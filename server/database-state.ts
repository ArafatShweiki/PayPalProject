import type { UserData, Entry } from "../shared/types";
import { currencies } from "../shared/money";
import { userRead } from "./store";
import {
  readProfile,
  readWallets,
  readTransactions,
  readSavingsRules,
  getServerSupabase,
  type StoredTransaction,
  type Profile,
} from "./supabase";

export async function databaseState(
  sub: string,
  uid: string,
  knownProfile?: Profile,
) {
  const profile = knownProfile ?? (await readProfile(sub));
  const [wallets, transactions, rules, data] = await Promise.all([
    readWallets(sub),
    readTransactions(sub),
    readSavingsRules(sub),
    userRead(uid, profile),
  ]);
  const walletBalances = { ILS: 0, USD: 0, JOD: 0 };
  const savingsBalances = { ILS: 0, USD: 0, JOD: 0 };
  for (const wallet of wallets) {
    walletBalances[wallet.currency as keyof typeof walletBalances] = Number(
      wallet.available_minor,
    );
    savingsBalances[wallet.currency as keyof typeof savingsBalances] = Number(
      wallet.savings_minor,
    );
  }
  const completedAt = profile?.onboarding_completed_at;
  const profileData: NonNullable<UserData["profile"]> = {
    fullName: profile?.full_name || "",
    email: profile?.email || "",
    emailVerified: profile?.email_verified || false,
    completedAt: completedAt || "",
  };
  data.profile = profileData;
  Object.assign(data.preferences, profile?.wallet_preferences);
  for (const rule of rules) {
    const currency = rule.currency as keyof typeof data.preferences.increments;
    data.preferences.increments[currency] = Number(rule.increment_minor);
    data.preferences.caps[currency] = Number(rule.cap_minor);
    data.savingsRuleEnabled ??= {};
    data.savingsRuleEnabled[currency] = rule.enabled;
  }
  data.preferences.name = profile?.full_name || "";
  data.preferences.preferred = profile?.preferred_currency || "ILS";
  data.preferences.savings =
    profile?.savings_enabled === null
      ? "unseen"
      : profile?.savings_enabled
        ? "enabled"
        : "disabled";
  data.preferences.notifications = profile?.currency_notifications || false;
  data.ledger = [...transactions]
    .sort(
      (a, b) =>
        a.occurred_at.localeCompare(b.occurred_at) || a.id.localeCompare(b.id),
    )
    .map(mapTransaction);
  const circleLedger = await getServerSupabase().rpc(
    "walletwise_own_circle_ledger",
    { p_sub: sub },
  );
  if (circleLedger.error && circleLedger.error.code !== "PGRST202")
    throw new Error("Account savings history is unavailable.");
  data.circleEntries = (circleLedger.data || []).map(
    (e: {
      amount: string;
      currency: Entry["currency"];
      at: string;
      circleId: string;
    }) => {
      const amount = Number(e.amount);
      if (!Number.isSafeInteger(amount))
        throw new Error("Account savings history is unavailable.");
      return { ...e, amount };
    },
  );
  const { data: pending, error } = await getServerSupabase()
    .from("funding_orders")
    .select("*")
    .eq("auth0_sub", sub)
    .is("transaction_id", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error("Account storage is unavailable.");
  for (const o of pending || [])
    data.ledger.push({
      id: o.id,
      at: o.created_at,
      kind: "funding",
      currency: o.currency,
      amount: Number(o.amount_minor),
      saved: 0,
      description: "Funds Added",
      category: "Funding",
      postings: [],
      status: o.status,
      fundingSource: "PayPal",
      reference: o.provider_order_id || o.id,
    });
  return { data, walletBalances, savingsBalances };
}

export function mapTransaction(transaction: StoredTransaction): Entry {
  const postings = transaction.ledger_entries.map((entry) => ({
    currency: entry.currency,
    account: entry.account,
    amount: Number(entry.amount_minor),
  }));
  const primary =
    postings.find(
      (entry) =>
        entry.account === "available" &&
        (transaction.kind !== "conversion" || entry.amount < 0),
    ) || postings[0];
  const metadata = transaction.metadata || {};
  const originalId =
    typeof metadata.originalId === "string" ? metadata.originalId : undefined;
  const to =
    typeof metadata.to === "string" &&
    currencies.includes(metadata.to as (typeof currencies)[number])
      ? (metadata.to as (typeof currencies)[number])
      : undefined;
  return {
    id: transaction.id,
    at: transaction.occurred_at,
    kind: metadata.merchantRefund
      ? "refund"
      : transaction.kind === "adjustment" && metadata.fundingId
        ? metadata.reversal
          ? ("reversal" as const)
          : ("funding" as const)
        : transaction.kind,
    ...(metadata.fundingId
      ? {
          status: String(metadata.status),
          fundingSource: "PayPal",
          reference: String(metadata.captureId),
        }
      : {}),
    currency: primary.currency,
    amount:
      typeof metadata.purchaseAmount === "number"
        ? metadata.purchaseAmount
        : Math.abs(
            transaction.kind === "purchase" || transaction.kind === "refund"
              ? postings.find((entry) => entry.account === "external")!.amount
              : primary.amount,
          ),
    saved:
      typeof metadata.sourceSaving === "number"
        ? metadata.sourceSaving
        : Math.abs(
            postings
              .filter((entry) => entry.account === "savings")
              .reduce((total, entry) => total + entry.amount, 0),
          ),
    description: transaction.description,
    category: transaction.category,
    postings,
    ...(typeof metadata.circleId === "string"
      ? { circleId: metadata.circleId }
      : {}),
    ...(metadata.saving && typeof metadata.saving === "object"
      ? { saving: metadata.saving as Entry["saving"] }
      : {}),
    ...(originalId ? { originalId } : {}),
    ...(metadata.savingsRetained ? { savingsRetained: true } : {}),
    ...(typeof metadata.goalId === "string" ? { goalId: metadata.goalId } : {}),
    ...(typeof metadata.goalId !== "string" &&
    typeof metadata.sourceGoal === "string"
      ? { goalId: metadata.sourceGoal }
      : {}),
    ...(typeof metadata.assignmentAmount === "number"
      ? { allocationDelta: metadata.assignmentAmount }
      : {}),
    ...(typeof metadata.savingsDestination === "string"
      ? { savingsDestination: metadata.savingsDestination }
      : {}),
    ...(to ? { to } : {}),
    ...(typeof metadata.received === "number"
      ? { received: metadata.received }
      : {}),
    ...(typeof metadata.rate === "number" ? { rate: metadata.rate } : {}),
    ...(typeof metadata.quoteSource === "string"
      ? { quoteSource: metadata.quoteSource }
      : {}),
    ...(typeof metadata.observedAt === "string"
      ? { observedAt: metadata.observedAt }
      : {}),
    ...(typeof metadata.method === "string" ? { method: metadata.method } : {}),
    ...(typeof metadata.simulatedFee === "number"
      ? { simulatedFee: metadata.simulatedFee }
      : {}),
    ...(typeof metadata.simulatedSpread === "number"
      ? { simulatedSpread: metadata.simulatedSpread }
      : {}),
    ...(typeof metadata.snapshotId === "string"
      ? { snapshotId: metadata.snapshotId }
      : {}),
  };
}
