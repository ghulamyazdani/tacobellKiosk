import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import {
  setEnableAccessibilityMode,
  toggleAccessibilityMode,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import useAdaActive from "../useAdaActive";

/*
  P9c (A9): the one switch every page and overlay sizes from — the guest's
  toggle AND the tenant's feature gate. Requiring both is what stops a tenant
  who turns the feature off from stranding a guest in the view (the footer
  button is hidden then, so nothing could turn it back off).
*/

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>{children}</Provider>
);

describe("useAdaActive — guest toggle AND tenant gate (P9c)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it.each([
    [false, true, false],
    [true, true, true],
    [true, false, false],
    [false, false, false],
  ])("toggle %s + gate %s → %s", (toggle, gate, expected) => {
    if (toggle) store.dispatch(toggleAccessibilityMode());
    store.dispatch(setEnableAccessibilityMode(gate));

    const { result } = renderHook(() => useAdaActive(), { wrapper });

    expect(result.current).toBe(expected);
  });

  it("follows both flags live, including a gate switched off mid-session", () => {
    const { result } = renderHook(() => useAdaActive(), { wrapper });
    expect(result.current).toBe(false);

    act(() => {
      store.dispatch(toggleAccessibilityMode());
    });
    expect(result.current).toBe(true);

    act(() => {
      store.dispatch(setEnableAccessibilityMode(false));
    });
    expect(result.current).toBe(false);
  });
});
