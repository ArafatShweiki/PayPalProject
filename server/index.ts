import { forexEnabled, forexPollMs } from "./forex.js";
import { diagnoseFundingConfiguration } from "./funding.js";
import { setting } from "./reliability.js";
import { app } from "./app.js";
import { refreshRates } from "./rates.js";
import express from "express";
import { resolve } from "node:path";
diagnoseFundingConfiguration();
if (process.env.NODE_ENV === "production") {
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
}
const server = app.listen(Number(process.env.PORT) || 3001, "127.0.0.1", () =>
  console.log("Dream Piggy Bank API: http://127.0.0.1:3001"),
);
if (process.env.DISABLE_RATE_JOB !== "true") {
  void refreshRates().catch(() =>
    console.warn("Rates unavailable; retained observations only."),
  );
  setInterval(
    () =>
      void refreshRates().catch(() =>
        console.warn("Rate refresh unavailable."),
      ),
    forexEnabled()
      ? forexPollMs()
      : setting("RATE_CACHE_TTL_MS", 6 * 60 * 60 * 1000),
  ).unref();
}
process.on("SIGTERM", () => server.close());
