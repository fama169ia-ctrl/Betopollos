import * as XLSX from 'xlsx';
import { formatCLP, getSupplyRemainingStock } from './initialData';
import { AppState } from './types';

export interface FinancialMetrics {
  grossRevenue: number;
  revenueCash: number;
  revenueCard: number;
  revenueTransfer: number;
  salesCogs: number;
  wasteCost: number;
  pettyCashTotal: number;
  netProfit: number;
  realMarginPct: number;
  expectedCashInDrawer: number;
  inventoryValuation: number;
}

export function computeFinancialMetrics(state: AppState): FinancialMetrics {
  let grossRevenue = 0;
  let revenueCash = 0;
  let revenueCard = 0;
  let revenueTransfer = 0;
  let salesCogs = 0;

  for (const s of state.sales) {
    grossRevenue += s.totalPrice;
    salesCogs += s.totalCost;
    if (s.paymentMethod === 'Efectivo') revenueCash += s.totalPrice;
    else if (s.paymentMethod === 'Tarjeta (Débito/Crédito)') revenueCard += s.totalPrice;
    else if (s.paymentMethod === 'Transferencia') revenueTransfer += s.totalPrice;
  }

  let wasteCost = 0;
  for (const sup of state.supplies) {
    wasteCost += Math.round(sup.waste * sup.unitCost);
  }

  let pettyCashTotal = 0;
  for (const exp of state.pettyCashExpenses) {
    pettyCashTotal += exp.amount;
  }

  const netProfit = grossRevenue - salesCogs - wasteCost - pettyCashTotal;
  const realMarginPct = grossRevenue > 0 ? Math.round((netProfit / grossRevenue) * 1000) / 10 : 0;
  const expectedCashInDrawer = revenueCash - pettyCashTotal;

  let inventoryValuation = 0;
  for (const sup of state.supplies) {
    const rem = getSupplyRemainingStock(sup);
    inventoryValuation += Math.round(rem * sup.unitCost);
  }

  return {
    grossRevenue: Math.round(grossRevenue),
    revenueCash: Math.round(revenueCash),
    revenueCard: Math.round(revenueCard),
    revenueTransfer: Math.round(revenueTransfer),
    salesCogs: Math.round(salesCogs),
    wasteCost: Math.round(wasteCost),
    pettyCashTotal: Math.round(pettyCashTotal),
    netProfit: Math.round(netProfit),
    realMarginPct,
    expectedCashInDrawer: Math.round(expectedCashInDrawer),
    inventoryValuation: Math.round(inventoryValuation),
  };
}

