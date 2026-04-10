# iselodyhereyet

Is Elody Ann Justice Here Yet?

A simple status page hosted on GitHub Pages at [iselodyhereyet.site](https://iselodyhereyet.site). Text an SMS to a Twilio phone number and the website updates with the message.

## How it works

1. You text a message (e.g. "Not yet!" or "She's here!") to the Twilio phone number
2. Twilio sends a webhook to a Cloudflare Worker (`worker/`)
3. The Worker validates the Twilio signature and checks the sender against an allowlisted phone number
4. The Worker commits an updated `index.html` to this repo via the GitHub API
5. GitHub Pages rebuilds the site (~30-60 seconds)
6. The Worker replies with a confirmation SMS

## Architecture

- **Frontend**: Static `index.html` on GitHub Pages with custom domain (`CNAME`)
- **Backend**: Cloudflare Worker (`worker/src/index.ts`) — receives SMS, commits to GitHub
- **SMS**: Twilio phone number with webhook pointing to the Worker

## Secrets (stored as Cloudflare Worker secrets)

- `GITHUB_TOKEN` — Fine-grained PAT scoped to this repo with Contents read/write
- `TWILIO_AUTH_TOKEN` — For validating incoming webhook signatures
- `ALLOWED_PHONE` — E.164 format phone number (e.g. `+15551234567`)

## Deploy the Worker

```sh
cd worker
npm install
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put TWILIO_AUTH_TOKEN
npx wrangler secret put ALLOWED_PHONE
npx wrangler deploy
```

Then configure the Twilio phone number's "A MESSAGE COMES IN" webhook to the Worker URL (HTTP POST).

## Update the site status

Text any message to the Twilio number from the allowlisted phone. The message body becomes the status displayed on the page.
