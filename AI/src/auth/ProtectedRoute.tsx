import { type ReactNode } from "react";
import { Navigate } from "react-router";
import { useAuth } from "./AuthContext";

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, status, loading } = useAuth();

  if (loading || status === "HYDRATING") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#05070d] text-white">
        Loading AiraDesk...
      </div>
    );
  }

  if (!user || status === "UNAUTHENTICATED") {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
