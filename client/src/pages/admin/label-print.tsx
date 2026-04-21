import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Printer, Search, Eye, Layers, RefreshCw,
  Calendar, AlertTriangle, Info, Boxes, FileWarning,
} from "lucide-react";
import {
  type LabelTemplate, type LabelContext, type PrintMediaLayout,
  LABEL_CONTEXT_LABELS, LABEL_DATA_FIELDS, labelContextEnum,
} from "@shared/schema";
import {
  renderBatchToHtml, renderMediaCompositionToHtml,
  type PrintItem,
} from "@/lib/label-renderer";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";

interface DataRow { id: string; totalVolumes?: number; [k: string]: any }

interface PrintConfigEntry { printer: string; copies: number }
interface PrintConfigResponse {
  success: boolean;
  printConfig: Record<string, PrintConfigEntry>;
}

// Contextos que exigem pelo menos um filtro mínimo (data ou texto) antes de listar.
const CONTEXTS_REQUIRING_FILTER: LabelContext[] = ["order_label", "volume_label", "pallet_label"];
// Contextos que exibem o seletor de período.
const CONTEXTS_WITH_DATE: LabelContext[] = ["order_label", "volume_label", "pallet_label"];

const SEARCH_PLACEHOLDER: Record<LabelContext, string> = {
  product_label: "Código, descrição ou código de barras...",
  order_label:   "Número do pedido, cliente ou código de carga...",
  volume_label:  "Número do pedido, cliente ou código de carga...",
  pallet_label:  "Código do pallet...",
  address_label: "Código WMS, bairro ou rua...",
};

