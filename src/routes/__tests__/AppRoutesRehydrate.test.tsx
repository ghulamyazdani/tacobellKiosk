import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { store } from "../../redux/app/store";
import { AppRoutes } from "../AppRoutes";

/*
  CartRehydratedContext is the "the cart rows are real now" signal BagSheet's
  empty-cart exit waits for after a crash-reload on /cart. It must stay false
  while the Dexie rehydrate is in flight (an early true drops the customer's
  saved reward on the transient empty cart) and must settle true once the
  rehydrate is done, whether it resolved OR failed (Rule 2: a broken Dexie
  must not leave a stale reward on a bag that can never exit). Mutation
  verifier: "never true on a Dexie failure" survived every other test.
*/

const { syncCartOnReLoad } = vi.hoisted(() => ({
  syncCartOnReLoad: vi.fn<() => Promise<void>>(),
}));

vi.mock("../../hooks/menuHooks/useCartHook", () => ({
  default: () => ({ syncCartOnReLoad }),
}));

// An unregistered device renders Registration at "/": probe the signal there.
vi.mock("../../pages/Registration", async () => {
  const { useCartRehydrated } = await import("../../hooks/utils/useCartRehydrated");
  return {
    default: function RehydratedProbe() {
      return <p data-testid="cart-rehydrated">{String(useCartRehydrated())}</p>;
    },
  };
});

const renderRoutes = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/"]}>
        <AppRoutes />
      </MemoryRouter>
    </Provider>
  );

const signal = () => screen.getByTestId("cart-rehydrated");

describe("AppRoutes — the cart-rehydrated signal (crash-reload on /cart)", () => {
  beforeEach(() => {
    syncCartOnReLoad.mockReset();
  });

  it("stays false while the Dexie rehydrate is in flight, turns true once it lands, and the rehydrate runs once", async () => {
    let land: () => void = () => {};
    syncCartOnReLoad.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        land = resolve;
      })
    );
    renderRoutes();
    expect(signal()).toHaveTextContent("false");
    await act(async () => {
      await Promise.resolve();
    });
    expect(signal()).toHaveTextContent("false");

    await act(async () => {
      land();
    });
    expect(signal()).toHaveTextContent("true");
    expect(syncCartOnReLoad).toHaveBeenCalledTimes(1);
  });

  it("settles true when the rehydrate FAILS (Dexie unavailable): the empty-cart exit is never left waiting", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    syncCartOnReLoad.mockRejectedValueOnce(new Error("dexie unavailable"));
    renderRoutes();
    await waitFor(() => expect(signal()).toHaveTextContent("true"));
    consoleError.mockRestore();
  });
});