export function buildExcelSheetsData(state: AppState) {
  const metrics = computeFinancialMetrics(state);

  // Hoja 1 "Pedidos": ID, Hora Ingreso, Hora Entrega, Cliente, Detalle Productos, Total ($), Estado Pago, Estado Entrega.
  const pedidosRows = state.orders.map((o) => ({
    'ID': o.id,
    'Hora Ingreso': o.createdAt,
    'Hora Entrega': o.pickupTime,
    'Cliente': `${o.customerName}${o.customerPhone ? ` (${o.customerPhone})` : ''}`,
    'Detalle Productos': o.items.map((i) => `${i.quantity}x ${i.name}`).join(' + '),
    'Total ($)': o.totalPrice,
    'Estado Pago': o.paymentStatus === 'Pagado' ? `Pagado (${o.paymentMethod || 'Efectivo'})` : o.paymentStatus,
    'Estado Entrega': o.deliveryStatus,
  }));

  // Hoja 2 "Ventas": ID Venta, Hora, Origen (Mostrador o Pedido), Detalle Productos, Cantidad, Costo Total Insumos ($), Precio Venta Total ($), Utilidad de la Venta ($), Margen (%), Medio de Pago.
  const ventasRows: Record<string, string | number>[] = state.sales.map((s) => ({
    'ID Venta': s.id,
    'Hora': s.time,
    'Origen': s.origin,
    'Detalle Productos': s.itemsSummary,
    'Cantidad': s.totalQuantity,
    'Costo Total Insumos ($)': s.totalCost,
    'Precio Venta Total ($)': s.totalPrice,
    'Utilidad de la Venta ($)': s.profit,
    'Margen (%)': `${s.marginPct}%`,
    'Medio de Pago': s.paymentMethod,
  }));

  // Al final de la hoja Ventas, incluir filas de resumen con Gastos de Caja y Cuadratura
  ventasRows.push({
    'ID Venta': '',
    'Hora': '',
    'Origen': '',
    'Detalle Productos': '',
    'Cantidad': '',
    'Costo Total Insumos ($)': '',
    'Precio Venta Total ($)': '',
    'Utilidad de la Venta ($)': '',
    'Margen (%)': '',
    'Medio de Pago': '',
  });
  ventasRows.push({
    'ID Venta': 'RESUMEN VENTAS BRUTAS',
    'Hora': state.businessDate,
    'Origen': 'TOTAL VENTAS',
    'Detalle Productos': `${state.sales.length} operaciones registradas`,
    'Cantidad': state.sales.reduce((acc, s) => acc + s.totalQuantity, 0),
    'Costo Total Insumos ($)': metrics.salesCogs,
    'Precio Venta Total ($)': metrics.grossRevenue,
    'Utilidad de la Venta ($)': metrics.grossRevenue - metrics.salesCogs,
    'Margen (%)':
      metrics.grossRevenue > 0
        ? `${Math.round(((metrics.grossRevenue - metrics.salesCogs) / metrics.grossRevenue) * 1000) / 10}%`
        : '0%',
    'Medio de Pago': 'TODOS',
  });

  // Desglose Gastos de Caja Chica
  for (const exp of state.pettyCashExpenses) {
    ventasRows.push({
      'ID Venta': exp.id,
      'Hora': exp.time,
      'Origen': 'GASTO CAJA CHICA',
      'Detalle Productos': exp.reason,
      'Cantidad': 1,
      'Costo Total Insumos ($)': 0,
      'Precio Venta Total ($)': -exp.amount,
      'Utilidad de la Venta ($)': -exp.amount,
      'Margen (%)': '-',
      'Medio de Pago': 'Efectivo (Salida)',
    });
  }

  ventasRows.push({
    'ID Venta': 'MERMAS DEL DÍA',
    'Hora': state.businessDate,
    'Origen': 'COSTO MERMAS',
    'Detalle Productos': `${state.wasteRecords.length} registros de merma`,
    'Cantidad': '-',
    'Costo Total Insumos ($)': metrics.wasteCost,
    'Precio Venta Total ($)': 0,
    'Utilidad de la Venta ($)': -metrics.wasteCost,
    'Margen (%)': '-',
    'Medio de Pago': 'Inventario',
  });

  ventasRows.push({
    'ID Venta': 'CUADRATURA EFECTIVO',
    'Hora': '',
    'Origen': 'CAJA EFECTIVO',
    'Detalle Productos': `Ventas Efectivo (${formatCLP(metrics.revenueCash)}) - Gastos Caja Chica (${formatCLP(metrics.pettyCashTotal)})`,
    'Cantidad': '-',
    'Costo Total Insumos ($)': '-',
    'Precio Venta Total ($)': metrics.expectedCashInDrawer,
    'Utilidad de la Venta ($)': '-',
    'Margen (%)': '-',
    'Medio de Pago': 'Efectivo en Caja',
  });

  ventasRows.push({
    'ID Venta': 'CUADRATURA TARJETA',
    'Hora': '',
    'Origen': 'VOUCHER / POS',
    'Detalle Productos': 'Total Ventas Débito / Crédito',
    'Cantidad': '-',
    'Costo Total Insumos ($)': '-',
    'Precio Venta Total ($)': metrics.revenueCard,
    'Utilidad de la Venta ($)': '-',
    'Margen (%)': '-',
    'Medio de Pago': 'Tarjeta (Débito/Crédito)',
  });

  ventasRows.push({
    'ID Venta': 'CUADRATURA TRANSFERENCIA',
    'Hora': '',
    'Origen': 'BANCO',
    'Detalle Productos': 'Total Ventas por Transferencia Bancaria',
    'Cantidad': '-',
    'Costo Total Insumos ($)': '-',
    'Precio Venta Total ($)': metrics.revenueTransfer,
    'Utilidad de la Venta ($)': '-',
    'Margen (%)': '-',
    'Medio de Pago': 'Transferencia',
  });

  ventasRows.push({
    'ID Venta': 'RESULTADO FINAL DÍA',
    'Hora': state.businessDate,
    'Origen': 'UTILIDAD NETA REAL',
    'Detalle Productos': 'Ingresos - Costo Insumos - Mermas - Gastos Caja Chica',
    'Cantidad': '-',
    'Costo Total Insumos ($)': metrics.salesCogs + metrics.wasteCost + metrics.pettyCashTotal,
    'Precio Venta Total ($)': metrics.grossRevenue,
    'Utilidad de la Venta ($)': metrics.netProfit,
    'Margen (%)': `${metrics.realMarginPct}%`,
    'Medio de Pago': 'CONSOLIDADO',
  });

  // Hoja 3 "Insumos": Insumo, Costo Unitario ($), Stock Inicial, Ingresos, Consumo Ventas, Mermas, Stock Final, Valorizado del Stock Restante ($).
  const insumosRows = state.supplies.map((s) => {
    const finalStock = getSupplyRemainingStock(s);
    return {
      'Insumo': `${s.name} (${s.unit})`,
      'Costo Unitario ($)': s.unitCost,
      'Stock Inicial': s.initialStock,
      'Ingresos': s.purchases,
      'Consumo Ventas': Math.round(s.salesConsumption * 100) / 100,
      'Mermas': Math.round(s.waste * 100) / 100,
      'Stock Final': finalStock,
      'Valorizado del Stock Restante ($)': Math.round(finalStock * s.unitCost),
    };
  });

  insumosRows.push({
    'Insumo': 'TOTAL VALORIZADO BODEGA / INVENTARIO',
    'Costo Unitario ($)': 0,
    'Stock Inicial': 0,
    'Ingresos': 0,
    'Consumo Ventas': 0,
    'Mermas': 0,
    'Stock Final': 0,
    'Valorizado del Stock Restante ($)': metrics.inventoryValuation,
  });

  return {
    pedidosRows,
    ventasRows,
    insumosRows,
    metrics,
  };
}

