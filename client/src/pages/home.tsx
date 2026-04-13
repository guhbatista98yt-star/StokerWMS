import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { Link } from "wouter";
import {
  Package, ClipboardCheck, Store, LogOut, ClipboardList,
  Warehouse, PackagePlus, ArrowRightLeft, MapPin, BarChart3,
  Truck, AlertTriangle, FileText, Users, Settings, ShieldCheck,
  Printer, Cog, BoxesIcon, ScrollText, Search, Trash2, TrendingUp, Barcode, PackageMinus, Layers,
  PanelLeftClose, PanelLeftOpen,
  Menu, X, Sun, Moon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface NavItem {
  icon: LucideIcon;
  label: string;
  description: string;
  href: string;
  color: string;
  bg: string;
}

interface NavGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  accentColor: string;
  accentBg: string;
  items: NavItem[];
}

const ALL_GROUPS: NavGroup[] = [
  {
    id: "operacao",
    label: "Operação",
    icon: BoxesIcon,
    accentColor: "text-blue-400",
    accentBg: "bg-blue-500/15",
    items: [
      { icon: Package,        label: "Separação",       description: "Separar pedidos de entrega",   href: "/separacao",           color: "text-blue-400",   bg: "bg-blue-500/15" },
      { icon: ClipboardCheck, label: "Conferência",     description: "Conferir pedidos separados",   href: "/conferencia",         color: "text-green-400",  bg: "bg-green-500/15" },
      { icon: Store,          label: "Balcão",          description: "Atendimento ao cliente",       href: "/balcao",              color: "text-orange-400", bg: "bg-orange-500/15" },
      { icon: ClipboardList,  label: "Fila de Pedidos", description: "Acompanhamento em tempo real", href: "/fila-pedidos",        color: "text-violet-400", bg: "bg-violet-500/15" },
      { icon: PackagePlus,    label: "Recebimento",     description: "Receber NFs e gerar pallets",  href: "/wms/recebimento",     color: "text-blue-400",   bg: "bg-blue-500/15" },
      { icon: MapPin,         label: "Endereçamento",   description: "Alocar pallets em endereços",  href: "/wms/checkin",         color: "text-teal-400",   bg: "bg-teal-500/15" },
      { icon: ArrowRightLeft, label: "Transferência",   description: "Movimentar pallets",           href: "/wms/transferencia",   color: "text-cyan-400",   bg: "bg-cyan-500/15" },
      { icon: PackageMinus,   label: "Retirada",        description: "Retirar produto de pallet",    href: "/wms/retirada",        color: "text-amber-400",  bg: "bg-amber-500/15" },
      { icon: PackagePlus,    label: "Adição",          description: "Adicionar produto em pallet",  href: "/wms/adicao",          color: "text-emerald-400",bg: "bg-emerald-500/15" },
      { icon: BarChart3,      label: "Contagem",        description: "Ciclos de contagem",           href: "/wms/contagem",        color: "text-indigo-400", bg: "bg-indigo-500/15" },
      { icon: Warehouse,      label: "Endereços",       description: "Gerenciar endereços WMS",      href: "/wms/enderecos",       color: "text-slate-400",  bg: "bg-slate-500/15" },
      { icon: Search,         label: "Buscar Produtos", description: "Pesquisar estoque",            href: "/wms/produtos",        color: "text-sky-400",    bg: "bg-sky-500/15" },
      { icon: Barcode,        label: "Vínculo Rápido",  description: "Vincular códigos de barras",   href: "/wms/codigos-barras",  color: "text-rose-400",   bg: "bg-rose-500/15" },
    ],
  },
  {
    id: "logistica",
    label: "Logística",
    icon: Truck,
    accentColor: "text-emerald-400",
    accentBg: "bg-emerald-500/15",
    items: [
      { icon: Package,       label: "Pedidos",   description: "Gerenciar pedidos",          href: "/supervisor/orders",       color: "text-blue-400",   bg: "bg-blue-500/15" },
      { icon: Truck,         label: "Rotas",     description: "Gerenciar rotas de entrega", href: "/supervisor/routes",       color: "text-emerald-400",bg: "bg-emerald-500/15" },
      { icon: ScrollText,    label: "Expedição", description: "Atribuir pedidos a rotas",   href: "/supervisor/route-orders", color: "text-teal-400",   bg: "bg-teal-500/15" },
      { icon: AlertTriangle, label: "Exceções",  description: "Exceções pendentes",         href: "/supervisor/exceptions",   color: "text-amber-400",  bg: "bg-amber-500/15" },
    ],
  },
  {
    id: "administracao",
    label: "Administração",
    icon: Cog,
    accentColor: "text-amber-400",
    accentBg: "bg-amber-500/15",
    items: [
      { icon: Users,         label: "Usuários",         description: "Gerenciar operadores",          href: "/supervisor/users",               color: "text-blue-400",   bg: "bg-blue-500/15" },
      { icon: TrendingUp,    label: "KPIs",             description: "Desempenho e produtividade",    href: "/admin/kpi-operadores",           color: "text-violet-400", bg: "bg-violet-500/15" },
      { icon: FileText,      label: "Relatórios",       description: "Gerar relatórios",              href: "/supervisor/reports",             color: "text-slate-400",  bg: "bg-slate-500/15" },
      { icon: ClipboardCheck,label: "Auditoria",        description: "Logs de operações",             href: "/supervisor/audit",               color: "text-green-400",  bg: "bg-green-500/15" },
      { icon: Settings,      label: "Mapping Studio",   description: "Mapeamento DB2",                href: "/supervisor/mapping-studio",      color: "text-cyan-400",   bg: "bg-cyan-500/15" },
      { icon: ShieldCheck,   label: "Permissões",       description: "Definir acessos",               href: "/admin/permissoes",               color: "text-amber-400",  bg: "bg-amber-500/15" },
      { icon: Barcode,       label: "Gestão Barcodes",  description: "Gerenciar códigos de barras",   href: "/supervisor/codigos-barras",      color: "text-rose-400",   bg: "bg-rose-500/15" },
      { icon: Printer,       label: "Impressoras",      description: "Configurar impressoras",        href: "/supervisor/print-settings",      color: "text-indigo-400", bg: "bg-indigo-500/15" },
      { icon: Layers,        label: "Modo Separação",   description: "Configurar modo de separação",  href: "/supervisor/separation-settings", color: "text-purple-400", bg: "bg-purple-500/15" },
      { icon: Trash2,        label: "Limpeza de Dados", description: "Resetar dados de teste",        href: "/admin/limpeza",                  color: "text-red-400",    bg: "bg-red-500/15" },
    ],
  },
];

