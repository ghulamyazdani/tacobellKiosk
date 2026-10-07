import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { setPipelines } from "@cx-sdk/catalog/state/pipeline.slice";
import { setPipelineStatuses } from "@cx-sdk/catalog/state/kioskOpenStatus.slice";
import {
  setKioskSettings,
  toggleAccessibilityMode,
} from "@cx-sdk/catalog/state/appSettings.slice";
import {
  setLanguages,
  setSelectedLanguage,
} from "../../../redux/features/multiLanguage/multiLanguage.slice";
import { store } from "../../../redux/app/store";
import SecondLayout from "../index";
import i18n from "../../../i18n";

// The menu fetch is the network seam (P9b: SecondLayout now enters the menu
// only when the fetch RETURNS categories). The failure paths live in
// SecondLayoutMenuError.test.tsx.
vi.mock("../../../hooks/menuHooks/useMenuConverters", () => ({
  default: () => ({
    fetchMenu: () => Promise.resolve({ categories: [{ id: "c1" }] }),
  }),
}));

const PIPELINES = [
  { _id: "p-dine", tab_id: "t1", tab_type: "dine_in", primary_name: "Dine In" },
  { _id: "p-take", tab_id: "t2", tab_type: "take_away", primary_name: "Take Out" },
];

const renderSecond = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/second"]}>
        <Routes>
          <Route path="/second" element={<SecondLayout />} />
          <Route path="/menu" element={<div>menu-screen</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );

describe("SecondLayout (order type — Figma 1:2581)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setPipelines(PIPELINES));
    store.dispatch(
      setLanguages({
        primary_language: { name: "English", code: "en" },
        secondary_language: { name: "العربية", code: "ar" },
      })
    );
  });

  it("renders one card per CX pipeline", () => {
    renderSecond();
    expect(screen.getByTestId("pipeline-p-dine")).toHaveTextContent("Dine In");
    expect(screen.getByTestId("pipeline-p-take")).toHaveTextContent("Take Out");
  });

  it("selecting a pipeline stores it and navigates to the menu", async () => {
    renderSecond();
    await userEvent.click(screen.getByTestId("pipeline-p-take"));
    // findBy: the navigate follows the (async) menu fetch.
    expect(await screen.findByText("menu-screen")).toBeInTheDocument();
    const state = store.getState() as {
      pipeline: { selectedPipeline: { _id: string }; tabType: string };
      auth: { tab_id?: string };
    };
    expect(state.pipeline.selectedPipeline._id).toBe("p-take");
    expect(state.pipeline.tabType).toBe("take_away");
    // SDK quirk preserved from legacy: setSelectedTabId writes tab_id
    // (selectedTabId is a documented dead field).
    expect(state.auth.tab_id).toBe("t2");
  });

  it("a CLOSED pipeline is disabled and cannot be selected", async () => {
    store.dispatch(
      setPipelineStatuses({
        "p-dine": { status: false, reason: "Store closed" },
      })
    );
    renderSecond();
    const card = screen.getByTestId("pipeline-p-dine");
    expect(card).toBeDisabled();
    expect(card).toHaveTextContent(/closed/i);
  });

  it("language sheet lists CX languages and switches the app language", async () => {
    renderSecond();
    await userEvent.click(screen.getByTestId("footer-language"));
    expect(screen.getByTestId("language-sheet")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("language-ar"));
    const state = store.getState() as {
      multiLanguage: { selectedLanguage: { code: string; dir: string } };
    };
    expect(state.multiLanguage.selectedLanguage.code).toBe("ar");
    expect(state.multiLanguage.selectedLanguage.dir).toBe("rtl");
  });
});

