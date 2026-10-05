export interface CartItems {
  itemId: number;
  id: string;
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- row-shape parity with SDK cart rows until the P7 Dexie typing pass
  subCategoryId: any;
  // Every cart row carries a unit count; the idb increase/decrease pipelines
  // mutate it directly (useCartIndexedDb).
  quantity: number;
}
