"""
Stoker WMS — Print Agent
Connects to the main server via WebSocket and handles local print jobs.

PDF generation via ReportLab (native, no browser needed).
Fallback to xhtml2pdf for legacy HTML jobs.

Requirements: websocket-client, reportlab
Optional: xhtml2pdf (for legacy HTML), pywin32 (for printer listing)
Python 3.8+

Install: pip install websocket-client reportlab xhtml2pdf
"""

import sys
import os
import json
import time
import logging
import threading
import tempfile
import subprocess
import configparser
import socket

# ── Logging ────────────────────────────────────────────────────────────────────
from logging.handlers import RotatingFileHandler

_fmt = logging.Formatter("%(asctime)s %(message)s")
_file_handler = RotatingFileHandler(
    "agent.log", maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"
)
_file_handler.setFormatter(_fmt)
_console_handler = logging.StreamHandler(sys.stdout)
_console_handler.setFormatter(_fmt)

logging.basicConfig(level=logging.INFO, handlers=[_console_handler, _file_handler])
log = logging.getLogger("print-agent")

# ── Config ─────────────────────────────────────────────────────────────────────
CONFIG_FILE = os.path.join(os.path.dirname(__file__), "config.ini")

def load_config():
    cfg = configparser.ConfigParser()
    if not os.path.exists(CONFIG_FILE):
        log.error(f"Arquivo de configuração não encontrado: {CONFIG_FILE}")
        sys.exit(1)
    cfg.read(CONFIG_FILE, encoding="utf-8")
    return cfg

cfg = load_config()
TOKEN       = cfg.get("agent", "token").strip()
MACHINE_ID  = cfg.get("agent", "machine_id", fallback="").strip().upper() or socket.gethostname().upper()
RECONNECT_S = cfg.getint("agent", "reconnect_seconds", fallback=5)
PING_INTERVAL = cfg.getint("agent", "ping_interval", fallback=20)
VERIFY_SSL = cfg.getboolean("agent", "verify_ssl", fallback=True)

try:
    from urllib.parse import urlparse as _urlparse
    _raw = cfg.get("agent", "server_url").strip().rstrip("/")
    _parsed = _urlparse(_raw)
    if not _parsed.scheme:
        _parsed = _urlparse("http://" + _raw)
    SERVER_BASE = f"{_parsed.scheme}://{_parsed.netloc}"
except Exception:
    SERVER_BASE = cfg.get("agent", "server_url").strip().rstrip("/")

WS_URL = SERVER_BASE.replace("https://", "wss://").replace("http://", "ws://") + "/ws/print-agent"


# ── Validação de dependências na inicialização ────────────────────────────────

def _check_dependencies():
    missing = []
    try:
        import websocket  # noqa: F401
    except ImportError:
        missing.append("websocket-client")
    try:
        from reportlab.lib.pagesizes import A4  # noqa: F401
    except ImportError:
        missing.append("reportlab")
    if missing:
        log.error(f"Dependências faltando: {', '.join(missing)}")
        log.error(f"Execute: pip install {' '.join(missing)}")
        sys.exit(1)

_check_dependencies()


# ── Printer detection (Windows) ────────────────────────────────────────────────

def get_printers():
    printers = []
    try:
        import win32print
        default = win32print.GetDefaultPrinter()
        flags = win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
        for p in win32print.EnumPrinters(flags, None, 4):
            name = p.get("pPrinterName", "")
            if name:
                printers.append({"name": name, "isDefault": name == default})
    except ImportError:
        try:
            result = subprocess.run(
                ["powershell", "-Command",
                 "Get-Printer | Select-Object -ExpandProperty Name"],
                capture_output=True, text=True, timeout=10
            )
            if result.returncode == 0:
                names = [n.strip() for n in result.stdout.strip().splitlines() if n.strip()]
                printers = [{"name": n, "isDefault": False} for n in names]
        except Exception:
            pass
    except Exception as e:
        log.warning(f"Erro ao listar impressoras: {e}")
    return printers


# ── ReportLab Templates ───────────────────────────────────────────────────────

