import type { Table } from "dexie";
import Dexie from "dexie";
import type { CartItems } from "./CartItems";
import { MenuData } from "@cx-sdk/core/types/menuTypes";

export interface MenuStorage {
  tabId: string;
  menuId: string;
  menu: MenuData;
}

export interface RecommendationCacheRecord {
  key: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- cache blob typed at the P7 recommendation pass
  map: Record<string, any>;
  fetchedAt: number;
}

export class QrAppDB extends Dexie {
  cartItems!: Table<CartItems, number>;
  menus!: Table<MenuStorage, string>;
  recommendations!: Table<RecommendationCacheRecord, string>;

  constructor() {
    super("KioskDB");
    this.version(1).stores({
      cartItems: "++itemId, id, name, subCategoryId",
    });
    this.version(2).stores({
      cartItems: "++itemId, id, name, subCategoryId",
      menus: "tabId",
    });
    this.version(3).stores({
      cartItems: "++itemId, id, name, subCategoryId",
      menus: "tabId",
      recommendations: "key",
    });
  }
}

export const db = new QrAppDB();

// db.on("populate", populate);

export function resetDatabase() {
  return db.transaction(
    "rw",
    db.cartItems,
    db.menus,
    db.recommendations,
    async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    },
  );
}
