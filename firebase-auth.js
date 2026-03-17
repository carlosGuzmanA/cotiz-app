(function() {
  const AUTH_STORAGE_KEY = 'cotiz_auth_session_v1';

  const FIREBASE_AUTH_CONFIG = {
    apiKey: 'AIzaSyAIvIig9S0bQPYDf_eilrPB7lWbiWPy9EU'
  };

  function readSession() {
    try {
      // Migrar sesión antigua de sessionStorage si existe
      const legacy = sessionStorage.getItem(AUTH_STORAGE_KEY);
      if (legacy) {
        localStorage.setItem(AUTH_STORAGE_KEY, legacy);
        sessionStorage.removeItem(AUTH_STORAGE_KEY);
      }
      const raw = localStorage.getItem(AUTH_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeSession(session) {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  }

  function clearSession() {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
  }

  function parseJwt(token) {
    try {
      const payload = token.split('.')[1];
      const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
      return JSON.parse(json);
    } catch (e) {
      return null;
    }
  }

  function getApiKey() {
    const key = (FIREBASE_AUTH_CONFIG.apiKey || '').trim();
    if (!key || key === '') {
      throw new Error('Configura FIREBASE_AUTH_CONFIG.apiKey en firebase-auth.js');
    }
    return key;
  }

  async function authRequest(path, body) {
    const apiKey = getApiKey();
    const endpoint = `https://identitytoolkit.googleapis.com/v1/${path}?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await res.json();
    if (!res.ok) {
      const msg = (data && data.error && data.error.message) || `HTTP ${res.status}`;
      throw new Error(msg);
    }

    return data;
  }

  async function refreshIdToken(refreshToken) {
    const apiKey = getApiKey();
    const endpoint = `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`;
    const form = new URLSearchParams();
    form.set('grant_type', 'refresh_token');
    form.set('refresh_token', refreshToken);

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    });

    const data = await res.json();
    if (!res.ok) {
      const msg = (data && data.error && data.error.message) || `HTTP ${res.status}`;
      throw new Error(msg);
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const expiresIn = Number(data.expires_in || 3600);
    const jwt = parseJwt(data.id_token) || {};

    const session = {
      idToken: data.id_token,
      refreshToken: data.refresh_token,
      uid: data.user_id || jwt.user_id || '',
      email: jwt.email || '',
      expiresAt: nowSec + expiresIn - 30
    };

    writeSession(session);
    return session.idToken;
  }

  async function signIn(email, password) {
    const data = await authRequest('accounts:signInWithPassword', {
      email,
      password,
      returnSecureToken: true
    });

    const nowSec = Math.floor(Date.now() / 1000);
    const expiresIn = Number(data.expiresIn || 3600);
    const jwt = parseJwt(data.idToken) || {};

    const session = {
      idToken: data.idToken,
      refreshToken: data.refreshToken,
      uid: data.localId || jwt.user_id || '',
      email: data.email || jwt.email || email,
      expiresAt: nowSec + expiresIn - 30
    };

    writeSession(session);
    return { uid: session.uid, email: session.email };
  }

  function signOut() {
    clearSession();
  }

  function getCurrentUser() {
    const session = readSession();
    if (!session || !session.idToken || !session.uid) return null;
    return { uid: session.uid, email: session.email || '' };
  }

  async function getValidIdToken() {
    const session = readSession();
    if (!session || !session.idToken) return null;

    const nowSec = Math.floor(Date.now() / 1000);
    if (session.expiresAt && session.expiresAt > nowSec) {
      return session.idToken;
    }

    if (!session.refreshToken) {
      clearSession();
      return null;
    }

    try {
      return await refreshIdToken(session.refreshToken);
    } catch (e) {
      clearSession();
      return null;
    }
  }

  function mapAuthError(message) {
    const map = {
      EMAIL_NOT_FOUND: 'Usuario no encontrado.',
      INVALID_PASSWORD: 'Contraseña incorrecta.',
      USER_DISABLED: 'Usuario deshabilitado.',
      INVALID_EMAIL: 'Correo inválido.',
      TOO_MANY_ATTEMPTS_TRY_LATER: 'Demasiados intentos. Intenta más tarde.'
    };
    return map[message] || message;
  }

  window.FirebaseAuthService = {
    signIn,
    signOut,
    getCurrentUser,
    getValidIdToken,
    mapAuthError,
    AUTH_STORAGE_KEY
  };
})();
