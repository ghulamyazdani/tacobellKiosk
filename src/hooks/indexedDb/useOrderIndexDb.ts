/* eslint-disable @typescript-eslint/no-explicit-any --
 * Verbatim copy of the posistKiosk useOrderIndexDb hook (customization vertical
 * port, transitive dep of useLoyalty -> useOrderHook). The anys are inherited;
 * typed in later domain passes. Do not add NEW anys.
 */
import { useDispatch } from "react-redux";
/**
 * Hollow upstream: every db call is commented out in the fork, so each
 * function is a no-op kept for its callers (useOrderHook, useSessionReset).
 * Their unreachable try/catch logging went with audit-fixes C5.
 */
function useOrderIndexDb() {
  // Verbatim parity: the original bound `dispatch` (unused — every db call
  // below is commented out upstream). The bare call keeps hook order identical.
  useDispatch();
  const addOrderToIndexedDb = (_order: any) => {
    // db.orders.add(order);
  };

  //   update order status in indexedDb
  const updateOrderStatusIndexedDb = async (_orderId: any, _status: any) => {
    // await db.orders.update(orderId, { orderStatus: status });
  };

  //   delete order with order id
  const deleteOrderIndexedDb = async (_orderId: any) => {
    // await db.orders.where("orderId").equals(orderId).delete();
  };

  const getOrdersFromIndexedDb = async () => {
    // const orders = await db.orders.toArray();
    // return orders;
  };

  const syncOrderFromIndexedDbToRedux = async () => {
    // const orders = await db.orders.toArray();
    // dispatch(syncOngoingOrdersRdx(orders));
  };

  const deleteAllOrdersFromIndexedDb = async () => {
    // await db.orders.clear();
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
