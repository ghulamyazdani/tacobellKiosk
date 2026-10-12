import { describe, expect, it } from "vitest";
import { resolveCustomizationReturnPath } from "../customizationReturn";

describe("resolveCustomizationReturnPath", () => {
  it("an explicit returnPath wins over direction (the SDK add intent's detour return)", () => {
    expect(resolveCustomizationReturnPath({ direction: "cart", returnPath: "/menu" })).toBe("/menu");
  });

  it("without one, direction decides: cart → /cart, anything else → /menu", () => {
    expect(resolveCustomizationReturnPath({ direction: "cart" })).toBe("/cart");
    expect(resolveCustomizationReturnPath(null)).toBe("/menu");
  });
});
