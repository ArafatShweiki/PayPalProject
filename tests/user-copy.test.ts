import { expect, it } from "vitest";
import { userFacingMessage } from "../src/errors";
import { articles } from "../src/helpContent";
import { infoPages } from "../src/infoContent";

it.each([
  "Supabase connection error",
  "The wallet database could not complete this request. Check database configuration.",
  "Auth0 ID token requires an authenticated role",
  "PayPal Sandbox authentication unavailable.",
  "Sandbox order not found for this account.",
  "Configure the server-side TWELVE_DATA_API_KEY.",
  "Twelve Data credentials or pair entitlements need configuration.",
])("gives useful product feedback for internal error: %s", (message) => {
  const copy = userFacingMessage(message);
  expect(copy).not.toMatch(
    /Auth0|Supabase|Sandbox|database|TWELVE_DATA_API_KEY|entitlement|authenticated role/i,
  );
  expect(copy.length).toBeGreaterThan(20);
});
it("preserves actionable validation and transaction messages", () => {
  for (const message of [
    "Insufficient USD funds.",
    "Preview expired. Please request a new preview.",
    "This purchase has already been refunded.",
  ])
    expect(userFacingMessage(message)).toBe(message);
});
it("keeps infrastructure names out of help and general information while preserving privacy disclosures", () => {
  expect(JSON.stringify(articles)).not.toMatch(
    /Auth0|Supabase|Sandbox|Firebase|SDK|backend/i,
  );
  for (const [path, page] of Object.entries(infoPages)) {
    if (["/privacy-policy", "/cookie-policy"].includes(path)) continue;
    expect(JSON.stringify(page)).not.toMatch(
      /Auth0|Supabase|Sandbox|Firebase|Firestore|SDK|backend/i,
    );
  }
  expect(JSON.stringify(infoPages["/privacy-policy"])).toMatch(/Auth0/);
  expect(JSON.stringify(infoPages["/privacy-policy"])).toMatch(/Supabase/);
  expect(JSON.stringify(infoPages["/cookie-policy"])).toMatch(/Auth0/);
});
