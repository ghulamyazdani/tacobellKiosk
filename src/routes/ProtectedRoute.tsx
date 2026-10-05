import { Navigate, Outlet } from "react-router-dom";
import { Cookies } from "react-cookie";

/**
 * Auth gate: no device token → back to Registration ("/").
 * Token source parity with posistKiosk: the "token" cookie (useAuthHook's
 * redux fallback arrives with the P3 auth port).
 */
export default function ProtectedRoute() {
  const token = new Cookies().get("token");
  return token ? <Outlet /> : <Navigate to="/" replace />;
}
