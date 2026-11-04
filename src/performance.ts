// Development-only durations. Labels are fixed: never include tokens, subjects,
// balances, request bodies, emails, or provider responses in performance entries.
export type StartupStage =
  | "auth_restore"
  | "identity_token"
  | "profile_bootstrap"
  | "wallet_essential"
  | "dashboard_usable"
  | "overview"
  | "activity"
  | "market";
export function startStage(stage: StartupStage) {
  if (import.meta.env.DEV) performance.mark(`dpb:${stage}:start`);
}
export function finishStage(stage: StartupStage) {
  if (!import.meta.env.DEV) return;
  const name = `dpb:${stage}:start`;
  if (performance.getEntriesByName(name).length)
    performance.measure(`dpb:${stage}`, name);
}
