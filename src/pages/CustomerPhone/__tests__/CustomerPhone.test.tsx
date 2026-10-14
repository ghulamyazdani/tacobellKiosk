import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import {
  setKioskSettings,
  toggleAccessibilityMode,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { setLoyaltyPartner } from "@cx-sdk/ordering/state/loyalty.slice";
import { setPhoneNumberRdx } from "@cx-sdk/core/customer/customerInfo.slice";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { store } from "../../../redux/app/store";
import { notePath } from "../../../hooks/utils/usePageEnter";
import CustomerPhone from "../index";
import i18n from "../../../i18n";

/*
  P9a (D10, Rule 1): the check_loyalty_balance continuation dispatches and
  navigates after its await. Once /phone is gone (Back, Skip, Cancel, idle ->
  /start) it must do neither — it would yank the kiosk off whatever screen it
  is on and open the rewards sheet for the NEXT customer. useLoyalty is the
  seam (its own late-write guard is covered in useLoyalty.test); useNavigate
  is a spy.
*/

const mockNavigate = vi.fn();
const mockExecuteLoyalty = vi.fn();
const { mockCapture, loyaltyHook } = vi.hoisted(() => ({
  mockCapture: vi.fn(),
  /** useLoyalty's isLoyaltyEventLoading (a lookup in flight). */
  loyaltyHook: { loading: false },
}));

vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mockCapture(...args),
}));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mockNavigate,
}));

vi.mock("../../../hooks/loyalty/useLoyalty", () => ({
  default: () => ({
    executeLoyalty: (...args: unknown[]) => mockExecuteLoyalty(...args),
    isLoyaltyEventLoading: loyaltyHook.loading,
  }),
}));

const XENO = {
  partner: { partner_name: "Xeno", partner_merchant_id: "xeno-merchant-uuid-1" },
  partnerDetails: { partner_name: "Xeno" },
};

/** A Xeno customer with something to redeem → the rewards sheet opens. */
const REWARDS = {
  status_code: 200,
  response: { coupons: [{ coupon_code: "static6562" }], loyalty_points: 3000 },
};

const rewardsSheetOpen = () =>
  (store.getState() as { loyalty: { loyaltyItemsModal: { isOpen: boolean } } })
    .loyalty.loyaltyItemsModal.isOpen;

const mount = (state?: { checkoutRoute: string }) =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[{ pathname: "/phone", state }]}>
        <CustomerPhone />
      </MemoryRouter>
    </Provider>
  );

/** CONTINUE with a valid number; the lookup stays in flight until settled. */
const continueWithLookupInFlight = () => {
  let settle!: { answer: (r: unknown) => void; fail: (e: unknown) => void };
  mockExecuteLoyalty.mockReturnValue(
    new Promise((resolve, reject) => {
      settle = { answer: resolve, fail: reject };
    })
  );
  act(() => {
    fireEvent.click(screen.getByTestId("phone-continue"));
  });
  expect(mockExecuteLoyalty).toHaveBeenCalledTimes(1);
  const flush = (fn: () => void) =>
    act(async () => {
      fn();
      await Promise.resolve();
      await Promise.resolve();
    });
  return {
    answer: (r: unknown) => flush(() => settle.answer(r)),
    fail: (e: unknown) => flush(() => settle.fail(e)),
  };
};

