import { Button } from "@/components/ui/button";
import { FileText, Package, ArrowLeft, PackageOpen, ClipboardList, MapPin, ArrowRightLeft, AlertTriangle, ChevronRight } from "lucide-react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/lib/auth";

interface ReportItem {
    id: string;
    label: string;
    description: string;
    icon: React.ElementType;
    route: string;
    adminOnly?: boolean;
}

const REPORTS: ReportItem[] = [
    {
        id: "picking-list",
        label: "Romaneio de Separação",
        description: "Romaneios por ponto de retirada e local de estoque",
        icon: Package,
        route: "/supervisor/reports/picking-list",
    },
    {
        id: "badge-generation",
        label: "Cartões de Acesso",
        description: "Cartões com código de barras para autorização de exceções",
        icon: FileText,
        route: "/supervisor/reports/badge-generation",
        adminOnly: true,
    },
    {
        id: "loading-map",
        label: "Mapa de Carregamento",
        description: "Produtos carregados por pacote/carga",
        icon: Package,
        route: "/supervisor/reports/loading-map",
    },
    {
        id: "loading-map-products",
        label: "Mapa de Carregamento (Produto)",
        description: "Listagem consolidada por produto a carregar do pacote/carga",
        icon: Package,
        route: "/supervisor/reports/loading-map-products",
    },
    {
        id: "order-volumes",
        label: "Etiquetas de Volume",
        description: "Etiquetas de volume geradas na conferência",
        icon: PackageOpen,
        route: "/supervisor/reports/order-volumes",
    },
    {
        id: "counting-cycles",
        label: "Ciclos de Contagem",
        description: "Ciclos de contagem com divergências e status de aprovação",
        icon: ClipboardList,
        route: "/supervisor/reports/counting-cycles",
    },
    {
        id: "wms-addresses",
        label: "Endereços WMS",
        description: "Ocupação, tipos e status dos endereços do armazém",
        icon: MapPin,
        route: "/supervisor/reports/wms-addresses",
    },
    {
        id: "pallet-movements",
        label: "Movimentações de Pallets",
        description: "Histórico de recebimento, alocação, transferência e cancelamento",
        icon: ArrowRightLeft,
        route: "/supervisor/reports/pallet-movements",
    },
    {
        id: "stock-discrepancy",
        label: "Divergências de Estoque",
        description: "Diferença entre estoque real (ERP) e estoque paletizado no WMS",
        icon: AlertTriangle,
        route: "/supervisor/reports/stock-discrepancy",
    },
];

export default function Reports() {
    const [, setLocation] = useLocation();
    const { user } = useAuth();
    const isAdmin = user?.role === "administrador";
    const allowedReports: string[] | null = user?.allowedReports ?? null;
    const canSeeReport = (id: string) => !allowedReports || allowedReports.length === 0 || allowedReports.includes(id);

    const visibleReports = REPORTS.filter(r => {
        if (r.adminOnly && !isAdmin) return false;
        return canSeeReport(r.id);
    });

    return (
        <div className="min-h-screen bg-background">
            <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border bg-card shrink-0">
                <Link href="/">
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                </Link>
                <div>
                    <h1 className="text-base font-semibold text-foreground leading-tight">Relatórios</h1>
                    <p className="text-xs text-muted-foreground">Selecione um relatório para gerar</p>
                </div>
            </div>

            <div className="p-6 max-w-3xl mx-auto">
                <div className="flex flex-col gap-2">
                    {visibleReports.map((report) => {
                        const Icon = report.icon;
                        return (
                            <button
                                key={report.id}
                                data-testid={`button-report-${report.id}`}
                                onClick={() => setLocation(report.route)}
                                className="flex items-center gap-4 w-full text-left px-4 py-3.5 rounded-lg border border-border bg-card hover:bg-muted/50 transition-colors group"
                            >
                                <div className="flex-shrink-0 w-9 h-9 rounded-md bg-muted flex items-center justify-center">
                                    <Icon className="h-4 w-4 text-muted-foreground" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-foreground">{report.label}</p>
                                    <p className="text-xs text-muted-foreground truncate">{report.description}</p>
                                </div>
                                <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors flex-shrink-0" />
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
