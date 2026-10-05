/* eslint-disable @typescript-eslint/no-explicit-any --
 * Verbatim copy of the posistKiosk UI slice (P1 shell port). The `any`s are
 * inherited; they get typed in the P6/P7 domain passes when the SDK menu/cart
 * types are wired through this slice. Do not add NEW anys to this file.
 */
import { createSlice } from "@reduxjs/toolkit";

const errorInfo = createSlice({
  name: "errorInfo",
  initialState: {
    configurationError: {
      isOpen: false,
      message: "",
    },
  },
  reducers: {
    openConfigurationError: (state, action) => {
      state.configurationError = {
        isOpen: true,
        message: action.payload,
      };
    },
    closeConfigurationError: (state) => {
      state.configurationError = {
        isOpen: false,
        message: "",
      };
    },
  },
});

export const { openConfigurationError, closeConfigurationError } =
  errorInfo.actions;

export const selectConfigurationError = (state: any) =>
  state.errorInfo.configurationError;

export default errorInfo.reducer;
