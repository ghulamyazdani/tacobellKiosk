import { useUpdateCxFcmKeyMutation } from "@cx-sdk/devices/updates/services/autoUpdateApi";
import { useSelector } from "react-redux";
import { useUpdateDeviceStatusMutation } from "@cx-sdk/devices/updates/services/autoUpdateApi";
import { selectDeviceUpdateId } from "@cx-sdk/devices/updates/autoUpdate.slice";
import { markAsUpdateDone } from "@cx-sdk/devices/updates/autoUpdate.slice";
import { useDispatch } from "react-redux";
import { useUpdateCxSoftwareDeviceMutation } from "@cx-sdk/devices/updates/services/autoUpdateApi";
import { selectKioskDeviceVersion } from "@cx-sdk/devices/updates/autoUpdate.slice";
// import { requestPermissionForFCMAndGetToken } from "../../firebase";
import { setShouldDeviceUpdate } from "@cx-sdk/devices/updates/autoUpdate.slice";
import { shouldDeviceUpdate } from "@cx-sdk/devices/updates/autoUpdate.slice";
import { setKioskDeviceVersion } from "@cx-sdk/devices/updates/autoUpdate.slice";
import { initiateWholeAppUpdate } from "@cx-sdk/devices/updates/autoUpdate.slice";
import {
  shouldApplyPendingUpdate,
  shouldUpdateDeviceVersion,
} from "@cx-sdk/devices/updates/updatePolicy";
function useAutoUpdate() {
  const kioskDeviceVersion = useSelector(selectKioskDeviceVersion);
  const shouldDeviceUpdateRdx = useSelector(shouldDeviceUpdate);
  const currentVersion = process.env.PACKAGE_VERSION;

  const deviceUpdateId = useSelector(selectDeviceUpdateId);
  const dispatch = useDispatch();
  const [updateCxFcmKey, { isLoading: updateCxFcmKeyLoading }] =
    useUpdateCxFcmKeyMutation();
  const [updateDeviceStatus] = useUpdateDeviceStatusMutation();

  const [updateCxSoftwareDevice] = useUpdateCxSoftwareDeviceMutation();
  const registerFCMTokenToServer = async (fcmToken: string) => {
    try {
      if (!fcmToken) {
        console.error("FCM token not found really");
      }
      await updateCxFcmKey({
        app: "kiosk",
        fcm_token: fcmToken,
      });
    } catch (error) {
      console.error("Error registering FCM token to server:", error);
    }
  };

  const updateDeviceUpdateStatus = async () => {
    try {
      const updateData = await updateDeviceStatus({
        app: "kiosk",
        device_update_id: deviceUpdateId,
      });
      dispatch(markAsUpdateDone());
      return updateData;
    } catch (error) {
      console.error("Error updating device status to server:", error);
    }
  };

  const checkDeviceVersionToUpdate = () => {
    // alert(`New version available ${currentVersion} - ${kioskDeviceVersion}`);
    return shouldUpdateDeviceVersion(currentVersion, kioskDeviceVersion);
  };

  const checkAndUpdateDeviceVersionDeviceWise = async () => {
    if (checkDeviceVersionToUpdate()) {
      try {
        await updateCxSoftwareDevicedDeviceWise(currentVersion);
        dispatch(setKioskDeviceVersion(currentVersion));
      } catch (error) {
        console.error("Error updating device version to server:", error);
      }
    }
  };

  const updateCxSoftwareDevicedDeviceWise = async (
    currentVersion: string | undefined,
  ) => {
    try {
      const updateData = await updateCxSoftwareDevice({
        app: "kiosk",
        version: currentVersion,
      });

      return updateData;
    } catch (error) {
      throw new Error("Error updating device version to server", {
        cause: error,
      });
    }
  };

  const setAutoUpdateOnNextStartOver = () => {
    dispatch(setShouldDeviceUpdate(true));
    dispatch(initiateWholeAppUpdate());
  };

  const checkAndUpdateAndRefresh = async () => {
    if (shouldApplyPendingUpdate(shouldDeviceUpdateRdx)) {
      window.location.reload();
      dispatch(setShouldDeviceUpdate(false));
    }
  };

  return {
    registerFCMTokenToServer,
    updateCxFcmKeyLoading,
    updateDeviceUpdateStatus,
    updateCxSoftwareDevicedDeviceWise,
    checkAndUpdateDeviceVersionDeviceWise,
    setAutoUpdateOnNextStartOver,
    checkAndUpdateAndRefresh,
  };
}

export default useAutoUpdate;
