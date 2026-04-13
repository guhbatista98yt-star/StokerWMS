import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSessionQueryKey } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, ShieldCheck, Save, Loader2 } from "lucide-react";
import { Link } from "wouter";

interface UserPermission {
  id: string;
  username: string;
  name: string;
  role: string;
  allowedModules: string[] | null;
  allowedReports: string[] | null;
}

const ALL_MODULES = [
  { id: "/wms/recebimento", label: "Recebimento", section: "Operação" },
  { id: "/wms/checkin", label: "Endereçamento", section: "Operação" },
  { id: "/wms/transferencia", label: "Transferência", section: "Operação" },
  { id: "/wms/retirada", label: "Retirada de Produto", section: "Operação" },
  { id: "/wms/adicao", label: "Adição em Pallet", section: "Operação" },
  { id: "/wms/contagem", label: "Contagem", section: "Operação" },
  { id: "/wms/enderecos", label: "Endereços", section: "Operação" },
  { id: "/wms/produtos", label: "Buscar Produtos", section: "Operação" },
  { id: "/wms/codigos-barras", label: "Vínculo Rápido (Barcodes)", section: "Operação" },
  { id: "/fila-pedidos", label: "Fila de Pedidos", section: "Logística" },
  { id: "/separacao", label: "Separação", section: "Logística" },
  { id: "/conferencia", label: "Conferência", section: "Logística" },
  { id: "/balcao", label: "Balcão", section: "Logística" },
  { id: "/supervisor/orders", label: "Pedidos", section: "Logística" },
  { id: "/supervisor/routes", label: "Rotas", section: "Logística" },
  { id: "/supervisor/route-orders", label: "Expedição", section: "Logística" },
  { id: "/supervisor/exceptions", label: "Exceções", section: "Logística" },
  { id: "/supervisor/users", label: "Usuários", section: "Administração" },
  { id: "/supervisor/mapping-studio", label: "Mapping Studio", section: "Administração" },
  { id: "/supervisor/codigos-barras", label: "Gestão Barcodes", section: "Administração" },
  { id: "/supervisor/separation-settings", label: "Modo Separação", section: "Administração" },
  { id: "/supervisor/print-settings", label: "Impressoras", section: "Administração" },
  { id: "/supervisor/reports", label: "Relatórios", section: "Administração" },
  { id: "/supervisor/audit", label: "Auditoria", section: "Administração" },
  { id: "/admin/permissoes", label: "Permissões de Acesso", section: "Administração" },
  { id: "/admin/kpi-operadores", label: "KPIs", section: "Administração" },
  { id: "/admin/limpeza", label: "Limpeza de Dados", section: "Administração" },
];

const SECTIONS = ["Operação", "Logística", "Administração"];

const ALL_REPORTS = [
  { id: "picking-list", label: "Romaneio de Separação" },
  { id: "badge-generation", label: "Cartões de Acesso" },
  { id: "loading-map", label: "Mapa de Carregamento" },
  { id: "loading-map-products", label: "Mapa de Carregamento (Produto)" },
  { id: "order-volumes", label: "Etiquetas de Volume" },
  { id: "counting-cycles", label: "Ciclos de Contagem" },
  { id: "wms-addresses", label: "Endereços WMS" },
  { id: "pallet-movements", label: "Movimentações de Pallets" },
];

const roleLabels: Record<string, string> = {
  administrador: "Administrador",
  supervisor: "Supervisor",
  separacao: "Separador",
  conferencia: "Conferente",
  balcao: "Balcão",
  fila_pedidos: "Fila de Pedidos",
  recebedor: "Recebedor",
  empilhador: "Empilhador",
  conferente_wms: "Conferente WMS",
};

