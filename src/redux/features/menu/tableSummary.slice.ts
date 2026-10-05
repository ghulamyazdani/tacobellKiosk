/* eslint-disable @typescript-eslint/no-explicit-any --
 * Verbatim copy of the posistKiosk UI slice (P1 shell port). The `any`s are
 * inherited; they get typed in the P6/P7 domain passes when the SDK menu/cart
 * types are wired through this slice. Do not add NEW anys to this file.
 */
import { createSlice } from "@reduxjs/toolkit";

const tableSummarySlice = createSlice({
  name: "tableSummary",
  initialState: {
    type: "",
    url: "",
    billNo: "",
    appliedOffer: {},
    netAmount: 0,
  },
  reducers: {
    setAppliedOffer: (state, action) => {
      const { offer } = action.payload;
      state.appliedOffer = offer;
    },
    removeOffer: (state) => {
      state.appliedOffer = {};
    },
    setNetAmountTableSummary: (state, action) => {
      const { netAmount } = action.payload;
      state.netAmount = netAmount;
    },
  },
});

export const { setAppliedOffer, removeOffer, setNetAmountTableSummary }: any =
  tableSummarySlice.actions;

export const selectAppliedOffer = (state: any) =>
  state.tableSummary.appliedOffer;

export const selectNetAmountTableSummary = (state: any) =>
  state.tableSummary.netAmount;
export default tableSummarySlice.reducer;
