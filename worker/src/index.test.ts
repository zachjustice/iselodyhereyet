/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import worker from "./index";

// Helper to build a valid Twilio SMS request with correct HMAC signature
async function smsRequest(
  body: string,
  from = "+15551234567",
  url = "https://worker.example.com/"
): Promise<Request> {
  const params: Record<string, string> = { Body: body, From: from };

  const sortedKeys = Object.keys(params).sort();
  let dataString = url;
  for (const key of sortedKeys) {
    dataString += key + params[key];
  }

  const encoder = new TextEncoder();
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode("test-twilio-auth-token"),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", hmacKey, encoder.encode(dataString));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));

  const formBody = new URLSearchParams(params);
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Twilio-Signature": signature,
    },
    body: formBody.toString(),
  });
}

// Helper: base64url encode
function b64url(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// GitHub API mock that returns existing status.json with a given stage
function githubMock(previousStage: number | null = null) {
  if (previousStage !== null) {
    const content = btoa(JSON.stringify({ stage: previousStage, updatedAt: 12345 }));
    return vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sha: "existing-sha", content }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ content: { sha: "new-sha" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
  }
  // No previous file (404)
  return vi.fn()
    .mockResolvedValueOnce(new Response("Not Found", { status: 404 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ content: { sha: "abc123" } }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );
}

describe("POST / (SMS handler)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", githubMock());
  });

  it("commits status.json with correct stage for valid input (1-5)", async () => {
    const req = await smsRequest("3");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("Stage updated to 3: Labor");

    // Verify GitHub commit payload
    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const putCall = fetchMock.mock.calls[1];
    const putUrl = putCall[0] as string;
    expect(putUrl).toContain("status.json");
    const putBody = JSON.parse(putCall[1]?.body as string);
    const committed = JSON.parse(atob(putBody.content));
    expect(committed.stage).toBe(3);
    expect(typeof committed.updatedAt).toBe("number");
    expect(putBody.message).toBe("Update stage to 3: Labor");
  });

  it("commits status.json for stage 5 (She's Here!)", async () => {
    const req = await smsRequest("5");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    const xml = await res.text();
    expect(xml).toContain("Stage updated to 5");
    expect(xml).toContain("She&apos;s Here!");
  });

  it("updates timestamp when re-sending the same stage", async () => {
    vi.stubGlobal("fetch", githubMock(2));

    const req = await smsRequest("2");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const fetchMock = vi.mocked(globalThis.fetch);
    const putBody = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);
    expect(putBody.sha).toBe("existing-sha");
    const committed = JSON.parse(atob(putBody.content));
    expect(committed.stage).toBe(2);
  });

  it("rejects non-numeric input with TwiML error", async () => {
    const req = await smsRequest("hello");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/xml");
    const xml = await res.text();
    expect(xml).toContain("Invalid stage");
    expect(xml).toContain("1-5");
  });

  it("rejects stage 0 with TwiML error", async () => {
    const req = await smsRequest("0");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    const xml = await res.text();
    expect(xml).toContain("Invalid stage");
  });

  it("rejects stage 6 with TwiML error", async () => {
    const req = await smsRequest("6");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    const xml = await res.text();
    expect(xml).toContain("Invalid stage");
  });

  it("rejects decimal input with TwiML error", async () => {
    const req = await smsRequest("3.5");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    const xml = await res.text();
    expect(xml).toContain("Invalid stage");
  });

  it("rejects empty body with TwiML error", async () => {
    const req = await smsRequest("");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    const xml = await res.text();
    expect(xml).toContain("Invalid stage");
  });

  it("rejects unauthorized phone number with TwiML error", async () => {
    const req = await smsRequest("3", "+19999999999");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    const xml = await res.text();
    expect(xml).toContain("Unauthorized sender");
  });

  it("rejects invalid Twilio signature with 403", async () => {
    const formBody = new URLSearchParams({ Body: "3", From: "+15551234567" });
    const req = new Request("https://worker.example.com/", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Twilio-Signature": "invalidsignature",
      },
      body: formBody.toString(),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(403);
  });
});