def _render_volume_label(data: dict, pdf_path: str) -> bool:
    """Renderiza etiquetas de volume usando ReportLab — 100 x 70 mm landscape."""
    from reportlab.lib.units import mm
    from reportlab.lib.colors import HexColor, black, white
    from reportlab.pdfgen import canvas
    from reportlab.graphics.barcode import code128

    PAGE_W = 100 * mm
    PAGE_H = 70  * mm

    volumes = data.get("volumes", [])
    if not volumes:
        raise RuntimeError("Nenhum volume para imprimir")

    c = canvas.Canvas(pdf_path, pagesize=(PAGE_W, PAGE_H))

    for vol in volumes:
        _draw_single_volume(c, vol, PAGE_W, PAGE_H, mm, HexColor, black, white, code128)
        c.showPage()

    c.save()
    return True


def _draw_single_volume(c, vol, PAGE_W, PAGE_H, mm, HexColor, black, white, code128):
    """Desenha uma etiqueta de volume em uma página.

    Layout landscape 100 x 70 mm (igual ao design de referência):
      ┌──────────────────────────────────────────────────┐
      │  PEDIDO              │  VOLUME                   │  ← topo preto (22 mm)
      │  479959              │  1/8                      │
      ├──────────────────────┼──────────────────────────┤
      │  DESTINATÁRIO        │                           │
      │  Nome cliente        │   [Code128 barcode]       │  ← corpo (~40 mm)
      │  Endereço...         │                           │
      │  Cidade - UF         │                           │
      │  ROTA│SACOLA│CAIXA│SACO│AVULSO (caixinhas)      │
      └──────────────────────────────────────────────────┘
                                     data às hora          ← abaixo da borda (8 mm)
    """
    erp_order    = vol.get("erpOrderId",   "—")
    vol_num      = vol.get("volumeNumber",  1)
    vol_total    = vol.get("totalVolumes",  1)
    route_code   = vol.get("routeName",    vol.get("routeCode", "—"))
    customer     = vol.get("customerName", "—")
    address      = vol.get("address",      "")
    neighborhood = vol.get("neighborhood", "")
    city_state   = vol.get("cityState",    "")
    sender       = vol.get("sender",       vol.get("company", ""))
    date_str     = vol.get("date",         "")
    time_str     = vol.get("time",         "")
    counts       = vol.get("counts",       {})
    barcode_text = vol.get("barcode",      f"{erp_order}{str(vol_num).zfill(3)}")

    # Reserva área abaixo para data/hora
    date_area_h = 5 * mm
    label_h     = PAGE_H - date_area_h
    top_h       = 22 * mm
    body_h      = label_h - top_h          # ~43 mm
    qr_col_w    = 32 * mm
    count_h     = 11 * mm                  # tira de contagem na base do corpo
    dest_h      = body_h - count_h

    MARGIN = 1.5 * mm  # borda da etiqueta (desenhada abaixo)

    # ── BORDA ARREDONDADA DA ETIQUETA ───────────────────────────────────
    # ReportLab não tem roundRect nativo em canvas; simulamos com rect + linha
    c.setStrokeColor(black)
    c.setLineWidth(1.5)
    c.roundRect(MARGIN, date_area_h, PAGE_W - 2 * MARGIN, label_h - 2 * MARGIN, 3 * mm, fill=0, stroke=1)

    label_x  = MARGIN
    label_y0 = date_area_h                  # base da etiqueta
    label_y1 = label_y0 + label_h - 2 * MARGIN   # topo da etiqueta

    top_y  = label_y1 - top_h              # y base da barra preta
    body_y = label_y0                       # y base do corpo

    # ── TOPO PRETO ───────────────────────────────────────────────────────
    c.setFillColor(black)
    # Preenchimento rectangular + cantos arredondados apenas no topo
    c.rect(label_x, top_y, PAGE_W - 2 * MARGIN, top_h, fill=1, stroke=0)

    # Divisor vertical no topo
    split_x = PAGE_W - qr_col_w
    c.setStrokeColor(HexColor("#555555"))
    c.setLineWidth(0.5)
    c.line(split_x, top_y, split_x, label_y1)

    pad = 3 * mm

    # Centro vertical da barra preta
    bar_mid_y = top_y + top_h / 2

    # "PEDIDO" label
    c.setFillColor(HexColor("#888888"))
    c.setFont("Helvetica-Bold", 6)
    c.drawString(label_x + pad, bar_mid_y + 5 * mm, "PEDIDO")

    # Número do pedido
    order_str = str(erp_order)
    max_w = split_x - label_x - 2 * pad
    for fs in (36, 32, 26, 22, 18, 14):
        if c.stringWidth(order_str, "Helvetica-Bold", fs) <= max_w:
            break
    c.setFillColor(white)
    c.setFont("Helvetica-Bold", fs)
    c.drawString(label_x + pad, bar_mid_y - 4 * mm, order_str)

    # "VOLUME" label
    c.setFillColor(HexColor("#888888"))
    c.setFont("Helvetica-Bold", 6)
    c.drawString(split_x + pad, bar_mid_y + 5 * mm, "VOLUME")

    # vol / total
    vol_str   = str(vol_num)
    total_str = f"/{vol_total}"
    avail_w   = qr_col_w - 2 * pad
    for vfs in (34, 28, 22, 18, 14):
        vw = c.stringWidth(vol_str,   "Helvetica-Bold", vfs)
        tw = c.stringWidth(total_str, "Helvetica",      int(vfs * 0.62))
        if vw + tw <= avail_w:
            break
    tfs = int(vfs * 0.62)
    c.setFillColor(white)
    c.setFont("Helvetica-Bold", vfs)
    c.drawString(split_x + pad, bar_mid_y - 4 * mm, vol_str)
    c.setFillColor(HexColor("#999999"))
    c.setFont("Helvetica", tfs)
    vw = c.stringWidth(vol_str, "Helvetica-Bold", vfs)
    c.drawString(split_x + pad + vw, bar_mid_y - 4 * mm, total_str)

    # ── CORPO ────────────────────────────────────────────────────────────
    # Divisor vertical corpo
    c.setStrokeColor(HexColor("#bbbbbb"))
    c.setLineWidth(0.8)
    c.line(split_x, body_y, split_x, top_y)

    # ─ DESTINATÁRIO ───────────────────────────────────────────────────
    text_x = label_x + pad
    c.setFillColor(HexColor("#555555"))
    c.setFont("Helvetica-Bold", 7)
    c.drawString(text_x, top_y - 4 * mm, "DESTINATARIO")

    max_name_w = split_x - label_x - 2 * pad
    for nfs in (12, 11, 10, 8):
        if c.stringWidth(customer[:60], "Helvetica-Bold", nfs) <= max_name_w:
            break
    c.setFillColor(black)
    c.setFont("Helvetica-Bold", nfs)
    c.drawString(text_x, top_y - 9 * mm, customer[:50])

    c.setFont("Helvetica", 8.5)
    c.setFillColor(HexColor("#222222"))
    addr_y = top_y - 14.5 * mm
    if address:
        c.drawString(text_x, addr_y, address[:50])
        addr_y -= 4.8 * mm
    if neighborhood:
        c.drawString(text_x, addr_y, neighborhood[:50])
        addr_y -= 4.8 * mm
    if city_state:
        c.setFont("Helvetica-Bold", 8.5)
        c.setFillColor(black)
        c.drawString(text_x, addr_y, city_state[:40])
        addr_y -= 4.5 * mm
    if sender:
        c.setStrokeColor(HexColor("#dddddd"))
        c.setLineWidth(0.4)
        c.line(text_x, addr_y + 2.5 * mm, split_x - pad, addr_y + 2.5 * mm)
        c.setFont("Helvetica-Bold", 6)
        c.setFillColor(HexColor("#777777"))
        c.drawString(text_x, addr_y + 0.5 * mm, "REMETENTE")
        c.setFont("Helvetica-Bold", 8)
        c.setFillColor(HexColor("#222222"))
        c.drawString(text_x, addr_y - 3.5 * mm, sender[:45])

    # ─ TIRA DE CONTAGEM (base da coluna esquerda) ─────────────────────
    strip_y0 = body_y
    strip_y1 = body_y + count_h

    # Linha separadora
    c.setStrokeColor(HexColor("#cccccc"))
    c.setLineWidth(0.5)
    c.line(label_x, strip_y1, split_x, strip_y1)

    count_labels = ["ROTA", "SACOLA", "CAIXA", "SACO", "AVULSO"]
    count_values = [
        str(route_code),
        str(counts.get("sacola", 0)),
        str(counts.get("caixa",  0)),
        str(counts.get("saco",   0)),
        str(counts.get("avulso", 0)),
    ]
    avail_strip_w = split_x - label_x - 2 * MARGIN
    box_w = avail_strip_w / len(count_labels)
    box_gap = 1 * mm

    for i, (lbl, val) in enumerate(zip(count_labels, count_values)):
        bx0 = label_x + MARGIN + i * box_w + box_gap / 2
        bx1 = bx0 + box_w - box_gap
        # Caixinha com borda
        c.setStrokeColor(HexColor("#888888"))
        c.setLineWidth(0.5)
        c.roundRect(bx0, strip_y0 + 1 * mm, bx1 - bx0, count_h - 2.5 * mm, 1 * mm, fill=0, stroke=1)
        cx = (bx0 + bx1) / 2
        c.setFillColor(HexColor("#444444"))
        c.setFont("Helvetica-Bold", 6.5)
        c.drawCentredString(cx, strip_y0 + count_h - 4.5 * mm, lbl)
        c.setFillColor(black)
        val_fs = 9 if lbl == "ROTA" else 13
        c.setFont("Helvetica-Bold", val_fs)
        # truncate route name if needed
        disp_val = val
        if lbl == "ROTA":
            max_box_w = bx1 - bx0 - 2 * mm
            while len(disp_val) > 1 and c.stringWidth(disp_val, "Helvetica-Bold", val_fs) > max_box_w:
                disp_val = disp_val[:-1]
        c.drawCentredString(cx, strip_y0 + 2 * mm, disp_val)

    # ─ CODE128 (coluna direita do corpo) ──────────────────────────────
    bc_x = split_x + 2 * mm
    bc_w_avail = qr_col_w - 4 * mm
    bc_h_avail = body_h - 6 * mm
    try:
        bc = code128.Code128(
            barcode_text,
            barWidth=0.55 * mm,
            barHeight=bc_h_avail * 0.75,
            humanReadable=True,
        )
        bc_actual_w = bc.width
        draw_x = bc_x + max(0, (bc_w_avail - bc_actual_w) / 2)
        draw_y = body_y + 2.5 * mm
        bc.drawOn(c, draw_x, draw_y)
    except Exception:
        c.setFont("Courier-Bold", 7)
        c.setFillColor(black)
        mid_x = split_x + qr_col_w / 2
        c.drawCentredString(mid_x, body_y + body_h / 2, barcode_text)

    # ── DATA/HORA ABAIXO DA ETIQUETA ─────────────────────────────────────
    c.setFillColor(HexColor("#333333"))
    c.setFont("Helvetica-Bold", 8.5)
    datetime_str = f"{date_str} \xe0s {time_str}" if date_str else time_str
    c.drawRightString(PAGE_W - MARGIN - 1 * mm, 1.5 * mm, datetime_str)


