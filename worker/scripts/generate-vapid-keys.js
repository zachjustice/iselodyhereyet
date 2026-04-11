#!/usr/bin/env node

// Generate VAPID key pair (ECDSA P-256) for Web Push notifications.
// Usage: node worker/scripts/generate-vapid-keys.js

const crypto = require("crypto");

const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
  namedCurve: "P-256",
});

const pubJwk = publicKey.export({ format: "jwk" });
const privJwk = privateKey.export({ format: "jwk" });

// Uncompressed public key: 0x04 || x || y (65 bytes), base64url-encoded
const x = Buffer.from(pubJwk.x, "base64");
const y = Buffer.from(pubJwk.y, "base64");
const rawPublic = Buffer.concat([Buffer.from([0x04]), x, y]);
const publicKeyB64 = rawPublic.toString("base64url");

// Private key: d parameter, base64url-encoded
const privateKeyB64 = privJwk.d;

console.log(`VAPID_PUBLIC_KEY=${publicKeyB64}`);
console.log(`VAPID_PRIVATE_KEY=${privateKeyB64}`);
console.log();
console.log("Next steps:");
console.log(`  1. Update VAPID_PUBLIC_KEY in index.html (line ~362)`);
console.log(`  2. Set worker secrets:`);
console.log(`     cd worker`);
console.log(`     echo "${privateKeyB64}" | npx wrangler secret put VAPID_PRIVATE_KEY`);
console.log(`     echo "${publicKeyB64}" | npx wrangler secret put VAPID_PUBLIC_KEY`);