const ROLE_LABELS: Record<string, string> = {
  administrador: "Administrador", supervisor: "Supervisor",
  separacao: "Separador", conferencia: "Conferente",
  balcao: "Balcão", fila_pedidos: "Fila de Pedidos",
  recebedor: "Recebedor", empilhador: "Empilhador",
  conferente_wms: "Conferente WMS",
};

const ROLE_MODULE_ACCESS: Record<string, string[]> = {
  administrador: [
    "/wms/recebimento","/wms/checkin","/wms/transferencia","/wms/retirada","/wms/adicao","/wms/contagem","/wms/enderecos","/wms/produtos","/wms/codigos-barras",
    "/fila-pedidos","/supervisor/orders","/supervisor/routes","/supervisor/route-orders","/supervisor/exceptions",
    "/supervisor/users","/supervisor/mapping-studio","/supervisor/codigos-barras",
    "/supervisor/reports","/supervisor/audit","/admin/permissoes",
    "/admin/limpeza","/supervisor/print-settings","/admin/kpi-operadores","/supervisor/separation-settings",
  ],
  supervisor: [
    "/wms/recebimento","/wms/checkin","/wms/transferencia","/wms/retirada","/wms/adicao","/wms/contagem","/wms/enderecos","/wms/produtos","/wms/codigos-barras",
    "/fila-pedidos","/supervisor/orders","/supervisor/routes","/supervisor/route-orders","/supervisor/exceptions",
    "/supervisor/users","/supervisor/reports","/supervisor/audit",
    "/supervisor/codigos-barras","/admin/kpi-operadores","/supervisor/separation-settings",
  ],
  separacao:      ["/separacao","/wms/codigos-barras"],
  conferencia:    ["/conferencia","/wms/codigos-barras"],
  balcao:         ["/balcao","/wms/codigos-barras"],
  fila_pedidos:   ["/fila-pedidos"],
  recebedor:      ["/wms/recebimento","/wms/adicao","/wms/produtos","/wms/codigos-barras"],
  empilhador:     ["/wms/checkin","/wms/transferencia","/wms/retirada","/wms/adicao","/wms/produtos","/wms/codigos-barras"],
  conferente_wms: ["/wms/contagem","/wms/produtos","/wms/codigos-barras"],
};

