import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useNotifications } from "./useNotifications";

function makeMockServiceWorker(pushManagerOverrides: Record<string, unknown> = {}) {
  return {
    ready: Promise.resolve({
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(null),
        subscribe: vi.fn().mockResolvedValue({ endpoint: "https://push.example.com/sub1" }),
        ...pushManagerOverrides,
      },
    }),
  } as unknown as ServiceWorkerContainer;
}

function mockNavigator(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal("navigator", {
    userAgent: "Mozilla/5.0 (Macintosh)",
    serviceWorker: makeMockServiceWorker(),
    ...overrides,
  });
}

function mockWindow(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("Notification", {
    requestPermission: vi.fn().mockResolvedValue("granted"),
    ...overrides.Notification as object,
  });
  // matchMedia for standalone check
  const originalMatchMedia = window.matchMedia;
  vi.stubGlobal("matchMedia", (query: string) => {
    if (query === "(display-mode: standalone)") {
      return { matches: false };
    }
    return originalMatchMedia?.(query) ?? { matches: false };
  });
}

beforeEach(() => {
  mockWindow();
  mockNavigator();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useNotifications", () => {
  it("isSupported is true when serviceWorker and PushManager are available", () => {
    const { result } = renderHook(() => useNotifications());
    expect(result.current.isSupported).toBe(true);
    expect(result.current.isIosNonStandalone).toBe(false);
  });

  it("isSupported is false when PushManager is missing", () => {
    vi.stubGlobal("PushManager", undefined);
    const { result } = renderHook(() => useNotifications());
    expect(result.current.isSupported).toBe(false);
  });

  it("detects iOS non-standalone mode", () => {
    mockNavigator({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS)" });
    const { result } = renderHook(() => useNotifications());
    expect(result.current.isIosNonStandalone).toBe(true);
    expect(result.current.isSupported).toBe(false);
  });

  it("detects existing subscription on mount", async () => {
    const existingSub = { endpoint: "https://push.example.com/existing" };
    mockNavigator({
      userAgent: "Mozilla/5.0 (Macintosh)",
      serviceWorker: makeMockServiceWorker({
        getSubscription: vi.fn().mockResolvedValue(existingSub),
      }),
    });

    const { result } = renderHook(() => useNotifications());

    await waitFor(() => expect(result.current.isSubscribed).toBe(true));
  });

  it("subscribe flow: requests permission, subscribes, posts to server", async () => {
    const mockSub = { endpoint: "https://push.example.com/new" };
    const subscribeFn = vi.fn().mockResolvedValue(mockSub);
    mockNavigator({
      userAgent: "Mozilla/5.0 (Macintosh)",
      serviceWorker: makeMockServiceWorker({
        subscribe: subscribeFn,
      }),
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useNotifications());

    await act(async () => {
      await result.current.subscribe();
    });

    expect(Notification.requestPermission).toHaveBeenCalled();
    expect(subscribeFn).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: expect.any(Uint8Array),
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/subscribe"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.current.isSubscribed).toBe(true);
    expect(result.current.error).toBe("");
  });

  it("sets error when permission is denied", async () => {
    vi.stubGlobal("Notification", {
      requestPermission: vi.fn().mockResolvedValue("denied"),
    });

    const { result } = renderHook(() => useNotifications());

    await act(async () => {
      await result.current.subscribe();
    });

    expect(result.current.error).toBe("Notification permission was denied.");
    expect(result.current.isSubscribed).toBe(false);
  });

  it("sets error when server returns error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { result } = renderHook(() => useNotifications());

    await act(async () => {
      await result.current.subscribe();
    });

    expect(result.current.error).toBe("Failed to subscribe. Try again.");
    expect(result.current.isSubscribed).toBe(false);
    spy.mockRestore();
  });

  it("sets error when subscribe throws", async () => {
    mockNavigator({
      userAgent: "Mozilla/5.0 (Macintosh)",
      serviceWorker: makeMockServiceWorker({
        subscribe: vi.fn().mockRejectedValue(new Error("Push failed")),
      }),
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { result } = renderHook(() => useNotifications());

    await act(async () => {
      await result.current.subscribe();
    });

    expect(result.current.error).toBe("Failed to subscribe. Try again.");
    spy.mockRestore();
  });

  it("starts with isSubscribed false and no error", () => {
    const { result } = renderHook(() => useNotifications());
    expect(result.current.isSubscribed).toBe(false);
    expect(result.current.error).toBe("");
  });
});
