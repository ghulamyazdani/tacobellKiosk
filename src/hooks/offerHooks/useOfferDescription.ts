/**
 * The REWARDS rows' descriptions, composed on the kiosk (lane offers-parity,
 * F3; posistKiosk OffersSheet.descriptionFor parity). Lazy: only the rewards
 * sheet (bagLazyParts) imports this, so the copy and the composer stay off
 * the boot path.
 *
 * Rules, in order:
 *  1. the offer's own `description`, trimmed (no payload sends one today);
 *  2. the buy/get sentence from the SDK's data-only clauses
 *     (@cx-sdk/ordering/offer/offerDescription): each clause joined to the
 *     previous one by THAT clause's relation, the connector chosen from the
 *     bodies, never the prefixes (PK buyGetCopy) — a dead buy side reads
 *     "Get …", never a dangling "Buy &";
 *  3. the item-criteria scope line ("10% off everything except Beer"), with
 *     the cap the bill applies (F5: "· up to £150.00"; an amount prints
 *     min(value, cap)) — and its lock line ("Not valid on Beer");
 *  4. "" — the row keeps its mechanic line.
 * Names: a buy item resolves through the menu (entityMap, then variantObject
 * as "Base (Variant)"), the payload's POS name the fallback; a get item is
 * its converter-resolved menu entity (+ " (Size)" for a fixed size); a
 * category keeps the payload's English name (P11). Words come from keys;
 * "qty name" and "Base (Variant)" are composed here with a space. In Arabic
 * every value composed here rides as an RTL isolate (rtlRun).
 * Never throws (D10): the sheet renders inside the bag's lazy boundary.
 */
