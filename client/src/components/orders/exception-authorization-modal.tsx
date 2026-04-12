import { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Exception, Product } from "@shared/schema";

interface ExceptionWithDetails extends Exception {
    orderItem: {
        product: Product;
        order: {
            erpOrderId: string;
        };
    };
}

interface ExceptionAuthorizationModalProps {
    open: boolean;
    onClose: () => void;
    exceptions: ExceptionWithDetails[];
    onAuthorized: () => void;
    onCancel?: () => void;
}

const exceptionTypeLabels: Record<string, string> = {
    nao_encontrado: "Não Encontrado",
    avariado: "Avariado",
    vencido: "Vencido",
};

export function ExceptionAuthorizationModal({
    open,
    onClose,
    exceptions,
    onAuthorized,
    onCancel
}: ExceptionAuthorizationModalProps) {
    const [mode, setMode] = useState<"credentials" | "badge">("badge");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [badge, setBadge] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");
    const { toast } = useToast();
    const badgeInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (open && mode === "badge") {
            setTimeout(() => badgeInputRef.current?.focus(), 100);
        }
    }, [open, mode]);

    const handleAuthorizeByCredentials = async () => {
        try {
            setIsLoading(true);
            setError("");

            if (!username.trim() || !password.trim()) {
                setError("Preencha usuário e senha");
                return;
            }

            const exceptionIds = exceptions.map(e => e.id);
            const res = await apiRequest("POST", "/api/exceptions/authorize", {
                username: username.trim(),
                password,
                exceptionIds,
            });

            if (res.ok) {
                const data = await res.json();
                toast({
                    title: "Exceções Autorizadas",
                    description: `Por ${data.authorizedByName}`,
                });
                onAuthorized();
                handleClose();
            } else {
                const data = await res.json();
                setError(data.error || "Erro ao autorizar exceções");
                setPassword("");
            }
        } catch (err) {
            setError("Erro de conexão");
        } finally {
            setIsLoading(false);
        }
    };

    const handleAuthorizeByBadge = async (badgeValue?: string) => {
        const val = badgeValue || badge;
        try {
            setIsLoading(true);
            setError("");

            if (!val.trim()) {
                setError("Escaneie ou digite o crachá");
                return;
            }

            const exceptionIds = exceptions.map(e => e.id);
            const res = await apiRequest("POST", "/api/exceptions/authorize-by-badge", {
                badge: val.trim(),
                exceptionIds,
            });

            if (res.ok) {
                const data = await res.json();
                toast({
                    title: "Exceções Autorizadas",
                    description: `Por ${data.authorizedByName} (via crachá)`,
                });
                onAuthorized();
                handleClose();
            } else {
                const data = await res.json();
                setError(data.error || "Erro ao autorizar exceções");
                setBadge("");
                setTimeout(() => badgeInputRef.current?.focus(), 100);
            }
        } catch (err) {
            setError("Erro de conexão");
        } finally {
            setIsLoading(false);
        }
    };

    const handleClose = () => {
        setUsername("");
        setPassword("");
        setBadge("");
        setError("");
        onClose();
    };

    const handleCancelRequest = () => {
        handleClose();
        onCancel?.();
    };

    const groupedExceptions = exceptions.reduce((acc, exc) => {
        if (!exc.orderItem?.product) return acc;
        const productId = exc.orderItem.product.id;
        if (!acc[productId]) {
            acc[productId] = {
                product: exc.orderItem.product,
                exceptions: [],
                totalQty: 0,
                orderCodes: new Set<string>(),
            };
        }
        acc[productId].exceptions.push(exc);
        acc[productId].totalQty += Number(exc.quantity);
        acc[productId].orderCodes.add(exc.orderItem.order.erpOrderId);
        return acc;
    }, {} as Record<string, {
        product: Product;
        exceptions: ExceptionWithDetails[];
        totalQty: number;
        orderCodes: Set<string>;
    }>);

    const groupedList = Object.values(groupedExceptions);

    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
            <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto p-4 sm:p-6">
                <DialogHeader className="pb-2">
                    <DialogTitle className="text-base sm:text-lg">{"Autorização de Problemas"}</DialogTitle>
                    <DialogDescription className="text-xs sm:text-sm">
                        {exceptions.length} {"problema(s) detectado(s). Supervisor ou Administrador deve autorizar."}
                    </DialogDescription>
                </DialogHeader>

                <div className="max-h-[120px] sm:max-h-[200px] overflow-y-auto border rounded-lg p-2 sm:p-3 space-y-1.5">
                    {groupedList.map(group => (
                        <div key={group.product.id} className="p-2 bg-muted/40 rounded-lg">
                            <p className="font-medium text-xs sm:text-sm mb-1">{group.product.name}</p>
                            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] sm:text-xs text-muted-foreground">
                                <div>
                                    <span className="font-medium">{"Pedido(s):"}</span> {Array.from(group.orderCodes).join(", ")}
                                </div>
                                <div>
                                    <span className="font-medium">{"Qtd Total:"}</span> {group.totalQty}
                                </div>
                                {group.exceptions.map((exc) => (
                                    <div key={exc.id} className="col-span-2 text-[10px] sm:text-xs mt-0.5 pl-2 border-l-2 border-orange-300">
                                        <div><span className="font-medium">{"Motivo:"}</span> {exceptionTypeLabels[exc.type] || exc.type}</div>
                                        {exc.observation && <div><span className="font-medium">{"Obs:"}</span> {exc.observation}</div>}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="flex gap-1.5 sm:gap-2 pt-1">
                    <Button
                        variant={mode === "badge" ? "default" : "outline"}
                        size="sm"
                        onClick={() => { setMode("badge"); setError(""); }}
                        className="flex-1 text-xs sm:text-sm h-8 sm:h-9"
                    >
                        {"Crachá / Código de Barras"}
                    </Button>
                    <Button
                        variant={mode === "credentials" ? "default" : "outline"}
                        size="sm"
                        onClick={() => { setMode("credentials"); setError(""); }}
                        className="flex-1 text-xs sm:text-sm h-8 sm:h-9"
                    >
                        {"Usuário e Senha"}
                    </Button>
                </div>

                {mode === "badge" ? (
                    <div className="space-y-2 pt-1">
                        <div>
                            <label className="text-xs sm:text-sm font-medium mb-1 block">{"Escaneie o crachá do supervisor"}</label>
                            <Input
                                ref={badgeInputRef}
                                placeholder="Escaneie o crachá"
                                value={badge}
                                onChange={(e) => setBadge(e.target.value)}
                                disabled={isLoading}
                                autoFocus
                                inputMode="none"
                                autoComplete="off"
                                autoCorrect="off"
                                autoCapitalize="off"
                                spellCheck={false}
                                data-testid="input-scan"
                                className="h-10 sm:h-11 text-sm"
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        handleAuthorizeByBadge();
                                    }
                                }}
                            />
                        </div>
                    </div>
                ) : (
                    <div className="space-y-2 pt-1">
                        <div>
                            <label className="text-xs sm:text-sm font-medium mb-1 block">{"Usuário (Supervisor/Admin)"}</label>
                            <Input
                                placeholder="Digite o usuário"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                disabled={isLoading}
                                className="h-9 sm:h-10 text-sm"
                                onKeyDown={(e) => e.key === "Enter" && handleAuthorizeByCredentials()}
                            />
                        </div>
                        <div>
                            <label className="text-xs sm:text-sm font-medium mb-1 block">{"Senha"}</label>
                            <Input
                                type="password"
                                placeholder="Digite a senha"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                disabled={isLoading}
                                className="h-9 sm:h-10 text-sm"
                                onKeyDown={(e) => e.key === "Enter" && handleAuthorizeByCredentials()}
                            />
                        </div>
                    </div>
                )}

                {error && (
                    <Alert variant="destructive" className="py-2">
                        <AlertDescription className="text-xs sm:text-sm">{String(error)}</AlertDescription>
                    </Alert>
                )}

                <div className="flex flex-col sm:flex-row gap-2 pt-1">
                    {onCancel && (
                        <Button variant="destructive" onClick={handleCancelRequest} disabled={isLoading} className="sm:mr-auto h-9 text-xs sm:text-sm">
                            {"Cancelar Solicitação"}
                        </Button>
                    )}
                    <div className="flex gap-2 ml-auto w-full sm:w-auto">
                        <Button variant="outline" onClick={handleClose} disabled={isLoading} className="flex-1 sm:flex-none h-9 text-xs sm:text-sm">
                            {"Fechar"}
                        </Button>
                        {mode === "credentials" ? (
                            <Button onClick={handleAuthorizeByCredentials} disabled={isLoading || !username.trim() || !password.trim()} className="flex-1 sm:flex-none h-9 text-xs sm:text-sm">
                                {isLoading ? "Autorizando..." : "Autorizar"}
                            </Button>
                        ) : (
                            <Button onClick={() => handleAuthorizeByBadge()} disabled={isLoading || !badge.trim()} className="flex-1 sm:flex-none h-9 text-xs sm:text-sm">
                                {isLoading ? "Autorizando..." : "Autorizar"}
                            </Button>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
