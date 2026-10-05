import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { setPipelines } from "@cx-sdk/catalog/state/pipeline.slice";
import { setPipelineStatuses } from "@cx-sdk/catalog/state/kioskOpenStatus.slice";
import { toggleAccessibilityMode } from "@cx-sdk/catalog/state/appSettings.slice";
import { setLanguages } from "../../../redux/features/multiLanguage/multiLanguage.slice";
import { store } from "../../../redux/app/store";
import SecondLayout from "../index";
import "../../../i18n";

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
  cards become one horizontal swipe row. Normal mode is unchanged.
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

  it("the swipe row is ADA-only: three pipelines in normal mode still wrap", () => {
    store.dispatch(setPipelines([...PIPELINES, THIRD]));
    renderSecond();

    expect(cardRow()?.className).toContain("flex-wrap");
    expect(screen.getByTestId("pipeline-p-drive").className).not.toContain(
      "shrink-0"
    );
  });
});
