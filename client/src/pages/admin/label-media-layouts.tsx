import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Plus, Trash2, Pencil, Grid as GridIcon, Printer,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import {
  type PrintMediaLayout, type LabelTemplate, type MediaLayoutCell,
} from "@shared/schema";

interface LayoutForm {
  name: string;
  description: string;
  mediaWidthMm: number;
  mediaHeightMm: number;
  rows: number;
  cols: number;
  cellWidthMm: number;
  cellHeightMm: number;
  marginMm: number;
  gapXMm: number;
  gapYMm: number;
  cells: MediaLayoutCell[];
}

const EMPTY_FORM: LayoutForm = {
  name: "", description: "",
  mediaWidthMm: 100, mediaHeightMm: 150,
  rows: 3, cols: 1,
  cellWidthMm: 100, cellHeightMm: 50,
  marginMm: 0, gapXMm: 0, gapYMm: 0,
  cells: [],
};

function GridPreview({ form }: { form: LayoutForm }) {
  // Render scaled SVG-ish via div. Use a max width.
  const maxW = 360;
  const scale = maxW / form.mediaWidthMm;
  const w = form.mediaWidthMm * scale;
  const h = form.mediaHeightMm * scale;
  return (
    <div
      className="relative bg-white border-2 border-slate-300 dark:border-slate-700 mx-auto"
      style={{ width: w, height: h }}
      data-testid="grid-preview"
    >
      {Array.from({ length: form.rows }).map((_, r) =>
        Array.from({ length: form.cols }).map((__, c) => {
          const x = (form.marginMm + c * (form.cellWidthMm + form.gapXMm)) * scale;
          const y = (form.marginMm + r * (form.cellHeightMm + form.gapYMm)) * scale;
          const cw = form.cellWidthMm * scale;
          const ch = form.cellHeightMm * scale;
          const cell = form.cells.find(cc => cc.row === r && cc.col === c);
          return (
            <div
              key={`${r}-${c}`}
              className={`absolute border ${cell?.templateId ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30" : "border-dashed border-slate-400 dark:border-slate-600 bg-slate-50/40"}`}
              style={{ left: x, top: y, width: cw, height: ch }}
            >
              <span className="absolute top-0 left-0 text-[9px] px-1 py-0 text-slate-500">
                {r + 1}·{c + 1}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}

function LayoutEditor({
  layout, onClose,
}: { layout: PrintMediaLayout | "new" | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<LayoutForm>(() => {
    if (layout && layout !== "new") {
      return {
        name: layout.name,
        description: layout.description ?? "",
        mediaWidthMm: layout.mediaWidthMm,
        mediaHeightMm: layout.mediaHeightMm,
        rows: layout.rows,
        cols: layout.cols,
        cellWidthMm: layout.cellWidthMm,
        cellHeightMm: layout.cellHeightMm,
        marginMm: layout.marginMm,
        gapXMm: layout.gapXMm,
        gapYMm: layout.gapYMm,
        cells: (layout.layoutJson as any)?.cells ?? [],
      };
    }
    return EMPTY_FORM;
  });

  const { data: templates = [] } = useQuery<LabelTemplate[]>({
    queryKey: ["/api/labels/templates"],
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name,
        description: form.description || null,
        mediaWidthMm: form.mediaWidthMm,
        mediaHeightMm: form.mediaHeightMm,
        rows: form.rows,
        cols: form.cols,
        cellWidthMm: form.cellWidthMm,
        cellHeightMm: form.cellHeightMm,
        marginMm: form.marginMm,
        gapXMm: form.gapXMm,
        gapYMm: form.gapYMm,
        layoutJson: { cells: form.cells },
      };
      if (layout && layout !== "new") {
        const res = await apiRequest("PUT", `/api/labels/media-layouts/${layout.id}`, body);
        return res.json();
      }
      const res = await apiRequest("POST", "/api/labels/media-layouts", body);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/labels/media-layouts"] });
      toast({ title: "Layout salvo" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" }),
  });

  function setCellTemplate(row: number, col: number, templateId: string | null) {
    setForm(f => {
      const others = f.cells.filter(c => !(c.row === row && c.col === col));
      if (templateId) others.push({ row, col, templateId });
      return { ...f, cells: others };
    });
  }

  const cellGrid = useMemo(() => {
    const out: MediaLayoutCell[] = [];
    for (let r = 0; r < form.rows; r++)
      for (let c = 0; c < form.cols; c++)
        out.push(form.cells.find(cc => cc.row === r && cc.col === c) ?? { row: r, col: c, templateId: null });
    return out;
  }, [form.rows, form.cols, form.cells]);

  return (
    <Dialog open={layout !== null} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{layout === "new" ? "Novo layout de mídia" : "Editar layout de mídia"}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div>
              <Label>Nome</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} data-testid="input-layout-name" />
            </div>
            <div>
              <Label>Descrição</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Mídia largura (mm)</Label>
                <Input type="number" value={form.mediaWidthMm} onChange={e => setForm(f => ({ ...f, mediaWidthMm: parseInt(e.target.value) || 0 }))} />
              </div>
              <div>
                <Label className="text-xs">Mídia altura (mm)</Label>
                <Input type="number" value={form.mediaHeightMm} onChange={e => setForm(f => ({ ...f, mediaHeightMm: parseInt(e.target.value) || 0 }))} />
              </div>
              <div>
                <Label className="text-xs">Linhas</Label>
                <Input type="number" min={1} value={form.rows} onChange={e => setForm(f => ({ ...f, rows: parseInt(e.target.value) || 1 }))} />
              </div>
              <div>
                <Label className="text-xs">Colunas</Label>
                <Input type="number" min={1} value={form.cols} onChange={e => setForm(f => ({ ...f, cols: parseInt(e.target.value) || 1 }))} />
              </div>
              <div>
                <Label className="text-xs">Célula largura (mm)</Label>
                <Input type="number" value={form.cellWidthMm} onChange={e => setForm(f => ({ ...f, cellWidthMm: parseInt(e.target.value) || 0 }))} />
              </div>
              <div>
                <Label className="text-xs">Célula altura (mm)</Label>
                <Input type="number" value={form.cellHeightMm} onChange={e => setForm(f => ({ ...f, cellHeightMm: parseInt(e.target.value) || 0 }))} />
              </div>
              <div>
                <Label className="text-xs">Margem (mm)</Label>
                <Input type="number" value={form.marginMm} onChange={e => setForm(f => ({ ...f, marginMm: parseInt(e.target.value) || 0 }))} />
              </div>
              <div className="grid grid-cols-2 gap-1">
                <div>
                  <Label className="text-xs">Gap X</Label>
                  <Input type="number" value={form.gapXMm} onChange={e => setForm(f => ({ ...f, gapXMm: parseInt(e.target.value) || 0 }))} />
                </div>
                <div>
                  <Label className="text-xs">Gap Y</Label>
                  <Input type="number" value={form.gapYMm} onChange={e => setForm(f => ({ ...f, gapYMm: parseInt(e.target.value) || 0 }))} />
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <Label>Pré-visualização</Label>
            <GridPreview form={form} />
            <p className="text-xs text-muted-foreground">
              {form.rows * form.cols} célula(s) por mídia
            </p>

            <div className="border-t pt-2">
              <Label className="text-xs mb-1 block">Modelo padrão por célula (opcional)</Label>
              <div className="space-y-1 max-h-[200px] overflow-y-auto">
                {cellGrid.map(c => (
                  <div key={`${c.row}-${c.col}`} className="flex items-center gap-2">
                    <span className="text-xs w-12 shrink-0">L{c.row + 1}·C{c.col + 1}</span>
                    <Select
                      value={c.templateId ?? "none"}
                      onValueChange={v => setCellTemplate(c.row, c.col, v === "none" ? null : v)}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Sem modelo" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Sem modelo (definir na impressão)</SelectItem>
                        {templates.filter(t => t.active).map(t => (
                          <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={!form.name || saveMutation.isPending} data-testid="btn-save-layout">
            {saveMutation.isPending ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function LabelMediaLayoutsPage() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState<PrintMediaLayout | "new" | null>(null);
  const [deleting, setDeleting] = useState<PrintMediaLayout | null>(null);

  const { data: layouts = [], isLoading } = useQuery<PrintMediaLayout[]>({
    queryKey: ["/api/labels/media-layouts"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/labels/media-layouts/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/labels/media-layouts"] });
      setDeleting(null);
      toast({ title: "Layout apagado" });
    },
    onError: () => toast({ title: "Erro ao apagar", variant: "destructive" }),
  });

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border bg-card">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/admin/label-templates")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-base font-semibold flex items-center gap-2">
            <GridIcon className="h-4 w-4 text-primary" />
            Layouts de mídia
          </h1>
          <p className="text-xs text-muted-foreground">Divida uma mídia maior em várias áreas para aproveitar a impressão.</p>
        </div>
        <Button size="sm" onClick={() => setEditing("new")} data-testid="btn-new-layout">
          <Plus className="h-4 w-4 mr-1.5" />
          Novo layout
        </Button>
      </div>

      <main className="max-w-5xl mx-auto px-4 py-4">
        {isLoading ? (
          <div className="text-center text-muted-foreground py-12 text-sm">Carregando...</div>
        ) : layouts.length === 0 ? (
          <Card>
            <CardContent className="py-12 flex flex-col items-center gap-3 text-muted-foreground">
              <GridIcon className="h-10 w-10 opacity-30" />
              <p className="text-sm text-center">Nenhum layout cadastrado.<br />Crie um para aproveitar a impressão de mídias maiores.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {layouts.map(l => (
              <Card key={l.id} data-testid={`card-layout-${l.id}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{l.name}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    {l.mediaWidthMm}×{l.mediaHeightMm}mm · {l.rows}×{l.cols} células de {l.cellWidthMm}×{l.cellHeightMm}mm
                  </p>
                  {l.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{l.description}</p>
                  )}
                  <div className="flex gap-1 pt-2">
                    <Button size="sm" variant="outline" className="flex-1 h-8" onClick={() => setEditing(l)} data-testid={`btn-edit-layout-${l.id}`}>
                      <Pencil className="h-3.5 w-3.5 mr-1" />Editar
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive" onClick={() => setDeleting(l)} data-testid={`btn-delete-layout-${l.id}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      {editing !== null && (
        <LayoutEditor layout={editing} onClose={() => setEditing(null)} />
      )}

      <Dialog open={!!deleting} onOpenChange={v => !v && setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Apagar layout?</DialogTitle></DialogHeader>
          <p className="text-sm">Tem certeza que deseja apagar <strong>{deleting?.name}</strong>?</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => deleting && deleteMutation.mutate(deleting.id)}>Apagar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
