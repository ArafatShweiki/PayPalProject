import { loadingResponse } from "../fixtures/loading";
import type { State } from "../../shared/types";
import { type Page } from "@playwright/test";
import { fundedUser } from "../fixtures/user";
import { balances } from "../../shared/ledger";
export function walletFixture(): State {
  const data = fundedUser();
  return {
    ...data,
    balances: balances(data),
    savingsBalances: balances(data, "savings"),
    snapshots: [],
    authMode: "auth0",
    capabilities: { firebase: false, paypal: false, gemini: false },
  };
}
// Only Playwright serves this page. The application has no fixture entry point.
async function installHarness(page: Page, financial = false) {
  await page.route("**/wallet-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
 import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
 const {React,createRoot}=await import('/tests/fixtures/browser.tsx');
 const {setAuth0TokenProvider}=await import('/src/api.ts');setAuth0TokenProvider(async()=>"test-fixture-token");
 ${financial ? `const {createWalletFixture}=await import('/tests/fixtures/wallet-service.ts');const {loadingResponse}=await import('/tests/fixtures/loading.ts');const fixture=createWalletFixture();const original=window.fetch.bind(window);window.fetch=async(url,options={})=>{if(typeof url==='string'&&url.startsWith('/api/')){try{return new Response(JSON.stringify(((url.startsWith('/api/bootstrap')||url.startsWith('/api/dashboard')||url.startsWith('/api/activity'))?loadingResponse(url.slice(4),fixture('/state')):fixture(url.slice(4),options.body?JSON.parse(options.body):undefined,options.method||'GET'))),{headers:{'content-type':'application/json'}});}catch(e){return new Response(JSON.stringify({error:e.message}),{status:400,headers:{'content-type':'application/json'}});}}return original(url,options);};` : ""}
 const {App}=await import('/src/App.tsx');await import('/src/styles.css');createRoot(document.getElementById('root')).render(React.createElement(App));
 </script></body></html>`,
    }),
  );
}
export async function enterTestWallet(page: Page) {
  await installHarness(page, true);
  await page.goto("/wallet-test#Home");
  await page.getByRole("navigation").waitFor({ state: "attached" });
}
export async function mountWalletFixture(
  page: Page,
  hash: string,
  initial = walletFixture(),
) {
  for (const path of ["bootstrap", "dashboard?**", "activity?**", "state"])
    await page.route(`**/api/${path}`, (route) =>
      route.fulfill({
        json: loadingResponse(
          new URL(route.request().url()).pathname.slice(4) +
            new URL(route.request().url()).search,
          initial as State,
        ),
      }),
    );
  await page.route("**/api/config", (route) =>
    route.fulfill({ json: { auth0: null } }),
  );
  await installHarness(page);
  await page.goto(`/wallet-test#${hash}`);
}
