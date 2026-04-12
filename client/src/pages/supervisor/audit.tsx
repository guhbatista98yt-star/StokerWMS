import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSessionQueryKey } from "@/lib/auth";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
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
import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import { DateRange } from "react-day-picker";
import { Link } from "wouter";
import { ArrowLeft, FileText, Calendar } from "lucide-react";
import { SortableTableHead, SortState, sortData, toggleSort } from "@/components/ui/sortable-table-head";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { AuditLog, User } from "@shared/schema";

type AuditLogWithUser = AuditLog & { user: User | null };

const actionLabels: Record<string, { label: string; color: string }> = {
    login: { label: "Login", color: "bg-green-100 text-green-700" },
    logout: { label: "Logout", color: "bg-gray-100 text-gray-700" },
    create_user: { label: "Criar Usuário", color: "bg-blue-100 text-blue-700" },
    update_user: { label: "Atualizar Usuário", color: "bg-yellow-100 text-yellow-700" },
    assign_route: { label: "Atribuir Rota", color: "bg-purple-100 text-purple-700" },
    launch_orders: { label: "Lançar Pedidos", color: "bg-indigo-100 text-indigo-700" },
    cancel_launch: { label: "Cancelar Lançamento", color: "bg-red-100 text-red-700" },
    relaunch_orders: { label: "Relançar Pedidos", color: "bg-orange-100 text-orange-700" },
    set_priority: { label: "Definir Prioridade", color: "bg-pink-100 text-pink-700" },
    lock_work_units: { label: "Bloquear Unidades", color: "bg-cyan-100 text-cyan-700" },
    unlock_work_units: { label: "Desbloquear Unidades", color: "bg-teal-100 text-teal-700" },
    create_exception: { label: "Criar Exceção", color: "bg-amber-100 text-amber-700" },
    create_manual_qty_rule: { label: "Criar Regra Qtd Manual", color: "bg-lime-100 text-lime-700" },
    print_report: { label: "Impressão de Relatório", color: "bg-slate-100 text-slate-700" },
    create_section_group: { label: "Criar Grupo Seção", color: "bg-emerald-100 text-emerald-700" },
    update_section_group: { label: "Atualizar Grupo Seção", color: "bg-fuchsia-100 text-fuchsia-700" },
    delete_section_group: { label: "Excluir Grupo Seção", color: "bg-rose-100 text-rose-700" },
};
import { startOfWeek, endOfWeek } from "date-fns";

const getCurrentWeekRange = (): DateRange => {
    const today = new Date();
    return {
        from: startOfWeek(today, { weekStartsOn: 1 }), // 1 = Segunda-feira
        to: endOfWeek(today, { weekStartsOn: 1 }),
    };
};

