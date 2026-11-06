# Vercel backend ESM resolution fix

The deployed error was reproduced locally using **`@vercel/node` 30.0.0**, the official Vercel Node function builder, targeting **nodejs24.x**. No Vercel account connection or deployment was used.

## Root cause and observed output

The project has `"type": "module"`. Its frontend TypeScript configuration uses `moduleResolution: Bundler` and `noEmit`, which permits extensionless imports. Vite bundles the browser application only. The Vercel Node builder separately transpiles/traces the backend and retains its ESM import specifiers.

Before the fix, the actual builder emitted:

```js
// api/index.js
export { app as default } from "../server/app";
```

The traced output **included `server/app.js`** (732 function files total), so the problem was not an omitted backend file. Plain Node failed with `ERR_MODULE_NOT_FOUND` for `server/app`, matching the deployed error. Adding only the entry extension would leave the same problem in the transitive backend imports.

After the fix, the same builder emitted:

```js
export { app as default } from "../server/app.js";
```

The server/shared static imports, re-exports, side-effect imports and dynamic imports now also specify `.js`. TypeScript resolves those specifiers to the corresponding `.ts` sources; emitted Node modules retain the correct `.js` paths. See [Node's ESM extension rule](https://nodejs.org/api/esm.html#mandatory-file-extensions) and [TypeScript's Node module guidance](https://www.typescriptlang.org/docs/handbook/modules/reference.html).

## Changes

- `api/index.ts`, relative import specifiers in `server/*.ts` and `shared/*.ts`: 148 import paths across 31 source files were mechanically updated. API behavior, authentication, financial calculations, SQL permissions and Supabase calls were not changed.
- `tsconfig.server.json`: NodeNext module/resolution check for API/server/shared code. Frontend Bundler resolution remains unchanged.
- `package.json`: typecheck runs both configurations; production build runs that typecheck before Vite. Added `check:node-function`.
- `scripts/check-node-function.mjs`: compiles the actual backend and starts a fresh plain Node process to load its emitted API export. Checks config JSON/no-store, denied private routes/cron and origin protection. It uses isolated local test storage and no external credentials/providers.
- `eslint.config.js`: includes the new `.mjs` check and excludes generated `.temp`/`.vercel` artifacts.
- `VERCEL_DEPLOYMENT.md`, `VERCEL_ESM_FIX.md`: runtime explanation and verification evidence.

`vercel.json`, dependency versions, environment files and database migrations were not changed. No new runtime dependency or custom bundling mode is needed.

## Verification

Passed:

- Production build and both TypeScript configurations.
- ESLint.
- 356 unit/integration tests across 51 files.
- 14 native PostgreSQL scenarios with 16 independent connections.
- 36 Playwright browser tests.
- Production-artifact smoke test.
- `npm run check:node-function`, using plain Node with no TypeScript loader.
- The **actual official-builder output**, copied outside the repository into an OS temporary directory with only its traced files/dependencies. Its API export loaded under plain Node, `/api/config` returned HTTP 200 JSON/no-store, and private API/cron/origin checks passed.

The before/after outputs remain in ignored `.temp/vercel-function-before` and `.temp/vercel-function-after`. The temporary builder installation is in `.temp/vercel-builder`; it did not change project dependencies. To recheck a materialized function, run:

```sh
node scripts/check-node-function.mjs --entry PATH_TO_FUNCTION/api/index.js
```

This validates compiled module resolution and the Express handler locally, not a successful Vercel deployment or live external integrations. No full linked `vercel build` was run because the repository has no configured Vercel CLI/project link. Deploy the reviewed changes yourself, then check the hosted `/api/config` and authenticated workflows. Existing Supabase/provider environment requirements still apply.
