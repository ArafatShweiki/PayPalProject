export const currencies = ["ILS", "USD", "JOD"] as const;
export type Currency = (typeof currencies)[number];
export const scale = (c: Currency) => (c === "JOD" ? 1000 : 100);
export function minor(value: string, c: Currency): number {
  const digits = c === "JOD" ? 3 : 2;
  if (!new RegExp(`^\\d{1,9}(\\.\\d{1,${digits}})?$`).test(value))
    throw new Error(
      `Enter a positive ${c} amount with at most ${digits} decimals.`,
    );
  const [whole, fraction = ""] = value.split(".");
  const n = Number(
    BigInt(whole) * BigInt(scale(c)) + BigInt(fraction.padEnd(digits, "0")),
  );
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new Error("Amount must be greater than zero.");
  return n;
}
export function decimal(n: number, c: Currency): string {
  const s = scale(c);
  return `${n < 0 ? "-" : ""}${Math.floor(Math.abs(n) / s)}.${String(Math.abs(n) % s).padStart(c === "JOD" ? 3 : 2, "0")}`;
}
export function money(n: number, c: Currency): string {
  const [whole, fraction] = decimal(n, c).split(".");
  return `${c === "ILS" ? "₪" : c === "USD" ? "$" : "JD "}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}
export function roundUp(
  amount: number,
  increment: number,
  cap = Number.MAX_SAFE_INTEGER,
): number {
  if (
    ![amount, increment, cap].every(Number.isSafeInteger) ||
    amount <= 0 ||
    increment <= 0 ||
    cap < 0
  )
    throw new Error("Invalid round-up inputs.");
  return Math.min((increment - (amount % increment)) % increment, cap);
}
export const RATE_SCALE = 1_000_000;
export function rateUnits(v: string): number {
  if (!/^\d+(\.\d{1,6})?$/.test(v)) throw new Error("Invalid rate.");
  const [a, b = ""] = v.split(".");
  const n = Number(BigInt(a) * 1000000n + BigInt(b.padEnd(6, "0")));
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error("Invalid rate.");
  return n;
}
export function convert(
  amount: number,
  from: Currency,
  to: Currency,
  rate: number,
): number {
  if (
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    !Number.isSafeInteger(rate) ||
    rate <= 0
  )
    throw new Error("Invalid conversion.");
  const numerator = BigInt(amount) * BigInt(rate) * BigInt(scale(to));
  const denominator = BigInt(RATE_SCALE) * BigInt(scale(from));
  const result = Number((numerator + denominator / 2n) / denominator);
  if (!Number.isSafeInteger(result) || result < 0)
    throw new Error("Converted amount is too large.");
  return result;
}
export function crossRate(
  from: Currency,
  to: Currency,
  ils: Record<Currency, number>,
): number {
  return Number(
    (BigInt(ils[from]) * 1000000n + BigInt(ils[to]) / 2n) / BigInt(ils[to]),
  );
}
export const changePercent = (current: number, reference: number) =>
  reference > 0 ? ((current - reference) / reference) * 100 : 0;
