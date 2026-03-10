// ============================================================
// DATA
// ============================================================


// ============================================================
// ACCESORIOS — se cargan desde Firebase o desde el fallback demo
// ============================================================

const SERVICES = [
  { id:'instalacion', name:'Instalación nueva', desc:'Primera instalación del equipo', price:100000, emoji:'🏗️' },
  { id:'mantencion', name:'Mantención', desc:'Limpieza y revisión general', price:30000, emoji:'🔧' },
  { id:'cambio', name:'Cambio + instalación', desc:'Retiro equipo antiguo + nuevo', price:120000, emoji:'🔄' },
  { id:'reparacion', name:'Reparación', desc:'Diagnóstico y reparación de fallas', price:10000, emoji:'⚙️' },
  { id:'garantia', name:'Visita garantía', desc:'Revisión por garantía vigente', price:0, emoji:'✅' },
  { id:'presupuesto', name:'Solo presupuesto', desc:'Cotización sin instalación', price:0, emoji:'📋' },
];

// ============================================================
// FIREBASE REALTIME DATABASE CONFIG
// ▶ Pega aqui tu conexion principal (opcional).
// Si dejas databaseURL vacio, la app usara lo guardado en el modal.
// ============================================================
const FIREBASE_CONNECTION = {
  databaseURL: 'https://cotizaciones-app-ece65-default-rtdb.firebaseio.com/', // Ejemplo: 'https://mi-proyecto-default-rtdb.firebaseio.com'
  node: 'air_conditioners', // Nodo donde vive el array de equipos
  authToken: '' // Opcional: token/secret si tus reglas requieren auth para leer
};

// ============================================================
// STATE
// ============================================================
let allAC = [];
let filteredAC = [];
let selectedAC = null;
let selectedBTU = null;
let selectedEquipments = {};
let selectedService = null;
let accQty = {};
let currentStep = 1;
let quoteNumber = '';
let toastTimer = null;
let repairQty = 1;
let repairUnitValue = 10000;
let serviceQtyMap = { instalacion: 0, mantencion: 0 };

function equipKey(idx, btu) {
  return `${idx}__${btu}`;
}

function getSelectedEquipmentItems() {
  return Object.entries(selectedEquipments)
    .map(([key, qty]) => {
      const [idxStr, btuStr] = key.split('__');
      const idx = Number(idxStr);
      const btu = Number(btuStr);
      const ac = allAC[idx];
      if (!ac || !qty) return null;
      const cap = (ac.capacities || []).find(c => Number(c.btu_capacity) === btu);
      if (!cap) return null;
      return { key, idx, btu, qty, ac, cap };
    })
    .filter(Boolean);
}

function getEquipmentTotalPrice() {
  return getSelectedEquipmentItems().reduce((sum, item) => sum + (item.cap.price_with_tax * item.qty), 0);
}

function updateStep1NextButton() {
  const btn = document.getElementById('btnStep1Next');
  if (!btn) return;
  const hasItems = getSelectedEquipmentItems().length > 0;
  btn.disabled = !hasItems;
  btn.style.opacity = hasItems ? '1' : '0.4';
}

function preloadInstallationsFromEquipment() {
  const equipCount = getSelectedEquipmentItems().reduce((sum, item) => sum + item.qty, 0);
  if (equipCount === 0) {
    serviceQtyMap.instalacion = 0;
  } else if ((serviceQtyMap.instalacion || 0) === 0) {
    // Precarga por defecto: 1 instalacion por cada equipo agregado.
    serviceQtyMap.instalacion = equipCount;
  }
  updateMultiServiceInputs();
  updateStep2NextButton();
  renderServiceGrid();
}

