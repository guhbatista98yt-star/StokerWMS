import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel,
    AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
    AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
    ArrowLeft, Plus, Trash2, Wifi, WifiOff, Printer, Copy, RefreshCw, Power, AlertCircle, KeyRound
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface AgentPrinter {
    name: string;
    isDefault: boolean;
}

interface PrintAgent {
    id: string;
    name: string;
    machineId: string;
    active: boolean;
    createdAt: string;
    lastSeenAt: string | null;
    online: boolean;
    printers: AgentPrinter[];
    lastPing: string | null;
}

function copyToClipboard(text: string): Promise<void> {
    if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
        try {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.position = "fixed";
            ta.style.left = "-9999px";
            ta.style.top = "-9999px";
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            const ok = document.execCommand("copy");
            document.body.removeChild(ta);
            ok ? resolve() : reject(new Error("execCommand failed"));
        } catch (e) {
            reject(e);
        }
    });
}

export default function PrintAgentsPage() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [newName, setNewName] = useState("");
    const [newToken, setNewToken] = useState<{ id: string; name: string; token: string } | null>(null);
    const [pendingDelete, setPendingDelete] = useState<PrintAgent | null>(null);
    const [pendingRegen, setPendingRegen] = useState<PrintAgent | null>(null);

    const { data: agents, isLoading } = useQuery<PrintAgent[]>({
        queryKey: ["/api/print-agents"],
        refetchInterval: 5000,
    });

    const createMutation = useMutation({
        mutationFn: () => apiRequest("POST", "/api/print-agents", { name: newName.trim() }),
        onSuccess: async (res) => {
            const data = await res.json();
            setNewToken({ id: data.id, name: data.name, token: data.token });
            setNewName("");
            queryClient.invalidateQueries({ queryKey: ["/api/print-agents"] });
            toast({ title: "Agente criado!", description: `Token gerado para "${data.name}". Guarde-o agora.` });
        },
        onError: () => toast({ title: "Erro ao criar agente", variant: "destructive" }),
    });

    const deleteMutation = useMutation({
        mutationFn: (id: string) => apiRequest("DELETE", `/api/print-agents/${id}`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/print-agents"] });
            toast({ title: "Agente removido" });
        },
        onError: () => toast({ title: "Erro ao remover agente", variant: "destructive" }),
    });

    const toggleMutation = useMutation({
        mutationFn: (id: string) => apiRequest("PATCH", `/api/print-agents/${id}/toggle`),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/print-agents"] }),
        onError: () => toast({ title: "Erro ao atualizar agente", variant: "destructive" }),
    });

    const regenerateMutation = useMutation({
        mutationFn: (id: string) => apiRequest("POST", `/api/print-agents/${id}/regenerate-token`),
        onSuccess: async (res) => {
            const data = await res.json();
            setNewToken({ id: data.id, name: data.name, token: data.token });
            toast({ title: "Novo token gerado!", description: `Atualize o config.ini do agente "${data.name}".` });
        },
        onError: () => toast({ title: "Erro ao regenerar token", variant: "destructive" }),
    });

    const copyToken = (token: string) => {
        copyToClipboard(token)
            .then(() => toast({ title: "Token copiado!" }))
            .catch(() => toast({ title: "Não foi possível copiar automaticamente", description: "Selecione o token e use Ctrl+C.", variant: "destructive" }));
    };

    const formatDate = (d: string | null) => {
        if (!d) return "—";
        try { return format(new Date(d), "dd/MM/yyyy HH:mm", { locale: ptBR }); } catch { return d; }
    };

    return (
        <div className="min-h-screen bg-background">
            <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border bg-card shrink-0">
                <div className="flex items-center gap-3">
                    <Link href="/">
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-base font-semibold text-foreground leading-tight">Agentes de Impressão</h1>
                        <p className="text-xs text-muted-foreground">Mini-servidores nas máquinas com impressoras</p>
                    </div>
                </div>
            </div>

            <div className="p-6 max-w-4xl mx-auto space-y-6">

                {/* Instrução */}
                <Card className="border-blue-200 dark:border-blue-900/40 bg-blue-50/50 dark:bg-blue-950/20">
                    <CardContent className="p-4">
                        <div className="flex gap-3">
                            <AlertCircle className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
                            <div className="text-sm text-blue-900 dark:text-blue-200 space-y-1">
                                <p className="font-semibold">Como funciona:</p>
                                <ol className="list-decimal ml-4 space-y-0.5">
                                    <li>Crie um agente aqui e copie o token gerado</li>
                                    <li>Copie a pasta <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">print-agent/</code> para a máquina Windows com impressoras</li>
                                    <li>Cole o token no <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">config.ini</code> e configure a URL do servidor</li>
                                    <li>Execute <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">instalar.bat</code> na primeira vez, ou <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">iniciar.bat</code> depois</li>
                                    <li>As impressoras aparecem no formato <strong>MAQUINA\Impressora</strong> nas configurações de usuário</li>
                                </ol>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Criar novo agente */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Novo Agente</CardTitle>
                        <CardDescription>Dê um nome amigável para identificar a máquina (ex: "Máquina Conferência 1")</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="flex gap-3">
                            <Input
                                placeholder="Nome do agente..."
                                value={newName}
                                onChange={e => setNewName(e.target.value)}
                                onKeyDown={e => e.key === "Enter" && newName.trim() && createMutation.mutate()}
                                data-testid="input-agent-name"
                                className="flex-1"
                            />
                            <Button
                                onClick={() => createMutation.mutate()}
                                disabled={!newName.trim() || createMutation.isPending}
                                data-testid="btn-create-agent"
                            >
                                <Plus className="h-4 w-4 mr-2" />
                                Criar
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                {/* Token gerado — mostrado após criar ou regenerar */}
                {newToken && (
                    <Card className="border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30">
                        <CardContent className="p-4 space-y-3">
                            <div className="flex items-center gap-2">
                                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                                <span className="font-semibold text-green-800 dark:text-green-200">
                                    Token para "{newToken.name}" — copie agora!
                                </span>
                            </div>
                            <p className="text-xs text-green-700 dark:text-green-300">
                                Este token só é exibido uma vez. Cole no <code>config.ini</code> do agente.
                            </p>
                            <div className="flex gap-2 items-center">
                                <code
                                    className="flex-1 bg-white dark:bg-black border border-green-300 dark:border-green-700 rounded px-3 py-2 text-sm font-mono break-all select-all cursor-text"
                                    data-testid="text-agent-token"
                                >
                                    {newToken.token}
                                </code>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => copyToken(newToken.token)}
                                    className="shrink-0"
                                    data-testid="btn-copy-token"
                                    title="Copiar token"
                                >
                                    <Copy className="h-4 w-4" />
                                </Button>
                            </div>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="text-green-700 dark:text-green-300"
                                onClick={() => setNewToken(null)}
                            >
                                Entendi, fechar
                            </Button>
                        </CardContent>
                    </Card>
                )}

                {/* Lista de agentes */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <h2 className="font-semibold text-foreground">Agentes cadastrados</h2>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/print-agents"] })}
                            data-testid="btn-refresh-agents"
                        >
                            <RefreshCw className="h-3.5 w-3.5 mr-1" />
                            Atualizar
                        </Button>
                    </div>

                    {isLoading ? (
                        <div className="text-center py-8 text-muted-foreground">Carregando...</div>
                    ) : !agents || agents.length === 0 ? (
                        <Card>
                            <CardContent className="flex flex-col items-center py-10 text-muted-foreground">
                                <Printer className="h-10 w-10 mb-3 opacity-20" />
                                <p>Nenhum agente cadastrado ainda.</p>
                            </CardContent>
                        </Card>
                    ) : (
                        agents.map(agent => (
                            <Card
                                key={agent.id}
                                className={`transition-colors ${!agent.active ? "opacity-60" : ""} ${agent.online ? "border-green-200 dark:border-green-800" : ""}`}
                                data-testid={`card-agent-${agent.id}`}
                            >
                                <CardContent className="p-4">
                                    <div className="flex items-start justify-between gap-4 flex-wrap">
                                        <div className="space-y-1.5 min-w-0 flex-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                {agent.online ? (
                                                    <Badge className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 border-0 gap-1">
                                                        <Wifi className="h-3 w-3" /> Online
                                                    </Badge>
                                                ) : (
                                                    <Badge variant="outline" className="text-muted-foreground gap-1">
                                                        <WifiOff className="h-3 w-3" /> Offline
                                                    </Badge>
                                                )}
                                                {!agent.active && (
                                                    <Badge variant="outline" className="text-red-500">Desativado</Badge>
                                                )}
                                                <span className="font-semibold text-sm">{agent.name}</span>
                                                {agent.machineId && (
                                                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                                                        {agent.machineId}
                                                    </code>
                                                )}
                                            </div>

                                            {/* Impressoras disponíveis */}
                                            {agent.online && agent.printers.length > 0 && (
                                                <div className="flex flex-wrap gap-1.5 mt-1">
                                                    {agent.printers.map(p => (
                                                        <span
                                                            key={p.name}
                                                            className="inline-flex items-center gap-1 text-xs bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded"
                                                        >
                                                            <Printer className="h-3 w-3 opacity-60" />
                                                            {agent.machineId}\{p.name}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}

                                            <div className="flex gap-4 text-xs text-muted-foreground flex-wrap">
                                                <span>Criado: {formatDate(agent.createdAt)}</span>
                                                {agent.lastSeenAt && <span>Último acesso: {formatDate(agent.lastSeenAt)}</span>}
                                                {agent.online && agent.lastPing && (
                                                    <span className="text-green-600">Ping: {formatDate(agent.lastPing)}</span>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex gap-2 shrink-0 flex-wrap justify-end">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => setPendingRegen(agent)}
                                                disabled={regenerateMutation.isPending}
                                                title="Regenerar token"
                                                data-testid={`btn-regen-token-${agent.id}`}
                                            >
                                                <KeyRound className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => toggleMutation.mutate(agent.id)}
                                                disabled={toggleMutation.isPending}
                                                title={agent.active ? "Desativar" : "Ativar"}
                                                data-testid={`btn-toggle-agent-${agent.id}`}
                                            >
                                                <Power className={`h-4 w-4 ${agent.active ? "text-green-600" : "text-muted-foreground"}`} />
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                                onClick={() => setPendingDelete(agent)}
                                                disabled={deleteMutation.isPending}
                                                data-testid={`btn-delete-agent-${agent.id}`}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))
                    )}
                </div>
            </div>

            {/* Dialog: confirmar exclusão de agente */}
            <AlertDialog open={!!pendingDelete} onOpenChange={open => !open && setPendingDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Remover agente</AlertDialogTitle>
                        <AlertDialogDescription>
                            Tem certeza que deseja remover o agente <strong>"{pendingDelete?.name}"</strong>?
                            Esta ação não pode ser desfeita.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-red-600 hover:bg-red-700"
                            onClick={() => {
                                if (pendingDelete) {
                                    deleteMutation.mutate(pendingDelete.id);
                                    setPendingDelete(null);
                                }
                            }}
                            data-testid="btn-confirm-delete-agent"
                        >
                            Remover
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Dialog: confirmar regeneração de token */}
            <AlertDialog open={!!pendingRegen} onOpenChange={open => !open && setPendingRegen(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Regenerar token do agente</AlertDialogTitle>
                        <AlertDialogDescription>
                            Tem certeza que deseja regenerar o token de <strong>"{pendingRegen?.name}"</strong>?
                            O token atual deixará de funcionar imediatamente e o agente precisará ser reconfigurado.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                if (pendingRegen) {
                                    regenerateMutation.mutate(pendingRegen.id);
                                    setPendingRegen(null);
                                }
                            }}
                            data-testid="btn-confirm-regen-token"
                        >
                            Regenerar token
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
