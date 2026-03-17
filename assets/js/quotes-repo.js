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

  // ── Cotización pública (para enlace de aceptación del cliente) ──

  /**
   * Guarda un snapshot público de la cotización en public_quotes/{quoteId}.
   * Requiere auth del vendedor. El cliente puede leerlo sin auth.
   */
  async function savePublicQuote(quoteId, publicData, idToken) {
    const payload = { ...publicData, updatedAt: Date.now() };
    await request(`public_quotes/${quoteId}`, idToken, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return true;
  }

  /**
   * Lee la respuesta del cliente desde quote_responses/{quoteId}.
   * Requiere auth del vendedor.
   */
  async function getQuoteResponse(quoteId, idToken) {
    const data = await request(`quote_responses/${quoteId}`, idToken, { method: 'GET' });
    return data;
  }

  /**
   * Elimina el snapshot público y la respuesta del cliente al borrar una cotización.
   * Falla silenciosamente si no existen.
   */
  async function deletePublicQuoteData(quoteId, idToken) {
    const cleanPath = async p => {
      try { await request(p, idToken, { method: 'DELETE' }); } catch (e) { /* ignorar */ }
    };
    await cleanPath(`public_quotes/${quoteId}`);
    await cleanPath(`quote_responses/${quoteId}`);
  }

  async function updateQuoteStatus(uid, idToken, quoteId, status, extraFields) {
    const patch = {
      status,
      updatedAt: Date.now(),
      ...(extraFields || {})
    };
    // PATCH: GET + PUT para no pisar campos existentes
    const current = await request(`quotes/${uid}/${quoteId}`, idToken, { method: 'GET' });
    if (!current) throw new Error('Cotización no encontrada.');
    const merged = { ...current, ...patch };
    await request(`quotes/${uid}/${quoteId}`, idToken, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(merged)
    });
    return merged;
  }

  window.QuotesRepo = {
    listQuotes,
    getQuote,
    saveQuote,
    deleteQuote,
    updateQuoteStatus,
    savePublicQuote,
    getQuoteResponse,
    deletePublicQuoteData
  };
})();
