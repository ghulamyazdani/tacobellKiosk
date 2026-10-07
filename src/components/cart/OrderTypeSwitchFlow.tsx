import { useState } from "react";
import { useDispatch } from "react-redux";
import { useTranslation } from "react-i18next";
import type {
  OrderTypeKind,
  SwitchablePipeline,
} from "@cx-sdk/ordering/cart/orderTypeTarget";
import useOrderTypeSwitch from "../../hooks/cartHooks/useOrderTypeSwitch";
import { setOrderTypeSwitchNotice } from "../../redux/features/menuSelections/menuSelections.slice";
import ErrorModal from "../common/ErrorModal";
import "../../i18n/lazyCopy";

interface OrderTypeSwitchFlowProps {
  target: SwitchablePipeline;
  targetKind: OrderTypeKind;
  onDone: () => void;
  onRemoveLoyaltyRow: (row: unknown) => void;
}

/**
 * The in-bag EAT IN / TAKE OUT switch (decision D1; design language — no
 * Figma frame, flagged for sign-off): confirm (ErrorModal, icon off) →
 * in-flight overlay (no exits; the hook holds idle and every request is
 * bounded) → failure (TRY AGAIN / BACK; nothing changed) or done. The hook
 * stages, commits and re-prices; this only drives the dialogs and raises the
 * removal notice. Never navigates (H1). Lazy (bagLazyParts).
 * z-stack in the bag: dialogs z-[80], the in-flight overlay z-[85].
 */
export default function OrderTypeSwitchFlow({
  target,
  targetKind,
  onDone,
  onRemoveLoyaltyRow,
}: OrderTypeSwitchFlowProps) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const { switchTo } = useOrderTypeSwitch({ onRemoveLoyaltyRow });
  // Local, not the hook's status: ANY non-ok outcome (or a throw) must land
  // on the failure dialog, never leave the exitless overlay up.
  const [phase, setPhase] = useState<"confirm" | "switching" | "failed">(
    "confirm",
  );

  const type = t(targetKind === "takeOut" ? "bag.takeOut" : "bag.eatIn");
  const current = t(targetKind === "takeOut" ? "bag.eatIn" : "bag.takeOut");

  const run = async () => {
    setPhase("switching");
    try {
      const outcome = await switchTo(target);
      if (outcome.aborted) return; // unmounted mid-flight: nothing written
      if (!outcome.ok) {
        setPhase("failed");
        return;
      }
      // No mounted guard on purpose: ok means the switch committed, and the
      // notice must outlive the bag's empty-cart exit.
      if (outcome.removedRows.length > 0) {
        dispatch(
          setOrderTypeSwitchNotice({ removed: [...outcome.removedRows] }),
        );
      }
      onDone();
    } catch {
      setPhase("failed");
    }
  };

  if (phase === "confirm") {
    return (
      <ErrorModal
        testId="bag-ordertype-confirm"
        icon={false}
        title={t("bag.orderType.confirmTitle", { type })}
        message={t("bag.orderType.confirmBody")}
        primary={{
          label: t("bag.orderType.confirmYes"),
          testId: "bag-ordertype-confirm-yes",
          onClick: () => void run(),
        }}
        secondary={{
          label: t("bag.orderType.confirmNo", { current }),
          testId: "bag-ordertype-confirm-no",
          onClick: onDone,
        }}
      />
    );
  }

  if (phase === "failed") {
    return (
      <ErrorModal
        testId="bag-ordertype-failed"
        title={t("bag.orderType.failedTitle", { type })}
        message={t("bag.orderType.failedBody")}
        primary={{
          label: t("menuError.retry"),
          testId: "bag-ordertype-retry",
          onClick: () => void run(),
        }}
        secondary={{
          label: t("menuError.back"),
          testId: "bag-ordertype-back",
          onClick: onDone,
        }}
      />
    );
  }

  // Switching (or committed, until onDone unmounts the flow).
  return (
    <div
      data-testid="bag-ordertype-switching"
      role="status"
      aria-live="polite"
      className="absolute inset-0 z-[85] flex flex-col items-center justify-center gap-[32px] bg-tb-purple/80"
    >
      <div className="h-[8px] w-[420px] overflow-hidden rounded-full bg-tb-surface/20">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-tb-pink" />
      </div>
      <p className="tb-display text-[32px] leading-[32px] text-tb-surface">
        {t("bag.orderType.switching")}
      </p>
    </div>
  );
}
