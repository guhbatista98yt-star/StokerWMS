/** Gera o HTML completo da etiqueta de VOLUME para impressão direta no servidor */
export function buildVolumeLabelHtml(params: {
  order: string;
  customer: string;
  city?: string;
  state?: string;
  address?: string;
  neighborhood?: string;
  vol: number | string;
  totalVol: number | string;
  route?: string;
  routeName?: string;
  loadCode?: string;
  operator?: string;
  date?: string;
  time?: string;
  company?: string;
  sender?: string;
  counts?: { sacola?: number; caixa?: number; saco?: number; avulso?: number };
}): string {
  const {
    order, customer, city = "", state = "", address = "", neighborhood = "",
    vol, totalVol, route = "", routeName = "",
    operator = "", date = new Date().toLocaleDateString("pt-BR"),
    time = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    counts = {},
  } = params;

  const displayRoute = routeName || route || "";
  const senderDisplay = params.sender || params.company || "";
  const cityLine  = [city, state].filter(Boolean).join(" - ");

  const sacola  = counts.sacola  ?? 0;
  const caixa   = counts.caixa   ?? 0;
  const saco    = counts.saco    ?? 0;
  const avulso  = counts.avulso  ?? 0;

  const orderLen   = String(order).length;
  const orderFsize = orderLen > 7 ? 26 : orderLen > 5 ? 32 : 36;

  const allCounts = [
    { label: "ROTA",   val: displayRoute || "—" },
    { label: "SACOLA", val: sacola },
    { label: "CAIXA",  val: caixa  },
    { label: "SACO",   val: saco   },
    { label: "AVULSO", val: avulso },
  ];

  const countHtml = allCounts.map(c => `
    <div class="count-box${c.label === "ROTA" ? " count-box-rota" : ""}">
      <div class="count-label">${c.label}</div>
      <div class="${c.label === "ROTA" ? "count-val-sm" : "count-val"}">${c.val}</div>
    </div>`).join("");

  const qrData = encodeURIComponent(`VOL:${order}:${vol}/${totalVol}`);
  const qrUrl  = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${qrData}&qzone=1&format=png`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Etiqueta Volume ${order}</title>
<style>
  @page { size: 100mm 70mm landscape; margin: 1.5mm; }
  html, body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background: white; color: #000; }
  * { box-sizing: border-box; }

  .wrap { display: flex; flex-direction: column; width: 97mm; }

  .label {
    width: 97mm; height: 61mm;
    border: 2px solid #000;
    border-radius: 3mm;
    display: flex; flex-direction: column;
    overflow: hidden;
    background: #fff;
  }

  /* ── TOPO PRETO ── */
  .top-bar {
    background: #000; color: #fff;
    display: flex; flex-shrink: 0; height: 22mm;
  }
  .top-left {
    flex: 1; padding: 3px 7px;
    border-right: 2px solid rgba(255,255,255,0.25);
    display: flex; flex-direction: column; justify-content: center;
    overflow: hidden;
  }
  .top-right {
    width: 32mm; padding: 3px 7px;
    display: flex; flex-direction: column; justify-content: center;
  }
  .top-section-label {
    font-size: 6.5px; font-weight: bold; letter-spacing: 0.8px;
    color: rgba(255,255,255,0.5); line-height: 1; text-transform: uppercase; margin-bottom: 1px;
  }
  .order-num {
    font-size: ${orderFsize}px; font-weight: 900; line-height: 1;
    letter-spacing: -0.5px; color: #fff; white-space: nowrap;
  }
  .vol-wrap { display: flex; align-items: baseline; gap: 1px; line-height: 1; }
  .vol-num   { font-size: 34px; font-weight: 900; color: #fff; letter-spacing: -0.5px; }
  .vol-denom { font-size: 22px; font-weight: 700; color: rgba(255,255,255,0.65); }

  /* ── CORPO ── */
  .body-row {
    flex: 1; display: flex; overflow: hidden;
  }
  .dest-col {
    flex: 1; padding: 5px 6px 4px;
    display: flex; flex-direction: column;
    border-right: 1.5px solid #bbb;
    overflow: hidden;
  }
  .dest-info { flex: 1; overflow: hidden; }
  .dest-tag  {
    font-size: 7px; font-weight: bold; letter-spacing: 0.5px;
    color: #555; text-transform: uppercase; margin-bottom: 2px;
  }
  .dest-name {
    font-size: 11px; font-weight: 900; line-height: 1.2;
    text-transform: uppercase; margin-bottom: 2px;
  }
  .dest-addr { font-size: 8.5px; color: #222; line-height: 1.3; }
  .dest-city { font-size: 8.5px; color: #000; font-weight: 700; line-height: 1.3; }
  .sender-block { margin-top: 3px; border-top: 1px dashed #ddd; padding-top: 2px; }
  .sender-tag  { font-size: 6px; font-weight: bold; color: #777; letter-spacing: 0.4px; text-transform: uppercase; }
  .sender-name { font-size: 8px; font-weight: 700; color: #222; }

  /* Tira de contagem */
  .count-strip {
    display: flex; gap: 2px;
    border-top: 1px solid #ccc;
    padding-top: 3px; margin-top: 2px;
    flex-shrink: 0;
  }
  .count-box {
    flex: 1; border: 1px solid #888; border-radius: 2px;
    text-align: center; padding: 2px 1px; overflow: hidden;
  }
  .count-box-rota { flex: 1.4; }
  .count-label { font-size: 6.5px; font-weight: bold; color: #444; letter-spacing: 0.2px; }
  .count-val   { font-size: 13px;  font-weight: 900; line-height: 1.1; }
  .count-val-sm { font-size: 8px; font-weight: 900; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* Coluna QR */
  .qr-col {
    width: 32mm; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center; padding: 5px;
  }
  .qr-col img {
    width: 24mm; height: 24mm;
    border: 1.5px solid #ccc; padding: 2px;
    image-rendering: pixelated;
  }

  /* Data/hora abaixo da etiqueta */
  .date-row {
    text-align: right; font-size: 8.5px; font-weight: bold;
    color: #333; padding-top: 2px; padding-right: 1mm; letter-spacing: 0.2px;
  }

  @media screen {
    body { background: #e5e5e5; padding: 10px; }
    .label { box-shadow: 0 4px 20px rgba(0,0,0,.3); }
  }
</style>
</head>
<body>
<div class="wrap">

  <div class="label">

    <!-- TOPO -->
    <div class="top-bar">
      <div class="top-left">
        <div class="top-section-label">PEDIDO</div>
        <div class="order-num">${order}</div>
      </div>
      <div class="top-right">
        <div class="top-section-label">VOLUME</div>
        <div class="vol-wrap">
          <span class="vol-num">${vol}</span>
          <span class="vol-denom">/${totalVol}</span>
        </div>
      </div>
    </div>

    <!-- CORPO -->
    <div class="body-row">
      <div class="dest-col">
        <div class="dest-info">
          <div class="dest-tag">&#128100; Destinatário</div>
          <div class="dest-name">${customer}</div>
          ${address      ? `<div class="dest-addr">${address}</div>`      : ""}
          ${neighborhood ? `<div class="dest-addr">${neighborhood}</div>` : ""}
          ${cityLine     ? `<div class="dest-city">${cityLine}</div>`     : ""}
          ${senderDisplay ? `<div class="sender-block"><div class="sender-tag">Remetente</div><div class="sender-name">${senderDisplay}</div></div>` : ""}
        </div>
        <div class="count-strip">
          ${countHtml}
        </div>
      </div>
      <div class="qr-col">
        <img src="${qrUrl}" alt="QR Code" onerror="this.style.display='none'" />
      </div>
    </div>

  </div>

  <!-- DATA/HORA -->
  <div class="date-row">${date} às ${time}${operator ? ` &middot; Op: ${operator}` : ""}</div>

</div>
</body>
</html>`;
}

/** Gera o HTML completo da etiqueta de PALLET para impressão direta no servidor */
export function buildPalletLabelHtml(params: {
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
