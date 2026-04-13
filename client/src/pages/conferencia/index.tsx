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
  ClipboardCheck,
  Package,
  List,
  LogOut,
  Check,
  AlertTriangle,
  Search,
  ArrowRight,
  Calendar,
  Truck,
  Lock,
  PackageOpen,
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
import { VolumeModal } from "@/components/conferencia/VolumeModal";
import { ScanQuantityModal } from "@/components/ui/scan-quantity-modal";
import { BarcodeDisplay } from "@/components/ui/barcode-display";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { WorkUnitWithDetails, OrderItem, Product, ExceptionType, UserSettings, Exception } from "@shared/schema";
import { ExceptionDialog } from "@/components/orders/exception-dialog";
import { ExceptionAuthorizationModal } from "@/components/orders/exception-authorization-modal";
import { getCurrentWeekRange, isDateInRange } from "@/lib/date-utils";
import { format } from "date-fns";
import { usePendingDeltaStore } from "@/lib/pendingDeltaStore";
import { useProductAddressesBatch, type ProductAddress } from "@/hooks/use-product-stock";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

type ConferenciaStep = "select" | "checking";
type CheckingTab = "product" | "list";

const STORAGE_KEY = "wms:conferencia-session";

interface SessionData {
  tab: CheckingTab;
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
  totalQty: number;          // Original requested quantity (sum of item.quantity)
  totalSeparatedQty: number; // Target quantity for conference (separatedQty-based formula, matching server)
  checkedQty: number;        // What was actually checked in conference
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

export default function ConferenciaPage() {
  const { user, logout, companyId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<ConferenciaStep>("select");
  const [selectedWorkUnits, setSelectedWorkUnits] = useState<string[]>([]);
  const [checkingTab, setCheckingTab] = useState<CheckingTab>("list");
  const [currentProductIndex, setCurrentProductIndex] = useState(0);
  const [sessionVersion, setSessionVersion] = useState(0);

  const [scanStatus, setScanStatus] = useState<"idle" | "success" | "error" | "warning">("idle");
  const [scanMessage, setScanMessage] = useState("");
  const [soundOn, setSoundOn] = useState(getSoundEnabled);
  const [showResultDialog, setShowResultDialog] = useState(false);
  const [resultDialogConfig, setResultDialogConfig] = useState({
    type: "success" as "success" | "error" | "warning",
    title: "",
    message: "",
  });

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
  const [filterRoute, setFilterRoute] = useState<string>("");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>(getCurrentWeekRange());
  const [showFilters, setShowFilters] = useState(false);

  const [sessionRestored, setSessionRestored] = useState(false);
  const [volumeModalOpen, setVolumeModalOpen] = useState(false);

  const scanQueueRef = useRef<string[]>([]);
  const scanWorkerRunningRef = useRef(false);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  type PendingScanCtx = { itemId: string; qty: number; barcode: string; workUnitId: string; apItems: { id: string }[]; productName: string; targetQty: number; exceptionQty: number; retryCount?: number };
  const pendingScanContextRef = useRef<Map<string, PendingScanCtx>>(new Map());
  const sendCheckRef = useRef<any>(null);

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
  const [overQtyModalOpen, setOverQtyModalOpen] = useState(false);
  const overQtyModalOpenRef = useRef(false);
  // Substituindo overQtyProductName por overQtyContext completo
  const [overQtyContext, setOverQtyContext] = useState<{
    productName: string;
    itemIds: string[];
    workUnitId: string;
    barcode: string;
    targetQty: number;
    message: string;
    serverAlreadyReset: boolean;
  } | null>(null);

  const workUnitsQueryKey = useSessionQueryKey(["/api/work-units?type=conferencia"]);
  const routesQueryKey = useSessionQueryKey(["/api/routes"]);

  const { data: workUnits, isLoading } = useQuery<WorkUnitWithDetails[]>({
    queryKey: workUnitsQueryKey,
    refetchInterval: () =>
      scanWorkerRunningRef.current || scanQueueRef.current.length > 0 ? false : 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // useEffect moved down to fix initialization order

  const activeSessionTokenRef = useRef("");

  useEffect(() => {
    activeSessionTokenRef.current = selectedWorkUnits.join(",") + "|" + step + "|" + checkingTab + "|" + sessionVersion;
  }, [selectedWorkUnits, step, checkingTab, sessionVersion]);

  const { data: routes } = useQuery<{ id: string; code: string; name: string }[]>({
    queryKey: routesQueryKey,
  });

  const pendingInvalidateRef = useRef(false);

  useEffect(() => {
    const handleOnline = () => {
      queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
    };
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
      scanWorkerRunningRef.current = false;
      overQtyModalOpenRef.current = false;
      scanQueueRef.current = [];
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [queryClient, workUnitsQueryKey]);

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
    "picking_update", "lock_acquired", "lock_released", "picking_finished",
    "conference_started", "conference_finished", "exception_created",
    "work_unit_created", "orders_launched", "orders_relaunched",
    "work_units_unlocked", "orders_launch_cancelled",
  ], handleSSEMessage);

  const myLockedUnits = useMemo(() => {
    if (!workUnits || !user) return [];
    return workUnits.filter(wu => wu.lockedBy === user.id && wu.status !== "concluido");
  }, [workUnits, user]);

  const allMyUnits = useMemo(() => {
    if (!workUnits || !user) return [];
    // BUGFIX: Filter out 'concluido' units from allMyUnits so that their 
    // products don't leak into the next order's view.
    let units = workUnits.filter(wu => wu.lockedBy === user.id && wu.status !== "concluido");

    // ISOLAMENTO DE CONTEXTO: Se estamos na tela de conferência, 
    // exija TERMINANTEMENTE que apenas as unidades *selecionadas* para esta rodada apareçam.
    if (step === "checking" && selectedWorkUnits.length > 0) {
      units = units.filter(wu => selectedWorkUnits.includes(wu.id));
    }
    
    return units;
  }, [workUnits, user, step, selectedWorkUnits]);

  useEffect(() => {
    if (allMyUnits.length === 0) return;
    const serverValues: Record<string, number> = {};
    for (const wu of allMyUnits) {
      for (const item of (wu.items as ItemWithProduct[])) {
        if (!serverValues[item.id]) {
          serverValues[item.id] = Number(item.checkedQty);
        }
      }
    }
    usePendingDeltaStore.getState().reconcile("conferencia", serverValues);
  }, [allMyUnits]);

  // Safety: se não houver unidades travadas, voltar para seleção
  useEffect(() => {
    if (step === "checking" && allMyUnits.length === 0 && !isLoading) {
      setStep("select");
      setSelectedWorkUnits([]);
    }
  }, [step, allMyUnits.length, isLoading]);

  const pendingConferencia = usePendingDeltaStore((s) => s.conferencia);

  const aggregatedProducts = useMemo((): AggregatedProduct[] => {
    const units = allMyUnits.length > 0 ? allMyUnits : [];
    const allItems: ItemWithProduct[] = units.flatMap(wu => (wu.items as ItemWithProduct[]) || [])
      .filter(item => Number(item.separatedQty) > 0 || Number(item.quantity) > 0);

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
          totalSeparatedQty: 0,
          checkedQty: 0,
          exceptionQty: 0,
          items: [],
          orderCodes: [],
          sections: [],
        };
      }
      const itemExcQty = Number(item.exceptionQty || 0);
      const iSep = Number(item.separatedQty);
      const targetQty = iSep > 0 ? iSep : (itemExcQty > 0 ? 0 : Number(item.quantity));
      map[pid].totalQty += Number(item.quantity);
      map[pid].totalSeparatedQty += targetQty;
      map[pid].checkedQty += Number(item.checkedQty) + (pendingConferencia[item.id] || 0);
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
  }, [allMyUnits, user, pendingConferencia]);

  const currentProduct = aggregatedProducts[currentProductIndex] || aggregatedProducts[0] || null;

  const confProductIds = useMemo(() => aggregatedProducts.map(ap => ap.product.id), [aggregatedProducts]);
  const { data: addressesMap } = useProductAddressesBatch(confProductIds);

  const { data: stockProducts = [], isLoading: stockLoading } = useQuery<any[]>({
    queryKey: [`/api/products/search?q=${encodeURIComponent(stockDebouncedQuery)}`, companyId],
    enabled: !!companyId && stockDebouncedQuery.length >= 2,
  });

  const handleStockSearch = useCallback((value: string) => {
    setStockQuery(value);
    if (stockQueryTimer.current) clearTimeout(stockQueryTimer.current);
    stockQueryTimer.current = setTimeout(() => setStockDebouncedQuery(value), 350);
  }, []);

  // Buscar log de endereços do separador para os pedidos sendo conferidos
  const confOrderIds = useMemo(() => {
    const ids = new Set<string>();
    allMyUnits.forEach(wu => { if (wu.orderId) ids.add(wu.orderId); });
    return Array.from(ids);
  }, [allMyUnits]);

  const { data: separadorAddressLog = [] } = useQuery<any[]>({
    queryKey: ["address-picking-log-conf", confOrderIds],
    queryFn: async () => {
      if (confOrderIds.length === 0) return [];
      const all: any[] = [];
      await Promise.all(confOrderIds.map(async (oid) => {
        const params = new URLSearchParams({ orderId: oid, limit: "200" });
        try {
          const res = await apiRequest("GET", `/api/picking/address-log?${params}`);
          const data = await res.json();
          all.push(...data);
        } catch {
          // Falha em um pedido não bloqueia os outros
        }
      }));
      return all;
    },
    enabled: confOrderIds.length > 0,
    staleTime: 30000,
  });

  // Indexar por productId → entrada mais recente
  const separadorAddressMap = useMemo<Record<string, { addressCode: string; quantity: number; userName: string }>>(() => {
    const map: Record<string, { addressCode: string; quantity: number; userName: string }> = {};
    for (const entry of separadorAddressLog) {
      if (!map[entry.productId]) {
        map[entry.productId] = { addressCode: entry.addressCode, quantity: entry.quantity, userName: entry.userName || "" };
      }
    }
    return map;
  }, [separadorAddressLog]);

  useEffect(() => {
    if (aggregatedProducts.length > 0 && currentProductIndex >= aggregatedProducts.length) {
      setCurrentProductIndex(0);
    }
  }, [aggregatedProducts.length, currentProductIndex]);

  const productIds = useMemo(() => aggregatedProducts.map(ap => ap.product.id), [aggregatedProducts]);

  useEffect(() => {
    if (workUnits && user && !sessionRestored) {
      setSessionRestored(true);
      const saved = loadSession();
      if (saved && saved.workUnitIds.length > 0) {
        const stillLockedIds = saved.workUnitIds.filter(id =>
          workUnits.some(wu => wu.id === id && wu.lockedBy === user.id)
        );
        if (stillLockedIds.length > 0) {
          setStep("checking");
          setCheckingTab(saved.tab);
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
        setStep("checking");
        setSelectedWorkUnits(myIds);
      }
    }
  }, [workUnits, user, sessionRestored, toast]);

  useEffect(() => {
    if (step === "checking" && allMyUnits.length > 0) {
      saveSession({
        tab: checkingTab,
        productIndex: currentProductIndex,
        workUnitIds: allMyUnits.map(wu => wu.id),
      });
    }
  }, [step, checkingTab, currentProductIndex, allMyUnits]);

  // Ref para acessar allMyUnits dentro do interval sem recriá-lo a cada refetch
  const allMyUnitsHeartbeatRef = useRef(allMyUnits);
  allMyUnitsHeartbeatRef.current = allMyUnits;

  // Renova o lock a cada 4 minutos — depende só de `step` para não resetar o interval a cada refetch
  useEffect(() => {
    if (step !== "checking") return;
    const sendHeartbeat = () => {
      if (allMyUnitsHeartbeatRef.current.length === 0) return;
      allMyUnitsHeartbeatRef.current.forEach(wu => {
        apiRequest("POST", `/api/work-units/${wu.id}/heartbeat`, {}).catch(() => {});
      });
    };
    sendHeartbeat(); // dispara imediatamente ao entrar em checking
    const interval = setInterval(sendHeartbeat, 4 * 60 * 1000);
    return () => clearInterval(interval);
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ao reconectar a rede ou retornar ao app, renova o lock imediatamente
  useEffect(() => {
    if (step !== "checking") return;
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
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
      usePendingDeltaStore.getState().clearItem("conferencia", data._orderItemId);
      usePendingDeltaStore.getState().resetBaseline("conferencia", data._orderItemId);
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

  const completeWorkUnitMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/work-units/${id}/complete-conference`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Erro ao concluir unidade");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
    },
    onError: (error: Error) => {
      toast({ title: "Erro", description: error.message || "Falha ao concluir conferência", variant: "destructive" });
    },
  });

  const clearExceptionsMutation = useMutation({
    mutationFn: async (orderItemId: string) => {
      const res = await apiRequest("DELETE", `/api/exceptions/item/${orderItemId}`);
      return { ...(await res.json()), _orderItemId: orderItemId };
    },
    onSuccess: async (data) => {
      usePendingDeltaStore.getState().clearItem("conferencia", data._orderItemId);
      usePendingDeltaStore.getState().resetBaseline("conferencia", data._orderItemId);
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
      const orderStatus = wu.order.status;
      if (orderStatus !== "separado" && orderStatus !== "em_conferencia") return false;
      if (!wu.order.isLaunched) return false;
      if (wu.status === "concluido") return false;

      if (filterOrderId && !processMultipleOrderSearch(filterOrderId, wu.order.erpOrderId)) return false;

      if (filterRoute && wu.order.routeId !== filterRoute) return false;

      if (!isDateInRange(wu.order.launchedAt || wu.order.createdAt, dateRange)) return false;

      return true;
    }) || [];
  }, [workUnits, user, filterOrderId, filterRoute, dateRange]);

  const groupedWorkUnits = useMemo(() => {
    const groups: Record<string, typeof availableWorkUnits> = {};
    availableWorkUnits.forEach((wu) => {
      if (!groups[wu.orderId]) groups[wu.orderId] = [];
      groups[wu.orderId].push(wu);
    });
    return Object.values(groups);
  }, [availableWorkUnits]);

  const handleSelectGroup = (wus: typeof availableWorkUnits, checked: boolean) => {
    const safeWus = wus.filter(wu => !wu.lockedBy || wu.lockedBy === user?.id);
    const ids = safeWus.map((wu) => wu.id);
    if (ids.length === 0) return;
    if (checked) {
      setSelectedWorkUnits(ids);
    } else {
      setSelectedWorkUnits([]);
    }
  };

  const handleStartConferencia = async () => {
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
            ? { ...wu, lockedBy: user!.id, status: (wu as any).status === "separado" ? "em_conferencia" : wu.status } as WorkUnitWithDetails
            : wu
        );
      });
      setStep("checking");
      setCheckingTab("list");
      setCurrentProductIndex(0);
      setScanStatus("idle");
      setScanMessage("");
      queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
    } catch {
      toast({ title: "Erro", description: "Falha ao bloquear unidades de trabalho", variant: "destructive" });
    }
  };

  const handleCompleteAll = async () => {
    // Verificar se há exceções não autorizadas
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

    // Continuar com finalização normal
    await finalizeWorkUnits();
  };

  const finalizeWorkUnits = async () => {
    scanQueueRef.current = [];
    setQtyModal(null);
    pendingScanContextRef.current.clear();
    clearWsQueue();
    try {
      let anyUnlock = false;
      const completedIds: string[] = []; // Track successfully completed units

      for (const wu of allMyUnits) {
        try {
          await completeWorkUnitMutation.mutateAsync(wu.id);
          completedIds.push(wu.id);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          if (msg === "Existem itens pendentes" || msg.includes("pendentes")) {
            await unlockMutation.mutateAsync({ ids: [wu.id], reset: false });
            anyUnlock = true;
          } else {
            throw error;
          }
        }
      }

      // BUGFIX: HARD PURGE from the cache optimistically
      queryClient.setQueryData(workUnitsQueryKey, (old: any) => {
        if (!old) return old;
        return old.filter((wu: any) => !completedIds.includes(wu.id));
      });

      // Isolamento transacional
      usePendingDeltaStore.getState().clear("conferencia");
      clearSession();
      setExceptionItem(null);
      setOverQtyContext(null);
      scanQueueRef.current = [];
      
      setStep("select");
      setSelectedWorkUnits([]);
      setCurrentProductIndex(0); 
      setCheckingTab("list");    
      setSessionVersion(v => v + 1);
      
      beep("complete");
      if (anyUnlock) {
        toast({ title: "Salvo", description: "Sua parte foi concluída. Pedido liberado para outras seções.", variant: "default" });
      } else {
        toast({ title: "Concluído", description: "Conferência finalizada com sucesso", variant: "default" });
      }
    } catch (error) {
      beep("error");
      toast({ title: "Erro", description: "Falha ao finalizar conferência", variant: "destructive" });
    }
  };

  const handleExceptionAuthorized = async () => {
    await queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
    await finalizeWorkUnits();
  };

  const handleWsCheckAck = useCallback((ack: any) => {
    const ctx = pendingScanContextRef.current.get(ack.msgId);
    if (!ctx) return;
    pendingScanContextRef.current.delete(ack.msgId);

    if (ack.status === "success") {
      queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
    } else if (ack.status === "over_quantity" || ack.status === "over_quantity_with_exception") {
      beep("error");
      ctx.apItems.forEach(item => {
        usePendingDeltaStore.getState().clearItem("conferencia", item.id);
        usePendingDeltaStore.getState().resetBaseline("conferencia", item.id);
      });
      queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
      setOverQtyContext({
        productName: ctx.productName,
        itemIds: ctx.apItems.map(i => i.id),
        workUnitId: ctx.workUnitId,
        barcode: ctx.barcode,
        targetQty: ctx.targetQty,
        message: ack.message || `Quantidade de "${ctx.productName}" excedeu o máximo (${ctx.targetQty}). Conferência reiniciada.`,
        serverAlreadyReset: false,
      });
      setOverQtyModalOpen(true);
      overQtyModalOpenRef.current = true;
    } else if (ack.status === "not_found") {
      beep("warning");
      usePendingDeltaStore.getState().dec("conferencia", ctx.itemId, ctx.qty);
      setScanStatus("warning");
      setScanMessage("Produto não encontrado neste pedido");
    } else if (ack.status === "error") {
      const isLockExpired = (ack.message || "").includes("Lock expirado");
      if (isLockExpired && (ctx.retryCount ?? 0) < 1 && sendCheckRef.current) {
        allMyUnitsHeartbeatRef.current.forEach(wu => {
          apiRequest("POST", `/api/work-units/${wu.id}/heartbeat`, {}).catch(() => {});
        });
        setTimeout(() => {
          if (!sendCheckRef.current) return;
          const newMsgId = generateMsgId();
          pendingScanContextRef.current.set(newMsgId, { ...ctx, retryCount: (ctx.retryCount ?? 0) + 1 });
          sendCheckRef.current(ctx.workUnitId, ctx.barcode, ctx.qty, newMsgId);
        }, 700);
        return;
      }
      beep("error");
      usePendingDeltaStore.getState().dec("conferencia", ctx.itemId, ctx.qty);
      setScanStatus("error");
      setScanMessage(isLockExpired ? "Sessão expirada — saia e entre novamente no pedido" : (ack.message || "Erro ao processar conferência"));
    }
  }, [queryClient, workUnitsQueryKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const wsNamespace = `conferencia:${user?.id ?? ""}:${companyId ?? ""}`;
  const { status: wsStatus, sendCheck, isConnected: wsConnected, clearQueue: clearWsQueue } = useScanWebSocket(step === "checking", handleWsCheckAck, wsNamespace);
  sendCheckRef.current = sendCheck;

  const processScanQueue = useCallback(async () => {
    if (scanWorkerRunningRef.current) return;
    scanWorkerRunningRef.current = true;

    try {
      while (scanQueueRef.current.length > 0) {
        if (overQtyModalOpenRef.current) break;
        const barcode = scanQueueRef.current.shift()!;

        const currentCache = queryClient.getQueryData<any[]>(workUnitsQueryKey) || [];
        const units = currentCache.filter((wu: any) =>
          wu.lockedBy === user?.id && wu.status !== "concluido"
          && (selectedWorkUnits.length === 0 || selectedWorkUnits.includes(wu.id))
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
          setScanMessage("Produto não encontrado nos seus pedidos em aberto");
          continue;
        }

        const { get: getDelta } = usePendingDeltaStore.getState();

        let targetUnit = unitsWithProduct.find((wu: any) => {
          const item = (wu.items as ItemWithProduct[]).find((i: ItemWithProduct) =>
            i.product?.barcode === barcode || i.product?.boxBarcode === barcode || (Array.isArray(i.product?.boxBarcodes) && i.product.boxBarcodes.some((bx: any) => bx.code === barcode))
          );
          if (!item) return false;
          const serverChecked = Number(item.checkedQty);
          const delta = getDelta("conferencia", item.id);
          const iSep = Number(item.separatedQty);
          const iExc = Number(item.exceptionQty || 0);
          const iTarget = iSep > 0 ? iSep : (iExc > 0 ? 0 : Number(item.quantity));
          return serverChecked + delta < iTarget;
        });

        const finalUnit = targetUnit || unitsWithProduct[0];
        if (!finalUnit) continue;

        const matchedItem = (finalUnit.items as ItemWithProduct[]).find(i =>
          i.product?.barcode === barcode || i.product?.boxBarcode === barcode || (Array.isArray(i.product?.boxBarcodes) && i.product.boxBarcodes.some((bx: any) => bx.code === barcode))
        );
        if (!matchedItem) continue;

        const serverChecked = Number(matchedItem.checkedQty);
        const itemDelta = getDelta("conferencia", matchedItem.id);
        const exceptionQty = Number(matchedItem.exceptionQty || 0);
        const iSep = Number(matchedItem.separatedQty);
        const targetQty = iSep > 0 ? iSep : (exceptionQty > 0 ? 0 : Number(matchedItem.quantity));
        const alreadyComplete = serverChecked + itemDelta >= targetQty;

        if (alreadyComplete) {
          setQtyModal(null);
          if (targetQty <= 0) {
            beep("warning");
            setScanStatus("warning");
            setScanMessage(`"${matchedItem.product.name}" está totalmente em exceção. Conferência bloqueada.`);
            break;
          }
          beep("error");
          usePendingDeltaStore.getState().clearItem("conferencia", matchedItem.id);
          usePendingDeltaStore.getState().resetBaseline("conferencia", matchedItem.id);
          setOverQtyContext({
            productName: matchedItem.product.name,
            itemIds: [matchedItem.id],
            workUnitId: finalUnit.id,
            barcode,
            targetQty,
            message: `"${matchedItem.product.name}" já atingiu a quantidade máxima (${targetQty}). A coleta será reiniciada.`,
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
        const remaining = targetQty - (serverChecked + itemDelta);
        const currentModal = qtyModalRef.current;

        if (currentModal && currentModal.productId !== productId) {
          if (currentModal.accumulated > 0) {
            usePendingDeltaStore.getState().inc("conferencia", currentModal.itemId, currentModal.accumulated);
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
            sendCheck(currentModal.workUnitId, currentModal.barcode, currentModal.accumulated, msgId);
          }
          setQtyModal(null);
        }

        if (currentModal && currentModal.productId === productId) {
          const addQty = isBoxBarcode ? boxQtyVal : currentModal.multiplier;
          const newAccumulated = currentModal.accumulated + addQty;
          if (newAccumulated > remaining) {
            beep("error");
            setQtyModal(null);
            usePendingDeltaStore.getState().clearItem("conferencia", currentModal.itemId);
            usePendingDeltaStore.getState().resetBaseline("conferencia", currentModal.itemId);
            toast({ title: "Quantidade excedida", description: "Produto zerado para recontagem. Escaneie novamente.", variant: "destructive" });
            apiRequest("POST", `/api/work-units/${currentModal.workUnitId}/reset-item-check`, { itemIds: [currentModal.itemId] })
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
            targetQty,
            exceptionQty: Number(matchedItem.exceptionQty ?? 0),
          });
        }

        setScanStatus("idle");
        setScanMessage("");

        const idx = aggregatedProducts.findIndex(ap => ap.product.id === productId);
        if (idx >= 0) setCurrentProductIndex(idx);
        setCheckingTab("product");
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
  }, [queryClient, workUnitsQueryKey, user, aggregatedProducts, selectedWorkUnits]);

  const handleScanItem = useCallback((barcode: string) => {
    if (overQtyModalOpenRef.current) return;
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    scanQueueRef.current.push(barcode);
    processScanQueue();
  }, [processScanQueue]);

  const globalScanHandler = useCallback((barcode: string) => {
    if (step === "checking") {
      handleScanItem(barcode);
    }
  }, [step, handleScanItem]);

  useBarcodeScanner(globalScanHandler, step === "checking" && !showStockModal && !showQuickLinkModal);

  const handleConfirmQtyModal = useCallback(() => {
    const modal = qtyModalRef.current;
    if (!modal || modal.accumulated <= 0) return;
    usePendingDeltaStore.getState().inc("conferencia", modal.itemId, modal.accumulated);
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
    sendCheck(modal.workUnitId, modal.barcode, modal.accumulated, msgId);
    setQtyModal(null);
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      if (scanQueueRef.current.length === 0 && !scanWorkerRunningRef.current) {
        queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
      }
    }, 300);
  }, [sendCheck, queryClient, workUnitsQueryKey]);

  const handleQtyModalAdd = useCallback(() => {
    const modal = qtyModalRef.current;
    if (!modal) return;
    const newAccumulated = modal.accumulated + modal.multiplier;
    if (newAccumulated > modal.maxRemaining) {
      setQtyModal(null);
      usePendingDeltaStore.getState().clearItem("conferencia", modal.itemId);
      usePendingDeltaStore.getState().resetBaseline("conferencia", modal.itemId);
      toast({ title: "Quantidade excedida", description: "Produto zerado para recontagem. Escaneie novamente.", variant: "destructive" });
      apiRequest("POST", `/api/work-units/${modal.workUnitId}/reset-item-check`, { itemIds: [modal.itemId] })
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

  const handleOverQtyRecount = async () => {
    if (!overQtyContext) return;
    const ctx = overQtyContext;

    ctx.itemIds.forEach(id => {
      usePendingDeltaStore.getState().clearItem("conferencia", id);
      usePendingDeltaStore.getState().resetBaseline("conferencia", id);
    });

    setOverQtyModalOpen(false);
    overQtyModalOpenRef.current = false;

    // Dispara o reset real de forma explícita e segura usando os IDs dos itens afetados
    try {
      await apiRequest("POST", `/api/work-units/${ctx.workUnitId}/reset-item-check`, { 
        itemIds: ctx.itemIds
      });
    } catch (err) {
      /* Erro no reset — UI atualizada via invalidateQueries */
    }

    setOverQtyContext(null);
    setScanStatus("idle");
    setScanMessage("");
    
    // Limpa a fila pendente blindando contra reprocessamento ou loop do mesmo barcode
    scanQueueRef.current = [];
    setTimeout(() => processScanQueue(), 0);

    queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
  };

  const handleCancelChecking = (shouldReset: boolean) => {
    setAbandonConfirmOpen(false);
    scanQueueRef.current = [];
    setQtyModal(null);
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    usePendingDeltaStore.getState().clear("conferencia");
    pendingScanContextRef.current.clear();
    clearWsQueue();
    const ids = allMyUnits.map(wu => wu.id);
    clearSession();
    setExceptionItem(null);
    setOverQtyContext(null);
    setStep("select");
    setSelectedWorkUnits([]);
    setCurrentProductIndex(0);
    setCheckingTab("list");
    setSessionVersion(v => v + 1);
    if (ids.length > 0) {
      unlockMutation.mutate({ ids, reset: shouldReset });
    }
  };

  const handleExitChecking = () => {
    setAbandonConfirmOpen(true);
  };


  const handleNextProduct = () => {
    const total = aggregatedProducts.length;
    if (total === 0) return;
    const nextIncompleteIdx = aggregatedProducts.findIndex((ap, idx) => {
      if (idx <= currentProductIndex) return false;
      return ap.totalSeparatedQty - ap.checkedQty > 0;
    });

    if (nextIncompleteIdx >= 0) {
      setCurrentProductIndex(nextIncompleteIdx);
      return;
    }

    const wrapIncompleteIdx = aggregatedProducts.findIndex((ap, idx) => {
      if (idx === currentProductIndex) return false;
      return ap.totalSeparatedQty - ap.checkedQty > 0;
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
    const total = aggregatedProducts.reduce((s, ap) => s + ap.totalSeparatedQty, 0);
    const done = aggregatedProducts.reduce((s, ap) => s + Math.min(ap.checkedQty, ap.totalSeparatedQty), 0);
    return total > 0 ? (done / total) * 100 : 0;
  };

  const allItemsComplete = aggregatedProducts.length > 0 && aggregatedProducts.every(ap =>
    ap.checkedQty >= ap.totalSeparatedQty
  );

  const handleApplyDateFilter = () => {
    setDateRange(tempDateRange);
  };

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden" data-module="conferencia">
      <header className="flex items-center justify-between px-3 py-2.5 border-b border-border bg-card">
        <div className="flex items-center gap-2 min-w-0">
          <img src="/stoker-icon.png" alt="Stoker" className="h-6 w-6 shrink-0 grayscale opacity-60 dark:opacity-40" />
          <span className="text-sm font-semibold truncate">{user?.name}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setVolumeModalOpen(true)}
            className="h-10 w-10 border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-300"
            title="Gerar Volume"
          >
            <PackageOpen className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={logout} className="h-10 w-10" data-testid="button-logout">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {step === "select" && (
        <div className="flex-1 flex flex-col min-h-0 px-3 py-3 gap-3 overflow-hidden">
          <div className="shrink-0">
            {(() => {
              const activeCount = [filterOrderId, filterRoute, dateRange].filter(Boolean).length;
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
                <div className="flex items-center gap-2">
                  <Truck className="h-4 w-4 text-muted-foreground shrink-0" />
                  <Select value={filterRoute} onValueChange={(val) => setFilterRoute(val === "__all__" ? "" : val)}>
                    <SelectTrigger className="h-9 text-sm flex-1">
                      <SelectValue placeholder="Todas as rotas" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">Todas as rotas</SelectItem>
                      {routes?.map(route => (
                        <SelectItem key={route.id} value={route.id}>{route.code} - {route.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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

                    let createdAt = "";
                    try {
                      createdAt = format(new Date(firstWU.order.launchedAt || firstWU.order.createdAt), "dd/MM HH:mm");
                    } catch { }

                    const routeName = routes?.find(r => r.id === firstWU.order.routeId)?.name;

                    return (
                      <div
                        key={firstWU.orderId}
                        className={`flex items-center gap-3 p-3 rounded-lg transition-colors min-h-[56px] ${lockedByOther
                          ? "opacity-50 cursor-not-allowed border border-border"
                          : isSelected ? "border-2 border-indigo-500 bg-indigo-500/5" : "border border-border"
                          }`}
                        onClick={() => !lockedByOther && handleSelectGroup(group, !isSelected)}
                        data-testid={`order-group-${firstWU.orderId}`}
                      >
                        {lockedByOther ? (
                          <Lock className="h-5 w-5 text-muted-foreground shrink-0" />
                        ) : (
                          <div
                            className={`h-5 w-5 rounded-full border-2 shrink-0 flex items-center justify-center ${isSelected ? "border-indigo-500 bg-indigo-500" : "border-muted-foreground"}`}
                            data-testid={`radio-order-${firstWU.orderId}`}
                          >
                            {isSelected && <Check className="h-3 w-3 text-white" />}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-sm font-bold">{firstWU.order.erpOrderId}</span>
                            {routeName && <span className="text-[10px] px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded font-medium dark:bg-indigo-900/30 dark:text-indigo-300">{routeName}</span>}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{firstWU.order.customerName}</p>
                          {lockedByOther && (
                            <p className="text-[10px] text-orange-600 font-medium flex items-center gap-1 mt-0.5">
                              <Lock className="h-3 w-3" />
                              {lockerName || "outro usuário"}
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-mono text-sm font-bold tabular-nums">{distinctProductCount}</p>
                          <p className="text-[10px] text-muted-foreground">{createdAt}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <Button
                className="w-full h-14 text-base font-bold bg-indigo-600 hover:bg-indigo-700 text-white shrink-0 active:scale-[0.98] transition-transform"
                onClick={handleStartConferencia}
                disabled={selectedWorkUnits.length === 0 || lockMutation.isPending}
                data-testid="button-start-conferencia"
              >
                <ClipboardCheck className="h-5 w-5 mr-2" />
                Conferir
                {selectedWorkUnits.length > 0 && ` (${new Set(
                  workUnits?.filter(wu => selectedWorkUnits.includes(wu.id)).map(wu => wu.orderId)
                ).size})`}
              </Button>
            </>
          ) : (
            <div className="text-center py-10 text-muted-foreground">
              <ClipboardCheck className="h-12 w-12 mx-auto mb-3 opacity-40" />
              <p className="text-sm font-medium">Nenhum pedido para conferir</p>
              <p className="text-xs">Aguarde a conclusão das separações</p>
            </div>
          )}
        </div>
      )}

      {step === "checking" && (
        <>
          <div className="px-3 pt-1.5 pb-1 space-y-1 border-b border-border bg-card">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground truncate">
                {allMyUnits.map(wu => wu.order.erpOrderId).filter((v, i, a) => a.indexOf(v) === i).join(", ")}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowQuickLinkModal(true)}
                  title="Vínculo rápido de embalagem"
                  data-testid="button-quick-link-conferencia"
                >
                  <Link2 className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => { setSoundOn(s => { const next = !s; persistSoundEnabled(next); return next; }); }}
                  data-testid="button-toggle-sound-conferencia"
                >
                  {soundOn ? <Volume2 className="h-3 w-3" /> : <VolumeX className="h-3 w-3 text-muted-foreground" />}
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
              className="[&_input]:h-9 [&_input]:text-sm"
            />
          </div>

          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {checkingTab === "product" && currentProduct && (
              <div className="flex flex-col h-full min-h-0">
                <div className="flex-1 overflow-y-scroll px-2 py-2 space-y-2 touch-pan-y overscroll-contain">
                  <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">

                    {/* ── Quantidade em destaque no topo ─────────── */}
                    <div className="px-3 pt-2 pb-2 bg-indigo-500/5 border-b border-border/60 flex items-center justify-between gap-3">
                      <div className="flex items-baseline gap-1.5">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Conferido</p>
                        {currentProduct.exceptionQty > 0 && (
                          <span className="text-[9px] font-semibold text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-800 px-1.5 py-0.5 rounded">
                            {currentProduct.exceptionQty} exc
                          </span>
                        )}
                      </div>
                      <p className="text-4xl font-extrabold tabular-nums leading-none">
                        {currentProduct.checkedQty}
                        <span className="text-muted-foreground font-normal text-xl ml-1">/ {currentProduct.totalSeparatedQty}</span>
                      </p>
                    </div>

                    {/* ── Barra de progresso ────────────────────── */}
                    <div className="h-1.5 bg-muted">
                      <div
                        className="h-full bg-indigo-500 transition-all duration-300"
                        style={{ width: `${Math.min(100, currentProduct.totalSeparatedQty > 0 ? (currentProduct.checkedQty / currentProduct.totalSeparatedQty) * 100 : 0)}%` }}
                      />
                    </div>

                    {/* ── Cabeçalho do produto ───────────────────── */}
                    <div className="px-3 pt-2 pb-2">
                      <div className="flex items-center gap-1 flex-wrap mb-1">
                        {currentProduct.orderCodes.map(code => (
                          <span key={code} className="text-[9px] bg-indigo-500/10 text-indigo-600 px-1.5 py-0.5 rounded font-mono font-semibold">{code}</span>
                        ))}
                      </div>
                      <p className="text-sm font-semibold leading-snug break-words">{currentProduct.product.name}</p>
                      <div className="flex items-center flex-wrap gap-x-2 mt-0.5">
                        {currentProduct.product.manufacturer && (
                          <span className="text-[10px] text-muted-foreground">Fab.: {currentProduct.product.manufacturer}</span>
                        )}
                        <span className="text-[10px] text-muted-foreground">
                          Cód.: <span className="font-mono font-semibold text-foreground">{currentProduct.product.erpCode}</span>
                        </span>
                        {currentProduct.product.barcode && (
                          <span className="text-[10px] font-mono text-muted-foreground/80">{currentProduct.product.barcode}</span>
                        )}
                      </div>
                    </div>

                    {/* ── Endereço de onde foi separado ─────────── */}
                    {separadorAddressMap[currentProduct.product.id] ? (
                      <div className="mx-3 mb-2 flex items-center gap-2 px-2 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800" data-testid="product-picked-address">
                        <MapPinIcon className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[9px] text-blue-500 font-semibold uppercase tracking-wide">Separado do endereço</p>
                          <p className="font-mono font-bold text-blue-700 dark:text-blue-300 text-xs">
                            {separadorAddressMap[currentProduct.product.id].addressCode}
                          </p>
                        </div>
                      </div>
                    ) : null}

                  </div>
                </div>

                <div className="px-2 pb-2 pt-1.5 border-t bg-background mt-auto space-y-1.5">
                  <div className="flex gap-1.5">
                    <Button
                      variant="outline"
                      className="h-10 px-3"
                      onClick={() => {
                        const firstIncompleteItem = currentProduct.items.find(i =>
                          Number(i.quantity) > Number(i.checkedQty || 0) + Number(i.exceptionQty || 0)
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
                      className="h-10 px-3 text-blue-600 border-blue-300 hover:bg-blue-50 dark:text-blue-400 dark:border-blue-700 dark:hover:bg-blue-950"
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
                      className="h-10 px-3 text-destructive border-destructive/30 hover:bg-destructive/10"
                      onClick={handleExitChecking}
                      disabled={unlockMutation.isPending}
                      data-testid="button-cancel-checking"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                    <Button
                      className="flex-1 h-10 text-sm"
                      onClick={handleNextProduct}
                    >
                      <ArrowRight className="h-4 w-4 mr-1" />
                      Próximo
                    </Button>
                  </div>
                  <Button
                    className="w-full h-11 text-sm font-bold bg-green-600 hover:bg-green-700 active:scale-[0.98] transition-transform"
                    onClick={handleCompleteAll}
                    disabled={!allItemsComplete || completeWorkUnitMutation.isPending}
                    data-testid="button-complete-checking"
                  >
                    <Check className="h-4 w-4 mr-1.5" />
                    Concluir
                  </Button>
                </div>
              </div>
            )}

            {checkingTab === "product" && !currentProduct && aggregatedProducts.length === 0 && (
              <div className="flex-1 flex items-center justify-center p-4 text-muted-foreground text-sm">
                Nenhum produto para conferir
              </div>
            )}

            {checkingTab === "list" && (
              <div className="flex flex-col h-full min-h-0">
                <div className="flex-1 overflow-y-scroll px-2 py-1.5 space-y-1.5 touch-pan-y overscroll-contain">

                  {/* Progress summary */}
                  <div className="flex items-center justify-between px-1 pb-0.5">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Produtos</span>
                    <div className="text-[11px]">
                      <span className="font-bold text-foreground">
                        {aggregatedProducts.filter(ap => ap.totalSeparatedQty - ap.checkedQty <= 0).length}
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
                      const remaining = ap.totalSeparatedQty - ap.checkedQty;
                      const isComplete = remaining <= 0;
                      const hasException = ap.exceptionQty > 0;

                      return (
                        <div
                          key={ap.product.id}
                          className={`flex bg-card rounded-lg border shadow-sm cursor-pointer active:scale-[0.99] transition-all overflow-hidden ${
                            isComplete
                              ? hasException
                                ? "border-amber-200/80 dark:border-amber-800/60"
                                : "border-green-200/80 dark:border-green-800/60"
                              : "border-border"
                          }`}
                          onClick={() => {
                            setCurrentProductIndex(idx);
                            setCheckingTab("product");
                          }}
                        >
                          <div className={`w-1 shrink-0 ${
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
                                  {ap.product.manufacturer && (
                                    <span className="text-[10px] text-muted-foreground truncate">{ap.product.manufacturer}</span>
                                  )}
                                  {ap.orderCodes.map(code => (
                                    <span key={code} className="text-[9px] bg-primary/10 text-primary px-1 py-0.5 rounded font-mono font-semibold">{code}</span>
                                  ))}
                                  {separadorAddressMap[ap.product.id] && (
                                    <span className="text-[9px] bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 px-1 py-0.5 rounded font-mono font-semibold">
                                      {separadorAddressMap[ap.product.id].addressCode}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="text-right shrink-0 ml-1">
                                <div className="text-base font-bold tabular-nums leading-tight">
                                  <span className={isComplete && !hasException ? "text-green-600 dark:text-green-400" : ""}>{ap.checkedQty}</span>
                                  <span className="text-xs text-muted-foreground font-normal">/{ap.totalSeparatedQty}</span>
                                </div>
                                {ap.exceptionQty > 0 && (
                                  <div className="text-[9px] text-orange-500 font-semibold">{ap.exceptionQty} exc</div>
                                )}
                              </div>
                            </div>
                            {!isComplete && ap.totalSeparatedQty > 0 && (
                              <div className="mt-1">
                                <div className="h-0.5 bg-muted rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-primary rounded-full transition-all"
                                    style={{ width: `${Math.min(100, (ap.checkedQty / ap.totalSeparatedQty) * 100)}%` }}
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

                <div className="px-2 pb-2 pt-1.5 border-t bg-background mt-auto space-y-1.5">
                  <div className="flex gap-1.5">
                    <Button
                      variant="outline"
                      className="h-10 px-3 text-destructive border-destructive/30 hover:bg-destructive/10"
                      onClick={handleExitChecking}
                      disabled={unlockMutation.isPending}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                    <Button
                      className="flex-1 h-11 text-sm font-bold bg-green-600 hover:bg-green-700 active:scale-[0.98] transition-transform"
                      onClick={handleCompleteAll}
                      disabled={!allItemsComplete || completeWorkUnitMutation.isPending}
                    >
                      <Check className="h-4 w-4 mr-1.5" />
                      Concluir
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <nav className="flex border-t border-border bg-card shrink-0">
            <button
              className={`flex-1 flex flex-col items-center py-2 gap-0.5 transition-colors ${checkingTab === "product" ? "text-indigo-600 bg-indigo-500/5" : "text-muted-foreground"
                }`}
              onClick={() => setCheckingTab("product")}
            >
              <Package className="h-5 w-5" />
              <span className="text-[10px] font-medium">Produto</span>
            </button>
            <button
              className={`flex-1 flex flex-col items-center py-2 gap-0.5 transition-colors ${checkingTab === "list" ? "text-indigo-600 bg-indigo-500/5" : "text-muted-foreground"
                }`}
              onClick={() => setCheckingTab("list")}
            >
              <List className="h-5 w-5" />
              <span className="text-[10px] font-medium">Lista</span>
            </button>
          </nav>
        </>
      )}

      <Dialog open={abandonConfirmOpen} onOpenChange={setAbandonConfirmOpen}>
        <DialogContent className="max-w-sm" data-scan-exclude="true">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Sair da conferência
            </DialogTitle>
            <DialogDescription className="pt-1 space-y-2 text-left">
              <span className="block">Escolha o que fazer com o progresso desta conferência:</span>
              <span className="block text-sm">
                <strong>Suspender</strong> — sai da tela e mantém tudo que foi conferido. Você poderá retomar depois.
              </span>
              <span className="block text-sm text-destructive">
                <strong>Abandonar</strong> — apaga TODO o progresso desta conferência e libera os pedidos. Essa ação não pode ser desfeita.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              variant="outline"
              className="w-full justify-center gap-2"
              onClick={() => handleCancelChecking(false)}
              disabled={unlockMutation.isPending}
              data-testid="button-suspend-checking"
            >
              <Pause className="h-4 w-4" />
              Suspender (manter progresso)
            </Button>
            <Button
              variant="destructive"
              className="w-full justify-center gap-2"
              onClick={() => handleCancelChecking(true)}
              disabled={unlockMutation.isPending}
              data-testid="button-abandon-checking"
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
              Cancelar (continuar conferindo)
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

      {exceptionItem && (
        <ExceptionDialog
          open={showExceptionDialog}
          onOpenChange={setShowExceptionDialog}
          productName={exceptionItem.product.name}
          maxQuantity={Math.max(0, Number(exceptionItem.separatedQty) - Number(exceptionItem.checkedQty) - (exceptionItem.exceptionQty || 0))}
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
          onClearExceptions={() => {
            clearExceptionsMutation.mutate(exceptionItem.id);
            setShowExceptionDialog(false);
          }}
          isSubmitting={createExceptionMutation.isPending}
          isClearing={clearExceptionsMutation.isPending}
        />
      )}

      <ExceptionAuthorizationModal
        open={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        exceptions={pendingExceptions}
        onAuthorized={handleExceptionAuthorized}
      />

      {overQtyContext && (
        <AlertDialog open={overQtyModalOpen} onOpenChange={setOverQtyModalOpen} key={overQtyContext.workUnitId || 'qty-modal'}>
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
                onClick={handleOverQtyRecount}
              >
                Recontar produto
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* Modal Gerar Volume — acessível em qualquer etapa da conferência */}
      <VolumeModal
        open={volumeModalOpen}
        onClose={() => setVolumeModalOpen(false)}
        defaultErpOrderId={myLockedUnits[0]?.order?.erpOrderId ?? null}
      />

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

    </div>
  );
}
