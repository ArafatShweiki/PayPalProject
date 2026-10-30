import "../server/env";
import { parseForexQuotes } from "../server/forex";
const response = await fetch("https://api.twelvedata.com/forex_pairs", {
  signal: AbortSignal.timeout(12000),
});
if (!response.ok)
  throw new Error("Twelve Data symbol directory is unavailable.");
const directory = (await response.json()) as {
  data?: { symbol: string; currency_base: string; currency_quote: string }[];
};
const wanted = [
  "USD/ILS",
  "USD/JOD",
  "JOD/ILS",
  "ILS/USD",
  "JOD/USD",
  "ILS/JOD",
];
console.log(
  JSON.stringify(
    {
      source: "Twelve Data live symbol directory",
      checkedAt: new Date().toISOString(),
      pairs: directory.data?.filter((row) => wanted.includes(row.symbol)),
    },
    null,
    2,
  ),
);
if (!process.env.TWELVE_DATA_API_KEY)
  console.log(
    "Authenticated quote probe skipped: TWELVE_DATA_API_KEY is not configured. No live price accuracy or account entitlement was verified.",
  );
else {
  const symbols = [
    process.env.FOREX_ILS_SYMBOL || "USD/ILS",
    process.env.FOREX_JOD_SYMBOL || "USD/JOD",
  ];
  const bodies = await Promise.all(
    symbols.map(async (symbol) => {
      const url = new URL("https://api.twelvedata.com/quote");
      url.searchParams.set("symbol", symbol);
      url.searchParams.set("dp", "8");
      const result = await fetch(url, {
        headers: { Authorization: `apikey ${process.env.TWELVE_DATA_API_KEY}` },
        signal: AbortSignal.timeout(12000),
      });
      if (!result.ok)
        throw new Error(
          "Twelve Data quote probe failed. Check account entitlements, quota and credentials.",
        );
      return result.json();
    }),
  );
  const snapshot = parseForexQuotes(bodies, symbols);
  console.log(
    JSON.stringify(
      {
        source: snapshot.source,
        fetchedAt: snapshot.fetchedAt,
        observedAt: snapshot.publishedAt,
        legs: snapshot.market?.legs,
      },
      null,
      2,
    ),
  );
  console.log(
    "This probe does not write wallet data or persist quotes. It consumes two quote credits. API success does not verify redistribution/storage licensing or independent price accuracy.",
  );
}
