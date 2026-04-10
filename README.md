# iselodyhereyet

Is Elody Ann Justice Here Yet?

A simple status page hosted on GitHub Pages at [iselodyhereyet.site](https://iselodyhereyet.site). Updates via SMS or automatic Apple Notes sync.

## How it works

### SMS Updates

1. You text a message (e.g. "Not yet!" or "She's here!") to the Twilio phone number
2. Twilio sends a webhook to a Cloudflare Worker (`worker/`)
3. The Worker validates the Twilio signature and checks the sender against an allowlisted phone number
4. The Worker commits an updated `index.html` to this repo via the GitHub API
5. GitHub Pages rebuilds the site (~30-60 seconds)
6. The Worker replies with a confirmation SMS

### Apple Notes Sync

1. A launchd job runs every 5 minutes on your Mac
2. A JXA script (`sync/extract-note.js`) extracts HTML and images from the "Is it Baby Time?" note in Apple Notes
3. A shell script (`sync/sync.sh`) builds a JSON payload, checks if content has changed (SHA-256 hash), and POSTs to the Worker's `/sync` endpoint
4. The Worker uploads images to R2, rewrites image URLs in the HTML, and commits `notes.html` to this repo via the GitHub API
5. GitHub Pages rebuilds the site

## Architecture

- **Frontend**: Static `index.html` + `notes.html` on GitHub Pages with custom domain (`CNAME`)
- **Backend**: Cloudflare Worker (`worker/src/index.ts`) — receives SMS webhooks and Apple Notes sync requests
- **SMS**: Twilio phone number with webhook pointing to the Worker
- **Images**: Cloudflare R2 bucket (`iselodyhereyet-images`) for Apple Notes image hosting
- **Sync**: JXA + shell scripts (`sync/`) scheduled via launchd

## Secrets (stored as Cloudflare Worker secrets)

- `GITHUB_TOKEN` — Fine-grained PAT scoped to this repo with Contents read/write
- `TWILIO_AUTH_TOKEN` — For validating incoming webhook signatures
- `ALLOWED_PHONE` — E.164 format phone number (e.g. `+15551234567`)
- `SYNC_AUTH_TOKEN` — Bearer token for the `/sync` endpoint

## Deploy the Worker

```sh
cd worker
npm install
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put TWILIO_AUTH_TOKEN
npx wrangler secret put ALLOWED_PHONE
npx wrangler secret put SYNC_AUTH_TOKEN
npm run deploy
```

Then configure the Twilio phone number's "A MESSAGE COMES IN" webhook to the Worker URL (HTTP POST).

## Set up Apple Notes Sync

1. Generate a sync auth token and set it as a Worker secret:

   ```sh
   openssl rand -hex 32
   npx wrangler secret put SYNC_AUTH_TOKEN
   ```

2. Update `sync/com.iselodyhereyet.sync.plist` with your `SYNC_AUTH_TOKEN` and `SYNC_URL` (the Worker URL with `/sync` path, shown after `npm run deploy`).

3. Install and start the launchd job:

   ```sh
   cd worker
   npm run install-launchd
   ```

4. Verify it's running:

   ```sh
   launchctl list | grep iselodyhereyet
   tail -f /tmp/iselodyhereyet-sync.log
   ```

To uninstall:

```sh
npm run uninstall-launchd
```

## Run the sync manually

```sh
export SYNC_AUTH_TOKEN="<your-token>"
export SYNC_URL="<your-worker-url>/sync"
bash sync/sync.sh
```

## Development

```sh
cd worker
npm install
npm run dev        # local dev server at http://localhost:8787
npm run test       # run tests
npm run typecheck  # type check
```

## Update the site status

Text any message to the Twilio number from the allowlisted phone. The message body becomes the status displayed on the page. Or edit the "Is it Baby Time?" note in Apple Notes — changes sync automatically every 5 minutes.
