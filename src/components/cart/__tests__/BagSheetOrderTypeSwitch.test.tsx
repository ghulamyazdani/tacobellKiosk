import { useState } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import {
  setCurrency,
  setGeneralSettings,
} from "@cx-sdk/catalog/state/appSettings.slice";
import {
  setPipelines,
  setSelectedPipeline,
  setTabType,
} from "@cx-sdk/catalog/state/pipeline.slice";
import { setPipelineStatuses } from "@cx-sdk/catalog/state/kioskOpenStatus.slice";
import type { SwitchablePipeline } from "@cx-sdk/ordering/cart/orderTypeTarget";
import { store } from "../../../redux/app/store";
import {
  selectOrderTypeSwitchNotice,
  setOrderTypeSwitchNotice,
} from "../../../redux/features/menuSelections/menuSelections.slice";
import { setSelectedLanguage } from "../../../redux/features/multiLanguage/multiLanguage.slice";
import BagSheet from "../BagSheet";
import i18n, { isolate } from "../../../i18n";
import "../../../i18n/lazyCopy";

/*
  Item 19 (lane bag-pdp) — the bag half of the in-bag EAT IN / TAKE OUT
  switch: when the other segment is live, the confirm → in-flight → failure /
  done flow, auto-apply held off while it is open, and the removal notice
  (redux, both BagSheet branches, names joined by the locale's ListFormat).

  Seams: the executor (useOrderTypeSwitch — its own suite is
  hooks/cartHooks/__tests__/orderTypeSwitch.test.ts), auto-apply (to read its
  `blocked` input), and PAY's revalidation fetches (BagSheetLateCheckout's).
*/

const mocks = vi.hoisted(() => ({
  switchTo: vi.fn(),
  autoApply: vi.fn(),
  fetchMenu: vi.fn(),
}));

vi.mock("../../../hooks/cartHooks/useOrderTypeSwitch", () => ({
  default: () => ({ status: "idle", switchTo: mocks.switchTo }),
}));

vi.mock("../../../hooks/offerHooks/useOfferAutoApply", () => ({
  default: (input: { blocked: boolean }) => mocks.autoApply(input),
}));

vi.mock("../../../hooks/menuHooks/useMenuConverters", () => ({
  default: () => ({ fetchMenu: (...args: unknown[]) => mocks.fetchMenu(...args) }),
}));

vi.mock("@cx-sdk/catalog/services/settingsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cx-sdk/catalog/services/settingsApi")>()),
  useLazyGetServerTimeQuery: () => [() => ({ unwrap: () => Promise.resolve({}) })],
}));

vi.mock("../../../hooks/schedulerHooks/useSchedulerConverter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../hooks/schedulerHooks/useSchedulerConverter")>()),
  default: () => ({
    isValidAsPerSchedulers: () => true,
    updateCartItemsByMenu: async () => ({ updatedCart: [], invalidSchedulerItemIds: [] }),
  }),
}));

const AR_BURGER = "تشيز برجر";
const AR_SALAD = "سلطة يونانية";
const AR = (value: string) => [{ value, name: "Arabic", code: "ar", dir: "rtl" }];

/** Paid CUSTOMIZABLE row (BagSheet.test fixture) — a valid, non-zero bill. */
const BURGER = {
  id: "cheese-burger",
  itemId: "cb-1",
  uniqueItemId: "cb-1-u",
  name: "Cheese Burger",
  aliases: AR(AR_BURGER),
  quantity: 1,
  type: "CUSTOMIZABLE",
  price: 8,
  total_price: 8.6,
  customizations: {
    sauce_group: [{ id: "onions", name: "Add Onions", price: 0.6, quantity: 1 }],
  },
  baseItem: { id: "cheese-burger", name: "Cheese Burger", price: 8, modifiers: ["sauce_group"] },
};
const SALAD = {
  id: "greek-salad",
  itemId: "gs-1",
  name: "Greek Salad",
  aliases: AR(AR_SALAD),
  quantity: 1,
  type: "ITEM",
  price: 6,
  total_price: 6,
};

const P1: SwitchablePipeline = { _id: "p1", tab_id: "t1", tab_type: "dine_in", primary_name: "Dine In" };
const P2: SwitchablePipeline = { _id: "p2", tab_id: "t2", tab_type: "take_away", primary_name: "Take Away" };
const P3: SwitchablePipeline = { _id: "p3", tab_id: "t3", tab_type: "takeaway", primary_name: "Collect" };

const OK = (removedRows: unknown[] = []) => ({ ok: true, removedRows, offerDropped: false });
const FAILED = { ok: false, removedRows: [], offerDropped: false };

/** The bag as the Menu page hosts it: onClose closes it (the empty-cart exit too). */
function Host({ initiallyOpen = true }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return <BagSheet open={open} onClose={() => setOpen(false)} />;
}