// Helper to build a subscribe request
function subscribeRequest(body: unknown): Request {
  return new Request("https://worker.example.com/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /subscribe", () => {
  it("stores a valid push subscription in KV and returns 201", async () => {
    const subscription = {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2w...", auth: "tBHItJI5svbpC7htqL..." },
    };
    const req = subscribeRequest(subscription);
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(201);
    const json = await res.json() as { ok: boolean };
    expect(json.ok).toBe(true);

    // Verify stored in KV — list all keys and check one was written
    const list = await env.PUSH_SUBSCRIPTIONS.list({ prefix: "sub:" });
    expect(list.keys.length).toBe(1);

    // Verify stored data matches
    const stored = await env.PUSH_SUBSCRIPTIONS.get(list.keys[0].name);
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.endpoint).toBe(subscription.endpoint);
    expect(parsed.keys.p256dh).toBe(subscription.keys.p256dh);
    expect(parsed.keys.auth).toBe(subscription.keys.auth);
  });

  it("handles duplicate subscriptions (same endpoint) gracefully", async () => {
    const subscription = {
      endpoint: "https://fcm.googleapis.com/fcm/send/dup-test",
      keys: { p256dh: "key1", auth: "auth1" },
    };

    const ctx1 = createExecutionContext();
    await worker.fetch(subscribeRequest(subscription), env, ctx1);
    await waitOnExecutionContext(ctx1);

    // Re-subscribe with updated keys
    const updated = {
      endpoint: "https://fcm.googleapis.com/fcm/send/dup-test",
      keys: { p256dh: "key2", auth: "auth2" },
    };
    const ctx2 = createExecutionContext();
    const res = await worker.fetch(subscribeRequest(updated), env, ctx2);
    await waitOnExecutionContext(ctx2);

    expect(res.status).toBe(201);

    // Should still be only one key for this endpoint
    const list = await env.PUSH_SUBSCRIPTIONS.list({ prefix: "sub:" });
    const values = await Promise.all(
      list.keys.map(async (k) => {
        const v = await env.PUSH_SUBSCRIPTIONS.get(k.name);
        return v ? JSON.parse(v) : null;
      })
    );
    const matching = values.filter(
      (v) => v?.endpoint === "https://fcm.googleapis.com/fcm/send/dup-test"
    );
    expect(matching.length).toBe(1);
    expect(matching[0].keys.p256dh).toBe("key2");
  });

  it("rejects invalid JSON with 400", async () => {
    const req = new Request("https://worker.example.com/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json{{{",
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Invalid JSON");
  });

  it("rejects missing endpoint with 400", async () => {
    const req = subscribeRequest({ keys: { p256dh: "a", auth: "b" } });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("endpoint");
  });

  it("rejects missing keys with 400", async () => {
    const req = subscribeRequest({ endpoint: "https://example.com/push" });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("keys");
  });

  it("rejects missing keys.auth with 400", async () => {
    const req = subscribeRequest({
      endpoint: "https://example.com/push",
      keys: { p256dh: "a" },
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("auth");
  });

  it("rejects invalid endpoint URL with 400", async () => {
    const req = subscribeRequest({
      endpoint: "not-a-url",
      keys: { p256dh: "a", auth: "b" },
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("valid URL");
  });
});

describe("Push notifications (SMS handler)", () => {
  let testSubscription: { endpoint: string; keys: { p256dh: string; auth: string } };

  beforeAll(async () => {
    // Generate valid subscription keys (ECDH P-256) for test push subscriptions
    // VAPID keys come from .dev.vars (valid P-256 keys from RFC 8291 test vectors)
    const subKp = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"]
    ) as CryptoKeyPair;
    const subPubRaw = new Uint8Array(
      await crypto.subtle.exportKey("raw", subKp.publicKey) as ArrayBuffer
    );
    const authBytes = crypto.getRandomValues(new Uint8Array(16));

    testSubscription = {
      endpoint: "https://push.example.com/sub1",
      keys: {
        p256dh: b64url(subPubRaw),
        auth: b64url(authBytes),
      },
    };
  });

  // Clean up ALL subscriptions in KV before each test to avoid stale data
  // from subscribe tests that use fake (non-crypto-valid) keys
  beforeEach(async () => {
    const list = await env.PUSH_SUBSCRIPTIONS.list({ prefix: "sub:" });
    for (const key of list.keys) {
      await env.PUSH_SUBSCRIPTIONS.delete(key.name);
    }
  });

  it("sends push notifications to all subscribers when stage changes", async () => {
    // Store a subscription in KV
    await env.PUSH_SUBSCRIPTIONS.put("sub:test-push-1", JSON.stringify(testSubscription));

    // Mock: GitHub GET returns stage 1, PUT succeeds, push endpoint returns 201
    const content = btoa(JSON.stringify({ stage: 1, updatedAt: 12345 }));
    const mockFetch = vi.fn(async (url: string | Request | URL, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes("api.github.com") && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify({ sha: "abc", content }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("api.github.com") && init?.method === "PUT") {
        return new Response(JSON.stringify({ content: { sha: "def" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // Push endpoint
      return new Response("", { status: 201 });
    });
    vi.stubGlobal("fetch", mockFetch);

    const req = await smsRequest("3");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);

    // Verify push notification was sent
    const pushCalls = mockFetch.mock.calls.filter(
      (call) => call[0].toString().includes("push.example.com")
    );
    expect(pushCalls.length).toBe(1);
    expect(pushCalls[0][0]).toBe("https://push.example.com/sub1");
    const pushInit = pushCalls[0][1] as RequestInit;
    expect(pushInit.method).toBe("POST");
    expect((pushInit.headers as Record<string, string>)["Content-Encoding"]).toBe("aes128gcm");
    expect((pushInit.headers as Record<string, string>)["Authorization"]).toContain("vapid t=");

    // Clean up
    await env.PUSH_SUBSCRIPTIONS.delete("sub:test-push-1");
  });

  it("does NOT send push notifications when stage is the same", async () => {
    // Store a subscription in KV
    await env.PUSH_SUBSCRIPTIONS.put("sub:test-push-2", JSON.stringify(testSubscription));

    // Mock: GitHub GET returns stage 3 (same as incoming), PUT succeeds
    const content = btoa(JSON.stringify({ stage: 3, updatedAt: 12345 }));
    const mockFetch = vi.fn(async (url: string | Request | URL, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes("api.github.com") && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify({ sha: "abc", content }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("api.github.com") && init?.method === "PUT") {
        return new Response(JSON.stringify({ content: { sha: "def" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("", { status: 201 });
    });
    vi.stubGlobal("fetch", mockFetch);

    const req = await smsRequest("3");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);

    // Verify NO push notification was sent
    const pushCalls = mockFetch.mock.calls.filter(
      (call) => call[0].toString().includes("push.example.com")
    );
    expect(pushCalls.length).toBe(0);

    // Should only have GitHub API calls
    expect(mockFetch.mock.calls.length).toBe(2);

    // Clean up
    await env.PUSH_SUBSCRIPTIONS.delete("sub:test-push-2");
  });

  it("sends push notifications when status.json is new (no previous file)", async () => {
    // Store a subscription in KV
    await env.PUSH_SUBSCRIPTIONS.put("sub:test-push-3", JSON.stringify(testSubscription));

    // Mock: GitHub GET returns 404 (new file), PUT succeeds, push returns 201
    const mockFetch = vi.fn(async (url: string | Request | URL, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes("api.github.com") && (!init?.method || init.method === "GET")) {
        return new Response("Not Found", { status: 404 });
      }
      if (urlStr.includes("api.github.com") && init?.method === "PUT") {
        return new Response(JSON.stringify({ content: { sha: "def" } }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("", { status: 201 });
    });
    vi.stubGlobal("fetch", mockFetch);

    const req = await smsRequest("1");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);

    // Push notification should be sent (null previous stage !== 1)
    const pushCalls = mockFetch.mock.calls.filter(
      (call) => call[0].toString().includes("push.example.com")
    );
    expect(pushCalls.length).toBe(1);

    // Clean up
    await env.PUSH_SUBSCRIPTIONS.delete("sub:test-push-3");
  });

  it("cleans up subscription from KV when push endpoint returns 410 Gone", async () => {
    // Store a subscription in KV
    await env.PUSH_SUBSCRIPTIONS.put("sub:test-push-4", JSON.stringify(testSubscription));

    // Mock: GitHub returns stage 1, push endpoint returns 410 Gone
    const content = btoa(JSON.stringify({ stage: 1, updatedAt: 12345 }));
    const mockFetch = vi.fn(async (url: string | Request | URL, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes("api.github.com") && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify({ sha: "abc", content }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("api.github.com") && init?.method === "PUT") {
        return new Response(JSON.stringify({ content: { sha: "def" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // Push endpoint returns 410 Gone (expired subscription)
      return new Response("Gone", { status: 410 });
    });
    vi.stubGlobal("fetch", mockFetch);

    const req = await smsRequest("3");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);

    // Verify subscription was deleted from KV
    const stored = await env.PUSH_SUBSCRIPTIONS.get("sub:test-push-4");
    expect(stored).toBeNull();
  });

  it("includes correct stage-specific message in notification payload", async () => {
    // Store a subscription in KV
    await env.PUSH_SUBSCRIPTIONS.put("sub:test-push-5", JSON.stringify(testSubscription));

    // Mock: GitHub returns stage 1, push succeeds
    const content = btoa(JSON.stringify({ stage: 1, updatedAt: 12345 }));
    const mockFetch = vi.fn(async (url: string | Request | URL, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes("api.github.com") && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify({ sha: "abc", content }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("api.github.com") && init?.method === "PUT") {
        return new Response(JSON.stringify({ content: { sha: "def" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("", { status: 201 });
    });
    vi.stubGlobal("fetch", mockFetch);

    const req = await smsRequest("5");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);

    // Verify push was sent (stage changed from 1 to 5)
    const pushCalls = mockFetch.mock.calls.filter(
      (call) => call[0].toString().includes("push.example.com")
    );
    expect(pushCalls.length).toBe(1);

    // The encrypted payload can't be directly inspected, but we can verify
    // the request was made with the correct headers and a body
    const pushInit = pushCalls[0][1] as RequestInit;
    expect(pushInit.body).toBeInstanceOf(Uint8Array);
    expect((pushInit.body as Uint8Array).length).toBeGreaterThan(0);

    // Clean up
    await env.PUSH_SUBSCRIPTIONS.delete("sub:test-push-5");
  });
});

describe("general routing", () => {
  it("rejects non-POST/OPTIONS requests to /subscribe with 405", async () => {
    const req = new Request("https://worker.example.com/subscribe", {
      method: "GET",
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(405);
  });

  it("returns 204 with CORS headers for OPTIONS /subscribe", async () => {
    const req = new Request("https://worker.example.com/subscribe", {
      method: "OPTIONS",
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Content-Type");
  });

  it("includes CORS headers on POST /subscribe responses", async () => {
    const subscription = {
      endpoint: "https://fcm.googleapis.com/fcm/send/cors-test",
      keys: { p256dh: "test-key", auth: "test-auth" },
    };
    const req = new Request("https://worker.example.com/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(201);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
