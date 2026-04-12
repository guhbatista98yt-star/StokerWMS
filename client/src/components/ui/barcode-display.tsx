import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

interface BarcodeDisplayProps {
  code: string | null | undefined;
  className?: string;
}

export function BarcodeDisplay({ code, className }: BarcodeDisplayProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || !code) return;
    try {
      JsBarcode(svgRef.current, code, {
        format: "CODE128",
        displayValue: false,
        height: 36,
        margin: 0,
        background: "transparent",
        lineColor: "currentColor",
        width: 1.4,
      });
    } catch {
      // barcode inválido — não renderiza
    }
  }, [code]);

  if (!code) {
    return <span className="font-mono text-muted-foreground">—</span>;
  }

  return (
    <div className={`flex flex-col items-start gap-0.5 ${className ?? ""}`}>
      <svg ref={svgRef} className="w-full max-w-[160px] h-9 text-foreground" />
      <span className="font-mono text-[10px] text-muted-foreground leading-none tracking-wider">
        {code}
      </span>
    </div>
  );
}
