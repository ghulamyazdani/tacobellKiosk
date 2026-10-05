import { useDispatch, useSelector } from "react-redux";
import { useCookies } from "react-cookie";
import dayjs from "dayjs";
import {
  selectCurrentToken,
  setAutenticationDetails,
  setLogOut,
  setToken,
} from "@cx-sdk/core/auth/authentication.slice";
import { setShouldRegisterFcm } from "@cx-sdk/devices/updates/autoUpdate.slice";
import { useLazyAuthenticateAndRegisterKioskQuery } from "@cx-sdk/core/auth/services/authApi";
import { authPolicy } from "@cx-sdk/core";
import { resetPersistedState } from "../../redux/app/store";
import { resetDatabase } from "../../models/db";

/**
 * P3 auth core — the registration/token/logout subset of posistKiosk's
 * useAuthHook, decision logic delegated to @cx-sdk/core authPolicy exactly
 * like the fork. DEVIATION (documented): the fork's emptyAllData is a ~20
 * dispatch fan-out; here a fresh registration wipes via resetPersistedState()
 * + resetDatabase() (RESET_STATE resets every slice — a superset). The
 * ordered fan-out arrives with the session-reset port (P4+).
 * QR/table-code scanning (getRestaurantDetailsFromCode) is out of the kiosk
 * flow and lands only if the Taco Bell deployment needs it.
 */
function useAuthHook() {
  const dispatch = useDispatch();
  const [cookies, setCookie, removeCookie] = useCookies(["token"]);
  const tokenRdx = useSelector(selectCurrentToken);

  const [authenticateAndRegister, { isLoading: isAuthenticateLoading }] =
    useLazyAuthenticateAndRegisterKioskQuery();

  const getAuthToken = () =>
    authPolicy.resolveAuthToken(cookies["token"], tokenRdx);

  const isKioskRegistered = () =>
    authPolicy.isKioskRegistered(getAuthToken());

  const wipeDeviceState = () => {
    resetPersistedState();
    resetDatabase().catch(() => {
      // Dexie unavailable (e.g. private mode) — redux reset already ran.
    });
  };

  const authenticateKiosk = async (code: string) => {
    try {
      const authenticationData =
        await authenticateAndRegister(code).unwrap();

      // Decision structure lives in the SDK; every user-facing string and
      // every effect (teardown, dispatches, cookie) stays here — fork parity.
      const decision = authPolicy.interpretAuthenticationResponse(
        authenticationData,
        {
          // Legacy expiry check, verbatim (moment === dayjs):
          isLicenseUnexpired: (expiryDate) =>
            dayjs().isBefore(dayjs(expiryDate)),
          // Legacy wiped state as soon as the response was truthy — BEFORE
          // the license gate, so an expired code still wipes state.
          onResponseReceived: wipeDeviceState,
        }
      );

      if (decision.kind === "REGISTER") {
        dispatch(setAutenticationDetails(authenticationData));
        dispatch(setToken(decision.loginCode));
        setCookie("token", decision.loginCode, { path: "/" });
        dispatch(setShouldRegisterFcm());
        return { error: null };
      } else if (decision.kind === "LICENSE_EXPIRED") {
        return { error: "The Code You Entered Has Expired" };
      }
      return {
        error:
          (authenticationData as { data?: { error?: string } })?.data?.error ??
          "Registration failed",
      };
    } catch (err) {
      const failure = err as { status?: unknown; data?: { error?: string } };
      const failureKind = authPolicy.classifyAuthenticationFailure(
        failure.status as never
      );
      if (failureKind === "FETCH_ERROR") {
        return { error: "Error In Fetching Data" };
      }
      if (failureKind === "SERVER_ERROR") {
        return { error: failure?.data?.error ?? "Server error" };
      }
      return { error: "Something unexpected happened" };
    }
  };

  const logoutKiosk = () => {
    dispatch(setLogOut());
    removeCookie("token", { path: "/" });
    wipeDeviceState();
  };

  return {
    authenticateKiosk,
    isAuthenticateLoading,
    getAuthToken,
    isKioskRegistered,
    logoutKiosk,
  };
}

export default useAuthHook;
