import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import DaypartTicker from "../DaypartTicker";
import i18n from "../../../i18n";

/*
  Post-P9 27b (D5) + fixer UI-2: operator copy keeps the designed marquee
  speed. index.css moves one copy in 18 s, tuned for the 16-character design
  line; a `message` scales the duration by length / 16, never below 18 s. The
  default copy carries NO inline style — byte-identical to before.
*/

const track = (container: HTMLElement) =>
  container.querySelector(".tb-marquee-track") as HTMLElement;

describe("DaypartTicker", () => {
  it("no message: the design copy (ticker.lunch) and no inline style at all", () => {
    const { container } = render(<DaypartTicker />);

    expect(screen.getAllByText(i18n.t("ticker.lunch"))).toHaveLength(12);
    expect(track(container)).not.toHaveAttribute("style");
  });

  it("a 39-character operator message runs 43.875 s (18 × 39/16)", () => {
    const message = "Two tacos for the price of one, 2-4 PM!";
    expect(message).toHaveLength(39);
    const { container } = render(<DaypartTicker message={message} />);

    expect(screen.getAllByText(message)).toHaveLength(12);
    expect(track(container).style.animationDuration).toBe("43.875s");
  });

  it("RTL isolates (U+2068 … U+2069) do not count: a 21-char Arabic line runs 23.625 s", () => {
    const visible = "ثلاثاء التاكو كل يوم!";
    expect(visible).toHaveLength(21);
    const { container } = render(
      <DaypartTicker message={`\u2068${visible}\u2069`} />
    );

    // 18 × 21/16 — not 18 × 23/16 = 25.875 s with the two marks counted.
    expect(track(container).style.animationDuration).toBe("23.625s");
  });

  it("a message shorter than 16 characters keeps the 18 s floor", () => {
    const { container } = render(<DaypartTicker message="Hola!" />);

    expect(track(container).style.animationDuration).toBe("18s");
  });

  it("only the second copy is hidden from assistive tech", () => {
    const { container } = render(<DaypartTicker message="Hola!" />);
    const copies = track(container).children;

    expect(copies).toHaveLength(2);
    expect(copies[0]).not.toHaveAttribute("aria-hidden", "true");
    expect(copies[1]).toHaveAttribute("aria-hidden", "true");
  });
});
