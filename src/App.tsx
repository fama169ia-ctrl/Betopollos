import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  BarChart3,
  Bell,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  DollarSign,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Flame,
  KeyRound,
  Layers,
  Lock,
  Mail,
  Maximize2,
  PackagePlus,
  Plus,
  QrCode,
  Radio,
  Receipt,
  RefreshCw,
  Send,
  ShoppingBag,
  Smartphone,
  Sun,
  Trash2,
  TrendingUp,
  Tv,
  Unlock,
  UtensilsCrossed,
  Volume2,
  VolumeX,
  Wallet,
  Webhook,
  X,
} from 'lucide-react';
import {
  computeFinancialMetrics,
  generateDailyExcelWorkbook,
  sendExcelToWebhook,
  shareExcelViaNavigator,
  triggerExcelDownload,
} from './excelAndShare';
import {
  calculateProductRecipeCost,
  createDefaultState,
  formatCLP,
  formatQty,
  getFutureTimeStr,
  getNowTimeStr,
  getSupplyRemainingStock,
  getTodayDateStr,
  STORAGE_KEY,
} from './initialData';
import { downloadStandaloneSingleFileHtml } from './standaloneHtmlGenerator';
import {
  ActiveTab,
  AppState,
  CustomerOrder,
  DuoRole,
  DuoSyncMessage,
  OrderItemLine,
  PaymentMethod,
  ProductCategory,
  ProductItem,
  RecipeIngredient,
  SaleRecord,
  SupplyItem,
} from './types';
import { useOnlineStatus, usePWAInstall } from './usePWAInstall';

// Sound synthesizer for iPhone Duo intercom and alerts (no external audio files needed)
function playDuoSound(type: 'cocina' | 'caja' | 'alerta') {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'alerta') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(659.25, now + 0.15);
      osc.frequency.setValueAtTime(880, now + 0.3);
      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
      osc.start(now);
      osc.stop(now + 0.7);
    } else if (type === 'cocina') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.setValueAtTime(880, now + 0.12);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      osc.start(now);
      osc.stop(now + 0.6);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.1);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      osc.start(now);
      osc.stop(now + 0.5);
    }
  } catch {
    // Audio restrictions
  }
}

function triggerDuoHaptic(type: 'light' | 'medium' | 'heavy' = 'medium') {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      if (type === 'light') navigator.vibrate(40);
      else if (type === 'heavy') navigator.vibrate([120, 60, 120]);
      else navigator.vibrate(80);
    } catch {
      // Haptics not available
    }
  }
}

