import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { setPipelines } from "@cx-sdk/catalog/state/pipeline.slice";
import { setPipelineStatuses } from "@cx-sdk/catalog/state/kioskOpenStatus.slice";
import { setLanguages } from "../../../redux/features/multiLanguage/multiLanguage.slice";
import { store } from "../../../redux/app/store";
import SecondLayout from "../index";
import "../../../i18n";

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
    expect(screen.getByText("menu-screen")).toBeInTheDocument();
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
