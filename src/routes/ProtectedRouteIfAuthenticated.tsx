import { Navigate, Outlet } from "react-router-dom";
import { Cookies } from "react-cookie";

/** Registration route gate: already registered → skip straight to /start. */
export default function ProtectedRouteIfAuthenticated() {
  const token = new Cookies().get("token");
  return token ? <Navigate to="/start" replace /> : <Outlet />;
}