export function generateDailyExcelWorkbook(state: AppState): {
  workbook: XLSX.WorkBook;
  fileName: string;
  excelArrayBuffer: ArrayBuffer;
  excelBase64: string;
  sheetsJson: ReturnType<typeof buildExcelSheetsData>;
} {
  const sheetsJson = buildExcelSheetsData(state);
  const wb = XLSX.utils.book_new();

  const wsPedidos = XLSX.utils.json_to_sheet(
    sheetsJson.pedidosRows.length > 0
      ? sheetsJson.pedidosRows
      : [
          {
            'ID': '-',
            'Hora Ingreso': '-',
            'Hora Entrega': '-',
            'Cliente': 'Sin pedidos registrados',
            'Detalle Productos': '-',
            'Total ($)': 0,
            'Estado Pago': '-',
            'Estado Entrega': '-',
          },
        ]
  );
  wsPedidos['!cols'] = [
    { wch: 12 },
    { wch: 14 },
    { wch: 14 },
    { wch: 26 },
    { wch: 48 },
    { wch: 14 },
    { wch: 28 },
    { wch: 16 },
  ];

  const wsVentas = XLSX.utils.json_to_sheet(sheetsJson.ventasRows);
  wsVentas['!cols'] = [
    { wch: 24 },
    { wch: 12 },
    { wch: 20 },
    { wch: 52 },
    { wch: 12 },
    { wch: 22 },
    { wch: 22 },
    { wch: 22 },
    { wch: 14 },
    { wch: 24 },
  ];

  const wsInsumos = XLSX.utils.json_to_sheet(sheetsJson.insumosRows);
  wsInsumos['!cols'] = [
    { wch: 36 },
    { wch: 18 },
    { wch: 14 },
    { wch: 14 },
    { wch: 16 },
    { wch: 14 },
    { wch: 14 },
    { wch: 30 },
  ];

  XLSX.utils.book_append_sheet(wb, wsPedidos, 'Pedidos');
  XLSX.utils.book_append_sheet(wb, wsVentas, 'Ventas');
  XLSX.utils.book_append_sheet(wb, wsInsumos, 'Insumos');

  const fileName = `Reporte_Ventas_${state.businessDate}.xlsx`;
  const excelArrayBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  const excelBase64 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' }) as string;

  return {
    workbook: wb,
    fileName,
    excelArrayBuffer,
    excelBase64,
    sheetsJson,
  };
}

