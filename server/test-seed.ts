import fs from "fs";
import path from "path";
import { execSync } from "child_process";

// Set environment variable BEFORE anything else to ensure it connects to test-db
process.env.DATABASE_URL = "file:test-db.sqlite";
process.env.NODE_ENV = "test";

const dbPath = path.resolve(process.cwd(), "test-db.sqlite");
console.log("🧹 Limpando banco de teste antigo...");
if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
}

console.log("🏗️ Criando schema do banco de teste...");
execSync("npx drizzle-kit push --config=drizzle.test.config.ts", { stdio: "inherit" });

async function runSeed() {
    const { db } = await import("./db");
    const {
        users, routes, sections, pickupPoints, sectionGroups,
        products, orders, orderItems, workUnits
    } = await import("@shared/schema");
    const { hashPassword } = await import("./auth");

    console.log("🌱 Inserindo dados de teste...");

    const adminPassword = await hashPassword("admin123");
    const sepPassword = await hashPassword("sep123");
    const confPassword = await hashPassword("conf123");

    // Usuários
    await db.insert(users).values({
        id: "admin-id-1",
        username: "test_admin",
        password: adminPassword,
        name: "Admin Test",
        role: "administrador",
        active: true,
        sections: ["100"],
    });

    await db.insert(users).values({
        id: "sep-id-1",
        username: "test_separador",
        password: sepPassword,
        name: "Separador Test",
        role: "separacao",
        active: true,
        sections: ["100"],
    });

    await db.insert(users).values({
        id: "conf-id-1",
        username: "test_conferente",
        password: confPassword,
        name: "Conferente Test",
        role: "conferencia",
        active: true,
        sections: ["100"],
    });

    // Rotas, Seções, Pontos
    await db.insert(pickupPoints).values({ id: 0, name: "Geral", active: true });
    await db.insert(routes).values({ id: "route-test", code: "RT-01", name: "Rota Teste 1", active: true });
    await db.insert(sections).values({ id: 100, name: "Secao Teste" });
    await db.insert(sectionGroups).values({ name: "Grupo Teste", sections: ["100"] });

    // Produto com código de barras conhecido
    const [produto] = await db.insert(products).values({
        id: "prod-teste-id-1",
        erpCode: "PROD-001",
        barcode: "1234567890123",
        name: "Produto Teste Bipagem",
        section: "100",
        pickupPoint: 0,
        unit: "UN",
        price: 10.0,
        stockQty: 50,
    }).returning();

    // Pedido e Item
    const [pedido] = await db.insert(orders).values({
        id: "pedido-teste-id-1",
        erpOrderId: "PED-TEST-001",
        customerName: "Cliente Teste",
        totalValue: 10.0,
        status: "pendente",
        isLaunched: true, // Launched so we can generate work units if needed, but we insert directly below
        financialStatus: "liberado",
    }).returning();

    const [workUnit] = await db.insert(workUnits).values({
        id: "wu-teste-id-1",
        orderId: pedido.id,
        pickupPoint: 0,
        section: "100",
        type: "separacao",
        status: "pendente",
    }).returning();

    await db.insert(orderItems).values({
        orderId: pedido.id,
        productId: produto.id,
        quantity: 5,
        checkedQty: 0,
        separatedQty: 0,
        section: "100",
        pickupPoint: 0,
        status: "pendente",
    });

    console.log("✅ Seed concluído com sucesso!");
    process.exit(0);
}

runSeed().catch((err) => {
    console.error("❌ Erro no seed de testes:", err);
    process.exit(1);
});
