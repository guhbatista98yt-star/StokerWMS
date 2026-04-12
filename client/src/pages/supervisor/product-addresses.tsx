import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link } from "wouter";
import { ArrowLeft, MapPin, Search, Plus, Trash2, Package, Building2 } from "lucide-react";
import type { Product } from "@shared/schema";

interface ProductAddressRow {
  id: string;
  productId: string;
  companyId: number;
  addressId: string;
  addressCode: string;
  addressType: string | null;
  productName: string;
  productErpCode: string;
  createdAt: string;
}

interface WmsAddress {
  id: string;
  code: string;
  type: string;
  bairro: string;
  rua: string;
  bloco: string;
  nivel: string;
  active: boolean;
}

export default function ProductAddressesPage() {
  const { companyId } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addrSearch, setAddrSearch] = useState("");

  const { data: mappings = [], isLoading: loadingMappings } = useQuery<ProductAddressRow[]>({
    queryKey: ["/api/product-addresses"],
  });

  const { data: products = [], isLoading: loadingProducts } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const { data: allAddresses = [] } = useQuery<WmsAddress[]>({
    queryKey: ["/api/wms-addresses"],
    enabled: addDialogOpen,
  });

  const addMutation = useMutation({
    mutationFn: ({ productId, addressId }: { productId: string; addressId: string }) =>
      apiRequest("POST", "/api/product-addresses", { productId, addressId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/product-addresses"] });
      qc.invalidateQueries({ queryKey: ["product-addresses-batch"] });
      setAddDialogOpen(false);
      setAddrSearch("");
      toast({ title: "Endereço vinculado com sucesso" });
    },
    onError: () => toast({ title: "Erro ao vincular endereço", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/product-addresses/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/product-addresses"] });
      qc.invalidateQueries({ queryKey: ["product-addresses-batch"] });
      toast({ title: "Endereço removido" });
    },
    onError: () => toast({ title: "Erro ao remover endereço", variant: "destructive" }),
  });

  const selectedProduct = useMemo(
    () => products.find(p => p.id === selectedProductId),
    [products, selectedProductId]
  );

  const productMappings = useMemo(
    () => mappings.filter(m => m.productId === selectedProductId),
    [mappings, selectedProductId]
  );

  const mappedAddressIds = useMemo(
    () => new Set(productMappings.map(m => m.addressId)),
    [productMappings]
  );

  const filteredProducts = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return products.slice(0, 100);
    return products.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.erpCode.toLowerCase().includes(q) ||
      (p.barcode || "").includes(q)
    ).slice(0, 100);
  }, [products, search]);

  const filteredAddresses = useMemo(() => {
    const q = addrSearch.toLowerCase().trim();
    const available = allAddresses.filter(a => a.active && !mappedAddressIds.has(a.id));
    if (!q) return available.slice(0, 50);
    return available.filter(a => a.code.toLowerCase().includes(q)).slice(0, 50);
  }, [allAddresses, addrSearch, mappedAddressIds]);

  const productAddressCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const m of mappings) {
      map[m.productId] = (map[m.productId] || 0) + 1;
    }
    return map;
  }, [mappings]);

  return (
    <div className="min-h-screen bg-background">
      <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-base font-semibold text-foreground leading-tight">Endereços de Produtos</h1>
            <p className="text-xs text-muted-foreground">Vincule produtos a endereços do armazém por empresa</p>
          </div>
        </div>
      </div>

      <div className="flex h-[calc(100vh-58px)] overflow-hidden">
        {/* Left panel — Product list */}
        <div className="w-80 shrink-0 border-r flex flex-col bg-card">
          <div className="p-3 border-b">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar produto..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 h-9"
                data-testid="input-search-product"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 px-0.5">
              {filteredProducts.length} produtos
            </p>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loadingProducts ? (
              <div className="p-3 space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 rounded-lg" />
                ))}
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-sm">
                Nenhum produto encontrado
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {filteredProducts.map(product => {
                  const count = productAddressCounts[product.id] || 0;
                  const isSelected = selectedProductId === product.id;
                  return (
                    <button
                      key={product.id}
                      onClick={() => setSelectedProductId(product.id)}
                      data-testid={`btn-product-${product.id}`}
                      className={`w-full text-left rounded-lg px-3 py-2.5 transition-colors ${
                        isSelected
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-accent"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className={`text-sm font-medium leading-tight truncate ${isSelected ? "text-primary-foreground" : ""}`}>
                            {product.name}
                          </p>
                          <p className={`text-xs mt-0.5 font-mono ${isSelected ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                            {product.erpCode}
                          </p>
                        </div>
                        {count > 0 && (
                          <Badge
                            variant={isSelected ? "secondary" : "outline"}
                            className="shrink-0 text-[10px] h-5"
                          >
                            {count}
                          </Badge>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right panel — Address management */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!selectedProduct ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <Package className="h-12 w-12 opacity-30" />
              <p className="text-sm">Selecione um produto para gerenciar os endereços</p>
            </div>
          ) : (
            <>
              <div className="p-4 border-b bg-card flex items-center justify-between gap-4">
                <div>
                  <h2 className="font-semibold text-base leading-tight">{selectedProduct.name}</h2>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">
                    Cód. ERP: {selectedProduct.erpCode}
                    {selectedProduct.barcode && ` · ${selectedProduct.barcode}`}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      Empresa {companyId}
                    </span>
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={() => setAddDialogOpen(true)}
                  data-testid="btn-add-address"
                >
                  <Plus className="h-4 w-4 mr-1.5" />
                  Adicionar endereço
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {loadingMappings ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 rounded-lg" />
                    ))}
                  </div>
                ) : productMappings.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
                    <MapPin className="h-10 w-10 opacity-30" />
                    <p className="text-sm">Nenhum endereço vinculado para este produto</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAddDialogOpen(true)}
                    >
                      <Plus className="h-4 w-4 mr-1.5" />
                      Adicionar endereço
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {productMappings.map(m => (
                      <div
                        key={m.id}
                        data-testid={`row-address-${m.id}`}
                        className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                      >
                        <div className="flex items-center gap-2.5">
                          <MapPin className="h-4 w-4 text-blue-500 shrink-0" />
                          <div>
                            <p className="font-mono font-semibold text-sm">{m.addressCode}</p>
                            {m.addressType && (
                              <p className="text-xs text-muted-foreground capitalize">{m.addressType}</p>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => deleteMutation.mutate(m.id)}
                          disabled={deleteMutation.isPending}
                          data-testid={`btn-remove-address-${m.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Add Address Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={open => { setAddDialogOpen(open); setAddrSearch(""); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar endereço</DialogTitle>
            <DialogDescription>
              Selecione um endereço do armazém para vincular ao produto
            </DialogDescription>
          </DialogHeader>
          <Command>
            <CommandInput
              placeholder="Buscar endereço..."
              value={addrSearch}
              onValueChange={setAddrSearch}
              data-testid="input-search-address"
            />
            <CommandList className="max-h-72">
              <CommandEmpty>Nenhum endereço encontrado</CommandEmpty>
              <CommandGroup>
                {filteredAddresses.map(addr => (
                  <CommandItem
                    key={addr.id}
                    value={addr.code}
                    onSelect={() => {
                      if (selectedProductId) {
                        addMutation.mutate({ productId: selectedProductId, addressId: addr.id });
                      }
                    }}
                    data-testid={`item-address-${addr.id}`}
                    disabled={addMutation.isPending}
                    className="gap-2"
                  >
                    <MapPin className="h-4 w-4 text-blue-500 shrink-0" />
                    <span className="font-mono font-medium">{addr.code}</span>
                    {addr.type !== "standard" && (
                      <Badge variant="outline" className="text-[10px] h-4 capitalize ml-auto">
                        {addr.type}
                      </Badge>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </div>
  );
}
