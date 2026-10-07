import { useDispatch, useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import { selectTabType } from "@cx-sdk/catalog/state/pipeline.slice";
import { orderTypeKindOf } from "@cx-sdk/ordering/cart/orderTypeTarget";
import {
  clearOrderTypeSwitchNotice,
  selectOrderTypeSwitchNotice,
} from "../../redux/features/menuSelections/menuSelections.slice";
import useLocalized from "../../hooks/utils/useLocalized";
import ErrorModal from "../common/ErrorModal";
import "../../i18n/lazyCopy";

/**
 * "YOUR BAG WAS UPDATED" — the in-bag order-type switch removed rows the new
 * menu does not serve (design language, Modal 1:945 look: no icon, one wide
 * GOT IT; flagged for sign-off). Redux-driven (menuSelections), `fixed` and
 * rendered in both BagSheet branches, so it survives the bag's empty-cart
 * exit. Names resolve at render; the store keeps the row entities.
 * Lazy (bagLazyParts). z-[89]: under OfferRemovalNotice (z-[90]).
 */
export default function OrderTypeSwitchNotice() {
  const { t, i18n } = useTranslation();
  const dispatch = useDispatch();
  const notice = useSelector(selectOrderTypeSwitchNotice);
  const tabType: unknown = useSelector(selectTabType);
  const { name } = useLocalized();

  if (!notice) return null;

  const type = t(
    orderTypeKindOf(tabType) === "takeOut" ? "bag.takeOut" : "bag.eatIn",
  );
  const items = new Intl.ListFormat(i18n.language, {
    type: "conjunction",
  }).format(notice.removed.map((row) => name(row)).filter(Boolean));

  return (
    <div className="fixed inset-0 z-[89]">
      <ErrorModal
        testId="bag-ordertype-notice"
        icon={false}
        wide
        title={t("bag.orderType.removedTitle")}
        message={t("bag.orderType.removedBody", { type, items })}
        primary={{
          label: t("offers.gotIt"),
          testId: "bag-ordertype-notice-gotit",
          onClick: () => dispatch(clearOrderTypeSwitchNotice()),
        }}
      />
    </div>
  );
}
