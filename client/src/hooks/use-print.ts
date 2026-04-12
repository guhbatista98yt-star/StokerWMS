import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { PrintType } from "@/lib/print-config";

interface PrintConfig {
  printer: string;
  copies: number;
}

let configCache: Record<string, PrintConfig> | null = null;

export function invalidatePrintConfigCache() {
  configCache = null;
}

async function loadPrintConfig(): Promise<Record<string, PrintConfig>> {
  if (configCache) return configCache;
  const res = await apiRequest("GET", "/api/print/config");
  const data = await res.json() as { success: boolean; printConfig: Record<string, PrintConfig> };
  configCache = data.printConfig ?? {};
  return configCache;
}

const lastPrintTime: Record<string, number> = {};
const PRINT_COOLDOWN_MS = 5000;

export function usePrint() {
  const [printing, setPrinting] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const { toast } = useToast();

  async function print(htmlOrNull: string | null, printType: PrintType, templatePayload?: { template: string; data: Record<string, unknown> }) {
    const now = Date.now();
    const last = lastPrintTime[printType] ?? 0;
    if (now - last < PRINT_COOLDOWN_MS) return;

    let config: PrintConfig | undefined;
    try {
      const allConfigs = await loadPrintConfig();
      config = allConfigs[printType];
    } catch {
    }

    if (!config?.printer) {
      toast({
        title: "Impressora não configurada",
        description: "Solicite ao administrador que configure a impressora padrão para o seu usuário.",
        variant: "destructive",
      });
      return;
    }

    lastPrintTime[printType] = now;
    setPrinting(true);

    const body: Record<string, unknown> = {
      printer: config.printer,
      copies: config.copies ?? 1,
    };

    if (templatePayload) {
      body.template = templatePayload.template;
      body.data = templatePayload.data;
    } else if (htmlOrNull) {
      body.html = htmlOrNull;
    }

    apiRequest("POST", "/api/print/job", body).catch(() => {});

    setTimeout(() => setPrinting(false), 400);

    const totalSeconds = Math.ceil(PRINT_COOLDOWN_MS / 1000);
    setCooldownSeconds(totalSeconds);
    let remaining = totalSeconds;
    const interval = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(interval);
        setCooldownSeconds(0);
      } else {
        setCooldownSeconds(remaining);
      }
    }, 1000);
  }

  return { printing, cooldownSeconds, print };
}
