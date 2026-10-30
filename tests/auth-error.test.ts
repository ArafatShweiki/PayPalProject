import { describe, expect, it } from "vitest";
import { authenticationError } from "../src/Auth";

describe("Auth0 login errors", () => {
  it("identifies an actual user cancellation", () => {
    expect(
      authenticationError({
        error: "access_denied",
        error_description: "User has canceled the interaction",
      }),
    ).toContain("You cancelled PayPal sign-in");
  });

  it("does not mislabel an Auth0 access denial as a cancellation", () => {
    expect(
      authenticationError({
        error: "access_denied",
        error_description: "Action denied: PayPal sandbox user blocked",
      }),
    ).toContain("We couldn't sign you in with this account");
  });

  it("gives the specific application-connection fix", () => {
    expect(
      authenticationError({
        error: "invalid_request",
        error_description:
          "connection paypal-sandbox not enabled for the client",
      }),
    ).toContain("This sign-in option is unavailable");
  });
});

it.each([
  "Service not found: https://walletwise.api",
  'Client "public" is not authorized to access resource server "https://walletwise.api".',
])("explains obsolete audience configuration: %s", (description) => {
  const message = authenticationError({
    error: "invalid_request",
    error_description: description,
  });
  expect(message).toContain("We couldn't sign you in");
  expect(message).not.toMatch(/Auth0|audience|resource server/i);
  expect(message).not.toContain("Add the API");
});
