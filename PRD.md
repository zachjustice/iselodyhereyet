# PRD: Sync Apple Notes to Website

## Problem Statement

Friends and family checking iselodyhereyet.site currently only see a single-line status message ("No", "She's here!", etc.) updated via SMS. Meanwhile, richer blog-style updates — including photos and detailed progress — are being shared through a shared Apple Notes link ("Is it Baby Time?"). This forces people to check two places, and not everyone has access to the Apple Notes link.

## Solution

Sync the contents of the shared Apple Note onto the website, displayed below the existing SMS-controlled status banner. The page will answer the immediate question ("Is Elody here yet?") at the top, with rich blog-style updates and photos below. The two update paths — SMS for the quick yes/no status, Apple Notes for the detailed journal — will coexist without interfering with each other by writing to separate files (`index.html` and `notes.html`).

## User Stories

1. As a friend or family member, I want to see detailed updates on the website, so that I don't need access to the Apple Notes link.
2. As a friend or family member, I want to see photos on the website, so that I can follow along visually.
3. As a friend or family member, I want to see the quick yes/no status at the top of the page, so that my immediate question is answered before I scroll.
4. As the parent (Zach), I want to update the note in Apple Notes and have the website update automatically, so that I don't have to manually publish changes.
5. As the parent, I want the sync to run every 5 minutes automatically, so that I don't have to remember to trigger it.
6. As the parent, I want the sync to skip unnecessary updates when nothing has changed, so that the git history stays clean.
7. As the parent, I want to keep updating the status via SMS, so that I can quickly change the yes/no answer from the delivery room without opening Notes.
8. As the parent, I want the SMS and notes sync to never conflict with each other, so that neither update path can break the other.
9. As the parent, I want the sync script to run on my Mac without intervention, so that it works in the background while I'm focused on other things.
10. As the parent, I want images from the note to be hosted reliably, so that they load quickly and don't bloat the git repo.
11. As the parent, I want the sync endpoint to be authenticated, so that only my Mac can trigger updates.
12. As a visitor, I want the page to load quickly, so that I'm not waiting on large assets.
13. As a visitor, I want the notes content to preserve its original formatting (headings, bold, lists, etc.), so that it reads naturally.
14. As the parent, I want the AppleScript to be as simple as possible, so that it's easy to debug if something goes wrong.

## Implementation Decisions

### Architecture: Two-file approach
- `index.html` is owned exclusively by the SMS/Twilio flow. It contains the status banner and a small inline `<script>` that fetches `notes.html` and injects it into a `<div id="notes">`.
- `notes.html` is owned exclusively by the Apple Notes sync flow. It contains the rendered note content with images.
- This eliminates any possibility of race conditions between the two update paths.

### Apple Notes extraction
- An AppleScript running on Zach's Mac extracts the HTML body and embedded image attachments from the note titled "Is it Baby Time?".
- The AppleScript is kept as simple as possible — it extracts data and hands it off. No HTML manipulation.

### Sync script (shell wrapper)
- A shell script orchestrates the sync: invokes the AppleScript, hashes the resulting payload, compares against a locally cached hash, and skips the POST if nothing has changed.
- This script is what launchd invokes every 5 minutes.

### Cloudflare Worker `/sync` endpoint
- A new route on the existing `iselodyhereyet-sms` Worker.
- Authenticates requests via a `Bearer` token in the `Authorization` header, checked against a `SYNC_AUTH_TOKEN` Worker secret.
- Accepts a JSON body: `{ html: string, images: [{ name: string, data: string }] }` where image `data` is base64-encoded.
- Uploads images to Cloudflare R2 and rewrites `src` attributes in the HTML to point to R2 public URLs.
- Commits the final `notes.html` to the GitHub repo via the existing GitHub Contents API logic.

### Image hosting
- Images are uploaded to a Cloudflare R2 bucket named `iselodyhereyet-images` with public access enabled via the default `r2.dev` domain.
- Image URL rewriting (replacing local/Apple references with R2 URLs) happens in the Worker, not in the AppleScript.

### HTML rendering
- The Apple Notes HTML is rendered as-is with minimal sanitization. No Markdown conversion or heavy processing.

### Worker template update
- The existing `generateHtml` function in the SMS handler is updated to include `<div id="notes"></div>` and the fetch script in the HTML template.

### Scheduling
- A launchd plist on Zach's Mac runs the sync script every 5 minutes.

### New secrets
- `SYNC_AUTH_TOKEN` — added as a Cloudflare Worker secret.

### New infrastructure
- Cloudflare R2 bucket: `iselodyhereyet-images` with public `r2.dev` access.

## Testing Decisions

Good tests for this project should test the external behavior of the Worker's `/sync` endpoint — given an input request, does it produce the correct output and side effects? Tests should not depend on internal implementation details like helper function signatures.

### Modules to test: Worker `/sync` endpoint
- **Authentication**: Requests without a valid bearer token are rejected with 403.
- **Input validation**: Malformed JSON or missing fields return appropriate errors.
- **Image URL rewriting**: Given HTML with local image references and a set of base64 images, the output HTML has `src` attributes pointing to R2 URLs.
- **R2 upload**: Images from the payload are uploaded to R2 with correct content types.
- **GitHub commit**: The final `notes.html` content is committed via the GitHub Contents API with the correct SHA flow.
- **Happy path end-to-end**: A valid request with HTML and images results in images on R2 and `notes.html` committed to GitHub.

### Modules NOT tested
- AppleScript (platform-dependent, manual verification)
- Shell sync script (thin orchestration layer, manual verification)
- launchd plist (system config, manual verification)
- `generateHtml` template change (trivial addition, verified by visual inspection)

## Out of Scope

- **Page styling/CSS** — Ship with browser defaults; revisit later if desired.
- **React or any frontend framework** — The client-side fetch is vanilla JS.
- **Custom domain for R2** — Using default `r2.dev` domain for image URLs.
- **Real-time/push updates** — The page requires a manual refresh to see new content.
- **Multiple notes support** — Only syncing the single "Is it Baby Time?" note.
- **Conflict resolution or locking** — Eliminated by the two-file architecture.
- **Image optimization/resizing** — Images are served as-is from R2.

## Task Status

| # | Task | Status |
|---|------|--------|
| 1 | Worker `/sync` endpoint (auth, validation, R2 upload, HTML rewrite, GitHub commit) | Done |
| 2 | Update `generateHtml` to include notes `<div>` and fetch script | Done |
| 3 | Tests for `/sync` endpoint | Done |
| 4 | AppleScript to extract note HTML and images | Done |
| 5 | Shell sync script with hash-based skip logic | Not Started |
| 6 | launchd plist for 5-minute scheduling | Not Started |
