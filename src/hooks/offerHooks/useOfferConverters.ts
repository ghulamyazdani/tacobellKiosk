/* eslint-disable @typescript-eslint/no-explicit-any --
 * Verbatim copy of the posistKiosk useOfferConverters wrapper (P5 port). The anys are
 * inherited; typed in the P6/P7 domain passes. Do not add NEW anys.
 */
import { useDispatch, useSelector } from "react-redux";
import type { UnknownAction } from "@reduxjs/toolkit";
import {
  selectOffers,
  setFilteredOffers,
} from "@cx-sdk/ordering/state/offer.slice";
import { convertOffersForMenu } from "@cx-sdk/ordering/offer/offerMenuConversion";

const useOfferConverters = () => {
  const dispatch = useDispatch();
  const offers = useSelector(selectOffers);

  const converOffersForGetItemByMenu = (
    entityMap: any,
    categoryMap: any,
    variantEntityMap: any,
    fetchModifierProperties: any,
    passedOffers: any,
    // Defaults to dispatch; the order-type switch stages it (fetchMenu opts).
    apply: (action: UnknownAction) => unknown = dispatch,
  ) => {
    // The conversion is the SDK's (C1a, a verbatim move pinned by
    // src/__tests__/offerMenuConversion.golden.test.ts); this hook only picks
    // the offers (passed, else the stored list) and applies the result.
    apply(
      setFilteredOffers(
        convertOffersForMenu(
          passedOffers ? passedOffers : offers,
          entityMap,
          categoryMap,
          variantEntityMap,
          fetchModifierProperties,
        ),
      ),
    );
  };

  return {
    converOffersForGetItemByMenu,
  };
};
export default useOfferConverters;
