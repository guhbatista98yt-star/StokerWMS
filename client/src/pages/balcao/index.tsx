import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth, useSessionQueryKey } from "@/lib/auth";
import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import { DateRange } from "react-day-picker";
import { ScanInput } from "@/components/ui/scan-input";
import { ResultDialog } from "@/components/ui/result-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useSSE } from "@/hooks/use-sse";
import { useBarcodeScanner } from "@/hooks/use-barcode-scanner";
import { useScanWebSocket, generateMsgId } from "@/hooks/use-scan-websocket";
import { ConnectionStatusIndicator } from "@/components/connection-status";
import {
  Store,
  Package,
  List,
  LogOut,
  Check,
  AlertTriangle,
  Search,
  ArrowRight,
  Calendar,
  Timer,
  Lock,
  X,
  SlidersHorizontal,
  ChevronDown,
  Volume2,
  VolumeX,
  BarChart2,
  MapPin as MapPinIcon,
  Loader2,
  Barcode as BarcodeIcon,
  Keyboard,
  Pause,
  Trash2,
  Link2,
} from "lucide-react";
import { beep, getSoundEnabled, setSoundEnabled as persistSoundEnabled } from "@/lib/audio-feedback";
import { QuickLinkBarcodeModal } from "@/components/quick-link-barcode-modal";
import { ScanQuantityModal } from "@/components/ui/scan-quantity-modal";
import type { WorkUnitWithDetails, OrderItem, Product, ExceptionType, UserSettings, Exception } from "@shared/schema";
import { ExceptionDialog } from "@/components/orders/exception-dialog";
import { ExceptionAuthorizationModal } from "@/components/orders/exception-authorization-modal";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { getCurrentWeekRange } from "@/lib/date-utils";
import { format } from "date-fns";

import { usePendingDeltaStore } from "@/lib/pendingDeltaStore";
import { useProductAddressesBatch, type ProductAddress } from "@/hooks/use-product-stock";
import { CheckCircle2 } from "lucide-react";

type BalcaoStep = "select" | "picking";
type PickingTab = "product" | "list";

const STORAGE_KEY = "wms:balcao-session";

interface SessionData {
  tab: PickingTab;
  productIndex: number;
  workUnitIds: string[];
}

interface ItemWithProduct extends OrderItem {
  product: Product;
  exceptionQty?: number;
  exceptions?: Exception[];
}

interface AggregatedProduct {
  product: Product;
  totalQty: number;
  separatedQty: number;
  exceptionQty: number;
  items: ItemWithProduct[];
  orderCodes: string[];
  sections: string[];
}

function saveSession(data: SessionData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { }
}

function loadSession(): SessionData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { }
  return null;
}

function clearSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { }
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export default function BalcaoPage() {
  const { user, logout, companyId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<BalcaoStep>("select");
  const [selectedWorkUnits, setSelectedWorkUnits] = useState<string[]>([]);
  const [pickingTab, setPickingTab] = useState<PickingTab>("list");
  const [currentProductIndex, setCurrentProductIndex] = useState(0);

  const [selectedAddresses, setSelectedAddresses] = useState<Record<string, { code: string; addressId: string; quantity: number } | null>>({});

  const [scanStatus, setScanStatus] = useState<"idle" | "success" | "error" | "warning">("idle");
  const [scanMessage, setScanMessage] = useState("");
  const [soundOn, setSoundOn] = useState(getSoundEnabled);
  const [showResultDialog, setShowResultDialog] = useState(false);
  const [resultDialogConfig, setResultDialogConfig] = useState({
    type: "success" as "success" | "error" | "warning",
    title: "",
    message: "",
  });

  const [elapsedTime, setElapsedTime] = useState(0);

  const [overQtyModalOpen, setOverQtyModalOpen] = useState(false);
  const overQtyModalOpenRef = useRef(false);
  const [overQtyContext, setOverQtyContext] = useState<{
    productName: string;
    itemIds: string[];
    workUnitId: string;
    barcode: string;
    targetQty: number;
    message: string;
    serverAlreadyReset: boolean;
  } | null>(null);

  const scanWorkerRunningRef = useRef(false);
  const scanQueueRef = useRef<string[]>([]);
  const activeSessionTokenRef = useRef("");
  const syncTimerRef = useRef<NodeJS.Timeout | null>(null);

  type PendingScanCtx = { itemId: string; qty: number; barcode: string; workUnitId: string; apItems: { id: string }[]; productName: string; targetQty: number; exceptionQty: number; retryCount?: number };
  const pendingScanContextRef = useRef<Map<string, PendingScanCtx>>(new Map());
  const sendScanRef = useRef<any>(null);

  interface QtyModalData {
    productId: string;
    productName: string;
    productCode: string;
    multiplier: number;
    accumulated: number;
    itemId: string;
    workUnitId: string;
    barcode: string;
    maxRemaining: number;
    targetQty: number;
    exceptionQty: number;
  }
  const [qtyModal, setQtyModal] = useState<QtyModalData | null>(null);
  const qtyModalRef = useRef<QtyModalData | null>(null);
  qtyModalRef.current = qtyModal;

  useEffect(() => {
    if (scanStatus !== "idle") {
      const timer = setTimeout(() => {
        setScanStatus("idle");
        setScanMessage("");
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [scanStatus]);

  const [showExceptionDialog, setShowExceptionDialog] = useState(false);
  const [exceptionItem, setExceptionItem] = useState<ItemWithProduct | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [pendingExceptions, setPendingExceptions] = useState<any[]>([]);

  const [abandonConfirmOpen, setAbandonConfirmOpen] = useState(false);
  const [showQuickLinkModal, setShowQuickLinkModal] = useState(false);
  const [showStockModal, setShowStockModal] = useState(false);
  const [stockQuery, setStockQuery] = useState("");
  const [stockDebouncedQuery, setStockDebouncedQuery] = useState("");
  const [stockKeyboard, setStockKeyboard] = useState(false);
  const stockQueryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stockInputRef = useRef<HTMLInputElement>(null);

  const [filterOrderId, setFilterOrderId] = useState("");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(getCurrentWeekRange());
  const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>(getCurrentWeekRange());
  const [showFilters, setShowFilters] = useState(false);

  const [sessionRestored, setSessionRestored] = useState(false);


  const workUnitsQueryKey = useSessionQueryKey(["/api/work-units?type=balcao"]);

  const { data: featureSettings } = useQuery<{ quickLinkEnabled: boolean }>({
    queryKey: ["/api/system-settings/features"],
    staleTime: 60_000,
  });

  const { data: workUnits, isLoading } = useQuery<WorkUnitWithDetails[]>({
    queryKey: workUnitsQueryKey,
    refetchInterval: () =>
      scanWorkerRunningRef.current || scanQueueRef.current.length > 0 ? false : 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const pendingInvalidateRef = useRef(false);

  useEffect(() => {
    activeSessionTokenRef.current = selectedWorkUnits.join(",") + "|" + step;
  }, [selectedWorkUnits, step]);

  useEffect(() => {
    if (!workUnits || !user) return;
    const myUnits = workUnits.filter(wu => wu.lockedBy === user.id);
    const serverValues: Record<string, number> = {};
    for (const wu of myUnits) {
      for (const item of (wu.items as ItemWithProduct[])) {
        if (!serverValues[item.id]) {
          serverValues[item.id] = Number(item.separatedQty);
        }
      }
    }
    usePendingDeltaStore.getState().reconcile("balcao", serverValues);
  }, [workUnits, user]);


  useEffect(() => {
    const handleOnline = () => {
      queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
    };
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
      scanWorkerRunningRef.current = false;
      scanQueueRef.current = [];
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [queryClient, workUnitsQueryKey]);

  useEffect(() => {
    overQtyModalOpenRef.current = overQtyModalOpen;
  }, [overQtyModalOpen]);

  const handleSSEMessage = useCallback((type: string, _data: any) => {
    if (scanWorkerRunningRef.current || scanQueueRef.current.length > 0) {
      pendingInvalidateRef.current = true;
      return;
    }
    queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
    if (type === "exception_created") {
      toast({
        title: "Novo Problema Relatado",
        description: "Um problema foi registrado",
        variant: "destructive",
      });
    }
  }, [queryClient, workUnitsQueryKey, toast]);

  useSSE("/api/sse", [
    "picking_update", "lock_acquired", "lock_released", "picking_started",
    "item_picked", "exception_created", "picking_finished",
    "orders_launched", "orders_relaunched", "work_units_unlocked",
    "orders_launch_cancelled", "work_unit_created",
    "conference_started", "conference_finished",
  ], handleSSEMessage);

  const myLockedUnits = useMemo(() => {
    if (!workUnits || !user) return [];
    return workUnits.filter(wu => wu.lockedBy === user.id && wu.status !== "concluido");
  }, [workUnits, user]);

  const allMyUnits = useMemo(() => {
    if (!workUnits || !user) return [];
    return workUnits.filter(wu => wu.lockedBy === user.id && wu.status !== "concluido");
  }, [workUnits, user]);

  useEffect(() => {
    if (step === "picking" && allMyUnits.length === 0 && !isLoading) {
      setStep("select");
      setSelectedWorkUnits([]);
    }
  }, [step, allMyUnits.length, isLoading]);

  const pendingBalcao = usePendingDeltaStore((s) => s.balcao);

  const aggregatedProducts = useMemo((): AggregatedProduct[] => {
    const units = allMyUnits.length > 0 ? allMyUnits : [];
    const allItems: ItemWithProduct[] = units.flatMap(wu => (wu.items as ItemWithProduct[]) || []);

    const seenItemIds = new Set<string>();
    const map: Record<string, AggregatedProduct> = {};
    allItems.forEach(item => {
      if (seenItemIds.has(item.id)) return;
      seenItemIds.add(item.id);
      const pid = item.productId;
      if (!map[pid]) {
        map[pid] = {
          product: item.product,
          totalQty: 0,
          separatedQty: 0,
          exceptionQty: 0,
          items: [],
          orderCodes: [],
          sections: [],
        };
      }
      map[pid].totalQty += Number(item.quantity);
      map[pid].separatedQty += Number(item.separatedQty) + (pendingBalcao[item.id] || 0);
      map[pid].exceptionQty += Number(item.exceptionQty || 0);
      map[pid].items.push(item);

      const wu = units.find(w => w.items.some(i => i.id === item.id));
      if (wu && !map[pid].orderCodes.includes(wu.order.erpOrderId)) {
        map[pid].orderCodes.push(wu.order.erpOrderId);
      }
      if (item.section && !map[pid].sections.includes(item.section)) {
        map[pid].sections.push(item.section);
      }
    });

    return Object.values(map).sort((a, b) =>
      a.product.name.localeCompare(b.product.name, "pt-BR", { sensitivity: "base" })
    );
  }, [allMyUnits, user, pendingBalcao]);

  const currentProduct = aggregatedProducts[currentProductIndex] || aggregatedProducts[0] || null;

  useEffect(() => {
    if (currentProduct && step === "picking" && !showResultDialog && !overQtyModalOpen) {
      const remaining = currentProduct.totalQty - currentProduct.separatedQty - currentProduct.exceptionQty;
      const isComplete = remaining <= 0;
      if (isComplete && currentProduct.separatedQty > 0) {
        const nextIdx = aggregatedProducts.findIndex((ap, idx) => {
          if (idx <= currentProductIndex) return false;
          const r = ap.totalQty - ap.separatedQty - ap.exceptionQty;
          return r > 0;
        });

        if (nextIdx >= 0 && nextIdx !== currentProductIndex) {
          const timer = setTimeout(() => setCurrentProductIndex(nextIdx), 500);
          return () => clearTimeout(timer);
        } else {
          const wrapIdx = aggregatedProducts.findIndex((ap) => {
            const r = ap.totalQty - ap.separatedQty - ap.exceptionQty;
            return r > 0;
          });
          if (wrapIdx >= 0 && wrapIdx !== currentProductIndex) {
            const timer = setTimeout(() => setCurrentProductIndex(wrapIdx), 500);
            return () => clearTimeout(timer);
          }
        }
      }
    }
  }, [currentProduct?.separatedQty, currentProduct?.totalQty, step, aggregatedProducts, currentProductIndex, showResultDialog, overQtyModalOpen]);

  useEffect(() => {
    if (aggregatedProducts.length > 0 && currentProductIndex >= aggregatedProducts.length) {
      setCurrentProductIndex(0);
    }
  }, [aggregatedProducts.length, currentProductIndex]);

  const productIds = useMemo(() => aggregatedProducts.map(ap => ap.product.id), [aggregatedProducts]);
  const { data: addressesMap } = useProductAddressesBatch(productIds);

  const { data: stockProducts = [], isLoading: stockLoading } = useQuery<any[]>({
    queryKey: [`/api/products/search?q=${encodeURIComponent(stockDebouncedQuery)}`, companyId],
    enabled: !!companyId && stockDebouncedQuery.length >= 2,
  });

  const handleStockSearch = useCallback((value: string) => {
    setStockQuery(value);
    if (stockQueryTimer.current) clearTimeout(stockQueryTimer.current);
    stockQueryTimer.current = setTimeout(() => setStockDebouncedQuery(value), 350);
  }, []);


  useEffect(() => {
    if (workUnits && user && !sessionRestored) {
      setSessionRestored(true);
      const saved = loadSession();
      if (saved && saved.workUnitIds.length > 0) {
        const stillLockedIds = saved.workUnitIds.filter(id =>
          workUnits.some(wu => wu.id === id && wu.lockedBy === user.id)
        );
        if (stillLockedIds.length > 0) {
          // Sync timer from server lockedAt so it survives page reload
          const lockedWUs = stillLockedIds
            .map(id => workUnits.find(wu => wu.id === id))
            .filter((wu): wu is NonNullable<typeof wu> => !!wu);
          const earliest = lockedWUs
            .map(wu => wu.lockedAt ? new Date(wu.lockedAt).getTime() : null)
            .filter((t): t is number => t !== null)
            .sort((a, b) => a - b)[0];
          if (earliest) {
            setElapsedTime(Math.max(0, Math.floor((Date.now() - earliest) / 1000)));
          }
          setStep("picking");
          setPickingTab(saved.tab);
          setCurrentProductIndex(0);
          setSelectedWorkUnits(stillLockedIds);
          return;
        } else {
          clearSession();
        }
      }

      const myUnit = workUnits.find(wu => wu.lockedBy === user.id && wu.status !== "concluido");
      if (myUnit) {
        const myIds = workUnits.filter(wu => wu.lockedBy === user.id).map(wu => wu.id);
        // Sync timer from server lockedAt
        const earliest = myIds
          .map(id => workUnits.find(wu => wu.id === id)?.lockedAt)
          .filter((t): t is string => !!t)
          .map(t => new Date(t).getTime())
          .sort((a, b) => a - b)[0];
        if (earliest) {
          setElapsedTime(Math.max(0, Math.floor((Date.now() - earliest) / 1000)));
        }
        setStep("picking");
        setSelectedWorkUnits(myIds);
      }
    }
  }, [workUnits, user, sessionRestored, toast]);

  useEffect(() => {
    if (step === "picking" && allMyUnits.length > 0) {
      saveSession({
        tab: pickingTab,
        productIndex: currentProductIndex,
        workUnitIds: allMyUnits.map(wu => wu.id),
      });
    }
  }, [step, pickingTab, currentProductIndex, allMyUnits]);

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (step === "picking" && allMyUnits.length > 0) {
      interval = setInterval(() => {
        // Compute from server's lockedAt so timer stays in sync with Fila de Pedidos
        const earliest = allMyUnitsHeartbeatRef.current
          .map(wu => wu.lockedAt ? new Date(wu.lockedAt).getTime() : null)
          .filter((t): t is number => t !== null)
          .sort((a, b) => a - b)[0];
        if (earliest) {
          setElapsedTime(Math.max(0, Math.floor((Date.now() - earliest) / 1000)));
        } else {
          setElapsedTime((prev) => prev + 1);
        }
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [step, allMyUnits.length]);

  // Ref para acessar allMyUnits dentro do interval sem recriá-lo a cada refetch
  const allMyUnitsHeartbeatRef = useRef(allMyUnits);
  allMyUnitsHeartbeatRef.current = allMyUnits;

  // Renova o lock a cada 4 minutos — depende só de `step` para não resetar o interval a cada refetch
  useEffect(() => {
    if (step !== "picking") return;
    const sendHeartbeat = () => {
      if (allMyUnitsHeartbeatRef.current.length === 0) return;
      allMyUnitsHeartbeatRef.current.forEach(wu => {
        apiRequest("POST", `/api/work-units/${wu.id}/heartbeat`, {}).catch(() => {});
      });
    };
    sendHeartbeat(); // dispara imediatamente ao entrar em picking
    const interval = setInterval(sendHeartbeat, 4 * 60 * 1000);
    return () => clearInterval(interval);
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ao reconectar a rede ou retornar ao app, renova o lock imediatamente
  useEffect(() => {
    if (step !== "picking") return;
    const renewLock = () => {
      if (allMyUnitsHeartbeatRef.current.length === 0) return;
      allMyUnitsHeartbeatRef.current.forEach(wu => {
        apiRequest("POST", `/api/work-units/${wu.id}/heartbeat`, {}).catch(() => {});
      });
    };
    const handleOnline = () => {
      renewLock();
      toast({ title: "Conexão restaurada", description: "Lock renovado automaticamente." });
    };
    const handleOffline = () => {
      toast({
        title: "Sem conexão",
        description: "Seu lock continua ativo por até 60 minutos. Não feche a tela.",
        variant: "destructive",
      });
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") renewLock();
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [step, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  const lockMutation = useMutation({
    mutationFn: async (workUnitIds: string[]) => {
      const res = await apiRequest("POST", "/api/work-units/lock", { workUnitIds });
      return res.json();
    },
    onError: (error: Error) => {
      beep("error");
      toast({ title: "Erro", description: error.message || "Falha ao bloquear unidades", variant: "destructive" });
    },
  });

  const unlockMutation = useMutation({
    mutationFn: async (data: string[] | { ids: string[], reset: boolean }) => {
      const body = Array.isArray(data)
        ? { workUnitIds: data }
        : { workUnitIds: data.ids, reset: data.reset };
      const res = await apiRequest("POST", "/api/work-units/unlock", body);
      if (!res.ok) throw new Error("Erro ao desbloquear unidades");
      return res.json();
    },
    onMutate: async (data) => {
      const ids = Array.isArray(data) ? data : data.ids;
      const isReset = !Array.isArray(data) && data.reset;
      await queryClient.cancelQueries({ queryKey: workUnitsQueryKey });
      queryClient.setQueryData(workUnitsQueryKey, (old: any) => {
        if (!old) return old;
        return old.map((wu: any) => {
          if (!ids.includes(wu.id)) return wu;
          return {
            ...wu,
            lockedBy: null,
            lockedAt: null,
            lockExpiresAt: null,
            ...(isReset ? { status: "pendente", startedAt: null, completedAt: null } : {}),
          };
        });
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
    },
  });


  const createExceptionMutation = useMutation({
    mutationFn: async (data: {
      workUnitId: string;
      orderItemId: string;
      type: ExceptionType;
      quantity: number;
      observation: string;
    }) => {
      const res = await apiRequest("POST", "/api/exceptions", data);
      return { ...(await res.json()), _orderItemId: data.orderItemId };
    },
    onSuccess: async (data) => {
      usePendingDeltaStore.getState().clearItem("balcao", data._orderItemId);
      usePendingDeltaStore.getState().resetBaseline("balcao", data._orderItemId);
      await queryClient.refetchQueries({ queryKey: workUnitsQueryKey });
      toast({ title: "Problema Registrado", description: "O problema foi reportado com sucesso" });
      setShowExceptionDialog(false);
      setExceptionItem(null);
    },
    onError: (error: Error) => {
      beep("error");
      let message = "Falha ao registrar problema";
      try {
        const errorData = JSON.parse(error.message);
        if (errorData.error) message = errorData.error;
      } catch { }
      toast({ title: "Erro", description: message, variant: "destructive" });
    },
  });

  const finalizeMutation = useMutation({
    mutationFn: async (payload: { workUnitIds: string[]; deductions: any[]; finalOrderStatus?: string }) => {
      const res = await apiRequest("POST", "/api/picking/finalize-separation", payload);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Erro ao finalizar atendimento");
      }
      return res.json() as Promise<{ ok: boolean; completed: string[]; unlocked: string[] }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
    },
  });

  const clearExceptionsMutation = useMutation({
    mutationFn: async (orderItemId: string) => {
      const res = await apiRequest("DELETE", `/api/exceptions/item/${orderItemId}`);
      return { ...(await res.json()), _orderItemId: orderItemId };
    },
    onSuccess: async (data) => {
      usePendingDeltaStore.getState().clearItem("balcao", data._orderItemId);
      usePendingDeltaStore.getState().resetBaseline("balcao", data._orderItemId);
      await queryClient.refetchQueries({ queryKey: workUnitsQueryKey });
      toast({ title: "Exceções Limpas", description: "As exceções foram removidas com sucesso" });
    },
    onError: () => {
      beep("error");
      toast({ title: "Erro", description: "Falha ao limpar exceções", variant: "destructive" });
    },
  });

  // Helper para busca múltipla por vírgula
  const processMultipleOrderSearch = (searchValue: string, orderCode: string): boolean => {
    if (!searchValue.trim()) return true;
    if (searchValue.includes(',')) {
      const terms = searchValue.split(',').map(t => t.trim().toLowerCase()).filter(t => t);
      return terms.some(term => orderCode.toLowerCase().includes(term));
    }
    return orderCode.toLowerCase().includes(searchValue.toLowerCase());
  };

  const availableWorkUnits = useMemo(() => {
    return workUnits?.filter((wu) => {
      if (wu.order.status === "finalizado") return false;
      if (wu.status === "concluido") return false;
      if (!wu.order.isLaunched) return false;

      if (filterOrderId && !processMultipleOrderSearch(filterOrderId, wu.order.erpOrderId)) return false;

      if (dateRange?.from) {
        const orderDate = new Date(wu.order.launchedAt || wu.order.createdAt);
        const fromDate = new Date(dateRange.from);
        fromDate.setHours(0, 0, 0, 0);
        if (dateRange.to) {
          const toDate = new Date(dateRange.to);
          toDate.setHours(23, 59, 59, 999);
          if (orderDate < fromDate || orderDate > toDate) return false;
        } else {
          if (orderDate < fromDate) return false;
        }
      }

      return true;
    }) || [];
  }, [workUnits, user, filterOrderId, dateRange]);

  const groupedWorkUnits = useMemo(() => {
    const groups: Record<string, typeof availableWorkUnits> = {};
    availableWorkUnits.forEach((wu) => {
      if (!groups[wu.orderId]) groups[wu.orderId] = [];
      groups[wu.orderId].push(wu);
    });
    return Object.values(groups);
  }, [availableWorkUnits]);

  const handleSelectGroup = (wus: typeof availableWorkUnits, checked: boolean) => {
    const filteredWus = wus.filter(wu => !wu.lockedBy || wu.lockedBy === user?.id);
    if (filteredWus.length === 0) return;
    const ids = filteredWus.map((wu) => wu.id);
    if (checked) {
      setSelectedWorkUnits(ids);
    } else {
      setSelectedWorkUnits([]);
    }
  };

  const handleStartBalcao = async () => {
    if (selectedWorkUnits.length === 0) {
      toast({ title: "Atenção", description: "Selecione pelo menos um pedido", variant: "destructive" });
      return;
    }
    try {
      await lockMutation.mutateAsync(selectedWorkUnits);
      const selectedSet = new Set(selectedWorkUnits);
      queryClient.setQueryData<WorkUnitWithDetails[]>(workUnitsQueryKey, (old) => {
        if (!old) return old;
        return old.map(wu =>
          selectedSet.has(wu.id)
            ? { ...wu, lockedBy: user!.id, status: wu.status === "pendente" ? "em_andamento" : wu.status }
            : wu
        );
      });
      setStep("picking");
      setPickingTab("list");
      setCurrentProductIndex(0);
      setElapsedTime(0);
      setScanStatus("idle");
      setScanMessage("");
      queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
    } catch {
      toast({ title: "Erro", description: "Falha ao bloquear unidades de trabalho", variant: "destructive" });
    }
  };

  const handleCompleteAll = async () => {
    const allExceptions: Exception[] = [];
    allMyUnits.forEach(wu => {
      wu.items.forEach((item: ItemWithProduct) => {
        if (item.exceptions && item.exceptions.length > 0) {
          item.exceptions.forEach((exc: Exception) => {
            if (!exc.authorizedBy) {
              allExceptions.push({
                ...exc,
                orderItem: {
                  ...item,
                  order: wu.order,
                },
              } as any);
            }
          });
        }
      });
    });

    if (allExceptions.length > 0) {
      const userSettings = user?.settings as UserSettings;
      if (userSettings?.canAuthorizeOwnExceptions) {
        try {
          await apiRequest("POST", "/api/exceptions/auto-authorize", {
            exceptionIds: allExceptions.map(e => e.id),
          });
          toast({ title: "Auto-autorização", description: "Exceções autorizadas automaticamente." });
        } catch (error) {
          toast({ title: "Erro", description: "Falha ao auto-autorizar exceções", variant: "destructive" });
          return;
        }
      } else {
        setPendingExceptions(allExceptions);
        setShowAuthModal(true);
        return;
      }
    }

    await finalizeWorkUnits();
  };

  const finalizeWorkUnits = async () => {
    scanQueueRef.current = [];
    setQtyModal(null);
    pendingScanContextRef.current.clear();
    clearWsQueue();

    // Enviar deduções de endereço para os produtos com endereço selecionado
    const deductions = aggregatedProducts
      .filter(ap => selectedAddresses[ap.product.id])
      .map(ap => {
        const addr = selectedAddresses[ap.product.id]!;
        const wu = allMyUnits.find(w => w.items.some(it => it.productId === ap.product.id));
        return {
          productId: ap.product.id,
          addressId: addr.addressId,
          quantity: ap.separatedQty,
          orderId: wu?.orderId,
          erpOrderId: wu?.order.erpOrderId,
          workUnitId: wu?.id,
        };
      })
      .filter(d => d.quantity > 0);

    setSelectedAddresses({});

    try {
      // S1-02: deduções e conclusão de WU numa única transação atômica no servidor
      const result = await finalizeMutation.mutateAsync({
        workUnitIds: allMyUnits.map(wu => wu.id),
        deductions,
        finalOrderStatus: "finalizado",
      });
      const anyUnlock = result.unlocked && result.unlocked.length > 0;
      setStep("select");
      setSelectedWorkUnits([]);
      clearSession();
      usePendingDeltaStore.getState().clear("balcao");
      beep("complete");
      if (anyUnlock) {
        toast({ title: "Salvo", description: "Sua parte foi concluída. Atendimento parcial salvo.", variant: "default" });
      } else {
        toast({ title: "Concluído", description: "Atendimento finalizado com sucesso", variant: "default" });
      }
    } catch (error) {
      beep("error");
      const detail = error instanceof Error ? error.message : "Falha ao finalizar atendimento";
      toast({ title: "Erro", description: detail, variant: "destructive" });
    }
  };

  const handleExceptionAuthorized = async () => {
    await queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
    await finalizeWorkUnits();
  };

  const handleWsScanAck = useCallback((ack: any) => {
    const ctx = pendingScanContextRef.current.get(ack.msgId);
    if (!ctx) return;
    pendingScanContextRef.current.delete(ack.msgId);

    if (ack.status === "success") {
      queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
    } else if (ack.status === "over_quantity" || ack.status === "over_quantity_with_exception") {
      beep("error");
      ctx.apItems.forEach(item => {
        usePendingDeltaStore.getState().clearItem("balcao", item.id);
        usePendingDeltaStore.getState().resetBaseline("balcao", item.id);
      });
      queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
      setOverQtyContext({
        productName: ctx.productName,
        itemIds: ctx.apItems.map(i => i.id),
        workUnitId: ctx.workUnitId,
        barcode: ctx.barcode,
        targetQty: ctx.targetQty,
        message: ack.message || `Quantidade de "${ctx.productName}" excedeu o máximo (${ctx.targetQty}). A coleta foi reiniciada.`,
        serverAlreadyReset: true,
      });
      setOverQtyModalOpen(true);
      overQtyModalOpenRef.current = true;
    } else if (ack.status === "not_found") {
      beep("warning");
      usePendingDeltaStore.getState().dec("balcao", ctx.itemId, ctx.qty);
      setScanStatus("warning");
      setScanMessage("Produto não encontrado neste pedido");
    } else if (ack.status === "error") {
      const isLockExpired = (ack.message || "").includes("Lock expirado");
      if (isLockExpired && (ctx.retryCount ?? 0) < 1 && sendScanRef.current) {
        allMyUnitsHeartbeatRef.current.forEach(wu => {
          apiRequest("POST", `/api/work-units/${wu.id}/heartbeat`, {}).catch(() => {});
        });
        setTimeout(() => {
          if (!sendScanRef.current) return;
          const newMsgId = generateMsgId();
          pendingScanContextRef.current.set(newMsgId, { ...ctx, retryCount: (ctx.retryCount ?? 0) + 1 });
          sendScanRef.current(ctx.workUnitId, ctx.barcode, ctx.qty, newMsgId);
        }, 700);
        return;
      }
      beep("error");
      usePendingDeltaStore.getState().dec("balcao", ctx.itemId, ctx.qty);
      setScanStatus("error");
      setScanMessage(isLockExpired ? "Sessão expirada — saia e entre novamente no pedido" : (ack.message || "Erro ao processar leitura"));
    }
  }, [queryClient, workUnitsQueryKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const wsNamespace = `balcao:${user?.id ?? ""}:${companyId ?? ""}`;
  const { status: wsStatus, sendScan, isConnected: wsConnected, clearQueue: clearWsQueue } = useScanWebSocket(step === "picking", handleWsScanAck, wsNamespace);
  sendScanRef.current = sendScan;

  const processScanQueue = useCallback(async () => {
    if (scanWorkerRunningRef.current) return;
    scanWorkerRunningRef.current = true;

    try {
      while (scanQueueRef.current.length > 0) {
        if (overQtyModalOpenRef.current) break;

        const barcode = scanQueueRef.current.shift()!;

        const currentCache = queryClient.getQueryData<any[]>(workUnitsQueryKey) || [];
        const units = currentCache.filter((wu: any) =>
          wu.lockedBy === user?.id
        );
        if (units.length === 0) continue;

        const unitsWithProduct = units.filter((wu: any) =>
          (wu.items as ItemWithProduct[]).some(item =>
            item.product?.barcode === barcode || item.product?.boxBarcode === barcode || (Array.isArray(item.product?.boxBarcodes) && item.product.boxBarcodes.some((bx: any) => bx.code === barcode))
          )
        );

        if (unitsWithProduct.length === 0) {
          beep("warning");
          setScanStatus("warning");
          setScanMessage("Produto não encontrado neste pedido");
          continue;
        }

        const { get: getDelta } = usePendingDeltaStore.getState();

        let targetUnit = unitsWithProduct.find((wu: any) => {
          const item = (wu.items as ItemWithProduct[]).find((i: ItemWithProduct) =>
            i.product?.barcode === barcode || i.product?.boxBarcode === barcode || (Array.isArray(i.product?.boxBarcodes) && i.product.boxBarcodes.some((bx: any) => bx.code === barcode))
          );
          if (!item) return false;
          const serverSeparated = Number(item.separatedQty);
          const delta = getDelta("balcao", item.id);
          const exceptionQty = Number(item.exceptionQty || 0);
          return serverSeparated + delta + exceptionQty < Number(item.quantity);
        });

        const finalUnit = targetUnit || unitsWithProduct[0];
        if (!finalUnit) continue;

        const matchedItem = (finalUnit.items as ItemWithProduct[]).find(i =>
          i.product?.barcode === barcode || i.product?.boxBarcode === barcode || (Array.isArray(i.product?.boxBarcodes) && i.product.boxBarcodes.some((bx: any) => bx.code === barcode))
        );

        if (!matchedItem) continue;

        const serverSeparated = Number(matchedItem.separatedQty);
        const itemDelta = getDelta("balcao", matchedItem.id);
        const exceptionQty = Number(matchedItem.exceptionQty || 0);
        const alreadyComplete = serverSeparated + itemDelta + exceptionQty >= Number(matchedItem.quantity);

        if (alreadyComplete) {
          beep("error");
          setQtyModal(null);
          usePendingDeltaStore.getState().clearItem("balcao", matchedItem.id);
          usePendingDeltaStore.getState().resetBaseline("balcao", matchedItem.id);
          const targetQtyOver = Number(matchedItem.quantity) - exceptionQty;
          setOverQtyContext({
            productName: matchedItem.product.name,
            itemIds: [matchedItem.id],
            workUnitId: finalUnit.id,
            barcode,
            targetQty: targetQtyOver,
            message: `"${matchedItem.product.name}" já atingiu a quantidade máxima (${targetQtyOver}). A coleta será reiniciada.`,
            serverAlreadyReset: false,
          });
          setOverQtyModalOpen(true);
          overQtyModalOpenRef.current = true;
          break;
        }

        let isBoxBarcode = false;
        let boxQtyVal = 1;
        if (matchedItem.product.barcode !== barcode && matchedItem.product.boxBarcodes && Array.isArray(matchedItem.product.boxBarcodes)) {
          const bx = matchedItem.product.boxBarcodes.find((b: any) => b.code === barcode);
          if (bx && bx.qty) {
            isBoxBarcode = true;
            boxQtyVal = bx.qty;
          }
        }

        const productId = matchedItem.product.id;
        const remaining = Number(matchedItem.quantity) - (serverSeparated + itemDelta) - exceptionQty;
        const currentModal = qtyModalRef.current;

        if (currentModal && currentModal.productId !== productId) {
          if (currentModal.accumulated > 0) {
            usePendingDeltaStore.getState().inc("balcao", currentModal.itemId, currentModal.accumulated);
            const msgId = generateMsgId();
            pendingScanContextRef.current.set(msgId, {
              itemId: currentModal.itemId,
              qty: currentModal.accumulated,
              barcode: currentModal.barcode,
              workUnitId: currentModal.workUnitId,
              apItems: [{ id: currentModal.itemId }],
              productName: currentModal.productName,
              targetQty: currentModal.targetQty,
              exceptionQty: currentModal.exceptionQty,
            });
            sendScan(currentModal.workUnitId, currentModal.barcode, currentModal.accumulated, msgId);
          }
          setQtyModal(null);
        }

        if (currentModal && currentModal.productId === productId) {
          const addQty = isBoxBarcode ? boxQtyVal : currentModal.multiplier;
          const newAccumulated = currentModal.accumulated + addQty;
          if (newAccumulated > remaining) {
            beep("error");
            setQtyModal(null);
            usePendingDeltaStore.getState().clearItem("balcao", currentModal.itemId);
            usePendingDeltaStore.getState().resetBaseline("balcao", currentModal.itemId);
            queryClient.setQueryData(workUnitsQueryKey, (old: any) => {
              if (!old) return old;
              return old.map((wu: any) => ({
                ...wu,
                items: wu.items.map((item: any) =>
                  item.id === currentModal.itemId
                    ? { ...item, separatedQty: 0, status: "recontagem" }
                    : item
                ),
              }));
            });
            toast({ title: "Quantidade excedida", description: "Produto zerado para recontagem. Escaneie novamente.", variant: "destructive" });
            apiRequest("POST", `/api/work-units/${currentModal.workUnitId}/reset-item-picking`, { itemIds: [currentModal.itemId] })
              .catch(() => { /* reset optimista — UI atualizada via invalidateQueries */ })
              .finally(() => queryClient.invalidateQueries({ queryKey: workUnitsQueryKey }));
          } else {
            setQtyModal({ ...currentModal, accumulated: newAccumulated, maxRemaining: remaining });
          }
        } else {
          beep("scan");
          setQtyModal({
            productId,
            productName: matchedItem.product.name,
            productCode: matchedItem.product.erpCode || String(matchedItem.product.id),
            multiplier: 1,
            accumulated: 0,
            itemId: matchedItem.id,
            workUnitId: finalUnit.id,
            barcode,
            maxRemaining: remaining,
            targetQty: Number(matchedItem.quantity) - exceptionQty,
            exceptionQty,
          });
        }

        setScanStatus("idle");
        setScanMessage("");

        const idx = aggregatedProducts.findIndex(ap => ap.product.id === productId);
        if (idx >= 0) setCurrentProductIndex(idx);
        setPickingTab("product");
      }
    } finally {
      scanWorkerRunningRef.current = false;
    }

    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      if (scanQueueRef.current.length === 0 && !scanWorkerRunningRef.current) {
        queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
        pendingInvalidateRef.current = false;
      }
    }, 300);
  }, [queryClient, workUnitsQueryKey, user, aggregatedProducts]);

  const handleScanItem = useCallback((barcode: string) => {
    if (overQtyModalOpenRef.current) return;
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    scanQueueRef.current.push(barcode);
    processScanQueue();
  }, [processScanQueue]);

  useBarcodeScanner(handleScanItem, step === "picking" && !showStockModal && !showQuickLinkModal);

  const handleConfirmQtyModal = useCallback(() => {
    const modal = qtyModalRef.current;
    if (!modal || modal.accumulated <= 0) return;
    usePendingDeltaStore.getState().inc("balcao", modal.itemId, modal.accumulated);
    const msgId = generateMsgId();
    pendingScanContextRef.current.set(msgId, {
      itemId: modal.itemId,
      qty: modal.accumulated,
      barcode: modal.barcode,
      workUnitId: modal.workUnitId,
      apItems: [{ id: modal.itemId }],
      productName: modal.productName,
      targetQty: modal.targetQty,
      exceptionQty: modal.exceptionQty,
    });
    sendScan(modal.workUnitId, modal.barcode, modal.accumulated, msgId);
    setQtyModal(null);
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      if (scanQueueRef.current.length === 0 && !scanWorkerRunningRef.current) {
        queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
      }
    }, 300);
  }, [sendScan, queryClient, workUnitsQueryKey]);

  const handleQtyModalAdd = useCallback(() => {
    const modal = qtyModalRef.current;
    if (!modal) return;
    const newAccumulated = modal.accumulated + modal.multiplier;
    if (newAccumulated > modal.maxRemaining) {
      setQtyModal(null);
      usePendingDeltaStore.getState().clearItem("balcao", modal.itemId);
      usePendingDeltaStore.getState().resetBaseline("balcao", modal.itemId);
      queryClient.setQueryData(workUnitsQueryKey, (old: any) => {
        if (!old) return old;
        return old.map((wu: any) => ({
          ...wu,
          items: wu.items.map((item: any) =>
            item.id === modal.itemId
              ? { ...item, separatedQty: 0, status: "recontagem" }
              : item
          ),
        }));
      });
      toast({ title: "Quantidade excedida", description: "Produto zerado para recontagem. Escaneie novamente.", variant: "destructive" });
      apiRequest("POST", `/api/work-units/${modal.workUnitId}/reset-item-picking`, { itemIds: [modal.itemId] })
        .catch(() => { /* reset optimista — UI atualizada via invalidateQueries */ })
        .finally(() => queryClient.invalidateQueries({ queryKey: workUnitsQueryKey }));
      return;
    }
    setQtyModal({ ...modal, accumulated: newAccumulated });
  }, [toast, queryClient, workUnitsQueryKey]);

  const handleQtyModalSubtract = useCallback(() => {
    const modal = qtyModalRef.current;
    if (!modal) return;
    setQtyModal({ ...modal, accumulated: Math.max(0, modal.accumulated - modal.multiplier) });
  }, []);

  const handleQtyModalMultiplierChange = useCallback((val: number) => {
    const modal = qtyModalRef.current;
    if (!modal) return;
    setQtyModal({ ...modal, multiplier: val });
  }, []);

  const handleConfirmOverQty = async () => {
    if (!overQtyContext) return;
    const ctx = overQtyContext;

    ctx.itemIds.forEach(id => {
      usePendingDeltaStore.getState().clearItem("balcao", id);
      usePendingDeltaStore.getState().resetBaseline("balcao", id);
    });

    queryClient.setQueryData(workUnitsQueryKey, (old: any) => {
      if (!old) return old;
      return old.map((wu: any) => ({
        ...wu,
        items: wu.items.map((item: any) =>
          ctx.itemIds.includes(item.id)
            ? { ...item, separatedQty: 0, status: "recontagem" }
            : item
        ),
      }));
    });

    setOverQtyModalOpen(false);
    overQtyModalOpenRef.current = false;
    setOverQtyContext(null);
    setScanStatus("idle");
    setScanMessage("");
    scanQueueRef.current = [];
    setTimeout(() => processScanQueue(), 0);

    try {
      if (!ctx.serverAlreadyReset) {
        await apiRequest("POST", `/api/work-units/${ctx.workUnitId}/reset-item-picking`, { itemIds: ctx.itemIds });
      }
    } catch (err) {
      /* Recount error handled via queryClient.invalidateQueries below */
    }
    queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
  };

  const handleCancelPicking = (shouldReset: boolean) => {
    setAbandonConfirmOpen(false);
    scanQueueRef.current = [];
    setQtyModal(null);
    pendingScanContextRef.current.clear();
    clearWsQueue();
    usePendingDeltaStore.getState().clear("balcao");
    setSelectedAddresses({});
    setCurrentProductIndex(0);
    const ids = allMyUnits.map(wu => wu.id);
    clearSession();
    setStep("select");
    setSelectedWorkUnits([]);
    setPickingTab("product");
    setElapsedTime(0);
    if (ids.length > 0) {
      unlockMutation.mutate({ ids, reset: shouldReset });
    }
  };

  const handleExitPicking = () => {
    setAbandonConfirmOpen(true);
  };

  const handleNextProduct = () => {
    const total = aggregatedProducts.length;
    if (total === 0) return;
    const nextIncompleteIdx = aggregatedProducts.findIndex((ap, idx) => {
      if (idx <= currentProductIndex) return false;
      return ap.totalQty - ap.separatedQty - ap.exceptionQty > 0;
    });

    if (nextIncompleteIdx >= 0) {
      setCurrentProductIndex(nextIncompleteIdx);
      return;
    }

    const wrapIncompleteIdx = aggregatedProducts.findIndex((ap, idx) => {
      if (idx === currentProductIndex) return false;
      return ap.totalQty - ap.separatedQty - ap.exceptionQty > 0;
    });

    if (wrapIncompleteIdx >= 0) {
      setCurrentProductIndex(wrapIncompleteIdx);
      return;
    }

    // Todos completos: avança linearmente
    const nextIdx = (currentProductIndex + 1) % total;
    setCurrentProductIndex(nextIdx);
  };

  const getProgress = () => {
    if (aggregatedProducts.length === 0) return 0;
    const total = aggregatedProducts.reduce((s, ap) => s + ap.totalQty, 0);
    const done = aggregatedProducts.reduce((s, ap) => s + ap.separatedQty + ap.exceptionQty, 0);
    return total > 0 ? (done / total) * 100 : 0;
  };

  const allItemsComplete = aggregatedProducts.length > 0 && aggregatedProducts.every(ap =>
    ap.separatedQty + ap.exceptionQty >= ap.totalQty
  );

  const handleApplyDateFilter = () => {
    setDateRange(tempDateRange);
  };

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden" data-module="balcao">
      <header className="flex items-center justify-between px-3 py-2.5 border-b border-border bg-card">
        <div className="flex items-center gap-2 min-w-0">
          <img src="/stoker-icon.png" alt="Stoker" className="h-6 w-6 shrink-0 grayscale opacity-60 dark:opacity-40" />
          <span className="text-sm font-semibold truncate">{user?.name}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {step === "picking" && (
            <div className="flex items-center gap-1 bg-amber-500/10 px-2.5 py-1.5 rounded-full">
              <Timer className="h-3.5 w-3.5 text-amber-500" />
              <span className="font-mono text-xs font-bold text-amber-600">{formatTime(elapsedTime)}</span>
            </div>
          )}
          <Button variant="ghost" size="icon" onClick={logout} className="h-10 w-10" data-testid="button-logout">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {step === "select" && (
        <div className="flex-1 flex flex-col min-h-0 px-3 py-3 gap-3 overflow-hidden">
          <div className="shrink-0">
            {(() => {
              const activeCount = [filterOrderId, dateRange].filter(Boolean).length;
              return (
                <button
                  onClick={() => setShowFilters(v => !v)}
                  className="w-full flex items-center gap-2 px-3 h-9 rounded-lg border border-border bg-card hover:bg-muted/50 transition-colors text-sm text-muted-foreground"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 text-left font-medium">Filtros</span>
                  {activeCount > 0 && (
                    <span className="text-[10px] font-semibold bg-primary text-primary-foreground rounded-full w-4 h-4 flex items-center justify-center">{activeCount}</span>
                  )}
                  <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${showFilters ? "rotate-180" : ""}`} />
                </button>
              );
            })()}
            {showFilters && (
              <div className="space-y-2 p-2.5 mt-1.5 bg-muted/30 rounded-lg border border-border">
                <div className="flex items-center gap-2">
                  <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                  <Input
                    placeholder="N° Pedido"
                    value={filterOrderId}
                    onChange={(e) => setFilterOrderId(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <DatePickerWithRange
                      date={tempDateRange}
                      onDateChange={setTempDateRange}
                      className="text-sm h-9 w-full"
                    />
                  </div>
                  <Button size="sm" className="h-9 px-4 text-sm shrink-0" onClick={handleApplyDateFilter}>
                    <Search className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          ) : groupedWorkUnits.length > 0 ? (
            <>
              <div className="flex-1 overflow-y-scroll border rounded-lg min-h-0 touch-pan-y overscroll-contain">
                <div className="space-y-1.5 p-2">
                  {groupedWorkUnits.map((group) => {
                    const firstWU = group[0];
                    const groupIds = group.map(g => g.id);
                    const isSelected = groupIds.every(id => selectedWorkUnits.includes(id));
                    const lockedByOther = group.some(wu => wu.lockedBy && wu.lockedBy !== user?.id);
                    const lockerName = group.find(wu => wu.lockedBy && wu.lockedBy !== user?.id)?.lockedByName;

                    const distinctProductCount = group.reduce((acc, wu) => {
                      const items = wu.items || [];
                      const productIds = new Set(items.map(item => item.productId));
                      return new Set([...acc, ...productIds]);
                    }, new Set<string>()).size;

                    const totalValue = Number(firstWU.order.totalValue || 0);

                    let createdAt = "";
                    try {
                      createdAt = format(new Date(firstWU.order.launchedAt || firstWU.order.createdAt), "dd/MM HH:mm");
                    } catch { }

                    return (
                      <div
                        key={firstWU.orderId}
                        className={`flex items-center gap-3 p-3 rounded-lg transition-colors min-h-[56px] ${lockedByOther ? "opacity-50 cursor-not-allowed border border-border" : isSelected ? "border-2 border-amber-500 bg-amber-500/5" : "border border-border"}`}
                        onClick={() => !lockedByOther && handleSelectGroup(group, !isSelected)}
                        data-testid={`order-group-${firstWU.orderId}`}
                      >
                        {!lockedByOther ? (
                          <div
                            className={`h-5 w-5 rounded-full border-2 shrink-0 flex items-center justify-center ${isSelected ? "border-amber-500 bg-amber-500" : "border-muted-foreground"}`}
                            data-testid={`radio-order-${firstWU.orderId}`}
                          >
                            {isSelected && <Check className="h-3 w-3 text-white" />}
                          </div>
                        ) : (
                          <Lock className="h-5 w-5 shrink-0 text-amber-500" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-sm font-bold">{firstWU.order.erpOrderId}</span>
                            {lockedByOther && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                                {lockerName}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{firstWU.order.customerName}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-mono text-sm font-bold tabular-nums">{distinctProductCount}</p>
                          <p className="text-[10px] text-muted-foreground">
                            R$ {totalValue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                          </p>
                          <p className="text-[10px] text-muted-foreground">{createdAt}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <Button
                className="w-full h-14 text-base font-bold bg-amber-500 hover:bg-amber-600 text-white shrink-0 active:scale-[0.98] transition-transform"
                onClick={handleStartBalcao}
                disabled={selectedWorkUnits.length === 0 || lockMutation.isPending}
                data-testid="button-start-balcao"
              >
                <Store className="h-5 w-5 mr-2" />
                Atender
                {selectedWorkUnits.length > 0 && ` (${new Set(
                  workUnits?.filter(wu => selectedWorkUnits.includes(wu.id)).map(wu => wu.orderId)
                ).size})`}
              </Button>
            </>
          ) : (
            <div className="text-center py-10 text-muted-foreground">
              <Store className="h-12 w-12 mx-auto mb-3 opacity-40" />
              <p className="text-sm font-medium">Nenhum pedido disponível</p>
              <p className="text-xs">Aguarde novos clientes</p>
            </div>
          )}
        </div>
      )}

      {step === "picking" && (
        <>
          <div className="px-3 pt-2 pb-1 space-y-1.5 border-b border-border bg-card">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground truncate">
                {allMyUnits.map(wu => wu.order.erpOrderId).filter((v, i, a) => a.indexOf(v) === i).join(", ")}
              </span>
              <div className="flex items-center gap-1.5">
                {(featureSettings?.quickLinkEnabled ?? true) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowQuickLinkModal(true)}
                    title="Vínculo rápido de embalagem"
                    data-testid="button-quick-link-balcao"
                  >
                    <Link2 className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => { setSoundOn(s => { const next = !s; persistSoundEnabled(next); return next; }); }}
                  data-testid="button-toggle-sound-balcao"
                >
                  {soundOn ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5 text-muted-foreground" />}
                </Button>
                <ConnectionStatusIndicator status={wsStatus} />
              </div>
            </div>
            <ScanInput
              placeholder="Leia o código de barras..."
              onScan={handleScanItem}
              status={scanStatus}
              statusMessage={scanMessage}
              autoFocus
              className="[&_input]:h-10 [&_input]:text-sm"
            />
          </div>

          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {pickingTab === "product" && currentProduct && (
              <div className="flex flex-col h-full min-h-0">
                <div className="flex-1 overflow-y-scroll px-3 py-3 space-y-3 touch-pan-y overscroll-contain">
                  <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">

                    {/* ── Cabeçalho do produto ───────────────────── */}
                    <div className="px-3 pt-2 pb-2">
                      <div className="flex items-center gap-1 flex-wrap mb-1">
                        {currentProduct.orderCodes.map(code => (
                          <span key={code} className="text-[9px] bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded font-mono font-semibold">{code}</span>
                        ))}
                      </div>
                      <p className="text-sm font-semibold leading-snug break-words">{currentProduct.product.name}</p>
                      <div className="flex items-center flex-wrap gap-x-2 mt-0.5">
                        {currentProduct.product.manufacturer && (
                          <span className="text-[10px] text-muted-foreground">Fab.: {currentProduct.product.manufacturer}</span>
                        )}
                        <span className="text-[10px] text-muted-foreground">
                          Cód.: <span className="font-mono font-semibold text-foreground">{currentProduct.product.erpCode}</span>
                          {(currentProduct.product as any).factoryCode && (
                            <span className="ml-1 text-muted-foreground/70">· Ref.: <span className="font-mono">{(currentProduct.product as any).factoryCode}</span></span>
                          )}
                        </span>
                        {currentProduct.product.barcode && (
                          <span className="text-[10px] font-mono text-muted-foreground">{currentProduct.product.barcode}</span>
                        )}
                      </div>
                    </div>

                    {/* ── Endereços ─────────────────────────────── */}
                    {addressesMap?.[currentProduct.product.id] && addressesMap[currentProduct.product.id].length > 0 && (
                      <div className="mx-4 mb-3 space-y-1.5" data-testid="product-addresses">
                        <div className="flex items-center justify-between">
                          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                            <MapPinIcon className="h-3 w-3 text-blue-500" />
                            Endereço de coleta
                          </p>
                          {selectedAddresses[currentProduct.product.id] && (
                            <button
                              className="text-[10px] text-muted-foreground underline"
                              onClick={() => setSelectedAddresses(prev => ({ ...prev, [currentProduct.product.id]: null }))}
                            >
                              Limpar
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-1 gap-1.5">
                          {addressesMap[currentProduct.product.id].map((addr: ProductAddress) => {
                            const isSelected = selectedAddresses[currentProduct.product.id]?.code === addr.code;
                            return (
                              <button
                                key={addr.code}
                                data-testid={`button-address-${addr.code}`}
                                onClick={() => setSelectedAddresses(prev => ({
                                  ...prev,
                                  [currentProduct.product.id]: isSelected ? null : { code: addr.code, addressId: addr.addressId || "", quantity: addr.quantity },
                                }))}
                                className={`flex items-center justify-between w-full px-3 py-2.5 rounded-xl border-2 transition-all ${
                                  isSelected
                                    ? "border-blue-500 bg-blue-50 dark:bg-blue-950/60 shadow-sm"
                                    : "border-border/60 bg-muted/30 hover:border-blue-300 hover:bg-blue-50/50 dark:hover:bg-blue-950/30"
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  {isSelected
                                    ? <CheckCircle2 className="h-4 w-4 text-blue-600 shrink-0" />
                                    : <MapPinIcon className="h-4 w-4 text-blue-400 shrink-0" />
                                  }
                                  <span className={`font-mono font-bold text-sm ${isSelected ? "text-blue-700 dark:text-blue-300" : "text-foreground"}`}>
                                    {addr.code}
                                  </span>
                                  {addr.type && addr.type !== "standard" && (
                                    <span className="text-[9px] bg-slate-100 dark:bg-slate-800 px-1 rounded uppercase font-bold text-muted-foreground">{addr.type}</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className={`font-mono text-sm font-bold ${addr.quantity > 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                                    {Number(addr.quantity).toLocaleString("pt-BR")} un
                                  </span>
                                  {isSelected && <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/40 px-1.5 py-0.5 rounded">SELECIONADO</span>}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                        {!selectedAddresses[currentProduct.product.id] && (
                          <p className="text-[10px] text-muted-foreground italic text-center">Opcional — pode prosseguir sem selecionar</p>
                        )}
                      </div>
                    )}

                    {/* ── Progresso ─────────────────────────────── */}
                    <div className="px-3 pt-2 pb-3 border-t border-border bg-muted/20">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-baseline gap-1.5">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Separado</p>
                          {currentProduct.exceptionQty > 0 && (
                            <span className="text-[9px] font-semibold text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-800 px-1.5 py-0.5 rounded">
                              {currentProduct.exceptionQty} exc
                            </span>
                          )}
                        </div>
                        <p className="text-2xl font-extrabold tabular-nums leading-none">
                          {currentProduct.separatedQty}
                          <span className="text-muted-foreground font-normal text-base ml-1">/ {currentProduct.totalQty}</span>
                        </p>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-500 rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(100, currentProduct.totalQty > 0 ? (currentProduct.separatedQty / currentProduct.totalQty) * 100 : 0)}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground text-center mt-1.5">Bipe o produto para coletar</p>
                    </div>
                  </div>

                </div>

                <div className="p-3 border-t bg-background mt-auto space-y-2">
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="h-12 px-4"
                      onClick={() => {
                        const firstIncompleteItem = currentProduct.items.find(i =>
                          Number(i.quantity) > Number(i.separatedQty) + Number(i.exceptionQty || 0)
                        ) || currentProduct.items[0];
                        setExceptionItem(firstIncompleteItem);
                        setShowExceptionDialog(true);
                      }}
                    >
                      <AlertTriangle className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-12 px-4 text-blue-600 border-blue-300 hover:bg-blue-50 dark:text-blue-400 dark:border-blue-700 dark:hover:bg-blue-950"
                      onClick={() => {
                        setShowStockModal(true);
                        setTimeout(() => stockInputRef.current?.focus(), 100);
                      }}
                      title="Consultar estoque"
                      data-testid="button-stock-query"
                    >
                      <BarChart2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      className="h-12 px-4 text-destructive border-destructive/30 hover:bg-destructive/10"
                      onClick={handleExitPicking}
                      disabled={unlockMutation.isPending}
                      data-testid="button-cancel-picking"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                    <Button
                      className="flex-1 h-12 text-sm"
                      onClick={handleNextProduct}
                    >
                      <ArrowRight className="h-4 w-4 mr-1.5" />
                      Próximo
                    </Button>
                  </div>
                  <Button
                    className="w-full h-14 text-base font-bold bg-green-600 hover:bg-green-700 active:scale-[0.98] transition-transform"
                    onClick={handleCompleteAll}
                    disabled={!allItemsComplete || finalizeMutation.isPending}
                    data-testid="button-complete-picking"
                  >
                    <Check className="h-5 w-5 mr-2" />
                    Concluir
                  </Button>
                </div>
              </div>
            )}

            {pickingTab === "product" && !currentProduct && aggregatedProducts.length === 0 && (
              <div className="flex-1 flex items-center justify-center p-4 text-muted-foreground text-sm">
                Nenhum produto para separar
              </div>
            )}

            {pickingTab === "list" && (
              <div className="flex flex-col h-full min-h-0">
                <div className="flex-1 overflow-y-scroll px-3 py-2 space-y-2 touch-pan-y overscroll-contain">

                  {/* Progress summary */}
                  <div className="flex items-center justify-end pb-1">
                    <div className="text-[11px]">
                      <span className="font-bold text-foreground">
                        {aggregatedProducts.filter(ap => ap.totalQty - ap.separatedQty - ap.exceptionQty <= 0).length}
                      </span>
                      <span className="text-muted-foreground">/{aggregatedProducts.length} ok</span>
                    </div>
                  </div>

                  {aggregatedProducts.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-xs">
                      Nenhum produto encontrado
                    </div>
                  ) : (
                    aggregatedProducts.map((ap, idx) => {
                      const remaining = ap.totalQty - ap.separatedQty - ap.exceptionQty;
                      const isComplete = remaining <= 0;
                      const hasException = ap.exceptionQty > 0;

                      return (
                        <div
                          key={ap.product.id}
                          className={`flex bg-card rounded-xl border shadow-sm cursor-pointer active:scale-[0.99] transition-all overflow-hidden ${
                            isComplete
                              ? hasException
                                ? "border-amber-200/80 dark:border-amber-800/60"
                                : "border-green-200/80 dark:border-green-800/60"
                              : "border-border"
                          }`}
                          onClick={() => {
                            setCurrentProductIndex(idx);
                            setPickingTab("product");
                          }}
                        >
                          <div className={`w-1.5 shrink-0 ${
                            isComplete
                              ? hasException ? "bg-amber-400" : "bg-green-500"
                              : "bg-muted-foreground/20"
                          }`} />
                          <div className="flex-1 min-w-0 px-2 py-1.5">
                            <div className="flex items-center gap-2">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                                isComplete
                                  ? hasException ? "bg-amber-500 text-white" : "bg-green-500 text-white"
                                  : "bg-primary/10 text-primary border border-primary/20"
                              }`}>
                                {isComplete ? (
                                  hasException ? <AlertTriangle className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />
                                ) : (
                                  <span className="text-xs font-bold tabular-nums leading-none">{remaining}</span>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold leading-tight truncate">{ap.product.name}</p>
                                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                  <span className="text-[10px] font-mono text-muted-foreground">{ap.product.erpCode}</span>
                                  {ap.product.barcode && (
                                    <span className="text-[10px] font-mono text-muted-foreground">{ap.product.barcode}</span>
                                  )}
                                  {ap.product.manufacturer && (
                                    <span className="text-[10px] text-muted-foreground truncate">{ap.product.manufacturer}</span>
                                  )}
                                  {ap.orderCodes.map(code => (
                                    <span key={code} className="text-[9px] bg-primary/10 text-primary px-1 py-0.5 rounded font-mono font-semibold">{code}</span>
                                  ))}
                                  {addressesMap?.[ap.product.id] && addressesMap[ap.product.id].length > 0 && (
                                    selectedAddresses[ap.product.id] ? (
                                      <span className="text-[9px] bg-blue-100 dark:bg-blue-900 border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 px-1 py-0.5 rounded font-mono font-semibold flex items-center gap-0.5">
                                        <Check className="h-2 w-2" />
                                        {selectedAddresses[ap.product.id]!.code}
                                      </span>
                                    ) : (
                                      addressesMap[ap.product.id].map((addr: ProductAddress) => (
                                        <span key={addr.code} className="text-[9px] bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 px-1 py-0.5 rounded font-mono font-semibold">
                                          {addr.code}
                                        </span>
                                      ))
                                    )
                                  )}
                                </div>
                              </div>
                              <div className="text-right shrink-0 ml-1">
                                <div className="text-base font-bold tabular-nums leading-tight">
                                  <span className={isComplete && !hasException ? "text-green-600 dark:text-green-400" : ""}>{ap.separatedQty}</span>
                                  <span className="text-xs text-muted-foreground font-normal">/{ap.totalQty}</span>
                                </div>
                                {ap.exceptionQty > 0 && (
                                  <div className="text-[9px] text-orange-500 font-semibold">{ap.exceptionQty} exc</div>
                                )}
                              </div>
                            </div>
                            {!isComplete && ap.totalQty > 0 && (
                              <div className="mt-1">
                                <div className="h-0.5 bg-muted rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-primary rounded-full transition-all"
                                    style={{ width: `${Math.min(100, (ap.separatedQty / ap.totalQty) * 100)}%` }}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="p-3 border-t bg-background mt-auto space-y-2">
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="h-12 px-4 text-destructive border-destructive/30 hover:bg-destructive/10"
                      onClick={handleExitPicking}
                      disabled={unlockMutation.isPending}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                    <Button
                      className="flex-1 h-14 text-base font-bold bg-green-600 hover:bg-green-700 active:scale-[0.98] transition-transform"
                      onClick={handleCompleteAll}
                      disabled={!allItemsComplete || finalizeMutation.isPending}
                    >
                      <Check className="h-5 w-5 mr-2" />
                      Concluir
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <nav className="flex border-t border-border bg-card shrink-0">
            <button
              className={`flex-1 flex flex-col items-center py-2 gap-0.5 transition-colors ${pickingTab === "product" ? "text-amber-500 bg-amber-500/5" : "text-muted-foreground"
                }`}
              onClick={() => setPickingTab("product")}
            >
              <Package className="h-5 w-5" />
              <span className="text-[10px] font-medium">Produto</span>
            </button>
            <button
              className={`flex-1 flex flex-col items-center py-2 gap-0.5 transition-colors ${pickingTab === "list" ? "text-amber-500 bg-amber-500/5" : "text-muted-foreground"
                }`}
              onClick={() => setPickingTab("list")}
            >
              <List className="h-5 w-5" />
              <span className="text-[10px] font-medium">Lista</span>
            </button>
          </nav>
        </>
      )
      }

      <Dialog open={abandonConfirmOpen} onOpenChange={setAbandonConfirmOpen}>
        <DialogContent className="max-w-sm" data-scan-exclude="true">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Sair da coleta
            </DialogTitle>
            <DialogDescription className="pt-1 space-y-2 text-left">
              <span className="block">Escolha o que fazer com o progresso desta coleta:</span>
              <span className="block text-sm">
                <strong>Suspender</strong> — sai da tela e mantém tudo que foi separado. Você poderá retomar depois.
              </span>
              <span className="block text-sm text-destructive">
                <strong>Abandonar</strong> — apaga TODO o progresso desta coleta e libera os pedidos. Essa ação não pode ser desfeita.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              variant="outline"
              className="w-full justify-center gap-2"
              onClick={() => handleCancelPicking(false)}
              disabled={unlockMutation.isPending}
              data-testid="button-suspend-picking"
            >
              <Pause className="h-4 w-4" />
              Suspender (manter progresso)
            </Button>
            <Button
              variant="destructive"
              className="w-full justify-center gap-2"
              onClick={() => handleCancelPicking(true)}
              disabled={unlockMutation.isPending}
              data-testid="button-abandon-picking"
            >
              <Trash2 className="h-4 w-4" />
              Abandonar (apagar progresso)
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => setAbandonConfirmOpen(false)}
              data-testid="button-cancel-exit"
            >
              Cancelar (continuar separando)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de Vínculo Rápido de Embalagem */}
      <QuickLinkBarcodeModal
        open={showQuickLinkModal}
        onClose={() => setShowQuickLinkModal(false)}
        prefilledProduct={currentProduct?.product
          ? { barcode: currentProduct.product.barcode, name: currentProduct.product.name, erpCode: currentProduct.product.erpCode ?? "" }
          : undefined}
      />

      <Dialog open={showStockModal} onOpenChange={v => {
        setShowStockModal(v);
        if (!v) { setStockQuery(""); setStockDebouncedQuery(""); setStockKeyboard(false); }
      }}>
        <DialogContent className="max-w-lg rounded-2xl p-0 gap-0 overflow-hidden max-h-[85dvh] flex flex-col">
          <DialogHeader className="px-4 pt-4 pb-3 border-b border-border/50 shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <BarChart2 className="h-4 w-4 text-blue-500" />
              Consultar Estoque
            </DialogTitle>
          </DialogHeader>

          <div className="px-3 py-2.5 border-b border-border/30 shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
              <input
                ref={stockInputRef}
                placeholder="Cód. ERP, cód. barras ou descrição..."
                value={stockQuery}
                onChange={e => handleStockSearch(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { if (stockQueryTimer.current) clearTimeout(stockQueryTimer.current); setStockDebouncedQuery(stockQuery); } }}
                className="w-full pl-9 pr-16 h-10 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                inputMode={stockKeyboard ? "text" : "none"}
                autoComplete="off"
                data-scan-exclude="true"
                data-testid="input-stock-search"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                {stockQuery ? (
                  <button className="p-1" onClick={() => { setStockQuery(""); setStockDebouncedQuery(""); stockInputRef.current?.focus(); }}>
                    {stockLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <X className="h-4 w-4 text-muted-foreground" />}
                  </button>
                ) : null}
                <button
                  className={`h-7 w-7 rounded-lg flex items-center justify-center transition-colors ${stockKeyboard ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                  onClick={() => { setStockKeyboard(v => !v); setTimeout(() => stockInputRef.current?.focus(), 50); }}
                  data-testid="button-stock-keyboard"
                >
                  <Keyboard className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-1.5 px-0.5">
              <span className="text-[10px] text-muted-foreground/70">Dicas:</span>
              <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono text-foreground/70">17081</span>
              <span className="text-[10px] text-muted-foreground/50">cód. exato</span>
              <span className="mx-1 text-muted-foreground/30">·</span>
              <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono text-foreground/70">TELHA%PVC</span>
              <span className="text-[10px] text-muted-foreground/50">% = curinga</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {stockLoading && (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-primary/50" />
              </div>
            )}

            {!stockLoading && stockDebouncedQuery.length >= 2 && stockProducts.length === 0 && (
              <div className="text-center py-10 text-muted-foreground">
                <Package className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm font-medium">Nenhum produto encontrado</p>
                <p className="text-[11px] mt-0.5 opacity-60">"{stockDebouncedQuery}"</p>
              </div>
            )}

            {stockDebouncedQuery.length < 2 && !stockLoading && (
              <div className="text-center py-10 text-muted-foreground">
                <Search className="h-8 w-8 mx-auto mb-2 opacity-20" />
                <p className="text-sm font-medium">Consultar estoque</p>
                <p className="text-[11px] mt-1 opacity-60 max-w-[220px] mx-auto leading-snug">
                  Digite o código ERP exato, escaneie o código de barras, ou use % como curinga na descrição
                </p>
              </div>
            )}

            {stockProducts.length > 0 && (
              <div className="divide-y divide-border/40">
                {stockProducts.map((p: any) => {
                  const real = Number(p.totalStock || 0);
                  const hasStock = real > 0;
                  return (
                    <div key={p.id} className="px-3 py-2.5" data-testid={`stock-row-${p.id}`}>
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold leading-snug">{p.name}</p>
                          <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
                            <span className="text-[11px] font-mono font-bold text-blue-600 dark:text-blue-400">{p.erpCode}</span>
                            {p.barcode && (
                              <span className="text-[10px] font-mono text-muted-foreground flex items-center gap-0.5">
                                <BarcodeIcon className="h-2.5 w-2.5 shrink-0" />{p.barcode}
                              </span>
                            )}
                            {p.manufacturer && <span className="text-[10px] text-muted-foreground">{p.manufacturer}</span>}
                          </div>
                        </div>
                        <div className={`shrink-0 flex flex-col items-center rounded-lg px-2.5 py-1 min-w-[52px] ${hasStock ? "bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800" : "bg-muted border border-border/50"}`}>
                          <span className={`text-[9px] font-bold uppercase tracking-wide leading-none mb-0.5 ${hasStock ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>Estoque</span>
                          <span className={`font-mono font-extrabold text-base leading-none ${hasStock ? "text-green-700 dark:text-green-300" : "text-muted-foreground"}`}>{real.toLocaleString("pt-BR")}</span>
                          {p.unit && <span className="text-[9px] text-muted-foreground/70 leading-none mt-0.5">{p.unit}</span>}
                        </div>
                      </div>

                      {p.addresses && p.addresses.length > 0 && (
                        <div className="flex items-center gap-1 flex-wrap mt-1.5">
                          <MapPinIcon className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                          {p.addresses.map((addr: any, i: number) => (
                            <span key={i} className="inline-flex items-center gap-1 bg-muted/60 rounded px-1.5 py-0.5 text-[10px] font-mono border border-border/30">
                              <span className="font-bold text-foreground">{addr.code}</span>
                              <span className="text-muted-foreground/50">·</span>
                              <span className="font-bold text-primary">{Number(addr.quantity).toLocaleString("pt-BR")}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ResultDialog
        open={showResultDialog}
        onOpenChange={setShowResultDialog}
        type={resultDialogConfig.type}
        title={resultDialogConfig.title}
        message={resultDialogConfig.message}
      />

      {
        exceptionItem && (
          <ExceptionDialog
            open={showExceptionDialog}
            onOpenChange={setShowExceptionDialog}
            productName={exceptionItem.product.name}
            maxQuantity={Math.max(0, Number(exceptionItem.quantity) - Number(exceptionItem.separatedQty) - (exceptionItem.exceptionQty || 0))}
            hasExceptions={(exceptionItem.exceptionQty || 0) > 0}
            onSubmit={(data) => {
              const wu = allMyUnits.find(w => w.items.some(i => i.id === exceptionItem.id));
              if (wu) {
                createExceptionMutation.mutate({
                  workUnitId: wu.id,
                  orderItemId: exceptionItem.id,
                  ...data,
                });
              }
            }}
            onClearExceptions={
              (user?.role === "supervisor" || user?.role === "administrador")
                ? () => { clearExceptionsMutation.mutate(exceptionItem.id); setShowExceptionDialog(false); }
                : undefined
            }
            isSubmitting={createExceptionMutation.isPending}
            isClearing={clearExceptionsMutation.isPending}
          />
        )
      }

      <ExceptionAuthorizationModal
        open={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        exceptions={pendingExceptions}
        onAuthorized={handleExceptionAuthorized}
      />

      {overQtyContext && (
        <AlertDialog open={overQtyModalOpen} onOpenChange={setOverQtyModalOpen} key={overQtyContext.workUnitId || "qty-modal"}>
          <AlertDialogContent className="max-w-sm">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-orange-600">
                <AlertTriangle className="h-5 w-5" />
                Quantidade Excedida
              </AlertDialogTitle>
              <AlertDialogDescription className="text-sm">
                {overQtyContext.message}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <Button
                className="w-full bg-orange-600 hover:bg-orange-700 text-white"
                onClick={handleConfirmOverQty}
                data-testid="button-confirm-overqty"
              >
                Recontar produto
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      <ScanQuantityModal
        open={!!qtyModal}
        onClose={() => setQtyModal(null)}
        onConfirm={handleConfirmQtyModal}
        productName={qtyModal?.productName || ""}
        productCode={qtyModal?.productCode || ""}
        multiplier={qtyModal?.multiplier || 1}
        onMultiplierChange={handleQtyModalMultiplierChange}
        accumulatedQty={qtyModal?.accumulated || 0}
        onAdd={handleQtyModalAdd}
        onSubtract={handleQtyModalSubtract}
      />

    </div >
  );
}