export default function LabelPrintPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth() as any;

  const [context, setContext] = useState<LabelContext>("volume_label");
  const [templateId, setTemplateId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [searchActive, setSearchActive] = useState(false);
  // Mantemos o registro completo de cada item selecionado (não apenas o id),
  // para que a impressão use exatamente o que está contado no resumo.
  const [selectedRecords, setSelectedRecords] = useState<Map<string, DataRow>>(new Map());
  const [copiesPerRecord, setCopiesPerRecord] = useState(1);
  const [mediaLayoutId, setMediaLayoutId] = useState<string>("none");
  const [printing, setPrinting] = useState(false);

  // Debounce na busca textual (350ms) — evita disparo a cada tecla.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  // Reset ao trocar contexto (domínio diferente).
  useEffect(() => {
    setSelectedRecords(new Map());
    setTemplateId("");
    setSearchActive(false);
    setSearch("");
    setDebouncedSearch("");
    setStartDate("");
    setEndDate("");
  }, [context]);

  const { data: templates = [] } = useQuery<LabelTemplate[]>({
    queryKey: ["/api/labels/templates"],
  });
  const { data: mediaLayouts = [] } = useQuery<PrintMediaLayout[]>({
    queryKey: ["/api/labels/media-layouts"],
  });
  // Configuração de impressão do usuário logado, indexada por contexto.
  const { data: printConfigData } = useQuery<PrintConfigResponse>({
    queryKey: ["/api/print/config"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/print/config");
      return res.json();
    },
  });
  const contextPrinterConfig = printConfigData?.printConfig?.[context];

  // Datasource — só dispara depois que o usuário clicar em "Buscar".
  const { data: records = [], isFetching, refetch } = useQuery<DataRow[]>({
    queryKey: ["/api/labels/datasource", context, debouncedSearch, startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams({ q: debouncedSearch, limit: "100" });
      if (startDate) params.set("startDate", startDate);
      if (endDate)   params.set("endDate", endDate);
      const url = `/api/labels/datasource/${context}?${params.toString()}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: searchActive,
  });

  // Modelos compatíveis com a origem escolhida (regra 10).
  const filteredTemplates = useMemo(
    () => templates.filter(t => t.context === context && t.active),
    [templates, context],
  );
  const template = filteredTemplates.find(t => t.id === templateId);
  const mediaLayout = mediaLayouts.find(m => m.id === mediaLayoutId);

  // Avaliação de filtros mínimos antes de buscar.
  const hasMinFilter = useMemo(() => {
    if (!CONTEXTS_REQUIRING_FILTER.includes(context)) return true;
    return !!(search.trim() || startDate || endDate);
  }, [context, search, startDate, endDate]);

  // Volumes detectados — soma dos totalVolumes dos registros selecionados (volume_label).
  const detectedVolumes = useMemo(() => {
    if (context !== "volume_label") return 0;
    let total = 0;
    for (const r of selectedRecords.values()) {
      total += Math.max(1, Number(r.totalVolumes) || 0);
    }
    return total;
  }, [context, selectedRecords]);

  // Quantidade base — para volume_label vem dos volumes; para os demais, é 1 por registro.
  const baseLabelCount = context === "volume_label" ? detectedVolumes : selectedRecords.size;
  const totalLabels = baseLabelCount * copiesPerRecord;
  const totalPages = useMemo(() => {
    if (mediaLayout) {
      const perPage = Math.max(1, mediaLayout.rows * mediaLayout.cols);
      return Math.ceil(totalLabels / perPage);
    }
    return totalLabels;
  }, [totalLabels, mediaLayout]);

  // Algum pedido sem volume? (só faz sentido em volume_label)
  const ordersMissingVolumes = useMemo(() => {
    if (context !== "volume_label") return [] as DataRow[];
    return Array.from(selectedRecords.values()).filter(
      r => !r.totalVolumes || Number(r.totalVolumes) < 1,
    );
  }, [context, selectedRecords]);

  function enrichData(row: Record<string, unknown>): Record<string, unknown> {
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

  // Constrói a lista de PrintItem expandindo automaticamente os volumes
  // quando o contexto for volume_label.
  function buildPrintItems(): PrintItem[] {
    if (!template) return [];
    const items: PrintItem[] = [];
    for (const r of selectedRecords.values()) {
      if (context === "volume_label") {
        const totalVol = Math.max(1, Number(r.totalVolumes) || 1);
        for (let v = 1; v <= totalVol; v++) {
          items.push({
            template,
            data: enrichData({ ...r, vol: String(v), totalVol: String(totalVol) }),
            copies: copiesPerRecord,
          });
        }
      } else {
        items.push({
          template,
          data: enrichData(r),
          copies: copiesPerRecord,
        });
      }
    }
    return items;
  }

  async function buildHtml(items: PrintItem[]): Promise<string> {
    if (!mediaLayout) return renderBatchToHtml(items);

    // Composição em mídia maior (várias etiquetas por página).
    if (mediaLayout.rows < 1 || mediaLayout.cols < 1) {
      throw new Error("Layout de mídia inválido (linhas/colunas).");
    }
    const totalCells = Math.max(1, mediaLayout.rows * mediaLayout.cols);
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
      pages.push(await renderMediaCompositionToHtml(mediaLayout, cells));
    }
    const bodies = pages.map(p => {
      const m = p.match(/<body>([\s\S]*?)<\/body>/);
      return `<section style="width:${mediaLayout.mediaWidthMm}mm;height:${mediaLayout.mediaHeightMm}mm;page-break-after:always;position:relative;background:#fff;">${m?.[1] ?? ""}</section>`;
    });
    const safeTitle = String(mediaLayout.name)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${safeTitle}</title><style>
      @page { size: ${mediaLayout.mediaWidthMm}mm ${mediaLayout.mediaHeightMm}mm; margin: 0; }
      *{box-sizing:border-box;} html,body{margin:0;padding:0;background:#fff;}
      section:last-child{page-break-after:auto;}
      @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
      @media screen{body{background:#e5e7eb;padding:16px;} section{background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.15);margin-bottom:16px;}}
    </style></head><body>${bodies.join("\n")}</body></html>`;
  }

  async function handlePrint(previewOnly: boolean) {
    // Validações operacionais.
    if (!template) {
      return toast({ title: "Selecione um modelo de etiqueta", variant: "destructive" });
    }
    if (template.context !== context) {
      return toast({ title: "Modelo incompatível com a origem", variant: "destructive" });
    }
    if (selectedRecords.size === 0) {
      return toast({ title: "Selecione ao menos um registro", variant: "destructive" });
    }
    if (context === "volume_label" && ordersMissingVolumes.length > 0) {
      return toast({
        title: "Pedido sem volume cadastrado",
        description: `${ordersMissingVolumes.length} pedido(s) selecionado(s) não têm volumes — não é possível imprimir etiquetas de volume.`,
        variant: "destructive",
      });
    }
    if (!previewOnly && !contextPrinterConfig?.printer) {
      return toast({
        title: "Impressora não configurada",
        description: `Configure a impressora padrão para "${LABEL_CONTEXT_LABELS[context]}" em Configurações de Impressão.`,
        variant: "destructive",
      });
    }

    setPrinting(true);
    try {
      const items = buildPrintItems();
      const html = await buildHtml(items);

      if (previewOnly) {
        const w = window.open("", "_blank", "width=900,height=700");
        if (!w) {
          toast({ title: "Bloqueador de pop-ups ativo", variant: "destructive" });
          return;
        }
        w.document.open(); w.document.write(html); w.document.close();
      } else {
        // Reaproveita exatamente a mesma rotina já usada nos módulos operacionais:
        // POST /api/print/job com a impressora vinculada ao contexto pelo usuário.
        // copies=1 porque as cópias por registro já foram expandidas no HTML.
        const res = await apiRequest("POST", "/api/print/job", {
          printer: contextPrinterConfig!.printer,
          copies: 1,
          html,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error ?? "Falha ao enviar para a impressora.");
        }
        toast({
          title: "Enviado para impressão",
          description: `${totalLabels} etiqueta(s) → ${contextPrinterConfig!.printer}`,
        });
      }
    } catch (e: any) {
      toast({ title: "Erro ao gerar impressão", description: e.message, variant: "destructive" });
    } finally {
      setPrinting(false);
    }
  }

  function toggleSelect(row: DataRow) {
    setSelectedRecords(prev => {
      const n = new Map(prev);
      if (n.has(row.id)) n.delete(row.id); else n.set(row.id, row);
      return n;
    });
  }
  const visibleSelectedCount = useMemo(
    () => records.reduce((acc, r) => acc + (selectedRecords.has(r.id) ? 1 : 0), 0),
    [records, selectedRecords],
  );
  const allVisibleSelected = records.length > 0 && visibleSelectedCount === records.length;
  function toggleAll() {
    setSelectedRecords(prev => {
      const n = new Map(prev);
      if (allVisibleSelected) {
        for (const r of records) n.delete(r.id);
      } else {
        for (const r of records) n.set(r.id, r);
      }
      return n;
    });
  }
  function clearSelection() { setSelectedRecords(new Map()); }

  function handleSearchClick() {
    if (!hasMinFilter) {
      toast({
        title: "Informe pelo menos um filtro",
        description: "Use a busca textual ou um período (data inicial/final) antes de buscar.",
        variant: "destructive",
      });
      return;
    }
    // Sincroniza o termo debounced imediatamente para evitar uma fetch
    // intermediária com o valor anterior dentro da janela de debounce.
    setDebouncedSearch(search);
    setSearchActive(true);
  }

  // Atalho: Enter no campo de busca dispara a procura.
  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSearchClick();
    }
  }

  const periodLabel = useMemo(() => {
    if (!startDate && !endDate) return "—";
    const fmt = (s: string) => s ? s.split("-").reverse().join("/") : "?";
    return `${fmt(startDate)} → ${fmt(endDate)}`;
  }, [startDate, endDate]);

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
          <p className="text-xs text-muted-foreground">
            Escolha a origem, defina filtros, selecione registros e envie para a impressora configurada.
          </p>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 py-4 grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
        {/* Configuração — passos numerados na ordem do fluxo */}
        <div className="space-y-3 lg:sticky lg:top-3 self-start">
          <Card>
            <CardContent className="pt-4 pb-3 space-y-3">
              {/* 1. Origem */}
              <div>
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary/15 text-primary text-[10px] font-semibold">1</span>
                  Origem dos dados
                  <span className="text-destructive ml-0.5">*</span>
                </Label>
                <Select value={context} onValueChange={v => setContext(v as LabelContext)}>
                  <SelectTrigger className="h-8 mt-1 text-xs" data-testid="select-context"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {labelContextEnum.map(c => (
                      <SelectItem key={c} value={c}>{LABEL_CONTEXT_LABELS[c]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 2. Filtros (texto + período condicional) */}
              <div className="space-y-2">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary/15 text-primary text-[10px] font-semibold">2</span>
                  Filtros
                  {CONTEXTS_REQUIRING_FILTER.includes(context) && (
                    <span className="text-destructive ml-0.5" title="Pelo menos um filtro é obrigatório">*</span>
                  )}
                </Label>

                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder={SEARCH_PLACEHOLDER[context]}
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    onKeyDown={onSearchKeyDown}
                    className="pl-7 h-8 text-xs"
                    data-testid="input-search-records"
                  />
                </div>

                {CONTEXTS_WITH_DATE.includes(context) && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <div>
                      <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Calendar className="h-3 w-3" /> Data inicial
                      </Label>
                      <Input
                        type="date"
                        value={startDate}
                        onChange={e => setStartDate(e.target.value)}
                        className="h-8 mt-0.5 text-xs"
                        data-testid="input-start-date"
                      />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Calendar className="h-3 w-3" /> Data final
                      </Label>
                      <Input
                        type="date"
                        value={endDate}
                        onChange={e => setEndDate(e.target.value)}
                        className="h-8 mt-0.5 text-xs"
                        data-testid="input-end-date"
                      />
                    </div>
                  </div>
                )}

                <Button
                  onClick={handleSearchClick}
                  size="sm"
                  className="w-full h-8 text-xs"
                  disabled={isFetching}
                  data-testid="btn-search"
                >
                  <Search className="h-3.5 w-3.5 mr-1.5" />
                  {isFetching ? "Buscando..." : "Buscar registros"}
                </Button>
              </div>

              {/* 3. Modelo (filtrado pela origem) */}
              <div>
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary/15 text-primary text-[10px] font-semibold">3</span>
                  Modelo de etiqueta
                  <span className="text-destructive ml-0.5">*</span>
                </Label>
                <Select value={templateId} onValueChange={setTemplateId} disabled={filteredTemplates.length === 0}>
                  <SelectTrigger className="h-8 mt-1 text-xs" data-testid="select-template">
                    <SelectValue placeholder={filteredTemplates.length === 0 ? "Nenhum modelo compatível" : "Escolha um modelo"} />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredTemplates.map(t => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}{t.companyId === null ? " (sistema)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {template && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {template.widthMm}×{template.heightMm}mm · {template.dpi} DPI
                  </p>
                )}
                {filteredTemplates.length === 0 && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Nenhum modelo de "{LABEL_CONTEXT_LABELS[context]}" cadastrado.
                  </p>
                )}
              </div>

              {/* 4. Cópias extras */}
              <div>
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary/15 text-primary text-[10px] font-semibold">4</span>
                  Cópias por {context === "volume_label" ? "volume" : "registro"}
                </Label>
                <Input
                  type="number" min={1} max={500}
                  value={copiesPerRecord}
                  onChange={e => setCopiesPerRecord(Math.max(1, parseInt(e.target.value) || 1))}
                  className="h-8 mt-1 text-xs"
                  data-testid="input-copies"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  {context === "volume_label"
                    ? "Multiplicador opcional sobre cada volume detectado."
                    : "Multiplicador opcional sobre cada registro selecionado."}
                </p>
              </div>

              {/* 5. Layout de mídia (opcional) */}
              <div>
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-muted text-muted-foreground text-[10px] font-semibold">5</span>
                  Layout de mídia
                  <span className="text-[10px] text-muted-foreground/70 ml-0.5 normal-case">(opcional)</span>
                </Label>
                <Select value={mediaLayoutId} onValueChange={setMediaLayoutId}>
                  <SelectTrigger className="h-8 mt-1 text-xs" data-testid="select-media-layout">
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
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {mediaLayout.rows * mediaLayout.cols} etiquetas por folha — agrupa o lote.
                  </p>
                )}
              </div>

              {/* Resumo operacional enriquecido */}
              <div className="border-t pt-2 space-y-0.5 text-[11px]">
                <SummaryRow label="Origem" value={LABEL_CONTEXT_LABELS[context]} />
                <SummaryRow label="Modelo" value={template?.name ?? "—"} />
                {CONTEXTS_WITH_DATE.includes(context) && (
                  <SummaryRow label="Período" value={periodLabel} />
                )}
                <SummaryRow label="Encontrados" value={records.length} testId="text-summary-found" />
                <SummaryRow label="Selecionados" value={selectedRecords.size} testId="text-summary-records" />
                {context === "volume_label" && (
                  <SummaryRow
                    label="Volumes detectados"
                    value={detectedVolumes}
                    accent={ordersMissingVolumes.length > 0 ? "warn" : "default"}
                    testId="text-summary-volumes"
                  />
                )}
                <SummaryRow
                  label={context === "volume_label" ? "Cópias por volume" : "Cópias por registro"}
                  value={`${copiesPerRecord}×`}
                />
                <SummaryRow
                  label="Total de etiquetas"
                  value={totalLabels}
                  accent="strong"
                  testId="text-summary-labels"
                />
                <SummaryRow label={mediaLayout ? "Páginas" : "Páginas (1/etiqueta)"} value={totalPages} testId="text-summary-pages" />
                {mediaLayout && (
                  <SummaryRow label="Layout" value={mediaLayout.name} />
                )}
                <SummaryRow
                  label="Impressora"
                  value={contextPrinterConfig?.printer ?? "(não configurada)"}
                  accent={contextPrinterConfig?.printer ? "default" : "warn"}
                  testId="text-summary-printer"
                />
              </div>

              {/* Avisos contextuais */}
              {context === "volume_label" && ordersMissingVolumes.length > 0 && (
                <Alert variant="destructive" className="py-2">
                  <FileWarning className="h-3.5 w-3.5" />
                  <AlertDescription className="text-[11px]">
                    {ordersMissingVolumes.length} pedido(s) selecionado(s) sem volume cadastrado.
                  </AlertDescription>
                </Alert>
              )}
              {!contextPrinterConfig?.printer && (
                <Alert className="py-2">
                  <Info className="h-3.5 w-3.5" />
                  <AlertDescription className="text-[11px]">
                    Sem impressora vinculada a "{LABEL_CONTEXT_LABELS[context]}". Configure em <strong>Configurações → Impressão</strong> para imprimir direto.
                  </AlertDescription>
                </Alert>
              )}

              {/* Ações */}
              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  className="flex-1 h-9"
                  onClick={() => handlePrint(true)}
                  disabled={!template || selectedRecords.size === 0 || printing}
                  data-testid="btn-preview"
                >
                  <Eye className="h-4 w-4 mr-1.5" />
                  Pré-visualizar
                </Button>
                <Button
                  className="flex-1 h-9"
                  onClick={() => handlePrint(false)}
                  disabled={
                    !template
                    || selectedRecords.size === 0
                    || printing
                    || !contextPrinterConfig?.printer
                    || (context === "volume_label" && ordersMissingVolumes.length > 0)
                  }
                  data-testid="btn-print"
                >
                  <Printer className="h-4 w-4 mr-1.5" />
                  {printing ? "Enviando..." : "Imprimir"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Registros */}
        <Card className="min-h-[400px] flex flex-col">
          <CardHeader className="pb-2 pt-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <Layers className="h-4 w-4" />
                Registros disponíveis
                <span className="text-[11px] font-normal text-muted-foreground">
                  · {LABEL_CONTEXT_LABELS[context]}
                </span>
              </CardTitle>
              <Button
                variant="ghost" size="icon" className="h-8 w-8"
                onClick={() => searchActive && refetch()}
                disabled={!searchActive}
                title="Recarregar"
                data-testid="btn-refresh"
              >
                <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col pb-3">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground pb-1.5 border-b gap-2">
              <button
                onClick={toggleAll}
                className="hover:text-foreground inline-flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                disabled={records.length === 0}
                data-testid="btn-select-all"
                title={search ? "Marca/desmarca apenas os registros visíveis com o filtro atual" : undefined}
              >
                <Checkbox
                  checked={allVisibleSelected}
                  onCheckedChange={toggleAll}
                  className="pointer-events-none"
                />
                {allVisibleSelected ? "Desmarcar visíveis" : (search || startDate || endDate ? "Marcar visíveis" : "Marcar todos")}
              </button>
              <span className="text-right">
                {isFetching ? "Carregando..." : (
                  <>
                    <strong className="text-foreground" data-testid="text-records-count">{records.length}</strong> registro(s)
                    {selectedRecords.size > 0 && (
                      <>
                        {" · "}
                        <strong className="text-foreground" data-testid="text-selected-total">{selectedRecords.size}</strong> selecionado(s)
                        {selectedRecords.size !== visibleSelectedCount && (
                          <span className="text-muted-foreground/70"> ({visibleSelectedCount} visível{visibleSelectedCount === 1 ? "" : "is"})</span>
                        )}
                        <button
                          onClick={clearSelection}
                          className="ml-2 underline hover:text-foreground"
                          data-testid="btn-clear-selection"
                        >limpar</button>
                      </>
                    )}
                  </>
                )}
              </span>
            </div>
            <ScrollArea className="flex-1 h-[58vh]">
              {!searchActive ? (
                <div className="text-center text-muted-foreground py-12 text-sm space-y-1">
                  <Search className="h-6 w-6 mx-auto opacity-40" />
                  <p>Defina os filtros e clique em <strong>Buscar registros</strong>.</p>
                  {CONTEXTS_REQUIRING_FILTER.includes(context) && (
                    <p className="text-[11px]">Para "{LABEL_CONTEXT_LABELS[context]}" use texto e/ou um período.</p>
                  )}
                </div>
              ) : records.length === 0 ? (
                <div className="text-center text-muted-foreground py-12 text-sm">
                  {isFetching ? "Carregando..." : "Nenhum registro encontrado para os filtros aplicados."}
                </div>
              ) : (
                <ul className="divide-y">
                  {records.map(r => {
                    const isSel = selectedRecords.has(r.id);
                    const fields = LABEL_DATA_FIELDS[context] ?? [];
                    const summary = fields.slice(0, 3).map(f => r[f.key]).filter(Boolean).join(" · ");
                    const showVol = context === "volume_label" || context === "order_label";
                    const volCount = Number(r.totalVolumes) || 0;
                    return (
                      <li
                        key={r.id}
                        className={`flex items-center gap-2 py-1 px-1.5 cursor-pointer transition-colors ${isSel ? "bg-primary/10" : "hover:bg-muted/40"}`}
                        onClick={() => toggleSelect(r)}
                        data-testid={`row-record-${r.id}`}
                      >
                        <Checkbox checked={isSel} onCheckedChange={() => toggleSelect(r)} onClick={e => e.stopPropagation()} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs truncate font-medium leading-tight">{summary || r.id}</p>
                          <p className="text-[10px] text-muted-foreground truncate font-mono leading-tight">{r.id}</p>
                        </div>
                        {showVol && (
                          <span
                            className={`shrink-0 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border ${
                              volCount > 0
                                ? "bg-primary/10 text-primary border-primary/20"
                                : "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
                            }`}
                            title={volCount > 0 ? `${volCount} volume(s) cadastrado(s)` : "Sem volume cadastrado"}
                            data-testid={`badge-volumes-${r.id}`}
                          >
                            <Boxes className="h-2.5 w-2.5" />
                            {volCount > 0 ? `${volCount} vol` : "sem vol"}
                          </span>
                        )}
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

function SummaryRow({
  label, value, testId, accent = "default",
}: {
  label: string;
  value: string | number;
  testId?: string;
  accent?: "default" | "strong" | "warn";
}) {
  const accentClass =
    accent === "strong" ? "text-foreground font-semibold"
    : accent === "warn" ? "text-amber-600 dark:text-amber-400 font-medium"
    : "text-foreground font-medium";
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}:</span>
      <span className={`text-right tabular-nums truncate max-w-[170px] ${accentClass}`} data-testid={testId} title={String(value)}>
        {value}
      </span>
    </div>
  );
}