describe("CustomerPhone — a late lookup never navigates (P9a, D10)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setKioskSettings({ enable_loyalty: true }));
    store.dispatch(setLoyaltyPartner(XENO));
    // Ten digits for the default IN country (min = max = 10).
    store.dispatch(setPhoneNumberRdx("9876543210"));
    mockNavigate.mockReset();
    mockExecuteLoyalty.mockReset();
  });

  it("answered while /phone is up: opens the rewards sheet and continues to the menu", async () => {
    mount();
    const lookup = continueWithLookupInFlight();

    await lookup.answer(REWARDS);

    expect(rewardsSheetOpen()).toBe(true);
    expect(mockNavigate).toHaveBeenCalledWith("/menu");
  });

  it("answered after the customer left: no rewards sheet, no navigation", async () => {
    const view = mount();
    const lookup = continueWithLookupInFlight();

    view.unmount();
    await lookup.answer(REWARDS);

    expect(rewardsSheetOpen()).toBe(false);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("failed after the customer left: no navigation either", async () => {
    const view = mount();
    const lookup = continueWithLookupInFlight();

    view.unmount();
    await lookup.fail(new Error("loyalty proxy 502"));

    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe("CustomerPhone placeholder (P9f contrast)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it("the empty-number placeholder is 55 % black (35 % was 2.43:1)", () => {
    mount();

    const placeholder = screen.getByText(i18n.t("phone.placeholder"));
    expect(placeholder).toHaveClass("text-black/55");
    expect(placeholder).not.toHaveClass("text-black/35");
  });

  it("the start screen's backdrop: the texture tiles and the 50 % plastic sheen, stage-registered (user 2026-10-14)", () => {
    mount();

    const backdrop = screen.getByTestId("phone-backdrop");
    expect(backdrop.style.backgroundImage).toContain("bg-texture");
    expect(backdrop.style.backgroundSize).toBe("240px 240px");
    expect(backdrop).toHaveClass("bottom-0", "h-[1920px]", "w-[1080px]");
    const sheen = screen.getByTestId("phone-sheen");
    expect(sheen.getAttribute("src")).toContain("plastic-overlay");
    expect(sheen).toHaveClass("opacity-50", "pointer-events-none", "bottom-0", "h-[1920px]");
    // Painted first: every control stacks above the two layers.
    const root = screen.getByTestId("phone-screen");
    expect(root.children[0]).toBe(backdrop);
    expect(root.children[1]).toBe(sheen);
  });
});

/*
  audit-fixes A3 (F34): in CHECKOUT mode the guest has a bag, so CANCEL ORDER
  asks first (CancelOrderModal, Figma 1:4552). NO keeps the screen; YES ONLY
  navigates to /start — /start's mount revokes and resets (H1), so this screen
  never touches the store. Pre-menu /phone keeps the direct exit (an empty
  bag, like /second — D-A3-1).
*/
describe("CustomerPhone — CANCEL ORDER (A3)", () => {
  const BURGER = { id: "cb", itemId: "cb-1", name: "Cheese Burger", quantity: 1, type: "ITEM", total_price: 8 };
  const cartRows = () => (store.getState() as { cart: { cartItems: unknown[] } }).cart.cartItems;

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCartItems([BURGER]));
    mockNavigate.mockReset();
  });

  it("checkout mode: CANCEL ORDER opens the confirm and navigates nowhere", async () => {
    mount({ checkoutRoute: "phone" });

    await userEvent.click(screen.getByTestId("footer-cancel"));

    expect(screen.getByTestId("cancel-order-modal")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("checkout mode: NO closes the confirm and stays on /phone with the bag", async () => {
    mount({ checkoutRoute: "phone" });
    await userEvent.click(screen.getByTestId("footer-cancel"));

    await userEvent.click(screen.getByTestId("cancel-order-cancel"));

    expect(screen.queryByTestId("cancel-order-modal")).toBeNull();
    expect(screen.getByTestId("phone-screen")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(cartRows()).toHaveLength(1);
  });

  it("checkout mode: YES only navigates to /start — the store is untouched (H1: /start's mount resets)", async () => {
    mount({ checkoutRoute: "phone" });
    await userEvent.click(screen.getByTestId("footer-cancel"));
    const dispatch = vi.spyOn(store, "dispatch");

    await userEvent.click(screen.getByTestId("cancel-order-confirm"));

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("/start");
    expect(dispatch).not.toHaveBeenCalled();
    expect(cartRows()).toEqual([BURGER]);
    dispatch.mockRestore();
  });

  it("pre-menu: CANCEL ORDER goes straight to /start (no confirm)", async () => {
    mount();

    await userEvent.click(screen.getByTestId("footer-cancel"));

    expect(screen.queryByTestId("cancel-order-modal")).toBeNull();
    expect(mockNavigate).toHaveBeenCalledWith("/start");
  });
});

/*
  audit-fixes UB5: the "+91" pill opens the country picker. A pick stores
  {…, picked: true}; the keypad cap, the length check and the lookup's
  country code follow it; the typed digits stay (fork parity); the keypad
  ignores a leading 0.
*/
describe("CustomerPhone — the country picker (UB5)", () => {
  const UAE = { code: "AE", dialCode: "+971", min: 9, max: 9, picked: true };
  const country = () =>
    (store.getState() as { auth: { selectedCountryCode: unknown } }).auth.selectedCountryCode;
  const globalError = () =>
    (store.getState() as { appSettings: { errorMessageGlobal: string } }).appSettings
      .errorMessageGlobal;

  const typeDigits = async (digits: string) => {
    for (const digit of digits) {
      await userEvent.click(screen.getByTestId(`numpad-key-${digit}`));
    }
  };

  // The sheet rides the ONE lazy chunk, which the /phone mount starts
  // loading; transforming it the first time takes longer than findBy's 1 s.
  beforeAll(async () => {
    await import("../../../components/cart/bagLazyParts");
  }, 30_000);

  /** Pill → sheet (its lazy chunk loads at the /phone mount) → search → row. */
  const pickUae = async () => {
    await userEvent.click(screen.getByTestId("phone-country-code"));
    const sheet = await screen.findByTestId("country-sheet");
    const keyboard = within(within(sheet).getByTestId("kiosk-keyboard"));
    for (const key of "emir") {
      await userEvent.click(keyboard.getByRole("button", { name: key }));
    }
    await userEvent.click(within(sheet).getByTestId("country-AE"));
  };

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setKioskSettings({ enable_loyalty: true }));
    store.dispatch(setLoyaltyPartner(XENO));
    mockNavigate.mockReset();
    mockExecuteLoyalty.mockReset();
    mockExecuteLoyalty.mockResolvedValue(REWARDS);
    mockCapture.mockReset();
  });

  it("the pill is a named button (phone.changeCountry) that opens the sheet and reports the tap", async () => {
    mount();

    const pill = screen.getByRole("button", {
      name: i18n.t("phone.changeCountry", { dialCode: "+91" }),
    });
    expect(pill).toHaveAttribute("data-testid", "phone-country-code");
    expect(pill).toHaveAttribute("aria-haspopup", "dialog");
    expect(pill).toHaveTextContent("+91");

    await userEvent.click(pill);

    expect(await screen.findByTestId("country-sheet")).toBeInTheDocument();
    expect(mockCapture).toHaveBeenCalledWith("country_code_selection_clicked", {
      current_country_code: "+91",
    });
  });

  it("picking the UAE stores it with picked:true and the pill follows", async () => {
    mount();

    await pickUae();

    expect(country()).toEqual(UAE);
    expect(screen.queryByTestId("country-sheet")).toBeNull();
    expect(screen.getByTestId("phone-country-code")).toHaveTextContent("+971");
    expect(screen.getByTestId("phone-country-code")).toHaveAccessibleName(
      i18n.t("phone.changeCountry", { dialCode: "+971" })
    );
  });

  it("the pill shows the selected country's round flag before the dial code, follows a pick, and stays named by its label", async () => {
    mount();
    const pill = () => screen.getByTestId("phone-country-code");
    const flag = () => pill().firstElementChild as HTMLElement;

    expect(flag()).toHaveAttribute("aria-hidden", "true");
    expect(flag()).toHaveClass("rounded-full");
    expect(flag().querySelector("img")).toHaveAttribute("src", "/flags/in.png");
    expect(flag().querySelector("img")).toHaveAttribute("alt", "");
    expect(flag().nextElementSibling).toHaveTextContent("+91");

    await pickUae();

    expect(flag().querySelector("img")).toHaveAttribute("src", "/flags/ae.png");
    expect(pill()).toHaveAccessibleName(i18n.t("phone.changeCountry", { dialCode: "+971" }));
  });

  it("a flag that failed shows its code; the next pick tries its own flag again", async () => {
    mount();
    const flag = () => screen.getByTestId("phone-country-code").firstElementChild as HTMLElement;

    fireEvent.error(flag().querySelector("img") as HTMLImageElement);
    expect(flag().querySelector("img")).toBeNull();
    expect(flag()).toHaveTextContent(/^IN$/);
    expect(screen.getByTestId("phone-country-code")).toHaveAccessibleName(
      i18n.t("phone.changeCountry", { dialCode: "+91" })
    );

    await pickUae();

    expect(flag().querySelector("img")).toHaveAttribute("src", "/flags/ae.png");
  });

  it("the keypad caps at the UAE's 9 digits and 8 digits get the exact-length error", async () => {
    mount();
    await pickUae();

    await typeDigits("5012345678");
    await userEvent.click(screen.getByTestId("phone-visibility"));
    expect(screen.getByTestId("phone-number-display")).toHaveTextContent("501234567");

    await userEvent.click(screen.getByTestId("numpad-backspace"));
    await userEvent.click(screen.getByTestId("phone-continue"));
    expect(globalError()).toBe(i18n.t("phone.exactDigits", { digits: 9 }));
    expect(mockExecuteLoyalty).not.toHaveBeenCalled();
  });

  it("CONTINUE looks the number up with the picked country code", async () => {
    mount();
    await pickUae();

    await typeDigits("501234567");
    await act(async () => {
      fireEvent.click(screen.getByTestId("phone-continue"));
    });

    expect(mockExecuteLoyalty).toHaveBeenCalledWith({
      countryCode: "+971",
      phoneNumber: "501234567",
    });
    expect(mockCapture).toHaveBeenCalledWith(
      "phone_number_entered",
      expect.objectContaining({ country_code: "+971", phone_length: 9 })
    );
  });

  it("the typed digits survive a country change (fork parity)", async () => {
    mount();
    await typeDigits("98765");

    await pickUae();

    await userEvent.click(screen.getByTestId("phone-visibility"));
    expect(screen.getByTestId("phone-number-display")).toHaveTextContent("98765");
  });

  it("the keypad ignores a leading 0 (a trunk prefix) and keeps later zeros", async () => {
    mount();

    await typeDigits("0501");
    await userEvent.click(screen.getByTestId("phone-visibility"));

    // Exact: toHaveTextContent("501") is a substring match, so "0501" passed it too.
    expect(screen.getByTestId("phone-number-display").textContent).toBe("501");
  });
});

