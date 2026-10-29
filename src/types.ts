export type PaymentMethod = 'Efectivo' | 'Tarjeta (Débito/Crédito)' | 'Transferencia';

export type SupplyUnit = 'Unid' | 'Kg' | 'Lts' | 'Lote';

export interface SupplyItem {
  id: string;
  name: string;
  unit: SupplyUnit;
  unitCost: number; // CLP sin decimales
  initialStock: number;
  purchases: number; // Compras / Ingresos del día (+)
  salesConsumption: number; // Consumo por ventas (-)
  waste: number; // Mermas (-)
  isRawChicken?: boolean;
}

export interface RecipeIngredient {
  supplyId: string;
  quantity: number;
}

export type ProductCategory = 'Pollos' | 'Combos' | 'Acompañamientos';

export interface ProductItem {
  id: string;
  name: string;
  shortDesc: string;
  category: ProductCategory;
  price: number; // CLP sin decimales
  cookedChickenUnits: number; // 1, 0.5, 2, 0
  recipe: RecipeIngredient[];
  directExtraCost?: number;
}

export interface OvenBatch {
  id: string;
  quantity: number;
  startTime: string;
  startedAtMs: number;
  notes: string;
}

export interface OrderItemLine {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  cookedChickenPerUnit: number;
}

export interface CustomerOrder {
  id: string;
  createdAt: string;
  pickupTime: string;
  customerName: string;
  customerPhone: string;
  items: OrderItemLine[];
  totalPrice: number;
  totalCost: number;
  totalCookedChicken: number;
  paymentStatus: 'Pagado' | 'Pendiente por pagar al retirar';
  paymentMethod?: PaymentMethod;
  deliveryStatus: 'Pendiente' | 'Entregado' | 'Cancelado';
  notes?: string;
}

export interface SaleRecord {
  id: string;
  time: string;
  origin: 'Mostrador' | 'Pedido';
  orderId?: string;
  customerName?: string;
  itemsSummary: string;
  totalQuantity: number;
  totalCookedChicken: number;
  totalCost: number;
  totalPrice: number;
  profit: number;
  marginPct: number;
  paymentMethod: PaymentMethod;
  cashReceived?: number;
  changeGiven?: number;
}

export interface PettyCashExpense {
  id: string;
  time: string;
  amount: number;
  reason: string;
}

export interface WasteRecord {
  id: string;
  time: string;
  supplyId: string;
  supplyName: string;
  quantity: number;
  unitCost: number;
  totalLoss: number;
  reason: string;
  fromCookedShowcase?: boolean;
}

export interface AppState {
  businessDate: string;
  supplies: SupplyItem[];
  products: ProductItem[];
  ovenBatches: OvenBatch[];
  cookedChickensInShowcase: number;
  nextBatchNumber: number;
  orders: CustomerOrder[];
  sales: SaleRecord[];
  pettyCashExpenses: PettyCashExpense[];
  wasteRecords: WasteRecord[];
  webhookUrl: string;
  recipientEmail: string;
}

export type ActiveTab = 'pos' | 'cocina' | 'pedidos' | 'inventario' | 'finanzas';

export type DuoRole = 'completo' | 'caja' | 'cocina' | 'cliente';

export interface DuoSyncMessage {
  type: 'SYNC_STATE' | 'SYNC_CART' | 'PING_COCINA' | 'PING_CAJA' | 'CLEAR_CART';
  sender: DuoRole;
  timestamp: number;
  payload?: any;
}
