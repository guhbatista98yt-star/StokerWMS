import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    Sheet, SheetContent, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
    Package, ShoppingBag, Archive, Box, Tag,
    Loader2, CheckCircle2, PackageOpen, Search, X, ArrowLeft, Trash2, Printer, ChevronRight, Minus, Plus,
} from "lucide-react";
import { usePrint } from "@/hooks/use-print";
import { useAuth } from "@/lib/auth";
import { format, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";

interface VolumeModalProps {
    open: boolean;
    onClose: () => void;
    defaultErpOrderId?: string | null;
}

interface OrderRow {
    id: string;
    erpOrderId: string;
    customerName: string;
    status: string;
    createdAt: string;
    address?: string;
    addressNumber?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    routeId?: string;
}

interface RouteRow {
    id: string;
    code: string;
    name: string;
}

interface OrderVolume {
    id: string;
    orderId: string;
    sacola: number;
    caixa: number;
    saco: number;
    avulso: number;
    totalVolumes: number;
}

const CATEGORIES = [
    { key: "sacola", label: "Sacola",  icon: ShoppingBag, accent: "text-blue-500",  bg: "bg-blue-50 dark:bg-blue-950/40",   border: "border-blue-200 dark:border-blue-800"  },
    { key: "caixa",  label: "Caixa",   icon: Box,         accent: "text-amber-500", bg: "bg-amber-50 dark:bg-amber-950/40", border: "border-amber-200 dark:border-amber-800" },
    { key: "saco",   label: "Saco",    icon: Archive,     accent: "text-green-500", bg: "bg-green-50 dark:bg-green-950/40", border: "border-green-200 dark:border-green-800" },
    { key: "avulso", label: "Avulso",  icon: Tag,         accent: "text-slate-500", bg: "bg-slate-50 dark:bg-slate-900/40", border: "border-slate-200 dark:border-slate-700" },
] as const;

const ALLOWED_STATUSES = ["separado", "em_conferencia", "conferido", "com_excecao"];

const STATUS_LABELS: Record<string, string> = {
    separado:       "Separado",
    em_conferencia: "Em Conferência",
    conferido:      "Conferido",
    com_excecao:    "Com Exceção",
};

const STATUS_COLORS: Record<string, string> = {
    separado:       "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    em_conferencia: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    conferido:      "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
    com_excecao:    "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
};

type Screen = "search" | "form";

export function VolumeModal({ open, onClose, defaultErpOrderId }: VolumeModalProps) {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { user, companyId, companiesData } = useAuth();
    const searchRef = useRef<HTMLInputElement>(null);

    const [screen, setScreen] = useState<Screen>("search");
    const [search, setSearch] = useState("");
    const [order, setOrder] = useState<OrderRow | null>(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [orderList, setOrderList] = useState<OrderRow[] | null>(null);
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState("");
    const [counts, setCounts] = useState({ sacola: 0, caixa: 0, saco: 0, avulso: 0 });
    const [editingKey, setEditingKey] = useState<keyof typeof counts | null>(null);
    const [editingValue, setEditingValue] = useState("");
    const editInputRef = useRef<HTMLInputElement>(null);
    const { printing, cooldownSeconds, print: printVolume } = usePrint();

    const total = counts.sacola + counts.caixa + counts.saco + counts.avulso;

    useEffect(() => {
        if (!open) {
            setScreen("search"); setSearch(""); setOrder(null);
            setOrderList(null); setSearchError("");
            setCounts({ sacola: 0, caixa: 0, saco: 0, avulso: 0 });
            setEditingKey(null);
        }
    }, [open]);

    useEffect(() => {
        if (open && defaultErpOrderId) {
            setSearch(defaultErpOrderId);
            doSearch(defaultErpOrderId);
        }
    }, [open, defaultErpOrderId]);

    useEffect(() => {
        if (open && screen === "search") {
            const t = setTimeout(() => searchRef.current?.focus(), 300);
            return () => clearTimeout(t);
        }
    }, [open, screen]);

    useEffect(() => {
        if (editingKey && editInputRef.current) {
            editInputRef.current.focus();
            editInputRef.current.select();
        }
    }, [editingKey]);

    const { data: savedVolume, isLoading: loadingVolume } = useQuery<OrderVolume | null>({
        queryKey: [`/api/order-volumes/${order?.id}`],
        enabled: !!order?.id && screen === "form",
    });

    const { data: routesList } = useQuery<RouteRow[]>({
        queryKey: ["/api/routes"],
    });

    const routeCode = order?.routeId
        ? (routesList?.find(r => r.id === order.routeId)?.code ?? null)
        : null;

    useEffect(() => {
        if (savedVolume) {
            setCounts({ sacola: savedVolume.sacola, caixa: savedVolume.caixa, saco: savedVolume.saco, avulso: savedVolume.avulso });
        } else if (order) {
            setCounts({ sacola: 0, caixa: 0, saco: 0, avulso: 0 });
        }
    }, [savedVolume, order?.id]);

    const doSearch = async (term: string) => {
        setSearching(true); setSearchError(""); setOrderList(null);
        try {
            const res = await apiRequest("GET", `/api/orders/by-erp/${encodeURIComponent(term.trim())}`);
            const found: OrderRow = await res.json();
            if (!ALLOWED_STATUSES.includes(found.status)) {
                setSearchError(`Status "${STATUS_LABELS[found.status] ?? found.status}" não permite gerar volumes.`);
                return;
            }
            setOrder(found);
            setScreen("form");
        } catch (e) {
            setSearchError(e instanceof Error ? e.message : "Erro ao buscar pedido.");
        } finally {
            setSearching(false);
        }
    };

    const loadList = async () => {
        setSearching(true); setSearchError("");
        try {
            const res = await apiRequest("GET", "/api/orders");
            const all: OrderRow[] = await res.json();
            const fromMs = new Date(subDays(new Date(), 6)).setHours(0, 0, 0, 0);
            const filtered = all.filter(o => {
                if (!ALLOWED_STATUSES.includes(o.status)) return false;
                if (o.createdAt) {
                    const t = new Date(o.createdAt).getTime();
                    if (t < fromMs) return false;
                }
                return true;
            });
            setOrderList(filtered);
        } catch (e) {
            setSearchError(e instanceof Error ? e.message : "Erro de conexão ao carregar pedidos.");
        } finally {
            setSearching(false);
        }
    };

    const handleSearch = () => { search.trim() ? doSearch(search.trim()) : loadList(); };

    const selectOrder = (row: OrderRow) => {
        setOrder(row); setSearch(row.erpOrderId);
        setOrderList(null); setScreen("form");
    };

    const goBack = () => {
        setScreen("search"); setOrder(null); setOrderList(null);
        setCounts({ sacola: 0, caixa: 0, saco: 0, avulso: 0 });
        setEditingKey(null);
    };

    const adjust = (key: keyof typeof counts, delta: number) =>
        setCounts(prev => ({ ...prev, [key]: Math.max(0, prev[key] + delta) }));

    const startEditing = (key: keyof typeof counts) => {
        setEditingKey(key);
        setEditingValue(String(counts[key]));
    };

    const commitEdit = () => {
        if (!editingKey) return;
        const v = parseInt(editingValue, 10);
        if (!isNaN(v) && v >= 0) {
            setCounts(prev => ({ ...prev, [editingKey]: v }));
        }
        setEditingKey(null);
        setEditingValue("");
    };

    const saveMutation = useMutation({
        mutationFn: () =>
            apiRequest("POST", "/api/order-volumes", {
                orderId: order!.id, erpOrderId: order!.erpOrderId, ...counts,
            }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/order-volumes/${order?.id}`] });
            queryClient.invalidateQueries({ queryKey: ["/api/order-volumes"] });
            toast({ title: "Volumes salvos!", description: `${total} volume(s) · Pedido ${order?.erpOrderId}.` });
        },
        onError: (err: any) => {
            toast({ title: "Erro ao salvar", description: err?.message || "Tente novamente.", variant: "destructive" });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: () => apiRequest("DELETE", `/api/order-volumes/${order?.id}`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/order-volumes/${order?.id}`] });
            queryClient.invalidateQueries({ queryKey: ["/api/order-volumes"] });
            setCounts({ sacola: 0, caixa: 0, saco: 0, avulso: 0 });
            toast({ title: "Volumes apagados", description: `Pedido ${order?.erpOrderId}.` });
        },
        onError: (err: any) => {
            toast({ title: "Erro ao apagar", description: err?.message || "Tente novamente.", variant: "destructive" });
        },
    });

    const buildVolumeData = (): { template: string; data: Record<string, unknown> } | null => {
        if (total === 0 || !order) return null;
        const op = user?.name || user?.username || "—";
        const now = new Date();
        const dStr = now.toLocaleDateString("pt-BR");
        const tStr = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
        const addressLine = [order.address, order.addressNumber ? `nº ${order.addressNumber}` : ""].filter(Boolean).join(", ");
        const cityLine = [order.city, order.state].filter(Boolean).join(" - ");
        const senderCompany = companiesData.find(c => c.id === companyId);
        const senderName = senderCompany?.name || "";
        const routeEntry = routesList?.find(r => r.id === order.routeId);
        const routeName = routeEntry?.name || routeEntry?.code || routeCode || "";
        const volumes = Array.from({ length: total }, (_, i) => ({
            erpOrderId: order.erpOrderId,
            volumeNumber: i + 1,
            totalVolumes: total,
            routeCode: routeCode || "—",
            routeName: routeName || "—",
            customerName: order.customerName || "—",
            address: addressLine,
            neighborhood: order.neighborhood || "",
            cityState: cityLine,
            operator: op,
            date: dStr,
            time: tStr,
            counts: { ...counts },
            barcode: `${order.erpOrderId}${String(i + 1).padStart(3, "0")}`,
            sender: senderName,
        }));
        return { template: "volume_label", data: { volumes } };
    };

    return (
    <>
        <Sheet open={open} onOpenChange={v => !v && onClose()}>
            <SheetContent
                side="right"
                className="w-full sm:max-w-[420px] p-0 flex flex-col gap-0 [&>button]:hidden"
                data-testid="sheet-volume"
            >
                <SheetTitle className="sr-only">Gerar Volume</SheetTitle>
                <SheetDescription className="sr-only">
                    {screen === "search" ? "Buscar pedido para gerar volumes" : order ? `Volumes do pedido ${order.erpOrderId}` : ""}
                </SheetDescription>

                {/* ── HEADER (padrão do app) ──────────────────────── */}
                <div className="flex items-center justify-between px-3 py-2.5 border-b border-border bg-card shrink-0">
                    <div className="flex items-center gap-2 min-w-0">
                        {screen === "form" ? (
                            <button
                                onClick={goBack}
                                className="text-muted-foreground hover:text-foreground transition-colors shrink-0 -ml-0.5 p-1"
                                data-testid="btn-volume-back"
                            >
                                <ArrowLeft className="h-5 w-5" />
                            </button>
                        ) : (
                            <PackageOpen className="h-5 w-5 text-muted-foreground shrink-0" />
                        )}
                        <div className="min-w-0">
                            <p className="text-sm font-semibold leading-tight truncate">
                                {screen === "search" ? "Gerar Volume" : `Pedido ${order?.erpOrderId}`}
                            </p>
                            {screen === "form" && order?.customerName && (
                                <p className="text-xs text-muted-foreground truncate leading-tight">{order.customerName}</p>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                        {screen === "form" && order?.status && (
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${STATUS_COLORS[order.status] ?? ""}`}>
                                {STATUS_LABELS[order.status] ?? order.status}
                            </span>
                        )}
                        {screen === "form" && savedVolume && (
                            <Badge className="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 border-0 text-[10px] gap-1 px-2">
                                <CheckCircle2 className="h-3 w-3" /> Salvo
                            </Badge>
                        )}
                        {screen === "form" && total > 0 && (
                            <Badge variant="secondary" className="text-xs font-bold tabular-nums px-2.5">
                                {total} vol.
                            </Badge>
                        )}
                        <button
                            onClick={onClose}
                            className="text-muted-foreground hover:text-foreground transition-colors p-1"
                            data-testid="btn-volume-close"
                        >
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                </div>

                {/* ── TELA BUSCA ──────────────────────────────────── */}
                {screen === "search" && (
                    <div className="flex flex-col flex-1 overflow-hidden bg-background">
                        {/* Campo de busca */}
                        <div className="px-4 pt-4 pb-3 space-y-2 border-b border-border shrink-0">
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50 pointer-events-none" />
                                    <Input
                                        ref={searchRef}
                                        placeholder="Número do pedido..."
                                        value={search}
                                        onChange={e => { setSearch(e.target.value); setSearchError(""); setOrderList(null); }}
                                        onKeyDown={e => e.key === "Enter" && handleSearch()}
                                        className="pl-9 pr-8 h-12 rounded-xl text-sm font-mono"
                                        inputMode="numeric"
                                        data-testid="input-volume-search"
                                    />
                                    {search && (
                                        <button
                                            onClick={() => { setSearch(""); setSearchError(""); setOrderList(null); }}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                        >
                                            <X className="h-4 w-4" />
                                        </button>
                                    )}
                                </div>
                                <Button
                                    className="h-12 px-5 rounded-xl gap-2 shrink-0"
                                    onClick={handleSearch}
                                    disabled={searching}
                                    data-testid="btn-volume-search"
                                >
                                    {searching
                                        ? <Loader2 className="h-4 w-4 animate-spin" />
                                        : <><Search className="h-4 w-4" /><span className="text-sm">Buscar</span></>
                                    }
                                </Button>
                            </div>
                            {searchError && (
                                <p className="text-sm text-destructive font-medium px-1">{searchError}</p>
                            )}
                            {orderList !== null && (
                                <p className="text-xs text-muted-foreground px-1">
                                    {orderList.length === 0
                                        ? "Nenhum pedido disponível nos últimos 7 dias."
                                        : `${orderList.length} pedido(s) disponível(is)`}
                                </p>
                            )}
                        </div>

                        {/* Lista / estado vazio */}
                        <div className="flex-1 overflow-y-auto">
                            {orderList === null && !searching && (
                                <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center py-16">
                                    <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
                                        <Package className="h-8 w-8 text-muted-foreground/30" />
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-sm font-medium text-foreground">Digite o número do pedido</p>
                                        <p className="text-xs text-muted-foreground leading-relaxed">
                                            Ou toque em <strong>Buscar</strong> sem nada digitado para ver todos os pedidos disponíveis.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {searching && (
                                <div className="flex justify-center py-12">
                                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/40" />
                                </div>
                            )}

                            {orderList !== null && orderList.length > 0 && (
                                <div className="px-4 py-3 space-y-2">
                                    {orderList.map(row => (
                                        <button
                                            key={row.id}
                                            className="w-full text-left rounded-2xl border border-border bg-card px-4 py-3 hover:bg-muted/50 active:scale-[0.99] transition-all flex items-center gap-3"
                                            onClick={() => selectOrder(row)}
                                            data-testid={`btn-volume-order-${row.id}`}
                                        >
                                            <div className="w-8 h-8 rounded-xl bg-muted flex items-center justify-center shrink-0">
                                                <Package className="h-4 w-4 text-muted-foreground/60" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-mono font-bold text-sm">{row.erpOrderId}</p>
                                                <p className="text-xs text-muted-foreground truncate">{row.customerName}</p>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-lg ${STATUS_COLORS[row.status] ?? ""}`}>
                                                    {STATUS_LABELS[row.status] ?? row.status}
                                                </span>
                                                <ChevronRight className="h-4 w-4 text-muted-foreground/40" />
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ── TELA FORMULÁRIO ─────────────────────────────── */}
                {screen === "form" && order && (
                    <div className="flex flex-col flex-1 overflow-hidden bg-background">
                        {/* Contadores */}
                        <div className="flex-1 overflow-y-auto">
                            {loadingVolume ? (
                                <div className="flex justify-center py-16">
                                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/40" />
                                </div>
                            ) : (
                                <div className="px-4 py-4 space-y-3">
                                    {CATEGORIES.map(({ key, label, icon: Icon, accent, bg, border }) => (
                                        <div
                                            key={key}
                                            className={`flex items-center rounded-2xl border ${border} ${bg} px-4 py-3 gap-4`}
                                            data-testid={`row-volume-${key}`}
                                        >
                                            {/* Ícone + label */}
                                            <div className="flex items-center gap-2.5 flex-1 min-w-0">
                                                <Icon className={`h-5 w-5 shrink-0 ${accent}`} />
                                                <span className="font-semibold text-sm text-foreground">{label}</span>
                                            </div>

                                            {/* Controles */}
                                            <div className="flex items-center gap-1.5 shrink-0">
                                                {/* Botão − */}
                                                <button
                                                    onClick={() => adjust(key, -1)}
                                                    disabled={counts[key] === 0}
                                                    className="w-12 h-12 rounded-xl border border-border bg-background flex items-center justify-center hover:bg-muted active:scale-95 transition-transform select-none touch-manipulation disabled:opacity-30"
                                                    data-testid={`btn-volume-${key}-minus`}
                                                >
                                                    <Minus className="h-4 w-4" />
                                                </button>

                                                {/* Contador — toque para digitar */}
                                                {editingKey === key ? (
                                                    <input
                                                        ref={editInputRef}
                                                        type="number"
                                                        min="0"
                                                        value={editingValue}
                                                        onChange={e => setEditingValue(e.target.value)}
                                                        onBlur={commitEdit}
                                                        onKeyDown={e => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditingKey(null); }}
                                                        className="w-14 h-12 text-center font-extrabold text-xl tabular-nums bg-background border border-primary rounded-xl outline-none focus:ring-2 focus:ring-primary/30"
                                                        data-testid={`input-volume-${key}-edit`}
                                                    />
                                                ) : (
                                                    <button
                                                        onClick={() => startEditing(key)}
                                                        className="w-14 h-12 text-center font-extrabold text-2xl tabular-nums rounded-xl hover:bg-muted/60 active:scale-95 transition-transform select-none touch-manipulation"
                                                        title="Toque para digitar"
                                                        data-testid={`count-volume-${key}`}
                                                    >
                                                        {counts[key]}
                                                    </button>
                                                )}

                                                {/* Botão + */}
                                                <button
                                                    onClick={() => adjust(key, 1)}
                                                    className="w-12 h-12 rounded-xl border border-border bg-background flex items-center justify-center hover:bg-muted active:scale-95 transition-transform select-none touch-manipulation"
                                                    data-testid={`btn-volume-${key}-plus`}
                                                >
                                                    <Plus className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </div>
                                    ))}

                                    {/* Total */}
                                    <div className="rounded-2xl overflow-hidden border border-blue-300/50 dark:border-blue-700/50 mt-1">
                                        <div className="bg-gradient-to-r from-blue-600 to-blue-500 dark:from-blue-700 dark:to-blue-600 px-5 py-4 flex items-center justify-between">
                                            <div className="flex items-center gap-2.5">
                                                <Package className="h-5 w-5 text-white/80" />
                                                <span className="font-semibold text-white text-sm">Total de Volumes</span>
                                            </div>
                                            <span className="text-4xl font-extrabold text-white tabular-nums tracking-tight" data-testid="text-volume-total">
                                                {total}
                                            </span>
                                        </div>
                                        {total > 0 && (
                                            <div className="bg-blue-50 dark:bg-blue-950/30 px-5 py-2">
                                                <p className="text-[11px] text-blue-600/80 dark:text-blue-400/80 font-mono">
                                                    {Array.from({ length: Math.min(total, 5) }, (_, i) => `${i+1}/${total}`).join(" · ")}
                                                    {total > 5 ? ` · … · ${total}/${total}` : ""}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* ── Barra de ações ─────────────────────────── */}
                        <div className="px-4 pt-3 pb-4 border-t border-border bg-background space-y-2 shrink-0">
                            {/* Linha principal: Salvar + Imprimir */}
                            <div className="flex gap-2">
                                <Button
                                    className="flex-1 h-13 rounded-xl bg-blue-600 hover:bg-blue-700 text-white gap-2 text-sm font-semibold"
                                    style={{ height: "52px" }}
                                    onClick={() => saveMutation.mutate()}
                                    disabled={total === 0 || saveMutation.isPending}
                                    data-testid="btn-volume-save"
                                >
                                    {saveMutation.isPending
                                        ? <><Loader2 className="h-4 w-4 shrink-0 animate-spin" /> Salvando...</>
                                        : <><CheckCircle2 className="h-4 w-4 shrink-0" /> Salvar {total > 0 ? `${total} vol.` : ""}</>}
                                </Button>

                                {total > 0 && (
                                    <Button
                                        variant="outline"
                                        className="h-13 w-14 p-0 rounded-xl shrink-0"
                                        style={{ height: "52px", width: "52px" }}
                                        onClick={() => { const vd = buildVolumeData(); if (vd) printVolume(null, "volume_label", vd); }}
                                        disabled={saveMutation.isPending || printing || cooldownSeconds > 0}
                                        title={cooldownSeconds > 0 ? `Aguarde ${cooldownSeconds}s` : "Imprimir etiquetas"}
                                        data-testid="btn-volume-print"
                                    >
                                        {printing
                                            ? <Loader2 className="h-4 w-4 animate-spin" />
                                            : cooldownSeconds > 0
                                                ? <span className="text-xs font-mono tabular-nums">{cooldownSeconds}s</span>
                                                : <Printer className="h-4 w-4" />}
                                    </Button>
                                )}
                            </div>

                            {/* Linha secundária: Apagar */}
                            {savedVolume && (
                                <Button
                                    variant="ghost"
                                    className="w-full h-10 rounded-xl text-destructive hover:bg-destructive/10 hover:text-destructive gap-2 text-sm"
                                    onClick={() => setShowDeleteConfirm(true)}
                                    disabled={deleteMutation.isPending || saveMutation.isPending}
                                    data-testid="btn-volume-delete"
                                >
                                    {deleteMutation.isPending
                                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        : <Trash2 className="h-3.5 w-3.5" />}
                                    Apagar volumes salvos
                                </Button>
                            )}
                        </div>
                    </div>
                )}
            </SheetContent>
        </Sheet>

        <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Apagar volumes</AlertDialogTitle>
                    <AlertDialogDescription>
                        Apagar todos os volumes salvos do pedido <strong>{order?.erpOrderId}</strong>? Esta ação não pode ser desfeita.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                        className="bg-red-600 hover:bg-red-700 text-white"
                        onClick={() => {
                            deleteMutation.mutate();
                            setShowDeleteConfirm(false);
                        }}
                    >
                        Apagar
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    </>
    );
}