/*
  P9c (A8 — design-language, no Figma frame; flagged for client sign-off):
  in the ADA view the page renders into the 1122px reach zone. The bell is
  dropped (the brand zone above carries the lockup), cards are never shrunk,
  and with more than two pipelines the second card ROW would not fit, so the
  cards become one horizontal swipe row. Normal mode wraps up to four (two
  rows under the bell, lane fonts fixer); five or more take the swipe row too.
*/
describe("SecondLayout in the ADA reach zone (P9c)", () => {
  const THIRD = {
    _id: "p-drive",
    tab_id: "t3",
    tab_type: "delivery",
    primary_name: "Drive Thru",
  };
  const bell = () => screen.queryByAltText("Taco Bell");
  const cardRow = () => screen.getByTestId("pipeline-p-dine").parentElement;

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setPipelines(PIPELINES));
  });

  it("normal mode keeps the bell and the wrapping card grid", () => {
    renderSecond();

    expect(bell()).toBeInTheDocument();
    expect(cardRow()?.className).toContain("flex-wrap");
  });

  it("ADA drops the bell and keeps every card and the whole footer on a reach-zone-high page", () => {
    store.dispatch(toggleAccessibilityMode());
    renderSecond();

    expect(bell()).not.toBeInTheDocument();
    expect(screen.getByTestId("second-screen").className).toContain("h-full");
    expect(screen.getByTestId("pipeline-p-dine")).toBeEnabled();
    expect(screen.getByTestId("pipeline-p-take")).toBeEnabled();
    for (const id of ["footer-cancel", "footer-ada", "footer-language"]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    // Two cards still fit one row: no needless scroller.
    expect(cardRow()?.className).toContain("flex-wrap");
  });

  it("ADA with more than two pipelines: one swipe row of full-size cards", () => {
    store.dispatch(setPipelines([...PIPELINES, THIRD]));
    store.dispatch(toggleAccessibilityMode());
    renderSecond();

    const row = cardRow();
    expect(row?.className).toContain("overflow-x-auto");
    expect(row?.className).not.toContain("flex-wrap");
    for (const id of ["p-dine", "p-take", "p-drive"]) {
      const card = screen.getByTestId(`pipeline-${id}`);
      expect(row).toContainElement(card);
      // shrink-0: a nowrap row would otherwise squeeze the 416px cards.
      expect(card.className).toContain("shrink-0");
      expect(card.className).toContain("h-[416px] w-[416px]");
    }
  });

  it("normal mode wraps three pipelines under the bell; five take the swipe row", () => {
    store.dispatch(setPipelines([...PIPELINES, THIRD]));
    const { unmount } = renderSecond();

    expect(cardRow()?.className).toContain("flex-wrap");
    expect(screen.getByTestId("pipeline-p-drive").className).not.toContain(
      "shrink-0"
    );
    // Anchored at the 2-card block's top, not centred: centred, the 2-row
    // block climbs over the bell (visual-entry ORDER TYPE 3/5 measures it).
    expect(cardRow()?.parentElement?.className).toContain("top-[573px]");
    unmount();

    const more = [4, 5].map((n) => ({ ...THIRD, _id: `p-${n}`, tab_id: `t${n}` }));
    store.dispatch(setPipelines([...PIPELINES, THIRD, ...more]));
    renderSecond();
    expect(cardRow()?.className).toContain("overflow-x-auto");
    expect(cardRow()?.parentElement?.className).toContain("top-1/2");
  });
});

