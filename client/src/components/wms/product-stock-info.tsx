import { AlertTriangle, TrendingUp, TrendingDown } from "lucide-react";

interface ProductStockInfoProps {
  totalStock: number;
  palletizedStock: number;
  pickingStock: number;
  unit?: string;
  compact?: boolean;
}

/**
 * Exibe Real / Pallet / Pick em caixas grandes e legíveis para operadores.
 * compact=true → versão menor mas ainda bem legível (usada dentro de listas de itens)
 * compact=false → versão completa (3 cards lado a lado)
 */
export function ProductStockInfo({ totalStock, palletizedStock, pickingStock, unit = "un", compact = false }: ProductStockInfoProps) {
  const wmsTotal = palletizedStock + pickingStock;
  const difference = wmsTotal - totalStock;
  const hasDifference = difference !== 0;

  if (compact) {
    return (
      <div className="space-y-1.5">
        {/* Três blocos lado a lado */}
        <div className="grid grid-cols-3 gap-1.5">
          {/* Real */}
          <div className="flex flex-col items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 px-2 py-1.5">
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 leading-none mb-0.5">Real</span>
            <span className="font-mono font-bold text-base leading-none text-slate-800 dark:text-slate-100">
              {totalStock.toLocaleString("pt-BR")}
            </span>
          </div>
          {/* Pallet */}
          <div className="flex flex-col items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/40 border border-violet-200 dark:border-violet-800 px-2 py-1.5">
            <span className="text-[9px] font-bold uppercase tracking-wider text-violet-600 dark:text-violet-400 leading-none mb-0.5">Pallet</span>
            <span className="font-mono font-bold text-base leading-none text-violet-700 dark:text-violet-300">
              {palletizedStock.toLocaleString("pt-BR")}
            </span>
          </div>
          {/* Pick */}
          <div className="flex flex-col items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-900/40 border border-orange-200 dark:border-orange-800 px-2 py-1.5">
            <span className="text-[9px] font-bold uppercase tracking-wider text-orange-600 dark:text-orange-400 leading-none mb-0.5">Pick</span>
            <span className="font-mono font-bold text-base leading-none text-orange-700 dark:text-orange-300">
              {pickingStock.toLocaleString("pt-BR")}
            </span>
          </div>
        </div>

        {/* Alerta de discrepância */}
        {hasDifference && (
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-semibold ${
            difference > 0
              ? "bg-red-50 dark:bg-red-950/30 border border-red-200/60 dark:border-red-800/40 text-red-700 dark:text-red-400"
              : "bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/40 text-amber-700 dark:text-amber-400"
          }`}>
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span>
              {difference > 0
                ? `Excesso: +${difference.toLocaleString("pt-BR")} ${unit} (WMS > Real)`
                : `Falta: ${difference.toLocaleString("pt-BR")} ${unit} (WMS < Real)`
              }
            </span>
          </div>
        )}
      </div>
    );
  }

  // Versão completa (não-compact)
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        {/* Real */}
        <div className="flex flex-col items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 px-3 py-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">Real</span>
          <span className="font-mono font-extrabold text-2xl leading-none text-slate-800 dark:text-slate-100">
            {totalStock.toLocaleString("pt-BR")}
          </span>
          <span className="text-[9px] text-slate-400 mt-0.5">{unit}</span>
        </div>
        {/* Pallet */}
        <div className="flex flex-col items-center justify-center rounded-xl bg-violet-100 dark:bg-violet-900/40 border border-violet-200 dark:border-violet-800 px-3 py-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-violet-600 dark:text-violet-400 mb-1">Pallet</span>
          <span className="font-mono font-extrabold text-2xl leading-none text-violet-700 dark:text-violet-300">
            {palletizedStock.toLocaleString("pt-BR")}
          </span>
          <span className="text-[9px] text-violet-400 mt-0.5">{unit}</span>
        </div>
        {/* Pick */}
        <div className="flex flex-col items-center justify-center rounded-xl bg-orange-100 dark:bg-orange-900/40 border border-orange-200 dark:border-orange-800 px-3 py-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-orange-600 dark:text-orange-400 mb-1">Pick</span>
          <span className="font-mono font-extrabold text-2xl leading-none text-orange-700 dark:text-orange-300">
            {pickingStock.toLocaleString("pt-BR")}
          </span>
          <span className="text-[9px] text-orange-400 mt-0.5">{unit}</span>
        </div>
      </div>

      {hasDifference && (
        <div className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold ${
          difference > 0
            ? "bg-red-50 dark:bg-red-950/30 border border-red-200/60 dark:border-red-800/40 text-red-700 dark:text-red-400"
            : "bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/40 text-amber-700 dark:text-amber-400"
        }`}>
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            {difference > 0
              ? `Excesso: +${difference.toLocaleString("pt-BR")} ${unit} (WMS > Real)`
              : `Falta: ${difference.toLocaleString("pt-BR")} ${unit} (WMS < Real)`
            }
          </span>
        </div>
      )}
    </div>
  );
}

export function StockLegend() {
  return (
    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
      <span className="flex items-center gap-1">
        <span className="bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 font-bold px-1.5 py-0.5 rounded text-[9px]">PALLET</span>
        Pallets
      </span>
      <span className="flex items-center gap-1">
        <span className="bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 font-bold px-1.5 py-0.5 rounded text-[9px]">PICK</span>
        Gôndola
      </span>
    </div>
  );
}
