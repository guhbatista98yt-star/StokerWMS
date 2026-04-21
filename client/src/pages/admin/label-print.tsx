import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Printer, Search, Eye, Layers, RefreshCw,
} from "lucide-react";
import {
  type LabelTemplate, type LabelContext, type PrintMediaLayout,
  LABEL_CONTEXT_LABELS, LABEL_DATA_FIELDS, labelContextEnum,
} from "@shared/schema";
import {
  renderBatchToHtml, renderMediaCompositionToHtml, openPrintWindow,
  type PrintItem,
} from "@/lib/label-renderer";
import { useAuth } from "@/lib/auth";

interface DataRow { id: string; [k: string]: any }

export default function LabelPrintPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth() as any;

  const [context, setContext] = useState<LabelContext>("volume_label");
  const [templateId, setTemplateId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [copiesPerRecord, setCopiesPerRecord] = useState(1);
  const [mediaLayoutId, setMediaLayoutId] = useState<string>("none");
  const [printing, setPrinting] = useState(false);

  const { data: templates = [] } = useQuery<LabelTemplate[]>({
    queryKey: ["/api/labels/templates"],
  });
  const { data: mediaLayouts = [] } = useQuery<PrintMediaLayout[]>({
    queryKey: ["/api/labels/media-layouts"],
  });
  const { data: records = [], isFetching, refetch } = useQuery<DataRow[]>({
    queryKey: ["/api/labels/datasource", context, search],
    queryFn: async () => {
      const url = `/api/labels/datasource/${context}?q=${encodeURIComponent(search)}&limit=100`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const filteredTemplates = useMemo(
    () => templates.filter(t => t.context === context && t.active),
    [templates, context],
  );

  // Reset seleção/template quando muda contexto
  useEffect(() => {
    setSelectedIds(new Set());
    setTemplateId("");
  }, [context]);

  const template = filteredTemplates.find(t => t.id === templateId);
  const mediaLayout = mediaLayouts.find(m => m.id === mediaLayoutId);

  function enrichData(row: DataRow): Record<string, unknown> {
    const now = new Date();
    const date = now.toLocaleDateString("pt-BR");
    const time = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return {
      ...row,
      date, time,
      operator: user?.name ?? user?.username ?? "",
      sender: "Stoker WMS",
    };
  }

  function fillMissingFromExamples(data: Record<string, unknown>): Record<string, unknown> {
    const fields = LABEL_DATA_FIELDS[context] ?? [];
    const out = { ...data };
    for (const f of fields) {
      if (out[f.key] === undefined || out[f.key] === null || out[f.key] === "") {
        if (f.example) out[f.key] = f.example;
      }
    }
    return out;
  }

  async function handlePrint(previewOnly = false) {
    if (!template) return toast({ title: "Selecione um modelo", variant: "destructive" });
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return toast({ title: "Selecione ao menos um registro", variant: "destructive" });
    setPrinting(true);
    try {
      const selected = records.filter(r => selectedIds.has(r.id));
      const items: PrintItem[] = selected.map(r => ({
        template,
        data: enrichData(r),
        copies: copiesPerRecord,
      }));

      let html: string;
      if (mediaLayout) {
        // Compõe múltiplas etiquetas por mídia
        const totalCells = Math.max(1, mediaLayout.rows * mediaLayout.cols);
        if (mediaLayout.rows < 1 || mediaLayout.cols < 1) {
          throw new Error("Layout de mídia inválido (linhas/colunas)");
        }
        const expanded: PrintItem[] = [];
        for (const it of items) {
          for (let i = 0; i < (it.copies ?? 1); i++) expanded.push({ ...it, copies: 1 });
        }
        const pages: string[] = [];
        for (let i = 0; i < expanded.length; i += totalCells) {
          const chunk = expanded.slice(i, i + totalCells);
          const cells = chunk.map((it, idx) => ({
            row: Math.floor(idx / mediaLayout.cols),
            col: idx % mediaLayout.cols,
            template: it.template,
            data: it.data,
          }));
          const pageHtml = await renderMediaCompositionToHtml(mediaLayout, cells);
          pages.push(pageHtml);
        }
        // Concatena páginas (cada pageHtml é um documento; precisamos extrair só body)
        const bodies = pages.map(p => {
          const m = p.match(/<body>([\s\S]*?)<\/body>/);
          return `<section style="width:${mediaLayout.mediaWidthMm}mm;height:${mediaLayout.mediaHeightMm}mm;page-break-after:always;position:relative;background:#fff;">${m?.[1] ?? ""}</section>`;
        });
        const safeTitle = String(mediaLayout.name)
          .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${safeTitle}</title><style>
          @page { size: ${mediaLayout.mediaWidthMm}mm ${mediaLayout.mediaHeightMm}mm; margin: 0; }
          *{box-sizing:border-box;} html,body{margin:0;padding:0;background:#fff;}
          section:last-child{page-break-after:auto;}
          @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
          @media screen{body{background:#e5e7eb;padding:16px;} section{background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.15);margin-bottom:16px;}}
        </style></head><body>${bodies.join("\n")}</body></html>`;
      } else {
        html = await renderBatchToHtml(items);
      }

      if (previewOnly) {
        const w = window.open("", "_blank", "width=900,height=700");
        if (!w) { toast({ title: "Bloqueador de pop-ups", variant: "destructive" }); return; }
        w.document.open(); w.document.write(html); w.document.close();
      } else {
        openPrintWindow(html);
      }
    } catch (e: any) {
      toast({ title: "Erro ao gerar impressão", description: e.message, variant: "destructive" });
    } finally {
      setPrinting(false);
    }
  }

  const totalPages = useMemo(() => {
    const totalLabels = selectedIds.size * copiesPerRecord;
    if (mediaLayout) {
      const perPage = Math.max(1, mediaLayout.rows * mediaLayout.cols);
      return Math.ceil(totalLabels / perPage);
    }
    return totalLabels;
  }, [selectedIds.size, copiesPerRecord, mediaLayout]);

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }
  function toggleAll() {
    if (selectedIds.size === records.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(records.map(r => r.id)));
  }

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border bg-card">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/admin/label-templates")} data-testid="btn-back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-base font-semibold flex items-center gap-2">
            <Printer className="h-4 w-4 text-primary" />
            Impressão de etiquetas
          </h1>
          <p className="text-xs text-muted-foreground">Selecione modelo, registros e quantidade — preview real ou impressão imediata.</p>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 py-4 grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* Configuração */}
        <div className="space-y-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">1. Origem dos dados</CardTitle></CardHeader>
            <CardContent>
              <Select value={context} onValueChange={v => setContext(v as LabelContext)}>
                <SelectTrigger className="h-9" data-testid="select-context"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {labelContextEnum.map(c => (
                    <SelectItem key={c} value={c}>{LABEL_CONTEXT_LABELS[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">2. Modelo de etiqueta</CardTitle></CardHeader>
            <CardContent>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger className="h-9" data-testid="select-template">
                  <SelectValue placeholder={filteredTemplates.length === 0 ? "Nenhum modelo ativo" : "Escolha um modelo"} />
                </SelectTrigger>
                <SelectContent>
                  {filteredTemplates.map(t => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} {t.companyId === null ? "(sistema)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {template && (
                <p className="text-xs text-muted-foreground mt-2">
                  {template.widthMm}mm × {template.heightMm}mm · {template.dpi} DPI
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">3. Layout de mídia (opcional)</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Select value={mediaLayoutId} onValueChange={setMediaLayoutId}>
                <SelectTrigger className="h-9" data-testid="select-media-layout">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Uma etiqueta por página</SelectItem>
                  {mediaLayouts.map(m => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name} ({m.mediaWidthMm}×{m.mediaHeightMm}mm · {m.rows}×{m.cols})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {mediaLayout && (
                <p className="text-xs text-muted-foreground">
                  Aproveita {mediaLayout.rows * mediaLayout.cols} etiquetas por mídia.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">4. Quantidade</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div>
                <Label className="text-xs">Cópias por registro</Label>
                <Input
                  type="number" min={1} max={500}
                  value={copiesPerRecord}
                  onChange={e => setCopiesPerRecord(Math.max(1, parseInt(e.target.value) || 1))}
                  className="h-9 mt-1"
                  data-testid="input-copies"
                />
              </div>
              <div className="text-xs text-muted-foreground border-t pt-2">
                Selecionados: <strong>{selectedIds.size}</strong> · Etiquetas: <strong>{selectedIds.size * copiesPerRecord}</strong>
                {mediaLayout && <> · Páginas: <strong>{totalPages}</strong></>}
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-2">
            <Button
              size="lg"
              className="w-full"
              onClick={() => handlePrint(false)}
              disabled={!template || selectedIds.size === 0 || printing}
              data-testid="btn-print"
            >
              <Printer className="h-4 w-4 mr-2" />
              {printing ? "Preparando..." : "Imprimir"}
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => handlePrint(true)}
              disabled={!template || selectedIds.size === 0 || printing}
              data-testid="btn-preview"
            >
              <Eye className="h-4 w-4 mr-2" />
              Pré-visualizar
            </Button>
          </div>
        </div>

        {/* Registros */}
        <Card className="min-h-[400px]">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <Layers className="h-4 w-4" />
                Registros disponíveis
              </CardTitle>
              <div className="flex items-center gap-2">
                <div className="relative w-56">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="Buscar registros..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pl-8 h-8 text-xs"
                    data-testid="input-search-records"
                  />
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => refetch()} title="Recarregar">
                  <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between text-xs text-muted-foreground pb-2 border-b">
              <button onClick={toggleAll} className="hover:text-foreground" data-testid="btn-select-all">
                {selectedIds.size === records.length && records.length > 0 ? "Desmarcar todos" : "Marcar todos"} ({records.length})
              </button>
              <span>{isFetching ? "Carregando..." : `${records.length} registro(s)`}</span>
            </div>
            <ScrollArea className="h-[55vh] mt-1">
              {records.length === 0 ? (
                <div className="text-center text-muted-foreground py-12 text-sm">
                  {isFetching ? "Carregando..." : "Nenhum registro encontrado"}
                </div>
              ) : (
                <ul className="divide-y">
                  {records.map(r => {
                    const isSel = selectedIds.has(r.id);
                    const fields = LABEL_DATA_FIELDS[context] ?? [];
                    const summary = fields.slice(0, 3).map(f => r[f.key]).filter(Boolean).join(" · ");
                    return (
                      <li key={r.id} className="flex items-center gap-2 py-1.5 px-1 hover:bg-muted/40 cursor-pointer" onClick={() => toggleSelect(r.id)} data-testid={`row-record-${r.id}`}>
                        <Checkbox checked={isSel} onCheckedChange={() => toggleSelect(r.id)} onClick={e => e.stopPropagation()} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm truncate font-medium">{summary || r.id}</p>
                          <p className="text-xs text-muted-foreground truncate">ID: {r.id}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
