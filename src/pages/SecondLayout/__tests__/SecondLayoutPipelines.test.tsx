import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { selectPipelines, setPipelines } from "@cx-sdk/catalog/state/pipeline.slice";
import {
  setGeneralSettings,
  toggleAccessibilityMode,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import SecondLayout from "../index";
import i18n from "../../../i18n";

/*
  Lane figma-polish S3 — /second shows only the pipelines that are NOT
  deactivated for this device (the deactivated_pipelines general setting),
  in their configured `order` (missing = 0, a stable sort over a copy), as the
  fork does (SecondLayout.tsx:86-91). The visible list drives everything: the
  card layout (swipe row / two rows), the mount's open-state refresh and the
  cards. None left → one translated line instead of a blank screen; the
  footer CANCEL still exits (Rule 1).
  Seams: navigation, the menu fetch and the open-state refresh (network).
*/

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), checkAll: vi.fn() }));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mocks.navigate,
}));

vi.mock("../../../hooks/menuHooks/useMenuConverters", () => ({
  default: () => ({ fetchMenu: () => Promise.resolve({ categories: [{ id: "c1" }] }) }),
}));

vi.mock("../../../hooks/kioskOpen/useKioskOpenServices", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../hooks/kioskOpen/useKioskOpenServices")>();
  return {
    default: () => ({
      ...actual.default(),
      checkAllPipelinesWithIds: (ids: string[]) => {
        mocks.checkAll(ids);
        return Promise.resolve(false);
      },
    }),
  };
});

const pipeline = (id: string, order?: number) => ({
  _id: id,
  tab_id: `tab-${id}`,
  tab_type: "take_away",
  primary_name: id.toUpperCase(),
  ...(order === undefined ? {} : { order }),
});

const deactivate = (ids: string[]) =>
  store.dispatch(setGeneralSettings([{ setting_id: "deactivated_pipelines", value: { value: ids } }]));

const renderSecond = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/second"]}>
        <SecondLayout />
      </MemoryRouter>
    </Provider>
  );

/** The rendered cards, in DOM order. */
const cardIds = () =>
  screen.queryAllByTestId(/^pipeline-/).map((card) => card.getAttribute("data-testid")?.replace("pipeline-", ""));
const cardRow = () => screen.getAllByTestId(/^pipeline-/)[0].parentElement as HTMLElement;

describe("/second — deactivated pipelines and the configured order (S3)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    mocks.navigate.mockReset();
    mocks.checkAll.mockReset();
  });

  it("a pipeline deactivated for this device is not rendered; the rest are", () => {
    store.dispatch(setPipelines([pipeline("p-dine"), pipeline("p-take"), pipeline("p-drive")]));
    deactivate(["p-take"]);
    renderSecond();

    expect(cardIds()).toEqual(["p-dine", "p-drive"]);
    expect(screen.queryByTestId("pipeline-p-take")).not.toBeInTheDocument();
    expect(screen.queryByTestId("second-no-pipelines")).not.toBeInTheDocument();
  });

  it("no setting (or a non-array value) hides nothing", () => {
    store.dispatch(setPipelines([pipeline("p-dine"), pipeline("p-take")]));
    store.dispatch(setGeneralSettings([{ setting_id: "deactivated_pipelines", value: { value: "p-take" } }]));
    renderSecond();

    expect(cardIds()).toEqual(["p-dine", "p-take"]);
  });

  it("cards sort by `order` — a missing order is 0, ties keep the server order — without mutating the store's list", () => {
    const server = [pipeline("p-a", 2), pipeline("p-b"), pipeline("p-c", 1), pipeline("p-d", 0), pipeline("p-e")];
    store.dispatch(setPipelines(server));
    renderSecond();

    expect(cardIds()).toEqual(["p-b", "p-d", "p-e", "p-c", "p-a"]);
    expect((selectPipelines(store.getState()) as Array<{ _id: string }>).map((p) => p._id)).toEqual([
      "p-a",
      "p-b",
      "p-c",
      "p-d",
      "p-e",
    ]);
  });

  it("the mount's open-state refresh asks only for the VISIBLE ids (in card order)", () => {
    store.dispatch(setPipelines([pipeline("p-a", 2), pipeline("p-b", 1), pipeline("p-c", 0)]));
    deactivate(["p-b"]);
    renderSecond();

    expect(mocks.checkAll).toHaveBeenCalledTimes(1);
    expect(mocks.checkAll).toHaveBeenCalledWith(["p-c", "p-a"]);
  });

  it("layout counts the visible list: five pipelines with one hidden wrap in two rows, not the swipe row", () => {
    store.dispatch(setPipelines(["p1", "p2", "p3", "p4", "p5"].map((id) => pipeline(id))));
    deactivate(["p5"]);
    renderSecond();

    expect(cardIds()).toHaveLength(4);
    expect(cardRow().className).toContain("flex-wrap");
    expect(cardRow().className).not.toContain("overflow-x-auto");
    expect(cardRow().parentElement?.className).toContain("top-[573px]"); // twoRows
  });

  it("layout counts the visible list: three pipelines with one hidden are ONE centred row (no twoRows)", () => {
    store.dispatch(setPipelines(["p1", "p2", "p3"].map((id) => pipeline(id))));
    deactivate(["p3"]);
    renderSecond();

    expect(cardIds()).toEqual(["p1", "p2"]);
    expect(cardRow().parentElement?.className).toContain("top-1/2");
    expect(cardRow().parentElement?.className).not.toContain("top-[573px]");
  });

  it("ADA counts the visible list: three pipelines with one hidden keep the wrapping row (no swipe row)", () => {
    store.dispatch(setPipelines(["p1", "p2", "p3"].map((id) => pipeline(id))));
    deactivate(["p2"]);
    store.dispatch(toggleAccessibilityMode());
    renderSecond();

    expect(cardIds()).toEqual(["p1", "p3"]);
    expect(cardRow().className).toContain("flex-wrap");
    expect(screen.getByTestId("pipeline-p1").className).not.toContain("shrink-0");
  });

  it("every pipeline deactivated: the second.noPipelines line, no cards, no refresh — and CANCEL still goes to /start", () => {
    store.dispatch(setPipelines([pipeline("p-dine"), pipeline("p-take")]));
    deactivate(["p-dine", "p-take"]);
    renderSecond();

    const line = screen.getByTestId("second-no-pipelines");
    expect(line).toHaveTextContent(i18n.t("second.noPipelines"));
    expect(line.tagName).toBe("P");
    expect(cardIds()).toEqual([]);
    expect(mocks.checkAll).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(i18n.t("second.title"));

    fireEvent.click(screen.getByTestId("footer-cancel"));
    expect(mocks.navigate).toHaveBeenCalledWith("/start");
  });
});
