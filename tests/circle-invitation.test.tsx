// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Invitation } from "../src/Circles";
import { api } from "../src/api";
vi.mock("../src/api", () => ({ api: vi.fn() }));
const preview = {
  name: "Family trip",
  description: "Trip fund",
  currency: "USD",
  target: "10000",
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  sessionStorage.clear();
  history.replaceState({}, "", "/");
});
it("shows membership instead of Join and opens the existing Circle", async () => {
  history.replaceState({}, "", `/circles/invite/${"a".repeat(43)}`);
  vi.mocked(api).mockResolvedValue({
    ...preview,
    alreadyMember: true,
    circleId: "circle-1",
  });
  const onJoined = vi.fn();
  render(<Invitation authenticated onJoined={onJoined} />);
  expect(
    await screen.findByText("You're already in this circle."),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Join Circle" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open Circle" }));
  expect(sessionStorage.getItem("walletwise:open-circle")).toBe("circle-1");
  expect(onJoined).toHaveBeenCalledOnce();
  expect(
    vi.mocked(api).mock.calls.some(([path]) => path === "/circles/join"),
  ).toBe(false);
});
it("handles membership gained in another tab between preview and Join", async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path === "/circles/join"
      ? { id: "circle-1", alreadyMember: true }
      : { ...preview, alreadyMember: false, circleId: null },
  );
  const onJoined = vi.fn();
  render(<Invitation authenticated onJoined={onJoined} />);
  fireEvent.click(await screen.findByRole("button", { name: "Join Circle" }));
  expect(
    await screen.findByText("You're already in this circle."),
  ).toBeTruthy();
  expect(onJoined).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Join Circle" })).toBeNull();
});
it("allows new members to explicitly join", async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path === "/circles/join"
      ? { id: "circle-1", alreadyMember: false }
      : { ...preview, alreadyMember: false, circleId: null },
  );
  const onJoined = vi.fn();
  render(<Invitation authenticated onJoined={onJoined} />);
  fireEvent.click(await screen.findByRole("button", { name: "Join Circle" }));
  await vi.waitFor(() => expect(onJoined).toHaveBeenCalledOnce());
});
