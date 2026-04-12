import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { useToast } from "@/hooks/use-toast";
import { Building2, Loader2, Sun, Moon, ChevronRight } from "lucide-react";

export default function CompanySelectPage() {
  const [, navigate] = useLocation();
  const { user, companyId, companiesData, selectCompany, logout } = useAuth();
  const { toast } = useToast();
  const { theme, toggle: toggleTheme } = useTheme();
  const [isLoading, setIsLoading] = useState(false);
  const [loadingId, setLoadingId] = useState<number | null>(null);

  const isDark = theme === "dark";

  function getOperatorRoute(role?: string): string {
    if (role === "separacao") return "/separacao";
    if (role === "conferencia") return "/conferencia";
    if (role === "balcao") return "/balcao";
    if (role === "fila_pedidos") return "/fila-pedidos";
    return "/";
  }

  useEffect(() => {
    if (companyId) navigate(getOperatorRoute(user?.role));
  }, [companyId, navigate]);

  const handleSelect = async (selectedId: number) => {
    setIsLoading(true);
    setLoadingId(selectedId);
    try {
      const success = await selectCompany(selectedId);
      if (!success) {
        toast({ title: "Erro", description: "Não foi possível selecionar a empresa", variant: "destructive" });
      }
    } finally {
      setIsLoading(false);
      setLoadingId(null);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background flex items-center justify-center relative overflow-hidden">

      {/* Decorative background */}
      {isDark && (
        <>
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -top-32 -left-32 w-[480px] h-[480px] rounded-full bg-blue-600/10 blur-[120px]" />
            <div className="absolute -bottom-32 -right-32 w-[420px] h-[420px] rounded-full bg-emerald-500/8 blur-[100px]" />
          </div>
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.025]"
            style={{
              backgroundImage: "linear-gradient(hsl(217 91% 65% / 1) 1px, transparent 1px), linear-gradient(90deg, hsl(217 91% 65% / 1) 1px, transparent 1px)",
              backgroundSize: "48px 48px",
            }}
          />
          <div className="pointer-events-none absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-500/40 to-transparent" />
        </>
      )}
      {!isDark && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-32 -right-32 w-[400px] h-[400px] rounded-full bg-blue-500/6 blur-[100px]" />
          <div className="absolute -bottom-32 -left-32 w-[400px] h-[400px] rounded-full bg-indigo-500/5 blur-[100px]" />
        </div>
      )}

      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        className="absolute top-4 right-4 z-10 w-9 h-9 flex items-center justify-center rounded-xl bg-card border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
        title={isDark ? "Tema claro" : "Tema escuro"}
        data-testid="btn-theme-toggle-company"
      >
        {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>

      {/* Main content */}
      <div className="relative z-10 w-full max-w-[360px] px-5 py-8 flex flex-col items-center gap-8">

        {/* Brand */}
        <div className="flex flex-col items-center gap-5">
          <div className="relative flex items-center justify-center">
            {isDark && (
              <div className="absolute inset-0 rounded-full bg-blue-500/15 blur-2xl scale-150" />
            )}
            <div className={`relative w-[96px] h-[96px] rounded-[22px] flex items-center justify-center ${
              isDark
                ? "bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-white/5 shadow-[0_0_32px_rgba(59,130,246,0.18)]"
                : "bg-gradient-to-br from-white to-slate-50 border border-slate-200/80 shadow-lg"
            }`}>
              <img src="/stoker-icon.png" alt="Stoker" className="w-[60px] h-[60px] object-contain select-none" draggable={false} />
            </div>
          </div>

          <div className="text-center space-y-1">
            <h1
              className="text-2xl font-black tracking-tight"
              style={{
                background: "linear-gradient(135deg, #60a5fa 0%, #34d399 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              STOKER
            </h1>
            <p className="text-[11px] text-muted-foreground/60">
              Olá, <span className="font-semibold text-foreground/80">{user?.name || "Operador"}</span> — selecione a empresa
            </p>
          </div>
        </div>

        {/* Company cards */}
        <div className={`w-full rounded-2xl border p-5 space-y-2 ${
          isDark
            ? "bg-white/[0.03] border-white/[0.06] backdrop-blur-xl shadow-[0_24px_64px_rgba(0,0,0,0.5)]"
            : "bg-white border-slate-200/80 shadow-xl"
        }`}>
          <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground/50 mb-3">
            Empresas disponíveis
          </p>

          <div className="space-y-2">
            {companiesData.map((company) => {
              const isThis = loadingId === company.id;
              return (
                <button
                  key={company.id}
                  onClick={() => handleSelect(company.id)}
                  disabled={isLoading}
                  data-testid={`button-select-company-${company.id}`}
                  className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border text-left transition-all group ${
                    isDark
                      ? "bg-white/[0.04] border-white/[0.06] hover:bg-white/[0.08] hover:border-blue-500/30 active:scale-[0.99]"
                      : "bg-slate-50 border-slate-200 hover:bg-blue-50/60 hover:border-blue-300/60 active:scale-[0.99]"
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                    isDark ? "bg-blue-500/15" : "bg-blue-100"
                  }`}>
                    <Building2 className="h-4 w-4 text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-foreground truncate">{company.name}</div>
                    <div className="text-[11px] text-muted-foreground/60 truncate mt-0.5">
                      CNPJ: {company.cnpj || "—"} · ID {company.id}
                    </div>
                  </div>
                  {isThis
                    ? <Loader2 className="h-4 w-4 text-muted-foreground animate-spin shrink-0" />
                    : <ChevronRight className="h-4 w-4 text-muted-foreground/30 group-hover:text-muted-foreground/60 shrink-0 transition-colors" />
                  }
                </button>
              );
            })}
          </div>

          <div className="pt-2 border-t border-border/30 mt-3">
            <button
              onClick={logout}
              data-testid="button-logout"
              className="w-full py-2.5 text-sm text-muted-foreground/60 hover:text-muted-foreground transition-colors"
            >
              Sair da conta
            </button>
          </div>
        </div>

        <p className="text-[10px] text-muted-foreground/20 font-medium tracking-wider">
          STOKER v2.0 · WMS
        </p>
      </div>
    </div>
  );
}