import { useCallback } from "react";
import { useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import { selectEntityMap, selectVariantObject } from "@cx-sdk/catalog/state/Menu.slice";
import {
  buildBuyGetDescription,
  type DescClause,
  type DescDiscount,
  type DescName,
} from "@cx-sdk/ordering/offer/offerDescription";
import { getOfferMechanic, type SavingsOffer } from "@cx-sdk/ordering/offer/offerSavings";
import { isRtl } from "../../i18n";
import useLocalized from "../utils/useLocalized";
import useCurrencySymbol from "../utils/useCurrencySymbol";
import { getOfferScope, type OfferScope, type OfferScopeNameResolver } from "./offerScopeCopy";
// The keys this hook reads ride the lazy chunk (D7 boot budget): lazy only.
import "../../i18n/lazyCopy";

export interface OfferDescription {
  /** The row's description, "" when none can be composed. */
  text: string;
  /** An item-criteria lock's scoped line, when the scope can be stated. */
  lockLine?: string;
}

type Named = { name?: unknown; selectedVariant?: Named | null };
type EntityMapIn = Record<string, Named | undefined> | null | undefined;
type VariantObjectIn =
  | Record<string, { baseItem?: Named | null; variant?: Named | null } | undefined>
  | null
  | undefined;
type ScopeEntry = Parameters<OfferScopeNameResolver>[0];

const EMPTY: OfferDescription = { text: "" };

/**
 * A value composed here ("2 <name>", "<name> <discount>", the joined clauses,
 * the scope list) as an RTL isolate (U+2067 … U+2069) while the active
 * language is RTL. i18next wraps an interpolated value in FSI (i18n/index.ts),
 * and with no strong letter of its own outside the nested name isolates that
 * FSI resolves LTR — an Arabic reader then met the parts backwards
 * ("<name> 2"). English is untouched.
 */
const rtlRun = (s: string): string => (s && isRtl() ? `\u2067${s}\u2069` : s);

export default function useOfferDescription(): (
  offer: SavingsOffer | null | undefined,
) => OfferDescription {
  const { t } = useTranslation();
  const { name, text } = useLocalized();
  const currency = useCurrencySymbol();
  const entityMap = useSelector(selectEntityMap) as EntityMapIn;
  const variantObject = useSelector(selectVariantObject) as VariantObjectIn;

  return useCallback(
    (offer: SavingsOffer | null | undefined): OfferDescription => {
      try {
        if (!offer) return EMPTY;
        const money = (n: number) => `${currency}${Number(n).toFixed(2)}`;
        const raw = (value: unknown) => (typeof value === "string" ? value.trim() : "");

        /** "Base (Variant)" when the two halves differ, else whichever exists. */
        const sized = (base: string, size: string) =>
          base && size && size !== base ? `${base} (${size})` : base || size;
        const menuName = (id: string | undefined): string => {
          if (!id) return "";
          const entity = entityMap?.[id];
          if (entity) return name(entity);
          const hit = variantObject?.[id];
          return hit ? sized(hit.baseItem ? name(hit.baseItem) : "", hit.variant ? name(hit.variant) : "") : "";
        };
        const nameOf = (ref: DescName): string => {
          if (ref.kind === "category") return text(ref.name);
          if (ref.kind === "item") return menuName(ref.id) || text(raw(ref.fallback));
          const entity = ref.entity as Named;
          const shown = sized(name(entity), entity?.selectedVariant ? name(entity.selectedVariant) : "");
          return shown || text(raw(ref.fallback));
        };
        const discountOf = (discount: DescDiscount): string =>
          discount.kind === "free"
            ? t("offers.desc.free")
            : discount.kind === "percent"
              ? t("offers.desc.percentOff", { value: discount.value })
              : t("offers.desc.amountOff", { amount: money(discount.value) });
        const clauseText = (clause: DescClause): string => {
          const label = nameOf(clause.name);
          if (!label) return "";
          const body =
            clause.name.kind === "category"
              ? clause.qty !== null
                ? t("offers.desc.category", { count: clause.qty, category: label })
                : t("offers.desc.categoryAny", { category: label })
              : clause.qty !== null
                ? `${clause.qty} ${label}`
                : label;
          if (!clause.discount) return body;
          const line = `${body} ${discountOf(clause.discount)}`;
          return clause.each ? t("offers.desc.each", { clause: rtlRun(line) }) : line;
        };
        /** Rendered clauses only, each joined by the PREVIOUS clause's relation. */
        const join = (clauses: DescClause[]): string => {
          const parts = clauses
            .map((clause) => ({ text: clauseText(clause), relation: clause.relation }))
            .filter((part) => part.text !== "");
          return parts.reduce(
            (sentence, part, index) =>
              index === 0
                ? part.text
                : `${sentence}${t(parts[index - 1].relation === "or" ? "offers.desc.or" : "offers.desc.comma")}${part.text}`,
            "",
          );
        };

        // 3 (computed first: the lock line rides along whatever the text).
        const kind = getOfferMechanic(offer);
        let scopeLine = "";
        let lockLine: string | undefined;
        if (kind === "percentItems" || kind === "amountItems") {
          const resolveName = (entry: ScopeEntry): string => {
            const item = entry?.item as { baseItemId?: string; _id?: string; name?: string } | undefined;
            if (item) return menuName(item.baseItemId || item._id) || text(raw(item.name));
            return text(raw(entry?.category?.categoryName));
          };
          const scope: OfferScope | null = getOfferScope(offer, resolveName);
          if (scope) {
            const separator = t("offers.scopeSeparator");
            const listed = scope.names.join(separator);
            const scopeText = rtlRun(
              scope.overflow > 0 ? `${listed}${separator}${t("offers.scopeMore", { qty: scope.overflow })}` : listed,
            );
            const value = Number(offer.type?.value) || 0;
            const cap = Number(offer.maxDiscount) || 0;
            const except = scope.mode === "except";
            if (kind === "percentItems") {
              const line = t(except ? "offers.mechPercentItemsExcept" : "offers.mechPercentItemsOnly", {
                value,
                scope: scopeText,
              });
              scopeLine = cap > 0 ? t("offers.upTo", { line, max: money(cap) }) : line;
            } else {
              scopeLine = t(except ? "offers.mechAmountItemsExcept" : "offers.mechAmountItemsOnly", {
                amount: money(cap > 0 ? Math.min(value, cap) : value),
                scope: scopeText,
              });
            }
            lockLine = t(except ? "offers.lockedItemCriteriaExcept" : "offers.lockedItemCriteriaOnly", {
              scope: scopeText,
            });
          }
        }

        // 1.
        const own = raw((offer as { description?: unknown }).description);
        if (own) return { text: own, lockLine };

        // 2.
        const ast = buildBuyGetDescription(offer);
        if (ast) {
          const buy = rtlRun(join(ast.buy));
          const get = rtlRun(join(ast.get));
          const sentence =
            buy && get
              ? t("offers.desc.buyGet", { buy, get })
              : get
                ? t("offers.desc.getOnly", { get })
                : buy
                  ? t("offers.desc.buyOnly", { buy })
                  : "";
          if (sentence) return { text: sentence, lockLine };
        }

        // 3, then 4.
        return { text: scopeLine, lockLine };
      } catch {
        return EMPTY;
      }
    },
    [t, name, text, currency, entityMap, variantObject],
  );
}