/*
  Post-P9 27b (D5): the ticker shows the guest's slot of
  kiosk_settings.pipeline_text_* when set — no cross-language fallback —
  otherwise DaypartTicker keeps t("ticker.lunch"). 28: the card label is
  the pipeline's secondary_name in a secondary-language session.
*/
describe("SecondLayout — server-driven ticker copy and pipeline names (post-P9 27b / 28)", () => {
  const FSI = "\u2068";
  const PDI = "\u2069";
  const iso = (s: string) => `${FSI}${s}${PDI}`;
  const AR_TICKER = "ساعة سعيدة";
  const AR_DINE = "تناول في المطعم";
  const AR_SESSION = { name: "Arabic", code: "ar", dir: "rtl", type: "secondary_language" };
  const EN_SESSION = { name: "English", code: "en", dir: "ltr", type: "primary_language" };
  /** DaypartTicker: six cells × two copies. */
  const CELLS = 12;

  const arabicSession = async () => {
    store.dispatch(setSelectedLanguage(AR_SESSION));
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
  };

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(
      setPipelines([{ ...PIPELINES[0], secondary_name: AR_DINE }, PIPELINES[1]])
    );
    store.dispatch(
      setLanguages({
        primary_language: { name: "English", code: "en" },
        secondary_language: { name: "Arabic", code: "ar" },
      })
    );
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("English shows pipeline_text_primary (trimmed), never the secondary text", () => {
    store.dispatch(
      setKioskSettings({ pipeline_text_primary: " HAPPY HOUR 2-4PM ", pipeline_text_secondary: AR_TICKER })
    );
    renderSecond();

    expect(screen.getAllByText("HAPPY HOUR 2-4PM")).toHaveLength(CELLS);
    expect(screen.queryByText(i18n.t("ticker.lunch"))).not.toBeInTheDocument();
    expect(screen.getByTestId("second-screen")).not.toHaveTextContent(AR_TICKER);
  });

  it("Arabic shows pipeline_text_secondary, isolated", async () => {
    store.dispatch(
      setKioskSettings({ pipeline_text_primary: "HAPPY HOUR", pipeline_text_secondary: AR_TICKER })
    );
    await arabicSession();
    renderSecond();

    expect(screen.getAllByText(iso(AR_TICKER))).toHaveLength(CELLS);
    expect(screen.getByTestId("second-screen")).not.toHaveTextContent("HAPPY HOUR");
  });

  it("Arabic with only the primary text shows the Arabic ticker.lunch", async () => {
    store.dispatch(setKioskSettings({ pipeline_text_primary: "HAPPY HOUR" }));
    await arabicSession();
    renderSecond();

    expect(screen.getAllByText(i18n.t("ticker.lunch"))).toHaveLength(CELLS);
    expect(i18n.t("ticker.lunch").startsWith(FSI)).toBe(true);
    expect(screen.getByTestId("second-screen")).not.toHaveTextContent("HAPPY HOUR");
  });

  it.each<[string, unknown]>([
    ["unset", undefined],
    ["blank", "   "],
    ["empty", ""],
    ["a number", 42],
    ["an object", { text: "HAPPY" }],
  ])("%s pipeline_text_primary shows ticker.lunch", (_label, value) => {
    store.dispatch(setKioskSettings({ pipeline_text_primary: value }));
    renderSecond();

    expect(screen.getAllByText("It's lunch time!")).toHaveLength(CELLS);
  });

  it("28: an Arabic session labels the card with secondary_name (isolated), falling back to primary_name", async () => {
    await arabicSession();
    renderSecond();

    expect(screen.getByTestId("pipeline-p-dine")).toHaveTextContent(iso(AR_DINE), { normalizeWhitespace: false });
    expect(screen.getByTestId("pipeline-p-dine")).not.toHaveTextContent("Dine In");
    // No secondary_name → the primary name, isolated like any RTL value.
    expect(screen.getByTestId("pipeline-p-take")).toHaveTextContent(iso("Take Out"), { normalizeWhitespace: false });
  });

  it("28: switching back to English restores the primary names, unisolated", async () => {
    await arabicSession();
    renderSecond();
    expect(screen.getByTestId("pipeline-p-dine")).not.toHaveTextContent("Dine In");

    act(() => {
      store.dispatch(setSelectedLanguage(EN_SESSION));
    });

    expect(screen.getByTestId("pipeline-p-dine")).toHaveTextContent("Dine In");
    expect(screen.getByTestId("pipeline-p-dine").textContent).not.toMatch(/[\u2066-\u2069]/);
    expect(screen.getByTestId("pipeline-p-take")).toHaveTextContent("Take Out");
  });
});
