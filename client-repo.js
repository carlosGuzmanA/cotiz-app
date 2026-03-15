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
    if (!dbUrl) throw new Error('No hay databaseURL configurada para clientes.');
    const encodedPath = path.split('/').map(function(part) { return encodeURIComponent(part); }).join('/');
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

  // Normalizes a Chilean RUT: removes dots and spaces, lowercase, keeps hyphen
  // "12.345.678-9" → "12345678-9"
  function normalizeRut(rut) {
    if (!rut || typeof rut !== 'string') return '';
    return rut.replace(/\./g, '').replace(/\s/g, '').toLowerCase().trim();
  }

  // Returns a stable clientId based on RUT, or null if no usable RUT
  function resolveClientId(client) {
    if (!client) return null;
    const rut = normalizeRut(client.rut || '');
    // Require at least one digit + hyphen + digit (minimum valid Chilean RUT)
    if (!rut || !/\d/.test(rut) || rut.length < 3) return null;
    return rut;
  }

  async function listClients(uid, idToken) {
    const raw = await request('clients/' + uid, idToken, { method: 'GET' });
    if (!raw || typeof raw !== 'object') return [];

    return Object.entries(raw)
      .map(function(entry) { return Object.assign({ id: entry[0] }, entry[1] || {}); })
      .sort(function(a, b) { return (a.name || '').localeCompare(b.name || '', 'es'); });
  }

  // Upserts a client. If clientId is provided, does GET→PUT (preserves createdAt/quoteIds).
  // Background-safe: errors are surfaced to caller.
  async function saveClientWithId(uid, idToken, clientData, clientId) {
    const now = Date.now();

    let existing = null;
    try {
      existing = await request('clients/' + uid + '/' + clientId, idToken, { method: 'GET' });
    } catch (e) {
      existing = null;
    }

    const payload = {
      name: clientData.name || '',
      rut: clientData.rut || '',
      rutKey: clientId,
      phone: clientData.phone || '',
      email: clientData.email || '',
      address: clientData.address || '',
      city: clientData.city || '',
      region: clientData.region || '',
      property: clientData.property || '',
      notes: clientData.notes || '',
      createdAt: (existing && existing.createdAt) ? existing.createdAt : now,
      updatedAt: now,
      quoteIds: Object.assign({}, existing ? (existing.quoteIds || {}) : {})
    };

    await request('clients/' + uid + '/' + clientId, idToken, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    return clientId;
  }

  // Adds a quoteId to an existing client's quoteIds set (PATCH — non-destructive)
  async function addQuoteToClient(uid, idToken, clientId, quoteId) {
    if (!clientId || !quoteId) return;
    await request('clients/' + uid + '/' + clientId + '/quoteIds', idToken, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [quoteId]: true })
    });
  }

  // Called fire-and-forget from persistCurrentQuote.
  // Only persists clients that have a RUT (deduplication key).
  async function syncClientForQuote(uid, idToken, clientObject, quoteId) {
    if (!clientObject || !clientObject.name) return null;
    const clientId = resolveClientId(clientObject);
    if (!clientId) return null; // No RUT → skip (can't deduplicate)

    try {
      const now = Date.now();

      // Fetch existing to preserve createdAt and quoteIds
      let existing = null;
      try {
        existing = await request('clients/' + uid + '/' + clientId, idToken, { method: 'GET' });
      } catch (e) {
        existing = null;
      }

      const quoteIds = Object.assign({}, existing ? (existing.quoteIds || {}) : {});
      if (quoteId) quoteIds[quoteId] = true;

      const payload = {
        name: clientObject.name || '',
        rut: clientObject.rut || '',
        rutKey: clientId,
        phone: clientObject.phone || '',
        email: clientObject.email || '',
        address: clientObject.address || '',
        city: clientObject.city || '',
        region: clientObject.region || '',
        property: clientObject.property || '',
        notes: clientObject.notes || '',
        createdAt: (existing && existing.createdAt) ? existing.createdAt : now,
        updatedAt: now,
        quoteIds: quoteIds
      };

      await request('clients/' + uid + '/' + clientId, idToken, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      return clientId;
    } catch (e) {
      // Silently fail — this is a background operation, must not interrupt user flow
      return null;
    }
  }

  async function deleteClient(uid, idToken, clientId) {
    if (!uid || !clientId) throw new Error('Parámetros inválidos para eliminar cliente.');
    await request('clients/' + uid + '/' + clientId, idToken, { method: 'DELETE' });
  }

  window.ClientRepo = {
    normalizeRut,
    resolveClientId,
    listClients,
    saveClientWithId,
    addQuoteToClient,
    syncClientForQuote,
    deleteClient
  };
})();
