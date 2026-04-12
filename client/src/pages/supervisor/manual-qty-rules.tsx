import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSessionQueryKey } from "@/lib/auth";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import { ArrowLeft, SlidersHorizontal, Plus, Pencil, Trash2, Search } from "lucide-react";

interface ManualQtyRule {
  id: string;
  ruleType: string;
  value: string;
  description: string | null;
  active: boolean;
  createdBy: string | null;
  createdAt: string;
}

const ruleTypeLabels: Record<string, string> = {
  product_code: "Código do Produto",
  barcode: "Código de Barras",
  description_keyword: "Palavra na Descrição",
  manufacturer: "Fornecedor/Fabricante",
};

const ruleTypeOptions = [
  { value: "product_code", label: "Código do Produto" },
  { value: "barcode", label: "Código de Barras" },
  { value: "description_keyword", label: "Palavra na Descrição" },
  { value: "manufacturer", label: "Fornecedor/Fabricante" },
];

export default function ManualQtyRulesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingRule, setEditingRule] = useState<ManualQtyRule | null>(null);
  const [deletingRule, setDeletingRule] = useState<ManualQtyRule | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const [formRuleType, setFormRuleType] = useState("product_code");
  const [formValue, setFormValue] = useState("");
  const [formDescription, setFormDescription] = useState("");

  const [editRuleType, setEditRuleType] = useState("product_code");
  const [editValue, setEditValue] = useState("");
  const [editDescription, setEditDescription] = useState("");

  const rulesQueryKey = useSessionQueryKey(["/api/manual-qty-rules"]);

  const { data: rules, isLoading } = useQuery<ManualQtyRule[]>({
    queryKey: rulesQueryKey,
  });

  const createMutation = useMutation({
    mutationFn: async (data: { ruleType: string; value: string; description: string }) => {
      const res = await apiRequest("POST", "/api/manual-qty-rules", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rulesQueryKey });
      setShowCreateDialog(false);
      resetCreateForm();
      toast({ title: "Regra criada", description: "A regra foi cadastrada com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro", description: "Falha ao criar regra", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ManualQtyRule> }) => {
      const res = await apiRequest("PATCH", `/api/manual-qty-rules/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rulesQueryKey });
      setEditingRule(null);
      toast({ title: "Regra atualizada", description: "As alterações foram salvas com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro", description: "Falha ao atualizar regra", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/manual-qty-rules/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rulesQueryKey });
      setDeletingRule(null);
      toast({ title: "Regra excluída", description: "A regra foi removida com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro", description: "Falha ao excluir regra", variant: "destructive" });
    },
  });

  const resetCreateForm = () => {
    setFormRuleType("product_code");
    setFormValue("");
    setFormDescription("");
  };

  const handleCreate = () => {
    if (!formValue.trim()) {
      toast({ title: "Erro", description: "O valor é obrigatório", variant: "destructive" });
      return;
    }
    createMutation.mutate({ ruleType: formRuleType, value: formValue.trim(), description: formDescription.trim() });
  };

  const handleEdit = (rule: ManualQtyRule) => {
    setEditingRule(rule);
    setEditRuleType(rule.ruleType);
    setEditValue(rule.value);
    setEditDescription(rule.description || "");
  };

  const handleUpdate = () => {
    if (!editingRule || !editValue.trim()) return;
    updateMutation.mutate({
      id: editingRule.id,
      data: { ruleType: editRuleType, value: editValue.trim(), description: editDescription.trim() },
    });
  };

  const handleToggleActive = (rule: ManualQtyRule) => {
    updateMutation.mutate({ id: rule.id, data: { active: !rule.active } });
  };

  const filteredRules = rules?.filter((rule) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      rule.value.toLowerCase().includes(term) ||
      (rule.description && rule.description.toLowerCase().includes(term))
    );
  });

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
            <h1 className="text-base font-semibold text-foreground leading-tight">Regras de Qtd. Manual</h1>
            <p className="text-xs text-muted-foreground">Produtos com entrada manual de quantidade</p>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filtrar por valor ou descrição..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button className="shrink-0" onClick={() => setShowCreateDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Adicionar Regra
          </Button>
        </div>

        <SectionCard title="Regras Cadastradas" icon={<SlidersHorizontal className="h-4 w-4 text-primary" />}>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredRules && filteredRules.length > 0 ? (
            <div className="overflow-x-auto -mx-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead className="hidden md:table-cell">Descrição</TableHead>
                    <TableHead>Ativo</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRules.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell>
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-0">
                          {ruleTypeLabels[rule.ruleType] || rule.ruleType}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono">{rule.value}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        {rule.description || <span className="text-muted-foreground text-xs italic">—</span>}
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={rule.active}
                          onCheckedChange={() => handleToggleActive(rule)}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(rule)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setDeletingRule(rule)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <SlidersHorizontal className="h-12 w-12 mx-auto mb-3 opacity-40" />
              <p>Nenhuma regra encontrada</p>
            </div>
          )}
        </SectionCard>
      </main>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar Regra</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Tipo de Regra</Label>
              <Select value={formRuleType} onValueChange={setFormRuleType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ruleTypeOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Valor</Label>
              <Input
                placeholder="Ex: P001; P005; P004 ou PLASTUBOS; AMANCO"
                value={formValue}
                onChange={(e) => setFormValue(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Para múltiplos valores, separe com ponto e vírgula (;). Ex: P001; P005; P004
              </p>
            </div>
            <div className="space-y-2">
              <Label>Descrição (opcional)</Label>
              <Input
                placeholder="Descrição da regra"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => { setShowCreateDialog(false); resetCreateForm(); }}>
                Cancelar
              </Button>
              <Button onClick={handleCreate} disabled={createMutation.isPending}>
                {createMutation.isPending ? "Criando..." : "Criar Regra"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingRule} onOpenChange={(open) => { if (!open) setEditingRule(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Regra</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Tipo de Regra</Label>
              <Select value={editRuleType} onValueChange={setEditRuleType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ruleTypeOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Valor</Label>
              <Input
                placeholder="Ex: P001; P005; P004 ou PLASTUBOS; AMANCO"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Para múltiplos valores, separe com ponto e vírgula (;). Ex: P001; P005; P004
              </p>
            </div>
            <div className="space-y-2">
              <Label>Descrição (opcional)</Label>
              <Input
                placeholder="Descrição da regra"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditingRule(null)}>
                Cancelar
              </Button>
              <Button onClick={handleUpdate} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingRule} onOpenChange={(open) => { if (!open) setDeletingRule(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Regra</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir esta regra? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingRule && deleteMutation.mutate(deletingRule.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
