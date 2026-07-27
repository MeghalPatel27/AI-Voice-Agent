  import {
    createContext,
    ReactNode,
    useContext,
    useEffect,
    useMemo,
    useState,
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
    loading: boolean;
    login: (email: string, password: string) => Promise<void>;
    register: (payload: RegisterPayload) => Promise<void>;
    refreshUser: () => Promise<void>;
    logout: () => void;
  };
  const AuthContext = createContext<AuthContextValue | null>(null);

  export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [loading, setLoading] = useState(true);

    async function refreshUser() {
      const token = localStorage.getItem("airadesk_token");

      if (!token) {
        setLoading(false);
        return;
      }

      try {
        const data = await apiFetch<MeResponse>("/api/auth/me");
        setUser(data.user);
      } catch {
        localStorage.removeItem("airadesk_token");
        setUser(null);
      } finally {
        setLoading(false);
      }
    }

    useEffect(() => {
      refreshUser();
    }, []);

    async function login(email: string, password: string) {
      const data = await apiFetch<LoginResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
        }),
      });

      localStorage.setItem("airadesk_token", data.token);
      setUser(data.user);
    }

    async function register(payload: RegisterPayload) {
      const data = await apiFetch<LoginResponse>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      localStorage.setItem("airadesk_token", data.token);
      setUser(data.user);
    }

    function logout() {
      localStorage.removeItem("airadesk_token");
      setUser(null);
    }

    const value = useMemo(
      () => ({
        user,
        loading,
        login,
        register,
        logout,
        refreshUser,
      }),
      [user, loading]
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
  }

  export function useAuth() {
    const context = useContext(AuthContext);

    if (!context) {
      throw new Error("useAuth must be used inside AuthProvider");
    }

    return context;
  }