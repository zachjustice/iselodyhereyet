# PRD: Domino's-Style Pizza Tracker for Baby Arrival Status

## Problem Statement

The current "Is Elody Here Yet?" website displays a plain, unstyled heading and paragraph with the baby's arrival status. Visitors have no visual sense of progress — they see a text status and a timestamp, with no indication of where things stand in the overall journey. The site needs a richer, more engaging way to communicate labor/delivery progress to anxious friends and family.

## Solution

Replace the existing `<h1>` and `<p>` status elements with a faithful visual clone of the Domino's Pizza Tracker. The tracker will display 5 stages of baby arrival progress as an interactive, animated progress bar. The Cloudflare Worker will be updated to commit a `status.json` file (instead of regenerating `index.html`), and the static `index.html` will fetch and render that data client-side, polling every 30 seconds for updates.

## User Stories

1. As a visitor, I want to see a Domino's-style progress tracker on the page, so that I can visually understand how far along the baby arrival process is.
2. As a visitor, I want to see completed stages marked with green checkmarks, so that I know which milestones have passed.
3. As a visitor, I want to see the active stage pulsing/glowing, so that I know which stage is currently in progress.
4. As a visitor, I want to see a green progress fill between completed stages, so that I get a clear sense of overall progress.
5. As a visitor, I want to see stage labels (Waiting, Hosptial, Labor, Delivery, She's Here!), so that I understand what each stage means.
6. As a visitor, I want the tracker to be horizontal on desktop/tablet, so that it matches the Domino's desktop experience.
7. As a visitor, I want the tracker to be vertical on mobile, so that it matches the Domino's mobile experience and is easy to read on small screens.
8. As a visitor, I want to see a "Last Updated" timestamp below the tracker, so that I know how recent the status is.
9. As a visitor, I want the page to automatically poll for updates every 30 seconds, so that I don't have to manually refresh to see new status.
10. As a visitor, I want to see a loading widget while the status data is being fetched, so that I know the page is working and not broken.
11. As a visitor, I want the page to still show the baby emoji favicon and title, so that the page identity is preserved.
12. As the site operator, I want to text a number 1-5 to update the tracker stage, so that I can quickly update status during labor without fiddling with an app.
13. As the site operator, I want to re-send the same stage number to refresh the "Last Updated" timestamp, so that visitors know I'm still actively updating.
14. As the site operator, I want non-numeric or out-of-range SMS messages to be rejected with an error response, so that I get feedback when I send an invalid update.
15. As the site operator, I want the worker to commit a `status.json` file instead of regenerating HTML, so that the presentation layer is decoupled from the data layer.
16. As the site operator, I want the `index.html` to be deployed once and remain static, so that I can iterate on the UI without modifying the worker.

## Implementation Decisions

- **Data contract:** The worker commits a `status.json` file to the repo with the structure `{ "stage": <1-5>, "lastUpdated": "<formatted timestamp>" }`. The frontend reads this file.
- **Worker changes:** The worker parses the SMS body as an integer 1-5. Valid stage numbers update `status.json`. Invalid messages (non-numeric, out of range) are rejected with a TwiML error response. The worker no longer generates HTML.
- **Worker config:** `GITHUB_FILE_PATH` changes from `index.html` to `status.json`.
- **Frontend architecture:** `index.html` is a self-contained static file with inline CSS and JS. JS fetches `status.json` on load and every 30 seconds thereafter. The tracker is re-rendered on each successful fetch.
- **5 stages:** (1) Waiting, (2) Hospital, (3) Labor, (4) Delivery, (5) She's Here!
- **Visual design:** Faithful Domino's Pizza Tracker clone — dark charcoal/black background bar, green progress fill, circular stage markers, checkmarks on completed stages, pulsing/glowing animation on the active stage.
- **Responsive layout:** Horizontal tracker on desktop/tablet, vertical tracker on mobile, matching Domino's responsive behavior.
- **Loading state:** A loading widget/spinner is displayed while `status.json` is being fetched. The tracker renders once data is available.
- **CSS animations:** Pulsing/glowing effect on the active stage via CSS `@keyframes`. Green fill transitions via CSS. JS is used only for data fetching, polling, and DOM updates.
- **Polling:** JS polls `status.json` every 30 seconds using `setInterval` + `fetch`. Cache-busting query parameter to avoid stale GitHub Pages cache.
- **Timestamp styling:** "Last Updated" timestamp displayed as small, muted text below the tracker.

## Testing Decisions

- Good tests verify external behavior through the module's public interface, not implementation details.
- **Worker tests:**
  - Valid stage numbers (1-5) produce correct JSON output and commit to GitHub
  - Re-sending the same stage number updates the timestamp but keeps the same stage
  - Invalid inputs (non-numeric, 0, 6, -1, empty, freeform text, decimal) are rejected with appropriate TwiML error responses
  - Twilio signature validation still works correctly
  - Phone number allowlist still works correctly
- Frontend is pure presentation + fetch — no unit tests planned. Visual correctness will be verified manually.

## Out of Scope

- Auto-refresh via WebSockets or Server-Sent Events — polling is sufficient
- Push notifications for status changes
- Authentication or access control on the website
- Analytics or visitor tracking
- Any backend changes beyond the Cloudflare Worker modifications described above

## Task Status

| # | Task | Status |
|---|------|--------|
| 1 | Update Worker SMS handler to parse stage 1-5, commit `status.json`, reject invalid input | Done |
| 2 | Worker tests for new SMS behavior | Done |
| 3 | Create static `index.html` with Domino's-style pizza tracker UI | Done |
| 4 | Create initial `status.json` with stage 1 (Waiting) | Done |

---

## Issue #3: Replicate Domino's Pizza Tracker UI

See [GitHub issue #3](https://github.com/zachjustice/iselodyhereyet/issues/3) for full spec.

### Task Status

| # | Task | Status |
|---|------|--------|
| 1 | Redesign `index.html` with Domino's brand colors, layout, animations, and structure | Done |

---

## Issue #4: Web Push Notifications on Status Change

See [GitHub issue #4](https://github.com/zachjustice/iselodyhereyet/issues/4) for full spec.

### Task Status

| # | Task | Status |
|---|------|--------|
| 1 | Add KV namespace binding + `POST /subscribe` endpoint on Worker + tests | Done |
| 2 | Implement push notification sending from SMS handler (stage change only) + tests | Done |
| 3 | Create service worker (`sw.js`) + PWA manifest (`manifest.json`) | Done |
| 4 | Add subscribe UI to `index.html` (button + iOS PWA guidance) | Done |
| 5 | Generate VAPID keys, create KV namespace, and deploy (`worker/scripts/setup-push.sh`) | Done |

---

## Issue #5: Instant UI Update from Push Notifications with updatedAt Timestamp

See [GitHub issue #5](https://github.com/zachjustice/iselodyhereyet/issues/5) for full spec.

### Task Status

| # | Task | Status |
|---|------|--------|
| 1 | Worker + frontend + tests: change `status.json` schema to `updatedAt` epoch, include `stage`/`updatedAt` in push payload, delete `formatEasternTimestamp`, add `formatTimestamp` client-side, direct push render, staleness guard in `fetchStatus` | Done |

---

## Issue #6: Add Rotating Fun Facts Card with Countdown Timer

See [GitHub issue #6](https://github.com/zachjustice/iselodyhereyet/issues/6) for full spec.

### Task Status

| # | Task | Status |
|---|------|--------|
| 1 | Create `fun_facts.json` and add fun facts card to `index.html` (HTML, CSS, JS — cycling, crossfade, countdown ring, session persistence, 15-min re-fetch) | Done |

---

## Issue #8: Refactor Frontend to React + Tailwind v4

See [GitHub issue #8](https://github.com/zachjustice/iselodyhereyet/issues/8) for full spec.

### Task Status

| # | Task | Status |
|---|------|--------|
| 1 | Project scaffolding: Create `frontend/` with Vite + React + TypeScript + Tailwind v4, basic App component, all component stubs, hooks, types, data files, Vitest setup, smoke test | Done |
| 2 | Hook tests: `useStatus`, `useFunFacts`, `useNotifications`, `useTabNotification` — full test coverage per PRD testing decisions | Pending |
| 3 | Service worker rewrite in TypeScript, built through Vite, output to `/sw.js` | Pending |
| 4 | GitHub Action: `.github/workflows/deploy.yml` — build React app, copy `status.json` + `CNAME`, deploy to GitHub Pages | Pending |
| 5 | Final styling pass: ensure visual parity with current `index.html` using Tailwind utilities | Pending |
| 6 | Remove old root-level `index.html`, `fun_facts.json`, `manifest.json`, `icons/`, `sw.js` after React app is deployed | Pending |
