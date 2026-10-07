import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { QRCodeProps } from "react-qr-code";
import PaytmQr from "../PaytmQr";
import i18n from "../../../i18n";

/*
  PaytmQr (P8b-07, D1): Paytm's UPI string encoded on the kiosk with
  react-qr-code, behind a LOCAL ErrorBoundary. The encoder is the real one
  except where a test flips `h.throwing` to make it throw.
*/

const h = vi.hoisted(() => ({ throwing: false, capture: vi.fn() }));

vi.mock("react-qr-code", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-qr-code")>();
  return {
    ...actual,
    QRCode: (props: QRCodeProps) => {
      if (h.throwing) throw new Error("encoder failed");
      return createElement(actual.QRCode, props);
    },
  };
});
vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => h.capture(...args),
}));

/** qr.js — react-qr-code's own encoder — at the level the kiosk uses ("L"). */
interface QrJs {
  addData: (data: string) => void;
  make: () => void;
  modules: boolean[][];
}
const moduleCount = async (value: string) => {
  const { default: QRCodeImpl } = await vi.importActual<{
    default: new (typeNumber: number, level: number) => QrJs;
  }>("qr.js/lib/QRCode");
  const { default: levels } = await vi.importActual<{ default: Record<string, number> }>(
    "qr.js/lib/ErrorCorrectLevel",
  );
  const code = new QRCodeImpl(-1, levels.L);
  code.addData(value);
  code.make();
  return code.modules.length;
};

const UPI = "upi://pay?pa=tb@paytm&pn=TB&am=9.00&tr=1700000000123";
const LONG_UPI =
  "upi://pay?pa=paytmqr2810050501011ooxxxxxxxxx@paytm&pn=Taco%20Bell%20Store%2012&mc=5814&tr=1700000000123" +
  "&tn=Order%201700000000123&am=1234.00&cu=INR&mode=19&orgid=000000&purpose=00&sign=MEUCIQDexampleexample";

const svgOf = () => screen.getByTestId("paytm-qr").querySelector("svg");
const viewBoxModules = () => Number(svgOf()?.getAttribute("viewBox")?.split(" ")[2]);

beforeEach(() => {
  h.throwing = false;
  h.capture.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("PaytmQr", () => {
  it("renders the QR as an svg inside a 616 card named 'Scan to pay' (role img)", () => {
    render(<PaytmQr value={UPI} />);
    const card = screen.getByRole("img", { name: i18n.t("paytm.qr.title") });
    expect(card).toBe(screen.getByTestId("paytm-qr"));
    expect(card).toHaveAttribute("aria-label", i18n.t("paytm.qr.title"));
    expect(card.style.width).toBe("616px");
    expect(card.style.height).toBe("616px");
    expect(card.querySelectorAll("svg")).toHaveLength(1);
    // PostHog's replay blockClass / autocapture opt-out (F3: the QR never reaches analytics).
    expect(card).toHaveClass("ph-no-capture");
  });

  it("sanity: qr.js gives 21 modules for version 1 and more for a longer payload", async () => {
    expect(await moduleCount("A")).toBe(21);
    expect(await moduleCount(LONG_UPI)).toBeGreaterThan(await moduleCount(UPI));
  });

  it.each([
    ["a short UPI string", UPI],
    ["a realistic signed UPI string", LONG_UPI],
    ["a single character (version 1)", "A"],
  ])("%s: the drawn matrix is exactly what qr.js encodes for the same value", async (_label, value) => {
    const expected = await moduleCount(value);
    render(<PaytmQr value={value} />);
    expect(viewBoxModules()).toBe(expected);
  });

  it.each([616, 360])("size %i: a quiet zone of at least 4 modules, even for the smallest QR", async (size) => {
    for (const value of ["A", UPI, LONG_UPI]) {
      const { unmount } = render(<PaytmQr value={value} size={size} />);
      const drawn = Number(svgOf()?.getAttribute("width"));
      const modules = await moduleCount(value);
      expect(((size - drawn) / 2) / (drawn / modules)).toBeGreaterThanOrEqual(4);
      unmount();
    }
  });

  it.each([
    ["empty", ""],
    ["blank", "   "],
    ["junk from a persisted slice", 42 as unknown as string],
    ["undefined", undefined as unknown as string],
  ])("%s value → renders nothing (a QR that scans to nothing is never shown)", (_label, value) => {
    const { container } = render(<PaytmQr value={value} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("an encoder throw shows the local fallback — no crash screen, no reload timer — and never reports the value", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined); // React logs the caught error
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    h.throwing = true;
    render(<PaytmQr value={`${UPI}&secretish=VALUE-MARKER`} />);

    expect(screen.queryByTestId("paytm-qr")).not.toBeInTheDocument();
    const fallback = screen.getByTestId("paytm-qr-unavailable");
    expect(fallback).toHaveTextContent(i18n.t("paytm.qr.unavailable"));
    expect(fallback.style.width).toBe("616px");
    expect(screen.queryByTestId("app-error")).not.toBeInTheDocument();
    expect(setTimeoutSpy.mock.calls.filter(([, ms]) => (ms ?? 0) >= 10_000)).toEqual([]);
    expect(h.capture).toHaveBeenCalledWith(
      "error_occurred",
      expect.objectContaining({ recovery_path: "local_fallback" }),
    );
    expect(JSON.stringify(h.capture.mock.calls)).not.toContain("VALUE-MARKER");
  });

  it("the REAL encoder overflowing (a payload no QR version holds) lands on the same fallback", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<PaytmQr value={`upi://pay?${"x".repeat(5000)}`} />);
    expect(screen.getByTestId("paytm-qr-unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("paytm-qr")).not.toBeInTheDocument();
  });
});
