/* eslint-disable @typescript-eslint/no-explicit-any --
 * Verbatim copy of the posistKiosk UI slice (P1 shell port). The `any`s are
 * inherited; they get typed in the P6/P7 domain passes when the SDK menu/cart
 * types are wired through this slice. Do not add NEW anys to this file.
 */
import { createSlice } from "@reduxjs/toolkit";

const appImage = createSlice({
  name: "appImage",
  initialState: {
    appImages: {},
  },
  reducers: {
    setImages: (state, action) => {
      //check if app image exists in local storage
      state.appImages = action.payload;
    },
  },
});

export const { setImages } = appImage.actions;

export const selectAppImages = (state: any) => state.appImage.appImages;

export default appImage.reducer;
