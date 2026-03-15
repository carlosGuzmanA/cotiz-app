(function() {
  const DEFAULT_DB_URL = 'https://cotizaciones-app-ece65-default-rtdb.firebaseio.com/';

  const FIREBASE_CONNECTION = {
  databaseURL: 'https://cotizaciones-app-ece65-default-rtdb.firebaseio.com/', // Ejemplo: 'https://mi-proyecto-default-rtdb.firebaseio.com'
  node: 'air_conditioners', // Nodo donde vive el array de equipos
  authToken: '' // Opcional: token/secret si tus reglas requieren auth para leer
};

  function getDatabaseURL() {
    if (FIREBASE_CONNECTION && FIREBASE_CONNECTION.databaseURL) {
      return FIREBASE_CONNECTION.databaseURL;
    }
    return DEFAULT_DB_URL;
  }

  function cleanUrl(url) {
    return (url || '').trim().replace(/\/$/, '');
  }

  function buildEndpoint(path, idToken) {
    const dbUrl = cleanUrl(getDatabaseURL());
    if (!dbUrl) throw new Error('No hay databaseURL configurada para el catálogo.');
    const encodedPath = path.split('/').map(function(p) { return encodeURIComponent(p); }).join('/');
    const authParam = idToken ? ('?auth=' + encodeURIComponent(idToken)) : '';
    return dbUrl + '/' + encodedPath + '.json' + authParam;
  }

  async function request(path, idToken, options) {
    const endpoint = buildEndpoint(path, idToken);
    const res = await fetch(endpoint, options);
    const data = await res.json().catch(function() { return null; });
    if (!res.ok) {
      const msg = (data && data.error) || ('HTTP ' + res.status);
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    return data;
  }

  // Firebase puede devolver arrays como objetos numéricos {0:{...}, 1:{...}}
  // Esta normalización es recursiva para cubrir arrays anidados (ej: capacities).
  function normalizeFirebaseArrays(raw) {
    if (raw === null || raw === undefined) return raw;
    if (Array.isArray(raw)) {
      return raw.map(function(item) { return normalizeFirebaseArrays(item); });
    }

    if (typeof raw === 'object') {
      var keys = Object.keys(raw);
      var allNumeric = keys.length > 0 && keys.every(function(k) { return /^\d+$/.test(k); });
      if (allNumeric) {
        return keys
          .sort(function(a, b) { return Number(a) - Number(b); })
          .map(function(k) { return normalizeFirebaseArrays(raw[k]); });
      }

      var result = {};
      keys.forEach(function(k) {
        result[k] = normalizeFirebaseArrays(raw[k]);
      });
      return result;
    }

    return raw;
  }

  function normalizeArray(raw) {
    if (raw === null || raw === undefined) return [];
    var normalized = normalizeFirebaseArrays(raw);
    if (Array.isArray(normalized)) return normalized;
    if (normalized && typeof normalized === 'object') return Object.values(normalized);
    return [];
  }

  // ── Equipos ──────────────────────────────────────────────

  function getEquipmentNode() {
    if (FIREBASE_CONNECTION && FIREBASE_CONNECTION.node) {
      return String(FIREBASE_CONNECTION.node).trim() || 'air_conditioners';
    }
    return 'air_conditioners';
  }

  async function listEquipment(idToken) {
    const raw = await request(getEquipmentNode(), idToken, { method: 'GET' });
    return normalizeArray(raw);
  }

  // Reemplaza el nodo air_conditioners completo
  async function saveEquipment(idToken, equipmentArray) {
    await request(getEquipmentNode(), idToken, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(equipmentArray)
    });
  }

  // ── Servicios ─────────────────────────────────────────────

  async function listServices(idToken) {
    const raw = await request('services', idToken, { method: 'GET' });
    return normalizeArray(raw);
  }

  // Reemplaza el nodo services completo
  async function saveServices(idToken, servicesArray) {
    await request('services', idToken, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(servicesArray)
    });
  }

  // ── Accesorios (extras) ───────────────────────────────────

  async function listAccessories(idToken) {
    const raw = await request('accessories', idToken, { method: 'GET' });
    return normalizeArray(raw);
  }

  // Reemplaza el nodo accessories completo
  async function saveAccessories(idToken, accessoriesArray) {
    await request('accessories', idToken, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(accessoriesArray)
    });
  }

  window.CatalogRepo = {
    listEquipment,
    saveEquipment,
    listServices,
    saveServices,
    listAccessories,
    saveAccessories,
    normalizeArray
  };
})();
