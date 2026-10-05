import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setPipelines } from "@cx-sdk/catalog/state/pipeline.slice";
import { setKioskSettings } from "@cx-sdk/catalog/state/appSettings.slice";
import { setLoyaltyPartner } from "@cx-sdk/ordering/state/loyalty.slice";
import { store } from "../../../redux/app/store";
import SecondLayout from "../index";
import i18n from "../../../i18n";

/*
  P9b R8 — a menu that fails to load keeps the guest on /second. fetchMenu
  swallows EVERY failure and resolves {} (fork parity), so the screen judges
  the RETURNED categories — never the redux menu, which after a nextCustomer
  reset still holds the previous pipeline's items. Seams: fetchMenu (answered
  per test), useNavigate, the charges refresh, the open-status refresh and
  analytics.
*/

const { mockNavigate, mockFetchMenu, mockCharges, mockCapture } = vi.hoisted(
  () => ({
    mockNavigate: vi.fn(),
    mockFetchMenu: vi.fn(),
    mockCharges: vi.fn(),
    mockCapture: vi.fn(),
  })
);

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mockNavigate,
}));

vi.mock("../../../hooks/menuHooks/useMenuConverters", () => ({
  default: () => ({
    fetchMenu: (...args: unknown[]) => mockFetchMenu(...args),
  }),
}));

// The mount-time open-status refresh is network too (and off-topic here).
vi.mock("../../../hooks/kioskOpen/useKioskOpenServices", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../../hooks/kioskOpen/useKioskOpenServices")
  >();
  return {
    default: () => ({
      ...actual.default(),
      checkAllPipelinesWithIds: () => Promise.resolve(false),
    }),
  };
});

vi.mock("../../../hooks/utils/useAppSettings", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../../hooks/utils/useAppSettings")
  >();
  return {
    default: () => ({
      ...actual.default(),
      getChargesCountryDataApi: (...args: unknown[]) => mockCharges(...args),
    }),
  };
});

vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mockCapture(...args),
}));

const PIPELINE = {
  _id: "p-take",
  tab_id: "t2",
  tab_type: "take_away",
  primary_name: "Take Out",
};
const LOADED_MENU = { categories: [{ id: "c1" }] };

const mount = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/second"]}>
        <SecondLayout />
      </MemoryRouter>
    </Provider>
  );

/** Tap the pipeline and let its fetch settle with `menu`. */
const tapPipeline = async (menu: unknown) => {
  mockFetchMenu.mockResolvedValueOnce(menu);
  await act(async () => {
    fireEvent.click(screen.getByTestId("pipeline-p-take"));
  });
};

const tapRetry = async (menu: unknown) => {
  mockFetchMenu.mockResolvedValueOnce(menu);
  await act(async () => {
    fireEvent.click(screen.getByTestId("menu-error-retry"));
  });
};

const eventsNamed = (name: string) =>
  mockCapture.mock.calls.filter(([event]) => event === name);

