import { refreshRates } from "../server/rates";
const observations = await refreshRates();
const latest = observations.at(-1);
console.log(
  JSON.stringify(
    {
      source: latest?.source,
      retrievedAt: latest?.fetchedAt,
      publishedAt: latest?.publishedAt,
      quotes: latest?.quotes,
      storedObservations: observations.length,
    },
    null,
    2,
  ),
);
