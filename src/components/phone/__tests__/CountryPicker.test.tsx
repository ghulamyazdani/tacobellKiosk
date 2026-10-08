import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { store } from "../../../redux/app/store";
import CountryPicker from "../CountryPicker";
import i18n from "../../../i18n";

/*
  audit-fixes UB5 — the picker's boot-path host. Other suites mock the ONE
  lazy chunk WITHOUT CountryPickerSheet (and a prevented vite:preloadError
  resolves the import to undefined), so a chunk without the export must read
  as "not loaded", never throw: an open picker is then a named scrim that
  closes on tap, and the current country keeps working. The loaded path runs
  in the CustomerPhone / LoyaltyLoginModal suites against the real chunk.
*/

vi.mock("../../cart/bagLazyParts", () => ({}));

const mount = (open: boolean) => {
  const onClose = vi.fn();
  const view = render(
    <Provider store={store}>
      <div className="relative h-[1920px]">
        <CountryPicker open={open} onClose={onClose} layerClass="z-40" />
      </div>
    </Provider>
  );
  return { ...view, onClose };
};

/** Let the host's mount-time import settle. */
const settle = () => act(async () => {});

describe("CountryPicker host (UB5)", () => {
  it("renders nothing while closed (the load still starts at mount)", async () => {
    mount(false);
    await settle();

    expect(screen.queryByTestId("country-loading")).toBeNull();
    expect(screen.queryByTestId("country-sheet")).toBeNull();
  });

  it("a chunk without the sheet: the open picker is a named scrim that closes on tap", async () => {
    const { onClose } = mount(true);
    await settle();

    const scrim = screen.getByTestId("country-loading");
    expect(scrim).toHaveAccessibleName(i18n.t("language.close"));
    expect(scrim.parentElement?.className).toContain("z-40");
    expect(screen.queryByTestId("country-sheet")).toBeNull();

    await userEvent.click(scrim);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("the host's layer class sets the z layer (z-[70] over the rewards login)", async () => {
    render(
      <Provider store={store}>
        <CountryPicker open onClose={vi.fn()} layerClass="z-[70]" />
      </Provider>
    );
    await settle();

    expect(screen.getByTestId("country-loading").parentElement?.className).toContain("z-[70]");
  });
});