function buildAllowedHrefs(role: string, customModules?: string[] | null): string[] {
  const base = Array.isArray(customModules) ? customModules : (ROLE_MODULE_ACCESS[role] ?? []);
  if (role === "administrador") return [...new Set([...base, "/admin/permissoes","/admin/limpeza","/supervisor/print-settings","/admin/kpi-operadores","/supervisor/separation-settings"])];
  if (role === "supervisor")    return [...new Set([...base, "/admin/kpi-operadores","/supervisor/separation-settings"])];
  return base;
}

function ModuleCard({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <Link href={item.href}>
      <div
        className="group flex flex-col gap-3 p-4 rounded-2xl bg-card border border-border/40 hover:border-primary/40 hover:bg-card/80 hover:-translate-y-0.5 hover:shadow-lg transition-all cursor-pointer"
        data-testid={`tile-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", item.bg)}>
          <Icon className={cn("h-5 w-5", item.color)} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground leading-tight truncate">{item.label}</p>
          <p className="text-[11px] text-muted-foreground leading-snug mt-0.5 line-clamp-2">{item.description}</p>
        </div>
      </div>
    </Link>
  );
}

export default function HomePage() {
  const { user, logout, companiesData, companyId } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  const role = user?.role ?? "";
  const customModules = user?.allowedModules as string[] | null | undefined;
  const allowedHrefs = buildAllowedHrefs(role, customModules);
  const userName = user?.name ?? "Operador";
  const companyName = companiesData?.find(c => c.id === companyId)?.name;
  const roleLabel = ROLE_LABELS[role] ?? role;

  const visibleGroups = ALL_GROUPS
    .map(g => ({ ...g, items: g.items.filter(i => allowedHrefs.includes(i.href)) }))
    .filter(g => g.items.length > 0);

  const activeGroupData = visibleGroups.find(g => g.id === activeGroup) ?? null;
  const initials = userName.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase();

  function handleGroupClick(id: string) {
    setActiveGroup(prev => (prev === id ? null : id));
    setMobileOpen(false);
  }

  const SidebarContent = ({ isMobile = false }: { isMobile?: boolean }) => {
    const collapsed = sidebarCollapsed && !isMobile;

    return (
      <>
        <div className={cn(
          "border-b border-sidebar-border shrink-0",
          collapsed ? "px-2 py-3" : "px-4 py-3"
        )}>
          <div className={cn(
            "flex items-center",
            collapsed ? "justify-center" : "gap-3"
          )}>
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center text-[11px] font-bold text-primary shrink-0 select-none">
              {initials}
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-sidebar-foreground truncate leading-tight">{userName}</p>
                {companyName && <p className="text-[10px] text-sidebar-foreground/40 truncate">{companyName}</p>}
              </div>
            )}
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-2 space-y-0.5">
          {visibleGroups.map(group => {
            const GIcon = group.icon;
            const isActive = activeGroup === group.id;

            return (
              <div key={group.id}>
                <button
                  onClick={() => handleGroupClick(group.id)}
                  className={cn(
                    "w-full flex items-center rounded-xl transition-colors",
                    collapsed ? "justify-center h-10 w-10 mx-auto" : "gap-3 px-3 py-2.5 mx-2",
                    isActive
                      ? "bg-sidebar-primary text-sidebar-primary-foreground"
                      : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-black/5 dark:hover:bg-white/5"
                  )}
                  title={collapsed ? group.label : undefined}
                  data-testid={`nav-group-${group.id}`}
                >
                  <GIcon className={cn("h-[18px] w-[18px] shrink-0", isActive ? "text-sidebar-primary-foreground" : group.accentColor)} />
                  {!collapsed && (
                    <>
                      <span className="flex-1 text-left text-[13px] font-medium">{group.label}</span>
                      <span className={cn("text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded-md",
                        isActive ? "bg-white/20 text-white" : "bg-black/5 dark:bg-white/5 text-sidebar-foreground/40"
                      )}>
                        {group.items.length}
                      </span>
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </nav>

        <div className={cn(
          "border-t border-sidebar-border shrink-0",
          collapsed ? "px-2 py-3 flex flex-col items-center gap-1" : "px-3 py-3 flex items-center gap-2"
        )}>
          <button
            onClick={toggleTheme}
            className={cn(
              "flex items-center justify-center rounded-lg text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors",
              collapsed ? "w-9 h-9" : "w-8 h-8"
            )}
            title={theme === "dark" ? "Tema claro" : "Tema escuro"}
            data-testid="btn-theme-toggle"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          {!isMobile && !collapsed && (
            <button
              onClick={() => setSidebarCollapsed(true)}
              className="flex items-center justify-center w-8 h-8 rounded-lg text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
              title="Recolher menu"
              data-testid="btn-sidebar-collapse"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          )}

          {!isMobile && collapsed && (
            <button
              onClick={() => setSidebarCollapsed(false)}
              className="flex items-center justify-center w-9 h-9 rounded-lg text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
              title="Expandir menu"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          )}

          {!collapsed && <div className="flex-1" />}

          <button
            onClick={logout}
            className={cn(
              "flex items-center justify-center rounded-lg text-sidebar-foreground/40 hover:text-red-400 hover:bg-black/5 dark:hover:bg-white/5 transition-colors",
              collapsed ? "w-9 h-9" : "w-8 h-8"
            )}
            title="Sair"
            data-testid="button-logout"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </>
    );
  };

  return (
    <div className="flex h-[100dvh] bg-background overflow-hidden">

      <aside className={cn(
        "hidden lg:flex flex-col h-screen sticky top-0 bg-sidebar border-r border-sidebar-border shrink-0 transition-all duration-300 ease-in-out",
        sidebarCollapsed ? "w-[72px]" : "w-[260px]"
      )}>
        <div className={cn(
          "flex items-center h-14 border-b border-sidebar-border shrink-0",
          sidebarCollapsed ? "justify-center px-3" : "px-4 justify-between"
        )}>
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src="/stoker-icon.png"
              alt="Stoker"
              className="w-7 h-7 object-contain shrink-0 select-none"
              draggable={false}
            />
            {!sidebarCollapsed && (
              <span className="font-bold text-sidebar-foreground text-sm tracking-tight">Stoker</span>
            )}
          </div>
        </div>

        <SidebarContent />
      </aside>

      {mobileOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)} />
          <aside className="fixed inset-y-0 left-0 z-50 w-72 bg-sidebar border-r border-sidebar-border flex flex-col shadow-2xl lg:hidden">
            <div className="flex items-center justify-between px-4 h-14 border-b border-sidebar-border shrink-0">
              <div className="flex items-center gap-2.5">
                <img
                  src="/stoker-icon.png"
                  alt="Stoker"
                  className="w-7 h-7 object-contain select-none"
                  draggable={false}
                />
                <span className="font-bold text-sidebar-foreground text-sm">Stoker</span>
              </div>
              <button
                onClick={() => setMobileOpen(false)}
                className="p-1.5 rounded-lg text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <SidebarContent isMobile />
          </aside>
        </>
      )}

      <div className="flex-1 flex flex-col overflow-hidden">

        <header className="flex items-center gap-3 px-4 lg:px-5 h-14 border-b border-border/40 bg-card shrink-0">
          <button
            onClick={() => setMobileOpen(true)}
            className="lg:hidden p-2 -ml-1 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            data-testid="btn-mobile-menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="flex-1 min-w-0">
            {activeGroupData ? (
              <>
                <p className="text-sm font-semibold text-foreground leading-tight">{activeGroupData.label}</p>
                <p className="text-[11px] text-muted-foreground">{activeGroupData.items.length} módulos</p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-foreground leading-tight">{userName.split(" ")[0]}</p>
                <p className="text-[11px] text-muted-foreground">{roleLabel}{companyName ? ` · ${companyName}` : ""}</p>
              </>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          {activeGroupData ? (
            <div className="max-w-5xl mx-auto px-4 lg:px-6 py-6 animate-fade-in">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
                {activeGroupData.items.map(item => (
                  <ModuleCard key={item.href} item={item} />
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-5 animate-fade-in select-none px-6">
              <div className={cn(
                "relative w-[100px] h-[100px] rounded-[24px] flex items-center justify-center shadow-xl",
                theme === "dark"
                  ? "bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-white/5 shadow-[0_0_32px_rgba(59,130,246,0.15)]"
                  : "bg-gradient-to-br from-white to-slate-50 border border-slate-200/80"
              )}>
                <img
                  src="/stoker-icon.png"
                  alt="Stoker WMS"
                  className="w-[64px] h-[64px] object-contain"
                  draggable={false}
                />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-semibold text-foreground/60">Bem-vindo ao Stoker</p>
                <p className="text-xs text-muted-foreground/40">
                  Selecione um módulo no menu lateral para começar
                </p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
