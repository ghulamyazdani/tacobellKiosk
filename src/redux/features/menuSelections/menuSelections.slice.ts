/* eslint-disable @typescript-eslint/no-explicit-any --
 * Verbatim copy of the posistKiosk UI slice (P1 shell port). The `any`s are
 * inherited; they get typed in the P6/P7 domain passes when the SDK menu/cart
 * types are wired through this slice. Do not add NEW anys to this file.
 */
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

/**
 * The in-bag order-type switch removed these rows (paid + loyalty). Rows are
 * stored as entities and named at render (useLocalized) — never strings.
 * Lives here so it survives the bag's empty-cart exit; never persisted
 * (menuSelections is neverPersist), cleared by useSessionReset.
 */
export interface OrderTypeSwitchNotice {
  removed: unknown[];
}

/** A chooser's finished cart row, parked as addItemToCart built it. */
export interface StagedCartRow {
  id: string;
  itemId: string;
  type: string;
  quantity: number;
  total_price?: number;
  [field: string]: unknown;
}

/**
 * The product-added modal's picks — nothing here has touched the bag; only
 * its ADD TO ORDER writes them (posistKiosk's staged selection). `pending`:
 * one-tap units by entity id (a zero is deleted). `pendingCustom`: rows a
 * suggestion's chooser (Select a Size / the PDP) finished, replayed whole.
 */
export interface UpsellStaging {
  pending: Record<string, number>;
  pendingCustom: StagedCartRow[];
}

const emptyStaging = (): UpsellStaging => ({ pending: {}, pendingCustom: [] });

const menuSelections = createSlice({
  name: "menuSelections",
  initialState: {
    customizations: {
      selectedEntity: {},
      selectedCustomizations: {},
    },
    addToCartModal: {
      isOpen: false,
      item: {},
    },
    upsellStaging: emptyStaging(),

    //isBottomSheetOpen
    bottomSheet: {
      isOpen: false,
      status: "",
      openType: "",
      editCustomizationContent: {},
    },
    taxAndChargesModalConfig: {
      isOpen: false,
      status: "",
    },

    outOfStockItems: {},

    /*
      A tap in the "You Might Like" strip has handed the customer off to a
      chooser (Select a Size / the PDP). While it is set the modal stays open
      but HIDDEN, and the add the chooser ends in is parked with its picks
      (useCartHook) — so it never opens another strip either. Every chooser
      exit clears it, which brings the modal back.
    */
    recommendationDetour: false,

    orderTypeSwitchNotice: null as OrderTypeSwitchNotice | null,
  },
  reducers: {
    setOrderTypeSwitchNotice: (
      state,
      action: PayloadAction<OrderTypeSwitchNotice>,
    ) => {
      state.orderTypeSwitchNotice = action.payload;
    },
    clearOrderTypeSwitchNotice: (state) => {
      state.orderTypeSwitchNotice = null;
    },
    // add variants to the state
    /** True while a strip tap is being handed off to the customization flow. */
    setRecommendationDetour: (state, action) => {
      state.recommendationDetour = !!action.payload;
    },
    setSelectedEntity: (state, action) => {
      state.customizations.selectedEntity = action.payload;
    },
    // add selected variants to the state
    setSelectedCustomizations: (state, action) => {
      state.customizations.selectedCustomizations = action.payload;
    },
    // change the bottom sheet
    setBottomSheet: (state, action) => {
      state.bottomSheet = action.payload;
    },

    closeBottomSheet: (state: any) => {
      state.bottomSheet = {
        isOpen: false,
        status: "",
        openType: "",
        editCustomizationContent: {},
      };
      // state.customizations.selectedEntity = {};
    },
    openTaxAndChargesModal: (state, action) => {
      state.taxAndChargesModalConfig = {
        isOpen: true,
        status: action.payload,
      };
    },
    closeTaxAndChargesModal: (state) => {
      state.taxAndChargesModalConfig = {
        isOpen: false,
        status: "",
      };
    },
    setOutOfStockItems: (state, action) => {
      state.outOfStockItems = action.payload;
    },

    /**
     * mutateAddToCartModal:
     * - Accepts either a boolean (true/false) OR an object { isOpen: boolean, item?: {...} }
     * - If boolean: toggles isOpen; when closing (false) it clears item.
     * - If object: sets isOpen and optional item.
     * Either way the picks go: a new add starts with none, and a close that
     * is not ADD TO ORDER throws them away.
     */
    mutateAddToCartModal: (state: any, action: any) => {
      const payload = action.payload;
      state.upsellStaging = emptyStaging();
      if (typeof payload === "boolean") {
        state.addToCartModal.isOpen = payload;
        if (!payload) {
          state.addToCartModal.item = {};
        }
      } else if (payload && typeof payload === "object") {
        // allow payload to be { isOpen: boolean, item?: {} }
        if (typeof payload.isOpen === "boolean") {
          state.addToCartModal.isOpen = payload.isOpen;
        }
        if (Object.prototype.hasOwnProperty.call(payload, "item")) {
          state.addToCartModal.item = payload.item ?? {};
        }
        // if closing explicitly, clear item
        if (payload.isOpen === false) {
          state.addToCartModal.item = {};
        }
      } else {
        // fallback: do nothing
      }
    },
    /** One one-tap unit picked (+1) or put back (−1). */
    stageUpsellItem: (state, action: PayloadAction<{ id: string; delta: number }>) => {
      const { id, delta } = action.payload;
      const units = (state.upsellStaging.pending[id] ?? 0) + delta;
      if (units > 0) state.upsellStaging.pending[id] = units;
      else delete state.upsellStaging.pending[id];
    },
    /**
     * A suggestion's chooser finished: park its row instead of buying it.
     * Bounded: one row per chooser round trip, and every modal open, close
     * and session reset (mutateAddToCartModal) empties the list.
     */
    stageConfiguredUpsellItem: (state, action: PayloadAction<StagedCartRow>) => {
      state.upsellStaging.pendingCustom = [...state.upsellStaging.pendingCustom, action.payload];
    },
    /** Drop one parked row (by its unique itemId). */
    unstageConfiguredUpsellItem: (state, action: PayloadAction<string>) => {
      state.upsellStaging.pendingCustom = state.upsellStaging.pendingCustom.filter(
        (row) => row.itemId !== action.payload,
      );
    },
  },
});

