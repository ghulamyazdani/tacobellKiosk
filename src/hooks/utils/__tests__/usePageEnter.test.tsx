import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  MemoryRouter,
  NavigationType,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import usePageEnter, { notePath, pageEnterDirection, type PageEnter } from "../usePageEnter";

/*
  Motion contract §2.3 / §5.5. A page root's `data-enter` is decided ONCE, at
  mount: a POP (a page load — reload, crash recovery, PWA update) never
  animates; a PUSH to a screen already on the session trail is "back", any
  other PUSH "fwd"; a REPLACE (a guard / redirect / resume) stays still unless
  it returns to the screen just before the one being left — the PDP's close
  lands as a REPLACE (its no-session guard re-navigates; lane motion
  integration). The trail is module state that AppRoutes writes AFTER each
  committed pathname, so a page's first render still sees the screen being
  left at the end of it.
*/

const { Push, Pop, Replace } = NavigationType;

beforeEach(() => {
  notePath("/start");
});

describe("pageEnterDirection — a POP never animates, a REPLACE only as a return", () => {
  const visited = ["/start", "/second", "/menu"];
  const cases: [string, PageEnter, string, NavigationType][] = [
    ["POP (a page load)", undefined, "/customization", Pop],
    ["REPLACE (a guard / redirect / resume)", undefined, "/customization", Replace],
    ["REPLACE back to the screen before the one being left (the PDP close)", "back", "/second", Replace],
    ["REPLACE to an older screen (a guard bounce)", undefined, "/start", Replace],
    ["REPLACE, trailing self (the lazy Paytm screen's resume)", undefined, "/menu", Replace],
    ["PUSH to a new screen", "fwd", "/customization", Push],
    ["PUSH to a visited screen", "back", "/second", Push],
    ["PUSH, trailing self (a lazy page mounting after its own commit)", "fwd", "/menu", Push],
  ];

  it.each(cases)("%s → %s", (_label, expected, path, navType) => {
    expect(pageEnterDirection(path, navType, visited)).toBe(expected);
  });
});

describe("notePath — the session trail", () => {
  it("/orderSuccess and /start each start a new trail", () => {
    notePath("/second");
    notePath("/menu");
    expect(pageEnterDirection("/second", Push)).toBe("back");

    notePath("/orderSuccess");
    expect(pageEnterDirection("/second", Push)).toBe("fwd"); // NEW ORDER
    expect(pageEnterDirection("/menu", Push)).toBe("fwd");

    notePath("/menu");
    notePath("/start");
    expect(pageEnterDirection("/menu", Push)).toBe("fwd");
  });

  it("PLACE NEW ORDER chains customers: every customer's Order Complete arrives fwd", () => {
    const checkout = ["/second", "/menu", "/cart", "/payment", "/receipt"];
    for (const customer of [1, 2, 3]) {
      checkout.forEach((path) => notePath(path)); // NEW ORDER pushes /second, never /start
      expect(pageEnterDirection("/orderSuccess", Push), `customer ${customer}`).toBe("fwd");
      notePath("/orderSuccess");
    }
  });

  it("a revisit truncates the trail back to that screen", () => {
    notePath("/second");
    notePath("/menu");
    notePath("/customization");
    notePath("/menu"); // PDP BACK

    expect(pageEnterDirection("/customization", Push)).toBe("fwd"); // dropped from the trail
    expect(pageEnterDirection("/second", Push)).toBe("back");
  });

  it("is idempotent (StrictMode runs AppRoutes' effect twice)", () => {
    notePath("/second");
    notePath("/menu");
    notePath("/menu");

    // A duplicate entry would make the page read its own screen as a revisit.
    expect(pageEnterDirection("/menu", Push)).toBe("fwd");
    expect(pageEnterDirection("/second", Push)).toBe("back");
  });
});

/** AppRoutes' notePath effect (AppRoutes itself is not mounted here). */
function TrailKeeper() {
  const { pathname } = useLocation();
  useEffect(() => {
    notePath(pathname);
  }, [pathname]);
  return null;
}

const PUSHES = ["/second", "/menu", "/cart", "/customization", "/paymentPolling"];

function Nav() {
  const navigate = useNavigate();
  return (
    <>
      {PUSHES.map((path) => (
        <button key={path} type="button" onClick={() => navigate(path)}>
          {path}
        </button>
      ))}
      <button type="button" onClick={() => navigate("/menu", { replace: true })}>
        replace /menu
      </button>
    </>
  );
}

function PageRoot({ quiet = false }: { quiet?: boolean }) {
  return <div data-testid="page-root" data-enter={usePageEnter(quiet)} />;
}

