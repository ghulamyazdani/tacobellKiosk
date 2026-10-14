import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import { setPhoneNumberRdx } from "@cx-sdk/core/customer/customerInfo.slice";
import { store } from "../../../redux/app/store";
import { notePath } from "../../../hooks/utils/usePageEnter";
import CustomerName from "../index";
import i18n from "../../../i18n";

/*
  P9b R4 (U2): /customerName (the zero-bill loyalty push) renders the same
  order-error panel as /receipt. The push itself is the hook's (pinned in
  usePayAtCounter.test and ReceiptPreference.test); here the hook is a stub
  so the panel's copy switch can be driven directly.
*/

const pay = vi.hoisted(() => ({
  failed: true,
  onTimeout: false,
  retry: vi.fn(),
  dismissError: vi.fn(),
}));

// The CRM prefill's network edge (only this screen imports it): each lookup
// stays in flight until the test answers it; abort() rejects it, as RTK does.
const crm = vi.hoisted(() => ({
  abort: vi.fn(),
  lookups: [] as { answer: (body: unknown) => void; aborted: () => boolean }[],
}));
vi.mock("@cx-sdk/core/customer/services/customerInfo", () => ({
  useGetCustomerNameByNumberMutation: () => [
    () => {
      let answer!: (body: unknown) => void;
      let fail!: (error: Error) => void;
      let aborted = false;
      const done = new Promise((resolve, reject) => {
        answer = resolve;
        fail = reject;
      });
      crm.lookups.push({ answer, aborted: () => aborted });
      return {
        unwrap: () => done,
        abort: () => {
          aborted = true;
          crm.abort();
          fail(new Error("Aborted"));
        },
      };
    },
  ],
}));

vi.mock("../../../hooks/paymentsHooks/usePayAtCounter", () => ({
  default: () => ({
    start: () => {},
    isBuffering: false,
    isPushing: false,
    hasFailed: pay.failed,
    failedOnTimeout: pay.failed && pay.onTimeout,
    retry: pay.retry,
    dismissError: pay.dismissError,
  }),
}));

const mount = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/customerName"]}>
        <CustomerName />
      </MemoryRouter>
    </Provider>
  );

describe("/customerName order-error panel (P9b R4)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    pay.failed = true;
    pay.onTimeout = false;
    pay.retry.mockReset();
    pay.dismissError.mockReset();
  });

  it("after a timeout: the UNCERTAIN copy — never 'didn't reach the restaurant'", () => {
    pay.onTimeout = true;
    mount();

    const panel = screen.getByTestId("order-error");
    expect(
      screen.getByRole("alertdialog", {
        name: i18n.t("orderError.uncertainTitle"),
        description: i18n.t("orderError.uncertainMessage"),
      })
    ).toBe(panel);
    expect(panel).toHaveTextContent(i18n.t("orderError.uncertainTitle"));
    expect(panel).toHaveTextContent(i18n.t("orderError.uncertainMessage"));
    expect(panel).not.toHaveTextContent(i18n.t("orderError.message"));
  });

  it("after a clean, exhausted ladder: the ordinary copy", () => {
    mount();

    const panel = screen.getByTestId("order-error");
    expect(
      screen.getByRole("alertdialog", {
        name: i18n.t("orderError.title"),
        description: i18n.t("orderError.message"),
      })
    ).toBe(panel);
    expect(panel).toHaveTextContent(i18n.t("orderError.title"));
    expect(panel).toHaveTextContent(i18n.t("orderError.message"));
    expect(panel).not.toHaveTextContent(i18n.t("orderError.uncertainTitle"));
  });

  it("Retry goes back to the SAME hook instance (same order id) — no new push path", () => {
    pay.onTimeout = true;
    mount();

    fireEvent.click(screen.getByTestId("order-error-retry"));

    expect(pay.retry).toHaveBeenCalledTimes(1);
    expect(pay.dismissError).not.toHaveBeenCalled();
  });

  it("the empty-name placeholder is 55 % black (P9f contrast: 35 % was 2.43:1)", () => {
    pay.failed = false;
    mount();

    const placeholder = screen.getByText(i18n.t("customerName.placeholder"));
    expect(placeholder).toHaveClass("text-black/55");
    expect(placeholder).not.toHaveClass("text-black/35");
  });

  it("the start screen's backdrop: the texture tiles and the 50 % plastic sheen, stage-registered (user 2026-10-14)", () => {
    pay.failed = false;
    mount();

    const backdrop = screen.getByTestId("customer-name-backdrop");
    expect(backdrop.style.backgroundImage).toContain("bg-texture");
    expect(backdrop.style.backgroundSize).toBe("240px 240px");
    expect(backdrop).toHaveClass("bottom-0", "h-[1920px]", "w-[1080px]");
    const sheen = screen.getByTestId("customer-name-sheen");
    expect(sheen.getAttribute("src")).toContain("plastic-overlay");
    expect(sheen).toHaveClass("opacity-50", "pointer-events-none", "bottom-0", "h-[1920px]");
    const root = screen.getByTestId("customer-name-screen");
    expect(root.children[0]).toBe(backdrop);
    expect(root.children[1]).toBe(sheen);
  });
});

