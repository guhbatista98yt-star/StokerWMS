import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ArrowLeft, Plus, Loader2, CheckCircle, XCircle, BarChart3, Trash2, ScanBarcode, Tag, Calendar, Package, Factory, Barcode, Keyboard } from "lucide-react";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { AddressPicker } from "@/components/wms/address-picker";

const cycleTypeOptions = [
  { value: "por_produto", label: "Por Produto", desc: "Conta por produto especifico" },
  { value: "por_pallet", label: "Por Pallet", desc: "Conta por pallet" },
  { value: "por_endereco", label: "Por Endereco", desc: "Conta por endereco" },
];

export default function ContagemPage() {
  const [, navigate] = useLocation();
  const { user, companyId, companiesData } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedCycle, setSelectedCycle] = useState<any>(null);
  const [showNew, setShowNew] = useState(false);
  const [newNotes, setNewNotes] = useState("");
  const [newType, setNewType] = useState("por_produto");
  const [deleteTarget, setDeleteTarget] = useState<any>(null);

  const [scanInput, setScanInput] = useState("");
  const [scanLoading, setScanLoading] = useState(false);
  const [keyboardEnabled, setKeyboardEnabled] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);

  const [addressId, setAddressId] = useState("");

  const isSupervisor = user?.role === "supervisor" || user?.role === "administrador";

  const { data: cycles = [], isLoading } = useQuery({
    queryKey: ["counting-cycles", companyId],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/counting-cycles");
      return res.json();
    },
    enabled: !!companyId,
  });

  const { data: allAddresses = [] } = useQuery({
    queryKey: ["all-addresses", companyId],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/wms-addresses");
      return res.json();
    },
    enabled: !!companyId,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/counting-cycles", { type: newType, notes: newNotes, items: [] });
      if (!res.ok) throw new Error("Erro");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["counting-cycles"] });
      setShowNew(false);
      setNewNotes("");
      toast({ title: "Ciclo criado" });
      if (data?.id) {
        loadCycle(data.id);
      }
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/counting-cycles/${id}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Erro ao apagar");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["counting-cycles"] });
      setDeleteTarget(null);
      if (selectedCycle && selectedCycle.id === deleteTarget?.id) setSelectedCycle(null);
      toast({ title: "Ciclo apagado" });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const [cycleLoading, setCycleLoading] = useState(false);

  const loadCycle = async (id: string) => {
    setCycleLoading(true);
    try {
      const res = await apiRequest("GET", `/api/counting-cycles/${id}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedCycle(data);
        if (data.type === "por_produto") {
          setTimeout(() => scanRef.current?.focus(), 200);
        }
      } else {
        toast({ title: "Erro ao carregar ciclo", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erro de conexão ao carregar ciclo", variant: "destructive" });
    } finally {
      setCycleLoading(false);
    }
  };

  const addItemByScan = async () => {
    const code = scanInput.trim();
    if (!code || !selectedCycle) return;
    setScanLoading(true);
    try {
      const body: any = {};
      if (selectedCycle.type === "por_pallet") {
        body.palletCode = code;
      } else {
        body.barcode = code;
      }

      const res = await apiRequest("POST", `/api/counting-cycles/${selectedCycle.id}/items`, body);
      if (!res.ok) {
        const err = await res.json();
        toast({ title: "Erro", description: err.error, variant: "destructive" });
      } else {
        const result = await res.json();
        const newItems = Array.isArray(result) ? result : [result];
        setSelectedCycle((prev: any) => ({ ...prev, items: [...(prev.items || []), ...newItems] }));
        setScanInput("");
        if (newItems.length === 1) {
          toast({ title: `Adicionado: ${newItems[0].product?.name || "item"}` });
        } else {
          toast({ title: `${newItems.length} itens adicionados` });
        }
        setTimeout(() => scanRef.current?.focus(), 50);
      }
    } catch {
      toast({ title: "Erro de conexao", variant: "destructive" });
    } finally {
      setScanLoading(false);
    }
  };

  const addItemByAddress = async () => {
    if (!addressId || !selectedCycle) return;
    setScanLoading(true);
    try {
      const res = await apiRequest("POST", `/api/counting-cycles/${selectedCycle.id}/items`, { addressId });
      if (!res.ok) {
        const err = await res.json();
        toast({ title: "Erro", description: err.error, variant: "destructive" });
      } else {
        const result = await res.json();
        const newItems = Array.isArray(result) ? result : [result];
        setSelectedCycle((prev: any) => ({ ...prev, items: [...(prev.items || []), ...newItems] }));
        setAddressId("");
        toast({ title: `${newItems.length} itens adicionados do endereço` });
      }
    } catch {
      toast({ title: "Erro de conexao", variant: "destructive" });
    } finally {
      setScanLoading(false);
    }
  };

  const countItemMutation = useMutation({
    mutationFn: async ({ itemId, countedQty, lot, expiryDate }: { itemId: string; countedQty: number; lot?: string; expiryDate?: string }) => {
      const res = await apiRequest("PATCH", `/api/counting-cycles/${selectedCycle.id}/item`, { itemId, countedQty, lot, expiryDate });
      if (!res.ok) throw new Error("Erro");
      return res.json();
    },
    onSuccess: () => {
      loadCycle(selectedCycle.id);
      toast({ title: "Contagem registrada" });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/counting-cycles/${selectedCycle.id}/approve`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["counting-cycles"] });
      loadCycle(selectedCycle.id);
      toast({ title: "Ciclo aprovado!" });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/counting-cycles/${selectedCycle.id}/reject`, { notes: "Rejeitado pelo supervisor" });
      if (!res.ok) throw new Error("Erro");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["counting-cycles"] });
      loadCycle(selectedCycle.id);
      toast({ title: "Ciclo rejeitado" });
    },
  });

  const statusStyles: Record<string, string> = {
    pendente: "border-amber-200 text-amber-700 bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:bg-amber-950/30",
    em_andamento: "border-blue-200 text-blue-700 bg-blue-50 dark:border-blue-800 dark:text-blue-400 dark:bg-blue-950/30",
    concluido: "border-emerald-200 text-emerald-700 bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:bg-emerald-950/30",
    aprovado: "border-green-200 text-green-700 bg-green-50 dark:border-green-800 dark:text-green-400 dark:bg-green-950/30",
    rejeitado: "border-red-200 text-red-700 bg-red-50 dark:border-red-800 dark:text-red-400 dark:bg-red-950/30",
  };

  const statusLabels: Record<string, string> = {
    pendente: "Pendente", em_andamento: "Em Andamento", concluido: "Concluido",
    aprovado: "Aprovado", rejeitado: "Rejeitado",
  };

  const getScanPlaceholder = () => {
    if (!selectedCycle) return "";
    if (selectedCycle.type === "por_pallet") return "Escanear código do pallet...";
    return "Escanear produto...";
  };

  const getEmptyMessage = () => {
    if (!selectedCycle) return "";
    if (selectedCycle.type === "por_pallet") return "Escaneia um pallet para adicionar";
    if (selectedCycle.type === "por_endereco") return "Selecione um endereço para adicionar";
    return "Escaneia um produto para adicionar";
  };

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/")} data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-base font-semibold text-foreground leading-tight">Contagem</h1>
            <p className="text-xs text-muted-foreground">{companyId ? (companiesData?.find(c => c.id === companyId)?.name || "WMS") : "WMS"}</p>
          </div>
        </div>
      </div>

      <main className="max-w-lg mx-auto px-4 py-4 space-y-3 safe-bottom">
        {!selectedCycle && (
          <>
            <div className="flex justify-between items-center animate-fade-in">
              <h2 className="text-base font-semibold">Ciclos</h2>
              <Button onClick={() => setShowNew(!showNew)} size="sm" className="h-9 rounded-xl text-xs" data-testid="button-new-cycle">
                <Plus className="h-3.5 w-3.5 mr-1.5" /> Novo Ciclo
              </Button>
            </div>

            {showNew && (
              <div className="rounded-2xl border border-border/50 bg-card p-4 space-y-4 animate-scale-in">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Tipo de Auditoria</p>
                  <div className="grid gap-2">
                    {cycleTypeOptions.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setNewType(opt.value)}
                        className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all active:scale-[0.98] ${
                          newType === opt.value ? "bg-primary/5 border-primary/30 ring-1 ring-primary/15" : "active:bg-muted/50"
                        }`}
                        data-testid={`cycle-type-${opt.value}`}
                      >
                        <div className={`w-4 h-4 rounded-full border-2 shrink-0 ${newType === opt.value ? "border-primary bg-primary" : "border-muted-foreground/25"}`} />
                        <div>
                          <p className="font-semibold text-sm">{opt.label}</p>
                          <p className="text-[11px] text-muted-foreground">{opt.desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <Textarea placeholder="Observacoes (opcional)..." value={newNotes} onChange={e => setNewNotes(e.target.value)}
                  className="rounded-xl resize-none" rows={2} data-testid="input-cycle-notes" />
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1 h-11 rounded-xl" onClick={() => setShowNew(false)} data-testid="button-cancel-new-cycle">Cancelar</Button>
                  <Button className="flex-1 h-11 rounded-xl" onClick={() => createMutation.mutate()} disabled={createMutation.isPending} data-testid="button-create-cycle">
                    {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
                    Criar
                  </Button>
                </div>
              </div>
            )}

            {isLoading ? (
              <div className="text-center py-16"><Loader2 className="h-6 w-6 mx-auto animate-spin text-muted-foreground" /></div>
            ) : cycles.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground animate-fade-in">
                <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-muted flex items-center justify-center">
                  <BarChart3 className="h-7 w-7 opacity-30" />
                </div>
                <p className="text-sm font-medium">Nenhum ciclo</p>
                <p className="text-xs mt-0.5">Crie um novo ciclo para comecar</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-border/50 bg-card overflow-hidden animate-slide-up">
                <div className="divide-y divide-border/30">
                  {cycles.map((c: any) => (
                    <div key={c.id} className="group flex items-center gap-3 px-4 py-3" data-testid={`row-cycle-${c.id}`}>
                      <button className="flex-1 text-left min-w-0" onClick={() => loadCycle(c.id)} data-testid={`button-load-cycle-${c.id}`}>
                        <p className="text-sm font-semibold truncate">{cycleTypeOptions.find(o => o.value === c.type)?.label || c.type}</p>
                        <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                          {new Date(c.createdAt).toLocaleDateString("pt-BR")}
                          {c.notes && ` · ${c.notes}`}
                        </p>
                      </button>
                      <Badge variant="outline" className={`text-[10px] shrink-0 ${statusStyles[c.status] || ""}`}>
                        {statusLabels[c.status] || c.status}
                      </Badge>
                      {isSupervisor && c.status !== "em_andamento" && (
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 shrink-0"
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget(c); }}
                          data-testid={`button-delete-cycle-${c.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {selectedCycle && (
          <div className="space-y-3 animate-slide-up">
            <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border/30 flex-wrap gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold">{cycleTypeOptions.find(o => o.value === selectedCycle.type)?.label || selectedCycle.type}</p>
                  {selectedCycle.notes && <p className="text-[10px] text-muted-foreground truncate">{selectedCycle.notes}</p>}
                </div>
                <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                  <Badge variant="outline" className={`text-[10px] ${statusStyles[selectedCycle.status] || ""}`}>
                    {statusLabels[selectedCycle.status] || selectedCycle.status}
                  </Badge>
                  {selectedCycle.status === "concluido" && (
                    <span className="text-[10px] text-muted-foreground">Aguardando aprovação do supervisor</span>
                  )}
                </div>
              </div>

              {selectedCycle.status !== "aprovado" && selectedCycle.status !== "em_andamento" && (
                <>
                  {selectedCycle.type === "por_endereco" ? (
                    <div className="px-4 py-3 border-b border-border/30 space-y-3">
                      <AddressPicker
                        availableAddresses={allAddresses}
                        onAddressSelect={setAddressId}
                        onClear={() => setAddressId("")}
                        value={addressId}
                      />
                      <Button
                        className="w-full h-11 rounded-xl"
                        onClick={addItemByAddress}
                        disabled={!addressId || scanLoading}
                        data-testid="button-add-address-items"
                      >
                        {scanLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                        Adicionar itens do endereço
                      </Button>
                    </div>
                  ) : (
                    <div className="px-4 py-3 border-b border-border/30 space-y-2">
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                          <Input
                            ref={scanRef}
                            placeholder={getScanPlaceholder()}
                            value={scanInput}
                            onChange={e => setScanInput(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && addItemByScan()}
                            className="pl-10 pr-12 h-11 rounded-xl text-sm font-mono"
                            inputMode={keyboardEnabled ? "text" : "none"}
                            autoFocus
                            data-testid="input-scan-count"
                          />
                          <div className="absolute right-2 top-1/2 -translate-y-1/2">
                            <Button
                              variant={keyboardEnabled ? "default" : "ghost"}
                              size="sm"
                              className="h-8 w-8 p-0 rounded-lg"
                              onClick={() => {
                                setKeyboardEnabled(v => !v);
                                setTimeout(() => scanRef.current?.focus(), 50);
                              }}
                              data-testid="button-keyboard-toggle"
                            >
                              <Keyboard className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        <Button className="h-11 px-4 rounded-xl" onClick={addItemByScan} disabled={!scanInput.trim() || scanLoading} data-testid="button-add-scan-item">
                          {scanLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        </Button>
                      </div>
                      {!keyboardEnabled && (
                        <p className="text-[10px] text-muted-foreground text-center">
                          Bipe o {selectedCycle.type === "por_pallet" ? "pallet" : "produto"} ou use <Keyboard className="h-3 w-3 inline" /> p/ digitar
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}

              {selectedCycle.items?.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  {getEmptyMessage()}
                </p>
              ) : (
                <div className="divide-y divide-border/30">
                  {selectedCycle.items?.map((item: any) => (
                    <CountingItemCard
                      key={item.id}
                      item={item}
                      cycleStatus={selectedCycle.status}
                      cycleType={selectedCycle.type}
                      onCount={(countedQty, lot, expiryDate) => countItemMutation.mutate({ itemId: item.id, countedQty, lot, expiryDate })}
                      isPending={countItemMutation.isPending}
                    />
                  ))}
                </div>
              )}
            </div>

            <Button variant="outline" className="w-full h-11 rounded-xl" onClick={() => { setSelectedCycle(null); setAddressId(""); }} data-testid="button-back-to-list">
              Voltar
            </Button>
          </div>
        )}
      </main>

      <Dialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>Apagar Ciclo</DialogTitle>
            <DialogDescription>Esta acao nao pode ser desfeita.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} className="rounded-xl" data-testid="button-cancel-delete">Cancelar</Button>
            <Button variant="destructive" onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)} disabled={deleteMutation.isPending} className="rounded-xl" data-testid="button-confirm-delete">
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Apagar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CountingItemCard({ item, cycleStatus, cycleType, onCount, isPending }: {
  item: any;
  cycleStatus: string;
  cycleType: string;
  onCount: (qty: number, lot?: string, expiry?: string) => void;
  isPending: boolean;
}) {
  const [countInput, setCountInput] = useState("");
  const [lotInput, setLotInput] = useState(item.lot || "");
  const [expiryInput, setExpiryInput] = useState(item.expiryDate || "");

  const product = item.product;
  const isCounted = item.status !== "pendente";

  const handleSubmit = () => {
    const qty = parseFloat(countInput);
    if (isNaN(qty) || qty < 0) return;
    onCount(qty, lotInput || undefined, expiryInput || undefined);
  };

  const itemStatusStyles: Record<string, string> = {
    pendente: "border-amber-200 text-amber-700 bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:bg-amber-950/30",
    contado: "border-emerald-200 text-emerald-700 bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:bg-emerald-950/30",
    divergente: "border-red-200 text-red-700 bg-red-50 dark:border-red-800 dark:text-red-400 dark:bg-red-950/30",
  };

  return (
    <div className={`px-4 py-3 space-y-2.5 ${isCounted ? "bg-muted/10" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {product ? (
            <>
              <p className="font-semibold text-sm leading-tight truncate">{product.name}</p>
              <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-0.5">
                  <Package className="h-2.5 w-2.5" /><span className="font-mono font-semibold text-foreground">{product.erpCode}</span>
                </span>
                {product.manufacturer && (
                  <span className="flex items-center gap-0.5"><Factory className="h-2.5 w-2.5" />{product.manufacturer}</span>
                )}
                {product.barcode && (
                  <span className="flex items-center gap-0.5"><Barcode className="h-2.5 w-2.5" /><span className="font-mono">{product.barcode}</span></span>
                )}
              </div>
              {item.expectedQty != null && (
                <p className="text-[10px] text-muted-foreground mt-0.5">Esperado: <span className="font-mono font-bold">{item.expectedQty}</span></p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Produto {item.productId?.slice(0, 12) || "-"}</p>
          )}
        </div>
        <Badge variant="outline" className={`text-[10px] shrink-0 ${itemStatusStyles[item.status] || ""}`} data-testid={`status-${item.id}`}>
          {item.status === "pendente" ? "Pendente" : item.status === "contado" ? "Contado" : "Divergente"}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[9px] text-muted-foreground uppercase font-bold flex items-center gap-0.5 mb-0.5">
            <Tag className="h-2.5 w-2.5" />Lote
          </label>
          <Input placeholder="Lote" value={lotInput} onChange={e => setLotInput(e.target.value)}
            className="h-8 text-xs rounded-lg" data-testid={`input-lot-${item.id}`} />
        </div>
        <div>
          <label className="text-[9px] text-muted-foreground uppercase font-bold flex items-center gap-0.5 mb-0.5">
            <Calendar className="h-2.5 w-2.5" />Validade
          </label>
          <Input type="date" value={expiryInput} onChange={e => setExpiryInput(e.target.value)}
            className="h-8 text-xs rounded-lg" data-testid={`input-expiry-${item.id}`} />
        </div>
      </div>

      {isCounted ? (
        <div className="flex items-center justify-between text-sm p-2.5 rounded-xl bg-muted/30 border border-border/30">
          <span className="text-xs text-muted-foreground">Contado:</span>
          <span className="font-mono font-bold text-base">{item.countedQty}</span>
          {item.divergencePct !== null && item.divergencePct !== undefined && item.divergencePct > 0 && (
            <span className="text-destructive text-[10px] font-semibold">{item.divergencePct.toFixed(1)}%</span>
          )}
        </div>
      ) : cycleStatus !== "aprovado" ? (
        <div className="flex gap-2">
          <Input
            type="number"
            inputMode="decimal"
            placeholder="Qtd contada"
            value={countInput}
            onChange={e => setCountInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSubmit()}
            className="flex-1 h-10 text-sm font-mono rounded-xl"
            data-testid={`input-count-${item.id}`}
          />
          <Button onClick={handleSubmit} disabled={!countInput || isPending} className="h-10 rounded-xl" data-testid={`button-submit-count-${item.id}`}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
