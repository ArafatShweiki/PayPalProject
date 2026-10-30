import { validateSupabaseConfiguration } from "./configuration";
import { databaseError } from "./database-errors";
import type { Preferences, Recommendation } from "../shared/types";
import "./env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const enabled = process.env.SUPABASE_ENABLED === "true";
const url = process.env.SUPABASE_URL || "";
const secret =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "";
validateSupabaseConfiguration(process.env);

let client: SupabaseClient | undefined;
export function supabaseEnabled() {
  return enabled;
}
export function getServerSupabase(): SupabaseClient {
  if (!enabled) throw new Error("Supabase integration is disabled.");
  return (client ??= createClient(url, secret, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }));
}
export type Profile = {
  wallet_preferences: Partial<Preferences>;
  auth0_sub: string;
  email: string | null;
  email_verified: boolean;
  full_name: string | null;
  preferred_currency: "ILS" | "USD" | "JOD";
  savings_enabled: boolean | null;
  currency_notifications: boolean;
  onboarding_completed_at: string | null;
};
export async function initializeProfile(sub: string): Promise<Profile> {
  const { data, error } = await getServerSupabase().rpc(
    "walletwise_initialize_user",
    { p_auth0_sub: sub },
  );
  if (error) throw databaseError(error);
  return data as Profile;
}
export async function readProfile(sub: string): Promise<Profile | null> {
  const { data, error } = await getServerSupabase()
    .from("profiles")
    .select("*")
    .eq("auth0_sub", sub)
    .maybeSingle();
  if (error) throw databaseError(error);
  return data as Profile | null;
}
export async function completeProfile(input: {
  sub: string;
  name: string;
  email: string;
  emailVerified: boolean;
  preferred: "ILS" | "USD" | "JOD";
  savings: boolean;
  notifications: boolean;
}): Promise<Profile> {
  const { data, error } = await getServerSupabase().rpc(
    "walletwise_complete_onboarding",
    {
      p_auth0_sub: input.sub,
      p_full_name: input.name,
      p_email: input.email || null,
      p_email_verified: input.emailVerified,
      p_preferred_currency: input.preferred,
      p_savings_enabled: input.savings,
      p_currency_notifications: input.notifications,
    },
  );
  if (error) throw databaseError(error);
  return data as Profile;
}
export async function updateProfilePreferences(
  sub: string,
  patch: Partial<Preferences>,
): Promise<Profile> {
  const { data, error } = await getServerSupabase().rpc(
    "walletwise_patch_preferences",
    {
      p_auth0_sub: sub,
      p_patch: patch,
    },
  );
  if (error) throw databaseError(error);
  return data as Profile;
}
export async function readSavingsRules(sub: string) {
  const { data, error } = await getServerSupabase()
    .from("savings_rules")
    .select("currency,enabled,increment_minor,cap_minor")
    .eq("auth0_sub", sub);
  if (error) throw databaseError(error);
  return data || [];
}
export async function readIdempotentTransaction(
  sub: string,
  requestId: string,
  fingerprint: string,
) {
  const { data, error } = await getServerSupabase()
    .from("transactions")
    .select("*")
    .eq("auth0_sub", sub)
    .eq("request_id", requestId)
    .maybeSingle();
  if (error) throw databaseError(error);
  if (data && data.request_fingerprint !== fingerprint)
    throw new Error("Idempotency key reused with different request");
  return data;
}
export async function applyLedgerTransaction(input: {
  sub: string;
  requestId: string;
  fingerprint: string;
  kind: string;
  description: string;
  category: string;
  entries: Array<{
    currency: "ILS" | "USD" | "JOD";
    account: "available" | "savings" | "external";
    amount_minor: number;
  }>;
  metadata?: Record<string, unknown>;
}) {
  const { data, error } = await getServerSupabase().rpc(
    "walletwise_apply_transaction",
    {
      p_auth0_sub: input.sub,
      p_request_id: input.requestId,
      p_request_fingerprint: input.fingerprint,
      p_kind: input.kind,
      p_description: input.description,
      p_category: input.category,
      p_entries: input.entries,
      p_metadata: input.metadata || {},
    },
  );
  if (error) throw databaseError(error);
  return data;
}
export async function readWallets(sub: string) {
  const { data, error } = await getServerSupabase()
    .from("wallets")
    .select("currency,available_minor,savings_minor")
    .eq("auth0_sub", sub);
  if (error) throw databaseError(error);
  return data || [];
}
export type StoredTransaction = {
  id: string;
  kind: "opening" | "purchase" | "refund" | "conversion";
  description: string;
  category: string;
  occurred_at: string;
  metadata: Record<string, unknown>;
  ledger_entries: Array<{
    currency: "ILS" | "USD" | "JOD";
    account: "available" | "savings" | "external";
    amount_minor: number | string;
  }>;
};
export async function readTransactions(
  sub: string,
): Promise<StoredTransaction[]> {
  const result: StoredTransaction[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await getServerSupabase()
      .from("transactions")
      .select(
        "id,kind,description,category,occurred_at,metadata,ledger_entries(currency,account,amount_minor)",
      )
      .eq("auth0_sub", sub)
      .in("kind", ["opening", "purchase", "refund", "conversion"])
      .order("occurred_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw databaseError(error);
    result.push(...((data || []) as StoredTransaction[]));
    if (!data || data.length < pageSize) return result;
  }
}
export async function readPurchasable(sub: string, transactionId: string) {
  const { data, error } = await getServerSupabase()
    .from("transactions")
    .select(
      "id,description,category,kind,metadata,ledger_entries(currency,account,amount_minor)",
    )
    .eq("auth0_sub", sub)
    .eq("id", transactionId)
    .eq("kind", "purchase")
    .maybeSingle();
  if (error) throw databaseError(error);
  return data;
}
export async function readPurchaseLedger(
  sub: string,
  transactionId: string,
): Promise<
  Array<{
    currency: "ILS" | "USD" | "JOD";
    account: "available" | "savings" | "external";
    amount_minor: number | string;
  }>
> {
  const { data, error } = await getServerSupabase()
    .from("ledger_entries")
    .select("currency,account,amount_minor")
    .eq("auth0_sub", sub)
    .eq("transaction_id", transactionId);
  if (error) throw databaseError(error);
  return (data || []) as Array<{
    currency: "ILS" | "USD" | "JOD";
    account: "available" | "savings" | "external";
    amount_minor: number | string;
  }>;
}

export async function acceptSavingsRule(sub: string, rule: Recommendation) {
  const { error } = await getServerSupabase().rpc(
    "walletwise_accept_savings_rule",
    {
      p_auth0_sub: sub,
      p_currency: rule.currency,
      p_current: rule.current,
      p_cap: rule.cap,
      p_suggested: rule.suggested,
      p_ledger_revision: rule.ledgerRevision,
    },
  );
  if (error) throw databaseError(error);
}
