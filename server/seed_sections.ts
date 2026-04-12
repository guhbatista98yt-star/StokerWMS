
import { db } from "./db";
import { sections } from "@shared/schema";
import { eq } from "drizzle-orm";

async function seedSections() {
    console.log("Seeding sections...");

    const sectionsData = [
        { id: 2, name: 'ACESSÓRIOS BANHEIRO & HIDRÁULICOS' },
        { id: 27, name: 'ADESIVOS' },
        { id: 45, name: 'ARGAMASSAS & GRAUTE' },
        { id: 49, name: 'BOMBAS & FERRAMENTAS ELETRICAS' },
        { id: 44, name: 'COBERTURAS & RESERVATÓRIOS' },
        { id: 39, name: 'CONEXÕES PVC' },
        { id: 6, name: 'ELETRICA & ILUMINAÇÃO' },
        { id: 48, name: 'ELETRODUTOS' },
        { id: 37, name: 'FERRAMENTAS & FERRAGENS' },
        { id: 3, name: 'LOUÇAS, PIAS & ESQUADRIAS' },
        { id: 20, name: 'METAIS & ACABAMENTOS' },
        { id: 4, name: 'PINTURAS & ACESSÓRIOS' },
        { id: 42, name: 'PINTURAS DEPÓSITO' },
        { id: 41, name: 'REVESTIMENTOS CERÂMICOS' },
        { id: 35, name: 'SALINHA' },
        { id: 47, name: 'TINTAS PÓ, CAL & REJUNTES' },
        { id: 43, name: 'TUBOS PVC & AÇO' },
        { id: 46, name: 'UTILIDADES DOMÉSTICAS' }
    ];

    for (const section of sectionsData) {
        // Check if exists using id
        // Assuming you have 'eq' imported
        const existing = await db.select().from(sections).where(eq(sections.id, section.id));

        if (existing.length === 0) {
            await db.insert(sections).values(section);
            console.log(`Inserted section ${section.id}: ${section.name}`);
        } else {
            // Update name if different? Optional. User wants to "create".
            console.log(`Section ${section.id} already exists.`);
        }
    }

    console.log("Sections seed completed.");
    process.exit(0);
}

seedSections().catch(err => {
    console.error("Error seeding sections:", err);
    process.exit(1);
});
