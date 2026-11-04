import { initialUser, append } from "../../shared/ledger";
export function fundedUser() {
  const data = initialUser();
  data.preferences.name = "Alex";
  for (const currency of ["ILS", "USD", "JOD"] as const) {
    const amount = { ILS: 650000, USD: 120000, JOD: 450000 }[currency];
    append(data, {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      kind: "opening",
      currency,
      amount,
      saved: 0,
      description: "Opening test balance",
      category: "Funding",
      postings: [
        { currency, account: "available", amount },
        { currency, account: "external", amount: -amount },
      ],
    });
  }
  return data;
}
