/**
 * Lane loyalty-visual D9 — the Menu's Xeno REWARDS sheet rides the ONE lazy
 * UI chunk (bagLazyParts) and is ALWAYS mounted under a local
 * <ErrorBoundary fallback> + <Suspense fallback>. While its code is not here
 * (still loading, or a failed chunk) an OPEN sheet is a named scrim that
 * only closes it — never navigates, never resets; a closed one is nothing,
 * and the rest of /menu keeps working.
 *
 * The chunk is held by a deferred the mocked bagLazyParts' sheet throws
 * while pending — exactly what React.lazy does with its import — and whose
 * rejection it rethrows, as a failed import does. The module stays real, so
 * a release renders the real sheet. (Not `use()`: a `use` suspension inside
 * RTL's synchronous render act strands the root once the lazy has resolved
 * in an earlier test.)
 */
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setMenuData } from "@cx-sdk/catalog/state/Menu.slice";
import { openLoyaltyItemsModal } from "@cx-sdk/ordering/state/loyalty.slice";
import { store } from "../../../redux/app/store";
import Menu from "../index";
import "../../../i18n";

interface HeldChunk {
  promise: Promise<void>;
  failure?: Error;
}

const { chunk, mockFetchMenu, mockNavigate, mockCapture } = vi.hoisted(() => ({
  /** null = the code is here; otherwise still loading until released / failed. */
  chunk: { held: null as HeldChunk | null, settled: false },
  mockFetchMenu: vi.fn(),
  mockNavigate: vi.fn(),
  mockCapture: vi.fn(),
}));

vi.mock("../../../components/cart/bagLazyParts", async (importOriginal) => {
  const parts = await importOriginal<typeof import("../../../components/cart/bagLazyParts")>();
  const { createElement } = await import("react");
  const Sheet = parts.LoyaltyRewardsSheet;
  return {
    ...parts,
    LoyaltyRewardsSheet: (props: ComponentProps<typeof Sheet>) => {
      const held = chunk.held;
      if (held && !chunk.settled) throw held.promise; // still loading
      if (held?.failure) throw held.failure; // the import failed
      return createElement(Sheet, props);
    },
  };
});

vi.mock("../../../hooks/menuHooks/useMenuConverters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../hooks/menuHooks/useMenuConverters")>();
  return {
    default: () => ({
      ...actual.default(),
      fetchMenu: (...args: unknown[]) => mockFetchMenu(...args),
    }),
  };
});

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mockNavigate,
}));

vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mockCapture(...args),
}));

const MENU = {
  categories: [
    {
      id: "c1",
      name: "Side Orders",
      subCategories: [
        {
          id: "s1",
          name: "Sides",
          entities: [{ id: "e-fries", name: "Large Fries", price: 2.5, outOfStock: false }],
        },
      ],
    },
  ],
};

const renderMenu = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/menu"]}>
        <Menu />
      </MemoryRouter>
    </Provider>
  );

const scrim = () => screen.queryByTestId("loyalty-rewards-loading");
const sheetOpen = () =>
  (store.getState() as unknown as { loyalty: { loyaltyItemsModal: { isOpen: boolean } } }).loyalty
    .loyaltyItemsModal.isOpen;
const openRewards = () =>
  act(() => {
    store.dispatch(openLoyaltyItemsModal({ isTimerOn: false }));
  });

/** Hold the chunk; the test then releases it or fails it by hand. */
const holdChunk = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const held: HeldChunk = {
    promise: new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    }),
  };
  held.promise.catch(() => {}); // React pings on it; nothing else listens
  chunk.held = held;
  chunk.settled = false;
  return {
    release: () => {
      chunk.settled = true;
      resolve();
    },
    fail: (error: Error) => {
      held.failure = error;
      chunk.settled = true;
      reject(error);
    },
  };
};

describe("Menu — the lazy Xeno rewards sheet (lane loyalty-visual D9)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setMenuData({ menu: MENU }));
    mockFetchMenu.mockReset();
    mockFetchMenu.mockReturnValue(new Promise(() => {}));
    mockNavigate.mockReset();
    mockCapture.mockReset();
  });

  afterEach(() => {
    chunk.held = null;
    chunk.settled = false;
    vi.restoreAllMocks();
  });

  it("chunk held: closed shows nothing; open shows the named scrim, whose tap only closes the sheet; once the code arrives the real sheet opens", async () => {
    const gate = holdChunk();
    // Spied before render: components capture dispatch when they mount.
    const dispatched = vi.spyOn(store, "dispatch");
    renderMenu();

    expect(scrim()).toBeNull();
    expect(screen.getByTestId("rail-c1")).toBeInTheDocument();

    openRewards();
    const loading = screen.getByRole("button", { name: "Close rewards" });
    expect(loading).toHaveAttribute("data-testid", "loyalty-rewards-loading");
    // The sheet's own layer (z-50): it must cover the bag (z-40) whose
    // REWARDS entry opens it, as the real sheet does.
    expect(loading).toHaveClass("absolute", "inset-0", "z-50");
    expect(screen.queryByTestId("loyalty-rewards-sheet")).toBeNull();

    dispatched.mockClear();
    await userEvent.click(loading);
    expect(dispatched.mock.calls.map(([action]) => (action as { type?: string }).type)).toEqual([
      "loyalty/closeLoyaltyItemsModal",
    ]);
    expect(sheetOpen()).toBe(false);
    expect(scrim()).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByTestId("rail-c1")).toBeInTheDocument();

    await act(async () => gate.release());
    openRewards();

    expect(await screen.findByTestId("loyalty-rewards-sheet")).toBeInTheDocument();
    expect(scrim()).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("chunk failed: the local boundary keeps /menu up (no crash screen), logs ErrorOccurred as a local fallback, and an open sheet is the closable scrim", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {}); // React reports the caught error
    const gate = holdChunk();
    renderMenu();
    expect(mockCapture).not.toHaveBeenCalled();

    await act(async () => gate.fail(new Error("Failed to fetch dynamically imported module")));

    await waitFor(() =>
      expect(mockCapture).toHaveBeenCalledWith(
        "error_occurred",
        expect.objectContaining({
          error_source: "react_boundary",
          error_message: "Failed to fetch dynamically imported module",
          recovery_path: "local_fallback",
        })
      )
    );
    expect(scrim()).toBeNull();
    expect(screen.getByTestId("rail-c1")).toBeInTheDocument();
    expect(screen.queryByTestId("app-error")).toBeNull();

    openRewards();
    const loading = screen.getByRole("button", { name: "Close rewards" });
    expect(loading).toHaveAttribute("data-testid", "loyalty-rewards-loading");
    expect(screen.getByTestId("rail-c1")).toBeInTheDocument();

    await userEvent.click(loading);
    expect(sheetOpen()).toBe(false);
    expect(scrim()).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("code already here: open shows the real sheet straight away (no scrim)", async () => {
    renderMenu();
    openRewards();

    expect(await screen.findByTestId("loyalty-rewards-sheet")).toBeInTheDocument();
    expect(scrim()).toBeNull();
  });
});
