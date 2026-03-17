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

  // Algoritmo de push ID compatible con Firebase (cliente local)
  const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
  let lastPushTime = 0;
  let lastRandChars = [];

  function generateClientPushId() {
    let now = Date.now();
    const duplicateTime = (now === lastPushTime);
    lastPushTime = now;

    const timeStampChars = new Array(8);
    for (let i = 7; i >= 0; i--) {
      timeStampChars[i] = PUSH_CHARS.charAt(now % 64);
      now = Math.floor(now / 64);
    }

    let id = timeStampChars.join('');

    if (!duplicateTime) {
      for (let i = 0; i < 12; i++) {
        lastRandChars[i] = Math.floor(Math.random() * 64);
      }
    } else {
      let i;
      for (i = 11; i >= 0 && lastRandChars[i] === 63; i--) {
        lastRandChars[i] = 0;
      }
      lastRandChars[i]++;
    }

    for (let i = 0; i < 12; i++) {
      id += PUSH_CHARS.charAt(lastRandChars[i]);
    }

    return id;
  }

  // Genera una clave única con el algoritmo de Firebase (push id)
  // y limpia inmediatamente el nodo temporal usado para obtenerla.
  async function generateFirebaseKey(namespace, idToken) {
    const safeNamespace = (namespace || 'general').replace(/[^a-zA-Z0-9_-]/g, '_');
    const tempPath = `__id_pool/${safeNamespace}`;
    try {
      const created = await request(tempPath, idToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ createdAt: Date.now() })
      });

      const key = created && created.name ? created.name : null;
      if (!key) throw new Error('No se pudo generar un ID único en Firebase.');

      try {
        await request(`${tempPath}/${key}`, idToken, { method: 'DELETE' });
      } catch (e) {
        // Limpieza best-effort.
      }

      return key;
    } catch (e) {
      const msg = String((e && e.message) || '').toLowerCase();
      if (msg.includes('permission denied') || msg.includes('permission_denied')) {
        return generateClientPushId();
      }
      throw e;
    }
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
    generateFirebaseKey,
    normalizeArray
  };
})();
