/* eslint-disable @typescript-eslint/no-explicit-any --
 * Verbatim copy of posistKiosk's theme adapter (P3 port). Inherited anys get
 * typed when the theme API response is modeled. Do not add NEW anys.
 */
import { useState } from "react";
import { useGetThemeDataMutation } from "@cx-sdk/catalog/services/kioskInfoApi";
import { selectDeploymentDetails } from "@cx-sdk/core/auth/authentication.slice";
import { useSelector } from "react-redux";
import {
  setGridWiseSetting,
  setTheme,
} from "@cx-sdk/catalog/state/theme.slice";
import { useDispatch } from "react-redux";
import {
  setChangeContrast,
} from "@cx-sdk/catalog/state/appSettings.slice";

const useFetchColors = () => {
  // to be checked
  const [colors] = useState(null);
  const dispatch = useDispatch();
  const [getThemeData] =
    useGetThemeDataMutation();
  const [loading] = useState(!colors);
  const selectDeploymentDetailsRdx = useSelector(selectDeploymentDetails);

  const syncThemeOnReload = async (themeData: any) => {
    if (themeData) {
      setThemeColors(themeData);
    }
  };

  const fetchColorsList = () => {
    // if (!colors) {
    const response = {
      Subway: [
        { hex_color: "#008c15", key: 1 },
        { hex_color: "#119324", key: 2 },
        { hex_color: "#229b34", key: 3 },
        { hex_color: "#33a343", key: 4 },
        { hex_color: "#44aa53", key: 5 },
        { hex_color: "#55b263", key: 6 },
        { hex_color: "#66ba72", key: 7 },
        { hex_color: "#77c182", key: 8 },
        { hex_color: "#88c991", key: 9 },
        { hex_color: "#99d1a1", key: 10 },
        { hex_color: "#aad8b1", key: 11 },
        { hex_color: "#bbe0c0", key: 12 },
        { hex_color: "#cce8d0", key: 13 },
        { hex_color: "#ddefdf", key: 14 },
        { hex_color: "#eef7ef", key: 15 },
        { hex_color: "#ffffff", key: 16 },
      ],
      //   Slate: [
      //     { key: 50, value: "#f8fafc" },
      //     { key: 100, value: "#f1f5f9" },
      //     { key: 200, value: "#e2e8f0" },
      //     { key: 300, value: "#cbd5e1" },
      //     { key: 400, value: "#94a3b8" },
      //     { key: 500, value: "#64748b" },
      //     { key: 600, value: "#475569" },
      //     { key: 700, value: "#334155" },
      //     { key: 800, value: "#1e293b" },
      //     { key: 900, value: "#0f172a" },
      //     { key: 950, value: "#0f172a" },
      //   ],
      //   Gray: [
      //     { key: 50, value: "#f9fafb" },
      //     { key: 100, value: "#f3f4f6" },
      //     { key: 200, value: "#e5e7eb" },
      //     { key: 300, value: "#d1d5db" },
      //     { key: 400, value: "#9ca3af" },
      //     { key: 500, value: "#6b7280" },
      //     { key: 600, value: "#4b5563" },
      //     { key: 700, value: "#374151" },
      //     { key: 800, value: "#1f2937" },
      //     { key: 900, value: "#111827" },
      //     { key: 950, value: "#030712" },
      //   ],
      //   Zinc: [
      //     { key: 50, value: "#f9fafb" },
      //     { key: 100, value: "#f3f4f6" },
      //     { key: 200, value: "#e5e7eb" },
      //     { key: 300, value: "#d1d5db" },
      //     { key: 400, value: "#9ca3af" },
      //     { key: 500, value: "#6b7280" },
      //     { key: 600, value: "#4b5563" },
      //     { key: 700, value: "#374151" },
      //     { key: 800, value: "#1f2937" },
      //     { key: 900, value: "#111827" },
      //     { key: 950, value: "#030712" },
      //   ],
      TacoBell: [
        { key: 50, hex_color: "#702082" },
        { key: 100, hex_color: "#792e8a" },
        { key: 200, hex_color: "#833d92" },
        { key: 300, hex_color: "#8c4c9b" },
        { key: 400, hex_color: "#965ba3" },
        { key: 500, hex_color: "#9f6aab" },
        { key: 600, hex_color: "#a979b4" },
        { key: 700, hex_color: "#b288bc" },
        { key: 800, hex_color: "#bc96c4" },
        { key: 900, hex_color: "#c5a5cd" },
        { key: 950, hex_color: "#cfb4d5" },
        { key: 1000, hex_color: "#d8c3dd" },
        { key: 1100, hex_color: "#e2d2e6" },
        { key: 1200, hex_color: "#ebe1ee" },
        { key: 1300, hex_color: "#f5f0f6" },
        { key: 1300, hex_color: "#ffffff" },
      ],
    };
    //   const data = await response.json();
    const data = response;

    return data;
  };

  const FetchThemeData = async () => {
    const themeData = await getThemeData({
      brand_id: selectDeploymentDetailsRdx?.brand_id,
      tenant_id: selectDeploymentDetailsRdx?.tenant_id,
      channel: "Kiosk",
    }).unwrap();

    dispatch(setTheme(themeData));
    const UIData = themeData?.ui_settings?.find(
      (setting: any) => setting.key === "show_grid_view",
    );
    dispatch(setGridWiseSetting(UIData ? UIData.value : false));

    setThemeColors(themeData);
  };

  const isWhite = (color: string) => {
    const whiteValues = [
      "white",
      "#fff",
      "#ffffff",
      "rgb(255,255,255)",
      "rgba(255,255,255,1)",
    ];
    return whiteValues.includes(color.toLowerCase().replace(/\s+/g, ""));
  };

  const setThemeColors = (themeData: any) => {
    const convertedThemeColor: any = {};

    themeData?.theme_color?.forEach((color: any) => {
      convertedThemeColor[color.key] = color.color_hex;
    });

    document.documentElement.style.setProperty(
      `--brand-primary`,
      convertedThemeColor["button_text_border_icon"],
    );

    if (isWhite(convertedThemeColor["button_text_border_icon"])) {
      dispatch(setChangeContrast(true));
    }
    document.documentElement.style.setProperty(
      `--brand-secondary`,
      convertedThemeColor["button_background"],
    );
    selectColor(themeData?.primary_color_shades);
  };

  const selectColor = (colors: any) => {
    // if (colors) {
    colors?.forEach((color: any, index: number) => {
      document.documentElement.style.setProperty(
        `--brand-${index + 1}`,
        color.hex_color,
      );
    });
    // document.documentElement.style.getPropertyValue("--brand-1");

    // }
  };

  return {
    fetchColorsList,
    colors,
    loading,
    selectColor,
    FetchThemeData,
    syncThemeOnReload,
  };
};

export default useFetchColors;
