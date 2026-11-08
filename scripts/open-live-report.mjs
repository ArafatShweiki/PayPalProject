import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const mode =
  process.argv[2] ||
  JSON.parse(readFileSync("playwright-report-live/latest.json", "utf8")).mode;
if (!["production-smoke", "preview-e2e"].includes(mode))
  throw new Error("Choose production-smoke or preview-e2e.");
execFileSync(
  process.execPath,
  [
    require.resolve("@playwright/test/cli"),
    "show-report",
    `playwright-report-live/${mode}`,
  ],
  { stdio: "inherit", windowsHide: true },
);
