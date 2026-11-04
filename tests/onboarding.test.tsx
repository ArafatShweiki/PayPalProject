import { profileBootstrap } from "./fixtures/loading";
// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { OnboardingBoundary } from "../src/Onboarding";
import { api } from "../src/api";
import { ApiError } from "../src/errors";
import type { OnboardingStatus } from "../shared/types";
vi.mock("../src/api", () => ({ api: vi.fn() }));
const initial: OnboardingStatus = {
  complete: false,
  fullName: "Taylor Example",
  email: "taylor@example.com",
  emailVerified: true,
  preferred: "ILS",
  savings: "unseen",
  notifications: false,
};
const signOut = vi.fn();
function mount() {
  return render(
    <OnboardingBoundary onSignOut={signOut}>
      <p>Protected dashboard</p>
    </OnboardingBoundary>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  history.replaceState({}, "", "/#Settings");
});
afterEach(cleanup);
it("blocks private content while checking and redirects incomplete deep links", async () => {
  let resolve!: (value: OnboardingStatus) => void;
  vi.mocked(api).mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  mount();
  expect(screen.getByRole("status").textContent).toContain(
    "Getting your profile ready",
  );
  expect(screen.queryByText("Protected dashboard")).toBeNull();
  resolve(profileBootstrap(initial) as never);
  await screen.findByLabelText("Full name");
  expect(location.pathname).toBe("/onboarding");
  expect((screen.getByLabelText("Full name") as HTMLInputElement).value).toBe(
    initial.fullName,
  );
  expect(screen.getByText("Verified by your sign-in provider.")).toBeTruthy();
  location.hash = "My%20Wallet";
  fireEvent(window, new Event("hashchange"));
  await waitFor(() => expect(location.hash).toBe(""));
  expect(screen.queryByText("Protected dashboard")).toBeNull();
});
it("retains input after failed saves and unlocks only after persistence succeeds", async () => {
  vi.mocked(api)
    .mockResolvedValueOnce(profileBootstrap(initial))
    .mockRejectedValueOnce(new Error("Save failed"))
    .mockResolvedValueOnce({ ...initial, complete: true })
    .mockResolvedValueOnce(profileBootstrap({ ...initial, complete: true }));
  mount();
  fireEvent.change(await screen.findByLabelText("Full name"), {
    target: { value: "Taylor New" },
  });
  fireEvent.change(screen.getByLabelText("Email address"), {
    target: { value: "new@example.com" },
  });
  expect(screen.getByText(/Not verified/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Preferred currency"), {
    target: { value: "JOD" },
  });
  fireEvent.click(screen.getByLabelText("Activate Smart Savings"));
  fireEvent.click(screen.getByRole("button", { name: "Open my wallet" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Save failed",
  );
  expect(screen.queryByText("Protected dashboard")).toBeNull();
  expect((screen.getByLabelText("Full name") as HTMLInputElement).value).toBe(
    "Taylor New",
  );
  fireEvent.click(screen.getByRole("button", { name: "Open my wallet" }));
  expect(await screen.findByText("Protected dashboard")).toBeTruthy();
  expect(location.pathname + location.hash).toBe("/#Home");
  expect(api).toHaveBeenCalledWith(
    "/onboarding",
    {
      fullName: "Taylor New",
      email: "new@example.com",
      preferred: "JOD",
      savings: "enabled",
      notifications: false,
    },
    "PUT",
  );
});
it("recovers interrupted onboarding on reload and skips completed users", async () => {
  vi.mocked(api).mockResolvedValue(profileBootstrap(initial));
  const first = mount();
  await screen.findByLabelText("Full name");
  first.unmount();
  const second = mount();
  await screen.findByLabelText("Full name");
  expect(location.pathname).toBe("/onboarding");
  second.unmount();
  vi.mocked(api).mockResolvedValue(
    profileBootstrap({ ...initial, complete: true }),
  );
  mount();
  expect(await screen.findByText("Protected dashboard")).toBeTruthy();
  expect(location.pathname + location.hash).toBe("/#Home");
});
it("fails closed on profile errors with retry and sign-out", async () => {
  vi.mocked(api)
    .mockRejectedValueOnce(new Error("Unavailable"))
    .mockResolvedValueOnce(profileBootstrap(initial));
  mount();
  await screen.findByRole("alert");
  expect(screen.queryByText("Protected dashboard")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(signOut).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByLabelText("Full name");
});
it("rechecks onboarding if the API denies an already mounted wallet", async () => {
  vi.mocked(api)
    .mockResolvedValueOnce(profileBootstrap({ ...initial, complete: true }))
    .mockResolvedValueOnce(profileBootstrap(initial));
  mount();
  await screen.findByText("Protected dashboard");
  fireEvent(window, new Event("walletwise:onboarding-required"));
  await waitFor(() =>
    expect(screen.queryByText("Protected dashboard")).toBeNull(),
  );
  await screen.findByLabelText("Full name");
});

it("shows the API failure reason without suggesting another login for setup failures", async () => {
  const message = "Account setup is incomplete. Please contact the app administrator.";
  vi.mocked(api).mockRejectedValueOnce(new ApiError(message, 503));
  mount();
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", message);
  expect(screen.queryByText("Protected dashboard")).toBeNull();
});
