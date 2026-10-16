import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { setTags } from "@cx-sdk/catalog/state/Menu.slice";
import { setKioskSettings } from "@cx-sdk/catalog/state/appSettings.slice";
import { setFilters } from "@cx-sdk/catalog/state/filter.slice";
import { openLoyaltyModal, setLoyaltyPartner } from "@cx-sdk/ordering/state/loyalty.slice";
import { store } from "../../redux/app/store";
import i18n from "../../i18n";
import CategoryRail from "../menu/CategoryRail";
import MenuFilterChips from "../menu/MenuFilterChips";
import MenuItemCard from "../menu/MenuItemCard";
import MenuCtaBar from "../menu/MenuCtaBar";
import SelectSizeModal from "../menu/SelectSizeModal";
import OptionCard, { Counter, CtaBar, GroupHeader, OptionRow } from "../customization/OptionCard";
import SlotSelectionSheet from "../customization/SlotSelectionSheet";
import ForYouCard from "../cart/ForYouCard";
import KioskKeyboard from "../keyboard/KioskKeyboard";
import KioskNumpad from "../keyboard/KioskNumpad";
import LoyaltySuccessModal from "../loyalty/LoyaltySuccessModal";

/*
  Lane motion, per-surface wiring (motion contract §3). jsdom has no animation
  engine and no :active, so these pin the CSS preconditions only:
  - selection: `tb-select` plays while aria-pressed / aria-current is true;
  - counts: a re-keyed leaf is a NEW node after a change (CSS replays its
    animation) and the SAME node otherwise (no replay on an unrelated render);
  - press: `tb-press-card` squeezes while its DIRECT empty overlay is pressed,
    keycaps opt out (`tb-no-press`) and take the Figma pressed fills.
*/

const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;
// A real cart row: the bag's bill (the menu bar's TOTAL) prices `price`.
const ROW = { id: "r1", itemId: "x", name: "X", type: "ITEM", price: 2.5, total_price: 2.5, quantity: 1 };

afterEach(() => {
  store.dispatch({ type: "RESET_STATE" });
});

describe("selection (§3.2)", () => {
  it("the category rail: tb-select on every row, aria-current only on the selected one, following the selection", () => {
    const categories = [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ];
    const { rerender } = render(<CategoryRail categories={categories} selectedId="a" onSelect={vi.fn()} />);
    expect(screen.getByTestId("rail-a")).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("rail-b")).not.toHaveAttribute("aria-current");
    for (const id of ["a", "b"]) expect(screen.getByTestId(`rail-${id}`)).toHaveClass("tb-select");

    rerender(<CategoryRail categories={categories} selectedId="b" onSelect={vi.fn()} />);
    expect(screen.getByTestId("rail-a")).not.toHaveAttribute("aria-current");
    expect(screen.getByTestId("rail-b")).toHaveAttribute("aria-current", "true");
  });

  it("the diet chips carry tb-select, driven by aria-pressed", () => {
    store.dispatch(setTags({ tags: ["veg", "non-veg"] }));
    store.dispatch(setFilters(["veg"]));
    render(<MenuFilterChips enabled />, { wrapper });
    expect(screen.getByTestId("menu-filter-veg")).toHaveClass("tb-select");
    expect(screen.getByTestId("menu-filter-veg")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("menu-filter-non-veg")).toHaveClass("tb-select");
    expect(screen.getByTestId("menu-filter-non-veg")).toHaveAttribute("aria-pressed", "false");
  });

  it("the size picker: both tile kinds carry tb-select; the picked radio's check pops in", () => {
    const entity = {
      id: "box",
      name: "Box",
      variants: [
        { id: "v-l", name: "Large", price: 8, isActive: true },
        { id: "v-r", name: "Regular", price: 6, isActive: true },
      ],
    };
    render(<SelectSizeModal entity={entity} onClose={vi.fn()} onContinue={vi.fn()} />, { wrapper });
    const tile = screen.getByTestId("size-v-r");
    expect(screen.getByTestId("size-v-l")).toHaveClass("tb-select");
    expect(tile).toHaveClass("tb-select");

    fireEvent.click(tile);
    expect(tile).toHaveAttribute("aria-pressed", "true");
    expect(tile.querySelector("img[src*='radio-check']")).toHaveClass("tb-pop-in");
  });

  it("the option card: the button variant bumps (tb-select) and its check pops; an errored overlay card shakes", () => {
    const { rerender } = render(<OptionCard testId="c" image={null} name="N" radio="off" onSelect={vi.fn()} />);
    const button = screen.getByTestId("c");
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveClass("tb-select");
    expect(button).not.toHaveClass("tb-press-card");
    expect(button).not.toHaveClass("tb-shake");

    rerender(<OptionCard testId="c" image={null} name="N" radio="on" onSelect={vi.fn()} />);
    expect(screen.getByTestId("c")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("c").querySelector("img")).toHaveClass("tb-pop-in");

    rerender(
      <OptionCard
        testId="c"
        image={null}
        name="N"
        radio="off"
        errored
        cta={{ label: "SWAP", onClick: vi.fn(), testId: "cta" }}
        onSelect={vi.fn()}
        selectLabel="Open"
        selectTestId="open"
      />
    );
    const card = screen.getByTestId("c");
    expect(card.tagName).toBe("DIV");
    expect(card).toHaveClass("tb-press-card", "tb-shake", "ring-4", "ring-red-500");
    expect(card).not.toHaveClass("tb-select");
  });

  it("Shift (the keyboard's one toggle) carries tb-select, driven by aria-pressed", () => {
    render(<KioskKeyboard value="" onChange={vi.fn()} onSubmit={vi.fn()} space />);
    const shift = Array.from(screen.getByTestId("kiosk-keyboard").querySelectorAll("button")).find((key) =>
      key.hasAttribute("aria-pressed")
    ) as HTMLButtonElement;
    expect(shift).toHaveClass("tb-select");
    expect(shift).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(shift);
    expect(shift).toHaveAttribute("aria-pressed", "true");
  });
});

