import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth, useSessionQueryKey } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  ArrowLeft,
  Database,
  Eye,
  Save,
  CheckCircle2,
  AlertCircle,
  ArrowRightLeft,
  Loader2,
  Info,
  Zap,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Play,
  Terminal,
  Download,
  Clock,
  TableIcon,
} from "lucide-react";
import { Link } from "wouter";
import type { DataContractField, MappingField, Db2Mapping } from "@shared/schema";

interface DatasetInfo {
  name: string;
  label: string;
  description: string;
}

interface CacheColumn {
  name: string;
  sampleValue: any;
}

const CAST_OPTIONS = [
  { value: "_none", label: "Nenhum" },
  { value: "string", label: "Texto" },
  { value: "number", label: "Número" },
  { value: "divide_100", label: "Dividir por 100" },
  { value: "divide_1000", label: "Dividir por 1000" },
  { value: "boolean_T_F", label: "T/F → Sim/Não" },
];

export default function MappingStudioPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedDataset, setSelectedDataset] = useState<string>("");
  const [mappingRows, setMappingRows] = useState<MappingField[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [description, setDescription] = useState("");
  const [showHelp, setShowHelp] = useState(false);

  const datasetsQueryKey = useSessionQueryKey(["/api/datasets"]);
  const { data: datasets, isLoading: datasetsLoading } = useQuery<DatasetInfo[]>({
    queryKey: datasetsQueryKey,
  });

  const columnsQueryKey = useSessionQueryKey(["/api/cache-columns"]);
  const { data: cacheColumnsData } = useQuery<{ columns: CacheColumn[]; message?: string }>({
    queryKey: columnsQueryKey,
  });

  const schemaQueryKey = useSessionQueryKey([`/api/schema/${selectedDataset}`]);
  const { data: schemaData, isLoading: schemaLoading } = useQuery<{ dataset: string; fields: DataContractField[] }>({
    queryKey: schemaQueryKey,
    enabled: !!selectedDataset,
  });

  const mappingQueryKey = useSessionQueryKey([`/api/mapping/${selectedDataset}`]);
  const { data: existingMapping } = useQuery<Db2Mapping | null>({
    queryKey: mappingQueryKey,
    enabled: !!selectedDataset,
  });

  useEffect(() => {
    if (schemaData?.fields) {
      const existingFields = existingMapping?.mappingJson as MappingField[] | undefined;
      const rows: MappingField[] = schemaData.fields.map(field => {
        const existing = existingFields?.find(m => m.appField === field.appField);
        return {
          appField: field.appField,
          type: field.type,
          required: field.required,
          dbExpression: existing?.dbExpression || "",
          cast: existing?.cast || "",
          defaultValue: existing?.defaultValue || "",
        };
      });
      setMappingRows(rows);
    }
  }, [schemaData, existingMapping]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/mapping/${selectedDataset}`, {
        mappingJson: mappingRows,
        description: description || `Mapping para ${selectedDataset}`,
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.details?.join("; ") || errorData.error || "Erro ao salvar");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: mappingQueryKey });
      toast({ title: "Salvo!", description: `Mapping v${data.version} salvo com sucesso.` });
    },
    onError: (error: Error) => {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    },
  });

  const activateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/mapping/${id}/activate`);
      if (!res.ok) throw new Error("Erro ao ativar");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mappingQueryKey });
      toast({ title: "Ativado!", description: "Mapping ativado. A próxima sincronização usará este mapeamento." });
    },
    onError: () => {
      toast({ title: "Erro", description: "Falha ao ativar mapping", variant: "destructive" });
    },
  });

  const previewMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/preview/${selectedDataset}`, {
        mappingJson: mappingRows,
      });
      if (!res.ok) throw new Error("Erro ao gerar preview");
      return res.json();
    },
    onSuccess: (data) => {
      setPreviewData(data);
      setPreviewOpen(true);
    },
    onError: () => {
      toast({ title: "Erro", description: "Falha ao gerar preview", variant: "destructive" });
    },
  });

  const updateMappingRow = (index: number, field: keyof MappingField, value: string) => {
    setMappingRows(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const cacheColumns = cacheColumnsData?.columns || [];

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
            <h1 className="text-base font-semibold text-foreground leading-tight">Mapping Studio</h1>
            <p className="text-xs text-muted-foreground">Mapeamento DB2 → Aplicação</p>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <Tabs defaultValue="mapping" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-4">
            <TabsTrigger value="mapping" className="flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4" />
              Mapeamento
            </TabsTrigger>
            <TabsTrigger value="sql" className="flex items-center gap-2">
              <Terminal className="h-4 w-4" />
              Consulta SQL
            </TabsTrigger>
          </TabsList>

          <TabsContent value="mapping" className="space-y-6">
        <div className="border border-blue-200 bg-blue-50 rounded-lg">
          <button
            onClick={() => setShowHelp(!showHelp)}
            className="w-full flex items-center justify-between px-4 py-3 text-left"
          >
            <div className="flex items-center gap-2 text-blue-700 font-medium text-sm">
              <HelpCircle className="h-4 w-4" />
              Como usar o Mapping Studio
            </div>
            {showHelp ? <ChevronUp className="h-4 w-4 text-blue-500" /> : <ChevronDown className="h-4 w-4 text-blue-500" />}
          </button>
          {showHelp && (
            <div className="px-4 pb-4 text-sm text-blue-900 space-y-3 border-t border-blue-200 pt-3">
              <div>
                <p className="font-semibold mb-1">O que é o Mapping Studio?</p>
                <p>O Mapping Studio permite configurar como os dados do ERP (DB2) são mapeados para o sistema Stoker, sem precisar alterar o código. Sempre que a sincronização rodar, ela usará o mapeamento ativo para transformar os dados.</p>
              </div>
              <div>
                <p className="font-semibold mb-1">Passo a passo:</p>
                <ol className="list-decimal pl-5 space-y-1">
                  <li><strong>Selecione o Dataset</strong> — Escolha qual tipo de dado quer mapear: Pedidos, Produtos ou Itens do Pedido.</li>
                  <li><strong>Veja as Colunas do DB2</strong> — Na seção "Colunas Disponíveis", passe o mouse sobre cada coluna para ver um exemplo do valor. Use esses nomes exatos no campo "Expressão DB2".</li>
                  <li><strong>Preencha o Mapeamento</strong> — Para cada campo do sistema (Campo App), informe a coluna correspondente do DB2 no campo "Expressão DB2 (coluna)". Campos obrigatórios estão marcados com "Sim".</li>
                  <li><strong>Configure a Conversão</strong> — Se necessário, escolha uma conversão: "string" (texto), "number" (número), "divide_100" (dividir por 100), "divide_1000" (dividir por 1000), "boolean_T_F" (verdadeiro/falso).</li>
                  <li><strong>Valor Padrão</strong> — Defina um valor padrão caso a coluna do DB2 venha vazia.</li>
                  <li><strong>Testar / Preview</strong> — Clique em "Testar / Preview" para visualizar como os dados ficarão após a transformação. Verifique se os valores estão corretos.</li>
                  <li><strong>Salvar</strong> — Quando estiver satisfeito, clique em "Salvar Mapping". Uma nova versão será criada.</li>
                  <li><strong>Ativar</strong> — Após salvar, ative o mapeamento para que a sincronização passe a usá-lo. Se o mapeamento não estiver ativo, o sistema usará o mapeamento padrão do código.</li>
                </ol>
              </div>
              <div>
                <p className="font-semibold mb-1">Dicas importantes:</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Sempre faça um "Testar / Preview" antes de salvar para garantir que os dados estão corretos.</li>
                  <li>Apenas um mapeamento pode estar ativo por dataset. Ao ativar um novo, o anterior é desativado automaticamente.</li>
                  <li>O campo "Descrição" ajuda a identificar cada versão do mapeamento.</li>
                  <li>Work Units (unidades de trabalho) são geradas automaticamente a partir dos pedidos — não precisam de mapeamento separado.</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        <SectionCard
          title="Selecionar Dataset"
          icon={<Database className="h-4 w-4 text-primary" />}
        >
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
            <div className="flex-1 w-full">
              <label className="text-sm font-medium mb-2 block text-muted-foreground">
                Escolha o dataset para configurar o mapeamento
              </label>
              {datasetsLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <Select value={selectedDataset} onValueChange={setSelectedDataset}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione um dataset..." />
                  </SelectTrigger>
                  <SelectContent>
                    {datasets?.map(ds => (
                      <SelectItem key={ds.name} value={ds.name}>
                        <span className="font-medium">{ds.label}</span>
                        <span className="text-muted-foreground ml-2 text-xs">— {ds.description}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            {existingMapping && (
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Ativo v{existingMapping.version}
                </Badge>
              </div>
            )}
          </div>
        </SectionCard>

        {cacheColumns.length > 0 && (
          <SectionCard
            title="Colunas Disponíveis no Cache DB2"
            icon={<Info className="h-4 w-4 text-primary" />}
          >
            <div className="flex flex-wrap gap-2">
              {cacheColumns.map(col => (
                <Badge
                  key={col.name}
                  variant="secondary"
                  className="cursor-help font-mono text-xs"
                  title={`Exemplo: ${col.sampleValue !== null ? String(col.sampleValue) : "null"}`}
                >
                  {col.name}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Passe o mouse sobre uma coluna para ver um valor de exemplo. Use estes nomes no campo "Expressão DB2".
            </p>
          </SectionCard>
        )}

        {selectedDataset && (
          <SectionCard
            title={`Mapeamento: ${datasets?.find(d => d.name === selectedDataset)?.label || selectedDataset}`}
            icon={<ArrowRightLeft className="h-4 w-4 text-primary" />}
            actions={
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => previewMutation.mutate()}
                  disabled={previewMutation.isPending}
                >
                  {previewMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Eye className="h-4 w-4 mr-2" />
                  )}
                  Testar / Preview
                </Button>
                <Button
                  size="sm"
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  Salvar
                </Button>
              </div>
            }
          >
            {schemaLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (
              <>
                <div className="mb-4">
                  <label className="text-sm font-medium text-muted-foreground">Descrição (opcional)</label>
                  <Input
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="Ex: Mapeamento padrão DB2 CISSERP"
                    className="mt-1"
                  />
                </div>

                <div className="overflow-x-auto -mx-6">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[180px]">Campo App</TableHead>
                        <TableHead className="w-[80px] hidden sm:table-cell">Tipo</TableHead>
                        <TableHead className="w-[60px] hidden sm:table-cell">Obrig.</TableHead>
                        <TableHead className="min-w-[200px]">Expressão DB2 (coluna)</TableHead>
                        <TableHead className="w-[160px] hidden lg:table-cell">Conversão</TableHead>
                        <TableHead className="w-[140px] hidden lg:table-cell">Valor Padrão</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {mappingRows.map((row, idx) => {
                        const contractField = schemaData?.fields.find(f => f.appField === row.appField);
                        return (
                          <TableRow key={row.appField}>
                            <TableCell>
                              <div>
                                <span className="font-mono text-sm font-medium">{row.appField}</span>
                                {contractField && (
                                  <p className="text-xs text-muted-foreground mt-0.5">{contractField.description}</p>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="hidden sm:table-cell">
                              <Badge variant="outline" className="font-mono text-xs">
                                {row.type}
                              </Badge>
                            </TableCell>
                            <TableCell className="hidden sm:table-cell">
                              {row.required ? (
                                <Badge className="bg-red-100 text-red-700 border-red-200">Sim</Badge>
                              ) : (
                                <span className="text-muted-foreground text-xs">Não</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Select
                                value={row.dbExpression || "_none"}
                                onValueChange={(val) => updateMappingRow(idx, "dbExpression", val === "_none" ? "" : val)}
                              >
                                <SelectTrigger className="font-mono text-sm">
                                  <SelectValue placeholder="Selecione coluna..." />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="_none">
                                    <span className="text-muted-foreground">Nenhuma</span>
                                  </SelectItem>
                                  {cacheColumns.map(col => (
                                    <SelectItem key={col.name} value={col.name}>
                                      <span className="font-mono">{col.name}</span>
                                      <span className="text-muted-foreground ml-2 text-xs">
                                        {col.sampleValue !== null ? `(${String(col.sampleValue).substring(0, 30)})` : "(null)"}
                                      </span>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell className="hidden lg:table-cell">
                              <Select
                                value={row.cast || "_none"}
                                onValueChange={(val) => updateMappingRow(idx, "cast", val === "_none" ? "" : val)}
                              >
                                <SelectTrigger className="text-sm">
                                  <SelectValue placeholder="Nenhum" />
                                </SelectTrigger>
                                <SelectContent>
                                  {CAST_OPTIONS.map(opt => (
                                    <SelectItem key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell className="hidden lg:table-cell">
                              <Input
                                value={row.defaultValue || ""}
                                onChange={e => updateMappingRow(idx, "defaultValue", e.target.value)}
                                placeholder="—"
                                className="text-sm"
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {existingMapping && !existingMapping.isActive && (
                  <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between">
                    <div className="flex items-center gap-2 text-amber-700 text-sm">
                      <AlertCircle className="h-4 w-4" />
                      <span>Este mapping está salvo mas não está ativo.</span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-amber-300 text-amber-700 hover:bg-amber-100"
                      onClick={() => activateMutation.mutate(existingMapping.id)}
                      disabled={activateMutation.isPending}
                    >
                      {activateMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Zap className="h-4 w-4 mr-2" />
                      )}
                      Ativar Mapping
                    </Button>
                  </div>
                )}
              </>
            )}
          </SectionCard>
        )}

        {!selectedDataset && (
          <div className="text-center py-12 text-muted-foreground">
            <Database className="h-16 w-16 mx-auto mb-4 opacity-30" />
            <h3 className="text-lg font-medium mb-2">Selecione um Dataset</h3>
            <p className="text-sm max-w-md mx-auto">
              Escolha um dataset acima para começar a configurar o mapeamento entre as colunas do DB2 e os campos que a aplicação espera.
            </p>
          </div>
        )}

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              Preview do Mapeamento
            </DialogTitle>
          </DialogHeader>

          {previewData && (
            <div className="space-y-4">
              {previewData.errors?.length > 0 && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="font-medium text-red-700 text-sm mb-1">Erros encontrados:</p>
                  <ul className="list-disc pl-4 text-sm text-red-600">
                    {previewData.errors.map((err: string, i: number) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {previewData.warnings?.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="font-medium text-amber-700 text-sm mb-1">Avisos:</p>
                  <ul className="list-disc pl-4 text-sm text-amber-600">
                    {previewData.warnings.map((warn: string, i: number) => (
                      <li key={i}>{warn}</li>
                    ))}
                  </ul>
                </div>
              )}

              {previewData.preview?.length > 0 ? (
                <div>
                  <p className="text-sm text-muted-foreground mb-2">
                    Mostrando {previewData.preview.length} registros transformados:
                  </p>
                  <div className="overflow-x-auto border rounded-lg">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8">#</TableHead>
                          {Object.keys(previewData.preview[0]).map(key => (
                            <TableHead key={key} className="font-mono text-xs whitespace-nowrap">{key}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {previewData.preview.map((row: Record<string, any>, idx: number) => (
                          <TableRow key={idx}>
                            <TableCell className="text-muted-foreground text-xs">{idx + 1}</TableCell>
                            {Object.values(row).map((val, colIdx) => (
                              <TableCell key={colIdx} className="text-xs whitespace-nowrap max-w-[200px] truncate">
                                {val === null ? (
                                  <span className="text-muted-foreground italic">null</span>
                                ) : (
                                  String(val)
                                )}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : previewData.errors?.length === 0 && previewData.warnings?.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">Nenhum dado para exibir.</p>
              ) : null}
            </div>
          )}
        </DialogContent>
      </Dialog>
          </TabsContent>

          <TabsContent value="sql">
            <SqlQueryTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function SqlQueryTab() {
  const { toast } = useToast();
  const [dbTarget, setDbTarget] = useState<"local" | "db2">("db2");
  const [sqlQuery, setSqlQuery] = useState("set current schema dba;\nSELECT * FROM PRODUTO FETCH FIRST 10 ROWS ONLY;");
  const [queryResult, setQueryResult] = useState<{ columns: string[]; rows: Record<string, any>[]; rowCount: number; elapsed: number; warning?: string } | null>(null);
  const [queryError, setQueryError] = useState<string>("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [queryHistory, setQueryHistory] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const executeQuery = async () => {
    if (!sqlQuery.trim()) return;
    setIsExecuting(true);
    setQueryError("");
    setQueryResult(null);

    const endpoint = dbTarget === "db2" ? "/api/db2-query" : "/api/sql-query";

    try {
      const res = await apiRequest("POST", endpoint, { query: sqlQuery.trim() });
      const data = await res.json();

      if (!res.ok) {
        setQueryError(data.error || "Erro ao executar consulta");
        return;
      }

      setQueryResult(data);
      setQueryHistory(prev => {
        const next = [sqlQuery.trim(), ...prev.filter(q => q !== sqlQuery.trim())];
        return next.slice(0, 20);
      });
    } catch (err) {
      setQueryError(err instanceof Error ? err.message : "Erro de conexão");
    } finally {
      setIsExecuting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      executeQuery();
    }
  };

  const exportCsv = () => {
    if (!queryResult || queryResult.rows.length === 0) return;
    const { columns, rows } = queryResult;
    const csvLines = [columns.join(";")];
    for (const row of rows) {
      csvLines.push(columns.map(col => {
        const val = row[col];
        if (val === null || val === undefined) return "";
        const str = String(val);
        if (str.includes(";") || str.includes('"') || str.includes("\n")) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }).join(";"));
    }
    const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `consulta_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <SectionCard
        title="Consulta SQL"
        icon={<Terminal className="h-4 w-4 text-primary" />}
      >
        <div className="space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-muted-foreground font-medium">Banco:</span>
            <div className="flex rounded-md border overflow-hidden">
              <button
                onClick={() => {
                  setDbTarget("db2");
                  if (sqlQuery === "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;") {
                    setSqlQuery("set current schema dba;\nSELECT * FROM PRODUTO FETCH FIRST 10 ROWS ONLY;");
                  }
                }}
                className={`px-3 py-1 text-xs font-medium transition-colors ${
                  dbTarget === "db2"
                    ? "bg-blue-600 text-white"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                DB2 (ERP)
              </button>
              <button
                onClick={() => {
                  setDbTarget("local");
                  if (sqlQuery === "set current schema dba;\nSELECT * FROM PRODUTO FETCH FIRST 10 ROWS ONLY;") {
                    setSqlQuery("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;");
                  }
                }}
                className={`px-3 py-1 text-xs font-medium transition-colors ${
                  dbTarget === "local"
                    ? "bg-green-600 text-white"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                Local (SQLite)
              </button>
            </div>
            {dbTarget === "db2" && (
              <span className="text-xs text-blue-600 flex items-center gap-1">
                <Database className="h-3 w-3" />
                CISSERP @ 192.168.1.200
              </span>
            )}
          </div>

          <div className="relative">
            <Textarea
              ref={textareaRef}
              value={sqlQuery}
              onChange={(e) => setSqlQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={dbTarget === "db2" ? "set current schema dba;\nSELECT * FROM PRODUTO FETCH FIRST 10 ROWS ONLY;" : "SELECT * FROM orders LIMIT 10;"}
              className="font-mono text-sm min-h-[120px] resize-y bg-slate-950 text-green-400 border-slate-700 placeholder:text-slate-600"
              spellCheck={false}
            />
            <div className="absolute bottom-2 right-2 text-xs text-slate-500">
              Ctrl+Enter para executar
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={executeQuery}
              disabled={isExecuting || !sqlQuery.trim()}
              className={dbTarget === "db2" ? "bg-blue-600 hover:bg-blue-700" : "bg-green-600 hover:bg-green-700"}
            >
              {isExecuting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              {isExecuting ? "Executando..." : "Executar"}
            </Button>

            {queryResult && queryResult.rows.length > 0 && (
              <Button variant="outline" size="sm" onClick={exportCsv}>
                <Download className="h-4 w-4 mr-2" />
                Exportar CSV
              </Button>
            )}

            {queryResult && (
              <div className="flex items-center gap-3 ml-auto text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <TableIcon className="h-3 w-3" />
                  {queryResult.rowCount} registro{queryResult.rowCount !== 1 ? "s" : ""}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {queryResult.elapsed}ms
                </span>
              </div>
            )}
          </div>

          {queryHistory.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground text-xs">
                Histórico ({queryHistory.length})
              </summary>
              <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                {queryHistory.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => setSqlQuery(q)}
                    className="block w-full text-left text-xs font-mono p-1.5 rounded hover:bg-muted truncate"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </details>
          )}
        </div>
      </SectionCard>

      {queryError && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-700 font-mono">{queryError}</p>
        </div>
      )}

      {queryResult?.warning && (
        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-amber-700">{queryResult.warning}</p>
        </div>
      )}

      {queryResult && queryResult.rows.length > 0 && (
        <SectionCard
          title={`Resultado — ${queryResult.rowCount} registro${queryResult.rowCount !== 1 ? "s" : ""}`}
          icon={<Database className="h-4 w-4 text-primary" />}
        >
          <div className="overflow-x-auto border rounded-lg max-h-[500px] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead className="w-10 text-center text-xs">#</TableHead>
                  {queryResult.columns.map((col) => (
                    <TableHead key={col} className="font-mono text-xs whitespace-nowrap">
                      {col}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {queryResult.rows.map((row, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="text-center text-xs text-muted-foreground">{idx + 1}</TableCell>
                    {queryResult.columns.map((col) => (
                      <TableCell key={col} className="text-xs whitespace-nowrap max-w-[300px] truncate font-mono">
                        {row[col] === null ? (
                          <span className="text-muted-foreground italic">NULL</span>
                        ) : (
                          String(row[col])
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </SectionCard>
      )}

      {queryResult && queryResult.rows.length === 0 && !queryError && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          Consulta executada com sucesso — nenhum registro retornado.
        </div>
      )}
    </div>
  );
}
