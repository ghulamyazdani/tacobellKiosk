import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  Lane figma-polish G2(c) — loadPdpLazyParts, the PDP's one door to the lazy
  bag chunk. Concurrent callers share ONE import and a success is kept (so a
  later PDP has the parts in its first commit, loadedPdpParts); a failure — a
  rejected import, or one that resolves without the parts (a build's
  prevented vite:preloadError resolves empty) — is forgotten, so only the
  NEXT call imports again. The chunk is a controllable stand-in; each test
  takes a fresh loader module.
*/

const chunk = { mode: "fail" as "fail" | "empty" | "ok", evaluations: 0 };
const PARTS = {
  PdpIncompleteWarning: () => null,
  Tier2CustomizationSheet: () => null,
  planSplitEditCommit: () => null,
};

/** A fresh loader over a fresh stand-in chunk (re-evaluated until it succeeds). */
const freshLoader = async () => {
  vi.resetModules();
  vi.doMock("../../../components/cart/bagLazyParts", () => {
    chunk.evaluations += 1;
    if (chunk.mode === "fail") {
      throw new TypeError("Failed to fetch dynamically imported module: /assets/bagLazyParts-0ld.js");
    }
    return chunk.mode === "ok" ? PARTS : {};
  });
  return import("../loadPdpLazyParts");
};

describe("loadPdpLazyParts — one shared import, a kept success, a forgotten failure (G2c)", () => {
  beforeEach(() => {
    chunk.mode = "fail";
    chunk.evaluations = 0;
  });

  it("a rejected import answers null and is forgotten: the NEXT call imports again and keeps the parts", async () => {
    const { loadPdpLazyParts, loadedPdpParts } = await freshLoader();

    expect(await loadPdpLazyParts()).toBeNull();
    expect(loadedPdpParts()).toBeNull();

    chunk.mode = "ok";
    const parts = await loadPdpLazyParts();
    expect(parts).toStrictEqual(PARTS);
    expect(loadedPdpParts()).toBe(parts);
    expect(chunk.evaluations).toBe(2);
  });

  it("an import that resolves WITHOUT the parts is a failure too: null, nothing kept, and the next call starts a new load", async () => {
    chunk.mode = "empty";
    const { loadPdpLazyParts, loadedPdpParts } = await freshLoader();

    const first = loadPdpLazyParts();
    expect(await first).toBeNull();
    expect(loadedPdpParts()).toBeNull();
    expect(loadPdpLazyParts()).not.toBe(first);
  });

  it("concurrent callers join ONE import; once loaded every later call is that same settled load — never a re-import", async () => {
    chunk.mode = "ok";
    const { loadPdpLazyParts, loadedPdpParts } = await freshLoader();

    const first = loadPdpLazyParts();
    expect(loadPdpLazyParts()).toBe(first);
    const parts = await first;

    expect(loadPdpLazyParts()).toBe(first);
    expect(loadedPdpParts()).toBe(parts);
    expect(chunk.evaluations).toBe(1);
  });
});
