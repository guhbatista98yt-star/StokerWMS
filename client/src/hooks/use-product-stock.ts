import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface StockInfo {
  totalStock: number;
  palletizedStock: number;
  pickingStock: number;
  difference: number;
  unit: string;
}

export function useProductStockBatch(productIds: string[]) {
  const ids = [...new Set(productIds.filter(Boolean))];

  return useQuery<Record<string, StockInfo>>({
    queryKey: ["product-stock-batch", ...ids.sort()],
    queryFn: async () => {
      if (ids.length === 0) return {};
      const res = await apiRequest("POST", "/api/products/stock-batch", { productIds: ids });
      return res.json();
    },
    enabled: ids.length > 0,
    staleTime: 30000,
  });
}

export interface ProductAddress {
  code: string;
  type: string | null;
  quantity: number;
  addressId?: string;
}

export function useProductAddressesBatch(productIds: string[]) {
  const ids = [...new Set(productIds.filter(Boolean))];

  return useQuery<Record<string, ProductAddress[]>>({
    queryKey: ["product-addresses-batch", ...ids.sort()],
    queryFn: async () => {
      if (ids.length === 0) return {};
      const res = await apiRequest("POST", "/api/products/addresses-batch", { productIds: ids });
      return res.json();
    },
    enabled: ids.length > 0,
    staleTime: 30000,
  });
}
