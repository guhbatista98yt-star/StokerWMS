import { useQuery } from "@tanstack/react-query";
import { User } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Printer, ArrowLeft, AlertTriangle } from "lucide-react";
import { useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export default function BadgeGeneration() {
    const [, navigate] = useLocation();
    const { data: users, isLoading } = useQuery<User[]>({
        queryKey: ["/api/users"],
    });

    const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
    const printRef = useRef<HTMLDivElement>(null);

    // Filter active users
    const activeUsers = users?.filter(u => u.active) || [];

    // Determine which users to display: selected ones, or all if none selected
    const usersToDisplay = selectedUserIds.length > 0
        ? activeUsers.filter(u => selectedUserIds.includes(u.id))
        : activeUsers;

    const handlePrint = () => {
        window.print();
    };

    const toggleUserSelection = (userId: string) => {
        setSelectedUserIds(prev =>
            prev.includes(userId)
                ? prev.filter(id => id !== userId)
                : [...prev, userId]
        );
    };

    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-screen">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background">
            <div className="print:hidden flex items-center justify-between px-3 py-2.5 border-b border-border bg-card shrink-0">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/supervisor/reports")}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div>
                        <h1 className="text-base font-semibold text-foreground leading-tight">Cartões de Acesso</h1>
                        <p className="text-xs text-muted-foreground">Impressão de QR Code para autorização</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setSelectedUserIds([])} disabled={selectedUserIds.length === 0}>
                        Limpar Seleção
                    </Button>
                    <Button size="sm" onClick={handlePrint} className="hidden sm:inline-flex">
                        <Printer className="mr-2 h-4 w-4" />
                        {selectedUserIds.length > 0 ? `Imprimir (${selectedUserIds.length})` : "Imprimir Todos"}
                    </Button>
                </div>
            </div>

            <div className="print:hidden p-4 space-y-4">
                <div className="w-full max-w-sm">
                    <label className="text-sm font-medium mb-1 block">Filtrar Usuários</label>
                    <div className="relative">
                        <select
                            className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            onChange={(e) => {
                                const val = e.target.value;
                                if (val) toggleUserSelection(val);
                            }}
                            value=""
                        >
                            <option value="">Selecione para adicionar...</option>
                            {activeUsers
                                .filter(u => !selectedUserIds.includes(u.id))
                                .map((user) => (
                                    <option key={user.id} value={user.id}>
                                        {user.name}
                                    </option>
                                ))}
                        </select>
                    </div>
                    {selectedUserIds.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                            {selectedUserIds.map(id => {
                                const u = activeUsers.find(user => user.id === id);
                                if (!u) return null;
                                return (
                                    <Badge key={id} variant="secondary" className="cursor-pointer" onClick={() => toggleUserSelection(id)}>
                                        {u.name} <span className="ml-1 text-muted-foreground">×</span>
                                    </Badge>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            <div ref={printRef} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 print:block print:w-full">
                {usersToDisplay.length === 0 && (
                    <div className="col-span-full text-center text-muted-foreground py-10">
                        Nenhum usuário selecionado.
                    </div>
                )}

                {usersToDisplay.map((user) => (
                    <div key={user.id} className="break-inside-avoid print:mb-4 print:inline-block print:w-[32%] print:mr-2">
                        <Card className="border-2 border-primary/20 overflow-hidden relative h-full rounded-2xl">
                            <div className="absolute top-0 left-0 w-2 h-full bg-primary" />
                            <CardContent className="p-6 flex flex-col items-center text-center gap-4 h-full justify-between">
                                <div className="flex flex-col items-center gap-4 w-full">
                                    <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary">
                                        {user.name.charAt(0).toUpperCase()}
                                    </div>

                                    <div className="space-y-1 w-full">
                                        <h3 className="font-bold text-xl truncate px-2">{user.name}</h3>
                                        <Badge variant="secondary" className="uppercase tracking-wider">
                                            {user.role}
                                        </Badge>
                                    </div>
                                </div>

                                <div className="mt-4 p-4 bg-white rounded border border-gray-200 w-full flex items-center justify-center min-h-[160px]">
                                    {user.badgeCode ? (
                                        <QRCodeSVG value={user.badgeCode} size={128} level="H" />
                                    ) : (
                                        <div className="flex flex-col items-center gap-2 text-amber-600">
                                            <AlertTriangle className="h-8 w-8" />
                                            <span className="text-xs font-semibold">Código não gerado</span>
                                            <span className="text-[10px] text-muted-foreground leading-tight px-2">
                                                Atualize a senha do usuário
                                            </span>
                                        </div>
                                    )}
                                </div>

                                <div className="text-xs text-muted-foreground font-mono mt-1 w-full border-t pt-2">
                                    ID: {user.username}
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                ))}
            </div>

            <style>{`
                @media print {
                    @page { margin: 0.5cm; size: auto; }
                    body * {
                        visibility: hidden;
                    }
                    .print\\:block, .print\\:block * {
                        visibility: visible;
                    }
                    .print\\:block {
                        position: absolute;
                        left: 0;
                        top: 0;
                        width: 100%;
                    }
                    .print\\:hidden {
                        display: none !important;
                    }
                    /* Ensure background colors/graphics print */
                    * {
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }
                }
            `}</style>
        </div>
    );
}
