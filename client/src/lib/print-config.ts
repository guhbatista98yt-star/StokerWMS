/**
 * Configuração de impressoras por tipo de impressão e por usuário.
 * Armazenado no localStorage do navegador, com chave separada por userId.
 * Isso permite que cada usuário tenha sua própria configuração mesmo
 * compartilhando o mesmo dispositivo/navegador.
 */

export type PrintType =
  | "volume_label"
  | "pallet_label"
  | "product_label"
  | "order_label"
  | "address_label";

export interface PrintConfig {
  printer: string;
  copies: number;
}

const BASE_KEY = "stoker_print_config";

function storageKey(userId?: string | number | null): string {
  return userId ? `${BASE_KEY}_${userId}` : BASE_KEY;
}

function loadAll(userId?: string | number | null): Record<string, PrintConfig> {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveAll(data: Record<string, PrintConfig>, userId?: string | number | null) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(data));
  } catch {}
}

export function getPrintConfig(type: PrintType, userId?: string | number | null): PrintConfig | null {
  const all = loadAll(userId);
  return all[type] ?? null;
}

export function setPrintConfig(type: PrintType, config: PrintConfig, userId?: string | number | null) {
  const all = loadAll(userId);
  all[type] = config;
  saveAll(all, userId);
}

export function clearPrintConfig(type: PrintType, userId?: string | number | null) {
  const all = loadAll(userId);
  delete all[type];
  saveAll(all, userId);
}

export function getAllPrintConfigs(userId?: string | number | null): Record<string, PrintConfig> {
  return loadAll(userId);
}

export const PRINT_TYPE_LABELS: Record<PrintType, string> = {
  volume_label:  "Etiqueta de Volume",
  pallet_label:  "Etiqueta de Palete",
  product_label: "Etiqueta de Produto",
  order_label:   "Etiqueta de Pedido",
  address_label: "Etiqueta de Endereço",
};

export const PRINT_TYPES: PrintType[] = [
  "volume_label",
  "pallet_label",
  "product_label",
  "order_label",
  "address_label",
];