def _render_pallet_label(data: dict, pdf_path: str) -> bool:
    """Renderiza etiqueta de pallet usando ReportLab."""
    from reportlab.lib.units import cm, mm
    from reportlab.lib.colors import HexColor, black, white
    from reportlab.pdfgen import canvas

    PAGE_W = 10 * cm
    PAGE_H = 15 * cm

    c = canvas.Canvas(pdf_path, pagesize=(PAGE_W, PAGE_H))
    y = PAGE_H

    pallet_code = data.get("palletCode", "—")
    address = data.get("address", "—")
    created_at = data.get("createdAt", "")
    created_by = data.get("createdBy", "—")
    printed_by = data.get("printedBy", "—")
    items = data.get("items", [])
    nf_ids = data.get("nfIds", [])
    qr_data = data.get("qrData", "")

    # ── Header ──────────────────────────────────────────────────────────
    header_h = 24 * mm
    c.setFont("Helvetica-Bold", 22)
    c.setStrokeColor(black)
    c.setLineWidth(1.5)
    c.rect(3 * mm, y - header_h, PAGE_W - 6 * mm, 14 * mm, stroke=1, fill=0)
    c.drawCentredString(PAGE_W / 2, y - 13 * mm, pallet_code)

    c.setFont("Helvetica-Bold", 13)
    c.drawCentredString(PAGE_W / 2, y - 21 * mm, address)

    y -= header_h + 2 * mm

    # ── QR Code (se disponível) ─────────────────────────────────────────
    if qr_data:
        try:
            from reportlab.graphics.barcode.qr import QrCodeWidget
            from reportlab.graphics.shapes import Drawing
            from reportlab.graphics import renderPDF

            target = 25 * mm
            qr = QrCodeWidget(qr_data)
            bounds = qr.getBounds()
            nat_w = bounds[2] - bounds[0]
            nat_h = bounds[3] - bounds[1]
            sx = target / nat_w if nat_w else 1
            sy = target / nat_h if nat_h else 1
            d = Drawing(target, target, transform=[sx, 0, 0, sy, 0, 0])
            d.add(qr)
            renderPDF.draw(d, c, (PAGE_W - target) / 2, y - target - 2 * mm)
            y -= target + 4 * mm
        except Exception:
            pass

    # ── Meta ────────────────────────────────────────────────────────────
    c.setStrokeColor(HexColor("#dddddd"))
    c.line(3 * mm, y, PAGE_W - 3 * mm, y)
    y -= 4 * mm

    c.setFillColor(HexColor("#555555"))
    c.setFont("Helvetica", 8)
    meta = f"Criado: {created_at} | Por: {created_by} | Impresso: {printed_by}"
    c.drawString(3 * mm, y, meta[:60])
    y -= 6 * mm

    # ── Itens ───────────────────────────────────────────────────────────
    c.setStrokeColor(black)
    c.line(3 * mm, y, PAGE_W - 3 * mm, y)
    y -= 4 * mm

    for item in items[:20]:
        product = item.get("product", "")
        erp_code = item.get("erpCode", "")
        quantity = item.get("quantity", "")
        unit = item.get("unit", "")
        lot = item.get("lot", "")
        expiry = item.get("expiryDate", "")

        c.setFillColor(black)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(3 * mm, y, product[:45])
        y -= 4 * mm

        detail = f"{erp_code} | {quantity} {unit}"
        if lot:
            detail += f" | Lote: {lot}"
        if expiry:
            detail += f" | Val: {expiry}"
        c.setFont("Helvetica", 8)
        c.drawString(3 * mm, y, detail[:60])
        y -= 2 * mm

        c.setStrokeColor(HexColor("#cccccc"))
        c.setDash(2, 2)
        c.line(3 * mm, y, PAGE_W - 3 * mm, y)
        c.setDash()
        y -= 3 * mm

        if y < 10 * mm:
            break

    # ── NF ──────────────────────────────────────────────────────────────
    if nf_ids:
        y -= 2 * mm
        c.setFillColor(HexColor("#333333"))
        c.setFont("Helvetica", 8)
        c.drawString(3 * mm, y, f"NF: {', '.join(str(n) for n in nf_ids[:10])}")

    c.save()
    return True


