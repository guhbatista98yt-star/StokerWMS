import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { User, Company } from "@shared/schema";
import { UNAUTHORIZED_EVENT } from "@/lib/queryClient";
import { invalidatePrintConfigCache } from "@/hooks/use-print";

const INACTIVITY_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const INACTIVITY_CHECK_INTERVAL_MS = 60 * 1000;
const LAST_ACTIVITY_KEY = "stoker:lastActivity";

interface AuthContextType {
  user: User | null;
  sessionKey: string | null;
  companyId: number | null;
  allowedCompanies: number[];
  companiesData: Company[];
  status: "loading" | "authenticated" | "unauthenticated";
  login: (username: string, password: string, companyId?: number) => Promise<{ success: boolean; requireCompanySelection?: boolean; allowedCompanies?: number[]; companiesData?: Company[] }>;
  selectCompany: (companyId: number) => Promise<boolean>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [allowedCompanies, setAllowedCompanies] = useState<number[]>([]);
  const [companiesData, setCompaniesData] = useState<Company[]>([]);
  const [status, setStatus] = useState<"loading" | "authenticated" | "unauthenticated">("loading");
  const queryClient = useQueryClient();
  const inactivityTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearSession = useCallback(() => {
    invalidatePrintConfigCache();
    queryClient.clear();
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("wms:") || key?.startsWith("stoker:") || key?.startsWith("ws_scan_pending_queue")) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));

    // Limpa o IndexedDB de picking para não contaminar sessão seguinte em dispositivo compartilhado
    try {
      indexedDB.deleteDatabase("wms-picking-db");
    } catch {
      // silently ignore — IndexedDB pode não estar disponível
    }

    setUser(null);
    setSessionKey(null);
    setCompanyId(null);
    setAllowedCompanies([]);
    setStatus("unauthenticated");
  }, [queryClient]);

  const updateActivity = useCallback(() => {
    localStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString());
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } finally {
      if (inactivityTimerRef.current) {
        clearInterval(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
      clearSession();
      // Force navigation to login to avoid unhandled protected routes states
      window.location.href = "/login";
    }
  }, [clearSession]);

  const startInactivityMonitor = useCallback(() => {
    if (inactivityTimerRef.current) {
      clearInterval(inactivityTimerRef.current);
    }

    updateActivity();

    inactivityTimerRef.current = setInterval(() => {
      const lastActivity = localStorage.getItem(LAST_ACTIVITY_KEY);
      if (lastActivity) {
        const elapsed = Date.now() - parseInt(lastActivity, 10);
        if (elapsed >= INACTIVITY_TIMEOUT_MS) {
          logout();
        }
      }
    }, INACTIVITY_CHECK_INTERVAL_MS);
  }, [updateActivity, logout]);

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setSessionKey(data.sessionKey);
        setCompanyId(data.companyId || null);
        setAllowedCompanies(data.allowedCompanies || []);
        setCompaniesData(data.companiesData || []);
        setStatus("authenticated");
      } else {
        clearSession();
      }
    } catch {
      clearSession();
    }
  }, [clearSession]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Auto-logout quando qualquer query/mutation receber 401
  useEffect(() => {
    const handle = () => {
      if (status === "authenticated") logout();
    };
    window.addEventListener(UNAUTHORIZED_EVENT, handle);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handle);
  }, [status, logout]);

  useEffect(() => {
    if (status !== "authenticated") {
      if (inactivityTimerRef.current) {
        clearInterval(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
      return;
    }

    startInactivityMonitor();

    const events = ["mousedown", "keydown", "touchstart", "scroll", "mousemove"];
    let throttleTimer: ReturnType<typeof setTimeout> | null = null;

    const handleActivity = () => {
      if (throttleTimer) return;
      throttleTimer = setTimeout(() => {
        throttleTimer = null;
      }, 30000);
      updateActivity();
    };

    events.forEach(event => window.addEventListener(event, handleActivity, { passive: true }));

    return () => {
      events.forEach(event => window.removeEventListener(event, handleActivity));
      if (throttleTimer) clearTimeout(throttleTimer);
      if (inactivityTimerRef.current) {
        clearInterval(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
    };
  }, [status, startInactivityMonitor, updateActivity]);

  const login = async (username: string, password: string, selectedCompanyId?: number): Promise<{ success: boolean; requireCompanySelection?: boolean; allowedCompanies?: number[]; companiesData?: Company[]; userRole?: string }> => {
    try {
      clearSession();
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, companyId: selectedCompanyId }),
        credentials: "include",
      });

      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setSessionKey(data.sessionKey);
        setCompanyId(data.companyId || null);
        setAllowedCompanies(data.allowedCompanies || []);
        setCompaniesData(data.companiesData || []);

        if (data.requireCompanySelection) {
          setStatus("authenticated");
          return { success: true, requireCompanySelection: true, allowedCompanies: data.allowedCompanies, companiesData: data.companiesData, userRole: data.user?.role };
        }

        setStatus("authenticated");
        return { success: true, userRole: data.user?.role };
      }
      return { success: false };
    } catch {
      return { success: false };
    }
  };

  const selectCompany = async (selectedCompanyId: number): Promise<boolean> => {
    try {
      const res = await fetch("/api/auth/select-company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: selectedCompanyId }),
        credentials: "include",
      });

      if (res.ok) {
        setCompanyId(selectedCompanyId);
        queryClient.clear();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  return (
    <AuthContext.Provider value={{ user, sessionKey, companyId, allowedCompanies, companiesData, status, login, selectCompany, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

export function useSessionQueryKey(baseKey: string | string[]): string[] {
  const { sessionKey } = useAuth();
  const keys = Array.isArray(baseKey) ? baseKey : [baseKey];
  return sessionKey ? [sessionKey, ...keys] : keys;
}
