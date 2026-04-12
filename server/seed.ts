import { db } from "./db";
import { users, routes, products, orders, orderItems, workUnits, sections } from "@shared/schema";
import { hashPassword, generateBadgeCode } from "./auth";
import { eq } from "drizzle-orm";

async function seedSections() {
  const existingSections = await db.select().from(sections);
  if (existingSections.length > 0) return;

  const sectionData = [
    { id: 1, name: "Mercearia" },
    { id: 2, name: "Laticínios" },
    { id: 3, name: "Bebidas" },
    { id: 4, name: "Limpeza" },
    { id: 5, name: "Higiene" },
    { id: 6, name: "Hortifruti" },
    { id: 7, name: "Carnes" },
    { id: 8, name: "Congelados" },
    { id: 9, name: "Padaria" },
    { id: 10, name: "Frios" },
  ];

  await db.insert(sections).values(sectionData);
  console.log("Sections seeded:", sectionData.length);
}

import { systemSettings } from "@shared/schema";

async function seedSystemSettings() {
  const existingSettings = await db.select().from(systemSettings);
  if (existingSettings.length > 0) return;

  await db.insert(systemSettings).values({
    id: "global",
    separationMode: "by_order",
    updatedAt: new Date().toISOString(),
  });
  console.log("System settings seeded");
}

