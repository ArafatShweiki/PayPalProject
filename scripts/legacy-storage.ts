import { createHash } from "node:crypto";
import { z } from "zod";
import type { Snapshot } from "../shared/types";
export const digest = (value: unknown): string => {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, canonical(x)]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
};
const safeInteger = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const snapshotSchema = z
  .object({
    id: z.string().min(1).max(128),
    fetchedAt: z.iso.datetime(),
    publishedAt: z.iso.datetime().nullable(),
    source: z.string().min(1).max(1000),
    ils: z.object({
      ILS: z.literal(1000000),
      USD: safeInteger,
      JOD: safeInteger,
    }),
    quotes: z.array(
      z.object({
        pair: z.string(),
        bid: z.string().regex(/^\d+(\.\d+)?$/),
        ask: z.string().regex(/^\d+(\.\d+)?$/),
      }),
    ),
    market: z
      .object({
        provider: z.literal("Twelve Data"),
        timeKind: z.literal("minute quote"),
        legs: z.array(
          z.object({
            symbol: z.string(),
            rate: safeInteger,
            observedAt: z.iso.datetime(),
            marketOpen: z.boolean().nullable(),
          }),
        ),
      })
      .optional(),
  })
  .strict();
export type LegacyRecord = { id: string; value: unknown; hash: string };
export const exportSchema = z
  .object({
    format: z.literal(1),
    source: z.string(),
    exportedAt: z.iso.datetime(),
    records: z
      .array(
        z.object({
          id: z.string().min(1).max(256),
          value: z.unknown(),
          hash: z.string().regex(/^[a-f0-9]{64}$/),
        }),
      )
      .max(10000),
  })
  .strict();
export type ImportPlan = {
  records: LegacyRecord[];
  observations: { provider: "pma" | "twelve"; snapshot: Snapshot }[];
  skippedTransient: number;
  unsupported: string[];
  conflicts: string[];
};
export function planImport(input: unknown): ImportPlan {
  const source = exportSchema.parse(input);
  const plan: ImportPlan = {
    records: [],
    observations: [],
    skippedTransient: 0,
    unsupported: [],
    conflicts: [],
  };
  const hashes = new Map<string, string>();
  for (const record of source.records) {
    if (digest(record.value) !== record.hash)
      throw new Error("Export integrity check failed");
    if (/^(limit_|lease_|cache_)/.test(record.id)) {
      plan.skippedTransient++;
      continue;
    }
    if (record.id === "rates" || record.id === "forex_snapshots") {
      const provider = record.id === "rates" ? "pma" : "twelve";
      for (const raw of z.array(snapshotSchema).parse(record.value)) {
        const id = `observation:${raw.id}`,
          hash = digest({
            provider,
            snapshot: { ...raw, fetchedAt: undefined },
          });
        if (hashes.has(id)) {
          if (hashes.get(id) !== hash) plan.conflicts.push(id);
          continue;
        }
        hashes.set(id, hash);
        plan.observations.push({ provider, snapshot: raw });
      }
    } else if (
      /^user_[A-Za-z0-9_-]+$/.test(record.id) ||
      ["twelve_status", "forex_alerts_checkpoint"].includes(record.id)
    ) {
      if (
        typeof record.value !== "object" ||
        !record.value ||
        Array.isArray(record.value)
      )
        throw new Error("Invalid auxiliary record");
      if (record.id.startsWith("user_")) {
        const value = record.value as Record<string, unknown>;
        if (
          !value.preferences ||
          !Array.isArray(value.ledger) ||
          !Array.isArray(value.goals)
        )
          throw new Error("Invalid legacy account shape");
      }
      if (hashes.has(record.id)) {
        if (hashes.get(record.id) !== record.hash)
          plan.conflicts.push(record.id);
        continue;
      }
      hashes.set(record.id, record.hash);
      plan.records.push(record);
    } else plan.unsupported.push(record.id);
  }
  return plan;
}
// Firestore's REST representation, decoded without retaining the Admin SDK.
export function decodeFirestore(value: Record<string, unknown>): unknown {
  if ("nullValue" in value) return null;
  for (const key of ["stringValue", "booleanValue", "timestampValue"])
    if (key in value) return value[key];
  if ("integerValue" in value || "doubleValue" in value) {
    const n = Number(value.integerValue ?? value.doubleValue);
    if (
      !Number.isFinite(n) ||
      ("integerValue" in value && !Number.isSafeInteger(n))
    )
      throw new Error("Unsafe exported number");
    return n;
  }
  if ("arrayValue" in value)
    return (
      (value.arrayValue as { values?: Record<string, unknown>[] }).values ?? []
    ).map(decodeFirestore);
  if ("mapValue" in value)
    return Object.fromEntries(
      Object.entries(
        (value.mapValue as { fields?: Record<string, Record<string, unknown>> })
          .fields ?? {},
      ).map(([k, v]) => [k, decodeFirestore(v)]),
    );
  throw new Error("Unsupported Firestore value; source unchanged");
}

export type ImportDestination = {
  read: (id: string) => Promise<unknown>;
  cas: (id: string, version: null, value: unknown) => Promise<boolean>;
  observation: (
    provider: "pma" | "twelve",
    snapshot: Snapshot,
  ) => Promise<boolean>;
  readObservation: (
    id: string,
  ) => Promise<{ provider: string; snapshot: Snapshot } | null>;
};
export async function reconcileLegacy(
  plan: ImportPlan,
  destination: ImportDestination,
  apply: boolean,
) {
  if (plan.conflicts.length || plan.unsupported.length)
    throw new Error("Source requires review");
  let inserted = 0,
    matched = 0,
    missing = 0;
  const conflicts: string[] = [];
  for (const record of plan.records) {
    let existing = await destination.read(record.id);
    if (existing === undefined && apply) {
      if (await destination.cas(record.id, null, record.value)) inserted++;
      existing = await destination.read(record.id);
    }
    if (existing === undefined) missing++;
    else if (digest(existing) === record.hash) matched++;
    else conflicts.push(`record:${record.id}`);
  }
  for (const { provider, snapshot } of plan.observations) {
    let existing = await destination.readObservation(snapshot.id);
    if (!existing && apply) {
      if (await destination.observation(provider, snapshot)) inserted++;
      existing = await destination.readObservation(snapshot.id);
    }
    if (!existing) missing++;
    else if (
      existing.provider === provider &&
      digest({ ...existing.snapshot, fetchedAt: undefined }) ===
        digest({ ...snapshot, fetchedAt: undefined })
    )
      matched++;
    else conflicts.push(`observation:${snapshot.id}`);
  }
  return {
    inserted,
    matched,
    missing,
    conflicts,
    complete: missing === 0 && conflicts.length === 0,
  };
}
