/* eslint-disable @typescript-eslint/no-explicit-any --
 * Verbatim copy of the posistKiosk useDynamicPricing wrapper (P5 port). The anys are
 * inherited; typed in the P6/P7 domain passes. Do not add NEW anys.
 */
import moment from "dayjs";
import type { UnknownAction } from "@reduxjs/toolkit";
import { useDispatch, useSelector } from "react-redux";
import {
  selectValidDpSessions,
  setDpItemsMap,
  setValidDpSessions,
  setCurrentSession,
} from "@cx-sdk/catalog/state/dynamicPricing.slice";
import {
  useGetDpSessionsMutation,
  useGetDpItemsMutation,
} from "@cx-sdk/catalog/services/dynamicPricingApi";
import { useLazyGetServerTimeQuery } from "@cx-sdk/catalog/services/settingsApi";
import {
  buildDpItemsMap,
  filterValidDpSessions,
  pickActiveDpSession,
} from "@cx-sdk/catalog/dynamicPricing/dynamicPricingEngine";

function useDynamicPricing() {
  const dispatch = useDispatch();
  const [getDpSessionsApi] = useGetDpSessionsMutation();
  const [getDpItemsApi] = useGetDpItemsMutation();
  const [getServerTimeApi] = useLazyGetServerTimeQuery();

  useSelector(selectValidDpSessions);

  /**
   * `apply` defaults to dispatch; the in-bag order-type switch passes its
   * stage so nothing lands before its one commit (fetchMenu opts).
   */
  const fetchDpSessions = async (
    apply: (action: UnknownAction) => unknown = dispatch,
  ) => {
    try {
      const response: any = await getDpSessionsApi({
        app: "kiosk",
        enable_deployment_dynamic_pricing: false,
      });

      let validSessions = {};

      if (response?.data) {
        validSessions = await filterDpSessions(response?.data, apply);
      }

      return validSessions;
    } catch (error) {
      console.error("Error fetching dynamic pricing sessions:", error);
    }
  };
  const fetchDpItems = async (
    pipeLineId: any,
    validDpSession: any,
    apply: (action: UnknownAction) => unknown = dispatch,
  ) => {
    try {
      const session = pickActiveDpSession(validDpSession);
      apply(setCurrentSession(session));
      if (!session) {
        apply(setDpItemsMap({}));
        // window.localStorage.setItem("dpItemsMap", JSON.stringify({}));
        return {};
      }
      const response: any = await getDpItemsApi({
        session_id: session?._id,
        app: "kiosk",
        pipeline_id: pipeLineId,
      });
      // if(lastSessionIdRdx !== session?._id){
      //   dispatch(openDpSessionInfoModal(session));
      // }

      return convertDpItemsMap(response?.data, apply);
    } catch (error) {
      console.error("Error fetching dynamic pricing items:", error);
    }
  };
  const convertDpItemsMap = (
    sessionItems: any,
    apply: (action: UnknownAction) => unknown = dispatch,
  ) => {
    const dpEntityMap = buildDpItemsMap(sessionItems);

    apply(setDpItemsMap(dpEntityMap));
    // window.localStorage.setItem("dpItemsMap", JSON.stringify(dpEntityMap));
    return dpEntityMap;
  };
  const filterDpSessions = async (
    dpSessions: any,
    apply: (action: UnknownAction) => unknown = dispatch,
  ) => {
    let dayIndex = moment().day();

    let currentDate = moment();

    const serverTimeData = await getServerTimeApi({}).unwrap();

    if (serverTimeData && serverTimeData?.serverTime) {
      const currentDateWithTime = new Date(serverTimeData?.serverTime);
      currentDate = moment(currentDateWithTime);
      dayIndex = currentDate.day();
    }

    const filteredSessions = filterValidDpSessions(
      dpSessions,
      currentDate,
      dayIndex,
    );

    apply(setValidDpSessions(filteredSessions));
    return filteredSessions;
  };
  return { convertDpItemsMap, fetchDpSessions, fetchDpItems };
}

export default useDynamicPricing;
