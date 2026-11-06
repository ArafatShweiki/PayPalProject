import { forexEnabled, forexStaleMs, refreshForex } from "./forex";
import { observationTime, snapshotRate } from "../shared/market";
import { setting, withLease } from "./reliability";
import { readProfile, supabaseEnabled } from "./supabase";
import { createHash, randomUUID } from "node:crypto";
import { changePercent, rateUnits, convert, money } from "../shared/money";
import type { Snapshot, UserData } from "../shared/types";
import { read, snapshots, update, userUpdate, users } from "./store";
import { persistPma } from "./forex-store";
export const PMA_URL = "https://wcur.pma.ps/webtools/currency/embed";
export const rateStaleMs = () =>
  forexEnabled()
    ? forexStaleMs()
    : Math.max(
        setting("RATE_CACHE_TTL_MS", 6 * 60 * 60 * 1000),
        setting("RATE_STALE_MS", 36 * 60 * 60 * 1000),
      );
export const stale = (s: Snapshot) =>
  Date.now() - Date.parse(observationTime(s)) > rateStaleMs();
export function parsePma(
  html: string,
  now = new Date().toISOString(),
): Snapshot {
  const quotes: Snapshot["quotes"] = [];
  for (const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [
      ...match[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi),
    ].map((m) => m[1].replace(/<[^>]*>/g, "").trim());
    if (["USD/ILS", "JOD/ILS"].includes(cells[0])) {
      rateUnits(cells[1]);
      rateUnits(cells[2]);
      quotes.push({ pair: cells[0], bid: cells[1], ask: cells[2] });
    }
  }
  if (quotes.length !== 2 || new Set(quotes.map((q) => q.pair)).size !== 2)
    throw new Error("PMA response format changed. Rates are unavailable.");
  const midpoint = (pair: string) => {
    const q = quotes.find((q) => q.pair === pair)!;
    return Math.floor((rateUnits(q.bid) + rateUnits(q.ask)) / 2);
  };
  return {
    id: createHash("sha256")
      .update(now + JSON.stringify(quotes))
      .digest("hex")
      .slice(0, 24),
    fetchedAt: now,
    publishedAt: null,
    source: PMA_URL,
    quotes,
    ils: { ILS: 1000000, USD: midpoint("USD/ILS"), JOD: midpoint("JOD/ILS") },
  };
}
export function evaluateAlerts(
  data: UserData,
  snapshot: Snapshot,
  now = Date.now(),
) {
  if (stale(snapshot)) return;
  for (const alert of data.alerts) {
    if (!alert.enabled) continue;
    if (alert.lastSnapshotId === snapshot.id) continue;
    const current = snapshotRate(snapshot, alert.from, alert.to);
    const previous = alert.lastObserved ?? alert.reference;
    alert.lastObserved = current;
    alert.lastSnapshotId = snapshot.id;
    if (!alert.reference) {
      alert.reference = current;
      continue;
    }
    const delta =
      alert.mode === "percent"
        ? changePercent(current, alert.reference)
        : (current - alert.reference) / 1000000;
    const target = alert.threshold * 1000000;
    const triggered =
      alert.mode === "target"
        ? alert.direction === "increase"
          ? previous < target && current >= target
          : previous > target && current <= target
        : alert.direction === "increase"
          ? delta >= alert.threshold
          : delta <= -alert.threshold;
    if (
      !triggered ||
      (alert.lastTriggered &&
        now - Date.parse(alert.lastTriggered) < 24 * 60 * 60 * 1000)
    )
      continue;
    const impact = alert.watched
      ? ` For ${money(alert.watched, alert.from)}, indicative value changed by ${money(convert(alert.watched, alert.from, alert.to, current) - convert(alert.watched, alert.from, alert.to, alert.reference), alert.to)} before fees.`
      : "";
    if (data.preferences.notifications)
      data.notices.unshift({
        id: randomUUID(),
        at: new Date(now).toISOString(),
        title: `${alert.from}/${alert.to} ${alert.direction}`,
        body: `Indicative midpoint moved ${changePercent(current, alert.reference).toFixed(2)}% from your reference. Current rate: ${(current / 1000000).toFixed(6)}.${impact} Before fees; not a prediction.`,
        read: false,
      });
    alert.reference = current;
    alert.lastTriggered = new Date(now).toISOString();
  }
}
let pending: Promise<Snapshot[]> | undefined;
export async function refreshRates(): Promise<Snapshot[]> {
  if (pending) return pending;
  if (forexEnabled()) {
    pending = refreshForex()
      .then(async (list) => {
        const latest = list.at(-1);
        if (latest) await processForexAlerts(latest);
        return list;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  }
  pending = withLease(
    "pma-refresh",
    1,
    async (lease) => {
      const prior = await snapshots();
      if (
        prior.length &&
        Date.now() - Date.parse(prior.at(-1)!.fetchedAt) <
          setting("RATE_CACHE_TTL_MS", 6 * 60 * 60 * 1000)
      )
        return prior;
      const res = await fetch(PMA_URL, {
        signal: AbortSignal.timeout(12000),
        headers: { "User-Agent": "dream-piggy-bank/1.0" },
      });
      if (!res.ok) throw new Error("PMA is currently unavailable.");
      const snapshot = parsePma(await res.text());
      const all = await persistPma(snapshot);
      await processAlerts(snapshot, lease?.renew);
      return all;
    },
    120000,
  ).finally(() => {
    pending = undefined;
  });
  return pending;
}

async function processAlerts(snapshot: Snapshot, renew?: () => Promise<void>) {
  for (const uid of await users()) {
    await renew?.();
    const existing = await userUpdate(uid, (data) => data);
    const profile =
      supabaseEnabled() && existing.auth0Sub
        ? await readProfile(existing.auth0Sub)
        : null;
    await userUpdate(uid, (data) => {
      if (profile)
        data.preferences.notifications = profile.currency_notifications;
      evaluateAlerts(data, snapshot);
    });
  }
}

async function processForexAlerts(snapshot: Snapshot) {
  if (
    (await read<{ id: string }>("forex_alerts_checkpoint"))?.id === snapshot.id
  )
    return;
  try {
    await withLease(
      "forex-alert-evaluation",
      1,
      async (lease) => {
        if (
          (await read<{ id: string }>("forex_alerts_checkpoint"))?.id ===
          snapshot.id
        )
          return;
        await processAlerts(snapshot, lease?.renew);
        await update<{ id: string }, void>(
          "forex_alerts_checkpoint",
          () => ({ id: "" }),
          (current) => {
            current.id = snapshot.id;
          },
        );
      },
      120000,
    );
  } catch (error) {
    if (!(error instanceof Error && "status" in error && error.status === 429))
      throw error;
  }
}
