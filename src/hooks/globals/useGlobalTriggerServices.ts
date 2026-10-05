/* eslint-disable @typescript-eslint/no-explicit-any --
 * Verbatim copy of the posistKiosk useGlobalTriggerServices wrapper (customization
 * vertical port). The anys are inherited; typed in later domain passes. Do not
 * add NEW anys.
 */
import { useDispatch } from "react-redux";
import { setShowErrorModalGlobal } from "@cx-sdk/catalog/state/appSettings.slice";

const useGlobalTriggerServices = () => {
  const dispatch = useDispatch();
  const triggerNotification = (message: any, _background?: any) => {
    dispatch(
      setShowErrorModalGlobal({
        showErrorModal: true,
        errorMessage: message,
      }),
    );
  };
  return {
    triggerNotification,
  };
};

export default useGlobalTriggerServices;
