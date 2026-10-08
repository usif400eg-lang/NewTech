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
    CURRENT_USER: 'newtech_active_user_v3',
    CLOUD_CONFIG: 'newtech_cloud_config_v3'
  };

  const ARABIC_DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

  let appState = {
    companies: [],
    items: [],           // المسحوبات / المبيعات
    purchases: [],       // فواتير المشتريات
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
        try {
          var localUsers1 = JSON.parse(localStorage.getItem('newtech_users_v3') || '[]');
          user = localUsers1.find(function(u) { return (u.username || '').toLowerCase() === username.toLowerCase(); }) || null;
        } catch(e1) {}

        if (!user && window.newTechDB) {
          try { user = await window.newTechDB.getUserByUsername(username); } catch(e2) {}
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

        var newUser = {
          id: 'user_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
          username: username.toLowerCase(),
          fullName: fullName,
          passwordHash: password,
          role: 'user',
          createdAt: new Date().toISOString()
        };

        localUsers2.push(newUser);
        localStorage.setItem('newtech_users_v3', JSON.stringify(localUsers2));

        if (window.newTechDB) {
          try { await window.newTechDB.saveUser(newUser); } catch(e4) {}
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
      }
    } catch (e) {
      console.warn('Fallback to LocalStorage cache:', e);
      const savedComp = localStorage.getItem(STORAGE_KEYS.COMPANIES);
      appState.companies = savedComp ? JSON.parse(savedComp) : (window.DEFAULT_COMPANIES || []);
      const savedItems = localStorage.getItem(STORAGE_KEYS.ITEMS);
      appState.items = savedItems ? JSON.parse(savedItems) : [];
      const savedPurch = localStorage.getItem(STORAGE_KEYS.PURCHASES);
      appState.purchases = savedPurch ? JSON.parse(savedPurch) : [];
    }

    syncLocalStorageCache();
  }

  function syncLocalStorageCache() {
    try {
      localStorage.setItem(STORAGE_KEYS.COMPANIES, JSON.stringify(appState.companies));
      localStorage.setItem(STORAGE_KEYS.ITEMS, JSON.stringify(appState.items));
      localStorage.setItem(STORAGE_KEYS.PURCHASES, JSON.stringify(appState.purchases));
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
    if (window.newTechDB) {
      return window.newTechDB.calculateCompanyNetting(companyId, appState.items, appState.purchases);
    }

    // حساب محلي في حالة عدم توفر الكائن
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

    const netBalance = dueFrom - dueTo;
    return {
      dueFromThem: dueFrom,
      dueToThem: dueTo,
      paidByThem: paidFrom,
      paidToThem: paidTo,
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
    appState.purchases.forEach(p => {
      if (!p.isReturned) {
        totalPurchasesRemaining += Number(p.remainingAmount) || 0;
      }
    });

    // تحديث الأرقام العلوية
    const unpaidEl = document.getElementById('statUnpaidAmount');
    if (unpaidEl) unpaidEl.textContent = `${unpaidTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })} ج.م (${unpaidCount} صنف)`;

    const paidEl = document.getElementById('statPaidAmount');
    if (paidEl) paidEl.textContent = `${paidTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })} ج.م (${paidCount} صنف)`;

    const retEl = document.getElementById('statReturnedAmount');
    if (retEl) retEl.textContent = `${returnedTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })} ج.م (${returnedCount} مرتجع)`;

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

        // تجميع البنود
        const rowEls = itemsTbody.querySelectorAll('tr');
        const items = [];
        rowEls.forEach(tr => {
          const name = tr.querySelector('.row-item-name').value.trim();
          const code = tr.querySelector('.row-item-code').value.trim();
          const qty = parseFloat(tr.querySelector('.row-item-qty').value) || 1;
          const price = parseFloat(tr.querySelector('.row-item-price').value) || 0;
          const disc = parseFloat(tr.querySelector('.row-item-discount').value) || 0;
          const finalPrice = Math.max(0, (qty * price) - disc);

          if (name) {
            items.push({
              id: 'pitem_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
              itemName: name,
              itemCode: code,
              quantity: qty,
              unitPrice: price,
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
        syncLocalStorageCache();
        closeModal('newPurchaseModal');
        renderAll();
        playSoundAdd();
        showToast(`✅ تم حفظ فاتورة المشتريات ${invoiceNumber} وتحديث حساب المورد والمقاصة!`);
      });
    }
  }

  // إضافة صف صنف داخل الفاتورة
  function addInvoiceItemRow() {
    const tbody = document.getElementById('purchaseItemsTableBody');
    if (!tbody) return;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" class="row-item-name" placeholder="اسم الصنف المشتَرى..." required></td>
      <td><input type="text" class="row-item-code text-ltr" placeholder="الكود"></td>
      <td><input type="number" class="row-item-qty" value="1" min="1" step="1" style="text-align:center;"></td>
      <td><input type="number" class="row-item-price" placeholder="0.00" min="0" step="0.5" required></td>
      <td><input type="number" class="row-item-discount" value="0" min="0" step="0.5"></td>
      <td><strong class="row-final-price" style="font-family:var(--font-latin); color:var(--ab-cyan);">0.00 ج.م</strong></td>
      <td style="text-align:center;">
        <button type="button" class="btn-cell-tool del remove-row-btn" title="حذف هذا الصنف"><i class="fa-solid fa-xmark"></i></button>
      </td>
    `;

    // ربط الحسابات
    const inputs = tr.querySelectorAll('input');
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

    function openForAdd() {
      form.reset();
      document.getElementById('editItemId').value = '';
      document.getElementById('addItemModalTitle').textContent = 'تسجيل صنف مسحوب جديد';
      const stamp = getFullTimestamp();
      document.getElementById('itemDateTimeText').textContent = stamp.fullText;
      document.getElementById('itemTimestampInput').value = stamp.iso;
      codeInp.value = 'NT-' + Math.floor(100 + Math.random() * 900);
      populateCompanyDropdown();
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
          if (window.newTechDB) await window.newTechDB.saveTransaction(item);
          syncLocalStorageCache();
          renderAll();
          playSoundReturn();
          showToast(`🔄 تم تسجيل صنف "${item.itemName}" كمرتجع (باللون الأصفر)`);
        } else {
          item.isReturned = false;
          item.status = 'UNPAID';
          item.returnedAt = null;
          item.updatedAt = new Date().toISOString();
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
        if (window.newTechDB) await window.newTechDB.savePurchase(purch);
        syncLocalStorageCache();
        renderPurchasesList();
        renderAll();
        playSoundReturn();
        showToast(purch.isReturned ? `🔄 تم تسجيل الفاتورة ${purch.invoiceNumber} كمرتجعة` : `تم إلغاء مرتجع الفاتورة`);
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
  // 17. تحديث كافة عناصر الواجهة (Render All)
  // ==========================================================================
  function renderAll() {
    renderStructuredTableRows();
    updateMetricsAndBadges();
    renderSidebarCompanies();
  }

  // ==========================================================================
  // 18. تهيئة التطبيق عند فتح الصفحة (DOM Ready)
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
      setupDatabaseControls();
      setupActions();
      renderAll();
    } catch (err) {
      console.error('Fatal initialization error:', err);
    }
  });

})();
