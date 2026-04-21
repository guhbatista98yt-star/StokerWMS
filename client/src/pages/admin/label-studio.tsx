import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Save, Eye, EyeOff, Type, AlignLeft, Barcode, QrCode,
  Minus, Square, Trash2, ChevronUp, ChevronDown,
  MousePointer, Grid, ZoomIn, ZoomOut, type LucideIcon,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { renderLabelToHtml } from "@/lib/label-renderer";
import { cn } from "@/lib/utils";
import type {
  LabelTemplate, LabelComponent, LabelContext,
  TextComponent, DynamicTextComponent, BarcodeComponent, QRCodeComponent,
  LineComponent, RectangleComponent, LabelLayout,
} from "@shared/schema";
import { LABEL_DATA_FIELDS, LABEL_CONTEXT_LABELS } from "@shared/schema";

const CANVAS_SCALE = 3.7795275591;
const SNAP_MM = 0.5;
const SAFETY_MARGIN_MM = 2;
const RULER_SIZE_PX = 18;

function mmToCanvasPx(mm: number, zoom: number): number {
  return mm * CANVAS_SCALE * (zoom / 100);
}
function canvasPxToMm(px: number, zoom: number): number {
  return px / CANVAS_SCALE / (zoom / 100);
}
function snapMm(value: number): number {
  return Math.round(value / SNAP_MM) * SNAP_MM;
}

