import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import useCurrencySymbol, { ltrCurrencySymbol } from "../useCurrencySymbol";

/*
  UB1 (2026-10-08): every price printed without a symbol because 17 sites read
  an invented `symbol` key. The backend's cx/kiosk/get_data sends
  `deployment.currencySettings = { currency, text, uniDec, uniHex }`; the one
  reader takes `text` and falls back to ₹ (the fork's getCurrency() rule).
*/

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>{children}</Provider>
);

const symbolFor = (currencySettings: unknown) => {
  store.dispatch(setCurrency(currencySettings));
  return renderHook(() => useCurrencySymbol(), { wrapper }).result.current;
};

describe("useCurrencySymbol (UB1)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it("reads `text` from the backend's exact INR body", () => {
    expect(
      symbolFor({ currency: "INR", text: "₹", uniDec: "8377", uniHex: "8377" }),
    ).toBe("₹");
  });

  it("reads `text` for any deployment currency (the fixtures' placeholder £)", () => {
    expect(symbolFor({ currency: "GBP", text: "£" })).toBe("£");
  });

  it.each([
    ["absent", undefined],
    ["the slice seed []", []],
    ["the legacy number 1", 1],
    ["an empty text", { text: "" }],
    ["null", null],
  ])("falls back to ₹ when currencySettings is %s", (_label, value) => {
    expect(symbolFor(value)).toBe("₹");
  });

  it("never reads the invented `symbol` key", () => {
    expect(symbolFor({ symbol: "£" })).toBe("₹");
    expect(symbolFor({ symbol: "£", currency_symbol: "£" })).toBe("₹");
  });

  it("the default store (nothing configured) shows ₹", () => {
    const { result } = renderHook(() => useCurrencySymbol(), { wrapper });
    expect(result.current).toBe("₹");
  });

  it("follows a later currency change", () => {
    const { result } = renderHook(() => useCurrencySymbol(), { wrapper });
    expect(result.current).toBe("₹");
    act(() => {
      store.dispatch(setCurrency({ currency: "AED", text: "AED " }));
    });
    expect(result.current).toBe("AED ");
  });

  it("always returns a string (a malformed text stays out of JSX)", () => {
    expect(symbolFor({ text: 7 })).toBe("7");
  });

  it("the Saudi body's ﷼ comes back between LRMs (ltrCurrencySymbol) — every price site reads this", () => {
    expect(symbolFor({ currency: "SAR", text: RIAL, uniDec: "65020", uniHex: "FDFC" })).toBe(`${LRM}${RIAL}${LRM}`);
  });
});

/*
  Walk 2026-10-14: U+FDFC RIAL SIGN is bidi class AL — "﷼100 | 254 Cal"
  painted as "254 | 100﷼ Cal", and a dir="auto" leaf starting with a price
  resolved RTL. An RTL symbol rides between two LRMs; LTR ones are untouched.
*/
const LRM = String.fromCharCode(0x200e);
/** The Saudi tenant's text, U+FDFC RIAL SIGN (a symbol, not AR copy: the bidi guard's exact-matcher rule is for copy). */
const RIAL = String.fromCharCode(0xfdfc);
const SAR_ABBREVIATION = "ر.س";

describe("ltrCurrencySymbol (walk 2026-10-14)", () => {
  it.each([
    ["the Saudi rial sign", "﷼"],
    ["an Arabic abbreviation with a dot", "ر.س"],
    ["the afghani sign", "؋"],
    ["a Hebrew word", "ש״ח"],
    ["an RTL symbol with a trailing space", "﷼ "],
  ])("%s is anchored between two LRMs", (_label, symbol) => {
    expect(ltrCurrencySymbol(symbol)).toBe(`${LRM}${symbol}${LRM}`);
  });

  it.each(["£", "₹", "$", "€", "₪", "AED ", "SAR", ""])("%j (no RTL letter) comes back byte-identical", (symbol) => {
    expect(ltrCurrencySymbol(symbol)).toBe(symbol);
  });

  it("is idempotent: an anchored symbol comes back as is", () => {
    const once = ltrCurrencySymbol(RIAL);
    expect(ltrCurrencySymbol(once)).toBe(once);
    expect(ltrCurrencySymbol(ltrCurrencySymbol(SAR_ABBREVIATION))).toBe(`${LRM}${SAR_ABBREVIATION}${LRM}`);
  });
});
