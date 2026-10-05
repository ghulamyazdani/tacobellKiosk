# tacobell-kiosk

Taco Bell self-service kiosk (1080×1920 portrait), built on the shared
`@cx-sdk/*` packages linked from the sibling `posistKiosk-cx-sdk` checkout.

## Prerequisites
- Node ≥ 20.19 (`.nvmrc`), yarn 1.22
- The sibling repo checked out at `../posistKiosk-cx-sdk` (the `link:`
  dependencies resolve into its `packages/` — raw TS source, no build step)
- `.env.development` created from `.env.example`

## Commands
| Command | What |
|---|---|
| `yarn dev` | Vite dev server on **5373** (strict port) |
| `yarn validate` | lint + type-check + guardrails + depcruise + dep-check + unit tests |
| `yarn test` / `test:e2e` | vitest / Playwright (1080×1920) |
| `yarn build` | `tsc -b` (app + SDK refs) + Vite build + PWA |

See `CLAUDE.md` for repo rules; the UI source of truth is the client Figma
file `33e5briUYJiBqxv6P0AbqY`.
