import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Minus, Plus, Trash2 } from "lucide-react";
import { ProductStockInfo, StockLegend } from "./product-stock-info";

export interface PalletItemData {
  id: string;
  productId?: string;
  quantity: number;
  lot?: string | null;
  expiryDate?: string | null;
  product?: {
    id?: string;
    name?: string;
    erpCode?: string;
    erp_code?: string;
    unit?: string;
    barcode?: string;
  };
}

interface StockInfo {
  totalStock: number;
  palletizedStock: number;
  pickingStock: number;
  unit: string;
}

type ItemMode = "view" | "edit" | "withdraw" | "partial";

interface PalletItemListProps {
  items: PalletItemData[];
  mode: ItemMode;
  quantities?: Map<string, number>;
  onQuantityChange?: (key: string, value: number, max: number) => void;
  onEditDelta?: (index: number, delta: number) => void;
  onRemoveItem?: (index: number) => void;
  stockInfoMap?: Record<string, StockInfo>;
  showStockLegend?: boolean;
  quantityKeyField?: "id" | "productId";
}

export function PalletItemList({
  items,
  mode,
  quantities,
  onQuantityChange,
  onEditDelta,
  onRemoveItem,
  stockInfoMap = {},
  showStockLegend = false,
  quantityKeyField = "id",
}: PalletItemListProps) {
  const getKey = (item: PalletItemData) =>
    quantityKeyField === "productId" ? (item.productId || item.product?.id || item.id) : item.id;

  const getStockInfo = (item: PalletItemData) => {
    const pid = item.productId || item.product?.id;
    return pid ? stockInfoMap[pid] : null;
  };

  return (
    <div>
      {showStockLegend && items.length > 0 && (
        <div className="px-4 py-2 border-b border-border/20">
          <StockLegend />
        </div>
      )}
      <div className="divide-y divide-border/30">
        {items.map((item, idx) => {
          const maxQty = Number(item.quantity);
          const key = getKey(item);
          const currentQty = quantities?.get(key) ?? 0;
          const si = getStockInfo(item);

          return (
            <div key={item.id || idx} className="px-4 py-2.5 space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.product?.name || "Produto"}</p>
                  <p className="text-[10px] text-muted-foreground font-mono truncate">
                    {item.product?.erpCode || item.product?.erp_code || ""}
                    {mode === "withdraw" && ` · Estoque: ${maxQty} ${item.product?.unit || "UN"}`}
                    {item.lot && ` · L:${item.lot}`}
                  </p>
                </div>

                {mode === "view" && (
                  <span className="font-mono font-bold text-sm shrink-0">{maxQty}</span>
                )}

                {mode === "edit" && (
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-lg"
                      onClick={() => onEditDelta?.(idx, -1)}
                      data-testid={`button-qty-minus-${idx}`}>
                      <Minus className="h-3.5 w-3.5" />
                    </Button>
                    <span className="font-mono font-bold text-sm w-9 text-center">{maxQty}</span>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-lg"
                      onClick={() => onEditDelta?.(idx, 1)}
                      data-testid={`button-qty-plus-${idx}`}>
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                    {onRemoveItem && (
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-lg text-destructive hover:bg-destructive/10"
                        onClick={() => onRemoveItem(idx)}
                        data-testid={`button-remove-item-${idx}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                )}

                {(mode === "withdraw" || mode === "partial") && quantities && onQuantityChange && (
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-lg"
                      onClick={() => onQuantityChange(key, currentQty - 1, maxQty)}
                      data-testid={`button-qty-minus-${idx}`}>
                      <Minus className="h-3.5 w-3.5" />
                    </Button>
                    <Input
                      value={currentQty}
                      onChange={e => {
                        const val = parseInt(e.target.value.replace(/\D/g, "")) || 0;
                        onQuantityChange(key, val, maxQty);
                      }}
                      className="h-8 w-14 text-center font-mono font-bold text-sm p-0 rounded-lg"
                      inputMode="numeric"
                      data-testid={`input-qty-${idx}`}
                    />
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-lg"
                      onClick={() => onQuantityChange(key, currentQty + 1, maxQty)}
                      data-testid={`button-qty-plus-${idx}`}>
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                    <span className="text-[10px] text-muted-foreground w-7 text-right">/{maxQty}</span>
                  </div>
                )}
              </div>

              {si && (
                <ProductStockInfo
                  totalStock={si.totalStock}
                  palletizedStock={si.palletizedStock}
                  pickingStock={si.pickingStock}
                  unit={si.unit}
                  compact
                />
              )}
            </div>
          );
        })}
        {items.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-6">Nenhum item no pallet</p>
        )}
      </div>
    </div>
  );
}
