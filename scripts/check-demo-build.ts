import { createServer, preview } from "vite";
import { chromium } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import assert from "node:assert/strict";
// Run after npm run build. Exercise real Vite transforms and production output.
const browser = await chromium.launch();
const config = {
  auth0: {
    domain: "example.auth0.com",
    clientId: "public-test",
    databaseConnection: "database",
  },
  supabase: null,
};
async function check(url: string, allowed: boolean) {
  const page = await browser.newPage();
  try {
    await page.route("**/api/config", (route) =>
      route.fulfill({ json: config }),
    );
    await page.addInitScript(() =>
      sessionStorage.setItem(
        "walletwise:developer-demo:v1",
        JSON.stringify({ data: { profile: {} }, snapshots: [] }),
      ),
    );
    await page.goto(url + "/#Settings");
    await page.getByRole("heading", { name: "Welcome back." }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Explore Dream Piggy Bank (Demo Mode)" })
        .count(),
      allowed ? 1 : 0,
    );
    assert.equal(await page.getByRole("navigation").count(), 0);
    assert.equal(
      await page.evaluate(() =>
        sessionStorage.getItem("walletwise:developer-demo:v1"),
      ),
      null,
    );
    console.log(
      `${url}: login protected, forged demo storage rejected, demo button ${allowed ? "visible" : "absent"}`,
    );
  } finally {
    await page.close();
  }
}
try {
  const dev = await createServer({
    server: { host: "127.0.0.1", port: 5185, strictPort: true },
    define: {
      "import.meta.env.VITE_ENABLE_DEMO_MODE": JSON.stringify("false"),
    },
  });
  try {
    await dev.listen();
    await check("http://127.0.0.1:5185", false);
  } finally {
    await dev.close();
  }
  const production = await preview({
    preview: { host: "127.0.0.1", port: 5186, strictPort: true },
  });
  try {
    await check("http://127.0.0.1:5186", false);
  } finally {
    await new Promise<void>((resolve, reject) =>
      production.httpServer.close((error) =>
        error ? reject(error) : resolve(),
      ),
    );
  }
  const names = await readdir("dist/assets");
  assert(
    !names.some((name) => name.startsWith("service-")),
    "Demo service chunk must not ship",
  );
  const output = (
    await Promise.all(
      names
        .filter((n) => n.endsWith(".js"))
        .map((n) => readFile(`dist/assets/${n}`, "utf8")),
    )
  ).join("\n");
  assert(
    !output.includes("Sample corner coffee") &&
      !output.includes("Weekend getaway"),
    "Demo seed must not ship",
  );
  // Public help describes the development-only button; it is not executable demo UI.
  const applicationOutput = (
    await Promise.all(
      names
        .filter(
          (name) => name.endsWith(".js") && !name.startsWith("PublicPages-"),
        )
        .map((name) => readFile(`dist/assets/${name}`, "utf8")),
    )
  ).join("\n");
  assert(
    !applicationOutput.includes("Explore Dream Piggy Bank (Demo Mode)"),
    "Demo entry button must be eliminated",
  );
  console.log(
    "Production assets exclude demo service, sample seed and demo entry button.",
  );
} finally {
  await browser.close();
}
