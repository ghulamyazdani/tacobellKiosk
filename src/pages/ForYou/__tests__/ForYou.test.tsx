import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { KioskEventName } from "@cx-sdk/core";
import {
  closeAccessibilityMode,
  setCurrency,
  setEnableAccessibilityMode,
  toggleAccessibilityMode,
} from "@cx-sdk/catalog/state/appSettings.slice";
import {
  selectCartUpsellEntryQuantity,
  selectCartUpsellSeen,
  setCartItems,
  setCartUpsellEntryQuantity,
} from "@cx-sdk/ordering/state/cart.slice";
import type { RecommendedEntity } from "@cx-sdk/core/types/recommendation";
import { store } from "../../../redux/app/store";
import {
  cartUpsellGridCapacity,
  CART_UPSELL_CARD_HEIGHT_PX,
  CART_UPSELL_CARD_WIDTH_PX,
} from "../../../hooks/menuHooks/cartUpsellUtils";
import {
  STAGE_HEIGHT,
  STAGE_WIDTH,
} from "../../../components/stage/KioskStage";
import type { ForYouCardProps } from "../../../components/cart/ForYouCard";
import ForYou from "../index";
import i18n from "../../../i18n";

/*
  HOUSE STYLE with ONE deliberate departure from the fork's version of this
  suite (posistKiosk src/pages/__tests__/ForYou.test.tsx).

  The fork mocks react-redux wholesale and drives `mockCartQuantity` /
  `mockEntryQuantity` as two independent module-level lets. The point of that
  split is that the visit baseline lives in REDUX, not in the component, so a
  detour remount can be modelled honestly: the cart moves while the screen is
  unmounted and the baseline does not.

  Here the same independence comes from the REAL store (TB house style: real
  store + Provider + MemoryRouter + RESET_STATE + i18n), which models it more
  honestly still — the store genuinely outlives the component, so
  unmount -> move the cart -> remount exercises the actual reducers and the
  actual selectors rather than two test-local variables that happen to behave
  that way. Cart units and the baseline remain separately drivable:
    setCartUnits(n)                        -> state.cart.totalQuantity
    dispatch(setCartUpsellEntryQuantity(n)) -> state.cart.cartUpsellEntryQuantity
  and the "did it re-seed?" assertions read the store rather than counting
  dispatches, so they fail on the behaviour rather than on the call shape.

  Mocked: the two hooks whose real implementations need a whole converted menu
  (useCartUpsell, useAddEntityToCart), the navigate spy (so `{replace:true}`
  is assertable), analytics (captureKioskEvent is a no-op unless PostHog is
  initialized), and the card (a real one would drag in image assets and the
  i18n calorie unit for no gain — the page's contract with it is the props it
  passes and the testid it chooses).
*/

const mockNavigate = vi.fn();
const mockAddEntity = vi.fn();
const mockCapture = vi.fn();

let mockItems: RecommendedEntity[] = [];
let mockShouldShow = true;
/** What tapping a card would do — "add" stays here, anything else leaves. */
let mockAddIntent = "add";

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  // Lazy deref: the factory itself must not touch a test-scope const.
  useNavigate: () => mockNavigate,
}));

vi.mock("../../../hooks/menuHooks/useCartUpsell", () => ({
  default: () => ({
    items: mockItems,
    shouldShowUpsell: mockShouldShow,
    getBreakdown: () => ({}),
  }),
}));

vi.mock("../../../hooks/menuHooks/useAddEntityToCart", () => ({
  default: () => ({
    addEntity: mockAddEntity,
    getAddIntent: () => mockAddIntent,
  }),
}));

vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mockCapture(...args),
}));

/*
  Stub card. Emits the testid the PAGE chose (so `foryou-card-<id>` is under
  test, not invented here) and mirrors every prop back as a data-* attribute,
  which is what makes the page->card contract assertable without rendering the
  real tile.
*/
vi.mock("../../../components/cart/ForYouCard", () => ({
  default: ({
    entity,
    title,
    price,
    currency,
    quantity,
    addLabel,
    customizeLabel,
    testId,
    onAdd,
  }: ForYouCardProps) => (
    <button
      type="button"
      data-testid={testId}
      data-price={String(price ?? "")}
      data-currency={currency}
      data-quantity={String(quantity)}
      data-add-label={addLabel}
      data-customize-label={customizeLabel}
      onClick={() => onAdd(entity)}
    >
      {title}
    </button>
  ),
}));

const item = (id: string): RecommendedEntity => ({
  id,
  name: `Item ${id}`,
  price: 10,
  isDirectlyAddable: true,
});

