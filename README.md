# iselodyhereyet

Is Elody Ann Justice Here Yet?

A simple status page hosted on GitHub Pages at [iselodyhereyet.site](https://iselodyhereyet.site). Updates via SMS.

## How it works

### SMS Updates

1. You text a message (e.g. "Not yet!" or "She's here!") to the Twilio phone number
2. Twilio sends a webhook to a Cloudflare Worker (`worker/`)
3. The Worker validates the Twilio signature and checks the sender against an allowlisted phone number
4. The Worker commits an updated `index.html` to this repo via the GitHub API
5. GitHub Pages rebuilds the site (~30-60 seconds)
6. The Worker replies with a confirmation SMS

## Architecture

- **Frontend**: Static `index.html` + `notes.html` on GitHub Pages with custom domain (`CNAME`)
- **Backend**: Cloudflare Worker (`worker/src/index.ts`) — receives SMS webhooks and push notification subscriptions
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
npm run deploy
```

Then configure the Twilio phone number's "A MESSAGE COMES IN" webhook to the Worker URL (HTTP POST).

## Development

```sh
cd worker
npm install
npm run dev        # local dev server at http://localhost:8787
npm run test       # run tests
npm run typecheck  # type check
```

## Update the site status

Text a number 1-5 to the twilio phone number to update the status.
