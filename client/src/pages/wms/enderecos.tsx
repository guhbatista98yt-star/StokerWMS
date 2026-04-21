import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, MapPin, Loader2, ToggleLeft, ToggleRight, Trash2, Search, Package, X, Filter, History, PackageMinus, PackagePlus, ArrowRightLeft, Warehouse } from "lucide-react";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { getAddressLabels } from "@/lib/address-labels";

export default function EnderecosPage() {
  const [, navigate] = useLocation();
  const { user, companyId, companiesData } = useAuth();
  const addrLabels = getAddressLabels(companyId);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [bairro, setBairro] = useState("");
  const [rua, setRua] = useState("");
  const [bloco, setBloco] = useState("");
  const [nivel, setNivel] = useState("");
  const [type, setType] = useState("standard");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [logAddress, setLogAddress] = useState<{ id: string; code: string } | null>(null);

  const { data: addresses = [], isLoading } = useQuery({
    queryKey: ["wms-addresses-occupancy", companyId],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/wms-addresses/with-occupancy");
      return res.json();
    },
    enabled: !!companyId,
  });

  const { data: addressLog = [], isLoading: logLoading } = useQuery<any[]>({
    queryKey: ["address-picking-log", logAddress?.id],
    queryFn: async () => {
      const params = new URLSearchParams({ addressId: logAddress!.id, limit: "100" });
      const res = await apiRequest("GET", `/api/picking/address-log?${params}`);
      return res.json();
    },
    enabled: !!logAddress,
    staleTime: 0,
  });

  const { data: palletMoves = [], isLoading: movesLoading } = useQuery<any[]>({
    queryKey: ["address-pallet-movements", logAddress?.id],
    queryFn: async () => {
      const params = new URLSearchParams({ addressId: logAddress!.id, limit: "100" });
      const res = await apiRequest("GET", `/api/pallet-movements?${params}`);
      return res.json();
    },
    enabled: !!logAddress,
    staleTime: 0,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/wms-addresses", { bairro, rua, bloco, nivel, type });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Erro");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wms-addresses-occupancy"] });
      queryClient.invalidateQueries({ queryKey: ["wms-addresses"] });
      setBairro(""); setRua(""); setBloco(""); setNivel("");
      setShowForm(false);
      toast({ title: "Endereço criado" });
    },
    onError: (e: Error) => {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const res = await apiRequest("PATCH", `/api/wms-addresses/${id}`, { active });
      if (!res.ok) throw new Error("Erro");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wms-addresses-occupancy"] });
      queryClient.invalidateQueries({ queryKey: ["wms-addresses"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/wms-addresses/${id}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Erro ao remover endereço");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wms-addresses-occupancy"] });
      queryClient.invalidateQueries({ queryKey: ["wms-addresses"] });
      setDeleteTarget(null);
      toast({ title: "Endereço apagado" });
    },
    onError: (e: Error) => {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    },
  });

  const typeLabels: Record<string, string> = {
    standard: "Padrão",
    picking: "Picking",
    recebimento: "Recebimento",
    expedicao: "Expedição",
  };

  const filteredAddresses = useMemo(() => {
    return addresses.filter((addr: any) => {
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const matches = addr.code?.toLowerCase().includes(term) ||
          addr.bairro?.toLowerCase().includes(term) ||
          addr.rua?.toLowerCase().includes(term) ||
          addr.pallet?.palletCode?.toLowerCase().includes(term);
        if (!matches) return false;
      }
      if (filterType !== "all" && addr.type !== filterType) return false;
      if (filterStatus === "active" && !addr.active) return false;
      if (filterStatus === "inactive" && addr.active) return false;
      if (filterStatus === "occupied" && !addr.occupied) return false;
      if (filterStatus === "empty" && addr.occupied) return false;
      return true;
    });
  }, [addresses, searchTerm, filterType, filterStatus]);

  const stats = useMemo(() => {
    const total = addresses.length;
    const active = addresses.filter((a: any) => a.active).length;
    const occupied = addresses.filter((a: any) => a.occupied).length;
    const empty = addresses.filter((a: any) => a.active && !a.occupied).length;
    return { total, active, inactive: total - active, occupied, empty };
  }, [addresses]);

  const hasFilters = searchTerm || filterType !== "all" || filterStatus !== "all";

  const movementTypeLabel: Record<string, string> = {
    created: "Criado",
    addition: "Adição WMS",
    withdrawn: "Retirada WMS",
    allocated: "Alocado",
    transferred: "Transferência",
    merged: "Mesclado",
    cancel_unaddressed: "Cancelado",
  };

  const movementTypeIcon: Record<string, JSX.Element> = {
    addition: <PackagePlus className="h-3.5 w-3.5 text-emerald-500" />,
    withdrawn: <PackageMinus className="h-3.5 w-3.5 text-amber-500" />,
    transferred: <ArrowRightLeft className="h-3.5 w-3.5 text-blue-500" />,
    allocated: <Warehouse className="h-3.5 w-3.5 text-purple-500" />,
    created: <Package className="h-3.5 w-3.5 text-muted-foreground" />,
  };

  const combinedEntries = useMemo(() => {
    const pickingEntries = addressLog.map((e: any) => ({
      ...e,
      _type: "picking" as const,
      _sortKey: e.createdAt,
    }));
    const wmsEntries = palletMoves.map((m: any) => ({
      ...m,
      _type: "wms" as const,
      _sortKey: m.createdAt,
    }));
    return [...pickingEntries, ...wmsEntries].sort((a, b) =>
      b._sortKey.localeCompare(a._sortKey)
    );
  }, [addressLog, palletMoves]);

  return (
    <div className="min-h-screen bg-background">
      <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/")} data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-base font-semibold text-foreground leading-tight">Endereços WMS</h1>
            <p className="text-xs text-muted-foreground">{companyId ? (companiesData?.find(c => c.id === companyId)?.name || "WMS") : "WMS"}</p>
          </div>
        </div>
      </div>

      <main className="max-w-4xl mx-auto px-4 py-6">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
          <div className="text-center p-2 rounded-lg bg-muted/30 border">
            <p className="text-lg font-bold">{stats.total}</p>
            <p className="text-[10px] text-muted-foreground uppercase">Total</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900">
            <p className="text-lg font-bold text-green-700 dark:text-green-400">{stats.active}</p>
            <p className="text-[10px] text-muted-foreground uppercase">Ativos</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900">
            <p className="text-lg font-bold text-blue-700 dark:text-blue-400">{stats.occupied}</p>
            <p className="text-[10px] text-muted-foreground uppercase">Ocupados</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-muted/30 border">
            <p className="text-lg font-bold">{stats.empty}</p>
            <p className="text-[10px] text-muted-foreground uppercase">Livres</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-muted/30 border">
            <p className="text-lg font-bold text-muted-foreground">{stats.inactive}</p>
            <p className="text-[10px] text-muted-foreground uppercase">Inativos</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
          <div className="flex items-center gap-2 flex-1 w-full sm:w-auto">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar endereço ou pallet..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="pl-9 pr-8"
                data-testid="input-search-address"
              />
              {searchTerm && (
                <Button variant="ghost" size="sm" className="absolute right-1 top-1 h-7 w-7 p-0" onClick={() => setSearchTerm("")}>
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-28" data-testid="select-filter-type">
                <Filter className="h-3 w-3 mr-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="standard">Padrão</SelectItem>
                <SelectItem value="picking">Picking</SelectItem>
                <SelectItem value="recebimento">Recebimento</SelectItem>
                <SelectItem value="expedicao">Expedição</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-28" data-testid="select-filter-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="active">Ativos</SelectItem>
                <SelectItem value="inactive">Inativos</SelectItem>
                <SelectItem value="occupied">Ocupados</SelectItem>
                <SelectItem value="empty">Livres</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={() => { setSearchTerm(""); setFilterType("all"); setFilterStatus("all"); }} data-testid="button-clear-filters">
                <X className="h-3 w-3 mr-1" /> Limpar
              </Button>
            )}
            <Button onClick={() => setShowForm(!showForm)} size="sm" data-testid="button-new-address">
              <Plus className="h-4 w-4 mr-2" /> Novo
            </Button>
          </div>
        </div>

        {showForm && (
          <Card className="mb-4">
            <CardHeader><CardTitle className="text-base">Novo Endereço</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                <Input placeholder={addrLabels.bairro} value={bairro} onChange={e => setBairro(e.target.value.toUpperCase())} data-testid="input-bairro" />
                <Input placeholder={addrLabels.rua} value={rua} onChange={e => setRua(e.target.value.toUpperCase())} data-testid="input-rua" />
                <Input placeholder={addrLabels.bloco} value={bloco} onChange={e => setBloco(e.target.value.toUpperCase())} data-testid="input-bloco" />
                <Input placeholder={addrLabels.nivel} value={nivel} onChange={e => setNivel(e.target.value.toUpperCase())} data-testid="input-nivel" />
              </div>
              <div className="flex items-center gap-3">
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger className="w-40" data-testid="select-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Padrão</SelectItem>
                    <SelectItem value="picking">Picking</SelectItem>
                    <SelectItem value="recebimento">Recebimento</SelectItem>
                    <SelectItem value="expedicao">Expedição</SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={() => createMutation.mutate()} disabled={!bairro || !rua || !bloco || !nivel || createMutation.isPending} data-testid="button-create-address">
                  {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Criar"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <p className="text-sm text-muted-foreground mb-2">{filteredAddresses.length} endereço{filteredAddresses.length !== 1 ? "s" : ""}{hasFilters ? " (filtrado)" : ""}</p>

        {isLoading ? (
          <div className="text-center py-12"><Loader2 className="h-8 w-8 mx-auto animate-spin text-muted-foreground" /></div>
        ) : filteredAddresses.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <MapPin className="h-12 w-12 mx-auto mb-4 opacity-40" />
            <p>{hasFilters ? "Nenhum endereço encontrado com esses filtros" : "Nenhum endereço cadastrado"}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredAddresses.map((addr: any) => (
              <div key={addr.id} className={`flex items-center justify-between p-3 rounded-lg border group ${addr.active ? 'bg-card' : 'bg-muted/50 opacity-60'}`} data-testid={`row-address-${addr.id}`}>
                <div className="flex items-center gap-3">
                  <MapPin className={`h-5 w-5 ${addr.occupied ? 'text-blue-500' : 'text-muted-foreground/40'}`} />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold">{addr.code}</span>
                      {addr.occupied && addr.pallet && (
                        <Badge variant="outline" className="text-[9px] font-mono border-blue-300 text-blue-600">
                          <Package className="h-2.5 w-2.5 mr-1" />
                          {addr.pallet.palletCode}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {addr.bairro} / {addr.rua} / {addr.bloco} / {addr.nivel}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={addr.occupied ? "default" : "secondary"} className="text-[9px]">
                    {addr.occupied ? "Ocupado" : "Livre"}
                  </Badge>
                  <Badge variant={addr.type === "standard" ? "outline" : "secondary"} className="text-[9px]">
                    {typeLabels[addr.type] || addr.type}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-blue-600"
                    onClick={() => setLogAddress({ id: addr.id, code: addr.code })}
                    title="Ver log de movimentações"
                    data-testid={`button-log-${addr.id}`}
                  >
                    <History className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={toggleMutation.isPending}
                    onClick={() => toggleMutation.mutate({ id: addr.id, active: !addr.active })}
                    data-testid={`button-toggle-${addr.id}`}
                  >
                    {toggleMutation.isPending
                      ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      : addr.active
                        ? <ToggleRight className="h-4 w-4 text-green-600" />
                        : <ToggleLeft className="h-4 w-4 text-gray-400" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => setDeleteTarget(addr)}
                    disabled={addr.occupied}
                    data-testid={`button-delete-${addr.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Dialog: Apagar endereço */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apagar Endereço</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja apagar o endereço <span className="font-mono font-semibold">{deleteTarget?.code}</span>? Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} data-testid="button-cancel-delete-address">
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete-address"
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Remover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Movimentações do endereço */}
      <Dialog open={!!logAddress} onOpenChange={(open) => !open && setLogAddress(null)}>
        <DialogContent className="max-w-lg p-0 gap-0" data-testid="dialog-address-log">
          <DialogHeader className="px-4 pt-4 pb-2 border-b">
            <div className="flex items-center justify-between">
              <DialogTitle className="flex items-center gap-2 text-base">
                <History className="h-4 w-4 text-blue-500" />
                Movimentações — <span className="font-mono">{logAddress?.code}</span>
              </DialogTitle>
              <DialogDescription className="sr-only">Histórico de movimentações registradas neste endereço</DialogDescription>
            </div>
          </DialogHeader>
          <div className="overflow-y-auto max-h-[60vh] px-4 py-3 space-y-2">
            {(logLoading || movesLoading) ? (
              <div className="text-center py-8"><Loader2 className="h-6 w-6 mx-auto animate-spin text-muted-foreground" /></div>
            ) : combinedEntries.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <History className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>Nenhuma movimentação registrada neste endereço</p>
              </div>
            ) : (
              combinedEntries.map((entry: any) => (
                <div key={`${entry._type}-${entry.id}`} className="bg-muted/30 rounded-xl px-3 py-2 text-xs border border-border/50">
                  {entry._type === "picking" ? (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Package className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                          <div className="min-w-0">
                            <p className="font-semibold text-sm truncate">{entry.productName || entry.productId}</p>
                            {entry.erpCode && <p className="text-muted-foreground font-mono">{entry.erpCode}</p>}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-orange-600 font-bold text-sm">−{Number(entry.quantity).toLocaleString("pt-BR")} un</p>
                          {entry.erpOrderId && <p className="text-muted-foreground">Pedido {entry.erpOrderId}</p>}
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-1 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1"><span className="bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 rounded px-1 py-0.5">Separação</span>{entry.userName || ""}</span>
                        <span>{new Date(entry.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-1.5">
                        {movementTypeIcon[entry.movementType] || <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground" />}
                        <span className="font-semibold text-sm">{movementTypeLabel[entry.movementType] || entry.movementType}</span>
                        {entry.palletCode && (
                          <span className="font-mono text-xs text-primary bg-primary/8 px-1.5 py-0.5 rounded ml-1">
                            {entry.palletCode}
                          </span>
                        )}
                        {entry.movementType === "withdrawn" && entry.fromAddressId === logAddress?.id && (
                          <span className="text-[10px] text-muted-foreground ml-1">← saiu</span>
                        )}
                        {entry.movementType === "transferred" && entry.toAddressId === logAddress?.id && (
                          <span className="text-[10px] text-emerald-600 ml-1">→ chegou</span>
                        )}
                        {entry.movementType === "transferred" && entry.fromAddressId === logAddress?.id && (
                          <span className="text-[10px] text-amber-600 ml-1">← partiu</span>
                        )}
                      </div>
                      {entry.notes && (
                        <p className="text-muted-foreground mt-0.5 pl-5">{entry.notes}</p>
                      )}
                      <div className="flex items-center justify-between mt-1 text-[10px] text-muted-foreground pl-5">
                        <span>{entry.userName || "—"}</span>
                        <span>{new Date(entry.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