// ============================================================
// INIT
// ============================================================
function init() {
  try { generateQuoteNumber(); } catch(e) {}
  try { renderAccGrid(); } catch(e) {}
  try { renderServiceGrid(); } catch(e) {}
  try { updateMultiServiceInputs(); } catch(e) {}
  try { updateStep2NextButton(); } catch(e) {}

  // Priorizar Firebase al iniciar. Si no hay config o falla, usar demo.
  const savedCfg = getSavedFirebaseConfig();
  const activeUrl = FIREBASE_CONNECTION.databaseURL || savedCfg.databaseURL;
  const activeNode = FIREBASE_CONNECTION.node || savedCfg.node || 'air_conditioners';
  const activeToken = FIREBASE_CONNECTION.authToken || savedCfg.authToken || '';

  if (activeUrl) {
    // Carga equipos y accesorios en paralelo desde Firebase
    loadFromFirebase(activeUrl, activeNode, activeToken);
    loadAccessoriesFromFirebase(activeUrl, activeToken);
  } else {
    loadDemoData();
    showFirebaseStatus('error', 'Sin Firebase configurado — usando datos demo');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// ============================================================
// FIREBASE REALTIME DATABASE - CARGA DE DATOS
// ============================================================

/**
 * Carga equipos desde Firebase Realtime Database.
 * La URL pública termina en /<nodo>.json sin necesidad de API key
 * cuando las reglas permiten lectura pública.
 */
async function loadFromFirebase(url, node, authToken = '') {
  const cleanUrl = url.replace(/\/$/, ''); // quitar slash final si existe
  const endpoint = buildFirebaseEndpoint(cleanUrl, node, authToken);

  try {
    showFirebaseStatus('connecting');
    const res = await fetch(endpoint);

    if (!res.ok) throw new Error(`HTTP ${res.status} — verifica la URL y las reglas de lectura`);

    const raw = await res.json();

    if (!raw) throw new Error('El nodo está vacío en Firebase');

    // Firebase guarda arrays como objetos numéricos {0:{...}, 1:{...}}
    // cuando se importa un JSON. Esta función los normaliza de vuelta a arrays.
    const data = normalizeFirebaseArrays(raw);

    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('No se encontraron equipos en el nodo indicado');
    }

    allAC = data;
    filteredAC = [...allAC];
    renderBrandFilterOptions();
    renderACGrid();
    updateStep1NextButton();
    showFirebaseStatus('ok', `${data.length} equipos cargados desde Firebase`);
    showToast(`✅ ${data.length} equipos actualizados`, 'success');

  } catch(e) {
    showFirebaseStatus('error', e.message);
    showToast('Firebase: usando datos demo', 'error');
    if (!Array.isArray(allAC) || allAC.length === 0) loadDemoData();
  }
}

/**
 * Carga accesorios desde Firebase Realtime Database.
 * Nodo: accessories (mismo proyecto que air_conditioners)
 * Si falla, mantiene los accesorios demo definidos en ACCESSORIES.
 */
async function loadAccessoriesFromFirebase(url, authToken = '') {
  const cleanUrl = url.replace(/\/$/, '');
  const endpoint = authToken
    ? `${cleanUrl}/accessories.json?auth=${authToken}`
    : `${cleanUrl}/accessories.json`;

  try {
    const res = await fetch(endpoint);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    if (!raw) throw new Error('Nodo accessories vacío');

    const data = normalizeFirebaseArrays(raw);
    if (!Array.isArray(data) || data.length === 0) throw new Error('Sin accesorios');

    ACCESSORIES = data;
    accQty = {}; // reset cantidades al recargar
    renderAccGrid();
    // console.log(`✅ ${data.length} accesorios cargados desde Firebase`);

  } catch(e) {
    // Silencioso — mantiene los accesorios demo ya definidos
    console.warn('Accesorios: usando datos demo —', e.message);
  }
}

/**
 * Convierte objetos con claves numéricas (formato Firebase) en arrays.
 * Aplica de forma recursiva para manejar arrays anidados (capacities).
 */
function normalizeFirebaseArrays(obj) {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(normalizeFirebaseArrays);

  if (typeof obj === 'object') {
    const keys = Object.keys(obj);
    const allNumeric = keys.length > 0 && keys.every(k => /^\d+$/.test(k));

    if (allNumeric) {
      // Es un array disfrazado de objeto
      return keys
        .sort((a, b) => Number(a) - Number(b))
        .map(k => normalizeFirebaseArrays(obj[k]));
    }

    // Es un objeto normal → normalizar sus valores recursivamente
    const result = {};
    keys.forEach(k => result[k] = normalizeFirebaseArrays(obj[k]));
    return result;
  }

  return obj;
}

// ============================================================
// PERSISTENCIA DE CONFIG EN LOCALSTORAGE
// ============================================================
function getSavedFirebaseConfig() {
  try {
    return {
      databaseURL: localStorage.getItem('fb_rtdb_url') || '',
      node: localStorage.getItem('fb_rtdb_node') || 'air_conditioners',
      authToken: localStorage.getItem('fb_rtdb_token') || ''
    };
  } catch(e) {
    return { databaseURL: '', node: 'air_conditioners', authToken: '' };
  }
}

function buildFirebaseEndpoint(url, node, authToken = '') {
  const cleanUrl = (url || '').trim().replace(/\/$/, '');
  const safeNode = (node || 'air_conditioners').replace(/^\/+|\/+$/g, '');
  let endpoint = '';

  if (/\.json(\?|$)/i.test(cleanUrl)) {
    endpoint = cleanUrl;
  } else if (cleanUrl.endsWith(`/${safeNode}`)) {
    endpoint = `${cleanUrl}.json`;
  } else {
    endpoint = `${cleanUrl}/${safeNode}.json`;
  }

  if (authToken) {
    const separator = endpoint.includes('?') ? '&' : '?';
    endpoint += `${separator}auth=${encodeURIComponent(authToken)}`;
  }

  return endpoint;
}

function saveFirebaseConfig() {
  const urlInput = document.getElementById('cfgFirebaseUrl').value.trim();
  const nodeInput = document.getElementById('cfgNode').value.trim() || 'air_conditioners';
  const tokenInput = document.getElementById('cfgToken').value.trim();

  if (!urlInput || !urlInput.startsWith('https://')) {
    showCfgStatus('error', '⚠️ La URL debe comenzar con https://');
    return;
  }

  try { localStorage.setItem('fb_rtdb_url', urlInput); } catch(e) {}
  try { localStorage.setItem('fb_rtdb_node', nodeInput); } catch(e) {}
  try { localStorage.setItem('fb_rtdb_token', tokenInput); } catch(e) {}

  showCfgStatus('loading', '🔄 Conectando con Firebase…');
  loadFromFirebaseModal(urlInput, nodeInput, tokenInput);
}

async function loadFromFirebaseModal(url, node, authToken = '') {
  const cleanUrl = url.replace(/\/$/, '');
  const endpoint = buildFirebaseEndpoint(cleanUrl, node, authToken);

  try {
    const res = await fetch(endpoint);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    if (!raw) throw new Error('Nodo vacío');

    const data = normalizeFirebaseArrays(raw);
    if (!Array.isArray(data) || data.length === 0) throw new Error('Sin equipos en ese nodo');

    allAC = data;
    filteredAC = [...allAC];
    renderBrandFilterOptions();
    renderACGrid();
    updateStep1NextButton();

    // También recargar accesorios desde el mismo proyecto Firebase
    loadAccessoriesFromFirebase(cleanUrl, authToken);

    showCfgStatus('ok', `✅ Conectado — ${data.length} equipos cargados`);
    showToast(`✅ Firebase conectado · ${data.length} equipos`, 'success');

    setTimeout(() => closeConfigModal(), 1800);

  } catch(e) {
    showCfgStatus('error', `❌ Error: ${e.message}`);
  }
}

function showCfgStatus(type, msg) {
  const el = document.getElementById('cfgStatus');
  if (!el) return;
  el.style.display = 'block';
  el.textContent = msg;
  const styles = {
    ok:      'background:rgba(45,90,61,0.1); border:1px solid rgba(45,90,61,0.3); color:#2d5a3d;',
    error:   'background:rgba(139,46,15,0.1); border:1px solid rgba(139,46,15,0.3); color:#8b2e0f;',
    loading: 'background:rgba(26,58,92,0.08); border:1px solid rgba(26,58,92,0.2); color:#1a3a5c;',
  };
  el.style.cssText += styles[type] || styles.loading;
}

function showFirebaseStatus(type, msg) {
  const dot = document.getElementById('fbStatusDot');
  if (!dot) return;
  if (type === 'connecting') {
    dot.style.background = 'rgba(201,168,76,0.8)';
    dot.title = 'Conectando con Firebase…';
  } else if (type === 'ok') {
    dot.style.background = '#6fcf97';
    dot.title = msg || 'Firebase conectado';
  } else {
    dot.style.background = 'rgba(255,100,80,0.7)';
    dot.title = msg || 'Error Firebase — usando datos demo';
  }
}

function getFirebaseConfig() {
  // Mantenido por compatibilidad — ya no se usa en el nuevo flujo
  return null;
}

function generateQuoteNumber() {
  const d = new Date();
  const pad = n => String(n).padStart(2,'0');
  quoteNumber = `COT-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${Math.floor(Math.random()*9000+1000)}`;
  document.getElementById('quoteNumHeader').textContent = quoteNumber;
}

function loadDemoData() {
  allAC = DEMO_DATA;
  filteredAC = [...allAC];
  renderBrandFilterOptions();
  renderACGrid();
  updateStep1NextButton();
}

function renderBrandFilterOptions() {
  const brandSelect = document.getElementById('filterBrand');
  if (!brandSelect) return;

  const selected = brandSelect.value;
  const brands = [...new Set(
    allAC
      .map(ac => (ac.marca || '').trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'es'));

  brandSelect.innerHTML = '<option value="">Todas las marcas</option>' +
    brands.map(brand => `<option value="${brand}">${brand}</option>`).join('');

  if (selected && brands.includes(selected)) {
    brandSelect.value = selected;
  }
}

// ============================================================
// RENDER AC GRID
// ============================================================
function renderACGrid() {
  try {
  const grid = document.getElementById('acGrid');
  const count = document.getElementById('resultsCount');
  if (!grid) return;
  if (filteredAC.length === 0) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p>No se encontraron equipos con esos filtros.</p></div>`;
    if (count) count.innerHTML = '';
    return;
  }
  if (count) count.innerHTML = `<span>${filteredAC.length}</span> equipo${filteredAC.length!==1?'s':''} encontrado${filteredAC.length!==1?'s':''}`;
  grid.innerHTML = filteredAC.map((ac, idx) => {
    const origIdx = allAC.indexOf(ac);
    const selectedItems = (ac.capacities || [])
      .map(c => ({ btu: Number(c.btu_capacity), qty: selectedEquipments[equipKey(origIdx, Number(c.btu_capacity))] || 0, cap: c }))
      .filter(item => item.qty > 0);
    const isSelected = selectedItems.length > 0;
    const brand = (ac.marca || '').trim();
    const displayName = brand ? `${brand} ${ac.brand_model}` : ac.brand_model;
    const refBadge = ac.refrigerant === 'R32' ? 'badge-r32' : 'badge-r410';
    const wifiLabel = ac.wifi === 'Yes' ? '📶 WiFi' : ac.wifi === 'Optional' ? '📶 WiFi opcional' : '📶 WiFi universal';
    const warYears = ac.warranty && ac.warranty.includes('3') ? '3 años' : '1 año';
    return `
    <div class="ac-card ${isSelected ? 'selected' : ''}" id="accard-${origIdx}">
      <div class="ac-header">
        <div>
          <div class="ac-brand">${displayName}</div>
          <div class="ac-type">${ac.type}</div>
        </div>
        <span class="ac-badge ${refBadge}">${ac.refrigerant}</span>
      </div>
      <div class="ac-specs">
        <span class="spec-tag wifi">${wifiLabel}</span>
        <span class="spec-tag warranty">🛡️ ${warYears}</span>
        <span class="spec-tag">📦 Kit ${ac.installation_kit}</span>
      </div>
      <div class="btu-label">Capacidad BTU</div>
      <div class="btu-options">
        ${ac.capacities.map(c => `
          <button class="btu-btn ${(selectedEquipments[equipKey(origIdx, Number(c.btu_capacity))] || 0) > 0 ? 'selected' : ''}"
            onclick="selectAC(${origIdx}, ${c.btu_capacity}); event.stopPropagation()">
            ${(c.btu_capacity/1000).toFixed(0)}K${(selectedEquipments[equipKey(origIdx, Number(c.btu_capacity))] || 0) > 0 ? ` x${selectedEquipments[equipKey(origIdx, Number(c.btu_capacity))] || 0}` : ''}
          </button>
        `).join('')}
      </div>
      ${isSelected ? renderACPrice(origIdx) : ''}
    </div>`;
  }).join('');
  } catch(err) {
    const grid = document.getElementById('acGrid');
    if (grid) grid.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>Error al cargar: ${err.message}</p></div>`;
  }
}

function renderACPrice(idx) {
  const ac = allAC[idx];
  const selectedItems = (ac.capacities || [])
    .map(c => ({ btu: Number(c.btu_capacity), qty: selectedEquipments[equipKey(idx, Number(c.btu_capacity))] || 0, cap: c }))
    .filter(item => item.qty > 0);
  if (!selectedItems.length) return '';

  const detailRows = selectedItems.map(item => {
    const subtotal = item.cap.price_with_tax * item.qty;
    return `<div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <span>${(item.btu/1000).toFixed(0)}K x ${item.qty}</span>
      <span style="display:flex;align-items:center;gap:4px;">
        <button class="btu-btn" style="padding:2px 7px;" onclick="changeEquipmentQty(${idx}, ${item.btu}, -1); event.stopPropagation()">-</button>
        <button class="btu-btn" style="padding:2px 7px;" onclick="changeEquipmentQty(${idx}, ${item.btu}, 1); event.stopPropagation()">+</button>
      </span>
      <span style="font-family:'DM Mono',monospace;color:var(--accent);">$${fmtNum(subtotal)}</span>
    </div>`;
  }).join('');

  const total = selectedItems.reduce((sum, item) => sum + item.cap.price_with_tax * item.qty, 0);
  return `
    <div class="ac-price">
      <div style="width:100%;">
        ${detailRows}
        <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--border);padding-top:6px;">
          <div class="price-net">Total equipo</div>
          <div class="price-iva">$${fmtNum(total)} <span>c/IVA</span></div>
        </div>
      </div>
    </div>`;
}

function selectAC(idx, btu) {
  const key = equipKey(idx, Number(btu));
  selectedEquipments[key] = (selectedEquipments[key] || 0) + 1;
  selectedAC = idx;
  selectedBTU = btu;
  updateStep1NextButton();
  renderACGrid();
  showToast(`✅ ${allAC[idx].brand_model} · ${(btu/1000).toFixed(0)}K (x${selectedEquipments[key]})`, 'success');
}

function changeEquipmentQty(idx, btu, delta) {
  const key = equipKey(idx, Number(btu));
  const nextQty = Math.max(0, (selectedEquipments[key] || 0) + delta);
  if (nextQty === 0) {
    delete selectedEquipments[key];
  } else {
    selectedEquipments[key] = nextQty;
  }
  updateStep1NextButton();
  renderACGrid();
}

function filterAC() {
  const search = document.getElementById('searchInput').value.toLowerCase();
  const brand = document.getElementById('filterBrand').value;
  const btu = parseInt(document.getElementById('filterBTU').value) || 0;
  const ref = document.getElementById('filterRef').value;
  // const warranty = document.getElementById('filterWarranty').value;
  // const wifi = document.getElementById('filterWifi').value;

  filteredAC = allAC.filter(ac => {
    const brandName = (ac.marca || '').toLowerCase();
    const modelName = (ac.brand_model || '').toLowerCase();
    if (search && !brandName.includes(search) && !modelName.includes(search)) return false;
    if (brand && (ac.marca || '') !== brand) return false;
    if (ref && ac.refrigerant !== ref) return false;
    // if (wifi && ac.wifi !== wifi) return false;
    // if (warranty === '1' && !ac.warranty.includes('1')) return false;
    // if (warranty === '3' && !ac.warranty.includes('3')) return false;
    if (btu && !ac.capacities.find(c => c.btu_capacity === btu)) return false;
    return true;
  });
  renderACGrid();
}

// ============================================================
// RENDER SERVICE GRID
// ============================================================
function renderServiceGrid() {
  document.getElementById('serviceGrid').innerHTML = SERVICES.map(s => `
    ${(() => {
      const qty = Math.max(0, serviceQtyMap[s.id] || 0);
      const displayPrice = s.id === 'reparacion'
        ? repairQty * repairUnitValue
        : ((isMultiService(s.id)) ? qty * s.price : s.price);
      const isActive = isMultiService(s.id) ? qty > 0 : selectedService === s.id;
      return `
    <div class="service-card ${isActive ? 'selected' : ''}" onclick="selectService('${s.id}')">
      <div class="service-emoji">${s.emoji}</div>
      <div class="service-name">${s.name}</div>
      <div class="service-price">${displayPrice > 0 ? '$'+fmtNum(displayPrice) : (isMultiService(s.id) ? 'No agregado' : 'Sin costo')}</div>
    </div>
  `;
    })()}
  `).join('');
}

function isMultiService(id) {
  return id === 'instalacion' || id === 'mantencion';
}

function updateStep2NextButton() {
  const btn = document.getElementById('btnStep2Next');
  if (!btn) return;
  const hasMulti = (serviceQtyMap.instalacion || 0) > 0 || (serviceQtyMap.mantencion || 0) > 0;
  const hasSingle = !!selectedService;
  const enabled = hasMulti || hasSingle;
  btn.disabled = !enabled;
  btn.style.opacity = enabled ? '1' : '0.4';
}

function selectService(id) {
  if (isMultiService(id)) {
    serviceQtyMap[id] = Math.max(0, (serviceQtyMap[id] || 0) + 1);
    updateMultiServiceInputs();
    renderServiceGrid();
    updateStep2NextButton();
    showToast(`✅ ${id === 'instalacion' ? 'Instalaciones' : 'Mantenciones'}: ${serviceQtyMap[id]}`, 'success');
    return;
  }

  selectedService = selectedService === id ? null : id;
  toggleRepairInputs();
  renderServiceGrid();
  updateStep2NextButton();
  showToast('✅ Servicio seleccionado', 'success');
}

function updateMultiServiceInputs() {
  const instInput = document.getElementById('serviceQtyInstInput');
  const mantInput = document.getElementById('serviceQtyMantInput');
  if (instInput) instInput.value = Math.max(0, serviceQtyMap.instalacion || 0);
  if (mantInput) mantInput.value = Math.max(0, serviceQtyMap.mantencion || 0);
  updateServiceQtyPreview();
}

function updateServiceQtyPreview() {
  const preview = document.getElementById('serviceQtyPreview');
  const instSvc = SERVICES.find(s => s.id === 'instalacion');
  const mantSvc = SERVICES.find(s => s.id === 'mantencion');
  if (!preview || !instSvc || !mantSvc) return;
  const instTotal = (serviceQtyMap.instalacion || 0) * instSvc.price;
  const mantTotal = (serviceQtyMap.mantencion || 0) * mantSvc.price;
  preview.textContent = `Instalación: $${fmtNum(instTotal)} · Mantención: $${fmtNum(mantTotal)}`;
}

function updateServiceQtyValue() {
  const instInput = document.getElementById('serviceQtyInstInput');
  const mantInput = document.getElementById('serviceQtyMantInput');
  serviceQtyMap.instalacion = Math.max(0, parseInt((instInput && instInput.value) || '0', 10) || 0);
  serviceQtyMap.mantencion = Math.max(0, parseInt((mantInput && mantInput.value) || '0', 10) || 0);
  updateMultiServiceInputs();
  renderServiceGrid();
  updateStep2NextButton();
}

function toggleRepairInputs() {
  const card = document.getElementById('repairConfigCard');
  if (!card) return;
  const isRepair = selectedService === 'reparacion';
  card.style.display = isRepair ? 'block' : 'none';
  if (isRepair) {
    updateRepairServiceValue();
  }
}

function updateRepairServiceValue() {
  const qtyEl = document.getElementById('repairQty');
  const unitEl = document.getElementById('repairUnitValue');
  const preview = document.getElementById('repairPreview');

  repairQty = Math.max(1, parseInt((qtyEl && qtyEl.value) || '1', 10) || 1);
  repairUnitValue = Math.max(0, parseFloat((unitEl && unitEl.value) || '0') || 0);

  if (qtyEl) qtyEl.value = repairQty;
  if (unitEl) unitEl.value = repairUnitValue;
  if (preview) preview.textContent = `Total reparación: $${fmtNum(repairQty * repairUnitValue)}`;

  if (selectedService === 'reparacion') {
    renderServiceGrid();
  }
}

function getCurrentServiceValues(svc) {
  if (!svc) return { qty: 0, unitPrice: 0, totalPrice: 0 };
  if (svc.id === 'reparacion') {
    const qty = Math.max(1, repairQty || 1);
    const unitPrice = Math.max(0, repairUnitValue || 0);
    return { qty, unitPrice, totalPrice: qty * unitPrice };
  }
  return { qty: 1, unitPrice: svc.price, totalPrice: svc.price };
}

function getSelectedServiceItems() {
  const items = [];

  ['instalacion', 'mantencion'].forEach(id => {
    const svc = SERVICES.find(s => s.id === id);
    const qty = Math.max(0, serviceQtyMap[id] || 0);
    if (svc && qty > 0) {
      items.push({ svc, qty, unitPrice: svc.price, totalPrice: qty * svc.price });
    }
  });

  if (selectedService && !isMultiService(selectedService)) {
    const svc = SERVICES.find(s => s.id === selectedService);
    if (svc) {
      const current = getCurrentServiceValues(svc);
      if (current.totalPrice > 0 || svc.price === 0) {
        items.push({ svc, qty: current.qty, unitPrice: current.unitPrice, totalPrice: current.totalPrice });
      }
    }
  }

  return items;
}

// ============================================================
// RENDER ACCESSORIES
// ============================================================
function renderAccGrid() {
  document.getElementById('accGrid').innerHTML = ACCESSORIES.map(acc => `
    <div class="acc-card">
      <div class="acc-icon" style="background:${acc.color}">${acc.icon}</div>
      <div class="acc-info">
        <div class="acc-name">${acc.name}</div>
        <div class="acc-desc">${acc.desc}</div>
      </div>
      <div>
        <div class="acc-price-tag">$${fmtNum(acc.price)}<small>c/u</small></div>
        <div class="qty-control" style="margin-top:6px">
          <button class="qty-btn" onclick="changeQty('${acc.id}', -1)">−</button>
          <input class="qty-val" id="qty-${acc.id}" value="${accQty[acc.id]||0}" readonly>
          <button class="qty-btn" onclick="changeQty('${acc.id}', 1)">+</button>
        </div>
      </div>
    </div>
  `).join('');
}

function changeQty(id, delta) {
  accQty[id] = Math.max(0, (accQty[id] || 0) + delta);
  document.getElementById('qty-'+id).value = accQty[id];
  updateAccSummary();
}

function updateAccSummary() {
  let total = 0, count = 0;
  ACCESSORIES.forEach(acc => {
    const q = accQty[acc.id] || 0;
    if (q > 0) { total += acc.price * q; count += q; }
  });
  const chip = document.getElementById('accSummaryChip');
  if (count > 0) {
    chip.style.display = 'block';
    document.getElementById('accSummaryText').textContent = `${count} ítem${count!==1?'s':''}`;
    document.getElementById('accSummaryPrice').textContent = '$'+fmtNum(total);
  } else {
    chip.style.display = 'none';
  }
}

// ============================================================
// STEP NAVIGATION
// ============================================================
function goToStep(n) {
  for (let i=1; i<=5; i++) {
    document.getElementById('page'+i).classList.toggle('active', i===n);
    document.getElementById('nav'+i).classList.toggle('active', i===n);
    const dot = document.getElementById('sd'+i);
    const lbl = document.getElementById('sl'+i);
    dot.className = 'step-dot ' + (i < n ? 'done' : i === n ? 'active' : '');
    lbl.className = 'step-label ' + (i < n ? 'done' : i === n ? 'active' : '');
    dot.textContent = i < n ? '✓' : i;
    if (i < 5) {
      document.getElementById('sline'+i).className = 'step-line ' + (i < n ? 'done' : '');
    }
  }
  currentStep = n;
  if (n === 2) {
    preloadInstallationsFromEquipment();
    renderServiceChip();
  }
  window.scrollTo(0,0);
}

function renderServiceChip() {
  const chip = document.getElementById('acSelectionChip');
  const selectedItems = getSelectedEquipmentItems();
  if (!selectedItems.length) { chip.innerHTML = ''; return; }
  const equipCount = selectedItems.reduce((sum, item) => sum + item.qty, 0);
  const equipTotal = selectedItems.reduce((sum, item) => sum + (item.cap.price_with_tax * item.qty), 0);
  chip.innerHTML = `
    <div class="selection-chip">
      <div class="chip-icon">❄️</div>
      <div class="chip-info">
        <div class="chip-title">Equipos seleccionados: ${equipCount}</div>
        <div class="chip-sub">${selectedItems.slice(0, 2).map(item => `${item.ac.brand_model} ${(item.btu/1000).toFixed(0)}K x${item.qty}`).join(' · ')}${selectedItems.length > 2 ? ' ...' : ''}</div>
      </div>
      <div>
        <div class="chip-price">$${fmtNum(equipTotal)}</div>
        <button class="chip-edit-btn" onclick="goToStep(1)">Cambiar</button>
      </div>
    </div>`;
}

// ============================================================
// BUILD SUMMARY
// ============================================================
function buildSummary() {
  const selectedEquipItems = getSelectedEquipmentItems();
  const selectedServiceItems = getSelectedServiceItems();

  // Quote info
  document.getElementById('sumQuoteNum').textContent = quoteNumber;
  document.getElementById('sumDate').textContent = new Date().toLocaleDateString('es-CL', {day:'2-digit',month:'long',year:'numeric'});

  // Client
  const name = document.getElementById('clientName').value || '—';
  const rut = document.getElementById('clientRut').value;
  const phone = document.getElementById('clientPhone').value || '—';
  const address = document.getElementById('clientAddress').value || '—';
  const city = document.getElementById('clientCity').value || '';
  const region = document.getElementById('clientRegion').value || '';
  document.getElementById('sumClientName').textContent = name;
  document.getElementById('sumClientRut').textContent = rut || '—';
  document.getElementById('sumRutRow').style.display = rut ? 'flex' : 'none';
  document.getElementById('sumClientPhone').textContent = phone;
  document.getElementById('sumClientAddress').textContent = `${address}${city?', '+city:''}${region?', '+region:''}`;

  // Equipment
  if (selectedEquipItems.length > 0) {
    const modelTxt = selectedEquipItems
      .map(item => `${item.ac.brand_model} ${(item.btu/1000).toFixed(0)}K x${item.qty}`)
      .join(' + ');
    const btuTxt = selectedEquipItems
      .map(item => `${(item.btu/1000).toFixed(0)}K x${item.qty}`)
      .join(' + ');
    const refs = [...new Set(selectedEquipItems.map(item => item.ac.refrigerant))].join(', ');
    document.getElementById('sumEquipModel').textContent = modelTxt;
    document.getElementById('sumEquipBtu').textContent = btuTxt;
    document.getElementById('sumEquipRef').textContent = refs;
    document.getElementById('sumEquipPrice').value = getEquipmentTotalPrice();
  } else {
    document.getElementById('sumEquipModel').textContent = 'Sin equipo';
    document.getElementById('sumEquipPrice').value = 0;
  }

  // Service
  if (selectedServiceItems.length > 0) {
    const serviceLabel = selectedServiceItems
      .map(item => `${item.svc.name} (${item.qty} x $${fmtNum(item.unitPrice)})`)
      .join(' + ');
    const serviceTotal = selectedServiceItems.reduce((acc, item) => acc + item.totalPrice, 0);
    document.getElementById('sumServiceName').textContent = serviceLabel;
    document.getElementById('sumServicePrice').value = serviceTotal;
    const notes = document.getElementById('serviceNotes').value;
    if (notes) {
      document.getElementById('sumNotesRow').style.display = 'flex';
      document.getElementById('sumNotes').textContent = notes;
    } else {
      document.getElementById('sumNotesRow').style.display = 'none';
    }
  } else {
    document.getElementById('sumServiceName').textContent = '—';
    document.getElementById('sumServicePrice').value = 0;
  }

  // Extras
  const extrasCard = document.getElementById('sumExtrasCard');
  const extrasList = document.getElementById('sumExtrasList');
  const activeExtras = ACCESSORIES.filter(acc => (accQty[acc.id]||0) > 0);
  if (activeExtras.length > 0) {
    extrasCard.style.display = 'block';
    extrasList.innerHTML = activeExtras.map(acc => {
      const q = accQty[acc.id];
      const subtotal = acc.price * q;
      return `<div class="summary-row">
        <div class="summary-row-label">${acc.name} × ${q}</div>
        <div class="summary-row-val">$${fmtNum(subtotal)}</div>
      </div>`;
    }).join('');
  } else {
    extrasCard.style.display = 'none';
  }

  recalcTotal();
}

function recalcTotal() {
  const equipPrice = parseFloat(document.getElementById('sumEquipPrice').value) || 0;
  const servicePrice = parseFloat(document.getElementById('sumServicePrice').value) || 0;
  let extrasTotal = 0;
  ACCESSORIES.forEach(acc => {
    extrasTotal += (accQty[acc.id]||0) * acc.price;
  });
  const subtotal = equipPrice + servicePrice + extrasTotal;
  const discPct = parseFloat(document.getElementById('discountPct').value) || 0;
  const discAmt = subtotal * discPct / 100;
  const total = subtotal - discAmt;
  document.getElementById('discountBadgeAmt').textContent = `−$${fmtNum(Math.round(discAmt))}`;
  document.getElementById('grandTotal').textContent = fmtNum(Math.round(total));
}

// ============================================================
// PDF GENERATION
// ============================================================
async function generatePDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const pageW = 210, margin = 18;
  let y = 0;

  // Header BG
  doc.setFillColor(13, 15, 20);
  doc.rect(0, 0, pageW, 45, 'F');

  // Accent bar
  doc.setFillColor(0, 229, 255);
  doc.rect(0, 0, 4, 45, 'F');

  // Logo PNG (si existe en la carpeta del proyecto)
  let titleX = 14;
  let subtitleX = 14;
  const logoSource = await getPdfLogoSource();
  if (logoSource) {
    doc.addImage(logoSource, 'PNG', 14, 8, 16, 16, undefined, 'FAST');
    titleX = 34;
    subtitleX = 34;
  }

  // Title
  doc.setTextColor(0, 229, 255);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text('RefriPro', titleX, 18);

  doc.setTextColor(200, 210, 230);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Sistema profesional de cotización HVAC', subtitleX, 25);

  // Quote number & date
  doc.setTextColor(140, 160, 200);
  doc.setFontSize(8);
  doc.text(document.getElementById('sumQuoteNum').textContent, pageW - margin, 14, { align: 'right' });
  doc.text(document.getElementById('sumDate').textContent, pageW - margin, 20, { align: 'right' });
  doc.setTextColor(0, 229, 255);
  doc.setFontSize(8);
  doc.text('Válido por 15 días', pageW - margin, 26, { align: 'right' });

  y = 55;

  // CLIENT SECTION
  const clientName = document.getElementById('clientName').value || '—';
  const clientRut = document.getElementById('clientRut').value || '';
  const clientPhone = document.getElementById('clientPhone').value || '—';
  const clientEmail = document.getElementById('clientEmail').value || '';
  const clientAddress = document.getElementById('clientAddress').value || '—';
  const clientCity = document.getElementById('clientCity').value || '';
  const clientRegion = document.getElementById('clientRegion').value || '';
  const clientProperty = document.getElementById('clientProperty').value || '';

  sectionHeader(doc, '  DATOS DEL CLIENTE', margin, y, pageW - margin*2);
  y += 10;

  const clientData = [
    ['Nombre', clientName],
    ...(clientRut ? [['RUT', clientRut]] : []),
    ['Teléfono', clientPhone],
    ...(clientEmail ? [['Email', clientEmail]] : []),
    ['Dirección', `${clientAddress}${clientCity?', '+clientCity:''}${clientRegion?', '+clientRegion:''}`],
    ...(clientProperty ? [['Inmueble', clientProperty]] : []),
  ];
  clientData.forEach(([label, val]) => {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(100, 120, 160);
    doc.text(label + ':', margin + 2, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(40, 50, 70);
    doc.text(val, margin + 35, y);
    y += 6;
  });
  y += 4;

  // EQUIPMENT
  const selectedEquipItems = getSelectedEquipmentItems();
  const selectedServiceItems = getSelectedServiceItems();
  const activeExtras = ACCESSORIES.filter(acc => (accQty[acc.id]||0) > 0);

  sectionHeader(doc, '  DETALLE EQUIPOS Y SERVICIOS', margin, y, pageW - margin*2);
  y += 8;

  const tableBody = [];

  selectedEquipItems.forEach(item => {
    tableBody.push([
      `${item.ac.brand_model}\n${item.ac.type} · ${item.ac.refrigerant} · Kit ${item.ac.installation_kit}`,
      `${(item.btu/1000).toFixed(0)}.000 BTU`,
      String(item.qty),
      `$${fmtNum(item.cap.net_price)}`,
      `$${fmtNum(item.cap.price_with_tax * item.qty)}`
    ]);
  });

  selectedServiceItems.forEach(item => {
    const serviceDesc = `${item.svc.emoji} ${item.svc.name}\n${item.svc.desc} · ${item.qty} x $${fmtNum(item.unitPrice)}`;
    tableBody.push([
      serviceDesc,
      'Servicio',
      String(item.qty),
      item.totalPrice > 0 ? `$${fmtNum(Math.round(item.totalPrice/1.19))}` : '$0',
      item.totalPrice > 0 ? `$${fmtNum(item.totalPrice)}` : 'Sin costo'
    ]);
  });

  activeExtras.forEach(acc => {
    const q = accQty[acc.id];
    tableBody.push([
      `${acc.icon} ${acc.name}\n${acc.desc}`,
      'Accesorio',
      String(q),
      `$${fmtNum(acc.price)}`,
      `$${fmtNum(acc.price * q)}`
    ]);
  });

  doc.autoTable({
    startY: y,
    head: [['DESCRIPCIÓN', 'TIPO', 'CANT.', 'P. NETO', 'P. c/IVA']],
    body: tableBody,
    margin: { left: margin, right: margin },
    styles: { fontSize: 8, font: 'helvetica', cellPadding: 4, textColor: [40, 50, 70] },
    headStyles: {
      fillColor: [13, 15, 20],
      textColor: [0, 229, 255],
      fontStyle: 'bold',
      fontSize: 8
    },
    alternateRowStyles: { fillColor: [245, 247, 252] },
    columnStyles: {
      0: { cellWidth: 72 },
      1: { cellWidth: 22, halign: 'center' },
      2: { cellWidth: 14, halign: 'center' },
      3: { cellWidth: 28, halign: 'right' },
      4: { cellWidth: 28, halign: 'right', fontStyle: 'bold' }
    },
  });

  y = doc.lastAutoTable.finalY + 8;

  // TOTALS
  const equipP = parseFloat(document.getElementById('sumEquipPrice').value) || 0;
  const svcP = parseFloat(document.getElementById('sumServicePrice').value) || 0;
  let extrasP = 0;
  ACCESSORIES.forEach(acc => { extrasP += (accQty[acc.id]||0) * acc.price; });
  const subtotal = equipP + svcP + extrasP;
  const discPct = parseFloat(document.getElementById('discountPct').value) || 0;
  const discAmt = subtotal * discPct / 100;
  const total = subtotal - discAmt;

  const totX = pageW - margin - 70;
  const totW = 70;

  doc.setFillColor(245, 247, 252);
  doc.rect(totX, y, totW, discPct > 0 ? 28 : 20, 'F');

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(80, 90, 110);
  doc.text('Subtotal:', totX + 4, y + 7);
  doc.text(`$${fmtNum(Math.round(subtotal))}`, totX + totW - 4, y + 7, { align: 'right' });

  if (discPct > 0) {
    doc.setTextColor(200, 120, 0);
    doc.text(`Descuento (${discPct}%):`, totX + 4, y + 14);
    doc.text(`−$${fmtNum(Math.round(discAmt))}`, totX + totW - 4, y + 14, { align: 'right' });
    y += 7;
  }

  doc.setFillColor(0, 229, 255);
  doc.rect(totX, y + 12, totW, 10, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(13, 15, 20);
  doc.setFontSize(10);
  doc.text('TOTAL:', totX + 4, y + 19);
  doc.text(`$${fmtNum(Math.round(total))}`, totX + totW - 4, y + 19, { align: 'right' });

  y += 30;

  // SERVICE NOTES
  const notes = document.getElementById('serviceNotes').value;
  if (notes) {
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(80, 90, 110);
    doc.text('Observaciones:', margin, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 70, 90);
    const lines = doc.splitTextToSize(notes, pageW - margin*2);
    doc.text(lines, margin, y);
    y += lines.length * 4 + 6;
  }

  // CLIENT NOTES
  const clientNotes = document.getElementById('clientNotes').value;
  if (clientNotes) {
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(80, 90, 110);
    doc.text('Notas adicionales:', margin, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 70, 90);
    const lines = doc.splitTextToSize(clientNotes, pageW - margin*2);
    doc.text(lines, margin, y);
    y += lines.length * 4 + 6;
  }

  // FOOTER
  const pageH = 297;
  doc.setFillColor(13, 15, 20);
  doc.rect(0, pageH - 18, pageW, 18, 'F');
  doc.setFillColor(0, 229, 255);
  doc.rect(0, pageH - 18, 4, 18, 'F');
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(140, 160, 200);
  doc.text('RefriPro · Generado con CotizaClima App', margin + 4, pageH - 9);
  doc.setTextColor(0, 229, 255);
  doc.text(quoteNumber, pageW - margin, pageH - 9, { align: 'right' });

  doc.save(`${quoteNumber}.pdf`);
  showToast('📄 PDF generado correctamente', 'success');
}

let pdfLogoCache = null;

async function getPdfLogoSource() {
  if (pdfLogoCache) return pdfLogoCache;

  // Prioriza carga como Image para soportar mejor apertura local (file://).
  const img = await loadImageFromCandidates(['refripro.png', './refripro.png', '/refripro.png']);
  if (img) {
    pdfLogoCache = img;
    return img;
  }

  // Fallback: intentar data URL via fetch para escenarios HTTP.
  const dataUrl = await getPdfLogoDataUrlFallback();
  if (dataUrl) {
    pdfLogoCache = dataUrl;
    return dataUrl;
  }

  return null;
}

function loadImageFromCandidates(candidates) {
  return new Promise((resolve) => {
    let i = 0;
    const tryNext = () => {
      if (i >= candidates.length) {
        resolve(null);
        return;
      }
      const path = candidates[i++];
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => tryNext();
      img.src = path;
    };
    tryNext();
  });
}

async function getPdfLogoDataUrlFallback() {
  const candidates = ['refripro.png', './refripro.png'];
  for (const path of candidates) {
    try {
      const res = await fetch(path);
      if (!res.ok) continue;
      const blob = await res.blob();
      const dataUrl = await blobToDataUrl(blob);
      if (dataUrl) return dataUrl;
    } catch (e) {
      // Ignorar y probar siguiente ruta
    }
  }
  return null;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function sectionHeader(doc, text, x, y, w) {
  doc.setFillColor(13, 15, 20);
  doc.rect(x, y - 5, w, 8, 'F');
  doc.setTextColor(0, 229, 255);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text(text, x + 2, y);
}

// ============================================================
// HELPERS
// ============================================================
function fmtNum(n) {
  return Math.round(n).toLocaleString('es-CL');
}

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  if (!t) return;

  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }

  t.classList.remove('show', 'success', 'error');
  t.textContent = msg;
  t.classList.add(type === 'error' ? 'error' : 'success');

  // Force reflow so quick consecutive toasts re-trigger animation cleanly.
  void t.offsetWidth;

  t.classList.add('show');
  toastTimer = setTimeout(() => {
    t.classList.remove('show');
    toastTimer = null;
  }, 2600);
}

function resetAll() {
  selectedAC = null;
  selectedBTU = null;
  selectedEquipments = {};
  selectedService = null;
  accQty = {};
  document.getElementById('clientName').value = '';
  document.getElementById('clientRut').value = '';
  document.getElementById('clientPhone').value = '';
  document.getElementById('clientEmail').value = '';
  document.getElementById('clientAddress').value = '';
  document.getElementById('clientCity').value = '';
  document.getElementById('clientNotes').value = '';
  document.getElementById('serviceNotes').value = '';
  document.getElementById('discountPct').value = '';
  updateStep1NextButton();
  repairQty = 1;
  repairUnitValue = 55000;
  serviceQtyMap = { instalacion: 0, mantencion: 0 };
  const repairQtyEl = document.getElementById('repairQty');
  const repairUnitEl = document.getElementById('repairUnitValue');
  const serviceQtyInstEl = document.getElementById('serviceQtyInstInput');
  const serviceQtyMantEl = document.getElementById('serviceQtyMantInput');
  if (repairQtyEl) repairQtyEl.value = 1;
  if (repairUnitEl) repairUnitEl.value = 55000;
  if (serviceQtyInstEl) serviceQtyInstEl.value = 0;
  if (serviceQtyMantEl) serviceQtyMantEl.value = 0;
  updateMultiServiceInputs();
  toggleRepairInputs();
  updateStep2NextButton();
  generateQuoteNumber();
  renderACGrid();
  renderAccGrid();
  renderServiceGrid();
  goToStep(1);
  showToast('🔄 Nueva cotización iniciada', 'success');
}

function closeConfigModal() {
  document.getElementById('configModal').classList.remove('open');
}

// ⚙️ Doble click en logo abre configuración Firebase
document.querySelector('.logo-icon').addEventListener('dblclick', () => {
  // Pre-llenar con URL guardada si existe
  try {
    const savedCfg = getSavedFirebaseConfig();
    const urlInput = document.getElementById('cfgFirebaseUrl');
    const nodeInput = document.getElementById('cfgNode');
    const tokenInput = document.getElementById('cfgToken');
    if (urlInput && savedCfg.databaseURL) urlInput.value = savedCfg.databaseURL;
    if (nodeInput) nodeInput.value = savedCfg.node;
    if (tokenInput) tokenInput.value = savedCfg.authToken;
  } catch(e) {}
  // Limpiar estado anterior
  const status = document.getElementById('cfgStatus');
  if (status) status.style.display = 'none';
  document.getElementById('configModal').classList.add('open');
});
document.getElementById('configModal').addEventListener('click', function(e) {
  if (e.target === this) closeConfigModal();
});
