(function () {
  const DEFAULT_DB_URL = 'https://cotizaciones-app-ece65-default-rtdb.firebaseio.com/';

  function getDatabaseURL() {
    if (window.FIREBASE_CONNECTION && window.FIREBASE_CONNECTION.databaseURL) {
      return window.FIREBASE_CONNECTION.databaseURL;
    }
    return DEFAULT_DB_URL;
  }

  function buildEndpoint(path, idToken) {
    const dbUrl = (getDatabaseURL() || '').trim().replace(/\/$/, '');
    if (!dbUrl) throw new Error('No hay databaseURL configurada.');
    const encodedPath = path.split('/').map(p => encodeURIComponent(p)).join('/');
    const auth = idToken ? `?auth=${encodeURIComponent(idToken)}` : '';
    return `${dbUrl}/${encodedPath}.json${auth}`;
  }

  async function request(path, idToken, options) {
    const endpoint = buildEndpoint(path, idToken);
    const res = await fetch(endpoint, options);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = (data && data.error) || `HTTP ${res.status}`;
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    return data;
  }

  /**
   * Normaliza el nombre de modelo a una clave segura para Firebase.
   * Ej: "Samsung WindFree 9K" → "samsung_windfree_9k"
   */
  function modelKey(brandModel) {
    return (brandModel || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  /**
   * Incrementa el contador de cotización para cada modelo único en la selección.
   * Usa el valor de servidor {".sv": {"increment": 1}} para incremento atómico.
   * Fire-and-forget seguro: no lanza excepciones al llamador.
   */
  async function incrementAcRankings(uid, idToken, equipmentSelections) {
    if (!uid || !idToken || !Array.isArray(equipmentSelections) || equipmentSelections.length === 0) return;

    // Deduplicar por brandModel para no contar múltiples BTU del mismo equipo
    const seen = new Set();
    const unique = equipmentSelections.filter(function (item) {
      const key = modelKey(item.brandModel);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    await Promise.all(unique.map(function (item) {
      const key = modelKey(item.brandModel);
      const body = {
        marca: item.marca || '',
        brandModel: item.brandModel || '',
        count: { '.sv': { increment: 1 } },
        updatedAt: { '.sv': 'timestamp' }
      };
      return request('rankings/' + uid + '/' + key, idToken, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    }));
  }

  /**
   * Obtiene todos los rankings del usuario.
   * Retorna { [modelKey]: count } ordenado por count desc.
   */
  async function getRankings(uid, idToken) {
    const raw = await request('rankings/' + uid, idToken, { method: 'GET' });
    if (!raw || typeof raw !== 'object') return {};
    var result = {};
    Object.entries(raw).forEach(function (entry) {
      const key = entry[0];
      const val = entry[1];
      result[key] = (val && typeof val.count === 'number') ? val.count : 0;
    });
    return result;
  }

  window.RankingRepo = { modelKey: modelKey, incrementAcRankings: incrementAcRankings, getRankings: getRankings };
})();