export function App() {
  // Persistent state in localStorage
  const [state, setState] = useState<AppState>(() => {
    try {
      let saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) {
        saved = localStorage.getItem('el_brasero_asaduria_state_v1');
      }
      if (saved) {
        const parsed = JSON.parse(saved) as AppState;
        if (parsed && Array.isArray(parsed.supplies) && Array.isArray(parsed.products)) {
          return parsed;
        }
      }
    } catch {
      // Fallback to default state
    }
    return createDefaultState();
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore quota errors
    }
  }, [state]);

  // Live clock tick every 30s for oven timers & order countdowns
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNowTick(Date.now()), 20000);
    return () => clearInterval(interval);
  }, []);

  // Navigation & UI state
  const [activeTab, setActiveTab] = useState<ActiveTab>('pos');
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'warning' | 'error' | 'info' } | null>(
    null
  );

  const showToast = (text: string, type: 'success' | 'warning' | 'error' | 'info' = 'success') => {
    setToast({ text, type });
    setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, 4200);
  };

  // PWA hooks
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const isOnline = useOnlineStatus();
  const [showIOSModal, setShowIOSModal] = useState(false);

  // =========================================================================
  // EMPLOYEE AUTHENTICATION & POS LOCK (PIN: 0503)
  // =========================================================================
  const EMPLOYEE_PIN = '0503';
  const AUTH_STORAGE_KEY = 'beto_pollos_pos_auth_v1';
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    try {
      return (
        sessionStorage.getItem(AUTH_STORAGE_KEY) === 'true' ||
        localStorage.getItem(AUTH_STORAGE_KEY) === 'true'
      );
    } catch {
      return false;
    }
  });
  const [rememberDevice, setRememberDevice] = useState<boolean>(true);
  const [pinInput, setPinInput] = useState<string>('');
  const [pinError, setPinError] = useState<string>('');
  const [isPinShaking, setIsPinShaking] = useState<boolean>(false);

  const handlePinDigit = (digit: string) => {
    if (pinInput.length >= 4) return;
    setPinError('');
    const newPin = pinInput + digit;
    setPinInput(newPin);
    triggerDuoHaptic('light');

    if (newPin.length === 4) {
      if (newPin === EMPLOYEE_PIN) {
        playDuoSound('cocina');
        triggerDuoHaptic('medium');
        setIsAuthenticated(true);
        try {
          sessionStorage.setItem(AUTH_STORAGE_KEY, 'true');
          if (rememberDevice) {
            localStorage.setItem(AUTH_STORAGE_KEY, 'true');
          }
        } catch {
          // ignore quota
        }
        showToast('¡Acceso concedido! Terminal Beto Pollos desbloqueada.', 'success');
        setPinInput('');
      } else {
        playDuoSound('alerta');
        triggerDuoHaptic('heavy');
        setIsPinShaking(true);
        setPinError('PIN incorrecto. Clave autorizada requerida: 0503');
        setTimeout(() => {
          setIsPinShaking(false);
          setPinInput('');
        }, 800);
      }
    }
  };

  const handlePinBackspace = () => {
    setPinError('');
    setPinInput((prev) => prev.slice(0, -1));
    triggerDuoHaptic('light');
  };

  const handlePinClear = () => {
    setPinError('');
    setPinInput('');
    triggerDuoHaptic('light');
  };

  const handleLockPOS = () => {
    setIsAuthenticated(false);
    setPinInput('');
    setPinError('');
    try {
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
      localStorage.removeItem(AUTH_STORAGE_KEY);
    } catch {
      //
    }
    showToast('Terminal bloqueada. Requiere PIN de empleado.', 'info');
  };

  useEffect(() => {
    if (isAuthenticated) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        handlePinDigit(e.key);
      } else if (e.key === 'Backspace') {
        handlePinBackspace();
      } else if (e.key === 'Escape' || e.key === 'c' || e.key === 'C') {
        handlePinClear();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isAuthenticated, pinInput, rememberDevice]);

  // =========================================================================
  // DERIVED KITCHEN & INVENTORY METRICS
  // =========================================================================
  const rawChickenSupply = useMemo(
    () => state.supplies.find((s) => s.isRawChicken || s.id === 'sup_pollo_crudo') || state.supplies[0],
    [state.supplies]
  );

  // Total physical chickens remaining in the store (from Inventory table)
  const totalChickenStockInStore = useMemo(
    () => (rawChickenSupply ? getSupplyRemainingStock(rawChickenSupply) : 0),
    [rawChickenSupply]
  );

  // Chickens currently in the oven (Etapa 2)
  const chickensInOven = useMemo(
    () => state.ovenBatches.reduce((sum, b) => sum + b.quantity, 0),
    [state.ovenBatches]
  );

  // Chickens in cold storage / raw waiting to go into oven (Etapa 1)
  const rawChickensInCooler = useMemo(() => {
    const raw = totalChickenStockInStore - state.cookedChickensInShowcase - chickensInOven;
    return Math.max(0, Math.round(raw * 100) / 100);
  }, [totalChickenStockInStore, state.cookedChickensInShowcase, chickensInOven]);

  // Chickens reserved by pending orders (Etapa 3 - Reservados)
  const reservedChickensInOrders = useMemo(() => {
    const res = state.orders
      .filter((o) => o.deliveryStatus === 'Pendiente')
      .reduce((sum, o) => sum + o.totalCookedChicken, 0);
    return Math.round(res * 100) / 100;
  }, [state.orders]);

  // Chickens available for immediate counter sale (Etapa 3 - Disponibles)
  const availableChickensForImmediateSale = useMemo(() => {
    const avail = state.cookedChickensInShowcase - reservedChickensInOrders;
    return Math.round(avail * 100) / 100;
  }, [state.cookedChickensInShowcase, reservedChickensInOrders]);

  const financialMetrics = useMemo(() => computeFinancialMetrics(state), [state]);

  // =========================================================================
  // MODULE 1: POS STATE & HANDLERS
  // =========================================================================
  const [posCategory, setPosCategory] = useState<'Todos' | ProductCategory>('Todos');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [posPaymentMethod, setPosPaymentMethod] = useState<PaymentMethod>('Efectivo');
  const [cashPaidInput, setCashPaidInput] = useState<string>('');
  const [allowNegativeShowcase, setAllowNegativeShowcase] = useState<boolean>(false);

  // Petty Cash Modal State
  const [showPettyCashModal, setShowPettyCashModal] = useState<boolean>(false);
  const [pettyAmount, setPettyAmount] = useState<string>('');
  const [pettyReason, setPettyReason] = useState<string>('');

  // =========================================================================
  // MENU & PRICE MANAGEMENT (CLAVE REQUERIDA: Betopollos)
  // Permite modificar nombres de combos, acompañamientos y pollos
  // =========================================================================
  const PRICE_ADMIN_PASSWORD = 'Betopollos';
  const [isPriceUnlocked, setIsPriceUnlocked] = useState<boolean>(false);
  const [showPasswordModal, setShowPasswordModal] = useState<boolean>(false);
  const [passwordInput, setPasswordInput] = useState<string>('');
  const [passwordError, setPasswordError] = useState<string>('');
  const [showPasswordText, setShowPasswordText] = useState<boolean>(false);
  const [showPriceManagerModal, setShowPriceManagerModal] = useState<boolean>(false);
  const [targetProductForPriceEdit, setTargetProductForPriceEdit] = useState<ProductItem | null>(null);
  type MenuManagerTabType = 'Todos' | ProductCategory | 'Insumos';
  const [menuManagerTab, setMenuManagerTab] = useState<MenuManagerTabType>('Todos');
  const [showNewProductForm, setShowNewProductForm] = useState<boolean>(false);
  const [newProdName, setNewProdName] = useState<string>('');
  const [newProdCategory, setNewProdCategory] = useState<ProductCategory>('Combos');
  const [newProdPrice, setNewProdPrice] = useState<string>('');
  const [newProdDesc, setNewProdDesc] = useState<string>('');
  const [newProdChickens, setNewProdChickens] = useState<string>('0');

  // Draft state for unified batch editing of prices, names and supplies
  const [draftProducts, setDraftProducts] = useState<ProductItem[]>(() => state.products);
  const [draftSupplies, setDraftSupplies] = useState<SupplyItem[]>(() => state.supplies);

  // Sync drafts when state changes or modal opens
  const syncDraftsFromState = () => {
    setDraftProducts(JSON.parse(JSON.stringify(state.products)));
    setDraftSupplies(JSON.parse(JSON.stringify(state.supplies)));
  };

  const pendingChangesCount = useMemo(() => {
    let count = 0;
    draftProducts.forEach((dp) => {
      const orig = state.products.find((p) => p.id === dp.id);
      if (
        !orig ||
        orig.name !== dp.name ||
        orig.price !== dp.price ||
        orig.shortDesc !== dp.shortDesc ||
        orig.cookedChickenUnits !== dp.cookedChickenUnits
      ) {
        count++;
      }
    });
    draftSupplies.forEach((ds) => {
      const orig = state.supplies.find((s) => s.id === ds.id);
      if (
        !orig ||
        orig.name !== ds.name ||
        orig.unitCost !== ds.unitCost ||
        orig.initialStock !== ds.initialStock
      ) {
        count++;
      }
    });
    return count;
  }, [draftProducts, draftSupplies, state.products, state.supplies]);

  const handleOpenPriceModalForProduct = (product: ProductItem) => {
    setTargetProductForPriceEdit(product);
    syncDraftsFromState();
    if (!isPriceUnlocked) {
      setPasswordInput('');
      setPasswordError('');
      setShowPasswordModal(true);
    } else {
      setShowPriceManagerModal(true);
    }
  };

  const handleOpenGeneralPriceManager = () => {
    setTargetProductForPriceEdit(null);
    syncDraftsFromState();
    if (!isPriceUnlocked) {
      setPasswordInput('');
      setPasswordError('');
      setShowPasswordModal(true);
    } else {
      setShowPriceManagerModal(true);
    }
  };

  const handleVerifyPassword = (e: React.FormEvent) => {
    e.preventDefault();
    const entered = passwordInput.trim();
    if (
      entered.toLowerCase() === PRICE_ADMIN_PASSWORD.toLowerCase() ||
      entered === '0503'
    ) {
      setIsPriceUnlocked(true);
      setPasswordError('');
      setShowPasswordModal(false);
      syncDraftsFromState();
      showToast('Clave autorizada ("Betopollos"). Menú listo para modificar nombres, precios e insumos.', 'success');
      setShowPriceManagerModal(true);
    } else {
      setPasswordError('Clave incorrecta. Clave de administrador requerida: Betopollos');
    }
  };

  const handleDraftProductChange = (
    productId: string,
    field: 'name' | 'shortDesc' | 'price' | 'cookedChickenUnits',
    value: string | number
  ) => {
    setDraftProducts((prev) =>
      prev.map((p) => {
        if (p.id !== productId) return p;
        if (field === 'price') {
          const num = Math.max(0, Math.round(Number(value) || 0));
          return { ...p, price: num };
        }
        if (field === 'cookedChickenUnits') {
          const num = Math.max(0, Number(value) || 0);
          return { ...p, cookedChickenUnits: num };
        }
        return { ...p, [field]: String(value) };
      })
    );
  };

  const handleDraftSupplyChange = (
    supplyId: string,
    field: 'name' | 'unitCost' | 'initialStock',
    value: string | number
  ) => {
    setDraftSupplies((prev) =>
      prev.map((s) => {
        if (s.id !== supplyId) return s;
        if (field === 'unitCost') {
          const num = Math.max(0, Math.round(Number(value) || 0));
          return { ...s, unitCost: num };
        }
        if (field === 'initialStock') {
          const num = Math.max(0, Number(value) || 0);
          return { ...s, initialStock: num };
        }
        return { ...s, [field]: String(value) };
      })
    );
  };

  const handleSaveAllPricesAndSupplies = () => {
    // Validate products
    for (const p of draftProducts) {
      if (!p.name.trim()) {
        showToast('Todos los productos y combos deben tener un nombre válido.', 'error');
        return;
      }
      if (p.price <= 0) {
        showToast(`El ítem "${p.name}" debe tener un precio de venta mayor a $0.`, 'error');
        return;
      }
    }

    // Validate supplies
    for (const s of draftSupplies) {
      if (!s.name.trim()) {
        showToast('Todos los insumos deben tener un nombre asignado.', 'error');
        return;
      }
      if (s.unitCost < 0) {
        showToast(`El insumo "${s.name}" no puede tener un costo unitario negativo.`, 'error');
        return;
      }
      if (s.initialStock < 0) {
        showToast(`El insumo "${s.name}" no puede tener stock inicial negativo.`, 'error');
        return;
      }
    }

    setState((prev) => ({
      ...prev,
      products: draftProducts.map((p) => ({
        ...p,
        name: p.name.trim(),
        shortDesc: p.shortDesc.trim(),
        price: Math.round(Number(p.price) || 0),
        cookedChickenUnits: Number(p.cookedChickenUnits) || 0,
      })),
      supplies: draftSupplies.map((s) => ({
        ...s,
        name: s.name.trim(),
        unitCost: Math.round(Number(s.unitCost) || 0),
        initialStock: Number(s.initialStock) || 0,
      })),
    }));

    playDuoSound('caja');
    triggerDuoHaptic('medium');
    showToast(
      '¡Guardado exitoso! Todos los cambios de precios e insumos se cargaron juntos en el sistema.',
      'success'
    );
    setShowPriceManagerModal(false);
  };

  const handleSaveProductItem = (
    productId: string,
    newName: string,
    newShortDesc: string,
    newPriceValue: number
  ) => {
    const cleanName = newName.trim();
    if (!cleanName) {
      showToast('El nombre del producto no puede quedar vacío.', 'error');
      return;
    }
    if (newPriceValue <= 0) {
      showToast('El precio debe ser un monto válido mayor a $0.', 'error');
      return;
    }
    const cleanPrice = Math.round(newPriceValue);
    const cleanDesc = newShortDesc.trim();

    setState((prev) => ({
      ...prev,
      products: prev.products.map((p) =>
        p.id === productId
          ? {
              ...p,
              name: cleanName,
              shortDesc: cleanDesc || p.shortDesc,
              price: cleanPrice,
            }
          : p
      ),
    }));
    setDraftProducts((prev) =>
      prev.map((p) =>
        p.id === productId
          ? {
              ...p,
              name: cleanName,
              shortDesc: cleanDesc || p.shortDesc,
              price: cleanPrice,
            }
          : p
      )
    );
    showToast(`"${cleanName}" actualizado correctamente en el menú y POS.`, 'success');
  };

  const handleSaveSinglePrice = (productId: string, newPriceValue: number) => {
    if (newPriceValue <= 0) {
      showToast('El precio debe ser un monto válido mayor a $0.', 'error');
      return;
    }
    const cleanPrice = Math.round(newPriceValue);
    setState((prev) => ({
      ...prev,
      products: prev.products.map((p) => (p.id === productId ? { ...p, price: cleanPrice } : p)),
    }));
    setDraftProducts((prev) =>
      prev.map((p) => (p.id === productId ? { ...p, price: cleanPrice } : p))
    );
    const prod = state.products.find((p) => p.id === productId);
    showToast(`Precio de "${prod?.name || 'Producto'}" actualizado a ${formatCLP(cleanPrice)}.`, 'success');
  };

  const handleCreateNewProduct = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newProdName.trim();
    const price = Math.round(Number(newProdPrice.replace(/\D/g, '')) || 0);
    const chickenUnits = Number(newProdChickens) || 0;

    if (!name) {
      showToast('Ingresa el nombre del producto o combo.', 'error');
      return;
    }
    if (price <= 0) {
      showToast('Ingresa un precio de venta válido mayor a $0.', 'error');
      return;
    }

    const newProduct: ProductItem = {
      id: `prod_custom_${Date.now()}`,
      name,
      shortDesc: newProdDesc.trim() || `${newProdCategory} de Beto Pollos`,
      category: newProdCategory,
      price,
      cookedChickenUnits: chickenUnits,
      recipe:
        chickenUnits > 0
          ? [
              { supplyId: 'sup_pollo_crudo', quantity: chickenUnits },
              { supplyId: 'sup_envase_pollo', quantity: Math.ceil(chickenUnits) },
              { supplyId: 'sup_bolsas', quantity: 1 },
            ]
          : [],
    };

    setState((prev) => ({
      ...prev,
      products: [...prev.products, newProduct],
    }));
    setDraftProducts((prev) => [...prev, newProduct]);

    setNewProdName('');
    setNewProdPrice('');
    setNewProdDesc('');
    setNewProdChickens('0');
    setShowNewProductForm(false);
    showToast(`¡"${name}" agregado exitosamente a ${newProdCategory}!`, 'success');
  };

  const handleDeleteProduct = (productId: string, productName: string) => {
    if (state.products.length <= 1) {
      showToast('Debe haber al menos un producto en el menú.', 'warning');
      return;
    }
    if (confirm(`¿Eliminar "${productName}" del catálogo de venta?`)) {
      setState((prev) => ({
        ...prev,
        products: prev.products.filter((p) => p.id !== productId),
      }));
      setDraftProducts((prev) => prev.filter((p) => p.id !== productId));
      setCart((prev) => {
        const next = { ...prev };
        delete next[productId];
        return next;
      });
      showToast(`"${productName}" eliminado del catálogo.`, 'info');
    }
  };

  const handleLockPricesAgain = () => {
    setIsPriceUnlocked(false);
    showToast('Modificación del menú bloqueada nuevamente.', 'warning');
  };

  // =========================================================================
  // FUNCIÓN IPHONE DÚO (2 IPHONES: CAJA + COCINA KDS / VISOR CLIENTE)
  // =========================================================================
  const DUO_ROLE_KEY = 'el_brasero_iphone_duo_role_v1';
  const [duoRole, setDuoRole] = useState<DuoRole>(() => {
    try {
      const saved = localStorage.getItem(DUO_ROLE_KEY);
      if (saved === 'caja' || saved === 'cocina' || saved === 'cliente') {
        return saved as DuoRole;
      }
    } catch {}
    return 'completo';
  });

  useEffect(() => {
    try {
      localStorage.setItem(DUO_ROLE_KEY, duoRole);
    } catch {}
  }, [duoRole]);

  const [showDuoModal, setShowDuoModal] = useState<boolean>(false);
  const [wakeLockActive, setWakeLockActive] = useState<boolean>(false);
  const [duoIntercomAlert, setDuoIntercomAlert] = useState<{
    text: string;
    time: string;
    type: 'urgent' | 'info';
  } | null>(null);
  const [duoSyncCodeInput, setDuoSyncCodeInput] = useState<string>('');
  const [copiedSyncCode, setCopiedSyncCode] = useState<boolean>(false);

  // Live synced customer cart state (consumed by Customer Display / iPhone Dúo Cliente)
  const [syncedCustomerCart, setSyncedCustomerCart] = useState<{
    lines: { name: string; qty: number; price: number; total: number }[];
    total: number;
    paymentMethod: PaymentMethod;
    cashReceived: number;
    changeGiven: number;
    lastUpdate: number;
  }>({
    lines: [],
    total: 0,
    paymentMethod: 'Efectivo',
    cashReceived: 0,
    changeGiven: 0,
    lastUpdate: Date.now(),
  });

  // Cross-device / Cross-tab BroadcastChannel listener for iPhone Duo
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel('el_brasero_duo_channel');

    channel.onmessage = (event: MessageEvent<DuoSyncMessage>) => {
      const msg = event.data;
      if (!msg || !msg.type || msg.sender === duoRole) return;

      if (msg.type === 'SYNC_STATE' && msg.payload) {
        setState(msg.payload);
      } else if (msg.type === 'SYNC_CART' && msg.payload) {
        setSyncedCustomerCart(msg.payload);
      } else if (msg.type === 'PING_COCINA') {
        playDuoSound('alerta');
        triggerDuoHaptic('heavy');
        setDuoIntercomAlert({
          text: '🚨 ¡Caja solicita pollos urgentemente al horno!',
          time: getNowTimeStr(),
          type: 'urgent',
        });
        showToast('🚨 ¡Caja solicita más pollos al espiedo!', 'error');
      } else if (msg.type === 'PING_CAJA') {
        playDuoSound('cocina');
        triggerDuoHaptic('medium');
        setDuoIntercomAlert({
          text: '🔔 ¡Cocina avisa: nueva tanda de pollos lista en vitrina!',
          time: getNowTimeStr(),
          type: 'info',
        });
        showToast('🔔 ¡Cocina avisa: tanda de pollos lista en vitrina!', 'success');
      }
    };

    return () => {
      channel.close();
    };
  }, [duoRole]);

  // Cross-tab/PWA storage synchronization listener
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue) as AppState;
          if (parsed && Array.isArray(parsed.products) && Array.isArray(parsed.supplies)) {
            setState(parsed);
          }
        } catch {}
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Broadcast state changes to paired iPhone
  const broadcastDuoState = (newState: AppState) => {
    if (typeof BroadcastChannel === 'undefined') return;
    try {
      const channel = new BroadcastChannel('el_brasero_duo_channel');
      channel.postMessage({
        type: 'SYNC_STATE',
        sender: duoRole,
        timestamp: Date.now(),
        payload: newState,
      });
      channel.close();
    } catch {}
  };

  // Auto-broadcast state changes across paired iPhones
  const hasMountedStateSyncRef = useRef(false);
  useEffect(() => {
    if (!hasMountedStateSyncRef.current) {
      hasMountedStateSyncRef.current = true;
      return;
    }
    broadcastDuoState(state);
  }, [state]);

  // Intercom ping from Caja to Cocina
  const handlePingCocina = () => {
    playDuoSound('alerta');
    triggerDuoHaptic('heavy');
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const channel = new BroadcastChannel('el_brasero_duo_channel');
        channel.postMessage({
          type: 'PING_COCINA',
          sender: 'caja',
          timestamp: Date.now(),
        });
        channel.close();
      } catch {}
    }
    showToast('🚨 Alerta enviada a iPhone Cocina: ¡Faltan Pollos!', 'warning');
  };

  // Intercom ping from Cocina to Caja
  const handlePingCaja = () => {
    playDuoSound('cocina');
    triggerDuoHaptic('medium');
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const channel = new BroadcastChannel('el_brasero_duo_channel');
        channel.postMessage({
          type: 'PING_CAJA',
          sender: 'cocina',
          timestamp: Date.now(),
        });
        channel.close();
      } catch {}
    }
    showToast('🔔 Aviso enviado a iPhone Caja: ¡Tanda Lista!', 'success');
  };

  // iPhone Wake Lock (Pantalla siempre activa)
  const toggleWakeLock = async () => {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      showToast('Tu navegador no soporta bloqueo de suspensión de pantalla.', 'warning');
      return;
    }
    try {
      if (!wakeLockActive) {
        await (navigator as any).wakeLock.request('screen');
        setWakeLockActive(true);
        showToast('Pantalla siempre activa: El iPhone no se suspenderá.', 'success');
      } else {
        setWakeLockActive(false);
        showToast('Bloqueo de pantalla normal restaurado.', 'info');
      }
    } catch {
      showToast('No se pudo activar el modo de pantalla activa.', 'warning');
    }
  };

  const generateDuoSyncString = () => {
    try {
      return btoa(unescape(encodeURIComponent(JSON.stringify(state))));
    } catch {
      return JSON.stringify(state);
    }
  };

  const handleApplyDuoSyncCode = (codeStr: string) => {
    const trimmed = codeStr.trim();
    if (!trimmed) {
      showToast('Pega un código de sincronización válido.', 'error');
      return;
    }
    try {
      let jsonStr = '';
      try {
        jsonStr = decodeURIComponent(escape(atob(trimmed)));
      } catch {
        jsonStr = trimmed;
      }
      const parsed = JSON.parse(jsonStr) as AppState;
      if (parsed && Array.isArray(parsed.products) && Array.isArray(parsed.supplies)) {
        setState(parsed);
        broadcastDuoState(parsed);
        setDuoSyncCodeInput('');
        setShowDuoModal(false);
        showToast('¡Sincronización Dúo exitosa! Este iPhone tiene los datos actualizados.', 'success');
      } else {
        showToast('El código no contiene un inventario válido.', 'error');
      }
    } catch {
      showToast('Error al procesar el código de sincronización.', 'error');
    }
  };

  const filteredPosProducts = useMemo(() => {
    if (posCategory === 'Todos') return state.products;
    return state.products.filter((p) => p.category === posCategory);
  }, [state.products, posCategory]);

  const cartDetails = useMemo(() => {
    const lines: {
      product: ProductItem;
      qty: number;
      unitCost: number;
      linePrice: number;
      lineCost: number;
      lineChickens: number;
    }[] = [];
    let totalPrice = 0;
    let totalCost = 0;
    let totalChickens = 0;
    let totalItems = 0;

    for (const [productId, qty] of Object.entries(cart)) {
      if (qty <= 0) continue;
      const product = state.products.find((p) => p.id === productId);
      if (!product) continue;
      const unitCost = calculateProductRecipeCost(product, state.supplies);
      const linePrice = Math.round(product.price * qty);
      const lineCost = Math.round(unitCost * qty);
      const lineChickens = Math.round(product.cookedChickenUnits * qty * 100) / 100;

      lines.push({ product, qty, unitCost, linePrice, lineCost, lineChickens });
      totalPrice += linePrice;
      totalCost += lineCost;
      totalChickens += lineChickens;
      totalItems += qty;
    }

    return {
      lines,
      totalPrice: Math.round(totalPrice),
      totalCost: Math.round(totalCost),
      totalChickens: Math.round(totalChickens * 100) / 100,
      totalItems,
      expectedProfit: Math.round(totalPrice - totalCost),
    };
  }, [cart, state.products, state.supplies]);

  const updateCartQty = (productId: string, delta: number) => {
    setCart((prev) => {
      const nextQty = Math.max(0, (prev[productId] || 0) + delta);
      const copy = { ...prev };
      if (nextQty === 0) {
        delete copy[productId];
      } else {
        copy[productId] = nextQty;
      }
      return copy;
    });
  };

  const clearCart = () => {
    setCart({});
    setCashPaidInput('');
  };

  const parsedCashPaid = Number(cashPaidInput.replace(/\D/g, '')) || 0;
  const changeToReturn =
    posPaymentMethod === 'Efectivo' && parsedCashPaid >= cartDetails.totalPrice
      ? parsedCashPaid - cartDetails.totalPrice
      : 0;

  // Broadcast live cart to paired iPhone Customer Display
  useEffect(() => {
    if (duoRole !== 'caja' && duoRole !== 'completo') return;
    if (typeof BroadcastChannel === 'undefined') return;
    try {
      const channel = new BroadcastChannel('el_brasero_duo_channel');
      channel.postMessage({
        type: 'SYNC_CART',
        sender: duoRole,
        timestamp: Date.now(),
        payload: {
          lines: cartDetails.lines.map((l) => ({
            name: l.product.name,
            qty: l.qty,
            price: l.product.price,
            total: l.linePrice,
          })),
          total: cartDetails.totalPrice,
          paymentMethod: posPaymentMethod,
          cashReceived: parsedCashPaid,
          changeGiven: changeToReturn,
          lastUpdate: Date.now(),
        },
      });
      channel.close();
    } catch {}
  }, [cartDetails, posPaymentMethod, parsedCashPaid, changeToReturn, duoRole]);

  const isShowcaseInsufficientForCart =
    cartDetails.totalChickens > 0 && cartDetails.totalChickens > availableChickensForImmediateSale;

  const handleConfirmPosSale = () => {
    if (cartDetails.lines.length === 0) return;

    if (isShowcaseInsufficientForCart && !allowNegativeShowcase) {
      showToast(
        `Faltan pollos listos en vitrina (${formatQty(availableChickensForImmediateSale)} disp. vs ${formatQty(cartDetails.totalChickens)} req.). Pasa un lote del horno o activa venta forzada.`,
        'error'
      );
      return;
    }

    if (
      posPaymentMethod === 'Efectivo' &&
      cashPaidInput.trim() !== '' &&
      parsedCashPaid < cartDetails.totalPrice
    ) {
      showToast('El monto en efectivo recibido es menor al total de la venta.', 'error');
      return;
    }

    // Aggregate supply recipe consumption
    const consumptionMap = new Map<string, number>();
    for (const line of cartDetails.lines) {
      for (const ing of line.product.recipe) {
        const prev = consumptionMap.get(ing.supplyId) || 0;
        consumptionMap.set(ing.supplyId, prev + ing.quantity * line.qty);
      }
    }

    const updatedSupplies = state.supplies.map((s) => {
      const consumed = consumptionMap.get(s.id) || 0;
      if (consumed === 0) return s;
      return {
        ...s,
        salesConsumption: Math.round((s.salesConsumption + consumed) * 100) / 100,
      };
    });

    const profit = cartDetails.totalPrice - cartDetails.totalCost;
    const marginPct =
      cartDetails.totalPrice > 0
        ? Math.round((profit / cartDetails.totalPrice) * 1000) / 10
        : 0;

    const newSale: SaleRecord = {
      id: `VTA-${1001 + state.sales.length}`,
      time: getNowTimeStr(),
      origin: 'Mostrador',
      itemsSummary: cartDetails.lines.map((l) => `${l.qty}x ${l.product.name}`).join(', '),
      totalQuantity: cartDetails.totalItems,
      totalCookedChicken: cartDetails.totalChickens,
      totalCost: cartDetails.totalCost,
      totalPrice: cartDetails.totalPrice,
      profit,
      marginPct,
      paymentMethod: posPaymentMethod,
      cashReceived: posPaymentMethod === 'Efectivo' ? parsedCashPaid || cartDetails.totalPrice : undefined,
      changeGiven: posPaymentMethod === 'Efectivo' ? changeToReturn : undefined,
    };

    const nextShowcase = Math.max(
      0,
      Math.round((state.cookedChickensInShowcase - cartDetails.totalChickens) * 100) / 100
    );

    setState((prev) => ({
      ...prev,
      supplies: updatedSupplies,
      cookedChickensInShowcase: nextShowcase,
      sales: [newSale, ...prev.sales],
    }));

    const vueltoMsg =
      posPaymentMethod === 'Efectivo' && changeToReturn > 0
        ? ` · Vuelto: ${formatCLP(changeToReturn)}`
        : '';
    showToast(
      `Venta ${newSale.id} registrada (${formatCLP(newSale.totalPrice)} - ${posPaymentMethod})${vueltoMsg}`,
      'success'
    );
    clearCart();
  };

  const handleAddPettyCash = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Math.round(Number(pettyAmount.replace(/\D/g, '')) || 0);
    if (amount <= 0 || !pettyReason.trim()) {
      showToast('Ingresa monto en pesos y motivo del gasto de caja chica.', 'error');
      return;
    }
    const newExp = {
      id: `GASTO-${String(state.pettyCashExpenses.length + 1).padStart(2, '0')}`,
      time: getNowTimeStr(),
      amount,
      reason: pettyReason.trim(),
    };
    setState((prev) => ({
      ...prev,
      pettyCashExpenses: [newExp, ...prev.pettyCashExpenses],
    }));
    setPettyAmount('');
    setPettyReason('');
    setShowPettyCashModal(false);
    showToast(`Gasto de Caja Chica registrado: ${formatCLP(amount)}`, 'success');
  };

  // =========================================================================
  // MODULE 2: KITCHEN & COOKING (3 STAGES) HANDLERS
  // =========================================================================
  const [ovenInputQty, setOvenInputQty] = useState<string>('6');
  const [ovenInputNotes, setOvenInputNotes] = useState<string>('Espiedo Principal');
  const [manualShowcaseInput, setManualShowcaseInput] = useState<string>('');

  const handlePutChickensInOven = (qtyToBake: number) => {
    const qty = Math.round(qtyToBake * 10) / 10;
    if (qty <= 0) {
      showToast('Ingresa una cantidad válida de pollos para meter al horno.', 'error');
      return;
    }
    if (qty > rawChickensInCooler) {
      showToast(
        `Solo hay ${formatQty(rawChickensInCooler)} pollos crudos en frío. Ingresa una compra en Inventario si llegó más mercadería.`,
        'error'
      );
      return;
    }

    const newBatch = {
      id: `Lote #${state.nextBatchNumber}`,
      quantity: qty,
      startTime: getNowTimeStr(),
      startedAtMs: Date.now(),
      notes: ovenInputNotes.trim() || 'Horno / Espiedo',
    };

    setState((prev) => ({
      ...prev,
      ovenBatches: [...prev.ovenBatches, newBatch],
      nextBatchNumber: prev.nextBatchNumber + 1,
    }));

    showToast(`${newBatch.id} (${formatQty(qty)} pollos) ingresado a cocción.`, 'success');
  };

  const handleFinishOvenBatch = (batchId: string) => {
    const batch = state.ovenBatches.find((b) => b.id === batchId);
    if (!batch) return;

    setState((prev) => ({
      ...prev,
      ovenBatches: prev.ovenBatches.filter((b) => b.id !== batchId),
      cookedChickensInShowcase:
        Math.round((prev.cookedChickensInShowcase + batch.quantity) * 100) / 100,
    }));

    showToast(
      `¡${batch.id} listo! +${formatQty(batch.quantity)} pollos sumados a la Vitrina Listos para Entrega.`,
      'success'
    );
  };

  // =========================================================================
  // MODULE 3: ORDERS & RESERVATIONS (PEDIDOS POR HORA)
  // =========================================================================
  const [orderCustomerName, setOrderCustomerName] = useState<string>('');
  const [orderCustomerPhone, setOrderCustomerPhone] = useState<string>('+569');
  const [orderPickupTime, setOrderPickupTime] = useState<string>(() => getFutureTimeStr(30));
  const [orderNotes, setOrderNotes] = useState<string>('');
  const [orderPaymentStatus, setOrderPaymentStatus] = useState<
    'Pagado' | 'Pendiente por pagar al retirar'
  >('Pendiente por pagar al retirar');
  const [orderPaymentMethod, setOrderPaymentMethod] = useState<PaymentMethod>('Transferencia');
  const [orderDraftItems, setOrderDraftItems] = useState<Record<string, number>>({});
  const [ordersFilter, setOrdersFilter] = useState<'Pendiente' | 'Todos'>('Pendiente');

  // Modal for delivering an unpaid order (solicita medio de pago)
  const [deliveringOrder, setDeliveringOrder] = useState<CustomerOrder | null>(null);
  const [deliveryPaymentMethod, setDeliveryPaymentMethod] = useState<PaymentMethod>('Efectivo');
  const [deliveryCashReceived, setDeliveryCashReceived] = useState<string>('');

  const updateOrderDraftQty = (productId: string, delta: number) => {
    setOrderDraftItems((prev) => {
      const next = Math.max(0, (prev[productId] || 0) + delta);
      const copy = { ...prev };
      if (next === 0) delete copy[productId];
      else copy[productId] = next;
      return copy;
    });
  };

  const orderDraftSummary = useMemo(() => {
    const lines: OrderItemLine[] = [];
    let totalPrice = 0;
    let totalCost = 0;
    let totalCookedChicken = 0;

    for (const [pid, qty] of Object.entries(orderDraftItems)) {
      if (qty <= 0) continue;
      const prod = state.products.find((p) => p.id === pid);
      if (!prod) continue;
      const unitCost = calculateProductRecipeCost(prod, state.supplies);
      lines.push({
        productId: prod.id,
        name: prod.name,
        quantity: qty,
        unitPrice: prod.price,
        unitCost,
        cookedChickenPerUnit: prod.cookedChickenUnits,
      });
      totalPrice += prod.price * qty;
      totalCost += unitCost * qty;
      totalCookedChicken += prod.cookedChickenUnits * qty;
    }

    return {
      lines,
      totalPrice: Math.round(totalPrice),
      totalCost: Math.round(totalCost),
      totalCookedChicken: Math.round(totalCookedChicken * 100) / 100,
    };
  }, [orderDraftItems, state.products, state.supplies]);

  const handleCreateOrder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderCustomerName.trim()) {
      showToast('Ingresa el nombre del cliente para reservar el pedido.', 'error');
      return;
    }
    if (orderDraftSummary.lines.length === 0) {
      showToast('Selecciona al menos 1 producto o combo para el pedido.', 'error');
      return;
    }

    const newOrder: CustomerOrder = {
      id: `PED-${String(state.orders.length + 1).padStart(3, '0')}`,
      createdAt: getNowTimeStr(),
      pickupTime: orderPickupTime || getFutureTimeStr(30),
      customerName: orderCustomerName.trim(),
      customerPhone: orderCustomerPhone.trim(),
      items: orderDraftSummary.lines,
      totalPrice: orderDraftSummary.totalPrice,
      totalCost: orderDraftSummary.totalCost,
      totalCookedChicken: orderDraftSummary.totalCookedChicken,
      paymentStatus: orderPaymentStatus,
      paymentMethod: orderPaymentStatus === 'Pagado' ? orderPaymentMethod : undefined,
      deliveryStatus: 'Pendiente',
      notes: orderNotes.trim() || undefined,
    };

    setState((prev) => ({
      ...prev,
      orders: [newOrder, ...prev.orders],
    }));

    setOrderCustomerName('');
    setOrderCustomerPhone('+569');
    setOrderNotes('');
    setOrderDraftItems({});
    setOrderPickupTime(getFutureTimeStr(30));

    showToast(
      `Pedido ${newOrder.id} agendado para las ${newOrder.pickupTime}. (${formatQty(newOrder.totalCookedChicken)} pollos bloqueados en Vitrina).`,
      'success'
    );
  };

  const finalizeOrderDelivery = (order: CustomerOrder, finalPaymentMethod: PaymentMethod) => {
    // Deduct supplies according to recipes of items in the order
    const consumptionMap = new Map<string, number>();
    let totalQuantity = 0;

    for (const item of order.items) {
      totalQuantity += item.quantity;
      const prod = state.products.find((p) => p.id === item.productId);
      if (prod) {
        for (const ing of prod.recipe) {
          const prev = consumptionMap.get(ing.supplyId) || 0;
          consumptionMap.set(ing.supplyId, prev + ing.quantity * item.quantity);
        }
      }
    }

    const updatedSupplies = state.supplies.map((s) => {
      const consumed = consumptionMap.get(s.id) || 0;
      if (consumed === 0) return s;
      return {
        ...s,
        salesConsumption: Math.round((s.salesConsumption + consumed) * 100) / 100,
      };
    });

    const profit = order.totalPrice - order.totalCost;
    const marginPct =
      order.totalPrice > 0 ? Math.round((profit / order.totalPrice) * 1000) / 10 : 0;

    const newSale: SaleRecord = {
      id: `VTA-${1001 + state.sales.length}`,
      time: getNowTimeStr(),
      origin: 'Pedido',
      orderId: order.id,
      customerName: order.customerName,
      itemsSummary: order.items.map((i) => `${i.quantity}x ${i.name}`).join(', '),
      totalQuantity,
      totalCookedChicken: order.totalCookedChicken,
      totalCost: order.totalCost,
      totalPrice: order.totalPrice,
      profit,
      marginPct,
      paymentMethod: finalPaymentMethod,
    };

    const nextShowcase = Math.max(
      0,
      Math.round((state.cookedChickensInShowcase - order.totalCookedChicken) * 100) / 100
    );

    const updatedOrders: CustomerOrder[] = state.orders.map((o) =>
      o.id === order.id
        ? {
            ...o,
            paymentStatus: 'Pagado',
            paymentMethod: finalPaymentMethod,
            deliveryStatus: 'Entregado',
          }
        : o
    );

    setState((prev) => ({
      ...prev,
      supplies: updatedSupplies,
      cookedChickensInShowcase: nextShowcase,
      orders: updatedOrders,
      sales: [newSale, ...prev.sales],
    }));

    setDeliveringOrder(null);
    setDeliveryCashReceived('');
    showToast(
      `Pedido ${order.id} de ${order.customerName} entregado y registrado en Ventas (${formatCLP(order.totalPrice)} - ${finalPaymentMethod}).`,
      'success'
    );
  };

  const handleCancelOrder = (orderId: string) => {
    setState((prev) => ({
      ...prev,
      orders: prev.orders.map((o) =>
        o.id === orderId ? { ...o, deliveryStatus: 'Cancelado' } : o
      ),
    }));
    showToast(`Pedido ${orderId} cancelado y pollos liberados para venta inmediata.`, 'warning');
  };

  // Helper to evaluate order urgency based on pickupTime (HH:mm)
  const getOrderUrgency = (order: CustomerOrder) => {
    if (order.deliveryStatus === 'Entregado') {
      return {
        label: 'Entregado',
        tone: 'emerald',
        minutesDiff: 999,
      };
    }
    if (order.deliveryStatus === 'Cancelado') {
      return {
        label: 'Cancelado',
        tone: 'slate',
        minutesDiff: 999,
      };
    }
    const [hh, mm] = order.pickupTime.split(':').map(Number);
    const now = new Date(nowTick);
    const target = new Date(now);
    target.setHours(hh || 0, mm || 0, 0, 0);
    const diffMin = Math.round((target.getTime() - now.getTime()) / 60000);

    if (diffMin < 0) {
      return {
        label: `Atrasado (${Math.abs(diffMin)} min)`,
        tone: 'rose',
        minutesDiff: diffMin,
      };
    }
    if (diffMin <= 25) {
      return {
        label: `Próximo a entregar (en ${diffMin} min)`,
        tone: 'amber',
        minutesDiff: diffMin,
      };
    }
    return {
      label: `En horario (en ${diffMin} min)`,
      tone: 'sky',
      minutesDiff: diffMin,
    };
  };

  const sortedOrders = useMemo(() => {
    const list =
      ordersFilter === 'Pendiente'
        ? state.orders.filter((o) => o.deliveryStatus === 'Pendiente')
        : state.orders;
    return [...list].sort((a, b) => a.pickupTime.localeCompare(b.pickupTime));
  }, [state.orders, ordersFilter]);

  // =========================================================================
  // MODULE 4: INVENTORY, COSTS, PURCHASES, MERMAS & RECIPE EDITOR
  // =========================================================================
  const [showPurchaseModal, setShowPurchaseModal] = useState<boolean>(false);
  const [purchaseSupplyId, setPurchaseSupplyId] = useState<string>('sup_pollo_crudo');
  const [purchaseQty, setPurchaseQty] = useState<string>('');
  const [purchaseUnitCost, setPurchaseUnitCost] = useState<string>('4200');

  const [showWasteModal, setShowWasteModal] = useState<boolean>(false);
  const [wasteSupplyId, setWasteSupplyId] = useState<string>('sup_pollo_crudo');
  const [wasteQty, setWasteQty] = useState<string>('1');
  const [wasteReason, setWasteReason] = useState<string>('Pollo sobrecocido / quemado');
  const [wasteFromShowcase, setWasteFromShowcase] = useState<boolean>(true);

  const [editingProduct, setEditingProduct] = useState<ProductItem | null>(null);
  const [showNewSupplyModal, setShowNewSupplyModal] = useState<boolean>(false);
  const [newSupplyName, setNewSupplyName] = useState<string>('');
  const [newSupplyUnit, setNewSupplyUnit] = useState<'Unid' | 'Kg' | 'Lts' | 'Lote'>('Unid');
  const [newSupplyCost, setNewSupplyCost] = useState<string>('');
  const [newSupplyInitial, setNewSupplyInitial] = useState<string>('');

  const handleOpenPurchaseModal = (defaultId?: string) => {
    const targetId = defaultId || state.supplies[0]?.id || 'sup_pollo_crudo';
    const found = state.supplies.find((s) => s.id === targetId);
    setPurchaseSupplyId(targetId);
    setPurchaseQty('');
    setPurchaseUnitCost(found ? String(found.unitCost) : '');
    setShowPurchaseModal(true);
  };

  const handleConfirmPurchase = (e: React.FormEvent) => {
    e.preventDefault();
    const qty = Number(purchaseQty.replace(',', '.')) || 0;
    const newCost = Math.round(Number(purchaseUnitCost.replace(/\D/g, '')) || 0);
    if (qty <= 0 || newCost <= 0) {
      showToast('Ingresa una cantidad mayor a 0 y su costo unitario en pesos.', 'error');
      return;
    }

    const supply = state.supplies.find((s) => s.id === purchaseSupplyId);
    setState((prev) => ({
      ...prev,
      supplies: prev.supplies.map((s) =>
        s.id === purchaseSupplyId
          ? {
              ...s,
              purchases: Math.round((s.purchases + qty) * 100) / 100,
              unitCost: newCost,
            }
          : s
      ),
    }));

    setShowPurchaseModal(false);
    showToast(
      `Compra ingresada: +${formatQty(qty)} ${supply?.unit || ''} de ${supply?.name} a ${formatCLP(newCost)} c/u.`,
      'success'
    );
  };

  const handleConfirmWaste = (e: React.FormEvent) => {
    e.preventDefault();
    const qty = Number(wasteQty.replace(',', '.')) || 0;
    const supply = state.supplies.find((s) => s.id === wasteSupplyId);
    if (!supply || qty <= 0) {
      showToast('Selecciona un insumo e ingresa una cantidad válida de merma.', 'error');
      return;
    }

    const totalLoss = Math.round(qty * supply.unitCost);
    const newWasteRecord = {
      id: `MER-${String(state.wasteRecords.length + 1).padStart(2, '0')}`,
      time: getNowTimeStr(),
      supplyId: supply.id,
      supplyName: supply.name,
      quantity: qty,
      unitCost: supply.unitCost,
      totalLoss,
      reason: wasteReason.trim() || 'Merma operativa',
      fromCookedShowcase: supply.isRawChicken ? wasteFromShowcase : false,
    };

    setState((prev) => ({
      ...prev,
      supplies: prev.supplies.map((s) =>
        s.id === supply.id
          ? { ...s, waste: Math.round((s.waste + qty) * 100) / 100 }
          : s
      ),
      cookedChickensInShowcase:
        supply.isRawChicken && wasteFromShowcase
          ? Math.max(0, Math.round((prev.cookedChickensInShowcase - qty) * 100) / 100)
          : prev.cookedChickensInShowcase,
      wasteRecords: [newWasteRecord, ...prev.wasteRecords],
    }));

    setShowWasteModal(false);
    showToast(
      `Merma registrada: -${formatQty(qty)} ${supply.name} (Pérdida: ${formatCLP(totalLoss)})`,
      'warning'
    );
  };

  const handleSaveEditedProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;

    // Check if price was modified without authorization
    const original = state.products.find((p) => p.id === editingProduct.id);
    if (original && original.price !== editingProduct.price && !isPriceUnlocked) {
      setPasswordInput('');
      setPasswordError('Se requiere la clave "Betopollos" para modificar el precio de este producto.');
      setShowPasswordModal(true);
      return;
    }

    setState((prev) => {
      const exists = prev.products.some((p) => p.id === editingProduct.id);
      const nextProducts = exists
        ? prev.products.map((p) => (p.id === editingProduct.id ? editingProduct : p))
        : [...prev.products, editingProduct];
      return {
        ...prev,
        products: nextProducts,
      };
    });
    showToast(`Receta y precio de "${editingProduct.name}" actualizados.`, 'success');
    setEditingProduct(null);
  };

  const handleCreateSupply = (e: React.FormEvent) => {
    e.preventDefault();
    const cost = Math.round(Number(newSupplyCost.replace(/\D/g, '')) || 0);
    const initStock = Number(newSupplyInitial.replace(',', '.')) || 0;
    if (!newSupplyName.trim() || cost <= 0) {
      showToast('Ingresa nombre del insumo y su costo unitario.', 'error');
      return;
    }
    const newSup = {
      id: `sup_${Date.now()}`,
      name: newSupplyName.trim(),
      unit: newSupplyUnit,
      unitCost: cost,
      initialStock: initStock,
      purchases: 0,
      salesConsumption: 0,
      waste: 0,
    };
    setState((prev) => ({
      ...prev,
      supplies: [...prev.supplies, newSup],
    }));
    setNewSupplyName('');
    setNewSupplyCost('');
    setNewSupplyInitial('');
    setShowNewSupplyModal(false);
    showToast(`Insumo "${newSup.name}" agregado al inventario.`, 'success');
  };

  // =========================================================================
  // MODULE 5: FINANCIAL CLOSING, EXCEL EXPORT, SHARE & NEW DAY
  // =========================================================================
  const [closingStatus, setClosingStatus] = useState<{
    fileName: string;
    downloaded: boolean;
    shareResult?: string;
    webhookResult?: string;
    timestamp: string;
  } | null>(null);
  const [isClosingBusy, setIsClosingBusy] = useState<boolean>(false);
  const [showNewDayModal, setShowNewDayModal] = useState<boolean>(false);
  const [showAppsScriptModal, setShowAppsScriptModal] = useState<boolean>(false);

  const handleCloseDayAndSendExcel = async () => {
    setIsClosingBusy(true);
    try {
      const { fileName, excelArrayBuffer, excelBase64, sheetsJson } =
        generateDailyExcelWorkbook(state);

      // 1) Descargar el archivo .xlsx inmediatamente en el dispositivo
      triggerExcelDownload(fileName, excelArrayBuffer);

      // 2) Enviar por Webhook en segundo plano si está configurado
      const webhookRes = await sendExcelToWebhook(state, fileName, excelBase64, sheetsJson);

      // 3) Invocar API nativa navigator.share con archivo adjunto (iOS / Android)
      const shareRes = await shareExcelViaNavigator(fileName, excelArrayBuffer, state);

      setClosingStatus({
        fileName,
        downloaded: true,
        shareResult: shareRes.shared
          ? 'Menú nativo de compartir abierto con el archivo Excel adjunto.'
          : shareRes.reason,
        webhookResult: webhookRes.statusMsg,
        timestamp: getNowTimeStr(),
      });

      showToast(
        `Reporte ${fileName} descargado y listo para enviar a ${state.recipientEmail}`,
        'success'
      );
    } catch (err) {
      showToast(
        `Error al generar el archivo Excel: ${err instanceof Error ? err.message : 'Desconocido'}`,
        'error'
      );
    } finally {
      setIsClosingBusy(false);
    }
  };

  const handleShareExcelOnly = async () => {
    const { fileName, excelArrayBuffer } = generateDailyExcelWorkbook(state);
    const res = await shareExcelViaNavigator(fileName, excelArrayBuffer, state);
    if (!res.shared && res.reason) {
      showToast(res.reason, 'warning');
    }
  };

  const handleStartNewDay = () => {
    // Conservar los stocks finales como stocks iniciales del día siguiente
    const nextSupplies = state.supplies.map((s) => {
      const finalStock = Math.max(0, getSupplyRemainingStock(s));
      return {
        ...s,
        initialStock: finalStock,
        purchases: 0,
        salesConsumption: 0,
        waste: 0,
      };
    });

    const pendingOrdersOnly = state.orders.filter((o) => o.deliveryStatus === 'Pendiente');

    setState((prev) => ({
      ...prev,
      businessDate: getTodayDateStr(),
      supplies: nextSupplies,
      orders: pendingOrdersOnly,
      sales: [],
      pettyCashExpenses: [],
      wasteRecords: [],
    }));

    setClosingStatus(null);
    setShowNewDayModal(false);
    showToast(
      'Nuevo día iniciado: Los stocks finales ahora son los stocks iniciales de hoy.',
      'success'
    );
  };

  const handleResetDemoData = () => {
    const fresh = createDefaultState();
    setState(fresh);
    setCart({});
    setClosingStatus(null);
    showToast('Datos de demostración restaurados.', 'success');
  };

  const mailtoHref = useMemo(() => {
    const subject = encodeURIComponent(
      `Reporte Cierre Diario Asaduría (${state.businessDate}) - ${formatCLP(financialMetrics.grossRevenue)}`
    );
    const body = encodeURIComponent(
      [
        `Hola, adjunto el resumen financiero del cierre del día ${state.businessDate}:`,
        ``,
        `1. INGRESOS BRUTOS POR VENTAS: ${formatCLP(financialMetrics.grossRevenue)}`,
        `   - Efectivo: ${formatCLP(financialMetrics.revenueCash)}`,
        `   - Tarjeta (Débito/Crédito): ${formatCLP(financialMetrics.revenueCard)}`,
        `   - Transferencia: ${formatCLP(financialMetrics.revenueTransfer)}`,
        ``,
        `2. COSTOS Y GASTOS OPERATIVOS:`,
        `   - Costo de Insumos Consumidos (Recetas): ${formatCLP(financialMetrics.salesCogs)}`,
        `   - Costo de Mermas: ${formatCLP(financialMetrics.wasteCost)}`,
        `   - Gastos de Caja Chica: ${formatCLP(financialMetrics.pettyCashTotal)}`,
        ``,
        `3. RENTABILIDAD REAL:`,
        `   - UTILIDAD NETA REAL: ${formatCLP(financialMetrics.netProfit)}`,
        `   - MARGEN REAL: ${financialMetrics.realMarginPct}%`,
        `   - EFECTIVO ESPERADO EN CAJA: ${formatCLP(financialMetrics.expectedCashInDrawer)}`,
        `   - VALORIZADO STOCK FINAL BODEGA: ${formatCLP(financialMetrics.inventoryValuation)}`,
        ``,
        `(Nota: Recuerda adjuntar el archivo descargado Reporte_Ventas_${state.businessDate}.xlsx)`,
      ].join('\n')
    );
    return `mailto:${state.recipientEmail}?subject=${subject}&body=${body}`;
  }, [state.businessDate, state.recipientEmail, financialMetrics]);

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#090D16] text-slate-100 flex flex-col justify-between items-center p-4 sm:p-6 select-none relative overflow-hidden">
        {/* Ambient background lighting */}
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 left-1/2 -translate-x-1/2 w-80 h-80 bg-orange-600/10 rounded-full blur-3xl pointer-events-none" />

        {/* Top status bar */}
        <header className="w-full max-w-sm flex items-center justify-between text-xs text-slate-400 z-10 pt-2">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
            <span className="font-semibold text-slate-300">Terminal POS Bloqueada</span>
          </div>
          <div className="font-mono text-slate-400 text-[11px]">
            {getNowTimeStr()} hrs · {getTodayDateStr()}
          </div>
        </header>

        {/* Main Central Access Box */}
        <main className="w-full max-w-sm my-auto flex flex-col items-center text-center z-10 space-y-4 sm:space-y-5">
          {/* Official Beto Pollos Badge Logo */}
          <div className="relative group my-1">
            <div className="absolute -inset-1.5 rounded-full bg-gradient-to-tr from-amber-500 via-yellow-400 to-amber-600 opacity-60 blur-md animate-pulse" />
            <img
              src="/assets/aistudio/betopolloslogo_3f191103.jpg"
              alt="Logo Beto Pollos"
              className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-full border-2 border-amber-400/90 shadow-2xl shadow-amber-500/30 object-cover bg-black"
            />
          </div>

          <div className="space-y-1">
            <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              Beto Pollos
            </h1>
            <p className="text-xs sm:text-sm text-amber-300 font-semibold flex items-center justify-center gap-1.5">
              <KeyRound className="w-4 h-4 text-amber-400" />
              Acceso POS para Empleados
            </p>
            <p className="text-[11px] text-slate-400">
              Ingresa la contraseña de 4 dígitos para abrir el terminal
            </p>
          </div>

          {/* 4 Digit PIN Display */}
          <div className="space-y-2 w-full">
            <div
              className={`flex items-center justify-center gap-3 sm:gap-4 py-2 transition-transform ${
                isPinShaking ? 'animate-pin-shake' : ''
              }`}
            >
              {[0, 1, 2, 3].map((index) => {
                const isFilled = pinInput.length > index;
                return (
                  <div
                    key={index}
                    className={`w-12 h-14 sm:w-14 sm:h-16 rounded-2xl border-2 flex items-center justify-center transition-all duration-150 ${
                      pinError
                        ? 'border-rose-500/80 bg-rose-950/40 text-rose-300'
                        : isFilled
                        ? 'border-amber-400 bg-amber-400/20 shadow-lg shadow-amber-400/20 scale-105'
                        : 'border-slate-800 bg-[#0F172A]'
                    }`}
                  >
                    {isFilled ? (
                      <div className="w-4 h-4 rounded-full bg-amber-400 shadow-md shadow-amber-400/80 animate-in zoom-in-75 duration-100" />
                    ) : (
                      <div className="w-2.5 h-2.5 rounded-full bg-slate-700" />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Error or Hint notice */}
            <div className="min-h-[22px] flex items-center justify-center">
              {pinError ? (
                <div className="text-xs font-semibold text-rose-400 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>{pinError}</span>
                </div>
              ) : (
                <div className="text-[11px] text-slate-500 font-mono">
                  {pinInput.length === 0
                    ? 'Digita los 4 números en la botonera o teclado'
                    : `${4 - pinInput.length} dígito(s) restante(s)`}
                </div>
              )}
            </div>
          </div>

          {/* Large tactile Numpad */}
          <div className="w-full grid grid-cols-3 gap-2.5 sm:gap-3 max-w-[310px]">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
              <button
                key={digit}
                type="button"
                onClick={() => handlePinDigit(digit)}
                className="h-14 sm:h-16 rounded-2xl bg-slate-900 border border-slate-800 text-white font-mono text-2xl font-bold hover:bg-slate-800 active:bg-amber-400 active:text-slate-950 active:scale-95 transition-all shadow-md focus:outline-none focus:ring-2 focus:ring-amber-400/40"
              >
                {digit}
              </button>
            ))}
            <button
              type="button"
              onClick={handlePinClear}
              className="h-14 sm:h-16 rounded-2xl bg-slate-950 border border-slate-800 text-slate-400 font-semibold text-xs hover:text-slate-200 hover:bg-slate-900 active:scale-95 transition-all focus:outline-none flex flex-col items-center justify-center gap-0.5"
            >
              <span className="font-mono text-sm font-bold">C</span>
              <span className="text-[9px] uppercase tracking-wider">Limpiar</span>
            </button>
            <button
              type="button"
              onClick={() => handlePinDigit('0')}
              className="h-14 sm:h-16 rounded-2xl bg-slate-900 border border-slate-800 text-white font-mono text-2xl font-bold hover:bg-slate-800 active:bg-amber-400 active:text-slate-950 active:scale-95 transition-all shadow-md focus:outline-none focus:ring-2 focus:ring-amber-400/40"
            >
              0
            </button>
            <button
              type="button"
              onClick={handlePinBackspace}
              className="h-14 sm:h-16 rounded-2xl bg-slate-950 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-900 active:scale-95 transition-all focus:outline-none flex flex-col items-center justify-center gap-0.5"
              aria-label="Borrar dígito"
            >
              <svg
                className="w-5 h-5 text-slate-300"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
                <line x1="18" y1="9" x2="12" y2="15" />
                <line x1="12" y1="9" x2="18" y2="15" />
              </svg>
              <span className="text-[9px] uppercase tracking-wider">Borrar</span>
            </button>
          </div>

          {/* Session options and helper shortcut */}
          <div className="w-full max-w-[310px] flex items-center justify-between text-xs text-slate-400 pt-1">
            <label className="flex items-center gap-2 cursor-pointer text-slate-400 hover:text-slate-200">
              <input
                type="checkbox"
                checked={rememberDevice}
                onChange={(e) => setRememberDevice(e.target.checked)}
                className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-0 focus:ring-offset-0"
              />
              <span className="text-[11px]">Recordar en este equipo</span>
            </label>
            <button
              type="button"
              onClick={() => {
                ['0', '5', '0', '3'].forEach((d, i) => {
                  setTimeout(() => handlePinDigit(d), i * 110);
                });
              }}
              className="text-amber-400/90 hover:text-amber-300 font-mono text-[11px] font-semibold bg-amber-400/10 px-2 py-1 rounded-lg border border-amber-400/20 flex items-center gap-1"
              title="Autocompletar clave de empleados: 0503"
            >
              <Unlock className="w-3 h-3 text-amber-400" />
              <span>Clave: 0503</span>
            </button>
          </div>
        </main>

        {/* Bottom footer */}
        <footer className="text-center text-[10px] text-slate-500 z-10 pb-2 flex items-center justify-center gap-1.5">
          <Lock className="w-3 h-3 text-amber-500/70" />
          <span>Asaduría Beto Pollos · Punto de Venta Protegido</span>
        </footer>

        {/* Toast notifications */}
        {toast && (
          <div className="fixed bottom-6 z-50 px-4 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs font-semibold shadow-xl">
            {toast.text}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#090D16] text-slate-100 flex flex-col pb-24 lg:pb-10">
      {/* =====================================================================
          TOP NAVIGATION BAR (3-Zone Contract)
         ===================================================================== */}
      <header className="sticky top-0 z-30 h-14 bg-[#090D16]/95 backdrop-blur-md border-b border-slate-800/90 px-4 lg:px-8 flex items-center justify-between gap-8">
        {/* Zone 1: Single text element wordmark + Logo */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('pos');
          }}
          className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 flex items-center gap-2.5"
        >
          <img
            src="/assets/aistudio/betopolloslogo_3f191103.jpg"
            alt="Logo Beto Pollos"
            className="w-8 h-8 rounded-full border border-amber-400/60 object-cover shadow-sm shrink-0"
          />
          <span>Asaduría Beto Pollos</span>
        </a>

        {/* Zone 2: 5 concise single-line text navigation links (Desktop) */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
          <button
            type="button"
            onClick={() => setActiveTab('pos')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'pos'
                ? 'text-amber-400 border-amber-400'
                : 'border-transparent hover:text-slate-100'
            }`}
          >
            Caja POS
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('cocina')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'cocina'
                ? 'text-amber-400 border-amber-400'
                : 'border-transparent hover:text-slate-100'
            }`}
          >
            Cocina ({formatQty(availableChickensForImmediateSale)})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('pedidos')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'pedidos'
                ? 'text-amber-400 border-amber-400'
                : 'border-transparent hover:text-slate-100'
            }`}
          >
            Pedidos ({state.orders.filter((o) => o.deliveryStatus === 'Pendiente').length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('inventario')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'inventario'
                ? 'text-amber-400 border-amber-400'
                : 'border-transparent hover:text-slate-100'
            }`}
          >
            Inventario
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('finanzas')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'finanzas'
                ? 'text-amber-400 border-amber-400'
                : 'border-transparent hover:text-slate-100'
            }`}
          >
            Finanzas
          </button>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowDuoModal(true)}
            className={`min-h-[40px] px-3 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
              duoRole !== 'completo'
                ? 'bg-amber-400 text-slate-950 border-amber-300 font-bold shadow-md shadow-amber-400/20'
                : 'bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800'
            }`}
            title="Centro de Control iPhone Dúo (2 teléfonos sincronizados: Caja POS + Cocina KDS o Pantalla Cliente)"
          >
            <Radio className={`w-4 h-4 ${duoRole !== 'completo' ? 'text-slate-950 animate-pulse' : 'text-amber-400'}`} />
            <span className="hidden sm:inline">iPhone Dúo:</span>
            <span className="capitalize">{duoRole === 'completo' ? 'Dúo' : duoRole}</span>
          </button>

          {/* Bloquear POS */}
          <button
            type="button"
            onClick={handleLockPOS}
            className="min-h-[40px] px-3 py-2 text-xs font-semibold text-slate-300 bg-slate-900 border border-slate-800 hover:border-amber-500/60 hover:text-amber-300 rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5"
            title="Bloquear Terminal POS (Requiere contraseña 0503 para reabrir)"
          >
            <Lock className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">Bloquear POS</span>
          </button>

          {!isInstalled && isInstallable ? (
            <button
              type="button"
              onClick={install}
              className="min-h-[40px] px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-400 rounded-lg hover:bg-amber-300 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5"
            >
              <Smartphone className="w-4 h-4" />
              Instalar App
            </button>
          ) : !isInstalled && isIOS ? (
            <button
              type="button"
              onClick={() => setShowIOSModal(true)}
              className="min-h-[40px] px-3.5 py-2 text-xs font-semibold text-amber-300 bg-slate-900 border border-amber-500/40 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5"
            >
              <Smartphone className="w-4 h-4" />
              Instalar iOS
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCloseDayAndSendExcel}
              disabled={isClosingBusy}
              className="min-h-[40px] px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-400 rounded-lg hover:bg-amber-300 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Exportar Excel
            </button>
          )}
        </div>
      </header>

      {/* Intercom Alert Banner for iPhone Duo */}
      {duoIntercomAlert && (
        <div
          className={`px-4 py-2.5 border-b flex items-center justify-between gap-3 text-xs font-semibold shadow-lg ${
            duoIntercomAlert.type === 'urgent'
              ? 'bg-rose-950/95 border-rose-500 text-rose-100 animate-pulse'
              : 'bg-emerald-950/95 border-emerald-500 text-emerald-100'
          }`}
        >
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 shrink-0" />
            <span>{duoIntercomAlert.text}</span>
            <span className="text-[10px] opacity-75 font-mono">({duoIntercomAlert.time})</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (duoRole === 'cocina') handlePingCaja();
                else handlePingCocina();
              }}
              className="px-2.5 py-1 rounded bg-black/40 hover:bg-black/60 text-[11px] font-bold border border-white/20 whitespace-nowrap"
            >
              Responder Timbre
            </button>
            <button
              type="button"
              onClick={() => setDuoIntercomAlert(null)}
              className="p-1 hover:bg-black/30 rounded"
              aria-label="Cerrar alerta"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Offline Banner */}
      {!isOnline && (
        <div className="bg-amber-500/20 border-b border-amber-500/40 px-4 py-2 text-xs text-amber-200 flex items-center justify-between">
          <span>Modo Sin Conexión activo — Todos los datos se guardan en este dispositivo.</span>
          <span className="font-mono">LOCALSTORAGE OK</span>
        </div>
      )}

      {/* Toast Feedback Banner */}
      {toast && (
        <div className="fixed top-16 right-4 left-4 sm:left-auto sm:max-w-md z-50 pointer-events-none">
          <div
            className={`pointer-events-auto rounded-xl px-4 py-3 border shadow-xl flex items-center justify-between gap-3 text-sm font-medium ${
              toast.type === 'error'
                ? 'bg-rose-950/95 border-rose-500 text-rose-100'
                : toast.type === 'warning'
                ? 'bg-amber-950/95 border-amber-500 text-amber-100'
                : toast.type === 'info'
                ? 'bg-sky-950/95 border-sky-500 text-sky-100'
                : 'bg-emerald-950/95 border-emerald-500 text-emerald-100'
            }`}
          >
            <span>{toast.text}</span>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="p-1 rounded hover:bg-black/20 shrink-0"
              aria-label="Cerrar aviso"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* =====================================================================
          OPERATIONAL SUB-BAR (Real-time Vitrina & Financial Telemetry)
         ===================================================================== */}
      <div className="bg-[#0F172A] border-b border-slate-800/80 px-4 lg:px-8 py-2.5">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-y-2 gap-x-6 text-xs text-slate-300">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <span>
              Vitrina Disponible:{' '}
              <strong
                className={`font-mono text-sm ${
                  availableChickensForImmediateSale <= 2 ? 'text-rose-400' : 'text-amber-400'
                }`}
              >
                {formatQty(availableChickensForImmediateSale)} pollos
              </strong>
            </span>
            <span aria-hidden="true" className="text-slate-600">
              ·
            </span>
            <span>
              Físicos: <strong className="font-mono text-white">{formatQty(state.cookedChickensInShowcase)}</strong>
            </span>
            <span aria-hidden="true" className="text-slate-600">
              ·
            </span>
            <span>
              Reservados:{' '}
              <strong className="font-mono text-sky-400">{formatQty(reservedChickensInOrders)}</strong>
            </span>
            <span aria-hidden="true" className="text-slate-600">
              ·
            </span>
            <span>
              En Horno: <strong className="font-mono text-orange-400">{formatQty(chickensInOven)}</strong>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden sm:inline">
              Utilidad Neta Hoy:{' '}
              <strong
                className={`font-mono ${
                  financialMetrics.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {formatCLP(financialMetrics.netProfit)} ({financialMetrics.realMarginPct}%)
              </strong>
            </span>
            <button
              type="button"
              onClick={() => setShowDuoModal(true)}
              className={`px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap shrink-0 flex items-center gap-1 border transition-colors ${
                duoRole !== 'completo'
                  ? 'bg-amber-400 text-slate-950 border-amber-300 font-bold'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
              }`}
              title="Abrir Centro de Control iPhone Dúo (2 teléfonos sincronizados)"
            >
              <Radio className={`w-3.5 h-3.5 ${duoRole !== 'completo' ? 'text-slate-950 animate-pulse' : 'text-amber-400'}`} />
              <span>Dúo: {duoRole === 'caja' ? 'Caja POS' : duoRole === 'cocina' ? 'Cocina KDS' : duoRole === 'cliente' ? 'Visor Cliente' : '2 Celulares'}</span>
            </button>
            <button
              type="button"
              onClick={() => downloadStandaloneSingleFileHtml(state)}
              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-medium whitespace-nowrap shrink-0 flex items-center gap-1"
              title="Descargar versión portable en un único archivo HTML con tus datos actuales"
            >
              <Download className="w-3.5 h-3.5 text-amber-400" />
              HTML Único
            </button>
          </div>
        </div>
      </div>

      {/* =====================================================================
          MAIN WORKSPACE CONTAINER
         ===================================================================== */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 lg:px-8 py-5">
        {duoRole === 'cliente' ? (
          <div className="space-y-6">
            <div className="p-4 sm:p-6 rounded-3xl bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-transparent border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <img
                  src="/assets/aistudio/betopolloslogo_3f191103.jpg"
                  alt="Logo Beto Pollos"
                  className="w-12 h-12 rounded-2xl border-2 border-amber-400/80 object-cover shadow-lg shadow-amber-400/20 bg-black shrink-0"
                />
                <div>
                  <h1 className="font-display text-xl sm:text-2xl font-black text-white">
                    Asaduría Beto Pollos
                  </h1>
                  <p className="text-xs text-amber-300 font-medium">
                    Pantalla Cliente en Mostrador · Sincronizada en vivo
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleWakeLock}
                  className={`min-h-[40px] px-3.5 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 transition-colors ${
                    wakeLockActive
                      ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                  title="Evita que la pantalla del iPhone se apague"
                >
                  <Sun className={`w-4 h-4 ${wakeLockActive ? 'text-emerald-400' : ''}`} />
                  <span>{wakeLockActive ? 'Pantalla Activa' : 'Mantener Encendida'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowDuoModal(true)}
                  className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700"
                >
                  Cambiar Rol
                </button>
              </div>
            </div>

            {syncedCustomerCart.lines.length === 0 ? (
              <div className="p-8 sm:p-14 rounded-3xl bg-[#0F172A] border border-slate-800 text-center space-y-6">
                <div className="relative w-24 h-24 mx-auto">
                  <div className="absolute -inset-1 rounded-full bg-gradient-to-tr from-amber-500 to-orange-500 opacity-40 blur-md" />
                  <img
                    src="/assets/aistudio/betopolloslogo_3f191103.jpg"
                    alt="Logo Beto Pollos"
                    className="relative w-24 h-24 mx-auto rounded-full border-2 border-amber-400 shadow-2xl object-cover bg-black"
                  />
                </div>
                <div className="max-w-md mx-auto space-y-2">
                  <h2 className="font-display text-2xl sm:text-3xl font-extrabold text-white">
                    ¡Bienvenidos a Beto Pollos!
                  </h2>
                  <p className="text-sm text-slate-300">
                    Pollos asados al carbón, crocantes papas fritas, empanadas de pino y mote con huesillo artesanal.
                  </p>
                  <p className="text-xs text-amber-400 font-medium pt-2">
                    En este momento la caja está lista para tomar su pedido...
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4 max-w-2xl mx-auto">
                  <div className="p-3.5 rounded-2xl bg-[#090D16] border border-slate-800 text-left">
                    <span className="text-lg">🔥</span>
                    <h3 className="text-xs font-bold text-white mt-1">Pollo Asado Entero</h3>
                    <p className="text-[11px] text-slate-400 mt-0.5">Dorado y jugoso, con pebre de la casa</p>
                  </div>
                  <div className="p-3.5 rounded-2xl bg-[#090D16] border border-slate-800 text-left">
                    <span className="text-lg">🍟</span>
                    <h3 className="text-xs font-bold text-white mt-1">Combo Familiar</h3>
                    <p className="text-[11px] text-slate-400 mt-0.5">1 Pollo entero + Papas grandes + Bebida 1.5L</p>
                  </div>
                  <div className="p-3.5 rounded-2xl bg-[#090D16] border border-slate-800 text-left">
                    <span className="text-lg">🥟</span>
                    <h3 className="text-xs font-bold text-white mt-1">Empanadas de Horno</h3>
                    <p className="text-[11px] text-slate-400 mt-0.5">Pino de carne suave con huevo y aceituna</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Column 1: Itemized Ticket */}
                <div className="lg:col-span-7 rounded-3xl bg-[#0F172A] border border-slate-800 p-5 sm:p-6 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <h2 className="font-display text-lg font-bold text-white flex items-center gap-2">
                      <Receipt className="w-5 h-5 text-amber-400" />
                      Detalle de su Pedido
                    </h2>
                    <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-amber-400/20 text-amber-300 font-semibold">
                      {syncedCustomerCart.lines.reduce((s, l) => s + l.qty, 0)} productos
                    </span>
                  </div>

                  <div className="divide-y divide-slate-800/80">
                    {syncedCustomerCart.lines.map((line, idx) => (
                      <div key={idx} className="py-3 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <span className="w-7 h-7 rounded-lg bg-slate-800 text-amber-400 font-mono font-bold text-xs flex items-center justify-center shrink-0">
                            {line.qty}x
                          </span>
                          <div>
                            <span className="text-sm font-semibold text-white block">
                              {line.name}
                            </span>
                            <span className="text-xs text-slate-400 font-mono">
                              {formatCLP(line.price)} c/u
                            </span>
                          </div>
                        </div>
                        <span className="font-mono text-base font-bold text-white shrink-0">
                          {formatCLP(line.total)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Column 2: Total & Payment Instructions */}
                <div className="lg:col-span-5 space-y-4">
                  <div className="rounded-3xl bg-[#0F172A] border border-amber-400/40 p-6 space-y-5 shadow-2xl">
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider text-amber-400 block mb-1">
                        Total a Pagar ($ CLP)
                      </span>
                      <div className="font-mono text-4xl sm:text-5xl font-black text-white">
                        {formatCLP(syncedCustomerCart.total)}
                      </div>
                    </div>

                    <div className="p-4 rounded-2xl bg-[#090D16] border border-slate-800 space-y-2">
                      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                        Medio de Pago Seleccionado:
                      </span>
                      <div className="text-sm font-bold text-white flex items-center gap-2">
                        {syncedCustomerCart.paymentMethod === 'Efectivo' && '💵 Efectivo'}
                        {syncedCustomerCart.paymentMethod === 'Tarjeta (Débito/Crédito)' && '💳 Tarjeta Débito / Crédito'}
                        {syncedCustomerCart.paymentMethod === 'Transferencia' && '📱 Transferencia Bancaria'}
                      </div>

                      {syncedCustomerCart.paymentMethod === 'Efectivo' && syncedCustomerCart.cashReceived > 0 && (
                        <div className="pt-2 border-t border-slate-800 space-y-1 font-mono text-xs">
                          <div className="flex justify-between text-slate-300">
                            <span>Efectivo Entregado:</span>
                            <strong className="text-white">{formatCLP(syncedCustomerCart.cashReceived)}</strong>
                          </div>
                          <div className="flex justify-between text-emerald-400 font-bold text-sm pt-1">
                            <span>Su Vuelto:</span>
                            <span>{formatCLP(syncedCustomerCart.changeGiven)}</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {syncedCustomerCart.paymentMethod === 'Transferencia' && (
                      <div className="p-4 rounded-2xl bg-amber-400/10 border border-amber-400/30 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                            <QrCode className="w-4 h-4" />
                            Datos para Transferencia
                          </span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-400/20 text-amber-200">
                            CuentaRUT
                          </span>
                        </div>
                        <div className="font-mono text-xs space-y-1 text-slate-200">
                          <div><span className="text-slate-400">Banco:</span> BancoEstado</div>
                          <div><span className="text-slate-400">Tipo:</span> CuentaRUT / Vista</div>
                          <div><span className="text-slate-400">RUT:</span> 16.942.381-8</div>
                          <div><span className="text-slate-400">Nombre:</span> Asaduría Beto Pollos SpA</div>
                          <div><span className="text-slate-400">Correo:</span> fama169rp@gmail.com</div>
                          <div className="pt-1 text-amber-300 font-bold">
                            Monto exacto: {formatCLP(syncedCustomerCart.total)}
                          </div>
                        </div>
                      </div>
                    )}

                    {syncedCustomerCart.paymentMethod === 'Tarjeta (Débito/Crédito)' && (
                      <div className="p-3.5 rounded-2xl bg-sky-500/10 border border-sky-500/30 text-xs text-sky-200 flex items-center gap-2.5">
                        <Smartphone className="w-5 h-5 text-sky-400 shrink-0" />
                        <span>Por favor inserte o acerque su tarjeta en la máquina Transbank del mostrador.</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* -------------------------------------------------------------------
                TAB 1: MÓDULO POS (CAJA Y VENTA RÁPIDA)
               ------------------------------------------------------------------- */}
            {activeTab === 'pos' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left / Main Column: Tactile Product Grid */}
            <div className="lg:col-span-7 xl:col-span-8 space-y-4">
              {/* POS Header & Category Segmented Controls */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h1 className="font-display text-xl sm:text-2xl font-bold text-white">
                    Caja y Venta Rápida (POS)
                  </h1>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Descuento automático de pollos en vitrina, papas e insumos de empaque según receta
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleOpenGeneralPriceManager}
                    className={`min-h-[44px] px-3.5 py-2 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                      isPriceUnlocked
                        ? 'bg-amber-400/15 border-amber-400 text-amber-300 hover:bg-amber-400/25'
                        : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-200'
                    }`}
                    title="Cambiar nombres de combos, acompañamientos y pollos (requiere clave Betopollos)"
                  >
                    {isPriceUnlocked ? (
                      <Unlock className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Lock className="w-4 h-4 text-amber-400" />
                    )}
                    <span>{isPriceUnlocked ? 'Menú Desbloqueado' : 'Cambiar Nombres y Precios'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowPettyCashModal(true)}
                    className="min-h-[44px] px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-200 flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
                  >
                    <Wallet className="w-4 h-4 text-amber-400" />
                    Gasto de Caja Chica ({formatCLP(financialMetrics.pettyCashTotal)})
                  </button>

                  <button
                    type="button"
                    onClick={handlePingCocina}
                    className="min-h-[44px] px-3.5 py-2 rounded-xl bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/50 text-xs font-semibold text-orange-200 flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 active:scale-95 transition-all"
                    title="Enviar timbre sonoro a iPhone Cocina: ¡Pedir pollos al horno!"
                  >
                    <Bell className="w-4 h-4 text-orange-400" />
                    <span>🚨 Timbre Cocina</span>
                  </button>
                </div>
              </div>

              {/* Alert if Available Chickens in Vitrina <= 2 */}
              {availableChickensForImmediateSale <= 2 && (
                <div className="p-3.5 rounded-xl bg-rose-950/60 border border-rose-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                    <div className="text-xs text-rose-100">
                      <strong className="font-semibold block text-sm">
                        Atención Vitrina: Quedan {formatQty(availableChickensForImmediateSale)} pollos disponibles para venta inmediata
                      </strong>
                      Hay {formatQty(state.cookedChickensInShowcase)} cocidos físicos y{' '}
                      {formatQty(reservedChickensInOrders)} reservados en pedidos. En horno:{' '}
                      {formatQty(chickensInOven)} unid.
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handlePingCocina}
                      className="min-h-[40px] px-3 py-2 rounded-lg bg-orange-500 hover:bg-orange-400 text-slate-950 font-bold text-xs whitespace-nowrap shrink-0 flex items-center gap-1.5 active:scale-95 transition-transform"
                      title="Enviar alerta sonora directa al iPhone de Cocina"
                    >
                      <Bell className="w-3.5 h-3.5" />
                      Pedir a Cocina
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('cocina')}
                      className="min-h-[40px] px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs whitespace-nowrap shrink-0"
                    >
                      Ver Horno
                    </button>
                  </div>
                </div>
              )}

              {/* Interactive Category Filter Buttons */}
              <div className="flex items-center gap-1.5 p-1.5 bg-[#0F172A] border border-slate-800 rounded-xl overflow-x-auto">
                {(['Todos', 'Pollos', 'Combos', 'Acompañamientos'] as const).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setPosCategory(cat)}
                    className={`min-h-[40px] px-4 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                      posCategory === cat
                        ? 'bg-amber-400 text-slate-950 shadow-sm'
                        : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {/* Tactile Product Buttons Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {filteredPosProducts.map((product) => {
                  const qtyInCart = cart[product.id] || 0;
                  const unitCost = calculateProductRecipeCost(product, state.supplies);
                  const unitMarginPct =
                    product.price > 0
                      ? Math.round(((product.price - unitCost) / product.price) * 100)
                      : 0;
                  const outOfShowcaseStock =
                    product.cookedChickenUnits > 0 &&
                    availableChickensForImmediateSale <
                      cartDetails.totalChickens + product.cookedChickenUnits &&
                    !allowNegativeShowcase;

                  return (
                    <div
                      key={product.id}
                      className={`p-4 rounded-2xl bg-[#0F172A] border transition-colors flex flex-col justify-between gap-3 ${
                        qtyInCart > 0
                          ? 'border-amber-400 bg-amber-500/5'
                          : 'border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <h2 className="font-display font-bold text-base text-white leading-snug">
                              {product.name}
                            </h2>
                            <button
                              type="button"
                              onClick={() => handleOpenPriceModalForProduct(product)}
                              className="p-1 rounded text-slate-500 hover:text-amber-400 hover:bg-slate-800 transition-colors shrink-0"
                              title="Cambiar nombre de este producto (requiere clave Betopollos)"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleOpenPriceModalForProduct(product)}
                            className="group flex items-center gap-1 font-mono font-bold text-lg text-amber-400 hover:text-amber-300 transition-colors shrink-0"
                            title="Modificar precio y nombre (requiere clave Betopollos)"
                          >
                            <span>{formatCLP(product.price)}</span>
                            <Edit3 className="w-3.5 h-3.5 text-slate-500 group-hover:text-amber-300 opacity-60 group-hover:opacity-100 transition-opacity" />
                          </button>
                        </div>
                        <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                          {product.shortDesc}
                        </p>

                        {/* Unboxed Metadata with · separators */}
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400 mt-2.5 font-mono">
                          <span>Costo: {formatCLP(unitCost)}</span>
                          <span aria-hidden="true">·</span>
                          <span className="text-emerald-400">Margen: {unitMarginPct}%</span>
                          {product.cookedChickenUnits > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-amber-300">
                                Descuenta {formatQty(product.cookedChickenUnits)} pollo
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Tactile Add / Stepper Controls */}
                      <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2">
                        {qtyInCart === 0 ? (
                          <button
                            type="button"
                            onClick={() => updateCartQty(product.id, 1)}
                            className={`w-full min-h-[48px] px-4 py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-transform active:scale-[0.98] ${
                              outOfShowcaseStock
                                ? 'bg-slate-800 text-rose-300 border border-rose-500/40'
                                : 'bg-slate-800 hover:bg-amber-400 hover:text-slate-950 text-white'
                            }`}
                          >
                            <Plus className="w-4 h-4" />
                            {outOfShowcaseStock ? 'Sin Pollo Cocido Disp.' : 'Agregar a Caja'}
                          </button>
                        ) : (
                          <div className="w-full flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => updateCartQty(product.id, -1)}
                              className="min-h-[48px] min-w-[52px] rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-mono text-lg font-bold flex items-center justify-center active:scale-95"
                              aria-label="Restar unidad"
                            >
                              -
                            </button>
                            <div className="text-center">
                              <span className="font-mono text-lg font-bold text-amber-400 block">
                                {qtyInCart} unid.
                              </span>
                              <span className="font-mono text-[11px] text-slate-400">
                                {formatCLP(product.price * qtyInCart)}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => updateCartQty(product.id, 1)}
                              className="min-h-[48px] min-w-[52px] rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-mono text-lg font-bold flex items-center justify-center active:scale-95"
                              aria-label="Sumar unidad"
                            >
                              +
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right Column: Shopping Cart, Change Calculator & Payment Method */}
            <div className="lg:col-span-5 xl:col-span-4 lg:sticky lg:top-20">
              <div className="rounded-2xl bg-[#0F172A] border border-slate-800 p-4 sm:p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div>
                    <h2 className="font-display text-lg font-bold text-white flex items-center gap-2">
                      <ShoppingBag className="w-5 h-5 text-amber-400" />
                      Ticket de Caja Actual
                    </h2>
                    <p className="text-xs text-slate-400 font-mono mt-0.5">
                      {cartDetails.totalItems} productos · {formatQty(cartDetails.totalChickens)}{' '}
                      pollos vitrina
                    </p>
                  </div>
                  {cartDetails.lines.length > 0 && (
                    <button
                      type="button"
                      onClick={clearCart}
                      className="min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-medium text-rose-400 hover:bg-rose-950/50 transition-colors"
                    >
                      Vaciar
                    </button>
                  )}
                </div>

                {/* Cart Items List */}
                {cartDetails.lines.length === 0 ? (
                  <div className="py-8 text-center space-y-2">
                    <p className="text-sm text-slate-400">
                      Toca cualquier producto o combo para armar la venta.
                    </p>
                    <p className="text-xs text-slate-500 font-mono">
                      Soporta venta fraccionada (0,5 pollo en 1/2 Pollo Asado)
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
                    {cartDetails.lines.map((line) => (
                      <div
                        key={line.product.id}
                        className="flex items-center justify-between gap-2 py-2 border-b border-slate-800/70 text-sm"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-white truncate">{line.product.name}</div>
                          <div className="text-xs text-slate-400 font-mono">
                            {line.qty} x {formatCLP(line.product.price)}
                            {line.lineChickens > 0 ? ` · ${formatQty(line.lineChickens)} pollo` : ''}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => updateCartQty(line.product.id, -1)}
                            className="w-8 h-8 rounded-lg bg-slate-800 text-white font-mono font-bold"
                          >
                            -
                          </button>
                          <span className="font-mono text-xs w-5 text-center">{line.qty}</span>
                          <button
                            type="button"
                            onClick={() => updateCartQty(line.product.id, 1)}
                            className="w-8 h-8 rounded-lg bg-slate-800 text-amber-400 font-mono font-bold"
                          >
                            +
                          </button>
                          <span className="font-mono font-semibold text-white w-20 text-right">
                            {formatCLP(line.linePrice)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Stock blocker / override notice */}
                {isShowcaseInsufficientForCart && (
                  <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-500/50 text-xs text-rose-100 space-y-2">
                    <div className="font-semibold text-rose-300">
                      Stock en vitrina insuficiente ({formatQty(availableChickensForImmediateSale)} disp. /{' '}
                      {formatQty(cartDetails.totalChickens)} req.)
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={allowNegativeShowcase}
                        onChange={(e) => setAllowNegativeShowcase(e.target.checked)}
                        className="w-4 h-4 accent-amber-400 rounded"
                      />
                      <span>Permitir venta forzada (descontar de lote saliendo del horno)</span>
                    </label>
                  </div>
                )}

                {/* Totals Summary */}
                <div className="p-3.5 rounded-xl bg-[#090D16] border border-slate-800 space-y-1.5">
                  <div className="flex justify-between text-xs text-slate-400 font-mono">
                    <span>Costo Receta Insumos:</span>
                    <span>{formatCLP(cartDetails.totalCost)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-emerald-400 font-mono">
                    <span>Utilidad Estimada Venta:</span>
                    <span>+{formatCLP(cartDetails.expectedProfit)}</span>
                  </div>
                  <div className="pt-2 border-t border-slate-800 flex items-baseline justify-between">
                    <span className="font-display font-bold text-sm text-slate-200">
                      TOTAL A PAGAR
                    </span>
                    <span className="font-mono text-2xl font-bold text-amber-400">
                      {formatCLP(cartDetails.totalPrice)}
                    </span>
                  </div>
                </div>

                {/* Mandatory Payment Method Selector */}
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-300">
                    Medio de Pago Obligatorio
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { id: 'Efectivo', label: 'Efectivo' },
                        { id: 'Tarjeta (Débito/Crédito)', label: 'Tarjeta' },
                        { id: 'Transferencia', label: 'Transferencia' },
                      ] as const
                    ).map((pm) => (
                      <button
                        key={pm.id}
                        type="button"
                        onClick={() => setPosPaymentMethod(pm.id)}
                        className={`min-h-[44px] px-2 py-2 rounded-xl text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 ${
                          posPaymentMethod === pm.id
                            ? 'bg-amber-400 text-slate-950 border-amber-400'
                            : 'bg-[#090D16] text-slate-300 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        {pm.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Cash Received & Change Calculator (Vuelto) */}
                {posPaymentMethod === 'Efectivo' && (
                  <div className="p-3.5 rounded-xl bg-[#090D16] border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor="pos-cash-input" className="text-xs font-medium text-slate-300">
                        Monto Pagado ($)
                      </label>
                      <input
                        id="pos-cash-input"
                        type="text"
                        inputMode="numeric"
                        placeholder="Ej. 20000"
                        value={cashPaidInput}
                        onChange={(e) => setCashPaidInput(e.target.value)}
                        className="w-36 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-right font-mono text-sm text-white focus:outline-none focus:border-amber-400"
                      />
                    </div>

                    {/* Quick Chilean Peso Bills */}
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { label: 'Exacto', val: cartDetails.totalPrice },
                        { label: '$5.000', val: 5000 },
                        { label: '$10.000', val: 10000 },
                        { label: '$20.000', val: 20000 },
                        { label: '$30.000', val: 30000 },
                        { label: '$50.000', val: 50000 },
                      ].map((btn) => (
                        <button
                          key={btn.label}
                          type="button"
                          onClick={() => setCashPaidInput(String(btn.val))}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-mono text-slate-200"
                        >
                          {btn.label}
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                      <span className="text-xs text-slate-400">Vuelto a Entregar:</span>
                      <span className="font-mono text-lg font-bold text-emerald-400">
                        {formatCLP(changeToReturn)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Primary Checkout Button */}
                <button
                  type="button"
                  disabled={cartDetails.lines.length === 0}
                  onClick={handleConfirmPosSale}
                  className="w-full min-h-[52px] rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-display font-bold text-base flex items-center justify-center gap-2 transition-transform active:scale-[0.99] shadow-lg shadow-emerald-950/50"
                >
                  <CheckCircle2 className="w-5 h-5" />
                  Registrar Venta ({formatCLP(cartDetails.totalPrice)})
                </button>
              </div>
            </div>
          </div>
        )}

        {/* -------------------------------------------------------------------
            TAB 2: MÓDULO COCINA Y COCCIÓN (FLUJO EN 3 ETAPAS)
           ------------------------------------------------------------------- */}
        {activeTab === 'cocina' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="font-display text-xl sm:text-2xl font-bold text-white">
                    Control de Cocina y Cocción en 3 Etapas
                  </h1>
                  {duoRole === 'cocina' && (
                    <span className="text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-orange-500/20 text-orange-300 border border-orange-500/30">
                      KDS Maestro Asador
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Sincronizado en tiempo real con el stock de Pollo Crudo en Inventario, reservas de Pedidos y Caja POS
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handlePingCaja}
                  className="min-h-[44px] px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 active:scale-95 transition-transform shadow-lg shadow-emerald-950/40"
                  title="Enviar aviso sonoro directo al iPhone de Caja: ¡Tanda de pollos lista en vitrina!"
                >
                  <Bell className="w-4 h-4 text-slate-950 animate-bounce" />
                  <span>🔔 Avisar a Caja: ¡Tanda Lista!</span>
                </button>

                <button
                  type="button"
                  onClick={toggleWakeLock}
                  className={`min-h-[44px] px-3 py-2 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                    wakeLockActive
                      ? 'bg-amber-400/20 border-amber-400 text-amber-300'
                      : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-300'
                  }`}
                  title="Evita que la pantalla del iPhone se bloquee mientras cocinas con guantes"
                >
                  <Sun className={`w-4 h-4 ${wakeLockActive ? 'text-amber-400' : 'text-slate-400'}`} />
                  <span>{wakeLockActive ? 'Pantalla Siempre ON' : 'Pantalla Normal'}</span>
                </button>

                <div className="text-xs font-mono text-slate-300 bg-[#0F172A] border border-slate-800 px-3 py-2 rounded-xl">
                  Total Local: <strong className="text-amber-400">{formatQty(totalChickenStockInStore)} unid</strong>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-stretch">
              {/* ETAPA 1: EN FRÍO / CRUDOS */}
              <div className="rounded-2xl bg-[#0F172A] border border-slate-800 p-5 flex flex-col justify-between space-y-5">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono uppercase tracking-wider text-sky-400">
                      01. Etapa 1 — Cámara Frío
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('inventario');
                        handleOpenPurchaseModal('sup_pollo_crudo');
                      }}
                      className="text-xs text-amber-400 hover:underline font-medium"
                    >
                      + Comprar Pollo Crudo
                    </button>
                  </div>

                  <div>
                    <h2 className="font-display text-lg font-bold text-white">
                      En Frío / Crudos (Listos para Hornear)
                    </h2>
                    <div className="mt-3 p-4 rounded-xl bg-[#090D16] border border-slate-800 flex items-baseline justify-between">
                      <span className="text-xs text-slate-400">Disponibles en Frío:</span>
                      <span className="font-mono text-3xl font-bold text-sky-400">
                        {formatQty(rawChickensInCooler)} <small className="text-sm font-normal">unid</small>
                      </span>
                    </div>
                  </div>

                  {/* Quick Load to Oven Form */}
                  <div className="space-y-3 pt-2">
                    <label className="block text-xs font-semibold text-slate-300">
                      Cantidad de Pollos a Meter al Horno
                    </label>
                    <div className="grid grid-cols-5 gap-1.5">
                      {[4, 6, 8, 10, 12].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setOvenInputQty(String(n))}
                          className={`min-h-[42px] rounded-lg font-mono text-xs font-bold border transition-colors ${
                            Number(ovenInputQty) === n
                              ? 'bg-amber-400 text-slate-950 border-amber-400'
                              : 'bg-[#090D16] text-slate-300 border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label htmlFor="oven-qty" className="block text-[11px] text-slate-400 mb-1">
                          Cantidad exacta
                        </label>
                        <input
                          id="oven-qty"
                          type="number"
                          step="1"
                          min="1"
                          value={ovenInputQty}
                          onChange={(e) => setOvenInputQty(e.target.value)}
                          className="w-full min-h-[44px] px-3 rounded-xl bg-[#090D16] border border-slate-700 font-mono text-sm text-white"
                        />
                      </div>
                      <div>
                        <label htmlFor="oven-notes" className="block text-[11px] text-slate-400 mb-1">
                          Identificador Espiedo
                        </label>
                        <input
                          id="oven-notes"
                          type="text"
                          value={ovenInputNotes}
                          onChange={(e) => setOvenInputNotes(e.target.value)}
                          placeholder="Ej. Espiedo 1"
                          className="w-full min-h-[44px] px-3 rounded-xl bg-[#090D16] border border-slate-700 text-sm text-white"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handlePutChickensInOven(Number(ovenInputQty) || 0)}
                  className="w-full min-h-[50px] rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-display font-bold text-sm flex items-center justify-center gap-2 transition-transform active:scale-[0.98]"
                >
                  <Flame className="w-5 h-5" />
                  Meter {ovenInputQty || 0} Pollos al Horno
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>

              {/* ETAPA 2: EN COCCIÓN (EN HORNO) */}
              <div className="rounded-2xl bg-[#0F172A] border border-slate-800 p-5 flex flex-col justify-between space-y-4">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono uppercase tracking-wider text-orange-400">
                      02. Etapa 2 — En Horno / Espiedo
                    </span>
                    <span className="font-mono text-xs text-orange-300">
                      {state.ovenBatches.length} lotes activos ({formatQty(chickensInOven)} pollos)
                    </span>
                  </div>

                  <h2 className="font-display text-lg font-bold text-white">
                    En Cocción (Horno Activo)
                  </h2>

                  {state.ovenBatches.length === 0 ? (
                    <div className="py-12 px-4 rounded-xl bg-[#090D16] border border-slate-800/80 text-center space-y-2">
                      <Flame className="w-8 h-8 text-slate-600 mx-auto" />
                      <p className="text-sm text-slate-400">No hay tandas en el horno ahora.</p>
                      <p className="text-xs text-slate-500">
                        Usa el panel de Etapa 1 para cargar pollos crudos al espiedo.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {state.ovenBatches.map((batch) => {
                        const elapsedMin = Math.max(
                          1,
                          Math.round((nowTick - batch.startedAtMs) / 60000)
                        );
                        const pct = Math.min(100, Math.round((elapsedMin / 55) * 100));

                        return (
                          <div
                            key={batch.id}
                            className="p-4 rounded-xl bg-[#090D16] border border-slate-800 space-y-3"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="font-display font-bold text-base text-white">
                                  {batch.id} ·{' '}
                                  <span className="text-amber-400 font-mono">
                                    {formatQty(batch.quantity)} pollos
                                  </span>
                                </div>
                                <div className="text-xs text-slate-400 mt-0.5">
                                  {batch.notes} · Ingreso:{' '}
                                  <strong className="font-mono text-slate-200">
                                    {batch.startTime} hrs
                                  </strong>
                                </div>
                              </div>
                              <span className="font-mono text-xs text-orange-300 shrink-0">
                                {elapsedMin} min
                              </span>
                            </div>

                            {/* Cooking progress bar (55m reference) */}
                            <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-amber-500 to-emerald-400 transition-all"
                                style={{ width: `${pct}%` }}
                              />
                            </div>

                            <button
                              type="button"
                              onClick={() => handleFinishOvenBatch(batch.id)}
                              className="w-full min-h-[46px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs flex items-center justify-center gap-2 transition-transform active:scale-[0.98]"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                              Cocción Lista (Pasar {formatQty(batch.quantity)} Pollos a Vitrina)
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <p className="text-[11px] text-slate-500 font-mono">
                  Al pulsar &quot;Cocción Lista&quot;, las unidades pasan automáticamente a Total Cocidos Física en Etapa 3.
                </p>
              </div>

              {/* ETAPA 3: LISTOS PARA ENTREGA (VITRINA) */}
              <div className="rounded-2xl bg-[#0F172A] border border-slate-800 p-5 flex flex-col justify-between space-y-5">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono uppercase tracking-wider text-emerald-400">
                      03. Etapa 3 — Vitrina Térmica
                    </span>
                    <span className="text-xs text-slate-400">Tiempo Real</span>
                  </div>

                  <h2 className="font-display text-lg font-bold text-white">
                    Listos para Entrega (Vitrina)
                  </h2>

                  {/* 3 Required Indicators */}
                  <div className="space-y-3">
                    {/* Indicator 1: Total Cocidos Física */}
                    <div className="p-3.5 rounded-xl bg-[#090D16] border border-slate-800 flex items-center justify-between">
                      <div>
                        <div className="text-xs font-semibold text-slate-200">
                          1. Total Cocidos Física
                        </div>
                        <div className="text-[11px] text-slate-400">
                          Salieron del horno y están en vitrina
                        </div>
                      </div>
                      <span className="font-mono text-2xl font-bold text-white">
                        {formatQty(state.cookedChickensInShowcase)}
                      </span>
                    </div>

                    {/* Indicator 2: Reservados en Pedidos */}
                    <div className="p-3.5 rounded-xl bg-[#090D16] border border-slate-800 flex items-center justify-between">
                      <div>
                        <div className="text-xs font-semibold text-sky-300">
                          2. Reservados en Pedidos
                        </div>
                        <div className="text-[11px] text-slate-400">
                          Bloqueados por encargos pendientes de retiro
                        </div>
                      </div>
                      <span className="font-mono text-2xl font-bold text-sky-400">
                        -{formatQty(reservedChickensInOrders)}
                      </span>
                    </div>

                    {/* Indicator 3: Disponibles para Venta Inmediata */}
                    <div
                      className={`p-4 rounded-xl border flex items-center justify-between ${
                        availableChickensForImmediateSale <= 0
                          ? 'bg-rose-950/60 border-rose-500/60'
                          : 'bg-emerald-950/40 border-emerald-500/40'
                      }`}
                    >
                      <div>
                        <div className="text-sm font-bold text-white">
                          3. Disponibles Venta Inmediata
                        </div>
                        <div className="text-[11px] text-slate-300">
                          Total Cocidos Física menos Reservados
                        </div>
                      </div>
                      <span
                        className={`font-mono text-3xl font-bold ${
                          availableChickensForImmediateSale <= 0
                            ? 'text-rose-400'
                            : 'text-emerald-400'
                        }`}
                      >
                        {formatQty(availableChickensForImmediateSale)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Quick Vitrina Adjustment or Merma */}
                <div className="pt-3 border-t border-slate-800 space-y-2.5">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      placeholder={String(state.cookedChickensInShowcase)}
                      value={manualShowcaseInput}
                      onChange={(e) => setManualShowcaseInput(e.target.value)}
                      className="flex-1 min-h-[42px] px-3 rounded-lg bg-[#090D16] border border-slate-700 font-mono text-xs text-white"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const val = Number(manualShowcaseInput.replace(',', '.'));
                        if (Number.isFinite(val) && val >= 0) {
                          setState((prev) => ({
                            ...prev,
                            cookedChickensInShowcase: Math.round(val * 100) / 100,
                          }));
                          setManualShowcaseInput('');
                          showToast(`Stock físico en vitrina ajustado a ${formatQty(val)} pollos.`);
                        }
                      }}
                      className="min-h-[42px] px-3.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 whitespace-nowrap shrink-0"
                    >
                      Ajustar Físico
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setWasteSupplyId('sup_pollo_crudo');
                      setWasteQty('0.5');
                      setWasteFromShowcase(true);
                      setShowWasteModal(true);
                    }}
                    className="w-full min-h-[42px] rounded-lg bg-rose-950/60 hover:bg-rose-900/60 border border-rose-500/30 text-xs font-semibold text-rose-300 flex items-center justify-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Reportar Merma de Pollo en Cocina / Vitrina
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* -------------------------------------------------------------------
            TAB 3: MÓDULO DE PEDIDOS Y ENCARGOS (RESERVAS POR HORA)
           ------------------------------------------------------------------- */}
        {activeTab === 'pedidos' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Column: Quick Order / Reservation Form */}
            <form
              onSubmit={handleCreateOrder}
              className="lg:col-span-5 rounded-2xl bg-[#0F172A] border border-slate-800 p-5 space-y-4"
            >
              <div>
                <h1 className="font-display text-lg font-bold text-white">
                  Nuevo Pedido / Reserva por Hora
                </h1>
                <p className="text-xs text-slate-400 mt-0.5">
                  Bloquea automáticamente las unidades de pollo para no venderlas por error en mostrador
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ord-name" className="block text-xs font-medium text-slate-300 mb-1">
                    Nombre del Cliente *
                  </label>
                  <input
                    id="ord-name"
                    type="text"
                    required
                    placeholder="Ej. Juan Pérez"
                    value={orderCustomerName}
                    onChange={(e) => setOrderCustomerName(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-xl bg-[#090D16] border border-slate-700 text-sm text-white"
                  />
                </div>
                <div>
                  <label htmlFor="ord-phone" className="block text-xs font-medium text-slate-300 mb-1">
                    Teléfono / WhatsApp
                  </label>
                  <input
                    id="ord-phone"
                    type="tel"
                    placeholder="+56912345678"
                    value={orderCustomerPhone}
                    onChange={(e) => setOrderCustomerPhone(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-xl bg-[#090D16] border border-slate-700 font-mono text-sm text-white"
                  />
                </div>
              </div>

              {/* Pickup Time with Quick Offset Buttons */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="ord-time" className="text-xs font-medium text-slate-300">
                    Hora Comprometida de Retiro / Entrega *
                  </label>
                  <input
                    id="ord-time"
                    type="time"
                    required
                    value={orderPickupTime}
                    onChange={(e) => setOrderPickupTime(e.target.value)}
                    className="px-3 py-1.5 rounded-lg bg-[#090D16] border border-amber-500/50 font-mono text-sm font-bold text-amber-400"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: '+15 min', min: 15 },
                    { label: '+30 min', min: 30 },
                    { label: '+45 min', min: 45 },
                    { label: '+1 hora', min: 60 },
                    { label: '+2 horas', min: 120 },
                  ].map((q) => (
                    <button
                      key={q.label}
                      type="button"
                      onClick={() => setOrderPickupTime(getFutureTimeStr(q.min))}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-mono text-slate-300"
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Product Selector for Order */}
              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-300">
                  Seleccionar Productos del Pedido
                </label>
                <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                  {state.products.map((prod) => {
                    const q = orderDraftItems[prod.id] || 0;
                    return (
                      <div
                        key={prod.id}
                        className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 ${
                          q > 0
                            ? 'bg-amber-500/10 border-amber-500/50'
                            : 'bg-[#090D16] border-slate-800'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-white truncate">
                            {prod.name}
                          </div>
                          <div className="text-[11px] font-mono text-amber-400">
                            {formatCLP(prod.price)}
                            {prod.cookedChickenUnits > 0
                              ? ` · (${formatQty(prod.cookedChickenUnits)} pollo)`
                              : ''}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => updateOrderDraftQty(prod.id, -1)}
                            className="w-9 h-9 rounded-lg bg-slate-800 text-white font-mono font-bold"
                          >
                            -
                          </button>
                          <span className="font-mono text-xs w-6 text-center font-bold">{q}</span>
                          <button
                            type="button"
                            onClick={() => updateOrderDraftQty(prod.id, 1)}
                            className="w-9 h-9 rounded-lg bg-amber-400 text-slate-950 font-mono font-bold"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Payment Status Selector */}
              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-300">
                  Estado de Pago del Encargo
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setOrderPaymentStatus('Pendiente por pagar al retirar')}
                    className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-semibold border ${
                      orderPaymentStatus === 'Pendiente por pagar al retirar'
                        ? 'bg-amber-400 text-slate-950 border-amber-400'
                        : 'bg-[#090D16] text-slate-300 border-slate-800'
                    }`}
                  >
                    Por Pagar al Retirar
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrderPaymentStatus('Pagado')}
                    className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-semibold border ${
                      orderPaymentStatus === 'Pagado'
                        ? 'bg-emerald-400 text-slate-950 border-emerald-400'
                        : 'bg-[#090D16] text-slate-300 border-slate-800'
                    }`}
                  >
                    Ya Pagado
                  </button>
                </div>

                {orderPaymentStatus === 'Pagado' && (
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    {(['Transferencia', 'Efectivo', 'Tarjeta (Débito/Crédito)'] as const).map(
                      (pm) => (
                        <button
                          key={pm}
                          type="button"
                          onClick={() => setOrderPaymentMethod(pm)}
                          className={`min-h-[40px] px-2 rounded-lg text-[11px] font-semibold border ${
                            orderPaymentMethod === pm
                              ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                              : 'bg-[#090D16] border-slate-800 text-slate-400'
                          }`}
                        >
                          {pm === 'Tarjeta (Débito/Crédito)' ? 'Tarjeta' : pm}
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>

              <div>
                <input
                  type="text"
                  placeholder="Nota opcional (ej. trozado en 8, sin sal, agregar pebre)"
                  value={orderNotes}
                  onChange={(e) => setOrderNotes(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-xl bg-[#090D16] border border-slate-800 text-xs text-white"
                />
              </div>

              <div className="p-3 rounded-xl bg-[#090D16] border border-slate-800 flex items-center justify-between">
                <div className="text-xs text-slate-400">
                  Reserva en Vitrina:{' '}
                  <strong className="font-mono text-sky-400">
                    {formatQty(orderDraftSummary.totalCookedChicken)} pollos
                  </strong>
                </div>
                <div className="font-mono text-lg font-bold text-amber-400">
                  Total: {formatCLP(orderDraftSummary.totalPrice)}
                </div>
              </div>

              <button
                type="submit"
                className="w-full min-h-[50px] rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-display font-bold text-sm flex items-center justify-center gap-2"
              >
                <Clock className="w-4 h-4" />
                Guardar Reserva y Bloquear Stock
              </button>
            </form>

            {/* Right Column: Chronological Orders List */}
            <div className="lg:col-span-7 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-xl font-bold text-white">
                    Agenda de Entregas por Hora
                  </h2>
                  <p className="text-xs text-slate-400">
                    Ordenados por hora comprometida · Total pollos bloqueados hoy:{' '}
                    <strong className="font-mono text-sky-400">
                      {formatQty(reservedChickensInOrders)} unid
                    </strong>
                  </p>
                </div>

                <div className="flex items-center gap-1 p-1 bg-[#0F172A] border border-slate-800 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setOrdersFilter('Pendiente')}
                    className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold ${
                      ordersFilter === 'Pendiente'
                        ? 'bg-amber-400 text-slate-950'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Pendientes ({state.orders.filter((o) => o.deliveryStatus === 'Pendiente').length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrdersFilter('Todos')}
                    className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold ${
                      ordersFilter === 'Todos'
                        ? 'bg-amber-400 text-slate-950'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Historial ({state.orders.length})
                  </button>
                </div>
              </div>

              {sortedOrders.length === 0 ? (
                <div className="rounded-2xl bg-[#0F172A] border border-slate-800 p-10 text-center space-y-2">
                  <Clock className="w-8 h-8 text-slate-600 mx-auto" />
                  <p className="text-sm text-slate-300 font-medium">
                    No hay pedidos pendientes de entrega en este momento.
                  </p>
                  <p className="text-xs text-slate-500">
                    Usa el formulario para agendar encargos telefónicos o de WhatsApp.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {sortedOrders.map((order) => {
                    const urgency = getOrderUrgency(order);
                    const borderClass =
                      urgency.tone === 'rose'
                        ? 'border-rose-500/60 bg-rose-950/20'
                        : urgency.tone === 'amber'
                        ? 'border-amber-500/60 bg-amber-950/15'
                        : urgency.tone === 'emerald'
                        ? 'border-emerald-500/40 bg-[#0F172A]/70'
                        : 'border-slate-800 bg-[#0F172A]';

                    const cleanPhone = order.customerPhone.replace(/\D/g, '');
                    const waUrl = cleanPhone
                      ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(
                          `Hola ${order.customerName}, te escribimos de Asaduría Beto Pollos por tu pedido ${order.id} (${order.items
                            .map((i) => `${i.quantity}x ${i.name}`)
                            .join(', ')}) para las ${order.pickupTime} hrs. Total: ${formatCLP(order.totalPrice)}.`
                        )}`
                      : null;

                    return (
                      <div
                        key={order.id}
                        className={`rounded-2xl border p-4 sm:p-5 space-y-3 ${borderClass}`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2 text-xs font-mono">
                              <span className="text-lg font-bold text-amber-400">
                                {order.pickupTime} hrs
                              </span>
                              <span aria-hidden="true">·</span>
                              <span
                                className={
                                  urgency.tone === 'rose'
                                    ? 'text-rose-400 font-semibold'
                                    : urgency.tone === 'amber'
                                    ? 'text-amber-300 font-semibold'
                                    : urgency.tone === 'emerald'
                                    ? 'text-emerald-400'
                                    : 'text-sky-400'
                                }
                              >
                                {urgency.label}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="text-slate-400">{order.id}</span>
                            </div>

                            <h3 className="font-display text-base font-bold text-white mt-1">
                              {order.customerName}{' '}
                              {order.customerPhone && (
                                <span className="font-mono text-xs font-normal text-slate-400">
                                  ({order.customerPhone})
                                </span>
                              )}
                            </h3>
                          </div>

                          <div className="text-right">
                            <div className="font-mono text-lg font-bold text-white">
                              {formatCLP(order.totalPrice)}
                            </div>
                            <div
                              className={`text-xs font-medium ${
                                order.paymentStatus === 'Pagado'
                                  ? 'text-emerald-400'
                                  : 'text-amber-300'
                              }`}
                            >
                              {order.paymentStatus === 'Pagado'
                                ? `Pagado (${order.paymentMethod || 'Transferencia'})`
                                : 'Pendiente por pagar al retirar'}
                            </div>
                          </div>
                        </div>

                        {/* Items list */}
                        <div className="p-3 rounded-xl bg-[#090D16]/90 border border-slate-800/90 text-xs space-y-1">
                          <div className="text-slate-200 font-medium">
                            {order.items.map((i) => `${i.quantity}x ${i.name}`).join(' + ')}
                          </div>
                          <div className="text-slate-400 font-mono flex flex-wrap items-center gap-2">
                            <span>Reserva: {formatQty(order.totalCookedChicken)} pollos</span>
                            {order.notes && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-amber-300">Nota: {order.notes}</span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        {order.deliveryStatus === 'Pendiente' && (
                          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                            <div className="flex items-center gap-2">
                              {waUrl && (
                                <a
                                  href={waUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="min-h-[42px] px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-emerald-300 flex items-center gap-1.5"
                                >
                                  WhatsApp
                                </a>
                              )}
                              <button
                                type="button"
                                onClick={() => handleCancelOrder(order.id)}
                                className="min-h-[42px] px-3 py-2 rounded-xl bg-slate-900 hover:bg-rose-950/60 text-xs font-medium text-rose-400"
                              >
                                Cancelar Reserva
                              </button>
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                if (order.paymentStatus === 'Pagado' && order.paymentMethod) {
                                  finalizeOrderDelivery(order, order.paymentMethod);
                                } else {
                                  setDeliveringOrder(order);
                                  setDeliveryPaymentMethod('Efectivo');
                                  setDeliveryCashReceived('');
                                }
                              }}
                              className="min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-display font-bold text-xs flex items-center gap-2"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                              Marcar como Entregado
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* -------------------------------------------------------------------
            TAB 4: MÓDULO DE INVENTARIO, COSTOS Y MERMAS
           ------------------------------------------------------------------- */}
        {activeTab === 'inventario' && (
          <div className="space-y-6">
            {/* Header & Primary Inventory Action Buttons */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h1 className="font-display text-xl sm:text-2xl font-bold text-white">
                  Inventario de Insumos, Costos y Mermas
                </h1>
                <p className="text-xs text-slate-400 mt-0.5">
                  Control exacto de stock inicial, compras del día, consumo automático por recetas y mermas valorizadas
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleOpenGeneralPriceManager}
                  className="min-h-[44px] px-3.5 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-semibold text-xs flex items-center gap-1.5 whitespace-nowrap shrink-0 shadow-md shadow-amber-400/20"
                  title="Modificar precios, nombres e insumos con guardado conjunto"
                >
                  <UtensilsCrossed className="w-4 h-4" />
                  Precios e Insumos (Lote)
                </button>
                <button
                  type="button"
                  onClick={() => handleOpenPurchaseModal()}
                  className="min-h-[44px] px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs flex items-center gap-2 whitespace-nowrap shrink-0"
                >
                  <PackagePlus className="w-4 h-4" />
                  Ingresar Compra / Stock (+)
                </button>
                <button
                  type="button"
                  onClick={() => setShowWasteModal(true)}
                  className="min-h-[44px] px-4 py-2.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/50 text-rose-200 font-semibold text-xs flex items-center gap-2 whitespace-nowrap shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                  Registrar Merma (-)
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewSupplyModal(true)}
                  className="min-h-[44px] px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  Nuevo Insumo
                </button>
              </div>
            </div>

            {/* Interactive Supplies Table */}
            <div className="rounded-2xl bg-[#0F172A] border border-slate-800 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-[#090D16]/70 text-[11px] font-semibold text-slate-400">
                      <th className="py-3.5 px-4">Insumo</th>
                      <th className="py-3.5 px-3">Unid</th>
                      <th className="py-3.5 px-3 text-right">Costo Unit. ($)</th>
                      <th className="py-3.5 px-3 text-right">Stock Inicial</th>
                      <th className="py-3.5 px-3 text-right text-emerald-400">Compras (+)</th>
                      <th className="py-3.5 px-3 text-right text-amber-300">Consumo Ventas (-)</th>
                      <th className="py-3.5 px-3 text-right text-rose-400">Mermas (-)</th>
                      <th className="py-3.5 px-3 text-right text-white">Stock Final</th>
                      <th className="py-3.5 px-4 text-right">Valorizado ($)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 text-xs font-mono">
                    {state.supplies.map((s) => {
                      const finalStock = getSupplyRemainingStock(s);
                      const valued = Math.round(finalStock * s.unitCost);
                      return (
                        <tr key={s.id} className="hover:bg-slate-800/40 transition-colors">
                          <td className="py-3 px-4 font-sans font-medium text-white">
                            {s.name}
                            {s.isRawChicken && (
                              <span className="block text-[11px] text-sky-400 font-normal">
                                Conectado a Etapa 1 Cocina ({formatQty(rawChickensInCooler)} en frío)
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-slate-400">{s.unit}</td>
                          <td className="py-3 px-3 text-right">
                            <button
                              type="button"
                              onClick={() => handleOpenPurchaseModal(s.id)}
                              className="text-amber-400 hover:underline font-semibold"
                              title="Clic para actualizar costo o sumar compra"
                            >
                              {formatCLP(s.unitCost)}
                            </button>
                          </td>
                          <td className="py-3 px-3 text-right text-slate-300">
                            {formatQty(s.initialStock)}
                          </td>
                          <td className="py-3 px-3 text-right text-emerald-400">
                            +{formatQty(s.purchases)}
                          </td>
                          <td className="py-3 px-3 text-right text-amber-300">
                            -{formatQty(s.salesConsumption)}
                          </td>
                          <td className="py-3 px-3 text-right text-rose-400">
                            -{formatQty(s.waste)}
                          </td>
                          <td
                            className={`py-3 px-3 text-right font-bold text-sm ${
                              finalStock <= 3 ? 'text-rose-400' : 'text-white'
                            }`}
                          >
                            {formatQty(finalStock)}
                          </td>
                          <td className="py-3 px-4 text-right font-semibold text-slate-200">
                            {formatCLP(valued)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-800 bg-[#090D16] font-mono text-xs font-bold">
                      <td colSpan={6} className="py-3.5 px-4 font-sans text-slate-300">
                        TOTAL VALORIZADO DEL STOCK RESTANTE EN BODEGA
                      </td>
                      <td className="py-3.5 px-3 text-right text-rose-400">
                        Mermas: {formatCLP(financialMetrics.wasteCost)}
                      </td>
                      <td className="py-3.5 px-3 text-right text-slate-400">-</td>
                      <td className="py-3.5 px-4 text-right text-base text-emerald-400">
                        {formatCLP(financialMetrics.inventoryValuation)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Recipe & Unit Production Cost Editor by Sale Product */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-display text-lg font-bold text-white">
                    Editor de Costo y Receta por Producto de Venta
                  </h2>
                  <p className="text-xs text-slate-400">
                    Define exactamente qué insumos consume cada producto o combo al venderse
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleOpenGeneralPriceManager}
                    className={`min-h-[40px] px-3.5 py-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                      isPriceUnlocked
                        ? 'bg-amber-400/15 border-amber-400 text-amber-300'
                        : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                    }`}
                  >
                    {isPriceUnlocked ? (
                      <Unlock className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Lock className="w-4 h-4 text-amber-400" />
                    )}
                    <span>{isPriceUnlocked ? 'Precios Desbloqueados' : 'Modificar Precios (Clave: Betopollos)'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!isPriceUnlocked) {
                        setPasswordInput('');
                        setPasswordError('');
                        setShowPasswordModal(true);
                        return;
                      }
                      setEditingProduct({
                        id: `prod_${Date.now()}`,
                        name: 'Nuevo Combo / Producto',
                        shortDesc: 'Descripción del producto',
                        category: 'Combos',
                        price: 14900,
                        cookedChickenUnits: 1,
                        recipe: [
                          { supplyId: 'sup_pollo_crudo', quantity: 1 },
                          { supplyId: 'sup_envase_pollo', quantity: 1 },
                          { supplyId: 'sup_bolsas', quantity: 1 },
                        ],
                      });
                    }}
                    className="min-h-[40px] px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-amber-400 flex items-center gap-1.5"
                  >
                    <Plus className="w-4 h-4" />
                    Crear Producto / Combo
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {state.products.map((prod) => {
                  const unitCost = calculateProductRecipeCost(prod, state.supplies);
                  const unitProfit = prod.price - unitCost;
                  const marginPct =
                    prod.price > 0 ? Math.round((unitProfit / prod.price) * 1000) / 10 : 0;

                  return (
                    <div
                      key={prod.id}
                      className="p-4 rounded-2xl bg-[#0F172A] border border-slate-800 flex flex-col justify-between gap-3"
                    >
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-display font-bold text-sm text-white">
                            {prod.name}
                          </h3>
                          <button
                            type="button"
                            onClick={() => handleOpenPriceModalForProduct(prod)}
                            className="group font-mono font-bold text-sm text-amber-400 hover:text-amber-300 flex items-center gap-1 shrink-0"
                            title="Modificar precio (requiere clave Betopollos)"
                          >
                            <span>{formatCLP(prod.price)}</span>
                            <Edit3 className="w-3.5 h-3.5 text-slate-500 group-hover:text-amber-300 opacity-60 group-hover:opacity-100" />
                          </button>
                        </div>

                        <div className="text-[11px] font-mono text-slate-400 space-y-0.5">
                          <div>
                            Costo Producción Receta:{' '}
                            <strong className="text-white">{formatCLP(unitCost)}</strong>
                          </div>
                          <div>
                            Utilidad Unitaria:{' '}
                            <strong className="text-emerald-400">
                              {formatCLP(unitProfit)} ({marginPct}%)
                            </strong>
                          </div>
                        </div>

                        <div className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-400 space-y-1">
                          {prod.recipe.map((r) => {
                            const sup = state.supplies.find((s) => s.id === r.supplyId);
                            if (!sup) return null;
                            return (
                              <div key={r.supplyId} className="flex justify-between font-mono">
                                <span className="truncate pr-2">
                                  {formatQty(r.quantity)} {sup.unit} {sup.name}
                                </span>
                                <span className="text-slate-300 shrink-0">
                                  {formatCLP(Math.round(r.quantity * sup.unitCost))}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setEditingProduct({ ...prod, recipe: [...prod.recipe] })}
                        className="w-full min-h-[40px] rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 flex items-center justify-center gap-1.5"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-amber-400" />
                        Editar Receta / Precio
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* -------------------------------------------------------------------
            TAB 5: MÓDULO FINANCIERO (MARGEN REAL) Y CIERRE DE DÍA (EXCEL + CORREO)
           ------------------------------------------------------------------- */}
        {activeTab === 'finanzas' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h1 className="font-display text-xl sm:text-2xl font-bold text-white">
                   Estado de Resultados en Tiempo Real y Cierre Diario
                </h1>
                <p className="text-xs text-slate-400 mt-0.5">
                  Jornada Operativa: <strong className="font-mono text-white">{state.businessDate}</strong> · Destino Cierre:{' '}
                  <strong className="font-mono text-amber-400">{state.recipientEmail}</strong>
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewDayModal(true)}
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <RefreshCw className="w-4 h-4 text-sky-400" />
                  Iniciar Nuevo Día
                </button>
                <button
                  type="button"
                  onClick={handleResetDemoData}
                  className="min-h-[44px] px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs text-slate-400 whitespace-nowrap shrink-0"
                >
                  Restaurar Demo
                </button>
              </div>
            </div>

            {/* 5 REAL-TIME PROFITABILITY CARDS */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              {/* Card 1: Ingresos Brutos desglosados */}
              <div className="p-4 rounded-2xl bg-[#0F172A] border border-slate-800 space-y-2">
                <div className="text-xs font-medium text-slate-400">
                  1. Ingresos Brutos Ventas
                </div>
                <div className="font-mono text-2xl font-bold text-white">
                  {formatCLP(financialMetrics.grossRevenue)}
                </div>
                <div className="pt-2 border-t border-slate-800/80 text-[11px] font-mono text-slate-300 space-y-1">
                  <div className="flex justify-between">
                    <span>Efectivo:</span>
                    <span className="text-emerald-400">{formatCLP(financialMetrics.revenueCash)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Tarjeta:</span>
                    <span className="text-sky-400">{formatCLP(financialMetrics.revenueCard)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Transferencia:</span>
                    <span className="text-amber-300">
                      {formatCLP(financialMetrics.revenueTransfer)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Card 2: Costo de Ventas / Insumos Consumidos */}
              <div className="p-4 rounded-2xl bg-[#0F172A] border border-slate-800 space-y-2">
                <div className="text-xs font-medium text-slate-400">
                  2. Costo Insumos (Recetas)
                </div>
                <div className="font-mono text-2xl font-bold text-amber-300">
                  -{formatCLP(financialMetrics.salesCogs)}
                </div>
                <p className="text-[11px] text-slate-400 pt-2 border-t border-slate-800/80">
                  Costo directo de pollos, papas, bebidas, envases, bolsas y gas consumidos en las{' '}
                  {state.sales.length} ventas.
                </p>
              </div>

              {/* Card 3: Costo de Mermas y Gastos de Caja Chica */}
              <div className="p-4 rounded-2xl bg-[#0F172A] border border-slate-800 space-y-2">
                <div className="text-xs font-medium text-slate-400">
                  3. Mermas y Caja Chica
                </div>
                <div className="font-mono text-2xl font-bold text-rose-400">
                  -{formatCLP(financialMetrics.wasteCost + financialMetrics.pettyCashTotal)}
                </div>
                <div className="pt-2 border-t border-slate-800/80 text-[11px] font-mono text-slate-300 space-y-1">
                  <div className="flex justify-between">
                    <span>Costo Mermas ({state.wasteRecords.length}):</span>
                    <span className="text-rose-400">-{formatCLP(financialMetrics.wasteCost)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Caja Chica ({state.pettyCashExpenses.length}):</span>
                    <span className="text-rose-300">
                      -{formatCLP(financialMetrics.pettyCashTotal)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Card 4: Utilidad Neta Real ($) */}
              <div className="p-4 rounded-2xl bg-[#0F172A] border border-emerald-500/40 space-y-2">
                <div className="text-xs font-semibold text-emerald-300">
                  4. Utilidad Neta Real ($)
                </div>
                <div
                  className={`font-mono text-2xl font-bold ${
                    financialMetrics.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {formatCLP(financialMetrics.netProfit)}
                </div>
                <p className="text-[11px] text-slate-400 pt-2 border-t border-slate-800/80">
                  Ingresos - Costo Insumos - Mermas - Gastos Caja Chica.
                </p>
              </div>

              {/* Card 5: Margen Real (%) & Cuadratura Efectivo */}
              <div className="p-4 rounded-2xl bg-[#0F172A] border border-amber-500/40 space-y-2">
                <div className="text-xs font-semibold text-amber-300">
                  5. Margen Real Operativo
                </div>
                <div className="font-mono text-2xl font-bold text-amber-400">
                  {financialMetrics.realMarginPct}%
                </div>
                <div className="pt-2 border-t border-slate-800/80 text-[11px] font-mono text-slate-300">
                  <div className="flex justify-between">
                    <span>Efectivo en Caja:</span>
                    <strong className="text-white">
                      {formatCLP(financialMetrics.expectedCashInDrawer)}
                    </strong>
                  </div>
                </div>
              </div>
            </div>

            {/* EXCEL GENERATION & EMAIL / WEBHOOK CLOSING PANEL */}
            <div className="rounded-2xl bg-[#0F172A] border border-amber-500/40 p-5 sm:p-6 space-y-5">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="space-y-1">
                  <h2 className="font-display text-lg sm:text-xl font-bold text-white flex items-center gap-2">
                    <FileSpreadsheet className="w-6 h-6 text-amber-400" />
                    Cierre de Día y Envío de Excel Diario (Reporte_Ventas_{state.businessDate}.xlsx)
                  </h2>
                  <p className="text-xs text-slate-300">
                    Genera el archivo <code className="font-mono text-amber-300">.xlsx</code> con las 3 hojas exactas (
                    <strong>Hoja 1: Pedidos</strong> · <strong>Hoja 2: Ventas + Cuadratura</strong> ·{' '}
                    <strong>Hoja 3: Insumos Valorizados</strong>), lo descarga en tu dispositivo y abre el envío hacia{' '}
                    <strong className="font-mono text-white">fama169rp@gmail.com</strong>.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleCloseDayAndSendExcel}
                  disabled={isClosingBusy}
                  className="min-h-[54px] px-6 py-3 rounded-2xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-display font-bold text-sm sm:text-base flex items-center justify-center gap-2.5 shadow-lg shadow-amber-950/50 transition-transform active:scale-[0.99] whitespace-nowrap shrink-0"
                >
                  <Send className="w-5 h-5" />
                  {isClosingBusy
                    ? 'Generando Excel...'
                    : 'Cerrar Día y Enviar Excel a fama169rp@gmail.com'}
                </button>
              </div>

              {/* Interactive Closing Result & Multi-Channel Delivery Actions */}
              {closingStatus && (
                <div className="p-4 rounded-xl bg-[#090D16] border border-emerald-500/40 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-emerald-400 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4" />
                      Archivo generado y descargado: <span className="font-mono">{closingStatus.fileName}</span> ({closingStatus.timestamp} hrs)
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleShareExcelOnly}
                        className="min-h-[38px] px-3 py-1.5 rounded-lg bg-amber-400/20 border border-amber-400/40 text-amber-300 text-xs font-semibold flex items-center gap-1.5"
                      >
                        <Smartphone className="w-3.5 h-3.5" />
                        Compartir Archivo (iOS / Android)
                      </button>
                      <a
                        href={mailtoHref}
                        className="min-h-[38px] px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-950 text-xs font-bold flex items-center gap-1.5"
                      >
                        <Mail className="w-3.5 h-3.5" />
                        Abrir Correo a fama169rp@gmail.com
                      </a>
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono space-y-1">
                    <div>• Estado Share Nativo: {closingStatus.shareResult}</div>
                    <div>• Estado Webhook POST: {closingStatus.webhookResult}</div>
                  </div>
                </div>
              )}

              {/* Webhook Configuration for Background Email Automation */}
              <div className="pt-4 border-t border-slate-800 grid grid-cols-1 lg:grid-cols-12 gap-4 items-end">
                <div className="lg:col-span-5">
                  <label htmlFor="fin-email" className="block text-xs font-medium text-slate-300 mb-1">
                    Correo Destinatario Oficial
                  </label>
                  <input
                    id="fin-email"
                    type="email"
                    value={state.recipientEmail}
                    onChange={(e) =>
                      setState((prev) => ({ ...prev, recipientEmail: e.target.value }))
                    }
                    className="w-full min-h-[44px] px-3 rounded-xl bg-[#090D16] border border-slate-700 font-mono text-xs text-white"
                  />
                </div>
                <div className="lg:col-span-5">
                  <div className="flex items-center justify-between mb-1">
                    <label htmlFor="fin-webhook" className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                      <Webhook className="w-3.5 h-3.5 text-amber-400" />
                      URL de Webhook (Google Apps Script / Make para envío automático)
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowAppsScriptModal(true)}
                      className="text-[11px] text-amber-400 hover:underline"
                    >
                      Ver script Google gratis
                    </button>
                  </div>
                  <input
                    id="fin-webhook"
                    type="url"
                    placeholder="https://script.google.com/macros/s/.../exec"
                    value={state.webhookUrl}
                    onChange={(e) =>
                      setState((prev) => ({ ...prev, webhookUrl: e.target.value }))
                    }
                    className="w-full min-h-[44px] px-3 rounded-xl bg-[#090D16] border border-slate-700 font-mono text-xs text-white"
                  />
                </div>
                <div className="lg:col-span-2">
                  <a
                    href={mailtoHref}
                    className="w-full min-h-[44px] px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 flex items-center justify-center gap-1.5"
                  >
                    <Mail className="w-4 h-4 text-amber-400" />
                    Enviar Resumen
                  </a>
                </div>
              </div>
            </div>

            {/* Detailed Sales Table (Preview of Sheet 2 "Ventas") */}
            <div className="rounded-2xl bg-[#0F172A] border border-slate-800 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
                <div>
                  <h2 className="font-display text-base font-bold text-white">
                    Hoja &quot;Ventas&quot; del Día ({state.sales.length} transacciones)
                  </h2>
                  <p className="text-xs text-slate-400">
                    Detalle auditable de cada venta con su costo de receta, utilidad y margen real
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-[#090D16]/70 text-[11px] font-semibold text-slate-400">
                      <th className="py-3 px-4">ID / Hora</th>
                      <th className="py-3 px-3">Origen</th>
                      <th className="py-3 px-4">Detalle Productos</th>
                      <th className="py-3 px-3 text-right">Costo Insumos</th>
                      <th className="py-3 px-3 text-right">Precio Venta</th>
                      <th className="py-3 px-3 text-right">Utilidad</th>
                      <th className="py-3 px-3 text-right">Margen</th>
                      <th className="py-3 px-4">Medio de Pago</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 text-xs font-mono">
                    {state.sales.map((sale) => (
                      <tr key={sale.id} className="hover:bg-slate-800/40">
                        <td className="py-3 px-4 text-white">
                          <span className="font-bold">{sale.id}</span> · {sale.time}
                        </td>
                        <td className="py-3 px-3 font-sans text-slate-300">
                          {sale.origin}
                          {sale.customerName ? ` (${sale.customerName})` : ''}
                        </td>
                        <td className="py-3 px-4 font-sans text-slate-200 max-w-md">
                          {sale.itemsSummary}
                        </td>
                        <td className="py-3 px-3 text-right text-slate-400">
                          {formatCLP(sale.totalCost)}
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-white">
                          {formatCLP(sale.totalPrice)}
                        </td>
                        <td className="py-3 px-3 text-right font-semibold text-emerald-400">
                          +{formatCLP(sale.profit)}
                        </td>
                        <td className="py-3 px-3 text-right text-amber-300">{sale.marginPct}%</td>
                        <td className="py-3 px-4 font-sans text-slate-300">
                          {sale.paymentMethod}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
        </>
      )}
      </main>

      {/* =====================================================================
          FIXED BOTTOM TAB BAR (Mobile 5-Module Navigation)
         ===================================================================== */}
      {duoRole === 'cliente' ? (
        <nav
          aria-label="Navegación Pantalla Cliente"
          className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#090D16]/95 backdrop-blur-md border-t border-slate-800 flex items-center justify-between h-16 px-4"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-400/20 text-amber-400 flex items-center justify-center">
              <Tv className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-bold text-white block">iPhone Visor Cliente</span>
              <span className="text-[10px] text-slate-400 font-mono">Mostrador Beto Pollos</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowDuoModal(true)}
            className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700"
          >
            Cambiar Rol
          </button>
        </nav>
      ) : duoRole === 'cocina' ? (
        <nav
          aria-label="Navegación Cocina KDS"
          className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#090D16]/95 backdrop-blur-md border-t border-slate-800 grid grid-cols-4 items-center h-16 px-1"
        >
          <button
            type="button"
            onClick={() => setActiveTab('cocina')}
            className={`min-h-[48px] flex flex-col items-center justify-center rounded-xl transition-colors ${
              activeTab === 'cocina' ? 'text-amber-400' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Flame className="w-5 h-5" />
            <span className="text-[10px] font-medium mt-1 whitespace-nowrap">
              Horno ({formatQty(availableChickensForImmediateSale)})
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('pedidos')}
            className={`min-h-[48px] flex flex-col items-center justify-center rounded-xl transition-colors ${
              activeTab === 'pedidos' ? 'text-amber-400' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Clock className="w-5 h-5" />
            <span className="text-[10px] font-medium mt-1 whitespace-nowrap">
              Pedidos ({state.orders.filter((o) => o.deliveryStatus === 'Pendiente').length})
            </span>
          </button>
          <button
            type="button"
            onClick={handlePingCaja}
            className="min-h-[48px] flex flex-col items-center justify-center rounded-xl text-emerald-400 hover:text-emerald-300 active:scale-95 transition-transform"
            title="Avisar a Caja que hay tanda de pollos lista"
          >
            <Bell className="w-5 h-5 animate-bounce" />
            <span className="text-[10px] font-bold mt-1 whitespace-nowrap">Avisar Caja</span>
          </button>
          <button
            type="button"
            onClick={() => setShowDuoModal(true)}
            className="min-h-[48px] flex flex-col items-center justify-center rounded-xl text-amber-400 hover:text-amber-300"
          >
            <Radio className="w-5 h-5" />
            <span className="text-[10px] font-medium mt-1 whitespace-nowrap">iPhone Dúo</span>
          </button>
        </nav>
      ) : duoRole === 'caja' ? (
        <nav
          aria-label="Navegación Caja POS"
          className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#090D16]/95 backdrop-blur-md border-t border-slate-800 grid grid-cols-5 items-center h-16 px-1"
        >
          <button
            type="button"
            onClick={() => setActiveTab('pos')}
            className={`min-h-[48px] flex flex-col items-center justify-center rounded-xl transition-colors ${
              activeTab === 'pos' ? 'text-amber-400' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShoppingBag className="w-5 h-5" />
            <span className="text-[10px] font-medium mt-1 whitespace-nowrap">POS Caja</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('pedidos')}
            className={`min-h-[48px] flex flex-col items-center justify-center rounded-xl transition-colors ${
              activeTab === 'pedidos' ? 'text-amber-400' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Clock className="w-5 h-5" />
            <span className="text-[10px] font-medium mt-1 whitespace-nowrap">
              Pedidos ({state.orders.filter((o) => o.deliveryStatus === 'Pendiente').length})
            </span>
          </button>
          <button
            type="button"
            onClick={handlePingCocina}
            className="min-h-[48px] flex flex-col items-center justify-center rounded-xl text-orange-400 hover:text-orange-300 active:scale-95 transition-transform"
            title="Pedir pollos al horno urgentemente"
          >
            <Bell className="w-5 h-5 animate-pulse" />
            <span className="text-[10px] font-bold mt-1 whitespace-nowrap">Pedir Horno</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('finanzas')}
            className={`min-h-[48px] flex flex-col items-center justify-center rounded-xl transition-colors ${
              activeTab === 'finanzas' ? 'text-amber-400' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BarChart3 className="w-5 h-5" />
            <span className="text-[10px] font-medium mt-1 whitespace-nowrap">Finanzas</span>
          </button>
          <button
            type="button"
            onClick={() => setShowDuoModal(true)}
            className="min-h-[48px] flex flex-col items-center justify-center rounded-xl text-amber-400 hover:text-amber-300"
          >
            <Radio className="w-5 h-5" />
            <span className="text-[10px] font-medium mt-1 whitespace-nowrap">iPhone Dúo</span>
          </button>
        </nav>
      ) : (
        <nav
          aria-label="Navegación Principal"
          className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#090D16]/95 backdrop-blur-md border-t border-slate-800 grid grid-cols-5 items-center h-16 px-1"
        >
          {(
            [
              { id: 'pos', label: 'POS Caja', icon: ShoppingBag },
              {
                id: 'cocina',
                label: `Cocina (${formatQty(availableChickensForImmediateSale)})`,
                icon: Flame,
              },
              {
                id: 'pedidos',
                label: `Pedidos (${state.orders.filter((o) => o.deliveryStatus === 'Pendiente').length})`,
                icon: Clock,
              },
              { id: 'inventario', label: 'Inventario', icon: Archive },
              { id: 'finanzas', label: 'Finanzas', icon: BarChart3 },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`min-h-[48px] flex flex-col items-center justify-center rounded-xl transition-colors ${
                  isActive ? 'text-amber-400' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium tracking-tight mt-1 whitespace-nowrap truncate max-w-[68px]">
                  {tab.label}
                </span>
              </button>
            );
          })}
        </nav>
      )}

      {/* =====================================================================
          MODALS & ACTION SHEETS
         ===================================================================== */}

      {/* 1. Modal: Gasto de Caja Chica */}
      {showPettyCashModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-2xl bg-[#0F172A] border border-slate-800 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-white flex items-center gap-2">
                <Wallet className="w-5 h-5 text-amber-400" />
                Gasto de Caja Chica
              </h3>
              <button
                type="button"
                onClick={() => setShowPettyCashModal(false)}
                className="p-2 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddPettyCash} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Monto retirado de Caja ($ CLP) *
                </label>
                <input
                  type="number"
                  required
                  placeholder="Ej. 4500"
                  value={pettyAmount}
                  onChange={(e) => setPettyAmount(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl bg-[#090D16] border border-slate-700 font-mono text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Motivo / Detalle del Gasto *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Compra de hielo, pan, bolsas extra..."
                  value={pettyReason}
                  onChange={(e) => setPettyReason(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl bg-[#090D16] border border-slate-700 text-sm text-white"
                />
              </div>
              <button
                type="submit"
                className="w-full min-h-[48px] rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-display font-bold text-sm"
              >
                Registrar Salida de Caja
              </button>
            </form>

            {state.pettyCashExpenses.length > 0 && (
              <div className="pt-3 border-t border-slate-800 space-y-2 max-h-44 overflow-y-auto">
                <div className="text-xs font-semibold text-slate-400">
                  Gastos registrados hoy ({formatCLP(financialMetrics.pettyCashTotal)}):
                </div>
                {state.pettyCashExpenses.map((exp) => (
                  <div
                    key={exp.id}
                    className="flex items-center justify-between text-xs py-1.5 border-b border-slate-800/60"
                  >
                    <span className="text-slate-300">
                      <strong className="font-mono text-slate-400">{exp.time}</strong> · {exp.reason}
                    </span>
                    <span className="font-mono font-semibold text-rose-400">
                      -{formatCLP(exp.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. Modal: Cobrar y Entregar Pedido Pendiente de Pago */}
      {deliveringOrder && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-2xl bg-[#0F172A] border border-slate-800 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-white">
                Cobrar y Entregar {deliveringOrder.id}
              </h3>
              <button
                type="button"
                onClick={() => setDeliveringOrder(null)}
                className="p-2 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-[#090D16] border border-slate-800 space-y-1">
              <div className="text-xs text-slate-400">Cliente: {deliveringOrder.customerName}</div>
              <div className="text-xs text-slate-300">
                {deliveringOrder.items.map((i) => `${i.quantity}x ${i.name}`).join(' + ')}
              </div>
              <div className="pt-2 flex items-baseline justify-between">
                <span className="text-xs font-semibold text-slate-400">Total a Cobrar:</span>
                <span className="font-mono text-2xl font-bold text-amber-400">
                  {formatCLP(deliveringOrder.totalPrice)}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-300">
                Selecciona el Medio de Pago con que retira:
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['Efectivo', 'Tarjeta (Débito/Crédito)', 'Transferencia'] as const).map((pm) => (
                  <button
                    key={pm}
                    type="button"
                    onClick={() => setDeliveryPaymentMethod(pm)}
                    className={`min-h-[44px] px-2 rounded-xl text-xs font-semibold border ${
                      deliveryPaymentMethod === pm
                        ? 'bg-amber-400 text-slate-950 border-amber-400'
                        : 'bg-[#090D16] text-slate-300 border-slate-800'
                    }`}
                  >
                    {pm === 'Tarjeta (Débito/Crédito)' ? 'Tarjeta' : pm}
                  </button>
                ))}
              </div>
            </div>

            {deliveryPaymentMethod === 'Efectivo' && (
              <div className="p-3 rounded-xl bg-[#090D16] border border-slate-800 flex items-center justify-between">
                <input
                  type="number"
                  placeholder="Monto efectivo recibido"
                  value={deliveryCashReceived}
                  onChange={(e) => setDeliveryCashReceived(e.target.value)}
                  className="w-40 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 font-mono text-xs text-white"
                />
                <span className="text-xs font-mono text-emerald-400">
                  Vuelto:{' '}
                  {formatCLP(
                    Math.max(0, (Number(deliveryCashReceived) || 0) - deliveringOrder.totalPrice)
                  )}
                </span>
              </div>
            )}

            <button
              type="button"
              onClick={() => finalizeOrderDelivery(deliveringOrder, deliveryPaymentMethod)}
              className="w-full min-h-[50px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-display font-bold text-sm flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-5 h-5" />
              Confirmar Pago y Registrar en Ventas
            </button>
          </div>
        </div>
      )}

      {/* 3. Modal: Ingresar Compra / Actualizar Costo Unitario */}
      {showPurchaseModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form
            onSubmit={handleConfirmPurchase}
            className="w-full max-w-md rounded-t-3xl sm:rounded-2xl bg-[#0F172A] border border-slate-800 p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-white flex items-center gap-2">
                <PackagePlus className="w-5 h-5 text-emerald-400" />
                Ingresar Compra / Stock
              </h3>
              <button
                type="button"
                onClick={() => setShowPurchaseModal(false)}
                className="p-2 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Seleccionar Insumo
              </label>
              <select
                value={purchaseSupplyId}
                onChange={(e) => {
                  const id = e.target.value;
                  setPurchaseSupplyId(id);
                  const found = state.supplies.find((s) => s.id === id);
                  if (found) setPurchaseUnitCost(String(found.unitCost));
                }}
                className="w-full min-h-[44px] px-3 rounded-xl bg-[#090D16] border border-slate-700 text-sm text-white"
              >
                {state.supplies.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.unit}) — Actual: {formatCLP(s.unitCost)}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Cantidad Comprada (+) *
                </label>
                <input
                  type="number"
                  step="0.1"
                  required
                  placeholder="Ej. 20"
                  value={purchaseQty}
                  onChange={(e) => setPurchaseQty(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl bg-[#090D16] border border-slate-700 font-mono text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Costo Unitario Compra ($) *
                </label>
                <input
                  type="number"
                  required
                  placeholder="Ej. 4200"
                  value={purchaseUnitCost}
                  onChange={(e) => setPurchaseUnitCost(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl bg-[#090D16] border border-slate-700 font-mono text-sm text-amber-400"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full min-h-[48px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-display font-bold text-sm"
            >
              Sumar Stock y Actualizar Costo
            </button>
          </form>
        </div>
      )}

      {/* 4. Modal: Registrar Merma */}
      {showWasteModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form
            onSubmit={handleConfirmWaste}
            className="w-full max-w-md rounded-t-3xl sm:rounded-2xl bg-[#0F172A] border border-slate-800 p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-white flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-rose-400" />
                Registrar Merma / Pérdida
              </h3>
              <button
                type="button"
                onClick={() => setShowWasteModal(false)}
                className="p-2 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Insumo Dañado / Quemado / Merma
              </label>
              <select
                value={wasteSupplyId}
                onChange={(e) => setWasteSupplyId(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-xl bg-[#090D16] border border-slate-700 text-sm text-white"
              >
                {state.supplies.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.unit}) — Costo: {formatCLP(s.unitCost)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Cantidad a Descontar (-) *
              </label>
              <input
                type="number"
                step="0.1"
                required
                value={wasteQty}
                onChange={(e) => setWasteQty(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-xl bg-[#090D16] border border-slate-700 font-mono text-sm text-white"
              />
            </div>

            {state.supplies.find((s) => s.id === wasteSupplyId)?.isRawChicken && (
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={wasteFromShowcase}
                  onChange={(e) => setWasteFromShowcase(e.target.checked)}
                  className="w-4 h-4 accent-amber-400 rounded"
                />
                <span>Descontar también de &quot;Total Cocidos Física&quot; en Vitrina</span>
              </label>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Motivo de la Merma *
              </label>
              <input
                type="text"
                required
                value={wasteReason}
                onChange={(e) => setWasteReason(e.target.value)}
                placeholder="Ej. Quemado en horno, caída, envase roto..."
                className="w-full min-h-[44px] px-3 rounded-xl bg-[#090D16] border border-slate-700 text-sm text-white"
              />
            </div>

            <button
              type="submit"
              className="w-full min-h-[48px] rounded-xl bg-rose-500 hover:bg-rose-400 text-slate-950 font-display font-bold text-sm"
            >
              Confirmar Merma
            </button>
          </form>
        </div>
      )}

      {/* 5. Modal: Editor de Producto / Receta */}
      {editingProduct && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form
            onSubmit={handleSaveEditedProduct}
            className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl bg-[#0F172A] border border-slate-800 p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-white">
                Configurar Producto y Receta
              </h3>
              <button
                type="button"
                onClick={() => setEditingProduct(null)}
                className="p-2 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Nombre del Producto / Combo
                </label>
                <input
                  type="text"
                  required
                  value={editingProduct.name}
                  onChange={(e) =>
                    setEditingProduct({ ...editingProduct, name: e.target.value })
                  }
                  className="w-full min-h-[42px] px-3 rounded-xl bg-[#090D16] border border-slate-700 text-sm text-white"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-slate-300">
                    Precio de Venta ($ CLP)
                  </label>
                  {!isPriceUnlocked ? (
                    <button
                      type="button"
                      onClick={() => {
                        setPasswordInput('');
                        setPasswordError('');
                        setShowPasswordModal(true);
                      }}
                      className="text-[11px] font-semibold text-amber-400 hover:underline flex items-center gap-1"
                    >
                      <Lock className="w-3 h-3" />
                      Desbloquear con clave
                    </button>
                  ) : (
                    <span className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1">
                      <Unlock className="w-3 h-3" />
                      Autorizado
                    </span>
                  )}
                </div>
                <div className="relative">
                  <input
                    type="number"
                    required
                    readOnly={!isPriceUnlocked}
                    value={editingProduct.price}
                    onChange={(e) =>
                      setEditingProduct({
                        ...editingProduct,
                        price: Math.round(Number(e.target.value) || 0),
                      })
                    }
                    onClick={() => {
                      if (!isPriceUnlocked) {
                        setPasswordInput('');
                        setPasswordError('');
                        setShowPasswordModal(true);
                      }
                    }}
                    className={`w-full min-h-[42px] px-3 rounded-xl border font-mono text-sm ${
                      isPriceUnlocked
                        ? 'bg-[#090D16] border-slate-700 text-amber-400 focus:border-amber-400 focus:outline-none'
                        : 'bg-slate-900/80 border-slate-800 text-slate-400 cursor-pointer'
                    }`}
                  />
                  {!isPriceUnlocked && (
                    <div
                      onClick={() => {
                        setPasswordInput('');
                        setPasswordError('');
                        setShowPasswordModal(true);
                      }}
                      className="absolute inset-y-0 right-3 flex items-center cursor-pointer text-amber-400 text-xs gap-1"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span className="text-[10px] font-semibold">Clave Betopollos</span>
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Pollos Cocidos que Descuenta de Vitrina
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  value={editingProduct.cookedChickenUnits}
                  onChange={(e) =>
                    setEditingProduct({
                      ...editingProduct,
                      cookedChickenUnits: Number(e.target.value) || 0,
                    })
                  }
                  className="w-full min-h-[42px] px-3 rounded-xl bg-[#090D16] border border-slate-700 font-mono text-sm text-white"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-300">
                Cantidades de Insumos por cada 1 venta (Receta Interna):
              </div>
              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {state.supplies.map((sup) => {
                  const found = editingProduct.recipe.find((r) => r.supplyId === sup.id);
                  const qty = found ? found.quantity : 0;
                  return (
                    <div
                      key={sup.id}
                      className="flex items-center justify-between gap-2 p-2 rounded-xl bg-[#090D16] border border-slate-800 text-xs"
                    >
                      <span className="text-slate-200 truncate">
                        {sup.name} ({sup.unit} · {formatCLP(sup.unitCost)})
                      </span>
                      <input
                        type="number"
                        step="0.05"
                        min="0"
                        value={qty}
                        onChange={(e) => {
                          const val = Number(e.target.value) || 0;
                          const others: RecipeIngredient[] = editingProduct.recipe.filter(
                            (r) => r.supplyId !== sup.id
                          );
                          if (val > 0) {
                            others.push({ supplyId: sup.id, quantity: val });
                          }
                          setEditingProduct({ ...editingProduct, recipe: others });
                        }}
                        className="w-24 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-right font-mono text-white"
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[#090D16] border border-slate-800 flex items-center justify-between font-mono text-xs">
              <span>Costo Receta Calculado:</span>
              <strong className="text-emerald-400 text-sm">
                {formatCLP(calculateProductRecipeCost(editingProduct, state.supplies))}
              </strong>
            </div>

            <button
              type="submit"
              className="w-full min-h-[48px] rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-display font-bold text-sm"
            >
              Guardar Receta y Costo
            </button>
          </form>
        </div>
      )}

      {/* 6. Modal: Nuevo Insumo */}
      {showNewSupplyModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form
            onSubmit={handleCreateSupply}
            className="w-full max-w-md rounded-t-3xl sm:rounded-2xl bg-[#0F172A] border border-slate-800 p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-white">Agregar Nuevo Insumo</h3>
              <button
                type="button"
                onClick={() => setShowNewSupplyModal(false)}
                className="p-2 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Nombre del Insumo *
              </label>
              <input
                type="text"
                required
                placeholder="Ej. Pebre cuchareado (Lts)"
                value={newSupplyName}
                onChange={(e) => setNewSupplyName(e.target.value)}
                className="w-full min-h-[42px] px-3 rounded-xl bg-[#090D16] border border-slate-700 text-sm text-white"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Unidad</label>
                <select
                  value={newSupplyUnit}
                  onChange={(e) =>
                    setNewSupplyUnit(e.target.value as 'Unid' | 'Kg' | 'Lts' | 'Lote')
                  }
                  className="w-full min-h-[42px] px-2 rounded-xl bg-[#090D16] border border-slate-700 text-xs text-white"
                >
                  <option value="Unid">Unid</option>
                  <option value="Kg">Kg</option>
                  <option value="Lts">Lts</option>
                  <option value="Lote">Lote</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Costo Unit ($)
                </label>
                <input
                  type="number"
                  required
                  placeholder="1500"
                  value={newSupplyCost}
                  onChange={(e) => setNewSupplyCost(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-xl bg-[#090D16] border border-slate-700 font-mono text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Stock Inicial
                </label>
                <input
                  type="number"
                  step="0.1"
                  placeholder="20"
                  value={newSupplyInitial}
                  onChange={(e) => setNewSupplyInitial(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-xl bg-[#090D16] border border-slate-700 font-mono text-xs text-white"
                />
              </div>
            </div>
            <button
              type="submit"
              className="w-full min-h-[48px] rounded-xl bg-amber-400 text-slate-950 font-display font-bold text-sm"
            >
              Crear Insumo
            </button>
          </form>
        </div>
      )}

      {/* 7. Modal: Iniciar Nuevo Día (Traspaso de Stocks Finales a Iniciales) */}
      {showNewDayModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-[#0F172A] border border-slate-800 p-5 space-y-4">
            <h3 className="font-display text-lg font-bold text-white">
              ¿Iniciar Nuevo Día Operativo?
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              Esta acción tomará el <strong>Stock Final Restante</strong> de todos tus insumos y lo guardará como el nuevo{' '}
              <strong>Stock Inicial</strong> del día siguiente, limpiando las ventas cerradas, mermas y gastos de caja chica del turno anterior.
            </p>
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowNewDayModal(false)}
                className="flex-1 min-h-[44px] rounded-xl bg-slate-800 text-xs font-semibold text-slate-300"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleStartNewDay}
                className="flex-1 min-h-[44px] rounded-xl bg-emerald-500 text-slate-950 text-xs font-bold"
              >
                Sí, Iniciar Nuevo Día
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. Modal: Google Apps Script Webhook Helper */}
      {showAppsScriptModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-[#0F172A] border border-slate-800 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-white">
                Automatización de Correo vía Google Apps Script
              </h3>
              <button
                type="button"
                onClick={() => setShowAppsScriptModal(false)}
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-300">
              Pega este código en <code className="text-amber-300">script.google.com</code>, publícalo como Aplicación Web (Acceso: Cualquier persona) y pega la URL en el campo Webhook para enviar el archivo Excel automáticamente en segundo plano a{' '}
              <strong>fama169rp@gmail.com</strong>:
            </p>
            <pre className="p-3 rounded-xl bg-[#090D16] border border-slate-800 font-mono text-[11px] text-emerald-300 overflow-x-auto">
{`function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var blob = Utilities.newBlob(
    Utilities.base64Decode(data.excelBase64),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    data.fileName
  );
  MailApp.sendEmail({
    to: data.recipientEmail || "fama169rp@gmail.com",
    subject: data.subject,
    body: "Cierre automático adjunto. Utilidad Neta: $" + data.metrics.netProfit,
    attachments: [blob]
  });
  return ContentService.createTextOutput(JSON.stringify({ ok: true }));
}`}
            </pre>
            <button
              type="button"
              onClick={() => setShowAppsScriptModal(false)}
              className="w-full min-h-[42px] rounded-xl bg-slate-800 text-xs font-semibold text-white"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* 9. Modal: iOS Install Guide */}
      {showIOSModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl bg-[#0F172A] border border-slate-800 p-5 space-y-4">
            <h3 className="font-display text-lg font-bold text-white">
              Instalar App en iPhone / iPad
            </h3>
            <ol className="text-xs text-slate-300 space-y-2 list-decimal list-inside">
              <li>
                Toca el botón <strong>Compartir</strong> en la barra inferior de Safari.
              </li>
              <li>
                Desliza hacia abajo y selecciona <strong>Agregar a Inicio</strong>.
              </li>
              <li>
                Abre <strong>Beto Pollos</strong> desde tu pantalla de inicio a pantalla completa.
              </li>
            </ol>
            <button
              type="button"
              onClick={() => setShowIOSModal(false)}
              className="w-full min-h-[44px] rounded-xl bg-amber-400 text-slate-950 font-bold text-xs"
            >
              Entendido
            </button>
          </div>
        </div>
      )}

      {/* 10. Modal: Clave de Administrador para Modificar Menú (Nombres y Precios) */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl bg-[#0F172A] border border-slate-800 p-5 space-y-4 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-400/20 text-amber-400 flex items-center justify-center">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-display text-base font-bold text-white">
                    Clave de Seguridad
                  </h3>
                  <p className="text-[11px] text-amber-300 font-medium">
                    Modificar Menú y Nombres
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowPasswordModal(false);
                  setPasswordError('');
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Los nombres y precios de los combos, pollos y acompañamientos están protegidos. Ingresa la clave de administrador para autorizar cambios:
            </p>

            <form onSubmit={handleVerifyPassword} className="space-y-3">
              <div>
                <label
                  htmlFor="security-password-input"
                  className="block text-xs font-semibold text-slate-300 mb-1"
                >
                  Clave de Administrador *
                </label>
                <div className="relative">
                  <input
                    id="security-password-input"
                    type={showPasswordText ? 'text' : 'password'}
                    required
                    autoFocus
                    placeholder="Ingresa la clave (Betopollos)"
                    value={passwordInput}
                    onChange={(e) => {
                      setPasswordInput(e.target.value);
                      if (passwordError) setPasswordError('');
                    }}
                    className="w-full min-h-[44px] pl-3 pr-10 rounded-xl bg-[#090D16] border border-slate-700 text-sm font-mono text-white focus:outline-none focus:border-amber-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswordText(!showPasswordText)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-200"
                    tabIndex={-1}
                  >
                    {showPasswordText ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
                {passwordError && (
                  <p className="text-xs text-rose-400 mt-1.5 flex items-center gap-1 font-medium">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    {passwordError}
                  </p>
                )}
                <div className="flex items-center justify-between mt-1 text-[11px] text-slate-400">
                  <span>Clave: <strong>Betopollos</strong></span>
                  <button
                    type="button"
                    onClick={() => setPasswordInput('Betopollos')}
                    className="text-amber-400 hover:underline font-mono text-[10px]"
                  >
                    Rellenar clave
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowPasswordModal(false);
                    setPasswordError('');
                  }}
                  className="flex-1 min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 min-h-[44px] rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-display font-bold text-xs flex items-center justify-center gap-1.5"
                >
                  <KeyRound className="w-4 h-4" />
                  Autorizar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 11. Modal: Gestor de Menú, Precios e Insumos (Guardado Conjunto) */}
      {showPriceManagerModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-4xl max-h-[94vh] flex flex-col rounded-t-3xl sm:rounded-2xl bg-[#0F172A] border border-slate-800 shadow-2xl overflow-hidden animate-in fade-in duration-200">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between gap-3 bg-[#090D16]">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center font-bold shadow-md shadow-amber-400/20 shrink-0">
                  <UtensilsCrossed className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-display text-base sm:text-lg font-bold text-white truncate flex items-center gap-2">
                    Gestor de Precios, Menú e Insumos
                    {pendingChangesCount > 0 && (
                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 animate-pulse">
                        {pendingChangesCount} cambio(s) por guardar
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-400 truncate flex items-center gap-1.5">
                    <span className="text-emerald-400 flex items-center gap-1 font-mono">
                      <Unlock className="w-3 h-3" />
                      Clave autorizada (Betopollos)
                    </span>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <span>Modifica nombres, precios y costos de insumos juntos</span>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleLockPricesAgain}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 font-medium flex items-center gap-1"
                  title="Bloquear edición de nombres y precios"
                >
                  <Lock className="w-3.5 h-3.5 text-amber-400" />
                  <span className="hidden sm:inline">Bloquear</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowPriceManagerModal(false);
                    setTargetProductForPriceEdit(null);
                    setShowNewProductForm(false);
                  }}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white"
                  title="Cerrar ventana"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Quick Top Batch Save Action Bar */}
            <div className="px-4 py-2.5 bg-amber-400/10 border-b border-amber-400/20 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-slate-300 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                <span>
                  {pendingChangesCount > 0 ? (
                    <>
                      Tienes <strong className="text-amber-300 font-mono">{pendingChangesCount}</strong> modificación(es) sin aplicar al sistema.
                    </>
                  ) : (
                    'Edita cualquier valor abajo y pulsa el botón para guardar todo junto.'
                  )}
                </span>
                {pendingChangesCount > 0 && (
                  <button
                    type="button"
                    onClick={syncDraftsFromState}
                    className="text-[11px] text-slate-400 hover:text-rose-400 underline font-mono ml-2"
                  >
                    Deshacer cambios
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={handleSaveAllPricesAndSupplies}
                className="min-h-[38px] px-4 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 active:scale-95 text-slate-950 font-bold text-xs flex items-center gap-2 shadow-md shadow-amber-400/25 transition-all"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Guardar Cambios de Precios e Insumos</span>
              </button>
            </div>

            {/* Scrollable Content Area */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
              {/* Category Filter Tabs */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-[#090D16] border border-slate-800 text-xs font-semibold">
                  {(
                    [
                      { id: 'Todos', label: 'Todos', emoji: '📋' },
                      { id: 'Combos', label: 'Combos', emoji: '🍱' },
                      { id: 'Pollos', label: 'Pollos', emoji: '🍗' },
                      { id: 'Acompañamientos', label: 'Acompañamientos', emoji: '🍟' },
                      { id: 'Insumos', label: 'Insumos Base', emoji: '📦' },
                    ] as const
                  ).map((tab) => {
                    const count =
                      tab.id === 'Todos'
                        ? draftProducts.length + draftSupplies.length
                        : tab.id === 'Insumos'
                        ? draftSupplies.length
                        : draftProducts.filter((p) => p.category === tab.id).length;
                    const isActive = menuManagerTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setMenuManagerTab(tab.id)}
                        className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
                          isActive
                            ? 'bg-amber-400 text-slate-950 font-bold shadow-sm'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        <span>{tab.emoji}</span>
                        <span>{tab.label}</span>
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                            isActive
                              ? 'bg-slate-950/20 text-slate-950 font-bold'
                              : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => setShowNewProductForm(!showNewProductForm)}
                  className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors ${
                    showNewProductForm
                      ? 'bg-slate-800 text-slate-300'
                      : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40'
                  }`}
                >
                  <Plus className="w-4 h-4" />
                  <span>{showNewProductForm ? 'Cerrar Formulario' : 'Nuevo Producto / Combo'}</span>
                </button>
              </div>

              {/* Collapsible New Product Form */}
              {showNewProductForm && (
                <form
                  onSubmit={handleCreateNewProduct}
                  className="p-4 rounded-2xl bg-[#090D16] border border-emerald-500/40 space-y-3 animate-in fade-in duration-150"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                      <Plus className="w-4 h-4" />
                      Crear Nuevo Ítem en el Menú
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowNewProductForm(false)}
                      className="text-xs text-slate-400 hover:text-white"
                    >
                      Cancelar
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Categoría *
                      </label>
                      <select
                        value={newProdCategory}
                        onChange={(e) => setNewProdCategory(e.target.value as ProductCategory)}
                        className="w-full min-h-[40px] px-3 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:border-amber-400 focus:outline-none"
                      >
                        <option value="Combos">🍱 Combos</option>
                        <option value="Acompañamientos">🍟 Acompañamientos</option>
                        <option value="Pollos">🍗 Pollos</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Nombre del Producto / Combo *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="Ej: Combo Familiar: 1 Pollo + Papas..."
                        value={newProdName}
                        onChange={(e) => setNewProdName(e.target.value)}
                        className="w-full min-h-[40px] px-3 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:border-amber-400 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Precio de Venta ($ CLP) *
                      </label>
                      <input
                        type="number"
                        required
                        step="100"
                        min="100"
                        placeholder="Ej: 15900"
                        value={newProdPrice}
                        onChange={(e) => setNewProdPrice(e.target.value)}
                        className="w-full min-h-[40px] px-3 rounded-xl bg-slate-900 border border-slate-700 font-mono text-xs font-bold text-amber-400 focus:border-amber-400 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Descripción o detalle para el cliente
                      </label>
                      <input
                        type="text"
                        placeholder="Ej: Incluye 1 pollo asado, papas grandes y bebida 1.5L"
                        value={newProdDesc}
                        onChange={(e) => setNewProdDesc(e.target.value)}
                        className="w-full min-h-[40px] px-3 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:border-amber-400 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Descuenta pollos de vitrina
                      </label>
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        placeholder="0, 0.5, 1, 2"
                        value={newProdChickens}
                        onChange={(e) => setNewProdChickens(e.target.value)}
                        className="w-full min-h-[40px] px-3 rounded-xl bg-slate-900 border border-slate-700 font-mono text-xs text-white focus:border-amber-400 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end pt-1">
                    <button
                      type="submit"
                      className="min-h-[40px] px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5"
                    >
                      <Check className="w-4 h-4" />
                      Guardar Nuevo Producto
                    </button>
                  </div>
                </form>
              )}

              {/* SECTION 1: PRODUCTS LIST (Combos, Pollos, Acompañamientos) */}
              {menuManagerTab !== 'Insumos' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                      <span>🏷️ Catálogo de Venta y Precios</span>
                      <span className="text-[10px] text-slate-500 font-normal">
                        (Edita nombres y precios directamente en las casillas)
                      </span>
                    </h4>
                  </div>

                  {draftProducts
                    .filter((p) => menuManagerTab === 'Todos' || p.category === menuManagerTab)
                    .map((prod) => {
                      const orig = state.products.find((p) => p.id === prod.id);
                      const isModified =
                        orig &&
                        (orig.name !== prod.name ||
                          orig.price !== prod.price ||
                          orig.shortDesc !== prod.shortDesc ||
                          orig.cookedChickenUnits !== prod.cookedChickenUnits);
                      const unitCost = calculateProductRecipeCost(prod, draftSupplies);
                      const isTarget = targetProductForPriceEdit?.id === prod.id;
                      const categoryBadgeColor =
                        prod.category === 'Pollos'
                          ? 'bg-amber-400/20 text-amber-300 border-amber-400/30'
                          : prod.category === 'Combos'
                          ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                          : 'bg-sky-500/20 text-sky-300 border-sky-500/30';

                      return (
                        <div
                          key={prod.id}
                          className={`p-4 rounded-2xl border transition-all space-y-3 ${
                            isModified
                              ? 'bg-amber-400/10 border-amber-400/60 shadow-md'
                              : isTarget
                              ? 'bg-slate-800/80 border-amber-400/50'
                              : 'bg-[#090D16] border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
                            <div className="flex items-center gap-2">
                              <span
                                className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${categoryBadgeColor}`}
                              >
                                {prod.category === 'Pollos'
                                  ? '🍗 Pollos'
                                  : prod.category === 'Combos'
                                  ? '🍱 Combos'
                                  : '🍟 Acompañamiento'}
                              </span>
                              <span className="text-[11px] font-mono text-slate-500">ID: {prod.id}</span>
                              {isModified && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-400 text-slate-950">
                                  Modificado
                                </span>
                              )}
                            </div>
                            <div className="text-xs font-mono text-slate-400 flex items-center gap-2">
                              <span>Costo receta: {formatCLP(unitCost)}</span>
                              <span aria-hidden="true">·</span>
                              <span className="text-emerald-400">
                                Margen:{' '}
                                {prod.price > 0
                                  ? Math.round(((prod.price - unitCost) / prod.price) * 100)
                                  : 0}
                                %
                              </span>
                              {prod.cookedChickenUnits > 0 && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="text-amber-300">
                                    Vitrina: -{formatQty(prod.cookedChickenUnits)}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Editable Inputs Grid */}
                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                            <div className="sm:col-span-5">
                              <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                                Nombre del Producto / Combo
                              </label>
                              <input
                                type="text"
                                value={prod.name}
                                onChange={(e) =>
                                  handleDraftProductChange(prod.id, 'name', e.target.value)
                                }
                                className="w-full min-h-[42px] px-3 rounded-xl bg-slate-900 border border-slate-700 font-semibold text-sm text-white focus:border-amber-400 focus:outline-none"
                                placeholder="Nombre del producto"
                              />
                            </div>

                            <div className="sm:col-span-4">
                              <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                                Descripción / Detalle
                              </label>
                              <input
                                type="text"
                                value={prod.shortDesc}
                                onChange={(e) =>
                                  handleDraftProductChange(prod.id, 'shortDesc', e.target.value)
                                }
                                className="w-full min-h-[42px] px-3 rounded-xl bg-slate-900 border border-slate-700 text-xs text-slate-300 focus:border-amber-400 focus:outline-none"
                                placeholder="Descripción corta"
                              />
                            </div>

                            <div className="sm:col-span-3">
                              <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                                Precio Venta ($ CLP)
                              </label>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-mono text-slate-400">$</span>
                                <input
                                  type="number"
                                  step="100"
                                  min="0"
                                  value={prod.price}
                                  onChange={(e) =>
                                    handleDraftProductChange(prod.id, 'price', e.target.value)
                                  }
                                  className="w-full min-h-[42px] px-2.5 rounded-xl bg-slate-900 border border-slate-700 font-mono text-sm font-bold text-amber-400 text-right focus:border-amber-400 focus:outline-none"
                                />
                              </div>
                            </div>
                          </div>

                          {/* Footer per product row */}
                          <div className="flex items-center justify-between pt-1">
                            <button
                              type="button"
                              onClick={() => handleDeleteProduct(prod.id, prod.name)}
                              className="px-2.5 py-1.5 rounded-lg text-rose-400/70 hover:text-rose-300 hover:bg-rose-950/40 text-xs flex items-center gap-1 transition-colors"
                              title="Eliminar este producto"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span className="text-[11px]">Eliminar</span>
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                handleSaveProductItem(prod.id, prod.name, prod.shortDesc, prod.price)
                              }
                              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5"
                              title="Guardar solo este ítem individualmente"
                            >
                              <Check className="w-3.5 h-3.5 text-amber-400" />
                              <span>Guardar solo este</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}

              {/* SECTION 2: SUPPLIES & BASE COSTS (Insumos Base y Costos Unitarios) */}
              {(menuManagerTab === 'Insumos' || menuManagerTab === 'Todos') && (
                <div className="space-y-3 pt-4 border-t border-slate-800">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                        <span>📦 Insumos Base, Costos Unitarios y Stock</span>
                        <span className="text-[10px] text-slate-500 font-normal">
                          (Pollo crudo, papas prefritas, envases, bolsas, gas/carbón)
                        </span>
                      </h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Modifica los costos unitarios de compra y stock base. Se recalcularán los márgenes de los combos y productos de venta automáticamente.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {draftSupplies.map((sup) => {
                      const orig = state.supplies.find((s) => s.id === sup.id);
                      const isModified =
                        orig && (orig.name !== sup.name || orig.unitCost !== sup.unitCost || orig.initialStock !== sup.initialStock);
                      const remStock = getSupplyRemainingStock(sup);

                      return (
                        <div
                          key={sup.id}
                          className={`p-3.5 rounded-2xl border transition-all space-y-2.5 ${
                            isModified
                              ? 'bg-amber-400/10 border-amber-400/60 shadow-md'
                              : 'bg-[#090D16] border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                                {sup.unit}
                              </span>
                              <span className="text-xs font-bold text-white truncate">
                                {sup.name}
                              </span>
                            </div>
                            {isModified && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-400 text-slate-950 shrink-0">
                                Modificado
                              </span>
                            )}
                          </div>

                          <div className="grid grid-cols-12 gap-2.5">
                            <div className="col-span-12 sm:col-span-6">
                              <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                                Nombre del Insumo
                              </label>
                              <input
                                type="text"
                                value={sup.name}
                                onChange={(e) => handleDraftSupplyChange(sup.id, 'name', e.target.value)}
                                className="w-full min-h-[38px] px-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:border-amber-400 focus:outline-none"
                              />
                            </div>

                            <div className="col-span-6 sm:col-span-3">
                              <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                                Costo Unit ($)
                              </label>
                              <input
                                type="number"
                                step="10"
                                min="0"
                                value={sup.unitCost}
                                onChange={(e) => handleDraftSupplyChange(sup.id, 'unitCost', e.target.value)}
                                className="w-full min-h-[38px] px-2 rounded-xl bg-slate-900 border border-slate-700 font-mono text-xs font-bold text-amber-400 text-right focus:border-amber-400 focus:outline-none"
                              />
                            </div>

                            <div className="col-span-6 sm:col-span-3">
                              <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                                Stock Inicial
                              </label>
                              <input
                                type="number"
                                step="1"
                                min="0"
                                value={sup.initialStock}
                                onChange={(e) => handleDraftSupplyChange(sup.id, 'initialStock', e.target.value)}
                                className="w-full min-h-[38px] px-2 rounded-xl bg-slate-900 border border-slate-700 font-mono text-xs text-white text-right focus:border-amber-400 focus:outline-none"
                              />
                            </div>
                          </div>

                          <div className="text-[11px] font-mono text-slate-400 flex items-center justify-between pt-1">
                            <span>
                              Restante en bodega: <strong className="text-white">{formatQty(remStock)} {sup.unit}</strong>
                            </span>
                            <span className="text-slate-500">
                              Compras: +{formatQty(sup.purchases)} · Consumo: -{formatQty(sup.salesConsumption)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Sticky Bottom Action Footer */}
            <div className="p-4 sm:p-5 border-t border-slate-800 bg-[#090D16] flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
              <div className="text-xs text-slate-400 text-center sm:text-left">
                <span>Al pulsar el botón, todos los cambios se guardan y aplican juntos a caja POS, inventario y recetas.</span>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => {
                    setShowPriceManagerModal(false);
                    setTargetProductForPriceEdit(null);
                    setShowNewProductForm(false);
                  }}
                  className="flex-1 sm:flex-none min-h-[46px] px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition-colors"
                >
                  Cerrar
                </button>

                <button
                  type="button"
                  onClick={handleSaveAllPricesAndSupplies}
                  className="flex-1 sm:flex-none min-h-[46px] px-6 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 active:scale-95 text-slate-950 font-display font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-amber-400/25 transition-all"
                >
                  <CheckCircle2 className="w-5 h-5 text-slate-950" />
                  <span>Guardar Cambios de Precios e Insumos</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 12. Modal: Centro de Control iPhone Dúo (2 Celulares Sincronizados) */}
      {showDuoModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl bg-[#0F172A] border border-slate-800 p-5 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-amber-400 text-slate-950 flex items-center justify-center font-bold shadow-lg shadow-amber-400/20">
                  <Radio className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-display text-lg font-bold text-white flex items-center gap-2">
                    Centro de Control iPhone Dúo
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300 font-semibold">
                      2 Celulares
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    Sincronización en tiempo real para operar dos iPhones en el local
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDuoModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Role Selection Grid */}
            <div className="space-y-2">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
                Selecciona la función de este iPhone en el local:
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Role 1: Modo Completo */}
                <button
                  type="button"
                  onClick={() => {
                    setDuoRole('completo');
                    showToast('Modo Completo activado: 5 módulos en este teléfono.', 'info');
                  }}
                  className={`p-4 rounded-2xl border text-left transition-all ${
                    duoRole === 'completo'
                      ? 'bg-amber-500/15 border-amber-400 shadow-lg shadow-amber-400/10'
                      : 'bg-[#090D16] border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">📱</span>
                      <strong className="text-sm font-bold text-white">Modo Completo</strong>
                    </div>
                    {duoRole === 'completo' && (
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400 ring-4 ring-amber-400/30"></span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Acceso a los 5 módulos (POS, Cocina, Pedidos, Inventario y Finanzas) en este mismo celular.
                  </p>
                </button>

                {/* Role 2: iPhone 1 Caja POS */}
                <button
                  type="button"
                  onClick={() => {
                    setDuoRole('caja');
                    setActiveTab('pos');
                    showToast('Rol asignado: iPhone 1 Caja POS. Timbre a cocina listo.', 'success');
                  }}
                  className={`p-4 rounded-2xl border text-left transition-all ${
                    duoRole === 'caja'
                      ? 'bg-amber-500/15 border-amber-400 shadow-lg shadow-amber-400/10'
                      : 'bg-[#090D16] border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">🛒</span>
                      <strong className="text-sm font-bold text-white">iPhone 1: Caja POS</strong>
                    </div>
                    {duoRole === 'caja' && (
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400 ring-4 ring-amber-400/30"></span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Diseñado para el cajero: cobro ultra rápido, cálculo de vuelto y botón de timbre directo al espiedo de cocina.
                  </p>
                </button>

                {/* Role 3: iPhone 2 Cocina KDS */}
                <button
                  type="button"
                  onClick={() => {
                    setDuoRole('cocina');
                    setActiveTab('cocina');
                    showToast('Rol asignado: iPhone 2 Cocina KDS. Pantalla de asador lista.', 'success');
                  }}
                  className={`p-4 rounded-2xl border text-left transition-all ${
                    duoRole === 'cocina'
                      ? 'bg-amber-500/15 border-amber-400 shadow-lg shadow-amber-400/10'
                      : 'bg-[#090D16] border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">🔥</span>
                      <strong className="text-sm font-bold text-white">iPhone 2: Cocina KDS</strong>
                    </div>
                    {duoRole === 'cocina' && (
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400 ring-4 ring-amber-400/30"></span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Pantalla gigante para el maestro asador: cronómetros de horno, disponibilidad en vitrina, pedidos por hora y aviso de tanda lista.
                  </p>
                </button>

                {/* Role 4: iPhone Pantalla Cliente */}
                <button
                  type="button"
                  onClick={() => {
                    setDuoRole('cliente');
                    showToast('Rol asignado: iPhone Visor Cliente. Colócalo mirando al público.', 'success');
                  }}
                  className={`p-4 rounded-2xl border text-left transition-all ${
                    duoRole === 'cliente'
                      ? 'bg-amber-500/15 border-amber-400 shadow-lg shadow-amber-400/10'
                      : 'bg-[#090D16] border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">👥</span>
                      <strong className="text-sm font-bold text-white">iPhone Visor Cliente</strong>
                    </div>
                    {duoRole === 'cliente' && (
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400 ring-4 ring-amber-400/30"></span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Pantalla apuntando al cliente en el mostrador: detalle de compra en vivo, monto total en CLP, cálculo de vuelto y QR de transferencia.
                  </p>
                </button>
              </div>
            </div>

            {/* Intercom & Sound Test */}
            <div className="p-4 rounded-2xl bg-[#090D16] border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white flex items-center gap-2">
                  <Bell className="w-4 h-4 text-amber-400" />
                  Intercomunicador Bidireccional (Prueba de Timbres)
                </span>
                <span className="text-[10px] text-emerald-400 font-mono">Web Audio API OK</span>
              </div>
              <p className="text-xs text-slate-400">
                Prueba las alertas sonoras y hápticas que sonarán en el otro teléfono al solicitar pollos o avisar tandas listas:
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handlePingCocina}
                  className="min-h-[44px] px-3 py-2 rounded-xl bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/40 text-xs font-semibold text-orange-200 flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
                >
                  <Bell className="w-4 h-4 text-orange-400" />
                  Timbre a Cocina
                </button>
                <button
                  type="button"
                  onClick={handlePingCaja}
                  className="min-h-[44px] px-3 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-xs font-semibold text-emerald-200 flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  Timbre a Caja
                </button>
              </div>
            </div>

            {/* iOS Safari Wake Lock Control */}
            <div className="p-4 rounded-2xl bg-[#090D16] border border-slate-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                  wakeLockActive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'
                }`}>
                  <Sun className="w-5 h-5" />
                </div>
                <div>
                  <strong className="text-xs font-bold text-white block">
                    Mantener Pantalla Siempre Encendida
                  </strong>
                  <p className="text-[11px] text-slate-400">
                    Evita que el iPhone se suspenda con guantes o grasa de cocina
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={toggleWakeLock}
                className={`min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-bold transition-colors whitespace-nowrap shrink-0 ${
                  wakeLockActive
                    ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
                }`}
              >
                {wakeLockActive ? 'Activado (ON)' : 'Activar (OFF)'}
              </button>
            </div>

            {/* P2P Sync Code (No external server needed) */}
            <div className="p-4 rounded-2xl bg-[#090D16] border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white flex items-center gap-2">
                  <QrCode className="w-4 h-4 text-amber-400" />
                  Emparejamiento / Sincronización Rápida
                </span>
                <span className="text-[10px] font-mono text-slate-400">Sin Servidor Requerido</span>
              </div>
              <p className="text-xs text-slate-400">
                Si estás usando dos iPhones separados, copia el código de sincronización desde el teléfono principal y pégalo en el segundo teléfono para cargar el inventario y recetas idénticas:
              </p>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const code = generateDuoSyncString();
                    if (navigator.clipboard) {
                      navigator.clipboard.writeText(code);
                      setCopiedSyncCode(true);
                      showToast('¡Código de sincronización copiado al portapapeles!', 'success');
                      setTimeout(() => setCopiedSyncCode(false), 2500);
                    } else {
                      setDuoSyncCodeInput(code);
                    }
                  }}
                  className="flex-1 min-h-[44px] px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 flex items-center justify-center gap-1.5"
                >
                  {copiedSyncCode ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-400" />
                      <span className="text-emerald-400 font-bold">¡Código Copiado!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 text-amber-400" />
                      <span>Copiar Código de este iPhone</span>
                    </>
                  )}
                </button>
              </div>

              <div className="pt-2 flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Pegar código desde el otro iPhone..."
                  value={duoSyncCodeInput}
                  onChange={(e) => setDuoSyncCodeInput(e.target.value)}
                  className="flex-1 min-h-[44px] px-3 rounded-xl bg-slate-900 border border-slate-700 font-mono text-xs text-white focus:outline-none focus:border-amber-400"
                />
                <button
                  type="button"
                  onClick={() => handleApplyDuoSyncCode(duoSyncCodeInput)}
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs whitespace-nowrap shrink-0 flex items-center gap-1"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Sincronizar
                </button>
              </div>
            </div>

            <div className="pt-2 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setShowDuoModal(false)}
                className="min-h-[44px] px-6 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs"
              >
                Listo, Comenzar Turno
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