const renderBag = (initiallyOpen = true) =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/cart"]}>
        <Host initiallyOpen={initiallyOpen} />
      </MemoryRouter>
    </Provider>,
  );

const takeOut = () => screen.getByTestId("bag-ordertype-takeout");
const lastBlocked = () => (mocks.autoApply.mock.calls.at(-1)?.[0] as { blocked: boolean }).blocked;
const notice = () => selectOrderTypeSwitchNotice(store.getState());
const messageOf = (testId: string) => document.getElementById(`${testId}-message`)?.textContent;

/** TAKE OUT → the (lazy) confirm. */
const openConfirm = async () => {
  fireEvent.click(takeOut());
  return screen.findByTestId("bag-ordertype-confirm");
};

describe("BagSheet — the in-bag order-type switch (item 19)", () => {
  beforeAll(async () => {
    // The ONE lazy bag chunk: load it once so findBy* never races a cold transform.
    await import("../bagLazyParts");
  }, 60_000);

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ symbol: "£" }));
    store.dispatch(setCartItems([{ ...BURGER }]));
    store.dispatch(setPipelines([P1, P2]));
    store.dispatch(setSelectedPipeline(P1));
    store.dispatch(setTabType("dine_in"));
    mocks.switchTo.mockReset();
    mocks.autoApply.mockReset();
    mocks.fetchMenu.mockReset();
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  describe("the segment", () => {
    it("one pipeline: TAKE OUT is aria-disabled and inert; EAT IN is the pressed segment", () => {
      store.dispatch(setPipelines([P1]));
      renderBag();
      expect(takeOut()).toHaveAttribute("aria-disabled", "true");
      expect(takeOut()).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByTestId("bag-ordertype-eatin")).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(takeOut());
      expect(screen.queryByTestId("bag-ordertype-loading")).not.toBeInTheDocument();
      expect(screen.queryByTestId("bag-ordertype-confirm")).not.toBeInTheDocument();
    });

    it("no OPEN target (the take-out pipeline is closed) → disabled", () => {
      store.dispatch(setPipelineStatuses({ p2: { status: false, reason: "closed" } }));
      renderBag();
      expect(takeOut()).toHaveAttribute("aria-disabled", "true");
    });

    it("a device-deactivated target → disabled", () => {
      store.dispatch(
        setGeneralSettings([{ setting_id: "deactivated_pipelines", value: { value: ["p2"] } }]),
      );
      renderBag();
      expect(takeOut()).toHaveAttribute("aria-disabled", "true");
    });

    it("a target without a tab → disabled", () => {
      store.dispatch(setPipelines([P1, { _id: "p2", tab_type: "take_away" }]));
      renderBag();
      expect(takeOut()).toHaveAttribute("aria-disabled", "true");
    });

    it("two pipelines → live; the first OPEN one in list order is the target", async () => {
      store.dispatch(setPipelines([P1, P2, P3]));
      store.dispatch(setPipelineStatuses({ p2: { status: false, reason: "closed" } }));
      mocks.switchTo.mockResolvedValue(OK());
      renderBag();
      expect(takeOut()).toHaveAttribute("aria-disabled", "false");
      await openConfirm();
      fireEvent.click(screen.getByTestId("bag-ordertype-confirm-yes"));
      expect(mocks.switchTo).toHaveBeenCalledWith(P3);
    });

    it("TAKE OUT active: EAT IN is the switch segment (the other kind)", async () => {
      store.dispatch(setSelectedPipeline(P2));
      store.dispatch(setTabType("take_away"));
      mocks.switchTo.mockResolvedValue(OK());
      renderBag();
      expect(takeOut()).toHaveAttribute("aria-pressed", "true");
      const eatIn = screen.getByTestId("bag-ordertype-eatin");
      expect(eatIn).toHaveAttribute("aria-disabled", "false");
      fireEvent.click(eatIn);
      const confirm = await screen.findByTestId("bag-ordertype-confirm");
      expect(confirm).toHaveAccessibleName("Switch to Eat In?");
      fireEvent.click(screen.getByTestId("bag-ordertype-confirm-yes"));
      expect(mocks.switchTo).toHaveBeenCalledWith(P1);
    });

    it("during checkout (PAY running) → disabled; live again once PAY's preflight settles", async () => {
      let fail!: (error: unknown) => void;
      mocks.fetchMenu.mockReturnValue(
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
      );
      renderBag();
      expect(takeOut()).toHaveAttribute("aria-disabled", "false");
      act(() => {
        fireEvent.click(screen.getByTestId("bag-pay"));
      });
      expect(mocks.fetchMenu).toHaveBeenCalledTimes(1);
      expect(takeOut()).toHaveAttribute("aria-disabled", "true");
      fireEvent.click(takeOut());
      expect(screen.queryByTestId("bag-ordertype-loading")).not.toBeInTheDocument();
      expect(screen.queryByTestId("bag-ordertype-confirm")).not.toBeInTheDocument();

      await act(async () => {
        fail(new Error("getMenu 504"));
        for (let i = 0; i < 5; i += 1) await Promise.resolve();
      });
      expect(takeOut()).toHaveAttribute("aria-disabled", "false");
    });
  });

  describe("the flow", () => {
    it("confirm (no icon, design-language copy) → NO changes nothing", async () => {
      renderBag();
      const before = store.getState();
      const confirm = await openConfirm();
      expect(confirm).toHaveAccessibleName("Switch to Take Out?");
      expect(confirm).toHaveAccessibleDescription("Prices and availability may change.");
      expect(confirm.querySelector("img")).toBeNull();
      expect(screen.getByTestId("bag-ordertype-confirm-yes")).toHaveTextContent("Yes, switch");
      expect(screen.getByTestId("bag-ordertype-confirm-no")).toHaveTextContent("No, keep Eat In");

      fireEvent.click(screen.getByTestId("bag-ordertype-confirm-no"));
      expect(screen.queryByTestId("bag-ordertype-confirm")).not.toBeInTheDocument();
      expect(mocks.switchTo).not.toHaveBeenCalled();
      const after = store.getState() as typeof before & { cart: unknown; pipeline: unknown };
      expect(after.cart).toBe((before as typeof after).cart);
      expect(after.pipeline).toBe((before as typeof after).pipeline);
      expect(notice()).toBeNull();
      expect(takeOut()).toHaveAttribute("aria-disabled", "false"); // it can be opened again
    });

    it("auto-apply is blocked while the flow is open, released when it closes", async () => {
      renderBag();
      expect(lastBlocked()).toBe(false);
      await openConfirm();
      expect(lastBlocked()).toBe(true);
      fireEvent.click(screen.getByTestId("bag-ordertype-confirm-no"));
      expect(lastBlocked()).toBe(false);
    });

    it("YES → an in-flight overlay that is a polite status (no exits) until the executor answers", async () => {
      let answer!: (outcome: unknown) => void;
      mocks.switchTo.mockImplementation(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      );
      renderBag();
      await openConfirm();
      fireEvent.click(screen.getByTestId("bag-ordertype-confirm-yes"));
      expect(mocks.switchTo).toHaveBeenCalledWith(P2);
      const overlay = screen.getByTestId("bag-ordertype-switching");
      expect(overlay).toHaveAttribute("role", "status");
      expect(overlay).toHaveAttribute("aria-live", "polite");
      expect(overlay).toHaveTextContent("Updating your order…");
      expect(overlay.querySelector("button")).toBeNull();
      expect(lastBlocked()).toBe(true);

      await act(async () => {
        answer(OK());
      });
      await waitFor(() => expect(screen.queryByTestId("bag-ordertype-switching")).not.toBeInTheDocument());
      expect(notice()).toBeNull(); // nothing was removed → no notice
      expect(lastBlocked()).toBe(false);
    });

    it("failed → the failure dialog; TRY AGAIN calls switchTo again; BACK closes with nothing raised", async () => {
      mocks.switchTo.mockResolvedValue(FAILED);
      renderBag();
      await openConfirm();
      fireEvent.click(screen.getByTestId("bag-ordertype-confirm-yes"));
      const failed = await screen.findByTestId("bag-ordertype-failed");
      expect(failed).toHaveAccessibleName("We couldn't switch to Take Out");
      expect(failed).toHaveAccessibleDescription("Your order hasn't changed. Please try again.");
      expect(failed.querySelector("img")).not.toBeNull(); // the warning mark

      fireEvent.click(screen.getByTestId("bag-ordertype-retry"));
      expect(mocks.switchTo).toHaveBeenCalledTimes(2);
      expect(mocks.switchTo).toHaveBeenLastCalledWith(P2);
      await screen.findByTestId("bag-ordertype-failed");

      fireEvent.click(screen.getByTestId("bag-ordertype-back"));
      expect(screen.queryByTestId("bag-ordertype-failed")).not.toBeInTheDocument();
      expect(mocks.switchTo).toHaveBeenCalledTimes(2);
      expect(notice()).toBeNull();
      expect(lastBlocked()).toBe(false);
    });

    it("a throwing executor also lands on the failure dialog (never a stuck overlay)", async () => {
      mocks.switchTo.mockRejectedValue(new Error("boom"));
      renderBag();
      await openConfirm();
      fireEvent.click(screen.getByTestId("bag-ordertype-confirm-yes"));
      expect(await screen.findByTestId("bag-ordertype-failed")).toBeInTheDocument();
      expect(screen.queryByTestId("bag-ordertype-switching")).not.toBeInTheDocument();
    });

    it("aborted (nothing was written) raises neither the failure dialog nor a notice", async () => {
      mocks.switchTo.mockResolvedValue({ ok: false, aborted: true, removedRows: [], offerDropped: false });
      renderBag();
      await openConfirm();
      fireEvent.click(screen.getByTestId("bag-ordertype-confirm-yes"));
      await act(async () => {});
      expect(screen.queryByTestId("bag-ordertype-failed")).not.toBeInTheDocument();
      expect(notice()).toBeNull();
    });

    it("ok with removed rows → the notice names them; it SURVIVES the bag's empty-cart exit; GOT IT clears it", async () => {
      store.dispatch(setTabType("dine_in"));
      mocks.switchTo.mockImplementation(async () => {
        // The executor's commit: the new tab serves nothing in the bag.
        store.dispatch(setTabType("take_away"));
        store.dispatch(setCartItems([]));
        return OK([BURGER, SALAD]);
      });
      store.dispatch(setCartItems([{ ...BURGER }, { ...SALAD }]));
      renderBag();
      await openConfirm();
      fireEvent.click(screen.getByTestId("bag-ordertype-confirm-yes"));

      const shown = await screen.findByTestId("bag-ordertype-notice");
      expect(screen.queryByTestId("bag-sheet")).not.toBeInTheDocument(); // the bag closed itself
      expect(shown).toHaveAccessibleName("Your bag was updated");
      expect(messageOf("bag-ordertype-notice")).toBe(
        "Not available for Take Out, removed: Cheese Burger and Greek Salad",
      );
      expect(shown.querySelector("img")).toBeNull();
      expect(screen.getByTestId("bag-ordertype-notice-gotit")).toHaveClass("w-full");
      expect(notice()).toEqual({ removed: [BURGER, SALAD] }); // entities, never strings

      fireEvent.click(screen.getByTestId("bag-ordertype-notice-gotit"));
      expect(notice()).toBeNull();
      expect(screen.queryByTestId("bag-ordertype-notice")).not.toBeInTheDocument();
    });
  });

  describe("the notice", () => {
    it("renders in BOTH branches — the open bag and the closed one", async () => {
      store.dispatch(setTabType("take_away"));
      store.dispatch(setOrderTypeSwitchNotice({ removed: [SALAD] }));
      const open = renderBag(true);
      expect(await screen.findByTestId("bag-ordertype-notice")).toBeInTheDocument();
      expect(screen.getByTestId("bag-sheet")).toBeInTheDocument();
      expect(messageOf("bag-ordertype-notice")).toBe("Not available for Take Out, removed: Greek Salad");
      open.unmount();

      renderBag(false);
      expect(await screen.findByTestId("bag-ordertype-notice")).toBeInTheDocument();
      expect(screen.queryByTestId("bag-sheet")).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId("bag-ordertype-notice-gotit"));
      expect(notice()).toBeNull();
    });

    it("EN: three names join as a serial list ('A, B, and C')", async () => {
      store.dispatch(setTabType("take_away"));
      store.dispatch(
        setOrderTypeSwitchNotice({ removed: [BURGER, SALAD, { ...SALAD, itemId: "gs-2", name: "Fries", aliases: [] }] }),
      );
      renderBag(false);
      await screen.findByTestId("bag-ordertype-notice");
      expect(messageOf("bag-ordertype-notice")).toBe(
        "Not available for Take Out, removed: Cheese Burger, Greek Salad, and Fries",
      );
    });

    it("AR: the menu's Arabic names, joined by the Arabic list format, in the Arabic copy", async () => {
      store.dispatch(setTabType("take_away"));
      store.dispatch(setSelectedLanguage({ name: "Arabic", code: "ar", dir: "rtl", type: "secondary_language" }));
      await act(async () => {
        await i18n.changeLanguage("ar");
      });
      store.dispatch(setOrderTypeSwitchNotice({ removed: [BURGER, SALAD] }));
      renderBag(false);
      await screen.findByTestId("bag-ordertype-notice");

      const items = new Intl.ListFormat("ar", { type: "conjunction" }).format([
        isolate(AR_BURGER),
        isolate(AR_SALAD),
      ]);
      const message = messageOf("bag-ordertype-notice") ?? "";
      expect(message).toBe(i18n.t("bag.orderType.removedBody", { type: i18n.t("bag.takeOut"), items }));
      expect(message).toContain(AR_BURGER);
      expect(message).toContain(AR_SALAD);
      expect(message).toContain(" و"); // the Arabic conjunction, not "and"
      expect(message).not.toContain("Cheese Burger");
      expect(screen.getByTestId("bag-ordertype-notice-gotit")).toHaveTextContent(i18n.t("offers.gotIt"));
    });
  });
});
