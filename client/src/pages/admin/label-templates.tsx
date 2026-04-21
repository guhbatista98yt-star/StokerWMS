import { useState, useMemo, useEffect, useRef } from "react";
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
  ArrowLeft, Plus, MoreVertical, Pencil, Copy, Trash2, Star,
  ToggleLeft, ToggleRight, Tag, Layers, Search, Eye, ZoomIn, ZoomOut, Maximize2,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { renderLabelToHtml } from "@/lib/label-renderer";
import {
  type LabelTemplate, type LabelContext, type LabelLayout, labelContextEnum, LABEL_CONTEXT_LABELS, LABEL_DATA_FIELDS,
} from "@shared/schema";

function ContextBadge({ context }: { context: LabelContext }) {
  const colors: Record<LabelContext, string> = {
    volume_label:  "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    pallet_label:  "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    product_label: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    order_label:   "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
    address_label: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colors[context]}`}>
      {LABEL_CONTEXT_LABELS[context]}
    </span>
  );
}

const MM_TO_PX_PREVIEW = 3.7795275591;

function PreviewModal({ template, onClose }: { template: LabelTemplate | null; onClose: () => void }) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // zoom em fração (1 = 100% do canvas técnico). null = "ajustar à janela" (auto).
  const [zoom, setZoom] = useState<number | null>(null);
  const [fitScale, setFitScale] = useState(1);
  const stageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!template) { setHtml(null); return; }
    let cancelled = false;
    setLoading(true);
    setZoom(null); // sempre reabre em "ajustar à janela"
    const ctx = template.context as LabelContext;
    const sample: Record<string, string> = Object.fromEntries(
      (LABEL_DATA_FIELDS[ctx] ?? []).map(f => [f.key, f.example ?? f.label])
    );
    renderLabelToHtml(template, sample)
      .then(h => { if (!cancelled) { setHtml(h); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [template]);

  // Calcula a escala para caber inteira na área do palco (com margem confortável).
  useEffect(() => {
    if (!template) return;
    const PADDING = 32; // margem visual confortável (px)
    function compute() {
      const el = stageRef.current;
      if (!el || !template) return;
      const w = el.clientWidth - PADDING * 2;
      const h = el.clientHeight - PADDING * 2;
      const labelW = template.widthMm * MM_TO_PX_PREVIEW;
      const labelH = template.heightMm * MM_TO_PX_PREVIEW;
      if (w <= 0 || h <= 0) return;
      const s = Math.min(w / labelW, h / labelH, 1.5);
      setFitScale(Math.max(0.05, s));
    }
    compute();
    const ro = new ResizeObserver(compute);
    if (stageRef.current) ro.observe(stageRef.current);
    window.addEventListener("resize", compute);
    return () => { ro.disconnect(); window.removeEventListener("resize", compute); };
  }, [template, html]);

  if (!template) return null;
  const updated = template.updatedAt || template.createdAt;
  const isFit = zoom === null;
  const effectiveScale = isFit ? fitScale : zoom!;
  const labelW = template.widthMm * MM_TO_PX_PREVIEW;
  const labelH = template.heightMm * MM_TO_PX_PREVIEW;
  // Quando o usuário aumenta além do que cabe, permitimos rolagem; caso contrário, sem scroll.
  const overflowsX = effectiveScale * labelW > (stageRef.current?.clientWidth ?? Infinity) - 8;
  const overflowsY = effectiveScale * labelH > (stageRef.current?.clientHeight ?? Infinity) - 8;
  const allowPan = !isFit && (overflowsX || overflowsY);

  return (
    <Dialog open={!!template} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl p-0 gap-0 overflow-hidden flex flex-col h-[80vh]">
        <DialogHeader className="px-4 pt-4 pb-2 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-4 w-4" />
            {template.name}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground border-b border-border px-4 pb-2 shrink-0">
          <ContextBadge context={template.context as LabelContext} />
          {template.groupName && <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">{template.groupName}</span>}
          <span>·</span>
          <span>{template.widthMm}mm × {template.heightMm}mm</span>
          <span>·</span>
          <span>{template.dpi} DPI</span>
          <span>·</span>
          <span>{(template.layoutJson as LabelLayout)?.components?.length ?? 0} componente(s)</span>
          <div className="flex-1" />
          <span>Atualizado: {new Date(updated).toLocaleString("pt-BR")}</span>
        </div>

        {/* Barra de zoom */}
        <div className="flex items-center gap-1.5 justify-end px-4 py-2 border-b border-border shrink-0">
          <Button
            variant={isFit ? "secondary" : "outline"}
            size="sm" className="h-7 px-2 text-xs"
            onClick={() => setZoom(null)}
            data-testid="btn-preview-fit"
            title="Ajustar à janela — etiqueta inteira visível"
          >
            <Maximize2 className="h-3.5 w-3.5 mr-1" />Ajustar
          </Button>
          <Button
            variant={zoom === 1 ? "secondary" : "outline"}
            size="sm" className="h-7 px-2 text-xs"
            onClick={() => setZoom(1)}
            data-testid="btn-preview-100"
            title="100% — escala técnica (96 DPI no navegador)"
          >
            100%
          </Button>
          <div className="w-px h-5 bg-border mx-1" />
          <Button
            variant="outline" size="sm" className="h-7 w-7 p-0"
            onClick={() => setZoom(z => Math.max(0.1, (z ?? fitScale) - 0.1))}
            data-testid="btn-preview-zoom-out"
            title="Diminuir zoom"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <span className="text-xs text-muted-foreground w-12 text-center tabular-nums" data-testid="text-preview-zoom">
            {Math.round(effectiveScale * 100)}%
          </span>
          <Button
            variant="outline" size="sm" className="h-7 w-7 p-0"
            onClick={() => setZoom(z => Math.min(5, (z ?? fitScale) + 0.1))}
            data-testid="btn-preview-zoom-in"
            title="Aumentar zoom"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Palco / canvas */}
        <div
          ref={stageRef}
          className={`flex-1 min-h-0 bg-muted/30 ${allowPan ? "overflow-auto" : "overflow-hidden"} flex items-center justify-center`}
          data-testid="preview-stage"
        >
          {loading ? (
            <p className="text-sm text-muted-foreground py-8">Renderizando...</p>
          ) : html ? (
            <div
              style={{
                width: labelW * effectiveScale,
                height: labelH * effectiveScale,
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: labelW,
                  height: labelH,
                  transform: `scale(${effectiveScale})`,
                  transformOrigin: "top left",
                  boxShadow: "0 1px 6px rgba(0,0,0,0.18)",
                  background: "white",
                  border: "1px solid hsl(var(--border))",
                }}
              >
                <iframe
                  srcDoc={html}
                  style={{ border: 0, background: "white", width: labelW, height: labelH, display: "block" }}
                  title="Visualização"
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-8">Sem componentes</p>
          )}
        </div>

        <DialogFooter className="px-4 py-2 border-t border-border shrink-0">
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function LabelTemplatesPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterContext, setFilterContext] = useState<LabelContext | "all">("all");
  const [filterGroup, setFilterGroup] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"name" | "updated" | "created">("updated");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState<LabelTemplate | null>(null);
  const [showPreview, setShowPreview] = useState<LabelTemplate | null>(null);
  const [showDuplicateDialog, setShowDuplicateDialog] = useState<LabelTemplate | null>(null);
  const [newName, setNewName] = useState("");
  const [newContext, setNewContext] = useState<LabelContext>("volume_label");
  const [newGroup, setNewGroup] = useState("");
  const [newWidth, setNewWidth] = useState(100);
  const [newHeight, setNewHeight] = useState(70);
  const [dupName, setDupName] = useState("");

  const { data: templates = [], isLoading } = useQuery<LabelTemplate[]>({
    queryKey: ["/api/labels/templates"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; context: LabelContext; groupName?: string; widthMm: number; heightMm: number }) => {
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
      setNewName(""); setNewGroup("");
      toast({ title: "Modelo criado", description: created.name });
      navigate(`/admin/label-studio/${created.id}`);
    },
    onError: () => toast({ title: "Erro ao criar modelo", variant: "destructive" }),
  });

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

  const { data: defaults = {} } = useQuery<Record<string, string | null>>({
    queryKey: ["/api/labels/defaults"],
  });

  const setDefaultMutation = useMutation({
    mutationFn: async ({ context, templateId }: { context: LabelContext; templateId: string }) => {
      const res = await apiRequest("PUT", `/api/labels/defaults/${context}`, { templateId });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/labels/defaults"] });
      toast({ title: "Modelo definido como padrão" });
    },
    onError: () => toast({ title: "Erro ao definir padrão", variant: "destructive" }),
  });

  const allGroups = useMemo(() => {
    const set = new Set<string>();
    templates.forEach(t => { if (t.groupName) set.add(t.groupName); });
    return Array.from(set).sort();
  }, [templates]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates
      .filter(t => filterContext === "all" || t.context === filterContext)
      .filter(t => filterGroup === "all" || (t.groupName ?? "") === filterGroup)
      .filter(t => !q || t.name.toLowerCase().includes(q) || (t.groupName ?? "").toLowerCase().includes(q))
      .sort((a, b) => {
        if (sortBy === "name") return a.name.localeCompare(b.name);
        if (sortBy === "created") return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
        return (b.updatedAt ?? b.createdAt ?? "").localeCompare(a.updatedAt ?? a.createdAt ?? "");
      });
  }, [templates, filterContext, filterGroup, search, sortBy]);

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
        <Button size="sm" onClick={() => setShowCreateDialog(true)} data-testid="btn-create-template">
          <Plus className="h-4 w-4 mr-1.5" />
          Novo Modelo
        </Button>
      </div>

      <main className="max-w-5xl mx-auto px-4 py-4 space-y-4">
        {/* Barra de pesquisa e filtros */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Buscar por título ou grupo..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-9"
              data-testid="input-search-templates"
            />
          </div>
          {allGroups.length > 0 && (
            <Select value={filterGroup} onValueChange={setFilterGroup}>
              <SelectTrigger className="w-[160px] h-9 text-xs" data-testid="select-filter-group">
                <SelectValue placeholder="Grupo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os grupos</SelectItem>
                {allGroups.map(g => (<SelectItem key={g} value={g}>{g}</SelectItem>))}
              </SelectContent>
            </Select>
          )}
          <Select value={sortBy} onValueChange={v => setSortBy(v as typeof sortBy)}>
            <SelectTrigger className="w-[140px] h-9 text-xs" data-testid="select-sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="updated">Última atualização</SelectItem>
              <SelectItem value="created">Mais recentes</SelectItem>
              <SelectItem value="name">Nome (A-Z)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant={filterContext === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterContext("all")}
            data-testid="filter-all"
          >
            Todos os tipos
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
                        {t.groupName && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                            {t.groupName}
                          </span>
                        )}
                        {t.companyId === null && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                            Sistema
                          </span>
                        )}
                        {defaults[t.context] === t.id && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                            <Star className="h-3 w-3 mr-1 fill-current" />Padrão
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
                            <DropdownMenuItem onClick={() => { setShowDuplicateDialog(t); setDupName(`${t.name} (cópia)`); }} data-testid={`menu-duplicate-${t.id}`}>
                              <Copy className="h-4 w-4 mr-2" />
                              Duplicar para editar
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setDefaultMutation.mutate({ context: t.context as LabelContext, templateId: t.id })}
                              disabled={defaults[t.context] === t.id}
                              data-testid={`menu-set-default-${t.id}`}
                            >
                              <Star className="h-4 w-4 mr-2" />
                              {defaults[t.context] === t.id ? "Já é o padrão" : "Definir como padrão"}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => setShowDeleteDialog(t)}
                              disabled={defaults[t.context] === t.id}
                              data-testid={`menu-delete-${t.id}`}
                              title={defaults[t.context] === t.id ? "Defina outro modelo como padrão antes de apagar" : undefined}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              {defaults[t.context] === t.id ? "Apagar (é o padrão)" : "Apagar"}
                            </DropdownMenuItem>
                          </>
                        ) : (
                          <>
                            <DropdownMenuItem asChild data-testid={`menu-edit-${t.id}`}>
                              <Link href={`/admin/label-studio/${t.id}`}>
                                <Pencil className="h-4 w-4 mr-2" />
                                Editar
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setShowDuplicateDialog(t); setDupName(`${t.name} (cópia)`); }} data-testid={`menu-duplicate-${t.id}`}>
                              <Copy className="h-4 w-4 mr-2" />
                              Duplicar
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setDefaultMutation.mutate({ context: t.context as LabelContext, templateId: t.id })}
                              disabled={defaults[t.context] === t.id}
                              data-testid={`menu-set-default-${t.id}`}
                            >
                              <Star className="h-4 w-4 mr-2" />
                              {defaults[t.context] === t.id ? "Já é o padrão" : "Definir como padrão"}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => toggleMutation.mutate({ id: t.id, active: !t.active })} data-testid={`menu-toggle-${t.id}`}>
                              {t.active ? (<><ToggleLeft className="h-4 w-4 mr-2" />Desativar</>) : (<><ToggleRight className="h-4 w-4 mr-2" />Ativar</>)}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive" onClick={() => setShowDeleteDialog(t)} data-testid={`menu-delete-${t.id}`}>
                              <Trash2 className="h-4 w-4 mr-2" />
                              Apagar
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
                  {t.companyId === null ? (
                    <Button size="sm" variant="outline" className="w-full mt-3 h-8" onClick={() => setShowPreview(t)} data-testid={`btn-view-template-${t.id}`}>
                      <Eye className="h-3.5 w-3.5 mr-1.5" />
                      Visualizar
                    </Button>
                  ) : (
                    <Link href={`/admin/label-studio/${t.id}`}>
                      <Button size="sm" variant="outline" className="w-full mt-3 h-8" data-testid={`btn-edit-template-${t.id}`}>
                        <Pencil className="h-3.5 w-3.5 mr-1.5" />
                        Abrir Studio
                      </Button>
                    </Link>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      <PreviewModal template={showPreview} onClose={() => setShowPreview(null)} />

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Novo Modelo de Etiqueta</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Título *</Label>
              <Input placeholder="Ex: Etiqueta de Volume Padrão" value={newName} onChange={e => setNewName(e.target.value)} data-testid="input-template-name" />
            </div>
            <div>
              <Label>Grupo (opcional)</Label>
              <Input placeholder="Ex: Expedição, Interno..." value={newGroup} onChange={e => setNewGroup(e.target.value)} list="group-suggestions" data-testid="input-template-group" />
              {allGroups.length > 0 && (
                <datalist id="group-suggestions">
                  {allGroups.map(g => (<option key={g} value={g} />))}
                </datalist>
              )}
              <p className="text-[10px] text-muted-foreground mt-0.5">Apenas para organização — pode deixar vazio.</p>
            </div>
            <div>
              <Label>Origem dos dados</Label>
              <Select value={newContext} onValueChange={v => setNewContext(v as LabelContext)}>
                <SelectTrigger data-testid="select-template-context"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {labelContextEnum.map(ctx => (
                    <SelectItem key={ctx} value={ctx}>{LABEL_CONTEXT_LABELS[ctx]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-0.5">Define quais campos dinâmicos ficarão disponíveis.</p>
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
              onClick={() => createMutation.mutate({ name: newName.trim(), context: newContext, groupName: newGroup.trim() || undefined, widthMm: newWidth, heightMm: newHeight })}
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
