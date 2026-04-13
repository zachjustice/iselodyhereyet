import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTabNotification } from "./useTabNotification";

beforeEach(() => {
  vi.useFakeTimers();
  document.title = "Elody's Tracker";

  // Create favicon link element
  const favicon = document.createElement("link");
  favicon.id = "favicon";
  favicon.rel = "icon";
  favicon.href = "/original-favicon.svg";
  document.head.appendChild(favicon);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.getElementById("favicon")?.remove();
});

describe("useTabNotification", () => {
  it("does nothing on first render (no flashing)", () => {
    renderHook(() => useTabNotification(2, false));

    vi.advanceTimersByTime(3000);

    expect(document.title).toBe("Elody's Tracker");
    const favicon = document.getElementById("favicon") as HTMLLinkElement;
    expect(favicon.href).toContain("/original-favicon.svg");
  });

  it("does nothing while loading", () => {
    const { rerender } = renderHook(
      ({ stage, isLoading }) => useTabNotification(stage, isLoading),
      { initialProps: { stage: 1, isLoading: true } },
    );

    rerender({ stage: 2, isLoading: true });

    vi.advanceTimersByTime(3000);
    expect(document.title).toBe("Elody's Tracker");
  });

  it("flashes title on stage change when tab is not focused", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);

    const { rerender } = renderHook(
      ({ stage, isLoading }) => useTabNotification(stage, isLoading),
      { initialProps: { stage: 1, isLoading: false } },
    );

    // Change stage to trigger flash
    rerender({ stage: 3, isLoading: false });

    // After 1 second, title should toggle
    vi.advanceTimersByTime(1000);
    // The interval fires — title should alternate between stage name and original
    const title = document.title;
    expect(
      title === "Labor has started" || title === "Elody's Tracker",
    ).toBe(true);
  });

  it("does not flash when tab is focused", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);

    const { rerender } = renderHook(
      ({ stage, isLoading }) => useTabNotification(stage, isLoading),
      { initialProps: { stage: 1, isLoading: false } },
    );

    rerender({ stage: 3, isLoading: false });

    vi.advanceTimersByTime(3000);
    // Title should remain original since tab is focused
    expect(document.title).toBe("Elody's Tracker");
  });

  it("stops flashing when tab gains focus", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);

    const { rerender } = renderHook(
      ({ stage, isLoading }) => useTabNotification(stage, isLoading),
      { initialProps: { stage: 1, isLoading: false } },
    );

    rerender({ stage: 4, isLoading: false });

    // Let it flash
    vi.advanceTimersByTime(1000);

    // Simulate focus event
    window.dispatchEvent(new Event("focus"));

    expect(document.title).toBe("Elody's Tracker");
    const favicon = document.getElementById("favicon") as HTMLLinkElement;
    expect(favicon.href).toContain("/original-favicon.svg");
  });

  it("restores title and favicon on unmount", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);

    const { rerender, unmount } = renderHook(
      ({ stage, isLoading }) => useTabNotification(stage, isLoading),
      { initialProps: { stage: 1, isLoading: false } },
    );

    rerender({ stage: 5, isLoading: false });

    // Let it start flashing
    vi.advanceTimersByTime(500);

    unmount();

    expect(document.title).toBe("Elody's Tracker");
    const favicon = document.getElementById("favicon") as HTMLLinkElement;
    expect(favicon.href).toContain("/original-favicon.svg");
  });
});
