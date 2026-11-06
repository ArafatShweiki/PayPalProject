import "../server/env";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const secretNames = [
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "PAYPAL_CLIENT_SECRET",
  "GEMINI_API_KEY",
  "FIREBASE_SERVICE_ACCOUNT",
  "CRON_SECRET",
  "TWELVE_DATA_API_KEY",
];
const secrets = secretNames.flatMap((name) =>
  process.env[name] && process.env[name]!.length >= 8
    ? [process.env[name]!]
    : [],
);
const signatures = [
  /sb_secret_[A-Za-z0-9_-]{20,}/,
  /-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\\nrt]*[A-Za-z0-9+/=]{64,}/,
  /AIza[A-Za-z0-9_-]{30,}/,
];
const suspected = (value: string) =>
  secrets.some((secret) => value.includes(secret)) ||
  signatures.some((pattern) => pattern.test(value));
const findings: string[] = [];
const revisions = execFileSync("git", ["rev-list", "--all"], {
  encoding: "utf8",
})
  .trim()
  .split(/\s+/)
  .filter(Boolean);
let historicalFiles = 0;
for (const rev of revisions) {
  for (const path of execFileSync(
    "git",
    ["ls-tree", "-r", "--name-only", rev],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean)) {
    historicalFiles++;
    const contents = execFileSync("git", ["show", `${rev}:${path}`], {
      encoding: "utf8",
      maxBuffer: 20_000_000,
    });
    if (suspected(contents))
      findings.push(`history:${rev.slice(0, 8)}:${path}`);
  }
}
const publicFiles: string[] = [];
function collect(dir: string) {
  if (!existsSync(dir)) return;
  for (const file of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, file.name);
    if (file.isDirectory()) collect(path);
    else publicFiles.push(path);
  }
}
collect("dist");
collect("src");
publicFiles.push(".env.example");
// Include current tracked backend/config files, not only historical revisions.
publicFiles.push(
  ...execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter((path) => path && existsSync(path)),
);
for (const path of publicFiles)
  if (suspected(readFileSync(path, "utf8"))) findings.push(path);
const ignored = execFileSync(
  "git",
  ["check-ignore", ".env", ".env.local", ".env.auth0"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n");
console.log(
  JSON.stringify({
    revisions: revisions.length,
    historicalFiles,
    publicFilesScanned: publicFiles.length,
    ignoredEnvironmentFiles: ignored,
    suspectedExposureFiles: findings,
  }),
);
if (findings.length) process.exitCode = 1;