export function triggerExcelDownload(fileName: string, arrayBuffer: ArrayBuffer) {
  const blob = new Blob([arrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function shareExcelViaNavigator(
  fileName: string,
  arrayBuffer: ArrayBuffer,
  state: AppState
): Promise<{ shared: boolean; reason?: string }> {
  const metrics = computeFinancialMetrics(state);
  const file = new File([arrayBuffer], fileName, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  const summaryText = [
    `Cierre Diario Asaduría Beto Pollos (${state.businessDate})`,
    `Destinatario: ${state.recipientEmail}`,
    `• Ingresos Brutos: ${formatCLP(metrics.grossRevenue)} (Efectivo: ${formatCLP(metrics.revenueCash)} | Tarjeta: ${formatCLP(metrics.revenueCard)} | Transf: ${formatCLP(metrics.revenueTransfer)})`,
    `• Costo Insumos: ${formatCLP(metrics.salesCogs)}`,
    `• Mermas: ${formatCLP(metrics.wasteCost)} | Caja Chica: ${formatCLP(metrics.pettyCashTotal)}`,
    `• UTILIDAD NETA REAL: ${formatCLP(metrics.netProfit)} (${metrics.realMarginPct}%)`,
    `• Efectivo esperado en caja: ${formatCLP(metrics.expectedCashInDrawer)}`,
  ].join('\n');

  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      const canShareFiles =
        typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
      if (canShareFiles) {
        await navigator.share({
          title: `Reporte Ventas ${state.businessDate} - ${state.recipientEmail}`,
          text: summaryText,
          files: [file],
        });
        return { shared: true };
      } else {
        await navigator.share({
          title: `Reporte Ventas ${state.businessDate} - ${state.recipientEmail}`,
          text: summaryText,
        });
        return { shared: true, reason: 'Texto compartido (el navegador no adjunta archivos directos)' };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Cancelado por el usuario';
      return { shared: false, reason: msg };
    }
  }
  return {
    shared: false,
    reason: 'Web Share API nativa no disponible en este navegador de escritorio.',
  };
}

export async function sendExcelToWebhook(
  state: AppState,
  fileName: string,
  excelBase64: string,
  sheetsJson: ReturnType<typeof buildExcelSheetsData>
): Promise<{ ok: boolean; statusMsg: string }> {
  const url = state.webhookUrl.trim();
  if (!url) {
    return {
      ok: false,
      statusMsg: 'URL de Webhook no configurada (opcional para automatización en segundo plano).',
    };
  }

  const payload = {
    recipientEmail: state.recipientEmail || 'fama169rp@gmail.com',
    subject: `Cierre de Día Asaduría (${state.businessDate}) - ${fileName}`,
    businessDate: state.businessDate,
    fileName,
    excelBase64,
    metrics: sheetsJson.metrics,
    sheets: {
      Pedidos: sheetsJson.pedidosRows,
      Ventas: sheetsJson.ventasRows,
      Insumos: sheetsJson.insumosRows,
    },
    sentAt: new Date().toISOString(),
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      return {
        ok: true,
        statusMsg: `Enviado automáticamente por Webhook a ${state.recipientEmail} (HTTP ${res.status}).`,
      };
    }
    return {
      ok: false,
      statusMsg: `El Webhook respondió con estado HTTP ${res.status}.`,
    };
  } catch {
    // Retry with no-cors mode for Google Apps Script web apps that redirect
    try {
      await fetch(url, {
        method: 'POST',
        mode: 'no-cors',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
        },
        body: JSON.stringify(payload),
      });
      return {
        ok: true,
        statusMsg: `Payload enviado al Webhook (modo Google Apps Script) hacia ${state.recipientEmail}.`,
      };
    } catch (e2) {
      return {
        ok: false,
        statusMsg: `Error de red al conectar con Webhook: ${e2 instanceof Error ? e2.message : 'Desconocido'}`,
      };
    }
  }
}
