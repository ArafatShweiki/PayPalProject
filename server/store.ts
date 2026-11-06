import { getServerSupabase, supabaseEnabled, readProfile } from "./supabase";
import "./env";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  backendStorage,
  currentGuards,
  sqlStorage,
  storageMode,
} from "./backend-storage";
import type { UserData, Snapshot } from "../shared/types";
import { initialUser } from "./ledger";
if (!["supabase", "sqlite"].includes(storageMode()))
  throw new Error(
    "Unsupported STORAGE adapter. Apply the backend storage migration and use STORAGE=supabase; SQLite is local/test only.",
  );
if (process.env.VERCEL && (!sqlStorage() || !supabaseEnabled()))
  throw new Error(
    "Vercel requires Supabase-only storage with SUPABASE_ENABLED=true.",
  );
const db = sqlStorage()
  ? null
  : await (async () => {
      const { DatabaseSync } = await import("node:sqlite");
      const path = process.env.DATABASE_PATH || "data/walletwise.db";
      mkdirSync(dirname(path), { recursive: true });
      const db = new DatabaseSync(path);
      db.exec("PRAGMA busy_timeout=5000");
      db.exec(
        "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, value TEXT NOT NULL)",
      );
      return db;
    })();
export async function read<T>(id: string): Promise<T | undefined> {
  if (sqlStorage()) return backendStorage.read<T>(id);
  const row = db!.prepare("SELECT value FROM records WHERE id=?").get(id) as
    { value: string } | undefined;
  return row ? JSON.parse(row.value) : undefined;
}
export async function update<T, R>(
  id: string,
  initial: () => T,
  fn: (data: T) => R,
): Promise<R> {
  if (sqlStorage()) return backendStorage.update(id, initial, fn);
  db!.exec("BEGIN IMMEDIATE");
  try {
    const row = db!.prepare("SELECT value FROM records WHERE id=?").get(id) as
      { value: string } | undefined;
    const data: T = row ? JSON.parse(row.value) : initial();
    const result = fn(data);
    db!
      .prepare(
        "INSERT INTO records(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .run(id, JSON.stringify(data));
    db!.exec("COMMIT");
    return result;
  } catch (e) {
    db!.exec("ROLLBACK");
    throw e;
  }
}
const identities = new Map<string, string>();
export function registerUserIdentity(uid: string, sub: string) {
  identities.set(uid, sub);
}
export async function userUpdate<R>(
  uid: string,
  fn: (data: UserData) => R,
): Promise<R> {
  if (!supabaseEnabled()) throw new Error("Account storage is unavailable.");
  const client = getServerSupabase();
  for (let attempt = 0; attempt < 12; attempt++) {
    const { data: row, error } = await client
      .from("account_state")
      .select("auth0_sub,version,state")
      .eq("user_id", uid)
      .maybeSingle();
    if (error) throw new Error("Account storage is unavailable.");
    const sub = identities.get(uid) || row?.auth0_sub;
    if (!sub || (row && row.auth0_sub !== sub))
      throw new Error("Verified account identity required.");
    // One-time copy of this authenticated account's auxiliary records only.
    // No deletion; SQL wallets/transactions remain the authoritative ledger.
    const state: UserData = structuredClone(
      row?.state ?? (await read<UserData>(`user_${uid}`)) ?? initialUser(),
    );
    state.auth0Sub = sub;
    const profile = await readProfile(sub);
    if (profile)
      Object.assign(state.preferences, profile.wallet_preferences, {
        name: profile.full_name || "",
        preferred: profile.preferred_currency,
        savings:
          profile.savings_enabled === null
            ? "unseen"
            : profile.savings_enabled
              ? "enabled"
              : "disabled",
        notifications: profile.currency_notifications,
      });
    const result = fn(state);
    if (sqlStorage() && currentGuards().length) {
      if (
        await backendStorage.accountCas(uid, sub, row?.version ?? null, state)
      )
        return result;
      continue;
    }
    const write = row
      ? await client
          .from("account_state")
          .update({
            state,
            version: row.version + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", uid)
          .eq("version", row.version)
          .select("user_id")
      : await client
          .from("account_state")
          .insert({ user_id: uid, auth0_sub: sub, state })
          .select("user_id");
    if (write.error?.code === "23505") continue;
    if (write.error) throw new Error("Account storage is unavailable.");
    if (write.data?.length) return result;
  }
  throw new Error("Your information changed. Please try again.");
}
// Reads no longer perform a compare-and-swap write on every request.
export async function userRead(
  uid: string,
  profile?: Awaited<ReturnType<typeof readProfile>>,
) {
  if (!supabaseEnabled()) throw new Error("Account storage is unavailable.");
  const { data: row, error } = await getServerSupabase()
    .from("account_state")
    .select("auth0_sub,state")
    .eq("user_id", uid)
    .maybeSingle();
  if (error) throw new Error("Account storage is unavailable.");
  const sub = identities.get(uid) || row?.auth0_sub;
  if (!sub || (row && row.auth0_sub !== sub))
    throw new Error("Verified account identity required.");
  if (!row) return userUpdate(uid, (data) => data);
  const data: UserData = structuredClone(row.state);
  const current = profile === undefined ? await readProfile(sub) : profile;
  if (current)
    Object.assign(data.preferences, current.wallet_preferences, {
      name: current.full_name || "",
      preferred: current.preferred_currency,
      savings:
        current.savings_enabled === null
          ? "unseen"
          : current.savings_enabled
            ? "enabled"
            : "disabled",
      notifications: current.currency_notifications,
    });
  return data;
}
export const snapshots = async (): Promise<Snapshot[]> =>
  process.env.MARKET_DATA_PROVIDER === "twelve"
    ? (await import("./forex-store")).readForexSnapshots()
    : (await import("./forex-store")).readPmaSnapshots();
export async function users(): Promise<string[]> {
  if (!supabaseEnabled()) return [];
  const result: string[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await getServerSupabase()
      .from("account_state")
      .select("user_id,auth0_sub")
      .order("user_id")
      .range(offset, offset + 499);
    if (error) throw new Error("Account storage is unavailable.");
    for (const row of data || []) {
      registerUserIdentity(row.user_id, row.auth0_sub);
      result.push(row.user_id);
    }
    if (!data || data.length < 500) return result;
  }
}
