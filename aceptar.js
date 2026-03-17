(function () {
  var DB_URL = 'https://cotizaciones-app-ece65-default-rtdb.firebaseio.com/';

  function $(id) { return document.getElementById(id); }

  function fmtNum(n) {
    return Math.round(Number(n || 0)).toLocaleString('es-CL');
  }

  function fmtDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString('es-CL', { dateStyle: 'long', timeStyle: 'short' });
  }

  function showState(name) {
    var ids = ['stateLoading','stateError','stateQuote','stateAlreadyResponded','stateConfirmed','stateRejected'];
    ids.forEach(function(id) {
      var el = $(id);
      if (!el) return;
      if (id === name) {
        el.classList.remove('hidden');
        el.style.display = '';
      } else {
        el.classList.add('hidden');
        el.style.display = 'none';
      }
    });
  }

  function getParams() {
    var p = new URLSearchParams(window.location.search);
    return { id: p.get('id') || '' };
  }

  async function dbGet(path) {
    var url = DB_URL + path + '.json';
    var res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function dbPut(path, data) {
    var url = DB_URL + path + '.json';
    var res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  // ── Construye el bloque HTML detallado de la cotización ──
  function buildDetailHTML(quote) {
    var client  = quote.client  || {};
    var pricing = quote.pricing || {};

    var sections = '';

    // Cliente
    var addr = [client.address, client.city, client.region].filter(Boolean).join(', ');
    var clientRows = '';
    if (client.name)    clientRows += kvRow('Nombre', client.name);
    if (addr)           clientRows += kvRow('Dirección', addr);
    if (clientRows) {
      sections += card('<i class="fas fa-user"></i> Cliente', clientRows);
    }

    // Equipos
    var equips = Array.isArray(quote.equipmentSelections) ? quote.equipmentSelections : [];
    if (equips.length) {
      var equipRows = equips.map(function(eq) {
        var label = [eq.marca, eq.brandModel].filter(Boolean).join(' ');
        var btu   = eq.btu ? ' ' + (eq.btu / 1000).toFixed(0) + 'K BTU' : '';
        var price = eq.unitPrice
          ? '<span>$' + fmtNum((eq.unitPrice || 0) * (eq.qty || 1)) + '</span>'
          : '';
        return '<div class="accept-row"><span>' + label + btu + ' × ' + (eq.qty || 1) + '</span>' + price + '</div>';
      }).join('');
      sections += card('<i class="fas fa-snowflake"></i> Equipos', equipRows);
    }

    // Servicios
    var svc      = quote.serviceSelection || {};
    var svcLines = [];
    if (svc.serviceQtyMap) {
      if ((svc.serviceQtyMap.instalacion || 0) > 0)
        svcLines.push('Instalación × ' + svc.serviceQtyMap.instalacion);
      if ((svc.serviceQtyMap.mantencion || 0) > 0)
        svcLines.push('Mantención × ' + svc.serviceQtyMap.mantencion);
    }
    if (svc.repairQty && svc.repairUnitValue)
      svcLines.push('Reparación × ' + svc.repairQty);
    if (!svcLines.length && svc.selectedService)
      svcLines.push(svc.selectedService);

    if (svcLines.length) {
      var svcRows = svcLines.map(function(s) {
        return '<div class="accept-row-simple">' + s + '</div>';
      }).join('');
      sections += card('<i class="fas fa-screwdriver-wrench"></i> Servicio', svcRows);
    }

    // Accesorios
    if (pricing.accessories > 0) {
      sections += card(
        '<i class="fas fa-toolbox"></i> Accesorios',
        '<div class="accept-row"><span>Accesorios varios</span><span>$' + fmtNum(pricing.accessories) + '</span></div>'
      );
    }

    // Observaciones
    var notes = (quote.notes && (quote.notes.client || quote.notes.service)) || '';
    if (notes) {
      sections += card(
        '<i class="fas fa-circle-info"></i> Observaciones',
        '<p class="notes-text">' + escHtml(notes) + '</p>'
      );
    }

    // Totales
    var totalRows = '';
    if (pricing.equipment)    totalRows += priceRow('Equipos', pricing.equipment);
    if (pricing.services)     totalRows += priceRow('Servicios', pricing.services);
    if (pricing.accessories)  totalRows += priceRow('Accesorios', pricing.accessories);
    if (pricing.discountPct)  totalRows += priceRow('Descuento (' + pricing.discountPct + '%)', -pricing.discountAmount, true);
    totalRows += '<div class="accept-row total-row"><span>Total</span><span>$' + fmtNum(pricing.total) + '</span></div>';
    sections += card('<i class="fas fa-calculator"></i> Desglose', totalRows);

    return sections;
  }

  function card(title, content) {
    return '<div class="accept-card"><div class="accept-card-title">' + title + '</div>' + content + '</div>';
  }
  function kvRow(label, value) {
    return '<div class="accept-kv"><b>' + label + '</b><span>' + escHtml(String(value)) + '</span></div>';
  }
  function priceRow(label, amount, isDiscount) {
    var cls = isDiscount ? ' discount-row' : '';
    return '<div class="accept-row' + cls + '"><span>' + label + '</span><span>' + (isDiscount ? '−' : '') + '$' + fmtNum(Math.abs(amount)) + '</span></div>';
  }
  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── Banner total ──
  function totalBannerHTML(pricing) {
    return '<div class="accept-total-banner">'
      + '<div class="total-label">Total cotización</div>'
      + '<div class="total-amount">$' + fmtNum((pricing || {}).total) + '</div>'
      + '<div class="total-note">Precio en pesos chilenos (CLP)</div>'
      + '</div>';
  }

  var _quoteId   = '';
  var _quoteData = null;

  async function handleAccept() {
    $('btnAccept').disabled = true;
    $('btnReject').disabled = true;
    var respondedAt = Date.now();
    try {
      await dbPut('quote_responses/' + encodeURIComponent(_quoteId), {
        type: 'accepted',
        respondedAt: respondedAt
      });
      showConfirmed(_quoteData, respondedAt);
    } catch (e) {
      $('btnAccept').disabled = false;
      $('btnReject').disabled = false;
      alert('No se pudo registrar tu respuesta. Por favor intenta nuevamente.');
    }
  }

  async function handleReject() {
    var ok = window.confirm('¿Confirmas que no deseas aceptar esta cotización?');
    if (!ok) return;
    $('btnAccept').disabled = true;
    $('btnReject').disabled = true;
    var respondedAt = Date.now();
    try {
      await dbPut('quote_responses/' + encodeURIComponent(_quoteId), {
        type: 'rejected',
        respondedAt: respondedAt
      });
      showRejected(_quoteData, respondedAt);
    } catch (e) {
      $('btnAccept').disabled = false;
      $('btnReject').disabled = false;
      alert('No se pudo registrar tu respuesta. Por favor intenta nuevamente.');
    }
  }

  function showConfirmed(quote, respondedAt) {
    var client  = (quote && quote.client)  || {};
    var pricing = (quote && quote.pricing) || {};
    var qNum    = (quote && quote.quoteNumber) || _quoteId;

    var el;
    el = $('confirmedQuoteNum');  if (el) el.textContent = qNum;
    el = $('confirmedClientName'); if (el) el.textContent = client.name || 'Cliente';
    el = $('confirmedDate');
    if (el) el.textContent = 'Registrado el ' + fmtDate(respondedAt);

    el = $('confirmedDetailBlock');
    if (el && quote) {
      el.innerHTML = totalBannerHTML(pricing) + buildDetailHTML(quote);
    }
    showState('stateConfirmed');
  }

  function showRejected(quote, respondedAt) {
    var qNum = (quote && quote.quoteNumber) || _quoteId;

    var el;
    el = $('rejectedQuoteNum'); if (el) el.textContent = qNum;
    el = $('rejectedDate');
    if (el) el.textContent = 'Registrado el ' + fmtDate(respondedAt);

    el = $('rejectedDetailBlock');
    if (el && quote) {
      el.innerHTML = buildDetailHTML(quote);
    }
    showState('stateRejected');
  }

  function showAlreadyResponded(existing, quote) {
    var qNum   = (quote && quote.quoteNumber) || _quoteId;
    var client = (quote && quote.client) || {};
    var pricing= (quote && quote.pricing) || {};
    var isAccepted = existing.type === 'accepted';

    var el;
    el = $('alreadyQuoteNum'); if (el) el.textContent = qNum;

    // Banner de respuesta
    el = $('alreadyResponseBanner');
    if (el) {
      var bannerCls  = isAccepted ? 'confirmed-banner--accepted' : 'confirmed-banner--rejected';
      var bannerIcon = isAccepted ? 'fa-circle-check' : 'fa-circle-xmark';
      var bannerTitle= isAccepted ? '¡Ya aceptaste esta cotización!' : 'Ya rechazaste esta cotización';
      var bannerSub  = existing.respondedAt ? 'El ' + fmtDate(existing.respondedAt) : '';
      el.innerHTML =
        '<div class="confirmed-banner ' + bannerCls + '">'
        + '<div class="confirmed-banner-icon"><i class="fas ' + bannerIcon + '"></i></div>'
        + '<div><div class="confirmed-banner-title">' + bannerTitle + '</div>'
        + (bannerSub ? '<div class="confirmed-banner-sub">' + bannerSub + '</div>' : '')
        + '</div></div>';
    }

    // Saludo
    if (client.name) {
      var greetEl = document.querySelector('#stateAlreadyResponded .greeting-box');
      if (!greetEl) {
        var greetDiv = document.createElement('div');
        greetDiv.className = 'greeting-box';
        greetDiv.innerHTML = '<p>Hola <strong>' + escHtml(client.name) + '</strong>, aquí puedes revisar los detalles de la cotización que ya respondiste.</p>';
        var banner = $('alreadyResponseBanner');
        if (banner && banner.nextSibling) {
          banner.parentNode.insertBefore(greetDiv, banner.nextSibling);
        }
      }
    }

    // Detalle de cotización
    el = $('alreadyDetailBlock');
    if (el && quote) {
      el.innerHTML = totalBannerHTML(pricing) + buildDetailHTML(quote);
    }

    showState('stateAlreadyResponded');
  }

  async function init() {
    var params = getParams();
    var id = params.id;

    if (!id) {
      showState('stateError');
      $('errorMessage').textContent = 'Enlace inválido: falta el identificador de cotización.';
      return;
    }

    _quoteId = id;

    try {
      // Cargar cotización pública y respuesta existente en paralelo
      var quoteResult    = null;
      var existingResult = null;

      try { quoteResult = await dbGet('public_quotes/' + encodeURIComponent(id)); } catch (e) {}
      try { existingResult = await dbGet('quote_responses/' + encodeURIComponent(id)); } catch (e) {}

      if (!quoteResult) {
        showState('stateError');
        $('errorMessage').textContent = 'No se encontró la cotización. El enlace puede haber expirado o ser inválido.';
        return;
      }

      _quoteData = quoteResult;

      // Si ya respondió → mostrar detalle con banner de respuesta
      if (existingResult && existingResult.type) {
        showAlreadyResponded(existingResult, quoteResult);
        return;
      }

      // Pendiente de respuesta → mostrar formulario
      var client  = quoteResult.client  || {};
      var pricing = quoteResult.pricing || {};

      $('quoteNumber').textContent     = quoteResult.quoteNumber || '';
      $('clientNameGreet').textContent = client.name || 'Cliente';

      var detailEl = $('quoteDetailBlock');
      if (detailEl) {
        detailEl.innerHTML = totalBannerHTML(pricing) + buildDetailHTML(quoteResult);
      }

      showState('stateQuote');

      $('btnAccept').addEventListener('click', handleAccept);
      $('btnReject').addEventListener('click', handleReject);

    } catch (e) {
      showState('stateError');
      $('errorMessage').textContent = 'No se pudo cargar la cotización. Intenta nuevamente más tarde.';
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();

