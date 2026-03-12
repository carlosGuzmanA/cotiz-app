(function() {
  const DEFAULT_DB_URL = 'https://cotizaciones-app-ece65-default-rtdb.firebaseio.com/';

  function getDatabaseURL() {
    if (window.FIREBASE_CONNECTION && window.FIREBASE_CONNECTION.databaseURL) {
      return window.FIREBASE_CONNECTION.databaseURL;
    }
    return DEFAULT_DB_URL;
  }

  function cleanUrl(url) {
    return (url || '').trim().replace(/\/$/, '');
  }

  function buildEndpoint(path, idToken) {
    const dbUrl = cleanUrl(getDatabaseURL());
    if (!dbUrl) throw new Error('No hay databaseURL configurada para cotizaciones.');
    const encodedPath = path.split('/').map(part => encodeURIComponent(part)).join('/');
    const authParam = idToken ? `?auth=${encodeURIComponent(idToken)}` : '';
    return `${dbUrl}/${encodedPath}.json${authParam}`;
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

  async function listQuotes(uid, idToken) {
    const raw = await request(`quotes/${uid}`, idToken, { method: 'GET' });
    if (!raw || typeof raw !== 'object') return [];

    return Object.entries(raw)
      .map(([id, payload]) => ({ id, ...(payload || {}) }))
      .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
  }

  async function getQuote(uid, idToken, quoteId) {
    const payload = await request(`quotes/${uid}/${quoteId}`, idToken, { method: 'GET' });
    if (!payload) return null;
    return { id: quoteId, ...payload };
  }

  async function saveQuote(uid, idToken, quotePayload, quoteId) {
    const now = Date.now();
    const basePayload = {
      ...quotePayload,
      ownerUid: uid,
      updatedAt: now,
      createdAt: quotePayload && quotePayload.createdAt ? quotePayload.createdAt : now
    };

    if (quoteId) {
      await request(`quotes/${uid}/${quoteId}`, idToken, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(basePayload)
      });
      return { id: quoteId, payload: basePayload };
    }

    const created = await request(`quotes/${uid}`, idToken, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(basePayload)
    });

    const id = created && created.name ? created.name : null;
    if (!id) throw new Error('No se pudo crear la cotización (sin id).');
    return { id, payload: basePayload };
  }

  async function deleteQuote(uid, idToken, quoteId) {
    await request(`quotes/${uid}/${quoteId}`, idToken, { method: 'DELETE' });
    return true;
  }

  window.QuotesRepo = {
    listQuotes,
    getQuote,
    saveQuote,
    deleteQuote
  };
})();
