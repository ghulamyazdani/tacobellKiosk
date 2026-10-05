/* eslint-disable @typescript-eslint/no-explicit-any --
 * Verbatim copy of the posistKiosk useCartHook wrapper (P5 port). The anys are
 * inherited; typed in the P6/P7 domain passes. Do not add NEW anys.
 */
// Thin wrapper over the SDK cart engine. All pure decision/transform logic
// (add/merge rules, quantity math, DP max-quantity gate, freebie pricing,
// snapshot-restore diffing) lives in @cx-sdk/ordering/cart/cartEngine; this
// hook gathers redux state, calls the engine, and performs the side effects
// (dispatches, IndexedDB writes, analytics, store.getState() reads).

import {
  addItemToCartRdx,
  increaseItemQuantity,
  decreaseItemQuantity,
  removeItemFromCart,
  setCartItems,
  selectCart,
  updateItemCartRdx,
  deleteItemFromCart,
  emptyGetItemsState,
  removeGetItemsRdx,
  increaseGetItemQuantity,
  addNewGetItemQuantity,
  decreaseGetItemQuantity,
  addGetItemsRdx,
} from "@cx-sdk/ordering/state/cart.slice";
import { syncSubTotalOnCart } from "@cx-sdk/ordering/state/cart.slice";
import { db } from "../../models/db";
import { useDispatch } from "react-redux";
import useCartIndexedDb from "../cartHooks/useCartIndexedDb";
import { cartQuantity } from "@cx-sdk/ordering/state/cart.slice";
import { selectMaxCartQuantity } from "@cx-sdk/ordering/state/cart.slice";
import { useSelector } from "react-redux";
import {
  selectDiscountOnAddon,
  selectIntensionalQuickCartClose,
  setShowErrorModalGlobal,
  toggleQuickCart,
} from "@cx-sdk/catalog/state/appSettings.slice";
// Side-effect import kept for parity: the module registers dayjs plugins
// (isBetween, customParseFormat) at import time; the hook itself is unused
// here (its only call site is commented out below).
import "../schedulerHooks/useSchedulerConverter";
import { selectCurrentSession } from "@cx-sdk/catalog/state/dynamicPricing.slice";
import {
  mutateAddToCartModal,
  setRecommendationDetour,
} from "../../redux/features/menuSelections/menuSelections.slice";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";
import { useStore } from "react-redux";
import {
  hasItemRecommendations,
  type EntityMap,
  type OutOfStockMap,
} from "@cx-sdk/catalog/recommendation/recommendationUtils";
import {
  buildCartItemContent,
  buildDpMaxQuantityErrorMessage,
  buildGetItemRdxContent,
  cartIDGenerator,
  doesGetItemExist as doesGetItemExistEngine,
  doesItemExistInCart as doesItemExistInCartEngine,
  findCartRowByKey,
  generateUniqueId,
  getAllCustomizationList,
  isAnyLoyaltyItemPresentInCart as isAnyLoyaltyItemPresentInCartEngine,
  isCustomizedAddType,
  isDpMaxQuantityValid as isDpMaxQuantityValidEngine,
  planCartSnapshotRestore,
  redeemGetItem as redeemGetItemEngine,
  resolveAddItemPresentation,
  resolveCartIdKey,
  withIncreasedQuantity,
  type AddItemToCartOptions,
  type CartSnapshotRow,
  type ITEMTYPEt,
} from "@cx-sdk/ordering/cart/cartEngine";

export type { AddItemToCartOptions };

/** The two slices the recommendation lookup reads out of the untyped store. */
interface RecommendationLookupState {
  menu?: { entityMap?: EntityMap };
  menuSelections?: { outOfStockItems?: OutOfStockMap };
}