export const selectMenuSelections = (state: any) => state.menuSelections;
export const isBottomSheetOpen = (state: any) =>
  state.menuSelections.bottomSheet;
// Selector for customizations
export const selectCustomizations = (state: any) =>
  state.menuSelections.customizations;

// Selector for selectedEntity within customizations
export const selectSelectedEntity = (state: any) =>
  state.menuSelections.customizations.selectedEntity;

// Selector for selectedCustomizations within customizations
export const selectSelectedCustomizations = (state: any) =>
  state.menuSelections.customizations.selectedCustomizations;

// Selector for bottomSheet
export const selectBottomSheet = (state: any) =>
  state.menuSelections.bottomSheet;

// Selector for isBottomSheetOpen within bottomSheet
export const selectIsBottomSheetOpen = (state: any) =>
  state.menuSelections.bottomSheet.isOpen;

// Selector for bottomSheet status
export const selectBottomSheetStatus = (state: any) =>
  state.menuSelections.bottomSheet.status;

// Selector for bottomSheet openType
export const selectBottomSheetOpenType = (state: any) =>
  state.menuSelections.bottomSheet.openType;

// Selector for bottomSheet editCustomizationContent
export const selectEditCustomizationContent = (state: any) =>
  state.menuSelections.bottomSheet.editCustomizationContent;

// Selector for taxAndChargesModalConfig

// Selector for isOpen within taxAndChargesModalConfig
export const selectTaxAndChargesModalIsOpen = (state: any) =>
  state.menuSelections.taxAndChargesModalConfig.isOpen;

// Selector for status within taxAndChargesModalConfig
export const selectTaxAndChargesModalStatus = (state: any) =>
  state.menuSelections.taxAndChargesModalConfig.status;

export const selectTaxAndChargesModalConfig = (state: any) =>
  state.menuSelections.taxAndChargesModalConfig;

/**
 * NOTE: selectAddToCartModal now returns the boolean `isOpen`.
 * If you need the item object, use selectAddToCartItem below.
 */
export const selectAddToCartModal = (state: any) =>
  state.menuSelections.addToCartModal.isOpen;

export const selectAddToCartItem = (state: any) =>
  state.menuSelections.addToCartModal.item;

export const selectOutOfStockItems = (state: any) =>
  state.menuSelections.outOfStockItems;

/** True while a strip tap is mid-handoff to a chooser (the modal hidden). */
export const selectRecommendationDetour = (state: any) =>
  state.menuSelections.recommendationDetour;

export const selectUpsellStaging = (state: {
  menuSelections: { upsellStaging: UpsellStaging };
}): UpsellStaging => state.menuSelections.upsellStaging;

/** Null-safe on a store without the slice (tests mounting partial stores). */
export const selectOrderTypeSwitchNotice = (state: {
  menuSelections?: { orderTypeSwitchNotice?: OrderTypeSwitchNotice | null };
}): OrderTypeSwitchNotice | null =>
  state?.menuSelections?.orderTypeSwitchNotice ?? null;

export const {
  setOrderTypeSwitchNotice,
  clearOrderTypeSwitchNotice,
  stageUpsellItem,
  stageConfiguredUpsellItem,
  unstageConfiguredUpsellItem,
} = menuSelections.actions;

export const {
  setSelectedCustomizations,
  setSelectedEntity,
  setBottomSheet,
  openTaxAndChargesModal,
  closeTaxAndChargesModal,
  closeBottomSheet,
  mutateAddToCartModal,
  setOutOfStockItems,
  setRecommendationDetour,
}: any = menuSelections.actions;

export default menuSelections.reducer;
