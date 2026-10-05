import { describe, expect, it } from "vitest";
import { readBootRefreshState } from "../bootRefresh";

/*
  P9e — the route state StartScreen hands /LoadingResources for a splash
  refresh. It lives in history.state (survives a reload) and the router does
  not type it, so only an exact { refresh: true, trigger } selects refresh
  mode; anything else is a NORMAL boot with the P9b retry ladder.
*/

describe("readBootRefreshState", () => {
  it.each(["brand", "scheduled", "operator"] as const)(
    "accepts { refresh: true, trigger: %s } and returns a fresh object without extra keys",
    (trigger) => {
      const state = { refresh: true, trigger, extra: 1 };

      const parsed = readBootRefreshState(state);

      expect(parsed).toStrictEqual({ refresh: true, trigger });
      expect(parsed).not.toBe(state);
    }
  );

  it.each([
    ["no state (a registration boot)", undefined],
    ["null", null],
    ["a number", 0],
    ["a string", "refresh"],
    ["a boolean", true],
    ["an array", []],
    ["an empty object", {}],
    ["refresh without a trigger", { refresh: true }],
    ["a trigger without refresh", { trigger: "brand" }],
    ['refresh as the string "true"', { refresh: "true", trigger: "brand" }],
    ["refresh as 1", { refresh: 1, trigger: "brand" }],
    ["refresh false", { refresh: false, trigger: "scheduled" }],
    ["an upper-case trigger", { refresh: true, trigger: "BRAND" }],
    ["an unknown trigger", { refresh: true, trigger: "cron" }],
    ["a null trigger", { refresh: true, trigger: null }],
    ["a non-string trigger", { refresh: true, trigger: 1 }],
    ["an array trigger", { refresh: true, trigger: ["brand"] }],
  ])("%s → null (normal boot)", (_label, state) => {
    expect(readBootRefreshState(state)).toBeNull();
  });
});
