/* eslint-disable @typescript-eslint/no-explicit-any --
 * Verbatim copy of the posistKiosk useCartIndexedDb wrapper (P5 port). The anys are
 * inherited; typed in the P6/P7 domain passes. Do not add NEW anys.
 */
// Thin wrapper over Dexie for the IndexedDB cart mirror. The pure row
// decisions (which row a +1/-1 targets, remove-vs-update on decrement, the
// availability merge, which rows count toward cart length) live in
// "@cx-sdk/ordering/cart/cartRowMerge"; every Dexie read/write stays here.
import {
  countCartRows,
  decideQuantityDecrease,
  findIncrementableRow,
  incrementRowQuantity,
  isDecrementableIdRow,
  mergeAvailabilityIntoRow,
} from "@cx-sdk/ordering/cart/cartRowMerge";
import { db } from "../../models/db";
import { removeBlackListed } from "@cx-sdk/ordering/state/makeItAMeal.slice";

// Every write here is the best-effort Dexie MIRROR of the redux cart: a failed
// one is swallowed (the redux cart stays the truth); a lost mirror is reported
// where it bites — AppRoutes' rehydrate after a reload (audit-fixes C5).
function useCartIndexedDb() {
  const addToIndexedDbCart = async (item: any) => {
    try {
      await db.cartItems.add(item);
    } catch {
      // best effort (see above)
    }
  };

  //update indexed db cart
  const updateItemIndexedDbCart = async (item: any, itemId: any) => {
    try {
      await db.cartItems.update(itemId, item);
      // alert("Item updated in cart");
    } catch {
      // best effort (see above)
    }
  };

  const increaseItemQuantityByIdIndexedDb = async (itemId: any, IDKEY: any) => {
    try {
      // Get the item from the database using itemId
      // const item = await db.cartItems.where(IDKEY).equals(itemId).first();
      const items = await db.cartItems.where(IDKEY).equals(itemId).toArray();

      if (items) {
        // Which matched row the +1 applies to (skips offer freebies) → SDK
        const item = findIncrementableRow(items);

        if (item) {
          // Increment the quantity field, then update the item in the database
          await db.cartItems.put(incrementRowQuantity(item));
        }
      }
    } catch {
      // best effort (see above)
    }
  };

  const decreaseItemQuantityByIdIndexedDb = async (
    itemId: any,
    IDKEY: any,
    dispatcher: any,
  ) => {
    try {
      if (IDKEY === "id") {
        const items: any = db.cartItems.where(IDKEY).equals(itemId);
        // filter the isLoyaltyItem from item
        const item = await items
          .filter((item: any) => isDecrementableIdRow(item))
          .first();
        if (item) {
          // Decrement the quantity field and decide remove-vs-update → SDK
          const decision = decideQuantityDecrease(item);
          if (decision.action === "remove") {
            // If quantity is <= 0, remove the item from the database
            dispatcher(removeBlackListed({ id: item?.id } as any));
            await db.cartItems.where("itemId").equals(item.itemId).delete();

            await db.cartItems.where("itemId").equals(item.itemId);
          } else {
            // Update the item in the database
            await db.cartItems.put(item);
          }
        }
      } else {
        // Get the item from the database using itemId
        const item = await db.cartItems.where(IDKEY).equals(itemId).first();

        if (item) {
          // Decrement the quantity field and decide remove-vs-update → SDK
          const decision = decideQuantityDecrease(item);
          if (decision.action === "remove") {
            // If quantity is <= 0, remove the item from the database
            dispatcher(removeBlackListed({ id: item?.id } as any));
            await db.cartItems.where(IDKEY).equals(itemId).delete();
          } else {
            // Update the item in the database
            await db.cartItems.put(item);
          }
        }
      }
    } catch {
      // best effort (see above)
    }
  };

  const removeItemFromIndexedDbCart = async (itemId: any, IDKEY: any) => {
    try {
      // Get the item from the database using itemId
      const item = await db.cartItems.where(IDKEY).equals(itemId).first();

      if (item) {
        // Remove the item from the database
        await db.cartItems.where(IDKEY).equals(itemId).delete();
      }
    } catch {
      // best effort (see above)
    }
  };

  const deleteItemFromIndexedDbCart = async (itemId: any) => {
    try {
      // Delete the item from the database using itemId
      await db.cartItems.where("itemId").equals(itemId).delete();
    } catch {
      // best effort (see above)
    }
  };

  const updateCartItemsAvailability = async (cartItems: any) => {
    cartItems.forEach(async (item: any) => {
      const existingItem = await db.cartItems
        .where("itemId")
        .equals(item?.itemId)
        .first();
      if (existingItem) {
        // Overlay only the availability/scheduling fields → SDK
        const updatedItem = mergeAvailabilityIntoRow(existingItem, item);

        await db.cartItems.put(updatedItem);
      }
    });
  };

  const updateCartItemsInIndexDB = async (cartItems: any) => {
    cartItems.forEach(async (item: any) => {
      const existingItem = await db.cartItems
        .where("itemId")
        .equals(item?.itemId)
        .first();
      if (existingItem) {
        const updatedItem = {
          // ...existingItem,
          ...item,
        };

        await db.cartItems.put(updatedItem);
      }
    });
  };

  /**
   * Replace the whole idb cart with `items` in ONE readwrite transaction.
   * Used by the buy-stage rollback: per-row diffing would race any still
   * in-flight increase/decrease pipelines (they are multi-await
   * read-modify-write with no queue), whereas a Dexie rw transaction queues
   * behind them and commits the authoritative final state atomically.
   */
  const replaceIndexedDbCart = async (items: any[]) => {
    try {
      await db.transaction("rw", db.cartItems, async () => {
        await db.cartItems.clear();
        if (items?.length > 0) {
          await db.cartItems.bulkAdd(items);
        }
      });
    } catch {
      // best effort (see above)
    }
  };

  const clearIndexedDbCart = async () => {
    try {
      // Clear the cartItems table
      await db.cartItems.clear();
    } catch {
      // best effort (see above)
    }
  };

  const getCartLength = async () => {
    try {
      const items = await db.cartItems.toArray();
      return countCartRows(items);
    } catch {
      // undefined: the length is unknown
    }
  };

  return {
    addToIndexedDbCart,
    increaseItemQuantityByIdIndexedDb,
    decreaseItemQuantityByIdIndexedDb,
    deleteItemFromIndexedDbCart,
    clearIndexedDbCart,
    replaceIndexedDbCart,
    updateItemIndexedDbCart,
    getCartLength,
    removeItemFromIndexedDbCart,
    updateCartItemsAvailability,
    updateCartItemsInIndexDB,
  };
}

export default useCartIndexedDb;
