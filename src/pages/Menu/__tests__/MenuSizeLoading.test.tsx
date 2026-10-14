import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setMenuData } from "@cx-sdk/catalog/state/Menu.slice";
import { store } from "../../../redux/app/store";
import { selectRecommendationDetour } from "../../../redux/features/menuSelections/menuSelections.slice";
import Menu from "../index";
import i18n from "../../../i18n";

/*
  Lane walk-oos: Select a Size rides the lazy UI chunk (the boot path paid
  for the out-of-stock work). Until its code is here — or if it never
  arrives — a quick add on a sized item shows the modal's own scrim, which
  closes like it: never a dead tap, never a stuck detour; once the code is
  in, the modal itself. Seams: the menu fetch (pending), navigation, the
  loader (held by hand).
*/

const mocks = vi.hoisted(() => ({
  arrive: null as null | ((modal: unknown) => void),
}));

vi.mock("../../../hooks/menuHooks/useMenuConverters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../hooks/menuHooks/useMenuConverters")>();
  return { default: () => ({ ...actual.default(), fetchMenu: () => new Promise(() => {}) }) };
});
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => vi.fn(),
}));
vi.mock("../../../components/menu/loadSelectSizeModal", () => ({
  loadedSelectSizeModal: () => null,
  loadSelectSizeModal: () =>
    new Promise((resolve) => {
      mocks.arrive = resolve;
    }),
}));

const TACO = {
  id: "e-taco",
  name: "Crunchy Taco",
  price: 0,
  hasVariant: true,
  isVariant: false,
  outOfStock: false,
  variants: [
    { id: "v-regular", name: "Regular", price: 4 },
    { id: "v-large", name: "Large", price: 6 },
  ],
};
const MENU = {
  categories: [{ id: "c1", name: "Tacos", subCategories: [{ id: "s1", name: "Tacos", entities: [TACO] }] }],
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>
    <MemoryRouter initialEntries={["/menu"]}>{children}</MemoryRouter>
  </Provider>
);

describe("Select a Size before its code is here (walk-oos)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setMenuData({ menu: MENU }));
    mocks.arrive = null;
  });

  it("the scrim stands in and closes like the modal; once the code arrives a quick add opens the modal itself", async () => {
    render(<Menu />, { wrapper });

    fireEvent.click(screen.getByTestId("quick-add-e-taco"));
    const scrim = screen.getByTestId("select-size-loading");
    expect(scrim).toHaveAccessibleName(i18n.t("language.close"));
    expect(screen.queryByTestId("select-size-modal")).not.toBeInTheDocument();
    fireEvent.click(scrim);
    expect(screen.queryByTestId("select-size-loading")).not.toBeInTheDocument();
    expect(selectRecommendationDetour(store.getState())).toBe(false);

    const { default: SelectSizeModal } = await import("../../../components/menu/SelectSizeModal");
    await act(async () => {
      mocks.arrive?.(SelectSizeModal);
    });
    fireEvent.click(screen.getByTestId("quick-add-e-taco"));
    expect(screen.getByTestId("select-size-modal")).toBeInTheDocument();
    expect(screen.queryByTestId("select-size-loading")).not.toBeInTheDocument();
  });
});
