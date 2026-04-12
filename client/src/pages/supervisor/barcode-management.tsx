import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Search, Loader2, Barcode, Plus, Pencil, Power, PowerOff,
  History, ChevronLeft, ChevronRight, X, Package, Upload, FileSpreadsheet,
  CheckCircle, AlertTriangle, XCircle, Download, MinusCircle,
} from "lucide-react";
import { useLocation } from "wouter";
import * as XLSX from "xlsx";

interface BarcodeRecord {
  id: string;
  companyId: number | null;
  productId: string;
  barcode: string;
  type: "UNITARIO" | "EMBALAGEM";
  packagingQty: number;
  packagingType: string | null;
  active: boolean;
  isPrimary: boolean;
  notes: string | null;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  deactivatedAt: string | null;
  deactivatedBy: string | null;
  productName: string | null;
  erpCode: string | null;
  productSection: string | null;
  manufacturer: string | null;
}

interface BarcodeItem {
  id: string;
  barcode: string;
  type: "UNITARIO" | "EMBALAGEM";
  packagingQty: number;
  packagingType: string | null;
  active: boolean;
  isPrimary: boolean;
  notes: string | null;
  createdAt: string | null;
  createdBy: string | null;
}

interface ProductWithBarcodes {
  productId: string;
  productName: string;
  erpCode: string;
  manufacturer: string | null;
  erpBarcode: string | null;
  erpBoxBarcode: string | null;
  allBarcodes: BarcodeItem[];
}

interface HistoryRecord {
  id: number;
  barcodeId: string | null;
  productId: string;
  operation: string;
  oldBarcode: string | null;
  newBarcode: string | null;
  barcodeType: string | null;
  oldQty: number | null;
  newQty: number | null;
  userId: string | null;
  userName: string | null;
  notes: string | null;
  createdAt: string;
}

interface ProductSearchResult {
  id: string;
  erpCode: string;
  name: string;
  barcode: string | null;
  section: string;
}

const OPERATION_LABELS: Record<string, string> = {
  criacao: "Criação",
  edicao: "Edição",
  substituicao: "Substituição",
  desativacao: "Desativação",
  ativacao: "Ativação",
};