# ── Geração de PDF (ReportLab nativo + fallback xhtml2pdf para HTML) ──────────

_pdf_lock = threading.Lock()
_PDF_TIMEOUT = 30

def generate_pdf_from_template(template: str, data: dict, pdf_path: str, job_id: str) -> bool:
    """Gera PDF usando ReportLab nativo (ultra-rápido, sem browser)."""
    renderers = {
        "volume_label": _render_volume_label,
        "pallet_label": _render_pallet_label,
    }

    renderer = renderers.get(template)
    if not renderer:
        raise RuntimeError(f"Template desconhecido: {template}")

    with _pdf_lock:
        renderer(data, pdf_path)

    if os.path.exists(pdf_path) and os.path.getsize(pdf_path) > 100:
        return True

    raise RuntimeError(f"ReportLab não gerou o PDF para template '{template}'")


def _strip_external_fonts(html: str) -> str:
    import re
    html = re.sub(r'@font-face\s*\{[^}]*\}', '', html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r'@import\s+url\([^)]*fonts[^)]*\)\s*;?', '', html, flags=re.IGNORECASE)
    html = re.sub(r'<link[^>]*fonts\.googleapis\.com[^>]*/?\s*>', '', html, flags=re.IGNORECASE)
    html = re.sub(r'<link[^>]*fonts\.gstatic\.com[^>]*/?\s*>', '', html, flags=re.IGNORECASE)
    return html


