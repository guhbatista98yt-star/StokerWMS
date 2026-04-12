import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Printer, XCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { getPrintConfig, setPrintConfig, type PrintType } from "@/lib/print-config";

interface PrinterInfo {
  name: string;
  isDefault: boolean;
  status: string;
}

/**
 * Cache de impressoras para a sessão inteira.
 * O servidor já mantém o cache real — aqui só evitamos re-chamar a API
 * a cada abertura do modal durante a mesma sessão de navegação.
 */
let cachedPrinters: PrinterInfo[] | null = null;

async function fetchPrinters(): Promise<PrinterInfo[]> {
  if (cachedPrinters) return cachedPrinters;
  const res = await apiRequest("GET", "/api/print/printers");
  const data = await res.json() as { success: boolean; printers: PrinterInfo[]; default_printer?: string };
  if (!data.success) throw new Error("Erro ao listar impressoras");
  cachedPrinters = data.printers;
  return data.printers;
}

interface PrintModalProps {
  open: boolean;
  onClose: () => void;
  html: string | (() => string);
  title?: string;
  defaultCopies?: number;
  /** Tipo de impressão — usado para salvar/recuperar impressora padrão */
  printType?: PrintType;
  /** Chamado se a impressão falhar (para mostrar toast no componente pai) */
  onError?: (msg: string) => void;
}

export function PrintModal({
  open,
  onClose,
  html,
  title = "Imprimir",
  defaultCopies = 1,
  printType,
  onError,
}: PrintModalProps) {
  const [loading, setLoading] = useState(false);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState("");
  const [copies, setCopies] = useState(defaultCopies);
  const [saveDefault, setSaveDefault] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const firedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setErrorMsg("");
      setCopies(defaultCopies);
      setSaveDefault(false);
      firedRef.current = false;
      return;
    }

    const savedConfig = printType ? getPrintConfig(printType) : null;

    if (savedConfig) {
      // Impressora já configurada → disparar imediatamente e fechar
      const htmlContent = typeof html === "function" ? html() : html;
      onClose();
      fireAndForget(htmlContent, savedConfig.printer, savedConfig.copies);
    } else {
      // Sem configuração → mostrar seleção
      loadPrinters();
    }
  }, [open]);

  function fireAndForget(htmlContent: string, printer: string, numCopies: number) {
    apiRequest("POST", "/api/print/job", { html: htmlContent, printer, copies: numCopies })
      .then((res) => res.json())
      .then((data: { success: boolean; error?: string }) => {
        if (!data.success) onError?.(data.error ?? "Erro ao imprimir.");
      })
      .catch((e: Error) => {
        onError?.(e.message ?? "Erro de conexão ao imprimir.");
      });
  }

  async function loadPrinters() {
    setLoading(true);
    setErrorMsg("");
    try {
      const list = await fetchPrinters();
      setPrinters(list);
      const def = list.find((p) => p.isDefault)?.name ?? list[0]?.name ?? "";
      setSelectedPrinter(def);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Não foi possível obter impressoras do servidor.");
    } finally {
      setLoading(false);
    }
  }

  function handlePrint() {
    if (!selectedPrinter) return;
    if (saveDefault && printType) {
      setPrintConfig(printType, { printer: selectedPrinter, copies });
    }
    const htmlContent = typeof html === "function" ? html() : html;
    onClose();
    fireAndForget(htmlContent, selectedPrinter, copies);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" />
            {title}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Selecione a impressora e confirme o envio do trabalho de impressão.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Carregando impressoras...
          </div>
        )}

        {!loading && errorMsg && (
          <div className="flex flex-col gap-3 py-1">
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
              {errorMsg}
            </div>
          </div>
        )}

        {!loading && !errorMsg && printers.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            Nenhuma impressora encontrada no servidor.
          </p>
        )}

        {!loading && !errorMsg && printers.length > 0 && (
          <div className="flex flex-col gap-4 py-1">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="printer-select">Impressora</Label>
              <Select value={selectedPrinter} onValueChange={setSelectedPrinter}>
                <SelectTrigger id="printer-select" data-testid="select-printer">
                  <SelectValue placeholder="Selecione uma impressora" />
                </SelectTrigger>
                <SelectContent>
                  {printers.map((p) => (
                    <SelectItem key={p.name} value={p.name} data-testid={`printer-option-${p.name}`}>
                      {p.name}{p.isDefault && <span className="ml-2 text-xs text-muted-foreground">(padrão)</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="copies-input">Cópias</Label>
              <Input
                id="copies-input"
                type="number"
                min={1}
                max={99}
                value={copies}
                onChange={(e) => setCopies(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-24"
                data-testid="input-copies"
              />
            </div>

            {printType && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="save-default"
                  checked={saveDefault}
                  onCheckedChange={(v) => setSaveDefault(!!v)}
                  data-testid="checkbox-save-default"
                />
                <Label htmlFor="save-default" className="font-normal cursor-pointer text-sm">
                  Sempre usar esta impressora para este tipo
                </Label>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {errorMsg && (
            <>
              <Button variant="ghost" onClick={onClose} data-testid="btn-print-cancel">Cancelar</Button>
              <Button onClick={loadPrinters} data-testid="btn-print-retry">Tentar novamente</Button>
            </>
          )}
          {!loading && !errorMsg && (
            <>
              <Button variant="ghost" onClick={onClose} data-testid="btn-print-cancel">Cancelar</Button>
              <Button
                onClick={handlePrint}
                disabled={!selectedPrinter || printers.length === 0}
                data-testid="btn-print-confirm"
              >
                <Printer className="mr-2 h-4 w-4" />
                Imprimir
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