describe("counts re-key a small leaf (§3.3)", () => {
  it("the bag mark is a NEW node after an add AND after an increment of an existing row — the SAME node otherwise; the mark it mounts with stays still (UX-02)", () => {
    render(<MenuCtaBar currency="£" onViewBag={vi.fn()} />, { wrapper });
    const bag = () => screen.getByTestId("cta-view-bag").querySelector("img") as HTMLImageElement;
    const empty = bag();
    expect(empty).not.toHaveClass("tb-bump");

    act(() => {
      store.dispatch(setCartItems([ROW])); // an add
    });
    const added = bag();
    expect(added).not.toBe(empty);
    expect(added).toHaveClass("tb-bump");

    act(() => {
      // + on the same row: one row, two units — the count is the bag
      // header's (units), the bag's Total moves with it.
      store.dispatch(setCartItems([{ ...ROW, quantity: 2 }]));
    });
    const incremented = bag();
    expect(incremented).not.toBe(added);
    expect(screen.getByTestId("cta-view-bag")).toHaveTextContent("(2)");
    expect(screen.getByTestId("cta-total")).toHaveTextContent(/£5$/);

    act(() => {
      store.dispatch(setCartItems([{ ...ROW, quantity: 2 }])); // nothing moved
    });
    expect(bag()).toBe(incremented);
  });

  it("the loyalty layout's count badge pops in, re-keyed per unit count", () => {
    store.dispatch(setKioskSettings({ enable_loyalty: true }));
    store.dispatch(setLoyaltyPartner({ partner: { partner_name: "Xeno" }, partnerDetails: { partner_name: "Xeno" } }));
    render(<MenuCtaBar currency="£" onViewBag={vi.fn()} onOpenRewards={vi.fn()} />, { wrapper });
    const badge = () =>
      screen.getByRole("button", { name: i18n.t("menu.viewMyBag") }).querySelector("span.tb-pop-in") as HTMLElement | null;
    const bag = () => screen.getByRole("button", { name: i18n.t("menu.viewMyBag") }).querySelector("img");
    expect(badge()).toBeNull(); // an empty bag has no badge
    const empty = bag();
    expect(empty).not.toBeNull();
    expect(empty).not.toHaveClass("tb-bump"); // UX-02: still at mount

    act(() => {
      store.dispatch(setCartItems([ROW]));
    });
    const one = badge();
    expect(one).toHaveTextContent(/^1$/);
    const added = bag();
    expect(added).not.toBe(empty); // this layout's bag mark re-keys too
    expect(added).toHaveClass("tb-bump");

    act(() => {
      store.dispatch(setCartItems([{ ...ROW, quantity: 2 }])); // + on the same row: a unit more
    });
    const two = badge();
    expect(two).not.toBe(one);
    expect(two).toHaveTextContent(/^2$/);
    expect(bag()).not.toBe(added); // …and the subtotal moved: the mark bumps

    act(() => {
      // Two rows of one: still two units — no replay.
      store.dispatch(setCartItems([ROW, { ...ROW, id: "r2", itemId: "y" }]));
    });
    expect(badge()).toBe(two);
    expect(badge()).toHaveTextContent(/^2$/);
  });

  it("the Counter value: a NEW inner leaf per value inside the SAME testid span; both controls take the lilac ring", () => {
    const props = { testId: "q", onDecrease: vi.fn(), onIncrease: vi.fn(), decreaseLabel: "-", increaseLabel: "+" };
    const { rerender } = render(<Counter {...props} value={1} />);
    const host = screen.getByTestId("q");
    const inner = host.firstElementChild;
    expect(inner).toHaveClass("tb-bump");

    rerender(<Counter {...props} value={1} />);
    expect(host.firstElementChild).toBe(inner);

    rerender(<Counter {...props} value={2} />);
    expect(screen.getByTestId("q")).toBe(host);
    expect(host.firstElementChild).not.toBe(inner);
    expect(host).toHaveTextContent("2");
    for (const id of ["q-decrease", "q-increase"]) expect(screen.getByTestId(id)).toHaveClass("active:border-tb-lilac");
  });

  it("the OptionRow qty and the GroupHeader 'n of m' re-key on a change, not on a same-value render", () => {
    const row = {
      testId: "r",
      image: null,
      name: "R",
      onDecrease: vi.fn(),
      onIncrease: vi.fn(),
      decreaseLabel: "-",
      increaseLabel: "+",
    };
    const { rerender } = render(<OptionRow {...row} qty={1} />);
    const qty = screen.getByTestId("r").querySelector(".tb-bump");
    expect(qty).toHaveTextContent("1");
    rerender(<OptionRow {...row} qty={1} />);
    expect(screen.getByTestId("r").querySelector(".tb-bump")).toBe(qty);
    rerender(<OptionRow {...row} qty={2} />);
    expect(screen.getByTestId("r").querySelector(".tb-bump")).not.toBe(qty);

    const header = render(<GroupHeader name="G" count={1} max={3} />);
    const count = header.container.querySelector(".tb-bump");
    expect(count).not.toBeNull();
    header.rerender(<GroupHeader name="G" count={1} max={3} />);
    expect(header.container.querySelector(".tb-bump")).toBe(count);
    header.rerender(<GroupHeader name="G" count={2} max={3} />);
    expect(header.container.querySelector(".tb-bump")).not.toBe(count);
  });

  it("the rail-card count pill pops in, re-keyed per quantity", () => {
    const card = (quantity: number) => (
      <ForYouCard
        entity={{ id: "e", name: "E", price: 2, isDirectlyAddable: true }}
        title="E"
        price={2}
        currency="£"
        quantity={quantity}
        addLabel="Add"
        customizeLabel="Customize"
        testId="card"
        onAdd={vi.fn()}
      />
    );
    const { rerender } = render(card(0));
    const pill = () => screen.getByTestId("card").querySelector(".tb-pop-in");
    expect(pill()).toBeNull();

    rerender(card(1));
    const one = pill();
    expect(one).toHaveTextContent(/^1$/);
    rerender(card(1));
    expect(pill()).toBe(one);
    rerender(card(2));
    expect(pill()).not.toBe(one);
    expect(pill()).toHaveTextContent(/^2$/);
  });
});

