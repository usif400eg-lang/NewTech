/**
 * NewTech System - Enterprise Sales, Purchases, Clearing & Multi-Device ERP Engine
 * المحرك المالي المتكامل:
 * 1. حسابات الشركات والموردين
 * 2. التصفية والمقاصة التلقائية بين الحسابات (لي عندهم: أحمر | عليّ لهم: أخضر)
 * 3. فواتير مشتريات بأصناف غير محدودة
 * 4. زر مرتجع بجانب تم الدفع (لون أصفر للمرتجع)
 * 5. نظام تسجيل الدخول وإنشاء الحسابات والمزامنة بين الأجهزة
 * 6. قاعدة بيانات مركزية PostgreSQL + محلية SQLite
 */

(function () {
  'use strict';

  const STORAGE_KEYS = {
    COMPANIES: 'newtech_companies_v3',
    ITEMS: 'newtech_items_v3',
    PURCHASES: 'newtech_purchases_v3',
    VOUCHERS: 'newtech_vouchers',
    EXPENSES: 'newtech_expenses',
    PRODUCTS: 'newtech_products',
    SALES: 'newtech_sales',
    PAYOUTS: 'newtech_payouts',
    CURRENT_USER: 'newtech_active_user_v3',
    CLOUD_CONFIG: 'newtech_cloud_config_v3'
  };

  const ARABIC_DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

  let appState = {
    companies: [],
    items: [],           // المسحوبات / المبيعات
    purchases: [],       // فواتير المشتريات
    vouchers: [],        // سندات القبض والصرف
    expenses: [],        // المصروفات العامة والنثريات
    products: [],        // المخزن والأصناف
    sales: [],           // فواتير مبيعات الكاشير POS
    payouts: [],         // أذونات صرف نقدية من الدرج
    posCart: [],         // سلة مشتريات الكاشير الحالية
    activeCartItemId: null, // الصنف النشط المحدد في سلة الكاشير
    posInlinePending: false, // حالة فتح سطر جديد لكتابة الكود بالترتيب (F12)
    currentInspectedProduct: null, // الصنف المعروض للاستعلام (F5, F4, F2)
    activeView: 'POS',   // 'POS' | 'REGISTER'
    posCategory: 'ALL',
    posSearch: '',
    users: [],
    currentUser: null,   // المستخدم النشط
    filters: {
      searchQuery: '',
      companyId: 'ALL',
      status: 'ALL',     // 'ALL' | 'UNPAID' | 'PAID' | 'RETURNED'
      dateRange: 'ALL'
    }
  };

  // ==========================================================================
  // 0. Audio Synthesizer (المؤثرات الصوتية التفاعلية)
  // ==========================================================================
  let soundEnabled = true;
  let audioCtx = null;

  function getAudioContext() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
    }
    return audioCtx;
  }

  function playTone(freq = 880, type = 'sine', duration = 0.12, vol = 0.18) {
    if (!soundEnabled) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.05, ctx.currentTime + duration * 0.5);
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duration);
    } catch(e) {}
  }

  function playSoundAdd() {
    playTone(660, 'triangle', 0.14, 0.15);
    setTimeout(() => playTone(880, 'sine', 0.1, 0.12), 80);
  }

  function playSoundPaid() {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => playTone(f, 'sine', 0.12, 0.18), i * 60));
  }

  function playSoundReturn() {
    [784, 659, 523].forEach((f, i) => setTimeout(() => playTone(f, 'triangle', 0.14, 0.18), i * 70));
  }

  function playSoundDelete() {
    playTone(220, 'sawtooth', 0.18, 0.12);
    setTimeout(() => playTone(160, 'sawtooth', 0.15, 0.1), 100);
  }

  function playSoundUnpay() {
    playTone(440, 'triangle', 0.1, 0.12);
    setTimeout(() => playTone(330, 'triangle', 0.12, 0.1), 80);
  }

  // تأثير جزيئات عند السداد
  function spawnParticles(originEl) {
    const rect = originEl ? originEl.getBoundingClientRect() : { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0, height: 0 };
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const colors = ['#10b981', '#a78bfa', '#38bdf8', '#fbbf24', '#f0abfc'];
    for (let i = 0; i < 18; i++) {
      const el = document.createElement('div');
      el.className = 'pay-particle';
      const color = colors[Math.floor(Math.random() * colors.length)];
      el.style.backgroundColor = color;
      el.style.boxShadow = `0 0 10px ${color}`;
      el.style.left = `${cx}px`;
      el.style.top = `${cy}px`;
      const angle = Math.random() * Math.PI * 2;
      const dist = 35 + Math.random() * 65;
      el.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      el.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 700);
    }
  }

  // ==========================================================================
  // 1. نظام تسجيل الدخول وإنشاء الحسابات (Authentication & Multi-Device Sync)
  // ==========================================================================
  async function setupAuth() {
    var loginScreen = document.getElementById('loginScreen');
    var tabLoginBtn = document.getElementById('tabLoginBtn');
    var tabRegisterBtn = document.getElementById('tabRegisterBtn');
    var loginForm = document.getElementById('loginForm');
    var registerForm = document.getElementById('registerForm');
    var loginUsernameInput = document.getElementById('loginUsernameInput');
    var loginPasswordInput = document.getElementById('loginPasswordInput');
    var loginErrorMsg = document.getElementById('loginErrorMsg');
    var logoutBtn = document.getElementById('logoutBtn');
    var currentUserNameText = document.getElementById('currentUserNameText');

    if (tabLoginBtn && tabRegisterBtn) {
      tabLoginBtn.addEventListener('click', function() {
        tabLoginBtn.classList.add('active');
        tabRegisterBtn.classList.remove('active');
        if (loginForm) loginForm.style.display = 'block';
        if (registerForm) registerForm.style.display = 'none';
        if (loginErrorMsg) loginErrorMsg.style.display = 'none';
      });
      tabRegisterBtn.addEventListener('click', function() {
        tabRegisterBtn.classList.add('active');
        tabLoginBtn.classList.remove('active');
        if (loginForm) loginForm.style.display = 'none';
        if (registerForm) registerForm.style.display = 'block';
        var regErrorMsg = document.getElementById('regErrorMsg');
        if (regErrorMsg) regErrorMsg.style.display = 'none';
      });
    }

    // Init default admin in localStorage
    try {
      var localUsers0 = JSON.parse(localStorage.getItem('newtech_users_v3') || '[]');
      var hasAdmin = localUsers0.some(function(u) { return (u.username || '').toLowerCase() === 'admin'; });
      if (!hasAdmin) {
        localUsers0.push({
          id: 'user_admin_root',
          username: 'admin',
          fullName: '\u0627\u0644\u0645\u0634\u0631\u0641 \u0627\u0644\u0631\u0626\u064a\u0633\u064a (Admin)',
          passwordHash: '1',
          role: 'admin',
          createdAt: new Date().toISOString()
        });
        localStorage.setItem('newtech_users_v3', JSON.stringify(localUsers0));
      }
      if (window.newTechDB) {
        var existingAdmin = await window.newTechDB.getUserByUsername('admin');
        if (!existingAdmin) {
          await window.newTechDB.saveUser({
            id: 'user_admin_root',
            username: 'admin',
            fullName: '\u0627\u0644\u0645\u0634\u0631\u0641 \u0627\u0644\u0631\u0626\u064a\u0633\u064a (Admin)',
            passwordHash: '1',
            role: 'admin',
            createdAt: new Date().toISOString()
          });
        }
      }
    } catch (e) {
      console.warn('Init default admin notice:', e);
    }

    // Check saved session
    var savedUserJson = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
    if (savedUserJson) {
      try {
        appState.currentUser = JSON.parse(savedUserJson);
        if (loginScreen) {
          loginScreen.classList.add('is-hidden');
          loginScreen.style.display = 'none';
        }
        if (currentUserNameText) currentUserNameText.textContent = '\u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645: ' + (appState.currentUser.fullName || appState.currentUser.username);
      } catch (e) {
        localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
      }
    } else {
      if (loginScreen) {
        loginScreen.classList.remove('is-hidden');
        loginScreen.style.display = 'flex';
      }
    }

    async function doLogin() {
      try {
        var username = loginUsernameInput ? loginUsernameInput.value.trim() : '';
        var password = loginPasswordInput ? loginPasswordInput.value.trim() : '';

        if (!username || !password) {
          if (loginErrorMsg) {
            loginErrorMsg.style.display = 'flex';
            var errSpan0 = document.getElementById('loginErrorText');
            if (errSpan0) errSpan0.textContent = '\u064a\u0631\u062c\u0649 \u0625\u062f\u062e\u0627\u0644 \u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645 \u0648\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631';
          }
          return;
        }

        var user = null;

        // 1. Check localStorage first (fastest)
        try {
          var localUsers1 = JSON.parse(localStorage.getItem('newtech_users_v3') || '[]');
          user = localUsers1.find(function(u) { return (u.username || '').toLowerCase() === username.toLowerCase(); }) || null;
        } catch(e1) {}

        // 2. Check IndexedDB
        if (!user && window.newTechDB) {
          try { user = await window.newTechDB.getUserByUsername(username); } catch(e2) {}
        }

        // 3. Check Firebase Cloud (cross-device sync)
        if (!user && window.CloudUsers) {
          try {
            var cloudUser = await window.CloudUsers.getUser(username);
            if (cloudUser && cloudUser.passwordHash === password) {
              user = cloudUser;
              // Cache locally for offline use
              try {
                var localUsers1b = JSON.parse(localStorage.getItem('newtech_users_v3') || '[]');
                var existsLocally = localUsers1b.some(function(u) { return (u.username||'').toLowerCase() === (cloudUser.username||'').toLowerCase(); });
                if (!existsLocally) {
                  localUsers1b.push(cloudUser);
                  localStorage.setItem('newtech_users_v3', JSON.stringify(localUsers1b));
                }
              } catch(ec) {}
            }
          } catch(e3) {}
        }

        var isDefaultAdmin = (username.toLowerCase() === 'admin' && password === '1');
        var isRegisteredUser = (user && user.passwordHash === password);

        if (isDefaultAdmin || isRegisteredUser) {
          if (!user) {
            user = { id: 'user_admin_root', username: 'admin', fullName: '\u0627\u0644\u0645\u0634\u0631\u0641 \u0627\u0644\u0631\u0626\u064a\u0633\u064a', role: 'admin' };
          }
          if (loginErrorMsg) loginErrorMsg.style.display = 'none';
          appState.currentUser = user;
          localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(user));
          if (currentUserNameText) currentUserNameText.textContent = '\u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645: ' + (user.fullName || user.username);
          if (loginScreen) {
            loginScreen.classList.add('is-hidden');
            loginScreen.style.display = 'none';
          }
          if (loginForm) loginForm.reset();
          await loadData();
          renderAll();
          showToast('\u0645\u0631\u062d\u0628\u0627\u064b \u0628\u0643 \u064a\u0627 ' + (user.fullName || user.username) + ' \u0641\u064a NewTech System!');
        } else {
          if (loginErrorMsg) {
            loginErrorMsg.style.display = 'flex';
            var errSpan1 = document.getElementById('loginErrorText');
            if (errSpan1) errSpan1.textContent = '\u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645 \u0623\u0648 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u063a\u064a\u0631 \u0635\u062d\u064a\u062d\u0629!';
          }
          if (loginPasswordInput) { loginPasswordInput.value = ''; loginPasswordInput.focus(); }
        }
      } catch (err) {
        console.error('Login error:', err);
        if (loginErrorMsg) {
          loginErrorMsg.style.display = 'flex';
          var errSpan2 = document.getElementById('loginErrorText');
          if (errSpan2) errSpan2.textContent = '\u062e\u0637\u0623 \u0623\u062b\u0646\u0627\u0621 \u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062f\u062e\u0648\u0644: ' + (err.message || '\u062d\u0627\u0648\u0644 \u062b\u0627\u0646\u064a\u0629');
        }
      }
    }

    async function doRegister() {
      var regErrorMsg = document.getElementById('regErrorMsg');
      var regErrorText = document.getElementById('regErrorText');
      function showRegErr(msg) {
        if (regErrorMsg) regErrorMsg.style.display = 'flex';
        if (regErrorText) regErrorText.textContent = msg;
      }
      try {
        var fnEl = document.getElementById('regFullNameInput');
        var unEl = document.getElementById('regUsernameInput');
        var pwEl = document.getElementById('regPasswordInput');
        var cpEl = document.getElementById('regConfirmPasswordInput');
        var fullName = fnEl ? fnEl.value.trim() : '';
        var username = unEl ? unEl.value.trim() : '';
        var password = pwEl ? pwEl.value.trim() : '';
        var confirmPassword = cpEl ? cpEl.value.trim() : '';

        if (!fullName || !username || !password) {
          showRegErr('\u064a\u0631\u062c\u0649 \u0625\u0643\u0645\u0627\u0644 \u062c\u0645\u064a\u0639 \u0627\u0644\u062d\u0642\u0648\u0644 \u0627\u0644\u0645\u0637\u0644\u0648\u0628\u0629!');
          return;
        }
        if (password !== confirmPassword) {
          showRegErr('\u0643\u0644\u0645\u0627\u062a \u0627\u0644\u0645\u0631\u0648\u0631 \u063a\u064a\u0631 \u0645\u062a\u0637\u0627\u0628\u0642\u0629\u060c \u064a\u0631\u062c\u0649 \u0625\u0639\u0627\u062f\u0629 \u0627\u0644\u062a\u062d\u0642\u0642!');
          return;
        }

        var localUsers2 = JSON.parse(localStorage.getItem('newtech_users_v3') || '[]');
        if (localUsers2.find(function(u) { return (u.username || '').toLowerCase() === username.toLowerCase(); })) {
          showRegErr('\u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645 \u0645\u0633\u062c\u0644 \u0645\u0633\u0628\u0642\u0627\u064b\u060c \u0627\u062e\u062a\u0631 \u0627\u0633\u0645\u0627\u064b \u0622\u062e\u0631!');
          return;
        }
        if (window.newTechDB) {
          try {
            var dbEx = await window.newTechDB.getUserByUsername(username);
            if (dbEx) { showRegErr('\u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645 \u0645\u0633\u062c\u0644 \u0645\u0633\u0628\u0642\u0627\u064b\u060c \u0627\u062e\u062a\u0631 \u0627\u0633\u0645\u0627\u064b \u0622\u062e\u0631!'); return; }
          } catch(e3) {}
        }

        var syncCode12 = (window.CloudUsers && window.CloudUsers.generate12CharCode)
          ? window.CloudUsers.generate12CharCode()
          : (function() {
              var chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
              var s = '';
              for (var i = 0; i < 12; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
              return s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8, 12);
            })();

        var newUser = {
          id: 'user_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
          username: username.toLowerCase(),
          fullName: fullName,
          passwordHash: password,
          role: 'user',
          syncCode: syncCode12.replace(/[^a-zA-Z0-9]/g, '').toUpperCase(),
          formattedCode: syncCode12,
          createdAt: new Date().toISOString()
        };

        localUsers2.push(newUser);
        localStorage.setItem('newtech_users_v3', JSON.stringify(localUsers2));

        if (window.newTechDB) {
          try { await window.newTechDB.saveUser(newUser); } catch(e4) {}
        }

        // Save to Firebase Cloud for cross-device access
        if (window.CloudUsers) {
          try {
            await window.CloudUsers.saveUser(newUser);
            await window.CloudUsers.saveSyncCode(newUser.syncCode, newUser);
          } catch(e5) {}
        }

        appState.currentUser = newUser;
        localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(newUser));
        if (currentUserNameText) currentUserNameText.textContent = '\u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645: ' + (newUser.fullName || newUser.username);
        if (loginScreen) {
          loginScreen.classList.add('is-hidden');
          loginScreen.style.display = 'none';
        }
        if (registerForm) registerForm.reset();
        await loadData();
        renderAll();
        showToast('\u062a\u0645 \u0625\u0646\u0634\u0627\u0621 \u062d\u0633\u0627\u0628\u0643 \u0628\u0646\u062c\u0627\u062d! \u0645\u0631\u062d\u0628\u0627\u064b \u0628\u0643 \u064a\u0627 ' + fullName + '.');
      } catch (err) {
        console.error('Register error:', err);
        showRegErr('\u062d\u062f\u062b \u062e\u0637\u0623: ' + (err.message || '\u062d\u0627\u0648\u0644 \u062b\u0627\u0646\u064a\u0629'));
      }
    }

    if (loginForm) {
      loginForm.addEventListener('submit', async function(e) { e.preventDefault(); e.stopPropagation(); await doLogin(); });
    }
    var loginSubmitBtn = document.getElementById('loginSubmitBtn');
    if (loginSubmitBtn) {
      loginSubmitBtn.addEventListener('click', async function(e) { e.preventDefault(); await doLogin(); });
    }
    if (registerForm) {
      registerForm.addEventListener('submit', async function(e) { e.preventDefault(); e.stopPropagation(); await doRegister(); });
    }
    var registerSubmitBtn = document.getElementById('registerSubmitBtn');
    if (registerSubmitBtn) {
      registerSubmitBtn.addEventListener('click', async function(e) { e.preventDefault(); await doRegister(); });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener('click', function() {
        if (confirm('\u0647\u0644 \u062a\u0631\u064a\u062f \u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062e\u0631\u0648\u062c \u0648\u0642\u0641\u0644 \u0627\u0644\u0646\u0638\u0627\u0645\u061f')) {
          localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
          appState.currentUser = null;
          if (loginScreen) {
            loginScreen.classList.remove('is-hidden');
            loginScreen.style.display = 'flex';
          }
          showToast('\u062a\u0645 \u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062e\u0631\u0648\u062c \u0648\u0642\u0641\u0644 \u0627\u0644\u0633\u064a\u0633\u062a\u0645 \u0628\u0646\u062c\u0627\u062d');
        }
      });
    }

    // Quick link to sync code from login form
    var linkGotoSyncCode = document.getElementById('linkGotoSyncCode');
    if (linkGotoSyncCode && tabRegisterBtn) {
      linkGotoSyncCode.addEventListener('click', function(e) {
        e.preventDefault();
        tabRegisterBtn.click();
        setTimeout(function() {
          var syncInput = document.getElementById('syncCodeInput');
          if (syncInput) {
            syncInput.focus();
            syncInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 100);
      });
    }

    // Paste button next to syncCodeInput
    var pasteSyncCodeBtn = document.getElementById('pasteSyncCodeBtn');
    if (pasteSyncCodeBtn) {
      pasteSyncCodeBtn.addEventListener('click', async function() {
        try {
          if (navigator.clipboard && navigator.clipboard.readText) {
            var txt = await navigator.clipboard.readText();
            var syncInput = document.getElementById('syncCodeInput');
            if (syncInput && txt) {
              syncInput.value = txt.trim().toUpperCase();
              showToast('تم لصق الكود من الحافظة');
            }
          } else {
            showToast('الصق الكود يدوياً بالضغط المطول أو Ctrl+V');
          }
        } catch(e) {
          showToast('الصق الكود يدوياً بالضغط المطول أو Ctrl+V');
        }
      });
    }

    // ======================================================================
    // Sync Code: Generate 12-character code for current user
    // ======================================================================
    var getSyncCodeBtn = document.getElementById('getSyncCodeBtn');
    if (getSyncCodeBtn) {
      getSyncCodeBtn.addEventListener('click', async function() {
        if (!appState.currentUser) {
          showToast('يجب تسجيل الدخول أولاً');
          return;
        }
        try {
          var user = appState.currentUser;
          var cleanExisting = user.syncCode ? String(user.syncCode).replace(/[^a-zA-Z0-9]/g, '').toUpperCase() : '';
          
          if (!cleanExisting || cleanExisting.length !== 12) {
            var newCode = (window.CloudUsers && window.CloudUsers.generate12CharCode)
              ? window.CloudUsers.generate12CharCode()
              : (function() {
                  var chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
                  var s = '';
                  for (var i = 0; i < 12; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
                  return s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8, 12);
                })();
            cleanExisting = newCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
            user.syncCode = cleanExisting;
            user.formattedCode = newCode;
            localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(user));
            var localUsers = JSON.parse(localStorage.getItem('newtech_users_v3') || '[]');
            var uIdx = localUsers.findIndex(function(u) { return (u.username || '').toLowerCase() === (user.username || '').toLowerCase(); });
            if (uIdx >= 0) {
              localUsers[uIdx].syncCode = user.syncCode;
              localUsers[uIdx].formattedCode = user.formattedCode;
              localStorage.setItem('newtech_users_v3', JSON.stringify(localUsers));
            }
            if (window.newTechDB) {
              try { await window.newTechDB.saveUser(user); } catch(e) {}
            }
          }

          var formatted = (window.CloudUsers && window.CloudUsers.formatCode) 
            ? window.CloudUsers.formatCode(cleanExisting) 
            : (cleanExisting.slice(0,4) + '-' + cleanExisting.slice(4,8) + '-' + cleanExisting.slice(8,12));

          // Save to Firebase Cloud
          if (window.CloudUsers) {
            try {
              await window.CloudUsers.saveSyncCode(cleanExisting, user);
              await window.CloudUsers.saveUser(user);
            } catch(e) {}
          }

          // Remove any existing sync modal
          var oldModal = document.getElementById('syncCodeModal');
          if (oldModal) oldModal.remove();

          // Create Modal with Copy Icon
          var modal = document.createElement('div');
          modal.id = 'syncCodeModal';
          modal.style.cssText = 'position:fixed;inset:0;background:rgba(5,6,10,0.88);z-index:99999;display:flex;align-items:center;justify-content:center;padding:1.5rem;backdrop-filter:blur(6px);animation:fadeIn 0.2s ease;';
          modal.innerHTML = '<div style="background:linear-gradient(165deg,rgba(23,25,38,0.99) 0%,rgba(15,16,25,0.99) 100%);border:1px solid rgba(14,165,233,0.4);border-radius:22px;width:100%;max-width:480px;padding:2rem;box-shadow:0 30px 80px rgba(0,0,0,0.8),0 0 35px rgba(14,165,233,0.2);position:relative;">'
            + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;">'
            + '  <div style="display:flex;align-items:center;gap:0.6rem;">'
            + '    <div style="width:38px;height:38px;border-radius:10px;background:rgba(14,165,233,0.15);display:flex;align-items:center;justify-content:center;color:#38bdf8;font-size:1.15rem;"><i class="fa-solid fa-arrows-rotate"></i></div>'
            + '    <h3 style="color:#fff;font-size:1.15rem;margin:0;font-weight:700;">كود المزامنة بين الأجهزة</h3>'
            + '  </div>'
            + '  <button id="closeSyncModalX" style="background:transparent;border:none;color:#94a3b8;font-size:1.25rem;cursor:pointer;padding:0.25rem;"><i class="fa-solid fa-xmark"></i></button>'
            + '</div>'
            + '<p style="color:#9ba0b6;font-size:0.84rem;margin:0 0 1.25rem;line-height:1.6;">'
            + 'كود حسابك مكوّن من <strong>12 حرف ورقم</strong>. اضغط على أيقونة النسخ لنسخ الكود واستخدمه على أي جهاز آخر:'
            + '</p>'
            + '<div style="background:#090a10;border:1.5px solid rgba(14,165,233,0.35);border-radius:14px;padding:0.9rem 1.25rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:1rem;box-shadow:inset 0 2px 10px rgba(0,0,0,0.5);">'
            + '  <div style="display:flex;flex-direction:column;gap:0.2rem;">'
            + '    <span style="font-size:0.7rem;color:#64748b;font-weight:600;letter-spacing:0.5px;">كود المزامنة (12 حرف ورقم)</span>'
            + '    <span id="syncCodeTextVal" style="font-family:\'JetBrains Mono\',monospace;font-size:1.45rem;font-weight:800;letter-spacing:3px;color:#38bdf8;direction:ltr;user-select:all;">' + formatted + '</span>'
            + '  </div>'
            + '  <button id="modalCopyCodeBtn" title="نسخ الكود" style="display:flex;align-items:center;gap:0.45rem;padding:0.65rem 1.1rem;background:linear-gradient(135deg,#0284c7,#0369a1);border:none;border-radius:10px;color:#fff;font-family:Cairo,sans-serif;font-weight:700;cursor:pointer;font-size:0.88rem;transition:all 0.2s ease;box-shadow:0 4px 14px rgba(2,132,199,0.35);">'
            + '    <i class="fa-solid fa-copy"></i>'
            + '    <span>نسخ</span>'
            + '  </button>'
            + '</div>'
            + '<div style="display:flex;align-items:center;gap:0.45rem;font-size:0.75rem;color:#10b981;margin-bottom:1.5rem;background:rgba(16,185,129,0.08);padding:0.55rem 0.85rem;border-radius:8px;border:1px solid rgba(16,185,129,0.2);">'
            + '  <i class="fa-solid fa-circle-check"></i>'
            + '  <span>الكود متصل بالسحابة (Firebase) وجاهز للمزامنة الفورية على أي جهاز</span>'
            + '</div>'
            + '<div style="display:flex;gap:0.75rem;">'
            + '  <button id="modalCopyCodeFullBtn" style="flex:1;padding:0.75rem;background:linear-gradient(135deg,#0284c7,#0369a1);border:none;border-radius:12px;color:#fff;font-family:Cairo,sans-serif;font-weight:700;cursor:pointer;font-size:0.9rem;display:flex;align-items:center;justify-content:center;gap:0.5rem;box-shadow:0 4px 16px rgba(2,132,199,0.4);">'
            + '    <i class="fa-solid fa-copy"></i>'
            + '    <span>نسخ كود المزامنة</span>'
            + '  </button>'
            + '  <button id="closeSyncModalBtn" style="padding:0.75rem 1.25rem;background:rgba(255,255,255,0.06);border:1px solid #232536;border-radius:12px;color:#9ba0b6;font-family:Cairo,sans-serif;cursor:pointer;font-size:0.9rem;">إغلاق</button>'
            + '</div></div>';

          document.body.appendChild(modal);

          function doCopyCode() {
            var textToCopy = cleanExisting;
            var copySuccessful = function() {
              var btn1 = document.getElementById('modalCopyCodeBtn');
              var btn2 = document.getElementById('modalCopyCodeFullBtn');
              if (btn1) {
                btn1.style.background = 'linear-gradient(135deg,#10b981,#059669)';
                btn1.innerHTML = '<i class="fa-solid fa-check"></i> <span>تم النسخ!</span>';
              }
              if (btn2) {
                btn2.style.background = 'linear-gradient(135deg,#10b981,#059669)';
                btn2.innerHTML = '<i class="fa-solid fa-check"></i> <span>تم نسخ الكود بنجاح</span>';
              }
              showToast('تم نسخ كود المزامنة (' + formatted + ') بنجاح!');
              setTimeout(function() {
                if (btn1) {
                  btn1.style.background = 'linear-gradient(135deg,#0284c7,#0369a1)';
                  btn1.innerHTML = '<i class="fa-solid fa-copy"></i> <span>نسخ</span>';
                }
                if (btn2) {
                  btn2.style.background = 'linear-gradient(135deg,#0284c7,#0369a1)';
                  btn2.innerHTML = '<i class="fa-solid fa-copy"></i> <span>نسخ كود المزامنة</span>';
                }
              }, 2500);
            };

            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(textToCopy).then(copySuccessful).catch(function() {
                fallbackCopy();
              });
            } else {
              fallbackCopy();
            }

            function fallbackCopy() {
              var ta = document.createElement('textarea');
              ta.value = textToCopy;
              ta.style.position = 'fixed';
              ta.style.opacity = '0';
              document.body.appendChild(ta);
              ta.select();
              try { document.execCommand('copy'); copySuccessful(); } catch(e) {}
              ta.remove();
            }
          }

          var copyBtn1 = document.getElementById('modalCopyCodeBtn');
          if (copyBtn1) copyBtn1.addEventListener('click', doCopyCode);
          var copyBtn2 = document.getElementById('modalCopyCodeFullBtn');
          if (copyBtn2) copyBtn2.addEventListener('click', doCopyCode);

          var codeTextEl = document.getElementById('syncCodeTextVal');
          if (codeTextEl) {
            codeTextEl.style.cursor = 'pointer';
            codeTextEl.title = 'انقر لنسخ الكود';
            codeTextEl.addEventListener('click', doCopyCode);
          }

          var closeX = document.getElementById('closeSyncModalX');
          if (closeX) closeX.addEventListener('click', function() { modal.remove(); });
          var closeBtn = document.getElementById('closeSyncModalBtn');
          if (closeBtn) closeBtn.addEventListener('click', function() { modal.remove(); });
          modal.addEventListener('click', function(e) {
            if (e.target === modal) modal.remove();
          });
        } catch (err) {
          console.error('Sync code generation error:', err);
          showToast('حدث خطأ في إنشاء كود المزامنة');
        }
      });
    }

    // ======================================================================
    // Sync Code: Import account from 12-character code
    // ======================================================================
    var importSyncCodeBtn = document.getElementById('importSyncCodeBtn');
    if (importSyncCodeBtn) {
      importSyncCodeBtn.addEventListener('click', async function() {
        var syncInput = document.getElementById('syncCodeInput');
        var rawCode = syncInput ? syncInput.value.trim() : '';
        var regErr = document.getElementById('regErrorMsg');
        var regErrTxt = document.getElementById('regErrorText');
        function showErr(msg) {
          if (regErr) regErr.style.display = 'flex';
          if (regErrTxt) regErrTxt.textContent = msg;
        }

        if (!rawCode) {
          showErr('يرجى إدخال كود المزامنة المكون من 12 حرف ورقم.');
          return;
        }

        var clean = rawCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        var originalBtnHtml = importSyncCodeBtn.innerHTML;
        importSyncCodeBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>جاري البحث عن الحساب والمزامنة...</span>';
        importSyncCodeBtn.disabled = true;

        try {
          var importedUser = null;

          // 1. If 12 characters: lookup via CloudUsers
          if (clean.length === 12) {
            if (window.CloudUsers) {
              importedUser = await window.CloudUsers.getUserBySyncCode(clean);
            }
          } else if (rawCode.length > 20) {
            // Backward compatibility: try legacy base64 decode
            try {
              var decoded = JSON.parse(decodeURIComponent(escape(atob(rawCode))));
              if (decoded.username && decoded.passwordHash) {
                importedUser = {
                  id: decoded.id || ('user_' + Date.now()),
                  username: (decoded.username || '').toLowerCase(),
                  fullName: decoded.fullName || decoded.username,
                  passwordHash: decoded.passwordHash,
                  role: decoded.role || 'user',
                  syncCode: decoded.syncCode || clean,
                  createdAt: decoded.createdAt || new Date().toISOString()
                };
              }
            } catch(e) {}
          }

          if (!importedUser) {
            if (clean.length !== 12) {
              showErr('كود المزامنة يجب أن يتكون من 12 حرف ورقم بالضبط (أنت كتبت ' + clean.length + ' رمز).');
            } else {
              showErr('لم يتم العثور على حساب مرتبط بهذا الكود (' + clean + '). تأكد من صحة الكود أو اتصاله بالإنترنت.');
            }
            importSyncCodeBtn.innerHTML = originalBtnHtml;
            importSyncCodeBtn.disabled = false;
            return;
          }

          var normalizedUser = {
            id: importedUser.id || ('user_' + Date.now()),
            username: (importedUser.username || '').toLowerCase(),
            fullName: importedUser.fullName || importedUser.username,
            passwordHash: importedUser.passwordHash,
            role: importedUser.role || 'user',
            syncCode: clean.length === 12 ? clean : (importedUser.syncCode || ''),
            formattedCode: clean.length === 12 ? (clean.slice(0,4) + '-' + clean.slice(4,8) + '-' + clean.slice(8,12)) : '',
            createdAt: importedUser.createdAt || new Date().toISOString()
          };

          // Save to localStorage users
          var localUsers = JSON.parse(localStorage.getItem('newtech_users_v3') || '[]');
          var existingIdx = localUsers.findIndex(function(u) { return (u.username || '').toLowerCase() === normalizedUser.username; });
          if (existingIdx >= 0) {
            localUsers[existingIdx] = normalizedUser;
          } else {
            localUsers.push(normalizedUser);
          }
          localStorage.setItem('newtech_users_v3', JSON.stringify(localUsers));

          // Save to IndexedDB
          if (window.newTechDB) {
            try { await window.newTechDB.saveUser(normalizedUser); } catch(e4) {}
          }

          // Auto-login
          appState.currentUser = normalizedUser;
          localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(normalizedUser));
          if (currentUserNameText) currentUserNameText.textContent = 'المستخدم: ' + (normalizedUser.fullName || normalizedUser.username);
          if (loginScreen) {
            loginScreen.classList.add('is-hidden');
            loginScreen.style.display = 'none';
          }
          await loadData();
          renderAll();
          showToast('تم استيراد وتسجيل دخول حساب (' + (normalizedUser.fullName || normalizedUser.username) + ') بنجاح!');
        } catch (err) {
          console.error('Import sync code error:', err);
          showErr('حدث خطأ أثناء استيراد الحساب: ' + (err.message || 'حاول ثانية'));
        } finally {
          if (importSyncCodeBtn) {
            importSyncCodeBtn.innerHTML = originalBtnHtml;
            importSyncCodeBtn.disabled = false;
          }
        }
      });
    }
  }

  // ==========================================================================
  // 2. تحميل البيانات والمزامنة (Data Loading & Sync)
  // ==========================================================================
  async function loadData() {
    const userId = appState.currentUser ? appState.currentUser.id : null;
    try {
      if (window.newTechDB) {
        await window.newTechDB.init();

        // 1. الشركات والموردين
        const dbCompanies = await window.newTechDB.getAllCompanies();
        if (dbCompanies && dbCompanies.length > 0) {
          appState.companies = dbCompanies;
        } else {
          appState.companies = window.DEFAULT_COMPANIES || [];
          await window.newTechDB.bulkSaveCompanies(appState.companies);
        }

        // 2. المسحوبات والمبيعات
        const dbItems = await window.newTechDB.getAllTransactions(userId);
        appState.items = dbItems || [];

        // 3. فواتير المشتريات
        const dbPurchases = await window.newTechDB.getAllPurchases(userId);
        appState.purchases = dbPurchases || [];

        // 4. سندات القبض والصرف
        const dbVouchers = await window.newTechDB.getAllVouchers(userId);
        appState.vouchers = dbVouchers || [];

        // 5. المصروفات العامة
        const dbExpenses = await window.newTechDB.getAllExpenses(userId);
        appState.expenses = dbExpenses || [];

        // 6. الأصناف والمخزون
        const dbProducts = await window.newTechDB.getAllProducts(userId);
        appState.products = dbProducts || [];

        // 7. مبيعات الكاشير POS
        const dbSales = await window.newTechDB.getAllSales(userId);
        appState.sales = dbSales || [];

        // 8. صرف نقدية الدرج
        const dbPayouts = await window.newTechDB.getAllPayouts(userId);
        appState.payouts = dbPayouts || [];
      }
    } catch (e) {
      console.warn('Fallback to LocalStorage cache:', e);
      const savedComp = localStorage.getItem(STORAGE_KEYS.COMPANIES);
      appState.companies = savedComp ? JSON.parse(savedComp) : (window.DEFAULT_COMPANIES || []);
      const savedItems = localStorage.getItem(STORAGE_KEYS.ITEMS);
      appState.items = savedItems ? JSON.parse(savedItems) : [];
      const savedPurch = localStorage.getItem(STORAGE_KEYS.PURCHASES);
      appState.purchases = savedPurch ? JSON.parse(savedPurch) : [];
      const savedVch = localStorage.getItem(STORAGE_KEYS.VOUCHERS);
      appState.vouchers = savedVch ? JSON.parse(savedVch) : [];
      const savedExp = localStorage.getItem(STORAGE_KEYS.EXPENSES);
      appState.expenses = savedExp ? JSON.parse(savedExp) : [];
      const savedProd = localStorage.getItem(STORAGE_KEYS.PRODUCTS);
      appState.products = savedProd ? JSON.parse(savedProd) : [];
      const savedSales = localStorage.getItem(STORAGE_KEYS.SALES);
      appState.sales = savedSales ? JSON.parse(savedSales) : [];
      const savedPayouts = localStorage.getItem(STORAGE_KEYS.PAYOUTS);
      appState.payouts = savedPayouts ? JSON.parse(savedPayouts) : [];
    }

    // تسلسل الأكواد الرقمية التلقائي من 1 إلى ما لا نهاية
    normalizeProductCodes();
    syncLocalStorageCache();
  }

  // توليد الكود الرقمي التسلسلي التالي تلقائياً من 1 إلى ما لا نهاية
  function getNextProductCode() {
    if (!appState.products || appState.products.length === 0) return 1;
    let maxCode = 0;
    appState.products.forEach(p => {
      const num = parseInt(p.code, 10);
      if (!isNaN(num) && num > maxCode) {
        maxCode = num;
      }
    });
    return maxCode + 1;
  }

  // تسوية وترتيب كافة الأكواد لتبدأ متسلسلة ونظيفة
  function normalizeProductCodes() {
    let changed = false;
    let currentCode = 1;
    (appState.products || []).forEach(p => {
      const num = parseInt(p.code, 10);
      if (isNaN(num) || num <= 0) {
        while ((appState.products || []).some(other => parseInt(other.code, 10) === currentCode)) {
          currentCode++;
        }
        p.code = String(currentCode);
        currentCode++;
        changed = true;
      }
    });
    if (changed) {
      syncLocalStorageCache();
      if (window.newTechDB) {
        (appState.products || []).forEach(p => {
          try { window.newTechDB.saveProduct(p); } catch(e) {}
        });
      }
    }
  }

  function syncLocalStorageCache() {
    try {
      localStorage.setItem(STORAGE_KEYS.COMPANIES, JSON.stringify(appState.companies));
      localStorage.setItem(STORAGE_KEYS.ITEMS, JSON.stringify(appState.items));
      localStorage.setItem(STORAGE_KEYS.PURCHASES, JSON.stringify(appState.purchases));
      localStorage.setItem(STORAGE_KEYS.VOUCHERS, JSON.stringify(appState.vouchers || []));
      localStorage.setItem(STORAGE_KEYS.EXPENSES, JSON.stringify(appState.expenses || []));
      localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(appState.products || []));
      localStorage.setItem(STORAGE_KEYS.SALES, JSON.stringify(appState.sales || []));
      localStorage.setItem(STORAGE_KEYS.PAYOUTS, JSON.stringify(appState.payouts || []));
    } catch (e) {}
  }

  // ==========================================================================
  // 3. مساعدات التواريخ والنصوص (Date & Formatting Helpers)
  // ==========================================================================
  function formatDateStr(d) {
    const day = String(d.getDate()).padStart(2, '0');
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}/${m}/${d.getFullYear()}`;
  }

  function formatTimeStr(d) {
    let hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    const ampm = hours >= 12 ? 'م' : 'ص';
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${String(hours).padStart(2, '0')}:${minutes}:${seconds} ${ampm}`;
  }

  function getFullTimestamp(d = new Date()) {
    return {
      iso: d.toISOString(),
      dayName: ARABIC_DAYS[d.getDay()],
      dateStr: formatDateStr(d),
      timeStr: formatTimeStr(d),
      fullText: `${ARABIC_DAYS[d.getDay()]} ${formatDateStr(d)} - ${formatTimeStr(d)}`
    };
  }

  function startLiveTime() {
    const timeEl = document.getElementById('statusLiveTime');
    function update() {
      const now = new Date();
      if (timeEl) {
        timeEl.textContent = `${ARABIC_DAYS[now.getDay()]} ${formatDateStr(now)} | ${formatTimeStr(now)}`;
      }
    }
    update();
    setInterval(update, 1000);
  }

  function showToast(msg) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px) scale(0.95)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ==========================================================================
  // 4. المقاصة والتصفية التلقائية بين الحسابات (Automatic Netting Formulas)
  //    - إذا كان لي عند الشركة -> أحمر
  //    - إذا كان عليّ للشركة -> أخضر
  // ==========================================================================
  function computeNetting(companyId) {
    let dueFrom = 0;
    let paidFrom = 0;
    appState.items.filter(i => i.companyId === companyId).forEach(i => {
      const val = Number(i.totalPrice) || 0;
      if (i.status === 'RETURNED' || i.isReturned) return;
      if (i.isPaid || i.status === 'PAID') {
        paidFrom += val;
      } else {
        dueFrom += val;
      }
    });

    let dueTo = 0;
    let paidTo = 0;
    appState.purchases.filter(p => p.supplierId === companyId).forEach(p => {
      if (p.isReturned) return;
      dueTo += Number(p.remainingAmount) || 0;
      paidTo += Number(p.paidAmount) || 0;
    });

    // سندات القبض المستلمة من الشركة تخصم من المطلوب منها
    const receipts = (appState.vouchers || [])
      .filter(v => v.companyId === companyId && v.type === 'receipt')
      .reduce((sum, v) => sum + (Number(v.amount) || 0), 0);
    dueFrom = Math.max(0, dueFrom - receipts);
    paidFrom += receipts;

    // سندات الصرف المدفوعة للمورد تخصم من المستحق له
    const payments = (appState.vouchers || [])
      .filter(v => v.companyId === companyId && v.type === 'payment')
      .reduce((sum, v) => sum + (Number(v.amount) || 0), 0);
    dueTo = Math.max(0, dueTo - payments);
    paidTo += payments;

    const netBalance = dueFrom - dueTo;
    return {
      dueFromThem: dueFrom,
      dueToThem: dueTo,
      paidByThem: paidFrom,
      paidToThem: paidTo,
      receipts,
      payments,
      netBalance,
      status: netBalance > 0 ? 'DUE_FROM_THEM' : (netBalance < 0 ? 'DUE_TO_THEM' : 'SETTLED')
    };
  }

  // ==========================================================================
  // 5. الفلترة وتحديث شريط المؤشرات والجدول الرئيسي
  // ==========================================================================
  function updateMetricsAndBadges() {
    let unpaidTotal = 0;
    let unpaidCount = 0;
    let paidTotal = 0;
    let paidCount = 0;
    let returnedTotal = 0;
    let returnedCount = 0;
    let grandTotal = 0;

    appState.items.forEach(i => {
      const p = Number(i.totalPrice) || 0;
      if (i.isReturned || i.status === 'RETURNED') {
        returnedTotal += p;
        returnedCount++;
      } else if (i.isPaid || i.status === 'PAID') {
        grandTotal += p;
        paidTotal += p;
        paidCount++;
      } else {
        grandTotal += p;
        unpaidTotal += p;
        unpaidCount++;
      }
    });

    let totalPurchasesRemaining = 0;
    let totalPurchasesPaid = 0;
    appState.purchases.forEach(p => {
      if (!p.isReturned) {
        totalPurchasesRemaining += Number(p.remainingAmount) || 0;
        totalPurchasesPaid += Number(p.paidAmount) || 0;
      }
    });

    // حسابات الخزينة والنقدية والمصروفات
    const vReceiptsCash = (appState.vouchers || [])
      .filter(v => v.type === 'receipt' && (!v.paymentMethod || v.paymentMethod.includes('كاش')))
      .reduce((sum, v) => sum + (Number(v.amount) || 0), 0);

    const vPaymentsCash = (appState.vouchers || [])
      .filter(v => v.type === 'payment' && (!v.paymentMethod || v.paymentMethod.includes('كاش')))
      .reduce((sum, v) => sum + (Number(v.amount) || 0), 0);

    const expCash = (appState.expenses || [])
      .filter(e => !e.paymentMethod || e.paymentMethod.includes('كاش'))
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    const totalExpenses = (appState.expenses || [])
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    // مبيعات الكاشير POS النقدية
    const posCashSales = (appState.sales || [])
      .filter(s => !s.paymentMethod || s.paymentMethod.includes('كاش'))
      .reduce((sum, s) => sum + (Number(s.grandTotal) || 0), 0);

    // أذونات صرف نقدية من الدرج
    const drawerPayoutsCash = (appState.payouts || [])
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

    // رصيد الكاش في الخزينة: مقبوضات المبيعات + كاشير POS + سندات القبض - مدفوعات المشتريات - سندات الصرف - المصروفات - صرف نقدية الدرج
    const cashInDrawer = Math.max(0, (paidTotal + vReceiptsCash + posCashSales) - (totalPurchasesPaid + vPaymentsCash + expCash + drawerPayoutsCash));

    // تحديث الأرقام العلوية
    const unpaidEl = document.getElementById('statUnpaidAmount');
    if (unpaidEl) unpaidEl.textContent = `${unpaidTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })} ج.م (${unpaidCount} صنف)`;

    const paidEl = document.getElementById('statPaidAmount');
    if (paidEl) paidEl.textContent = `${paidTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })} ج.م (${paidCount} صنف)`;

    const treasuryEl = document.getElementById('statTreasuryCash');
    if (treasuryEl) treasuryEl.textContent = `${cashInDrawer.toLocaleString('en-US', { minimumFractionDigits: 2 })} ج.م`;

    const totalExpensesEl = document.getElementById('statTotalExpenses');
    if (totalExpensesEl) totalExpensesEl.textContent = `${totalExpenses.toLocaleString('en-US', { minimumFractionDigits: 2 })} ج.م`;

    const totalEl = document.getElementById('statTotalAmount');
    if (totalEl) totalEl.textContent = `${grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })} ج.م`;

    // شارات الشريط الجانبي
    const badgeAll = document.getElementById('sideBadgeAll');
    if (badgeAll) badgeAll.textContent = appState.items.length;

    const badgeUnpaid = document.getElementById('sideBadgeUnpaid');
    if (badgeUnpaid) badgeUnpaid.textContent = unpaidCount;

    const badgePaid = document.getElementById('sideBadgePaid');
    if (badgePaid) badgePaid.textContent = paidCount;

    const badgeRet = document.getElementById('sideBadgeReturned');
    if (badgeRet) badgeRet.textContent = returnedCount;

    const badgePurch = document.getElementById('sidePurchasesCount');
    if (badgePurch) badgePurch.textContent = appState.purchases.length;

    const badgeVch = document.getElementById('sideVouchersCount');
    if (badgeVch) badgeVch.textContent = (appState.vouchers || []).length;

    const badgeExp = document.getElementById('sideExpensesCount');
    if (badgeExp) badgeExp.textContent = (appState.expenses || []).length;

    const badgeProd = document.getElementById('sideProductsCount');
    if (badgeProd) badgeProd.textContent = (appState.products || []).length;

    // شريط الحالة
    const countEl = document.getElementById('statusItemCount');
    if (countEl) countEl.textContent = `المعروض: ${getFilteredItems().length} من أصل ${appState.items.length} مسحوب`;

    const debtEl = document.getElementById('statusDebtSummary');
    if (debtEl) debtEl.textContent = `المطلوب تحصيله (عجز): ${unpaidTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })} ج.م`;

    const purchSumEl = document.getElementById('statusPurchasesSummary');
    if (purchSumEl) purchSumEl.textContent = `مستحق للموردين: ${totalPurchasesRemaining.toLocaleString('en-US', { minimumFractionDigits: 2 })} ج.م`;
  }

  function getFilteredItems() {
    const q = appState.filters.searchQuery.trim().toLowerCase();
    const cId = appState.filters.companyId;
    const st = appState.filters.status;
    const dRange = appState.filters.dateRange;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 86400000;
    const startOfWeek = startOfToday - (now.getDay() * 86400000);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    return appState.items.filter(i => {
      if (cId !== 'ALL' && i.companyId !== cId) return false;

      // فلتر الحالات
      if (st === 'UNPAID') {
        if (i.isReturned || i.isPaid) return false;
      } else if (st === 'PAID') {
        if (!i.isPaid || i.isReturned) return false;
      } else if (st === 'RETURNED') {
        if (!i.isReturned && i.status !== 'RETURNED') return false;
      }

      // فلتر التواريخ
      if (dRange !== 'ALL') {
        const itemT = new Date(i.createdAt).getTime();
        if (dRange === 'TODAY' && itemT < startOfToday) return false;
        if (dRange === 'YESTERDAY' && (itemT < startOfYesterday || itemT >= startOfToday)) return false;
        if (dRange === 'THIS_WEEK' && itemT < startOfWeek) return false;
        if (dRange === 'THIS_MONTH' && itemT < startOfMonth) return false;
      }

      // البحث
      if (q) {
        const mName = (i.itemName || '').toLowerCase().includes(q);
        const mCode = (i.itemCode || '').toLowerCase().includes(q);
        const mComp = (i.companyName || '').toLowerCase().includes(q) || (i.companyArName || '').toLowerCase().includes(q);
        const mPers = (i.personName || '').toLowerCase().includes(q);
        const mNotes = (i.notes || '').toLowerCase().includes(q);
        if (!mName && !mCode && !mComp && !mPers && !mNotes) return false;
      }

      return true;
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  // ==========================================================================
  // 6. عرض جدول المسحوبات والمبيعات (مع زر مرتجع بجانب تم الدفع ولون أصفر)
  // ==========================================================================
  function renderStructuredTableRows() {
    const tbody = document.getElementById('tableRowsBody');
    const emptyState = document.getElementById('emptyState');
    const filtered = getFilteredItems();

    updateCompanyBanner();

    if (!tbody) return;

    if (filtered.length === 0) {
      tbody.innerHTML = '';
      if (emptyState) emptyState.style.display = 'flex';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    tbody.innerHTML = filtered.map(item => {
      const isReturned = item.isReturned || item.status === 'RETURNED';
      const isPaid = item.isPaid || item.status === 'PAID';

      // 1. زر تم الدفع
      let payButton = '';
      if (isReturned) {
        payButton = `<button class="btn-table-pay" style="opacity:0.4; cursor:not-allowed;" title="الصنف مرتجع"><i class="fa-solid fa-ban"></i> تم الدفع</button>`;
      } else if (isPaid) {
        payButton = `<button class="btn-table-pay paid-action" data-action="toggle-paid" data-id="${item.id}" title="تم الدفع - انقر لإلغاء السداد">
             <span class="done-lbl"><i class="fa-solid fa-circle-check"></i> تم الدفع</span>
             <span class="revert-lbl">إلغاء ↺</span>
           </button>`;
      } else {
        payButton = `<button class="btn-table-pay unpaid-action" data-action="toggle-paid" data-id="${item.id}" title="انقر لتأكيد السداد كاش">
             <i class="fa-solid fa-hourglass-half"></i> تم الدفع
           </button>`;
      }

      // 2. زر مرتجع بجانب زر تم الدفع (المطلب رقم 4)
      const returnButton = `<button class="btn-table-return ${isReturned ? 'returned-active' : ''}" data-action="toggle-return" data-id="${item.id}" title="${isReturned ? 'إلغاء المرتجع وإعادته للسجل' : 'تسجيل الصنف كمرتجع'}">
           <i class="fa-solid fa-rotate-left"></i> ${isReturned ? 'مرتجع ↺' : 'مرتجع'}
         </button>`;

      // ستايل السعر: إذا كان مرتجعاً يتحول للأصفر
      let totalClass = 'unpaid';
      if (isReturned) {
        totalClass = 'returned';
      } else if (isPaid) {
        totalClass = 'paid';
      }

      // حالة الصف
      let rowClass = 'is-unpaid';
      if (isReturned) {
        rowClass = 'is-returned';
      } else if (isPaid) {
        rowClass = 'is-paid';
      }

      return `
        <tr class="${rowClass}" id="row_${item.id}">
          
          <!-- التحديد -->
          <td style="text-align:center;">
            <input type="checkbox" class="row-checkbox" data-id="${item.id}">
          </td>

          <!-- كود الصنف -->
          <td>
            <code class="cell-code text-ltr">${escapeHtml(item.itemCode)}</code>
          </td>

          <!-- اسم الصنف -->
          <td>
            <strong class="cell-item-name">${escapeHtml(item.itemName)}</strong>
            ${isReturned ? '<span class="badge-returned" style="margin-top:0.2rem;"><i class="fa-solid fa-rotate-left"></i> صنف مرتجع</span>' : ''}
            ${item.notes ? `<small style="color:var(--ab-text-dim); display:block; font-size:0.72rem;">${escapeHtml(item.notes)}</small>` : ''}
          </td>

          <!-- اسم الشركة / المورد -->
          <td>
            <span class="cell-company" data-action="focus-company" data-company-id="${item.companyId}" title="تصفية حسب هذه الجهة">
              ${escapeHtml(item.companyName)} (${escapeHtml(item.companyArName || '')})
            </span>
          </td>

          <!-- الشخص المستلم -->
          <td>
            <span class="cell-person">${escapeHtml(item.personName || 'غير مسجل')}</span>
          </td>

          <!-- الكمية -->
          <td style="text-align:center;">
            <span class="cell-qty">${item.quantity}</span>
          </td>

          <!-- سعر القطعة -->
          <td>
            <span class="cell-price">${Number(item.unitPrice).toFixed(2)} ج.م</span>
          </td>

          <!-- السعر الإجمالي (يتحول للأصفر عند المرتجع) -->
          <td>
            <strong class="cell-total ${totalClass}">${Number(item.totalPrice).toFixed(2)} ج.م</strong>
          </td>

          <!-- التاريخ والوقت -->
          <td>
            <div class="cell-datetime">
              <span class="date-line">${escapeHtml(item.dayName)} ${escapeHtml(item.dateStr)}</span>
              <span class="time-line">${escapeHtml(item.timeStr)}</span>
            </div>
          </td>

          <!-- حالة السداد والمرتجع (زر تم الدفع وبجانبه زر مرتجع) -->
          <td style="text-align:center;">
            <div class="pay-actions-group">
              ${payButton}
              ${returnButton}
            </div>
          </td>

          <!-- إجراءات -->
          <td style="text-align:center;">
            <div class="table-actions-cell">
              <button class="btn-cell-tool" data-action="edit-item" data-id="${item.id}" title="تعديل"><i class="fa-solid fa-pen"></i></button>
              <button class="btn-cell-tool del" data-action="delete-item" data-id="${item.id}" title="حذف"><i class="fa-solid fa-trash"></i></button>
            </div>
          </td>

        </tr>
      `;
    }).join('');
  }

  // تحديث بانر الشركة ورصيد المقاصة السريع
  function updateCompanyBanner() {
    const banner = document.getElementById('activeCompanyBanner');
    const title = document.getElementById('activeCompanyTitle');
    const desc = document.getElementById('activeCompanyDesc');
    const nettingBadge = document.getElementById('activeCompanyNettingBadge');

    if (!banner) return;

    if (appState.filters.companyId !== 'ALL') {
      const comp = appState.companies.find(c => c.id === appState.filters.companyId);
      if (comp) {
        const netting = computeNetting(comp.id);
        title.textContent = `حساب: ${comp.name} (${comp.arName})`;
        desc.textContent = `| مسحوبات: ${netting.dueFromThem.toFixed(2)} ج.م | مشتريات: ${netting.dueToThem.toFixed(2)} ج.م`;

        if (nettingBadge) {
          if (netting.netBalance > 0) {
            nettingBadge.className = 'netting-badge due-from';
            nettingBadge.textContent = `المقاصة: لي عندهم ${netting.netBalance.toFixed(2)} ج.م`;
          } else if (netting.netBalance < 0) {
            nettingBadge.className = 'netting-badge due-to';
            nettingBadge.textContent = `المقاصة: عليّ لهم ${Math.abs(netting.netBalance).toFixed(2)} ج.م`;
          } else {
            nettingBadge.className = 'netting-badge settled';
            nettingBadge.textContent = `المقاصة: متوازن خالص 0.00 ج.م`;
          }
        }

        banner.style.display = 'flex';
        return;
      }
    }

    banner.style.display = 'none';
  }

  // ==========================================================================
  // 7. إدارة فواتير المشتريات (Purchase Invoices System)
  // ==========================================================================
  function setupPurchaseInvoices() {
    const newPurchaseForm = document.getElementById('newPurchaseForm');
    const addRowBtn = document.getElementById('addInvoiceRowBtn');
    const itemsTbody = document.getElementById('purchaseItemsTableBody');
    const paidInput = document.getElementById('purchasePaidInput');
    const openNewPurchaseModalBtn = document.getElementById('openNewPurchaseModalBtn');
    const openPurchasesListBtn = document.getElementById('openPurchasesListBtn');
    const sideNavOpenPurchases = document.getElementById('sideNavOpenPurchases');
    const emptyStatePurchaseBtn = document.getElementById('emptyStatePurchaseBtn');
    const openNewPurchaseFromListBtn = document.getElementById('openNewPurchaseFromListBtn');

    // زر فتح نافذة إنشاء الفاتورة
    function openNewPurchase() {
      if (newPurchaseForm) newPurchaseForm.reset();
      const numInput = document.getElementById('purchaseInvoiceNumInput');
      if (numInput) numInput.value = 'PUR-' + Math.floor(1000 + Math.random() * 9000);
      const dateInput = document.getElementById('purchaseDateInput');
      if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

      // تعبئة قائمة الموردين
      populateSupplierDropdown();

      // تفريغ وإضافة أول صف بند افتراضي
      if (itemsTbody) {
        itemsTbody.innerHTML = '';
        addInvoiceItemRow();
      }
      recalcPurchaseTotals();
      openModal('newPurchaseModal');
    }

    if (openNewPurchaseModalBtn) openNewPurchaseModalBtn.addEventListener('click', openNewPurchase);
    if (emptyStatePurchaseBtn) emptyStatePurchaseBtn.addEventListener('click', openNewPurchase);
    const menuNewPurchase = document.getElementById('menuNewPurchase');
    if (menuNewPurchase) menuNewPurchase.addEventListener('click', openNewPurchase);
    if (openNewPurchaseFromListBtn) {
      openNewPurchaseFromListBtn.addEventListener('click', () => {
        closeModal('purchasesListModal');
        openNewPurchase();
      });
    }

    // زر فتح سجل فواتير المشتريات
    function openPurchasesList() {
      renderPurchasesList();
      openModal('purchasesListModal');
    }

    if (openPurchasesListBtn) openPurchasesListBtn.addEventListener('click', openPurchasesList);
    if (sideNavOpenPurchases) sideNavOpenPurchases.addEventListener('click', openPurchasesList);

    // زر إضافة بند آخر للفاتورة
    if (addRowBtn) {
      addRowBtn.addEventListener('click', () => {
        addInvoiceItemRow();
        recalcPurchaseTotals();
      });
    }

    // إعادة حساب عند تعديل المدفوع
    if (paidInput) {
      paidInput.addEventListener('input', recalcPurchaseTotals);
    }

    // حفظ الفاتورة
    if (newPurchaseForm) {
      newPurchaseForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const supplierSelect = document.getElementById('purchaseSupplierSelect');
        const supplierId = supplierSelect.value;
        const supplierObj = appState.companies.find(c => c.id === supplierId);
        if (!supplierObj) {
          alert('يرجى اختيار الشركة أو المورد أولاً');
          return;
        }

        const invoiceNumber = document.getElementById('purchaseInvoiceNumInput').value.trim();
        const invoiceDate = document.getElementById('purchaseDateInput').value;
        const notes = document.getElementById('purchaseNotesInput').value.trim();

        // تجميع البنود مع الكود الرقمي والتصنيف وسعر الشراء وسعر البيع
        const rowEls = itemsTbody.querySelectorAll('tr');
        const items = [];
        rowEls.forEach(tr => {
          const name = tr.querySelector('.row-item-name').value.trim();
          const code = tr.querySelector('.row-item-code') ? tr.querySelector('.row-item-code').value.trim() : '';
          const cat = tr.querySelector('.row-item-cat') ? tr.querySelector('.row-item-cat').value : 'عام';
          const qty = parseFloat(tr.querySelector('.row-item-qty').value) || 1;
          const price = parseFloat(tr.querySelector('.row-item-price').value) || 0;
          const sellPrice = parseFloat(tr.querySelector('.row-item-sell-price') ? tr.querySelector('.row-item-sell-price').value : 0) || Math.round(price * 1.25);
          const disc = parseFloat(tr.querySelector('.row-item-discount').value) || 0;
          const finalPrice = Math.max(0, (qty * price) - disc);

          if (name) {
            items.push({
              id: 'pitem_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
              itemName: name,
              itemCode: code,
              category: cat,
              quantity: qty,
              unitPrice: price,
              sellPrice: sellPrice,
              discount: disc,
              finalPrice: finalPrice
            });
          }
        });

        if (items.length === 0) {
          alert('يرجى كتابة اسم صنف واحد على الأقل داخل الفاتورة!');
          return;
        }

        const subtotal = items.reduce((acc, i) => acc + (i.quantity * i.unitPrice), 0);
        const totalDiscount = items.reduce((acc, i) => acc + i.discount, 0);
        const grandTotal = items.reduce((acc, i) => acc + i.finalPrice, 0);
        const paidAmount = parseFloat(paidInput.value) || 0;
        const remainingAmount = Math.max(0, grandTotal - paidAmount);

        let paymentStatus = 'UNPAID';
        if (remainingAmount === 0 && grandTotal > 0) paymentStatus = 'PAID';
        else if (paidAmount > 0 && remainingAmount > 0) paymentStatus = 'PARTIAL';

        const newInvoice = {
          id: 'inv_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
          userId: appState.currentUser ? appState.currentUser.id : null,
          invoiceNumber,
          supplierId,
          supplierName: supplierObj.name,
          supplierArName: supplierObj.arName,
          invoiceDate,
          items,
          subtotal,
          discount: totalDiscount,
          grandTotal,
          paidAmount,
          remainingAmount,
          paymentStatus,
          isReturned: false,
          notes,
          createdAt: new Date().toISOString()
        };

        appState.purchases.unshift(newInvoice);
        if (window.newTechDB) await window.newTechDB.savePurchase(newInvoice);

        // تحديث رصيد المخزن تلقائياً وتسجيل الصنف وسعر تكلفته وسعر بيعه وكوده الرقمي وتصنيفه
        for (const pItem of items) {
          let matchedProd = (appState.products || []).find(p => (pItem.itemCode && String(p.code) === String(pItem.itemCode)) || (p.name && p.name.toLowerCase() === pItem.itemName.toLowerCase()));
          if (matchedProd) {
            matchedProd.stock = (parseFloat(matchedProd.stock) || 0) + (parseFloat(pItem.quantity) || 1);
            if (pItem.unitPrice > 0) matchedProd.costPrice = pItem.unitPrice;
            if (pItem.sellPrice > 0) matchedProd.salePrice = pItem.sellPrice;
            if (pItem.category) matchedProd.category = pItem.category;
            if (pItem.itemCode) matchedProd.code = pItem.itemCode;
            matchedProd.updatedAt = new Date().toISOString();
            if (window.newTechDB) await window.newTechDB.saveProduct(matchedProd);
          } else {
            const newProd = {
              id: 'prod_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
              code: pItem.itemCode || String(Math.floor(100 + Math.random() * 900)),
              name: pItem.itemName,
              category: pItem.category || 'عام',
              unit: 'قطعة',
              costPrice: pItem.unitPrice || 0,
              salePrice: pItem.sellPrice || Math.round((pItem.unitPrice || 0) * 1.25),
              stock: parseFloat(pItem.quantity) || 1,
              minStock: 3,
              notes: `وارد من فاتورة مشتريات ${invoiceNumber}`,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };
            appState.products.push(newProd);
            if (window.newTechDB) await window.newTechDB.saveProduct(newProd);
          }
        }

        syncLocalStorageCache();
        closeModal('newPurchaseModal');
        renderAll();
        playSoundAdd();
        showToast(`✅ تم حفظ فاتورة المشتريات ${invoiceNumber} وتحديث كروت الأصناف في نقطة البيع والمخزن!`);
      });
    }
  }

  // إضافة صف صنف داخل الفاتورة
  function addInvoiceItemRow() {
    const tbody = document.getElementById('purchaseItemsTableBody');
    if (!tbody) return;

    // توليد كود رقمي تسلسلي بالترتيب من 1 إلى ما لا نهاية
    const existingRows = tbody.querySelectorAll('tr').length;
    const nextNumericCode = getNextProductCode() + existingRows;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" class="row-item-name" placeholder="اسم الصنف المشتَرى..." required></td>
      <td><input type="number" class="row-item-code text-ltr" value="${nextNumericCode}" min="1" step="1" placeholder="كود رقمي" required style="width:85px; text-align:center; font-weight:800; color:var(--ab-cyan);"></td>
      <td>
        <select class="row-item-cat form-control" style="font-size:0.8rem; padding:0.2rem 0.4rem; background:var(--ab-bg-input); color:var(--ab-text-main); border:1px solid var(--ab-border);">
          <option value="شواحن ومحولات">شواحن ومحولات</option>
          <option value="كابلات ووصلات">كابلات ووصلات</option>
          <option value="شاشات وقطع غيار">شاشات وقطع غيار</option>
          <option value="هاردات ورامات">هاردات ورامات</option>
          <option value="ملحقات وإكسسوارات">ملحقات وإكسسوارات</option>
          <option value="صيانة ومستهلكات">صيانة ومستهلكات</option>
          <option value="عام" selected>عام</option>
        </select>
      </td>
      <td><input type="number" class="row-item-qty" value="1" min="1" step="1" style="text-align:center; width:65px;"></td>
      <td><input type="number" class="row-item-price" placeholder="سعر الشراء" min="0" step="0.5" required style="width:90px;"></td>
      <td><input type="number" class="row-item-sell-price" placeholder="سعر البيع" min="0" step="0.5" required style="width:90px; color:#10b981; font-weight:700;"></td>
      <td><input type="number" class="row-item-discount" value="0" min="0" step="0.5" style="width:70px;"></td>
      <td><strong class="row-final-price" style="font-family:var(--font-latin); color:var(--ab-cyan);">0.00 ج.م</strong></td>
      <td style="text-align:center;">
        <button type="button" class="btn-cell-tool del remove-row-btn" title="حذف هذا الصنف"><i class="fa-solid fa-xmark"></i></button>
      </td>
    `;

    // اقتراح سعر بيع تلقائي بهامش ربح 25% عند كتابة سعر التكلفة إن لم يكن محدداً
    const costInp = tr.querySelector('.row-item-price');
    const sellInp = tr.querySelector('.row-item-sell-price');
    costInp.addEventListener('input', () => {
      const c = parseFloat(costInp.value) || 0;
      if (!sellInp.value || parseFloat(sellInp.value) === 0) {
        sellInp.value = Math.round(c * 1.25);
      }
    });

    // ربط الحسابات
    const inputs = tr.querySelectorAll('input, select');
    inputs.forEach(inp => {
      inp.addEventListener('input', () => {
        recalcRowFinal(tr);
        recalcPurchaseTotals();
      });
    });

    tr.querySelector('.remove-row-btn').addEventListener('click', () => {
      const rows = tbody.querySelectorAll('tr');
      if (rows.length > 1) {
        tr.remove();
        recalcPurchaseTotals();
      } else {
        alert('يجب الإبقاء على صنف واحد على الأقل في الفاتورة');
      }
    });

    tbody.appendChild(tr);
  }

  function recalcRowFinal(tr) {
    const qty = parseFloat(tr.querySelector('.row-item-qty').value) || 1;
    const price = parseFloat(tr.querySelector('.row-item-price').value) || 0;
    const disc = parseFloat(tr.querySelector('.row-item-discount').value) || 0;
    const finalVal = Math.max(0, (qty * price) - disc);
    tr.querySelector('.row-final-price').textContent = `${finalVal.toFixed(2)} ج.م`;
  }

  function recalcPurchaseTotals() {
    const tbody = document.getElementById('purchaseItemsTableBody');
    if (!tbody) return;

    let subtotal = 0;
    let totalDisc = 0;
    let grandTotal = 0;

    tbody.querySelectorAll('tr').forEach(tr => {
      const qty = parseFloat(tr.querySelector('.row-item-qty').value) || 1;
      const price = parseFloat(tr.querySelector('.row-item-price').value) || 0;
      const disc = parseFloat(tr.querySelector('.row-item-discount').value) || 0;
      subtotal += (qty * price);
      totalDisc += disc;
      grandTotal += Math.max(0, (qty * price) - disc);
    });

    const paidInput = document.getElementById('purchasePaidInput');
    const paidVal = paidInput ? (parseFloat(paidInput.value) || 0) : 0;
    const remaining = Math.max(0, grandTotal - paidVal);

    const subtotalEl = document.getElementById('purchaseSubtotalText');
    if (subtotalEl) subtotalEl.textContent = `${subtotal.toFixed(2)} ج.م`;

    const discEl = document.getElementById('purchaseDiscountText');
    if (discEl) discEl.textContent = `${totalDisc.toFixed(2)} ج.م`;

    const grandEl = document.getElementById('purchaseGrandTotalText');
    if (grandEl) grandEl.textContent = `${grandTotal.toFixed(2)} ج.م`;

    const remEl = document.getElementById('purchaseRemainingText');
    if (remEl) remEl.textContent = `${remaining.toFixed(2)} ج.م`;
  }

  function populateSupplierDropdown() {
    const select = document.getElementById('purchaseSupplierSelect');
    if (!select) return;
    select.innerHTML = '<option value="" disabled selected>-- اختر من قائمة الشركات والموردين --</option>';

    appState.companies.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      const typeLabel = c.entityType === 'supplier' ? ' (مورد)' : (c.entityType === 'both' ? ' (شركة ومورد)' : ' (شركة مول)');
      opt.textContent = `${c.name} - ${c.arName}${typeLabel}`;
      select.appendChild(opt);
    });
  }

  // عرض قائمة فواتير المشتريات
  function renderPurchasesList() {
    const tbody = document.getElementById('purchasesListTableBody');
    if (!tbody) return;

    if (appState.purchases.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:2rem; color:var(--ab-text-dim);">لا توجد فواتير مشتريات مسجلة حتى الآن</td></tr>`;
      return;
    }

    tbody.innerHTML = appState.purchases.map(p => {
      const isRet = p.isReturned;
      let statusBadge = '';
      if (isRet) {
        statusBadge = `<span class="badge-returned"><i class="fa-solid fa-rotate-left"></i> فاتورة مرتجعة</span>`;
      } else if (p.remainingAmount === 0) {
        statusBadge = `<span style="color:var(--ab-paid); font-weight:700;"><i class="fa-solid fa-circle-check"></i> مدفوعة بالكامل</span>`;
      } else if (p.paidAmount > 0) {
        statusBadge = `<span style="color:var(--ab-cyan); font-weight:700;"><i class="fa-solid fa-clock"></i> مدفوعة جزئياً</span>`;
      } else {
        statusBadge = `<span style="color:var(--ab-unpaid); font-weight:700;"><i class="fa-solid fa-hourglass-half"></i> آجل غير مدفوع</span>`;
      }

      return `
        <tr class="${isRet ? 'is-returned' : ''}">
          <td><code class="cell-code text-ltr">${escapeHtml(p.invoiceNumber)}</code></td>
          <td><strong>${escapeHtml(p.supplierName)} (${escapeHtml(p.supplierArName || '')})</strong></td>
          <td>${escapeHtml(p.invoiceDate)}</td>
          <td><strong style="font-family:var(--font-latin);">${Number(p.grandTotal).toFixed(2)} ج.م</strong></td>
          <td style="color:var(--ab-paid); font-family:var(--font-latin);">${Number(p.paidAmount).toFixed(2)} ج.م</td>
          <td style="color:var(--ab-unpaid); font-family:var(--font-latin);">${Number(p.remainingAmount).toFixed(2)} ج.م</td>
          <td style="text-align:center;">${statusBadge}</td>
          <td style="text-align:center;">
            <div class="table-actions-cell">
              <button class="btn-cell-tool" data-action="toggle-purchase-return" data-id="${p.id}" title="${isRet ? 'إلغاء المرتجع' : 'تسجيل الفاتورة كمرتجع'}">
                <i class="fa-solid fa-rotate-left" style="color:var(--ab-returned);"></i>
              </button>
              <button class="btn-cell-tool del" data-action="delete-purchase" data-id="${p.id}" title="حذف الفاتورة">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // ==========================================================================
  // 8. شاشة التصفية والمقاصة التلقائية بين الحسابات (Clearing Matrix Modal)
  //    - إذا كان لي عند الشركة -> يظهر المتبقي باللون الأحمر
  //    - إذا كان عليّ للشركة -> يظهر المتبقي باللون الأخضر
  // ==========================================================================
  function setupNettingModal() {
    const openBtn = document.getElementById('openNettingModalBtn');
    const sideBtn = document.getElementById('sideNavOpenNetting');
    const menuBtn = document.getElementById('menuNetting');

    function openNetting() {
      renderNettingMatrix();
      openModal('nettingModal');
    }

    if (openBtn) openBtn.addEventListener('click', openNetting);
    if (sideBtn) sideBtn.addEventListener('click', openNetting);
    if (menuBtn) menuBtn.addEventListener('click', openNetting);

    const searchInput = document.getElementById('nettingSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        renderNettingMatrix(searchInput.value.trim().toLowerCase());
      });
    }
  }

  function renderNettingMatrix(query = '') {
    const tbody = document.getElementById('nettingTableBody');
    if (!tbody) return;

    let grandDueFrom = 0;
    let grandDueTo = 0;

    let companiesToRender = appState.companies;
    if (query) {
      companiesToRender = companiesToRender.filter(c =>
        (c.name || '').toLowerCase().includes(query) ||
        (c.arName || '').toLowerCase().includes(query)
      );
    }

    // حساب الإجماليات الشاملة
    appState.companies.forEach(c => {
      const net = computeNetting(c.id);
      grandDueFrom += net.dueFromThem;
      grandDueTo += net.dueToThem;
    });

    const grandBalance = grandDueFrom - grandDueTo;

    // تحديث كروت الإحصائيات العلوية
    const totFromEl = document.getElementById('nettingTotalDueFromText');
    if (totFromEl) totFromEl.textContent = `${grandDueFrom.toLocaleString('en-US', { minimumFractionDigits: 2 })} ج.م`;

    const totToEl = document.getElementById('nettingTotalDueToText');
    if (totToEl) totToEl.textContent = `${grandDueTo.toLocaleString('en-US', { minimumFractionDigits: 2 })} ج.م`;

    const grandBalEl = document.getElementById('nettingGrandBalanceText');
    const grandHintEl = document.getElementById('nettingGrandStatusHint');
    if (grandBalEl) {
      grandBalEl.textContent = `${Math.abs(grandBalance).toLocaleString('en-US', { minimumFractionDigits: 2 })} ج.م`;
      if (grandBalance > 0) {
        grandBalEl.style.color = '#ff3366'; // أحمر
        if (grandHintEl) grandHintEl.textContent = 'الصافي العام النهائي: لي عند الشركات والموردين';
      } else if (grandBalance < 0) {
        grandBalEl.style.color = '#10b981'; // أخضر
        if (grandHintEl) grandHintEl.textContent = 'الصافي العام النهائي: عليّ للشركات والموردين';
      } else {
        grandBalEl.style.color = 'var(--ab-text-dim)';
        if (grandHintEl) grandHintEl.textContent = 'الحساب متوازن بالكامل ومصفى';
      }
    }

    // تعبئة الجدول
    tbody.innerHTML = companiesToRender.map(c => {
      const net = computeNetting(c.id);

      // تطبيق القواعد المحددة من المستخدم بدقة:
      // إذا كان لي مبلغ عند الشركة -> يظهر المتبقي باللون الأحمر
      // إذا كان عليّ مبلغ للشركة -> يظهر المتبقي باللون الأخضر
      let balanceBadge = '';
      if (net.netBalance > 0) {
        balanceBadge = `<span class="netting-badge due-from">لي عندهم: ${net.netBalance.toFixed(2)} ج.م</span>`;
      } else if (net.netBalance < 0) {
        balanceBadge = `<span class="netting-badge due-to">عليّ لهم: ${Math.abs(net.netBalance).toFixed(2)} ج.م</span>`;
      } else {
        balanceBadge = `<span class="netting-badge settled">متوازن (0.00 ج.م)</span>`;
      }

      let typeLabel = 'شركة مسحوبات';
      if (c.entityType === 'supplier') typeLabel = 'مورد بضائع';
      else if (c.entityType === 'both') typeLabel = 'شركة ومورد (مقاصة ثنائية)';

      return `
        <tr>
          <td>
            <strong>${escapeHtml(c.name)}</strong>
            <span style="color:var(--ab-text-muted); margin-right:0.35rem;">(${escapeHtml(c.arName)})</span>
          </td>
          <td><small style="color:var(--ab-cyan);">${typeLabel}</small></td>
          <td><span style="color:var(--ab-unpaid); font-family:var(--font-latin);">${net.dueFromThem.toFixed(2)} ج.م</span></td>
          <td><span style="color:var(--ab-paid); font-family:var(--font-latin);">${net.dueToThem.toFixed(2)} ج.م</span></td>
          <td style="text-align:center;">${balanceBadge}</td>
          <td style="text-align:center;">
            <button class="btn-cell-tool" data-action="open-company-statement" data-company-id="${c.id}" title="كشف حساب تفصيلي">
              <i class="fa-solid fa-file-invoice"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  // ==========================================================================
  // 9. كشف حساب تفصيلي والمقاصة للطباعة
  // ==========================================================================
  function setupStatementModal() {
    const openBtn = document.getElementById('openAccountStatementBtn');
    const menuBtn = document.getElementById('menuStatement');
    const select = document.getElementById('statementCompanySelect');
    const printBtn1 = document.getElementById('printStatementActionBtn');
    const printBtn2 = document.getElementById('printStatementActionBtn2');
    const quickBtn = document.getElementById('openCompanyQuickStatementBtn');

    function populateSelect() {
      if (!select) return;
      select.innerHTML = '';
      appState.companies.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = `${c.name} - ${c.arName}`;
        select.appendChild(opt);
      });
      if (appState.filters.companyId !== 'ALL') {
        select.value = appState.filters.companyId;
      }
    }

    function openStatement(targetId = null) {
      populateSelect();
      if (targetId && select) select.value = targetId;
      renderStatementSheet();
      openModal('statementModal');
    }

    if (openBtn) openBtn.addEventListener('click', () => openStatement());
    if (menuBtn) menuBtn.addEventListener('click', () => openStatement());
    if (quickBtn) quickBtn.addEventListener('click', () => openStatement(appState.filters.companyId));

    if (select) {
      select.addEventListener('change', renderStatementSheet);
    }

    const doPrint = () => window.print();
    if (printBtn1) printBtn1.addEventListener('click', doPrint);
    if (printBtn2) printBtn2.addEventListener('click', doPrint);
  }

  function renderStatementSheet() {
    const select = document.getElementById('statementCompanySelect');
    if (!select) return;
    const compId = select.value;
    const comp = appState.companies.find(c => c.id === compId);
    if (!comp) return;

    document.getElementById('statementTargetCompany').textContent = `الجهة: ${comp.name} (${comp.arName})`;
    document.getElementById('statementPrintDate').textContent = `التاريخ: ${formatDateStr(new Date())}`;

    const net = computeNetting(comp.id);
    document.getElementById('stmtDueFromVal').textContent = `${net.dueFromThem.toFixed(2)} ج.م`;
    document.getElementById('stmtDueToVal').textContent = `${net.dueToThem.toFixed(2)} ج.م`;

    const netBalEl = document.getElementById('stmtNetBalanceVal');
    if (net.netBalance > 0) {
      netBalEl.style.color = '#ff3366'; // أحمر
      netBalEl.textContent = `لي عندهم: ${net.netBalance.toFixed(2)} ج.م`;
    } else if (net.netBalance < 0) {
      netBalEl.style.color = '#10b981'; // أخضر
      netBalEl.textContent = `عليّ لهم: ${Math.abs(net.netBalance).toFixed(2)} ج.م`;
    } else {
      netBalEl.style.color = 'var(--ab-text-dim)';
      netBalEl.textContent = `متوازن 0.00 ج.م`;
    }

    // جدول المسحوبات
    const stmtTableBody = document.getElementById('statementTableBody');
    const compItems = appState.items.filter(i => i.companyId === comp.id);
    if (stmtTableBody) {
      if (compItems.length === 0) {
        stmtTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:0.75rem; color:var(--ab-text-dim);">لا توجد مسحوبات مسجلة</td></tr>`;
      } else {
        stmtTableBody.innerHTML = compItems.map((item, idx) => `
          <tr style="border-bottom:1px solid var(--ab-border-subtle);">
            <td style="padding:0.4rem;">${idx + 1}</td>
            <td style="padding:0.4rem;">${item.dateStr}</td>
            <td style="padding:0.4rem;">${item.itemName}</td>
            <td style="padding:0.4rem;"><code class="cell-code text-ltr">${item.itemCode}</code></td>
            <td style="padding:0.4rem; text-align:center;">${item.quantity}</td>
            <td style="padding:0.4rem; font-family:var(--font-latin);">${Number(item.totalPrice).toFixed(2)} ج.م</td>
            <td style="padding:0.4rem;">${item.isReturned ? '<span class="badge-returned">مرتجع</span>' : (item.isPaid ? 'تم الدفع ✅' : 'آجل ⏳')}</td>
          </tr>
        `).join('');
      }
    }

    // جدول المشتريات
    const stmtPurchTableBody = document.getElementById('statementPurchasesTableBody');
    const compPurchases = appState.purchases.filter(p => p.supplierId === comp.id);
    if (stmtPurchTableBody) {
      if (compPurchases.length === 0) {
        stmtPurchTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:0.75rem; color:var(--ab-text-dim);">لا توجد فواتير مشتريات مسجلة</td></tr>`;
      } else {
        stmtPurchTableBody.innerHTML = compPurchases.map(p => `
          <tr style="border-bottom:1px solid var(--ab-border-subtle);">
            <td style="padding:0.4rem;"><code class="cell-code text-ltr">${p.invoiceNumber}</code></td>
            <td style="padding:0.4rem;">${p.invoiceDate}</td>
            <td style="padding:0.4rem; font-family:var(--font-latin);">${Number(p.grandTotal).toFixed(2)} ج.م</td>
            <td style="padding:0.4rem; font-family:var(--font-latin); color:var(--ab-paid);">${Number(p.paidAmount).toFixed(2)} ج.م</td>
            <td style="padding:0.4rem; font-family:var(--font-latin); color:var(--ab-unpaid);">${Number(p.remainingAmount).toFixed(2)} ج.م</td>
            <td style="padding:0.4rem;">${p.isReturned ? '<span class="badge-returned">مرتجعة</span>' : (p.remainingAmount === 0 ? 'مسددة' : 'آجلة')}</td>
          </tr>
        `).join('');
      }
    }

    // جدول سندات القبض والصرف في كشف الحساب
    const stmtVouchersTableBody = document.getElementById('statementVouchersTableBody');
    const compVouchers = (appState.vouchers || []).filter(v => v.companyId === comp.id);
    if (stmtVouchersTableBody) {
      if (compVouchers.length === 0) {
        stmtVouchersTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:0.75rem; color:var(--ab-text-dim);">لا توجد دفعات أو سندات قبض/صرف مسجلة</td></tr>`;
      } else {
        stmtVouchersTableBody.innerHTML = compVouchers.map(v => `
          <tr style="border-bottom:1px solid var(--ab-border-subtle);">
            <td style="padding:0.4rem;"><code class="cell-code text-ltr">${v.voucherNumber || v.id}</code></td>
            <td style="padding:0.4rem;">${v.date || ''}</td>
            <td style="padding:0.4rem; font-weight:700; color:${v.type === 'receipt' ? '#10b981' : 'var(--ab-unpaid)'};">${v.type === 'receipt' ? '🟢 سند قبض (دفعة مستلمة)' : '🔴 سند صرف (دفعة مسددة)'}</td>
            <td style="padding:0.4rem; font-family:var(--font-latin); font-weight:700;">${Number(v.amount).toFixed(2)} ج.م</td>
            <td style="padding:0.4rem;">${v.paymentMethod || 'كاش'}</td>
            <td style="padding:0.4rem; color:var(--ab-text-muted);">${v.notes || '-'}</td>
          </tr>
        `).join('');
      }
    }
  }

  // ==========================================================================
  // 10. إدارة قاعدة البيانات (PostgreSQL + SQLite) والتصدير والمزامنة
  // ==========================================================================
  function setupDatabaseControls() {
    const openDbModalBtn = document.getElementById('openDbModalBtn');
    const ribbonDbBtn = document.getElementById('ribbonDbBtn');
    const menuDbBtn = document.getElementById('menuDatabase');

    function openDb() {
      updateDbModalStats();
      openModal('dbModal');
    }

    if (openDbModalBtn) openDbModalBtn.addEventListener('click', openDb);
    if (ribbonDbBtn) ribbonDbBtn.addEventListener('click', openDb);
    if (menuDbBtn) menuDbBtn.addEventListener('click', openDb);
    const menuBackup = document.getElementById('menuBackup');
    if (menuBackup) menuBackup.addEventListener('click', openDb);

    // تصدير PostgreSQL
    const dlPgBtn = document.getElementById('downloadPostgresDumpBtn');
    if (dlPgBtn) {
      dlPgBtn.addEventListener('click', async () => {
        if (!window.newTechDB) return;
        const sql = await window.newTechDB.generatePostgresDump();
        downloadFile(sql, `NewTech_PostgreSQL_Dump_${Date.now()}.sql`, 'application/sql');
        showToast('✅ تم توليد وتنزيل ملف PostgreSQL Dump المتوافق مع السيرفرات السحابية');
      });
    }

    // تصدير SQLite
    const dlSqliteBtn = document.getElementById('downloadSqliteDumpBtn');
    if (dlSqliteBtn) {
      dlSqliteBtn.addEventListener('click', async () => {
        if (!window.newTechDB) return;
        const sql = await window.newTechDB.generateSQLiteDump();
        downloadFile(sql, `NewTech_SQLite_Dump_${Date.now()}.sql`, 'application/sql');
        showToast('✅ تم توليد وتنزيل ملف SQLite Dump للتشغيل المحلي والوضع Offline');
      });
    }

    // تصدير JSON
    const dlJsonBtn = document.getElementById('downloadJsonBackupBtn');
    if (dlJsonBtn) {
      dlJsonBtn.addEventListener('click', () => {
        const backup = {
          exportDate: new Date().toISOString(),
          companies: appState.companies,
          transactions: appState.items,
          purchases: appState.purchases,
          currentUser: appState.currentUser
        };
        downloadFile(JSON.stringify(backup, null, 2), `NewTech_Backup_${Date.now()}.json`, 'application/json');
        showToast('تم تصدير نسخة JSON احتياطية بنجاح');
      });
    }

    // استعادة ملف نسخة
    const restoreInput = document.getElementById('restoreDbFileInput');
    if (restoreInput) {
      restoreInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
          try {
            const data = JSON.parse(ev.target.result);
            if (data.companies) appState.companies = data.companies;
            if (data.transactions) appState.items = data.transactions;
            if (data.purchases) appState.purchases = data.purchases;

            if (window.newTechDB) {
              await window.newTechDB.bulkSaveCompanies(appState.companies);
              for (const it of appState.items) await window.newTechDB.saveTransaction(it);
              for (const pu of appState.purchases) await window.newTechDB.savePurchase(pu);
            }
            syncLocalStorageCache();
            renderAll();
            showToast('✅ تم استعادة النسخة الاحتياطية بنجاح وتحديث كافة السجلات!');
          } catch(err) {
            alert('الملف غير صالح أو حدث خطأ أثناء القراءة!');
          }
        };
        reader.readAsText(file);
      });
    }

    // حفظ إعدادات المزامنة السحابية
    const saveCloudBtn = document.getElementById('saveCloudSyncBtn');
    if (saveCloudBtn) {
      saveCloudBtn.addEventListener('click', async () => {
        const endpoint = document.getElementById('pgEndpointInput').value.trim();
        const apiKey = document.getElementById('pgApiKeyInput').value.trim();
        if (window.newTechDB) {
          await window.newTechDB.saveCloudSettings({ endpoint, apiKey, enabled: true });
          try {
            await window.newTechDB.syncWithCloudPostgres();
            const statusEl = document.getElementById('cloudSyncStatusText');
            if (statusEl) {
              statusEl.textContent = '🟢 متصل ومتزامن مع PostgreSQL';
              statusEl.style.color = 'var(--ab-paid)';
            }
            showToast('✅ تمت المزامنة بنجاح مع سيرفر PostgreSQL السحابي!');
          } catch (err) {
            alert(err.message);
          }
        }
      });
    }
  }

  async function updateDbModalStats() {
    if (!window.newTechDB) return;
    const stats = await window.newTechDB.getDatabaseStats();
    const transCountEl = document.getElementById('dbModalTransCount');
    if (transCountEl) transCountEl.textContent = `${stats.transactionsCount} مسحوب | ${stats.purchasesCount} فاتورة مشتريات`;

    const userEl = document.getElementById('dbModalCurrentUser');
    if (userEl) userEl.textContent = appState.currentUser ? appState.currentUser.username : 'admin';

    // تحميل إعدادات الكلاود في الحقول
    const epInput = document.getElementById('pgEndpointInput');
    const keyInput = document.getElementById('pgApiKeyInput');
    if (epInput && window.newTechDB.cloudConfig) epInput.value = window.newTechDB.cloudConfig.endpoint || '';
    if (keyInput && window.newTechDB.cloudConfig) keyInput.value = window.newTechDB.cloudConfig.apiKey || '';

    // سجل التدقيق
    const auditContainer = document.getElementById('auditLogContainer');
    if (auditContainer) {
      const logs = await window.newTechDB.getAuditLogs(30);
      if (logs.length === 0) {
        auditContainer.innerHTML = '<div style="color:var(--ab-text-dim); padding:0.5rem;">لا توجد عمليات مسجلة</div>';
      } else {
        auditContainer.innerHTML = logs.map(l => `
          <div class="audit-log-item">
            <span>[${l.action}] ${escapeHtml(l.itemName || l.invoiceNumber || l.details || '')}</span>
            <small style="color:var(--ab-text-dim);">${formatTimeStr(new Date(l.timestamp))}</small>
          </div>
        `).join('');
      }
    }
  }

  function downloadFile(content, fileName, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 200);
  }

  // ==========================================================================
  // 11. إضافة صنف مسحوب جديد (Add / Edit Transaction)
  // ==========================================================================
  function setupAddItemModal() {
    const form = document.getElementById('addItemForm');
    const openBtn = document.getElementById('openAddModalBtn');
    const emptyBtn = document.getElementById('emptyStateAddBtn');
    const menuBtn = document.getElementById('menuAdd');
    const priceInp = document.getElementById('itemUnitPriceInput');
    const qtyInp = document.getElementById('itemQuantityInput');
    const totalInp = document.getElementById('itemTotalPriceInput');
    const codeInp = document.getElementById('itemCodeInput');
    const genCodeBtn = document.getElementById('generateCodeBtn');
    const compSel = document.getElementById('itemCompanySelect');

    function calcTotal() {
      const p = parseFloat(priceInp.value) || 0;
      const q = parseInt(qtyInp.value) || 1;
      totalInp.value = (p * q).toFixed(2);
    }

    if (priceInp) priceInp.addEventListener('input', calcTotal);
    if (qtyInp) qtyInp.addEventListener('input', calcTotal);

    if (genCodeBtn) {
      genCodeBtn.addEventListener('click', () => {
        const prefix = 'NT-';
        const rand = Math.floor(100 + Math.random() * 900);
        codeInp.value = `${prefix}${rand}`;
      });
    }

    function populateQuickStockProducts() {
      const qsSelect = document.getElementById('quickStockProductSelect');
      const badge = document.getElementById('quickStockProductStockBadge');
      if (!qsSelect) return;
      qsSelect.innerHTML = '<option value="">-- أو اختر صنفاً جاهزاً من المخزون (ينزل السعر والكود تلقائياً) --</option>';
      if (badge) badge.style.display = 'none';

      (appState.products || []).forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.name} [كود: ${p.code}] - متاح: ${p.stock} ${p.unit || 'قطعة'} (سعر: ${p.salePrice || p.costPrice} ج.م)`;
        qsSelect.appendChild(opt);
      });
    }

    const qsSelect = document.getElementById('quickStockProductSelect');
    if (qsSelect) {
      qsSelect.addEventListener('change', () => {
        const prodId = qsSelect.value;
        const prod = (appState.products || []).find(p => p.id === prodId);
        const badge = document.getElementById('quickStockProductStockBadge');
        if (prod) {
          document.getElementById('itemNameInput').value = prod.name;
          codeInp.value = prod.code;
          priceInp.value = prod.salePrice || prod.costPrice || 0;
          calcTotal();
          if (badge) {
            badge.style.display = 'inline-block';
            badge.textContent = `الرصيد المتاح بالمخزن: ${prod.stock} ${prod.unit || 'قطعة'}`;
            badge.style.color = prod.stock <= (prod.minStock || 3) ? '#ef4444' : '#10b981';
          }
        } else {
          if (badge) badge.style.display = 'none';
        }
      });
    }

    function openForAdd() {
      form.reset();
      document.getElementById('editItemId').value = '';
      document.getElementById('addItemModalTitle').textContent = 'تسجيل صنف مسحوب جديد';
      const stamp = getFullTimestamp();
      document.getElementById('itemDateTimeText').textContent = stamp.fullText;
      document.getElementById('itemTimestampInput').value = stamp.iso;
      codeInp.value = 'NT-' + Math.floor(100 + Math.random() * 900);
      populateCompanyDropdown();
      populateQuickStockProducts();
      if (appState.filters.companyId !== 'ALL') {
        compSel.value = appState.filters.companyId;
      }
      openModal('addItemModal');
    }

    if (openBtn) openBtn.addEventListener('click', openForAdd);
    if (emptyBtn) emptyBtn.addEventListener('click', openForAdd);
    if (menuBtn) menuBtn.addEventListener('click', openForAdd);
    const quickAddCompanyBtn = document.getElementById('quickAddCompanyBtn');
    if (quickAddCompanyBtn) quickAddCompanyBtn.addEventListener('click', () => { renderCompaniesGrid(); openModal('companiesModal'); });

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const editId = document.getElementById('editItemId').value;
        const itemName = document.getElementById('itemNameInput').value.trim();
        const itemCode = codeInp.value.trim();
        const unitPrice = parseFloat(priceInp.value) || 0;
        const quantity = parseInt(qtyInp.value) || 1;
        const totalPrice = parseFloat(totalInp.value) || (unitPrice * quantity);
        const companyId = compSel.value;
        const personName = document.getElementById('itemPersonInput').value.trim();
        const paymentRadio = document.querySelector('input[name="paymentStatus"]:checked');
        const paymentStatus = paymentRadio ? paymentRadio.value : 'UNPAID';
        const isPaid = paymentStatus === 'PAID';
        const isReturned = paymentStatus === 'RETURNED';
        const notes = document.getElementById('itemNotesInput').value.trim();

        const compObj = appState.companies.find(c => c.id === companyId);
        if (!compObj) return;

        if (editId) {
          const idx = appState.items.findIndex(i => i.id === editId);
          if (idx !== -1) {
            const updatedItem = {
              ...appState.items[idx],
              itemName,
              itemCode,
              unitPrice,
              quantity,
              totalPrice,
              companyId,
              companyName: compObj.name,
              companyArName: compObj.arName,
              personName,
              status: paymentStatus,
              isPaid,
              isReturned,
              updatedAt: new Date().toISOString(),
              notes
            };
            appState.items[idx] = updatedItem;
            if (window.newTechDB) await window.newTechDB.saveTransaction(updatedItem);
            syncLocalStorageCache();
            renderAll();
            closeModal('addItemModal');
            showToast(`تم تعديل صنف "${itemName}" بنجاح`);
          }
        } else {
          const stamp = getFullTimestamp();
          const newItem = {
            id: 'item_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            userId: appState.currentUser ? appState.currentUser.id : null,
            itemName,
            itemCode,
            unitPrice,
            quantity,
            totalPrice,
            companyId,
            companyName: compObj.name,
            companyArName: compObj.arName,
            personName,
            createdAt: stamp.iso,
            updatedAt: stamp.iso,
            dayName: stamp.dayName,
            dateStr: stamp.dateStr,
            timeStr: stamp.timeStr,
            status: paymentStatus,
            isPaid,
            isReturned,
            paidAt: isPaid ? stamp.iso : null,
            returnedAt: isReturned ? stamp.iso : null,
            notes
          };
          appState.items.unshift(newItem);
          if (window.newTechDB) await window.newTechDB.saveTransaction(newItem);

          // خصم تلقائي من رصيد المخزن في حال كان الصنف غير مرتجع
          if (!isReturned) {
            const matchedProd = (appState.products || []).find(p => (itemCode && p.code === itemCode) || (itemName && p.name.toLowerCase() === itemName.toLowerCase()));
            if (matchedProd) {
              matchedProd.stock = Math.max(0, (parseFloat(matchedProd.stock) || 0) - quantity);
              matchedProd.updatedAt = new Date().toISOString();
              if (window.newTechDB) await window.newTechDB.saveProduct(matchedProd);
            }
          }

          syncLocalStorageCache();
          renderAll();
          closeModal('addItemModal');
          playSoundAdd();
          showToast(`تم تسجيل صنف "${itemName}" لشركة "${compObj.name}" بنجاح!`);
        }
      });
    }
  }

  function populateCompanyDropdown() {
    const sel = document.getElementById('itemCompanySelect');
    if (!sel) return;
    sel.innerHTML = '<option value="" disabled selected>-- اختر من قائمة الشركات والموردين --</option>';
    appState.companies.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.name} (${c.arName})`;
      sel.appendChild(opt);
    });
  }

  // ==========================================================================
  // 12. معالجة الأحداث والضغطات (Delegated Actions)
  //     - زر تم الدفع وزر مرتجع وتعديل وحذف
  // ==========================================================================
  function setupActions() {
    document.addEventListener('click', async (e) => {
      // 1. زر تم الدفع (Toggle Paid)
      const togglePaidBtn = e.target.closest('[data-action="toggle-paid"]');
      if (togglePaidBtn) {
        const id = togglePaidBtn.getAttribute('data-id');
        const item = appState.items.find(i => i.id === id);
        if (!item || item.isReturned) return;

        if (!item.isPaid) {
          item.isPaid = true;
          item.status = 'PAID';
          item.paidAt = new Date().toISOString();
          item.updatedAt = new Date().toISOString();
          if (window.newTechDB) await window.newTechDB.saveTransaction(item);
          syncLocalStorageCache();
          renderAll();
          playSoundPaid();
          spawnParticles(togglePaidBtn);
          showToast(`✅ تم تأكيد سداد: ${item.itemName} (${item.companyName})`);
        } else {
          item.isPaid = false;
          item.status = 'UNPAID';
          item.paidAt = null;
          item.updatedAt = new Date().toISOString();
          if (window.newTechDB) await window.newTechDB.saveTransaction(item);
          syncLocalStorageCache();
          renderAll();
          playSoundUnpay();
          showToast(`↩️ تم إعادة صنف "${item.itemName}" لغير مدفوع`);
        }
        return;
      }

      // 2. زر مرتجع بجانب زر تم الدفع (المطلب رقم 4)
      const toggleReturnBtn = e.target.closest('[data-action="toggle-return"]');
      if (toggleReturnBtn) {
        const id = toggleReturnBtn.getAttribute('data-id');
        const item = appState.items.find(i => i.id === id);
        if (!item) return;

        if (!item.isReturned) {
          item.isReturned = true;
          item.status = 'RETURNED';
          item.isPaid = false;
          item.returnedAt = new Date().toISOString();
          item.updatedAt = new Date().toISOString();

          // إعادة الكمية إلى رصيد المخزن عند الإرجاع
          const matchedProd = (appState.products || []).find(p => (item.itemCode && p.code === item.itemCode) || (item.itemName && p.name.toLowerCase() === item.itemName.toLowerCase()));
          if (matchedProd) {
            matchedProd.stock = (parseFloat(matchedProd.stock) || 0) + (parseFloat(item.quantity) || 1);
            matchedProd.updatedAt = new Date().toISOString();
            if (window.newTechDB) await window.newTechDB.saveProduct(matchedProd);
          }

          if (window.newTechDB) await window.newTechDB.saveTransaction(item);
          syncLocalStorageCache();
          renderAll();
          playSoundReturn();
          showToast(`🔄 تم تسجيل صنف "${item.itemName}" كمرتجع وإعادة الكمية للمخزن`);
        } else {
          item.isReturned = false;
          item.status = 'UNPAID';
          item.returnedAt = null;
          item.updatedAt = new Date().toISOString();

          // إعادة الخصم من المخزن عند إلغاء المرتجع
          const matchedProd = (appState.products || []).find(p => (item.itemCode && p.code === item.itemCode) || (item.itemName && p.name.toLowerCase() === item.itemName.toLowerCase()));
          if (matchedProd) {
            matchedProd.stock = Math.max(0, (parseFloat(matchedProd.stock) || 0) - (parseFloat(item.quantity) || 1));
            matchedProd.updatedAt = new Date().toISOString();
            if (window.newTechDB) await window.newTechDB.saveProduct(matchedProd);
          }

          if (window.newTechDB) await window.newTechDB.saveTransaction(item);
          syncLocalStorageCache();
          renderAll();
          playSoundUnpay();
          showToast(`↩️ تم إلغاء المرتجع وإعادة صنف "${item.itemName}" للمسحوبات`);
        }
        return;
      }

      // 3. مرتجع فاتورة مشتريات
      const togglePurchReturn = e.target.closest('[data-action="toggle-purchase-return"]');
      if (togglePurchReturn) {
        const id = togglePurchReturn.getAttribute('data-id');
        const purch = appState.purchases.find(p => p.id === id);
        if (!purch) return;

        purch.isReturned = !purch.isReturned;
        purch.paymentStatus = purch.isReturned ? 'RETURNED' : (purch.remainingAmount === 0 ? 'PAID' : 'UNPAID');

        // تحديث رصيد المخزن وفقاً لحالة مرتجع فاتورة الشراء
        for (const pItem of purch.items || []) {
          const matchedProd = (appState.products || []).find(p => (pItem.itemCode && p.code === pItem.itemCode) || (pItem.itemName && p.name.toLowerCase() === pItem.itemName.toLowerCase()));
          if (matchedProd) {
            if (purch.isReturned) {
              // خصم الكمية من المخزن لأن الفاتورة أُرجعت للمورد
              matchedProd.stock = Math.max(0, (parseFloat(matchedProd.stock) || 0) - (parseFloat(pItem.quantity) || 1));
            } else {
              // إعادة الكمية للمخزن لأن مرتجع الشراء أُلغي
              matchedProd.stock = (parseFloat(matchedProd.stock) || 0) + (parseFloat(pItem.quantity) || 1);
            }
            matchedProd.updatedAt = new Date().toISOString();
            if (window.newTechDB) await window.newTechDB.saveProduct(matchedProd);
          }
        }

        if (window.newTechDB) await window.newTechDB.savePurchase(purch);
        syncLocalStorageCache();
        renderPurchasesList();
        renderAll();
        playSoundReturn();
        showToast(purch.isReturned ? `🔄 تم تسجيل الفاتورة ${purch.invoiceNumber} كمرتجعة وتحديث المخزن` : `تم إلغاء مرتجع الفاتورة`);
        return;
      }

      // 4. حذف فاتورة مشتريات
      const delPurchBtn = e.target.closest('[data-action="delete-purchase"]');
      if (delPurchBtn) {
        const id = delPurchBtn.getAttribute('data-id');
        if (confirm('هل تريد حذف فاتورة الشراء هذه نهائياً؟')) {
          appState.purchases = appState.purchases.filter(p => p.id !== id);
          if (window.newTechDB) await window.newTechDB.deletePurchase(id);
          syncLocalStorageCache();
          renderPurchasesList();
          renderAll();
          playSoundDelete();
          showToast('تم حذف فاتورة الشراء وتحديث المقاصة');
        }
        return;
      }

      // 5. التركيز على شركة
      const focusComp = e.target.closest('[data-action="focus-company"]');
      if (focusComp) {
        selectCompany(focusComp.getAttribute('data-company-id'));
        return;
      }

      // 6. تعديل صنف
      const editBtn = e.target.closest('[data-action="edit-item"]');
      if (editBtn) {
        const id = editBtn.getAttribute('data-id');
        const item = appState.items.find(i => i.id === id);
        if (!item) return;

        document.getElementById('editItemId').value = item.id;
        document.getElementById('itemNameInput').value = item.itemName;
        document.getElementById('itemCodeInput').value = item.itemCode;
        document.getElementById('itemUnitPriceInput').value = item.unitPrice;
        document.getElementById('itemQuantityInput').value = item.quantity;
        document.getElementById('itemTotalPriceInput').value = item.totalPrice;
        populateCompanyDropdown();
        document.getElementById('itemCompanySelect').value = item.companyId;
        document.getElementById('itemPersonInput').value = item.personName || '';
        document.getElementById('itemNotesInput').value = item.notes || '';
        document.getElementById('addItemModalTitle').textContent = `تعديل صنف: ${item.itemName}`;

        if (item.isReturned) document.getElementById('statusReturnedRadio').checked = true;
        else if (item.isPaid) document.getElementById('statusPaidRadio').checked = true;
        else document.getElementById('statusUnpaidRadio').checked = true;

        openModal('addItemModal');
        return;
      }

      // 7. حذف صنف
      const delBtn = e.target.closest('[data-action="delete-item"]');
      if (delBtn) {
        const id = delBtn.getAttribute('data-id');
        const item = appState.items.find(i => i.id === id);
        if (!item) return;

        if (confirm(`هل أنت متأكد من حذف صنف "${item.itemName}" من السجل؟`)) {
          appState.items = appState.items.filter(i => i.id !== id);
          if (window.newTechDB) await window.newTechDB.deleteTransaction(id);
          syncLocalStorageCache();
          renderAll();
          playSoundDelete();
          showToast(`تم حذف صنف "${item.itemName}" بنجاح`);
        }
        return;
      }

      // 8. كشف حساب شركة من المقاصة
      const stmtCompBtn = e.target.closest('[data-action="open-company-statement"]');
      if (stmtCompBtn) {
        const compId = stmtCompBtn.getAttribute('data-company-id');
        closeModal('nettingModal');
        const stmtSel = document.getElementById('statementCompanySelect');
        if (stmtSel) stmtSel.value = compId;
        renderStatementSheet();
        openModal('statementModal');
        return;
      }
    });

    // زر تفريغ السجل
    const clearAllBtn = document.getElementById('ribbonClearAllBtn');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', async () => {
        if (confirm('تحذير: هل أنت متأكد من رغبتك في تفريغ وتصفير كافة المسحوبات والمشتريات للبدء على نظيف؟')) {
          appState.items = [];
          appState.purchases = [];
          if (window.newTechDB) await window.newTechDB.clearAllTransactions();
          syncLocalStorageCache();
          renderAll();
          playSoundDelete();
          showToast('تم تصفير السجل بنجاح للبدء على نظيف من الصفر');
        }
      });
    }

    // زر إلغاء فلترة الشركة
    const resetCompanyBtn = document.getElementById('resetCompanyFilterBtn');
    if (resetCompanyBtn) {
      resetCompanyBtn.addEventListener('click', () => {
        selectCompany('ALL');
      });
    }

    // زر تصدير إكسيل
    const exportExcelBtn = document.getElementById('exportExcelBtn');
    if (exportExcelBtn) {
      exportExcelBtn.addEventListener('click', exportToExcel);
    }

    // زر كتم الصوت
    const soundBtn = document.getElementById('soundToggleBtn');
    if (soundBtn) {
      soundBtn.addEventListener('click', () => {
        soundEnabled = !soundEnabled;
        soundBtn.classList.toggle('muted', !soundEnabled);
        soundBtn.innerHTML = soundEnabled ? '<i class="fa-solid fa-volume-high"></i>' : '<i class="fa-solid fa-volume-xmark"></i>';
        showToast(soundEnabled ? 'تم تفعيل المؤثرات الصوتية' : 'تم كتم المؤثرات الصوتية');
      });
    }
  }

  function selectCompany(compId) {
    appState.filters.companyId = compId;
    renderSidebarCompanies();
    renderStructuredTableRows();
    updateMetricsAndBadges();
  }

  // ==========================================================================
  // 13. الشريط الجانبي والفلترة
  // ==========================================================================
  function setupFiltersAndSidebar() {
    // الأقسام الرئيسية
    ['ALL', 'UNPAID', 'PAID', 'RETURNED'].forEach(type => {
      const el = document.getElementById(`sideNav${type.charAt(0) + type.slice(1).toLowerCase()}`);
      if (el) {
        el.addEventListener('click', () => {
          document.querySelectorAll('.sidebar-nav-item').forEach(i => i.classList.remove('active'));
          el.classList.add('active');
          appState.filters.status = type;
          renderStructuredTableRows();
        });
      }
    });

    // أزرار الفلترة في الشريط العلوي
    const btnUnpaid = document.getElementById('btnFilterUnpaid');
    const btnPaid = document.getElementById('btnFilterPaid');
    const btnRet = document.getElementById('btnFilterReturned');

    if (btnUnpaid) btnUnpaid.addEventListener('click', () => setStatusFilter('UNPAID'));
    if (btnPaid) btnPaid.addEventListener('click', () => setStatusFilter('PAID'));
    if (btnRet) btnRet.addEventListener('click', () => setStatusFilter('RETURNED'));

    function setStatusFilter(st) {
      appState.filters.status = (appState.filters.status === st) ? 'ALL' : st;
      document.querySelectorAll('.sidebar-nav-item').forEach(i => i.classList.remove('active'));
      const activeEl = document.getElementById(`sideNav${appState.filters.status.charAt(0) + appState.filters.status.slice(1).toLowerCase()}`);
      if (activeEl) activeEl.classList.add('active');
      renderStructuredTableRows();
    }

    // فلتر التاريخ
    const dateSel = document.getElementById('dateFilterSelect');
    if (dateSel) {
      dateSel.addEventListener('change', (e) => {
        appState.filters.dateRange = e.target.value;
        renderStructuredTableRows();
      });
    }

    // البحث في الشريط العلوي
    const searchInp = document.getElementById('titleSearchInput');
    if (searchInp) {
      searchInp.addEventListener('input', (e) => {
        appState.filters.searchQuery = e.target.value;
        renderStructuredTableRows();
      });
    }

    // بحث شركات الشريط الجانبي
    const compSearchInp = document.getElementById('sideCompanySearchInput');
    if (compSearchInp) {
      compSearchInp.addEventListener('input', (e) => {
        renderSidebarCompanies(e.target.value.trim().toLowerCase());
      });
    }
  }

  function renderSidebarCompanies(query = '') {
    const list = document.getElementById('sidebarCompaniesList');
    if (!list) return;

    let companies = appState.companies;
    if (query) {
      companies = companies.filter(c =>
        (c.name || '').toLowerCase().includes(query) ||
        (c.arName || '').toLowerCase().includes(query)
      );
    }

    list.innerHTML = `
      <li class="sidebar-nav-item ${appState.filters.companyId === 'ALL' ? 'active' : ''}" data-comp="ALL">
        <div class="sidebar-item-label">
          <i class="fa-solid fa-border-all"></i>
          <span>جميع الشركات والموردين</span>
        </div>
      </li>
    ` + companies.map(c => {
      const net = computeNetting(c.id);
      let badgeStyle = 'color:var(--ab-text-dim);';
      let badgeText = '0';
      if (net.netBalance > 0) {
        badgeStyle = 'color:#ff3366; font-weight:800;'; // أحمر
        badgeText = `${net.netBalance.toFixed(0)}`;
      } else if (net.netBalance < 0) {
        badgeStyle = 'color:#10b981; font-weight:800;'; // أخضر
        badgeText = `${Math.abs(net.netBalance).toFixed(0)}`;
      }

      return `
        <li class="sidebar-nav-item ${appState.filters.companyId === c.id ? 'active' : ''}" data-comp="${c.id}">
          <div class="sidebar-item-label">
            <i class="fa-solid fa-building" style="font-size:0.75rem;"></i>
            <span>${escapeHtml(c.name)} (${escapeHtml(c.arName)})</span>
          </div>
          <span class="sidebar-badge" style="${badgeStyle}">${badgeText}</span>
        </li>
      `;
    }).join('');

    list.querySelectorAll('.sidebar-nav-item').forEach(li => {
      li.addEventListener('click', () => {
        const compId = li.getAttribute('data-comp');
        selectCompany(compId);
      });
    });
  }

  // ==========================================================================
  // 14. إدارة الشركات والموردين (Companies Modal)
  // ==========================================================================
  function setupCompaniesManagement() {
    const openBtn = document.getElementById('openCompaniesModalBtn');
    const menuBtn = document.getElementById('menuCompanies');
    const form = document.getElementById('addNewCompanyForm');
    const searchInp = document.getElementById('companiesSearchInput');

    function openCompanies() {
      renderCompaniesGrid();
      openModal('companiesModal');
    }

    if (openBtn) openBtn.addEventListener('click', openCompanies);
    if (menuBtn) menuBtn.addEventListener('click', openCompanies);

    if (searchInp) {
      searchInp.addEventListener('input', () => {
        renderCompaniesGrid(searchInp.value.trim().toLowerCase());
      });
    }

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('newCompanyNameInput').value.trim();
        const arName = document.getElementById('newCompanyArNameInput').value.trim();
        const entityType = document.getElementById('newCompanyTypeSelect').value;
        const person = document.getElementById('newCompanyPersonInput').value.trim();

        const id = name.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now().toString(36);
        const newComp = {
          id,
          name,
          arName,
          entityType,
          persons: person ? [person] : ['مسؤول الجهة']
        };

        appState.companies.push(newComp);
        if (window.newTechDB) await window.newTechDB.saveCompany(newComp);
        syncLocalStorageCache();
        form.reset();
        renderCompaniesGrid();
        renderSidebarCompanies();
        showToast(`تمت إضافة ${name} (${arName}) بنجاح!`);
      });
    }
  }

  function renderCompaniesGrid(query = '') {
    const grid = document.getElementById('companiesManageGrid');
    if (!grid) return;

    let comps = appState.companies;
    if (query) {
      comps = comps.filter(c =>
        (c.name || '').toLowerCase().includes(query) ||
        (c.arName || '').toLowerCase().includes(query)
      );
    }

    const countEl = document.getElementById('modalCompaniesCount');
    if (countEl) countEl.textContent = `${comps.length} شركة ومورد`;

    grid.innerHTML = comps.map(c => `
      <div class="company-card-item">
        <div class="comp-head">
          <div class="comp-title-en">${escapeHtml(c.name)}</div>
          <div class="comp-title-ar">${escapeHtml(c.arName)}</div>
          <small style="color:var(--ab-cyan); display:block; margin-top:0.2rem;">${c.entityType === 'supplier' ? 'مورد مشتريات' : (c.entityType === 'both' ? 'شركة ومورد (مقاصة ثنائية)' : 'شركة مول')}</small>
        </div>
      </div>
    `).join('');
  }

  // ==========================================================================
  // 15. إدارة النوافذ المنبثقة (Modals Helper)
  // ==========================================================================
  function openModal(id) {
    const el = document.getElementById(id);
    if (el) {
      el.classList.add('is-active', 'is-open');
      el.style.display = 'flex';
    }
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) {
      el.classList.remove('is-active', 'is-open');
      el.style.display = 'none';
    }
  }

  function setupModalsDismiss() {
    document.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const modalId = btn.getAttribute('data-close-modal');
        closeModal(modalId);
      });
    });

    document.querySelectorAll('.modal-backdrop').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.classList.remove('is-active', 'is-open');
        }
      });
    });
  }

  // ==========================================================================
  // 16. تصدير إكسيل (Excel CSV Export with UTF-8 BOM)
  // ==========================================================================
  function exportToExcel() {
    const items = appState.items;
    if (items.length === 0) {
      alert('السجل فارغ! لا توجد أصناف لتصديرها.');
      return;
    }

    let csv = '\uFEFF';
    csv += 'كود الصنف,اسم الصنف,اسم الشركة,الاسم العربي,الشخص المستلم,الكمية,سعر القطعة,السعر الإجمالي,التاريخ,الوقت,حالة السداد,ملاحظات\n';

    items.forEach(i => {
      const st = i.isReturned ? 'مرتجع' : (i.isPaid ? 'تم الدفع' : 'غير مدفوع');
      csv += `"${i.itemCode}","${i.itemName}","${i.companyName}","${i.companyArName || ''}","${i.personName || ''}",${i.quantity},${i.unitPrice},${i.totalPrice},"${i.dateStr}","${i.timeStr}","${st}","${(i.notes || '').replace(/"/g, '""')}"\n`;
    });

    downloadFile(csv, `NewTech_Export_${Date.now()}.csv`, 'text/csv;charset=utf-8;');
    showToast('تم تصدير كشف الإكسيل بنجاح');
  }

  // ==========================================================================
  // 17. نظام سندات القبض والصرف وسداد الدفعات (Vouchers System)
  // ==========================================================================
  function setupVouchers() {
    const openBtn = document.getElementById('openVoucherModalBtn');
    const sideNavBtn = document.getElementById('sideNavVouchers');
    const menuBtn = document.getElementById('menuVouchers');
    const listBtn = document.getElementById('openVouchersListBtn');
    const form = document.getElementById('voucherForm');
    const searchInp = document.getElementById('voucherSearchInput');
    const typeSelect = document.getElementById('voucherTypeSelect');
    const compSelect = document.getElementById('voucherCompanySelect');
    const numInput = document.getElementById('voucherNumberInput');
    const dateInput = document.getElementById('voucherDateInput');

    function openVouchersModal(defaultType = 'receipt') {
      if (form) form.reset();
      if (typeSelect) typeSelect.value = defaultType;
      if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
      if (numInput) {
        const prefix = (typeSelect && typeSelect.value === 'payment') ? 'PAY-' : 'REC-';
        numInput.value = prefix + Math.floor(1000 + Math.random() * 9000);
      }
      populateVoucherCompanies();
      renderVouchersTable();
      openModal('voucherModal');
    }

    if (openBtn) openBtn.addEventListener('click', () => openVouchersModal('receipt'));
    if (sideNavBtn) sideNavBtn.addEventListener('click', () => openVouchersModal('receipt'));
    if (menuBtn) menuBtn.addEventListener('click', () => openVouchersModal('receipt'));
    if (listBtn) listBtn.addEventListener('click', () => openVouchersModal('receipt'));

    if (typeSelect) {
      typeSelect.addEventListener('change', () => {
        const prefix = typeSelect.value === 'payment' ? 'PAY-' : 'REC-';
        if (numInput) numInput.value = prefix + Math.floor(1000 + Math.random() * 9000);
      });
    }

    function populateVoucherCompanies() {
      if (!compSelect) return;
      compSelect.innerHTML = '<option value="" disabled selected>-- اختر الشركة أو المورد --</option>';
      appState.companies.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = `${c.name} (${c.arName}) - ${c.entityType === 'supplier' ? 'مورد' : 'شركة'}`;
        compSelect.appendChild(opt);
      });
      if (appState.filters.companyId !== 'ALL') {
        compSelect.value = appState.filters.companyId;
      }
    }

    if (searchInp) {
      searchInp.addEventListener('input', () => {
        renderVouchersTable(searchInp.value.trim().toLowerCase());
      });
    }

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const type = typeSelect ? typeSelect.value : 'receipt';
        const companyId = compSelect.value;
        const comp = appState.companies.find(c => c.id === companyId);
        if (!comp) {
          alert('يرجى اختيار الشركة أو المورد أولاً');
          return;
        }

        const amount = parseFloat(document.getElementById('voucherAmountInput').value) || 0;
        const method = document.getElementById('voucherPaymentMethodSelect').value;
        const date = dateInput.value;
        const number = numInput.value;
        const notes = document.getElementById('voucherNotesInput').value.trim();

        const newVoucher = {
          id: 'vch_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
          voucherNumber: number,
          type, // 'receipt' or 'payment'
          companyId,
          companyName: comp.name,
          companyArName: comp.arName,
          amount,
          paymentMethod: method,
          date,
          notes,
          createdAt: new Date().toISOString()
        };

        appState.vouchers.unshift(newVoucher);
        if (window.newTechDB) await window.newTechDB.saveVoucher(newVoucher);
        syncLocalStorageCache();
        renderVouchersTable();
        renderAll();
        playSoundPaid();
        showToast(`✅ تم حفظ ${type === 'receipt' ? 'سند قبض' : 'سند صرف'} برقم ${number} بمبلغ ${amount.toFixed(2)} ج.م بنجاح!`);

        // تجهيز رقم السند التالي
        const nextPrefix = type === 'payment' ? 'PAY-' : 'REC-';
        numInput.value = nextPrefix + Math.floor(1000 + Math.random() * 9000);
        document.getElementById('voucherAmountInput').value = '';
        document.getElementById('voucherNotesInput').value = '';
      });
    }

    const vouchersTable = document.getElementById('vouchersTableBody');
    if (vouchersTable) {
      vouchersTable.addEventListener('click', async (e) => {
        const delBtn = e.target.closest('[data-action="delete-voucher"]');
        if (delBtn) {
          const id = delBtn.getAttribute('data-id');
          if (confirm('هل أنت متأكد من حذف هذا السند؟ سيتم تحديث رصيد المقاصة والخزينة.')) {
            appState.vouchers = appState.vouchers.filter(v => v.id !== id);
            if (window.newTechDB) await window.newTechDB.deleteVoucher(id);
            syncLocalStorageCache();
            renderVouchersTable();
            renderAll();
            playSoundDelete();
            showToast('تم حذف السند وتحديث الحسابات بنجاح');
          }
        }
      });
    }
  }

  function renderVouchersTable(query = '') {
    const tbody = document.getElementById('vouchersTableBody');
    if (!tbody) return;

    let vouchers = appState.vouchers || [];
    let totReceipts = 0;
    let totPayments = 0;

    vouchers.forEach(v => {
      const amt = parseFloat(v.amount) || 0;
      if (v.type === 'receipt') totReceipts += amt;
      else totPayments += amt;
    });

    const recEl = document.getElementById('voucherTotalReceipts');
    if (recEl) recEl.textContent = `${totReceipts.toFixed(2)} ج.م`;
    const payEl = document.getElementById('voucherTotalPayments');
    if (payEl) payEl.textContent = `${totPayments.toFixed(2)} ج.م`;

    if (query) {
      vouchers = vouchers.filter(v =>
        (v.voucherNumber || '').toLowerCase().includes(query) ||
        (v.companyName || '').toLowerCase().includes(query) ||
        (v.companyArName || '').toLowerCase().includes(query) ||
        (v.notes || '').toLowerCase().includes(query)
      );
    }

    if (vouchers.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:1.5rem; color:var(--ab-text-dim);">لا توجد سندات قبض أو صرف مسجلة</td></tr>`;
      return;
    }

    tbody.innerHTML = vouchers.map(v => {
      const isRec = v.type === 'receipt';
      const typeBadge = isRec
        ? `<span style="background:rgba(16,185,129,0.15); color:#10b981; border:1px solid rgba(16,185,129,0.3); padding:0.2rem 0.5rem; border-radius:4px; font-weight:700;"><i class="fa-solid fa-arrow-down-left"></i> سند قبض (مقبوضات)</span>`
        : `<span style="background:rgba(239,68,68,0.15); color:var(--ab-unpaid); border:1px solid rgba(239,68,68,0.3); padding:0.2rem 0.5rem; border-radius:4px; font-weight:700;"><i class="fa-solid fa-arrow-up-right"></i> سند صرف (مدفوعات)</span>`;

      return `
        <tr>
          <td><code class="cell-code text-ltr">${escapeHtml(v.voucherNumber || v.id)}</code></td>
          <td>${typeBadge}</td>
          <td><strong>${escapeHtml(v.companyName || '')} (${escapeHtml(v.companyArName || '')})</strong></td>
          <td><strong style="font-family:var(--font-latin); font-size:0.95rem; color:${isRec ? '#10b981' : 'var(--ab-unpaid)'};">${Number(v.amount).toFixed(2)} ج.م</strong></td>
          <td><small style="color:var(--ab-cyan);">${escapeHtml(v.paymentMethod || 'كاش')}</small></td>
          <td>${escapeHtml(v.date || '')}</td>
          <td style="color:var(--ab-text-muted);">${escapeHtml(v.notes || '-')}</td>
          <td style="text-align:center;">
            <button class="btn-cell-tool del" data-action="delete-voucher" data-id="${v.id}" title="حذف السند">
              <i class="fa-solid fa-trash"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  // ==========================================================================
  // 18. نظام سجل المصروفات العامة والنثريات (Expenses System)
  // ==========================================================================
  function setupExpenses() {
    const openBtn = document.getElementById('openExpenseModalBtn');
    const sideNavBtn = document.getElementById('sideNavExpenses');
    const menuBtn = document.getElementById('menuExpenses');
    const listBtn = document.getElementById('openExpensesListBtn');
    const pillBtn = document.getElementById('openExpensesPillBtn');
    const form = document.getElementById('expenseForm');
    const searchInp = document.getElementById('expenseSearchInput');
    const dateInput = document.getElementById('expenseDateInput');

    function openExpensesModal() {
      if (form) form.reset();
      if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
      renderExpensesTable();
      openModal('expenseModal');
    }

    if (openBtn) openBtn.addEventListener('click', openExpensesModal);
    if (sideNavBtn) sideNavBtn.addEventListener('click', openExpensesModal);
    if (menuBtn) menuBtn.addEventListener('click', openExpensesModal);
    if (listBtn) listBtn.addEventListener('click', openExpensesModal);
    if (pillBtn) pillBtn.addEventListener('click', openExpensesModal);

    if (searchInp) {
      searchInp.addEventListener('input', () => {
        renderExpensesTable(searchInp.value.trim().toLowerCase());
      });
    }

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const category = document.getElementById('expenseCategorySelect').value;
        const amount = parseFloat(document.getElementById('expenseAmountInput').value) || 0;
        const paymentMethod = document.getElementById('expensePaymentMethodSelect').value;
        const date = dateInput.value;
        const title = document.getElementById('expenseTitleInput').value.trim();

        const newExpense = {
          id: 'exp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
          title,
          category,
          amount,
          paymentMethod,
          date,
          createdAt: new Date().toISOString()
        };

        appState.expenses.unshift(newExpense);
        if (window.newTechDB) await window.newTechDB.saveExpense(newExpense);
        syncLocalStorageCache();
        renderExpensesTable();
        renderAll();
        playSoundAdd();
        showToast(`✅ تم تسجيل المصروف: "${title}" بمبلغ ${amount.toFixed(2)} ج.م بنجاح`);

        document.getElementById('expenseAmountInput').value = '';
        document.getElementById('expenseTitleInput').value = '';
      });
    }

    const expensesTable = document.getElementById('expensesTableBody');
    if (expensesTable) {
      expensesTable.addEventListener('click', async (e) => {
        const delBtn = e.target.closest('[data-action="delete-expense"]');
        if (delBtn) {
          const id = delBtn.getAttribute('data-id');
          if (confirm('هل أنت متأكد من حذف هذا المصروف؟')) {
            appState.expenses = appState.expenses.filter(x => x.id !== id);
            if (window.newTechDB) await window.newTechDB.deleteExpense(id);
            syncLocalStorageCache();
            renderExpensesTable();
            renderAll();
            playSoundDelete();
            showToast('تم حذف المصروف بنجاح');
          }
        }
      });
    }
  }

  function renderExpensesTable(query = '') {
    const tbody = document.getElementById('expensesTableBody');
    if (!tbody) return;

    let expenses = appState.expenses || [];
    const todayStr = new Date().toISOString().split('T')[0];

    let todayTotal = 0;
    let allTotal = 0;

    expenses.forEach(x => {
      const amt = parseFloat(x.amount) || 0;
      allTotal += amt;
      if (x.date === todayStr) todayTotal += amt;
    });

    const todayEl = document.getElementById('expenseTodayTotal');
    if (todayEl) todayEl.textContent = `${todayTotal.toFixed(2)} ج.م`;
    const allEl = document.getElementById('expenseAllTotal');
    if (allEl) allEl.textContent = `${allTotal.toFixed(2)} ج.م`;

    if (query) {
      expenses = expenses.filter(x =>
        (x.title || '').toLowerCase().includes(query) ||
        (x.category || '').toLowerCase().includes(query)
      );
    }

    if (expenses.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:1.5rem; color:var(--ab-text-dim);">لا توجد مصروفات مسجلة</td></tr>`;
      return;
    }

    tbody.innerHTML = expenses.map(x => `
      <tr>
        <td><strong>${escapeHtml(x.title)}</strong></td>
        <td><span style="background:rgba(245,158,11,0.15); color:#f59e0b; border:1px solid rgba(245,158,11,0.3); padding:0.2rem 0.5rem; border-radius:4px; font-size:0.78rem;">${escapeHtml(x.category)}</span></td>
        <td><strong style="font-family:var(--font-latin); color:#f59e0b; font-size:0.95rem;">${Number(x.amount).toFixed(2)} ج.م</strong></td>
        <td><small style="color:var(--ab-cyan);">${escapeHtml(x.paymentMethod || 'كاش')}</small></td>
        <td>${escapeHtml(x.date || '')}</td>
        <td style="text-align:center;">
          <button class="btn-cell-tool del" data-action="delete-expense" data-id="${x.id}" title="حذف المصروف">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>
    `).join('');
  }

  // ==========================================================================
  // 19. إدارة الخزينة والكاش وتقفيل اليومية (Treasury & Cash Drawer)
  // ==========================================================================
  function setupTreasury() {
    const openBtn = document.getElementById('openTreasuryModalBtn');
    const sideNavBtn = document.getElementById('sideNavTreasury');
    const menuBtn = document.getElementById('menuTreasury');
    const pillBtn = document.getElementById('openTreasuryPillBtn');
    const openDailyBtn = document.getElementById('openDailyCloseReportBtn');
    const printDailyBtn = document.getElementById('printDailyReportBtn');

    function openTreasury() {
      renderTreasuryModal();
      openModal('treasuryModal');
    }

    if (openBtn) openBtn.addEventListener('click', openTreasury);
    if (sideNavBtn) sideNavBtn.addEventListener('click', openTreasury);
    if (menuBtn) menuBtn.addEventListener('click', openTreasury);
    if (pillBtn) pillBtn.addEventListener('click', openTreasury);

    if (openDailyBtn) {
      openDailyBtn.addEventListener('click', () => {
        renderDailyCloseReport();
        openModal('dailyCloseModal');
      });
    }

    if (printDailyBtn) {
      printDailyBtn.addEventListener('click', () => {
        window.print();
      });
    }
  }

  function renderTreasuryModal() {
    const todayStr = new Date().toISOString().split('T')[0];

    let paidSalesCashTotal = 0;
    let paidPurchasesCashTotal = 0;
    let voucherReceiptCashTotal = 0;
    let voucherPaymentCashTotal = 0;
    let expensesCashTotal = 0;

    let todayIn = 0;
    let todayOut = 0;
    let todayExpenses = 0;

    const logEntries = [];

    // 1. Transactions (مسحوبات / مبيعات)
    appState.items.forEach(it => {
      if (it.isPaid && !it.isReturned) {
        const val = parseFloat(it.totalPrice) || 0;
        paidSalesCashTotal += val;
        const itDate = (it.createdAt || '').slice(0, 10);
        if (itDate === todayStr) {
          todayIn += val;
        }
        logEntries.push({
          date: it.createdAt || it.dateStr,
          timestamp: new Date(it.createdAt || Date.now()).getTime(),
          type: 'sale',
          label: 'إيراد مسحوبات نقدية',
          entity: `${it.itemName} (${it.companyName})`,
          amount: val,
          direction: 'in'
        });
      }
    });

    // 2. Purchases (فواتير مشتريات)
    appState.purchases.forEach(pu => {
      if (!pu.isReturned && (parseFloat(pu.paidAmount) || 0) > 0) {
        const paid = parseFloat(pu.paidAmount) || 0;
        paidPurchasesCashTotal += paid;
        const puDate = pu.invoiceDate || (pu.createdAt || '').slice(0, 10);
        if (puDate === todayStr) {
          todayOut += paid;
        }
        logEntries.push({
          date: pu.createdAt || pu.invoiceDate,
          timestamp: new Date(pu.createdAt || Date.now()).getTime(),
          type: 'purchase',
          label: 'سداد مشتريات بضاعة',
          entity: `فاتورة ${pu.invoiceNumber} (${pu.supplierName})`,
          amount: paid,
          direction: 'out'
        });
      }
    });

    // 3. Vouchers
    (appState.vouchers || []).forEach(v => {
      const amt = parseFloat(v.amount) || 0;
      const isCash = (v.paymentMethod || '').includes('كاش');
      if (isCash) {
        if (v.type === 'receipt') {
          voucherReceiptCashTotal += amt;
          if (v.date === todayStr) todayIn += amt;
          logEntries.push({
            date: v.createdAt || v.date,
            timestamp: new Date(v.createdAt || Date.now()).getTime(),
            type: 'receipt_voucher',
            label: 'سند قبض نقدي',
            entity: `${v.voucherNumber} - ${v.companyName}`,
            amount: amt,
            direction: 'in'
          });
        } else {
          voucherPaymentCashTotal += amt;
          if (v.date === todayStr) todayOut += amt;
          logEntries.push({
            date: v.createdAt || v.date,
            timestamp: new Date(v.createdAt || Date.now()).getTime(),
            type: 'payment_voucher',
            label: 'سند صرف نقدي',
            entity: `${v.voucherNumber} - ${v.companyName}`,
            amount: amt,
            direction: 'out'
          });
        }
      }
    });

    // 4. Expenses
    (appState.expenses || []).forEach(x => {
      const amt = parseFloat(x.amount) || 0;
      const isCash = (x.paymentMethod || '').includes('كاش');
      if (isCash) {
        expensesCashTotal += amt;
        if (x.date === todayStr) {
          todayOut += amt;
          todayExpenses += amt;
        }
        logEntries.push({
          date: x.createdAt || x.date,
          timestamp: new Date(x.createdAt || Date.now()).getTime(),
          type: 'expense',
          label: `مصروف: ${x.category}`,
          entity: x.title,
          amount: amt,
          direction: 'out'
        });
      }
    });

    // 5. POS Sales (مبيعات الكاشير)
    (appState.sales || []).forEach(s => {
      const isCash = !s.paymentMethod || s.paymentMethod.includes('كاش');
      const val = parseFloat(s.grandTotal) || 0;
      if (isCash && val > 0) {
        paidSalesCashTotal += val;
        const sDate = (s.createdAt || '').slice(0, 10);
        if (sDate === todayStr) {
          todayIn += val;
        }
        logEntries.push({
          date: s.createdAt || s.date,
          timestamp: new Date(s.createdAt || Date.now()).getTime(),
          type: 'pos_sale',
          label: 'إيراد مبيعات كاشير POS',
          entity: `${s.invoiceNumber} (${s.customerName || 'عميل نقدي'})`,
          amount: val,
          direction: 'in'
        });
      }
    });

    // 6. Drawer Payouts (صرف نقدية الدرج)
    (appState.payouts || []).forEach(p => {
      const amt = parseFloat(p.amount) || 0;
      if (amt > 0) {
        expensesCashTotal += amt;
        const pDate = (p.createdAt || '').slice(0, 10);
        if (pDate === todayStr) {
          todayOut += amt;
          todayExpenses += amt;
        }
        logEntries.push({
          date: p.createdAt || p.date,
          timestamp: new Date(p.createdAt || Date.now()).getTime(),
          type: 'payout',
          label: `صرف نقدية درج: ${p.category}`,
          entity: `${p.recipient} - ${p.notes}`,
          amount: amt,
          direction: 'out'
        });
      }
    });

    const netCashInDrawer = Math.max(0, (paidSalesCashTotal + voucherReceiptCashTotal) - (paidPurchasesCashTotal + voucherPaymentCashTotal + expensesCashTotal));

    // تحديث كروت الإحصائيات
    const curCashEl = document.getElementById('treasuryCurrentCashVal');
    if (curCashEl) curCashEl.textContent = `${netCashInDrawer.toFixed(2)} ج.م`;

    const tdInEl = document.getElementById('treasuryTodayInVal');
    if (tdInEl) tdInEl.textContent = `+${todayIn.toFixed(2)} ج.م`;

    const tdOutEl = document.getElementById('treasuryTodayOutVal');
    if (tdOutEl) tdOutEl.textContent = `-${todayOut.toFixed(2)} ج.م`;

    const tdExpEl = document.getElementById('treasuryTodayExpensesVal');
    if (tdExpEl) tdExpEl.textContent = `${todayExpenses.toFixed(2)} ج.م`;

    // ترتيب السجل تنازلياً
    logEntries.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    // تعبئة جدول الحركات
    const logTbody = document.getElementById('treasuryLogTableBody');
    if (logTbody) {
      if (logEntries.length === 0) {
        logTbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:1.5rem; color:var(--ab-text-dim);">لا توجد حركات نقدية مسجلة بالخزينة</td></tr>`;
      } else {
        logTbody.innerHTML = logEntries.slice(0, 50).map(entry => {
          const isIn = entry.direction === 'in';
          return `
            <tr>
              <td><small>${formatTimeStr(new Date(entry.timestamp || Date.now()))} - ${(entry.date || '').slice(0, 10)}</small></td>
              <td><span style="font-weight:700; color:${isIn ? '#10b981' : 'var(--ab-unpaid)'};">${isIn ? '🟢 وارد (+)' : '🔴 منصرف (-)'}</span> - ${entry.label}</td>
              <td>${escapeHtml(entry.entity)}</td>
              <td style="font-family:var(--font-latin); font-weight:700; color:#10b981;">${isIn ? `+${Number(entry.amount).toFixed(2)} ج.م` : '-'}</td>
              <td style="font-family:var(--font-latin); font-weight:700; color:var(--ab-unpaid);">${!isIn ? `-${Number(entry.amount).toFixed(2)} ج.م` : '-'}</td>
              <td><small style="color:var(--ab-cyan);">كاش الخزينة والدرج</small></td>
            </tr>
          `;
        }).join('');
      }
    }
  }

  function renderDailyCloseReport() {
    const todayStr = new Date().toISOString().split('T')[0];

    let totalSales = 0;
    let cashSales = 0;
    let creditSales = 0;

    let receiptVouchers = 0;
    let paymentVouchers = 0;
    let expenses = 0;
    let purchases = 0;

    // مبيعات المسحوبات
    appState.items.forEach(it => {
      const itDate = (it.createdAt || '').slice(0, 10);
      if (itDate === todayStr && !it.isReturned) {
        const val = parseFloat(it.totalPrice) || 0;
        totalSales += val;
        if (it.isPaid) cashSales += val;
        else creditSales += val;
      }
    });

    // مبيعات الكاشير POS
    (appState.sales || []).forEach(s => {
      const sDate = (s.createdAt || '').slice(0, 10);
      if (sDate === todayStr) {
        const val = parseFloat(s.grandTotal) || 0;
        totalSales += val;
        if (!s.paymentMethod || s.paymentMethod.includes('كاش')) {
          cashSales += val;
        } else {
          creditSales += val;
        }
      }
    });

    (appState.vouchers || []).forEach(v => {
      if (v.date === todayStr) {
        const amt = parseFloat(v.amount) || 0;
        if (v.type === 'receipt') receiptVouchers += amt;
        else paymentVouchers += amt;
      }
    });

    (appState.expenses || []).forEach(x => {
      if (x.date === todayStr) {
        expenses += (parseFloat(x.amount) || 0);
      }
    });

    // صرف نقدية الدرج
    (appState.payouts || []).forEach(p => {
      const pDate = (p.createdAt || '').slice(0, 10);
      if (pDate === todayStr) {
        expenses += (parseFloat(p.amount) || 0);
      }
    });

    appState.purchases.forEach(pu => {
      const puDate = pu.invoiceDate || (pu.createdAt || '').slice(0, 10);
      if (puDate === todayStr && !pu.isReturned) {
        purchases += (parseFloat(pu.paidAmount) || 0);
      }
    });

    let totalCashDrawer = 0;
    appState.items.forEach(it => { if (it.isPaid && !it.isReturned) totalCashDrawer += (parseFloat(it.totalPrice) || 0); });
    (appState.sales || []).forEach(s => { if (!s.paymentMethod || s.paymentMethod.includes('كاش')) totalCashDrawer += (parseFloat(s.grandTotal) || 0); });
    (appState.vouchers || []).forEach(v => {
      if ((v.paymentMethod || '').includes('كاش')) {
        if (v.type === 'receipt') totalCashDrawer += (parseFloat(v.amount) || 0);
        else totalCashDrawer -= (parseFloat(v.amount) || 0);
      }
    });
    appState.purchases.forEach(pu => { if (!pu.isReturned) totalCashDrawer -= (parseFloat(pu.paidAmount) || 0); });
    (appState.expenses || []).forEach(x => {
      if ((x.paymentMethod || '').includes('كاش')) totalCashDrawer -= (parseFloat(x.amount) || 0);
    });
    (appState.payouts || []).forEach(p => {
      totalCashDrawer -= (parseFloat(p.amount) || 0);
    });

    document.getElementById('reportCloseDateText').textContent = `التاريخ: ${formatDateStr(new Date())}`;
    document.getElementById('reportCloseUserText').textContent = `المستخدم: ${appState.currentUser ? appState.currentUser.username : 'admin'}`;
    document.getElementById('repTotalSales').textContent = `${totalSales.toFixed(2)} ج.م`;
    document.getElementById('repCashSales').textContent = `${cashSales.toFixed(2)} ج.م`;
    document.getElementById('repCreditSales').textContent = `${creditSales.toFixed(2)} ج.م`;
    document.getElementById('repReceiptVouchers').textContent = `${receiptVouchers.toFixed(2)} ج.م`;
    document.getElementById('repPaymentVouchers').textContent = `${paymentVouchers.toFixed(2)} ج.م`;
    document.getElementById('repExpenses').textContent = `${expenses.toFixed(2)} ج.م`;
    document.getElementById('repPurchases').textContent = `${purchases.toFixed(2)} ج.م`;
    document.getElementById('repFinalDrawerCash').textContent = `${totalCashDrawer.toFixed(2)} ج.م`;
  }

  // ==========================================================================
  // 20. نظام المخزن وإدارة الأصناف وجرد النواقص (Inventory Management)
  // ==========================================================================
  function setupProductsInventory() {
    const openBtn = document.getElementById('openProductsModalBtn');
    const sideNavBtn = document.getElementById('sideNavProducts');
    const menuBtn = document.getElementById('menuProducts');
    const form = document.getElementById('productForm');
    const searchInp = document.getElementById('prodSearchInput');
    const catFilter = document.getElementById('prodCategoryFilter');
    const cancelEditBtn = document.getElementById('cancelEditProdBtn');

    function openProducts() {
      resetProductForm();
      renderProductsTable();
      openModal('productsModal');
    }

    if (openBtn) openBtn.addEventListener('click', openProducts);
    if (sideNavBtn) sideNavBtn.addEventListener('click', openProducts);
    if (menuBtn) menuBtn.addEventListener('click', openProducts);

    function resetProductForm() {
      if (form) form.reset();
      document.getElementById('editProductId').value = '';
      document.getElementById('productFormTitle').textContent = '+ إضافة صنف جديد للمخزن:';
      document.getElementById('saveProdSubmitBtn').innerHTML = '<i class="fa-solid fa-save"></i> حفظ الصنف في المخزن';
      if (cancelEditBtn) cancelEditBtn.style.display = 'none';
      const codeInp = document.getElementById('prodCodeInput');
      if (codeInp) codeInp.value = String(getNextProductCode());
    }

    if (cancelEditBtn) {
      cancelEditBtn.addEventListener('click', resetProductForm);
    }

    if (searchInp) {
      searchInp.addEventListener('input', () => {
        renderProductsTable(searchInp.value.trim().toLowerCase(), catFilter ? catFilter.value : 'ALL');
      });
    }

    if (catFilter) {
      catFilter.addEventListener('change', () => {
        renderProductsTable(searchInp ? searchInp.value.trim().toLowerCase() : '', catFilter.value);
      });
    }

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const editId = document.getElementById('editProductId').value;
        const code = document.getElementById('prodCodeInput').value.trim();
        const name = document.getElementById('prodNameInput').value.trim();
        const category = document.getElementById('prodCategorySelect').value;
        const unit = document.getElementById('prodUnitSelect').value;
        const costPrice = parseFloat(document.getElementById('prodBuyPriceInput').value) || 0;
        const salePrice = parseFloat(document.getElementById('prodSellPriceInput').value) || 0;
        const stock = parseFloat(document.getElementById('prodQuantityInput').value) || 0;
        const minStock = parseFloat(document.getElementById('prodMinStockInput').value) || 3;

        if (editId) {
          const idx = (appState.products || []).findIndex(p => p.id === editId);
          if (idx !== -1) {
            const updated = {
              ...appState.products[idx],
              code,
              name,
              category,
              unit,
              costPrice,
              salePrice,
              stock,
              minStock,
              updatedAt: new Date().toISOString()
            };
            appState.products[idx] = updated;
            if (window.newTechDB) await window.newTechDB.saveProduct(updated);
            syncLocalStorageCache();
            renderProductsTable();
            renderAll();
            resetProductForm();
            showToast(`✅ تم تحديث الصنف "${name}" بالمخزن بنجاح`);
          }
        } else {
          const newProd = {
            id: 'prod_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            code,
            name,
            category,
            unit,
            costPrice,
            salePrice,
            stock,
            minStock,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          appState.products.push(newProd);
          if (window.newTechDB) await window.newTechDB.saveProduct(newProd);
          syncLocalStorageCache();
          renderProductsTable();
          renderAll();
          resetProductForm();
          playSoundAdd();
          showToast(`✅ تمت إضافة صنف "${name}" إلى المخزن بنجاح`);
        }
      });
    }

    const tbody = document.getElementById('productsTableBody');
    if (tbody) {
      tbody.addEventListener('click', async (e) => {
        const editBtn = e.target.closest('[data-action="edit-product"]');
        if (editBtn) {
          const id = editBtn.getAttribute('data-id');
          const prod = (appState.products || []).find(p => p.id === id);
          if (!prod) return;

          document.getElementById('editProductId').value = prod.id;
          document.getElementById('prodCodeInput').value = prod.code;
          document.getElementById('prodNameInput').value = prod.name;
          document.getElementById('prodCategorySelect').value = prod.category || 'عام';
          document.getElementById('prodUnitSelect').value = prod.unit || 'قطعة';
          document.getElementById('prodBuyPriceInput').value = prod.costPrice;
          document.getElementById('prodSellPriceInput').value = prod.salePrice;
          document.getElementById('prodQuantityInput').value = prod.stock;
          document.getElementById('prodMinStockInput').value = prod.minStock || 3;

          document.getElementById('productFormTitle').textContent = `تعديل صنف بالمخزن: ${prod.name}`;
          document.getElementById('saveProdSubmitBtn').innerHTML = '<i class="fa-solid fa-check"></i> حفظ التعديلات';
          if (cancelEditBtn) cancelEditBtn.style.display = 'inline-block';
          return;
        }

        const delBtn = e.target.closest('[data-action="delete-product"]');
        if (delBtn) {
          const id = delBtn.getAttribute('data-id');
          const prod = (appState.products || []).find(p => p.id === id);
          if (!prod) return;

          if (confirm(`هل أنت متأكد من حذف صنف "${prod.name}" نهائياً من المخزن؟`)) {
            appState.products = (appState.products || []).filter(p => p.id !== id);
            if (window.newTechDB) await window.newTechDB.deleteProduct(id);
            syncLocalStorageCache();
            renderProductsTable();
            renderAll();
            playSoundDelete();
            showToast(`تم حذف الصنف "${prod.name}" من المخزن`);
          }
        }
      });
    }
  }

  function renderProductsTable(query = '', categoryFilter = 'ALL') {
    const tbody = document.getElementById('productsTableBody');
    if (!tbody) return;

    let prods = appState.products || [];
    let totalQty = 0;
    let totalValue = 0;
    let lowStockCount = 0;

    prods.forEach(p => {
      const q = parseFloat(p.stock) || 0;
      const c = parseFloat(p.costPrice) || 0;
      totalQty += q;
      totalValue += (q * c);
      if (q <= (parseFloat(p.minStock) || 3)) {
        lowStockCount += 1;
      }
    });

    const statCountEl = document.getElementById('statProdCount');
    if (statCountEl) statCountEl.textContent = `${prods.length}`;
    const statQtyEl = document.getElementById('statProdTotalQty');
    if (statQtyEl) statQtyEl.textContent = `${totalQty} قطعة`;
    const statValEl = document.getElementById('statProdTotalValue');
    if (statValEl) statValEl.textContent = `${totalValue.toFixed(2)} ج.م`;
    const statLowEl = document.getElementById('statProdLowStockCount');
    if (statLowEl) statLowEl.textContent = `${lowStockCount} صنف`;

    if (categoryFilter === 'LOW_STOCK') {
      prods = prods.filter(p => (parseFloat(p.stock) || 0) <= (parseFloat(p.minStock) || 3));
    } else if (categoryFilter !== 'ALL') {
      prods = prods.filter(p => p.category === categoryFilter);
    }

    if (query) {
      prods = prods.filter(p =>
        (p.name || '').toLowerCase().includes(query) ||
        (p.code || '').toLowerCase().includes(query)
      );
    }

    if (prods.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:1.5rem; color:var(--ab-text-dim);">لا توجد أصناف تطابق البحث في المخزن</td></tr>`;
      return;
    }

    tbody.innerHTML = prods.map(p => {
      const isLow = (parseFloat(p.stock) || 0) <= (parseFloat(p.minStock) || 3);
      const stockBadge = isLow
        ? `<span style="background:rgba(239,68,68,0.2); color:#ef4444; border:1px solid #ef4444; padding:0.2rem 0.5rem; border-radius:4px; font-weight:800;"><i class="fa-solid fa-triangle-exclamation"></i> رصيد قارب على النفاد!</span>`
        : `<span style="color:#10b981; font-weight:700;"><i class="fa-solid fa-check"></i> متوفر</span>`;

      return `
        <tr style="${isLow ? 'background:rgba(239,68,68,0.04);' : ''}">
          <td><code class="cell-code text-ltr">${escapeHtml(p.code)}</code></td>
          <td><strong>${escapeHtml(p.name)}</strong></td>
          <td><small style="color:var(--ab-cyan);">${escapeHtml(p.category || 'عام')}</small></td>
          <td style="font-family:var(--font-latin);">${Number(p.costPrice).toFixed(2)} ج.م</td>
          <td style="font-family:var(--font-latin); font-weight:700; color:var(--ab-cyan);">${Number(p.salePrice).toFixed(2)} ج.م</td>
          <td style="font-family:var(--font-latin); font-weight:800; font-size:1.05rem; text-align:center; color:${isLow ? '#ef4444' : '#10b981'};">${p.stock} ${escapeHtml(p.unit || 'قطعة')}</td>
          <td>${stockBadge}</td>
          <td style="text-align:center;">
            <div class="table-actions-cell">
              <button class="btn-cell-tool" data-action="edit-product" data-id="${p.id}" title="تعديل الصنف">
                <i class="fa-solid fa-pen-to-square"></i>
              </button>
              <button class="btn-cell-tool del" data-action="delete-product" data-id="${p.id}" title="حذف الصنف">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // ==========================================================================
  // 21. شاشة التبديل بين الكاشير (POS) وسجل المسحوبات المركزي
  // ==========================================================================
  function setupViewSwitcher() {
    const btnSwitchPOS = document.getElementById('btnSwitchToPOS');
    const btnSwitchReg = document.getElementById('btnSwitchToRegister');
    const menuPOS = document.getElementById('menuPOS');
    const menuRegister = document.getElementById('menuRegister');
    const posContainer = document.getElementById('posViewContainer');
    const classicView = document.getElementById('classicTableView');

    function switchToPOS() {
      appState.activeView = 'POS';
      if (posContainer) posContainer.style.display = 'flex';
      if (classicView) classicView.style.display = 'none';
      if (btnSwitchPOS) btnSwitchPOS.classList.add('active');
      if (btnSwitchReg) btnSwitchReg.classList.remove('active');
      renderPOSCatalog();
      renderPOSCart();
      const scanInp = document.getElementById('posBarcodeScanInput');
      if (scanInp) scanInp.focus();
    }

    function switchToRegister() {
      appState.activeView = 'REGISTER';
      if (posContainer) posContainer.style.display = 'none';
      if (classicView) classicView.style.display = 'flex';
      if (btnSwitchReg) btnSwitchReg.classList.add('active');
      if (btnSwitchPOS) btnSwitchPOS.classList.remove('active');
      renderStructuredTableRows();
      updateMetricsAndBadges();
    }

    if (btnSwitchPOS) btnSwitchPOS.addEventListener('click', switchToPOS);
    if (btnSwitchReg) btnSwitchReg.addEventListener('click', switchToRegister);
    if (menuPOS) menuPOS.addEventListener('click', switchToPOS);
    if (menuRegister) menuRegister.addEventListener('click', switchToRegister);

    // الوضع الافتراضي للواجهة الرئيسية: نقطة البيع POS
    switchToPOS();
  }

  // ==========================================================================
  // 22. نقطة البيع السحابية والكاشير (POS System Engine)
  // ==========================================================================
  function setupPOS() {
    const scanInput = document.getElementById('posBarcodeScanInput');
    const quickAddBtn = document.getElementById('btnPosQuickAdd');
    const discountInput = document.getElementById('posDiscountInput');
    const paidInput = document.getElementById('posPaidInput');
    const checkoutBtn = document.getElementById('posCheckoutBtn');
    const clearCartBtn = document.getElementById('posClearCartBtn');

    // تصفية الكاتالوج بحسب الأقسام
    document.querySelectorAll('.pos-cat-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.pos-cat-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        appState.posCategory = pill.getAttribute('data-cat') || 'ALL';
        renderPOSCatalog();
      });
    });

    // مسح الباركود أو الكود الرقمي أو البحث الفوري
    if (scanInput) {
      scanInput.addEventListener('input', (e) => {
        appState.posSearch = e.target.value.trim().toLowerCase();
        renderPOSCatalog();
      });

      scanInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const query = scanInput.value.trim();
          if (!query) return;

          // البحث أولاً بالكود الدقيق (سواء رقم أو كود)
          let match = (appState.products || []).find(p => String(p.code).trim().toLowerCase() === query.toLowerCase());
          if (!match) {
            match = (appState.products || []).find(p => (p.name || '').toLowerCase().includes(query.toLowerCase()));
          }

          if (match) {
            addToCart(match);
            scanInput.value = '';
            appState.posSearch = '';
            renderPOSCatalog();
          } else {
            showToast(`⚠️ لم يتم العثور على صنف بالرمز أو الاسم (${query})`);
          }
        }
      });
    }

    // زر إضافة صنف حر سريع للسلة مباشرة
    if (quickAddBtn) {
      quickAddBtn.addEventListener('click', () => {
        const name = prompt('أدخل اسم الصنف أو الخدمة السريعة:');
        if (!name) return;
        const priceStr = prompt('أدخل سعر البيع (ج.م):', '50');
        const price = parseFloat(priceStr) || 0;
        if (price <= 0) return;

        const quickItem = {
          id: 'quick_' + Date.now(),
          code: String(Math.floor(100 + Math.random() * 900)),
          name: name.trim(),
          category: 'عام',
          costPrice: 0,
          salePrice: price,
          stock: 999
        };
        addToCart(quickItem);
      });
    }

    // تعديل الخصم والمدفوع
    if (discountInput) {
      discountInput.addEventListener('input', recalcPOSCartTotals);
    }
    if (paidInput) {
      paidInput.addEventListener('input', recalcPOSCartTotals);
    }

    // تفريغ الفاتورة
    if (clearCartBtn) {
      clearCartBtn.addEventListener('click', () => {
        if (appState.posCart.length === 0) return;
        if (confirm('هل أنت متأكد من إلغاء الفاتورة الحالية وتفريغ السلة؟')) {
          appState.posCart = [];
          appState.activeCartItemId = null;
          appState.posInlinePending = false;
          renderPOSCart();
          playSoundUnpay();
          showToast('تم تفريغ الفاتورة');
        }
      });
    }

    // إتمام البيع
    if (checkoutBtn) {
      checkoutBtn.addEventListener('click', checkoutPOS);
    }

    // ربط نقر شريط الاختصارات السريعة أسفل السلة
    const shortcutF12 = document.getElementById('shortcutF12Btn');
    if (shortcutF12) shortcutF12.addEventListener('click', startPosInlineCodeEntry);

    const shortcutF5 = document.getElementById('shortcutF5Btn');
    if (shortcutF5) shortcutF5.addEventListener('click', () => openProductDetailsModal());

    const shortcutF4 = document.getElementById('shortcutF4Btn');
    if (shortcutF4) shortcutF4.addEventListener('click', () => openProductCostModal());

    const shortcutF2 = document.getElementById('shortcutF2Btn');
    if (shortcutF2) shortcutF2.addEventListener('click', () => openProductSalesHistoryModal());

    const shortcutCtrlDel = document.getElementById('shortcutCtrlDelBtn');
    if (shortcutCtrlDel) shortcutCtrlDel.addEventListener('click', deleteActiveOrLastCartItem);

    const shortcutCtrlF10 = document.getElementById('shortcutCtrlF10Btn');
    if (shortcutCtrlF10) shortcutCtrlF10.addEventListener('click', checkoutPOS);

    // ربط الأزرار التفاعلية داخل بطاقة الصنف الشاملة F5
    const detailSalesBtn = document.getElementById('detailOpenSalesHistoryBtn');
    if (detailSalesBtn) {
      detailSalesBtn.addEventListener('click', () => {
        const prod = appState.currentInspectedProduct;
        closeModal('productDetailsModal');
        openProductSalesHistoryModal(prod);
      });
    }

    const detailCostBtn = document.getElementById('detailOpenCostBtn');
    if (detailCostBtn) {
      detailCostBtn.addEventListener('click', () => {
        const prod = appState.currentInspectedProduct;
        closeModal('productDetailsModal');
        openProductCostModal(prod);
      });
    }

    // أحداث السلة (تحديد الصنف النشط، زيادة، نقص، حذف)
    const cartTbody = document.getElementById('posCartTableBody');
    if (cartTbody) {
      cartTbody.addEventListener('click', (e) => {
        const incBtn = e.target.closest('[data-cart-action="inc"]');
        const decBtn = e.target.closest('[data-cart-action="dec"]');
        const delBtn = e.target.closest('[data-cart-action="del"]');
        const row = e.target.closest('tr[data-cart-row-id]');

        if (incBtn) {
          const id = incBtn.getAttribute('data-id');
          const item = appState.posCart.find(i => i.id === id);
          if (item) {
            item.qty += 1;
            appState.activeCartItemId = item.id;
            renderPOSCart();
            playSoundAdd();
          }
          return;
        }

        if (decBtn) {
          const id = decBtn.getAttribute('data-id');
          const item = appState.posCart.find(i => i.id === id);
          if (item) {
            if (item.qty > 1) {
              item.qty -= 1;
              appState.activeCartItemId = item.id;
            } else {
              appState.posCart = appState.posCart.filter(i => i.id !== id);
              if (appState.activeCartItemId === id) appState.activeCartItemId = null;
            }
            renderPOSCart();
            playSoundUnpay();
          }
          return;
        }

        if (delBtn) {
          const id = delBtn.getAttribute('data-id');
          appState.posCart = appState.posCart.filter(i => i.id !== id);
          if (appState.activeCartItemId === id) appState.activeCartItemId = null;
          renderPOSCart();
          playSoundDelete();
          return;
        }

        if (row) {
          const rowId = row.getAttribute('data-cart-row-id');
          if (rowId) {
            appState.activeCartItemId = rowId;
            // تحديث تمييز السطر النشط
            cartTbody.querySelectorAll('tr[data-cart-row-id]').forEach(tr => {
              tr.classList.toggle('is-active-row', tr.getAttribute('data-cart-row-id') === rowId);
            });
          }
        }
      });
    }

    // ربط الأزرار السريعة لفتح النوافذ من شاشة POS
    const posOpenPayoutBtn = document.getElementById('posOpenPayoutBtn');
    if (posOpenPayoutBtn) posOpenPayoutBtn.addEventListener('click', () => openModal('drawerPayoutModal'));

    const posOpenStockBtn = document.getElementById('posOpenStockBtn');
    if (posOpenStockBtn) posOpenStockBtn.addEventListener('click', () => { renderStockAuditSheet(); openModal('stocktakingModal'); });

    const posSalesHistoryBtn = document.getElementById('posSalesHistoryBtn');
    if (posSalesHistoryBtn) posSalesHistoryBtn.addEventListener('click', () => { renderSalesHistoryTable(); openModal('salesHistoryModal'); });
  }

  function addToCart(prod) {
    const existing = appState.posCart.find(i => i.productId === prod.id || (i.code && String(i.code) === String(prod.code) && i.name === prod.name));
    if (existing) {
      existing.qty += 1;
      appState.activeCartItemId = existing.id;
    } else {
      const newItem = {
        id: 'cart_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5),
        productId: prod.id,
        code: prod.code || '',
        name: prod.name,
        category: prod.category || 'عام',
        costPrice: Number(prod.costPrice) || 0,
        salePrice: Number(prod.salePrice) || Number(prod.costPrice) || 0,
        qty: 1
      };
      appState.posCart.push(newItem);
      appState.activeCartItemId = newItem.id;
    }
    renderPOSCart();
    playSoundAdd();
  }

  function startPosInlineCodeEntry() {
    appState.posInlinePending = true;
    renderPOSCart();
    setTimeout(() => {
      const inp = document.getElementById('posInlineCodeInput');
      if (inp) {
        inp.focus();
        inp.select();
      }
    }, 40);
  }

  function getActiveOrQueriedProduct() {
    let prod = null;
    if (appState.activeCartItemId) {
      const cItem = (appState.posCart || []).find(i => i.id === appState.activeCartItemId);
      if (cItem) {
        prod = (appState.products || []).find(p => p.id === cItem.productId || (p.code && String(p.code) === String(cItem.code)));
        if (!prod) {
          prod = {
            id: cItem.productId || cItem.id,
            name: cItem.name,
            code: cItem.code,
            category: cItem.category,
            costPrice: cItem.costPrice,
            salePrice: cItem.salePrice,
            stock: 'غير محدد'
          };
        }
      }
    }

    if (!prod && appState.posCart && appState.posCart.length > 0) {
      const cItem = appState.posCart[appState.posCart.length - 1];
      appState.activeCartItemId = cItem.id;
      prod = (appState.products || []).find(p => p.id === cItem.productId || (p.code && String(p.code) === String(cItem.code)));
      if (!prod) {
        prod = {
          id: cItem.productId || cItem.id,
          name: cItem.name,
          code: cItem.code,
          category: cItem.category,
          costPrice: cItem.costPrice,
          salePrice: cItem.salePrice,
          stock: 'غير محدد'
        };
      }
    }

    if (!prod) {
      const scanInp = document.getElementById('posBarcodeScanInput');
      const q = scanInp ? scanInp.value.trim() : '';
      if (q) {
        prod = (appState.products || []).find(p => String(p.code).trim().toLowerCase() === q.toLowerCase() || (p.name || '').toLowerCase().includes(q.toLowerCase()));
      }
    }

    if (!prod) {
      const code = prompt('يرجى كتابة كود الصنف الرقمي للاستعلام:');
      if (code) {
        prod = (appState.products || []).find(p => String(p.code).trim() === code.trim());
        if (!prod) {
          alert(`عذراً، لا يوجد صنف في المخزن يحمل الكود رقم (${code})`);
          return null;
        }
      }
    }

    return prod;
  }

  function openProductDetailsModal(prod) {
    if (!prod) prod = getActiveOrQueriedProduct();
    if (!prod) return;

    appState.currentInspectedProduct = prod;
    const nameEl = document.getElementById('detailProdName');
    const codeEl = document.getElementById('detailProdCode');
    const catEl = document.getElementById('detailProdCategoryBadge');
    const costEl = document.getElementById('detailProdCostPrice');
    const saleEl = document.getElementById('detailProdSalePrice');
    const profitEl = document.getElementById('detailProdProfit');
    const stockEl = document.getElementById('detailProdStock');
    const supEl = document.getElementById('detailProdSupplier');
    const dateEl = document.getElementById('detailProdCreatedAt');
    const notesEl = document.getElementById('detailProdNotes');

    if (nameEl) nameEl.textContent = prod.name;
    if (codeEl) codeEl.textContent = '#' + (prod.code || '-');
    if (catEl) catEl.textContent = prod.category || 'عام';

    const cost = parseFloat(prod.costPrice) || 0;
    const sale = parseFloat(prod.salePrice || prod.costPrice) || 0;
    const profit = sale - cost;
    const profitPct = cost > 0 ? ((profit / cost) * 100).toFixed(1) : '100';

    if (costEl) costEl.textContent = `${cost.toFixed(2)} ج.م`;
    if (saleEl) saleEl.textContent = `${sale.toFixed(2)} ج.م`;
    if (profitEl) profitEl.textContent = `${profit >= 0 ? '+' : ''}${profit.toFixed(2)} ج.م (${profitPct}%)`;
    if (stockEl) stockEl.textContent = `${prod.stock || 0} قطعة`;
    if (supEl) supEl.textContent = prod.supplier || 'المورد الرئيسي';
    if (dateEl) dateEl.textContent = prod.createdAt ? formatDateStr(new Date(prod.createdAt)) : '--';
    if (notesEl) notesEl.textContent = prod.notes || 'لا توجد ملاحظات مسجلة';

    openModal('productDetailsModal');
  }

  function openProductCostModal(prod) {
    if (!prod) prod = getActiveOrQueriedProduct();
    if (!prod) return;

    appState.currentInspectedProduct = prod;
    const nameEl = document.getElementById('costModalProdName');
    const codeEl = document.getElementById('costModalProdCode');
    const costEl = document.getElementById('costModalCostPrice');
    const saleEl = document.getElementById('costModalSalePrice');
    const profitEl = document.getElementById('costModalNetProfit');

    if (nameEl) nameEl.textContent = prod.name;
    if (codeEl) codeEl.textContent = '#' + (prod.code || '-');

    const cost = parseFloat(prod.costPrice) || 0;
    const sale = parseFloat(prod.salePrice || prod.costPrice) || 0;
    const profit = sale - cost;
    const profitPct = cost > 0 ? ((profit / cost) * 100).toFixed(1) : '100';

    if (costEl) costEl.textContent = `${cost.toFixed(2)} ج.م`;
    if (saleEl) saleEl.textContent = `${sale.toFixed(2)} ج.م`;
    if (profitEl) profitEl.textContent = `${profit >= 0 ? '+' : ''}${profit.toFixed(2)} ج.م (${profitPct}%)`;

    openModal('productCostModal');
  }

  function openProductSalesHistoryModal(prod) {
    if (!prod) prod = getActiveOrQueriedProduct();
    if (!prod) return;

    appState.currentInspectedProduct = prod;
    const titleEl = document.getElementById('prodHistModalTitle');
    const codeEl = document.getElementById('prodHistModalCode');
    const qtyEl = document.getElementById('prodHistTotalQtySold');
    const revEl = document.getElementById('prodHistTotalRevenue');
    const tbody = document.getElementById('productSalesHistoryTableBody');

    if (titleEl) titleEl.textContent = `سجل مبيعات الصنف: ${prod.name}`;
    if (codeEl) codeEl.textContent = `كود: #${prod.code}`;

    let totalQty = 0;
    let totalRevenue = 0;
    let rowsHtml = '';
    let rowIdx = 1;

    (appState.sales || []).forEach(sale => {
      const matched = (sale.items || []).filter(it => 
        it.productId === prod.id || 
        (it.code && String(it.code) === String(prod.code)) || 
        it.name === prod.name
      );

      matched.forEach(it => {
        const lineTotal = (it.qty || 1) * (parseFloat(it.salePrice) || 0);
        totalQty += (it.qty || 1);
        totalRevenue += lineTotal;

        rowsHtml += `
          <tr>
            <td style="text-align:center;">${rowIdx++}</td>
            <td><code class="cell-code text-ltr">${escapeHtml(sale.invoiceNumber)}</code></td>
            <td><small>${escapeHtml(sale.date)} ${escapeHtml(sale.time)}</small></td>
            <td><strong>${escapeHtml(sale.customerName || 'عميل نقدي')}</strong></td>
            <td style="text-align:center; font-weight:800; color:#38bdf8;">${it.qty || 1}</td>
            <td style="text-align:center; font-family:var(--font-latin);">${Number(it.salePrice).toFixed(2)}</td>
            <td style="font-weight:800; color:#10b981; font-family:var(--font-latin);">${lineTotal.toFixed(2)} ج.م</td>
            <td><small style="color:var(--ab-cyan);">${escapeHtml(sale.paymentMethod || 'كاش')}</small></td>
            <td><small>${escapeHtml(sale.userName || 'admin')}</small></td>
          </tr>
        `;
      });
    });

    if (qtyEl) qtyEl.textContent = `${totalQty} قطعة`;
    if (revEl) revEl.textContent = `${totalRevenue.toFixed(2)} ج.م`;

    if (tbody) {
      if (rowsHtml) {
        tbody.innerHTML = rowsHtml;
      } else {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:2rem; color:var(--ab-text-dim);">لم يتم تسجيل أي عمليات بيع سابقة لهذا الصنف حتى الآن</td></tr>`;
      }
    }

    openModal('productSalesHistoryModal');
  }

  function deleteActiveOrLastCartItem() {
    if (!appState.posCart || appState.posCart.length === 0) {
      showToast('سلة الفاتورة فارغة بالفعل');
      return;
    }

    let removedName = '';
    if (appState.activeCartItemId) {
      const idx = appState.posCart.findIndex(i => i.id === appState.activeCartItemId);
      if (idx !== -1) {
        removedName = appState.posCart[idx].name;
        appState.posCart.splice(idx, 1);
      }
      appState.activeCartItemId = null;
    } else {
      const last = appState.posCart.pop();
      if (last) removedName = last.name;
    }

    renderPOSCart();
    playSoundDelete();
    showToast(`🗑️ تم حذف ${removedName || 'الصنف'} من شاشة البيع`);
  }

  function setupPOSKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // F12: إضافة سطر جديد لمنتج داخل شاشة البيع لكتابة الكود
      if (e.key === 'F12') {
        e.preventDefault();
        e.stopPropagation();
        startPosInlineCodeEntry();
        return;
      }

      // F5: عرض كل بيانات المنتج من اسمه أو سعره أو تكلفته
      if (e.key === 'F5') {
        e.preventDefault();
        e.stopPropagation();
        openProductDetailsModal();
        return;
      }

      // F4: عرض تكلفتي للمنتج
      if (e.key === 'F4') {
        e.preventDefault();
        e.stopPropagation();
        openProductCostModal();
        return;
      }

      // F2: عرض كل عمليات البيع الخاصة بالمنتج بالتاريخ والوقت
      if (e.key === 'F2') {
        e.preventDefault();
        e.stopPropagation();
        openProductSalesHistoryModal();
        return;
      }

      // Ctrl + Delete: حذف منتج من شاشة البيع
      if (e.ctrlKey && (e.key === 'Delete' || e.code === 'Delete')) {
        e.preventDefault();
        e.stopPropagation();
        deleteActiveOrLastCartItem();
        return;
      }

      // Ctrl + F10: حفظ الفاتورة وإتمام البيع والطباعة
      if (e.ctrlKey && e.key === 'F10') {
        e.preventDefault();
        e.stopPropagation();
        checkoutPOS();
        return;
      }
    }, true);
  }

  function renderPOSCart() {
    const tbody = document.getElementById('posCartTableBody');
    const numDisplay = document.getElementById('posInvoiceNumDisplay');
    const dateDisplay = document.getElementById('posInvoiceDateDisplay');

    if (numDisplay && !numDisplay.hasAttribute('data-active-num')) {
      const invNum = 'INV-' + Math.floor(1000 + Math.random() * 9000);
      numDisplay.setAttribute('data-active-num', invNum);
      numDisplay.textContent = `فاتورة مبيعات #${invNum}`;
    }

    if (dateDisplay) {
      dateDisplay.textContent = `${formatDateStr(new Date())} - ${formatTimeStr(new Date())}`;
    }

    if (!tbody) return;

    if (appState.posCart.length === 0 && !appState.posInlinePending) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align:center; padding:2.5rem 1rem; color:var(--ab-text-dim);">
            <i class="fa-solid fa-cart-shopping" style="font-size:2rem; display:block; margin-bottom:0.5rem; opacity:0.3;"></i>
            الفاتورة فارغة.. اضغط <kbd style="color:var(--ab-cyan);">F12</kbd> لكتابة كود الصنف أو انقر على صنف من القائمة
          </td>
        </tr>
      `;
      recalcPOSCartTotals();
      return;
    }

    // تعيين الصنف النشط الافتراضي لآخر صنف تمت إضافته إن لم يكن محدداً
    if (!appState.activeCartItemId && appState.posCart.length > 0) {
      appState.activeCartItemId = appState.posCart[appState.posCart.length - 1].id;
    }

    let rowsHtml = appState.posCart.map(item => {
      const lineTotal = item.qty * item.salePrice;
      const isActive = item.id === appState.activeCartItemId;
      return `
        <tr class="${isActive ? 'is-active-row' : ''}" data-cart-row-id="${item.id}" title="انقر لتحديد الصنف واستخدام الاختصارات">
          <td>
            <div style="font-weight:700; font-size:0.84rem; color:var(--ab-text-main);">${escapeHtml(item.name)}</div>
            <code class="cell-code text-ltr" style="font-size:0.75rem; color:var(--ab-cyan); font-weight:800;">#${escapeHtml(item.code)}</code>
          </td>
          <td style="text-align:center; font-family:var(--font-latin); font-weight:700; color:var(--ab-cyan);">
            ${item.salePrice.toFixed(2)}
          </td>
          <td style="text-align:center;">
            <div class="pos-qty-stepper">
              <button type="button" class="btn-step" data-cart-action="dec" data-id="${item.id}">-</button>
              <span class="qty-num">${item.qty}</span>
              <button type="button" class="btn-step" data-cart-action="inc" data-id="${item.id}">+</button>
            </div>
          </td>
          <td style="text-align:left; font-family:var(--font-latin); font-weight:800; color:#10b981;">
            ${lineTotal.toFixed(2)}
          </td>
          <td style="text-align:center;">
            <button type="button" class="btn-cell-tool del" data-cart-action="del" data-id="${item.id}" title="حذف الصنف (Ctrl + Del)">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');

    // سطر إضافة كود جديد تفاعلي (F12)
    if (appState.posInlinePending) {
      rowsHtml += `
        <tr class="pos-inline-row is-active-row" style="background:rgba(56, 189, 248, 0.09); border:1.5px dashed var(--ab-cyan);">
          <td colspan="2">
            <div style="display:flex; align-items:center; gap:0.4rem;">
              <span style="font-weight:800; color:var(--ab-cyan); font-size:0.8rem; white-space:nowrap;"><i class="fa-solid fa-barcode"></i> كود الصنف:</span>
              <input type="number" id="posInlineCodeInput" class="pos-cart-inline-code" min="1" step="1" placeholder="اكتب كود الصنف (1، 2، ...) واضغط Enter" autofocus style="width:100%;" />
            </div>
          </td>
          <td colspan="3" style="font-size:0.75rem; color:var(--ab-text-dim); vertical-align:middle; text-align:left;">
            اضغط Enter للإضافة، أو Esc للإلغاء
          </td>
        </tr>
      `;
    }

    tbody.innerHTML = rowsHtml;

    // ربط إدخال الكود في السطر الجديد
    const inlineInp = document.getElementById('posInlineCodeInput');
    if (inlineInp) {
      inlineInp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const codeVal = inlineInp.value.trim();
          if (!codeVal) return;

          let match = (appState.products || []).find(p => String(p.code).trim() === codeVal);
          if (!match) {
            match = (appState.products || []).find(p => String(p.code).trim().toLowerCase() === codeVal.toLowerCase());
          }

          if (match) {
            appState.posInlinePending = false;
            addToCart(match);
          } else {
            alert(`⚠️ لا يوجد صنف مسجل في المخزن بالكود رقم (${codeVal})!\nتأكد من رقم الكود أو أضف الصنف عبر كارت المخزن أو فاتورة مشتريات.`);
            inlineInp.select();
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          appState.posInlinePending = false;
          renderPOSCart();
        }
      });
    }

    recalcPOSCartTotals();
  }

  function recalcPOSCartTotals() {
    const subtotalEl = document.getElementById('posSubtotalVal');
    const discInp = document.getElementById('posDiscountInput');
    const grandEl = document.getElementById('posGrandTotalVal');
    const paidInp = document.getElementById('posPaidInput');
    const changeEl = document.getElementById('posChangeVal');

    const subtotal = appState.posCart.reduce((sum, i) => sum + (i.qty * i.salePrice), 0);
    const discount = discInp ? (parseFloat(discInp.value) || 0) : 0;
    const grandTotal = Math.max(0, subtotal - discount);

    if (subtotalEl) subtotalEl.textContent = `${subtotal.toFixed(2)} ج.م`;
    if (grandEl) grandEl.textContent = `${grandTotal.toFixed(2)} ج.م`;

    const paid = paidInp ? (parseFloat(paidInp.value) || 0) : 0;
    const change = Math.max(0, paid - grandTotal);
    if (changeEl) changeEl.textContent = `${change.toFixed(2)} ج.م`;
  }

  async function checkoutPOS() {
    if (appState.posCart.length === 0) {
      alert('الفاتورة فارغة! يرجى إضافة صنف واحد على الأقل للبيع.');
      return;
    }

    const numDisplay = document.getElementById('posInvoiceNumDisplay');
    const invoiceNum = (numDisplay && numDisplay.getAttribute('data-active-num')) ? numDisplay.getAttribute('data-active-num') : ('INV-' + Math.floor(1000 + Math.random() * 9000));
    const customerSelect = document.getElementById('posCustomerSelect');
    const customerName = customerSelect ? (customerSelect.options[customerSelect.selectedIndex].text || 'عميل نقدي') : 'عميل نقدي';
    const methodSelect = document.getElementById('posPaymentMethodSelect');
    const paymentMethod = methodSelect ? methodSelect.value : 'كاش (الخزينة)';
    const discInp = document.getElementById('posDiscountInput');
    const discount = discInp ? (parseFloat(discInp.value) || 0) : 0;
    const paidInp = document.getElementById('posPaidInput');
    const subtotal = appState.posCart.reduce((sum, i) => sum + (i.qty * i.salePrice), 0);
    const grandTotal = Math.max(0, subtotal - discount);
    const paidAmount = paidInp ? (parseFloat(paidInp.value) || grandTotal) : grandTotal;
    const changeAmount = Math.max(0, paidAmount - grandTotal);

    const saleRecord = {
      id: 'pos_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      invoiceNumber: invoiceNum,
      userId: appState.currentUser ? appState.currentUser.id : null,
      userName: appState.currentUser ? (appState.currentUser.fullName || appState.currentUser.username) : 'admin',
      customerName,
      date: formatDateStr(new Date()),
      time: formatTimeStr(new Date()),
      items: [...appState.posCart],
      subtotal,
      discount,
      grandTotal,
      paidAmount,
      changeAmount,
      paymentMethod,
      createdAt: new Date().toISOString()
    };

    // خصم الكميات من رصيد المخزن
    for (const cItem of appState.posCart) {
      const prod = (appState.products || []).find(p => p.id === cItem.productId || (p.code && String(p.code) === String(cItem.code)));
      if (prod) {
        prod.stock = Math.max(0, (parseFloat(prod.stock) || 0) - cItem.qty);
        prod.updatedAt = new Date().toISOString();
        if (window.newTechDB) await window.newTechDB.saveProduct(prod);
      }
    }

    // حفظ الفاتورة في IndexedDB و appState
    appState.sales.unshift(saleRecord);
    if (window.newTechDB) await window.newTechDB.saveSale(saleRecord);

    syncLocalStorageCache();
    playSoundPaid();
    showToast(`✅ تم حفظ الفاتورة ${invoiceNum} بمبلغ ${grandTotal.toFixed(2)} ج.م بنجاح!`);

    // عرض الفاتورة الحرارية للطباعة الفورية
    showThermalReceipt(saleRecord);

    // تصفير سلة المبيعات وتجهيز الفاتورة التالية
    appState.posCart = [];
    if (discInp) discInp.value = 0;
    if (paidInp) paidInp.value = '';
    if (numDisplay) {
      const nextNum = 'INV-' + Math.floor(1000 + Math.random() * 9000);
      numDisplay.setAttribute('data-active-num', nextNum);
      numDisplay.textContent = `فاتورة مبيعات #${nextNum}`;
    }
    renderPOSCart();
    renderPOSCatalog();
    renderProductsTable();
    updateMetricsAndBadges();
  }

  function showThermalReceipt(sale) {
    document.getElementById('receiptInvoiceNum').textContent = `رقم الفاتورة: ${sale.invoiceNumber}`;
    document.getElementById('receiptDate').textContent = `التاريخ: ${sale.date}`;
    document.getElementById('receiptTime').textContent = `الوقت: ${sale.time}`;
    document.getElementById('receiptCustomer').textContent = sale.customerName || 'عميل نقدي';
    document.getElementById('receiptCashier').textContent = sale.userName || 'admin';

    const itemsTbody = document.getElementById('receiptItemsTableBody');
    if (itemsTbody) {
      itemsTbody.innerHTML = (sale.items || []).map(it => `
        <tr style="border-bottom:1px dotted #ccc;">
          <td style="padding:0.25rem 0;">${escapeHtml(it.name)}</td>
          <td style="text-align:center;">${it.qty}</td>
          <td style="text-align:center;">${it.salePrice.toFixed(2)}</td>
          <td style="text-align:left; font-weight:700;">${(it.qty * it.salePrice).toFixed(2)}</td>
        </tr>
      `).join('');
    }

    document.getElementById('receiptSubtotal').textContent = `${sale.subtotal.toFixed(2)} ج.م`;
    const discRow = document.getElementById('receiptDiscountRow');
    if (discRow) {
      discRow.style.display = sale.discount > 0 ? 'flex' : 'none';
      document.getElementById('receiptDiscount').textContent = `${sale.discount.toFixed(2)} ج.م`;
    }
    document.getElementById('receiptGrandTotal').textContent = `${sale.grandTotal.toFixed(2)} ج.م`;
    document.getElementById('receiptPaid').textContent = `${sale.paidAmount.toFixed(2)} ج.م`;
    document.getElementById('receiptChange').textContent = `${sale.changeAmount.toFixed(2)} ج.م`;
    document.getElementById('receiptMethod').textContent = sale.paymentMethod || 'كاش';

    const printBtn = document.getElementById('printReceiptBtn');
    if (printBtn) {
      printBtn.onclick = () => window.print();
    }

    openModal('posReceiptModal');
  }

  // ==========================================================================
  // 23. نظام صرف النقدية المباشر من الدرج (Cash Drawer Payouts)
  // ==========================================================================
  function setupDrawerPayouts() {
    const form = document.getElementById('drawerPayoutForm');
    const openBtn = document.getElementById('openDrawerPayoutModalBtn');
    const menuBtn = document.getElementById('menuPayout');
    const posBtn = document.getElementById('posOpenPayoutBtn');
    const searchInp = document.getElementById('payoutSearchInput');
    const dateInp = document.getElementById('payoutDateInput');
    const tbody = document.getElementById('drawerPayoutsTableBody');

    function openPayoutModal() {
      if (form) form.reset();
      if (dateInp) dateInp.value = new Date().toISOString().split('T')[0];
      const curCash = document.getElementById('drawerPayoutCurrentCashVal');
      const statCash = document.getElementById('statTreasuryCash');
      if (curCash && statCash) curCash.textContent = statCash.textContent;
      renderDrawerPayoutsTable();
      openModal('drawerPayoutModal');
    }

    if (openBtn) openBtn.addEventListener('click', openPayoutModal);
    if (menuBtn) menuBtn.addEventListener('click', openPayoutModal);
    if (posBtn) posBtn.addEventListener('click', openPayoutModal);

    if (searchInp) {
      searchInp.addEventListener('input', () => {
        renderDrawerPayoutsTable(searchInp.value.trim().toLowerCase());
      });
    }

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const amount = parseFloat(document.getElementById('payoutAmountInput').value) || 0;
        const category = document.getElementById('payoutCategorySelect').value;
        const recipient = document.getElementById('payoutRecipientInput').value.trim();
        const date = dateInp ? dateInp.value : new Date().toISOString().split('T')[0];
        const notes = document.getElementById('payoutNotesInput').value.trim();

        if (amount <= 0) {
          alert('يرجى كتابة مبلغ صرف صحيح أكبر من الصفر');
          return;
        }

        const payout = {
          id: 'payout_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
          voucherNumber: 'PO-' + Math.floor(1000 + Math.random() * 9000),
          userId: appState.currentUser ? appState.currentUser.id : null,
          category,
          recipient,
          amount,
          date,
          time: formatTimeStr(new Date()),
          notes,
          createdAt: new Date().toISOString()
        };

        appState.payouts.unshift(payout);
        if (window.newTechDB) await window.newTechDB.savePayout(payout);
        syncLocalStorageCache();

        form.reset();
        if (dateInp) dateInp.value = new Date().toISOString().split('T')[0];
        renderDrawerPayoutsTable();
        updateMetricsAndBadges();
        const curCash = document.getElementById('drawerPayoutCurrentCashVal');
        const statCash = document.getElementById('statTreasuryCash');
        if (curCash && statCash) curCash.textContent = statCash.textContent;

        playSoundDelete();
        showToast(`💸 تم صرف مبلغ ${amount.toFixed(2)} ج.م لصالح (${recipient}) وخصمه من الدرج بنجاح`);
      });
    }

    if (tbody) {
      tbody.addEventListener('click', async (e) => {
        const delBtn = e.target.closest('[data-action="delete-payout"]');
        if (delBtn) {
          const id = delBtn.getAttribute('data-id');
          if (confirm('هل أنت متأكد من حذف إذن الصرف هذا وإعادة المبلغ للدرج؟')) {
            appState.payouts = appState.payouts.filter(p => p.id !== id);
            if (window.newTechDB) await window.newTechDB.deletePayout(id);
            syncLocalStorageCache();
            renderDrawerPayoutsTable();
            updateMetricsAndBadges();
            const curCash = document.getElementById('drawerPayoutCurrentCashVal');
            const statCash = document.getElementById('statTreasuryCash');
            if (curCash && statCash) curCash.textContent = statCash.textContent;
            showToast('تم حذف إذن الصرف وإعادة الرصيد للدرج');
          }
        }
      });
    }
  }

  function renderDrawerPayoutsTable(query = '') {
    const tbody = document.getElementById('drawerPayoutsTableBody');
    if (!tbody) return;

    let payouts = appState.payouts || [];
    if (query) {
      payouts = payouts.filter(p =>
        (p.recipient || '').toLowerCase().includes(query) ||
        (p.category || '').toLowerCase().includes(query) ||
        (p.notes || '').toLowerCase().includes(query) ||
        (p.voucherNumber || '').toLowerCase().includes(query)
      );
    }

    if (payouts.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:1.25rem; color:var(--ab-text-dim);">لا توجد أذونات صرف نقدية مسجلة</td></tr>`;
      return;
    }

    tbody.innerHTML = payouts.map(p => `
      <tr>
        <td><small>${escapeHtml(p.date || '')} ${escapeHtml(p.time || '')}</small></td>
        <td><span style="font-weight:700; color:#f59e0b;">${escapeHtml(p.category)}</span></td>
        <td><strong>${escapeHtml(p.recipient)}</strong></td>
        <td><strong style="color:var(--ab-unpaid); font-family:var(--font-latin);">${Number(p.amount).toFixed(2)} ج.م</strong></td>
        <td style="color:var(--ab-text-muted);">${escapeHtml(p.notes || '-')}</td>
        <td style="text-align:center;">
          <button type="button" class="btn-cell-tool del" data-action="delete-payout" data-id="${p.id}" title="إلغاء وحذف إذن الصرف">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>
    `).join('');
  }

  // ==========================================================================
  // 24. نظام جرد المخزن وطباعة استمارة الجرد الرسمية (Stocktaking & PDF)
  // ==========================================================================
  function setupStocktaking() {
    const openBtn = document.getElementById('openStocktakingModalBtn');
    const menuBtn = document.getElementById('menuStocktake');
    const posBtn = document.getElementById('posOpenStockBtn');
    const printBtn = document.getElementById('printStockAuditBtn');
    const catSelect = document.getElementById('stockFilterCategorySelect');
    const typeSelect = document.getElementById('stockFilterTypeSelect');

    function openStockAudit() {
      populateStockAuditCats();
      renderStockAuditSheet();
      openModal('stocktakingModal');
    }

    if (openBtn) openBtn.addEventListener('click', openStockAudit);
    if (menuBtn) menuBtn.addEventListener('click', openStockAudit);
    if (posBtn) posBtn.addEventListener('click', openStockAudit);

    if (catSelect) catSelect.addEventListener('change', renderStockAuditSheet);
    if (typeSelect) typeSelect.addEventListener('change', renderStockAuditSheet);

    if (printBtn) {
      printBtn.addEventListener('click', () => {
        window.print();
      });
    }
  }

  function populateStockAuditCats() {
    const catSel = document.getElementById('stockFilterCategorySelect');
    if (!catSel) return;
    const currentVal = catSel.value;
    const cats = new Set(['شواحن ومحولات', 'كابلات ووصلات', 'شاشات وقطع غيار', 'هاردات ورامات', 'ملحقات وإكسسوارات', 'صيانة ومستهلكات', 'عام']);
    (appState.products || []).forEach(p => { if (p.category) cats.add(p.category); });

    catSel.innerHTML = '<option value="ALL">جميع الأقسام والتصنيفات</option>' +
      Array.from(cats).map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');

    if (currentVal) catSel.value = currentVal;
  }

  function renderStockAuditSheet() {
    const tbody = document.getElementById('stockAuditTableBody');
    const catSel = document.getElementById('stockFilterCategorySelect');
    const typeSel = document.getElementById('stockFilterTypeSelect');
    const cat = catSel ? catSel.value : 'ALL';
    const type = typeSel ? typeSel.value : 'ALL';

    let prods = appState.products || [];

    if (cat !== 'ALL') {
      prods = prods.filter(p => p.category === cat);
    }

    if (type === 'LOW_STOCK') {
      prods = prods.filter(p => (parseFloat(p.stock) || 0) <= (parseFloat(p.minStock) || 3));
    } else if (type === 'ZERO_STOCK') {
      prods = prods.filter(p => (parseFloat(p.stock) || 0) <= 0);
    }

    let totalPieces = 0;
    let totalCostVal = 0;
    let totalSaleVal = 0;

    prods.forEach(p => {
      const q = parseFloat(p.stock) || 0;
      const c = parseFloat(p.costPrice) || 0;
      const s = parseFloat(p.salePrice) || c;
      totalPieces += q;
      totalCostVal += (q * c);
      totalSaleVal += (q * s);
    });

    // تحديث كروت إحصائيات الجرد
    const cntEl = document.getElementById('repStockItemsCount');
    if (cntEl) cntEl.textContent = `${prods.length}`;
    const pcsEl = document.getElementById('repStockTotalPieces');
    if (pcsEl) pcsEl.textContent = `${totalPieces}`;
    const cValEl = document.getElementById('repStockCostVal');
    if (cValEl) cValEl.textContent = `${totalCostVal.toFixed(2)} ج.م`;
    const sValEl = document.getElementById('repStockSaleVal');
    if (sValEl) sValEl.textContent = `${totalSaleVal.toFixed(2)} ج.م`;

    const dText = document.getElementById('stockAuditDateText');
    if (dText) dText.textContent = `تاريخ الجرد: ${formatDateStr(new Date())}`;
    const uText = document.getElementById('stockAuditUserText');
    if (uText) uText.textContent = `المسؤول: ${appState.currentUser ? (appState.currentUser.fullName || appState.currentUser.username) : 'admin'}`;
    const cText = document.getElementById('stockAuditCatText');
    if (cText) cText.textContent = `القسم: ${cat === 'ALL' ? 'جميع الأقسام' : cat}`;

    if (!tbody) return;

    if (prods.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:1.5rem; color:#666;">لا توجد أصناف مسجلة تطابق محددات الجرد</td></tr>`;
      return;
    }

    tbody.innerHTML = prods.map((p, idx) => {
      const q = parseFloat(p.stock) || 0;
      const c = parseFloat(p.costPrice) || 0;
      const s = parseFloat(p.salePrice) || c;
      const totVal = q * c;

      return `
        <tr style="border-bottom:1px solid #ccc;">
          <td style="padding:0.4rem;">${idx + 1}</td>
          <td style="padding:0.4rem; font-family:monospace; font-weight:700;">${escapeHtml(p.code)}</td>
          <td style="padding:0.4rem; text-align:right; font-weight:700;">${escapeHtml(p.name)}</td>
          <td style="padding:0.4rem;">${escapeHtml(p.category || 'عام')}</td>
          <td style="padding:0.4rem; font-weight:800; font-size:1rem; color:#059669;">${q}</td>
          <td style="padding:0.4rem;">${c.toFixed(2)}</td>
          <td style="padding:0.4rem;">${s.toFixed(2)}</td>
          <td style="padding:0.4rem; font-weight:700;">${totVal.toFixed(2)}</td>
          <td style="padding:0.4rem; background:#fffbe8; min-width:80px;">&nbsp;</td>
          <td style="padding:0.4rem; background:#fffbe8; min-width:80px;">&nbsp;</td>
        </tr>
      `;
    }).join('');
  }

  // ==========================================================================
  // 25. سجل فواتير المبيعات السابقة (Sales History)
  // ==========================================================================
  function setupSalesHistory() {
    const openBtn = document.getElementById('openSalesHistoryModalBtn');
    const posBtn = document.getElementById('posSalesHistoryBtn');
    const searchInp = document.getElementById('salesSearchInput');
    const tbody = document.getElementById('salesHistoryTableBody');

    function openHistory() {
      renderSalesHistoryTable();
      openModal('salesHistoryModal');
    }

    if (openBtn) openBtn.addEventListener('click', openHistory);
    if (posBtn) posBtn.addEventListener('click', openHistory);

    if (searchInp) {
      searchInp.addEventListener('input', () => {
        renderSalesHistoryTable(searchInp.value.trim().toLowerCase());
      });
    }

    if (tbody) {
      tbody.addEventListener('click', (e) => {
        const viewBtn = e.target.closest('[data-action="view-receipt"]');
        if (viewBtn) {
          const id = viewBtn.getAttribute('data-id');
          const sale = (appState.sales || []).find(s => s.id === id);
          if (sale) {
            closeModal('salesHistoryModal');
            showThermalReceipt(sale);
          }
        }
      });
    }
  }

  function renderSalesHistoryTable(query = '') {
    const tbody = document.getElementById('salesHistoryTableBody');
    const tdTotalEl = document.getElementById('salesTodayTotalVal');
    const allTotalEl = document.getElementById('salesAllTotalVal');
    if (!tbody) return;

    let sales = appState.sales || [];
    const todayStr = formatDateStr(new Date());

    let todayTotal = 0;
    let grandTotal = 0;

    sales.forEach(s => {
      const val = parseFloat(s.grandTotal) || 0;
      grandTotal += val;
      if (s.date === todayStr) {
        todayTotal += val;
      }
    });

    if (tdTotalEl) tdTotalEl.textContent = `${todayTotal.toFixed(2)} ج.م`;
    if (allTotalEl) allTotalEl.textContent = `${grandTotal.toFixed(2)} ج.م`;

    if (query) {
      sales = sales.filter(s =>
        (s.invoiceNumber || '').toLowerCase().includes(query) ||
        (s.customerName || '').toLowerCase().includes(query) ||
        (s.paymentMethod || '').toLowerCase().includes(query) ||
        (s.userName || '').toLowerCase().includes(query)
      );
    }

    if (sales.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:1.5rem; color:var(--ab-text-dim);">لا توجد فواتير مبيعات سابقة</td></tr>`;
      return;
    }

    tbody.innerHTML = sales.map(s => `
      <tr>
        <td><code class="cell-code text-ltr">${escapeHtml(s.invoiceNumber)}</code></td>
        <td><strong>${escapeHtml(s.customerName || 'عميل نقدي')}</strong></td>
        <td><small>${escapeHtml(s.date)} ${escapeHtml(s.time)}</small></td>
        <td style="text-align:center; font-weight:700;">${(s.items || []).length} صنف</td>
        <td><strong style="color:#10b981; font-family:var(--font-latin);">${Number(s.grandTotal).toFixed(2)} ج.م</strong></td>
        <td><small style="color:var(--ab-cyan);">${escapeHtml(s.paymentMethod || 'كاش')}</small></td>
        <td style="text-align:center;">
          <button type="button" class="btn-cell-tool" data-action="view-receipt" data-id="${s.id}" title="عرض وطباعة إيصال الفاتورة">
            <i class="fa-solid fa-print"></i>
          </button>
        </td>
      </tr>
    `).join('');
  }

  // ==========================================================================
  // 26. إدارة الموردين وفواتيرهم وأرصدتهم (Suppliers Engine)
  // ==========================================================================
  function setupSuppliersManagement() {
    const openBtn = document.getElementById('openSuppliersModalBtn');
    const menuBtn = document.getElementById('menuSuppliers');
    const form = document.getElementById('supplierForm');
    const searchInp = document.getElementById('suppliersSearchInput');
    const cancelEditBtn = document.getElementById('cancelEditSupplierBtn');
    const tbody = document.getElementById('suppliersTableBody');

    function openSuppliers() {
      resetSupplierForm();
      renderSuppliersTable();
      openModal('suppliersModal');
    }

    if (openBtn) openBtn.addEventListener('click', openSuppliers);
    if (menuBtn) menuBtn.addEventListener('click', openSuppliers);

    if (searchInp) {
      searchInp.addEventListener('input', () => {
        renderSuppliersTable(searchInp.value.trim().toLowerCase());
      });
    }

    function resetSupplierForm() {
      if (form) form.reset();
      const editIdInp = document.getElementById('editSupplierId');
      if (editIdInp) editIdInp.value = '';
      const title = document.getElementById('supplierFormTitle');
      if (title) title.innerHTML = '<i class="fa-solid fa-user-plus"></i> تسجيل مورد جديد تشتري منه:';
      const submitBtn = document.getElementById('saveSupplierSubmitBtn');
      if (submitBtn) submitBtn.innerHTML = '<i class="fa-solid fa-check"></i> حفظ المورد';
      if (cancelEditBtn) cancelEditBtn.style.display = 'none';
    }

    if (cancelEditBtn) {
      cancelEditBtn.addEventListener('click', resetSupplierForm);
    }

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const editId = document.getElementById('editSupplierId').value;
        const name = document.getElementById('supplierNameInput').value.trim();
        const contactPerson = document.getElementById('supplierContactPersonInput').value.trim();
        const phone = document.getElementById('supplierPhoneInput').value.trim();
        const address = document.getElementById('supplierAddressInput').value.trim();
        const category = document.getElementById('supplierCategoryInput').value.trim();
        const openingBalance = parseFloat(document.getElementById('supplierOpeningBalanceInput').value) || 0;
        const balanceType = document.getElementById('supplierBalanceTypeSelect').value;
        const notes = document.getElementById('supplierNotesInput').value.trim();

        if (editId) {
          const sup = (appState.companies || []).find(c => c.id === editId);
          if (sup) {
            sup.name = name;
            sup.arName = name;
            sup.persons = contactPerson ? [contactPerson] : (sup.persons || ['مندوب المورد']);
            sup.phone = phone;
            sup.address = address;
            sup.category = category;
            sup.openingBalance = openingBalance;
            sup.balanceType = balanceType;
            sup.notes = notes;
            sup.updatedAt = new Date().toISOString();
            if (window.newTechDB) await window.newTechDB.saveCompany(sup);
            showToast(`✅ تم تحديث بيانات المورد (${name}) بنجاح!`);
          }
        } else {
          const newSup = {
            id: 'sup_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            name,
            arName: name,
            entityType: 'supplier',
            persons: contactPerson ? [contactPerson] : ['مندوب التوريد'],
            phone,
            address,
            category,
            openingBalance,
            balanceType,
            notes,
            createdAt: new Date().toISOString()
          };
          appState.companies.push(newSup);
          if (window.newTechDB) await window.newTechDB.saveCompany(newSup);
          showToast(`🚚 تمت إضافة المورد (${name}) بنجاح!`);
        }

        syncLocalStorageCache();
        resetSupplierForm();
        renderSuppliersTable();
        renderSidebarCompanies();
        populateSupplierDropdown();
      });
    }

    if (tbody) {
      tbody.addEventListener('click', (e) => {
        const editBtn = e.target.closest('[data-action="edit-supplier"]');
        const delBtn = e.target.closest('[data-action="del-supplier"]');
        const invoiceBtn = e.target.closest('[data-action="new-invoice-supplier"]');
        const stmtBtn = e.target.closest('[data-action="stmt-supplier"]');

        if (editBtn) {
          const id = editBtn.getAttribute('data-id');
          const sup = (appState.companies || []).find(c => c.id === id);
          if (sup) {
            document.getElementById('editSupplierId').value = sup.id;
            document.getElementById('supplierNameInput').value = sup.name || sup.arName || '';
            document.getElementById('supplierContactPersonInput').value = (sup.persons && sup.persons[0]) || '';
            document.getElementById('supplierPhoneInput').value = sup.phone || '';
            document.getElementById('supplierAddressInput').value = sup.address || '';
            document.getElementById('supplierCategoryInput').value = sup.category || '';
            document.getElementById('supplierOpeningBalanceInput').value = sup.openingBalance || 0;
            document.getElementById('supplierBalanceTypeSelect').value = sup.balanceType || 'CREDIT';
            document.getElementById('supplierNotesInput').value = sup.notes || '';

            const title = document.getElementById('supplierFormTitle');
            if (title) title.innerHTML = `<i class="fa-solid fa-pen-to-square"></i> تعديل بيانات المورد: <span style="color:#fff;">${escapeHtml(sup.name)}</span>`;
            const submitBtn = document.getElementById('saveSupplierSubmitBtn');
            if (submitBtn) submitBtn.innerHTML = '<i class="fa-solid fa-save"></i> حفظ التعديلات';
            if (cancelEditBtn) cancelEditBtn.style.display = 'inline-block';
            document.getElementById('supplierNameInput').focus();
          }
          return;
        }

        if (delBtn) {
          const id = delBtn.getAttribute('data-id');
          const sup = (appState.companies || []).find(c => c.id === id);
          if (!sup) return;
          if (confirm(`هل أنت متأكد من حذف المورد (${sup.name})؟`)) {
            appState.companies = appState.companies.filter(c => c.id !== id);
            syncLocalStorageCache();
            if (window.newTechDB && window.newTechDB.deleteCompany) {
              try { window.newTechDB.deleteCompany(id); } catch(err) {}
            }
            renderSuppliersTable();
            renderSidebarCompanies();
            populateSupplierDropdown();
            playSoundDelete();
            showToast(`🗑️ تم حذف المورد (${sup.name})`);
          }
          return;
        }

        if (invoiceBtn) {
          const id = invoiceBtn.getAttribute('data-id');
          closeModal('suppliersModal');
          const compSel = document.getElementById('purchaseSupplierSelect');
          if (compSel) compSel.value = id;
          openModal('newPurchaseModal');
          return;
        }

        if (stmtBtn) {
          const id = stmtBtn.getAttribute('data-id');
          closeModal('suppliersModal');
          const stmtCompSel = document.getElementById('stmtCompanySelect');
          if (stmtCompSel) {
            stmtCompSel.value = id;
            stmtCompSel.dispatchEvent(new Event('change'));
          }
          openModal('statementModal');
          return;
        }
      });
    }
  }

  function renderSuppliersTable(query = '') {
    const tbody = document.getElementById('suppliersTableBody');
    const badge = document.getElementById('suppliersCountBadge');
    if (!tbody) return;

    let suppliers = (appState.companies || []).filter(c => 
      c.entityType === 'supplier' || c.entityType === 'both' || !c.entityType
    );

    if (query) {
      suppliers = suppliers.filter(s =>
        (s.name || '').toLowerCase().includes(query) ||
        (s.arName || '').toLowerCase().includes(query) ||
        ((s.persons && s.persons[0]) || '').toLowerCase().includes(query) ||
        (s.phone || '').toLowerCase().includes(query) ||
        (s.category || '').toLowerCase().includes(query)
      );
    }

    if (badge) badge.textContent = suppliers.length;

    if (suppliers.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2rem; color:var(--ab-text-dim);">لا يوجد موردين مطابقين للبحث. يمكنك تسجيل مورد جديد عبر النموذج أعلاه.</td></tr>`;
      return;
    }

    tbody.innerHTML = suppliers.map(s => {
      const invoices = (appState.purchases || []).filter(inv => inv.companyId === s.id || inv.companyName === s.name);
      const invCount = invoices.length;
      let totalInvoiced = invoices.reduce((sum, inv) => sum + (parseFloat(inv.grandTotal) || 0), 0);
      let totalPaid = invoices.reduce((sum, inv) => sum + (parseFloat(inv.paidAmount) || 0), 0);
      let opening = (parseFloat(s.openingBalance) || 0) * (s.balanceType === 'DEBIT' ? -1 : 1);
      let netBalance = (totalInvoiced - totalPaid) + opening;

      let balanceLabel = '';
      if (netBalance > 0) {
        balanceLabel = `<span style="color:#ef4444; font-weight:800; font-family:var(--font-latin);">${netBalance.toFixed(2)} ج.م (له علينا)</span>`;
      } else if (netBalance < 0) {
        balanceLabel = `<span style="color:#10b981; font-weight:800; font-family:var(--font-latin);">${Math.abs(netBalance).toFixed(2)} ج.م (لنا عنده)</span>`;
      } else {
        balanceLabel = `<span style="color:var(--ab-text-dim);">خالص (0.00)</span>`;
      }

      const repName = (s.persons && s.persons[0]) || '-';
      const phoneStr = s.phone ? `<a href="tel:${s.phone}" style="color:var(--ab-cyan); font-family:var(--font-latin); font-weight:700;">${escapeHtml(s.phone)}</a>` : '-';
      const actStr = (s.category ? `<span class="card-cat-badge" style="font-size:0.7rem; padding:0.1rem 0.4rem; display:inline-block; margin-bottom:0.2rem;">${escapeHtml(s.category)}</span> ` : '') + (s.address ? `<small style="color:var(--ab-text-dim); display:block;">${escapeHtml(s.address)}</small>` : '');

      return `
        <tr>
          <td>
            <strong style="color:#fff; font-size:0.9rem;">${escapeHtml(s.name || s.arName)}</strong>
            ${s.notes ? `<small style="color:var(--ab-text-dim); display:block; font-size:0.72rem;">${escapeHtml(s.notes)}</small>` : ''}
          </td>
          <td>${escapeHtml(repName)}</td>
          <td>${phoneStr}</td>
          <td>${actStr || '-'}</td>
          <td style="text-align:center;">
            <span style="font-family:var(--font-latin); font-weight:800; color:var(--ab-cyan);">${invCount}</span>
            <small style="display:block; font-size:0.7rem; color:var(--ab-text-dim);">${totalInvoiced.toFixed(0)} ج.م</small>
          </td>
          <td>${balanceLabel}</td>
          <td style="text-align:center;">
            <div style="display:flex; justify-content:center; gap:0.25rem;">
              <button type="button" class="btn-cell-tool" data-action="new-invoice-supplier" data-id="${s.id}" title="إنشاء فاتورة شراء جديدة من هذا المورد">
                <i class="fa-solid fa-cart-plus" style="color:var(--ab-cyan);"></i>
              </button>
              <button type="button" class="btn-cell-tool" data-action="stmt-supplier" data-id="${s.id}" title="كشف حساب المورد">
                <i class="fa-solid fa-file-invoice" style="color:#f59e0b;"></i>
              </button>
              <button type="button" class="btn-cell-tool" data-action="edit-supplier" data-id="${s.id}" title="تعديل بيانات المورد">
                <i class="fa-solid fa-pen-to-square"></i>
              </button>
              <button type="button" class="btn-cell-tool del" data-action="del-supplier" data-id="${s.id}" title="حذف المورد">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // ==========================================================================
  // 27. تحديث كافة عناصر الواجهة (Render All)
  // ==========================================================================
  function renderAll() {
    renderStructuredTableRows();
    updateMetricsAndBadges();
    renderSidebarCompanies();
    renderVouchersTable();
    renderExpensesTable();
    renderProductsTable();
    renderPOSCatalog();
    renderPOSCart();
    renderDrawerPayoutsTable();
    renderSuppliersTable();
  }

  // ==========================================================================
  // 28. تهيئة التطبيق عند فتح الصفحة (DOM Ready)
  // ==========================================================================
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      startLiveTime();
      setupModalsDismiss();
      if (window.newTechDB) {
        await window.newTechDB.init();
      }
      await loadData();
      await setupAuth();
      setupFiltersAndSidebar();
      setupAddItemModal();
      setupPurchaseInvoices();
      setupNettingModal();
      setupStatementModal();
      setupCompaniesManagement();
      setupSuppliersManagement();
      setupDatabaseControls();
      setupActions();
      setupVouchers();
      setupExpenses();
      setupTreasury();
      setupProductsInventory();
      setupViewSwitcher();
      setupPOS();
      setupPOSKeyboardShortcuts();
      setupDrawerPayouts();
      setupStocktaking();
      setupSalesHistory();
      renderAll();
    } catch (err) {
      console.error('Fatal initialization error:', err);
    }
  });

})();
