import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Save, Eye, EyeOff, Type, AlignLeft, Barcode, QrCode,
  Minus, Square, Trash2, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  Grid, ZoomIn, ZoomOut, type LucideIcon,
  Undo2, Redo2, Copy, Lock, Unlock, EyeOff as EyeOffIcon, Eye as EyeIcon,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  Maximize2, Square as SquareIcon, AlertTriangle, Printer, PanelRightClose, PanelRightOpen,
  PanelLeft, PanelRight, PanelTop, PanelBottom, Settings2, RectangleHorizontal, RectangleVertical,
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
const HISTORY_LIMIT = 50;

function mmToCanvasPx(mm: number, zoom: number): number {
  return mm * CANVAS_SCALE * (zoom / 100);
}
function canvasPxToMm(px: number, zoom: number): number {
  return px / CANVAS_SCALE / (zoom / 100);
}
function snapMm(value: number): number {
  return Math.round(value / SNAP_MM) * SNAP_MM;
}
function compLabel(c: LabelComponent): string {
  if (c.name) return c.name;
  if (c.type === "text") return (c as TextComponent).content || "Texto";
  if (c.type === "dynamic_text") return `[${(c as DynamicTextComponent).field}]`;
  if (c.type === "barcode") return `Barcode (${(c as BarcodeComponent).field})`;
  if (c.type === "qrcode") return `QR (${(c as QRCodeComponent).field})`;
  if (c.type === "line") return "Linha";
  return "Caixa";
}