const tree = () => (
  <Provider store={store}>
    <MemoryRouter initialEntries={["/forYou"]}>
      <ForYou />
    </MemoryRouter>
  </Provider>
);

/**
 * Moves `state.cart.totalQuantity` — UNITS, not rows (TRAP 1). Two of one item
 * is ONE row and TWO units; the baseline arithmetic is unit-based, so the
 * fixture has to be too.
 */
const setCartUnits = (units: number, entityId = "seed") => {
  store.dispatch(
    setCartItems(
      units > 0
        ? [
            {
              id: entityId,
              itemId: `${entityId}-1`,
              name: `Row ${entityId}`,
              quantity: units,
              type: "ITEM",
              total_price: 1,
            },
          ]
        : [],
    ),
  );
};

/** Same, but while the screen is mounted — the store update re-renders it. */
const setCartUnitsLive = (units: number, entityId = "seed") => {
  act(() => {
    setCartUnits(units, entityId);
  });
};

const setViewport = (width: number, height: number) => {
  Object.defineProperty(window, "innerWidth", {
    value: width,
    configurable: true,
  });
  Object.defineProperty(window, "innerHeight", {
    value: height,
    configurable: true,
  });
};

const primary = () => screen.getByTestId("foryou-primary");
const primaryText = () => primary().textContent;
const seen = () => selectCartUpsellSeen(store.getState());
const baseline = () => selectCartUpsellEntryQuantity(store.getState());
const shownIds = () =>
  screen
    .getAllByTestId(/^foryou-card-/)
    .map((el) => el.getAttribute("data-testid"));

/*
  Read the copy back through the SAME i18n instance the component uses, so
  these assertions hold both before and after the gate agent merges the three
  `upsell.*` keys: today t() returns the key, tomorrow the English string, and
  either way the two sides agree.
*/
const NOT_TODAY = i18n.t("upsell.notToday");
const PROCEED = i18n.t("upsell.proceedToOrder");