export default function PermissoesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const usersQueryKey = useSessionQueryKey(["/api/admin/permissions"]);

  const [editingUser, setEditingUser] = useState<UserPermission | null>(null);
  const [selectedModules, setSelectedModules] = useState<string[]>([]);
  const [selectedReports, setSelectedReports] = useState<string[]>([]);

  const { data: users, isLoading } = useQuery<UserPermission[]>({
    queryKey: usersQueryKey,
  });

  const saveMutation = useMutation({
    mutationFn: async ({ userId, modules, reports }: { userId: string; modules: string[] | null; reports?: string[] | null }) => {
      const res = await apiRequest("PUT", `/api/admin/permissions/${userId}`, { allowedModules: modules, allowedReports: reports });
      if (!res.ok) throw new Error("Falha ao salvar permissões");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: usersQueryKey });
      setEditingUser(null);
      toast({ title: "Permissões salvas", description: "As permissões do usuário foram atualizadas." });
    },
    onError: () => {
      toast({ title: "Erro", description: "Não foi possível salvar as permissões.", variant: "destructive" });
    },
  });

  const openEditor = (user: UserPermission) => {
    setEditingUser(user);
    setSelectedModules(user.allowedModules || []);
    setSelectedReports(user.allowedReports || []);
  };

  const toggleModule = (moduleId: string) => {
    setSelectedModules((prev) =>
      prev.includes(moduleId) ? prev.filter((m) => m !== moduleId) : [...prev, moduleId]
    );
  };

  const toggleSection = (section: string) => {
    const sectionModuleIds = ALL_MODULES.filter((m) => m.section === section).map((m) => m.id);
    const allSelected = sectionModuleIds.every((id) => selectedModules.includes(id));
    if (allSelected) {
      setSelectedModules((prev) => prev.filter((id) => !sectionModuleIds.includes(id)));
    } else {
      setSelectedModules((prev) => [...new Set([...prev, ...sectionModuleIds])]);
    }
  };

  const toggleReport = (reportId: string) => {
    setSelectedReports((prev) =>
      prev.includes(reportId) ? prev.filter((r) => r !== reportId) : [...prev, reportId]
    );
  };

  const selectAll = () => {
    setSelectedModules(ALL_MODULES.map((m) => m.id));
    setSelectedReports(ALL_REPORTS.map((r) => r.id));
  };

  const clearAll = () => {
    setSelectedModules([]);
    setSelectedReports([]);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-back-home">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-base font-semibold text-foreground leading-tight">Permissões de Acesso</h1>
            <p className="text-xs text-muted-foreground">Definir módulos visíveis por usuário</p>
          </div>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 py-6">
        <div className="rounded-2xl border border-border/60 bg-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border/40 flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold">Usuários e Permissões</h2>
          </div>

          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="hidden sm:table-cell">Usuário</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Cargo</TableHead>
                    <TableHead className="hidden md:table-cell">Módulos</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users?.map((u) => (
                    <TableRow key={u.id} data-testid={`row-user-${u.id}`}>
                      <TableCell className="font-mono text-sm hidden sm:table-cell">{u.username}</TableCell>
                      <TableCell>
                        <div className="min-w-0">
                          <span className="block">{u.name}</span>
                          <span className="text-xs text-muted-foreground font-mono sm:hidden">{u.username}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary">
                          {roleLabels[u.role] || u.role}
                        </span>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {u.allowedModules ? (
                          <span className="text-sm text-muted-foreground">
                            {u.allowedModules.length} módulo{u.allowedModules.length !== 1 ? "s" : ""}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground italic">Padrão do cargo</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => openEditor(u)} data-testid={`button-edit-permissions-${u.id}`}>
                          Editar
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </main>

      <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Permissões — {editingUser?.name}
            </DialogTitle>
            <DialogDescription>
              Selecione os módulos que este usuário pode acessar.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1 mb-4">
            <p className="text-sm text-muted-foreground">
              Cargo: <span className="font-medium text-foreground">{editingUser?.role ? roleLabels[editingUser.role] || editingUser.role : ""}</span>
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={selectAll} data-testid="button-select-all">
                Marcar todos
              </Button>
              <Button variant="outline" size="sm" onClick={clearAll} data-testid="button-clear-all">
                Desmarcar todos
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            {SECTIONS.map((section) => {
              const sectionModules = ALL_MODULES.filter((m) => m.section === section);
              const allSelected = sectionModules.every((m) => selectedModules.includes(m.id));
              const someSelected = sectionModules.some((m) => selectedModules.includes(m.id));

              return (
                <div key={section} className="border rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Checkbox
                      checked={allSelected}
                      ref={undefined}
                      onCheckedChange={() => toggleSection(section)}
                      data-testid={`checkbox-section-${section.toLowerCase()}`}
                    />
                    <span className="font-semibold text-sm">{section}</span>
                    {someSelected && !allSelected && (
                      <span className="text-xs text-muted-foreground">(parcial)</span>
                    )}
                  </div>
                  <div className="space-y-1.5 ml-6">
                    {sectionModules.map((mod) => (
                      <label key={mod.id} className="flex items-center gap-2 cursor-pointer">
                        <Checkbox
                          checked={selectedModules.includes(mod.id)}
                          onCheckedChange={() => toggleModule(mod.id)}
                          data-testid={`checkbox-module-${mod.id.replace(/\//g, "-")}`}
                        />
                        <span className="text-sm">{mod.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="border rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <Checkbox
                checked={ALL_REPORTS.every((r) => selectedReports.includes(r.id))}
                ref={undefined}
                onCheckedChange={() => {
                  const allSelected = ALL_REPORTS.every((r) => selectedReports.includes(r.id));
                  setSelectedReports(allSelected ? [] : ALL_REPORTS.map((r) => r.id));
                }}
                data-testid="checkbox-section-reports"
              />
              <span className="font-semibold text-sm">Relatórios</span>
              {selectedReports.length > 0 && selectedReports.length < ALL_REPORTS.length && (
                <span className="text-xs text-muted-foreground">(parcial)</span>
              )}
            </div>
            <div className="space-y-1.5 ml-6">
              {ALL_REPORTS.map((rep) => (
                <label key={rep.id} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={selectedReports.includes(rep.id)}
                    onCheckedChange={() => toggleReport(rep.id)}
                    data-testid={`checkbox-report-${rep.id}`}
                  />
                  <span className="text-sm">{rep.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-between gap-2 pt-4 border-t">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => editingUser && saveMutation.mutate({ userId: editingUser.id, modules: null, reports: null })}
              disabled={saveMutation.isPending}
              data-testid="button-reset-permissions"
            >
              Resetar para padrão do cargo
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditingUser(null)} data-testid="button-cancel-permissions">
                Cancelar
              </Button>
              <Button
                onClick={() => editingUser && saveMutation.mutate({ userId: editingUser.id, modules: selectedModules, reports: selectedReports })}
                disabled={saveMutation.isPending}
                data-testid="button-save-permissions"
              >
                {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Salvar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