def _extract_page_size_mm(html: str):
    """Extrai dimensões de @page { size: Xmm Ymm } do CSS do HTML.
    Retorna (width_mm, height_mm) ou (None, None) se não encontrar."""
    import re
    m = re.search(r'@page\s*\{[^}]*?size:\s*([\d.]+)\s*mm\s+([\d.]+)\s*mm', html, re.DOTALL)
    if m:
        return float(m.group(1)), float(m.group(2))
    return None, None


def _find_browser_win():
    """Localiza Chrome ou Edge no Windows."""
    candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    ]
    return next((c for c in candidates if os.path.exists(c)), None)


def _generate_pdf_via_chrome(html_content: str, pdf_path: str, job_id: str,
                              width_mm: float, height_mm: float) -> bool:
    """Gera PDF via Chrome/Edge headless com tamanho de papel explícito (mm → polegadas).
    Retorna True se gerou com sucesso, False se browser não disponível ou falhou."""
    browser = _find_browser_win()
    if not browser:
        return False

    tmp_html = pdf_path.replace(".pdf", ".html")
    try:
        with open(tmp_html, "w", encoding="utf-8") as f:
            f.write(html_content)

        # Chrome --paper-width/--paper-height usam polegadas
        w_in = width_mm / 25.4
        h_in = height_mm / 25.4

        file_url = "file:///" + tmp_html.replace("\\", "/")

        for headless_flag in ["--headless=old", "--headless"]:
            try:
                if os.path.exists(pdf_path):
                    os.remove(pdf_path)
            except Exception:
                pass

            try:
                r = subprocess.run(
                    [
                        browser,
                        headless_flag,
                        "--disable-gpu",
                        "--no-sandbox",
                        "--disable-dev-shm-usage",
                        "--disable-extensions",
                        f"--print-to-pdf={pdf_path}",
                        "--print-to-pdf-no-header",
                        "--no-pdf-header-footer",
                        f"--paper-width={w_in:.5f}",
                        f"--paper-height={h_in:.5f}",
                        "--virtual-time-budget=5000",
                        file_url,
                    ],
                    timeout=45,
                    capture_output=True,
                )
            except Exception:
                continue

            if os.path.exists(pdf_path) and os.path.getsize(pdf_path) > 100:
                log.info(f"[{job_id}] Chrome headless OK ({width_mm}×{height_mm}mm, {headless_flag})")
                return True

        log.warning(f"[{job_id}] Chrome headless falhou para todos os flags")
        return False

    except Exception as e:
        log.warning(f"[{job_id}] Chrome headless erro: {e}")
        return False
    finally:
        try:
            os.remove(tmp_html)
        except Exception:
            pass


