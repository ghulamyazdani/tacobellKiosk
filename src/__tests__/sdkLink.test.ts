import { describe, expect, it } from "vitest";
import {
  KioskEventName,
  withTimeoutRetry,
  TimeoutError,
} from "@cx-sdk/core";
import CountryCodes from "@cx-sdk/core/data/CountryCodes";

describe("@cx-sdk link (cross-repo workspace source)", () => {
  it("resolves the core barrel export", () => {
    expect(KioskEventName.pageViewed).toBe("page_viewed");
    expect(Object.keys(KioskEventName).length).toBeGreaterThan(50);
  });

  it("resolves subpath exports", () => {
    expect(Array.isArray(CountryCodes)).toBe(true);
    expect(CountryCodes.length).toBeGreaterThan(100);
  });

  it("runs SDK logic: withTimeoutRetry resolves a successful attempt", async () => {
    const result = await withTimeoutRetry(async () => "ok", {
      timeoutMs: 1000,
      retries: 0,
    });
    expect(result).toMatchObject({ ok: true, data: "ok", attempts: 1 });
  });

  it("runs SDK logic: withTimeoutRetry times out and reports TimeoutError", async () => {
    const result = await withTimeoutRetry(
      () => new Promise<string>(() => {}),
      { timeoutMs: 20, retries: 0 }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(TimeoutError);
      expect(result.timedOut).toBe(true);
    }
  });
});
