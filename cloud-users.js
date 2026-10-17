// ============================================================
// NewTech System - Firebase Cloud Users Manager
// يتعامل مع حسابات المستخدمين عبر السحابة (Firebase Realtime DB)
// Fallback to localStorage if Firebase not configured
// ============================================================

window.CloudUsers = (function() {
  var db = null;
  var initialized = false;
  var initPromise = null;

  function init() {
    if (initPromise) return initPromise;
    initPromise = new Promise(function(resolve) {
      if (!window.FIREBASE_ENABLED) {
        console.log('[CloudUsers] Firebase not configured - using localStorage only');
        resolve(false);
        return;
      }
      try {
        // Firebase SDK must be loaded before this runs
        if (typeof firebase === 'undefined') {
          console.warn('[CloudUsers] Firebase SDK not loaded');
          resolve(false);
          return;
        }
        if (!firebase.apps || firebase.apps.length === 0) {
          firebase.initializeApp(window.FIREBASE_CONFIG);
        }
        db = firebase.database();
        initialized = true;
        console.log('[CloudUsers] Firebase Realtime DB connected ✓');
        resolve(true);
      } catch(e) {
        console.warn('[CloudUsers] Firebase init failed:', e.message);
        resolve(false);
      }
    });
    return initPromise;
  }

  function generate12CharCode() {
    var chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    var code = '';
    for (var i = 0; i < 12; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code.slice(0, 4) + '-' + code.slice(4, 8) + '-' + code.slice(8, 12);
  }

  function cleanCode(code) {
    if (!code) return '';
    return String(code).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  }

  function formatCode(code) {
    var c = cleanCode(code);
    if (c.length !== 12) return code;
    return c.slice(0, 4) + '-' + c.slice(4, 8) + '-' + c.slice(8, 12);
  }

  async function getUser(username) {
    var ready = await init();
    if (!ready || !db) return null;
    try {
      var snap = await db.ref('newtech_users/' + username.toLowerCase()).once('value');
      return snap.val() || null;
    } catch(e) {
      return null;
    }
  }

  async function saveUser(user) {
    var ready = await init();
    var key = (user.username || '').toLowerCase();
    if (!key) return false;
    var c = cleanCode(user.syncCode);
    var userData = {
      id: user.id,
      username: key,
      fullName: user.fullName || user.username,
      passwordHash: user.passwordHash,
      role: user.role || 'user',
      syncCode: c || undefined,
      formattedCode: c && c.length === 12 ? formatCode(c) : undefined,
      createdAt: user.createdAt || new Date().toISOString()
    };
    if (ready && db) {
      try {
        await db.ref('newtech_users/' + key).set(userData);
        if (c && c.length === 12) {
          await db.ref('newtech_sync_codes/' + c).set(userData);
        }
      } catch(e) {
        console.warn('[CloudUsers] saveUser failed:', e.message);
      }
    }
    if (c && c.length === 12) {
      try {
        var map = JSON.parse(localStorage.getItem('newtech_sync_codes_cache') || '{}');
        map[c] = userData;
        localStorage.setItem('newtech_sync_codes_cache', JSON.stringify(map));
      } catch(e) {}
    }
    return true;
  }

  async function saveSyncCode(code, user) {
    var ready = await init();
    var c = cleanCode(code);
    if (!c || c.length !== 12) return false;
    var payload = {
      id: user.id,
      username: (user.username || '').toLowerCase(),
      fullName: user.fullName || user.username,
      passwordHash: user.passwordHash,
      role: user.role || 'user',
      createdAt: user.createdAt || new Date().toISOString(),
      syncCode: c,
      formattedCode: formatCode(c),
      updatedAt: new Date().toISOString()
    };
    if (ready && db) {
      try {
        await db.ref('newtech_sync_codes/' + c).set(payload);
        if (user.username) {
          await db.ref('newtech_users/' + user.username.toLowerCase() + '/syncCode').set(c);
        }
      } catch(e) {
        console.warn('[CloudUsers] saveSyncCode failed:', e.message);
      }
    }
    try {
      var map = JSON.parse(localStorage.getItem('newtech_sync_codes_cache') || '{}');
      map[c] = payload;
      localStorage.setItem('newtech_sync_codes_cache', JSON.stringify(map));
    } catch(e) {}
    return true;
  }

  async function getUserBySyncCode(code) {
    var c = cleanCode(code);
    if (!c || c.length !== 12) return null;
    var ready = await init();
    if (ready && db) {
      try {
        var snap = await db.ref('newtech_sync_codes/' + c).once('value');
        var val = snap.val();
        if (val && val.username && val.passwordHash) return val;
      } catch(e) {
        console.warn('[CloudUsers] getUserBySyncCode cloud error:', e.message);
      }
    }
    try {
      var map = JSON.parse(localStorage.getItem('newtech_sync_codes_cache') || '{}');
      if (map[c]) return map[c];
    } catch(e) {}
    try {
      var localUsers = JSON.parse(localStorage.getItem('newtech_users_v3') || '[]');
      var found = localUsers.find(function(u) { return cleanCode(u.syncCode) === c; });
      if (found) return found;
    } catch(e) {}
    return null;
  }

  async function isReady() {
    var r = await init();
    return r;
  }

  return {
    init: init,
    getUser: getUser,
    saveUser: saveUser,
    saveSyncCode: saveSyncCode,
    getUserBySyncCode: getUserBySyncCode,
    generate12CharCode: generate12CharCode,
    cleanCode: cleanCode,
    formatCode: formatCode,
    isReady: isReady
  };
})();