describe("SecondLayout — menu-load failure stays on /second (P9b R8)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setPipelines([PIPELINE]));
    mockNavigate.mockReset();
    mockFetchMenu.mockReset();
    mockCharges.mockReset();
    mockCapture.mockReset();
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("a menu that loaded enters it", async () => {
    mount();
    await tapPipeline(LOADED_MENU);

    expect(mockFetchMenu).toHaveBeenCalledWith("t2", false, false, PIPELINE);
    expect(mockNavigate).toHaveBeenCalledWith("/menu");
    expect(screen.queryByTestId("menu-error")).not.toBeInTheDocument();
  });

  it("with loyalty on, a loaded menu goes to /phone first", async () => {
    store.dispatch(setKioskSettings({ enable_loyalty: true }));
    store.dispatch(setLoyaltyPartner({ partner: { partner_name: "Xeno" } }));
    mount();
    await tapPipeline(LOADED_MENU);

    expect(mockNavigate).toHaveBeenCalledWith("/phone");
  });

  it.each([
    ["{} — fetchMenu's swallowed failure", {}],
    ["no categories", { categories: [] }],
    ["nothing at all", undefined],
  ])("a failed load (%s): no navigation, the menu-error dialog over the cards", async (_label, menu) => {
    mount();
    await tapPipeline(menu);

    expect(mockNavigate).not.toHaveBeenCalled();
    const dialog = screen.getByTestId("menu-error");
    expect(dialog).toHaveAccessibleName(i18n.t("menuError.title"));
    expect(dialog).toHaveAccessibleDescription(i18n.t("menuError.message"));
    expect(screen.getByTestId("menu-error-retry")).toHaveTextContent(
      i18n.t("menuError.retry")
    );
    expect(screen.getByTestId("menu-error-back")).toHaveTextContent(
      i18n.t("menuError.back")
    );
    // The "Building your menu…" overlay is gone; the cards are underneath.
    expect(screen.queryByTestId("menu-fetching")).not.toBeInTheDocument();
    expect(screen.getByTestId("pipeline-p-take")).toBeInTheDocument();
  });

  it("TRY AGAIN re-runs ONLY the fetches (same args, charges included) and enters the menu", async () => {
    mount();
    await tapPipeline({});
    expect(mockCharges).toHaveBeenCalledTimes(1);

    await tapRetry(LOADED_MENU);

    expect(mockFetchMenu).toHaveBeenCalledTimes(2);
    expect(mockFetchMenu.mock.calls[1]).toEqual(mockFetchMenu.mock.calls[0]);
    // The tap's charges call failed with the menu; only a success rewrites
    // the stored charges, so the retry must ask again (money, Rule 3).
    expect(mockCharges).toHaveBeenCalledTimes(2);
    expect(mockCharges).toHaveBeenLastCalledWith("t2");
    expect(mockNavigate).toHaveBeenCalledWith("/menu");
    // One selection, one set of selection events — a retry is not a new tap.
    expect(eventsNamed("pipeline_selected")).toHaveLength(1);
    expect(eventsNamed("order_type_selected")).toHaveLength(1);
  });

  it("TRY AGAIN shows the fetching overlay while it runs", async () => {
    mount();
    await tapPipeline({});

    let answer!: (menu: unknown) => void;
    mockFetchMenu.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      })
    );
    act(() => {
      fireEvent.click(screen.getByTestId("menu-error-retry"));
    });

    expect(screen.getByTestId("menu-fetching")).toBeInTheDocument();
    expect(screen.queryByTestId("menu-error")).not.toBeInTheDocument();

    await act(async () => {
      answer(LOADED_MENU);
    });
    expect(screen.queryByTestId("menu-fetching")).not.toBeInTheDocument();
    expect(mockNavigate).toHaveBeenCalledWith("/menu");
  });

  it("a retry that fails again brings the dialog back — no dead end, no loop of its own", async () => {
    mount();
    await tapPipeline({});
    await tapRetry({});

    expect(mockFetchMenu).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("menu-error")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("a double tap on TRY AGAIN fetches once", async () => {
    mount();
    await tapPipeline({});
    mockFetchMenu.mockReturnValueOnce(new Promise(() => {}));
    const retry = screen.getByTestId("menu-error-retry");

    act(() => {
      fireEvent.click(retry);
      fireEvent.click(retry);
    });

    expect(mockFetchMenu).toHaveBeenCalledTimes(2);
  });

  it("BACK dismisses the dialog: the cards and the footer are live again, nothing is refetched", async () => {
    mount();
    await tapPipeline({});

    fireEvent.click(screen.getByTestId("menu-error-back"));

    expect(screen.queryByTestId("menu-error")).not.toBeInTheDocument();
    expect(mockFetchMenu).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();

    // Rule 1 exit: the footer's Cancel still reaches the splash.
    fireEvent.click(screen.getByTestId("footer-cancel"));
    expect(mockNavigate).toHaveBeenCalledWith("/start");

    // …and the cards take a fresh tap.
    await tapPipeline(LOADED_MENU);
    expect(mockNavigate).toHaveBeenLastCalledWith("/menu");
  });

  it("speaks the guest's language (AR)", async () => {
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    mount();
    await tapPipeline({});

    expect(screen.getByTestId("menu-error")).toHaveAccessibleName(
      "تعذر تحميل القائمة"
    );
    expect(screen.getByTestId("menu-error-retry")).toHaveTextContent("حاول مرة أخرى");
  });
});
