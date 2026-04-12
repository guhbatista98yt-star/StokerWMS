import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type StatusType =
  | "pendente"
  | "em_separacao"
  | "separado"
  | "em_conferencia"
  | "conferido"
  | "finalizado"
  | "cancelado"
  | "em_andamento"
  | "concluido"
  | "recontagem"
  | "excecao";

const statusConfig: Record<StatusType, { label: string; className: string }> = {
  pendente: {
    label: "Pendente",
    className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  },
  em_separacao: {
    label: "Em Separação",
    className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  },
  separado: {
    label: "Separado",
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  },
  em_conferencia: {
    label: "Em Conferência",
    className: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  },
  conferido: {
    label: "Conferido",
    className: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
  },
  finalizado: {
    label: "Finalizado",
    className: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  },
  cancelado: {
    label: "Cancelado",
    className: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  },
  em_andamento: {
    label: "Em Separação",
    className: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  },
  concluido: {
    label: "Concluído",
    className: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  },
  recontagem: {
    label: "Recontagem",
    className: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  },
  excecao: {
    label: "Exceção",
    className: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  },
};

interface StatusBadgeProps {
  status: StatusType | string;
  className?: string;
  hasExceptions?: boolean;
}

export function StatusBadge({ status, className, hasExceptions }: StatusBadgeProps) {
  const config = statusConfig[status as StatusType] || statusConfig.pendente;

  if (hasExceptions && (status === "separado" || status === "conferido" || status === "em_conferencia")) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "font-medium border-0",
          "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
          className
        )}
      >
        {config.label} com Exceção
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className={cn("font-medium border-0", config.className, className)}
    >
      {config.label}
    </Badge>
  );
}
