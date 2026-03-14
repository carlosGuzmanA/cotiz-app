(function() {
  const PENDING_QUOTE_STORAGE_KEY = 'cotiz_pending_quote_v1';

  // ── Estado del ciclo de vida ──────────────────────────────
  const STATUS_CONFIG = {
    draft:     { label: 'Borrador',    icon: 'fa-file-pen',        cls: 'status-draft'      },
    issued:    { label: 'Emitida',     icon: 'fa-paper-plane',     cls: 'status-issued'     },
    accepted:  { label: 'Aceptada',    icon: 'fa-circle-check',    cls: 'status-accepted'   },
    scheduled: { label: 'Programada',  icon: 'fa-calendar-check',  cls: 'status-scheduled'  },
    completed: { label: 'Finalizada',  icon: 'fa-flag-checkered',  cls: 'status-completed'  },
    warranty:  { label: 'Garantía',    icon: 'fa-shield-halved',   cls: 'status-warranty'   }
  };

  // Transiciones permitidas
  const TRANSITIONS = {
    draft:     ['issued'],
    issued:    ['accepted'],
    accepted:  ['scheduled'],
    scheduled: ['completed'],
    completed: ['warranty'],
    warranty:  []
  };

  // Etiqueta del botón de avance
  const TRANSITION_LABEL = {
    issued:    'Marcar emitida',
    accepted:  'Cliente aceptó',
    scheduled: 'Programar fecha',
    completed: 'Marcar finalizada',
    warranty:  'Programar garantía'
  };

  function $(id) { return document.getElementById(id); }

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
    if (!email || !password) { showStatus('Completa correo y contraseña.', true); return; }
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

  function buildWazeUrl(client) {
    if (!client) return '';
    const parts = [client.address, client.city, client.region].filter(Boolean);
    if (!parts.length) return '';
    return 'https://waze.com/ul?q=' + encodeURIComponent(parts.join(', ')) + '&navigate=yes';
  }

  function statusBadge(status) {
    const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.draft;
    return `<span class="status-badge ${cfg.cls}"><i class="fas ${cfg.icon}"></i> ${cfg.label}</span>`;
  }

  function scheduledDateLine(item) {
    const lines = [];
    if (item.scheduledDate) {
      const d = new Date(item.scheduledDate);
      lines.push(`<div class="quote-scheduled-line"><i class="fas fa-calendar-day"></i> Instalación: <strong>${d.toLocaleString('es-CL', {dateStyle:'medium', timeStyle:'short'})}</strong></div>`);
    }
    if (item.completedAt) {
      const d = new Date(item.completedAt);
      lines.push(`<div class="quote-scheduled-line"><i class="fas fa-flag-checkered"></i> Finalizada: <strong>${d.toLocaleDateString('es-CL', {dateStyle:'medium'})}</strong></div>`);
    }
    if (item.warrantyDate) {
      const d = new Date(item.warrantyDate);
      const isPast = d < new Date();
      lines.push(`<div class="quote-scheduled-line${isPast?' expired':''}"><i class="fas fa-shield-halved"></i> Garantía hasta: <strong>${d.toLocaleDateString('es-CL', {dateStyle:'medium'})}</strong>${isPast?' — Vencida':''}</div>`);
    }
    return lines.join('');
  }

  function nextTransitionButton(item) {
    const status = item.status || 'draft';
    const nexts = TRANSITIONS[status] || [];
    if (!nexts.length) return '';
    const next = nexts[0];
    const needsDate = next === 'scheduled' || next === 'warranty';
    const dataDate = needsDate ? `data-needs-date="1"` : '';
    const dataCompleted = item.completedAt ? `data-completed-at="${item.completedAt}"` : '';
    return `<button class="quotes-btn action-btn" data-action="advance" data-id="${item.id}" data-next="${next}" ${dataDate} ${dataCompleted} title="${TRANSITION_LABEL[next]}">
      <i class="fas ${STATUS_CONFIG[next].icon}"></i> ${TRANSITION_LABEL[next]}
    </button>`;
  }

  function quoteItemTemplate(item) {
    const client = item.client || {};
    const clientName = client.name || 'Sin nombre';
    const total = item.pricing && item.pricing.total ? `$${fmtNum(item.pricing.total)}` : '$0';
    const updated = item.updatedAt ? new Date(item.updatedAt).toLocaleString('es-CL') : 'Sin fecha';
    const status = item.status || 'draft';
    const phone = client.phone ? client.phone.trim() : '';
    const wazeUrl = buildWazeUrl(client);
    const callBtn  = phone   ? `<a class="quotes-btn secondary icon-btn" href="tel:${phone.replace(/\s/g,'')}" title="Llamar"><i class="fas fa-phone"></i></a>` : '';
    const wazeBtn  = wazeUrl ? `<a class="quotes-btn secondary icon-btn" href="${wazeUrl}" target="_blank" rel="noopener noreferrer" title="Waze"><i class="fas fa-route"></i></a>` : '';
    const advanceBtn = nextTransitionButton(item);

    return `<div class="quote-item status-border-${status}" data-id="${item.id}">
      <div class="quote-head">
        <div class="quote-head-left">
          <div class="quote-num">${item.quoteNumber || item.id}</div>
          <div class="quote-meta">Actualizada: ${updated}</div>
        </div>
        <div class="quote-head-right">
          ${statusBadge(status)}
          <div class="quote-total">${total}</div>
        </div>
      </div>
      <div class="quote-client"><i class="fas fa-user" style="opacity:.5;margin-right:4px"></i>${clientName}</div>
      ${scheduledDateLine(item)}
      ${advanceBtn ? `<div class="quote-advance-row">${advanceBtn}</div>` : ''}
      <div class="quote-actions-row">
        <div class="quote-actions-group">
          <button class="quotes-btn icon-btn" data-action="open" data-id="${item.id}" title="Abrir y editar"><i class="fas fa-pen-to-square"></i></button>
          <button class="quotes-btn secondary icon-btn" data-action="detail" data-id="${item.id}" title="Ver detalle"><i class="fas fa-eye"></i></button>
          <button class="quotes-btn secondary icon-btn" data-action="duplicate" data-id="${item.id}" title="Duplicar"><i class="fas fa-copy"></i></button>
          ${callBtn}${wazeBtn}
        </div>
        <button class="quotes-btn danger icon-btn" data-action="delete" data-id="${item.id}" title="Eliminar"><i class="fas fa-trash"></i></button>
      </div>
    </div>`;
  }

  function navigateToEditorWithQuote(quote) {
    sessionStorage.setItem(PENDING_QUOTE_STORAGE_KEY, JSON.stringify({ quote }));
    window.location.href = 'index.html';
  }

  // ── Modal de detalle ──────────────────────────────────────
  function openDetailModal(item) {
    const client  = item.client  || {};
    const pricing = item.pricing || {};
    const status  = item.status  || 'draft';
    const cfg     = STATUS_CONFIG[status] || STATUS_CONFIG.draft;

    const fmtDate = ts => ts ? new Date(ts).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
    const fmtDateOnly = ts => ts ? new Date(ts).toLocaleDateString('es-CL', { dateStyle: 'medium' }) : '—';

    // Equipos
    const equipRows = (item.equipmentSelections || []).map(eq =>
      `<div class="detail-row"><span>${eq.marca ? eq.marca + ' ' : ''}${eq.brandModel || ''} ${eq.btu ? (eq.btu/1000).toFixed(0)+'K' : ''} x${eq.qty || 1}</span><span>$${fmtNum((eq.unitPrice || 0) * (eq.qty || 1))}</span></div>`
    ).join('');

    // Servicios
    const svcItems = [];
    const svc = item.serviceSelection || {};
    if (svc.serviceQtyMap) {
      if (svc.serviceQtyMap.instalacion > 0) svcItems.push(`Instalación x${svc.serviceQtyMap.instalacion} — $${fmtNum((svc.instalacionUnitValue || 0) * svc.serviceQtyMap.instalacion)}`);
      if (svc.serviceQtyMap.mantencion  > 0) svcItems.push(`Mantención x${svc.serviceQtyMap.mantencion}  — $${fmtNum((svc.mantencionUnitValue  || 0) * svc.serviceQtyMap.mantencion)}`);
    }
    if (svc.selectedService && svc.selectedService !== '' && !svc.serviceQtyMap) {
      svcItems.push(svc.selectedService);
    }
    const svcRows = svcItems.map(s => `<div class="detail-row"><span>${s}</span></div>`).join('');

    const wazeUrl = buildWazeUrl(client);
    const wazeLink = wazeUrl ? `<a href="${wazeUrl}" target="_blank" rel="noopener noreferrer" class="detail-link"><i class="fas fa-route"></i> Abrir en Waze</a>` : '';

    $('detailModal').innerHTML = `
      <div class="detail-sheet">
        <div class="detail-handle"></div>
        <div class="detail-header">
          <div>
            <div class="detail-quote-num">${item.quoteNumber || item.id}</div>
            <div class="detail-date">Actualizada: ${fmtDate(item.updatedAt)}</div>
          </div>
          <span class="status-badge ${cfg.cls}"><i class="fas ${cfg.icon}"></i> ${cfg.label}</span>
        </div>

        <div class="detail-total-banner">$${fmtNum(pricing.total)}</div>

        <div class="detail-section">
          <div class="detail-section-title"><i class="fas fa-user"></i> Cliente</div>
          <div class="detail-kv"><b>Nombre</b><span>${client.name || '—'}</span></div>
          ${client.rut    ? `<div class="detail-kv"><b>RUT</b><span>${client.rut}</span></div>` : ''}
          ${client.phone  ? `<div class="detail-kv"><b>Teléfono</b><span><a href="tel:${client.phone.replace(/\s/g,'')}" class="detail-link">${client.phone}</a></span></div>` : ''}
          ${client.email  ? `<div class="detail-kv"><b>Correo</b><span>${client.email}</span></div>` : ''}
          ${client.address? `<div class="detail-kv"><b>Dirección</b><span>${[client.address, client.city, client.region].filter(Boolean).join(', ')} ${wazeLink}</span></div>` : ''}
        </div>

        ${equipRows ? `<div class="detail-section"><div class="detail-section-title"><i class="fas fa-snowflake"></i> Equipos</div>${equipRows}</div>` : ''}
        ${svcRows   ? `<div class="detail-section"><div class="detail-section-title"><i class="fas fa-screwdriver-wrench"></i> Servicios</div>${svcRows}</div>` : ''}

        <div class="detail-section">
          <div class="detail-section-title"><i class="fas fa-calculator"></i> Totales</div>
          ${pricing.equipment  ? `<div class="detail-row"><span>Equipos</span><span>$${fmtNum(pricing.equipment)}</span></div>` : ''}
          ${pricing.services   ? `<div class="detail-row"><span>Servicios</span><span>$${fmtNum(pricing.services)}</span></div>` : ''}
          ${pricing.accessories? `<div class="detail-row"><span>Accesorios</span><span>$${fmtNum(pricing.accessories)}</span></div>` : ''}
          ${pricing.discountPct? `<div class="detail-row discount"><span>Descuento (${pricing.discountPct}%)</span><span>−$${fmtNum(pricing.discountAmount)}</span></div>` : ''}
          <div class="detail-row total-row"><span>Total</span><span>$${fmtNum(pricing.total)}</span></div>
        </div>

        ${item.scheduledDate || item.completedAt || item.warrantyDate ? `
        <div class="detail-section">
          <div class="detail-section-title"><i class="fas fa-calendar"></i> Fechas</div>
          ${item.scheduledDate ? `<div class="detail-kv"><b>Instalación</b><span>${fmtDate(item.scheduledDate)}</span></div>` : ''}
          ${item.completedAt  ? `<div class="detail-kv"><b>Finalizada</b><span>${fmtDateOnly(item.completedAt)}</span></div>` : ''}
          ${item.warrantyDate ? `<div class="detail-kv"><b>Garantía</b><span>${fmtDateOnly(item.warrantyDate)}</span></div>` : ''}
        </div>` : ''}

        <div class="detail-actions">
          <button class="quotes-btn" id="btnDetailOpen"><i class="fas fa-pen-to-square"></i> Abrir y editar</button>
          <button class="quotes-btn secondary" id="btnDetailClose">Cerrar</button>
        </div>
      </div>`;

    $('detailModal').classList.add('open');
    $('btnDetailClose').onclick = closeDetailModal;
    $('btnDetailOpen').onclick  = () => { closeDetailModal(); navigateToEditorWithQuote(item); };
    $('detailModal').onclick = e => { if (e.target === $('detailModal')) closeDetailModal(); };
  }

  function closeDetailModal() {
    $('detailModal').classList.remove('open');
  }

  function getQuoteYearFromNumber(quoteNumber) {
    const normalized = String(quoteNumber || '').trim().toUpperCase();
    const m = normalized.match(/^CL-(\d{4})-(\d{4,})$/);
    if (m) return m[1];
    const l = normalized.match(/^COT-(\d{8})-(\d{4,})$/);
    if (l) return l[1].slice(0, 4);
    return String(new Date().getFullYear());
  }

  function parseQuoteSequenceByYear(quoteNumber, year) {
    const n = String(quoteNumber || '').trim().toUpperCase();
    const m = n.match(/^CL-(\d{4})-(\d{4,})$/);
    if (m) return String(year) !== m[1] ? 0 : Number(m[2]) || 0;
    const l = n.match(/^COT-(\d{8})-(\d{4,})$/);
    if (l) return String(year) !== l[1].slice(0,4) ? 0 : Number(l[2]) || 0;
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
    const clone = {
      ...quote, id: undefined, activeQuoteId: null, status: 'draft',
      quoteNumber: buildQuoteNumber(targetYear, maxSeq + 1),
      createdAt: Date.now(), updatedAt: Date.now(),
      scheduledDate: null, completedAt: null, warrantyDate: null
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

  // ── Modal de fecha ────────────────────────────────────────
  let _pendingAdvance = null;

  function openScheduleModal(id, nextStatus, completedAt) {
    _pendingAdvance = { id, nextStatus };
    const modal = $('scheduleModal');
    const title = $('scheduleModalTitle');
    const hint  = $('scheduleModalHint');
    const datePart = $('scheduleModalDatePart');
    const timePart = $('scheduleModalTimePart');
    const timeGroup = $('scheduleTimeGroup');

    // Fecha mínima: hoy
    const today = new Date().toISOString().slice(0, 10);
    datePart.min = today;

    if (nextStatus === 'scheduled') {
      title.textContent = 'Programar instalación';
      hint.textContent  = 'Selecciona la fecha y hora de la visita de instalación.';
      timeGroup.style.display = '';
      datePart.value = '';
      timePart.value = '09:00';
    } else if (nextStatus === 'warranty') {
      title.textContent = 'Visita de garantía';
      hint.textContent  = 'Agenda la visita de garantía (sin costo). Fecha sugerida: 6 meses desde la finalización.';
      timeGroup.style.display = '';
      timePart.value = '09:00';

      // Base: fecha de finalización si existe, si no desde hoy
      const base = completedAt ? new Date(completedAt) : new Date();
      const suggested = new Date(base);
      suggested.setMonth(suggested.getMonth() + 6);
      datePart.value = suggested.toISOString().slice(0, 10);

      // Máximo: también 6 meses desde la base
      datePart.max = suggested.toISOString().slice(0, 10);
    } else {
      datePart.value = '';
      timePart.value = '09:00';
    }

    modal.classList.add('open');
  }

  function closeScheduleModal() {
    _pendingAdvance = null;
    $('scheduleModal').classList.remove('open');
    $('scheduleModalDatePart').value = '';
    $('scheduleModalTimePart').value = '09:00';
    if ($('scheduleModalDatePart').max) $('scheduleModalDatePart').max = '';
  }

  async function confirmSchedule() {
    if (!_pendingAdvance) return;
    const { id, nextStatus } = _pendingAdvance;
    const dateVal = $('scheduleModalDatePart').value;
    const timeVal = $('scheduleModalTimePart').value || '09:00';
    if (!dateVal) { alert('Por favor selecciona una fecha.'); return; }
    const ts = new Date(`${dateVal}T${timeVal}`).getTime();
    if (isNaN(ts)) { alert('Fecha inválida.'); return; }
    closeScheduleModal();
    await advanceStatus(id, nextStatus, ts);
  }

  async function advanceStatus(id, nextStatus, scheduledTs) {
    try {
      const { user, idToken } = await requireAuthContext();
      const extra = {};

      if (nextStatus === 'scheduled') {
        extra.scheduledDate = scheduledTs || null;
      } else if (nextStatus === 'completed') {
        extra.completedAt = Date.now();
        // Auto-calcular límite de garantía: 6 meses
        const warrantyEnd = new Date();
        warrantyEnd.setMonth(warrantyEnd.getMonth() + 6);
        extra.warrantyExpiry = warrantyEnd.getTime();
      } else if (nextStatus === 'warranty') {
        extra.warrantyDate = scheduledTs || null;
      }

      await window.QuotesRepo.updateQuoteStatus(user.uid, idToken, id, nextStatus, extra);
      showStatus(`Estado actualizado: ${STATUS_CONFIG[nextStatus].label}`, false);
      await loadQuotes();
    } catch (e) {
      showStatus(e.message || 'Error al actualizar estado.', true);
    }
  }

  async function onListClick(evt) {
    const btn = evt.target.closest('button[data-action], a[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;

    try {
      if (action === 'open')      await openQuote(id);
      if (action === 'detail') {
        const { user, idToken } = await requireAuthContext();
        const quote = await window.QuotesRepo.getQuote(user.uid, idToken, id);
        if (quote) openDetailModal(quote);
        return;
      }
      if (action === 'duplicate') await duplicateQuote(id);
      if (action === 'delete')    await deleteQuote(id);
      if (action === 'advance') {
        const next = btn.dataset.next;
        const needsDate = btn.dataset.needsDate === '1';
        if (needsDate) {
          const completedAt = btn.dataset.completedAt ? Number(btn.dataset.completedAt) : null;
          openScheduleModal(id, next, completedAt);
        } else {
          await advanceStatus(id, next, null);
        }
      }
    } catch (e) {
      showStatus(e.message || 'Error al ejecutar acción.', true);
    }
  }

  async function bootstrap() {
    const user = window.FirebaseAuthService.getCurrentUser();
    const token = await window.FirebaseAuthService.getValidIdToken();
    if (!user || !token) { setAuthUi(false, ''); return; }
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
    $('btnScheduleConfirm').addEventListener('click', confirmSchedule);
    $('btnScheduleCancel').addEventListener('click', closeScheduleModal);
    $('scheduleModal').addEventListener('click', e => { if (e.target === $('scheduleModal')) closeScheduleModal(); });
    await bootstrap();
  });
})();
