/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, vi, beforeEach } from "vitest";
import worker from "./index";

// Helper to build a sync request
function syncRequest(
  body: unknown,
  token = "valid-sync-token"
): Request {
  return new Request("https://worker.example.com/sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

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

// Small 1x1 red PNG as base64
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

describe("POST /sync", () => {
  beforeEach(() => {
    // globalThis.fetch is used by commitToGitHub — mock it
    vi.stubGlobal(
      "fetch",
      vi.fn()
        // First call: GET file SHA (404 = new file)
        .mockResolvedValueOnce(
          new Response("Not Found", { status: 404 })
        )
        // Second call: PUT file
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ content: { sha: "abc123" } }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          })
        )
    );
  });

  it("rejects requests without auth token with 403", async () => {
    const req = new Request("https://worker.example.com/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html: "<p>hi</p>", images: [] }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(403);
  });

  it("rejects requests with wrong auth token with 403", async () => {
    const req = syncRequest({ html: "<p>hi</p>", images: [] }, "wrong-token");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(403);
  });

  it("rejects invalid JSON with 400", async () => {
    const req = new Request("https://worker.example.com/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer valid-sync-token",
      },
      body: "not json{{{",
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Invalid JSON");
  });

  it("rejects missing html field with 400", async () => {
    const req = syncRequest({ images: [] });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("html");
  });

  it("rejects empty html field with 400", async () => {
    const req = syncRequest({ html: "   ", images: [] });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("html");
  });

  it("rejects missing images array with 400", async () => {
    const req = syncRequest({ html: "<p>hi</p>" });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("images");
  });

  it("rejects images with missing fields with 400", async () => {
    const req = syncRequest({
      html: "<p>hi</p>",
      images: [{ name: "test.png" }], // missing data
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("name");
  });

  it("uploads images to R2 and rewrites src URLs in HTML", async () => {
    const html = `<p>Look at this:</p><img src="cid:photo.png"><img src="photo2.jpg">`;
    const req = syncRequest({
      html,
      images: [
        { name: "photo.png", data: TINY_PNG_BASE64 },
        { name: "photo2.jpg", data: TINY_PNG_BASE64 },
      ],
    });

    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);

    // Verify images were uploaded to R2
    const obj1 = await env.IMAGES_BUCKET.get("images/photo.png");
    expect(obj1).not.toBeNull();

    const obj2 = await env.IMAGES_BUCKET.get("images/photo2.jpg");
    expect(obj2).not.toBeNull();

    // Verify GitHub commit was called with rewritten HTML
    const fetchMock = vi.mocked(globalThis.fetch);
    // The PUT call is the second call — its body has the committed content
    const putCall = fetchMock.mock.calls[1];
    const putBody = JSON.parse(putCall[1]?.body as string);
    const committedHtml = atob(putBody.content);

    expect(committedHtml).toContain('src="https://pub-iselodyhereyet-images.r2.dev/images/photo.png"');
    expect(committedHtml).toContain('src="https://pub-iselodyhereyet-images.r2.dev/images/photo2.jpg"');
    expect(committedHtml).not.toContain("cid:");
  });

  it("commits notes.html to GitHub for new file (no existing SHA)", async () => {
    const req = syncRequest({ html: "<p>Hello notes</p>", images: [] });

    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);

    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // GET call for file SHA
    const getUrl = fetchMock.mock.calls[0][0] as string;
    expect(getUrl).toContain("notes.html");

    // PUT call to create file
    const putCall = fetchMock.mock.calls[1];
    const putBody = JSON.parse(putCall[1]?.body as string);
    expect(putBody.message).toBe("Update notes from Apple Notes sync");
    expect(putBody.sha).toBeUndefined(); // new file, no sha
    const content = atob(putBody.content);
    expect(content).toBe("<p>Hello notes</p>");
  });

  it("commits notes.html to GitHub with existing SHA", async () => {
    // Override the mock to return an existing file
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ sha: "existing-sha-456" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ content: { sha: "new-sha-789" } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        )
    );

    const req = syncRequest({ html: "<p>Updated notes</p>", images: [] });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);

    const fetchMock = vi.mocked(globalThis.fetch);
    const putBody = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);
    expect(putBody.sha).toBe("existing-sha-456");
  });

  it("returns 500 when GitHub commit fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(new Response("Not Found", { status: 404 }))
        .mockResolvedValueOnce(new Response("Server Error", { status: 500 }))
    );

    const req = syncRequest({ html: "<p>will fail</p>", images: [] });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(500);
    expect(await res.text()).toContain("Failed to commit");
  });
});

describe("POST / (SMS handler)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(new Response("Not Found", { status: 404 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ content: { sha: "abc123" } }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          })
        )
    );
  });

  it("commits status.json with correct stage for valid input (1-5)", async () => {
    const req = await smsRequest("3");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("Stage updated to 3: Active Labor");

    // Verify GitHub commit payload
    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const putCall = fetchMock.mock.calls[1];
    const putUrl = putCall[0] as string;
    expect(putUrl).toContain("status.json");
    const putBody = JSON.parse(putCall[1]?.body as string);
    const committed = JSON.parse(atob(putBody.content));
    expect(committed.stage).toBe(3);
    expect(committed.lastUpdated).toBeTruthy();
    expect(putBody.message).toBe("Update stage to 3: Active Labor");
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
    // Simulate existing status.json
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ sha: "existing-sha" }), { status: 200, headers: { "Content-Type": "application/json" } })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ content: { sha: "new-sha" } }), { status: 200, headers: { "Content-Type": "application/json" } })
        )
    );

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
    // Filter to just our endpoint's key — other tests may have written keys
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

describe("general routing", () => {
  it("rejects non-POST requests with 405", async () => {
    const req = new Request("https://worker.example.com/sync", {
      method: "GET",
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(405);
  });
});
