/**
 * The app origin under test. 5373 by default (CLAUDE.md rule 5 — 5173/5273
 * belong to other Restroworks apps); TB_E2E_PORT lets a parallel worktree lane
 * run its own dev server on another port.
 */
export const E2E_PORT = Number(process.env.TB_E2E_PORT) || 5373;
export const APP_ORIGIN = `http://localhost:${E2E_PORT}`;
