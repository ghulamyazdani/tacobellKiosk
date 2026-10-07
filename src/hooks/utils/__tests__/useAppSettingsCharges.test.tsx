import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import type { UnknownAction } from "@reduxjs/toolkit";
import {
  setChargesCountryData,
  setCurrency,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { resolveDefaultCountry } from "@cx-sdk/catalog/settings/settingsEngine";
import { setCountryCode } from "@cx-sdk/core/auth/authentication.slice";
import CountryCodes from "@cx-sdk/core/data/CountryCodes";
import { pushCharges, setDeploymentCharges } from "@cx-sdk/ordering/state/cart.slice";
import { store } from "../../../redux/app/store";
import useAppSettings from "../useAppSettings";

/*
  Lane bag-pdp (item 19): getChargesCountryDataApi's DEFAULT path is pinned
  (the exact dispatch + localStorage sequence every existing caller —
  SecondLayout, Menu, BagSheet — relies on), and its staged mode (opts) is
  the order-type switch's: nothing reaches the store or localStorage until
  the caller commits.
*/

const net = vi.hoisted(() => ({
  charges: (): Promise<unknown> => Promise.resolve({}),
  requests: [] as unknown[],
}));

vi.mock("@cx-sdk/catalog/services/qrInfoApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cx-sdk/catalog/services/qrInfoApi")>()),
  useGetChargesCountryDataMutation: () => [
    (body: unknown) => {
      net.requests.push(body);
      return net.charges();
    },
  ],
}));

const MENU_CHARGE = { id: "mc-pack", name: "Packing", value: 10, type: "fixed" };
const BODY = {
  charges: [
    { _id: "dc-service", name: "Service", value: 5, type: "fixed" },
    { _id: "dc-open", name: "Open", value: 1, type: "fixed", isopenCharge: true },
  ],
  deployment: {
    countryCode: { code: "IN", dial_code: "+91" },
    currencySettings: { symbol: "₹", code: "INR" },
  },
};

type Write = [string, string];

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>{children}</Provider>
);

const record = async (
  run: (
    getChargesCountryDataApi: ReturnType<typeof useAppSettings>["getChargesCountryDataApi"],
  ) => Promise<unknown>,
) => {
  const dispatch = vi.spyOn(store, "dispatch");
  const setItem = vi.spyOn(window.localStorage, "setItem");
  const { result } = renderHook(() => useAppSettings(), { wrapper });
  dispatch.mockClear();
  setItem.mockClear();
  let returned: unknown;
  await act(async () => {
    returned = await run(result.current.getChargesCountryDataApi);
  });
  const actions = dispatch.mock.calls.map(([action]) => action as UnknownAction);
  const writes = setItem.mock.calls
    .map(([key, value]) => [String(key), String(value)] as Write)
    .filter(([key]) => !key.startsWith("persist:"));
  return { returned, actions, writes };
};

describe("useAppSettings.getChargesCountryDataApi — lane bag-pdp pins", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    window.localStorage.clear();
    window.localStorage.setItem("menuCharges", JSON.stringify([MENU_CHARGE]));
    net.charges = () => Promise.resolve({ data: BODY });
    net.requests = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("default path: the exact dispatch + localStorage sequence (regression pin)", async () => {
    const { actions, writes } = await record((fetchCharges) => fetchCharges("t2"));

    expect(net.requests).toEqual([
      expect.objectContaining({ tab_id: "t2", isCharged: true, isCountry: true }),
    ]);
    const service = BODY.charges[0];
    // Default composition: localStorage menu charges FIRST (fork order).
    expect(actions).toEqual([
      setChargesCountryData({ charges: [service], countries: CountryCodes }),
      setCountryCode(resolveDefaultCountry(BODY.deployment.countryCode, CountryCodes)),
      setCurrency(BODY.deployment.currencySettings),
      setDeploymentCharges([service]),
      pushCharges([MENU_CHARGE, service]),
    ]);
    expect(writes).toEqual([
      ["deploymentCharges", JSON.stringify([service])],
      ["charges", JSON.stringify([MENU_CHARGE, service])],
      ["countries", JSON.stringify(CountryCodes)],
    ]);
  });

  it("staged: nothing reaches the store or localStorage; apply/mirror get the default sequence", async () => {
    const staged: UnknownAction[] = [];
    const mirrored: Write[] = [];
    const { returned, actions, writes } = await record((fetchCharges) =>
      fetchCharges("t2", {
        apply: (action) => staged.push(action),
        mirror: (key, value) => mirrored.push([key, value]),
      }),
    );

    const service = BODY.charges[0];
    expect(actions).toEqual([]);
    expect(writes).toEqual([]);
    expect(staged.map((action) => action.type)).toEqual([
      "appSettings/setChargesCountryData",
      "auth/setCountryCode",
      "appSettings/setCurrency",
      "cart/setDeploymentCharges",
      "cart/pushCharges",
    ]);
    expect(mirrored.map(([key]) => key)).toEqual(["deploymentCharges", "charges", "countries"]);
    expect(returned).toEqual({ ok: true, deploymentCharges: [service] });
  });

  it("staged: a failed call resolves ok:false and stages nothing", async () => {
    net.charges = () => Promise.resolve({ error: { status: "TIMEOUT_ERROR" } });
    const staged: UnknownAction[] = [];
    const mirrored: Write[] = [];
    const { returned, actions } = await record((fetchCharges) =>
      fetchCharges("t2", {
        apply: (action) => staged.push(action),
        mirror: (key, value) => mirrored.push([key, value]),
      }),
    );
    expect(returned).toEqual({ ok: false, deploymentCharges: [] });
    expect([...actions, ...staged, ...mirrored]).toEqual([]);
  });

  it("default path: a failed call writes nothing", async () => {
    net.charges = () => Promise.resolve({ error: { status: 500 } });
    const { actions, writes } = await record((fetchCharges) => fetchCharges("t2"));
    expect(actions).toEqual([]);
    expect(writes).toEqual([]);
  });
});
