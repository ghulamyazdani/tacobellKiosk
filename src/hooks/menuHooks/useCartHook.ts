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
import {
  selectCartOffer,
  syncSubTotalOnCart,
} from "@cx-sdk/ordering/state/cart.slice";
import { findOrphanedFreebieRowsWithCategories } from "@cx-sdk/ordering/offer/offerCategoryOwnership";
import { db } from "../../models/db";
import { useDispatch } from "react-redux";
import useCartIndexedDb from "../cartHooks/useCartIndexedDb";
import { cartQuantity } from "@cx-sdk/ordering/state/cart.slice";
import { selectMaxCartQuantity } from "@cx-sdk/ordering/state/cart.slice";
import { useSelector } from "react-redux";
import {
  selectDiscountOnAddon,
  setShowErrorModalGlobal,
} from "@cx-sdk/catalog/state/appSettings.slice";
// Side-effect import kept for parity: the module registers dayjs plugins
// (isBetween, customParseFormat) at import time; the hook itself is unused
// here (its only call site is commented out below).
import "../schedulerHooks/useSchedulerConverter";
import { selectCurrentSession } from "@cx-sdk/catalog/state/dynamicPricing.slice";
import {
  mutateAddToCartModal,
  setRecommendationDetour,
  stageConfiguredUpsellItem,
} from "../../redux/features/menuSelections/menuSelections.slice";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";
import i18n from "../../i18n";
import { useStore } from "react-redux";
import {
  buildCartItemContent,
  buildGetItemRdxContent,
  cartIDGenerator,
  doesGetItemExist as doesGetItemExistEngine,
  doesItemExistInCart as doesItemExistInCartEngine,
  findCartRowByKey,
  generateUniqueId,
  getAllCustomizationList,
  isAnyLoyaltyItemPresentInCart as isAnyLoyaltyItemPresentInCartEngine,
  isDpMaxQuantityValid as isDpMaxQuantityValidEngine,
  planCartSnapshotRestore,
  redeemGetItem as redeemGetItemEngine,
  resolveCartIdKey,
  withIncreasedQuantity,
  type AddItemToCartOptions,
  type CartSnapshotRow,
  type ITEMTYPEt,
} from "@cx-sdk/ordering/cart/cartEngine";

export type { AddItemToCartOptions };

/**
 * TB-local: `stamped` — the item is a row this function already built (a
 * product-added pick parked by its chooser): keep its itemId. Restamped, two
 * rows of one product replayed in the same millisecond would get the same
 * "<ms>_<id>" key, and the reducer would merge them into one row.
 */
export type TbAddItemToCartOptions = AddItemToCartOptions & { stamped?: boolean };

/**
 * What this hook reads out of the untyped store on demand: the live cart
 * (the DP check) and the product-added modal's detour (the parking guard).
 */
interface RecommendationLookupState {
  menuSelections?: {
    addToCartModal?: { isOpen?: boolean };
    recommendationDetour?: boolean;
  };
  cart?: { cartItems?: unknown[] };
}

