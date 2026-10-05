import { useEffect, useState, type ReactNode } from "react";

export const STAGE_WIDTH = 1080;
export const STAGE_HEIGHT = 1920;

/**
 * Fixed 1080×1920 design stage, scaled uniformly to fit the real viewport.
 *
 * The kiosk hardware IS 1080×1920 portrait (scale = 1 in production); the
 * scaling exists so development and E2E at other window sizes render the
 * same layout proportionally. Screens are laid out in design pixels against
 * this stage — deliberately no vh/vw units (posistKiosk's ~113 vh/vw call
 * sites are what made its layout unverifiable off-device).
 */
export function KioskStage({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(() => computeScale());

  useEffect(() => {
    const onResize = () => setScale(computeScale());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div className="flex h-screen w-screen items-center justify-center overflow-hidden">
      <div
        data-testid="kiosk-stage"
        className="relative shrink-0 overflow-hidden"
        style={{
          width: STAGE_WIDTH,
          height: STAGE_HEIGHT,
          transform: `scale(${scale})`,
          transformOrigin: "center center",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function computeScale(): number {
  return Math.min(
    window.innerWidth / STAGE_WIDTH,
    window.innerHeight / STAGE_HEIGHT
  );
}
