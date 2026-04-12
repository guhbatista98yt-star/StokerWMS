
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Order, OrderItem, Product } from "@shared/schema";
import { usePickingStore, PickingItem } from "@/lib/pickingStore";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Loader2, Package, MapPin, Layers } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";

type OrderWithItems = Order & {
    items: (OrderItem & { product: Product })[];
};

interface SeparationModeData {
    separationMode: "by_order" | "by_section";
}

export function PickingList() {
    const { startSession } = usePickingStore();
    const { toast } = useToast();
    const { user } = useAuth();
    const [expandedOrder, setExpandedOrder] = useState<string | null>(null);

    const { data: separationModeData } = useQuery<SeparationModeData>({
        queryKey: ["/api/system-settings/separation-mode"],
    });

    const separationMode = separationModeData?.separationMode ?? "by_order";
    const userSections: string[] = (user?.sections as string[]) || [];

    // 1. Fetch Orders (Summary)
    const { data: orders, isLoading: ordersLoading } = useQuery<Order[]>({
        queryKey: ["/api/orders"],
        select: (data) => data.filter(o => o.status === 'pendente' || o.status === 'em_separacao')
    });

    // 2. Fetch Order Details (on expansion)
    const { data: orderDetails, isLoading: detailsLoading } = useQuery<OrderWithItems>({
        queryKey: ["/api/orders", expandedOrder],
        enabled: !!expandedOrder,
        queryFn: async () => {
            const res = await apiRequest("GET", `/api/orders/${expandedOrder}`);
            if (!res.ok) throw new Error("Failed to fetch order details");
            return res.json();
        }
    });

    const handleStartPicking = async (order: Order, section: string, items: (OrderItem & { product: Product })[]) => {
        try {
            const lockRes = await apiRequest("POST", "/api/lock", {
                orderId: order.id,
                sectionId: section
            });

            if (!lockRes.ok) {
                const error = await lockRes.json();
                toast({
                    variant: "destructive",
                    title: "Bloqueado",
                    description: error.message || "Esta seção já está sendo separada por outro usuário."
                });
                return;
            }

            const { sessionId } = await lockRes.json();

            const pickingItems: PickingItem[] = items.map(i => ({
                ...i,
                qtyPickedLocal: i.qtyPicked || 0,
                statusLocal: i.status === 'separado' ? 'synced' : 'pending'
            }));

            startSession({
                orderId: order.id,
                sectionId: section,
                sessionId,
                lastHeartbeat: Date.now()
            }, pickingItems);

        } catch (e) {
            toast({
                variant: "destructive",
                title: "Erro",
                description: "Não foi possível iniciar a sessão."
            });
        }
    };

    // Helper to group items by section, filtering by user sections in by_section mode
    const getSections = (items: (OrderItem & { product: Product })[]) => {
        const sections: Record<string, (OrderItem & { product: Product })[]> = {};
        items.forEach(item => {
            if (!sections[item.section]) sections[item.section] = [];
            sections[item.section].push(item);
        });

        let entries = Object.entries(sections);

        // In by_section mode, filter to only show user's assigned sections
        if (separationMode === "by_section" && userSections.length > 0) {
            entries = entries.filter(([sectionName]) => userSections.includes(sectionName));
        }

        return entries;
    };

    if (ordersLoading) {
        return <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    const modeBadge = separationMode === "by_section" ? (
        <Badge variant="outline" className="bg-purple-100 text-purple-700 border-purple-200 text-xs flex items-center gap-1" data-testid="badge-separation-mode">
            <Layers className="h-3 w-3" />
            Modo: Por Seção
        </Badge>
    ) : (
        <Badge variant="outline" className="bg-blue-100 text-blue-700 border-blue-200 text-xs flex items-center gap-1" data-testid="badge-separation-mode">
            <Package className="h-3 w-3" />
            Modo: Por Pedido
        </Badge>
    );

    return (
        <div className="space-y-4 min-w-0 overflow-hidden">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold truncate">Pedidos Disponíveis</h2>
                {modeBadge}
            </div>

            {separationMode === "by_section" && userSections.length === 0 && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
                    Nenhuma seção atribuída ao seu usuário. Entre em contato com o supervisor.
                </div>
            )}

            {orders?.length === 0 && <p className="text-muted-foreground text-center">Nenhum pedido pendente.</p>}

            <Accordion type="single" collapsible onValueChange={setExpandedOrder}>
                {orders?.map(order => (
                    <AccordionItem key={order.id} value={order.id}>
                        <AccordionTrigger className="hover:no-underline px-4 border rounded-lg mb-2 bg-card hover:bg-accent min-h-[48px]">
                            <div className="flex flex-col items-start text-left w-full min-w-0">
                                <div className="flex justify-between w-full min-w-0 gap-2">
                                    <span className="font-bold truncate" data-testid={`text-order-id-${order.id}`}>Pedido #{order.erpOrderId}</span>
                                    <Badge variant={order.priority > 0 ? "destructive" : "outline"} className="shrink-0">

                                        {order.priority > 0 ? "Prioridade" : "Normal"}
                                    </Badge>
                                </div>
                                <span className="text-sm text-muted-foreground truncate w-full">{order.customerName}</span>
                            </div>
                        </AccordionTrigger>

                        <AccordionContent className="px-2 pt-2 pb-4">
                            {detailsLoading && expandedOrder === order.id ? (
                                <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin" /></div>
                            ) : (
                                orderDetails && expandedOrder === order.id && (
                                    <div className="space-y-2">
                                        <p className="text-sm font-semibold text-muted-foreground mb-2">
                                            {separationMode === "by_section"
                                                ? "Suas seções neste pedido:"
                                                : "Selecione uma seção para iniciar:"}
                                        </p>
                                        {getSections(orderDetails.items).length === 0 ? (
                                            <p className="text-sm text-muted-foreground italic">
                                                {separationMode === "by_section"
                                                    ? "Nenhuma seção deste pedido está atribuída ao seu usuário."
                                                    : "Nenhuma seção encontrada."}
                                            </p>
                                        ) : (
                                            getSections(orderDetails.items).map(([sectionName, items]) => (
                                                <Card key={sectionName} className="cursor-pointer hover:bg-accent transition-colors"
                                                    onClick={() => handleStartPicking(order, sectionName, items)}
                                                    data-testid={`card-section-${sectionName}`}
                                                >
                                                    <CardContent className="flex items-center justify-between p-4 min-h-[48px]">
                                                        <div className="flex items-center space-x-3 min-w-0">
                                                            <MapPin className="h-5 w-5 text-primary shrink-0" />
                                                            <div className="min-w-0">
                                                                <p className="font-bold text-lg truncate">{sectionName}</p>
                                                                <p className="text-xs text-muted-foreground">{items.length} itens</p>
                                                            </div>
                                                        </div>
                                                        <Button size="sm" className="shrink-0 h-10" data-testid={`button-start-picking-${sectionName}`}>Iniciar</Button>
                                                    </CardContent>
                                                </Card>
                                            ))
                                        )}

                                    </div>
                                )
                            )}
                        </AccordionContent>
                    </AccordionItem>
                ))}
            </Accordion>
        </div>
    );
}
