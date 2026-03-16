(function () {
  var DB_URL = 'https://cotizaciones-app-ece65-default-rtdb.firebaseio.com/';

  function $(id) { return document.getElementById(id); }

  function fmtNum(n) {
    return Math.round(Number(n || 0)).toLocaleString('es-CL');
  }

  function showState(name) {
    var ids = ['stateLoading','stateError','stateAlreadyResponded','stateQuote','stateConfirmed','stateRejected'];
    ids.forEach(function(id) {
      var el = $(id);
      if (!el) return;
      if (id === name) {
        el.classList.remove('hidden');
        el.style.display = '';
      } else {
        el.classList.add('hidden');
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

  function renderQuote(quote) {
    var client  = quote.client  || {};
    var pricing = quote.pricing || {};

    $('quoteNumber').textContent       = quote.quoteNumber || '';
    $('clientNameGreet').textContent   = client.name || 'Cliente';
    $('clientDisplayName').textContent = client.name || '—';

    var addr = [client.address, client.city, client.region].filter(Boolean).join(', ');
    if (addr) {
      $('clientDisplayAddress').textContent = addr;
    } else {
      var row = $('addressRow');
      if (row) row.style.display = 'none';
    }

    // Equipos
    var equips = Array.isArray(quote.equipmentSelections) ? quote.equipmentSelections : [];
    if (equips.length) {
      $('equipRows').innerHTML = equips.map(function(eq) {
        var label = [eq.marca, eq.brandModel].filter(Boolean).join(' ');
        var btu   = eq.btu ? ' ' + (eq.btu / 1000).toFixed(0) + 'K BTU' : '';
        var price = eq.unitPrice
          ? '<span>$' + fmtNum((eq.unitPrice || 0) * (eq.qty || 1)) + '</span>'
          : '';
        return '<div class="accept-row"><span>' + label + btu + ' × ' + (eq.qty || 1) + '</span>' + price + '</div>';
      }).join('');
    } else {
      var equipCard = $('equipCard');
      if (equipCard) equipCard.style.display = 'none';
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
      $('svcRows').innerHTML = svcLines.map(function(s) {
        return '<div class="accept-row-simple">' + s + '</div>';
      }).join('');
    } else {
      var svcCard = $('svcCard');
      if (svcCard) svcCard.style.display = 'none';
    }

    // Accesorios
    if (pricing.accessories > 0) {
      $('accRows').innerHTML = '<div class="accept-row"><span>Accesorios varios</span><span>$' + fmtNum(pricing.accessories) + '</span></div>';
    } else {
      var accCard = $('accCard');
      if (accCard) accCard.style.display = 'none';
    }

    // Observaciones
    var notes = (quote.notes && (quote.notes.client || quote.notes.service)) || '';
    if (notes) {
      $('notesText').textContent = notes;
      var notesCard = $('notesCard');
      if (notesCard) notesCard.style.display = '';
    }

    // Total
    $('totalAmount').textContent = '$' + fmtNum(pricing.total);
  }

  var _quoteId   = '';
  var _quoteData = null;

  async function handleAccept() {
    $('btnAccept').disabled = true;
    $('btnReject').disabled = true;
    try {
      await dbPut('quote_responses/' + encodeURIComponent(_quoteId), {
        type: 'accepted',
        respondedAt: Date.now()
      });
      $('confirmedQuoteNum').textContent =
        (_quoteData && _quoteData.quoteNumber) ? _quoteData.quoteNumber : _quoteId;
      showState('stateConfirmed');
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
    try {
      await dbPut('quote_responses/' + encodeURIComponent(_quoteId), {
        type: 'rejected',
        respondedAt: Date.now()
      });
      showState('stateRejected');
    } catch (e) {
      $('btnAccept').disabled = false;
      $('btnReject').disabled = false;
      alert('No se pudo registrar tu respuesta. Por favor intenta nuevamente.');
    }
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
      // Verificar si ya existe una respuesta
      var existing = null;
      try { existing = await dbGet('quote_responses/' + encodeURIComponent(id)); } catch (e) { /* no response yet */ }

      if (existing && existing.type) {
        var typeLabel = existing.type === 'accepted' ? 'aceptada' : 'rechazada';
        $('alreadyType').textContent = typeLabel;
        var icon = $('alreadyIcon');
        if (existing.type === 'accepted') {
          icon.className = 'state-icon accepted-icon';
          icon.innerHTML = '<i class="fas fa-circle-check"></i>';
        } else {
          icon.className = 'state-icon rejected-icon';
          icon.innerHTML = '<i class="fas fa-circle-xmark"></i>';
        }
        showState('stateAlreadyResponded');
        return;
      }

      // Cargar cotización pública
      var quote = null;
      try { quote = await dbGet('public_quotes/' + encodeURIComponent(id)); } catch (e) { /* handled below */ }

      if (!quote) {
        showState('stateError');
        $('errorMessage').textContent = 'No se encontró la cotización. El enlace puede haber expirado o ser inválido.';
        return;
      }

      _quoteData = quote;
      renderQuote(quote);
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