function Ruler({ length, zoom, side }: { length: number; zoom: number; side: "top" | "bottom" | "left" | "right" }) {
  const pxLen = mmToCanvasPx(length, zoom);
  const ticks: { pos: number; label?: string }[] = [];
  for (let mm = 0; mm <= length; mm += 5) {
    ticks.push({ pos: mmToCanvasPx(mm, zoom), label: mm % 10 === 0 ? String(mm) : undefined });
  }
  const TICK_COLOR = "currentColor";
  const isHorizontal = side === "top" || side === "bottom";

  // Posicionamento absoluto: cada régua "encosta" no lado correspondente do canvas (do lado de fora)
  const wrapperStyle: React.CSSProperties = {
    position: "absolute",
    overflow: "hidden",
    pointerEvents: "none",
    userSelect: "none",
    width: isHorizontal ? pxLen : RULER_SIZE_PX,
    height: isHorizontal ? RULER_SIZE_PX : pxLen,
  };
  if (side === "top")    { wrapperStyle.top = -RULER_SIZE_PX; wrapperStyle.left = 0; }
  if (side === "bottom") { wrapperStyle.bottom = -RULER_SIZE_PX; wrapperStyle.left = 0; }
  if (side === "left")   { wrapperStyle.left = -RULER_SIZE_PX; wrapperStyle.top = 0; }
  if (side === "right")  { wrapperStyle.right = -RULER_SIZE_PX; wrapperStyle.top = 0; }

  if (isHorizontal) {
    // Topo: ticks descem do alto; Baixo: ticks sobem da base (espelhado)
    const baseY = side === "top" ? RULER_SIZE_PX : 0;
    const tickDir = side === "top" ? -1 : 1;
    return (
      <div className="text-muted-foreground" style={wrapperStyle}>
        <svg width={pxLen} height={RULER_SIZE_PX}>
          <rect width={pxLen} height={RULER_SIZE_PX} className="fill-muted" />
          {ticks.map(({ pos, label }) => (
            <g key={pos}>
              <line
                x1={pos} y1={baseY}
                x2={pos} y2={baseY + tickDir * (label !== undefined ? 8 : 4)}
                stroke={TICK_COLOR} strokeOpacity={0.55} strokeWidth={1}
              />
              {label !== undefined && (
                <text x={pos + 2} y={side === "top" ? RULER_SIZE_PX - 9 : 11} fontSize={8} fill={TICK_COLOR}>{label}</text>
              )}
            </g>
          ))}
          <line
            x1={0} y1={side === "top" ? RULER_SIZE_PX - 0.5 : 0.5}
            x2={pxLen} y2={side === "top" ? RULER_SIZE_PX - 0.5 : 0.5}
            stroke={TICK_COLOR} strokeOpacity={0.3} strokeWidth={1}
          />
        </svg>
      </div>
    );
  }
  // Vertical (left ou right)
  const baseX = side === "left" ? RULER_SIZE_PX : 0;
  const tickDir = side === "left" ? -1 : 1;
  return (
    <div className="text-muted-foreground" style={wrapperStyle}>
      <svg width={RULER_SIZE_PX} height={pxLen}>
        <rect width={RULER_SIZE_PX} height={pxLen} className="fill-muted" />
        {ticks.map(({ pos, label }) => (
          <g key={pos}>
            <line
              x1={baseX} y1={pos}
              x2={baseX + tickDir * (label !== undefined ? 8 : 4)} y2={pos}
              stroke={TICK_COLOR} strokeOpacity={0.55} strokeWidth={1}
            />
            {label !== undefined && (
              <text
                x={side === "left" ? RULER_SIZE_PX - 9 : 9}
                y={pos + 3}
                fontSize={8} fill={TICK_COLOR} textAnchor="middle"
                transform={`rotate(-90, ${side === "left" ? RULER_SIZE_PX - 9 : 9}, ${pos + 3})`}
              >{label}</text>
            )}
          </g>
        ))}
        <line
          x1={side === "left" ? RULER_SIZE_PX - 0.5 : 0.5} y1={0}
          x2={side === "left" ? RULER_SIZE_PX - 0.5 : 0.5} y2={pxLen}
          stroke={TICK_COLOR} strokeOpacity={0.3} strokeWidth={1}
        />
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
    opacity: comp.opacity ?? 1,
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
  const isLocked = comp.locked === true;
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium text-xs text-muted-foreground uppercase tracking-wider">Propriedades</span>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => update({ locked: !isLocked })} title={isLocked ? "Desbloquear" : "Bloquear"} data-testid="btn-toggle-lock">
            {isLocked ? <Lock className="h-3.5 w-3.5 text-amber-500" /> : <Unlock className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => update({ hidden: !comp.hidden })} title={comp.hidden ? "Mostrar" : "Ocultar"} data-testid="btn-toggle-hide">
            {comp.hidden ? <EyeOffIcon className="h-3.5 w-3.5 text-muted-foreground" /> : <EyeIcon className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={onDelete} disabled={isLocked} data-testid="btn-delete-component">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div>
        <Label className="text-xs">Nome do objeto</Label>
        <Input value={comp.name ?? ""} placeholder={compLabel(comp)} onChange={e => update({ name: e.target.value || undefined })} className="h-7 text-xs" data-testid="input-comp-name" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label className="text-xs">X (mm)</Label><Input type="number" value={comp.x} onChange={e => update({ x: Number(e.target.value) })} className="h-7 text-xs" step={0.5} disabled={isLocked} /></div>
        <div><Label className="text-xs">Y (mm)</Label><Input type="number" value={comp.y} onChange={e => update({ y: Number(e.target.value) })} className="h-7 text-xs" step={0.5} disabled={isLocked} /></div>
        <div><Label className="text-xs">Largura (mm)</Label><Input type="number" value={comp.width} onChange={e => update({ width: Number(e.target.value) })} className="h-7 text-xs" step={0.5} min={1} disabled={isLocked} /></div>
        <div><Label className="text-xs">Altura (mm)</Label><Input type="number" value={comp.height} onChange={e => update({ height: Number(e.target.value) })} className="h-7 text-xs" step={0.5} min={1} disabled={isLocked} /></div>
        <div><Label className="text-xs">Rotação (°)</Label><Input type="number" value={comp.rotation ?? 0} onChange={e => update({ rotation: Number(e.target.value) })} className="h-7 text-xs" step={1} disabled={isLocked} /></div>
        <div><Label className="text-xs">Opacidade (%)</Label><Input type="number" value={Math.round((comp.opacity ?? 1) * 100)} onChange={e => update({ opacity: Math.max(0, Math.min(100, Number(e.target.value))) / 100 })} className="h-7 text-xs" step={5} min={0} max={100} disabled={isLocked} /></div>
      </div>
      {(comp.type === "text" || comp.type === "dynamic_text") && (() => {
        const c = comp as TextComponent | DynamicTextComponent;
        return (
          <>
            {comp.type === "text" && (
              <div><Label className="text-xs">Conteúdo</Label><Input value={(c as TextComponent).content} onChange={e => update({ content: e.target.value })} className="h-7 text-xs" disabled={isLocked} /></div>
            )}
            {comp.type === "dynamic_text" && (
              <>
                <div>
                  <Label className="text-xs">Campo de dados</Label>
                  <Select value={(c as DynamicTextComponent).field} onValueChange={v => update({ field: v })} disabled={isLocked}>
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
                  <div><Label className="text-xs">Prefixo</Label><Input value={(c as DynamicTextComponent).prefix ?? ""} onChange={e => update({ prefix: e.target.value })} className="h-7 text-xs" disabled={isLocked} /></div>
                  <div><Label className="text-xs">Sufixo</Label><Input value={(c as DynamicTextComponent).suffix ?? ""} onChange={e => update({ suffix: e.target.value })} className="h-7 text-xs" disabled={isLocked} /></div>
                </div>
              </>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">Tamanho (pt)</Label><Input type="number" value={c.fontSize} onChange={e => update({ fontSize: Number(e.target.value) })} className="h-7 text-xs" min={6} max={72} disabled={isLocked} /></div>
              <div>
                <Label className="text-xs">Peso</Label>
                <Select value={c.fontWeight ?? "normal"} onValueChange={v => update({ fontWeight: v as "normal" | "bold" })} disabled={isLocked}>
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
                <Select value={c.align ?? "left"} onValueChange={v => update({ align: v as "left" | "center" | "right" })} disabled={isLocked}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="left">Esquerda</SelectItem>
                    <SelectItem value="center">Centro</SelectItem>
                    <SelectItem value="right">Direita</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Cor</Label><Input type="color" value={c.color ?? "#000000"} onChange={e => update({ color: e.target.value })} className="h-7 p-0.5" disabled={isLocked} /></div>
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
              <Select value={c.field} onValueChange={v => update({ field: v })} disabled={isLocked}>
                <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Selecionar campo..." /></SelectTrigger>
                <SelectContent>
                  {fields.map(f => (<SelectItem key={f.key} value={f.key} className="text-xs">{f.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            {comp.type === "barcode" && (
              <>
                <div>
                  <Label className="text-xs">Formato</Label>
                  <Select value={(c as BarcodeComponent).format} onValueChange={v => update({ format: v as BarcodeComponent["format"] })} disabled={isLocked}>
                    <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["CODE128", "CODE39", "EAN13", "EAN8", "ITF14"].map(f => (<SelectItem key={f} value={f} className="text-xs">{f}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="show-value" checked={(c as BarcodeComponent).showValue !== false} onChange={e => update({ showValue: e.target.checked })} disabled={isLocked} />
                  <Label htmlFor="show-value" className="text-xs">Mostrar valor abaixo</Label>
                </div>
              </>
            )}
            {comp.type === "qrcode" && (
              <div>
                <Label className="text-xs">Correção de erro</Label>
                <Select value={(c as QRCodeComponent).errorLevel ?? "M"} onValueChange={v => update({ errorLevel: v as "L"|"M"|"Q"|"H" })} disabled={isLocked}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="L">Baixa (L)</SelectItem>
                    <SelectItem value="M">Média (M)</SelectItem>
                    <SelectItem value="Q">Alta (Q)</SelectItem>
                    <SelectItem value="H">Máxima (H)</SelectItem>
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
              <Select value={c.orientation} onValueChange={v => update({ orientation: v as "horizontal" | "vertical" })} disabled={isLocked}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="horizontal">Horizontal</SelectItem>
                  <SelectItem value="vertical">Vertical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">Espessura (px)</Label><Input type="number" value={c.strokeWidth ?? 1} onChange={e => update({ strokeWidth: Number(e.target.value) })} className="h-7 text-xs" min={1} disabled={isLocked} /></div>
              <div><Label className="text-xs">Cor</Label><Input type="color" value={c.color ?? "#000000"} onChange={e => update({ color: e.target.value })} className="h-7 p-0.5" disabled={isLocked} /></div>
            </div>
          </>
        );
      })()}
      {comp.type === "rectangle" && (() => {
        const c = comp as RectangleComponent;
        return (
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-xs">Preenchimento</Label><Input type="color" value={c.fillColor ?? "#ffffff"} onChange={e => update({ fillColor: e.target.value })} className="h-7 p-0.5" disabled={isLocked} /></div>
            <div><Label className="text-xs">Borda</Label><Input type="color" value={c.strokeColor ?? "#000000"} onChange={e => update({ strokeColor: e.target.value })} className="h-7 p-0.5" disabled={isLocked} /></div>
            <div><Label className="text-xs">Espessura borda</Label><Input type="number" value={c.strokeWidth ?? 1} onChange={e => update({ strokeWidth: Number(e.target.value) })} className="h-7 text-xs" min={0} disabled={isLocked} /></div>
            <div><Label className="text-xs">Raio (px)</Label><Input type="number" value={c.borderRadius ?? 0} onChange={e => update({ borderRadius: Number(e.target.value) })} className="h-7 text-xs" min={0} disabled={isLocked} /></div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── Configuração da Etiqueta (popover) ────────────────────────────────────
function DocumentSettings({
  currentWidthMm, currentHeightMm, originalWidthMm, originalHeightMm,
  displayUnit, setDisplayUnit, isReadOnly, outOfBoundsCount, onChange, onReset,
}: {
  currentWidthMm: number;
  currentHeightMm: number;
  originalWidthMm: number;
  originalHeightMm: number;
  displayUnit: "mm" | "cm" | "in";
  setDisplayUnit: (u: "mm" | "cm" | "in") => void;
  isReadOnly: boolean;
  outOfBoundsCount: number;
  onChange: (widthMm: number, heightMm: number) => void;
  onReset: () => void;
}) {
  const toDisplay = (mm: number) => {
    if (displayUnit === "cm") return (mm / 10).toFixed(2);
    if (displayUnit === "in") return (mm / 25.4).toFixed(3);
    return String(Math.round(mm));
  };
  const fromDisplay = (raw: string): number | null => {
    const n = parseFloat(raw.replace(",", "."));
    if (!isFinite(n) || n <= 0) return null;
    let mm = n;
    if (displayUnit === "cm") mm = n * 10;
    if (displayUnit === "in") mm = n * 25.4;
    // schema é integer em mm
    return Math.max(5, Math.min(500, Math.round(mm)));
  };

  const PRESETS: { label: string; w: number; h: number }[] = [
    { label: "100×150 (envio)", w: 100, h: 150 },
    { label: "100×70",  w: 100, h: 70 },
    { label: "100×50",  w: 100, h: 50 },
    { label: "60×40",   w: 60,  h: 40 },
    { label: "50×30",   w: 50,  h: 30 },
    { label: "38×25",   w: 38,  h: 25 },
  ];

  const swapOrientation = () => onChange(currentHeightMm, currentWidthMm);
  const isLandscape = currentWidthMm >= currentHeightMm;
  const isOriginal = currentWidthMm === originalWidthMm && currentHeightMm === originalHeightMm;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Configuração da Etiqueta
        </h4>
        <div className="flex items-center gap-1" data-testid="group-display-unit">
          {(["mm", "cm", "in"] as const).map(u => (
            <Button
              key={u}
              type="button"
              variant={displayUnit === u ? "secondary" : "ghost"}
              size="sm"
              className="h-6 px-1.5 text-[10px]"
              onClick={() => setDisplayUnit(u)}
              data-testid={`btn-unit-${u}`}
            >
              {u}
            </Button>
          ))}
        </div>
      </div>

      {isReadOnly && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          Modelo do sistema (somente leitura). Altere uma cópia para editar.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="doc-width" className="text-[11px]">Largura ({displayUnit})</Label>
          <Input
            id="doc-width"
            type="number"
            inputMode="decimal"
            step={displayUnit === "mm" ? "1" : displayUnit === "cm" ? "0.1" : "0.01"}
            value={toDisplay(currentWidthMm)}
            onChange={(e) => {
              const mm = fromDisplay(e.target.value);
              if (mm !== null) onChange(mm, currentHeightMm);
            }}
            disabled={isReadOnly}
            className="h-8 text-xs"
            data-testid="input-doc-width"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="doc-height" className="text-[11px]">Altura ({displayUnit})</Label>
          <Input
            id="doc-height"
            type="number"
            inputMode="decimal"
            step={displayUnit === "mm" ? "1" : displayUnit === "cm" ? "0.1" : "0.01"}
            value={toDisplay(currentHeightMm)}
            onChange={(e) => {
              const mm = fromDisplay(e.target.value);
              if (mm !== null) onChange(currentWidthMm, mm);
            }}
            disabled={isReadOnly}
            className="h-8 text-xs"
            data-testid="input-doc-height"
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">Orientação</span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant={isLandscape ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2 text-[10px]"
            onClick={() => { if (!isLandscape) swapOrientation(); }}
            disabled={isReadOnly}
            data-testid="btn-orient-landscape"
            title="Paisagem"
          >
            <RectangleHorizontal className="h-3.5 w-3.5 mr-1" /> Paisagem
          </Button>
          <Button
            type="button"
            variant={!isLandscape ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2 text-[10px]"
            onClick={() => { if (isLandscape) swapOrientation(); }}
            disabled={isReadOnly}
            data-testid="btn-orient-portrait"
            title="Retrato"
          >
            <RectangleVertical className="h-3.5 w-3.5 mr-1" /> Retrato
          </Button>
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-[11px] text-muted-foreground">Predefinições (mm)</p>
        <div className="grid grid-cols-3 gap-1">
          {PRESETS.map(p => (
            <Button
              key={p.label}
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-[10px] px-1"
              onClick={() => onChange(p.w, p.h)}
              disabled={isReadOnly}
              data-testid={`btn-preset-${p.w}x${p.h}`}
            >
              {p.w}×{p.h}
            </Button>
          ))}
        </div>
      </div>

      {outOfBoundsCount > 0 && (
        <div className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800 p-2">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <p className="text-[11px] text-amber-800 dark:text-amber-300" data-testid="text-oob-warning">
            {outOfBoundsCount} {outOfBoundsCount === 1 ? "componente está fora" : "componentes estão fora"} da área útil. Ajuste posições ou aumente o tamanho.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between pt-1 border-t border-border">
        <p className="text-[10px] text-muted-foreground">
          Original: {originalWidthMm}×{originalHeightMm}mm
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[10px]"
          onClick={onReset}
          disabled={isReadOnly || isOriginal}
          data-testid="btn-reset-dims"
        >
          Restaurar
        </Button>
      </div>

      <p className="text-[10px] text-muted-foreground italic">
        As alterações entram em vigor imediatamente no canvas e na pré-visualização. Salve para persistir.
      </p>
    </div>
  );
}

export default function LabelStudioPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [layout, setLayout] = useState<LabelLayout>({ components: [] });
  const [history, setHistory] = useState<LabelLayout[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const [isDirty, setIsDirty] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewPosition, setPreviewPositionState] = useState<"right" | "left" | "top" | "bottom">(() => {
    if (typeof window === "undefined") return "right";
    const v = window.localStorage.getItem("label-studio-preview-pos");
    return v === "left" || v === "top" || v === "bottom" || v === "right" ? v : "right";
  });
  const setPreviewPosition = (p: "right" | "left" | "top" | "bottom") => {
    setPreviewPositionState(p);
    try { window.localStorage.setItem("label-studio-preview-pos", p); } catch {}
  };
  // Dimensões editáveis (mm internamente, sempre). Quando null, usa as do template.
  const [editedWidthMm, setEditedWidthMm] = useState<number | null>(null);
  const [editedHeightMm, setEditedHeightMm] = useState<number | null>(null);
  // Unidade exibida no painel "Configuração da Etiqueta" (apenas display).
  const [displayUnit, setDisplayUnit] = useState<"mm" | "cm" | "in">(() => {
    if (typeof window === "undefined") return "mm";
    const v = window.localStorage.getItem("label-studio-unit");
    return v === "cm" || v === "in" ? v : "mm";
  });
  const setDisplayUnitPersisted = (u: "mm" | "cm" | "in") => {
    setDisplayUnit(u);
    try { window.localStorage.setItem("label-studio-unit", u); } catch {}
  };
  const [docSettingsOpen, setDocSettingsOpen] = useState(false);
  const [dragging, setDragging] = useState<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [resizing, setResizing] = useState<{ id: string; handle: string; startX: number; startY: number; origX: number; origY: number; origW: number; origH: number } | null>(null);
  const [snapGrid, setSnapGrid] = useState(true);
  const [showMargins, setShowMargins] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [clipboard, setClipboard] = useState<LabelComponent | null>(null);
  const [showExitConfirm, setShowExitConfirm] = useState<string | null>(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const canvasRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const { data: template, isLoading } = useQuery<LabelTemplate>({
    queryKey: ["/api/labels/templates", id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/labels/templates/${id}`);
      return res.json();
    },
    enabled: !!id,
  });
  const isReadOnly = template?.companyId === null;

  useEffect(() => {
    if (template) {
      const initial = (template.layoutJson as LabelLayout) ?? { components: [] };
      setLayout(initial);
      setHistory([initial]);
      setHistoryIdx(0);
      // Reset dimensões editadas para refletir o template carregado/salvo
      setEditedWidthMm(null);
      setEditedHeightMm(null);
      setIsDirty(false);
    }
  }, [template]);

  // ─── Histórico (undo/redo) ───────────────────────────────────────────────
  // Dimensões efetivas (preferem valor editado sobre o do template).
  // Definidas aqui para que callbacks abaixo possam referenciá-las.
  const widthMm = editedWidthMm ?? template?.widthMm ?? 0;
  const heightMm = editedHeightMm ?? template?.heightMm ?? 0;
  const dimsChanged =
    !!template &&
    ((editedWidthMm !== null && editedWidthMm !== template.widthMm) ||
      (editedHeightMm !== null && editedHeightMm !== template.heightMm));

  const pushHistory = useCallback((next: LabelLayout) => {
    setHistory(prev => {
      const trimmed = prev.slice(0, historyIdx + 1);
      const newHist = [...trimmed, next].slice(-HISTORY_LIMIT);
      setHistoryIdx(newHist.length - 1);
      return newHist;
    });
  }, [historyIdx]);

  const commitLayout = useCallback((updater: (prev: LabelLayout) => LabelLayout) => {
    setLayout(prev => {
      const next = updater(prev);
      pushHistory(next);
      setIsDirty(true);
      return next;
    });
  }, [pushHistory]);

  const undo = useCallback(() => {
    if (historyIdx <= 0) return;
    const newIdx = historyIdx - 1;
    setHistoryIdx(newIdx);
    setLayout(history[newIdx]);
    setIsDirty(true);
  }, [history, historyIdx]);

  const redo = useCallback(() => {
    if (historyIdx >= history.length - 1) return;
    const newIdx = historyIdx + 1;
    setHistoryIdx(newIdx);
    setLayout(history[newIdx]);
    setIsDirty(true);
  }, [history, historyIdx]);

  // ─── Aviso ao sair com alterações ────────────────────────────────────────
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // ─── Preview real ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!showPreview || !template) { setPreviewHtml(null); return; }
    let cancelled = false;
    setPreviewLoading(true);
    const ctx = template.context as LabelContext;
    const sampleData: Record<string, string> = Object.fromEntries(
      (LABEL_DATA_FIELDS[ctx] ?? []).map(f => [f.key, f.example ?? f.label])
    );
    const effW = editedWidthMm ?? template.widthMm;
    const effH = editedHeightMm ?? template.heightMm;
    const previewTemplate = { ...template, widthMm: effW, heightMm: effH, layoutJson: layout };
    renderLabelToHtml(previewTemplate, sampleData).then(html => {
      if (!cancelled) { setPreviewHtml(html); setPreviewLoading(false); }
    }).catch(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [showPreview, layout, template, editedWidthMm, editedHeightMm]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: { layoutJson: LabelLayout; widthMm?: number; heightMm?: number } = { layoutJson: layout };
      if (editedWidthMm !== null && template && editedWidthMm !== template.widthMm) body.widthMm = editedWidthMm;
      if (editedHeightMm !== null && template && editedHeightMm !== template.heightMm) body.heightMm = editedHeightMm;
      const res = await apiRequest("PUT", `/api/labels/templates/${id}`, body);
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

  // ─── Operações com componentes ──────────────────────────────────────────
  const updateComponent = useCallback((updated: LabelComponent, fromInteraction = false) => {
    if (fromInteraction) {
      // durante drag/resize: atualiza sem entrar no histórico (commit no mouseup)
      setLayout(prev => ({ components: prev.components.map(c => c.id === updated.id ? updated : c) }));
      setIsDirty(true);
    } else {
      commitLayout(prev => ({ components: prev.components.map(c => c.id === updated.id ? updated : c) }));
    }
  }, [commitLayout]);

  const deleteComponent = useCallback((compId: string) => {
    commitLayout(prev => ({ components: prev.components.filter(c => c.id !== compId) }));
    setSelectedId(null);
  }, [commitLayout]);

  const duplicateComponent = useCallback((compId: string) => {
    const orig = layoutRef.current.components.find(c => c.id === compId);
    if (!orig) return;
    const copy: LabelComponent = { ...orig, id: crypto.randomUUID(), x: orig.x + 3, y: orig.y + 3 } as LabelComponent;
    commitLayout(prev => ({ components: [...prev.components, copy] }));
    setSelectedId(copy.id);
  }, [commitLayout]);

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
    commitLayout(prev => ({ components: [...prev.components, newComp] }));
    setSelectedId(newComp.id);
  }, [layout.components.length, template?.context, commitLayout]);

  const moveLayer = useCallback((compId: string, dir: "up" | "down") => {
    commitLayout(prev => {
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
  }, [commitLayout]);

  // ─── Alinhamento ─────────────────────────────────────────────────────────
  const alignSelected = useCallback((mode: "left"|"center-h"|"right"|"top"|"center-v"|"bottom") => {
    if (!selectedId || !template) return;
    const comp = layoutRef.current.components.find(c => c.id === selectedId);
    if (!comp || comp.locked) return;
    const updated = { ...comp };
    if (mode === "left") updated.x = 0;
    if (mode === "right") updated.x = widthMm - comp.width;
    if (mode === "center-h") updated.x = (widthMm - comp.width) / 2;
    if (mode === "top") updated.y = 0;
    if (mode === "bottom") updated.y = heightMm - comp.height;
    if (mode === "center-v") updated.y = (heightMm - comp.height) / 2;
    updated.x = Math.round(updated.x * 10) / 10;
    updated.y = Math.round(updated.y * 10) / 10;
    updateComponent(updated);
  }, [selectedId, template, widthMm, heightMm, updateComponent]);

  // ─── Drag/resize ─────────────────────────────────────────────────────────
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent, compId: string) => {
    e.stopPropagation();
    setSelectedId(compId);
    const comp = layout.components.find(c => c.id === compId);
    if (!comp || comp.locked) return;
    setDragging({ id: compId, startX: e.clientX, startY: e.clientY, origX: comp.x, origY: comp.y });
  }, [layout.components]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (canvasRef.current && template) {
      const rect = canvasRef.current.getBoundingClientRect();
      const mxMm = canvasPxToMm(e.clientX - rect.left, zoom);
      const myMm = canvasPxToMm(e.clientY - rect.top, zoom);
      if (mxMm >= 0 && myMm >= 0 && mxMm <= widthMm && myMm <= heightMm) {
        setMousePos({ x: Math.round(mxMm * 10) / 10, y: Math.round(myMm * 10) / 10 });
      } else {
        setMousePos(null);
      }
    }
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
      const MIN = 1;
      if (nw < MIN) { if (handle.includes("w")) nx = origX + origW - MIN; nw = MIN; }
      if (nh < MIN) { if (handle.includes("n")) ny = origY + origH - MIN; nh = MIN; }
      const snap = (v: number) => snapGrid ? snapMm(v) : Math.round(v * 10) / 10;
      nx = Math.max(0, Math.min(widthMm - MIN, snap(nx)));
      ny = Math.max(0, Math.min(heightMm - MIN, snap(ny)));
      nw = Math.max(MIN, Math.min(widthMm - nx, snap(nw)));
      nh = Math.max(MIN, Math.min(heightMm - ny, snap(nh)));
      updateComponent({ ...comp, x: nx, y: ny, width: nw, height: nh }, true);
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
    const newX = Math.max(0, Math.min(widthMm - comp.width, snappedX));
    const newY = Math.max(0, Math.min(heightMm - comp.height, snappedY));
    updateComponent({ ...comp, x: newX, y: newY }, true);
  }, [dragging, resizing, layout.components, zoom, template, widthMm, heightMm, updateComponent, snapGrid]);

  const handleMouseUp = useCallback(() => {
    if (dragging || resizing) {
      // commit no histórico ao terminar drag/resize
      pushHistory(layoutRef.current);
    }
    setDragging(null);
    setResizing(null);
  }, [dragging, resizing, pushHistory]);

  const handleResizeStart = useCallback((e: React.MouseEvent, compId: string, handle: string) => {
    e.stopPropagation();
    e.preventDefault();
    const comp = layout.components.find(c => c.id === compId);
    if (!comp || comp.locked) return;
    setResizing({ id: compId, handle, startX: e.clientX, startY: e.clientY, origX: comp.x, origY: comp.y, origW: comp.width, origH: comp.height });
  }, [layout.components]);

  // ─── Atalhos de teclado ──────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      const isInput = tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.isContentEditable);
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (meta && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) { e.preventDefault(); redo(); return; }
      if (meta && e.key.toLowerCase() === "s") { e.preventDefault(); if (!isReadOnly && isDirty) saveMutation.mutate(); return; }
      if (isInput) return;
      if (!selectedId) return;
      const comp = layoutRef.current.components.find(c => c.id === selectedId);
      if (!comp) return;
      if (meta && e.key.toLowerCase() === "d") { e.preventDefault(); duplicateComponent(comp.id); return; }
      if (meta && e.key.toLowerCase() === "c") { e.preventDefault(); setClipboard(comp); toast({ title: "Componente copiado" }); return; }
      if (meta && e.key.toLowerCase() === "v" && clipboard) {
        e.preventDefault();
        const copy: LabelComponent = { ...clipboard, id: crypto.randomUUID(), x: clipboard.x + 3, y: clipboard.y + 3 } as LabelComponent;
        commitLayout(prev => ({ components: [...prev.components, copy] }));
        setSelectedId(copy.id);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") { if (!comp.locked) { e.preventDefault(); deleteComponent(comp.id); } return; }
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) && !comp.locked && template) {
        e.preventDefault();
        const step = e.shiftKey ? 5 : SNAP_MM;
        let nx = comp.x, ny = comp.y;
        if (e.key === "ArrowLeft") nx -= step;
        if (e.key === "ArrowRight") nx += step;
        if (e.key === "ArrowUp") ny -= step;
        if (e.key === "ArrowDown") ny += step;
        nx = Math.max(0, Math.min(widthMm - comp.width, Math.round(nx * 10) / 10));
        ny = Math.max(0, Math.min(heightMm - comp.height, Math.round(ny * 10) / 10));
        updateComponent({ ...comp, x: nx, y: ny });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, selectedId, deleteComponent, duplicateComponent, clipboard, commitLayout, updateComponent, template, widthMm, heightMm, isReadOnly, isDirty, saveMutation, toast]);

  // ─── Validações visuais ──────────────────────────────────────────────────
  const validationWarnings = useMemo(() => {
    if (!template) return [];
    const warns: { compId: string; msg: string }[] = [];
    for (const c of layout.components) {
      if (c.x < 0 || c.y < 0 || c.x + c.width > widthMm || c.y + c.height > heightMm) {
        warns.push({ compId: c.id, msg: `${compLabel(c)}: fora da área imprimível` });
      } else if (c.x < SAFETY_MARGIN_MM || c.y < SAFETY_MARGIN_MM || c.x + c.width > widthMm - SAFETY_MARGIN_MM || c.y + c.height > heightMm - SAFETY_MARGIN_MM) {
        warns.push({ compId: c.id, msg: `${compLabel(c)}: invade margem de segurança` });
      }
      if (c.type === "barcode" && (c.width < 20 || c.height < 8)) {
        warns.push({ compId: c.id, msg: `${compLabel(c)}: muito pequeno para leitura confiável` });
      }
    }
    return warns;
  }, [layout, template, widthMm, heightMm]);

  const tryNavigateBack = () => {
    if (isDirty) setShowExitConfirm("/admin/label-templates");
    else navigate("/admin/label-templates");
  };

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
  const canvasW = mmToCanvasPx(widthMm, zoom);
  const canvasH = mmToCanvasPx(heightMm, zoom);
  const TOOLBAR_ITEMS: { type: LabelComponent["type"]; label: string; Icon: LucideIcon }[] = [
    { type: "text", label: "Texto", Icon: Type },
    { type: "dynamic_text", label: "Campo", Icon: AlignLeft },
    { type: "barcode", label: "Código de Barras", Icon: Barcode },
    { type: "qrcode", label: "QR Code", Icon: QrCode },
    { type: "line", label: "Linha", Icon: Minus },
    { type: "rectangle", label: "Caixa", Icon: Square },
  ];

  const fitToScreen = () => {
    if (!canvasRef.current?.parentElement?.parentElement) return;
    const container = canvasRef.current.parentElement.parentElement;
    const availW = container.clientWidth - 80;
    const availH = container.clientHeight - 80;
    const z = Math.min(availW / mmToCanvasPx(widthMm, 100), availH / mmToCanvasPx(heightMm, 100)) * 100;
    setZoom(Math.max(25, Math.min(400, Math.round(z))));
  };

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-card shrink-0 flex-wrap">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={tryNavigateBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-foreground truncate flex items-center gap-2">
            {template.name}
            {isReadOnly && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">Sistema (somente leitura)</span>}
            {template.groupName && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">{template.groupName}</span>}
          </h1>
          <p className="text-[11px] text-muted-foreground">
            {LABEL_CONTEXT_LABELS[context]} · {widthMm}×{heightMm}mm
            {dimsChanged && <span className="text-amber-600 dark:text-amber-400"> (era {template.widthMm}×{template.heightMm})</span>}
            {" "}· {template.dpi} DPI
          </p>
        </div>

        <div className="flex-1" />

        {/* Histórico */}
        <div className="flex items-center gap-0.5 border-r border-border pr-2 mr-1">
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={undo} disabled={historyIdx <= 0} title="Desfazer (Ctrl+Z)" data-testid="btn-undo">
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={redo} disabled={historyIdx >= history.length - 1} title="Refazer (Ctrl+Y)" data-testid="btn-redo">
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Alinhamento */}
        <div className="flex items-center gap-0.5 border-r border-border pr-2 mr-1">
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => alignSelected("left")} disabled={!selectedComp || isReadOnly} title="Alinhar à esquerda" data-testid="btn-align-left"><AlignStartVertical className="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => alignSelected("center-h")} disabled={!selectedComp || isReadOnly} title="Centralizar horizontalmente" data-testid="btn-align-center-h"><AlignCenterVertical className="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => alignSelected("right")} disabled={!selectedComp || isReadOnly} title="Alinhar à direita" data-testid="btn-align-right"><AlignEndVertical className="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => alignSelected("top")} disabled={!selectedComp || isReadOnly} title="Alinhar topo" data-testid="btn-align-top"><AlignStartHorizontal className="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => alignSelected("center-v")} disabled={!selectedComp || isReadOnly} title="Centralizar verticalmente" data-testid="btn-align-center-v"><AlignCenterHorizontal className="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => alignSelected("bottom")} disabled={!selectedComp || isReadOnly} title="Alinhar base" data-testid="btn-align-bottom"><AlignEndHorizontal className="h-3.5 w-3.5" /></Button>
        </div>

        {/* Zoom */}
        <div className="flex items-center gap-1 border-r border-border pr-2 mr-1">
          <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => setZoom(z => Math.max(25, z - 10))} title="Diminuir zoom"><ZoomOut className="h-3.5 w-3.5" /></Button>
          <Input type="number" value={zoom} onChange={e => setZoom(Math.max(25, Math.min(400, Number(e.target.value) || 100)))} className="h-7 w-14 text-xs text-center" data-testid="input-zoom" />
          <span className="text-[10px] text-muted-foreground">%</span>
          <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => setZoom(z => Math.min(400, z + 10))} title="Aumentar zoom"><ZoomIn className="h-3.5 w-3.5" /></Button>
          <Button variant="outline" size="sm" className="h-7 px-2 text-[10px]" onClick={fitToScreen} title="Ajustar à tela"><Maximize2 className="h-3 w-3 mr-1" />Ajustar</Button>
          <Button variant="outline" size="sm" className="h-7 px-2 text-[10px]" onClick={() => setZoom(100)} title="100% (tamanho real)"><SquareIcon className="h-3 w-3 mr-1" />1:1</Button>
        </div>

        {/* Configuração da Etiqueta */}
        <Popover open={docSettingsOpen} onOpenChange={setDocSettingsOpen}>
          <PopoverTrigger asChild>
            <Button
              variant={dimsChanged ? "secondary" : "outline"}
              size="sm"
              className="h-7 px-2 text-[10px]"
              title="Configuração da etiqueta (tamanho)"
              data-testid="btn-doc-settings"
            >
              <Settings2 className="h-3.5 w-3.5 mr-1" />
              {widthMm}×{heightMm}mm{dimsChanged && "*"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-3" align="end">
            <DocumentSettings
              currentWidthMm={widthMm}
              currentHeightMm={heightMm}
              originalWidthMm={template.widthMm}
              originalHeightMm={template.heightMm}
              displayUnit={displayUnit}
              setDisplayUnit={setDisplayUnitPersisted}
              isReadOnly={!!isReadOnly}
              outOfBoundsCount={layout.components.filter(c =>
                c.x < 0 || c.y < 0 || c.x + c.width > widthMm || c.y + c.height > heightMm
              ).length}
              onChange={(w, h) => {
                if (w !== widthMm) { setEditedWidthMm(w); setIsDirty(true); }
                if (h !== heightMm) { setEditedHeightMm(h); setIsDirty(true); }
              }}
              onReset={() => {
                setEditedWidthMm(null);
                setEditedHeightMm(null);
              }}
            />
          </PopoverContent>
        </Popover>

        {/* Toggles */}
        <Button variant={snapGrid ? "secondary" : "outline"} size="sm" className="h-7 w-7 p-0" onClick={() => setSnapGrid(v => !v)} title="Snap ao grid (0,5mm)" data-testid="btn-toggle-snap">
          <Grid className="h-3.5 w-3.5" />
        </Button>
        <Button variant={showGrid ? "secondary" : "outline"} size="sm" className="h-7 px-2 text-[10px]" onClick={() => setShowGrid(v => !v)} title="Mostrar grade">Grade</Button>
        <Button variant={showMargins ? "secondary" : "outline"} size="sm" className="h-7 px-2 text-[10px]" onClick={() => setShowMargins(v => !v)} title="Mostrar margens de segurança" data-testid="btn-toggle-margins">Margens</Button>
        <Button variant={showPreview ? "secondary" : "outline"} size="sm" className="h-7" onClick={() => setShowPreview(v => !v)} data-testid="btn-toggle-preview">
          {showPreview ? <><EyeOff className="h-3.5 w-3.5 mr-1.5" />Fechar</> : <><Eye className="h-3.5 w-3.5 mr-1.5" />Preview</>}
        </Button>

        {!isReadOnly && (
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={!isDirty || saveMutation.isPending} data-testid="btn-save-studio" className={cn(!isDirty && "opacity-50")}>
            <Save className="h-4 w-4 mr-1.5" />
            {saveMutation.isPending ? "Salvando..." : isDirty ? "Salvar*" : "Salvo"}
          </Button>
        )}
        <Button variant="outline" size="sm" className="h-7" onClick={() => navigate("/admin/label-print")} data-testid="btn-print-studio" title="Ir para impressão em lote">
          <Printer className="h-3.5 w-3.5 mr-1" />Imprimir
        </Button>
        <Button
          variant="outline" size="sm" className="h-7 w-7 p-0"
          onClick={() => setRightPanelOpen(v => !v)}
          title={rightPanelOpen ? "Esconder painel lateral" : "Mostrar painel lateral"}
          data-testid="btn-toggle-right-panel"
        >
          {rightPanelOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
        </Button>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Toolbox + camadas */}
        <div className="w-44 border-r border-border bg-card flex flex-col shrink-0 overflow-hidden">
          <div className="px-2 py-2 border-b border-border">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Componentes</p>
          </div>
          <div className="p-1.5 space-y-1">
            {TOOLBAR_ITEMS.map(({ type, label, Icon }) => (
              <button key={type} className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-foreground hover:bg-muted transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed" onClick={() => addComponent(type)} disabled={isReadOnly} data-testid={`btn-add-${type}`}>
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {label}
              </button>
            ))}
          </div>
          <div className="px-2 py-1.5 border-b border-t border-border mt-1 flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Camadas</p>
            <span className="text-[10px] text-muted-foreground">{layout.components.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
            {[...layout.components].reverse().map(c => {
              const warn = validationWarnings.find(w => w.compId === c.id);
              return (
                <div key={c.id} className={cn("group flex items-center gap-1 px-1.5 py-1 rounded text-xs cursor-pointer transition-colors", selectedId === c.id ? "bg-primary/15 text-primary font-medium" : "hover:bg-muted text-foreground", c.hidden && "opacity-50")} onClick={() => setSelectedId(c.id)} data-testid={`layer-${c.id}`}>
                  {warn && <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />}
                  <span className="flex-1 truncate">{compLabel(c)}</span>
                  <button onClick={e => { e.stopPropagation(); updateComponent({ ...c, hidden: !c.hidden }); }} className="opacity-0 group-hover:opacity-60 hover:!opacity-100" title={c.hidden ? "Mostrar" : "Ocultar"}>
                    {c.hidden ? <EyeOffIcon className="h-3 w-3" /> : <EyeIcon className="h-3 w-3" />}
                  </button>
                  <button onClick={e => { e.stopPropagation(); updateComponent({ ...c, locked: !c.locked }); }} className="opacity-0 group-hover:opacity-60 hover:!opacity-100" title={c.locked ? "Desbloquear" : "Bloquear"}>
                    {c.locked ? <Lock className="h-3 w-3 text-amber-500" /> : <Unlock className="h-3 w-3" />}
                  </button>
                  <button onClick={e => { e.stopPropagation(); duplicateComponent(c.id); }} className="opacity-0 group-hover:opacity-60 hover:!opacity-100" title="Duplicar"><Copy className="h-3 w-3" /></button>
                  <button onClick={e => { e.stopPropagation(); moveLayer(c.id, "up"); }} className="opacity-0 group-hover:opacity-60 hover:!opacity-100"><ChevronUp className="h-3 w-3" /></button>
                  <button onClick={e => { e.stopPropagation(); moveLayer(c.id, "down"); }} className="opacity-0 group-hover:opacity-60 hover:!opacity-100"><ChevronDown className="h-3 w-3" /></button>
                </div>
              );
            })}
            {layout.components.length === 0 && (<p className="text-xs text-muted-foreground text-center py-4">Nenhum componente</p>)}
          </div>
          {validationWarnings.length > 0 && (
            <div className="border-t border-amber-500/30 bg-amber-50 dark:bg-amber-900/20 p-2 max-h-32 overflow-y-auto">
              <p className="text-[10px] font-medium text-amber-700 dark:text-amber-300 uppercase tracking-wider mb-1 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Avisos ({validationWarnings.length})</p>
              {validationWarnings.map((w, i) => (
                <p key={i} className="text-[10px] text-amber-800 dark:text-amber-200 leading-tight">• {w.msg}</p>
              ))}
            </div>
          )}
        </div>

        {/* Área central: canvas + (opcionalmente) preview lateral/inferior */}
        <div
          className={cn(
            "flex flex-1 min-h-0 overflow-hidden",
            previewPosition === "right" && "flex-row",
            previewPosition === "left" && "flex-row-reverse",
            previewPosition === "bottom" && "flex-col",
            previewPosition === "top" && "flex-col-reverse",
          )}
        >
        <div className="flex-1 overflow-auto bg-muted/30 flex items-center justify-center p-8 relative" onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
          <div style={{ position: "relative", margin: RULER_SIZE_PX, flexShrink: 0 }}>
            <div
              ref={canvasRef}
              style={{ position: "relative", width: canvasW, height: canvasH, background: "white", boxShadow: "0 4px 24px rgba(0,0,0,0.15)", cursor: dragging ? "grabbing" : "default", flexShrink: 0, outline: "1px solid hsl(var(--border))" }}
              onMouseDown={e => {
                // Só desseleciona se o usuário clicou no fundo do canvas (não num componente).
                if (e.target === e.currentTarget) setSelectedId(null);
              }}
              data-testid="label-canvas"
            >
              <Ruler length={widthMm} zoom={zoom} side="top" />
              <Ruler length={widthMm} zoom={zoom} side="bottom" />
              <Ruler length={heightMm} zoom={zoom} side="left" />
              <Ruler length={heightMm} zoom={zoom} side="right" />
              {showGrid && (
                <svg style={{ position: "absolute", top: 0, left: 0, width: canvasW, height: canvasH, pointerEvents: "none", zIndex: 1 }}>
                  <defs>
                    <pattern id="grid-pattern" width={mmToCanvasPx(5, zoom)} height={mmToCanvasPx(5, zoom)} patternUnits="userSpaceOnUse">
                      <path d={`M ${mmToCanvasPx(5, zoom)} 0 L 0 0 0 ${mmToCanvasPx(5, zoom)}`} fill="none" stroke="rgba(100,116,139,0.15)" strokeWidth="0.5" />
                    </pattern>
                  </defs>
                  <rect width="100%" height="100%" fill="url(#grid-pattern)" />
                </svg>
              )}
              {showMargins && (
                <div style={{
                  position: "absolute",
                  top: mmToCanvasPx(SAFETY_MARGIN_MM, zoom),
                  left: mmToCanvasPx(SAFETY_MARGIN_MM, zoom),
                  width: mmToCanvasPx(widthMm - SAFETY_MARGIN_MM * 2, zoom),
                  height: mmToCanvasPx(heightMm - SAFETY_MARGIN_MM * 2, zoom),
                  border: "1px dashed rgba(239, 68, 68, 0.4)",
                  pointerEvents: "none",
                  zIndex: 999,
                }} />
              )}
              {layout.components.filter(c => !c.hidden).map(comp => {
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
                    cursor: comp.locked ? "not-allowed" : (dragging ? "grabbing" : "grab"),
                    outline: isSelected ? "2px solid #3b82f6" : (comp.locked ? "1px dashed rgba(245,158,11,0.5)" : "1px dashed transparent"),
                    zIndex: comp.zIndex ?? 0,
                    boxSizing: "border-box",
                    transform: comp.rotation ? `rotate(${comp.rotation}deg)` : undefined,
                    transformOrigin: "top left",
                  }} onMouseDown={e => handleCanvasMouseDown(e, comp.id)} data-testid={`component-${comp.id}`}>
                    <ComponentPreview comp={comp} zoom={zoom} />
                    {isSelected && !comp.locked && HANDLES.map(h => (
                      <div key={h.id} style={{ position: "absolute", width: 8, height: 8, background: "white", border: "2px solid #3b82f6", borderRadius: 1, ...h.style }} onMouseDown={e => handleResizeStart(e, comp.id, h.id)} />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Status bar */}
          <div className="absolute bottom-2 left-4 right-4 flex items-center justify-between text-[10px] text-muted-foreground pointer-events-none">
            <span>{mousePos ? `X: ${mousePos.x}mm  Y: ${mousePos.y}mm` : "—"}</span>
            <span>{layout.components.length} objeto(s) · zoom {zoom}%</span>
          </div>
        </div>

        {/* Preview real — posicionável (right/left/top/bottom) e em tamanho real (1:1) */}
        {showPreview && (() => {
          const isVerticalPanel = previewPosition === "right" || previewPosition === "left";
          const realW = template ? widthMm * CANVAS_SCALE : 0;
          const realH = template ? heightMm * CANVAS_SCALE : 0;
          const borderClass =
            previewPosition === "right"  ? "border-l" :
            previewPosition === "left"   ? "border-r" :
            previewPosition === "top"    ? "border-b" : "border-t";
          return (
            <div
              className={cn(
                "bg-card flex flex-col shrink-0 overflow-hidden border-border",
                borderClass,
                isVerticalPanel ? "h-full" : "w-full",
              )}
              style={isVerticalPanel
                ? { width: Math.max(288, Math.min(realW + 32, 560)) }
                : { height: Math.max(220, Math.min(realH + 64, 420)) }}
              data-testid="preview-panel"
            >
              <div className="px-2 py-2 border-b border-border flex items-center gap-1.5">
                <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex-1">
                  Preview Real <span className="text-[10px] text-muted-foreground/80 normal-case">· 1:1</span>
                </p>
                <div className="flex items-center gap-0.5 mr-1" title="Posição do preview">
                  <Button variant={previewPosition === "left"   ? "secondary" : "ghost"} size="sm" className="h-6 w-6 p-0"
                    onClick={() => setPreviewPosition("left")} title="Mover para a esquerda" data-testid="btn-preview-pos-left">
                    <PanelLeft className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant={previewPosition === "top"    ? "secondary" : "ghost"} size="sm" className="h-6 w-6 p-0"
                    onClick={() => setPreviewPosition("top")} title="Mover para o topo" data-testid="btn-preview-pos-top">
                    <PanelTop className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant={previewPosition === "bottom" ? "secondary" : "ghost"} size="sm" className="h-6 w-6 p-0"
                    onClick={() => setPreviewPosition("bottom")} title="Mover para baixo" data-testid="btn-preview-pos-bottom">
                    <PanelBottom className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant={previewPosition === "right"  ? "secondary" : "ghost"} size="sm" className="h-6 w-6 p-0"
                    onClick={() => setPreviewPosition("right")} title="Mover para a direita" data-testid="btn-preview-pos-right">
                    <PanelRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <span className="text-[10px] text-muted-foreground">{template ? `${widthMm}×${heightMm}mm` : "—"}</span>
              </div>
              <div className="flex-1 overflow-auto p-3 flex items-center justify-center bg-muted/40">
                {previewLoading ? (
                  <p className="text-xs text-muted-foreground">Renderizando...</p>
                ) : previewHtml && template ? (
                  <iframe
                    srcDoc={previewHtml}
                    style={{
                      border: "1px solid #ccc",
                      background: "white",
                      width: realW,
                      height: realH,
                      flexShrink: 0,
                      boxShadow: "0 2px 12px rgba(0,0,0,0.10)",
                    }}
                    scrolling="no"
                    title="Label Preview"
                    data-testid="preview-iframe"
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">Nenhum componente</p>
                )}
              </div>
            </div>
          );
        })()}
        </div>{/* /área central */}

        {/* Propriedades / Campos disponíveis (recolhível) */}
        {rightPanelOpen ? (
        <div className="w-60 border-l border-border bg-card overflow-y-auto shrink-0">
          <div className="p-2 border-b border-border flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{selectedComp ? "Propriedades" : "Campos Disponíveis"}</p>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 -mr-1" onClick={() => setRightPanelOpen(false)} title="Esconder painel" data-testid="btn-collapse-fields">
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
          {selectedComp ? (
            <div className="p-2">
              <PropertiesPanel comp={selectedComp} context={context} onChange={updateComponent} onDelete={() => deleteComponent(selectedComp.id)} />
            </div>
          ) : (
            <div className="p-2 space-y-3">
              <p className="text-xs text-muted-foreground">Adicione um componente do menu lateral, depois selecione-o para editar suas propriedades.</p>
              <div className="text-[10px] text-muted-foreground space-y-1 border-t border-border pt-2">
                <p className="font-medium text-foreground mb-1">Atalhos:</p>
                <p>Ctrl+Z / Ctrl+Y — desfazer/refazer</p>
                <p>Ctrl+S — salvar</p>
                <p>Ctrl+D — duplicar</p>
                <p>Ctrl+C / Ctrl+V — copiar/colar</p>
                <p>Delete — remover</p>
                <p>Setas — mover (Shift = 5mm)</p>
              </div>
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
        ) : (
          <div className="border-l border-border bg-card flex items-start shrink-0">
            <Button
              variant="ghost" size="sm" className="h-8 w-7 p-0 rounded-none"
              onClick={() => setRightPanelOpen(true)}
              title="Mostrar painel de propriedades / campos"
              data-testid="btn-expand-fields"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* Confirmar saída */}
      <Dialog open={!!showExitConfirm} onOpenChange={() => setShowExitConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Alterações não salvas</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Você tem alterações que ainda não foram salvas. Deseja sair sem salvar?</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExitConfirm(null)}>Continuar editando</Button>
            <Button variant="destructive" onClick={() => { const dst = showExitConfirm; setShowExitConfirm(null); setIsDirty(false); if (dst) navigate(dst); }}>Sair sem salvar</Button>
            <Button onClick={async () => { await saveMutation.mutateAsync(); const dst = showExitConfirm; setShowExitConfirm(null); if (dst) navigate(dst); }}>Salvar e sair</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
