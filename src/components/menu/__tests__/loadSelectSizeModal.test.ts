import { afterEach, describe, expect, it, vi } from "vitest";

/*
  Lane walk-oos — Select a Size's loader (loadPdpLazyParts' pattern): the
  code comes from the ONE lazy UI chunk; once it is in, every later menu has
  it at once; a load that fails is forgotten, so the next menu mount retries.
*/
describe("loadSelectSizeModal", () => {
  afterEach(() => {
    vi.doUnmock("../../cart/bagLazyParts");
    vi.resetModules();
  });

  it("loads the modal from the lazy UI chunk once, then hands it out at once", async () => {
    vi.resetModules();
    const { loadSelectSizeModal, loadedSelectSizeModal } = await import("../loadSelectSizeModal");
    const { default: SelectSizeModal } = await import("../SelectSizeModal");

    expect(loadedSelectSizeModal()).toBeNull();
    const first = loadSelectSizeModal();
    expect(loadSelectSizeModal()).toBe(first);
    expect(await first).toBe(SelectSizeModal);
    expect(loadedSelectSizeModal()).toBe(SelectSizeModal);
  }, 60_000);

  it("a chunk without the modal (a prevented preload error) resolves null and is retried by the next load", async () => {
    vi.resetModules();
    vi.doMock("../../cart/bagLazyParts", () => ({}));
    const { loadSelectSizeModal, loadedSelectSizeModal } = await import("../loadSelectSizeModal");

    const failed = loadSelectSizeModal();
    expect(await failed).toBeNull();
    expect(loadedSelectSizeModal()).toBeNull();
    expect(loadSelectSizeModal()).not.toBe(failed);
  });
});
