/* eslint-disable @typescript-eslint/no-explicit-any --
 * Verbatim copy of the posistKiosk useOrderIndexDb hook (customization vertical
 * port, transitive dep of useLoyalty -> useOrderHook). The anys are inherited;
 * typed in later domain passes. Do not add NEW anys.
 */
import { useDispatch } from "react-redux";
function useOrderIndexDb() {
  // Verbatim parity: the original bound `dispatch` (unused — every db call
  // below is commented out upstream). The bare call keeps hook order identical.
  useDispatch();
  const addOrderToIndexedDb = (_order: any) => {
    try {
      // db.orders.add(order);
    } catch (error) {
      console.error("Error adding order to indexedDB:", error);
    }
  };

  //   update order status in indexedDb
  const updateOrderStatusIndexedDb = async (_orderId: any, _status: any) => {
    try {
      // await db.orders.update(orderId, { orderStatus: status });
    } catch (error) {
      console.error("Error updating order status in indexedDB:", error);
    }
  };

  //   delete order with order id
  const deleteOrderIndexedDb = async (_orderId: any) => {
    try {
      // await db.orders.where("orderId").equals(orderId).delete();
    } catch (error) {
      console.error("Error deleting order from indexedDB:", error);
    }
  };

  const getOrdersFromIndexedDb = async () => {
    try {
      // const orders = await db.orders.toArray();
      // return orders;
    } catch (error) {
      console.error("Error getting orders from indexedDB:", error);
    }
  };

  const syncOrderFromIndexedDbToRedux = async () => {
    try {
      // const orders = await db.orders.toArray();
      // dispatch(syncOngoingOrdersRdx(orders));
      //   orders.forEach((order) => {
      //     // dispatch(pushOrderInOngoingOrders(order));
      //   });
    } catch (error) {
      console.error("Error getting orders from indexedDB:", error);
    }
  };

  const deleteAllOrdersFromIndexedDb = async () => {
    try {
      // await db.orders.clear();
    } catch (error) {
      console.error("Error deleting all orders from indexedDB:", error);
    }
  };

  return {
    addOrderToIndexedDb,
    updateOrderStatusIndexedDb,
    deleteOrderIndexedDb,
    getOrdersFromIndexedDb,
    syncOrderFromIndexedDbToRedux,
    deleteAllOrdersFromIndexedDb,
  };
}

export default useOrderIndexDb;
