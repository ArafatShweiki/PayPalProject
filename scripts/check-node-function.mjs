import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync } from "node:fs";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const entryOption = process.argv.indexOf("--entry");
let entry;
if (entryOption >= 0) {
  if (!process.argv[entryOption + 1])
    throw new Error("Pass a compiled JavaScript entry after --entry.");
  entry = resolve(process.argv[entryOption + 1]);
} else {
  mkdirSync(".temp", { recursive: true });
  const output = mkdtempSync(resolve(".temp/node-function-"));
  execFileSync(
    process.execPath,
    [
      require.resolve("typescript/bin/tsc"),
      "--project",
      "tsconfig.server.json",
      "--noEmit",
      "false",
      "--outDir",
      output,
    ],
    { stdio: "inherit", windowsHide: true },
  );
  entry = resolve(output, "api/index.js");
}
const worker = String.raw`
  import assert from 'node:assert/strict';
  import {createServer} from 'node:http';
  import {pathToFileURL} from 'node:url';
  const {default:app}=await import(pathToFileURL(process.env.NODE_FUNCTION_ENTRY).href);
  assert.equal(typeof app,'function');
  const server=createServer(app);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try {
    const base='http://127.0.0.1:'+server.address().port;
    const config=await fetch(base+'/api/config');
    assert.equal(config.status,200);
    assert.match(config.headers.get('content-type'),/application\/json/);
    assert.match(config.headers.get('cache-control'),/no-store/);
    const body=await config.json();
    assert.equal(body.auth0.clientId,'node-function-smoke');
    assert.equal(body.supabase,null);
    for (const path of ['/api/state','/api/circles','/api/funding','/api/cron']) {
      const response=await fetch(base+path);
      assert.equal(response.status,401);
      assert.match(response.headers.get('content-type'),/application\/json/);
    }
    const rejected=await fetch(base+'/api/purchases',{method:'POST',headers:{Origin:'https://attacker.invalid','X-WalletWise':'1','Content-Type':'application/json'},body:'{}'});
    assert.equal(rejected.status,403);
    console.log('Plain Node ESM function smoke passed: config, private API authorization, cron and request-origin protection.');
  } finally { await new Promise(r=>server.close(r)); }
`;
// No TypeScript runner, loader hooks, local credentials or external providers.
// A fresh Node process must resolve the exact emitted .js graph itself.
execFileSync(process.execPath, ["--input-type=module", "--eval", worker], {
  stdio: "inherit",
  windowsHide: true,
  timeout: 30000,
  env: {
    ...process.env,
    NODE_OPTIONS: "",
    NODE_ENV: "test",
    VERCEL: "",
    VERCEL_URL: "",
    WALLETWISE_LOAD_ENV: "false",
    AUTH0_ENABLED: "true",
    AUTH0_DOMAIN: "example.auth0.com",
    AUTH0_CLIENT_ID: "node-function-smoke",
    SUPABASE_ENABLED: "false",
    STORAGE: "sqlite",
    DATABASE_PATH: resolve(dirname(entry), "../.smoke/cache.db"),
    APP_ORIGIN: "https://wallet.example.test",
    RATE_LIMIT_ENTRY: "10000",
    PAYPAL_CLIENT_ID: "",
    PAYPAL_CLIENT_SECRET: "",
    GEMINI_API_KEY: "",
    NODE_FUNCTION_ENTRY: entry,
  },
});
