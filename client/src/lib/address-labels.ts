/**
 * Nomenclatura dos campos de endereçamento WMS por empresa.
 *
 * Padrão (todas as empresas):  Bairro / Rua / Bloco / Nível
 * Empresa 03 (companyId === 3): Área / Corredor / Prateleira / Posição
 */

export interface AddressFieldLabels {
  bairro: string;
  rua: string;
  bloco: string;
  nivel: string;
}

const DEFAULT_LABELS: AddressFieldLabels = {
  bairro: "Bairro",
  rua:    "Rua",
  bloco:  "Bloco",
  nivel:  "Nível",
};

const COMPANY_03_LABELS: AddressFieldLabels = {
  bairro: "Área",
  rua:    "Corredor",
  bloco:  "Prateleira",
  nivel:  "Posição",
};

export function getAddressLabels(companyId: number | null | undefined): AddressFieldLabels {
  if (companyId === 3) return COMPANY_03_LABELS;
  return DEFAULT_LABELS;
}