describe("press (§3.1)", () => {
  it("a menu card is tb-press-card with its overlay as a DIRECT empty child", () => {
    render(
      <MenuItemCard entity={{ id: "x", name: "X", price: "1" }} currency="£" onOpen={vi.fn()} onQuickAdd={vi.fn()} />,
      { wrapper }
    );
    const card = screen.getByTestId("item-x");
    expect(card).toHaveClass("tb-press-card");
    expect(card.querySelectorAll(":scope > button:empty")).toHaveLength(1);
    expect(card.querySelector(":scope > button:empty")).toHaveAccessibleName("X");
    // The quick add is not empty: pressing it never squeezes the card.
    expect(screen.getByTestId("quick-add-x").matches(":empty")).toBe(false);
  });

  it("an option card with a CTA squeezes through its direct empty overlay — never through the nested CTA", () => {
    render(
      <OptionCard
        testId="c"
        image={null}
        name="N"
        cta={{ label: "SWAP", onClick: vi.fn(), testId: "cta" }}
        onSelect={vi.fn()}
        selectLabel="Open"
        selectTestId="open"
      />
    );
    const card = screen.getByTestId("c");
    expect(card).toHaveClass("tb-press-card");
    expect(card.querySelector(":scope > button:empty")).toBe(screen.getByTestId("open"));
    expect(screen.getByTestId("cta").parentElement).not.toBe(card);
  });

  it("a slot-sheet row is tb-press-card with its pick overlay as a direct empty child; the picked check pops in", () => {
    render(
      <SlotSelectionSheet
        open
        group={{ _id: "g", name: "Side", min: 1, max: 1 }}
        options={[{ id: "o1", name: "Cola", price: 0 }]}
        currency="£"
        canCustomize={() => true}
        onSave={vi.fn()}
        onCustomize={vi.fn()}
        onClose={vi.fn()}
      />,
      { wrapper }
    );
    const pick = screen.getByTestId("slot-option-o1");
    const row = pick.parentElement as HTMLElement;
    expect(row).toHaveClass("tb-press-card");
    expect(row.querySelector(":scope > button:empty")).toBe(pick);
    expect(screen.getByTestId("slot-customize-o1").parentElement).not.toBe(row);

    fireEvent.click(pick);
    expect(row.querySelector("img[src*='radio-check']")).toHaveClass("tb-pop-in");
  });

  it("CtaBar BACK: a group button whose label takes the Figma pressed colour (1:558)", () => {
    render(<CtaBar backTestId="back" backLabel="BACK" onBack={vi.fn()} actionTestId="act" action="ADD" onAction={vi.fn()} />);
    expect(screen.getByTestId("back")).toHaveClass("group");
    expect(screen.getByText("BACK")).toHaveClass("group-active:text-tb-purple-press", "text-tb-surface");
  });

  it("keyboard keys: tb-no-press with the 2 px travel; letters press #883ED2, the grey specials Grey 3", () => {
    render(<KioskKeyboard value="" onChange={vi.fn()} onSubmit={vi.fn()} space />);
    const keys = Array.from(screen.getByTestId("kiosk-keyboard").querySelectorAll("button"));
    expect(keys.length).toBeGreaterThan(30);
    for (const key of keys) expect(key).toHaveClass("tb-no-press", "active:translate-y-[2px]");

    const letter = screen.getByRole("button", { name: "q" });
    expect(letter).toHaveClass("active:bg-tb-purple-press");
    expect(letter).not.toHaveClass("active:bg-tb-grey-3");
    const specials = keys.filter((key) => key.classList.contains("bg-tb-grey-4"));
    expect(specials).toHaveLength(5); // shift, backspace, 123, space, GO
    for (const key of specials) {
      expect(key).toHaveClass("active:bg-tb-grey-3");
      expect(key).not.toHaveClass("active:bg-tb-purple-press");
    }
  });

  it("numpad keys: tb-no-press; digits press #883ED2, CLEAR / backspace / GO Grey 3", () => {
    render(<KioskNumpad value="" onChange={vi.fn()} onSubmit={vi.fn()} />);
    const keys = Array.from(screen.getByTestId("kiosk-numpad").querySelectorAll("button"));
    expect(keys).toHaveLength(13);
    for (const key of keys) expect(key).toHaveClass("tb-no-press");
    for (const digit of ["0", "1", "9"]) {
      expect(screen.getByTestId(`numpad-key-${digit}`)).toHaveClass("active:bg-tb-purple-press");
    }
    for (const id of ["numpad-clear", "numpad-backspace", "numpad-go"]) {
      expect(screen.getByTestId(id)).toHaveClass("active:bg-tb-grey-3");
      expect(screen.getByTestId(id)).not.toHaveClass("active:bg-tb-purple-press");
    }
  });
});

describe("celebrations (motion-v2 MV5)", () => {
  // Pop and burst together, as on Order Complete. No delay: tb-pop-in's backwards fill would hide the seal
  // and its pieces for the delay, and the front-loaded burst (--d 0–180 ms from mount) would fly unseen.
  it("the loyalty-unlock seal pops in with no delay and bursts once from inside it (28 pieces)", () => {
    store.dispatch(openLoyaltyModal({ isOpen: true, item: { id: "reward" } }));
    render(<LoyaltySuccessModal />, { wrapper });

    const popping = screen.getByTestId("loyalty-success").querySelectorAll(".tb-pop-in");
    expect(popping).toHaveLength(1);
    const seal = popping[0] as HTMLElement;
    expect(seal).toHaveClass("relative", "h-[356px]", "w-[356px]");
    expect(seal).toHaveAttribute("aria-hidden", "true");
    expect(seal.className).not.toMatch(/delay/);
    expect(seal.style.animationDelay).toBe("");
    expect(seal.querySelectorAll(".tb-confetti-piece")).toHaveLength(28);
    expect(screen.getByTestId("loyalty-success").querySelectorAll(".tb-confetti-piece")).toHaveLength(28);
  });
});
