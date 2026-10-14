import { describe, expect, it } from "vitest";
import { moduloCalcaledValue } from "@cx-sdk/catalog/settings/settingsEngine";
import { formatPrice } from "../price";

/*
  User decision 2026-10-14: "use same function used in the posistKiosk for
  formatting the prices" — moduloCalcaledValue (posistKiosk
  useAppSettings.ts:293; the SDK settingsEngine copy). Walk: menu cards read
  "﷼0.5", "﷼5.5", "﷼100" beside "﷼100.00" on the PDP.
*/
describe("formatPrice — posistKiosk's moduloCalcaledValue", () => {
  it.each([
    [100, "100"],
    [0.5, "0.50"],
    [5.5, "5.50"],
    [5.59, "5.59"],
    [34.125, "34.13"],
    // roundTo's float-noise guard: 1.005 is 1.00499… as a double.
    [1.005, "1.01"],
    [0.1 + 0.2, "0.30"],
    ["8", "8"],
    ["5.5", "5.50"],
    [0, "0"],
    [-2.5, "-2.50"],
  ])("%s → %s", (value, expected) => {
    expect(formatPrice(value)).toBe(expected);
  });

  it("matches the SDK function on every numeric input", () => {
    for (const value of [0, 1, 2.5, 10.1, 99.999, 123.456]) {
      expect(formatPrice(value)).toBe(String(moduloCalcaledValue(value)));
    }
  });

  it.each([[undefined], [null], [""], ["abc"], [Number.NaN]])(
    "a missing or non-numeric price (%s) reads 0 — never 'null' / 'NaN' in a template",
    (value) => {
      expect(formatPrice(value)).toBe("0");
    },
  );
});