export default function AuditPage() {
    const logsQueryKey = useSessionQueryKey(["/api/audit-logs"]);
    const usersQueryKey = useSessionQueryKey(["/api/users"]);

    const [filterDateRange, setFilterDateRange] = useState<DateRange | undefined>(getCurrentWeekRange());
    const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>(getCurrentWeekRange());
    const [selectedUserId, setSelectedUserId] = useState<string>("all");
    const [sort, setSort] = useState<SortState | null>({ key: "createdAt", direction: "desc" });
    const handleSort = (key: string) => setSort(prev => toggleSort(prev, key));

    const { data: logs, isLoading } = useQuery<AuditLogWithUser[]>({
        queryKey: logsQueryKey,
    });

    const { data: users } = useQuery<User[]>({
        queryKey: usersQueryKey,
    });

    // Lógica de filtro
    const filteredLogs = logs?.filter((log) => {
        // Filtro de Data
        if (filterDateRange?.from) {
            const logDate = new Date(log.createdAt);
            if (logDate < filterDateRange.from) return false;
            if (filterDateRange.to) {
                const endOfDay = new Date(filterDateRange.to);
                endOfDay.setHours(23, 59, 59, 999);
                if (logDate > endOfDay) return false;
            }
        }

        // Filtro de Usuário
        if (selectedUserId !== "all") {
            if (log.userId !== selectedUserId) return false;
        }

        return true;
    }) || [];

    const sortedLogs = useMemo(() => sortData(filteredLogs, sort, (log, key) => {
        switch (key) {
            case "createdAt": return new Date(log.createdAt).getTime();
            case "userName": return log.user?.name ?? "Sistema";
            case "action": return log.action ?? "";
            case "entityType": return log.entityType ?? "";
            case "ipAddress": return log.ipAddress ?? "";
            default: return null;
        }
    }), [filteredLogs, sort]);

    return (
        <div className="min-h-screen bg-background">
            <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border bg-card shrink-0">
                <div className="flex items-center gap-3">
                    <Link href="/">
                        <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-back">
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-base font-semibold text-foreground leading-tight">Auditoria</h1>
                        <p className="text-xs text-muted-foreground">Logs de atividades do sistema</p>
                    </div>
                </div>
            </div>

            <main className="max-w-7xl mx-auto px-4 py-6 space-y-4">
                {/* Filtros */}
                <div className="bg-card p-4 rounded-lg border shadow-sm space-y-4">
                    <div className="flex flex-col md:flex-row gap-4">
                        {/* Filtro de Data */}
                        <div className="flex flex-wrap items-center gap-2">
                            <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
                            <div className="flex-1 min-w-0">
                                <DatePickerWithRange date={tempDateRange} onDateChange={setTempDateRange} className="w-full" />
                            </div>
                            <Button variant="secondary" className="shrink-0" onClick={() => setFilterDateRange(tempDateRange)}>
                                Buscar
                            </Button>
                        </div>

                        {/* Filtro de Usuário */}
                        <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                            <SelectTrigger className="w-full sm:w-[200px]">
                                <SelectValue placeholder="Usuário" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todos os Usuários</SelectItem>
                                {users?.map((user) => (
                                    <SelectItem key={user.id} value={user.id}>
                                        {user.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <SectionCard
                    title={`Logs de Auditoria (${filteredLogs.length})`}
                    icon={<FileText className="h-4 w-4 text-blue-600" />}
                >
                    {isLoading ? (
                        <div className="space-y-2">
                            {Array.from({ length: 10 }).map((_, i) => (
                                <Skeleton key={i} className="h-12 w-full" />
                            ))}
                        </div>
                    ) : filteredLogs && filteredLogs.length > 0 ? (
                        <div className="overflow-x-auto overflow-y-auto max-h-[70vh] -mx-6 px-6 relative">
                            <Table>
                                <TableHeader className="sticky top-0 bg-background z-10 shadow-sm">
                                    <TableRow>
                                        <SortableTableHead label="Data/Hora" sortKey="createdAt" sort={sort} onSort={handleSort} />
                                        <SortableTableHead label="Usuário" sortKey="userName" sort={sort} onSort={handleSort} />
                                        <SortableTableHead label="Ação" sortKey="action" sort={sort} onSort={handleSort} />
                                        <SortableTableHead label="Módulo" sortKey="entityType" sort={sort} onSort={handleSort} className="hidden md:table-cell" />
                                        <TableHead className="hidden sm:table-cell">Detalhes</TableHead>
                                        <SortableTableHead label="IP" sortKey="ipAddress" sort={sort} onSort={handleSort} className="hidden lg:table-cell" />
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {sortedLogs.map((log) => {
                                        const actionConfig = actionLabels[log.action] || {
                                            label: log.action,
                                            color: "bg-gray-100 text-gray-700",
                                        };

                                        return (
                                            <TableRow key={log.id} data-testid={`row-audit-${log.id}`}>
                                                {/* Data/Hora */}
                                                <TableCell className="text-sm whitespace-nowrap">
                                                    {format(new Date(log.createdAt), "dd/MM/yyyy HH:mm:ss", {
                                                        locale: ptBR,
                                                    })}
                                                </TableCell>

                                                {/* Usuário */}
                                                <TableCell className="font-medium">
                                                    {log.user?.name || "Sistema"}
                                                </TableCell>

                                                {/* Ação */}
                                                <TableCell>
                                                    <Badge variant="outline" className={`${actionConfig.color} border-0`}>
                                                        {actionConfig.label}
                                                    </Badge>
                                                </TableCell>

                                                <TableCell className="text-sm text-muted-foreground hidden md:table-cell">
                                                    {log.entityType}
                                                </TableCell>

                                                <TableCell className="max-w-[400px] hidden sm:table-cell">
                                                    <div className="max-h-[100px] overflow-y-auto pr-2 text-sm whitespace-pre-wrap break-words">
                                                        {log.details || "-"}
                                                    </div>
                                                </TableCell>

                                                <TableCell className="text-xs font-mono text-muted-foreground hidden lg:table-cell">
                                                    {log.ipAddress || "-"}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    ) : (
                        <div className="text-center py-12 text-muted-foreground">
                            <FileText className="h-16 w-16 mx-auto mb-4 opacity-40" />
                            <p className="text-lg font-medium">Nenhum log registrado</p>
                            <p className="text-sm">
                                {logs && logs.length > 0
                                    ? "Nenhum log encontrado com os filtros aplicados"
                                    : "Ainda não há atividades registradas"}
                            </p>
                        </div>
                    )}
                </SectionCard>
            </main>
        </div>
    );
}