def generate_pdf_from_html(html_content: str, pdf_path: str, job_id: str) -> bool:
    """Gera PDF a partir de HTML.

    Estratégia (em ordem de prioridade):
    1. Chrome/Edge headless com --paper-width/--paper-height explícitos (respeita @page CSS)
    2. xhtml2pdf como fallback (não respeita @page size, mas funciona sem browser)
    """
    html_content = _strip_external_fonts(html_content)

    # 1) Tentativa via Chrome headless com tamanho exato de papel
    width_mm, height_mm = _extract_page_size_mm(html_content)
    if width_mm and height_mm:
        try:
            if _generate_pdf_via_chrome(html_content, pdf_path, job_id, width_mm, height_mm):
                return True
        except Exception as e:
            log.warning(f"[{job_id}] Chrome fallback para xhtml2pdf: {e}")

    # 2) Fallback: xhtml2pdf (legado — ignora @page size, usa A4 por padrão)
    log.info(f"[{job_id}] Usando xhtml2pdf como fallback")
    from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout

    def _worker():
        import logging as _logging
        _logging.getLogger("xhtml2pdf").setLevel(_logging.CRITICAL)
        _logging.getLogger("reportlab").setLevel(_logging.CRITICAL)
        _logging.getLogger("html5lib").setLevel(_logging.CRITICAL)
        from xhtml2pdf import pisa
        with open(pdf_path, "wb") as f:
            pisa.CreatePDF(html_content, dest=f)
        return os.path.exists(pdf_path) and os.path.getsize(pdf_path) > 100

    with _pdf_lock:
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(_worker)
            try:
                ok = future.result(timeout=_PDF_TIMEOUT)
            except FuturesTimeout:
                raise RuntimeError(f"xhtml2pdf timeout ({_PDF_TIMEOUT}s)")

    if ok:
        return True
    raise RuntimeError("xhtml2pdf não gerou o PDF")


