import { AppState, ProductItem, SupplyItem } from './types';

export const STORAGE_KEY = 'beto_pollos_asaduria_state_v1';

export function formatCLP(value: number): string {
  const rounded = Math.round(Number.isFinite(value) ? value : 0);
  const sign = rounded < 0 ? '-' : '';
  const abs = Math.abs(rounded);
  return `${sign}$${abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

export function formatQty(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return rounded.toString().replace('.', ',');
}

export function getNowTimeStr(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export function getFutureTimeStr(minutesAhead: number): string {
  const d = new Date(Date.now() + minutesAhead * 60000);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export function getTodayDateStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getSupplyRemainingStock(s: SupplyItem): number {
  const raw = s.initialStock + s.purchases - s.salesConsumption - s.waste;
  return Math.round(raw * 100) / 100;
}

export function calculateProductRecipeCost(product: ProductItem, supplies: SupplyItem[]): number {
  const supplyMap = new Map<string, SupplyItem>();
  for (const s of supplies) {
    supplyMap.set(s.id, s);
  }
  let cost = product.directExtraCost || 0;
  for (const ing of product.recipe) {
    const sup = supplyMap.get(ing.supplyId);
    if (sup) {
      cost += sup.unitCost * ing.quantity;
    }
  }
  return Math.round(cost);
}

export function createDefaultState(): AppState {
  const initialSupplies: SupplyItem[] = [
    {
      id: 'sup_pollo_crudo',
      name: 'Pollo crudo (Marinado)',
      unit: 'Unid',
      unitCost: 4200,
      initialStock: 48,
      purchases: 12,
      salesConsumption: 6.5,
      waste: 1,
      isRawChicken: true,
    },
    {
      id: 'sup_papas_prefritas',
      name: 'Papas prefritas',
      unit: 'Kg',
      unitCost: 1850,
      initialStock: 35,
      purchases: 10,
      salesConsumption: 3.1,
      waste: 0.5,
    },
    {
      id: 'sup_empanadas',
      name: 'Empanadas (Pino / Queso)',
      unit: 'Unid',
      unitCost: 850,
      initialStock: 60,
      purchases: 0,
      salesConsumption: 8,
      waste: 0,
    },
    {
      id: 'sup_mote_huesillo',
      name: 'Vaso Mote con Huesillo (500cc)',
      unit: 'Unid',
      unitCost: 950,
      initialStock: 36,
      purchases: 0,
      salesConsumption: 4,
      waste: 0,
    },
    {
      id: 'sup_bebida_15l',
      name: 'Bebida 1.5L (Línea Coca-Cola/CCU)',
      unit: 'Unid',
      unitCost: 1150,
      initialStock: 30,
      purchases: 12,
      salesConsumption: 3,
      waste: 0,
    },
    {
      id: 'sup_envase_pollo',
      name: 'Envase térmico pollo (Aluminio/PP)',
      unit: 'Unid',
      unitCost: 280,
      initialStock: 90,
      purchases: 0,
      salesConsumption: 7,
      waste: 1,
    },
    {
      id: 'sup_caja_papas',
      name: 'Caja papas fritas antigrasa',
      unit: 'Unid',
      unitCost: 160,
      initialStock: 100,
      purchases: 0,
      salesConsumption: 6,
      waste: 0,
    },
    {
      id: 'sup_bolsas',
      name: 'Bolsas camiseta / Kraft entrega',
      unit: 'Unid',
      unitCost: 45,
      initialStock: 180,
      purchases: 0,
      salesConsumption: 12,
      waste: 0,
    },
    {
      id: 'sup_carbon_gas',
      name: 'Carbón / Gas (Lote diario hornos)',
      unit: 'Lote',
      unitCost: 8500,
      initialStock: 4,
      purchases: 0,
      salesConsumption: 0.65,
      waste: 0,
    },
  ];

  const initialProducts: ProductItem[] = [
    {
      id: 'prod_pollo_entero',
      name: 'Pollo Asado Entero',
      shortDesc: '1 Pollo entero al espiedo + adobo de la casa en envase térmico',
      category: 'Pollos',
      price: 11900,
      cookedChickenUnits: 1,
      recipe: [
        { supplyId: 'sup_pollo_crudo', quantity: 1 },
        { supplyId: 'sup_envase_pollo', quantity: 1 },
        { supplyId: 'sup_bolsas', quantity: 1 },
        { supplyId: 'sup_carbon_gas', quantity: 0.1 },
      ],
    },
    {
      id: 'prod_medio_pollo',
      name: '1/2 Pollo Asado',
      shortDesc: 'Medio pollo asado trozado (0.5 unid) en envase térmico',
      category: 'Pollos',
      price: 6800,
      cookedChickenUnits: 0.5,
      recipe: [
        { supplyId: 'sup_pollo_crudo', quantity: 0.5 },
        { supplyId: 'sup_envase_pollo', quantity: 1 },
        { supplyId: 'sup_bolsas', quantity: 1 },
        { supplyId: 'sup_carbon_gas', quantity: 0.05 },
      ],
    },
    {
      id: 'prod_combo_familiar',
      name: 'Combo Familiar: 1 Pollo + Papas Grandes + Bebida',
      shortDesc: '1 Pollo Entero + 600g Papas Fritas + Bebida 1.5L',
      category: 'Combos',
      price: 16900,
      cookedChickenUnits: 1,
      recipe: [
        { supplyId: 'sup_pollo_crudo', quantity: 1 },
        { supplyId: 'sup_papas_prefritas', quantity: 0.6 },
        { supplyId: 'sup_bebida_15l', quantity: 1 },
        { supplyId: 'sup_envase_pollo', quantity: 1 },
        { supplyId: 'sup_caja_papas', quantity: 1 },
        { supplyId: 'sup_bolsas', quantity: 2 },
        { supplyId: 'sup_carbon_gas', quantity: 0.1 },
      ],
    },
    {
      id: 'prod_combo_duo',
      name: 'Combo Dúo: 1/2 Pollo + Papas + 2 Empanadas',
      shortDesc: '1/2 Pollo Asado + 400g Papas Fritas + 2 Empanadas',
      category: 'Combos',
      price: 12900,
      cookedChickenUnits: 0.5,
      recipe: [
        { supplyId: 'sup_pollo_crudo', quantity: 0.5 },
        { supplyId: 'sup_papas_prefritas', quantity: 0.4 },
        { supplyId: 'sup_empanadas', quantity: 2 },
        { supplyId: 'sup_envase_pollo', quantity: 1 },
        { supplyId: 'sup_caja_papas', quantity: 1 },
        { supplyId: 'sup_bolsas', quantity: 1 },
        { supplyId: 'sup_carbon_gas', quantity: 0.05 },
      ],
    },
    {
      id: 'prod_combo_dominguero',
      name: 'Combo Gran Asado: 2 Pollos + 2 Papas + 2 Mote + Bebida',
      shortDesc: '2 Pollos Enteros + 1.2kg Papas + 2 Mote con Huesillo + Bebida 1.5L',
      category: 'Combos',
      price: 31900,
      cookedChickenUnits: 2,
      recipe: [
        { supplyId: 'sup_pollo_crudo', quantity: 2 },
        { supplyId: 'sup_papas_prefritas', quantity: 1.2 },
        { supplyId: 'sup_mote_huesillo', quantity: 2 },
        { supplyId: 'sup_bebida_15l', quantity: 1 },
        { supplyId: 'sup_envase_pollo', quantity: 2 },
        { supplyId: 'sup_caja_papas', quantity: 2 },
        { supplyId: 'sup_bolsas', quantity: 3 },
        { supplyId: 'sup_carbon_gas', quantity: 0.2 },
      ],
    },
    {
      id: 'prod_papas_fritas',
      name: 'Porción de Papas Fritas',
      shortDesc: 'Porción grande de papas fritas crujientes (450g)',
      category: 'Acompañamientos',
      price: 3900,
      cookedChickenUnits: 0,
      recipe: [
        { supplyId: 'sup_papas_prefritas', quantity: 0.45 },
        { supplyId: 'sup_caja_papas', quantity: 1 },
        { supplyId: 'sup_bolsas', quantity: 1 },
      ],
    },
    {
      id: 'prod_empanada',
      name: 'Empanadas (Pino / Queso)',
      shortDesc: 'Empanada recién horneada o frita (1 unidad)',
      category: 'Acompañamientos',
      price: 2200,
      cookedChickenUnits: 0,
      recipe: [
        { supplyId: 'sup_empanadas', quantity: 1 },
        { supplyId: 'sup_bolsas', quantity: 0.5 },
      ],
    },
    {
      id: 'prod_mote_huesillo',
      name: 'Mote con Huesillo Tradicional',
      shortDesc: 'Vaso sellado 500cc con huesillo y trigo mote frío',
      category: 'Acompañamientos',
      price: 2600,
      cookedChickenUnits: 0,
      recipe: [
        { supplyId: 'sup_mote_huesillo', quantity: 1 },
        { supplyId: 'sup_bolsas', quantity: 0.5 },
      ],
    },
  ];

  const nowMs = Date.now();

  return {
    businessDate: getTodayDateStr(),
    supplies: initialSupplies,
    products: initialProducts,
    ovenBatches: [
      {
        id: 'Lote #102',
        quantity: 8,
        startTime: getFutureTimeStr(-42),
        startedAtMs: nowMs - 42 * 60000,
        notes: 'Espiedo Principal - Tanda Almuerzo',
      },
      {
        id: 'Lote #103',
        quantity: 6,
        startTime: getFutureTimeStr(-18),
        startedAtMs: nowMs - 18 * 60000,
        notes: 'Horno 2 - Refuerzo Pedidos',
      },
    ],
    cookedChickensInShowcase: 11.5, // 11.5 pollos cocidos físicamente en vitrina
    nextBatchNumber: 104,
    orders: [
      {
        id: 'PED-001',
        createdAt: getFutureTimeStr(-50),
        pickupTime: getFutureTimeStr(-5), // Atrasado / Por retirar urgente
        customerName: 'Carolina Muñoz',
        customerPhone: '+56984123901',
        items: [
          {
            productId: 'prod_combo_familiar',
            name: 'Combo Familiar: 1 Pollo + Papas Grandes + Bebida',
            quantity: 2,
            unitPrice: 16900,
            unitCost: 7945,
            cookedChickenPerUnit: 1,
          },
          {
            productId: 'prod_empanada',
            name: 'Empanadas (Pino / Queso)',
            quantity: 4,
            unitPrice: 2200,
            unitCost: 873,
            cookedChickenPerUnit: 0,
          },
        ],
        totalPrice: 42600,
        totalCost: 19382,
        totalCookedChicken: 2,
        paymentStatus: 'Pendiente por pagar al retirar',
        deliveryStatus: 'Pendiente',
        notes: 'Agregar ají pebre extra',
      },
      {
        id: 'PED-002',
        createdAt: getFutureTimeStr(-30),
        pickupTime: getFutureTimeStr(15), // Próximo a entregar
        customerName: 'Roberto Soto',
        customerPhone: '+56971148820',
        items: [
          {
            productId: 'prod_pollo_entero',
            name: 'Pollo Asado Entero',
            quantity: 1,
            unitPrice: 11900,
            unitCost: 5375,
            cookedChickenPerUnit: 1,
          },
          {
            productId: 'prod_medio_pollo',
            name: '1/2 Pollo Asado',
            quantity: 1,
            unitPrice: 6800,
            unitCost: 2850,
            cookedChickenPerUnit: 0.5,
          },
          {
            productId: 'prod_mote_huesillo',
            name: 'Mote con Huesillo Tradicional',
            quantity: 2,
            unitPrice: 2600,
            unitCost: 973,
            cookedChickenPerUnit: 0,
          },
        ],
        totalPrice: 23900,
        totalCost: 10171,
        totalCookedChicken: 1.5,
        paymentStatus: 'Pagado',
        paymentMethod: 'Transferencia',
        deliveryStatus: 'Pendiente',
        notes: 'Trocear el pollo entero en 8 partes',
      },
      {
        id: 'PED-003',
        createdAt: getFutureTimeStr(-15),
        pickupTime: getFutureTimeStr(50),
        customerName: 'Familia Valdés',
        customerPhone: '+56993451092',
        items: [
          {
            productId: 'prod_combo_dominguero',
            name: 'Combo Gran Asado: 2 Pollos + 2 Papas + 2 Mote + Bebida',
            quantity: 1,
            unitPrice: 31900,
            unitCost: 16445,
            cookedChickenPerUnit: 2,
          },
        ],
        totalPrice: 31900,
        totalCost: 16445,
        totalCookedChicken: 2,
        paymentStatus: 'Pendiente por pagar al retirar',
        deliveryStatus: 'Pendiente',
        notes: 'Retira don Patricio en camioneta blanca',
      },
    ],
    sales: [
      {
        id: 'VTA-1001',
        time: '12:15',
        origin: 'Mostrador',
        itemsSummary: '3x Combo Familiar: 1 Pollo + Papas Grandes + Bebida, 2x Mote con Huesillo Tradicional',
        totalQuantity: 5,
        totalCookedChicken: 3,
        totalCost: 25780,
        totalPrice: 55900,
        profit: 30120,
        marginPct: 53.9,
        paymentMethod: 'Tarjeta (Débito/Crédito)',
      },
      {
        id: 'VTA-1002',
        time: '12:40',
        origin: 'Mostrador',
        itemsSummary: '2x Pollo Asado Entero, 2x Porción de Papas Fritas, 4x Empanadas (Pino / Queso)',
        totalQuantity: 8,
        totalCookedChicken: 2,
        totalCost: 16316,
        totalPrice: 40400,
        profit: 24084,
        marginPct: 59.6,
        paymentMethod: 'Efectivo',
        cashReceived: 50000,
        changeGiven: 9600,
      },
      {
        id: 'VTA-1003',
        time: '13:05',
        origin: 'Pedido',
        orderId: 'PED-000',
        customerName: 'Andrés Riquelme',
        itemsSummary: '1x Combo Dúo: 1/2 Pollo + Papas + 2 Empanadas, 1x Pollo Asado Entero, 2x Empanadas (Pino / Queso), 2x Mote con Huesillo Tradicional',
        totalQuantity: 6,
        totalCookedChicken: 1.5,
        totalCost: 14093,
        totalPrice: 34400,
        profit: 20307,
        marginPct: 59.0,
        paymentMethod: 'Transferencia',
      },
    ],
    pettyCashExpenses: [
      {
        id: 'GASTO-01',
        time: '11:20',
        amount: 4500,
        reason: 'Compra de 3 bolsas de hielo y limones para pebre',
      },
      {
        id: 'GASTO-02',
        time: '12:50',
        amount: 3200,
        reason: 'Servilletas extra y rollo papel térmico impresora POS',
      },
    ],
    wasteRecords: [
      {
        id: 'MER-01',
        time: '12:10',
        supplyId: 'sup_pollo_crudo',
        supplyName: 'Pollo crudo (Marinado)',
        quantity: 1,
        unitCost: 4200,
        totalLoss: 4200,
        reason: 'Pollo sobrecocido en barra inferior del espiedo',
        fromCookedShowcase: false,
      },
      {
        id: 'MER-02',
        time: '12:35',
        supplyId: 'sup_papas_prefritas',
        supplyName: 'Papas prefritas',
        quantity: 0.5,
        unitCost: 1850,
        totalLoss: 925,
        reason: 'Merma de fondo de freidora',
        fromCookedShowcase: false,
      },
      {
        id: 'MER-03',
        time: '12:45',
        supplyId: 'sup_envase_pollo',
        supplyName: 'Envase térmico pollo (Aluminio/PP)',
        quantity: 1,
        unitCost: 280,
        totalLoss: 280,
        reason: 'Tapa aplastada en empaque',
        fromCookedShowcase: false,
      },
    ],
    webhookUrl: '',
    recipientEmail: 'fama169rp@gmail.com',
  };
}
