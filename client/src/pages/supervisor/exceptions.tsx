import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth, useSessionQueryKey } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import { DateRange } from "react-day-picker";
import { Link } from "wouter";
import { ArrowLeft, AlertTriangle, FileWarning, Search, Printer, Trash2, Package } from "lucide-react";
import { SortableTableHead, SortState, sortData, toggleSort } from "@/components/ui/sortable-table-head";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { apiRequest } from "@/lib/queryClient";
import type { Exception, OrderItem, Product, User, WorkUnit, Order } from "@shared/schema";

type ExceptionWithDetails = Exception & {
  orderItem: OrderItem & {
    product: Product;
    order: Order;
  };
  reportedByUser: User;
  workUnit: WorkUnit;
};

const exceptionTypeLabels: Record<string, { label: string; color: string }> = {
  nao_encontrado: { label: "Não Encontrado", color: "bg-yellow-100 text-yellow-700" },
  avariado: { label: "Avariado", color: "bg-red-100 text-red-700" },
  vencido: { label: "Vencido", color: "bg-orange-100 text-orange-700" },
};

export default function ExceptionsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === "administrador";
  const exceptionsQueryKey = useSessionQueryKey(["/api/exceptions"]);

  const [filterDateRange, setFilterDateRange] = useState<DateRange | undefined>();
  const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>();
  const [searchOrderQuery, setSearchOrderQuery] = useState("");
  const [searchLoadCode, setSearchLoadCode] = useState("");
  const [selectedExceptionType, setSelectedExceptionType] = useState<string>("all");
  const [sort, setSort] = useState<SortState | null>({ key: "createdAt", direction: "desc" });
  const handleSort = (key: string) => setSort(prev => toggleSort(prev, key));

  const { data: exceptions, isLoading } = useQuery<ExceptionWithDetails[]>({
    queryKey: exceptionsQueryKey,
  });

  // Lógica de filtro
  const processMultipleOrderSearch = (searchValue: string, orderCode: string): boolean => {
    if (!searchValue.trim()) return true;
    if (searchValue.includes(',')) {
      const terms = searchValue.split(',').map(t => t.trim().toLowerCase()).filter(t => t);
      return terms.some(term => orderCode.toLowerCase().includes(term));
    }
    return orderCode.toLowerCase().includes(searchValue.toLowerCase());
  };

  const trimmedLoadCode = searchLoadCode.trim();

  const filteredExceptions = exceptions?.filter((exception) => {
    // Filtro de Pacote/Carga — quando ativo, ignora data
    if (trimmedLoadCode) {
      const orderLoadCode = (exception.orderItem?.order as any)?.loadCode || "";
      if (!orderLoadCode.toString().toLowerCase().includes(trimmedLoadCode.toLowerCase())) return false;
    } else {
      // Filtro de Data (ignorado quando buscando por Pacote/Carga)
      if (filterDateRange?.from) {
        const exceptionDate = new Date(exception.createdAt);
        if (exceptionDate < filterDateRange.from) return false;
        if (filterDateRange.to) {
          const endOfDay = new Date(filterDateRange.to);
          endOfDay.setHours(23, 59, 59, 999);
          if (exceptionDate > endOfDay) return false;
        }
      }
    }

    // Filtro de Pedido (Múltiplos pedidos com vírgula)
    if (searchOrderQuery) {
      const orderMatch = processMultipleOrderSearch(searchOrderQuery, exception.orderItem?.order?.erpOrderId || '');
      if (!orderMatch) return false;
    }

    // Filtro de Motivo/Tipo
    if (selectedExceptionType !== "all") {
      if (exception.type !== selectedExceptionType) return false;
    }

    return true;
  }) || [];

  const sortedExceptions = useMemo(() => sortData(filteredExceptions, sort, (ex, key) => {
    switch (key) {
      case "erpOrderId": return (ex.orderItem?.order as any)?.erpOrderId ?? "";
      case "loadCode": return (ex.orderItem?.order as any)?.loadCode ?? "";
      case "createdAt": return new Date(ex.createdAt).getTime();
      case "barcode": return ex.orderItem?.product?.barcode ?? "";
      case "productName": return ex.orderItem?.product?.name ?? "";
      case "quantity": return ex.quantity ?? 0;
      case "type": return ex.type ?? "";
      case "reportedBy": return ex.reportedByUser?.name ?? "";
      case "authorizedBy": return ex.authorizedByName ?? "";
      default: return null;
    }
  }), [filteredExceptions, sort]);

  const handlePrint = async () => {
    try {
      await apiRequest("POST", "/api/audit-logs", {
        action: "print_report",
        entityType: "exceptions_report",
        details: `Imprimiu relatório de exceções com filtros aplicados.`,
      });
    } catch {
      // Falha no log de auditoria não interrompe a impressão
    }

    const now = format(new Date(), "dd/MM/yyyy HH:mm", { locale: ptBR });
    // Sort filtered results
    const sortedExceptions = sortData(filteredExceptions ?? [], sort, (ex, key) => {
      switch (key) {
        case "erpOrderId": return (ex.orderItem?.order as any)?.erpOrderId ?? "";
        case "loadCode": return (ex.orderItem?.order as any)?.loadCode ?? "";
        case "createdAt": return new Date(ex.createdAt).getTime();
        case "barcode": return ex.orderItem?.product?.barcode ?? "";
        case "productName": return ex.orderItem?.product?.name ?? "";
        case "quantity": return ex.quantity ?? 0;
        case "type": return ex.type ?? "";
        case "reportedBy": return ex.reportedByUser?.name ?? "";
        case "authorizedBy": return ex.authorizedByName ?? "";
        default: return null;
      }
    });

    const toprint = sortedExceptions;

    let bodyHtml = "";
    for (const exc of toprint) {
      const typeInfo = exceptionTypeLabels[exc.type] ?? { label: exc.type, color: "" };
      const date = exc.createdAt ? format(new Date(exc.createdAt), "dd/MM HH:mm") : "-";
      const authDate = exc.authorizedAt ? format(new Date(exc.authorizedAt), "dd/MM HH:mm") : "-";
      const erpOrderId = exc.orderItem?.order?.erpOrderId || "-";
      const loadCode = (exc.orderItem?.order as any)?.loadCode || "-";
      const productName = exc.orderItem?.product?.name || "-";
      const productCode = exc.orderItem?.product?.erpCode || "-";
      const operator = exc.reportedByUser?.name || "-";
      const authorizedBy = exc.authorizedByName || (exc.authorizedBy ? "Sim" : "Aguardando");
      const obs = exc.observation || "-";

      bodyHtml += `<tr>
        <td class="mono bold">${erpOrderId}</td>
        <td class="mono">${loadCode !== "-" ? `<strong>${loadCode}</strong>` : "-"}</td>
        <td class="mono">${productCode}</td>
        <td>${productName}</td>
        <td class="center">${exc.quantity}</td>
        <td class="center"><strong>${typeInfo.label}</strong></td>
        <td>${obs}</td>
        <td>${operator}</td>
        <td>${authorizedBy}</td>
        <td class="center nowrap">${date}</td>
        <td class="center nowrap">${authDate}</td>
      </tr>`;
    }

    const filtersLine = [
      trimmedLoadCode && `Pacote/Carga: ${trimmedLoadCode}`,
      !trimmedLoadCode && filterDateRange?.from && `Período: ${format(filterDateRange.from, "dd/MM/yyyy")} a ${filterDateRange.to ? format(filterDateRange.to, "dd/MM/yyyy") : format(new Date(), "dd/MM/yyyy")}`,
      searchOrderQuery && `Busca: ${searchOrderQuery}`,
      selectedExceptionType !== "all" && `Tipo: ${exceptionTypeLabels[selectedExceptionType]?.label || selectedExceptionType}`,
    ].filter(Boolean).join(" | ");

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Relatório de Exceções</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; margin: 10px 15px; font-size: 9px; color: #000; }
.header { margin-bottom: 6px; }
.header h1 { font-size: 14px; font-weight: bold; }
.header .meta { font-size: 8px; color: #555; margin-top: 2px; }
.filters { font-size: 8px; color: #333; background: #fff8e8; padding: 3px 6px; border-radius: 2px; margin: 4px 0 6px; border-left: 3px solid #f59e0b; }
table { width: 100%; border-collapse: collapse; }
th { background: #fff3cd; border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 3px 4px; font-size: 9px; font-weight: bold; }
td { padding: 2px 4px; font-size: 9px; border-bottom: 1px solid #eee; vertical-align: top; }
td.mono { font-family: monospace; }
td.bold { font-weight: bold; }
td.center { text-align: center; }
td.nowrap { white-space: nowrap; }
@media print { body { margin: 5mm 6mm; } @page { size: landscape; margin: 5mm; } tr { page-break-inside: avoid; } }
</style>
<script>window.onload = function() { window.print(); }</script>
</head><body>
<div class="header">
  <h1>⚠ Relatório de Exceções</h1>
  <div class="meta">Gerado em: ${now} &nbsp;|&nbsp; Total: ${toprint.length} exceções</div>
</div>
<div class="filters"><strong>Filtros:</strong> ${filtersLine || "Nenhum filtro ativo"}</div>
<table>
  <thead><tr>
    <th>Nº Pedido</th><th>Pacote/Carga</th><th>Cód.</th><th>Produto</th>
    <th style="text-align:center">Qtd</th><th style="text-align:center">Motivo</th>
    <th>Observação</th><th>Operador</th><th>Autorizado Por</th>
    <th style="text-align:center">Data Exc.</th><th style="text-align:center">Data Aut.</th>
  </tr></thead>
  <tbody>${bodyHtml}</tbody>
</table>
</body></html>`;

    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  return (
    <div className="min-h-screen bg-background print:bg-white">
      <div className="print:hidden">
        <div className="flex items-center justify-between gap-3 px-3 py-2.5 border-b border-border bg-card shrink-0">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-back">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-base font-semibold text-foreground leading-tight">Exceções</h1>
              <p className="text-xs text-muted-foreground">Itens com problemas reportados</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            className="hidden sm:inline-flex"
          >
            <Printer className="h-4 w-4 mr-2" />
            Imprimir
          </Button>
        </div>
      </div>

      <main className="max-w-[1600px] mx-auto px-4 py-6 space-y-4 print:py-0 print:px-0">

        {/* Printable Header - Only visible when printing */}
        <div className="hidden print:block mb-4 pt-4">
          <h1 className="text-2xl font-bold">Relatório de Exceções</h1>
          <p className="text-sm text-gray-500">Impresso em: {format(new Date(), "dd/MM/yyyy HH:mm", { locale: ptBR })}</p>
          {(filterDateRange?.from || searchOrderQuery || selectedExceptionType !== 'all' || trimmedLoadCode) && (
            <div className="text-xs text-gray-500 mt-1">Filtros aplicados. Total: {filteredExceptions.length} registro(s)</div>
          )}
        </div>

        {/* Filtros */}
        <div className="bg-card p-4 rounded-lg border shadow-sm space-y-3 print:hidden">
          {/* Linha 1: Pacote/Carga + Pedido */}
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Filtro de Pacote/Carga */}
            <div className="relative sm:w-56">
              <Package className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Pacote/Carga"
                value={searchLoadCode}
                onChange={(e) => setSearchLoadCode(e.target.value)}
                className="pl-9"
                data-testid="input-load-code-exceptions"
              />
            </div>

            {/* Filtro de Pedido */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar Pedido (separe múltiplos por vírgula)"
                value={searchOrderQuery}
                onChange={(e) => setSearchOrderQuery(e.target.value)}
                className="pl-9"
                data-testid="input-search-order-exceptions"
              />
            </div>

            {/* Filtro de Motivo */}
            <Select value={selectedExceptionType} onValueChange={setSelectedExceptionType}>
              <SelectTrigger className="w-full sm:w-[180px]" data-testid="select-exception-type">
                <SelectValue placeholder="Motivo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os Motivos</SelectItem>
                <SelectItem value="nao_encontrado">Não Encontrado</SelectItem>
                <SelectItem value="avariado">Avariado</SelectItem>
                <SelectItem value="vencido">Vencido</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Linha 2: Data (desabilitada quando Pacote/Carga está preenchido) */}
          <div className={`flex flex-wrap items-center gap-2 transition-opacity ${trimmedLoadCode ? "opacity-40 pointer-events-none" : ""}`}>
            <div className="flex-1 min-w-0">
              <DatePickerWithRange date={tempDateRange} onDateChange={setTempDateRange} className="w-full" />
            </div>
            <Button variant="secondary" className="shrink-0" onClick={() => setFilterDateRange(tempDateRange)}>
              Buscar
            </Button>
            {trimmedLoadCode && (
              <span className="text-xs text-muted-foreground italic">
                Filtro de data ignorado ao buscar por Pacote/Carga
              </span>
            )}
          </div>
        </div>

        <SectionCard
          title={`Exceções Pendentes (${filteredExceptions.length})`}
          icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
        >
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredExceptions && filteredExceptions.length > 0 ? (
            <div className="overflow-x-auto -mx-6 print:overflow-visible print:mx-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTableHead label="Pedido" sortKey="erpOrderId" sort={sort} onSort={handleSort} />
                    <SortableTableHead label="Pacote" sortKey="loadCode" sort={sort} onSort={handleSort} className="hidden sm:table-cell" />
                    <SortableTableHead label="Data/Hora" sortKey="createdAt" sort={sort} onSort={handleSort} className="hidden lg:table-cell" />
                    <SortableTableHead label="Código" sortKey="barcode" sort={sort} onSort={handleSort} className="hidden md:table-cell" />
                    <SortableTableHead label="Descrição" sortKey="productName" sort={sort} onSort={handleSort} className="hidden lg:table-cell" />
                    <SortableTableHead label="Qtd" sortKey="quantity" sort={sort} onSort={handleSort} />
                    <SortableTableHead label="Motivo" sortKey="type" sort={sort} onSort={handleSort} />
                    <SortableTableHead label="Reportado" sortKey="reportedBy" sort={sort} onSort={handleSort} className="hidden md:table-cell" />
                    <TableHead className="hidden xl:table-cell">Observação</TableHead>
                    <SortableTableHead label="Autorizado" sortKey="authorizedBy" sort={sort} onSort={handleSort} className="hidden md:table-cell" />
                    {isAdmin && <TableHead className="w-[60px]"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedExceptions.map((exception) => {
                    const typeConfig = exceptionTypeLabels[exception.type] || {
                      label: exception.type,
                      color: "bg-gray-100 text-gray-700",
                    };
                    const loadCode = (exception.orderItem?.order as any)?.loadCode;
                    return (
                      <TableRow key={exception.id} data-testid={`row-exception-${exception.id}`}>
                        <TableCell className="font-mono font-medium">
                          <div className="flex flex-col">
                            <span>{exception.orderItem?.order?.erpOrderId || "-"}</span>
                            <span className="text-[10px] text-muted-foreground font-normal lg:hidden">
                              {format(new Date(exception.createdAt), "dd/MM HH:mm", { locale: ptBR })}
                            </span>
                          </div>
                        </TableCell>

                        <TableCell className="hidden sm:table-cell">
                          {loadCode ? (
                            <span className="font-mono text-xs font-bold bg-purple-50 text-purple-700 dark:bg-purple-950/30 dark:text-purple-300 px-2 py-0.5 rounded">
                              {loadCode}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">-</span>
                          )}
                        </TableCell>

                        <TableCell className="text-sm whitespace-nowrap hidden lg:table-cell">
                          {format(new Date(exception.createdAt), "dd/MM/yyyy HH:mm", {
                            locale: ptBR,
                          })}
                        </TableCell>

                        <TableCell className="font-mono text-xs hidden md:table-cell">
                          {exception.orderItem?.product?.barcode || "-"}
                        </TableCell>

                        <TableCell className="max-w-[250px] hidden lg:table-cell">
                          <p className="font-medium truncate" title={exception.orderItem?.product?.name || "-"}>
                            {exception.orderItem?.product?.name || "-"}
                          </p>
                        </TableCell>

                        <TableCell className="font-medium">
                          {Number(exception.quantity)} {exception.orderItem?.product?.unit || "UN"}
                        </TableCell>

                        <TableCell>
                          <Badge variant="outline" className={`${typeConfig.color} border-0`}>
                            {typeConfig.label}
                          </Badge>
                        </TableCell>

                        <TableCell className="hidden md:table-cell">{exception.reportedByUser?.name || "-"}</TableCell>

                        <TableCell className="max-w-[200px] hidden xl:table-cell">
                          <p className="text-sm text-muted-foreground truncate">
                            {exception.observation || "-"}
                          </p>
                        </TableCell>

                        <TableCell className="hidden md:table-cell">
                          {exception.authorizedByName ? (
                            <div className="flex items-center gap-1 text-sm">
                              <span className="text-green-600">✓</span>
                              <span>{exception.authorizedByName}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">Pendente</span>
                          )}
                        </TableCell>

                        {/* Delete — Admin only */}
                        {isAdmin && (
                          <TableCell>
                            <DeleteExceptionButton
                              exceptionId={exception.id}
                              productName={exception.orderItem?.product?.name || "item"}
                              onDeleted={() => queryClient.invalidateQueries({ queryKey: exceptionsQueryKey })}
                            />
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <FileWarning className="h-16 w-16 mx-auto mb-4 opacity-40" />
              <p className="text-lg font-medium">Nenhuma exceção registrada</p>
              <p className="text-sm">
                {exceptions && exceptions.length > 0
                  ? "Nenhuma exceção encontrada com os filtros aplicados"
                  : "Todas as operações estão normais"}
              </p>
            </div>
          )}
        </SectionCard>
      </main>
    </div>
  );
}

function DeleteExceptionButton({
  exceptionId,
  productName,
  onDeleted,
}: {
  exceptionId: string;
  productName: string;
  onDeleted: () => void;
}) {
  const { toast } = useToast();
  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/exceptions/${exceptionId}`),
    onSuccess: () => {
      toast({ title: "Exceção removida", description: `A exceção de "${productName}" foi apagada e o item foi resetado.` });
      onDeleted();
    },
    onError: () => {
      toast({ title: "Erro ao apagar", description: "Não foi possível remover a exceção.", variant: "destructive" });
    },
  });

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10">
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Apagar Exceção?</AlertDialogTitle>
          <AlertDialogDescription>
            A exceção de <strong>"{productName}"</strong> será removida e o item retornará ao status pendente para recoleta.
            Esta ação não pode ser desfeita.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? "Apagando..." : "Apagar"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
