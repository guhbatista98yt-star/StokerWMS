import type {
  LabelTemplate,
  LabelLayout,
  LabelComponent,
  TextComponent,
  DynamicTextComponent,
  BarcodeComponent,
  QRCodeComponent,
  LineComponent,
  RectangleComponent,
  PrintMediaLayout,
} from "@shared/schema";

const MM_TO_PX = 3.7795275591; // 96 DPI

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Sanitiza um valor de cor: aceita #abc / #aabbcc / rgb(...) / nomes simples. */
function safeColor(c: string | undefined, fallback = "#000"): string {
  if (!c) return fallback;
  const v = String(c).trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)) return v;
  if (/^rgba?\(\s*[\d.\s,%]+\)$/.test(v)) return v;
  if (/^[a-zA-Z]{1,30}$/.test(v)) return v;
  return fallback;
}

/** Sanitiza família de fonte: somente caracteres seguros. */
function safeFontFamily(c: string | undefined, fallback = "Arial, sans-serif"): string {
  if (!c) return fallback;
  const v = String(c).trim();
  if (/^[\w\s,'"\-.]{1,80}$/.test(v)) return v;
  return fallback;
}

/** Sanitiza número não negativo. */
function safeNum(n: unknown, fallback = 0, max = 10000): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(max, v));
}

function resolveValue(field: string, data: Record<string, unknown>): string {
  const v = data[field];
  if (v === null || v === undefined) return "";
  return String(v);
}

async function generateBarcodeSvg(
  c: BarcodeComponent,
  value: string,
): Promise<string> {
  if (!value) return "";
  try {
    const JsBarcode = (await import("jsbarcode")).default;
    if (typeof document === "undefined") return "";
    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    JsBarcode(svg, value, {
      format: c.format,
      width: c.lineWidth ?? 1.5,
      height: c.barHeight ?? Math.max(20, c.height * MM_TO_PX - 20),
      displayValue: c.showValue !== false,
      margin: 0,
      fontSize: 12,
    });
    return new XMLSerializer().serializeToString(svg);
  } catch (e) {
    return `<div style="color:red;font-size:8px">Erro barcode: ${escapeHtml(value)}</div>`;
  }
}

async function generateQrCodeDataUrl(
  c: QRCodeComponent,
  value: string,
): Promise<string> {
  if (!value) return "";
  try {
    const QRCode = await import("qrcode");
    return await QRCode.toDataURL(value, {
      errorCorrectionLevel: c.errorLevel ?? "M",
      margin: 0,
      width: Math.round(c.width * MM_TO_PX),
    });
  } catch {
    return "";
  }
}

async function renderComponent(
  comp: LabelComponent,
  data: Record<string, unknown>,
): Promise<string> {
  const xPx = comp.x * MM_TO_PX;
  const yPx = comp.y * MM_TO_PX;
  const wPx = comp.width * MM_TO_PX;
  const hPx = comp.height * MM_TO_PX;
  const opacityCss = comp.opacity !== undefined && comp.opacity !== 1 ? `opacity:${comp.opacity};` : "";
  const baseStyle = `position:absolute;left:${xPx}px;top:${yPx}px;width:${wPx}px;height:${hPx}px;z-index:${comp.zIndex ?? 0};${opacityCss}${comp.rotation ? `transform:rotate(${comp.rotation}deg);transform-origin:top left;` : ""}`;

  const align = (a?: string) => (["left", "center", "right", "justify"].includes(a ?? "") ? a : "left");
  const weight = (w?: string) => (/^[\w\d-]{1,20}$/.test(w ?? "") ? w : "normal");

  switch (comp.type) {
    case "text": {
      const c = comp as TextComponent;
      const style = `${baseStyle}font-size:${safeNum(c.fontSize, 12, 200)}px;font-weight:${weight(c.fontWeight as any)};font-family:${safeFontFamily(c.fontFamily)};color:${safeColor(c.color)};text-align:${align(c.align)};line-height:1.1;overflow:hidden;`;
      return `<div style="${style}">${escapeHtml(c.content)}</div>`;
    }
    case "dynamic_text": {
      const c = comp as DynamicTextComponent;
      const value = resolveValue(c.field, data);
      const display = `${c.prefix ?? ""}${value}${c.suffix ?? ""}`;
      const style = `${baseStyle}font-size:${safeNum(c.fontSize, 12, 200)}px;font-weight:${weight(c.fontWeight as any)};font-family:${safeFontFamily(c.fontFamily)};color:${safeColor(c.color)};text-align:${align(c.align)};line-height:1.1;overflow:hidden;`;
      return `<div style="${style}">${escapeHtml(display)}</div>`;
    }
    case "barcode": {
      const c = comp as BarcodeComponent;
      const value = resolveValue(c.field, data);
      const svg = await generateBarcodeSvg(c, value);
      return `<div style="${baseStyle}display:flex;align-items:center;justify-content:center;overflow:hidden;">${svg}</div>`;
    }
    case "qrcode": {
      const c = comp as QRCodeComponent;
      const value = resolveValue(c.field, data);
      const dataUrl = await generateQrCodeDataUrl(c, value);
      // dataUrl é gerado pela lib QRCode (data:image/png;base64,...). Mantemos como atributo.
      return `<div style="${baseStyle}display:flex;align-items:center;justify-content:center;">${dataUrl ? `<img src="${escapeHtml(dataUrl)}" style="width:100%;height:100%;object-fit:contain;" />` : ""}</div>`;
    }
    case "line": {
      const c = comp as LineComponent;
      const isH = c.orientation === "horizontal";
      const border = `${c.dashed ? "dashed" : "solid"} ${safeColor(c.color)} ${safeNum(c.strokeWidth, 1, 50)}px`;
      const style = isH
        ? `${baseStyle}border-top:${border};`
        : `${baseStyle}border-left:${border};`;
      return `<div style="${style}"></div>`;
    }
    case "rectangle": {
      const c = comp as RectangleComponent;
      const style = `${baseStyle}background:${safeColor(c.fillColor, "transparent")};border:${safeNum(c.strokeWidth, 1, 50)}px solid ${safeColor(c.strokeColor)};border-radius:${safeNum(c.borderRadius, 0, 200)}px;`;
      return `<div style="${style}"></div>`;
    }
    default:
      return "";
  }
}

