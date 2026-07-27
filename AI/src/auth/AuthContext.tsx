import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { apiFetch, registerSessionInvalidationListener } from "../lib/api";

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

export type AuthStatus = "HYDRATING" | "AUTHENTICATED" | "UNAUTHENTICATED";

type LoginResponse = {
  message: string;
  token: string;
  user: AuthUser;
};

type MeResponse = {
  user: AuthUser;
};

type RegisterPayload = {
  name: string;
  email: string;
  password: string;
  companyName: string;
  industry: Industry;
};

type AuthContextValue = {
  user: AuthUser | null;
  status: AuthStatus;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  refreshUser: () => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredToken() {
  return localStorage.getItem("airadesk_token");
}

function getInitialStatus(): AuthStatus {
  return readStoredToken() ? "HYDRATING" : "UNAUTHENTICATED";
}

async function fetchSessionUser(signal?: AbortSignal) {
  const data = await apiFetch<MeResponse>("/api/auth/me", { signal });
  return data.user;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>(getInitialStatus);
  const hydrationAbortRef = useRef<AbortController | null>(null);
  const redirectingRef = useRef(false);

  const loading = status === "HYDRATING";

  const clearSession = useCallback(() => {
    localStorage.removeItem("airadesk_token");
    setUser(null);
    setStatus("UNAUTHENTICATED");
  }, []);

  const hydrateFromToken = useCallback(
    async (signal?: AbortSignal) => {
      const token = readStoredToken();
      if (!token) {
        setUser(null);
        setStatus("UNAUTHENTICATED");
        return;
      }

      setStatus("HYDRATING");

      try {
        const nextUser = await fetchSessionUser(signal);
        if (signal?.aborted) return;
        setUser(nextUser);
        setStatus("AUTHENTICATED");
      } catch (error) {
        if (signal?.aborted) return;
        const aborted =
          error instanceof Error &&
          "aborted" in error &&
          Boolean((error as { aborted?: boolean }).aborted);
        if (aborted) return;
        clearSession();
      }
    },
    [clearSession],
  );

  useEffect(() => {
    hydrationAbortRef.current?.abort();
    const controller = new AbortController();
    hydrationAbortRef.current = controller;

    // Hydrate persisted sessions once on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- auth bootstrap must read persisted token after mount
    void hydrateFromToken(controller.signal);

    return () => {
      controller.abort();
    };
  }, [hydrateFromToken]);

  useEffect(() => {
    registerSessionInvalidationListener((reason) => {
      if (reason !== "unauthorized" || redirectingRef.current) return;
      redirectingRef.current = true;
      clearSession();
    });

    return () => {
      registerSessionInvalidationListener(null);
      redirectingRef.current = false;
    };
  }, [clearSession]);

  const refreshUser = useCallback(async () => {
    await hydrateFromToken();
  }, [hydrateFromToken]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await apiFetch<LoginResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
      }),
    });

    localStorage.setItem("airadesk_token", data.token);
    redirectingRef.current = false;
    setUser(data.user);
    setStatus("AUTHENTICATED");
  }, []);

  const register = useCallback(async (payload: RegisterPayload) => {
    const data = await apiFetch<LoginResponse>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    localStorage.setItem("airadesk_token", data.token);
    redirectingRef.current = false;
    setUser(data.user);
    setStatus("AUTHENTICATED");
  }, []);

  const logout = useCallback(() => {
    hydrationAbortRef.current?.abort();
    redirectingRef.current = false;
    clearSession();
  }, [clearSession]);

  const value = useMemo(
    () => ({
      user,
      status,
      loading,
      login,
      register,
      logout,
      refreshUser,
    }),
    [user, status, loading, login, register, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- hook must live beside AuthProvider
export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}
