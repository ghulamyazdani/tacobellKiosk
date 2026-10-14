import { useTranslation } from "react-i18next";
import ErrorModal from "../common/ErrorModal";

interface RemoveItemModalProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * REMOVE ITEM confirm — Figma 1:4551 (of 1:4533) on ErrorModal's 680 shell
 * (audit-fixes C4a): 680 × 396, no mark, "REMOVE ITEM" + the two-line body,
 * 280 × 60 CTAs 26 px apart — outlined "NO, BACK TO CART" left, red filled
 * "YES, DELETE" right (`danger`). An alertdialog with an inert scrim (a
 * backdrop tap no longer cancels) and focus on NO, BACK TO CART — the safe
 * choice (WAI-ARIA APG alertdialog; a keypad Enter never deletes).
 *
 * Purely presentational: the caller owns what confirm / cancel dispatch.
 * Mounted inside the bag's z-40 context, where ErrorModal's z-80 clears the
 * bag's other overlays.
 */
export default function RemoveItemModal({
  open,
  onCancel,
  onConfirm,
}: RemoveItemModalProps) {
  const { t } = useTranslation();

  if (!open) return null;

  return (
    <ErrorModal
      testId="remove-item-modal"
      icon={false}
      initialFocus="secondary"
      title={t("removeItem.title")}
      message={t("removeItem.body")}
      secondary={{
        label: t("removeItem.cancel"),
        testId: "remove-item-cancel",
        onClick: onCancel,
      }}
      primary={{
        label: t("removeItem.confirm"),
        testId: "remove-item-confirm",
        onClick: onConfirm,
        danger: true,
      }}
    />
  );
}