function formatDate(d: string | null) {
  if (!d) return "-";
  try {
    return new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch { return d; }
}

export default function BarcodeManagementPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const [editDialog, setEditDialog] = useState<BarcodeRecord | null>(null);
  const [createDialog, setCreateDialog] = useState(false);
  const [historyDialog, setHistoryDialog] = useState<string | null>(null);
  const [deactivateDialog, setDeactivateDialog] = useState<BarcodeRecord | null>(null);
  const [deactivateNotes, setDeactivateNotes] = useState("");

  const [importDialog, setImportDialog] = useState(false);
  const [importStep, setImportStep] = useState<"upload" | "preview" | "result">("upload");
  const [importRows, setImportRows] = useState<{ productId: string; eanUnitario?: string; eanEmbalagem?: string; qtdEmbalagem?: number }[]>([]);
  const [importResults, setImportResults] = useState<any[]>([]);
  const [importSummary, setImportSummary] = useState<{ ok: number; warn: number; error: number } | null>(null);
  const [importSkipped, setImportSkipped] = useState(0);
  const [importFileName, setImportFileName] = useState("");
  const importFileRef = useRef<HTMLInputElement>(null);

  const [formBarcode, setFormBarcode] = useState("");
  const [formType, setFormType] = useState<"UNITARIO" | "EMBALAGEM">("UNITARIO");
  const [formQty, setFormQty] = useState("1");
  const [formPkgType, setFormPkgType] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formProductId, setFormProductId] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [debouncedProductSearch, setDebouncedProductSearch] = useState("");
  const productDebounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (productDebounceRef.current) clearTimeout(productDebounceRef.current);
    };
  }, []);

  const handleSearch = useCallback((v: string) => {
    setSearch(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setDebouncedSearch(v); setPage(1); }, 350);
  }, []);

  const handleProductSearch = useCallback((v: string) => {
    setProductSearch(v);
    if (productDebounceRef.current) clearTimeout(productDebounceRef.current);
    productDebounceRef.current = setTimeout(() => setDebouncedProductSearch(v), 350);
  }, []);

  const productQueryParams = new URLSearchParams();
  if (debouncedSearch) productQueryParams.set("search", debouncedSearch);
  productQueryParams.set("page", String(page));
  productQueryParams.set("limit", "50");

  const { data, isLoading } = useQuery<{ data: ProductWithBarcodes[]; total: number; page: number; pageSize: number }>({
    queryKey: ["/api/barcodes/products", debouncedSearch, page],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/barcodes/products?${productQueryParams.toString()}`);
      return res.json();
    },
  });

  const { data: historyData, isLoading: historyLoading } = useQuery<HistoryRecord[]>({
    queryKey: ["/api/barcodes/history", historyDialog],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/barcodes/history/${historyDialog}`);
      return res.json();
    },
    enabled: !!historyDialog,
  });

  const { data: productResults = [] } = useQuery<ProductSearchResult[]>({
    queryKey: ["/api/products/search-for-barcode", debouncedProductSearch],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/products/search-for-barcode?q=${encodeURIComponent(debouncedProductSearch)}`);
      return res.json();
    },
    enabled: debouncedProductSearch.length >= 2,
  });

  const invalidateBarcodes = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/barcodes/products"] });
    queryClient.invalidateQueries({ queryKey: ["/api/barcodes"] });
  };

  const createMutation = useMutation({
    mutationFn: async (body: any) => apiRequest("POST", "/api/barcodes", body),
    onSuccess: () => { invalidateBarcodes(); setCreateDialog(false); resetForm(); },
    onError: (e: Error) => toast({ variant: "destructive", title: "Erro", description: e.message || "Erro ao cadastrar" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: any }) => apiRequest("PUT", `/api/barcodes/${id}`, body),
    onSuccess: () => { invalidateBarcodes(); setEditDialog(null); resetForm(); },
    onError: (e: Error) => toast({ variant: "destructive", title: "Erro", description: e.message || "Erro ao atualizar" }),
  });

  const deactivateMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => apiRequest("PATCH", `/api/barcodes/${id}/deactivate`, { notes }),
    onSuccess: () => { invalidateBarcodes(); setDeactivateDialog(null); setDeactivateNotes(""); },
    onError: (e: Error) => toast({ variant: "destructive", title: "Erro", description: e.message || "Erro ao desativar" }),
  });

  const activateMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("PATCH", `/api/barcodes/${id}/activate`),
    onSuccess: () => invalidateBarcodes(),
    onError: (e: Error) => toast({ variant: "destructive", title: "Erro", description: e.message || "Erro ao ativar" }),
  });

  const importMutation = useMutation({
    mutationFn: async (rows: typeof importRows) => {
      const res = await apiRequest("POST", "/api/barcodes/import", { rows }, { timeoutMs: 300000 });
      return res.json();
    },
    onSuccess: (data: any) => {
      setImportResults(data.results || []);
      setImportSummary(data.summary || null);
      setImportStep("result");
      invalidateBarcodes();
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Erro ao importar", description: e.message }),
  });

  function openImport() {
    setImportStep("upload");
    setImportRows([]);
    setImportResults([]);
    setImportSummary(null);
    setImportSkipped(0);
    setImportFileName("");
    setImportDialog(true);
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const data = ev.target?.result;
      const wb = XLSX.read(data, { type: "binary" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
      const allMapped = json.map((row: any) => {
        const productId = String(row["Código do produto"] || row["codigo_produto"] || row["CODIGO"] || row["Produto"] || "").trim();
        const eanUnitario = String(row["EAN unitário"] || row["EAN_UNITARIO"] || row["ean_unitario"] || row["EAN Unitário"] || "").trim();
        const eanEmbalagem = String(row["EAN embalagem"] || row["EAN_EMBALAGEM"] || row["ean_embalagem"] || row["EAN Embalagem"] || "").trim();
        const qtdEmbalagem = Number(row["Qtd embalagem"] || row["QTD_EMBALAGEM"] || row["qtd_embalagem"] || row["Qtd Embalagem"] || 0);
        return { productId, eanUnitario: eanUnitario || undefined, eanEmbalagem: eanEmbalagem || undefined, qtdEmbalagem: qtdEmbalagem || undefined };
      });
      const mapped = allMapped.filter(r => r.eanUnitario || r.eanEmbalagem);
      setImportSkipped(allMapped.length - mapped.length);
      setImportRows(mapped);
      if (mapped.length > 0) setImportStep("preview");
      else toast({ variant: "destructive", title: "Arquivo inválido", description: "Nenhuma linha com EAN válido encontrada. Verifique os cabeçalhos." });
    };
    reader.readAsBinaryString(file);
    e.target.value = "";
  }

  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Código do produto", "EAN unitário", "EAN embalagem", "Qtd embalagem"],
      ["001234", "7891234567890", "17891234567890", "12"],
      ["005678", "7899876543210", "", ""],
    ]);
    ws["!cols"] = [{ wch: 20 }, { wch: 18 }, { wch: 18 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Importação");
    XLSX.writeFile(wb, "modelo_importacao_codigos_barras.xlsx");
  }

  function resetForm() {
    setFormBarcode(""); setFormType("UNITARIO"); setFormQty("1");
    setFormPkgType(""); setFormNotes(""); setFormProductId("");
    setProductSearch(""); setDebouncedProductSearch("");
  }

  function openCreate() {
    resetForm();
    setCreateDialog(true);
  }

  function openCreateForProduct(row: ProductWithBarcodes) {
    resetForm();
    setFormProductId(row.productId);
    setProductSearch(`${row.erpCode} - ${row.productName}`);
    setCreateDialog(true);
  }

  function openEdit(rec: BarcodeRecord) {
    setFormBarcode(rec.barcode);
    setFormType(rec.type);
    setFormQty(String(rec.packagingQty));
    setFormPkgType(rec.packagingType || "");
    setFormNotes(rec.notes || "");
    setFormProductId(rec.productId);
    setEditDialog(rec);
  }

  function openEditBarcode(item: BarcodeItem, row: ProductWithBarcodes) {
    const synthetic: BarcodeRecord = {
      id: item.id,
      productId: row.productId,
      barcode: item.barcode,
      type: item.type,
      packagingQty: item.packagingQty,
      packagingType: item.packagingType,
      active: item.active,
      isPrimary: item.isPrimary,
      notes: item.notes,
      createdAt: item.createdAt || "",
      createdBy: item.createdBy,
      updatedAt: null, updatedBy: null,
      deactivatedAt: null, deactivatedBy: null, companyId: null,
      productName: row.productName, erpCode: row.erpCode,
      productSection: null, manufacturer: row.manufacturer,
    };
    openEdit(synthetic);
  }

  function openDeactivateBarcode(item: BarcodeItem, row: ProductWithBarcodes) {
    setDeactivateDialog({
      id: item.id,
      productId: row.productId,
      barcode: item.barcode,
      type: item.type,
      packagingQty: item.packagingQty,
      packagingType: item.packagingType,
      active: item.active,
      isPrimary: item.isPrimary,
      notes: item.notes,
      createdAt: item.createdAt || "",
      createdBy: item.createdBy,
      updatedAt: null, updatedBy: null,
      deactivatedAt: null, deactivatedBy: null, companyId: null,
      productName: row.productName, erpCode: row.erpCode,
      productSection: null, manufacturer: row.manufacturer,
    });
    setDeactivateNotes("");
  }

  function handleCreate() {
    if (!formProductId || !formBarcode) return;
    createMutation.mutate({
      productId: formProductId,
      barcode: formBarcode.trim(),
      type: formType,
      packagingQty: Number(formQty) || 1,
      packagingType: formPkgType || null,
      notes: formNotes || null,
    });
  }

  function handleUpdate() {
    if (!editDialog || !formBarcode) return;
    updateMutation.mutate({
      id: editDialog.id,
      body: {
        barcode: formBarcode.trim(),
        packagingQty: Number(formQty) || 1,
        packagingType: formPkgType || null,
        notes: formNotes || null,
      },
    });
  }

  const productRows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 50);

  return (
    <div className="min-h-screen bg-background">
      <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-base font-semibold text-foreground leading-tight">Gestão de Códigos de Barras</h1>
            <p className="text-xs text-muted-foreground">Gerenciar EANs por produto</p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-4 space-y-4">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              data-testid="input-barcode-search"
              placeholder="Buscar por código, produto ou código interno..."
              value={search}
              onChange={e => handleSearch(e.target.value)}
              className="pl-10 rounded-xl"
            />
            {search && (
              <button className="absolute right-3 top-1/2 -translate-y-1/2" onClick={() => { setSearch(""); setDebouncedSearch(""); }}>
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="rounded-xl gap-2" onClick={openImport} data-testid="button-import-barcodes">
              <Upload className="h-4 w-4" />
              <span className="hidden sm:inline">Importar</span>
            </Button>
            <Button className="rounded-xl gap-2" onClick={openCreate} data-testid="button-create-barcode">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Cadastrar</span>
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
        ) : productRows.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Barcode className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>Nenhum produto com código de barras encontrado</p>
          </div>
        ) : (
          <>
            <div className="text-sm text-muted-foreground">{total.toLocaleString("pt-BR")} produto(s)</div>
            <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/30 bg-muted/30">
                      <th className="text-left px-4 py-3 font-medium">Produto</th>
                      <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Cód. Interno</th>
                      <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Fornecedor</th>
                      <th className="text-left px-4 py-3 font-medium">Códigos de Barras</th>
                      <th className="text-right px-4 py-3 font-medium">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {productRows.map(row => {
                      const activeBarcodes = row.allBarcodes.filter(b => b.active);
                      const inactiveBarcodes = row.allBarcodes.filter(b => !b.active);
                      return (
                        <tr key={row.productId} className="hover:bg-muted/20 align-top" data-testid={`row-product-${row.productId}`}>
                          {/* Produto */}
                          <td className="px-4 py-3 max-w-[200px]">
                            <div className="font-medium leading-tight truncate" title={row.productName}>{row.productName}</div>
                          </td>
                          {/* Cód. Interno */}
                          <td className="px-4 py-3 hidden sm:table-cell font-mono text-xs text-muted-foreground whitespace-nowrap">{row.erpCode || "—"}</td>
                          {/* Fornecedor */}
                          <td className="px-4 py-3 hidden md:table-cell">
                            <span className="text-xs text-muted-foreground">{row.manufacturer || <span className="italic opacity-50">—</span>}</span>
                          </td>
                          {/* Todos os códigos de barras */}
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1.5">
                              {/* ERP unitário */}
                              {row.erpBarcode && (
                                <div className="flex items-center gap-1 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-2 py-1" title="Código de barras do ERP (somente leitura)">
                                  <span className="text-[9px] font-bold uppercase tracking-wide text-blue-600 dark:text-blue-400 leading-none">ERP UN</span>
                                  <span className="font-mono text-xs text-blue-700 dark:text-blue-300 leading-none ml-1">{row.erpBarcode}</span>
                                </div>
                              )}
                              {/* ERP embalagem */}
                              {row.erpBoxBarcode && (
                                <div className="flex items-center gap-1 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 px-2 py-1" title="Código de barras de embalagem do ERP (somente leitura)">
                                  <span className="text-[9px] font-bold uppercase tracking-wide text-indigo-600 dark:text-indigo-400 leading-none">ERP EMB</span>
                                  <span className="font-mono text-xs text-indigo-700 dark:text-indigo-300 leading-none ml-1">{row.erpBoxBarcode}</span>
                                </div>
                              )}
                              {/* Barcodes ativos da tabela product_barcodes */}
                              {activeBarcodes.map(item => (
                                <div key={item.id} className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/30 px-2 py-1 group">
                                  <div className="flex flex-col leading-none gap-0.5">
                                    <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
                                      {item.type === "UNITARIO" ? "UN" : `EMB${item.packagingQty > 1 ? ` ×${item.packagingQty}` : ""}`}
                                      {item.packagingType ? ` · ${item.packagingType}` : ""}
                                    </span>
                                    <span className="font-mono text-xs leading-none">{item.barcode}</span>
                                  </div>
                                  <div className="flex items-center gap-0.5 ml-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                    <Button
                                      variant="ghost" size="icon"
                                      className="h-5 w-5 rounded"
                                      onClick={() => openEditBarcode(item, row)}
                                      title="Editar"
                                      data-testid={`button-edit-bc-${item.id}`}
                                    >
                                      <Pencil className="h-2.5 w-2.5" />
                                    </Button>
                                    <Button
                                      variant="ghost" size="icon"
                                      className="h-5 w-5 rounded text-red-400 hover:text-red-600"
                                      onClick={() => openDeactivateBarcode(item, row)}
                                      title="Desativar"
                                      data-testid={`button-deact-bc-${item.id}`}
                                    >
                                      <PowerOff className="h-2.5 w-2.5" />
                                    </Button>
                                  </div>
                                </div>
                              ))}
                              {/* Barcodes inativos (colapsados) */}
                              {inactiveBarcodes.length > 0 && (
                                <div className="flex items-center gap-1 rounded-lg border border-border/30 bg-muted/10 px-2 py-1 opacity-50" title={`${inactiveBarcodes.length} código(s) desativado(s): ${inactiveBarcodes.map(b => b.barcode).join(", ")}`}>
                                  <PowerOff className="h-2.5 w-2.5 text-muted-foreground" />
                                  <span className="text-[10px] text-muted-foreground line-through font-mono">{inactiveBarcodes.length === 1 ? inactiveBarcodes[0].barcode : `${inactiveBarcodes.length} inativos`}</span>
                                </div>
                              )}
                              {/* Nenhum barcode */}
                              {!row.erpBarcode && !row.erpBoxBarcode && row.allBarcodes.length === 0 && (
                                <span className="text-muted-foreground italic text-xs">—</span>
                              )}
                            </div>
                          </td>
                          {/* Ações */}
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost" size="icon"
                                className="h-8 w-8 rounded-lg"
                                onClick={() => openCreateForProduct(row)}
                                title="Adicionar código de barras"
                                data-testid={`button-add-barcode-${row.productId}`}
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost" size="icon"
                                className="h-8 w-8 rounded-lg"
                                onClick={() => setHistoryDialog(row.productId)}
                                title="Histórico de alterações"
                                data-testid={`button-history-${row.productId}`}
                              >
                                <History className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2">
                <Button variant="outline" size="icon" className="rounded-xl" disabled={page <= 1} onClick={() => setPage(p => p - 1)} data-testid="button-prev-page">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground">Página {page} de {totalPages}</span>
                <Button variant="outline" size="icon" className="rounded-xl" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} data-testid="button-next-page">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <Dialog open={createDialog} onOpenChange={v => { if (!v) { setCreateDialog(false); resetForm(); } }}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader><DialogTitle>Cadastrar Código de Barras</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Produto</label>
              <Input
                data-testid="input-product-search-create"
                placeholder="Buscar produto..."
                value={productSearch}
                onChange={e => handleProductSearch(e.target.value)}
                className="rounded-xl"
              />
              {debouncedProductSearch.length >= 2 && productResults.length > 0 && !formProductId && (
                <div className="mt-1 rounded-xl border border-border/50 bg-card max-h-40 overflow-y-auto">
                  {productResults.map(p => (
                    <button
                      key={p.id}
                      className="w-full text-left px-3 py-2 hover:bg-muted/50 text-sm"
                      data-testid={`button-select-product-${p.id}`}
                      onClick={() => { setFormProductId(p.id); setProductSearch(`${p.erpCode} - ${p.name}`); setDebouncedProductSearch(""); }}
                    >
                      <span className="font-mono text-xs text-muted-foreground">{p.erpCode}</span>
                      <span className="ml-2">{p.name}</span>
                    </button>
                  ))}
                </div>
              )}
              {formProductId && (
                <Button variant="ghost" size="sm" className="mt-1 text-xs" onClick={() => { setFormProductId(""); setProductSearch(""); }}>
                  Alterar produto
                </Button>
              )}
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Código de Barras</label>
              <Input data-testid="input-barcode-create" value={formBarcode} onChange={e => setFormBarcode(e.target.value)} placeholder="Bipe ou digite o código" className="rounded-xl font-mono" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">Tipo</label>
                <Select value={formType} onValueChange={v => {
                  const t = v as "UNITARIO" | "EMBALAGEM";
                  setFormType(t);
                  if (t === "UNITARIO") { setFormPkgType(""); setFormQty("1"); }
                }}>
                  <SelectTrigger className="rounded-xl" data-testid="select-type-create">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="UNITARIO">Unitário</SelectItem>
                    <SelectItem value="EMBALAGEM">Embalagem</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Qtd Embalagem</label>
                <Input
                  data-testid="input-qty-create"
                  type="number"
                  min="1"
                  value={formQty}
                  onChange={e => setFormQty(e.target.value)}
                  className="rounded-xl"
                  disabled={formType === "UNITARIO"}
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Tipo Embalagem</label>
              <Select value={formPkgType} onValueChange={setFormPkgType} disabled={formType === "UNITARIO"}>
                <SelectTrigger className="rounded-xl" data-testid="select-pkg-type-create">
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Caixa">Caixa</SelectItem>
                  <SelectItem value="Fardo">Fardo</SelectItem>
                  <SelectItem value="Pacote">Pacote</SelectItem>
                  <SelectItem value="Saco">Saco</SelectItem>
                  <SelectItem value="Display">Display</SelectItem>
                  <SelectItem value="Bandeja">Bandeja</SelectItem>
                  <SelectItem value="Pallet">Pallet</SelectItem>
                  <SelectItem value="Caixeta">Caixeta</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Observação</label>
              <Textarea data-testid="input-notes-create" value={formNotes} onChange={e => setFormNotes(e.target.value)} placeholder="Opcional" className="rounded-xl" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => { setCreateDialog(false); resetForm(); }}>Cancelar</Button>
            <Button className="rounded-xl" onClick={handleCreate} disabled={!formProductId || !formBarcode.trim() || createMutation.isPending} data-testid="button-confirm-create">
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Cadastrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editDialog} onOpenChange={v => { if (!v) { setEditDialog(null); resetForm(); } }}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader><DialogTitle>Editar Código de Barras</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-muted/50 border border-border/50">
              <div className="text-sm font-medium">{editDialog?.productName}</div>
              <div className="text-xs text-muted-foreground font-mono">{editDialog?.erpCode}</div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Código de Barras</label>
              <Input data-testid="input-barcode-edit" value={formBarcode} onChange={e => setFormBarcode(e.target.value)} className="rounded-xl font-mono" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">Qtd Embalagem</label>
                <Input
                  data-testid="input-qty-edit"
                  type="number"
                  min="1"
                  value={formQty}
                  onChange={e => setFormQty(e.target.value)}
                  className="rounded-xl"
                  disabled={editDialog?.type === "UNITARIO"}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Tipo Embalagem</label>
                <Select value={formPkgType} onValueChange={setFormPkgType} disabled={editDialog?.type === "UNITARIO"}>
                  <SelectTrigger className="rounded-xl" data-testid="select-pkg-type-edit">
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Caixa">Caixa</SelectItem>
                    <SelectItem value="Fardo">Fardo</SelectItem>
                    <SelectItem value="Pacote">Pacote</SelectItem>
                    <SelectItem value="Saco">Saco</SelectItem>
                    <SelectItem value="Display">Display</SelectItem>
                    <SelectItem value="Bandeja">Bandeja</SelectItem>
                    <SelectItem value="Pallet">Pallet</SelectItem>
                    <SelectItem value="Caixeta">Caixeta</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Observação</label>
              <Textarea data-testid="input-notes-edit" value={formNotes} onChange={e => setFormNotes(e.target.value)} className="rounded-xl" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => { setEditDialog(null); resetForm(); }}>Cancelar</Button>
            <Button className="rounded-xl" onClick={handleUpdate} disabled={!formBarcode.trim() || updateMutation.isPending} data-testid="button-confirm-edit">
              {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deactivateDialog} onOpenChange={v => { if (!v) { setDeactivateDialog(null); setDeactivateNotes(""); } }}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader><DialogTitle>Desativar Código</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Desativar o código <span className="font-mono font-medium text-foreground">{deactivateDialog?.barcode}</span> do produto{" "}
              <span className="font-medium text-foreground">{deactivateDialog?.productName}</span>?
            </p>
            <Textarea
              data-testid="input-deactivate-notes"
              value={deactivateNotes}
              onChange={e => setDeactivateNotes(e.target.value)}
              placeholder="Motivo (opcional)"
              className="rounded-xl"
              rows={2}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setDeactivateDialog(null)}>Cancelar</Button>
            <Button variant="destructive" className="rounded-xl" onClick={() => deactivateDialog && deactivateMutation.mutate({ id: deactivateDialog.id, notes: deactivateNotes })} disabled={deactivateMutation.isPending} data-testid="button-confirm-deactivate">
              {deactivateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Desativar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!historyDialog} onOpenChange={v => { if (!v) setHistoryDialog(null); }}>
        <DialogContent className="max-w-lg rounded-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><History className="h-5 w-5" /> Histórico de Alterações</DialogTitle></DialogHeader>
          {historyLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : !historyData || historyData.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">Nenhum registro encontrado</p>
          ) : (
            <div className="space-y-3">
              {historyData.map(h => (
                <div key={h.id} className="p-3 rounded-xl border border-border/50 bg-muted/20 space-y-1">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-xs">
                      {OPERATION_LABELS[h.operation] || h.operation}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{formatDate(h.createdAt)}</span>
                  </div>
                  <div className="text-sm">
                    {h.oldBarcode && <span className="font-mono text-xs text-red-400 line-through mr-2">{h.oldBarcode}</span>}
                    {h.newBarcode && <span className="font-mono text-xs text-green-400">{h.newBarcode}</span>}
                    {h.barcodeType && <span className="ml-2 text-xs text-muted-foreground">({h.barcodeType})</span>}
                  </div>
                  {(h.oldQty || h.newQty) && (
                    <div className="text-xs text-muted-foreground">
                      Qtd: {h.oldQty ?? "-"} → {h.newQty ?? "-"}
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground">
                    Por: {h.userName || h.userId || "-"}
                  </div>
                  {h.notes && <div className="text-xs text-muted-foreground italic">{h.notes}</div>}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={importDialog} onOpenChange={(o) => { if (!importMutation.isPending) setImportDialog(o); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              {importStep === "upload" && "Importar Planilha de Códigos de Barras"}
              {importStep === "preview" && `Pré-visualização — ${importRows.length} linha(s)`}
              {importStep === "result" && "Resultado da Importação"}
            </DialogTitle>
          </DialogHeader>

          {importStep === "upload" && (
            <div className="space-y-4 py-2">
              <div className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center space-y-3">
                <FileSpreadsheet className="h-10 w-10 mx-auto text-muted-foreground" />
                <div>
                  <p className="font-medium">Selecione o arquivo Excel (.xlsx ou .xls)</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    O arquivo deve ter as colunas: <span className="font-mono text-xs bg-muted px-1 rounded">Código do produto</span>, <span className="font-mono text-xs bg-muted px-1 rounded">EAN unitário</span>, <span className="font-mono text-xs bg-muted px-1 rounded">EAN embalagem</span>, <span className="font-mono text-xs bg-muted px-1 rounded">Qtd embalagem</span>
                  </p>
                </div>
                <input
                  ref={importFileRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={handleImportFile}
                  data-testid="input-import-file"
                />
                <Button onClick={() => importFileRef.current?.click()} data-testid="button-select-file">
                  <Upload className="h-4 w-4 mr-2" />
                  Escolher arquivo
                </Button>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/20 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">Baixar modelo</p>
                  <p className="text-xs text-muted-foreground">Arquivo Excel com os cabeçalhos corretos e exemplos</p>
                </div>
                <Button variant="outline" size="sm" onClick={downloadTemplate} data-testid="button-download-template">
                  <Download className="h-4 w-4 mr-2" />
                  Modelo .xlsx
                </Button>
              </div>
            </div>
          )}

          {importStep === "preview" && (
            <div className="flex flex-col gap-3 overflow-hidden">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{importFileName}</span>
                <span>·</span>
                <span>{importRows.length} produtos</span>
              </div>
              <div className="overflow-auto rounded-xl border border-border flex-1" style={{ maxHeight: "380px" }}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[140px]">Cód. Produto</TableHead>
                      <TableHead>EAN Unitário</TableHead>
                      <TableHead>EAN Embalagem</TableHead>
                      <TableHead className="text-right">Qtd Emb.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importRows.slice(0, 200).map((row, i) => (
                      <TableRow key={i} className={!row.productId ? "bg-yellow-50/50 dark:bg-yellow-950/10" : ""}>
                        <TableCell className="font-mono text-xs">
                          {row.productId ? row.productId : (
                            <span className="flex items-center gap-1 text-yellow-600 dark:text-yellow-400">
                              <AlertTriangle className="h-3 w-3 shrink-0" />
                              <span className="italic">buscar pelo EAN</span>
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{row.eanUnitario || <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="font-mono text-xs">{row.eanEmbalagem || <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-right text-xs">{row.eanEmbalagem ? (row.qtdEmbalagem || 2) : <span className="text-muted-foreground">—</span>}</TableCell>
                      </TableRow>
                    ))}
                    {importRows.length > 200 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-3">
                          ... e mais {importRows.length - 200} linhas (serão todas importadas)
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {importStep === "result" && importSummary && (
            <div className="flex flex-col gap-3 overflow-hidden">
              <p className="text-sm text-muted-foreground">
                Total lido: <span className="font-semibold text-foreground">{importSummary.ok + importSummary.warn + importSummary.error + importSkipped}</span> linha(s)
                {importSkipped > 0 && <span className="ml-2 text-yellow-600 dark:text-yellow-400">· {importSkipped} sem EAN (ignoradas antes do envio)</span>}
              </p>
              <div className="grid grid-cols-4 gap-2">
                <div className="rounded-xl border border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-800 p-3 text-center">
                  <CheckCircle className="h-5 w-5 mx-auto text-green-600 dark:text-green-400 mb-1" />
                  <p className="text-xl font-bold text-green-700 dark:text-green-300">{importSummary.ok}</p>
                  <p className="text-xs text-green-600 dark:text-green-400">Importados</p>
                </div>
                <div className="rounded-xl border border-yellow-200 bg-yellow-50 dark:bg-yellow-950/30 dark:border-yellow-800 p-3 text-center">
                  <AlertTriangle className="h-5 w-5 mx-auto text-yellow-600 dark:text-yellow-400 mb-1" />
                  <p className="text-xl font-bold text-yellow-700 dark:text-yellow-300">{importSummary.warn}</p>
                  <p className="text-xs text-yellow-600 dark:text-yellow-400">Alertas</p>
                </div>
                <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800 p-3 text-center">
                  <XCircle className="h-5 w-5 mx-auto text-red-600 dark:text-red-400 mb-1" />
                  <p className="text-xl font-bold text-red-700 dark:text-red-300">{importSummary.error}</p>
                  <p className="text-xs text-red-600 dark:text-red-400">Não encontrados</p>
                </div>
                <div className="rounded-xl border border-border bg-muted/30 p-3 text-center">
                  <MinusCircle className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
                  <p className="text-xl font-bold text-muted-foreground">{importSkipped}</p>
                  <p className="text-xs text-muted-foreground">Sem EAN</p>
                </div>
              </div>
              {(importSummary.warn > 0 || importSummary.error > 0) && (
                <div className="overflow-auto rounded-xl border border-border flex-1" style={{ maxHeight: "300px" }}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Produto</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Mensagem</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {importResults.filter(r => r.status !== "ok").map((r, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs">
                            {r.resolvedCode && r.resolvedCode !== r.productId
                              ? <span className="flex flex-col gap-0.5"><span>{r.resolvedCode}</span><span className="text-muted-foreground text-[10px]">via EAN</span></span>
                              : r.productId}
                          </TableCell>
                          <TableCell>
                            {r.status === "warning"
                              ? <Badge variant="outline" className="border-yellow-400 text-yellow-700 bg-yellow-50 dark:bg-yellow-950/20 dark:text-yellow-300 text-xs">Alerta</Badge>
                              : <Badge variant="destructive" className="text-xs">Erro</Badge>
                            }
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{r.message}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="pt-2 shrink-0">
            {importStep === "upload" && (
              <Button variant="outline" onClick={() => setImportDialog(false)}>Fechar</Button>
            )}
            {importStep === "preview" && (
              <>
                <Button variant="outline" onClick={() => setImportStep("upload")}>Voltar</Button>
                <Button
                  onClick={() => importMutation.mutate(importRows)}
                  disabled={importMutation.isPending}
                  data-testid="button-confirm-import"
                >
                  {importMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Importar {importRows.length} produtos
                </Button>
              </>
            )}
            {importStep === "result" && (
              <>
                <Button variant="outline" onClick={openImport}>Nova importação</Button>
                <Button onClick={() => setImportDialog(false)}>Fechar</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
