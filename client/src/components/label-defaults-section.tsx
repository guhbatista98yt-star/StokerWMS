import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tag } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  type LabelTemplate, type LabelContext, labelContextEnum, LABEL_CONTEXT_LABELS,
} from "@shared/schema";

export function LabelDefaultsSection() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: templates = [] } = useQuery<LabelTemplate[]>({
    queryKey: ["/api/labels/templates"],
  });

  const { data: defaults = {} } = useQuery<Record<string, string | null>>({
    queryKey: ["/api/labels/defaults"],
  });

  const setDefault = useMutation({
    mutationFn: async ({ context, templateId }: { context: LabelContext; templateId: string | null }) => {
      const res = await apiRequest("PUT", `/api/labels/defaults/${context}`, { templateId });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/labels/defaults"] });
      toast({ title: "Modelo padrão atualizado" });
    },
    onError: () => toast({ title: "Erro ao atualizar padrão", variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Tag className="h-4 w-4 text-muted-foreground" />
          Modelos Padrão por Contexto
        </CardTitle>
        <CardDescription className="text-xs">
          Modelo aplicado automaticamente nas impressões de cada tipo de etiqueta.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {labelContextEnum.map(ctx => {
          const ctxTemplates = templates.filter(t => t.context === ctx && t.active);
          const currentId = defaults[ctx] ?? "";
          return (
            <div key={ctx} className="flex items-center gap-2">
              <span className="text-xs font-medium w-32 shrink-0">{LABEL_CONTEXT_LABELS[ctx]}</span>
              <Select
                value={currentId || "__none__"}
                onValueChange={v => setDefault.mutate({ context: ctx, templateId: v === "__none__" ? null : v })}
              >
                <SelectTrigger className="h-8 text-xs" data-testid={`select-default-${ctx}`}>
                  <SelectValue placeholder="Sem modelo padrão" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" className="text-xs">Sem modelo (padrão do sistema)</SelectItem>
                  {ctxTemplates.map(t => (
                    <SelectItem key={t.id} value={t.id} className="text-xs">
                      {t.name}{t.companyId === null ? " (Sistema)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
