/* eslint-disable @typescript-eslint/no-explicit-any --
 * Verbatim copy of the posistKiosk UI slice (P1 shell port). The `any`s are
 * inherited; they get typed in the P6/P7 domain passes when the SDK menu/cart
 * types are wired through this slice. Do not add NEW anys to this file.
 */
import { createSlice } from "@reduxjs/toolkit";

const multiLanguageSlice = createSlice({
  name: "multiLanguage",
  initialState: {
    primary_language: {},
    secondary_language: {},
    selectedLanguage: {
      name: "",
      code: "",
    },
  },
  reducers: {
    setLanguages: (state, action) => {
      state.primary_language = action.payload.primary_language;

      state.secondary_language = action.payload.secondary_language;
    },
    setSelectedLanguage: (state, action) => {
      state.selectedLanguage = action.payload;
    },
    emptySelectedLanguage: (state) => {
      state.selectedLanguage = {
        name: "",
        code: "",
      };
    },
  },
});

export const { setLanguages, setSelectedLanguage, emptySelectedLanguage } =
  multiLanguageSlice.actions;

export const selectPrimaryLanguage = (state: any) =>
  state.multiLanguage.primary_language;

export const selectSecondaryLanguage = (state: any) =>
  state.multiLanguage.secondary_language;

export const selectSelectedLanguage = (state: any) =>
  state.multiLanguage.selectedLanguage;

export default multiLanguageSlice.reducer;
