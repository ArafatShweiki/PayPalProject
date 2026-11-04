const randomUUID = () => globalThis.crypto.randomUUID();
import { currencies, roundUp, type Currency } from "./money";
import type { Balances, Entry, UserData } from "./types";
export const emptyBalances = (): Balances => ({ ILS: 0, USD: 0, JOD: 0 });
export function balances(
  data: UserData,
  account: "available" | "savings" = "available",
): Balances {
  const result = emptyBalances();
  for (const e of data.ledger)
    for (const p of e.postings)
      if (p.account === account) result[p.currency] += p.amount;
  return result;
}
export function append(data: UserData, entry: Entry) {
  for (const c of currencies)
    if (
      entry.postings
        .filter((p) => p.currency === c)
        .reduce((s, p) => s + p.amount, 0) !== 0
    )
      throw new Error("Unbalanced ledger entry.");
  data.ledger.push(entry);
  for (const account of ["available", "savings"] as const)
    if (
      Object.values(balances(data, account)).some(
        (n) => !Number.isSafeInteger(n) || n < 0,
      )
    ) {
      data.ledger.pop();
      throw new Error(
        "Insufficient available balance for the purchase and savings.",
      );
    }
}
export function initialUser(): UserData {
  const data: UserData = {
    createdAt: new Date().toISOString(),
    preferences: {
      name: "",
      preferred: "ILS",
      savings: "unseen",
      increments: { ILS: 500, USD: 100, JOD: 1000 },
      caps: { ILS: 2000, USD: 500, JOD: 5000 },
      goalIds: {},
      frequency: "monthly",
      notifications: true,
    },
    ledger: [],
    goals: [],
    alerts: [],
    notices: [],
    reports: [],
    recommendations: [],
    operations: {},
  };
  return data;
}

export function purchase(
  data: UserData,
  currency: Currency,
  amount: number,
  description: string,
  category: string,
) {
  if (!Number.isSafeInteger(amount) || amount <= 0)
    throw new Error(
      "Purchase amount must be a positive integer in minor units.",
    );
  const saved =
    data.preferences.savings === "enabled" &&
    data.savingsRuleEnabled?.[currency] !== false
      ? roundUp(
          amount,
          data.preferences.increments[currency],
          data.preferences.caps[currency],
        )
      : 0;
  const selected = data.preferences.goalIds[currency];
  const goal = data.goals.find(
    (g) =>
      g.id === selected &&
      g.currency === currency &&
      !g.archived &&
      goalSaved(data, g.id) < g.target,
  );
  const entry: Entry = {
    id: randomUUID(),
    at: new Date().toISOString(),
    kind: "purchase",
    currency,
    amount,
    saved,
    description,
    category,
    ...(saved > 0
      ? {
          goalId: goal?.id,
          savingsDestination: goal?.id ?? `general:${currency}`,
        }
      : {}),
    postings: [
      { currency, account: "available", amount: -amount - saved },
      { currency, account: "external", amount },
      { currency, account: "savings", amount: saved },
    ],
  };
  append(data, entry);
  if (!goal || goalSaved(data, goal.id) >= goal.target)
    delete data.preferences.goalIds[currency];
  return entry;
}
export function refund(data: UserData, id: string) {
  const e = data.ledger.find((e) => e.id === id && e.kind === "purchase");
  if (!e) throw new Error("Purchase not found.");
  const existing = data.ledger.find((e) => e.originalId === id);
  if (existing) return existing;
  const entry: Entry = {
    ...e,
    id: randomUUID(),
    at: new Date().toISOString(),
    kind: "refund",
    originalId: id,
    description: `Refund: ${e.description}`,
    postings: e.postings.map((p) => ({ ...p, amount: -p.amount })),
  };
  append(data, entry);
  return entry;
}
export function goalSaved(data: UserData, id: string): number {
  return data.ledger
    .filter((e) => e.goalId === id)
    .reduce(
      (s, e) =>
        s +
        (e.allocationDelta ??
          e.postings
            .filter((p) => p.account === "savings")
            .reduce((sum, p) => sum + p.amount, 0)),
      0,
    );
}
export function generalSavings(data: UserData): Balances {
  const result = emptyBalances();
  for (const entry of data.ledger) {
    if (entry.allocationDelta) result[entry.currency] -= entry.allocationDelta;
    if (!entry.goalId)
      for (const posting of entry.postings)
        if (posting.account === "savings")
          result[posting.currency] += posting.amount;
  }
  return result;
}
export function idempotent<T>(
  data: UserData,
  key: string,
  fingerprint: string,
  work: () => T,
): T {
  const prior = data.operations[key];
  if (prior) {
    if (prior.fingerprint !== fingerprint)
      throw new Error(
        "This request identifier was already used for different input.",
      );
    return prior.result as T;
  }
  const result = work();
  data.operations[key] = { fingerprint, result };
  return result;
}
