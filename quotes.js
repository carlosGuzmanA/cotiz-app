(function() {
  const PENDING_QUOTE_STORAGE_KEY = 'cotiz_pending_quote_v1';

  function $(id) {
    return document.getElementById(id);
  }

  function fmtNum(n) {
    return Math.round(Number(n || 0)).toLocaleString('es-CL');
  }

  function showStatus(message, isError) {
    const el = $('quotesStatus');
    if (!el) return;
    el.textContent = message || '';
    el.style.color = isError ? '#8b2e0f' : '#6a655e';
  }

  async function requireAuthContext() {
    if (!window.FirebaseAuthService) throw new Error('Auth no disponible.');
    const user = window.FirebaseAuthService.getCurrentUser();
    const idToken = await window.FirebaseAuthService.getValidIdToken();
    if (!user || !idToken) throw new Error('Sesión no válida. Inicia sesión nuevamente.');
    return { user, idToken };
  }

  function setAuthUi(logged, email) {
    $('authCard').classList.toggle('hidden', logged);
    $('quotesListCard').classList.toggle('hidden', !logged);
    $('sessionInfo').textContent = logged ? `Sesión: ${email || ''}` : 'Sin sesión';
  }

  async function doLogin(evt) {
    evt.preventDefault();
    const email = $('loginEmail').value.trim();
    const password = $('loginPassword').value;

    if (!email || !password) {
      showStatus('Completa correo y contraseña.', true);
      return;
    }

    try {
      await window.FirebaseAuthService.signIn(email, password);
      showStatus('Sesión iniciada.', false);
      await bootstrap();
    } catch (e) {
      const msg = window.FirebaseAuthService.mapAuthError(e.message || 'Error login');
      showStatus(msg, true);
    }
  }

  function doLogout() {
    window.FirebaseAuthService.signOut();
    setAuthUi(false, '');
    $('quoteList').innerHTML = '';
    showStatus('Sesión cerrada.', false);
  }

  function quoteItemTemplate(item) {
    const clientName = (item.client && item.client.name) || 'Sin nombre';
    const total = item.pricing && item.pricing.total ? `$${fmtNum(item.pricing.total)}` : '$0';
    const updated = item.updatedAt ? new Date(item.updatedAt).toLocaleString('es-CL') : 'Sin fecha';
    const status = item.status || 'draft';

    return `<div class="quote-item" data-id="${item.id}">
      <div class="quote-head">
        <div>
          <div class="quote-num">${item.quoteNumber || item.id}</div>
          <div class="quote-meta">Actualizada: ${updated} · Estado: ${status}</div>
        </div>
        <div class="quote-total">${total}</div>
      </div>
      <div class="quote-client">Cliente: ${clientName}</div>
      <div class="quote-actions">
        <button class="quotes-btn" data-action="open" data-id="${item.id}">Abrir y editar</button>
        <button class="quotes-btn secondary" data-action="duplicate" data-id="${item.id}">Duplicar</button>
        <button class="quotes-btn danger" data-action="delete" data-id="${item.id}">Eliminar</button>
      </div>
    </div>`;
  }

  function navigateToEditorWithQuote(quote) {
    sessionStorage.setItem(PENDING_QUOTE_STORAGE_KEY, JSON.stringify({ quote }));
    window.location.href = 'index.html';
  }

  function getQuoteYearFromNumber(quoteNumber) {
    const normalized = String(quoteNumber || '').trim().toUpperCase();
    const currentFmt = normalized.match(/^CL-(\d{4})-(\d{4,})$/);
    if (currentFmt) return currentFmt[1];

    // Compatibilidad con formato antiguo COT-YYYYMMDD-####
    const legacyFmt = normalized.match(/^COT-(\d{8})-(\d{4,})$/);
    if (legacyFmt) return legacyFmt[1].slice(0, 4);

    return String(new Date().getFullYear());
  }

  function parseQuoteSequenceByYear(quoteNumber, year) {
    const normalized = String(quoteNumber || '').trim().toUpperCase();

    const currentFmt = normalized.match(/^CL-(\d{4})-(\d{4,})$/);
    if (currentFmt) {
      if (String(year) !== currentFmt[1]) return 0;
      return Number(currentFmt[2] || 0) || 0;
    }

    const legacyFmt = normalized.match(/^COT-(\d{8})-(\d{4,})$/);
    if (legacyFmt) {
      const legacyYear = legacyFmt[1].slice(0, 4);
      if (String(year) !== legacyYear) return 0;
      return Number(legacyFmt[2] || 0) || 0;
    }

    return 0;
  }

  function buildQuoteNumber(year, sequence) {
    return `CL-${year}-${String(Math.max(1, Number(sequence) || 1)).padStart(4, '0')}`;
  }

  async function loadQuotes() {
    const { user, idToken } = await requireAuthContext();
    const list = await window.QuotesRepo.listQuotes(user.uid, idToken);
    const container = $('quoteList');

    if (!list.length) {
      container.innerHTML = '<div class="quote-item">No hay cotizaciones guardadas.</div>';
      return;
    }

    container.innerHTML = list.map(quoteItemTemplate).join('');
  }

  async function openQuote(id) {
    const { user, idToken } = await requireAuthContext();
    const quote = await window.QuotesRepo.getQuote(user.uid, idToken, id);
    if (!quote) throw new Error('Cotización no encontrada.');
    navigateToEditorWithQuote(quote);
  }

  async function duplicateQuote(id) {
    const { user, idToken } = await requireAuthContext();
    const quote = await window.QuotesRepo.getQuote(user.uid, idToken, id);
    if (!quote) throw new Error('No se encontró para duplicar.');

    const targetYear = getQuoteYearFromNumber(quote.quoteNumber);
    const allQuotes = await window.QuotesRepo.listQuotes(user.uid, idToken);
    const maxSeq = (allQuotes || []).reduce((max, item) => {
      const seq = parseQuoteSequenceByYear(item && item.quoteNumber, targetYear);
      return seq > max ? seq : max;
    }, 0);
    const nextQuoteNumber = buildQuoteNumber(targetYear, maxSeq + 1);

    const clone = {
      ...quote,
      id: undefined,
      activeQuoteId: null,
      status: 'draft',
      quoteNumber: nextQuoteNumber,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    await window.QuotesRepo.saveQuote(user.uid, idToken, clone, null);
    showStatus('Cotización duplicada.', false);
    await loadQuotes();
  }

  async function deleteQuote(id) {
    const ok = window.confirm('¿Eliminar esta cotización? Esta acción no se puede deshacer.');
    if (!ok) return;

    const { user, idToken } = await requireAuthContext();
    await window.QuotesRepo.deleteQuote(user.uid, idToken, id);
    showStatus('Cotización eliminada.', false);
    await loadQuotes();
  }

  async function onListClick(evt) {
    const btn = evt.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;

    try {
      if (action === 'open') await openQuote(id);
      if (action === 'duplicate') await duplicateQuote(id);
      if (action === 'delete') await deleteQuote(id);
    } catch (e) {
      showStatus(e.message || 'Error al ejecutar acción.', true);
    }
  }

  async function bootstrap() {
    const user = window.FirebaseAuthService.getCurrentUser();
    const token = await window.FirebaseAuthService.getValidIdToken();

    if (!user || !token) {
      setAuthUi(false, '');
      return;
    }

    setAuthUi(true, user.email || '');
    try {
      await loadQuotes();
      showStatus('Historial actualizado.', false);
    } catch (e) {
      showStatus(e.message || 'No se pudo cargar historial.', true);
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    $('loginForm').addEventListener('submit', doLogin);
    $('btnLogout').addEventListener('click', doLogout);
    $('btnBackApp').addEventListener('click', () => { window.location.href = 'index.html'; });
    $('quoteList').addEventListener('click', onListClick);

    await bootstrap();
  });
})();