function useCartHook() {
  const dispatch = useDispatch();
  const cart = useSelector(selectCart);
  const internsionalQuickCartOpen = useSelector(
    selectIntensionalQuickCartClose,
  );
  useSelector(cartQuantity);
  useSelector(selectMaxCartQuantity);
  const discountOnAddonRdx = useSelector(selectDiscountOnAddon);
  // const { checkCartItemsAsPerSchedulers } = useSchedulerConverter();
  const currentSessionRdx = useSelector(selectCurrentSession);
  // Store handle, not a subscription. This hook is instantiated by dozens of
  // components; subscribing it to the entityMap / out-of-stock map would
  // re-render every item card on each out-of-stock poll. The recommendation
  // check only needs a value at add time, so it reads state on demand.
  const store = useStore();

  const {
    addToIndexedDbCart,
    increaseItemQuantityByIdIndexedDb,
    decreaseItemQuantityByIdIndexedDb,
    updateItemIndexedDbCart,
    removeItemFromIndexedDbCart,
    deleteItemFromIndexedDbCart,
    replaceIndexedDbCart,
  } = useCartIndexedDb();

  const isDpMaxQuantityValid = (item: any) =>
    isDpMaxQuantityValidEngine(item, cart?.cartItems, currentSessionRdx);

  const showDpMaxQuantityError = () => {
    dispatch(
      setShowErrorModalGlobal({
        showErrorModal: true,
        errorMessage: buildDpMaxQuantityErrorMessage(currentSessionRdx),
      }),
    );
  };

  const addItemToCart = (
    item: any,
    itemType: any,
    options: AddItemToCartOptions = {},
  ) => {
    if (!isDpMaxQuantityValid(item)) {
      showDpMaxQuantityError();
      return false;
    }

    const itemContent = buildCartItemContent(item, itemType);
    dispatch(addItemToCartRdx(itemContent));
    addToIndexedDbCart(itemContent);
    captureKioskEvent(KioskEventName.CartModified, {
      modification_type: "add",
      item_id: item?.id,
      cart_quantity: itemContent?.quantity,
    });

    const isCustomizedAdd = isCustomizedAddType(itemType);

    // A plain add normally just reveals the quick cart. It now also earns the
    // confirmation modal — but only when the item actually has recommendations
    // to show, so the fastest add path on the kiosk stays unblocked otherwise.
    // Short-circuits on the first resolvable id and allocates nothing when the
    // item has no `recommendedItems` at all, which is the common case.
    let showRecommendationModal = false;
    if (!isCustomizedAdd && !options?.suppressAddedModal) {
      const state = store.getState() as RecommendationLookupState;
      showRecommendationModal = hasItemRecommendations(
        state?.menu?.entityMap,
        state?.menuSelections?.outOfStockItems,
        itemContent,
      );
    }

    const { shouldOpenQuickCart, shouldOpenAddedModal } =
      resolveAddItemPresentation({
        isCustomizedAdd,
        suppressAddedModal: options?.suppressAddedModal,
        showRecommendationModal,
        intentionalQuickCartClose: internsionalQuickCartOpen,
      });

    if (shouldOpenQuickCart) {
      dispatch(toggleQuickCart(true));
    }

    if (shouldOpenAddedModal) {
      /*
        Did this add come from a "You Might Like" tap that detoured through
        /customization? If so the modal still opens (customized adds have always
        confirmed), but WITHOUT its own strip — otherwise the customer can hop
        suggestion to suggestion forever.

        Read through the store handle, not a selector: this hook is instantiated
        by dozens of components and a subscription here re-renders every one of
        them. Consumed immediately, so it can never affect a later, unrelated
        add.
      */
      const cameFromRecommendation = !!(store.getState() as any)?.menuSelections
        ?.recommendationDetour;
      if (cameFromRecommendation) {
        dispatch(setRecommendationDetour(false));
      }

      dispatch(
        mutateAddToCartModal({
          isOpen: true,
          item: cameFromRecommendation
            ? { ...itemContent, suppressRecommendations: true }
            : itemContent,
        }),
      );
    }

    return true;
  };

  //update cart
  const updateItemCart = (item: any) => {
    if (!isDpMaxQuantityValid(item)) {
      showDpMaxQuantityError();
      return false;
    }
    const localItem = { ...item };

    updateItemIndexedDbCart(localItem, item.itemId);
    dispatch(updateItemCartRdx({ item: item }));
    return true;
  };

  const IncreaseItemQuantityById = (
    itemId: any,
    itemType: ITEMTYPEt,
    idKey: any,
    item: any,
  ) => {
    const itemFromRdx = findCartRowByKey(cart?.cartItems, idKey, item);
    if (!isDpMaxQuantityValid(withIncreasedQuantity(itemFromRdx))) {
      showDpMaxQuantityError();
      return false;
    }
    const resolvedIdKey = resolveCartIdKey(itemType, idKey);
    dispatch(increaseItemQuantity({ id: itemId, IDKEY: resolvedIdKey }));
    increaseItemQuantityByIdIndexedDb(itemId, resolvedIdKey);
    captureKioskEvent(KioskEventName.CartModified, {
      modification_type: "increase",
      item_id: itemFromRdx?.id,
    });
    return true;
  };

  const decreaseItemQuantityById = async (
    itemId: any,
    itemType: ITEMTYPEt,
    idKey: any,
  ) => {
    const resolvedIdKey = resolveCartIdKey(itemType, idKey);
    dispatch(decreaseItemQuantity({ id: itemId, IDKEY: resolvedIdKey }));
    decreaseItemQuantityByIdIndexedDb(itemId, resolvedIdKey, dispatch);
    captureKioskEvent(KioskEventName.CartModified, {
      modification_type: "decrease",
      item_id: itemId,
    });
  };

  const removeItemFromCartFnc = async (
    itemId: any,
    itemType: ITEMTYPEt,
    idKey: any,
  ) => {
    const resolvedIdKey = resolveCartIdKey(itemType, idKey);
    dispatch(removeItemFromCart({ id: itemId, IDKEY: resolvedIdKey }));
    removeItemFromIndexedDbCart(itemId, resolvedIdKey);
    captureKioskEvent(KioskEventName.CartModified, {
      modification_type: "remove",
      item_id: itemId,
    });
  };

  const doesItemExistInCart = (id: any) =>
    doesItemExistInCartEngine(id, cart?.cartItems);

  const deleteItemFromCartByItemId = (itemId: any) => {
    dispatch(deleteItemFromCart({ id: itemId }));
    deleteItemFromIndexedDbCart(itemId);
  };

  const syncCartOnReLoad = async () => {
    try {
      await db.open();
      const cartItems = await db.cartItems.toArray();
      dispatch(setCartItems(cartItems));
      dispatch(syncSubTotalOnCart(cartItems)); // Sync with Redux store
    } catch (error) {
      console.error("Error syncing cart from Dexie:", error);
      throw new Error("Error syncing cart from Dexie", { cause: error });
    }
  };

  const addLoyaltyItemToCart = (item: any, itemType: any) => {
    const itemContent = buildCartItemContent(item, itemType);

    dispatch(addItemToCartRdx(itemContent));
    addToIndexedDbCart(itemContent);
  };

  const removeLoyaltyItemFromCart = (itemId: any) => {
    dispatch(removeItemFromCart({ id: itemId, IDKEY: "itemId" }));
    removeItemFromIndexedDbCart(itemId, "itemId");
  };

  const isAnyLoyaltyItemPresentInCart = () =>
    isAnyLoyaltyItemPresentInCartEngine(cart?.cartItems);

  const redeemGetItem = (
    item: any,
    discountType: any,
    quantity: any,
    discountValue: any,
    isQuantityNeeded: any,
  ) =>
    // Freebie pricing math lives in the engine; `discountOnAddon` is the only
    // redux input it needs (see redeemGetItem's doc comment in cartEngine).
    redeemGetItemEngine(
      item,
      discountType,
      quantity,
      discountValue,
      isQuantityNeeded,
      discountOnAddonRdx,
    );

  const addGetItemToCart = (item: any, itemType: any) => {
    const itemContent = buildCartItemContent(item, itemType);

    dispatch(addItemToCartRdx(itemContent));
    addToIndexedDbCart(itemContent);
  };

  const addGetItemToRdx = (item: any, itemType: any) => {
    const itemContent = buildGetItemRdxContent(item, itemType);
    dispatch(addGetItemsRdx(itemContent));
    return true;
  };

  const IncreaseGetItemQuantityById = (
    itemId: any,
    itemType: ITEMTYPEt,
    idKey: any,
    _item: any,
  ) => {
    dispatch(
      increaseGetItemQuantity({
        id: itemId,
        IDKEY: resolveCartIdKey(itemType, idKey),
      }),
    );
    return true;
  };

  const addNewGetItemQuantityById = (
    itemId: any,
    itemType: ITEMTYPEt,
    idKey: any,
    _item: any,
  ) => {
    if (itemType === "ITEM") {
      dispatch(increaseGetItemQuantity({ id: itemId, IDKEY: idKey }));
    } else {
      dispatch(addNewGetItemQuantity({ id: itemId, IDKEY: "itemId" }));
    }
    return true;
  };

  const decreaseGetItemQuantityById = async (
    itemId: any,
    itemType: ITEMTYPEt,
    idKey: any,
  ) => {
    dispatch(
      decreaseGetItemQuantity({
        id: itemId,
        IDKEY: resolveCartIdKey(itemType, idKey),
      }),
    );
  };

  const removeGetItemsById = (id: any, IDKEY: any) => {
    dispatch(removeGetItemsRdx({ id, IDKEY }));
  };

  const doesGetItemExist = (id: any): any =>
    doesGetItemExistEngine(id, cart.getItems);

  const emptyGetItems = () => {
    dispatch(emptyGetItemsState());
  };

  const removeAllGetItems = (cartItems: any) => {
    cartItems?.forEach((item: any) => {
      if (item?.isGetItem) {
        dispatch(deleteItemFromCart({ id: item.itemId }));
        deleteItemFromIndexedDbCart(item?.itemId);
      }
    });
  };

  /**
   * Restore the PAID cart rows to a snapshot taken earlier in the SAME modal
   * flow (the BOGO buy stage's abandon rollback), and return the resulting
   * full cart list. The diff itself is planned by the engine
   * (planCartSnapshotRestore — see its doc comment for the paid-rows-only
   * scoping rationale); this wrapper executes it.
   *
   * Redux is updated through the existing reducers (per-row diff); IndexedDB
   * is replaced wholesale in ONE rw transaction with the final list —
   * per-row idb ops could race the fire-and-forget increase/decrease
   * pipelines still in flight from the stage's steppers. Deliberately NOT
   * the analytics-emitting wrappers: a rollback is not customer cart
   * activity and would pollute the cart_modified funnel.
   *
   * Only valid while the flow that took the snapshot owns the only mutation
   * surface (a full-screen modal over /cart).
   */
  const restoreCartItemsSnapshot = (
    snapshotItems: CartSnapshotRow[],
  ): CartSnapshotRow[] => {
    const currentItems: CartSnapshotRow[] = cart?.cartItems || [];
    const { operations, finalItems } = planCartSnapshotRestore(
      currentItems,
      snapshotItems,
    );

    operations.forEach((op) => {
      if (op.type === "remove") {
        dispatch(removeItemFromCart({ id: op.itemId, IDKEY: "itemId" }));
      } else if (op.type === "update") {
        dispatch(updateItemCartRdx({ item: op.item }));
      } else {
        dispatch(addItemToCartRdx({ ...op.item }));
      }
    });

    replaceIndexedDbCart(finalItems);
    return finalItems;
  };

  return {
    addItemToCart,
    IncreaseItemQuantityById,
    decreaseItemQuantityById,
    doesItemExistInCart,
    cartIDGenerator,
    syncCartOnReLoad,
    getAllCustomizationList,
    addLoyaltyItemToCart,
    updateItemCart,
    removeItemFromCart: removeItemFromCartFnc,
    isAnyLoyaltyItemPresentInCart,
    removeLoyaltyItemFromCart,
    deleteItemFromCartByItemId,
    isDpMaxQuantityValid,
    generateUniqueId,
    redeemGetItem,
    addGetItemToCart,
    removeAllGetItems,
    addGetItemToRdx,
    IncreaseGetItemQuantityById,
    addNewGetItemQuantityById,
    decreaseGetItemQuantityById,
    removeGetItemsById,
    doesGetItemExist,
    emptyGetItems,
    restoreCartItemsSnapshot,
  };
}

export default useCartHook;
