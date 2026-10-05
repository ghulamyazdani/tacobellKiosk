import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setPipelines } from "@cx-sdk/catalog/state/pipeline.slice";
import { store } from "../../../redux/app/store";
import SecondLayout from "../index";
import "../../../i18n";

/*
  P9a (D10, Rule 1): the menu fetch behind a pipeline tap is not idle-held,
  so the session can end (idle -> /start) while it is in flight. Its late
  answer must not drive the emptied kiosk off the splash into /menu.
  fetchMenu is the seam: the test answers it by hand. useNavigate is a spy.
*/

const mockNavigate = vi.fn();
const mockFetchMenu = vi.fn();

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mockNavigate,
}));

vi.mock("../../../hooks/menuHooks/useMenuConverters", () => ({
  default: () => ({
    fetchMenu: (...args: unknown[]) => mockFetchMenu(...args),
  }),
}));

const PIPELINE = {
  _id: "p-take",
  tab_id: "t2",
  tab_type: "take_away",
  primary_name: "Take Out",
};

const mount = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/second"]}>
        <SecondLayout />
      </MemoryRouter>
    </Provider>
  );

/** A menu that loaded (P9b: an empty `{}` now means the fetch failed). */
const LOADED_MENU = { categories: [{ id: "c1" }] };

/** Tap the pipeline; the menu fetch stays in flight until `answer()`. */
const tapPipelineWithFetchInFlight = () => {
  let answer!: (menu: unknown) => void;
  mockFetchMenu.mockReturnValue(
    new Promise((resolve) => {
      answer = resolve;
    })
  );
  act(() => {
    fireEvent.click(screen.getByTestId("pipeline-p-take"));
  });
  expect(mockFetchMenu).toHaveBeenCalledTimes(1);
  return async () => {
    await act(async () => {
      answer(LOADED_MENU);
      await Promise.resolve();
    });
  };
};

describe("SecondLayout — a late menu fetch never navigates (P9a, D10)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setPipelines([PIPELINE]));
    mockNavigate.mockReset();
    mockFetchMenu.mockReset();
  });

  it("answered while the screen is up: continues to the menu", async () => {
    mount();
    const answer = tapPipelineWithFetchInFlight();

    await answer();

    expect(mockNavigate).toHaveBeenCalledWith("/menu");
  });

  it("answered after the session ended (screen unmounted): stays put", async () => {
    const view = mount();
    const answer = tapPipelineWithFetchInFlight();

    view.unmount();
    await answer();

    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
