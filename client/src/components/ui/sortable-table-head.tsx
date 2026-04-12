import { cn } from "@/lib/utils";
import { TableHead } from "@/components/ui/table";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";

export type SortDirection = "asc" | "desc";
export interface SortState {
  key: string;
  direction: SortDirection;
}

interface SortableTableHeadProps {
  label: React.ReactNode;
  sortKey: string;
  sort: SortState | null;
  onSort: (key: string) => void;
  className?: string;
}

export function SortableTableHead({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: SortableTableHeadProps) {
  const isActive = sort?.key === sortKey;
  const direction = isActive ? sort!.direction : null;

  return (
    <TableHead
      onClick={() => onSort(sortKey)}
      className={cn(
        "select-none cursor-pointer group",
        "hover:bg-muted/60 transition-colors",
        isActive && "text-primary",
        className
      )}
    >
      <span className="flex items-center gap-1">
        {label}
        <span className={cn(
          "ml-0.5 shrink-0 transition-opacity",
          isActive ? "opacity-100" : "opacity-0 group-hover:opacity-40"
        )}>
          {direction === "asc" ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : direction === "desc" ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronsUpDown className="h-3.5 w-3.5" />
          )}
        </span>
      </span>
    </TableHead>
  );
}

/** Hook para gerenciar estado de ordenação de tabelas */
export function useSortState(defaultKey?: string, defaultDir: SortDirection = "desc") {
  return {
    initialState: defaultKey
      ? ({ key: defaultKey, direction: defaultDir } as SortState)
      : null,
  };
}

/** Função utilitária para ordenar uma array por um campo */
export function sortData<T>(
  data: T[],
  sort: SortState | null,
  getValue: (item: T, key: string) => string | number | boolean | null | undefined
): T[] {
  if (!sort) return data;
  const { key, direction } = sort;
  const mult = direction === "asc" ? 1 : -1;

  return [...data].sort((a, b) => {
    const aVal = getValue(a, key);
    const bVal = getValue(b, key);

    // Nulls/undefineds always at end
    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;

    if (typeof aVal === "number" && typeof bVal === "number") {
      return (aVal - bVal) * mult;
    }
    if (typeof aVal === "boolean" && typeof bVal === "boolean") {
      return ((aVal ? 1 : 0) - (bVal ? 1 : 0)) * mult;
    }
    const aStr = String(aVal).toLowerCase();
    const bStr = String(bVal).toLowerCase();
    return aStr.localeCompare(bStr, "pt-BR") * mult;
  });
}

/** Toggle sort: mesmo campo inverte direção, campo diferente começa em asc */
export function toggleSort(current: SortState | null, key: string): SortState {
  if (!current || current.key !== key) return { key, direction: "asc" };
  return { key, direction: current.direction === "asc" ? "desc" : "asc" };
}
