interface Env {
  GITHUB_TOKEN: string;
  TWILIO_AUTH_TOKEN: string;
  ALLOWED_PHONE: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  GITHUB_FILE_PATH: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

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
      await commitToGitHub(env, html, `Update status: ${status}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return twimlResponse(`Failed to update: ${message}`);
    }

    return twimlResponse(`Status updated to: ${status}`);
  },
};

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

async function commitToGitHub(
  env: Env,
  htmlContent: string,
  commitMessage: string
): Promise<void> {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${env.GITHUB_FILE_PATH}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "iselodyhereyet-worker",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  // Get current file SHA
  const getResponse = await fetch(`${url}?ref=${env.GITHUB_BRANCH}`, {
    headers,
  });
  if (!getResponse.ok) {
    throw new Error(`GitHub GET failed: ${getResponse.status}`);
  }
  const fileData = (await getResponse.json()) as { sha: string };

  // Update file
  const putResponse = await fetch(url, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: commitMessage,
      content: base64Encode(htmlContent),
      sha: fileData.sha,
      branch: env.GITHUB_BRANCH,
    }),
  });

  if (!putResponse.ok) {
    const body = await putResponse.text();
    throw new Error(`GitHub PUT failed: ${putResponse.status} - ${body}`);
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
