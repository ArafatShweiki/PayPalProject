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
export function initialUser(demo = false): UserData {
  const data: UserData = {
    createdAt: new Date().toISOString(),
    preferences: {
      name: "Alex",
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
    sandbox: [],
    operations: {},
  };
  if (!demo) {
    data.preferences.name = "";
    return data;
  }
  for (const c of currencies) {
    const amount = { ILS: 650000, USD: 120000, JOD: 450000 }[c];
    append(data, {
      id: randomUUID(),
      at: data.createdAt,
      kind: "opening",
      currency: c,
      amount,
      saved: 0,
      description: "Simulated opening balance",
      category: "Opening",
      postings: [
        { currency: c, account: "available", amount },
        { currency: c, account: "external", amount: -amount },
      ],
    });
  }
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
    data.preferences.savings === "enabled"
      ? roundUp(
          amount,
          data.preferences.increments[currency],
          data.preferences.caps[currency],
        )
      : 0;
  const entry: Entry = {
    id: randomUUID(),
    at: new Date().toISOString(),
    kind: "purchase",
    currency,
    amount,
    saved,
    description,
    category,
    goalId: data.preferences.goalIds[currency],
    postings: [
      { currency, account: "available", amount: -amount - saved },
      { currency, account: "external", amount },
      { currency, account: "savings", amount: saved },
    ],
  };
  append(data, entry);
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
    .reduce((s, e) => s + (e.kind === "refund" ? -e.saved : e.saved), 0);
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
