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
    if (!ready || !db) return false;
    try {
      var key = (user.username || '').toLowerCase();
      if (!key) return false;
      await db.ref('newtech_users/' + key).set({
        id: user.id,
        username: key,
        fullName: user.fullName || user.username,
        passwordHash: user.passwordHash,
        role: user.role || 'user',
        createdAt: user.createdAt || new Date().toISOString()
      });
      return true;
    } catch(e) {
      console.warn('[CloudUsers] saveUser failed:', e.message);
      return false;
    }
  }

  async function isReady() {
    var r = await init();
    return r;
  }

  return { init: init, getUser: getUser, saveUser: saveUser, isReady: isReady };
})();
