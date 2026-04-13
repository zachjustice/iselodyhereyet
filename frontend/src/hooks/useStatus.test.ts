import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useStatus } from "./useStatus";

function mockFetch(stage: number, updatedAt: number) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ stage, updatedAt }),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  // Provide a minimal serviceWorker stub so the hook's addEventListener branch runs
  vi.stubGlobal("navigator", {
    ...navigator,
    serviceWorker: {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useStatus", () => {
  it("returns loading state initially", () => {
    vi.stubGlobal("fetch", mockFetch(2, 1000));
    const { result } = renderHook(() => useStatus());
    expect(result.current.isLoading).toBe(true);
    expect(result.current.stage).toBe(1); // default before fetch
  });

  it("fetches on mount and returns parsed stage data", async () => {
    vi.stubGlobal("fetch", mockFetch(3, 5000));
    const { result } = renderHook(() => useStatus());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.stage).toBe(3);
    expect(result.current.updatedAt).toBe(5000);
    expect(result.current.message).toBe(
      "Katie began preparing your order 9 months ago",
    );
  });

  it("returns stage 5 message", async () => {
    vi.stubGlobal("fetch", mockFetch(5, 9000));
    const { result } = renderHook(() => useStatus());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.message).toBe("Zach has the best wife ever");
  });

  it("re-fetches on interval", async () => {
    const fetchMock = mockFetch(1, 1000);
    vi.stubGlobal("fetch", fetchMock);
    renderHook(() => useStatus(5000));

    // Wait for initial fetch
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Advance past the poll interval
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("handles fetch errors gracefully", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network error")),
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useStatus());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Falls back to defaults
    expect(result.current.stage).toBe(1);
    expect(result.current.updatedAt).toBe(0);
    spy.mockRestore();
  });

  it("handles non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useStatus());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.stage).toBe(1);
    spy.mockRestore();
  });

  it("staleness guard: ignores older updatedAt", async () => {
    // First fetch returns newer data
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ stage: 3, updatedAt: 5000 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ stage: 2, updatedAt: 3000 }), // older
      });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useStatus(5000));

    await waitFor(() => expect(result.current.stage).toBe(3));

    // Trigger re-fetch with stale data
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    // Should still show stage 3 (ignored stale data)
    expect(result.current.stage).toBe(3);
    expect(result.current.updatedAt).toBe(5000);
  });

  it("accepts newer updatedAt on re-fetch", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ stage: 2, updatedAt: 1000 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ stage: 4, updatedAt: 9000 }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useStatus(5000));

    await waitFor(() => expect(result.current.stage).toBe(2));

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    await waitFor(() => expect(result.current.stage).toBe(4));
    expect(result.current.updatedAt).toBe(9000);
  });

  it("handles push-update message with full data", async () => {
    vi.stubGlobal("fetch", mockFetch(1, 1000));

    let messageHandler: (event: MessageEvent) => void = () => {};
    vi.stubGlobal("navigator", {
      ...navigator,
      serviceWorker: {
        addEventListener: vi.fn((_event: string, handler: (event: MessageEvent) => void) => {
          messageHandler = handler;
        }),
        removeEventListener: vi.fn(),
      },
    });

    const { result } = renderHook(() => useStatus());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.stage).toBe(1);

    // Simulate push-update message from service worker
    act(() => {
      messageHandler(
        new MessageEvent("message", {
          data: {
            type: "push-update",
            data: { stage: 5, updatedAt: 99000 },
          },
        }),
      );
    });

    expect(result.current.stage).toBe(5);
    expect(result.current.updatedAt).toBe(99000);
  });

  it("handles push-update message without data by fetching", async () => {
    const fetchMock = mockFetch(1, 1000);
    vi.stubGlobal("fetch", fetchMock);

    let messageHandler: (event: MessageEvent) => void = () => {};
    vi.stubGlobal("navigator", {
      ...navigator,
      serviceWorker: {
        addEventListener: vi.fn((_event: string, handler: (event: MessageEvent) => void) => {
          messageHandler = handler;
        }),
        removeEventListener: vi.fn(),
      },
    });

    const { result } = renderHook(() => useStatus());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const callsBefore = fetchMock.mock.calls.length;

    // Simulate push-update without full data
    act(() => {
      messageHandler(
        new MessageEvent("message", {
          data: { type: "push-update" },
        }),
      );
    });

    // Should have triggered another fetch
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("cleans up interval and listener on unmount", async () => {
    vi.stubGlobal("fetch", mockFetch(1, 1000));

    const removeEventListener = vi.fn();
    vi.stubGlobal("navigator", {
      ...navigator,
      serviceWorker: {
        addEventListener: vi.fn(),
        removeEventListener,
      },
    });

    const { unmount } = renderHook(() => useStatus());

    await waitFor(() => {}); // let effects settle

    unmount();

    expect(removeEventListener).toHaveBeenCalledWith(
      "message",
      expect.any(Function),
    );
  });
});
