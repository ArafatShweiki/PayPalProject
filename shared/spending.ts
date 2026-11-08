import type { Entry } from "./types.js";
// The external leg is the merchant amount; savings/wallet legs are never spending.
export function spendingMovement(entry: Entry) {
  if (entry.kind !== "purchase" && entry.kind !== "refund")
    return { net: 0, gross: 0, refunds: 0 };
  const net = entry.postings
    .filter((p) => p.account === "external" && p.currency === entry.currency)
    .reduce((sum, p) => sum + p.amount, 0);
  if (!Number.isSafeInteger(net))
    throw new Error("Spending exceeds supported precision.");
  return {
    net,
    gross: entry.kind === "purchase" ? net : 0,
    refunds: entry.kind === "refund" ? -net : 0,
  };
}
