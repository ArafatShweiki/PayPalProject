import "../server/env";
import { parsePma, PMA_URL } from "../server/rates";
try {
  const response = await fetch(PMA_URL, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error();
  const snapshot = parsePma(await response.text());
  console.log(
    JSON.stringify({
      check: "live-pma-read-only",
      pass: true,
      status: response.status,
      pairs: snapshot.quotes.map((q) => q.pair),
    }),
  );
} catch {
  console.log(JSON.stringify({ check: "live-pma-read-only", pass: false }));
  process.exitCode = 1;
}