export async function seedDatabase() {
  console.log("Seeding database...");

  await seedSections();
  await seedSystemSettings();

  // Check if already seeded
  console.log("Checking for existing users...");
  const existingUsers = await db.select().from(users);
  console.log("Existing users count:", existingUsers.length);
  if (existingUsers.length > 0) {
    console.log("Database already seeded");
    return;
  }

  // Create users
  console.log("Hashing passwords...");
  const supervisorPassword = await hashPassword("admin123");
  const operatorPassword = await hashPassword("1234");
  console.log("Passwords hashed.");

  console.log("Creating administrador...");
  const [supervisor] = await db.insert(users).values({
    username: "admin",
    password: supervisorPassword,
    name: "Carlos Silva",
    role: "administrador" as any,
    active: true,
    badgeCode: generateBadgeCode(),
  }).returning();
  console.log("Administrador created.");

  const [separador] = await db.insert(users).values({
    username: "joao",
    password: operatorPassword,
    name: "João Santos",
    role: "separacao" as any,
    sections: ["Mercearia", "Laticínios"],
    active: true,
    badgeCode: generateBadgeCode(),
  }).returning();

  const [conferente] = await db.insert(users).values({
    username: "maria",
    password: operatorPassword,
    name: "Maria Oliveira",
    role: "conferencia" as any,
    active: true,
    badgeCode: generateBadgeCode(),
  }).returning();

  const [balcao] = await db.insert(users).values({
    username: "pedro",
    password: operatorPassword,
    name: "Pedro Costa",
    role: "balcao" as any,
    active: true,
    badgeCode: generateBadgeCode(),
  }).returning();

  console.log("Created users:", supervisor.name, separador.name, conferente.name, balcao.name);

  // Create routes
  const [rota1] = await db.insert(routes).values({
    code: "R01",
    name: "Centro",
    description: "Região central da cidade",
    active: true,
  }).returning();

  const [rota2] = await db.insert(routes).values({
    code: "R02",
    name: "Zona Norte",
    description: "Bairros da zona norte",
    active: true,
  }).returning();

  const [rota3] = await db.insert(routes).values({
    code: "R03",
    name: "Zona Sul",
    description: "Bairros da zona sul",
    active: true,
  }).returning();

  console.log("Created routes:", rota1.code, rota2.code, rota3.code);

  // Create products
  const productsSeed = [
    { erpCode: "P001", referenceCode: "REF-001", barcode: "7891234567890", boxBarcode: "DUN7891234567890", name: "Arroz Tipo 1 5kg", section: "Mercearia", pickupPoint: 1, unit: "UN", price: "24.90", stockQty: "100" },
    { erpCode: "P002", referenceCode: "REF-002", barcode: "7891234567891", boxBarcode: "DUN7891234567891", name: "Feijão Carioca 1kg", section: "Mercearia", pickupPoint: 1, unit: "UN", price: "8.90", stockQty: "100" },
    { erpCode: "P003", referenceCode: "REF-003", barcode: "7891234567892", boxBarcode: null, name: "Óleo de Soja 900ml", section: "Mercearia", pickupPoint: 1, unit: "UN", price: "7.50", stockQty: "100" },
    { erpCode: "P004", referenceCode: "REF-004", barcode: "7891234567893", boxBarcode: "DUN7891234567893", name: "Açúcar Cristal 1kg", section: "Mercearia", pickupPoint: 2, unit: "UN", price: "5.90", stockQty: "100" },
    { erpCode: "P005", referenceCode: "REF-005", barcode: "7891234567894", boxBarcode: null, name: "Café Torrado 500g", section: "Mercearia", pickupPoint: 2, unit: "UN", price: "18.90", stockQty: "100" },
    { erpCode: "P006", referenceCode: "REF-006", barcode: "7891234567895", boxBarcode: "DUN7891234567895", name: "Leite Integral 1L", section: "Laticínios", pickupPoint: 3, unit: "UN", price: "5.50", stockQty: "100" },
    { erpCode: "P007", referenceCode: "REF-007", barcode: "7891234567896", boxBarcode: null, name: "Queijo Mussarela 500g", section: "Laticínios", pickupPoint: 3, unit: "UN", price: "32.90", stockQty: "100" },
    { erpCode: "P008", referenceCode: "REF-008", barcode: "7891234567897", boxBarcode: "DUN7891234567897", name: "Manteiga 200g", section: "Laticínios", pickupPoint: 3, unit: "UN", price: "12.90", stockQty: "100" },
    { erpCode: "P009", referenceCode: "REF-009", barcode: "7891234567898", boxBarcode: null, name: "Refrigerante Cola 2L", section: "Bebidas", pickupPoint: 4, unit: "UN", price: "9.90", stockQty: "100" },
    { erpCode: "P010", referenceCode: "REF-010", barcode: "7891234567899", boxBarcode: "DUN7891234567899", name: "Suco de Laranja 1L", section: "Bebidas", pickupPoint: 4, unit: "UN", price: "8.90", stockQty: "100" },
    { erpCode: "P011", referenceCode: "REF-011", barcode: "7891234567900", boxBarcode: null, name: "Água Mineral 500ml", section: "Bebidas", pickupPoint: 4, unit: "UN", price: "2.50", stockQty: "100" },
    { erpCode: "P012", referenceCode: "REF-012", barcode: "7891234567901", boxBarcode: "DUN7891234567901", name: "Sabão em Pó 1kg", section: "Limpeza", pickupPoint: 5, unit: "UN", price: "14.90", stockQty: "100" },
  ];

  const productsData = productsSeed.map((p) => ({
    ...p,
    price: Number(p.price),
    stockQty: Number(p.stockQty),
  }));

  const createdProducts = await db.insert(products).values(productsData).returning();
  console.log("Created", createdProducts.length, "products");

  // Create mapping for lookups
  const productMap = new Map();
  for (const p of createdProducts) {
    productMap.set(p.erpCode, p.id);
  }

  // Orders
  const ordersSeed = [
    { erpOrderId: "PED-001", customerName: "Mercado do João", customerCode: "C001", totalValue: "156.80", status: "pendente", priority: 1, routeId: rota1.id, pickupPoints: [1, 2] },
    { erpOrderId: "PED-002", customerName: "Supermercado Bom Preço", customerCode: "C002", totalValue: "289.50", status: "pendente", priority: 0, routeId: rota1.id, pickupPoints: [1, 3, 4] },
    { erpOrderId: "PED-003", customerName: "Atacado Central", customerCode: "C003", totalValue: "534.20", status: "pendente", priority: 0, routeId: rota2.id, pickupPoints: [1, 2, 3] },
    { erpOrderId: "PED-004", customerName: "Loja das Bebidas", customerCode: "C004", totalValue: "187.60", status: "pendente", priority: 0, routeId: rota2.id, pickupPoints: [4] },
    { erpOrderId: "PED-005", customerName: "Padaria Estrela", customerCode: "C005", totalValue: "98.70", status: "pendente", priority: 0, routeId: rota3.id, pickupPoints: [2, 3] },
    { erpOrderId: "BAL-001", customerName: "Cliente Balcão", customerCode: "BAL", totalValue: "45.30", status: "pendente", priority: 0, pickupPoints: [1] },
    { erpOrderId: "BAL-002", customerName: "Cliente Balcão 2", customerCode: "BAL", totalValue: "67.80", status: "pendente", priority: 0, pickupPoints: [2, 3] },
  ];

  const ordersData = ordersSeed.map((o) => ({
    ...o,
    totalValue: Number(o.totalValue),
    pickupPoints: o.pickupPoints as any, // Cast to avoid JSON type conflict
    status: o.status as any,
  }));

  const createdOrders = await db.insert(orders).values(ordersData).returning();
  console.log("Created", createdOrders.length, "orders");

  // Order Items
  const orderItemsSeed = [
    { erpOrderId: "PED-001", erpProductCode: "P001", quantity: "5", separatedQty: "0", checkedQty: "0", status: "pendente", pickupPoint: 1, section: "Mercearia" },
    { erpOrderId: "PED-001", erpProductCode: "P004", quantity: "2", separatedQty: "0", checkedQty: "0", status: "pendente", pickupPoint: 2, section: "Mercearia" },
    { erpOrderId: "PED-002", erpProductCode: "P002", quantity: "3", separatedQty: "0", checkedQty: "0", status: "pendente", pickupPoint: 1, section: "Mercearia" },
    { erpOrderId: "PED-002", erpProductCode: "P006", quantity: "10", separatedQty: "0", checkedQty: "0", status: "pendente", pickupPoint: 3, section: "Laticínios" },
    { erpOrderId: "PED-002", erpProductCode: "P009", quantity: "4", separatedQty: "0", checkedQty: "0", status: "pendente", pickupPoint: 4, section: "Bebidas" },
    { erpOrderId: "PED-003", erpProductCode: "P003", quantity: "7", separatedQty: "0", checkedQty: "0", status: "pendente", pickupPoint: 1, section: "Mercearia" },
    { erpOrderId: "PED-003", erpProductCode: "P005", quantity: "3", separatedQty: "0", checkedQty: "0", status: "pendente", pickupPoint: 2, section: "Mercearia" },
    { erpOrderId: "PED-003", erpProductCode: "P007", quantity: "2", separatedQty: "0", checkedQty: "0", status: "pendente", pickupPoint: 3, section: "Laticínios" },
    { erpOrderId: "PED-004", erpProductCode: "P010", quantity: "6", separatedQty: "0", checkedQty: "0", status: "pendente", pickupPoint: 4, section: "Bebidas" },
    { erpOrderId: "PED-005", erpProductCode: "P004", quantity: "1", separatedQty: "0", checkedQty: "0", status: "pendente", pickupPoint: 2, section: "Mercearia" },
    { erpOrderId: "PED-005", erpProductCode: "P008", quantity: "2", separatedQty: "0", checkedQty: "0", status: "pendente", pickupPoint: 3, section: "Laticínios" },
    { erpOrderId: "BAL-001", erpProductCode: "P001", quantity: "1", separatedQty: "0", checkedQty: "0", status: "pendente", pickupPoint: 1, section: "Mercearia" },
    { erpOrderId: "BAL-002", erpProductCode: "P005", quantity: "1", separatedQty: "0", checkedQty: "0", status: "pendente", pickupPoint: 2, section: "Mercearia" },
    { erpOrderId: "BAL-002", erpProductCode: "P006", quantity: "2", separatedQty: "0", checkedQty: "0", status: "pendente", pickupPoint: 3, section: "Laticínios" },
  ];

  const itemsToInsert = orderItemsSeed.map((item) => {
    const order = createdOrders.find((o) => o.erpOrderId === item.erpOrderId);
    const productId = productMap.get(item.erpProductCode);

    if (!order || !productId) return null;

    return {
      orderId: order.id,
      productId,
      quantity: Number(item.quantity),
      separatedQty: Number(item.separatedQty),
      checkedQty: Number(item.checkedQty),
      status: item.status as any,
      pickupPoint: item.pickupPoint,
      section: item.section,
    };
  }).filter((i): i is NonNullable<typeof i> => i !== null);

  if (itemsToInsert.length > 0) {
    await db.insert(orderItems).values(itemsToInsert as any);
  }
  console.log("Created order items");

  for (const order of createdOrders.slice(0, 5)) {
    await db.insert(workUnits).values({
      orderId: order.id,
      pickupPoint: 0,
      type: "separacao" as any,
      status: "pendente" as any,
    });
  }

  // Create work units for balcão
  for (const order of createdOrders.slice(5)) {
    await db.insert(workUnits).values({
      orderId: order.id,
      pickupPoint: 1,
      type: "balcao" as any,
      status: "pendente" as any,
    });
  }

  console.log("Created work units");
  console.log("Seed completed successfully!");
}
