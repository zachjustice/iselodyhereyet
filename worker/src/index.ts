type Env = Cloudflare.Env;

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const url = new URL(request.url);
    if (url.pathname === "/subscribe") {
      return handleSubscribe(request, env);
    }

    return handleSms(request, env);
  },
};

// --- SMS handler (existing Twilio webhook) ---

const STAGE_LABELS: Record<number, string> = {
  1: "Waiting",
  2: "Early Labor",
  3: "Labor",
  4: "Delivery",
  5: "She's Here!",
};

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

  // Parse stage number from SMS body
  const body = (params["Body"] ?? "").trim();
  const stage = parseInt(body, 10);
  if (isNaN(stage) || stage < 1 || stage > 5 || body !== String(stage)) {
    return twimlResponse(
      "Invalid stage. Send a number 1-5: 1=Waiting, 2=Early Labor, 3=Active Labor, 4=Delivery, 5=She's Here!"
    );
  }

  // Build status.json
  const now = new Date();
  const lastUpdated = formatEasternTimestamp(now);
  const statusJson = JSON.stringify({ stage, lastUpdated }, null, 2);

  // Commit to GitHub
  try {
    await commitToGitHub(env, env.GITHUB_FILE_PATH, statusJson, `Update stage to ${stage}: ${STAGE_LABELS[stage]}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return twimlResponse(`Failed to update: ${message}`);
  }

  return twimlResponse(`Stage updated to ${stage}: ${STAGE_LABELS[stage]}`);
}

// --- Subscribe handler (push notification subscriptions) ---

interface PushSubscriptionPayload {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

async function handleSubscribe(request: Request, env: Env): Promise<Response> {
  let payload: PushSubscriptionPayload;
  try {
    payload = await request.json() as PushSubscriptionPayload;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Validate required fields
  if (
    !payload.endpoint ||
    typeof payload.endpoint !== "string" ||
    !payload.keys?.p256dh ||
    !payload.keys?.auth
  ) {
    return new Response(
      "Invalid subscription: requires endpoint, keys.p256dh, and keys.auth",
      { status: 400 }
    );
  }

  // Validate endpoint is a URL
  try {
    new URL(payload.endpoint);
  } catch {
    return new Response("Invalid subscription: endpoint must be a valid URL", {
      status: 400,
    });
  }

  // Key by SHA-256 hash of the endpoint URL to avoid duplicates
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(payload.endpoint)
  );
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const key = "sub:" + hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  // Store the subscription in KV
  const subscription = {
    endpoint: payload.endpoint,
    keys: {
      p256dh: payload.keys.p256dh,
      auth: payload.keys.auth,
    },
  };

  await env.PUSH_SUBSCRIPTIONS.put(key, JSON.stringify(subscription));

  return new Response(JSON.stringify({ ok: true }), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
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
