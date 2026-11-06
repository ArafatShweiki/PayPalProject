import "../server/env";
import { readFileSync, writeFileSync } from "node:fs";
import { planImport, reconcileLegacy } from "./legacy-storage";
import { backendStorage } from "../server/backend-storage";
import { getServerSupabase } from "../server/supabase";
const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
try {
  const file = option("--source");
  if (!file) throw new Error("Pass --source PATH");
  const plan = planImport(JSON.parse(readFileSync(file, "utf8")));
  const apply = args.includes("--apply"),
    verify = args.includes("--verify");
  if (apply && args.includes("--dry-run"))
    throw new Error("Choose apply or dry-run");
  const url = new URL(
    process.env.SUPABASE_URL || "https://unconfigured.invalid",
  );
  if (apply && option("--confirm-project") !== url.hostname)
    throw new Error(
      "Import requires --confirm-project with the exact intended SUPABASE_URL hostname",
    );
  if (plan.conflicts.length || plan.unsupported.length)
    throw new Error(
      "Source has conflicting or unsupported records; review an offline import plan first",
    );
  const result =
    apply || verify
      ? await reconcileLegacy(
          plan,
          {
            read: (id) => backendStorage.read(id),
            cas: (id, version, value) => backendStorage.cas(id, version, value),
            observation: (provider, snapshot) =>
              backendStorage.observation(provider, snapshot),
            readObservation: async (id) => {
              const { data, error } = await getServerSupabase()
                .from("forex_snapshots")
                .select("provider,snapshot")
                .eq("id", id)
                .maybeSingle();
              if (error) throw new Error("Destination read unavailable");
              return data;
            },
          },
          apply,
        )
      : { inserted: 0, matched: 0, missing: 0, conflicts: [], complete: false };
  const report = {
    dryRun: !apply,
    destinationChecked: apply || verify,
    sourceRecords: plan.records.length,
    observations: plan.observations.length,
    skippedTransient: plan.skippedTransient,
    ...result,
    financialTablesChanged: false,
  };
  // IDs/digests only; no account payloads, provider tokens or credentials.
  console.log(JSON.stringify(report, null, 2));
  if (option("--report"))
    writeFileSync(option("--report")!, JSON.stringify(report, null, 2), {
      flag: "wx",
    });
  if (result.missing || result.conflicts.length) process.exitCode = 1;
} catch {
  console.error(
    "Legacy import validation/reconciliation failed. Check arguments, project confirmation, source checksums and destination migration. No existing record was overwritten; any completed inserts are safe to reconcile/retry.",
  );
  process.exitCode = 1;
}
