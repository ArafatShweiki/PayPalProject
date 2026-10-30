// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HelpCenter } from "../src/PublicPages";
import { StoragePreferences } from "../src/InfoNavigation";
import { ErrorState } from "../src/ErrorState";
import { PageSkeleton } from "../src/Skeleton";
import { ApiError } from "../src/errors";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it("searches help and filters categories with an honest empty state", () => {
  render(<HelpCenter />);
  fireEvent.change(screen.getByLabelText("Search help"), {
    target: { value: "round-ups" },
  });
  expect(
    screen.getByRole("heading", {
      name: "Activate round-ups and edit savings settings",
    }),
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Category"), {
    target: { value: "Troubleshooting" },
  });
  fireEvent.change(screen.getByLabelText("Search help"), {
    target: { value: "zzzzz" },
  });
  expect(screen.getByText(/No matching articles/)).toBeTruthy();
  expect(screen.queryByText("Frequently asked questions")).toBeNull();
  expect(
    screen.queryByText("Does this application hold real money?"),
  ).toBeNull();
});
it("documents necessary storage without offering invented consent categories", () => {
  render(<StoragePreferences />);
  fireEvent.click(screen.getByText("Review necessary storage"));
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(
    screen
      .getByRole("link", { name: "Read the Cookie Policy" })
      .getAttribute("href"),
  ).toBe("/cookie-policy");
});
it.each([401, 403, 404, 429, 500, 503])(
  "renders a branded %s error and safe recovery",
  (status) => {
    render(<ErrorState status={status} />);
    expect(screen.getByRole("alert").textContent).toContain(
      `DREAM PIGGY BANK · ${status}`,
    );
    expect(screen.getByRole("heading")).toBeTruthy();
  },
);
it("waits for the enforced cooldown before enabling retry", () => {
  vi.useFakeTimers();
  render(
    <ErrorState error={new ApiError("limited", 429, 2)} onRetry={vi.fn()} />,
  );
  expect(
    (screen.getByRole("button", { name: "Try again" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
it.each([
  "Home",
  "My Wallet",
  "Smart Savings",
  "Currency Rates",
  "Reports",
  "Settings",
])("provides a shaped accessible loading state for %s", (area) => {
  render(<PageSkeleton area={area} />);
  expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
  expect(screen.getByLabelText(`Loading ${area}`)).toBeTruthy();
});