/*
  Lane motion (§2.3 / §2.7). The root's data-enter is latched at mount: none
  on a page load (POP), fwd on a PUSH, back on a PUSH to a screen already on
  the session trail (AppRoutes' notePath; seeded here). Only the content
  blocks carry tb-enter [--i]; BACK, the footer and the overlays never move.
*/
describe("/customerName — the route entrance (lane motion)", () => {
  /** A PUSH from another route: <Navigate> fires after the first commit. */
  const mountPushed = () =>
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/from"]}>
          <Routes>
            <Route path="/from" element={<Navigate to="/customerName" />} />
            <Route path="/customerName" element={<CustomerName />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );
  const root = () => screen.getByTestId("customer-name-screen");

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    pay.failed = false;
    pay.onTimeout = false;
    notePath("/start");
  });

  it("a page load (POP) mounts still; a PUSH arrives fwd; a PUSH back to a visited /customerName arrives back", () => {
    const pop = mount();
    expect(root()).not.toHaveAttribute("data-enter");
    pop.unmount();

    const pushed = mountPushed();
    expect(root()).toHaveAttribute("data-enter", "fwd");
    pushed.unmount();

    notePath("/customerName");
    notePath("/payment");
    mountPushed();
    expect(root()).toHaveAttribute("data-enter", "back");
  });

  it("tb-enter [--i] on the title, copy, field, CONTINUE and keyboard (0–4) — never BACK, the footer or the error panel", () => {
    pay.failed = true;
    mountPushed();
    const blocks = [...root().querySelectorAll(".tb-enter")];
    expect(blocks.map((block) => block.className.match(/\[--i:(\d+)\]/)?.[1])).toEqual(["0", "1", "2", "3", "4"]);
    expect(blocks[2]).toContainElement(screen.getByTestId("customer-name-input"));
    expect(blocks[3]).toBe(screen.getByTestId("customer-name-continue"));
    for (const id of ["customer-name-back", "footer-cancel", "order-error"]) {
      expect(screen.getByTestId(id).closest(".tb-enter")).toBeNull();
    }
  });
});

/*
  motion-v2 MV3: the CRM prefill wait (it mounts with the page) shows the
  house sweep above its label — it was a still line.
*/
describe("/customerName — the CRM lookup wait", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    pay.failed = false;
    pay.onTimeout = false;
    crm.abort.mockReset();
    crm.lookups.length = 0;
  });

  it("a phone with no stored name: the loading layer stacks the house sweep above its label; leaving aborts the lookup", () => {
    store.dispatch(setPhoneNumberRdx("9953833675"));
    const view = mount();

    const loading = screen.getByTestId("customer-name-loading");
    expect(loading).toHaveClass("flex-col", "gap-[32px]");
    const sweep = loading.querySelectorAll(".tb-indeterminate");
    expect(sweep).toHaveLength(1);
    const track = sweep[0].parentElement as HTMLElement;
    expect(track).toHaveClass("overflow-hidden");
    expect(track.nextElementSibling).toHaveTextContent(i18n.t("customerName.loading"));
    expect(loading.querySelector("button")).toBeNull();
    // It mounts with the page, under the entering keyboard: never revealed late (motion-v2 MV4 "NOT on").
    expect(loading.closest(".tb-reveal-late")).toBeNull();

    view.unmount();
    expect(crm.abort).toHaveBeenCalled();
  });

  // StrictMode (every dev build) runs the mount effect twice: the first lookup
  // is aborted on the way to the second. Its stale settle used to end the wait
  // while the live lookup still ran (and forgot it, so leaving never aborted it).
  it("StrictMode's re-run: the aborted first lookup neither ends the wait nor forgets the live one", async () => {
    store.dispatch(setPhoneNumberRdx("9953833675"));
    const view = render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/customerName"]}>
          <CustomerName />
        </MemoryRouter>
      </Provider>,
      { reactStrictMode: true }
    );
    expect(crm.lookups.map((lookup) => lookup.aborted())).toEqual([true, false]);
    await act(async () => {}); // the aborted lookup settles
    expect(screen.getByTestId("customer-name-loading")).toBeInTheDocument();

    view.unmount(); // leaving still aborts the live lookup
    expect(crm.lookups[1].aborted()).toBe(true);
  });

  it("the live lookup's answer ends the wait (and prefills the name)", async () => {
    store.dispatch(setPhoneNumberRdx("9953833675"));
    mount();
    await act(async () => {
      crm.lookups[0].answer([{ firstname: "Ana", updated: "2026-10-01T00:00:00Z" }]);
    });
    expect(screen.queryByTestId("customer-name-loading")).not.toBeInTheDocument();
    expect(screen.getByTestId("customer-name-input")).toHaveTextContent("Ana");
  });
});
