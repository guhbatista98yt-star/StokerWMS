import { useEffect, useRef } from "react";
import { useSearch } from "wouter";
import { QRCodeSVG } from "qrcode.react";
import { useLabelDefault } from "@/hooks/use-label-default";

/**
 * Página de etiqueta de PALLET — aberta em nova aba, imprime automaticamente.
 *
 * Parâmetros de URL (query string):
 *   code       — código do pallet (ex: PAL-001)
 *   status     — status do pallet
 *   address    — código do endereço WMS (opcional)
 *   items      — resumo dos itens (ex: "Produto A x10 | Produto B x5")
 *   operator   — nome do operador (opcional)
 *   date       — data de emissão (opcional, padrão = hoje)
 *   company    — nome da empresa (opcional)
 *   nf         — número da NF vinculada (opcional)
 *   lot        — lote (opcional)
 */
export default function PalletLabelPage() {
  const searchStr = useSearch();
  const params = new URLSearchParams(searchStr);

  const code     = params.get("code")     ?? "—";
  const status   = params.get("status")   ?? "";
  const address  = params.get("address")  ?? "";
  const items    = params.get("items")    ?? "";
  const operator = params.get("operator") ?? "";
  const date     = params.get("date")     ?? new Date().toLocaleDateString("pt-BR");
  const company  = params.get("company")  ?? "Stoker WMS";
  const nf       = params.get("nf")       ?? "";
  const lot      = params.get("lot")      ?? "";

  const barcodeRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (barcodeRef.current && code !== "—") {
      import("jsbarcode").then(({ default: JsBarcode }) => {
        JsBarcode(barcodeRef.current!, code, {
          format: "CODE128",
          width: 2,
          height: 50,
          displayValue: true,
          fontOptions: "bold",
          fontSize: 14,
          margin: 4,
        });
      });
    }
  }, [code]);


  const STATUS_LABELS: Record<string, string> = {
    sem_endereco: "SEM ENDEREÇO",
    alocado: "ALOCADO",
    em_picking: "EM PICKING",
    concluido: "CONCLUÍDO",
    cancelado: "CANCELADO",
  };

  const statusLabel = STATUS_LABELS[status] ?? status.toUpperCase();
  const statusColor = status === "alocado" ? "#1a7a3a" : status === "cancelado" ? "#c0392b" : "#1a3a5c";

  const { loading: tplLoading, templateHtml } = useLabelDefault("pallet_label", {
    code, status: statusLabel, address, items, operator, date, company, nf, lot,
  });

  if (tplLoading) return null;
  if (templateHtml) {
    return (
      <iframe
        srcDoc={templateHtml}
        style={{ border: 0, width: "100vw", height: "100vh" }}
        title="Etiqueta de Pallet"
        onLoad={(e) => {
          try { (e.currentTarget.contentWindow as Window | null)?.print(); } catch {}
        }}
      />
    );
  }

  return (
    <>
      <style>{`
        @page {
          size: 10cm 15cm;
          margin: 4mm;
        }
        body {
          margin: 0;
          font-family: Arial, Helvetica, sans-serif;
          font-size: 10px;
          background: white;
          color: black;
        }
        * { box-sizing: border-box; }
        @media screen {
          body { padding: 8px; background: #f0f0f0; }
          .label { box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
        }
      `}</style>

      <div className="label" style={{
        width: "100%",
        maxWidth: "10cm",
        minHeight: "15cm",
        background: "white",
        border: "1px solid #333",
        display: "flex",
        flexDirection: "column",
        margin: "0 auto",
      }}>
        {/* Cabeçalho */}
        <div style={{
          background: "#1a3a5c",
          color: "white",
          padding: "5px 8px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          <span style={{ fontWeight: "bold", fontSize: 13 }}>{company}</span>
          <span style={{ fontSize: 11 }}>ETIQUETA DE PALLET</span>
        </div>

        {/* Código do Pallet */}
        <div style={{
          background: "#e8f4fd",
          borderBottom: `2px solid ${statusColor}`,
          padding: "6px 8px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          <div>
            <div style={{ fontSize: 9, color: "#555" }}>CÓDIGO DO PALLET</div>
            <div style={{ fontWeight: "bold", fontSize: 22, color: "#1a3a5c" }}>{code}</div>
          </div>
          {statusLabel && (
            <div style={{
              background: statusColor,
              color: "white",
              padding: "3px 8px",
              borderRadius: 4,
              fontSize: 10,
              fontWeight: "bold",
            }}>
              {statusLabel}
            </div>
          )}
        </div>

        {/* Endereço */}
        {address && (
          <div style={{ padding: "6px 8px", borderBottom: "1px solid #ddd", background: "#fffbe6" }}>
            <div style={{ fontSize: 9, color: "#555" }}>ENDEREÇO WMS</div>
            <div style={{ fontWeight: "bold", fontSize: 16, letterSpacing: 1 }}>{address}</div>
          </div>
        )}

        {/* Conteúdo */}
        {items && (
          <div style={{ padding: "6px 8px", borderBottom: "1px solid #ddd", flex: 1 }}>
            <div style={{ fontSize: 9, color: "#555", marginBottom: 4 }}>CONTEÚDO</div>
            {items.split("|").map((item, i) => (
              <div key={i} style={{ fontSize: 11, padding: "2px 0", borderBottom: i < items.split("|").length - 1 ? "1px dotted #ddd" : "none" }}>
                {item.trim()}
              </div>
            ))}
          </div>
        )}

        {/* NF / Lote */}
        {(nf || lot) && (
          <div style={{ padding: "6px 8px", borderBottom: "1px solid #ddd", display: "flex", gap: 12 }}>
            {nf && (
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, color: "#555" }}>NF</div>
                <div style={{ fontWeight: "bold", fontSize: 12 }}>{nf}</div>
              </div>
            )}
            {lot && (
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, color: "#555" }}>LOTE</div>
                <div style={{ fontWeight: "bold", fontSize: 12 }}>{lot}</div>
              </div>
            )}
          </div>
        )}

        {/* Código de barras */}
        <div style={{ padding: "8px", textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg ref={barcodeRef} style={{ maxWidth: "100%", height: "auto" }} />
        </div>

        {/* Rodapé */}
        <div style={{
          padding: "6px 8px",
          borderTop: "1px solid #ddd",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
        }}>
          <div style={{ fontSize: 9, color: "#555" }}>
            {operator && <div>Operador: <strong>{operator}</strong></div>}
            <div>Emissão: <strong>{date}</strong></div>
          </div>
          <QRCodeSVG
            value={`PAL:${code}${address ? `:${address}` : ""}`}
            size={56}
            level="M"
          />
        </div>
      </div>
    </>
  );
}

/** @deprecated Use buildPalletLabelHtml from @/lib/print-templates instead */
function buildPalletLabelHtml(params: {
  code: string;
  status?: string;
  address?: string;
  items?: string;
  operator?: string;
  date?: string;
  company?: string;
  nf?: string;
  lot?: string;
}): string {
  const {
    code, status = "", address = "", items = "",
    operator = "", date = new Date().toLocaleDateString("pt-BR"),
    company = "Stoker WMS", nf = "", lot = "",
  } = params;

  const STATUS_LABELS: Record<string, string> = {
    sem_endereco: "SEM ENDEREÇO",
    alocado: "ALOCADO",
    em_picking: "EM PICKING",
    concluido: "CONCLUÍDO",
    cancelado: "CANCELADO",
  };
  const statusLabel = STATUS_LABELS[status] ?? status.toUpperCase();
  const statusColor = status === "alocado" ? "#1a7a3a" : status === "cancelado" ? "#c0392b" : "#1a3a5c";

  const itemsRows = items
    ? items.split("|").map((it) => `<div style="font-size:11px;padding:2px 0;">${it.trim()}</div>`).join("")
    : "";

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Etiqueta Pallet ${code}</title>
<style>
  @page { size: 10cm 15cm; margin: 4mm; }
  body { margin: 0; font-family: Arial, sans-serif; font-size: 10px; }
  * { box-sizing: border-box; }
  .label { width: 100%; border: 1px solid #333; display: flex; flex-direction: column; min-height: 14cm; }
  .header { background: #1a3a5c; color: white; padding: 5px 8px; display: flex; justify-content: space-between; align-items: center; }
  .code-bar { background: #e8f4fd; border-bottom: 2px solid ${statusColor}; padding: 6px 8px; display: flex; justify-content: space-between; align-items: center; }
  .code-label { font-size: 9px; color: #555; }
  .code-value { font-weight: bold; font-size: 22px; color: #1a3a5c; }
  .status-badge { background: ${statusColor}; color: white; padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: bold; }
  .section { padding: 6px 8px; border-bottom: 1px solid #ddd; }
  .sec-label { font-size: 9px; color: #555; margin-bottom: 2px; }
  .address-value { font-weight: bold; font-size: 16px; letter-spacing: 1px; }
  .barcode-area { padding: 8px; text-align: center; display: flex; align-items: center; justify-content: center; }
  .barcode-placeholder { border: 2px solid #333; padding: 8px 16px; font-size: 28px; font-family: monospace; letter-spacing: 3px; }
  .footer { padding: 6px 8px; border-top: 1px solid #ddd; display: flex; justify-content: space-between; align-items: flex-end; }
  .footer-text { font-size: 9px; color: #555; }
</style>
</head>
<body>
<div class="label">
  <div class="header">
    <span style="font-weight:bold;font-size:13px;">${company}</span>
    <span style="font-size:11px;">ETIQUETA DE PALLET</span>
  </div>
  <div class="code-bar">
    <div>
      <div class="code-label">CÓDIGO DO PALLET</div>
      <div class="code-value">${code}</div>
    </div>
    ${statusLabel ? `<div class="status-badge">${statusLabel}</div>` : ""}
  </div>
  ${address ? `
  <div class="section" style="background:#fffbe6;">
    <div class="sec-label">ENDEREÇO WMS</div>
    <div class="address-value">${address}</div>
  </div>` : ""}
  ${items ? `
  <div class="section" style="flex:1;">
    <div class="sec-label">CONTEÚDO</div>
    ${itemsRows}
  </div>` : ""}
  ${(nf || lot) ? `
  <div class="section" style="display:flex;gap:12px;">
    ${nf ? `<div style="flex:1;"><div class="sec-label">NF</div><div style="font-weight:bold;font-size:12px;">${nf}</div></div>` : ""}
    ${lot ? `<div style="flex:1;"><div class="sec-label">LOTE</div><div style="font-weight:bold;font-size:12px;">${lot}</div></div>` : ""}
  </div>` : ""}
  <div class="barcode-area">
    <div class="barcode-placeholder">${code}</div>
  </div>
  <div class="footer">
    <div class="footer-text">
      ${operator ? `<div>Operador: <strong>${operator}</strong></div>` : ""}
      <div>Emissão: <strong>${date}</strong></div>
    </div>
    <div style="font-size:9px;color:#555;">PAL:${code}${address ? `:${address}` : ""}</div>
  </div>
</div>
</body>
</html>`;
}