function useCartHook() {
  const dispatch = useDispatch();
  const cart = useSelector(selectCart);
  useSelector(cartQuantity);
  useSelector(selectMaxCartQuantity);
  const discountOnAddonRdx = useSelector(selectDiscountOnAddon);
  // const { checkCartItemsAsPerSchedulers } = useSchedulerConverter();
  const currentSessionRdx = useSelector(selectCurrentSession);
  // Store handle, not a subscription. This hook is instantiated by dozens of
  // components; subscribing it to the cart or the modal's detour would
  // re-render every item card on each change. The add-time checks only need
  // a value at add time, so they read state on demand.
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

  // The LIVE cart, not this render's: ProductAddedModal's ADD TO ORDER writes
  // several rows in one handler, and each check must count the ones before it.
  const isDpMaxQuantityValid = (item: any) =>
    isDpMaxQuantityValidEngine(
      item,
      (store.getState() as RecommendationLookupState)?.cart?.cartItems,
      currentSessionRdx,
    );

  // Translated here (the SDK's English buildDpMaxQuantityErrorMessage stays
  // for the fork); i18n.t, not useTranslation: this hook is instantiated by
  // dozens of components and must not subscribe them to language changes.
  const showDpMaxQuantityError = () => {
    dispatch(
      setShowErrorModalGlobal({
        showErrorModal: true,
        errorMessage: i18n.t("toast.dpMaxQuantity", {
          // A NUMBER, so i18next picks the plural form ("1 item"); parsed as
          // the SDK's cap check parses the session's string.
          count: parseInt(currentSessionRdx?._extras?.maxQtyItem, 10),
          session: currentSessionRdx?.sessionName ?? "",
        }),
      }),
    );
  };

  const addItemToCart = (
    item: any,
    itemType: any,
    options: TbAddItemToCartOptions = {},
  ) => {
    if (!isDpMaxQuantityValid(item)) {
      showDpMaxQuantityError();
      return false;
    }

    const itemContent = options.stamped ? item : buildCartItemContent(item, itemType);

    // The tail of a product-added suggestion's chooser (Select a Size / the
    // PDP): the guest picked it but has not pressed ADD TO ORDER, so it is
    // parked with the modal's other picks — above the cart write, Dexie and
    // CartModified, which are what "added" means. ADD TO ORDER replays it.
    const selections = (store.getState() as RecommendationLookupState)
      ?.menuSelections;
    if (selections?.addToCartModal?.isOpen && selections?.recommendationDetour) {
      dispatch(stageConfiguredUpsellItem(itemContent));
      return true;
    }

    dispatch(addItemToCartRdx(itemContent));
    addToIndexedDbCart(itemContent);
    captureKioskEvent(KioskEventName.CartModified, {
      modification_type: "add",
      item_id: item?.id,
      cart_quantity: itemContent?.quantity,
    });

    // User 2026-10-14 ("item added modal should also come when normal item
    // without customization is added"): EVERY add confirms — a plain one too —
    // unless its caller is a surface that confirms by itself and says so
    // (suppressAddedModal: the bag, the buy stage, the PDP and rewards rails,
    // the modal's own picks). posistKiosk and the SDK's
    // resolveAddItemPresentation confirm a plain add only when it has
    // recommendations, else slide open a quick cart TB does not have. The strip
    // stays the modal's business: no recommendations → title, Total, GOT IT.
    if (!options?.suppressAddedModal) openAddedModal(itemContent);

    return true;
  };

  /**
   * The product-added modal on `item` — addItemToCart's and the menu's +1 on
   * a row already in the bag (useAddEntityToCart).
   *
   * Did the add come from a "You Might Like" tap that detoured through a
   * chooser? Then the modal opens WITHOUT its own strip — otherwise the
   * customer can hop suggestion to suggestion forever. Read through the store
   * handle, not a selector: this hook is instantiated by dozens of components
   * and a subscription here re-renders every one of them. Consumed
   * immediately, so it can never affect a later, unrelated add.
   */
  const openAddedModal = (item: object) => {
    const cameFromRecommendation = !!(store.getState() as RecommendationLookupState)
      ?.menuSelections?.recommendationDetour;
    if (cameFromRecommendation) {
      dispatch(setRecommendationDetour(false));
    }

    dispatch(
      mutateAddToCartModal({
        isOpen: true,
        item: cameFromRecommendation ? { ...item, suppressRecommendations: true } : item,
      }),
    );
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
      const restored = await db.cartItems.toArray();
      // Lane offers 4a: the rows (IndexedDB) and cartOffer (redux-persist,
      // already rehydrated — PersistGate) are written separately, so a crash
      // between the two can restore freebie rows the applied offer does not
      // own, still discounted by their own stamps. Dropped here, before they
      // ever reach the screen — every fork removal path DELETES freebie rows
      // (removeAllGetItems), never re-prices them, and un-stamping would
      // charge for items nobody ordered. Silent: the screen already matches
      // the persisted reward, so there is nothing the customer saw to explain.
      // Lane offers-parity (D5): a get-CATEGORY freebie is the applied
      // offer's own when its id is one of the persisted group's entities and
      // it carries that group's stamp — else every reload deleted it.
      const orphans = findOrphanedFreebieRowsWithCategories(
        selectCartOffer(store.getState()),
        restored,
      );
      orphans.forEach((row) => deleteItemFromIndexedDbCart(row.itemId));
      const cartItems = restored.filter((row) => !orphans.includes(row));
      dispatch(setCartItems(cartItems));
      dispatch(syncSubTotalOnCart(cartItems)); // Sync with Redux store
    } catch (error) {
      // AppRoutes, the one caller, reports it (ErrorOccurred dexie/rehydrate).
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

  /**
   * Replace the whole cart in ONE dispatch + ONE IndexedDB transaction (the
   * PDP's split edit, planned by planSplitEditCommit). A split must never be
   * two dispatches: the second step's DP check would read a stale cart.
   * replaceIndexedDbCart catches its own errors (the redux cart stays the
   * source of truth for this session).
   */
  const replaceCartItems = (rows: unknown[]): void => {
    dispatch(setCartItems(rows));
    replaceIndexedDbCart(rows);
  };

  return {
    addItemToCart,
    openAddedModal,
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
    replaceCartItems,
  };
}

export default useCartHook;
