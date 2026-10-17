# Sivry — working notes for Claude

Personal news app that shows only **primary sources** (governments, companies, research bodies, NPOs). Read `PRODUCT.md` (principles) and `BACKLOG.md` (decisions, market view) before proposing features.
Live: https://ty-knowgic.github.io/sivry-app/ (GitHub Pages; "Publish Sivry" workflow runs on push and every ~3 h).

## Layout
- `src/` Express + TypeScript server and shared logic (profile matching, pipeline, robots, vectors). `src/browser/main.ts` is the in-browser API used by the static site (bundled to `static-api.js`).
- `public/` static UI (`app.js`, `i18n.js`, `sync.js`, `legal.html`, `locales/*.json`). `site/` is the gitignored build output.
- `scripts/` checks and tests. `.github/workflows/publish.yml` runs them in CI.

## Before every commit (all must pass)
`npx tsc --noEmit` · `npm run check:locales` · `npm run test:xss` · `npm run test:sync` · `npm run test:visit` · `npm run test:onboarding` · `npm run build:site`

## Conventions that bite
- **i18n**: the Japanese text is the key. Every new UI string needs an entry in all 12 other `public/locales/*.json` (`check:locales` fails otherwise). New source names go in `locales/sources.json`.
- **Python edits**: use files, not stdin heredocs with non-ASCII (macOS python 3.9 mangles long lines): write the script to the scratchpad and run it with `exec(compile(open(f, encoding='utf-8').read(), f, 'exec'))`. No `sed -i` (macOS BSD sed).
- jsdom tests: `const`/`let` in `app.js` are invisible to `window.eval`; expose what a test needs via `window.__t`.
- Static build is cached 10 min by GitHub Pages: asset URLs carry `?v=<sha>`.
- CSP is a meta tag in `public/index.html`: any new external host must be added deliberately and justified in the privacy page.

## Decisions already made (don't reopen without being asked)
- User settings live **only on the client**. No server-side user data, no accounts, **no email digest**. Cross-device = copy/paste, or optional Google Drive appDataFolder sync (needs `CLIENT_ID` in `public/sync.js`).
- No human reviewers or experts for QA — do review/QA myself and say what I couldn't verify.
- Primary sources only: no media feeds, no SNS. Honest crawler identity `SivryBot`; obey robots.txt; don't work around 403s.
- Never reset the user's saved profile in tests; don't leave local servers running (the user tests on GitHub).
- **Ask before `git push`** (and before anything outward-facing: labels, issues, publishing).

## Working style / token budget
- Be concise; lead with the result. Don't re-derive settled facts; don't narrate options not pursued.
- Keep one session on one theme. At a natural milestone (a pushed + verified change), suggest `/compact` or a fresh session rather than letting context grow. Re-read files instead of relying on stale memory.
- Prefer targeted reads (offset/limit, grep) over whole-file reads of `public/app.js` (~1800 lines) and `src/newsPipeline.ts`.
- Spawn subagents only when the user asks.
- Save durable lessons to memory; don't repeat what the repo already records.

## gstack (installed at `~/.claude/skills`, not in this repo)
Use these deliberately, one per task, not all at once:
- `/qa` or `/browse` — real-browser check of the live site (dark mode, iPhone width, CSP console errors, first-run flow).
- `/review` — review the diff before a risky push. `/cso` — security audit (CSP, sync, supply chain).
- `/design-review` — visual polish. `/plan-eng-review` — before a big feature. `/office-hours` — product/market questions.
- `/ship`, `/land-and-deploy` — only if the user asks; this repo deploys by pushing `main`.
