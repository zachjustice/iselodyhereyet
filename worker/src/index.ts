type Env = Cloudflare.Env;

interface SyncPayload {
  html: string;
  images: { name: string; data: string }[];
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const url = new URL(request.url);

    if (url.pathname === "/sync") {
      return handleSync(request, env);
    }

    return handleSms(request, env);
  },
};

// --- SMS handler (existing Twilio webhook) ---

async function handleSms(request: Request, env: Env): Promise<Response> {
  const formData = await request.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    params[key] = String(value);
  }

  // Validate Twilio signature
  const signature = request.headers.get("X-Twilio-Signature") ?? "";
  const isValid = await validateTwilioSignature(
    request.url,
    params,
    signature,
    env.TWILIO_AUTH_TOKEN
  );
  if (!isValid) {
    return new Response("Forbidden", { status: 403 });
  }

  // Check phone allowlist
  const from = params["From"] ?? "";
  if (from !== env.ALLOWED_PHONE) {
    return twimlResponse("Unauthorized sender.");
  }

  // Extract status message
  const status = (params["Body"] ?? "").trim();
  if (!status) {
    return twimlResponse("No status message provided.");
  }

  // Generate updated HTML
  const now = new Date();
  const timestamp = formatEasternTimestamp(now);
  const html = generateHtml(status, timestamp);

  // Commit to GitHub
  try {
    await commitToGitHub(env, env.GITHUB_FILE_PATH, html, `Update status: ${status}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return twimlResponse(`Failed to update: ${message}`);
  }

  return twimlResponse(`Status updated to: ${status}`);
}

// --- Sync handler (Apple Notes sync endpoint) ---

async function handleSync(request: Request, env: Env): Promise<Response> {
  // Authenticate via Bearer token
  const authHeader = request.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token || !timingSafeEqual(token, env.SYNC_AUTH_TOKEN)) {
    return new Response("Forbidden", { status: 403 });
  }

  // Parse and validate JSON body
  let payload: SyncPayload;
  try {
    payload = await request.json() as SyncPayload;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (typeof payload.html !== "string" || !payload.html.trim()) {
    return new Response("Missing or empty 'html' field", { status: 400 });
  }

  if (!Array.isArray(payload.images)) {
    return new Response("Missing 'images' array", { status: 400 });
  }

  for (const img of payload.images) {
    if (typeof img.name !== "string" || typeof img.data !== "string") {
      return new Response("Each image must have 'name' (string) and 'data' (string) fields", { status: 400 });
    }
  }

  // Upload images to R2 and build URL map
  const imageUrlMap = new Map<string, string>();
  for (const img of payload.images) {
    const binary = base64ToUint8Array(img.data);
    const contentType = guessContentType(img.name);
    const key = `images/${img.name}`;

    await env.IMAGES_BUCKET.put(key, binary, {
      httpMetadata: { contentType },
    });

    // R2 public URL via custom domain or r2.dev
    const publicUrl = `https://pub-iselodyhereyet-images.r2.dev/${key}`;
    imageUrlMap.set(img.name, publicUrl);
  }

  // Rewrite image src attributes in the HTML
  let finalHtml = payload.html;
  for (const [name, url] of imageUrlMap) {
    // Replace any src that references this image name (handles cid:, relative paths, etc.)
    finalHtml = finalHtml.replace(
      new RegExp(`src=["'][^"']*${escapeRegExp(name)}[^"']*["']`, "g"),
      `src="${url}"`
    );
  }

  // Commit notes.html to GitHub
  try {
    await commitToGitHub(env, env.NOTES_FILE_PATH, finalHtml, "Update notes from Apple Notes sync");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(`Failed to commit: ${message}`, { status: 500 });
  }

  return new Response("OK", { status: 200 });
}

// --- Shared utilities ---

async function validateTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string,
  authToken: string
): Promise<boolean> {
  const sortedKeys = Object.keys(params).sort();
  let dataString = url;
  for (const key of sortedKeys) {
    dataString += key + params[key];
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(dataString)
  );

  const computedSignature = btoa(
    String.fromCharCode(...new Uint8Array(signatureBuffer))
  );

  return timingSafeEqual(computedSignature, signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function formatEasternTimestamp(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";

  return `${get("weekday")} ${get("month")} ${get("day")} ${get("hour")}:${get("minute")} ${get("dayPeriod")} ${get("timeZoneName")}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function generateHtml(status: string, timestamp: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="ie=edge">
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>\u{1F476}</text></svg>">
    <title>\u{1F476} Baby Time?</title>
  </head>
  <body>
    <h1>Is Elody Here Yet?</h1>
    <p>${escapeHtml(status)}</p>
    <p>Last Updated at ${escapeHtml(timestamp)}</p>
    <div id="notes"></div>
    <script>
      fetch("notes.html")
        .then(r => r.ok ? r.text() : "")
        .then(html => { document.getElementById("notes").innerHTML = html; })
        .catch(() => {});
    </script>
  </body>
</html>
`;
}

function base64Encode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function guessContentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "heic":
      return "image/heic";
    default:
      return "application/octet-stream";
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function commitToGitHub(
  env: Env,
  filePath: string,
  content: string,
  commitMessage: string
): Promise<void> {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${filePath}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "iselodyhereyet-worker",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  // Get current file SHA (may not exist yet for notes.html)
  const getResponse = await fetch(`${url}?ref=${env.GITHUB_BRANCH}`, {
    headers,
  });

  let sha: string | undefined;
  if (getResponse.ok) {
    const fileData = (await getResponse.json()) as { sha: string };
    sha = fileData.sha;
  } else if (getResponse.status !== 404) {
    throw new Error(`GitHub GET failed: ${getResponse.status}`);
  }

  // Create or update file
  const body: Record<string, string> = {
    message: commitMessage,
    content: base64Encode(content),
    branch: env.GITHUB_BRANCH,
  };
  if (sha) {
    body.sha = sha;
  }

  const putResponse = await fetch(url, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!putResponse.ok) {
    const responseBody = await putResponse.text();
    throw new Error(`GitHub PUT failed: ${putResponse.status} - ${responseBody}`);
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function twimlResponse(message: string): Response {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(message)}</Message>
</Response>`;

  return new Response(twiml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
