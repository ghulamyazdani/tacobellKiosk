import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  openMakeItAMealSession,
  setTier1BottomSheetAndSelectedEntity,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import { setSelectedLanguage } from "../../../redux/features/multiLanguage/multiLanguage.slice";
import Customization from "../index";
import i18n from "../../../i18n";

/*
  Post-P9 28 on the PDP: the title, group titles, option names (stepper and
  grid), the stepper aria-labels, the variant cards and the change-size label
  follow the menu's ar aliases in an Arabic session — FSI…PDI isolated, with
  every accessible name containing its visible label (WCAG 2.5.3). The
  description is the RAW translation in a dir="auto" leaf (w-fit, text-start),
  never isolated. Nothing translated is ever written to the store.
*/

const FSI = "⁨";
const PDI = "⁩";
const iso = (s: string) => `${FSI}${s}${PDI}`;
const ISOLATES = /[⁦-⁩]/;
const AR = (value: string) => [{ value, name: "Arabic", code: "ar", dir: "rtl" }];

const AR_BURGER = "تشيز برجر";
const AR_EXTRAS = "إضافات";
const AR_PICKLES = "مخلل إضافي";
const AR_SAUCE = "الصلصة";
const AR_MILD = "صلصة خفيفة";
const AR_DESCRIPTION = "برجر لحم مع جبنة ذائبة";
const AR_DRINK = "بيبسي";
const AR_LARGE = "كبير";

const AR_SESSION = { name: "Arabic", code: "ar", dir: "rtl", type: "secondary_language" };
const EN_SESSION = { name: "English", code: "en", dir: "ltr", type: "primary_language" };

/** multiplePunchMaxItem > 1 → stepper rows. */
const EXTRAS = {
  _id: "pdp_extras",
  name: "Extras",
  aliases: AR(AR_EXTRAS),
  min: 0,
  max: 3,
  multiplePunchMin: 0,
  multiplePunchMax: 3,
  multiplePunchMaxItem: 3,
  order: 1,
  isActive: true,
  constituentItems: [
    { id: "pickles", name: "Extra Pickles", aliases: AR(AR_PICKLES), price: 0, isActive: true },
  ],
};

/** multiplePunchMaxItem 1 → grid tiles. */
const SAUCE = {
  _id: "pdp_sauce",
  name: "Sauce",
  aliases: AR(AR_SAUCE),
  min: 0,
  max: 1,
  multiplePunchMin: 0,
  multiplePunchMax: 1,
  multiplePunchMaxItem: 1,
  order: 2,
  isActive: true,
  constituentItems: [
    { id: "mild", name: "Mild Sauce", aliases: AR(AR_MILD), price: 0.5, isActive: true },
  ],
};

const BURGER = {
  id: "cheese-burger",
  name: "Cheese Burger",
  aliases: AR(AR_BURGER),
  price: 8,
  description: "Beef patty with melted cheese",
  _extra: { descriptionTranslation: AR_DESCRIPTION },
  modifiers: [EXTRAS._id, SAUCE._id],
};

const DRINK = {
  id: "pepsi",
  name: "Pepsi",
  aliases: AR(AR_DRINK),
  price: 0,
  hasVariant: true,
  variants: [
    { id: "pepsi-l", name: "Large", aliases: AR(AR_LARGE), price: 3, isActive: true, modifiers: [] },
  ],
};

const seedPdp = (entity: object, type = "customizableItem") => {
  store.dispatch(setCurrency({ symbol: "£" }));
  store.dispatch(setModifiersMap({ modifiersMap: { [EXTRAS._id]: EXTRAS, [SAUCE._id]: SAUCE } }));
  store.dispatch(openMakeItAMealSession());
  store.dispatch(
    setTier1BottomSheetAndSelectedEntity({
      bottomSheet: { isOpen: true, status: "", type, openType: "new", editCustomizationContent: {} },
      selectedEntity: entity,
    })
  );
};

const renderPdp = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/customization"]}>
        <Routes>
          <Route path="/customization" element={<Customization />} />
          <Route path="/menu" element={<div>menu-screen</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );

const arabicSession = async () => {
  store.dispatch(setSelectedLanguage(AR_SESSION));
  await act(async () => {
    await i18n.changeLanguage("ar");
  });
};

const title = () => screen.getByRole("heading", { level: 1 }).textContent;
const groupTitles = () =>
  screen
    .getAllByRole("heading", { level: 3 })
    .map((h) => h.textContent)
    .filter((text) => text !== i18n.t("size.title"));