export async function renderLabelToHtml(
  template: LabelTemplate,
  data: Record<string, unknown>,
): Promise<string> {
  const layout = (template.layoutJson as LabelLayout) ?? { components: [] };
  const widthPx = template.widthMm * MM_TO_PX;
  const heightPx = template.heightMm * MM_TO_PX;

  const sortedComponents = [...layout.components]
    .filter(c => !c.hidden)
    .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
  const componentHtmls = await Promise.all(sortedComponents.map(c => renderComponent(c, data)));

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(template.name)}</title>
<style>
  @page { size: ${template.widthMm}mm ${template.heightMm}mm; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { width: ${template.widthMm}mm; height: ${template.heightMm}mm; }
  .label-container {
    position: relative;
    width: ${widthPx}px;
    height: ${heightPx}px;
    overflow: hidden;
    background: #fff;
  }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
<div class="label-container">
${componentHtmls.join("\n")}
</div>
</body>
</html>`;
}

/**
 * Renderiza somente o conteúdo interno (sem <html>) de uma única etiqueta,
 * para compor múltiplas etiquetas dentro de uma mesma página/mídia.
 */
async function renderLabelInner(
  template: LabelTemplate,
  data: Record<string, unknown>,
): Promise<string> {
  const layout = (template.layoutJson as LabelLayout) ?? { components: [] };
  const widthPx = template.widthMm * MM_TO_PX;
  const heightPx = template.heightMm * MM_TO_PX;
  const sortedComponents = [...layout.components]
    .filter(c => !c.hidden)
    .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
  const html = await Promise.all(sortedComponents.map(c => renderComponent(c, data)));
  return `<div class="label-container" style="position:relative;width:${widthPx}px;height:${heightPx}px;overflow:hidden;background:#fff;">${html.join("")}</div>`;
}

export interface PrintItem {
  template: LabelTemplate;
  data: Record<string, unknown>;
  copies?: number;
}

/**
 * Gera um HTML único contendo várias etiquetas, uma por página, prontas para impressão.
 * Cada etiqueta respeita seu próprio tamanho (@page por etiqueta não é universalmente
 * suportado; usamos o tamanho da primeira etiqueta como padrão e cada container tem
 * page-break-after).
 */
export async function renderBatchToHtml(items: PrintItem[]): Promise<string> {
  if (items.length === 0) return "<!DOCTYPE html><html><body>Nenhuma etiqueta</body></html>";
  const first = items[0].template;
  const sections: string[] = [];
  for (const it of items) {
    const inner = await renderLabelInner(it.template, it.data);
    const copies = Math.max(1, it.copies ?? 1);
    for (let i = 0; i < copies; i++) {
      sections.push(`<section class="page" style="width:${it.template.widthMm}mm;height:${it.template.heightMm}mm;page-break-after:always;overflow:hidden;">${inner}</section>`);
    }
  }
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Impressão de etiquetas (${items.length})</title>
<style>
  @page { size: ${first.widthMm}mm ${first.heightMm}mm; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .page:last-child { page-break-after: auto; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  @media screen { body { background: #e5e7eb; padding: 16px; }
    .page { background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.15); margin-bottom: 16px; }
  }
</style>
</head>
<body>
${sections.join("\n")}
</body>
</html>`;
}

/**
 * Renderiza várias etiquetas dentro de uma única mídia física dividida em células
 * (composição de impressão).
 */
export async function renderMediaCompositionToHtml(
  media: PrintMediaLayout,
  cellAssignments: Array<{ row: number; col: number; template: LabelTemplate; data: Record<string, unknown> } | null>,
): Promise<string> {
  const cellsHtml: string[] = [];
  for (const a of cellAssignments) {
    if (!a) continue;
    const xMm = media.marginMm + a.col * (media.cellWidthMm + media.gapXMm);
    const yMm = media.marginMm + a.row * (media.cellHeightMm + media.gapYMm);
    const inner = await renderLabelInner(a.template, a.data);
    cellsHtml.push(
      `<div style="position:absolute;left:${xMm}mm;top:${yMm}mm;width:${media.cellWidthMm}mm;height:${media.cellHeightMm}mm;overflow:hidden;background:#fff;">${inner}</div>`
    );
  }
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(media.name)}</title>
<style>
  @page { size: ${media.mediaWidthMm}mm ${media.mediaHeightMm}mm; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { width: ${media.mediaWidthMm}mm; height: ${media.mediaHeightMm}mm; position: relative; background: #fff; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
${cellsHtml.join("\n")}
</body>
</html>`;
}

/**
 * Abre uma nova janela e imprime o HTML fornecido.
 * Usa noopener,noreferrer e zera o `opener` para evitar ataque tabnabbing/XSS pivot.
 */
export function openPrintWindow(html: string) {
  const w = window.open("", "_blank", "noopener,noreferrer,width=900,height=700");
  if (!w) {
    alert("Bloqueador de pop-ups impediu abrir a janela de impressão. Permita pop-ups e tente novamente.");
    return;
  }
  try { (w as any).opener = null; } catch {}
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.onload = () => {
    setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 250);
  };
}