// One component per screen, as in the app; /menu and /cart share MenuPage, so
// that hop re-renders the SAME instance (like <Menu> / <Menu bagOpen>).
// "bag": quiet while the bag is open, as Menu's `bagOpen || …`.
const SecondPage = () => <PageRoot />;
function MenuPage({ quiet }: { quiet: boolean | "bag" }) {
  const bagOpen = useLocation().pathname === "/cart";
  return <PageRoot quiet={quiet === "bag" ? bagOpen : quiet} />;
}
const PdpPage = () => <PageRoot />;

/** The Paytm screen is a lazy chunk: its page mounts after its own commit. */
function LazyPage() {
  const [loaded, setLoaded] = useState(false);
  return loaded ? (
    <PageRoot />
  ) : (
    <button type="button" onClick={() => setLoaded(true)}>
      chunk arrives
    </button>
  );
}

const renderKiosk = (initial: string, reactStrictMode: boolean, quietMenu: boolean | "bag" = false) =>
  render(
    <MemoryRouter initialEntries={[initial]}>
      <TrailKeeper />
      <Nav />
      <Routes>
        <Route path="/start" element={<p>splash</p>} />
        <Route path="/second" element={<SecondPage />} />
        <Route path="/menu" element={<MenuPage quiet={quietMenu} />} />
        <Route path="/cart" element={<MenuPage quiet={quietMenu} />} />
        <Route path="/customization" element={<PdpPage />} />
        <Route path="/paymentPolling" element={<LazyPage />} />
      </Routes>
    </MemoryRouter>,
    { reactStrictMode }
  );

const go = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const pageRoot = () => screen.getByTestId("page-root");

describe.each([false, true])("usePageEnter under MemoryRouter (reactStrictMode: %s)", (reactStrictMode) => {
  it("the first render is a page load (POP): no data-enter", () => {
    renderKiosk("/second", reactStrictMode);

    expect(pageRoot()).not.toHaveAttribute("data-enter");
  });

  it("navigate() to a new screen gives fwd; a REPLACE gives none", () => {
    renderKiosk("/start", reactStrictMode);

    go("/second");
    expect(pageRoot()).toHaveAttribute("data-enter", "fwd");

    go("replace /menu");
    expect(pageRoot()).not.toHaveAttribute("data-enter");
  });

  it("returning to a screen on the trail gives back, latched while the trail moves on", () => {
    renderKiosk("/start", reactStrictMode);
    go("/second");
    go("/menu");
    go("/customization");

    go("/menu"); // PDP BACK
    const menu = pageRoot();
    expect(menu).toHaveAttribute("data-enter", "back");

    // Opening the bag re-renders the SAME Menu after the trail gained /cart:
    // recomputed it would read "fwd", which would start an entrance on a live page.
    go("/cart");
    expect(pageRoot()).toBe(menu);
    expect(menu).toHaveAttribute("data-enter", "back");
  });

  it("the PDP close — a REPLACE back to the screen before it — gives back", () => {
    renderKiosk("/start", reactStrictMode);
    go("/second");
    go("/menu");
    go("/customization");

    go("replace /menu"); // the no-session guard's bounce wins the PDP's BACK
    expect(pageRoot()).toHaveAttribute("data-enter", "back");
  });

  it("a page mounting after its own commit (lazy) still gives fwd", () => {
    renderKiosk("/start", reactStrictMode);
    go("/second");
    go("/paymentPolling");

    go("chunk arrives");
    expect(pageRoot()).toHaveAttribute("data-enter", "fwd");
  });

  it("quiet gives no data-enter (Menu mounting under an open overlay)", () => {
    renderKiosk("/start", reactStrictMode, true);
    go("/second");
    expect(pageRoot()).toHaveAttribute("data-enter", "fwd");

    go("/menu");
    expect(pageRoot()).not.toHaveAttribute("data-enter");
  });

  // Menu's quiet is `bagOpen || …`: it flips on the SAME instance as the bag
  // opens and closes. Re-read, it would drop data-enter and add it back — and
  // adding it STARTS the entrance on a live page.
  it("quiet is read once: a Menu that arrived keeps fwd while the bag opens", () => {
    renderKiosk("/start", reactStrictMode, "bag");
    go("/second");
    go("/menu");
    const menu = pageRoot();
    expect(menu).toHaveAttribute("data-enter", "fwd");

    go("/cart");
    expect(pageRoot()).toBe(menu);
    expect(menu).toHaveAttribute("data-enter", "fwd");
  });

  it("quiet is read once: a Menu that mounted under the bag stays still when it closes", () => {
    renderKiosk("/start", reactStrictMode, "bag");
    go("/second");
    go("/cart");
    const menu = pageRoot();
    expect(menu).not.toHaveAttribute("data-enter");

    go("/menu");
    expect(pageRoot()).toBe(menu);
    expect(menu).not.toHaveAttribute("data-enter");
  });
});
