import { STORAGE_KEY } from './initialData';
import { AppState } from './types';

export function downloadStandaloneSingleFileHtml(currentState: AppState) {
  const serializedState = JSON.stringify(currentState);
  const htmlContent = `<!DOCTYPE html>
<html lang="es" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
  <meta name="theme-color" content="#090D16" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <title>Asaduría Beto Pollos — POS, Cocina y Finanzas (HTML Único)</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/lucide@latest"></script>
  <script src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"></script>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;600;700&family=Outfit:wght@600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    body { font-family: 'Plus Jakarta Sans', sans-serif; background: #090D16; color: #F8FAFC; -webkit-tap-highlight-color: transparent; }
    .font-display { font-family: 'Outfit', sans-serif; }
    .font-mono, .tabular-nums { font-family: 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums; }
  </style>
</head>
<body class="min-h-screen pb-24">
  <div id="app" class="max-w-7xl mx-auto"></div>
  <script>
    const STORAGE_KEY = '${STORAGE_KEY}';
    const INITIAL_DATA = ${serializedState};
    let state = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || INITIAL_DATA;
    let activeTab = 'pos';
    let cart = {};
    let paymentMethod = 'Efectivo';
    let cashReceived = '';

    function saveState() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      render();
    }
    function formatCLP(v) {
      const r = Math.round(Number(v) || 0);
      return (r < 0 ? '-' : '') + '$' + Math.abs(r).toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g, '.');
    }
    function getRemStock(s) {
      return Math.round((s.initialStock + s.purchases - s.salesConsumption - s.waste) * 100) / 100;
    }
    function getReservedChickens() {
      return state.orders.filter(o => o.deliveryStatus === 'Pendiente').reduce((a, o) => a + o.totalCookedChicken, 0);
    }
    function getAvailableChickens() {
      return Math.round((state.cookedChickensInShowcase - getReservedChickens()) * 100) / 100;
    }
    function getProdCost(p) {
      let c = p.directExtraCost || 0;
      p.recipe.forEach(r => {
        const s = state.supplies.find(x => x.id === r.supplyId);
        if (s) c += s.unitCost * r.quantity;
      });
      return Math.round(c);
    }
    function addToCart(pid, delta) {
      cart[pid] = Math.max(0, (cart[pid] || 0) + delta);
      if (cart[pid] === 0) delete cart[pid];
      render();
    }
    function checkoutPOS() {
      const entries = Object.entries(cart);
      if (!entries.length) return;
      let total = 0, cost = 0, chickens = 0, qty = 0;
      const summary = [];
      entries.forEach(([pid, q]) => {
        const p = state.products.find(x => x.id === pid);
        if (!p) return;
        total += p.price * q;
        cost += getProdCost(p) * q;
        chickens += p.cookedChickenUnits * q;
        qty += q;
        summary.push(q + 'x ' + p.name);
        p.recipe.forEach(r => {
          const s = state.supplies.find(x => x.id === r.supplyId);
          if (s) s.salesConsumption = Math.round((s.salesConsumption + r.quantity * q) * 100) / 100;
        });
      });
      state.cookedChickensInShowcase = Math.max(0, Math.round((state.cookedChickensInShowcase - chickens) * 100) / 100);
      const profit = total - cost;
      const now = new Date();
      const time = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
      state.sales.unshift({
        id: 'VTA-' + (1001 + state.sales.length),
        time,
        origin: 'Mostrador',
        itemsSummary: summary.join(', '),
        totalQuantity: qty,
        totalCookedChicken: chickens,
        totalCost: cost,
        totalPrice: total,
        profit,
        marginPct: total > 0 ? Math.round((profit / total) * 1000) / 10 : 0,
        paymentMethod
      });
      cart = {};
      cashReceived = '';
      saveState();
    }
    function exportExcel() {
      const wb = XLSX.utils.book_new();
      const pedidos = state.orders.map(o => ({
        'ID': o.id, 'Hora Ingreso': o.createdAt, 'Hora Entrega': o.pickupTime,
        'Cliente': o.customerName + ' (' + o.customerPhone + ')',
        'Detalle Productos': o.items.map(i => i.quantity + 'x ' + i.name).join(' + '),
        'Total ($)': o.totalPrice, 'Estado Pago': o.paymentStatus, 'Estado Entrega': o.deliveryStatus
      }));
      const ventas = state.sales.map(s => ({
        'ID Venta': s.id, 'Hora': s.time, 'Origen': s.origin, 'Detalle Productos': s.itemsSummary,
        'Cantidad': s.totalQuantity, 'Costo Total Insumos ($)': s.totalCost, 'Precio Venta Total ($)': s.totalPrice,
        'Utilidad de la Venta ($)': s.profit, 'Margen (%)': s.marginPct + '%', 'Medio de Pago': s.paymentMethod
      }));
      const insumos = state.supplies.map(s => {
        const fin = getRemStock(s);
        return {
          'Insumo': s.name + ' (' + s.unit + ')', 'Costo Unitario ($)': s.unitCost,
          'Stock Inicial': s.initialStock, 'Ingresos': s.purchases, 'Consumo Ventas': s.salesConsumption,
          'Mermas': s.waste, 'Stock Final': fin, 'Valorizado del Stock Restante ($)': Math.round(fin * s.unitCost)
        };
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pedidos), 'Pedidos');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ventas), 'Ventas');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(insumos), 'Insumos');
      XLSX.writeFile(wb, 'Reporte_Ventas_' + state.businessDate + '.xlsx');
    }
    const PRICE_PASSWORD = 'Betopollos';
    function modifyName(pid) {
      const p = state.products.find(x => x.id === pid);
      if (!p) return;
      const pass = prompt('Modificar nombre de: ' + p.name + '\\n\\nIngresa la clave de administrador:');
      if (pass === null) return;
      if (pass.trim() !== PRICE_PASSWORD && pass.trim() !== '0503') {
        alert('Clave incorrecta. Clave de administrador requerida: Betopollos');
        return;
      }
      const newName = prompt('Nuevo nombre para este producto o combo:', p.name);
      if (!newName || !newName.trim()) return;
      p.name = newName.trim();
      saveState();
      alert('Nombre actualizado a: ' + p.name);
    }
    function modifyPrice(pid) {
      const p = state.products.find(x => x.id === pid);
      if (!p) return;
      const pass = prompt('Modificar precio de: ' + p.name + '\\n\\nIngresa la clave de seguridad:');
      if (pass === null) return;
      if (pass.trim() !== PRICE_PASSWORD && pass.trim() !== '0503') {
        alert('Clave incorrecta. Clave de seguridad requerida: Betopollos');
        return;
      }
      const newPriceStr = prompt('Nuevo precio ($ CLP) para ' + p.name + ':', p.price);
      if (newPriceStr === null) return;
      const newPrice = Math.round(Number(newPriceStr.replace(/\\D/g, '')) || 0);
      if (newPrice > 0) {
        p.price = newPrice;
        saveState();
        alert('Precio de ' + p.name + ' actualizado a ' + formatCLP(newPrice));
      }
    }
    function modifyAllPricesPrompt() {
      const pass = prompt('Ingresa la clave de administrador para modificar precios:');
      if (pass === null) return;
      if (pass.trim() !== PRICE_PASSWORD) {
        alert('Clave incorrecta. Clave de seguridad requerida: Betopollos');
        return;
      }
      const listStr = state.products.map((p, i) => (i + 1) + '. ' + p.name + ' (' + formatCLP(p.price) + ')').join('\\n');
      const selection = prompt('Selecciona el número del producto a modificar:\\n\\n' + listStr);
      if (!selection) return;
      const idx = parseInt(selection) - 1;
      const p = state.products[idx];
      if (!p) { alert('Producto no encontrado.'); return; }
      const newPriceStr = prompt('Nuevo precio ($ CLP) para ' + p.name + ':', p.price);
      if (newPriceStr === null) return;
      const newPrice = Math.round(Number(newPriceStr.replace(/\\D/g, '')) || 0);
      if (newPrice > 0) {
        p.price = newPrice;
        saveState();
        alert('Precio de ' + p.name + ' actualizado a ' + formatCLP(newPrice));
      }
    }
    function render() {
      const app = document.getElementById('app');
      const avail = getAvailableChickens();
      const reserved = getReservedChickens();
      let gross = 0, cogs = 0;
      state.sales.forEach(s => { gross += s.totalPrice; cogs += s.totalCost; });
      const wasteCost = state.supplies.reduce((a, s) => a + Math.round(s.waste * s.unitCost), 0);
      const petty = state.pettyCashExpenses.reduce((a, e) => a + e.amount, 0);
      const net = gross - cogs - wasteCost - petty;

      app.innerHTML = \`
        <header class="sticky top-0 z-30 bg-[#090D16]/95 backdrop-blur border-b border-slate-800 px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <h1 class="font-display font-bold text-lg text-white">Asaduría Beto Pollos</h1>
            <p class="text-xs text-slate-400">Vitrina Disponible: <strong class="font-mono text-amber-400">\${avail} pollos</strong> · Reservados: <strong class="font-mono">\${reserved}</strong></p>
          </div>
          <div class="flex items-center gap-2">
            <button onclick="modifyAllPricesPrompt()" class="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-amber-400 font-semibold text-xs flex items-center gap-1 hover:bg-slate-700">🔒 Modificar Precios</button>
            <button onclick="exportExcel()" class="px-3 py-2 rounded-lg bg-amber-500 text-slate-950 font-semibold text-xs">Descargar Excel (.xlsx)</button>
          </div>
        </header>
        <main class="p-4">
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <div class="p-3 rounded-xl bg-slate-900 border border-slate-800"><div class="text-xs text-slate-400">Ventas Hoy</div><div class="text-lg font-mono font-bold text-white">\${formatCLP(gross)}</div></div>
            <div class="p-3 rounded-xl bg-slate-900 border border-slate-800"><div class="text-xs text-slate-400">Costo Insumos</div><div class="text-lg font-mono font-bold text-slate-200">\${formatCLP(cogs)}</div></div>
            <div class="p-3 rounded-xl bg-slate-900 border border-slate-800"><div class="text-xs text-slate-400">Mermas + Caja Chica</div><div class="text-lg font-mono font-bold text-rose-400">\${formatCLP(wasteCost + petty)}</div></div>
            <div class="p-3 rounded-xl bg-slate-900 border border-slate-800"><div class="text-xs text-slate-400">Utilidad Neta Real</div><div class="text-lg font-mono font-bold text-emerald-400">\${formatCLP(net)}</div></div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            \${state.products.map(p => \`
              <div class="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <div class="font-semibold text-sm text-white truncate cursor-pointer hover:text-amber-300 flex items-center gap-1" onclick="modifyName('\${p.id}')" title="Clic para modificar nombre (clave: Betopollos)">
                    <span>\${p.name}</span>
                    <span class="text-xs text-slate-500">✏️</span>
                  </div>
                  <button onclick="modifyPrice('\${p.id}')" class="font-mono text-amber-400 font-bold hover:underline flex items-center gap-1" title="Clic para modificar precio (clave: Betopollos)">
                    <span>\${formatCLP(p.price)}</span>
                    <span class="text-xs text-slate-400">✏️</span>
                  </button>
                  <div class="text-xs text-slate-400">Costo receta: \${formatCLP(getProdCost(p))}</div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <button onclick="addToCart('\${p.id}', -1)" class="w-10 h-10 rounded-lg bg-slate-800 text-white font-bold">-</button>
                  <span class="font-mono w-6 text-center">\${cart[p.id] || 0}</span>
                  <button onclick="addToCart('\${p.id}', 1)" class="w-10 h-10 rounded-lg bg-amber-500 text-slate-950 font-bold">+</button>
                </div>
              </div>
            \`).join('')}
          </div>
          \${Object.keys(cart).length ? \`
            <div class="mt-6 p-4 rounded-2xl bg-slate-900 border border-amber-500/40 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div class="font-mono text-lg font-bold">Total Carrito: \${formatCLP(Object.entries(cart).reduce((a,[id,q]) => a + (state.products.find(x=>x.id===id)?.price||0)*q, 0))}</div>
              <button onclick="checkoutPOS()" class="w-full sm:w-auto px-6 py-3 rounded-xl bg-emerald-500 text-slate-950 font-bold">Confirmar Venta en POS</button>
            </div>
          \` : ''}
        </main>
      \`;
    }
    render();
  </script>
</body>
</html>`;

  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Asaduria_Beto_Pollos_UnicoArchivo_${currentState.businessDate}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
