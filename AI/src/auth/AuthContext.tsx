import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { apiFetch } from "../lib/api";

export type Industry =
  | "HOSPITAL"
  | "CLINIC"
  | "HOTEL"
  | "RESTAURANT"
  | "REAL_ESTATE"
  | "OTHER";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  companyId: string;
  companyName: string;
  industry: Industry;
};

export type AuthStatus =
  | "HYDRATING"
  | "AUTHENTICATED"
  | "UNAUTHENTICATED";

type RegisterPayload = {
  name: string;
  email: string;
  password: string;
  companyName: string;
  industry: Industry;
};

type MeResponse = {
  user: AuthUser;
};

type AuthContextValue = {
  user: AuthUser | null;
  status: AuthStatus;
  loading: boolean;

  // Kept for compatibility with old components.
  login: (email: string, password: string) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  refreshUser: () => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [user, setUser] =
    useState<AuthUser | null>(null);

  const [status, setStatus] =
    useState<AuthStatus>("HYDRATING");

  const loading = status === "HYDRATING";

  const refreshUser = useCallback(async () => {
    // Remove any old JWT left over from the previous login system.
    localStorage.removeItem("airadesk_token");

    setStatus("HYDRATING");

    try {
      const data = await apiFetch<MeResponse>(
        "/api/auth/me"
      );

      setUser(data.user);
      setStatus("AUTHENTICATED");
    } catch (error) {
      console.error(
        "Failed to load local development user:",
        error
      );

      setUser(null);
      setStatus("UNAUTHENTICATED");
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  // Login/register are intentionally bypassed locally.
  // These functions stay here so old components still compile.
  const login = useCallback(
    async (_email: string, _password: string) => {
      await refreshUser();
    },
    [refreshUser]
  );

  const register = useCallback(
    async (_payload: RegisterPayload) => {
      await refreshUser();
    },
    [refreshUser]
  );

  // There is no logout in local single-user mode.
  const logout = useCallback(() => {
    void refreshUser();
  }, [refreshUser]);

  const value = useMemo(
    () => ({
      user,
      status,
      loading,
      login,
      register,
      refreshUser,
      logout,
    }),
    [
      user,
      status,
      loading,
      login,
      register,
      refreshUser,
      logout,
    ]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error(
      "useAuth must be used inside AuthProvider"
    );
  }

  return context;
}