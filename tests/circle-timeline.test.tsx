// @vitest-environment jsdom
import React from "react";
import { expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CircleTimeline } from "../src/CircleTimeline";
import type { CircleDetail } from "../shared/circles";
vi.mock("../src/api", () => ({
  api: vi.fn(async () => ({
    events: [
      {
        id: "create",
        at: "2026-11-06T10:00:00Z",
        memberId: "m",
        event: "create",
        details: { amount: "100" },
      },
      {
        id: "entry",
        at: "2026-11-06T11:00:00Z",
        memberId: "m",
        event: "contribution",
        details: { amount: "200" },
      },
    ],
    more: false,
  })),
}));
afterEach(cleanup);
it("formats only recorded subledger amounts, never a user-derived creation amount", async () => {
  const circle = {
    id: "c",
    name: "Trip",
    currency: "USD",
    members: [{ id: "m", name: "Member" }],
  } as CircleDetail;
  render(<CircleTimeline circle={circle} busy={false} onReturn={vi.fn()} />);
  expect(await screen.findByText("$2.00")).toBeTruthy();
  expect(screen.queryByText("$1.00")).toBeNull();
});