# ── Impressão (SumatraPDF ou ShellExecute) ─────────────────────────────────

def find_sumatra():
    candidates = [
        r"C:\Program Files\SumatraPDF\SumatraPDF.exe",
        r"C:\Program Files (x86)\SumatraPDF\SumatraPDF.exe",
        os.path.join(os.path.dirname(__file__), "SumatraPDF.exe"),
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return None


def _send_to_printer(pdf_path: str, printer: str, copies: int, job_id: str) -> dict:
    """Envia PDF para a impressora via SumatraPDF ou ShellExecute."""
    sumatra = find_sumatra()
    if not sumatra:
        try:
            import win32api
            for _ in range(max(1, min(copies, 99))):
                win32api.ShellExecute(0, "print", pdf_path, f'"{printer}"', ".", 0)
                time.sleep(0.3)
            return {"success": True}
        except ImportError:
            return {"success": False, "error": "SumatraPDF não encontrado."}

    for i in range(max(1, min(copies, 99))):
        r = subprocess.run(
            [sumatra, "-print-to", printer, "-print-settings", "noscale", "-silent", pdf_path],
            timeout=30, capture_output=True
        )
        if r.returncode != 0:
            stderr_msg = (r.stderr or b"").decode("utf-8", errors="replace").strip()
            return {"success": False, "error": f"SumatraPDF erro cópia {i+1}: {stderr_msg[:200]}"}
        if copies > 1:
            time.sleep(0.2)

    return {"success": True}


def print_job(msg: dict) -> dict:
    """Processa um job de impressão.

    Prioridade:
    1. pdfBase64 — PDF já gerado pelo servidor (tamanho correto garantido)
    2. template + data — ReportLab nativo
    3. html — Chrome headless → fallback xhtml2pdf
    """
    tmp = tempfile.gettempdir()
    job_id = os.urandom(4).hex()
    pdf_path = os.path.join(tmp, f"stoker_{job_id}.pdf")
    printer = msg.get("printer", "")
    copies = max(1, min(int(float(msg.get("copies", 1))), 99))

    try:
        t_start = time.time()

        pdf_b64 = msg.get("pdfBase64")
        template = msg.get("template")
        data = msg.get("data")
        html = msg.get("html")

        if pdf_b64:
            import base64
            with open(pdf_path, "wb") as f:
                f.write(base64.b64decode(pdf_b64))
            if not (os.path.exists(pdf_path) and os.path.getsize(pdf_path) > 100):
                raise RuntimeError("pdfBase64 decodificado vazio ou inválido")
            method = "server-PDF"
        elif template and data:
            generate_pdf_from_template(template, data, pdf_path, job_id)
            method = "ReportLab"
        elif html:
            generate_pdf_from_html(html, pdf_path, job_id)
            method = "Chrome/xhtml2pdf"
        else:
            return {"success": False, "error": "Job sem 'pdfBase64', 'template'+'data' nem 'html'."}

        result = _send_to_printer(pdf_path, printer, copies, job_id)
        t_total = time.time() - t_start

        if result["success"]:
            log.info(f"[{job_id}] ✓ '{printer}' x{copies} ({method}, {t_total:.1f}s)")
        else:
            log.error(f"[{job_id}] ✗ {result.get('error', '?')}")

        return result

    except Exception as e:
        log.error(f"[{job_id}] ✗ {e}")
        return {"success": False, "error": str(e)}
    finally:
        try:
            if os.path.exists(pdf_path):
                os.remove(pdf_path)
        except Exception:
            pass


# ── Limpeza de temporários ─────────────────────────────────────────────────────

def _cleanup_stale_temp_files():
    tmp = tempfile.gettempdir()
    cutoff = time.time() - 3600
    try:
        for f in os.listdir(tmp):
            if f.startswith("stoker_"):
                full = os.path.join(tmp, f)
                try:
                    if os.path.getmtime(full) < cutoff:
                        if os.path.isdir(full):
                            import shutil
                            shutil.rmtree(full, ignore_errors=True)
                        else:
                            os.remove(full)
                except Exception:
                    pass
    except Exception:
        pass

_cleanup_stale_temp_files()


# ── WebSocket Agent ────────────────────────────────────────────────────────────

import websocket
from concurrent.futures import ThreadPoolExecutor

_print_pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix="print")

