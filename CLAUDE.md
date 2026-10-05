# CLAUDE CODE — TACO BELL KIOSK (tacobell-kiosk)

Taco Bell-branded self-service kiosk. Second web shell over the shared
`@cx-sdk/{core,catalog,ordering,payments,devices}` packages, which are linked
from the sibling checkout `../posistKiosk-cx-sdk/packages/*` (yarn `link:`,
raw TS source, no build step). UI is implemented EXCLUSIVELY from the client
Figma design (file `33e5briUYJiBqxv6P0AbqY`) — 1080×1920 portrait.

The full kiosk rulebook of posistKiosk applies here unchanged — read
`../posistKiosk-cx-sdk/CLAUDE.md` for Rules 1–5 (flow integrity, never
crash/hang, state integrity, code quality, hardware awareness), the 6-step
task workflow, ask-first testing/commits, and the Claude-in-Chrome protocol.
This file only records what DIFFERS in this repo:

## Repo-specific rules

1. **Business logic lives in the SDK, not here.** New domain logic goes into
   `../posistKiosk-cx-sdk/packages/*` (its own repo rules apply there). This
   repo holds: UI components/pages, thin hook wrappers, UI slices, platform
   adapters, routing, i18n. dependency-cruiser enforces: no relative imports
   into the sibling repo (use `@cx-sdk/<pkg>/...`), no cycles (error — this
   repo has NO legacy ratchet).
2. **No legacy allowances.** Full-strict tsconfig, zero-warning ESLint, real
   coverage thresholds. Never add a ratchet/downgrade block.
3. **UI fidelity.** Screens come from the Figma frames — the canonical
   node-ID map, design tokens, and the mandatory pull process live in
   `docs/FIGMA_UI_GUIDE.md`. Follow that process for every new surface and
   update its frame-map status when a screen lands. Screens without a Figma
   frame are built in the same design language and flagged for client
   sign-off in the task summary.
4. **Theming contract.** Brand colors flow through `--brand-*` CSS vars set at
   runtime by useFetchColors (fallbacks in src/index.css are mandatory).
   Static TB design tokens are Tailwind 4 `@theme` tokens (`tb-*`).
5. **Ports and modes.** Dev server + Playwright: port **5373** (`--strictPort`).
   5173/5273 belong to other Restroworks apps — never reuse them.
6. **Env discipline.** `.env.*` is gitignored; `.env.example` documents every
   key. Never commit real endpoints/keys. `VITE_POST_HOG_TYPE === "production"`
   is the analytics kill switch.
7. **PWA trap.** If an image-optimizer plugin is ever added AND the manifest
   icon is a PNG, the icon MUST be excluded from optimization — hash mismatch
   in the precache manifest silently disables the ENTIRE service worker.
8. **Boot order is load-bearing** (once P1 lands): installChunkErrorRecovery()
   first, setAnalyticsPort() before render, apiSlice imported only via
   `src/redux/app/apiSlice.ts` (transport config side effect).

9. **Keep `docs/PROGRESS.md` current.** It is the project's living tracker
   (phase status, deferred items, open decisions, engineering notes, session
   log). ANY completed or descoped work item MUST be reflected there in the
   same working session — a step is not "done" until the tracker says so.

## Commands

`yarn dev` (5373) · `yarn validate` (lint + type-check + guardrails +
depcruise + check-deps + unit tests) · `yarn test:e2e` · `yarn build` ·
`yarn guardrails:strict` · `yarn check-bundle-size`
