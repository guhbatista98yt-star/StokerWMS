import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import { DateRange } from "react-day-picker";
import { getCurrentWeekRange, isDateInRange } from "@/lib/date-utils";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    FileDown,
    Loader2,
    ArrowLeft,
    Search as SearchIcon,
    Plus,
    Pencil,
    Trash2,
    Save,
    XCircle,
    MapPin,
    Package,
    Layers,
    CheckSquare,
    Printer,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Link, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";


type FlowStep = "initial" | "pickup-points" | "select-orders" | "sections" | "summary";
type SectionMode = "individual" | "group";

function escHtml(str: string | null | undefined): string {
    if (!str) return "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface SectionGroup {
    id: string;
    name: string;
    sections: string[];
    createdAt: string;
    updatedAt: string;
}

export default function PickingListReport() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { user, companyId } = useAuth();
    const [, navigate] = useLocation();

    // Flow state
    const [currentStep, setCurrentStep] = useState<FlowStep>("pickup-points");

    // Modal 1 - Pickup Points
    const [selectedPickupPoints, setSelectedPickupPoints] = useState<number[]>([]);
    const [selectAllPickupPoints, setSelectAllPickupPoints] = useState(false);

    // Modal 2 - Orders
    const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
    const [orderSearchQuery, setOrderSearchQuery] = useState("");
    const [showSelectedOrdersOnly, setShowSelectedOrdersOnly] = useState(false);
    const [filterDateRange, setFilterDateRange] = useState<DateRange | undefined>(getCurrentWeekRange());
    const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>(getCurrentWeekRange());

    // Modal 3 - Sections/Groups
    const [sectionMode, setSectionMode] = useState<SectionMode>("individual");
    const [selectedSections, setSelectedSections] = useState<string[]>([]);
    const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
    const [showCreateGroupDialog, setShowCreateGroupDialog] = useState(false);
    const [showEditGroupDialog, setShowEditGroupDialog] = useState(false);
    const [editingGroup, setEditingGroup] = useState<SectionGroup | null>(null);
    const [groupToDelete, setGroupToDelete] = useState<SectionGroup | null>(null);
    const [newGroupName, setNewGroupName] = useState("");
    const [newGroupSections, setNewGroupSections] = useState<string[]>([]);
    const [groupSearchQuery, setGroupSearchQuery] = useState("");

    // Modal 4 - Generate
    const [isGenerating, setIsGenerating] = useState(false);

    const [ordersLoaded, setOrdersLoaded] = useState(false);
    const [validOrderIds, setValidOrderIds] = useState<string[] | null>(null);
    const [filteredCounts, setFilteredCounts] = useState<Record<string, number>>({});
    const [isFetchingValidOrders, setIsFetchingValidOrders] = useState(false);

    const { data: pickupPointsData } = useQuery({
        queryKey: ["/api/pickup-points"],
    });
    const allPickupPoints: any[] = (pickupPointsData as any[]) || [];
    // Pontos de retirada permitidos por empresa no Romaneio (mantemos aqui para filtro visual no dropdown)
    const COMPANY_PICKUP_POINTS: Record<number, number[]> = {
        1: [1, 2, 4, 58],
        3: [52, 54, 60, 61],
    };
    const allowedPoints = companyId ? COMPANY_PICKUP_POINTS[companyId] : null;
    const pickupPoints = allowedPoints
        ? allPickupPoints.filter(pp => allowedPoints.includes(pp.id))
        : allPickupPoints;

    const { data: ordersData, refetch: refetchOrders, isFetching: isLoadingOrders } = useQuery({
        queryKey: ["/api/orders?type=report"],
        enabled: ordersLoaded,
    });
    const orders = (ordersData as any[]) || [];

    const { data: sectionsData } = useQuery({
        queryKey: ["/api/sections"],
        enabled: currentStep === "sections",
    });
    const sections = (sectionsData as any[]) || [];

    const { data: groupsData } = useQuery({
        queryKey: ["/api/sections/groups"],
        enabled: currentStep === "sections",
    });
    const groups = (groupsData as SectionGroup[]) || [];

    const { data: routesData } = useQuery({
        queryKey: ["/api/routes"],
    });
    const routes = (routesData as any[]) || [];

    // Mutations
    const createGroupMutation = useMutation({
        mutationFn: async (data: { name: string; sections: string[] }) => {
            const response = await apiRequest("POST", "/api/sections/groups", data);
            if (!response.ok) {
                const text = await response.text();
                throw new Error(text || "Falha ao criar grupo");
            }
            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/sections/groups"] });
            toast({ title: "Grupo criado com sucesso!" });
            setShowCreateGroupDialog(false);
            setNewGroupName("");
            setNewGroupSections([]);
        },
        onError: () => {
            toast({ title: "Erro ao criar grupo", variant: "destructive" });
        },
    });

    const updateGroupMutation = useMutation({
        mutationFn: async (data: { id: string; name: string; sections: string[] }) => {
            const response = await apiRequest("PUT", `/api/sections/groups/${data.id}`, { name: data.name, sections: data.sections });
            if (!response.ok) {
                const text = await response.text();
                throw new Error(text || "Falha ao atualizar grupo");
            }
            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/sections/groups"] });
            toast({ title: "Grupo atualizado!" });
            setShowEditGroupDialog(false);
            setEditingGroup(null);
        },
        onError: () => {
            toast({ title: "Erro ao atualizar grupo", variant: "destructive" });
        },
    });

    const deleteGroupMutation = useMutation({
        mutationFn: async (id: string) => {
            const response = await apiRequest("DELETE", `/api/sections/groups/${id}`);
            if (!response.ok) {
                const text = await response.text();
                throw new Error(text || "Falha ao excluir grupo");
            }
            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/sections/groups"] });
            toast({ title: "Grupo excluído." });
        },
        onError: () => {
            toast({ title: "Erro ao excluir grupo", variant: "destructive" });
        },
    });

    const cancelLaunchMutation = useMutation({
        mutationFn: async (orderIds: string[]) => {
            const response = await apiRequest("POST", "/api/orders/cancel-launch", { orderIds });
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.details || data.error || "Erro ao cancelar lançamento");
            }
            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
            toast({ title: "Lançamento cancelado com sucesso!" });
        },
        onError: (error: Error) => {
            toast({
                title: "Erro ao cancelar lançamento",
                description: error.message,
                variant: "destructive"
            });
        },
    });

    const filteredOrders = orders.filter(order => {
        if (!isDateInRange(order.createdAt, filterDateRange)) return false;

        // Bug 7: Use item-level pickup point filter (validOrderIds from backend)
        if (!selectAllPickupPoints && selectedPickupPoints.length > 0 && validOrderIds !== null) {
            if (!validOrderIds.includes(order.id)) return false;
        }

        return true;
    });

    // Helper para busca múltipla
    const processMultipleOrderSearch = (searchValue: string, orderCode: string): boolean => {
        if (!searchValue.trim()) return true;
        if (searchValue.includes(',')) {
            const terms = searchValue.split(',').map(t => t.trim().toLowerCase()).filter(t => t);
            return terms.some(term => orderCode.toLowerCase().includes(term));
        }
        return orderCode.toLowerCase().includes(searchValue.toLowerCase());
    };

    // Search filtered orders
    const displayedOrders = filteredOrders.filter(order => {
        if (orderSearchQuery) {
            const query = orderSearchQuery.toLowerCase();
            const matchesId = processMultipleOrderSearch(orderSearchQuery, order.erpOrderId || '');
            const matchesCustomer = order.customerName?.toLowerCase().includes(query);
            if (!matchesId && !matchesCustomer) return false;
        }

        if (showSelectedOrdersOnly && !selectedOrders.includes(order.id)) {
            return false;
        }

        return true;
    });

    // Handlers
    const handleStartFlow = () => {
        setCurrentStep("pickup-points");
    };

    const handleCancelFlow = () => {
        navigate("/supervisor/reports");
    };

    const handlePickupPointsNext = async () => {
        if (!selectAllPickupPoints && selectedPickupPoints.length > 0) {
            setIsFetchingValidOrders(true);
            try {
                const qs = selectedPickupPoints.map(pp => `pp=${pp}`).join('&');
                const res = await apiRequest("GET", `/api/orders/ids-by-pickup-points?${qs}`);
                if (res.ok) {
                    const data = await res.json();
                    setValidOrderIds(data.orderIds || []);
                    if (data.counts) {
                        const countsMap: Record<string, number> = {};
                        data.counts.forEach((c: any) => countsMap[c.orderId] = c.itemCount);
                        setFilteredCounts(countsMap);
                    }
                } else {
                    setValidOrderIds(null);
                    setFilteredCounts({});
                }
            } catch {
                setValidOrderIds(null);
                setFilteredCounts({});
            } finally {
                setIsFetchingValidOrders(false);
            }
        } else {
            setValidOrderIds(null);
            setFilteredCounts({});
        }
        // Auto-load orders when entering the orders step
        setFilterDateRange(tempDateRange);
        setOrdersLoaded(true);
        setCurrentStep("select-orders");
    };

    const handleSelectOrdersBack = () => {
        setCurrentStep("pickup-points");
    };

    const handleSelectOrdersNext = () => {
        setCurrentStep("sections");
    };

    const handleSectionsBack = () => {
        setCurrentStep("select-orders");
    };

    const handleSectionsNext = () => {
        setCurrentStep("summary");
    };

    const handleSummaryBack = () => {
        setCurrentStep("sections");
    };

    const buildPrintHtml = (
        bodyHtml: string,
        titlePrefix: string,
        orderIdsLabel: string,
        sectionFilterLabel: string,
        now: string,
        tabTitle: string
    ) => {
        return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${tabTitle}</title>
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; margin: 12px 20px; font-size: 11px; color: #000; line-height: 1.2; }
    .header { text-align: center; margin-bottom: 6px; }
    .header h1 { font-size: 16px; font-weight: bold; margin: 0 0 4px 0; letter-spacing: 0.3px; }
    .header .params { font-size: 10px; color: #222; line-height: 1.3; }
    .header .params span.label { color: #555; }
    .sub-header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 1px solid #000; padding-bottom: 2px; margin-bottom: 4px; font-size: 10px; }
    .sub-header .left { font-style: italic; text-decoration: underline; }
    .sub-header .right { text-align: right; font-size: 9px; line-height: 1.2; }
    table { width: 100%; border-collapse: collapse; margin-top: 2px; }
    th { border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 3px 6px; text-align: left; font-size: 11px; font-weight: bold; background: #f5f5f5; }
    th:last-child { text-align: right; }
    td { padding: 2px 6px; font-size: 11px; border: none; vertical-align: middle; word-break: break-word; overflow-wrap: break-word; }
    td:last-child { text-align: right; }
    td:first-child { font-weight: 500; }
    tr:nth-child(even):not(.section-row):not(.count-row):not(.total-row) { background: #fafafa; }
    .section-row td { padding-top: 8px; padding-bottom: 2px; border-bottom: 1px solid #ccc; font-size: 12px; background: transparent !important; }
    .count-row td { padding-top: 2px; padding-bottom: 1px; font-size: 10px; color: #444; background: transparent !important; }
    .total-row td { padding-top: 4px; font-size: 12px; background: transparent !important; }
    .total-row.final td { border-top: 1px solid #000; padding-top: 6px; font-size: 13px; }
    @media print {
        body { margin: 6mm 8mm; }
        @page { size: landscape; margin: 6mm; }
        tr { page-break-inside: avoid; }
        .section-row { page-break-after: avoid; }
    }
</style>
<script>window.onload = function() { window.print(); }</script>
</head><body>
<div class="header">
    <h1>${escHtml(titlePrefix)}Romaneio de Separação</h1>
    <div class="params">
        <span class="label">Pedidos:</span> ${escHtml(orderIdsLabel)}<br/>
        <span class="label">Local de Estoque:</span> ${escHtml(sectionFilterLabel)}
    </div>
</div>
<div class="sub-header">
    <span class="left"></span>
    <span class="right">Versão 1<br/>${now}</span>
</div>
<table>
    <thead>
        <tr>
            <th style="width:9%">Cód. Produto</th>
            <th style="width:10%">Referência</th>
            <th style="width:22%">Descrição do Produto</th>
            <th style="width:12%">Cód. de Barras</th>
            <th style="width:11%">Pedidos</th>
            <th style="width:7%">Lote</th>
            <th style="width:17%">Fornecedor</th>
            <th style="width:9%">Separar</th>
        </tr>
    </thead>
    <tbody>${bodyHtml}</tbody>
</table>
</body></html>`;
    };

    interface AggregatedProduct {
        erpCode: string;
        name: string;
        barcode: string;
        manufacturer: string;
        factoryCode: string;
        section: string;
        totalQty: number;
        orderIds: string[];
    }

    interface ReportGroup {
        section: string;
        pickupPoint: number;
        items: any[];
    }

    const buildBodyHtml = (reportData: ReportGroup[], filterSectionIds?: string[]) => {
        let bodyHtml = "";
        
        // Pre-group by section to avoid repeating section headers for different pickup points
        const itemsBySection = new Map<string, any[]>();
        
        for (const group of reportData) {
            if (filterSectionIds && !filterSectionIds.includes(String(group.section))) continue;
            const sectionId = String(group.section);
            const currentItems = itemsBySection.get(sectionId) || [];
            itemsBySection.set(sectionId, [...currentItems, ...group.items]);
        }

        for (const [sectionId, items] of Array.from(itemsBySection.entries())) {
            const sectionObj = sections.find((s: any) => String(s.id) === sectionId);
            const sectionName = sectionObj ? sectionObj.name : (sectionId || "Sem Seção");

            const productMap = new Map<string, AggregatedProduct>();
            for (const item of items) {
                const erpCode = item.product?.erpCode || item.productId || "";
                const existing = productMap.get(erpCode);
                const orderId = item.order?.erpOrderId;

                if (existing) {
                    existing.totalQty += Number(item.quantity) || 0;
                    if (orderId && !existing.orderIds.includes(orderId)) {
                        existing.orderIds.push(orderId);
                    }
                } else {
                    productMap.set(erpCode, {
                        erpCode,
                        name: item.product?.name || "",
                        barcode: item.product?.barcode || "",
                        manufacturer: item.product?.manufacturer || "",
                        factoryCode: item.product?.factoryCode || "",
                        section: sectionName,
                        totalQty: Number(item.quantity) || 0,
                        orderIds: orderId ? [orderId] : [],
                    });
                }
            }

            const aggregatedItems = Array.from(productMap.values()).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

            bodyHtml += `<tr class="section-row"><td colspan="8" style="text-align:left;">
                <strong>Seção:</strong> ${escHtml(sectionName.toUpperCase())}
            </td></tr>`;

            for (const item of aggregatedItems) {
                const qtyFormatted = item.totalQty % 1 === 0 ? item.totalQty.toFixed(0) + ",00" : item.totalQty.toFixed(2).replace(".", ",");
                const ordersList = item.orderIds.map(id => escHtml(id)).join(', ');
                bodyHtml += `<tr>
                    <td>${escHtml(item.erpCode)}</td>
                    <td>${escHtml(item.factoryCode)}</td>
                    <td>${escHtml(item.name)}</td>
                    <td>${escHtml(item.barcode)}</td>
                    <td>${ordersList}</td>
                    <td></td>
                    <td>${escHtml(item.manufacturer)}</td>
                    <td style="text-align:right; font-weight:bold">${qtyFormatted}</td>
                </tr>`;
            }
        }
        return bodyHtml;
    };

    const handleGeneratePDF = async () => {
        setIsGenerating(true);

        try {
            const groupSections = sectionMode === "group" && selectedGroupIds.length > 0
                ? [...new Set(selectedGroupIds.flatMap(gid => groups.find(g => g.id === gid)?.sections || []))]
                : undefined;

            const payload = {
                orderIds: selectedOrders,
                pickupPoints: selectAllPickupPoints ? [] : selectedPickupPoints,
                mode: sectionMode,
                sections: sectionMode === "individual" ? selectedSections : groupSections,
                groupId: sectionMode === "group" ? selectedGroupIds : undefined,
            };

            const response = await apiRequest("POST", "/api/reports/picking-list/generate", payload);
            if (!response.ok) throw new Error("Falha ao gerar relatório");
            const data = await response.json();

            const reportOrders = data.orders || [];
            const now = new Date().toLocaleString("pt-BR");
            const orderIdsLabel = reportOrders.map((o: any) => o.erpOrderId).join("; ");

            const routeIds = [...new Set(reportOrders.map((o: any) => o.routeId).filter(Boolean))] as string[];
            const routeNames = routeIds.map((rid: string) => {
                const r = routes.find((rt: any) => rt.id === rid);
                return r ? (r.name || r.erpRouteId || rid) : rid;
            });
            const titleRouteLabel = routeNames.length > 0 ? routeNames.join(", ") : "";
            const titlePrefix = titleRouteLabel ? `${titleRouteLabel} - ` : "";

            const reportData: ReportGroup[] = data.reportData || [];

            if (sectionMode === "group" && selectedGroupIds.length > 1) {
                for (const gid of selectedGroupIds) {
                    const grp = groups.find(g => g.id === gid);
                    if (!grp) continue;

                    const grpSections = grp.sections;
                    const bodyHtml = buildBodyHtml(reportData, grpSections);
                    if (!bodyHtml) continue;

                    const sectionFilterLabel = grpSections
                        .map(sid => sections.find((s: any) => String(s.id) === sid)?.name || sid)
                        .join("; ");

                    const tabTitle = `${grp.name} - Romaneio`;
                    const html = buildPrintHtml(bodyHtml, titlePrefix, orderIdsLabel, sectionFilterLabel, now, tabTitle);

                    const printWindow = window.open("", "_blank");
                    if (printWindow) {
                        printWindow.document.write(html);
                        printWindow.document.close();
                    } else {
                        toast({ title: "Popup bloqueado", description: `Permita popups para imprimir o grupo "${grp.name}".`, variant: "destructive" });
                    }
                }

                toast({
                    title: "Relatórios gerados!",
                    description: `${selectedGroupIds.length} abas abertas com impressão automática.`
                });
            } else {
                const activeSections = sectionMode === "individual" && selectedSections.length > 0
                    ? selectedSections
                    : sectionMode === "group" && selectedGroupIds.length > 0
                        ? [...new Set(selectedGroupIds.flatMap(gid => groups.find(g => g.id === gid)?.sections || []))]
                        : [];
                const sectionFilterLabel = activeSections.length > 0
                    ? activeSections.map(sid => sections.find((s: any) => String(s.id) === sid)?.name || sid).join("; ")
                    : "Todos";

                const bodyHtml = buildBodyHtml(reportData, activeSections.length > 0 ? activeSections : undefined);
                const groupName = sectionMode === "group" && selectedGroupIds.length === 1
                    ? groups.find(g => g.id === selectedGroupIds[0])?.name
                    : null;
                const tabTitle = groupName
                    ? `${groupName} - Romaneio`
                    : `${titlePrefix}Romaneio de Separação`;

                const html = buildPrintHtml(bodyHtml, titlePrefix, orderIdsLabel, sectionFilterLabel, now, tabTitle);

                const printWindow = window.open("", "_blank");
                if (printWindow) {
                    printWindow.document.write(html);
                    printWindow.document.close();
                } else {
                    toast({ title: "Popup bloqueado", description: "Permita popups no navegador para imprimir o relatório.", variant: "destructive" });
                }

                toast({
                    title: "Relatório gerado!",
                    description: "Impressão automática iniciada."
                });
            }

        } catch (error) {
            toast({
                title: "Erro ao gerar relatório",
                variant: "destructive",
                description: "Não foi possível gerar o PDF. Tente novamente."
            });
        } finally {
            setIsGenerating(false);
        }
    };

    const handleGeneratePDFBySections = async () => {
        setIsGenerating(true);
        try {
            const groupSections = sectionMode === "group" && selectedGroupIds.length > 0
                ? [...new Set(selectedGroupIds.flatMap(gid => groups.find(g => g.id === gid)?.sections || []))]
                : selectedSections;

            const payload = {
                orderIds: selectedOrders,
                pickupPoints: selectAllPickupPoints ? [] : selectedPickupPoints,
                mode: sectionMode,
                sections: sectionMode === "individual" ? selectedSections : groupSections,
                groupId: sectionMode === "group" ? selectedGroupIds : undefined,
            };

            const response = await apiRequest("POST", "/api/reports/picking-list/generate", payload);
            if (!response.ok) throw new Error("Falha ao gerar relatório");
            const data = await response.json();

            const reportOrders = data.orders || [];
            const now = new Date().toLocaleString("pt-BR");
            const orderIdsLabel = reportOrders.map((o: any) => o.erpOrderId).join("; ");
            const routeIds = [...new Set(reportOrders.map((o: any) => o.routeId).filter(Boolean))] as string[];
            const routeNames = routeIds.map((rid: string) => {
                const r = routes.find((rt: any) => rt.id === rid);
                return r ? (r.name || r.erpRouteId || rid) : rid;
            });
            const titlePrefix = routeNames.length > 0 ? `${routeNames.join(", ")} - ` : "";

            const reportData: ReportGroup[] = data.reportData || [];

            const sectionsToprint = groupSections.length > 0 ? groupSections : selectedSections;
            const sectionPages: string[] = [];

            for (const sectionId of sectionsToprint) {
                const sectionObj = sections.find((s: any) => String(s.id) === sectionId);
                const sectionName = sectionObj ? sectionObj.name : sectionId;

                const sectionItems: any[] = [];
                for (const group of reportData) {
                    if (String(group.section) === sectionId) {
                        sectionItems.push(...group.items);
                    }
                }
                if (sectionItems.length === 0) continue;

                const productMap = new Map<string, AggregatedProduct>();
                for (const item of sectionItems) {
                    const erpCode = item.product?.erpCode || item.productId || "";
                    const existing = productMap.get(erpCode);
                    const orderId = item.order?.erpOrderId;
                    if (existing) {
                        existing.totalQty += Number(item.quantity) || 0;
                        if (orderId && !existing.orderIds.includes(orderId)) existing.orderIds.push(orderId);
                    } else {
                        productMap.set(erpCode, {
                            erpCode,
                            name: item.product?.name || "",
                            barcode: item.product?.barcode || "",
                            manufacturer: item.product?.manufacturer || "",
                            factoryCode: item.product?.factoryCode || "",
                            section: sectionName,
                            totalQty: Number(item.quantity) || 0,
                            orderIds: orderId ? [orderId] : [],
                        });
                    }
                }

                const aggregatedItems = Array.from(productMap.values()).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
                let tableRows = "";
                for (const item of aggregatedItems) {
                    const qtyFormatted = item.totalQty % 1 === 0 ? item.totalQty.toFixed(0) + ",00" : item.totalQty.toFixed(2).replace(".", ",");
                    const ordersList = item.orderIds.map(id => escHtml(id)).join(', ');
                    tableRows += `<tr>
                        <td>${escHtml(item.erpCode)}</td>
                        <td>${escHtml(item.factoryCode)}</td>
                        <td>${escHtml(item.name)}</td>
                        <td>${escHtml(item.barcode)}</td>
                        <td>${ordersList}</td>
                        <td></td>
                        <td>${escHtml(item.manufacturer)}</td>
                        <td style="text-align:right;font-weight:bold">${qtyFormatted}</td>
                    </tr>`;
                }

                const routeLabel = routeNames.length > 0 ? routeNames.join(", ") : "";
                sectionPages.push(`<div class="section-page">
<div class="page-header">
    <div class="page-header-top">
        <div class="page-header-left">
            <div class="page-title">Romaneio de Separação</div>
            ${routeLabel ? `<div class="page-route">${escHtml(routeLabel)}</div>` : ""}
        </div>
        <span class="page-date">Versão 1 | ${escHtml(now)}</span>
    </div>
    <div class="page-section-banner">${escHtml(sectionName.toUpperCase())}</div>
    <div class="page-header-params">
        <span class="label">Pedidos:</span> ${escHtml(orderIdsLabel)}
    </div>
</div>
<table>
    <thead><tr>
        <th style="width:9%">Cód. Produto</th>
        <th style="width:10%">Referência</th>
        <th style="width:22%">Descrição do Produto</th>
        <th style="width:12%">Cód. de Barras</th>
        <th style="width:11%">Pedidos</th>
        <th style="width:7%">Lote</th>
        <th style="width:17%">Fornecedor</th>
        <th style="width:9%">Separar</th>
    </tr></thead>
    <tbody>${tableRows}</tbody>
</table>
</div>`);
            }

            if (sectionPages.length === 0) {
                toast({ title: "Nenhum dado encontrado para as seções selecionadas", variant: "destructive" });
                return;
            }

            const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Romaneio por Seção</title>
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #000; line-height: 1.2; }
    .section-page { padding: 12px 20px; }
    .page-header { margin-bottom: 6px; border-bottom: 3px solid #000; padding-bottom: 6px; }
    .page-header-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px; }
    .page-header-left { display: flex; flex-direction: column; gap: 1px; }
    .page-title { font-size: 11px; color: #555; text-transform: uppercase; letter-spacing: 0.04em; }
    .page-route { font-size: 18px; font-weight: bold; color: #000; line-height: 1.1; }
    .page-date { font-size: 9px; color: #777; white-space: nowrap; padding-top: 2px; }
    .page-section-banner {
        font-size: 22px;
        font-weight: bold;
        letter-spacing: 0.05em;
        color: #000;
        background: #f0f0f0;
        border-left: 6px solid #000;
        padding: 5px 10px;
        margin: 5px 0 4px 0;
        line-height: 1.15;
    }
    .page-header-params { font-size: 9px; color: #555; margin-top: 2px; }
    .page-header-params .label { font-weight: bold; color: #333; }
    table { width: 100%; border-collapse: collapse; margin-top: 4px; }
    th { border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 3px 6px; text-align: left; font-size: 11px; font-weight: bold; background: #f5f5f5; }
    th:last-child { text-align: right; }
    td { padding: 2px 6px; font-size: 11px; border: none; vertical-align: middle; word-break: break-word; overflow-wrap: break-word; }
    td:last-child { text-align: right; }
    td:first-child { font-weight: 500; }
    tr:nth-child(even) { background: #fafafa; }
    @media print {
        .section-page { padding: 4mm 6mm; page-break-after: always; }
        .section-page:last-child { page-break-after: avoid; }
        @page { size: landscape; margin: 6mm; }
        tr { page-break-inside: avoid; }
    }
</style>
<script>window.onload = function() { window.print(); }</script>
</head><body>
${sectionPages.join("\n")}
</body></html>`;

            const printWindow = window.open("", "_blank");
            if (printWindow) {
                printWindow.document.write(html);
                printWindow.document.close();
            } else {
                toast({ title: "Popup bloqueado", description: "Permita popups no navegador para imprimir.", variant: "destructive" });
            }

            toast({
                title: "Relatório gerado!",
                description: `${sectionPages.length} seção(ões) — 1 página por seção.`,
            });
        } catch {
            toast({ title: "Erro ao gerar relatório", variant: "destructive", description: "Não foi possível gerar o relatório." });
        } finally {
            setIsGenerating(false);
        }
    };

    const togglePickupPoint = (id: number) => {
        setSelectedPickupPoints(prev =>
            prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
        );
        setSelectAllPickupPoints(false);
    };

    const toggleAllPickupPoints = (checked: boolean) => {
        setSelectAllPickupPoints(checked);
        if (checked) {
            setSelectedPickupPoints([]);
        }
    };

    const toggleOrder = (id: string) => {
        setSelectedOrders(prev =>
            prev.includes(id) ? prev.filter(o => o !== id) : [...prev, id]
        );
    };

    const toggleSelectAllOrders = (checked: boolean) => {
        if (checked) {
            setSelectedOrders(displayedOrders.map(o => o.id));
        } else {
            setSelectedOrders([]);
        }
    };

    const toggleSection = (section: string) => {
        setSelectedSections(prev =>
            prev.includes(section) ? prev.filter(s => s !== section) : [...prev, section]
        );
    };

    const handleCreateGroup = () => {
        if (!newGroupName || newGroupSections.length === 0) {
            toast({ title: "Preencha o nome e selecione ao menos uma seção", variant: "destructive" });
            return;
        }
        createGroupMutation.mutate({ name: newGroupName, sections: newGroupSections });
    };

    const handleEditGroup = (group: SectionGroup) => {
        setEditingGroup(group);
        setNewGroupName(group.name);
        setNewGroupSections(group.sections);
        setShowEditGroupDialog(true);
    };

    const handleUpdateGroup = () => {
        if (!editingGroup || !newGroupName || newGroupSections.length === 0) {
            toast({ title: "Preencha o nome e selecione ao menos uma seção", variant: "destructive" });
            return;
        }
        updateGroupMutation.mutate({ id: editingGroup.id, name: newGroupName, sections: newGroupSections });
    };

    const handleDeleteGroup = (group: SectionGroup) => {
        setGroupToDelete(group);
    };

    const handleSaveGroup = () => {
        if (showEditGroupDialog) {
            handleUpdateGroup();
        } else {
            handleCreateGroup();
        }
    };

    // Pickup points badge label
    const pickupPointsBadge = selectAllPickupPoints
        ? "Todos os pontos"
        : selectedPickupPoints.length === 0
            ? "0 pontos selecionados"
            : `${selectedPickupPoints.length} ponto${selectedPickupPoints.length > 1 ? 's' : ''} selecionado${selectedPickupPoints.length > 1 ? 's' : ''}`;

    return (
    <>
        <div className="min-h-screen bg-background">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-border bg-card shrink-0">
                <div className="flex items-center gap-3">
                    <Link href="/supervisor/reports">
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-base font-semibold text-foreground leading-tight">Romaneio de Separação</h1>
                        <p className="text-xs text-muted-foreground">Relatório de separação de pedidos</p>
                    </div>
                </div>
            </div>

            <div className="p-6 max-w-7xl mx-auto">
                {/* Stepper Header */}
                <div className="mb-8">
                    <div className="flex items-center justify-between relative">
                        <div className="absolute left-0 top-1/2 transform -translate-y-1/2 w-full h-0.5 bg-muted -z-10"></div>
                        <div
                            className="absolute left-0 top-1/2 transform -translate-y-1/2 h-0.5 bg-primary -z-10 transition-all duration-300"
                            style={{
                                width: currentStep === 'pickup-points' ? '0%' :
                                    currentStep === 'select-orders' ? '33%' :
                                        currentStep === 'sections' ? '66%' : '100%'
                            }}
                        ></div>

                        {[
                            { id: 'pickup-points', label: '1. Pontos', Icon: MapPin },
                            { id: 'select-orders', label: '2. Pedidos', Icon: Package },
                            { id: 'sections', label: '3. Seções', Icon: Layers },
                            { id: 'summary', label: '4. Gerar', Icon: FileDown }
                        ].map((step) => {
                            const steps = ['pickup-points', 'select-orders', 'sections', 'summary'];
                            const currentIndex = steps.indexOf(currentStep);
                            const stepIndex = steps.indexOf(step.id);
                            const isActive = stepIndex <= currentIndex;
                            const isCurrent = step.id === currentStep;
                            const StepIcon = step.Icon;

                            return (
                                <div key={step.id} className="flex flex-col items-center bg-background px-2">
                                    <div
                                        className={`
                                            w-10 h-10 rounded-full flex items-center justify-center border-2 
                                            transition-colors duration-300 z-10
                                            ${isActive ? 'bg-primary border-primary text-primary-foreground' : 'bg-background border-muted text-muted-foreground'}
                                            ${isCurrent ? 'ring-2 ring-offset-2 ring-primary' : ''}
                                        `}
                                    >
                                        <StepIcon className="h-4 w-4" />
                                    </div>
                                    <span className={`text-sm mt-2 font-medium ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
                                        {step.label}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Step Content: Pickup Points */}
                {currentStep === "pickup-points" && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Filtrar por Ponto de Retirada</CardTitle>
                            <CardDescription>Selecione um ou mais pontos para buscar pedidos</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div
                                className="flex items-center space-x-2 p-4 border rounded-lg bg-muted/20 cursor-pointer select-none"
                                onClick={() => toggleAllPickupPoints(!selectAllPickupPoints)}
                            >
                                <Checkbox
                                    checked={selectAllPickupPoints}
                                    onCheckedChange={toggleAllPickupPoints}
                                    onClick={(e) => e.stopPropagation()}
                                />
                                <span className="font-medium">Todos os Pontos</span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {pickupPoints.length === 0 && (
                                    <p className="text-muted-foreground text-sm col-span-2">Nenhum ponto de retirada encontrado</p>
                                )}
                                {pickupPoints.map((pp: any) => (
                                    <div
                                        key={pp.id}
                                        className={`flex items-center space-x-2 p-3 border rounded transition-colors select-none ${selectAllPickupPoints ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-muted/50'}`}
                                        onClick={() => !selectAllPickupPoints && togglePickupPoint(pp.id)}
                                    >
                                        <Checkbox
                                            checked={selectedPickupPoints.includes(pp.id)}
                                            onCheckedChange={() => togglePickupPoint(pp.id)}
                                            disabled={selectAllPickupPoints}
                                            onClick={(e) => e.stopPropagation()}
                                        />
                                        <span className="font-medium text-sm w-full py-1">{pp.name}</span>
                                    </div>
                                ))}
                            </div>

                            <div className="pt-2">
                                <Badge variant="secondary" className="px-3 py-1 text-sm">{pickupPointsBadge}</Badge>
                            </div>
                        </CardContent>
                        <div className="flex justify-between p-6 border-t bg-muted/10">
                            <Button variant="outline" onClick={handleCancelFlow}>Cancelar</Button>
                            <Button
                                onClick={handlePickupPointsNext}
                                disabled={(!selectAllPickupPoints && selectedPickupPoints.length === 0) || isFetchingValidOrders}
                            >
                                {isFetchingValidOrders ? (
                                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Carregando...</>
                                ) : (
                                    "Continuar →"
                                )}
                            </Button>
                        </div>
                    </Card>
                )}

                {/* Step Content: Select Orders */}
                {currentStep === "select-orders" && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Selecionar Pedidos</CardTitle>
                            <CardDescription>
                                {filteredOrders.length} pedidos encontrados | {pickupPointsBadge} | {selectedOrders.length} selecionados
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex flex-col md:flex-row gap-4">
                                <DatePickerWithRange
                                    date={tempDateRange}
                                    onDateChange={setTempDateRange}
                                    className="flex-1"
                                />
                                <Button
                                    onClick={() => {
                                        setFilterDateRange(tempDateRange);
                                        refetchOrders();
                                    }}
                                    variant="outline"
                                    disabled={isLoadingOrders}
                                >
                                    {isLoadingOrders ? (
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    ) : (
                                        <SearchIcon className="h-4 w-4 mr-2" />
                                    )}
                                    {isLoadingOrders ? "Carregando..." : "Atualizar"}
                                </Button>
                            </div>

                            <div className="relative">
                                <SearchIcon className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Filtrar (Pedido, Cliente) - separe por vírgula"
                                    value={orderSearchQuery}
                                    onChange={(e) => setOrderSearchQuery(e.target.value)}
                                    className="pl-8"
                                />
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-4 py-2">
                                <div className="flex items-center space-x-2">
                                    <Checkbox
                                        id="select-all-orders"
                                        checked={displayedOrders.length > 0 && selectedOrders.length === displayedOrders.length}
                                        onCheckedChange={toggleSelectAllOrders}
                                    />
                                    <Label htmlFor="select-all-orders" className="cursor-pointer">
                                        Selecionar todos visíveis ({displayedOrders.length})
                                    </Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <Checkbox
                                        id="show-selected"
                                        checked={showSelectedOrdersOnly}
                                        onCheckedChange={(checked) => setShowSelectedOrdersOnly(!!checked)}
                                    />
                                    <Label htmlFor="show-selected" className="cursor-pointer">Mostrar apenas Selecionados</Label>
                                </div>
                            </div>

                            <div className="border rounded-md overflow-hidden">
                                <div className="max-h-[500px] overflow-auto">
                                    <Table>
                                        <TableHeader className="bg-muted/50 sticky top-0 z-10">
                                            <TableRow>
                                                <TableHead className="w-12 text-center">
                                                    <Checkbox
                                                        checked={displayedOrders.length > 0 && selectedOrders.length === displayedOrders.length}
                                                        onCheckedChange={toggleSelectAllOrders}
                                                    />
                                                </TableHead>
                                                <TableHead>Pedido</TableHead>
                                                <TableHead>Cliente</TableHead>
                                                <TableHead className="w-16 text-center hidden sm:table-cell">Prod.</TableHead>
                                                <TableHead className="text-right hidden md:table-cell">Valor</TableHead>
                                                <TableHead className="text-center hidden md:table-cell">Status Fin.</TableHead>
                                                {user && ["administrador", "supervisor"].includes(user.role) && (
                                                    <TableHead className="text-center w-32">Ações</TableHead>
                                                )}
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {displayedOrders.length === 0 ? (
                                                <TableRow>
                                                    <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                                                        {isLoadingOrders
                                                            ? <div className="flex flex-col items-center gap-2"><Loader2 className="h-8 w-8 opacity-50 animate-spin" /><span>Carregando pedidos...</span></div>
                                                            : orders.length === 0
                                                                ? <div className="flex flex-col items-center gap-2"><SearchIcon className="h-8 w-8 opacity-50" /><span>Nenhum pedido no período selecionado</span></div>
                                                                : 'Nenhum pedido encontrado com os filtros atuais'
                                                        }
                                                    </TableCell>
                                                </TableRow>
                                            ) : (
                                                displayedOrders.map(order => (
                                                    <TableRow
                                                        key={order.id}
                                                        className={`cursor-pointer transition-colors ${selectedOrders.includes(order.id) ? 'bg-primary/5' : 'hover:bg-muted/50'}`}
                                                        onClick={() => toggleOrder(order.id)}
                                                    >
                                                        <TableCell onClick={(e) => e.stopPropagation()} className="text-center">
                                                            <Checkbox
                                                                checked={selectedOrders.includes(order.id)}
                                                                onCheckedChange={() => toggleOrder(order.id)}
                                                            />
                                                        </TableCell>
                                                        <TableCell className="font-mono font-medium text-primary">{order.erpOrderId}</TableCell>
                                                        <TableCell className="font-medium">{order.customerName}</TableCell>
                                                        <TableCell className="text-center hidden sm:table-cell">
                                                            <Badge variant="outline">
                                                                {!selectAllPickupPoints && selectedPickupPoints.length > 0 && filteredCounts[order.id] !== undefined 
                                                                    ? filteredCounts[order.id] || 0
                                                                    : order.itemCount || 0}
                                                            </Badge>
                                                        </TableCell>
                                                        <TableCell className="text-right font-medium hidden md:table-cell">
                                                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(order.totalValue || 0))}
                                                        </TableCell>
                                                        <TableCell className="text-center hidden md:table-cell">
                                                            <Badge variant={order.financialStatus === 'faturado' ? 'default' : 'secondary'} className={`shadow-none capitalize ${order.financialStatus === 'faturado' ? 'bg-green-600 hover:bg-green-700' : ''}`}>
                                                                {order.financialStatus === 'faturado' ? 'Liberado' : (order.financialStatus || 'Pendente')}
                                                            </Badge>
                                                        </TableCell>
                                                        {user && ["administrador", "supervisor"].includes(user.role) && (
                                                            <TableCell onClick={(e) => e.stopPropagation()} className="text-center">
                                                                {order.isLaunched ? (
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="sm"
                                                                        className="h-8 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                                                                        onClick={() => cancelLaunchMutation.mutate([order.id])}
                                                                        disabled={cancelLaunchMutation.isPending}
                                                                        title="Cancelar Lançamento"
                                                                    >
                                                                        <XCircle className="h-4 w-4" />
                                                                    </Button>
                                                                ) : (
                                                                    <span className="text-muted-foreground text-xs">-</span>
                                                                )}
                                                            </TableCell>
                                                        )}
                                                    </TableRow>
                                                ))
                                            )}
                                        </TableBody>
                                    </Table>
                                </div>
                            </div>
                        </CardContent>
                        <div className="flex justify-between p-6 border-t bg-muted/10">
                            <Button variant="outline" onClick={handleSelectOrdersBack}>← Voltar</Button>
                            <Button
                                onClick={handleSelectOrdersNext}
                                disabled={selectedOrders.length === 0}
                            >
                                Continuar ({selectedOrders.length}) →
                            </Button>
                        </div>
                    </Card>
                )}

                {/* Step Content: Sections/Groups */}
                {currentStep === "sections" && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Organizar Relatório</CardTitle>
                            <CardDescription>Como você deseja agrupar os itens no relatório?</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <RadioGroup value={sectionMode} onValueChange={(v) => setSectionMode(v as SectionMode)} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div
                                    className={`flex items-start space-x-3 border p-4 rounded-lg cursor-pointer transition-all ${sectionMode === 'individual' ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/50'}`}
                                    onClick={() => setSectionMode('individual')}
                                >
                                    <RadioGroupItem value="individual" id="mode-individual" className="mt-1" onClick={(e) => e.stopPropagation()} />
                                    <div className="grid gap-1.5">
                                        <Label htmlFor="mode-individual" className="font-semibold text-base cursor-pointer">
                                            Por Seção Individual
                                        </Label>
                                        <p className="text-sm text-muted-foreground">
                                            Gera uma quebra de página para cada seção selecionada (ex: Tubos, Conexões).
                                        </p>
                                    </div>
                                </div>
                                <div
                                    className={`flex items-start space-x-3 border p-4 rounded-lg cursor-pointer transition-all ${sectionMode === 'group' ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/50'}`}
                                    onClick={() => setSectionMode('group')}
                                >
                                    <RadioGroupItem value="group" id="mode-group" className="mt-1" onClick={(e) => e.stopPropagation()} />
                                    <div className="grid gap-1.5">
                                        <Label htmlFor="mode-group" className="font-semibold text-base cursor-pointer">
                                            Por Grupo de Seções
                                        </Label>
                                        <p className="text-sm text-muted-foreground">
                                            Agrupa várias seções em uma única lista (ex: "Hidráulica" contendo tubos e conexões).
                                        </p>
                                    </div>
                                </div>
                            </RadioGroup>

                            {sectionMode === "individual" && (
                                <div className="space-y-4 border-t pt-6 animate-in fade-in slide-in-from-top-4 duration-300">
                                    <div className="flex items-center justify-between">
                                        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Seções Disponíveis</h4>
                                        <Badge variant="secondary">{selectedSections.length} selecionadas</Badge>
                                    </div>
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                        {sections.map((section: any) => (
                                            <div key={section.id} className="flex items-center space-x-2 p-3 rounded border bg-card hover:bg-accent transition-colors cursor-pointer" onClick={() => toggleSection(String(section.id))}>
                                                <Checkbox
                                                    id={`section-${section.id}`}
                                                    checked={selectedSections.includes(String(section.id))}
                                                    onCheckedChange={() => toggleSection(String(section.id))}
                                                    className="pointer-events-none"
                                                />
                                                <Label htmlFor={`section-${section.id}`} className="cursor-pointer flex-1 text-sm line-clamp-1 py-1" title={section.name}>
                                                    <span className="font-mono text-muted-foreground mr-2">{section.id}</span>
                                                    {section.name}
                                                </Label>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {sectionMode === "group" && (
                                <div className="space-y-4 border-t pt-6 animate-in fade-in slide-in-from-top-4 duration-300">
                                    {/* Create/Edit Group Inline Form */}
                                    {(showCreateGroupDialog || showEditGroupDialog) ? (
                                        <div className="border-2 border-dashed border-primary/20 rounded-xl p-6 bg-muted/30 space-y-5">
                                            <div className="flex items-center justify-between">
                                                <h3 className="text-lg font-semibold text-primary">
                                                    {showEditGroupDialog ? "✏️ Editar Grupo" : "✨ Novo Grupo"}
                                                </h3>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => {
                                                        setShowCreateGroupDialog(false);
                                                        setShowEditGroupDialog(false);
                                                        setEditingGroup(null);
                                                        setNewGroupName("");
                                                        setNewGroupSections([]);
                                                    }}
                                                >
                                                    Cancelar
                                                </Button>
                                            </div>

                                            <div className="grid gap-4">
                                                <div className="grid gap-2">
                                                    <Label htmlFor="inline-group-name">Nome do Grupo</Label>
                                                    <Input
                                                        id="inline-group-name"
                                                        value={newGroupName}
                                                        onChange={(e) => setNewGroupName(e.target.value)}
                                                        placeholder="Ex: Kit Banheiro Completo"
                                                        className="bg-background"
                                                    />
                                                </div>

                                                <div className="grid gap-2">
                                                    <Label>Selecione as Seções do Grupo</Label>
                                                    <div className="border rounded-md bg-background max-h-[250px] overflow-auto p-4 grid grid-cols-2 gap-3">
                                                        {sections.map(section => (
                                                            <div key={section.id} className="flex items-center space-x-3 p-3 border rounded-md hover:bg-accent transition-colors cursor-pointer" onClick={() => {
                                                                setNewGroupSections(prev =>
                                                                    prev.includes(String(section.id))
                                                                        ? prev.filter(s => s !== String(section.id))
                                                                        : [...prev, String(section.id)]
                                                                );
                                                            }}>
                                                                <Checkbox
                                                                    id={`inline-section-${section.id}`}
                                                                    checked={newGroupSections.includes(String(section.id))}
                                                                    onCheckedChange={() => {
                                                                        // Handled by parent div click
                                                                    }}
                                                                    className="pointer-events-none" // Pass click to parent
                                                                />
                                                                <Label htmlFor={`inline-section-${section.id}`} className="text-sm cursor-pointer flex-1 py-1">
                                                                    <span className="font-mono font-bold mr-1">{section.id}</span>
                                                                    {section.name}
                                                                </Label>
                                                            </div>
                                                        ))}
                                                    </div>
                                                    <p className="text-xs text-muted-foreground text-right">
                                                        {newGroupSections.length} seções selecionadas
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="flex justify-end gap-3 pt-2">
                                                <Button
                                                    onClick={handleSaveGroup}
                                                    className="w-full md:w-auto min-w-[150px]"
                                                >
                                                    <Save className="h-4 w-4 mr-2" />
                                                    Salvar Grupo
                                                </Button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            <Button
                                                variant="outline"
                                                className="w-full border-dashed h-12 text-muted-foreground hover:text-primary hover:border-primary transition-colors"
                                                onClick={() => {
                                                    setNewGroupName("");
                                                    setNewGroupSections([]);
                                                    setShowCreateGroupDialog(true);
                                                }}
                                            >
                                                <Plus className="h-4 w-4 mr-2" />
                                                Criar Novo Grupo Personalizado
                                            </Button>

                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                {groups.length === 0 ? (
                                                    <div className="col-span-full py-12 text-center text-muted-foreground border rounded-lg bg-muted/10">
                                                        <p>Nenhum grupo de seções encontrado.</p>
                                                        <p className="text-sm">Crie um grupo para facilitar a geração de relatórios recorrentes.</p>
                                                    </div>
                                                ) : (
                                                    groups.map(group => (
                                                        <div
                                                            key={group.id}
                                                            className={`
                                                                relative border rounded-xl p-4 cursor-pointer transition-all duration-200
                                                                ${selectedGroupIds.includes(group.id)
                                                                    ? 'bg-primary/5 border-primary ring-1 ring-primary shadow-sm'
                                                                    : 'hover:bg-muted/50 hover:border-muted-foreground/50'}
                                                            `}
                                                            onClick={() => setSelectedGroupIds(prev => prev.includes(group.id) ? prev.filter(id => id !== group.id) : [...prev, group.id])}
                                                        >
                                                            <div className="flex items-start justify-between mb-2">
                                                                <div className="flex items-center gap-2">
                                                                    <div className={`
                                                                        w-4 h-4 rounded border flex items-center justify-center
                                                                        ${selectedGroupIds.includes(group.id) ? 'border-primary bg-primary' : 'border-muted-foreground'}
                                                                    `}>
                                                                        {selectedGroupIds.includes(group.id) && <div className="text-white text-[10px] font-bold">&#10003;</div>}
                                                                    </div>
                                                                    <h4 className="font-semibold text-foreground line-clamp-1" title={group.name}>{group.name}</h4>
                                                                </div>
                                                                <div className="flex gap-1 -mr-2 -mt-2">
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        className="h-8 w-8 hover:text-primary"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            handleEditGroup(group);
                                                                        }}
                                                                    >
                                                                        <Pencil className="h-3.5 w-3.5" />
                                                                    </Button>
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        className="h-8 w-8 hover:text-destructive"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            handleDeleteGroup(group);
                                                                        }}
                                                                    >
                                                                        <Trash2 className="h-3.5 w-3.5" />
                                                                    </Button>
                                                                </div>
                                                            </div>

                                                            <div className="pl-6">
                                                                <p className="text-xs text-muted-foreground mb-2">{group.sections.length} seções incluídas</p>
                                                                <div className="flex flex-wrap gap-1">
                                                                    {group.sections.slice(0, 3).map(s => (
                                                                        <Badge key={s} variant="secondary" className="px-1.5 py-0 text-[10px] font-normal text-muted-foreground bg-muted/50 border-0">
                                                                            {s}
                                                                        </Badge>
                                                                    ))}
                                                                    {group.sections.length > 3 && (
                                                                        <span className="text-[10px] text-muted-foreground px-1 self-center">+{group.sections.length - 3}</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </CardContent>
                        <div className="flex justify-between p-6 border-t bg-muted/10">
                            <Button variant="outline" onClick={handleSectionsBack}>← Voltar</Button>
                            <Button
                                onClick={handleSectionsNext}
                                disabled={
                                    (sectionMode === "individual" && selectedSections.length === 0) ||
                                    (sectionMode === "group" && selectedGroupIds.length === 0) ||
                                    showCreateGroupDialog || showEditGroupDialog
                                }
                            >
                                Continuar →
                            </Button>
                        </div>
                    </Card>
                )}

                {/* Step Content: Summary */}
                {currentStep === "summary" && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Resumo e Geração</CardTitle>
                            <CardDescription>Confira os dados antes de gerar o PDF final</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="space-y-2">
                                    <h4 className="font-medium text-sm text-muted-foreground uppercase">Pontos de Retirada</h4>
                                    <div className="p-4 bg-muted/30 rounded-lg border">
                                        {selectAllPickupPoints ? (
                                            <div className="flex items-center gap-2">
                                                <Badge>Todos</Badge>
                                                <span className="text-sm">Todos os pontos selecionados</span>
                                            </div>
                                        ) : (
                                            <div className="flex flex-col gap-2">
                                                {selectedPickupPoints.map(pointId => {
                                                    const pp = pickupPoints.find((p: any) => p.id === pointId);
                                                    return (
                                                        <div key={pointId} className="flex items-center gap-2">
                                                            <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
                                                            <span className="text-sm font-medium">{pp?.name || `Ponto ${pointId}`}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <h4 className="font-medium text-sm text-muted-foreground uppercase">Pedidos Selecionados</h4>
                                    <div className="p-4 bg-muted/30 rounded-lg border">
                                        <div className="flex items-baseline gap-2 mb-2">
                                            <span className="text-3xl font-bold">{selectedOrders.length}</span>
                                            <span className="text-sm text-muted-foreground">pedidos</span>
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            Clique em voltar para ver a lista detalhada.
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <h4 className="font-medium text-sm text-muted-foreground uppercase">Organização</h4>
                                    <div className="p-4 bg-muted/30 rounded-lg border h-full">
                                        {sectionMode === "individual" ? (
                                            <div>
                                                <div className="flex items-center gap-2 mb-2">
                                                    <Badge variant="outline" className="bg-background">Seção Individual</Badge>
                                                </div>
                                                <p className="text-sm font-medium">{selectedSections.length} seções selecionadas</p>
                                            </div>
                                        ) : (
                                            <div>
                                                <div className="flex items-center gap-2 mb-2">
                                                    <Badge variant="outline" className="bg-background">Agrupado</Badge>
                                                </div>
                                                <p className="text-sm font-medium">
                                                    {selectedGroupIds.map(gid => groups.find(g => g.id === gid)?.name).filter(Boolean).join(", ")}
                                                </p>
                                                <p className="text-xs text-muted-foreground mt-1">
                                                    {[...new Set(selectedGroupIds.flatMap(gid => groups.find(g => g.id === gid)?.sections || []))].length} seções incluídas
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-3 p-3 bg-muted/40 border border-border rounded-lg text-muted-foreground text-sm">
                                <CheckSquare className="h-4 w-4 shrink-0 text-primary" />
                                <p>Verifique os dados acima e clique em <strong className="text-foreground">Gerar PDF</strong> para abrir o relatório em nova aba e imprimir.</p>
                            </div>
                        </CardContent>
                        <div className="flex justify-between p-6 border-t bg-muted/10">
                            <Button variant="outline" onClick={handleSummaryBack}>← Voltar</Button>
                            <div className="flex gap-3">
                                {sectionMode === "group" && (
                                    <Button
                                        onClick={handleGeneratePDFBySections}
                                        disabled={isGenerating}
                                        variant="outline"
                                        size="lg"
                                        className="min-w-[200px]"
                                    >
                                        {isGenerating ? (
                                            <>
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                Gerando...
                                            </>
                                        ) : (
                                            <>
                                                <Printer className="mr-2 h-5 w-5" />
                                                Imprimir por Seção
                                            </>
                                        )}
                                    </Button>
                                )}
                                <Button
                                    onClick={handleGeneratePDF}
                                    disabled={isGenerating}
                                    className="min-w-[200px]"
                                    size="lg"
                                >
                                    {isGenerating ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            Gerando Relatório...
                                        </>
                                    ) : (
                                        <>
                                            <FileDown className="mr-2 h-5 w-5" />
                                            Gerar PDF Agora
                                        </>
                                    )}
                                </Button>
                            </div>
                        </div>
                    </Card>
                )}
            </div>
        </div>

        <AlertDialog open={!!groupToDelete} onOpenChange={open => !open && setGroupToDelete(null)}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Excluir grupo de seções</AlertDialogTitle>
                    <AlertDialogDescription>
                        Tem certeza que deseja excluir o grupo <strong>{groupToDelete?.name}</strong>? Esta ação não pode ser desfeita.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                        className="bg-red-600 hover:bg-red-700 text-white"
                        onClick={() => {
                            if (groupToDelete) {
                                deleteGroupMutation.mutate(groupToDelete.id);
                                setGroupToDelete(null);
                            }
                        }}
                    >
                        Excluir
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    </>
    );
}
