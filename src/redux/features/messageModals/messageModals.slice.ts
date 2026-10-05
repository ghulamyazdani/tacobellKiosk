/* eslint-disable @typescript-eslint/no-explicit-any --
 * Verbatim copy of the posistKiosk UI slice (P1 shell port). The `any`s are
 * inherited; they get typed in the P6/P7 domain passes when the SDK menu/cart
 * types are wired through this slice. Do not add NEW anys to this file.
 */
import { createSlice } from "@reduxjs/toolkit";

const messageModals = createSlice({
  name: "messageModals",
  initialState: {
    messageModals: {
      isOpen: false,
      heading: "",
      subHeading: "",
      lottieAnimation: null,
      enableConfetti: false,
    },
  },
  reducers: {
    openMessageModal: (state, action) => {
      state.messageModals = action.payload;
    },
    closeMessageModal: (state: any) => {
      state.messageModals = {
        isOpen: false,
        heading: "",
        subHeading: "",
        lottieAnimation: null,
      };
    },
  },
});

export const { openMessageModal, closeMessageModal } = messageModals.actions;
export const selectMessageModals = (state: any) =>
  state.messageModals.messageModals;

export default messageModals.reducer;
