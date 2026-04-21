import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Plus, MoreVertical, Pencil, Copy, Trash2,
  ToggleLeft, ToggleRight, Tag, Layers, Upload,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import {
  type LabelTemplate, type LabelContext, type LabelLayout, labelContextEnum, LABEL_CONTEXT_LABELS,
} from "@shared/schema";

function ContextBadge({ context }: { context: LabelContext }) {
  const colors: Record<LabelContext, string> = {
    volume_label:  "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    pallet_label:  "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    product_label: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    order_label:   "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colors[context]}`}>
      {LABEL_CONTEXT_LABELS[context]}
    </span>
  );
}

export default function LabelTemplatesPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filterContext, setFilterContext] = useState<LabelContext | "all">("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState<LabelTemplate | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [showDuplicateDialog, setShowDuplicateDialog] = useState<LabelTemplate | null>(null);
  const [newName, setNewName] = useState("");
  const [newContext, setNewContext] = useState<LabelContext>("volume_label");
  const [newWidth, setNewWidth] = useState(100);
  const [newHeight, setNewHeight] = useState(70);
  const [dupName, setDupName] = useState("");

  const { data: templates = [], isLoading } = useQuery<LabelTemplate[]>({
    queryKey: ["/api/labels/templates"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; context: LabelContext; widthMm: number; heightMm: number }) => {
      const res = await apiRequest("POST", "/api/labels/templates", {
        ...data,
        active: true,
        layoutJson: { components: [] },
      });
      return res.json() as Promise<LabelTemplate>;
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["/api/labels/templates"] });
      setShowCreateDialog(false);
      toast({ title: "Modelo criado", description: created.name });
      navigate(`/admin/label-studio/${created.id}`);
    },
    onError: () => toast({ title: "Erro ao criar modelo", variant: "destructive" }),
  });

  const importMutation = useMutation({
    mutationFn: async (payload: unknown) => {
      const res = await apiRequest("POST", "/api/labels/templates/import", payload);
      return res.json() as Promise<LabelTemplate>;
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["/api/labels/templates"] });
      toast({ title: "Modelo importado", description: created.name });
      navigate(`/admin/label-studio/${created.id}`);
    },
    onError: () => toast({ title: "Erro ao importar modelo", variant: "destructive" }),
  });

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string);
        importMutation.mutate(json);
      } catch {
        toast({ title: "Arquivo inválido", description: "O arquivo não é um JSON válido.", variant: "destructive" });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const duplicateMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const res = await apiRequest("POST", `/api/labels/templates/${id}/duplicate`, { name });
      return res.json() as Promise<LabelTemplate>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/labels/templates"] });
      setShowDuplicateDialog(null);
      toast({ title: "Modelo duplicado com sucesso" });
    },
    onError: () => toast({ title: "Erro ao duplicar", variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const res = await apiRequest("PATCH", `/api/labels/templates/${id}/active`, { active });
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/labels/templates"] }),
    onError: () => toast({ title: "Erro ao atualizar status", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/labels/templates/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/labels/templates"] });
      setShowDeleteDialog(null);
      toast({ title: "Modelo excluído" });
    },
    onError: () => toast({ title: "Erro ao excluir", variant: "destructive" }),
  });

  const filtered = templates.filter(t => filterContext === "all" || t.context === filterContext);

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border bg-card shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold text-foreground leading-tight flex items-center gap-2">
            <Tag className="h-4 w-4 text-primary" />
            Etiquetas
          </h1>
          <p className="text-xs text-muted-foreground">Modelos de etiquetas para impressão</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => importInputRef.current?.click()}
          disabled={importMutation.isPending}
          data-testid="btn-import-template"
        >
          <Upload className="h-4 w-4 mr-1.5" />
          {importMutation.isPending ? "Importando..." : "Importar"}
        </Button>
        <input
          ref={importInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={handleImportFile}
          data-testid="input-import-file"
        />
        <Button size="sm" onClick={() => setShowCreateDialog(true)} data-testid="btn-create-template">
          <Plus className="h-4 w-4 mr-1.5" />
          Novo Modelo
        </Button>
      </div>

      <main className="max-w-4xl mx-auto px-4 py-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button
            variant={filterContext === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterContext("all")}
            data-testid="filter-all"
          >
            Todos
          </Button>
          {labelContextEnum.map(ctx => (
            <Button
              key={ctx}
              variant={filterContext === ctx ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterContext(ctx)}
              data-testid={`filter-${ctx}`}
            >
              {LABEL_CONTEXT_LABELS[ctx]}
            </Button>
          ))}
        </div>

        {isLoading ? (
          <div className="text-center text-muted-foreground py-12 text-sm">Carregando modelos...</div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 flex flex-col items-center gap-3 text-muted-foreground">
              <Layers className="h-10 w-10 opacity-30" />
              <p className="text-sm text-center">Nenhum modelo encontrado.<br />Clique em <strong>Novo Modelo</strong> para criar.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map(t => (
              <Card key={t.id} className={`transition-all ${!t.active ? "opacity-60" : ""}`} data-testid={`card-template-${t.id}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <CardTitle className="text-sm font-semibold truncate">{t.name}</CardTitle>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <ContextBadge context={t.context as LabelContext} />
                        {t.companyId === null && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                            Sistema
                          </span>
                        )}
                        {!t.active && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">
                            Inativo
                          </span>
                        )}
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" data-testid={`menu-template-${t.id}`}>
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {t.companyId === null ? (
                          <>
                            <DropdownMenuItem asChild>
                              <Link href={`/admin/label-studio/${t.id}`}>
                                <Pencil className="h-4 w-4 mr-2" />
                                Visualizar (somente leitura)
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setShowDuplicateDialog(t); setDupName(`${t.name} (cópia)`); }}>
                              <Copy className="h-4 w-4 mr-2" />
                              Duplicar para editar
                            </DropdownMenuItem>
                          </>
                        ) : (
                          <>
                            <DropdownMenuItem asChild>
                              <Link href={`/admin/label-studio/${t.id}`}>
                                <Pencil className="h-4 w-4 mr-2" />
                                Editar no Studio
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setShowDuplicateDialog(t); setDupName(`${t.name} (cópia)`); }}>
                              <Copy className="h-4 w-4 mr-2" />
                              Duplicar
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => toggleMutation.mutate({ id: t.id, active: !t.active })}>
                              {t.active ? (<><ToggleLeft className="h-4 w-4 mr-2" />Desativar</>) : (<><ToggleRight className="h-4 w-4 mr-2" />Ativar</>)}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive" onClick={() => setShowDeleteDialog(t)}>
                              <Trash2 className="h-4 w-4 mr-2" />
                              Excluir
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-xs text-muted-foreground">
                    {t.widthMm}mm × {t.heightMm}mm · {t.dpi} DPI
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {(t.layoutJson as LabelLayout)?.components?.length ?? 0} componente(s)
                  </p>
                  <Link href={`/admin/label-studio/${t.id}`}>
                    <Button size="sm" variant="outline" className="w-full mt-3 h-8" data-testid={`btn-edit-template-${t.id}`}>
                      <Pencil className="h-3.5 w-3.5 mr-1.5" />
                      Abrir Studio
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Novo Modelo de Etiqueta</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nome do modelo</Label>
              <Input placeholder="Ex: Etiqueta de Volume Padrão" value={newName} onChange={e => setNewName(e.target.value)} data-testid="input-template-name" />
            </div>
            <div>
              <Label>Tipo de etiqueta</Label>
              <Select value={newContext} onValueChange={v => setNewContext(v as LabelContext)}>
                <SelectTrigger data-testid="select-template-context"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {labelContextEnum.map(ctx => (
                    <SelectItem key={ctx} value={ctx}>{LABEL_CONTEXT_LABELS[ctx]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Largura (mm)</Label>
                <Input type="number" value={newWidth} onChange={e => setNewWidth(Number(e.target.value))} data-testid="input-template-width" />
              </div>
              <div>
                <Label>Altura (mm)</Label>
                <Input type="number" value={newHeight} onChange={e => setNewHeight(Number(e.target.value))} data-testid="input-template-height" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancelar</Button>
            <Button
              onClick={() => createMutation.mutate({ name: newName.trim(), context: newContext, widthMm: newWidth, heightMm: newHeight })}
              disabled={!newName.trim() || createMutation.isPending}
              data-testid="btn-confirm-create"
            >
              {createMutation.isPending ? "Criando..." : "Criar e Abrir Studio"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!showDuplicateDialog} onOpenChange={() => setShowDuplicateDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Duplicar Modelo</DialogTitle></DialogHeader>
          <div>
            <Label>Nome da cópia</Label>
            <Input value={dupName} onChange={e => setDupName(e.target.value)} data-testid="input-dup-name" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDuplicateDialog(null)}>Cancelar</Button>
            <Button
              onClick={() => { if (showDuplicateDialog) duplicateMutation.mutate({ id: showDuplicateDialog.id, name: dupName.trim() }); }}
              disabled={!dupName.trim() || duplicateMutation.isPending}
              data-testid="btn-confirm-duplicate"
            >
              {duplicateMutation.isPending ? "Duplicando..." : "Duplicar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!showDeleteDialog} onOpenChange={() => setShowDeleteDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Excluir Modelo</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Tem certeza que deseja excluir <strong>{showDeleteDialog?.name}</strong>? Esta ação não pode ser desfeita.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => showDeleteDialog && deleteMutation.mutate(showDeleteDialog.id)} disabled={deleteMutation.isPending} data-testid="btn-confirm-delete">
              {deleteMutation.isPending ? "Excluindo..." : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
