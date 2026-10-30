import type { UserData } from "../shared/types";
import { currencies } from "../shared/money";
import { userRead } from "./store";
import {
  readProfile,
  readWallets,
  readTransactions,
  readSavingsRules,
} from "./supabase";

export async function databaseState(sub: string, uid: string) {
  const profile = await readProfile(sub);
  const wallets = await readWallets(sub);
  const transactions = await readTransactions(sub);
  const rules = await readSavingsRules(sub);
  const data = await userRead(uid);
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
    .map((transaction) => {
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
        typeof metadata.originalId === "string"
          ? metadata.originalId
          : undefined;
      const to =
        typeof metadata.to === "string" &&
        currencies.includes(metadata.to as (typeof currencies)[number])
          ? (metadata.to as (typeof currencies)[number])
          : undefined;
      return {
        id: transaction.id,
        at: transaction.occurred_at,
        kind: transaction.kind,
        currency: primary.currency,
        amount: Math.abs(
          transaction.kind === "purchase" || transaction.kind === "refund"
            ? postings.find((entry) => entry.account === "external")!.amount
            : primary.amount,
        ),
        saved: Math.abs(
          postings
            .filter((entry) => entry.account === "savings")
            .reduce((total, entry) => total + entry.amount, 0),
        ),
        description: transaction.description,
        category: transaction.category,
        postings,
        ...(originalId ? { originalId } : {}),
        ...(typeof metadata.goalId === "string"
          ? { goalId: metadata.goalId }
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
        ...(typeof metadata.method === "string"
          ? { method: metadata.method }
          : {}),
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
    });
  return { data, walletBalances, savingsBalances };
}
