import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { DatabaseError } from "./database-errors";
import { getServerSupabase } from "./supabase";
import type { Snapshot, UserData } from "../shared/types";

export type LeaseGuard = { scope: string; owner: string; generation: number };
export type Lease = LeaseGuard & { acquired: true; expiresAt: string };
export type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: unknown }>;
const context = new AsyncLocalStorage<LeaseGuard[]>();
export const currentGuards = () => context.getStore() ?? [];
export const withGuards = <T>(guard: LeaseGuard, work: () => Promise<T>) =>
  context.run([...currentGuards(), guard], work);
export const storageMode = () =>
  process.env.STORAGE ||
  (process.env.VERCEL || process.env.SUPABASE_ENABLED === "true"
    ? "supabase"
    : "sqlite");
export const sqlStorage = () => storageMode() === "supabase";
export class BackendLeaseBusy extends DatabaseError {
  readonly retryAfter = 3;
  constructor() {
    super("This service is busy. Please try again shortly.", 429);
  }
}

export class SupabaseBackendStorage {
  constructor(
    private readonly rpc: Rpc = (name, args) =>
      getServerSupabase().rpc(name, args),
  ) {}
  async call<T>(name: string, args: Record<string, unknown>): Promise<T> {
    try {
      const { data, error } = await this.rpc(name, args);
      if (error) throw error;
      return data as T;
    } catch {
      // Never return raw PostgREST SQL details, cached payloads or ownership tokens.
      throw new DatabaseError(
        "Shared backend storage is unavailable or its lease expired. Please retry.",
        503,
      );
    }
  }
  async record<T>(id: string) {
    return this.call<{ value: T | null; version: number } | null>(
      "walletwise_backend_read",
      { p_id: id },
    );
  }
  async read<T>(id: string): Promise<T | undefined> {
    return (await this.record<T>(id))?.value ?? undefined;
  }
  async cas(
    id: string,
    version: number | null,
    value: unknown,
    expiresAt: string | null = null,
  ) {
    return this.call<boolean>("walletwise_backend_cas", {
      p_id: id,
      p_version: version,
      p_value: value,
      p_expires_at: expiresAt,
      p_guards: currentGuards(),
    });
  }
  async update<T, R>(
    id: string,
    initial: () => T,
    fn: (value: T) => R,
  ): Promise<R> {
    // Retry conflicts only: never replay an uncertain/timed-out RPC. Callbacks
    // must be synchronous, side-effect-free transformations of auxiliary data.
    for (let attempt = 0; attempt < 12; attempt++) {
      const prior = await this.record<T>(id);
      const value = structuredClone(prior?.value ?? initial());
      const result = fn(value);
      const clean = JSON.parse(JSON.stringify(value));
      const expires = id.startsWith("cache_")
        ? new Date(clean.record?.expires || Date.now() + 60000).toISOString()
        : null;
      if (await this.cas(id, prior?.version ?? null, clean, expires))
        return result;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(20, attempt * 2 + Math.random() * 4)),
      );
    }
    throw new DatabaseError(
      "Shared information changed. Please try again.",
      503,
    );
  }
  consume(
    scope: string,
    identityHash: string,
    limit: number,
    windowMs: number,
  ) {
    return this.call<{
      allowed: boolean;
      bucket: { count: number; reset: number };
      retryAfter: number;
    }>("walletwise_consume_limit", {
      p_scope: scope,
      p_identity: identityHash,
      p_limit: limit,
      p_window_ms: windowMs,
    });
  }
  lease(
    action: "acquire" | "renew" | "release",
    scope: string,
    owner: string,
    slots: number,
    duration: number,
    generation: number | null = null,
  ) {
    return this.call<Lease | { acquired: false; released?: boolean }>(
      "walletwise_backend_lease",
      {
        p_action: action,
        p_scope: scope,
        p_owner: owner,
        p_slots: slots,
        p_duration_ms: duration,
        p_generation: generation,
      },
    );
  }
  async withLease<T>(
    scope: string,
    slots: number,
    work: (lease?: { renew: () => Promise<void> }) => Promise<T>,
    duration = 30000,
  ): Promise<T> {
    const owner = randomUUID();
    const lease = await this.lease("acquire", scope, owner, slots, duration);
    if (!lease.acquired) throw new BackendLeaseBusy();
    const renew = async () => {
      if (
        !(
          await this.lease(
            "renew",
            scope,
            owner,
            slots,
            duration,
            lease.generation,
          )
        ).acquired
      )
        throw new DatabaseError(
          "The operation lease expired. Please try again.",
          503,
        );
    };
    let failed = false;
    let result: T | undefined;
    let failure: unknown;
    try {
      result = await withGuards(lease, () => work({ renew }));
    } catch (error) {
      failed = true;
      failure = error;
    }
    try {
      await this.lease(
        "release",
        scope,
        owner,
        slots,
        duration,
        lease.generation,
      );
    } catch (error) {
      if (!failed) throw error;
    }
    if (failed) throw failure;
    return result as T;
  }
  observation(provider: "pma" | "twelve", snapshot: Snapshot) {
    return this.call<boolean>("walletwise_store_observation", {
      p_provider: provider,
      p_snapshot: snapshot,
      p_guards: currentGuards(),
    });
  }
  accountCas(
    uid: string,
    sub: string,
    version: number | null,
    state: UserData,
  ) {
    return this.call<boolean>("walletwise_backend_account_cas", {
      p_uid: uid,
      p_sub: sub,
      p_version: version,
      p_state: state,
      p_guards: currentGuards(),
    });
  }
  cleanup(batch = 500) {
    return this.call<number>("walletwise_cleanup_backend", { p_batch: batch });
  }
}
export const backendStorage = new SupabaseBackendStorage();
