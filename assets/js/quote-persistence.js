(function() {
  const PENDING_QUOTE_STORAGE_KEY = 'cotiz_pending_quote_v1';

  function $(id) {
    return document.getElementById(id);
  }

  function getBridge() {
    return window.CotizPersistenceBridge || null;
  }

  function showToastSafe(message, type) {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type || 'success');
    }
  }

  async function getAuthContext(requireAuth) {
    if (!window.FirebaseAuthService) {
      if (requireAuth) throw new Error('Módulo de autenticación no disponible.');
      return null;
    }

    const user = window.FirebaseAuthService.getCurrentUser();
    const idToken = await window.FirebaseAuthService.getValidIdToken();

    if (!user || !idToken) {
      if (requireAuth) throw new Error('Debes iniciar sesión en Historial para guardar cotizaciones.');
      return null;
    }

    return { user, idToken };
  }

  // Jerarquía de estados: a mayor índice, más avanzado
  const STATUS_RANK = ['draft', 'issued', 'accepted', 'scheduled', 'completed', 'warranty'];

  function effectiveStatus(requested, existing) {
    const reqIdx = STATUS_RANK.indexOf(requested || 'draft');
    const exiIdx = STATUS_RANK.indexOf(existing  || 'draft');
    // Preservar el estado más avanzado (nunca retroceder)
    return exiIdx > reqIdx ? existing : requested;
  }

  async function persistCurrentQuote(status, options) {
    const opts = options || {};
    const requireAuth = !!opts.requireAuth;
    const silent = !!opts.silent;

    if (!window.QuotesRepo) {
      if (!silent) showToastSafe('No se pudo guardar: módulo de cotizaciones no cargado.', 'error');
      return null;
    }

    const bridge = getBridge();
    if (!bridge) {
      if (!silent) showToastSafe('No se pudo guardar: puente de estado no disponible.', 'error');
      return null;
    }

    try {
      const auth = await getAuthContext(requireAuth);
      if (!auth) return null;

      const existingId = bridge.getActiveQuoteId();
      // Nunca retroceder el estado: si la cotización ya tiene un estado más
      // avanzado (ej. 'issued'), no lo sobreescribimos con 'draft'.
      const currentStatus = typeof bridge.getActiveQuoteStatus === 'function'
        ? bridge.getActiveQuoteStatus()
        : 'draft';
      const resolvedStatus = effectiveStatus(status || 'draft', currentStatus);
      const payload = bridge.exportQuoteSnapshot(resolvedStatus);
      // Actualizar el status en memoria para reflejar el estado guardado
      if (typeof bridge.setActiveQuoteStatus === 'function') {
        bridge.setActiveQuoteStatus(resolvedStatus);
      }
      const result = await window.QuotesRepo.saveQuote(auth.user.uid, auth.idToken, payload, existingId || null);
      bridge.setActiveQuoteId(result.id);

      // Sync client directory in background (fire-and-forget, must not block user flow)
      if (window.ClientRepo && payload.client && payload.client.name) {
        window.ClientRepo.syncClientForQuote(auth.user.uid, auth.idToken, payload.client, result.id).catch(function() {});
      }

      // Sync AC ranking counters in background (fire-and-forget)
      if (window.RankingRepo && payload.equipmentSelections && payload.equipmentSelections.length) {
        window.RankingRepo.incrementAcRankings(auth.user.uid, auth.idToken, payload.equipmentSelections).catch(function() {});
      }

      if (!silent) {
        const label = status === 'issued' ? 'emitida' : 'guardada';
        showToastSafe(`Cotización ${label} correctamente`, 'success');
      }

      return result;
    } catch (e) {
      if (!silent) showToastSafe(`No se pudo guardar: ${e.message}`, 'error');
      return null;
    }
  }

  async function saveDraftQuote() {
    return persistCurrentQuote('draft', { requireAuth: true, silent: false });
  }

  function readPendingQuote() {
    try {
      const raw = sessionStorage.getItem(PENDING_QUOTE_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function clearPendingQuote() {
    sessionStorage.removeItem(PENDING_QUOTE_STORAGE_KEY);
  }

  function applyPendingQuoteIfAny() {
    const bridge = getBridge();
    if (!bridge) return;

    const payload = readPendingQuote();
    if (!payload || !payload.quote) return;

    const originalToast = window.showToast;
    window.showToast = function() {};
    try {
      bridge.importQuoteSnapshot(payload.quote);
    } finally {
      window.showToast = originalToast;
      clearPendingQuote();
    }

    showToastSafe('Cotización cargada para edición', 'success');
  }

  function showSavePrompt() {
    return new Promise(function(resolve) {
      var modal = document.getElementById('savePromptModal');
      if (!modal) { resolve('continue'); return; }
      modal.classList.add('open');
      var loginBtn = document.getElementById('savePromptLogin');
      var continueBtn = document.getElementById('savePromptContinue');
      function cleanup() { modal.classList.remove('open'); }
      if (loginBtn) loginBtn.onclick = function() { cleanup(); resolve('login'); };
      if (continueBtn) continueBtn.onclick = function() { cleanup(); resolve('continue'); };
      modal.onclick = function(e) { if (e.target === modal) { cleanup(); resolve('continue'); } };
    });
  }

  function patchGeneratePdfForAutosave() {
    if (typeof window.generatePDF !== 'function') return;
    if (window.generatePDF.__patchedWithPersistence) return;

    const original = window.generatePDF;
    window.generatePDF = async function patchedGeneratePDF() {
      // Validar antes de guardar o generar
      const bridge = getBridge();
      if (bridge && typeof bridge.validateQuoteForGeneration === 'function') {
        if (!bridge.validateQuoteForGeneration()) return;
      }
      const auth = await getAuthContext(false);
      if (!auth) {
        const choice = await showSavePrompt();
        if (choice === 'login') { openLoginModal(); return; }
        await original();
        if (bridge && typeof bridge.resetAll === 'function') bridge.resetAll();
        return;
      }
      let saved = null;
      try {
        saved = await persistCurrentQuote('issued', { requireAuth: false, silent: true });
      } catch (e) {
        saved = null;
      }
      await original();
      if (saved) {
        showToastSafe('PDF generado y cotización guardada', 'success');
      }
      if (bridge && typeof bridge.resetAll === 'function') bridge.resetAll();
    };

    window.generatePDF.__patchedWithPersistence = true;
  }

  function patchSharePdfForAutosave() {
    if (typeof window.sharePDF !== 'function') return;
    if (window.sharePDF.__patchedWithPersistence) return;

    const original = window.sharePDF;
    window.sharePDF = async function patchedSharePDF() {
      // Validar antes de guardar o compartir
      const bridge = getBridge();
      if (bridge && typeof bridge.validateQuoteForGeneration === 'function') {
        if (!bridge.validateQuoteForGeneration()) return;
      }
      const auth = await getAuthContext(false);
      if (!auth) {
        const choice = await showSavePrompt();
        if (choice === 'login') { openLoginModal(); return; }
        await original();
        if (bridge && typeof bridge.resetAll === 'function') bridge.resetAll();
        return;
      }
      try {
        await persistCurrentQuote('issued', { requireAuth: false, silent: true });
      } catch (e) {
        // persistencia silenciosa; no bloquear flujo de compartir
      }
      await original();
      if (bridge && typeof bridge.resetAll === 'function') bridge.resetAll();
    };

    window.sharePDF.__patchedWithPersistence = true;
  }

  function closeMenu() {
    const menu = $('hamburgerMenu');
    const trigger = $('btnHamburgerMenu');
    if (menu) menu.style.display = 'none';
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  }

  function openMenu() {
    const menu = $('hamburgerMenu');
    const trigger = $('btnHamburgerMenu');
    if (menu) menu.style.display = 'block';
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
  }

  function isAuthenticated() {
    if (!window.FirebaseAuthService) return false;
    return !!window.FirebaseAuthService.getCurrentUser();
  }

  function updateAuthMenuState() {
    const loginAction = $('menuLoginAction');
    const historyAction = $('menuOpenHistory');
    const sessionText = $('menuSessionText');
    const auth = window.FirebaseAuthService;
    const user = auth ? auth.getCurrentUser() : null;
    const logged = !!user;

    if (historyAction) historyAction.disabled = !logged;
    const catalogAction = $('menuOpenCatalog');
    if (catalogAction) catalogAction.disabled = !logged;
    if (loginAction) loginAction.textContent = logged ? 'Cerrar sesión' : 'Iniciar sesión';
    if (sessionText) sessionText.textContent = logged ? `Sesión: ${user.email || user.uid}` : 'Sin sesión';
  }

  function openLoginModal() {
    const modal = $('loginModal');
    const status = $('loginModalStatus');
    if (status) {
      status.textContent = '';
      status.style.color = 'var(--text-muted)';
    }
    if (modal) modal.classList.add('open');
  }

  function closeLoginModal() {
    const modal = $('loginModal');
    if (modal) modal.classList.remove('open');
  }

  async function submitLoginFromModal() {
    if (!window.FirebaseAuthService) {
      showToastSafe('No se pudo iniciar sesión: módulo auth no cargado.', 'error');
      return;
    }

    const emailEl = $('loginEmailInput');
    const passwordEl = $('loginPasswordInput');
    const statusEl = $('loginModalStatus');
    const email = emailEl ? emailEl.value.trim() : '';
    const password = passwordEl ? passwordEl.value : '';

    if (!email || !password) {
      if (statusEl) {
        statusEl.textContent = 'Completa correo y contraseña.';
        statusEl.style.color = 'var(--red)';
      }
      return;
    }

    try {
      if (statusEl) {
        statusEl.textContent = 'Validando credenciales...';
        statusEl.style.color = 'var(--text-muted)';
      }
      await window.FirebaseAuthService.signIn(email, password);
      updateAuthMenuState();
      closeLoginModal();
      // Actualizar correlativo si el número actual era provisional
      if (window.CotizPersistenceBridge && typeof window.CotizPersistenceBridge.refreshQuoteNumberAfterLogin === 'function') {
        window.CotizPersistenceBridge.refreshQuoteNumberAfterLogin().catch(function() {});
      }
      showToastSafe('Sesión iniciada. Historial habilitado.', 'success');
    } catch (e) {
      const mapper = window.FirebaseAuthService.mapAuthError;
      const msg = typeof mapper === 'function' ? mapper(e.message || 'Error de autenticación') : (e.message || 'Error de autenticación');
      if (statusEl) {
        statusEl.textContent = msg;
        statusEl.style.color = 'var(--red)';
      }
    }
  }

  function bindHeaderMenuEvents() {
    const menuTrigger = $('btnHamburgerMenu');
    const menuNode = $('hamburgerMenu');
    const loginAction = $('menuLoginAction');
    const historyAction = $('menuOpenHistory');
    const closeLoginBtn = $('btnCloseLoginModal');
    const submitLoginBtn = $('btnSubmitLoginModal');
    const loginModal = $('loginModal');

    if (menuTrigger && menuNode) {
      menuTrigger.addEventListener('click', function(e) {
        e.stopPropagation();
        const isOpen = menuNode.style.display === 'block';
        if (isOpen) closeMenu(); else openMenu();
      });
    }

    if (loginAction) {
      loginAction.addEventListener('click', function() {
        closeMenu();
        if (isAuthenticated()) {
          window.FirebaseAuthService.signOut();
          updateAuthMenuState();
          // Regenerar número provisional al cerrar sesión
          const bridge = getBridge();
          if (bridge && typeof bridge.generateQuoteNumber === 'function') {
            bridge.generateQuoteNumber().catch(function() {});
          }
          showToastSafe('Sesión cerrada.', 'success');
          return;
        }
        openLoginModal();
      });
    }

    if (historyAction) {
      historyAction.addEventListener('click', function() {
        closeMenu();
        if (!isAuthenticated()) {
          showToastSafe('Inicia sesión para ver el historial y clientes.', 'error');
          openLoginModal();
          return;
        }
        window.location.href = 'quotes.html';
      });
    }

    const catalogAction = $('menuOpenCatalog');
    if (catalogAction) {
      catalogAction.addEventListener('click', function() {
        closeMenu();
        if (!isAuthenticated()) {
          showToastSafe('Inicia sesión para acceder al catálogo.', 'error');
          openLoginModal();
          return;
        }
        window.location.href = 'catalog.html';
      });
    }

    if (closeLoginBtn) closeLoginBtn.addEventListener('click', closeLoginModal);
    if (submitLoginBtn) submitLoginBtn.addEventListener('click', submitLoginFromModal);

    const passwordInput = $('loginPasswordInput');
    if (passwordInput) {
      passwordInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitLoginFromModal();
        }
      });
    }

    if (loginModal) {
      loginModal.addEventListener('click', function(e) {
        if (e.target === loginModal) closeLoginModal();
      });
    }

    document.addEventListener('click', function(e) {
      if (!menuNode || menuNode.style.display !== 'block') return;
      if (menuNode.contains(e.target) || (menuTrigger && menuTrigger.contains(e.target))) return;
      closeMenu();
    });
  }

  function initPersistenceFeatures() {
    patchGeneratePdfForAutosave();
    patchSharePdfForAutosave();
    applyPendingQuoteIfAny();
    bindHeaderMenuEvents();
    updateAuthMenuState();
  }

  window.saveDraftQuote = saveDraftQuote;
  window.CotizQuotePersistence = {
    persistCurrentQuote,
    PENDING_QUOTE_STORAGE_KEY
  };

  if (window.__cotizAppReady) {
    initPersistenceFeatures();
  } else {
    document.addEventListener('cotiz:app-ready', initPersistenceFeatures, { once: true });
  }
})();