describe("ForYou — the pre-cart upsell screen", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockAddEntity.mockReset();
    mockCapture.mockReset();
    mockItems = [item("a"), item("b")];
    mockShouldShow = true;
    mockAddIntent = "add";

    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ symbol: "£" }));
    // Arrived through the gate in Menu: one unit in the bag, baseline seeded.
    setCartUnits(1);
    store.dispatch(setCartUpsellEntryQuantity(1));
  });

  describe("mount guards — it must never render a dead end", () => {
    it("redirects to the menu when the cart is empty", () => {
      // Reachable by hand-typed URL. "Complete your meal" with nothing in the
      // bag is nonsense, and /cart would be an empty cart — bounce to /menu.
      setCartUnits(0);
      render(tree());

      expect(mockNavigate).toHaveBeenCalledWith("/menu", { replace: true });
    });

    it("redirects to the cart when the gate is closed", () => {
      mockShouldShow = false;
      render(tree());

      expect(mockNavigate).toHaveBeenCalledWith("/cart", { replace: true });
    });

    it("redirects to the cart when there is nothing to show", () => {
      mockItems = [];
      render(tree());

      expect(mockNavigate).toHaveBeenCalledWith("/cart", { replace: true });
    });

    it("uses replace so Back cannot ping-pong", () => {
      mockShouldShow = false;
      render(tree());

      expect(mockNavigate.mock.calls[0][1]).toEqual({ replace: true });
    });

    it("renders nothing rather than a blank shell when empty", () => {
      mockItems = [];
      const { container } = render(tree());

      expect(container).toBeEmptyDOMElement();
    });

    it("does not redirect on the happy path", () => {
      render(tree());

      expect(mockNavigate).not.toHaveBeenCalled();
      expect(screen.getByTestId("foryou-screen")).toBeInTheDocument();
    });

    it("does not re-seed a baseline that is already a number", () => {
      render(tree());

      expect(baseline()).toBe(1);
    });
  });

  describe("rendering", () => {
    it("shows one heading and a card per item", () => {
      render(tree());

      expect(screen.getByTestId("foryou-heading")).toHaveTextContent(
        i18n.t("upsell.anythingElse"),
      );
      expect(screen.getByTestId("foryou-card-a")).toHaveTextContent("Item a");
      expect(screen.getByTestId("foryou-card-b")).toBeInTheDocument();
      expect(shownIds()).toHaveLength(2);
    });

    it("always offers a way back to the menu (Rule 1 — no global footer here)", () => {
      render(tree());

      fireEvent.click(screen.getByTestId("foryou-back"));
      expect(mockNavigate).toHaveBeenCalledWith("/menu");
    });

    it("hands each card the raw price, the currency symbol and its live in-cart count", () => {
      // Two of item "a" already in the bag: the card's count pill is driven by
      // the CART, not by what was taken on this screen.
      setCartUnits(2, "a");
      render(tree());

      const card = screen.getByTestId("foryou-card-a");
      // RAW menu price — a taxed bill total is a cart concept and must never
      // appear on a suggestion.
      expect(card).toHaveAttribute("data-price", "10");
      expect(card).toHaveAttribute("data-currency", "£");
      expect(card).toHaveAttribute("data-quantity", "2");
      expect(screen.getByTestId("foryou-card-b")).toHaveAttribute(
        "data-quantity",
        "0",
      );
      // The accessible verbs: one-tap vs chooser, resolved by the card.
      expect(card).toHaveAttribute("data-add-label", i18n.t("menu.quickAdd"));
      expect(card).toHaveAttribute(
        "data-customize-label",
        i18n.t("pack.customize"),
      );
    });

    /*
      The screen does not scroll in either axis, so what it renders is bounded
      by what fits: capacity comes from cartUpsellGridCapacity(STAGE) — the
      fixed 1080x1920 design stage, or the ADA reach zone (P9c). Render one row
      too many and "Proceed to Order" and "Back to Menu" leave the screen — on
      a kiosk with no scroll gesture, that is a stranded customer (Rule 1),
      which is why these are flow tests and not styling tests.
    */
    describe("the grid is bounded by what fits on screen", () => {
      const forty = () => Array.from({ length: 40 }, (_, i) => item(`i${i}`));

      it("shows every item when they all fit", () => {
        mockItems = Array.from({ length: 12 }, (_, i) => item(`i${i}`));
        render(tree());

        expect(shownIds()).toHaveLength(12);
      });

      it("drops the tail rather than overflowing a page that cannot scroll", () => {
        mockItems = forty(); // 4 across x 4 down = 16
        render(tree());

        expect(shownIds()).toHaveLength(16);
        // The TAIL — the merchandiser's own menu order decides who survives.
        expect(shownIds()[0]).toBe("foryou-card-i0");
        expect(screen.queryByTestId("foryou-card-i16")).not.toBeInTheDocument();
      });

      it("ADA: the reach zone holds two rows — 8 cards", () => {
        mockItems = forty();
        store.dispatch(toggleAccessibilityMode());
        render(tree());

        expect(shownIds()).toHaveLength(8);
        expect(cartUpsellGridCapacity(STAGE_WIDTH, STAGE_HEIGHT, true)).toBe(8);
      });

      it("a stale ADA flag with the tenant gate off keeps the full grid", () => {
        mockItems = forty();
        store.dispatch(toggleAccessibilityMode());
        store.dispatch(setEnableAccessibilityMode(false));
        render(tree());

        expect(shownIds()).toHaveLength(16);
      });

      it("sizes from the STAGE, never the window — KioskStage scales the stage to any window", () => {
        // Window px were only right at scale 1: a dev/e2e window (or a bad
        // measurement) must not decide what the fixed stage can hold.
        setViewport(0, 0);
        mockItems = forty();
        render(tree());

        expect(shownIds()).toHaveLength(16);
        expect(screen.getByTestId("foryou-back")).toBeInTheDocument();
      });

      it("leaving ADA on this screen (the brand-zone exit) grows the grid without reshuffling it", () => {
        mockItems = forty();
        store.dispatch(toggleAccessibilityMode());
        render(tree());
        expect(shownIds()).toHaveLength(8);

        act(() => {
          store.dispatch(closeAccessibilityMode());
        });

        expect(shownIds()).toHaveLength(16);
        expect(shownIds()[0]).toBe("foryou-card-i0");
      });

      it("centres in both modes: the reach zone already lowers the page", () => {
        store.dispatch(toggleAccessibilityMode());
        render(tree());

        const page = screen.getByTestId("foryou-screen");
        expect(page.className).toContain("h-full");
        expect(page.className).toContain("justify-center");
        expect(page.className).not.toContain("justify-end");
        expect(page.className).not.toContain("pb-[120px]");
      });

      it("keeps both exits reachable when the list is truncated", () => {
        mockItems = forty();
        render(tree());

        fireEvent.click(primary());
        expect(mockNavigate).toHaveBeenCalledWith("/cart");
      });

      it("reports what was SHOWN and what qualified, so truncation is visible", () => {
        mockItems = forty();
        render(tree());

        fireEvent.click(primary());
        expect(mockCapture).toHaveBeenCalledWith(
          KioskEventName.CartUpsellSkipped,
          { offered: 16, eligible: 40 },
        );
      });
    });

    it("gives every card the same box, so a long name cannot outgrow the row", () => {
      // The box is set by the PAGE rather than left to the card's content: the
      // grid's row arithmetic assumes this exact height, and nothing scrolls.
      mockItems = [item("a"), item("b"), item("c")];
      render(tree());

      screen.getAllByTestId(/^foryou-card-/).forEach((card) => {
        expect(card.parentElement).toHaveStyle({
          width: `${CART_UPSELL_CARD_WIDTH_PX}px`,
          height: `${CART_UPSELL_CARD_HEIGHT_PX}px`,
        });
      });
    });

    it("snapshots the list so cards cannot reflow under a finger", () => {
      const { rerender } = render(tree());
      // Stock/filters change mid-screen — the grid must not shuffle.
      mockItems = [item("z")];
      rerender(tree());

      expect(screen.getByTestId("foryou-card-a")).toBeInTheDocument();
      expect(screen.queryByTestId("foryou-card-z")).not.toBeInTheDocument();
    });
  });

  describe("adding", () => {
    it("suppresses the confirmation modal and returns here after a detour", () => {
      render(tree());
      fireEvent.click(screen.getByTestId("foryou-card-a"));

      expect(mockAddEntity).toHaveBeenCalledTimes(1);
      expect(mockAddEntity.mock.calls[0][0]).toMatchObject({ id: "a" });
      expect(mockAddEntity.mock.calls[0][1]).toMatchObject({
        suppressAddedModal: true,
        // Back HERE, not forward to the cart — cancelling a customization must
        // not push the customer somewhere they never asked to go.
        returnPath: "/forYou",
      });
    });
  });

  describe("the single action button", () => {
    it("reads as a decline until something is taken", () => {
      render(tree());

      expect(primaryText()).toBe(NOT_TODAY);
    });

    // A store dispatch keeps the SAME instance mounted, so this only covers the
    // intent === "add" path where the customer never leaves the screen. The
    // detour case needs a real unmount — see the remount block below.
    it("becomes the way forward once the cart has grown", () => {
      render(tree());
      setCartUnitsLive(3); // entry was 1

      expect(primaryText()).toBe(PROCEED);
    });

    it("reports a skip when nothing was taken", () => {
      render(tree());
      fireEvent.click(primary());

      expect(mockCapture).toHaveBeenCalledWith(
        KioskEventName.CartUpsellSkipped,
        expect.objectContaining({ offered: 2, eligible: 2 }),
      );
      expect(mockNavigate).toHaveBeenCalledWith("/cart");
    });

    it("does NOT report a skip when something was taken", () => {
      render(tree());
      setCartUnitsLive(2);

      fireEvent.click(primary());
      expect(mockCapture).not.toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith("/cart");
    });

    it("always leads to the cart either way", () => {
      render(tree());
      fireEvent.click(primary());
      expect(mockNavigate).toHaveBeenCalledWith("/cart");
    });

    it("is a single 44px-plus target, never two competing calls to action", () => {
      render(tree());

      expect(screen.getAllByTestId("foryou-primary")).toHaveLength(1);
      expect(primary().className).toContain("min-h-[84px]");
      expect(screen.getByTestId("foryou-back").className).toContain(
        "min-h-[44px]",
      );
    });
  });

  /*
    REGRESSION BLOCK — the reported bug.

    Tapping a card that needs a chooser navigates to /customization, and
    /forYou and /customization are sibling <Route>s in one <Routes>
    (AppRoutes.tsx), so this screen is UNMOUNTED. The item is added to the cart
    while it is gone, and only then does the return navigation (returnPath
    "/forYou") rebuild it.

    The baseline therefore has to outlive the component. As a useRef its
    initialiser re-ran on the remount against the post-add cart, pinning
    addedHere at 0 so the button never left "Not Today".

    Modelled honestly: unmount(), move the cart in the store, leave the
    baseline alone (redux does not care that a component died), then render()
    fresh.
  */
  describe("the entry baseline survives the customization detour", () => {
    /** Tap a chooser card, lose the screen to /customization, come back. */
    const detourAndReturn = (intent: string, unitsAfter: number) => {
      mockAddIntent = intent;
      const { unmount } = render(tree());
      fireEvent.click(screen.getByTestId("foryou-card-a"));
      unmount(); // navigate("/customization") tears this screen down
      setCartUnits(unitsAfter); // the item lands while we are unmounted
      render(tree()); // the return navigation rebuilds us
    };

    it("still flips to Proceed to Order after the screen is torn down and rebuilt", () => {
      detourAndReturn("variant", 2); // entry was 1

      expect(primaryText()).toBe(PROCEED);
    });

    /*
      Deliberately EXCLUDES "upsell": the Make-It-A-Meal branch drops
      navigationState and ejects the customer to /menu, so it never returns
      here at all. Asserting a flip for it would encode a second, separate
      defect as correct behaviour.
    */
    it.each(["variant", "modifiers", "repeat"])(
      "survives a %s detour and back",
      (intent) => {
        detourAndReturn(intent, 2);
        expect(primaryText()).toBe(PROCEED);
      },
    );

    it("stays a decline when the customer CANCELLED the customization", () => {
      // Guards against over-correcting by treating any detour as a conversion.
      detourAndReturn("variant", 1); // cart unchanged

      expect(primaryText()).toBe(NOT_TODAY);
    });

    it("does NOT re-seed the baseline on the detour return", () => {
      // The assertion that would have caught the original bug's shape: a
      // re-seed would move the baseline to the POST-add quantity and swallow
      // the item the customer just customized.
      detourAndReturn("variant", 2);

      expect(baseline()).toBe(1);
    });

    it("does not report a skip after a customization conversion", () => {
      detourAndReturn("variant", 2);
      mockCapture.mockClear();

      fireEvent.click(primary());
      expect(mockCapture).not.toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith("/cart");
    });

    it("seeds the baseline when reached without passing the gate (hand-typed URL / F5)", () => {
      store.dispatch({ type: "RESET_STATE" }); // baseline back to null
      setCartUnits(2);
      render(tree());

      expect(baseline()).toBe(2);
      // And never a "Proceed to Order" flash: the fallback in the arithmetic
      // is the live cart quantity, not 0, so the pre-seed render reads as a
      // decline too.
      expect(primaryText()).toBe(NOT_TODAY);
    });
  });

  /*
    The screen is shown at most once per CUSTOMER. "Seen" lives in redux (it
    survives emptyCart and is not persisted), never in router state — which
    belongs to a single history entry and was dropped by any navigation that
    did not re-supply it, bringing the screen back later in the same session.

    Only the FORWARD exits count. "Back to Menu" is not a dismissal: the
    customer is still mid-order and will pass this way again.
  */
  describe("marks itself seen on the forward exits only", () => {
    it("on Not Today", () => {
      render(tree());
      fireEvent.click(primary());

      expect(seen()).toBe(true);
    });

    it("on proceeding to the cart after adding", () => {
      render(tree());
      setCartUnitsLive(5); // cart grew since mount → the way forward

      fireEvent.click(primary());
      expect(seen()).toBe(true);
    });

    /*
      REGRESSION. useAddEntityToCart's "upsell" branch dispatches
      openMakeItAMealModal WITHOUT forwarding navigationState — unlike repeat /
      modifiers / variant, which all do — so the prompt navigates bare and the
      customer is ejected to /menu with no way back here. Unmarked, that
      reproduced the original bug: tap a combo suggestion, land on /menu, hit
      VIEW MY BAG, and the upsell screen returns.
    */
    it.each(["upsell", "repeat", "modifiers", "variant"])(
      "on a %s detour, which navigates away from this screen",
      (intent) => {
        mockAddIntent = intent;
        render(tree());
        fireEvent.click(screen.getByTestId("foryou-card-a"));

        expect(seen()).toBe(true);
        expect(mockAddEntity).toHaveBeenCalledTimes(1);
      },
    );

    it("NOT on a plain add — the customer is still standing on the screen", () => {
      mockAddIntent = "add";
      render(tree());
      fireEvent.click(screen.getByTestId("foryou-card-a"));

      expect(seen()).toBe(false);
      expect(mockAddEntity).toHaveBeenCalledTimes(1);
    });

    it("NOT on an unavailable item — nothing happens at all", () => {
      mockAddIntent = "unavailable";
      render(tree());
      fireEvent.click(screen.getByTestId("foryou-card-a"));

      expect(seen()).toBe(false);
    });

    it("NOT on Back to Menu — going back to browse is not a dismissal", () => {
      render(tree());
      fireEvent.click(screen.getByTestId("foryou-back"));

      expect(seen()).toBe(false);
      // ...and they still get to the menu.
      expect(mockNavigate).toHaveBeenCalledWith("/menu");
    });
  });
});
