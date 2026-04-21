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
  const baseStyle = `position:absolute;left:${xPx}px;top:${yPx}px;width:${wPx}px;height:${hPx}px;z-index:${comp.zIndex ?? 0};${comp.rotation ? `transform:rotate(${comp.rotation}deg);transform-origin:top left;` : ""}`;

  switch (comp.type) {
    case "text": {
      const c = comp as TextComponent;
      const style = `${baseStyle}font-size:${c.fontSize}px;font-weight:${c.fontWeight ?? "normal"};font-family:${c.fontFamily ?? "Arial, sans-serif"};color:${c.color ?? "#000"};text-align:${c.align ?? "left"};line-height:1.1;overflow:hidden;`;
      return `<div style="${style}">${escapeHtml(c.content)}</div>`;
    }
    case "dynamic_text": {
      const c = comp as DynamicTextComponent;
      const value = resolveValue(c.field, data);
      const display = `${c.prefix ?? ""}${value}${c.suffix ?? ""}`;
      const style = `${baseStyle}font-size:${c.fontSize}px;font-weight:${c.fontWeight ?? "normal"};font-family:${c.fontFamily ?? "Arial, sans-serif"};color:${c.color ?? "#000"};text-align:${c.align ?? "left"};line-height:1.1;overflow:hidden;`;
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
      return `<div style="${baseStyle}display:flex;align-items:center;justify-content:center;">${dataUrl ? `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:contain;" />` : ""}</div>`;
    }
    case "line": {
      const c = comp as LineComponent;
      const isH = c.orientation === "horizontal";
      const border = `${c.dashed ? "dashed" : "solid"} ${c.color ?? "#000"} ${c.strokeWidth ?? 1}px`;
      const style = isH
        ? `${baseStyle}border-top:${border};`
        : `${baseStyle}border-left:${border};`;
      return `<div style="${style}"></div>`;
    }
    case "rectangle": {
      const c = comp as RectangleComponent;
      const style = `${baseStyle}background:${c.fillColor ?? "transparent"};border:${c.strokeWidth ?? 1}px solid ${c.strokeColor ?? "#000"};border-radius:${c.borderRadius ?? 0}px;`;
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

  const sortedComponents = [...layout.components].sort(
    (a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0),
  );
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
