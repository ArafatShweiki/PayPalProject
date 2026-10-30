import { z } from "zod";
import { createHash } from "node:crypto";
import { ServiceError, setting, withLease } from "./reliability";
import { read, update } from "./store";
import { persistForex, readForexSnapshots } from "./forex-store";
import type { MarketStatus, Snapshot } from "../shared/types";
export const forexEnabled = () => process.env.MARKET_DATA_PROVIDER === "twelve";
export const forexPollMs = () =>
  Math.max(60000, setting("FOREX_POLL_MS", 300000));
export const forexStaleMs = () =>
  Math.max(forexPollMs() * 2, setting("FOREX_STALE_MS", 180000));
const SOURCE = "https://twelvedata.com/forex";
const STATUS = "twelve_status";
type InternalStatus = Partial<MarketStatus> & {
  credentialHash?: string;
  day?: string;
  dayCredits?: number;
  minute?: number;
  minuteCredits?: number;
};
export async function forexStatus(): Promise<MarketStatus> {
  const stored = await read<InternalStatus>(STATUS);
  return {
    provider: "Twelve Data",
    configured: !!process.env.TWELVE_DATA_API_KEY,
    transport: "polling",
    pollMs: forexPollMs(),
    staleMs: forexStaleMs(),
    connection: stored?.connection ?? "waiting",
    lastAttemptAt: stored?.lastAttemptAt,
    lastSuccessAt: stored?.lastSuccessAt,
    nextAttemptAt: stored?.nextAttemptAt,
    error: stored?.error,
    failures: stored?.failures,
  };
}
// Accept more provider decimals, round half-up once to the existing millionth rate scale.
export function forexUnits(value: string): number {
  if (!/^\d{1,6}(\.\d{1,11})?$/.test(value))
    throw new ServiceError("The provider returned an invalid Forex price.");
  const [whole, fraction = ""] = value.split("."),
    digits = fraction.padEnd(7, "0");
  const units =
    BigInt(whole) * 1000000n +
    BigInt(digits.slice(0, 6)) +
    (digits[6] >= "5" ? 1n : 0n);
  if (units <= 0n || units > BigInt(Number.MAX_SAFE_INTEGER))
    throw new ServiceError("The provider returned an invalid Forex price.");
  return Number(units);
}
const quoteSchema = z.object({
  symbol: z.string(),
  close: z.string(),
  timestamp: z.number().int().positive(),
  last_quote_at: z.number().int().positive().optional(),
  is_market_open: z.boolean().optional(),
});
export function parseForexQuotes(
  raw: unknown[],
  symbols: string[],
  now = Date.now(),
): Snapshot {
  const legs = raw.map((input, i) => {
    const q = quoteSchema.safeParse(input);
    if (!q.success || q.data.symbol !== symbols[i])
      throw new ServiceError("The provider returned an invalid Forex quote.");
    const at = (q.data.last_quote_at ?? q.data.timestamp) * 1000;
    if (at > now + 60000)
      throw new ServiceError(
        "The provider returned an invalid market timestamp.",
      );
    return {
      symbol: q.data.symbol,
      rate: forexUnits(q.data.close),
      observedAt: new Date(at).toISOString(),
      marketOpen: q.data.is_market_open ?? null,
    };
  });
  if (legs.length !== 2)
    throw new ServiceError("Both required Forex pairs must be available.");
  const times = legs.map((q) => Date.parse(q.observedAt));
  if (
    Math.max(...times) - Math.min(...times) >
    setting("FOREX_MAX_SKEW_MS", 120000)
  )
    throw new ServiceError(
      "The Forex legs are too far apart in time for a reliable cross-rate.",
    );
  const inverse = (v: number) =>
    Number((1000000000000n + BigInt(v) / 2n) / BigInt(v));
  const usdIls =
    legs[0].symbol === "USD/ILS" ? legs[0].rate : inverse(legs[0].rate);
  const usdJod =
    legs[1].symbol === "USD/JOD" ? legs[1].rate : inverse(legs[1].rate);
  const jodIls = Number(
    (BigInt(usdIls) * 1000000n + BigInt(usdJod) / 2n) / BigInt(usdJod),
  );
  return {
    id: createHash("sha256")
      .update(JSON.stringify(legs))
      .digest("hex")
      .slice(0, 24),
    fetchedAt: new Date(now).toISOString(),
    publishedAt: new Date(Math.min(...times)).toISOString(),
    source: SOURCE,
    quotes: [],
    ils: { ILS: 1000000, USD: usdIls, JOD: jodIls },
    market: { provider: "Twelve Data", timeKind: "minute quote", legs },
  };
}
async function providerQuote(symbol: string) {
  const url = new URL("https://api.twelvedata.com/quote");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("dp", "8");
  const response = await fetch(url, {
    headers: { Authorization: `apikey ${process.env.TWELVE_DATA_API_KEY}` },
    signal: AbortSignal.timeout(12000),
  });
  const body = (await response.json()) as { status?: string; code?: number };
  if (response.status === 429 || body.code === 429)
    throw new ServiceError(
      "Twelve Data quota reached. Retaining the last recorded quotes.",
      429,
      Math.max(60, Number(response.headers.get("retry-after")) || 60),
    );
  if (!response.ok || body.status === "error")
    throw new ServiceError(
      response.status === 401 ||
        body.code === 401 ||
        response.status === 403 ||
        body.code === 403
        ? "Twelve Data credentials or pair entitlements need configuration."
        : "Twelve Data did not provide the requested Forex pair. Last observations are retained.",
    );
  return body;
}
let pending: Promise<Snapshot[]> | undefined;
export async function refreshForex(): Promise<Snapshot[]> {
  if (pending) return pending;
  pending = withLease("twelve-provider", 1, async () => {
    if (!process.env.TWELVE_DATA_API_KEY)
      throw new ServiceError(
        "Configure the server-side TWELVE_DATA_API_KEY to receive Forex market data.",
      );
    const credentialHash = createHash("sha256")
      .update(process.env.TWELVE_DATA_API_KEY)
      .digest("hex");
    const status = await read<InternalStatus>(STATUS);
    if (
      status?.credentialHash === credentialHash &&
      status.nextAttemptAt &&
      Date.parse(status.nextAttemptAt) > Date.now()
    )
      return readForexSnapshots();
    const now = Date.now(),
      day = new Date(now).toISOString().slice(0, 10),
      minute = Math.floor(now / 60000);
    const reservation = await update<
      InternalStatus,
      { allowed: boolean; retryAfter: number }
    >(
      STATUS,
      () => ({}),
      (current) => {
        if (current.day !== day) {
          current.day = day;
          current.dayCredits = 0;
        }
        if (current.minute !== minute) {
          current.minute = minute;
          current.minuteCredits = 0;
        }
        const daily =
          (current.dayCredits ?? 0) + 2 >
          setting("TWELVE_DATA_DAILY_CREDITS", 800);
        const minuteLimited =
          (current.minuteCredits ?? 0) + 2 >
          setting("TWELVE_DATA_MINUTE_CREDITS", 8);
        if (daily || minuteLimited) {
          const reset = daily
            ? Date.parse(day) + 86400000
            : (minute + 1) * 60000;
          current.nextAttemptAt = new Date(reset).toISOString();
          current.connection = "unavailable";
          current.error =
            "Configured Forex provider budget exhausted. Retaining recorded quotes.";
          return {
            allowed: false,
            retryAfter: Math.max(1, Math.ceil((reset - now) / 1000)),
          };
        }
        current.dayCredits = (current.dayCredits ?? 0) + 2;
        current.minuteCredits = (current.minuteCredits ?? 0) + 2;
        current.credentialHash = credentialHash;
        current.lastAttemptAt = new Date(now).toISOString();
        current.nextAttemptAt = new Date(now + forexPollMs()).toISOString();
        return { allowed: true, retryAfter: 0 };
      },
    );
    if (!reservation.allowed)
      throw new ServiceError(
        "Configured Forex provider budget exhausted. Retaining recorded quotes.",
        429,
        reservation.retryAfter,
      );
    try {
      const symbols = [
        process.env.FOREX_ILS_SYMBOL || "USD/ILS",
        process.env.FOREX_JOD_SYMBOL || "USD/JOD",
      ];
      if (
        !["USD/ILS", "ILS/USD"].includes(symbols[0]) ||
        !["USD/JOD", "JOD/USD"].includes(symbols[1])
      )
        throw new ServiceError(
          "Configure supported USD/ILS and USD/JOD Forex legs or their inverses.",
        );
      const raw = await Promise.all(symbols.map(providerQuote));
      const snapshot = parseForexQuotes(raw, symbols);
      const prior = await readForexSnapshots(),
        last = prior.at(-1);
      if (
        !last ||
        Date.parse(snapshot.publishedAt!) >= Date.parse(last.publishedAt!)
      )
        await persistForex(snapshot);
      await update<InternalStatus, void>(
        STATUS,
        () => ({}),
        (current) => {
          current.lastSuccessAt = new Date().toISOString();
          current.connection = "connected";
          current.error = undefined;
          current.failures = 0;
        },
      );
      return readForexSnapshots();
    } catch (error) {
      await update<InternalStatus, void>(
        STATUS,
        () => ({}),
        (current) => {
          current.failures = (current.failures ?? 0) + 1;
          current.connection = "unavailable";
          current.error =
            error instanceof ServiceError
              ? error.message
              : "Forex provider or storage is temporarily unavailable. Last observations are retained.";
          const cooldown =
            error instanceof ServiceError ? error.retryAfter * 1000 : 0;
          current.nextAttemptAt = new Date(
            Date.now() +
              Math.max(
                cooldown,
                Math.min(
                  3600000,
                  forexPollMs() * 2 ** Math.min(current.failures - 1, 4),
                ),
              ),
          ).toISOString();
        },
      );
      throw error instanceof ServiceError
        ? error
        : new ServiceError(
            "Forex provider or storage is temporarily unavailable. Last observations are retained.",
          );
    }
  })
    .catch(async (error) => {
      if (error instanceof ServiceError && error.status === 429) {
        const prior = await readForexSnapshots();
        if (prior.length) return prior;
      }
      throw error;
    })
    .finally(() => {
      pending = undefined;
    });
  return pending;
}
