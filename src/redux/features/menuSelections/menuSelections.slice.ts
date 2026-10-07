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
      A tap in the "You Might Like" strip has handed the customer off to the
      customization flow, and the add it produces must NOT be offered another
      strip.

      Without this the feature recurses: strip -> customizable item ->
      /customization -> addItemToCart(obj, "CUSTOMIZABLE") -> confirmation modal
      -> strip again -> another customizable item -> ... The `suppressAddedModal`
      option cannot cover it, because the add happens later from
      useCustomization.ts:1851, which passes no options and cannot know where the
      customer came from.

      Set at the moment of the detour, CONSUMED by the next modal open.
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
     */
    mutateAddToCartModal: (state: any, action: any) => {
      const payload = action.payload;
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

/** True while a strip tap is mid-handoff to the customization flow. */
export const selectRecommendationDetour = (state: any) =>
  state.menuSelections.recommendationDetour;

/** Null-safe on a store without the slice (tests mounting partial stores). */
export const selectOrderTypeSwitchNotice = (state: {
  menuSelections?: { orderTypeSwitchNotice?: OrderTypeSwitchNotice | null };
}): OrderTypeSwitchNotice | null =>
  state?.menuSelections?.orderTypeSwitchNotice ?? null;

export const { setOrderTypeSwitchNotice, clearOrderTypeSwitchNotice } =
  menuSelections.actions;

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
