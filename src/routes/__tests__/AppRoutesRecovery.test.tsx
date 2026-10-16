import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, useLocation } from "react-router-dom";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { store } from "../../redux/app/store";
import { recoverFromServerError } from "../../redux/app/sessionRecovery";
import { AppRoutes } from "../AppRoutes";

/*
  A session recovery mid-order must land on Registration, never on a page an
  empty-cart exit would open first. Pins the hook-less guards' redirect on
  the reset's own render: AppRoutes re-renders on that cart write, so they
  re-read the cookie. (Written for the perf pass, whose route-tree memo was
  dropped because it would have needed the cookie read in AppRoutes.)
*/

const { pageRenders } = vi.hoisted(() => ({ pageRenders: vi.fn() }));

// No IndexedDB in jsdom: the rehydrate restores an empty mirror.
vi.mock("../../models/db", () => ({
  db: { open: () => Promise.resolve(), cartItems: { toArray: () => Promise.resolve([]) } },
  resetDatabase: () => Promise.resolve(),
}));
// The in-session chrome renders nothing; the pages are render probes.
vi.mock("../IdleGuard", async () => {
  const { Outlet } = await import("react-router-dom");
  return { default: () => <Outlet /> };
});
vi.mock("../../components/makeItAMeal/MakeItAMealPrompt", () => ({ default: () => null }));
vi.mock("../../components/cart/RepeatItemSheet", () => ({ default: () => null }));
vi.mock("../../components/menu/DetourTapGuard", () => ({ default: () => null }));
vi.mock("../../pages/PaymentSelection", async () => {
  const { useNavigate } = await import("react-router-dom");
  return {
    default: function PaymentProbe() {
      pageRenders("payment");
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate("/receipt")}>
          payment
        </button>
      );
    },
  };
});
vi.mock("../../pages/ReceiptPreference", () => ({
  default: function ReceiptProbe() {
    pageRenders("receipt");
    return <p>receipt</p>;
  },
}));
vi.mock("../../pages/Menu", async () => {
  const { useNavigate } = await import("react-router-dom");
  return {
    default: function MenuProbe() {
      pageRenders("menu");
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate("/tent")}>
          menu
        </button>
      );
    },
  };
});
// The real Tent's empty-cart exit, verbatim (Tent/index.tsx).
vi.mock("../../pages/Tent", async () => {
  const { useEffect } = await import("react");
  const { useSelector } = await import("react-redux");
  const { useNavigate } = await import("react-router-dom");
  const { selectCart } = await import("@cx-sdk/ordering/state/cart.slice");
  return {
    default: function TentProbe() {
      pageRenders("tent");
      const navigate = useNavigate();
      const cart = useSelector(selectCart) as { cartItems?: unknown[] } | undefined;
      const cartCount = cart?.cartItems?.length ?? 0;
      useEffect(() => {
        if (cartCount === 0) {
          navigate("/menu", { replace: true });
        }
      }, [cartCount, navigate]);
      return <p>tent</p>;
    },
  };
});
vi.mock("../../pages/Registration", () => ({
  default: function RegistrationProbe() {
    pageRenders("registration");
    return <p>registration</p>;
  },
}));

const fries = { id: "fries", itemId: "f-1", name: "Large Fries", quantity: 1, type: "ITEM", price: 2.5, total_price: 2.5 };

// Every pathname the router commits, in order.
const trail: string[] = [];
function PathTrail() {
  const { pathname } = useLocation();
  useEffect(() => {
    trail.push(pathname);
  }, [pathname]);
  return null;
}

describe("AppRoutes — a session recovery mid-order", () => {
  beforeEach(() => {
    document.cookie = "token=abc123; path=/";
  });
  afterEach(() => {
    document.cookie = "token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    vi.unstubAllGlobals();
  });

  // A 504/505 (or 401) mid-session resets the store and removes the token,
  // then reloads — asynchronously in a browser. Until the page unloads, the
  // guard sends the router to Registration on the reset's render; Tent's
  // empty-cart exit must not open the menu first.
  it("a session recovery on /tent with a bag lands on Registration, never on the menu", async () => {
    pageRenders.mockClear();
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/menu"]}>
          <PathTrail />
          <AppRoutes />
        </MemoryRouter>
      </Provider>
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    act(() => {
      store.dispatch(setCartItems([fries]));
    });
    fireEvent.click(screen.getByRole("button", { name: "menu" }));
    expect(screen.getByText("tent")).toBeInTheDocument();

    trail.length = 0;
    pageRenders.mockClear();
    const replace = vi.fn();
    vi.stubGlobal("location", { href: "http://localhost:3000/tent", origin: "http://localhost:3000", replace });
    await act(async () => {
      recoverFromServerError(store.dispatch);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(replace).toHaveBeenCalledWith("http://localhost:3000/");
    expect(document.cookie).not.toContain("token=abc123");
    expect(trail).toEqual(["/"]);
    expect(screen.getByText("registration")).toBeInTheDocument();
    expect(pageRenders).not.toHaveBeenCalledWith("menu");
  });
});