/*
  Lane motion (§2.3 / §2.7). The root's data-enter is latched at mount: none
  on a page load (POP), fwd on a PUSH, back on a PUSH to a screen already on
  the session trail (AppRoutes' notePath; seeded here). Only the content
  blocks carry tb-enter [--i]; BACK, the bell and the footer never move.
*/
describe("CustomerPhone — the route entrance (lane motion)", () => {
  /** A PUSH from another route: <Navigate> fires after the first commit. */
  const mountPushed = () =>
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/from"]}>
          <Routes>
            <Route path="/from" element={<Navigate to="/phone" />} />
            <Route path="/phone" element={<CustomerPhone />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );
  const root = () => screen.getByTestId("phone-screen");

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    notePath("/start");
  });

  it("a page load (POP) mounts still; a PUSH arrives fwd; a PUSH back to a visited /phone arrives back", () => {
    const pop = mount();
    expect(root()).not.toHaveAttribute("data-enter");
    pop.unmount();

    const pushed = mountPushed();
    expect(root()).toHaveAttribute("data-enter", "fwd");
    pushed.unmount();

    notePath("/phone");
    notePath("/customerName");
    mountPushed();
    expect(root()).toHaveAttribute("data-enter", "back");
  });

  it("tb-enter [--i] on the title, copy, entry row, keypad and SKIP (0–4) — never CONTINUE / BACK (chrome, as /tent's pair) or the footer", () => {
    mountPushed();
    const blocks = [...root().querySelectorAll(".tb-enter")];
    expect(blocks.map((block) => block.className.match(/\[--i:(\d+)\]/)?.[1])).toEqual(["0", "1", "2", "3", "4"]);
    expect(blocks[0]).toBe(screen.getByRole("heading", { level: 1 }));
    expect(blocks[2]).toContainElement(screen.getByTestId("phone-number-display"));
    expect(blocks[3]).toContainElement(screen.getByTestId("kiosk-numpad"));
    expect(blocks[4]).toBe(screen.getByTestId("phone-skip"));
    for (const id of ["phone-continue", "phone-back", "footer-cancel"]) {
      expect(screen.getByTestId(id).closest(".tb-enter")).toBeNull();
    }
  });
});

