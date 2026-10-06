import type { Table } from "dexie";
import Dexie from "dexie";
import type { CartItems } from "./CartItems";
import { MenuData } from "@cx-sdk/core/types/menuTypes";
import type { TenantRecommendationMap } from "@cx-sdk/catalog/recommendation/tenantRecommendations";

export interface MenuStorage {
  tabId: string;
  menuId: string;
  menu: MenuData;
}

export interface RecommendationCacheRecord {
  key: string;
  /** Re-validated on load (toTenantRecommendationMap) — never trusted as is. */
  map: TenantRecommendationMap;
  /** The URL it came from: loadCached ignores a copy of any other URL (D6). */
  url: string;
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
