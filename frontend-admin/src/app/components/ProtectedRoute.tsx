import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router";
import { clearToken, getMe, getToken } from "../../lib/api";

export function ProtectedRoute() {
  const [status, setStatus] = useState<"checking" | "ok" | "unauthenticated">(
    getToken() ? "checking" : "unauthenticated",
  );

  useEffect(() => {
    if (status !== "checking") return;
    getMe()
      .then(() => setStatus("ok"))
      .catch(() => {
        clearToken();
        setStatus("unauthenticated");
      });
  }, [status]);

  if (status === "checking") {
    return <div className="min-h-screen flex items-center justify-center text-sm text-gray-400">กำลังตรวจสอบสิทธิ์...</div>;
  }

  if (status === "unauthenticated") {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
