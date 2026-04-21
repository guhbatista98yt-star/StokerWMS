import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Printer, RotateCcw, Save, CheckCircle2, User, Cpu, Tag } from "lucide-react";
import { LabelDefaultsSection } from "@/components/label-defaults-section";
import { Link, useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { invalidatePrintConfigCache } from "@/hooks/use-print";
import { PRINT_TYPE_LABELS, PRINT_TYPES, type PrintType } from "@/lib/print-config";
import { useAuth } from "@/lib/auth";

interface PrinterInfo {
  name: string;
  isDefault: boolean;
  status?: string;
  agentName?: string;
  machineId?: string;
  online?: boolean;
}

interface UserInfo {
  id: string;
  username: string;
  name: string;
  role: string;
}

interface PrintConfig {
  printer: string;
  copies: number;
}

const ROLE_LABELS: Record<string, string> = {
  administrador: "Administrador",
  supervisor: "Supervisor",
  separacao: "Separador",
  conferencia: "Conferente",
  balcao: "Balcão",
  fila_pedidos: "Fila de Pedidos",
  recebedor: "Recebedor",
  empilhador: "Empilhador",
  conferente_wms: "Conferente WMS",
};

export default function PrintSettingsPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === "administrador";

  const [selectedUserId, setSelectedUserId] = useState<string>("__none__");
  const [configs, setConfigs] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});

  const { data: printersData, isLoading: loadingPrinters, refetch } = useQuery({
    queryKey: ["/api/print/printers"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/print/printers");
      return res.json() as Promise<{ success: boolean; printers: PrinterInfo[]; default_printer: string | null }>;
    },
  });

  const { data: usersData, isLoading: loadingUsers } = useQuery({
    queryKey: ["/api/users"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/users");
      return res.json() as Promise<UserInfo[]>;
    },
  });

  // Busca a config de impressoras do usuário selecionado no banco de dados
  const { data: userConfigData, isLoading: loadingUserConfig } = useQuery({
    queryKey: ["/api/print/config", selectedUserId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/print/config/${selectedUserId}`);
      return res.json() as Promise<{ success: boolean; printConfig: Record<string, PrintConfig> }>;
    },
    enabled: selectedUserId !== "__none__",
  });

  // Atualiza os selects quando a config do usuário é carregada
  useEffect(() => {
    if (!userConfigData?.printConfig) {
      setConfigs({});
      return;
    }
    const loaded: Record<string, string> = {};
    for (const type of PRINT_TYPES) {
      const cfg = userConfigData.printConfig[type];
      if (cfg?.printer) loaded[type] = cfg.printer;
    }
    setConfigs(loaded);
    setSaved({});
  }, [userConfigData]);

  const saveMutation = useMutation({
    mutationFn: async ({ userId, printConfig }: { userId: string; printConfig: Record<string, PrintConfig> }) => {
      const res = await apiRequest("PUT", `/api/print/config/${userId}`, { printConfig });
      return res.json() as Promise<{ success: boolean; error?: string }>;
    },
    onSuccess: (_, { userId }) => {
      qc.invalidateQueries({ queryKey: ["/api/print/config", userId] });
      // Limpa cache em memória do hook de impressão (para o próximo print carregar a nova config)
      invalidatePrintConfigCache();
    },
  });

  const printers: PrinterInfo[] = printersData?.printers ?? [];
  const localPrinters = printers.filter(p => !p.status || p.status === "ready");
  const onlineAgentPrinters = printers.filter(p => p.status === "agent-online");
  const offlineAgentPrinters = printers.filter(p => p.status === "agent-offline");
  const users: UserInfo[] = Array.isArray(usersData) ? usersData : [];
  const selectedUser = users.find((u) => u.id === selectedUserId);
  const hasPrinters = printers.length > 0;

  function handleSave(type: PrintType) {
    if (selectedUserId === "__none__") return;
    const printer = (configs[type] ?? "").trim();

    const currentPrintConfig: Record<string, PrintConfig> = {};
    for (const t of PRINT_TYPES) {
      const val = t === type ? printer : (configs[t] ?? "").trim();
      if (val) currentPrintConfig[t] = { printer: val, copies: 1 };
    }

    saveMutation.mutate(
      { userId: selectedUserId, printConfig: currentPrintConfig },
      {
        onSuccess: (data) => {
          if (data.success) {
            setSaved((prev) => ({ ...prev, [type]: true }));
            setTimeout(() => setSaved((prev) => ({ ...prev, [type]: false })), 2000);
            const userLabel = selectedUser ? ` para ${selectedUser.name || selectedUser.username}` : "";
            toast({
              title: "Configuração salva",
              description: `${PRINT_TYPE_LABELS[type]}: ${printer || "sem padrão"}${userLabel}`,
            });
          } else {
            toast({ title: "Erro ao salvar", description: data.error ?? "Tente novamente.", variant: "destructive" });
          }
        },
      }
    );
  }

  function handleClear(type: PrintType) {
    if (selectedUserId === "__none__") return;
    const newConfigs = { ...configs };
    delete newConfigs[type];
    setConfigs(newConfigs);

    const currentPrintConfig: Record<string, PrintConfig> = {};
    for (const t of PRINT_TYPES) {
      if (t !== type && newConfigs[t]) {
        currentPrintConfig[t] = { printer: newConfigs[t], copies: 1 };
      }
    }

    saveMutation.mutate(
      { userId: selectedUserId, printConfig: currentPrintConfig },
      {
        onSuccess: () => {
          toast({ title: "Configuração removida", description: `${PRINT_TYPE_LABELS[type]} sem impressora padrão.` });
        },
      }
    );
  }

  const showConfigCards = selectedUserId !== "__none__";

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-base font-semibold text-foreground leading-tight">Configuração de Impressoras</h1>
            <p className="text-xs text-muted-foreground">Defina a impressora padrão por usuário</p>
          </div>
        </div>
      </div>

      <main className="max-w-lg mx-auto px-4 py-5 space-y-4">

        {/* Agentes de impressão — apenas admin */}
        {isAdmin && (
          <Link href="/admin/print-agents">
            <Card className="cursor-pointer hover:border-primary/50 transition-colors group">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="rounded-lg bg-primary/10 p-2.5 shrink-0 group-hover:bg-primary/20 transition-colors">
                  <Cpu className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">Agentes de Impressão</p>
                  <p className="text-xs text-muted-foreground">Mini-servidores nas máquinas com impressoras</p>
                </div>
                <ArrowLeft className="h-4 w-4 text-muted-foreground rotate-180 shrink-0" />
              </CardContent>
            </Card>
          </Link>
        )}

        <Link href="/admin/label-templates">
          <Card className="cursor-pointer hover:border-primary/50 transition-colors group">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="rounded-lg bg-primary/10 p-2.5 shrink-0 group-hover:bg-primary/20 transition-colors">
                <Tag className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">Modelos de Etiquetas</p>
                <p className="text-xs text-muted-foreground">Editor visual de etiquetas (volume, palete, etc.)</p>
              </div>
              <ArrowLeft className="h-4 w-4 text-muted-foreground rotate-180 shrink-0" />
            </CardContent>
          </Card>
        </Link>

        <LabelDefaultsSection />

        {/* Seletor de usuário */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              Usuário
            </CardTitle>
            <CardDescription className="text-xs">
              Escolha o usuário cujas impressoras você quer configurar.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingUsers ? (
              <div className="text-sm text-muted-foreground">Carregando usuários...</div>
            ) : (
              <Select
                value={selectedUserId}
                onValueChange={(v) => setSelectedUserId(v)}
              >
                <SelectTrigger data-testid="select-user">
                  <SelectValue placeholder="Selecionar usuário..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Selecionar usuário...</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {`${u.name || u.username} (${ROLE_LABELS[u.role] ?? u.role})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </CardContent>
        </Card>

        {/* Aguardando seleção */}
        {!showConfigCards && (
          <Card>
            <CardContent className="py-10 flex flex-col items-center gap-3 text-muted-foreground">
              <User className="h-8 w-8" />
              <p className="text-sm text-center">Selecione um usuário acima para configurar suas impressoras.</p>
            </CardContent>
          </Card>
        )}

        {/* Cards de configuração por tipo de impressão */}
        {showConfigCards && (
          <>
            {selectedUser && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground px-1">
                <User className="h-3.5 w-3.5 shrink-0" />
                <span>Configurando:</span>
                <strong className="text-foreground">{selectedUser.name || selectedUser.username}</strong>
                <span className="text-xs">({ROLE_LABELS[selectedUser.role] ?? selectedUser.role})</span>
              </div>
            )}

            {(loadingPrinters || loadingUserConfig) && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2 px-1">
                <Printer className="h-4 w-4 animate-pulse" />
                Carregando...
              </div>
            )}

            {!loadingPrinters && !loadingUserConfig && PRINT_TYPES.map((type) => (
              <Card key={type}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Printer className="h-4 w-4 text-muted-foreground" />
                    {PRINT_TYPE_LABELS[type]}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {configs[type]
                      ? `Impressora atual: ${configs[type]}`
                      : "Nenhuma impressora configurada para este tipo"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label>Impressora padrão</Label>

                    {hasPrinters ? (
                      <Select
                        value={configs[type] ?? "__none__"}
                        onValueChange={(v) =>
                          setConfigs((prev) => ({ ...prev, [type]: v === "__none__" ? "" : v }))
                        }
                      >
                        <SelectTrigger data-testid={`select-printer-${type}`}>
                          <SelectValue placeholder="Selecionar impressora..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Sem padrão</SelectItem>

                          {localPrinters.length > 0 && (
                            <SelectGroup>
                              <SelectLabel className="text-xs text-muted-foreground">Impressoras do servidor</SelectLabel>
                              {localPrinters.map((p) => (
                                <SelectItem key={p.name} value={p.name}>
                                  {p.name}{p.isDefault ? " (padrão)" : ""}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          )}

                          {onlineAgentPrinters.length > 0 && (
                            <SelectGroup>
                              <SelectLabel className="text-xs text-green-600 dark:text-green-400">● Agentes online</SelectLabel>
                              {onlineAgentPrinters.map((p) => (
                                <SelectItem key={p.name} value={p.name}>
                                  {p.agentName}: {p.name.split("\\").pop()}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          )}

                          {offlineAgentPrinters.length > 0 && (
                            <SelectGroup>
                              <SelectLabel className="text-xs text-muted-foreground">○ Agentes offline</SelectLabel>
                              {offlineAgentPrinters.map((p) => (
                                <SelectItem key={p.name} value={p.name}>
                                  {p.agentName}: {p.name.split("\\").pop()} (offline)
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          )}
                        </SelectContent>
                      </Select>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <Input
                          placeholder="Nome exato da impressora no Windows..."
                          value={configs[type] ?? ""}
                          onChange={(e) =>
                            setConfigs((prev) => ({ ...prev, [type]: e.target.value }))
                          }
                          data-testid={`input-printer-${type}`}
                        />
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-muted-foreground">
                            Nenhuma impressora detectada — digite o nome manualmente.
                          </p>
                          <Button variant="ghost" size="sm" className="text-xs h-7 px-2" onClick={() => refetch()}>
                            <RotateCcw className="h-3 w-3 mr-1" /> Recarregar
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleSave(type)}
                      disabled={saveMutation.isPending}
                      data-testid={`btn-save-printer-${type}`}
                    >
                      {saved[type] ? (
                        <><CheckCircle2 className="h-4 w-4 mr-1.5" />Salvo!</>
                      ) : (
                        <><Save className="h-4 w-4 mr-1.5" />Salvar</>
                      )}
                    </Button>
                    {configs[type] && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleClear(type)}
                        disabled={saveMutation.isPending}
                        data-testid={`btn-clear-printer-${type}`}
                      >
                        <RotateCcw className="h-4 w-4 mr-1.5" />
                        Remover
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}

            {!loadingPrinters && !loadingUserConfig && (
              <p className="text-xs text-muted-foreground text-center px-4 pb-2">
                As configurações são salvas no banco de dados e funcionam em qualquer dispositivo.
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
