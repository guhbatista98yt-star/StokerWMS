import type { DataContractField, DatasetName } from "@shared/schema";

const ordersContract: DataContractField[] = [
  { appField: "erp_order_id", type: "string", required: true, description: "ID do pedido no ERP (IDORCAMENTO)", example: "12345" },
  { appField: "customer_name", type: "string", required: true, description: "Nome do cliente (DESCLIENTE)", example: "Mercado do João" },
  { appField: "customer_code", type: "string", required: false, description: "Código do cliente (IDCLIFOR)", example: "C001" },
  { appField: "total_value", type: "number", required: true, description: "Valor total do pedido", example: "156.80" },
  { appField: "financial_status", type: "string", required: false, description: "Status financeiro: pendente ou faturado", example: "pendente" },
  { appField: "created_at", type: "date", required: false, description: "Data do movimento (DTMOVIMENTO)", example: "2025-01-15" },
  { appField: "pickup_point", type: "number", required: false, description: "Local de retirada (IDLOCALRETIRADA)", example: "1" },
  { appField: "section", type: "string", required: false, description: "Seção do armazém (IDSECAO)", example: "1" },
];

const productsContract: DataContractField[] = [
  { appField: "erp_code", type: "string", required: true, description: "Código do produto no ERP (IDPRODUTO)", example: "P001" },
  { appField: "name", type: "string", required: true, description: "Descrição do produto (DESCRRESPRODUTO)", example: "Arroz Tipo 1 5kg" },
  { appField: "barcode", type: "string", required: false, description: "Código de barras unitário (CODBARRAS)", example: "7891234567890" },
  { appField: "box_barcode", type: "string", required: false, description: "Código de barras da caixa (CODBARRAS_CAIXA)", example: "DUN7891234567890" },
  { appField: "section", type: "string", required: true, description: "Seção do produto (IDSECAO)", example: "Mercearia" },
  { appField: "pickup_point", type: "number", required: true, description: "Ponto de retirada (IDLOCALRETIRADA)", example: "1" },
  { appField: "unit", type: "string", required: false, description: "Unidade de medida (UNIDADE)", example: "UN" },
  { appField: "manufacturer", type: "string", required: false, description: "Fabricante (FABRICANTE)", example: "Marca X" },
  { appField: "price", type: "number", required: false, description: "Preço unitário bruto (VALUNITBRUTO)", example: "24.90" },
];

const orderItemsContract: DataContractField[] = [
  { appField: "erp_order_id", type: "string", required: true, description: "ID do pedido pai no ERP (IDORCAMENTO)", example: "12345" },
  { appField: "erp_product_code", type: "string", required: true, description: "Código do produto no ERP (IDPRODUTO)", example: "P001" },
  { appField: "quantity", type: "number", required: true, description: "Quantidade do item (QTDPRODUTO)", example: "5.0" },
  { appField: "pickup_point", type: "number", required: false, description: "Ponto de retirada (IDLOCALRETIRADA)", example: "1" },
  { appField: "section", type: "string", required: false, description: "Seção do item (IDSECAO)", example: "1" },
];

const workUnitsContract: DataContractField[] = [
  { appField: "erp_order_id", type: "string", required: true, description: "ID do pedido (derivado do order)", example: "12345" },
  { appField: "pickup_point", type: "number", required: false, description: "Ponto de retirada", example: "1" },
  { appField: "section", type: "string", required: false, description: "Seção do armazém", example: "1" },
  { appField: "type", type: "string", required: true, description: "Tipo: separacao, conferencia ou balcao", example: "separacao" },
];

export const dataContracts: Record<DatasetName, DataContractField[]> = {
  orders: ordersContract,
  products: productsContract,
  order_items: orderItemsContract,
  work_units: workUnitsContract,
};

export function getDataContract(dataset: string): DataContractField[] | null {
  return dataContracts[dataset as DatasetName] || null;
}

export function getAvailableDatasets(): { name: DatasetName; label: string; description: string }[] {
  return [
    { name: "orders", label: "Pedidos", description: "Dados de pedidos/orçamentos do ERP" },
    { name: "products", label: "Produtos", description: "Catálogo de produtos com códigos de barras" },
    { name: "order_items", label: "Itens de Pedido", description: "Itens individuais dentro de cada pedido" },
  ];
}
