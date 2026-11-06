import { getServerSupabase, supabaseEnabled } from "./supabase";
import { read, update } from "./store";
import { databaseError } from "./database-errors";
import { backendStorage, sqlStorage } from "./backend-storage";
import type { Snapshot } from "../shared/types";
import {
  historyPeriods,
  observationTime,
  type HistoryPeriod,
} from "../shared/market";
export async function persistForex(snapshot: Snapshot) {
  if (sqlStorage()) {
    await backendStorage.observation("twelve", snapshot);
    return;
  }
  if (supabaseEnabled()) {
    const { error } = await getServerSupabase()
      .from("forex_snapshots")
      .upsert(
        {
          id: snapshot.id,
          observed_at: observationTime(snapshot),
          fetched_at: snapshot.fetchedAt,
          snapshot,
        },
        { onConflict: "id", ignoreDuplicates: true },
      );
    if (error) throw databaseError(error);
  } else
    await update<Snapshot[], void>(
      "forex_snapshots",
      () => [],
      (list) => {
        if (!list.some((s) => s.id === snapshot.id)) list.push(snapshot);
        const cutoff = Date.now() - 90 * 86400000;
        const retained = list
          .filter((s) => Date.parse(observationTime(s)) >= cutoff)
          .sort(
            (a, b) =>
              Date.parse(observationTime(a)) - Date.parse(observationTime(b)),
          )
          .slice(-40000);
        list.splice(0, list.length, ...retained);
      },
    );
}
export async function readForexSnapshots(): Promise<Snapshot[]> {
  if (supabaseEnabled()) {
    const { data, error } = await getServerSupabase()
      .from("forex_snapshots")
      .select("snapshot")
      .eq("provider", "twelve")
      .order("observed_at", { ascending: false })
      .order("fetched_at", { ascending: false })
      .limit(240);
    if (error) throw databaseError(error);
    return (data ?? []).map((row) => row.snapshot as Snapshot).reverse();
  }
  return ((await read<Snapshot[]>("forex_snapshots")) ?? []).slice(-240);
}
export async function readPmaSnapshots(): Promise<Snapshot[]> {
  if (!sqlStorage()) return (await read<Snapshot[]>("rates")) ?? [];
  const { data, error } = await getServerSupabase()
    .from("forex_snapshots")
    .select("snapshot")
    .eq("provider", "pma")
    .order("observed_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(366);
  if (error) throw databaseError(error);
  return (data ?? []).map((row) => row.snapshot as Snapshot).reverse();
}
export async function persistPma(snapshot: Snapshot): Promise<Snapshot[]> {
  if (sqlStorage()) {
    await backendStorage.observation("pma", snapshot);
    return readPmaSnapshots();
  }
  return update<Snapshot[], Snapshot[]>(
    "rates",
    () => [],
    (list) => {
      if (!list.some((s) => s.id === snapshot.id)) list.push(snapshot);
      if (list.length > 366) list.splice(0, list.length - 366);
      return list;
    },
  );
}
export async function forexHistory(period: HistoryPeriod): Promise<Snapshot[]> {
  const config = historyPeriods[period],
    since = Date.now() - config.ms;
  if (supabaseEnabled()) {
    const { data, error } = await getServerSupabase().rpc("forex_history", {
      p_since: new Date(since).toISOString(),
      p_bucket_seconds: config.bucket,
    });
    if (error) throw databaseError(error);
    return data as Snapshot[];
  }
  const buckets = new Map<number, Snapshot>();
  for (const s of (await read<Snapshot[]>("forex_snapshots")) ?? []) {
    const at = Date.parse(observationTime(s));
    if (at >= since) buckets.set(Math.floor(at / (config.bucket * 1000)), s);
  }
  return [...buckets.values()].slice(-500);
}
