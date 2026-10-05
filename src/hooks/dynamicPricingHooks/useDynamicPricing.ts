/* eslint-disable @typescript-eslint/no-explicit-any --
 * Verbatim copy of the posistKiosk useDynamicPricing wrapper (P5 port). The anys are
 * inherited; typed in the P6/P7 domain passes. Do not add NEW anys.
 */
import moment from "dayjs";
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

  const fetchDpSessions = async () => {
    try {
      const response: any = await getDpSessionsApi({
        app: "kiosk",
        enable_deployment_dynamic_pricing: false,
      });

      let validSessions = {};

      if (response?.data) {
        validSessions = await filterDpSessions(response?.data);
      }

      // console.log("response fetchDpSessions", response);
      return validSessions;
    } catch (error) {
      console.error("Error fetching dynamic pricing sessions:", error);
    }
  };
  const fetchDpItems = async (pipeLineId: any, validDpSession: any) => {
    try {
      const session = pickActiveDpSession(validDpSession);
      dispatch(setCurrentSession(session));
      if (!session) {
        dispatch(setDpItemsMap({}));
        // window.localStorage.setItem("dpItemsMap", JSON.stringify({}));
        return {};
      }
      const response: any = await getDpItemsApi({
        session_id: session?._id,
        app: "kiosk",
        pipeline_id: pipeLineId,
      });
      // console.log("response fetchDpItems", response);
      // // console.log("filteredSessions id", session?._id, lastSessionIdRdx);
      // if(lastSessionIdRdx !== session?._id){
      //   dispatch(openDpSessionInfoModal(session));
      // }

      return convertDpItemsMap(response?.data);
    } catch (error) {
      console.error("Error fetching dynamic pricing items:", error);
    }
  };
  const convertDpItemsMap = (sessionItems: any) => {
    const dpEntityMap = buildDpItemsMap(sessionItems);

    // console.log("dpEntityMap", dpEntityMap, sessionItems);

    dispatch(setDpItemsMap(dpEntityMap));
    // window.localStorage.setItem("dpItemsMap", JSON.stringify(dpEntityMap));
    return dpEntityMap;
  };
  const filterDpSessions = async (dpSessions: any) => {
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

    // console.log("filteredSessions", filteredSessions, dpSessions);

    dispatch(setValidDpSessions(filteredSessions));
    return filteredSessions;
  };
  return { convertDpItemsMap, fetchDpSessions, fetchDpItems };
}

export default useDynamicPricing;
