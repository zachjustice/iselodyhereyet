import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFunFacts } from "./useFunFacts";

const FACTS = ["Fact one", "Fact two", "Fact three"];

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  // Stub rAF so progress ticks don't interfere with timer tests
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((cb: FrameRequestCallback) => {
      cb(performance.now());
      return 1;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useFunFacts", () => {
  it("returns the first fact on mount", () => {
    const { result } = renderHook(() => useFunFacts(FACTS));
    expect(result.current.currentFact).toBe("Fact one");
  });

  it("rotates through facts on interval", () => {
    const { result } = renderHook(() => useFunFacts(FACTS, 1000));

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.currentFact).toBe("Fact two");

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.currentFact).toBe("Fact three");
  });

  it("wraps around at the end of the facts array", () => {
    const { result } = renderHook(() => useFunFacts(FACTS, 1000));

    // Advance through all 3 facts
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    // Should wrap back to first fact
    expect(result.current.currentFact).toBe("Fact one");
  });

  it("persists index to sessionStorage", () => {
    renderHook(() => useFunFacts(FACTS, 1000));

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(sessionStorage.getItem("funFactIndex")).toBe("1");

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(sessionStorage.getItem("funFactIndex")).toBe("2");
  });

  it("restores index from sessionStorage", () => {
    sessionStorage.setItem("funFactIndex", "2");

    const { result } = renderHook(() => useFunFacts(FACTS, 1000));
    expect(result.current.currentFact).toBe("Fact three");
  });

  it("handles sessionStorage index exceeding array length", () => {
    sessionStorage.setItem("funFactIndex", "10");

    const { result } = renderHook(() => useFunFacts(FACTS, 1000));
    // 10 % 3 = 1 → "Fact two"
    expect(result.current.currentFact).toBe("Fact two");
  });

  it("returns empty string when facts array is empty", () => {
    const { result } = renderHook(() => useFunFacts([]));
    expect(result.current.currentFact).toBe("");
  });

  it("returns progress between 0 and 1", () => {
    const { result } = renderHook(() => useFunFacts(FACTS, 1000));
    expect(result.current.progress).toBeGreaterThanOrEqual(0);
    expect(result.current.progress).toBeLessThanOrEqual(1);
  });
});
