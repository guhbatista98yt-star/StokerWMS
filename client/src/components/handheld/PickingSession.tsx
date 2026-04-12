
import { useState, useEffect } from "react";
import { usePickingStore } from "@/lib/pickingStore";
import { ItemCard } from "./ItemCard";
import { ScannerHandler } from "./ScannerHandler";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertTriangle, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export function PickingSession() {
    const { items, activeSession, pickItem, endSession, syncItem } = usePickingStore();
    const { toast } = useToast();
    const [currentIndex, setCurrentIndex] = useState(0);

    // Filter pending items
    const pendingItems = items.filter(i => i.statusLocal === 'pending');
    // If no pending items, we are done?
    // Or we should show all items but focus on pending?
    // Let's find the first pending item index relative to the full list, or just iterate pending list.
    // Better to iterate full list but skip completed ones, or have a "done" screen.

    const currentItem = pendingItems[0];
    const isComplete = !currentItem;

    // Heartbeat Effect
    useEffect(() => {
        if (!activeSession) return;

        const interval = setInterval(async () => {
            try {
                await apiRequest("POST", "/api/heartbeat", { sessionId: activeSession.sessionId });
            } catch {
                // Heartbeat falhou silenciosamente — a sessão será invalidada pelo TTL do servidor
            }
        }, 30000); // 30s

        return () => clearInterval(interval);
    }, [activeSession]);

    const handleConfirm = async (qty: number) => {
        if (!currentItem || !activeSession) return;

        // 1. Update Local Store
        pickItem(currentItem.id, qty);

        // 2. Sync to Backend (Optimistic)
        try {
            const res = await apiRequest("POST", "/api/picking/submit", {
                orderId: activeSession.orderId,
                sectionId: activeSession.sectionId,
                items: [{ id: currentItem.id, qtyPicked: qty }]
            });

            if (!res.ok) throw new Error("Sync failed");

            // Mark as synced
            syncItem(currentItem.id);

            toast({ title: "Item Separado", description: `${currentItem.product.name}` });

        } catch (e) {
            toast({
                variant: "destructive",
                title: "Erro de Sincronização",
                description: "Salvo localmente. Tentando novamente em breve."
            });
            // Keeping statusLocal as 'picked' but not 'synced' deals with this.
        }
    };

    const handleScan = (barcode: string) => {
        if (!currentItem) return;

        if (barcode === currentItem.product.barcode || barcode === currentItem.product.boxBarcode) {
            toast({ title: "Código de Barras OK", className: "bg-green-100 border-green-500" });
            // Auto confirm? Or just validate?
            // For efficiency, maybe auto-confirm if quantity is 1?
            // Or just highlight and ask for Qty.
            // Let's just play a success sound (visual toast) and maybe focus confirm button.
            // For now, simple validation.
        } else {
            toast({
                variant: "destructive",
                title: "Código Incorreto",
                description: `Lido: ${barcode}. Esperado: ${currentItem.product.barcode}`
            });
        }
    };

    const handleUnlock = async () => {
        if (activeSession) {
            try {
                await apiRequest("POST", "/api/unlock", {
                    orderId: activeSession.orderId,
                    sectionId: activeSession.sectionId
                });
            } catch {
                // Ignore unlock error — sessão será limpa pelo TTL
            }
        }
        endSession();
    };

    if (isComplete) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-6 text-center space-y-6">
                <CheckCircle2 className="h-24 w-24 text-green-500" />
                <h2 className="text-3xl font-bold">Seção Finalizada!</h2>
                <p className="text-muted-foreground">Todos os itens desta seção foram separados.</p>
                <Button size="lg" className="w-full h-14" onClick={handleUnlock}>
                    Finalizar Sessão
                </Button>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full min-w-0 overflow-hidden">
            {/* Header with Exit button */}
            <div className="flex justify-between items-center mb-4 shrink-0">
                <Button variant="ghost" className="h-12 px-4" onClick={handleUnlock}>
                    <ArrowLeft className="mr-2 h-4 w-4" /> Sair
                </Button>
                <span className="font-mono text-sm shrink-0">
                    {items.length - pendingItems.length} / {items.length}
                </span>
            </div>

            <ScannerHandler onScan={handleScan} />

            <div className="flex-1 flex items-center justify-center overflow-hidden min-w-0 w-full">
                <ItemCard
                    item={currentItem}
                    onConfirm={handleConfirm}
                    onSkip={() => {
                        // Skip logic: Move to end of array locally? 
                        // Or just index++?
                        // Since we filter pendingItems based on statusLocal, and we aren't changing status,
                        // simplistic 'skip' needs state manipulation or just finding next.
                        // Ideally we have a 'skipped' status or just rotate.
                        // For MVP, handling skip is complex without reordering.
                        // Let's just say "Not implemented" or simple rotation if array was robust.
                        toast({ title: "Pular", description: "Funcionalidade em desenvolvimento" });
                    }}
                    onIssue={() => {
                        toast({ title: "Avaria", description: "Funcionalidade em desenvolvimento" });
                    }}
                />
            </div>
        </div>
    );
}
