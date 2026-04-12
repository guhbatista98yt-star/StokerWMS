import { useSearch } from "wouter";
import { QRCodeSVG } from "qrcode.react";

/**
 * Etiqueta de VOLUME — 100mm × 70mm landscape
 *
 * Parâmetros de URL (query string):
 *   order        — número do pedido ERP
 *   customer     — nome do cliente
 *   address      — endereço (rua + número)
 *   neighborhood — bairro
 *   city         — cidade
 *   state        — UF
 *   vol          — número do volume atual
 *   totalVol     — total de volumes do pedido
 *   route        — código da rota (exibido na caixinha ROTA)
 *   routeName    — nome da rota (fallback para route)
 *   operator     — nome do operador (opcional)
 *   date         — data de emissão
 *   time         — hora de emissão
 *   sender       — nome do remetente
 *   sacola / caixa / saco / avulso — contagens
 */
export default function VolumeLabelPage() {
  const searchStr = useSearch();
  const p = new URLSearchParams(searchStr);

  const order        = p.get("order")        ?? "—";
  const customer     = p.get("customer")     ?? "—";
  const address      = p.get("address")      ?? "";
  const neighborhood = p.get("neighborhood") ?? "";
  const city         = p.get("city")         ?? "";
  const state        = p.get("state")        ?? "";
  const vol          = p.get("vol")          ?? "1";
  const totalVol     = p.get("totalVol")     ?? "1";
  const routeDisplay = p.get("routeName")    ?? p.get("route") ?? "";
  const operator     = p.get("operator")     ?? "";
  const sender       = p.get("sender")       ?? p.get("company") ?? "";
  const date         = p.get("date")         ?? new Date().toLocaleDateString("pt-BR");
  const time         = p.get("time")         ?? new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  const sacola = Number(p.get("sacola") ?? 0);
  const caixa  = Number(p.get("caixa")  ?? 0);
  const saco   = Number(p.get("saco")   ?? 0);
  const avulso = Number(p.get("avulso") ?? 0);

  const cityLine = [city, state].filter(Boolean).join(" - ");

  const countCells = [
    { label: "ROTA",   val: routeDisplay || "—" },
    { label: "SACOLA", val: sacola },
    { label: "CAIXA",  val: caixa  },
    { label: "SACO",   val: saco   },
    { label: "AVULSO", val: avulso },
  ];

  return (
    <>
      <style>{`
        @page { size: 100mm 70mm landscape; margin: 1.5mm; }
        html, body {
          margin: 0; padding: 0;
          font-family: Arial, Helvetica, sans-serif;
          background: white; color: #000;
          width: 100mm; height: 70mm;
        }
        * { box-sizing: border-box; }
        @media screen {
          html, body { width: auto; height: auto; background: #e0e0e0; padding: 12px; }
          .wrap { display: flex; flex-direction: column; width: 97mm; }
          .label { box-shadow: 0 4px 20px rgba(0,0,0,.3); }
        }
        @media print {
          .wrap { display: flex; flex-direction: column; width: 97mm; }
        }
      `}</style>

      <div className="wrap">
        {/* ── LABEL ── */}
        <div className="label" style={{
          border: "2px solid #000",
          borderRadius: "3mm",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          background: "#fff",
          height: "61mm",
        }}>

          {/* ── TOPO PRETO: PEDIDO | VOLUME ── */}
          <div style={{
            background: "#000",
            color: "#fff",
            display: "flex",
            flexShrink: 0,
            height: "22mm",
          }}>
            {/* Pedido */}
            <div style={{
              flex: 1,
              padding: "3px 7px",
              borderRight: "2px solid rgba(255,255,255,0.25)",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              overflow: "hidden",
            }}>
              <div style={{ fontSize: 6.5, fontWeight: "bold", letterSpacing: 0.8, color: "rgba(255,255,255,0.5)", lineHeight: 1, textTransform: "uppercase", marginBottom: 1 }}>
                PEDIDO
              </div>
              <div style={{
                fontSize: order.length > 7 ? 26 : order.length > 5 ? 32 : 36,
                fontWeight: 900,
                lineHeight: 1,
                letterSpacing: -0.5,
                color: "#fff",
                whiteSpace: "nowrap",
              }}>
                {order}
              </div>
            </div>

            {/* Volume */}
            <div style={{
              width: "32mm",
              padding: "3px 7px",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
            }}>
              <div style={{ fontSize: 6.5, fontWeight: "bold", letterSpacing: 0.8, color: "rgba(255,255,255,0.5)", lineHeight: 1, textTransform: "uppercase", marginBottom: 1 }}>
                VOLUME
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 1, lineHeight: 1.05 }}>
                <span style={{ fontSize: 34, fontWeight: 900, color: "#fff", letterSpacing: -0.5 }}>{vol}</span>
                <span style={{ fontSize: 22, fontWeight: 700, color: "rgba(255,255,255,0.65)" }}>/{totalVol}</span>
              </div>
            </div>
          </div>

          {/* ── CORPO: DESTINATÁRIO + CONTAGEM | QR ── */}
          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

            {/* Coluna esquerda */}
            <div style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              padding: "4px 6px 3px",
              borderRight: "1.5px solid #bbb",
              overflow: "hidden",
            }}>

              {/* Destinatário */}
              <div style={{ flex: 1, overflow: "hidden", minHeight: 0 }}>
                <div style={{
                  fontSize: 7, fontWeight: "bold", letterSpacing: 0.5,
                  color: "#555", textTransform: "uppercase", marginBottom: 2,
                  display: "flex", alignItems: "center", gap: 3,
                }}>
                  <span>&#128100;</span><span>Destinatário</span>
                </div>
                <div style={{
                  fontSize: 11, fontWeight: 900, lineHeight: 1.2,
                  textTransform: "uppercase", marginBottom: 2,
                }}>
                  {customer}
                </div>
                {address && (
                  <div style={{ fontSize: 8.5, color: "#222", lineHeight: 1.3 }}>{address}</div>
                )}
                {neighborhood && (
                  <div style={{ fontSize: 8.5, color: "#222", lineHeight: 1.3 }}>{neighborhood}</div>
                )}
                {cityLine && (
                  <div style={{ fontSize: 8.5, color: "#000", fontWeight: 700, lineHeight: 1.3 }}>{cityLine}</div>
                )}
                {sender && (
                  <div style={{ marginTop: 3, borderTop: "1px dashed #ddd", paddingTop: 2 }}>
                    <div style={{ fontSize: 6, fontWeight: "bold", color: "#777", letterSpacing: 0.4, textTransform: "uppercase" }}>Remetente</div>
                    <div style={{ fontSize: 8, fontWeight: 700, color: "#222" }}>{sender}</div>
                  </div>
                )}
              </div>

              {/* Tira de contagem */}
              <div style={{
                display: "flex",
                gap: "2px",
                borderTop: "1px solid #ccc",
                paddingTop: "3px",
                marginTop: "2px",
                flexShrink: 0,
              }}>
                {countCells.map((c) => (
                  <div key={c.label} style={{
                    flex: c.label === "ROTA" ? 1.4 : 1,
                    border: "1px solid #888",
                    borderRadius: "2px",
                    textAlign: "center",
                    padding: "2px 1px",
                    overflow: "hidden",
                  }}>
                    <div style={{ fontSize: 6.5, fontWeight: "bold", color: "#444", letterSpacing: 0.2 }}>{c.label}</div>
                    <div style={{
                      fontSize: c.label === "ROTA" ? 8 : 13,
                      fontWeight: 900,
                      lineHeight: 1.1,
                      overflow: "hidden",
                      whiteSpace: c.label === "ROTA" ? "nowrap" : undefined,
                      textOverflow: c.label === "ROTA" ? "ellipsis" : undefined,
                    }}>{c.val}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Coluna QR */}
            <div style={{
              width: "32mm",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "5px",
              flexShrink: 0,
            }}>
              <div style={{ border: "1.5px solid #ccc", padding: "2px", lineHeight: 0 }}>
                <QRCodeSVG
                  value={`VOL:${order}:${vol}/${totalVol}`}
                  size={82}
                  level="M"
                  marginSize={0}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── DATA/HORA ABAIXO DA ETIQUETA ── */}
        <div style={{
          textAlign: "right",
          fontSize: 7.5,
          fontWeight: "bold",
          color: "#333",
          paddingTop: "2px",
          paddingRight: "1mm",
          letterSpacing: 0.2,
        }}>
          {date} às {time}
          {operator && <span style={{ color: "#666", fontWeight: "normal" }}> · Op: {operator}</span>}
        </div>
      </div>
    </>
  );
}
