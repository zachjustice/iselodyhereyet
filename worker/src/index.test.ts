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
