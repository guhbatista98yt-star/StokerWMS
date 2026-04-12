import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema, type LoginInput } from "@shared/schema";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { User, Lock, Loader2, Download, Sun, Moon, ArrowRight } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function LoginPage() {
  const [, navigate] = useLocation();
  const { login } = useAuth();
  const { toast } = useToast();
  const { theme, toggle: toggleTheme } = useTheme();
  const [isLoading, setIsLoading] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(display-mode: standalone)").matches || (window.navigator as any).standalone) {
      setIsInstalled(true);
    }
    const handler = (e: Event) => { e.preventDefault(); setDeferredPrompt(e as BeforeInstallPromptEvent); };
    const installedHandler = () => { setIsInstalled(true); setDeferredPrompt(null); };
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", installedHandler);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") { setDeferredPrompt(null); setIsInstalled(true); }
  };

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  function getOperatorRoute(role?: string): string {
    if (role === "separacao") return "/separacao";
    if (role === "conferencia") return "/conferencia";
    if (role === "balcao") return "/balcao";
    if (role === "fila_pedidos") return "/fila-pedidos";
    return "/";
  }

  const onSubmit = async (data: LoginInput) => {
    setIsLoading(true);
    try {
      const result = await login(data.username, data.password);
      if (result.success) {
        if (result.requireCompanySelection) { navigate("/select-company"); return; }
        navigate(getOperatorRoute(result.userRole));
      } else {
        toast({ title: "Acesso negado", description: "Usuário ou senha inválidos.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erro de conexão", description: "Não foi possível conectar ao servidor.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const isDark = theme === "dark";

  return (
    <div className="min-h-[100dvh] bg-background flex items-center justify-center relative overflow-hidden">

      {/* ── Decorative background ── */}
      {isDark && (
        <>
          {/* Orbs */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -top-32 -left-32 w-[480px] h-[480px] rounded-full bg-blue-600/10 blur-[120px]" />
            <div className="absolute -bottom-32 -right-32 w-[420px] h-[420px] rounded-full bg-emerald-500/8 blur-[100px]" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] rounded-full bg-indigo-600/6 blur-[80px]" />
          </div>
          {/* Subtle grid */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.025]"
            style={{
              backgroundImage: "linear-gradient(hsl(217 91% 65% / 1) 1px, transparent 1px), linear-gradient(90deg, hsl(217 91% 65% / 1) 1px, transparent 1px)",
              backgroundSize: "48px 48px",
            }}
          />
          {/* Top accent line */}
          <div className="pointer-events-none absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-500/40 to-transparent" />
        </>
      )}
      {!isDark && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-32 -right-32 w-[400px] h-[400px] rounded-full bg-blue-500/6 blur-[100px]" />
          <div className="absolute -bottom-32 -left-32 w-[400px] h-[400px] rounded-full bg-indigo-500/5 blur-[100px]" />
        </div>
      )}

      {/* ── Theme toggle ── */}
      <button
        onClick={toggleTheme}
        className="absolute top-4 right-4 z-20 w-9 h-9 flex items-center justify-center rounded-xl bg-card border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
        title={isDark ? "Tema claro" : "Tema escuro"}
        data-testid="btn-theme-toggle-login"
      >
        {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>

      {/* ── Main content ── */}
      <div className="relative z-10 w-full max-w-[360px] px-5 py-8 flex flex-col items-center gap-10 animate-fade-in">

        {/* ── Brand section ── */}
        <div className="flex flex-col items-center gap-5">
          {/* Icon with glow ring */}
          <div className="relative flex items-center justify-center">
            {isDark && (
              <>
                <div className="absolute inset-0 rounded-full bg-blue-500/15 blur-2xl scale-150" />
                <div className="absolute inset-0 rounded-full border border-blue-500/10 scale-[1.35]" />
              </>
            )}
            <div className={`relative w-[120px] h-[120px] rounded-[28px] flex items-center justify-center ${
              isDark
                ? "bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-white/5 shadow-[0_0_40px_rgba(59,130,246,0.2)]"
                : "bg-gradient-to-br from-white to-slate-50 border border-slate-200/80 shadow-xl"
            }`}>
              <img
                src="/stoker-icon.png"
                alt="Stoker"
                className="w-[78px] h-[78px] object-contain select-none"
                draggable={false}
              />
            </div>
          </div>

          {/* Brand text */}
          <div className="text-center space-y-1">
            <h1
              className="text-3xl font-black tracking-tight"
              style={{
                background: "linear-gradient(135deg, #60a5fa 0%, #34d399 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              STOKER
            </h1>
            <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-muted-foreground/50">
              Warehouse Management System
            </p>
          </div>
        </div>

        {/* ── Login card ── */}
        <div className={`w-full rounded-2xl border p-6 space-y-4 ${
          isDark
            ? "bg-white/[0.03] border-white/[0.06] backdrop-blur-xl shadow-[0_24px_64px_rgba(0,0,0,0.5)]"
            : "bg-white border-slate-200/80 shadow-xl"
        }`}>

          {/* Section label */}
          <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground/50 mb-2">
            Acesso ao sistema
          </p>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">

              {/* Username */}
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <div className="relative group">
                        <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40 pointer-events-none transition-colors group-focus-within:text-blue-400" />
                        <input
                          {...field}
                          placeholder="Usuário"
                          autoComplete="username"
                          disabled={isLoading}
                          data-testid="input-username"
                          className={`w-full pl-10 pr-4 h-12 rounded-xl text-sm outline-none transition-all ${
                            isDark
                              ? "bg-white/[0.05] border border-white/[0.08] text-foreground placeholder:text-muted-foreground/30 focus:border-blue-500/50 focus:bg-white/[0.07] focus:shadow-[0_0_0_3px_rgba(59,130,246,0.12)]"
                              : "bg-slate-50 border border-slate-200 text-foreground placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:shadow-[0_0_0_3px_rgba(59,130,246,0.08)]"
                          }`}
                        />
                      </div>
                    </FormControl>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />

              {/* Password */}
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <div className="relative group">
                        <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40 pointer-events-none transition-colors group-focus-within:text-blue-400" />
                        <input
                          {...field}
                          type="password"
                          placeholder="Senha"
                          autoComplete="current-password"
                          disabled={isLoading}
                          data-testid="input-password"
                          className={`w-full pl-10 pr-4 h-12 rounded-xl text-sm outline-none transition-all ${
                            isDark
                              ? "bg-white/[0.05] border border-white/[0.08] text-foreground placeholder:text-muted-foreground/30 focus:border-blue-500/50 focus:bg-white/[0.07] focus:shadow-[0_0_0_3px_rgba(59,130,246,0.12)]"
                              : "bg-slate-50 border border-slate-200 text-foreground placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:shadow-[0_0_0_3px_rgba(59,130,246,0.08)]"
                          }`}
                        />
                      </div>
                    </FormControl>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />

              {/* Submit button */}
              <button
                type="submit"
                disabled={isLoading}
                data-testid="button-login"
                className="relative w-full h-12 rounded-xl font-bold text-sm text-white overflow-hidden transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed mt-1"
                style={{
                  background: isLoading
                    ? "linear-gradient(135deg, #3b82f6, #34d399)"
                    : "linear-gradient(135deg, #3b82f6 0%, #06b6d4 50%, #34d399 100%)",
                  backgroundSize: "200% 200%",
                  boxShadow: isDark ? "0 4px 24px rgba(59,130,246,0.35), 0 1px 0 rgba(255,255,255,0.08) inset" : "0 4px 16px rgba(59,130,246,0.3)",
                }}
              >
                <span className="relative z-10 flex items-center justify-center gap-2">
                  {isLoading ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Autenticando...</>
                  ) : (
                    <><span>Entrar</span><ArrowRight className="h-4 w-4" /></>
                  )}
                </span>
                {/* Shine overlay */}
                {!isLoading && (
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] hover:translate-x-[100%] transition-transform duration-700" />
                )}
              </button>

            </form>
          </Form>
        </div>

        {/* PWA install */}
        {deferredPrompt && !isInstalled && (
          <button
            onClick={handleInstall}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-border/40 bg-card text-muted-foreground text-xs hover:text-foreground hover:border-border transition-colors"
            data-testid="button-install"
          >
            <Download className="h-3.5 w-3.5" />
            Instalar aplicativo
          </button>
        )}

        <div className="flex flex-col items-center gap-1">
          <p className="text-[10px] text-muted-foreground/25 font-medium tracking-wider">
            STOKER v2.0 · WMS
          </p>
          <p className="text-[10px] text-muted-foreground/20 font-medium">
            by Gusttavo Batista
          </p>
        </div>
      </div>
    </div>
  );
}