/*
  Layout (user 2026-10-14: "the continue and back button should be at the
  bottom just like table screen and also content should be at the middle").
  CONTINUE / BACK are /tent's CONFIRM / NO THANKS classes, bottom-anchored on
  /phone's footer (/tent has none): CONTINUE 1648, BACK 1756, footer 1864 —
  the same stage px in the ADA zone, which is bottom-aligned with the stage.
  The rest is one flex column centred between the bell and CONTINUE, 24px
  off each (248–1624; ADA, no bell: 0–826 of the zone), so it sits as far
  under the bell as above CONTINUE, as /tent's does (geometry measured in
  tests/e2e/phoneLayout.spec.ts).
*/
describe("CustomerPhone — the bottom pair and the centred block (user 2026-10-14)", () => {
  /** tent-confirm / tent-skip's classes, minus their slot. */
  const CONFIRM_LOOK = "tb-display absolute left-[24px] h-[84px] w-[1032px] rounded-[8px] bg-tb-surface text-center text-[24px] leading-[20px] text-tb-purple shadow-[0_20px_40px_rgba(0,0,0,0.15)]";
  const SKIP_LOOK = "tb-display absolute left-[24px] h-[84px] w-[1032px] rounded-[8px] border border-tb-surface text-center text-[24px] leading-[20px] text-tb-surface";
  const classes = (id: string) => screen.getByTestId(id).className.split(/\s+/);
  const bell = () => screen.queryByRole("img", { name: "Taco Bell" });
  const block = () => screen.getByTestId("phone-content");

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setKioskSettings({ crm_phone_mandatory: false, crm_name_mandatory: false }));
  });

  afterEach(() => {
    loyaltyHook.loading = false;
  });

  for (const ada of [false, true]) {
    const mode = ada ? "ADA" : "normal";

    it(`${mode}: CONTINUE is the table screen's white CONFIRM and BACK its outline NO THANKS, bottom-anchored on the footer — one BACK, none at the top`, () => {
      if (ada) store.dispatch(toggleAccessibilityMode());
      mount();

      expect(classes("phone-continue")).toEqual(expect.arrayContaining([...CONFIRM_LOOK.split(" "), "bottom-[188px]"]));
      expect(classes("phone-back")).toEqual(expect.arrayContaining([...SKIP_LOOK.split(" "), "bottom-[80px]"]));
      for (const id of ["phone-continue", "phone-back"]) {
        expect(classes(id).filter((c) => /^(top|bottom)-/.test(c)), id).toHaveLength(1);
        expect(screen.getByTestId(id).className, id).not.toMatch(/bg-tb-pink|w-\[600px\]|top-\[40px\]|left-\[40px\]/);
      }
      expect(screen.getAllByRole("button", { name: i18n.t("phone.back") })).toHaveLength(1);
      // Paint order: the pair after the block, the footer after the pair.
      const root = screen.getByTestId("phone-screen");
      const order = [...root.children];
      expect(order.indexOf(screen.getByTestId("phone-back"))).toBe(
        order.indexOf(screen.getByTestId("phone-continue")) + 1
      );
      expect(order.indexOf(screen.getByTestId("phone-continue"))).toBe(order.indexOf(block()) + 1);
    });

    it(`${mode}: title, subtitle, entry row, keypad and SKIP are one flex column centred ${ada ? "above CONTINUE" : "between the bell and CONTINUE"}; the bell ${ada ? "is dropped" : "stays at /tent's 135, outside it"}`, () => {
      if (ada) store.dispatch(toggleAccessibilityMode());
      mount();

      expect(classes("phone-content")).toEqual(
        expect.arrayContaining(["absolute", "inset-x-0", "bottom-[296px]", "flex", "flex-col", "items-center", "justify-center"])
      );
      // Normal: the room starts 24px under the bell (135 + 89 + 24), as it ends 24px above CONTINUE.
      expect(classes("phone-content").filter((c) => /^top-/.test(c))).toEqual([ada ? "top-0" : "top-[248px]"]);
      const parts = [...block().children];
      expect(parts).toHaveLength(5);
      expect(parts[0]).toBe(screen.getByRole("heading", { level: 1 }));
      expect(parts[0]).toHaveClass("min-h-[140px]");
      expect(parts[1]).toHaveTextContent(i18n.t("phone.subtitle"));
      expect(parts[2]).toContainElement(screen.getByTestId("phone-country-code"));
      expect(parts[3]).toContainElement(screen.getByTestId("kiosk-numpad"));
      expect(parts[4]).toBe(screen.getByTestId("phone-skip"));
      // In the flow: no part is positioned on its own any more.
      for (const part of parts) {
        expect(part.className).not.toMatch(/\babsolute\b|\btop-\[|-translate-x-1\/2/);
      }
      // The gaps: /phone's old rhythm (ADA: 16–20 px).
      const gaps = parts.slice(2).map((part) => part.className.match(/\bmt-\[(\d+)px\]/)?.[1]);
      expect(gaps).toEqual(ada ? ["20", "20", "16"] : ["74", "60", "36"]);
      for (const id of ["phone-continue", "phone-back"]) {
        expect(block()).not.toContainElement(screen.getByTestId(id));
      }
      if (ada) {
        expect(bell()).toBeNull();
      } else {
        expect(bell()).toHaveClass("top-[135px]");
        expect(block()).not.toContainElement(bell());
      }
    });
  }

  it("a lookup in flight: CONTINUE is disabled, says so, and wears the house dim on white", () => {
    loyaltyHook.loading = true;
    mount();

    const button = screen.getByTestId("phone-continue");
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent(i18n.t("phone.checking"));
    expect(button).toHaveClass("bg-tb-surface", "disabled:opacity-60");
  });
});
