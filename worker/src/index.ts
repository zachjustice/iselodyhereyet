type Env = Cloudflare.Env;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/subscribe") {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }
      return withCors(await handleSubscribe(request, env));
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    return handleSms(request, env, ctx);
  },
};

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// --- SMS handler (existing Twilio webhook) ---

const STAGE_LABELS: Record<number, string> = {
  1: "Waiting",
  2: "Early Labor",
  3: "Active Labor",
  4: "Delivery",
  5: "She's Here!",
};

const STAGE_NOTIFICATIONS: Record<number, { title: string; body: string }> = {
  1: { title: "Status Update", body: "We're waiting! No signs of labor yet." },
  2: { title: "It's Starting!", body: "Early labor has begun." },
  3: { title: "Things Are Moving!", body: "Active labor is underway." },
  4: { title: "Almost There!", body: "Delivery is happening!" },
  5: { title: "She's Here!", body: "Elody Ann Justice has arrived!" },
};

async function handleSms(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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
  let previousContent: string | null = null;
  try {
    const result = await commitToGitHub(env, env.GITHUB_FILE_PATH, statusJson, `Update stage to ${stage}: ${STAGE_LABELS[stage]}`);
    previousContent = result.previousContent;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return twimlResponse(`Failed to update: ${message}`);
  }

  // Send push notifications if stage changed
  let previousStage: number | null = null;
  if (previousContent) {
    try {
      previousStage = JSON.parse(previousContent).stage ?? null;
    } catch {
      // ignore parse errors — treat as new file (stage changed)
    }
  }

  if (previousStage !== stage) {
    ctx.waitUntil(sendNotificationsToAll(env, stage));
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
): Promise<{ previousContent: string | null }> {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${filePath}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "iselodyhereyet-worker",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  // Get current file SHA and content
  const getResponse = await fetch(`${url}?ref=${env.GITHUB_BRANCH}`, {
    headers,
  });

  let sha: string | undefined;
  let previousContent: string | null = null;
  if (getResponse.ok) {
    const fileData = (await getResponse.json()) as { sha: string; content: string };
    sha = fileData.sha;
    try {
      previousContent = atob(fileData.content.replace(/\n/g, ""));
    } catch {
      // content might not be decodable
    }
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

  return { previousContent };
}

// --- Web Push notification functions ---

function base64UrlEncode(data: Uint8Array | ArrayBuffer): string {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function createVapidHeaders(
  endpoint: string,
  vapidPrivateKey: string,
  vapidPublicKey: string
): Promise<{ authorization: string }> {
  const origin = new URL(endpoint).origin;
  const now = Math.floor(Date.now() / 1000);

  const headerJson = JSON.stringify({ typ: "JWT", alg: "ES256" });
  const payloadJson = JSON.stringify({
    aud: origin,
    exp: now + 12 * 60 * 60,
    sub: "mailto:noreply@iselodyhereyet.site",
  });

  const headerB64 = base64UrlEncode(new TextEncoder().encode(headerJson));
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(payloadJson));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  // Import VAPID private key (base64url d parameter) with public key components
  const privateKeyBytes = base64UrlDecode(vapidPrivateKey);
  const publicKeyBytes = base64UrlDecode(vapidPublicKey);

  const x = base64UrlEncode(publicKeyBytes.slice(1, 33));
  const y = base64UrlEncode(publicKeyBytes.slice(33, 65));
  const d = base64UrlEncode(privateKeyBytes);

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x, y, d, ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(unsignedToken)
  );

  const jwt = `${unsignedToken}.${base64UrlEncode(signature)}`;
  return { authorization: `vapid t=${jwt}, k=${vapidPublicKey}` };
}

async function encryptPushPayload(
  subscriptionKeys: { p256dh: string; auth: string },
  payload: string
): Promise<Uint8Array> {
  // Generate ephemeral ECDH key pair
  const localKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  ) as CryptoKeyPair;

  // Import subscriber's public key
  const subscriberPubBytes = base64UrlDecode(subscriptionKeys.p256dh);
  const subscriberPubKey = await crypto.subtle.importKey(
    "raw",
    subscriberPubBytes,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  // ECDH shared secret (Cloudflare types use $public but runtime expects public)
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: subscriberPubKey } as unknown as SubtleCryptoDeriveKeyAlgorithm,
    localKeyPair.privateKey,
    256
  );

  // Export local public key (65 bytes uncompressed)
  const localPubBytes = new Uint8Array(
    await crypto.subtle.exportKey("raw", localKeyPair.publicKey) as ArrayBuffer
  );

  // Auth secret
  const authSecret = base64UrlDecode(subscriptionKeys.auth);

  // Derive IKM: HKDF(salt=auth, ikm=ecdh_secret, info="WebPush: info\0" || subscriber_pub || local_pub)
  const infoPrefix = new TextEncoder().encode("WebPush: info\0");
  const ikmInfo = new Uint8Array(infoPrefix.length + subscriberPubBytes.length + localPubBytes.length);
  ikmInfo.set(infoPrefix, 0);
  ikmInfo.set(subscriberPubBytes, infoPrefix.length);
  ikmInfo.set(localPubBytes, infoPrefix.length + subscriberPubBytes.length);

  const sharedSecretKey = await crypto.subtle.importKey(
    "raw", sharedSecret, "HKDF", false, ["deriveBits"]
  );

  const ikm = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: authSecret, info: ikmInfo },
    sharedSecretKey,
    256
  );

  // Random 16-byte salt for content encryption
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const ikmKey = await crypto.subtle.importKey(
    "raw", ikm, "HKDF", false, ["deriveBits"]
  );

  // Derive CEK (16 bytes) and nonce (12 bytes)
  const cek = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: new TextEncoder().encode("Content-Encoding: aes128gcm\0") },
    ikmKey, 128
  );

  const nonce = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: new TextEncoder().encode("Content-Encoding: nonce\0") },
    ikmKey, 96
  );

  // Pad payload with final record delimiter (0x02)
  const payloadBytes = new TextEncoder().encode(payload);
  const padded = new Uint8Array(payloadBytes.length + 1);
  padded.set(payloadBytes);
  padded[payloadBytes.length] = 2;

  // AES-128-GCM encrypt
  const cekKey = await crypto.subtle.importKey(
    "raw", cek, "AES-GCM", false, ["encrypt"]
  );

  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: new Uint8Array(nonce) },
      cekKey,
      padded
    )
  );

  // Build aes128gcm header: salt(16) + rs(4) + idlen(1) + keyid(65)
  const rs = new ArrayBuffer(4);
  new DataView(rs).setUint32(0, 4096, false);

  const header = new Uint8Array(16 + 4 + 1 + localPubBytes.length);
  header.set(salt, 0);
  header.set(new Uint8Array(rs), 16);
  header[20] = localPubBytes.length;
  header.set(localPubBytes, 21);

  const result = new Uint8Array(header.length + encrypted.length);
  result.set(header);
  result.set(encrypted, header.length);

  return result;
}