function Ruler({ length, zoom, orient }: { length: number; zoom: number; orient: "h" | "v" }) {
  const pxLen = mmToCanvasPx(length, zoom);
  const ticks: { pos: number; label?: string }[] = [];
  for (let mm = 0; mm <= length; mm += 5) {
    ticks.push({ pos: mmToCanvasPx(mm, zoom), label: mm % 10 === 0 ? String(mm) : undefined });
  }
  if (orient === "h") {
    return (
      <div style={{ position: "absolute", top: -RULER_SIZE_PX, left: 0, width: pxLen, height: RULER_SIZE_PX, overflow: "hidden", pointerEvents: "none", userSelect: "none" }}>
        <svg width={pxLen} height={RULER_SIZE_PX}>
          <rect width={pxLen} height={RULER_SIZE_PX} fill="#f3f4f6" />
          {ticks.map(({ pos, label }) => (
            <g key={pos}>
              <line x1={pos} y1={RULER_SIZE_PX} x2={pos} y2={label !== undefined ? RULER_SIZE_PX - 8 : RULER_SIZE_PX - 4} stroke="#9ca3af" strokeWidth={1} />
              {label !== undefined && <text x={pos + 2} y={RULER_SIZE_PX - 9} fontSize={8} fill="#6b7280">{label}</text>}
            </g>
          ))}
        </svg>
      </div>
    );
  }
  return (
    <div style={{ position: "absolute", left: -RULER_SIZE_PX, top: 0, width: RULER_SIZE_PX, height: pxLen, overflow: "hidden", pointerEvents: "none", userSelect: "none" }}>
      <svg width={RULER_SIZE_PX} height={pxLen}>
        <rect width={RULER_SIZE_PX} height={pxLen} fill="#f3f4f6" />
        {ticks.map(({ pos, label }) => (
          <g key={pos}>
            <line x1={RULER_SIZE_PX} y1={pos} x2={label !== undefined ? RULER_SIZE_PX - 8 : RULER_SIZE_PX - 4} y2={pos} stroke="#9ca3af" strokeWidth={1} />
            {label !== undefined && (
              <text x={RULER_SIZE_PX - 9} y={pos + 3} fontSize={8} fill="#6b7280" textAnchor="middle"
                transform={`rotate(-90, ${RULER_SIZE_PX - 9}, ${pos + 3})`}>{label}</text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

function ComponentPreview({ comp, zoom }: { comp: LabelComponent; zoom: number }) {
  const style: React.CSSProperties = {
    position: "absolute",
    left: 0, top: 0, width: "100%", height: "100%",
    boxSizing: "border-box",
    overflow: "hidden",
  };
  if (comp.type === "text") {
    const c = comp as TextComponent;
    return (
      <div style={{
        ...style,
        fontSize: c.fontSize * (zoom / 100) * 1.33,
        fontWeight: c.fontWeight ?? "normal",
        fontFamily: c.fontFamily ?? "Arial, sans-serif",
        textAlign: c.align ?? "left",
        color: c.color ?? "#000",
        lineHeight: 1.2,
        whiteSpace: "pre-wrap",
      }}>
        {c.content || <span style={{ color: "#aaa", fontStyle: "italic" }}>Texto</span>}
      </div>
    );
  }
  if (comp.type === "dynamic_text") {
    const c = comp as DynamicTextComponent;
    const allFields = Object.values(LABEL_DATA_FIELDS).flat();
    const fieldDef = allFields.find(f => f.key === c.field);
    const displayValue = `${c.prefix ?? ""}${fieldDef?.example ?? c.field}${c.suffix ?? ""}`;
    return (
      <div style={{
        ...style,
        fontSize: c.fontSize * (zoom / 100) * 1.33,
        fontWeight: c.fontWeight ?? "normal",
        fontFamily: c.fontFamily ?? "Arial, sans-serif",
        textAlign: c.align ?? "left",
        color: c.color ?? "#000",
        lineHeight: 1.2,
        background: "rgba(59,130,246,0.05)",
        border: "1px dashed rgba(59,130,246,0.3)",
        display: "flex",
        alignItems: "flex-start",
        padding: "1px 2px",
      }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" }}>
          {displayValue || <span style={{ color: "#aaa", fontStyle: "italic" }}>Campo dinâmico</span>}
        </span>
      </div>
    );
  }
  if (comp.type === "barcode") {
    return (
      <div style={{ ...style, background: "#f9f9f9", border: "1px dashed #bbb", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
        <Barcode style={{ width: "60%", height: "60%", color: "#555" }} />
        <span style={{ fontSize: Math.max(8, 10 * zoom / 100), color: "#888" }}>{(comp as BarcodeComponent).field || "Código"}</span>
      </div>
    );
  }
  if (comp.type === "qrcode") {
    return (
      <div style={{ ...style, background: "#f9f9f9", border: "1px dashed #bbb", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
        <QrCode style={{ width: "60%", height: "60%", color: "#555" }} />
        <span style={{ fontSize: Math.max(8, 10 * zoom / 100), color: "#888" }}>QR Code</span>
      </div>
    );
  }
  if (comp.type === "line") {
    const c = comp as LineComponent;
    const isH = c.orientation === "horizontal";
    return (
      <div style={{ ...style, display: "flex", alignItems: isH ? "center" : "flex-start", justifyContent: isH ? "flex-start" : "center" }}>
        <div style={{ width: isH ? "100%" : (c.strokeWidth ?? 1), height: isH ? (c.strokeWidth ?? 1) : "100%", background: c.color ?? "#000" }} />
      </div>
    );
  }
  if (comp.type === "rectangle") {
    const c = comp as RectangleComponent;
    return <div style={{ ...style, background: c.fillColor ?? "transparent", border: `${c.strokeWidth ?? 1}px solid ${c.strokeColor ?? "#000"}`, borderRadius: c.borderRadius ?? 0 }} />;
  }
  return null;
}

function PropertiesPanel({
  comp, context, onChange, onDelete,
}: {
  comp: LabelComponent;
  context: LabelContext;
  onChange: (updated: LabelComponent) => void;
  onDelete: () => void;
}) {
  const fields = LABEL_DATA_FIELDS[context] ?? [];
  const update = (patch: Record<string, unknown>) => {
    onChange({ ...comp, ...patch } as LabelComponent);
  };
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium text-xs text-muted-foreground uppercase tracking-wider">Propriedades</span>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={onDelete} data-testid="btn-delete-component">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label className="text-xs">X (mm)</Label><Input type="number" value={comp.x} onChange={e => update({ x: Number(e.target.value) })} className="h-7 text-xs" step={0.5} /></div>
        <div><Label className="text-xs">Y (mm)</Label><Input type="number" value={comp.y} onChange={e => update({ y: Number(e.target.value) })} className="h-7 text-xs" step={0.5} /></div>
        <div><Label className="text-xs">Largura (mm)</Label><Input type="number" value={comp.width} onChange={e => update({ width: Number(e.target.value) })} className="h-7 text-xs" step={0.5} min={1} /></div>
        <div><Label className="text-xs">Altura (mm)</Label><Input type="number" value={comp.height} onChange={e => update({ height: Number(e.target.value) })} className="h-7 text-xs" step={0.5} min={1} /></div>
      </div>
      {(comp.type === "text" || comp.type === "dynamic_text") && (() => {
        const c = comp as TextComponent | DynamicTextComponent;
        return (
          <>
            {comp.type === "text" && (
              <div><Label className="text-xs">Conteúdo</Label><Input value={(c as TextComponent).content} onChange={e => update({ content: e.target.value })} className="h-7 text-xs" /></div>
            )}
            {comp.type === "dynamic_text" && (
              <>
                <div>
                  <Label className="text-xs">Campo de dados</Label>
                  <Select value={(c as DynamicTextComponent).field} onValueChange={v => update({ field: v })}>
                    <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Selecionar campo..." /></SelectTrigger>
                    <SelectContent>
                      {fields.map(f => (
                        <SelectItem key={f.key} value={f.key} className="text-xs">
                          {f.label}{f.example && <span className="text-muted-foreground ml-1">({f.example})</span>}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label className="text-xs">Prefixo</Label><Input value={(c as DynamicTextComponent).prefix ?? ""} onChange={e => update({ prefix: e.target.value })} className="h-7 text-xs" /></div>
                  <div><Label className="text-xs">Sufixo</Label><Input value={(c as DynamicTextComponent).suffix ?? ""} onChange={e => update({ suffix: e.target.value })} className="h-7 text-xs" /></div>
                </div>
              </>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">Tamanho (pt)</Label><Input type="number" value={c.fontSize} onChange={e => update({ fontSize: Number(e.target.value) })} className="h-7 text-xs" min={6} max={72} /></div>
              <div>
                <Label className="text-xs">Peso</Label>
                <Select value={c.fontWeight ?? "normal"} onValueChange={v => update({ fontWeight: v as "normal" | "bold" })}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="bold">Negrito</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Alinhamento</Label>
                <Select value={c.align ?? "left"} onValueChange={v => update({ align: v as "left" | "center" | "right" })}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="left">Esquerda</SelectItem>
                    <SelectItem value="center">Centro</SelectItem>
                    <SelectItem value="right">Direita</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Cor</Label><Input type="color" value={c.color ?? "#000000"} onChange={e => update({ color: e.target.value })} className="h-7 p-0.5" /></div>
            </div>
          </>
        );
      })()}
      {(comp.type === "barcode" || comp.type === "qrcode") && (() => {
        const c = comp as BarcodeComponent | QRCodeComponent;
        return (
          <>
            <div>
              <Label className="text-xs">Campo de dados</Label>
              <Select value={c.field} onValueChange={v => update({ field: v })}>
                <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Selecionar campo..." /></SelectTrigger>
                <SelectContent>
                  {fields.map(f => (<SelectItem key={f.key} value={f.key} className="text-xs">{f.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            {comp.type === "barcode" && (
              <div>
                <Label className="text-xs">Formato</Label>
                <Select value={(c as BarcodeComponent).format} onValueChange={v => update({ format: v as BarcodeComponent["format"] })}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["CODE128", "CODE39", "EAN13", "EAN8", "ITF14"].map(f => (<SelectItem key={f} value={f} className="text-xs">{f}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </>
        );
      })()}
      {comp.type === "line" && (() => {
        const c = comp as LineComponent;
        return (
          <>
            <div>
              <Label className="text-xs">Orientação</Label>
              <Select value={c.orientation} onValueChange={v => update({ orientation: v as "horizontal" | "vertical" })}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="horizontal">Horizontal</SelectItem>
                  <SelectItem value="vertical">Vertical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">Espessura (px)</Label><Input type="number" value={c.strokeWidth ?? 1} onChange={e => update({ strokeWidth: Number(e.target.value) })} className="h-7 text-xs" min={1} /></div>
              <div><Label className="text-xs">Cor</Label><Input type="color" value={c.color ?? "#000000"} onChange={e => update({ color: e.target.value })} className="h-7 p-0.5" /></div>
            </div>
          </>
        );
      })()}
      {comp.type === "rectangle" && (() => {
        const c = comp as RectangleComponent;
        return (
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-xs">Preenchimento</Label><Input type="color" value={c.fillColor ?? "#ffffff"} onChange={e => update({ fillColor: e.target.value })} className="h-7 p-0.5" /></div>
            <div><Label className="text-xs">Borda</Label><Input type="color" value={c.strokeColor ?? "#000000"} onChange={e => update({ strokeColor: e.target.value })} className="h-7 p-0.5" /></div>
            <div><Label className="text-xs">Espessura borda</Label><Input type="number" value={c.strokeWidth ?? 1} onChange={e => update({ strokeWidth: Number(e.target.value) })} className="h-7 text-xs" min={0} /></div>
            <div><Label className="text-xs">Raio (px)</Label><Input type="number" value={c.borderRadius ?? 0} onChange={e => update({ borderRadius: Number(e.target.value) })} className="h-7 text-xs" min={0} /></div>
          </div>
        );
      })()}
    </div>
  );
}

export default function LabelStudioPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [layout, setLayout] = useState<LabelLayout>({ components: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const [isDirty, setIsDirty] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [dragging, setDragging] = useState<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [resizing, setResizing] = useState<{ id: string; handle: string; startX: number; startY: number; origX: number; origY: number; origW: number; origH: number } | null>(null);
  const [snapGrid, setSnapGrid] = useState(true);
  const [showMargins, setShowMargins] = useState(true);
  const canvasRef = useRef<HTMLDivElement>(null);

  const { data: template, isLoading } = useQuery<LabelTemplate>({
    queryKey: ["/api/labels/templates", id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/labels/templates/${id}`);
      return res.json();
    },
    enabled: !!id,
  });

  useEffect(() => {
    if (template) {
      setLayout((template.layoutJson as LabelLayout) ?? { components: [] });
      setIsDirty(false);
    }
  }, [template]);

  useEffect(() => {
    if (!showPreview || !template) { setPreviewHtml(null); return; }
    let cancelled = false;
    setPreviewLoading(true);
    const ctx = template.context as LabelContext;
    const sampleData: Record<string, string> = Object.fromEntries(
      (LABEL_DATA_FIELDS[ctx] ?? []).map(f => [f.key, f.example ?? f.label])
    );
    const previewTemplate = { ...template, layoutJson: layout };
    renderLabelToHtml(previewTemplate, sampleData).then(html => {
      if (!cancelled) { setPreviewHtml(html); setPreviewLoading(false); }
    }).catch(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [showPreview, layout, template]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", `/api/labels/templates/${id}`, { layoutJson: layout });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/labels/templates", id] });
      qc.invalidateQueries({ queryKey: ["/api/labels/templates"] });
      setIsDirty(false);
      toast({ title: "Modelo salvo com sucesso" });
    },
    onError: (e: any) => toast({ title: "Erro ao salvar", description: e?.message, variant: "destructive" }),
  });

  const updateComponent = useCallback((updated: LabelComponent) => {
    setLayout(prev => ({ components: prev.components.map(c => c.id === updated.id ? updated : c) }));
    setIsDirty(true);
  }, []);

  const deleteComponent = useCallback((compId: string) => {
    setLayout(prev => ({ components: prev.components.filter(c => c.id !== compId) }));
    setSelectedId(null);
    setIsDirty(true);
  }, []);

  const addComponent = useCallback((type: LabelComponent["type"]) => {
    const ctx = (template?.context as LabelContext) ?? "volume_label";
    const defaultField = LABEL_DATA_FIELDS[ctx][0]?.key ?? "order";
    const base = { id: crypto.randomUUID(), x: 5, y: 5, zIndex: layout.components.length };
    let newComp: LabelComponent;
    switch (type) {
      case "text":
        newComp = { ...base, type: "text", width: 40, height: 8, content: "Texto", fontSize: 10, fontWeight: "normal", align: "left", color: "#000" } as TextComponent; break;
      case "dynamic_text":
        newComp = { ...base, type: "dynamic_text", width: 50, height: 8, field: defaultField, fontSize: 10, fontWeight: "normal", align: "left", color: "#000" } as DynamicTextComponent; break;
      case "barcode":
        newComp = { ...base, type: "barcode", width: 50, height: 15, field: defaultField, format: "CODE128", showValue: true } as BarcodeComponent; break;
      case "qrcode":
        newComp = { ...base, type: "qrcode", width: 15, height: 15, field: defaultField, errorLevel: "M" } as QRCodeComponent; break;
      case "line":
        newComp = { ...base, type: "line", width: 40, height: 1, orientation: "horizontal", strokeWidth: 1, color: "#000" } as LineComponent; break;
      case "rectangle":
        newComp = { ...base, type: "rectangle", width: 30, height: 20, fillColor: "transparent", strokeColor: "#000", strokeWidth: 1, borderRadius: 0 } as RectangleComponent; break;
      default: return;
    }
    setLayout(prev => ({ components: [...prev.components, newComp] }));
    setSelectedId(newComp.id);
    setIsDirty(true);
  }, [layout.components.length, template?.context]);

  const moveLayer = useCallback((compId: string, dir: "up" | "down") => {
    setLayout(prev => {
      const idx = prev.components.findIndex(c => c.id === compId);
      if (idx < 0) return prev;
      const newComps = [...prev.components];
      if (dir === "up" && idx < newComps.length - 1) {
        [newComps[idx], newComps[idx + 1]] = [newComps[idx + 1], newComps[idx]];
      } else if (dir === "down" && idx > 0) {
        [newComps[idx], newComps[idx - 1]] = [newComps[idx - 1], newComps[idx]];
      }
      return { components: newComps.map((c, i) => ({ ...c, zIndex: i })) };
    });
    setIsDirty(true);
  }, []);

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent, compId: string) => {
    e.stopPropagation();
    setSelectedId(compId);
    const comp = layout.components.find(c => c.id === compId);
    if (!comp) return;
    setDragging({ id: compId, startX: e.clientX, startY: e.clientY, origX: comp.x, origY: comp.y });
  }, [layout.components]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (resizing) {
      const { id: rid, handle, startX, startY, origX, origY, origW, origH } = resizing;
      const comp = layout.components.find(c => c.id === rid);
      if (!comp || !template) return;
      const dxMm = canvasPxToMm(e.clientX - startX, zoom);
      const dyMm = canvasPxToMm(e.clientY - startY, zoom);
      let nx = origX, ny = origY, nw = origW, nh = origH;
      if (handle.includes("e")) nw = origW + dxMm;
      if (handle.includes("s")) nh = origH + dyMm;
      if (handle.includes("w")) { nx = origX + dxMm; nw = origW - dxMm; }
      if (handle.includes("n")) { ny = origY + dyMm; nh = origH - dyMm; }
      // Enforce min size before snapping; preserve anchor on west/north handles
      const MIN = 1;
      if (nw < MIN) {
        if (handle.includes("w")) nx = origX + origW - MIN;
        nw = MIN;
      }
      if (nh < MIN) {
        if (handle.includes("n")) ny = origY + origH - MIN;
        nh = MIN;
      }
      const snap = (v: number) => snapGrid ? snapMm(v) : Math.round(v * 10) / 10;
      nx = Math.max(0, Math.min(template.widthMm - MIN, snap(nx)));
      ny = Math.max(0, Math.min(template.heightMm - MIN, snap(ny)));
      nw = Math.max(MIN, Math.min(template.widthMm - nx, snap(nw)));
      nh = Math.max(MIN, Math.min(template.heightMm - ny, snap(nh)));
      updateComponent({ ...comp, x: nx, y: ny, width: nw, height: nh });
      return;
    }
    if (!dragging) return;
    const dx = canvasPxToMm(e.clientX - dragging.startX, zoom);
    const dy = canvasPxToMm(e.clientY - dragging.startY, zoom);
    const comp = layout.components.find(c => c.id === dragging.id);
    if (!comp || !template) return;
    const rawX = dragging.origX + dx;
    const rawY = dragging.origY + dy;
    const snappedX = snapGrid ? snapMm(rawX) : Math.round(rawX * 10) / 10;
    const snappedY = snapGrid ? snapMm(rawY) : Math.round(rawY * 10) / 10;
    const newX = Math.max(0, Math.min(template.widthMm - comp.width, snappedX));
    const newY = Math.max(0, Math.min(template.heightMm - comp.height, snappedY));
    updateComponent({ ...comp, x: newX, y: newY });
  }, [dragging, resizing, layout.components, zoom, template, updateComponent, snapGrid]);

  const handleMouseUp = useCallback(() => { setDragging(null); setResizing(null); }, []);

  const handleResizeStart = useCallback((e: React.MouseEvent, compId: string, handle: string) => {
    e.stopPropagation();
    e.preventDefault();
    const comp = layout.components.find(c => c.id === compId);
    if (!comp) return;
    setResizing({ id: compId, handle, startX: e.clientX, startY: e.clientY, origX: comp.x, origY: comp.y, origW: comp.width, origH: comp.height });
  }, [layout.components]);

  const selectedComp = layout.components.find(c => c.id === selectedId) ?? null;

  if (isLoading || !template) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground text-sm">Carregando studio...</p>
      </div>
    );
  }

  const context = template.context as LabelContext;
  const fields = LABEL_DATA_FIELDS[context] ?? [];
  const canvasW = mmToCanvasPx(template.widthMm, zoom);
  const canvasH = mmToCanvasPx(template.heightMm, zoom);
  const TOOLBAR_ITEMS: { type: LabelComponent["type"]; label: string; Icon: LucideIcon }[] = [
    { type: "text", label: "Texto", Icon: Type },
    { type: "dynamic_text", label: "Campo", Icon: AlignLeft },
    { type: "barcode", label: "Código de Barras", Icon: Barcode },
    { type: "qrcode", label: "QR Code", Icon: QrCode },
    { type: "line", label: "Linha", Icon: Minus },
    { type: "rectangle", label: "Caixa", Icon: Square },
  ];

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/admin/label-templates")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-foreground truncate">{template.name}</h1>
          <p className="text-xs text-muted-foreground">{LABEL_CONTEXT_LABELS[context]} · {template.widthMm}×{template.heightMm}mm</p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => setZoom(z => Math.max(50, z - 10))}>
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <span className="text-xs text-muted-foreground w-10 text-center">{zoom}%</span>
          <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => setZoom(z => Math.min(200, z + 10))}>
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
        </div>
        <Button variant={snapGrid ? "secondary" : "outline"} size="sm" className="h-7 w-7 p-0" onClick={() => setSnapGrid(v => !v)} title="Snap ao grid (0.5mm)" data-testid="btn-toggle-snap">
          <Grid className="h-3.5 w-3.5" />
        </Button>
        <Button variant={showMargins ? "secondary" : "outline"} size="sm" className="h-7 w-7 p-0" onClick={() => setShowMargins(v => !v)} title="Margens de segurança (2mm)" data-testid="btn-toggle-margins">
          <MousePointer className="h-3.5 w-3.5" />
        </Button>
        <Button variant={showPreview ? "secondary" : "outline"} size="sm" className="h-7" onClick={() => setShowPreview(v => !v)} data-testid="btn-toggle-preview">
          {showPreview ? <><EyeOff className="h-3.5 w-3.5 mr-1.5" />Fechar</> : <><Eye className="h-3.5 w-3.5 mr-1.5" />Preview</>}
        </Button>
        <Button size="sm" onClick={() => saveMutation.mutate()} disabled={!isDirty || saveMutation.isPending} data-testid="btn-save-studio" className={cn(!isDirty && "opacity-50")}>
          <Save className="h-4 w-4 mr-1.5" />
          {saveMutation.isPending ? "Salvando..." : isDirty ? "Salvar*" : "Salvo"}
        </Button>
        <Button variant="outline" size="sm" className="h-7" onClick={() => { window.open(`/api/labels/templates/${id}/export`, "_blank"); }} data-testid="btn-export-studio" title="Exportar como JSON">
          Exportar
        </Button>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="w-40 border-r border-border bg-card flex flex-col shrink-0 overflow-y-auto">
          <div className="px-2 py-2 border-b border-border">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Componentes</p>
          </div>
          <div className="p-1.5 space-y-1">
            {TOOLBAR_ITEMS.map(({ type, label, Icon }) => (
              <button key={type} className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-foreground hover:bg-muted transition-colors text-left" onClick={() => addComponent(type)} data-testid={`btn-add-${type}`}>
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {label}
              </button>
            ))}
          </div>
          <div className="px-2 py-2 border-b border-t border-border mt-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Camadas</p>
          </div>
          <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
            {[...layout.components].reverse().map(c => (
              <div key={c.id} className={cn("flex items-center gap-1 px-2 py-1 rounded text-xs cursor-pointer transition-colors", selectedId === c.id ? "bg-primary/15 text-primary font-medium" : "hover:bg-muted text-foreground")} onClick={() => setSelectedId(c.id)} data-testid={`layer-${c.id}`}>
                <span className="flex-1 truncate">{
                  c.type === "text" ? (c as TextComponent).content || "Texto" :
                  c.type === "dynamic_text" ? `[${(c as DynamicTextComponent).field}]` :
                  c.type === "barcode" ? "Barcode" :
                  c.type === "qrcode" ? "QR Code" :
                  c.type === "line" ? "Linha" : "Caixa"
                }</span>
                <button onClick={e => { e.stopPropagation(); moveLayer(c.id, "up"); }} className="opacity-50 hover:opacity-100"><ChevronUp className="h-3 w-3" /></button>
                <button onClick={e => { e.stopPropagation(); moveLayer(c.id, "down"); }} className="opacity-50 hover:opacity-100"><ChevronDown className="h-3 w-3" /></button>
              </div>
            ))}
            {layout.components.length === 0 && (<p className="text-xs text-muted-foreground text-center py-4">Nenhum componente</p>)}
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-muted/30 flex items-center justify-center p-8" onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
          <div style={{ position: "relative", marginTop: RULER_SIZE_PX, marginLeft: RULER_SIZE_PX, flexShrink: 0 }}>
            <div ref={canvasRef} style={{ position: "relative", width: canvasW, height: canvasH, background: "white", boxShadow: "0 4px 24px rgba(0,0,0,0.15)", cursor: dragging ? "grabbing" : "default", flexShrink: 0, outline: "1px solid #ddd" }} onClick={() => setSelectedId(null)} data-testid="label-canvas">
              <Ruler length={template.widthMm} zoom={zoom} orient="h" />
              <Ruler length={template.heightMm} zoom={zoom} orient="v" />
              {showMargins && (
                <div style={{
                  position: "absolute",
                  top: mmToCanvasPx(SAFETY_MARGIN_MM, zoom),
                  left: mmToCanvasPx(SAFETY_MARGIN_MM, zoom),
                  width: mmToCanvasPx(template.widthMm - SAFETY_MARGIN_MM * 2, zoom),
                  height: mmToCanvasPx(template.heightMm - SAFETY_MARGIN_MM * 2, zoom),
                  border: "1px dashed rgba(239, 68, 68, 0.4)",
                  pointerEvents: "none",
                  zIndex: 999,
                }} />
              )}
              {layout.components.map(comp => {
                const isSelected = selectedId === comp.id;
                const HANDLES = [
                  { id: "nw", style: { top: -4, left: -4, cursor: "nw-resize" as const } },
                  { id: "n",  style: { top: -4, left: "calc(50% - 4px)", cursor: "n-resize" as const } },
                  { id: "ne", style: { top: -4, right: -4, cursor: "ne-resize" as const } },
                  { id: "e",  style: { top: "calc(50% - 4px)", right: -4, cursor: "e-resize" as const } },
                  { id: "se", style: { bottom: -4, right: -4, cursor: "se-resize" as const } },
                  { id: "s",  style: { bottom: -4, left: "calc(50% - 4px)", cursor: "s-resize" as const } },
                  { id: "sw", style: { bottom: -4, left: -4, cursor: "sw-resize" as const } },
                  { id: "w",  style: { top: "calc(50% - 4px)", left: -4, cursor: "w-resize" as const } },
                ];
                return (
                  <div key={comp.id} style={{
                    position: "absolute",
                    left: mmToCanvasPx(comp.x, zoom),
                    top: mmToCanvasPx(comp.y, zoom),
                    width: mmToCanvasPx(comp.width, zoom),
                    height: mmToCanvasPx(comp.height, zoom),
                    cursor: dragging ? "grabbing" : "grab",
                    outline: isSelected ? "2px solid #3b82f6" : "1px dashed transparent",
                    zIndex: comp.zIndex ?? 0,
                    boxSizing: "border-box",
                  }} onMouseDown={e => handleCanvasMouseDown(e, comp.id)} data-testid={`component-${comp.id}`}>
                    <ComponentPreview comp={comp} zoom={zoom} />
                    {isSelected && HANDLES.map(h => (
                      <div key={h.id} style={{ position: "absolute", width: 8, height: 8, background: "white", border: "2px solid #3b82f6", borderRadius: 1, ...h.style }} onMouseDown={e => handleResizeStart(e, comp.id, h.id)} />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {showPreview && (
          <div className="w-64 border-l border-border bg-card flex flex-col shrink-0 overflow-hidden" data-testid="preview-panel">
            <div className="px-2 py-2 border-b border-border flex items-center gap-1.5">
              <Eye className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Preview Real</p>
            </div>
            <div className="flex-1 overflow-auto p-2 flex items-start justify-center">
              {previewLoading ? (
                <p className="text-xs text-muted-foreground pt-4">Renderizando...</p>
              ) : previewHtml ? (
                <iframe srcDoc={previewHtml} style={{ border: "1px solid #ccc", background: "white", width: "100%", minHeight: 200 }} title="Label Preview" data-testid="preview-iframe" />
              ) : (
                <p className="text-xs text-muted-foreground pt-4">Nenhum componente</p>
              )}
            </div>
          </div>
        )}

        <div className="w-56 border-l border-border bg-card overflow-y-auto shrink-0">
          <div className="p-2 border-b border-border">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{selectedComp ? "Propriedades" : "Campos Disponíveis"}</p>
          </div>
          {selectedComp ? (
            <div className="p-2">
              <PropertiesPanel comp={selectedComp} context={context} onChange={updateComponent} onDelete={() => deleteComponent(selectedComp.id)} />
            </div>
          ) : (
            <div className="p-2 space-y-3">
              <p className="text-xs text-muted-foreground">Adicione um componente do menu lateral, depois selecione-o para editar suas propriedades.</p>
              <div>
                <p className="text-xs font-medium text-foreground mb-1">Campos dinâmicos disponíveis:</p>
                {Array.from(new Set(fields.map(f => f.category))).map(cat => (
                  <div key={cat} className="mb-2">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">{cat}</p>
                    {fields.filter(f => f.category === cat).map(f => (
                      <div key={f.key} className="flex items-start gap-1 py-0.5">
                        <code className="text-[10px] bg-muted px-1 rounded text-foreground shrink-0">{f.key}</code>
                        <span className="text-[10px] text-muted-foreground">{f.label}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