describe("PDP names in the guest's language (post-P9 28)", () => {
  beforeAll(() => {
    // jsdom has no Element.scrollTo; the hook's autoscroll paths call it.
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("English: title, groups and options are the plain names; the description is the plain one", () => {
    seedPdp(BURGER);
    renderPdp();

    expect(title()).toBe("Cheese Burger");
    expect(groupTitles()).toEqual(["Extras", "Sauce"]);
    expect(screen.getByRole("button", { name: `${i18n.t("pdp.increase")} Extra Pickles` })).toBeInTheDocument();
    expect(screen.getByText("Beef patty with melted cheese")).toHaveAttribute("dir", "auto");
    expect(screen.getByTestId("customization-screen").textContent).not.toMatch(ISOLATES);
  });

  it("Arabic: the title and the group titles are the aliases, isolated", async () => {
    await arabicSession();
    seedPdp(BURGER);
    renderPdp();

    expect(title()).toBe(iso(AR_BURGER));
    expect(groupTitles()).toEqual([iso(AR_EXTRAS), iso(AR_SAUCE)]);
  });

  it("Arabic: stepper rows show the alias and both stepper buttons are named by it (label-in-name)", async () => {
    await arabicSession();
    seedPdp(BURGER);
    renderPdp();

    expect(screen.getByText(iso(AR_PICKLES))).toBeInTheDocument();
    const increase = screen.getByRole("button", { name: `${i18n.t("pdp.increase")} ${iso(AR_PICKLES)}` });
    const decrease = screen.getByRole("button", { name: `${i18n.t("pdp.decrease")} ${iso(AR_PICKLES)}` });
    expect(increase.getAttribute("aria-label")).toContain(iso(AR_PICKLES));
    expect(decrease.getAttribute("aria-label")).toContain(iso(AR_PICKLES));
    expect(screen.queryByText(/Extra Pickles/)).not.toBeInTheDocument();
  });

  it("Arabic: a grid option tile shows the alias (its accessible name is its text)", async () => {
    await arabicSession();
    seedPdp(BURGER);
    renderPdp();

    const tile = screen.getByTestId("pdp-option-mild");
    expect(tile).toHaveTextContent(iso(AR_MILD), { normalizeWhitespace: false });
    expect(tile).not.toHaveTextContent("Mild Sauce");
    expect(tile.getAttribute("aria-label")).toBeNull();
  });

  it("Arabic: the description is the raw translation in a dir='auto' leaf — never isolated", async () => {
    await arabicSession();
    seedPdp(BURGER);
    renderPdp();

    const description = screen.getByText(AR_DESCRIPTION);
    expect(description.tagName).toBe("P");
    expect(description.textContent).toBe(AR_DESCRIPTION);
    expect(description.textContent).not.toMatch(ISOLATES);
    expect(description).toHaveAttribute("dir", "auto");
    expect(description).toHaveClass("w-fit", "text-start", "max-w-[860px]");
    expect(description.childElementCount).toBe(0);
  });

  it("Arabic: the variant cards and the change-size label show the variant alias", async () => {
    await arabicSession();
    seedPdp(DRINK, "variant");
    renderPdp();

    expect(title()).toBe(iso(AR_DRINK));
    const card = screen.getByTestId("pdp-variant-pepsi-l");
    expect(card).toHaveTextContent(iso(AR_LARGE), { normalizeWhitespace: false });
    expect(card).not.toHaveTextContent("Large");

    fireEvent.click(card);

    const change = screen.getByTestId("pdp-change-size");
    expect(change.textContent).toBe(`${iso(AR_LARGE)} · ${i18n.t("pdp.change")}`);
  });

  it("switching back to English restores every name, unisolated", async () => {
    await arabicSession();
    seedPdp(BURGER);
    renderPdp();
    expect(title()).toBe(iso(AR_BURGER));

    act(() => {
      store.dispatch(setSelectedLanguage(EN_SESSION));
    });

    expect(title()).toBe("Cheese Burger");
    expect(groupTitles()).toEqual(["Extras", "Sauce"]);
    expect(screen.getByTestId("pdp-option-mild")).toHaveTextContent("Mild Sauce");
    expect(screen.getByText("Beef patty with melted cheese")).toBeInTheDocument();
    expect(screen.queryByText(AR_DESCRIPTION)).not.toBeInTheDocument();
  });

  it("the store never holds a translated name: the selected entity keeps its primary name", async () => {
    await arabicSession();
    seedPdp(BURGER);
    renderPdp();
    fireEvent.click(screen.getByRole("button", { name: `${i18n.t("pdp.increase")} ${iso(AR_PICKLES)}` }));
    fireEvent.click(screen.getByTestId("pdp-option-mild"));

    expect(JSON.stringify(store.getState())).not.toMatch(ISOLATES);
  });
});