async function sendPushNotification(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  env: Env
): Promise<Response> {
  const body = await encryptPushPayload(subscription.keys, payload);
  const { authorization } = await createVapidHeaders(
    subscription.endpoint,
    env.VAPID_PRIVATE_KEY,
    env.VAPID_PUBLIC_KEY
  );

  return fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
    },
    body,
  });
}

async function sendNotificationsToAll(env: Env, stage: number): Promise<void> {
  const notification = STAGE_NOTIFICATIONS[stage];
  if (!notification) return;

  const payload = JSON.stringify({
    title: notification.title,
    body: notification.body,
    url: "https://www.iselodyhereyet.site",
  });

  const list = await env.PUSH_SUBSCRIPTIONS.list({ prefix: "sub:" });

  const results = await Promise.allSettled(
    list.keys.map(async (key) => {
      const subJson = await env.PUSH_SUBSCRIPTIONS.get(key.name);
      if (!subJson) return;

      const subscription = JSON.parse(subJson);
      const response = await sendPushNotification(subscription, payload, env);

      // Clean up expired subscriptions
      if (response.status === 410) {
        await env.PUSH_SUBSCRIPTIONS.delete(key.name);
      }
    })
  );

  // Log failures for debugging (errors are caught to avoid crashing the handler)
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Push notification failed:", result.reason);
    }
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
