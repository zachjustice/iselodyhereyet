import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App";

// Mock fetch for status.json
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ stage: 2, updatedAt: 1744410480000 }),
    }),
  );
});

describe("App", () => {
  it("renders loading spinner initially", () => {
    render(<App />);
    expect(screen.getByText("Checking delivery status...")).toBeInTheDocument();
  });

  it("renders tracker after status loads", async () => {
    render(<App />);
    expect(
      await screen.findByText("Elody's Tracker"),
    ).toBeInTheDocument();
  });
});