class PrintAgent:
    def __init__(self):
        self._ws = None
        self._running = True
        self._registered = False
        self._ping_thread = None
        self._send_lock = threading.Lock()

    def send(self, msg: dict):
        with self._send_lock:
            try:
                ws = self._ws
                if ws and ws.sock and ws.sock.connected:
                    ws.send(json.dumps(msg))
            except Exception:
                pass

    def on_open(self, ws):
        self._registered = False
        printers = get_printers()
        self.send({
            "type": "register",
            "token": TOKEN,
            "machineId": MACHINE_ID,
            "printers": printers,
        })

    def on_message(self, ws, data):
        try:
            msg = json.loads(data)
        except Exception:
            return

        msg_type = msg.get("type", "")

        if msg_type == "registered":
            self._registered = True
            name = msg.get("name", "?")
            log.info(f"✓ Conectado como '{name}'")
            if self._ping_thread is None or not self._ping_thread.is_alive():
                self._ping_thread = threading.Thread(target=self._ping_loop, daemon=True)
                self._ping_thread.start()

        elif msg_type == "register_error":
            log.error(f"✗ Registro falhou: {msg.get('message', '?')}")
            self._registered = False

        elif msg_type == "print":
            _print_pool.submit(self._handle_print, msg)

        elif msg_type == "pong":
            pass

        elif msg_type == "error":
            log.warning(f"Servidor: {msg.get('message', '?')}")

    def _handle_print(self, msg: dict):
        job_id = msg.get("jobId", "?")
        printer = msg.get("printer", "")
        user = msg.get("user", "?")
        template = msg.get("template", "")

        try:
            copies = max(1, min(int(float(msg.get("copies", 1))), 99))
        except (TypeError, ValueError):
            copies = 1

        label = template or "html"
        short_printer = printer.split(" ")[0] if len(printer) > 20 else printer
        log.info(f"[{job_id}] → {short_printer} x{copies} [{label}] (user={user})")

        try:
            if not printer:
                self.send({"type": "print_result", "jobId": job_id, "success": False, "error": "Impressora não especificada."})
                return

            result = print_job(msg)
            self.send({"type": "print_result", "jobId": job_id, **result})

        except Exception as e:
            log.error(f"[{job_id}] ✗ Erro inesperado: {e}")
            try:
                self.send({"type": "print_result", "jobId": job_id, "success": False, "error": f"Erro inesperado: {e}"})
            except Exception:
                pass

    def _ping_loop(self):
        while self._running and self._registered:
            time.sleep(PING_INTERVAL)
            if self._registered:
                self.send({"type": "ping"})

    def on_error(self, ws, error):
        err_msg = str(error)
        if "Connection refused" not in err_msg and "timed out" not in err_msg:
            log.warning(f"WS: {err_msg[:100]}")

    def on_close(self, ws, code, reason):
        self._registered = False
        if code and code != 1000:
            log.info(f"Desconectado (código={code})")

    def run_forever(self):
        while self._running:
            try:
                self._ws = websocket.WebSocketApp(
                    WS_URL,
                    on_open=self.on_open,
                    on_message=self.on_message,
                    on_error=self.on_error,
                    on_close=self.on_close,
                )
                ssl_opt = {}
                if WS_URL.startswith("wss://") and not VERIFY_SSL:
                    import ssl as _ssl
                    ssl_opt = {"cert_reqs": _ssl.CERT_NONE, "check_hostname": False}
                self._ws.run_forever(
                    ping_interval=0,
                    reconnect=0,
                    sslopt=ssl_opt,
                )
            except KeyboardInterrupt:
                log.info("Encerrando...")
                self._running = False
                break
            except Exception as e:
                log.error(f"Erro: {e}")

            if self._running:
                time.sleep(RECONNECT_S)

if __name__ == "__main__":
    printers = get_printers()
    printer_names = [p["name"] for p in printers]
    log.info(f"Stoker WMS Print Agent | {MACHINE_ID} | {len(printers)} impressora(s)")
    if printer_names:
        log.info(f"  Impressoras: {', '.join(printer_names)}")
    log.info(f"  Servidor: {WS_URL}")
    agent = PrintAgent()
    try:
        agent.run_forever()
    except KeyboardInterrupt:
        log.info("Agente encerrado.")
