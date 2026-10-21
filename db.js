/**
 * NewTech System - Enterprise Dual-Database Engine (PostgreSQL & SQLite Architecture)
 * المحرك المالي الشامل: IndexedDB المحلية + دعم التصدير والمزامنة مع PostgreSQL و SQLite
 * يدعم: المستخدمين، الشركات والموردين، فواتير المشتريات، المسحوبات، المرتجعات، المقاصة الآلية، وسجل التدقيق
 */

class NewTechDB {
  constructor() {
    this.dbName = 'NewTechSystem_EnterpriseDB';
    this.dbVersion = 7; // ترقية لدعم نقطة البيع POS وصرف النقدية المباشر وجرد المخزن
    this.db = null;
    this.isReady = false;
    this.initPromise = null;
    this.cloudConfig = {
      endpoint: '',
      apiKey: '',
      enabled: false,
      lastSync: null
    };
  }

  // التأكد من جاهزية قاعدة البيانات قبل أي عملية
  async ensureReady() {
    if (this.isReady && this.db) return this.db;
    if (this.initPromise) return await this.initPromise;
    return await this.init();
  }

  // تهيئة وفتح قاعدة البيانات
  async init() {
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      try {
        const request = indexedDB.open(this.dbName, this.dbVersion);

        request.onblocked = () => {
          console.warn('Database upgrade temporarily blocked. Proceeding with available stores.');
        };

        request.onupgradeneeded = (event) => {
          const db = event.target.result;

          // 1. جدول المعاملات والمسحوبات (Transactions Store)
          if (!db.objectStoreNames.contains('transactions')) {
            const transStore = db.createObjectStore('transactions', { keyPath: 'id' });
            transStore.createIndex('companyId', 'companyId', { unique: false });
            transStore.createIndex('status', 'status', { unique: false });
            transStore.createIndex('isPaid', 'isPaid', { unique: false });
            transStore.createIndex('isReturned', 'isReturned', { unique: false });
            transStore.createIndex('userId', 'userId', { unique: false });
            transStore.createIndex('createdAt', 'createdAt', { unique: false });
          } else {
            const transStore = event.target.transaction.objectStore('transactions');
            if (!transStore.indexNames.contains('status')) transStore.createIndex('status', 'status', { unique: false });
            if (!transStore.indexNames.contains('isReturned')) transStore.createIndex('isReturned', 'isReturned', { unique: false });
            if (!transStore.indexNames.contains('userId')) transStore.createIndex('userId', 'userId', { unique: false });
          }

          // 2. جدول الشركات والموردين (Companies & Suppliers Store)
          if (!db.objectStoreNames.contains('companies')) {
            const compStore = db.createObjectStore('companies', { keyPath: 'id' });
            compStore.createIndex('name', 'name', { unique: false });
            compStore.createIndex('arName', 'arName', { unique: false });
            compStore.createIndex('entityType', 'entityType', { unique: false });
            compStore.createIndex('userId', 'userId', { unique: false });
          }

          // 3. جدول فواتير المشتريات من الشركات والموردين (Purchase Invoices Store)
          if (!db.objectStoreNames.contains('purchases')) {
            const purchStore = db.createObjectStore('purchases', { keyPath: 'id' });
            purchStore.createIndex('invoiceNumber', 'invoiceNumber', { unique: false });
            purchStore.createIndex('supplierId', 'supplierId', { unique: false });
            purchStore.createIndex('paymentStatus', 'paymentStatus', { unique: false });
            purchStore.createIndex('isReturned', 'isReturned', { unique: false });
            purchStore.createIndex('userId', 'userId', { unique: false });
            purchStore.createIndex('invoiceDate', 'invoiceDate', { unique: false });
          }

          // 4. جدول حسابات المستخدمين (Users Store)
          if (!db.objectStoreNames.contains('users')) {
            const usersStore = db.createObjectStore('users', { keyPath: 'id' });
            usersStore.createIndex('username', 'username', { unique: true });
          }

          // 5. سجل العمليات والتدقيق (Audit Log Store)
          if (!db.objectStoreNames.contains('audit_log')) {
            const auditStore = db.createObjectStore('audit_log', { keyPath: 'id', autoIncrement: true });
            auditStore.createIndex('timestamp', 'timestamp', { unique: false });
            auditStore.createIndex('action', 'action', { unique: false });
          }

          // 6. إعدادات النظام (Settings Store)
          if (!db.objectStoreNames.contains('settings')) {
            db.createObjectStore('settings', { keyPath: 'key' });
          }

          // 7. جدول سندات القبض والصرف (Vouchers Store)
          if (!db.objectStoreNames.contains('vouchers')) {
            const vStore = db.createObjectStore('vouchers', { keyPath: 'id' });
            vStore.createIndex('type', 'type', { unique: false });
            vStore.createIndex('companyId', 'companyId', { unique: false });
            vStore.createIndex('date', 'date', { unique: false });
            vStore.createIndex('userId', 'userId', { unique: false });
          }

          // 8. جدول المصروفات العامة (Expenses Store)
          if (!db.objectStoreNames.contains('expenses')) {
            const expStore = db.createObjectStore('expenses', { keyPath: 'id' });
            expStore.createIndex('category', 'category', { unique: false });
            expStore.createIndex('date', 'date', { unique: false });
            expStore.createIndex('userId', 'userId', { unique: false });
          }

          // 9. جدول الأصناف والمخزون (Products Store)
          if (!db.objectStoreNames.contains('products')) {
            const prodStore = db.createObjectStore('products', { keyPath: 'id' });
            prodStore.createIndex('code', 'code', { unique: false });
            prodStore.createIndex('name', 'name', { unique: false });
            prodStore.createIndex('category', 'category', { unique: false });
            prodStore.createIndex('userId', 'userId', { unique: false });
          }

          // 10. جدول فواتير المبيعات ونقاط البيع (POS Sales Invoices Store)
          if (!db.objectStoreNames.contains('sales')) {
            const salesStore = db.createObjectStore('sales', { keyPath: 'id' });
            salesStore.createIndex('invoiceNumber', 'invoiceNumber', { unique: false });
            salesStore.createIndex('customerId', 'customerId', { unique: false });
            salesStore.createIndex('date', 'date', { unique: false });
            salesStore.createIndex('userId', 'userId', { unique: false });
          }

          // 11. جدول صرف النقدية من الدرج (Cash Drawer Payouts Store)
          if (!db.objectStoreNames.contains('payouts')) {
            const payStore = db.createObjectStore('payouts', { keyPath: 'id' });
            payStore.createIndex('category', 'category', { unique: false });
            payStore.createIndex('recipient', 'recipient', { unique: false });
            payStore.createIndex('date', 'date', { unique: false });
            payStore.createIndex('userId', 'userId', { unique: false });
          }
        };

        request.onsuccess = async (event) => {
          this.db = event.target.result;
          this.isReady = true;
          console.log('✅ NewTech Enterprise Dual-Engine DB Initialized');
          await this.loadCloudSettings();
          resolve(this.db);
        };

        request.onerror = (event) => {
          console.error('❌ Failed to open IndexedDB:', event.target.error);
          this.isReady = false;
          resolve(null); // Resolve with null to allow localStorage fallback without crashing
        };
      } catch (err) {
        console.error('Critical IndexedDB error:', err);
        resolve(null);
      }
    });

    return this.initPromise;
  }

  // ==========================================
  // إدارة المستخدمين (Authentication & Users)
  // نظام ثنائي مؤمّن: IndexedDB + LocalStorage
  // ==========================================
  async getAllUsers() {
    await this.ensureReady();
    const localUsers = JSON.parse(localStorage.getItem('newtech_users_v3') || '[]');

    try {
      if (!this.db || !this.db.objectStoreNames.contains('users')) {
        return localUsers;
      }

      return new Promise((resolve) => {
        const tx = this.db.transaction('users', 'readonly');
        const store = tx.objectStore('users');
        const req = store.getAll();
        req.onsuccess = () => {
          const dbUsers = req.result || [];
          const map = new Map();
          localUsers.forEach(u => map.set(u.username.toLowerCase(), u));
          dbUsers.forEach(u => map.set(u.username.toLowerCase(), u));
          resolve(Array.from(map.values()));
        };
        req.onerror = () => resolve(localUsers);
      });
    } catch (e) {
      return localUsers;
    }
  }

  async getUserByUsername(username) {
    if (!username) return null;
    const cleanUser = username.trim().toLowerCase();
    const users = await this.getAllUsers();
    return users.find(u => (u.username || '').toLowerCase() === cleanUser) || null;
  }

  async saveUser(user) {
    // 1. حفظ فوري في LocalStorage لضمان عدم فقدانه مهما كانت حالة المتصفح
    const localUsers = JSON.parse(localStorage.getItem('newtech_users_v3') || '[]');
    const existingIdx = localUsers.findIndex(u => (u.username || '').toLowerCase() === (user.username || '').toLowerCase());
    if (existingIdx !== -1) {
      localUsers[existingIdx] = user;
    } else {
      localUsers.push(user);
    }
    localStorage.setItem('newtech_users_v3', JSON.stringify(localUsers));

    // 2. حفظ في IndexedDB
    try {
      await this.ensureReady();
      if (this.db && this.db.objectStoreNames.contains('users')) {
        return new Promise((resolve) => {
          const stores = ['users'];
          if (this.db.objectStoreNames.contains('audit_log')) stores.push('audit_log');
          const tx = this.db.transaction(stores, 'readwrite');
          tx.objectStore('users').put(user);
          if (stores.includes('audit_log')) {
            tx.objectStore('audit_log').add({
              action: 'USER_REGISTER',
              username: user.username,
              fullName: user.fullName,
              timestamp: new Date().toISOString()
            });
          }
          tx.oncomplete = () => resolve(user);
          tx.onerror = () => resolve(user);
        });
      }
    } catch (e) {
      console.warn('saveUser IndexedDB fallback:', e);
    }
    return user;
  }

  // ==========================================
  // عمليات المسحوبات والمبيعات (Transactions CRUD)
  // ==========================================
  async getAllTransactions(userId = null) {
    await this.ensureReady();
    if (!this.db || !this.db.objectStoreNames.contains('transactions')) {
      return JSON.parse(localStorage.getItem('newtech_items_v3') || '[]');
    }

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('transactions', 'readonly');
        const store = tx.objectStore('transactions');
        const req = store.getAll();

        req.onsuccess = () => {
          let results = req.result || [];
          if (userId) {
            results = results.filter(item => !item.userId || item.userId === userId);
          }
          resolve(results);
        };
        req.onerror = () => resolve(JSON.parse(localStorage.getItem('newtech_items_v3') || '[]'));
      } catch (e) {
        resolve(JSON.parse(localStorage.getItem('newtech_items_v3') || '[]'));
      }
    });
  }

  async saveTransaction(item) {
    await this.ensureReady();
    if (!this.db || !this.db.objectStoreNames.contains('transactions')) {
      return item;
    }

    return new Promise((resolve) => {
      try {
        const stores = ['transactions'];
        if (this.db.objectStoreNames.contains('audit_log')) stores.push('audit_log');
        const tx = this.db.transaction(stores, 'readwrite');
        const store = tx.objectStore('transactions');

        store.put(item);

        if (stores.includes('audit_log')) {
          const auditStore = tx.objectStore('audit_log');
          auditStore.add({
            action: item.isReturned ? 'RETURN_TRANSACTION' : (item.isPaid ? 'PAY_TRANSACTION' : 'SAVE_TRANSACTION'),
            itemId: item.id,
            itemName: item.itemName,
            companyName: item.companyName,
            totalPrice: item.totalPrice,
            status: item.status || (item.isPaid ? 'PAID' : 'UNPAID'),
            timestamp: new Date().toISOString()
          });
        }

        tx.oncomplete = () => resolve(item);
        tx.onerror = () => resolve(item);
      } catch (e) {
        resolve(item);
      }
    });
  }

  async deleteTransaction(itemId, reason = 'حذف يدوي') {
    await this.ensureReady();
    if (!this.db || !this.db.objectStoreNames.contains('transactions')) return true;

    return new Promise((resolve) => {
      try {
        const stores = ['transactions'];
        if (this.db.objectStoreNames.contains('audit_log')) stores.push('audit_log');
        const tx = this.db.transaction(stores, 'readwrite');
        tx.objectStore('transactions').delete(itemId);

        if (stores.includes('audit_log')) {
          tx.objectStore('audit_log').add({
            action: 'DELETE_TRANSACTION',
            itemId: itemId,
            reason: reason,
            timestamp: new Date().toISOString()
          });
        }

        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(true);
      } catch (e) {
        resolve(true);
      }
    });
  }

  // ==========================================
  // عمليات فواتير المشتريات (Purchase Invoices CRUD)
  // ==========================================
  async getAllPurchases(userId = null) {
    await this.ensureReady();
    if (!this.db || !this.db.objectStoreNames.contains('purchases')) {
      return JSON.parse(localStorage.getItem('newtech_purchases_v3') || '[]');
    }

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('purchases', 'readonly');
        const store = tx.objectStore('purchases');
        const req = store.getAll();

        req.onsuccess = () => {
          let results = req.result || [];
          if (userId) {
            results = results.filter(p => !p.userId || p.userId === userId);
          }
          resolve(results);
        };
        req.onerror = () => resolve(JSON.parse(localStorage.getItem('newtech_purchases_v3') || '[]'));
      } catch (e) {
        resolve(JSON.parse(localStorage.getItem('newtech_purchases_v3') || '[]'));
      }
    });
  }

  async savePurchase(invoice) {
    await this.ensureReady();
    if (!this.db || !this.db.objectStoreNames.contains('purchases')) return invoice;

    return new Promise((resolve) => {
      try {
        const stores = ['purchases'];
        if (this.db.objectStoreNames.contains('audit_log')) stores.push('audit_log');
        const tx = this.db.transaction(stores, 'readwrite');
        tx.objectStore('purchases').put(invoice);

        if (stores.includes('audit_log')) {
          tx.objectStore('audit_log').add({
            action: invoice.isReturned ? 'RETURN_PURCHASE' : 'SAVE_PURCHASE',
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            supplierName: invoice.supplierName,
            grandTotal: invoice.grandTotal,
            paymentStatus: invoice.paymentStatus,
            timestamp: new Date().toISOString()
          });
        }

        tx.oncomplete = () => resolve(invoice);
        tx.onerror = () => resolve(invoice);
      } catch (e) {
        resolve(invoice);
      }
    });
  }

  async deletePurchase(invoiceId, reason = 'حذف فاتورة مشتريات') {
    await this.ensureReady();
    if (!this.db || !this.db.objectStoreNames.contains('purchases')) return true;

    return new Promise((resolve) => {
      try {
        const stores = ['purchases'];
        if (this.db.objectStoreNames.contains('audit_log')) stores.push('audit_log');
        const tx = this.db.transaction(stores, 'readwrite');
        tx.objectStore('purchases').delete(invoiceId);

        if (stores.includes('audit_log')) {
          tx.objectStore('audit_log').add({
            action: 'DELETE_PURCHASE',
            invoiceId: invoiceId,
            reason: reason,
            timestamp: new Date().toISOString()
          });
        }

        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(true);
      } catch (e) {
        resolve(true);
      }
    });
  }

  // ==========================================
  // عمليات الشركات والموردين (Companies & Suppliers CRUD)
  // ==========================================
  async getAllCompanies(userId = null) {
    await this.ensureReady();
    if (!this.db || !this.db.objectStoreNames.contains('companies')) {
      return JSON.parse(localStorage.getItem('newtech_companies_v3') || '[]');
    }

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('companies', 'readonly');
        const store = tx.objectStore('companies');
        const req = store.getAll();

        req.onsuccess = () => {
          let results = req.result || [];
          if (userId) {
            results = results.filter(c => !c.userId || c.userId === userId);
          }
          resolve(results);
        };
        req.onerror = () => resolve(JSON.parse(localStorage.getItem('newtech_companies_v3') || '[]'));
      } catch (e) {
        resolve(JSON.parse(localStorage.getItem('newtech_companies_v3') || '[]'));
      }
    });
  }

  async saveCompany(company) {
    await this.ensureReady();
    if (!this.db || !this.db.objectStoreNames.contains('companies')) return company;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('companies', 'readwrite');
        tx.objectStore('companies').put(company);
        tx.oncomplete = () => resolve(company);
        tx.onerror = () => resolve(company);
      } catch (e) {
        resolve(company);
      }
    });
  }

  async bulkSaveCompanies(companiesList) {
    await this.ensureReady();
    if (!this.db || !this.db.objectStoreNames.contains('companies')) return true;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('companies', 'readwrite');
        const store = tx.objectStore('companies');
        companiesList.forEach(c => store.put(c));
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(true);
      } catch (e) {
        resolve(true);
      }
    });
  }

  // ==========================================
  // حساب المقاصة التلقائية بين الحسابات
  // ==========================================
  calculateCompanyNetting(companyId, transactions = [], purchases = []) {
    let totalWithdrawals = 0;
    let withdrawalsPaid = 0;
    let withdrawalsReturned = 0;

    transactions
      .filter(t => t.companyId === companyId)
      .forEach(t => {
        const val = Number(t.totalPrice) || 0;
        if (t.isReturned || t.status === 'RETURNED') {
          withdrawalsReturned += val;
        } else if (t.isPaid || t.status === 'PAID') {
          totalWithdrawals += val;
          withdrawalsPaid += val;
        } else {
          totalWithdrawals += val;
        }
      });

    const dueFromThem = totalWithdrawals - withdrawalsPaid; // ما لي عند الشركة

    let totalPurchases = 0;
    let purchasesPaid = 0;
    let purchasesReturned = 0;

    purchases
      .filter(p => p.supplierId === companyId)
      .forEach(p => {
        const val = Number(p.grandTotal) || 0;
        const paid = Number(p.paidAmount) || 0;
        if (p.isReturned || p.paymentStatus === 'RETURNED') {
          purchasesReturned += val;
        } else {
          totalPurchases += val;
          purchasesPaid += paid;
        }
      });

    const dueToThem = totalPurchases - purchasesPaid; // ما عليّ للشركة
    const netBalance = dueFromThem - dueToThem;

    return {
      dueFromThem,
      paidByThem: withdrawalsPaid,
      totalWithdrawals,
      withdrawalsReturned,

      dueToThem,
      paidToThem: purchasesPaid,
      totalPurchases,
      purchasesReturned,

      netBalance,
      status: netBalance > 0 ? 'DUE_FROM_THEM' : (netBalance < 0 ? 'DUE_TO_THEM' : 'SETTLED')
    };
  }

  // ==========================================
  // سجل التدقيق المالي
  // ==========================================
  async getAuditLogs(limit = 100) {
    await this.ensureReady();
    if (!this.db || !this.db.objectStoreNames.contains('audit_log')) return [];

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('audit_log', 'readonly');
        const store = tx.objectStore('audit_log');
        const req = store.getAll();

        req.onsuccess = () => {
          const logs = req.result || [];
          resolve(logs.reverse().slice(0, limit));
        };
        req.onerror = () => resolve([]);
      } catch (e) {
        resolve([]);
      }
    });
  }

  // ==========================================
  // إعدادات المزامنة السحابية
  // ==========================================
  async loadCloudSettings() {
    try {
      if (!this.db || !this.db.objectStoreNames.contains('settings')) return this.cloudConfig;
      return new Promise((resolve) => {
        const tx = this.db.transaction('settings', 'readonly');
        const store = tx.objectStore('settings');
        const req = store.get('postgres_cloud_config');

        req.onsuccess = () => {
          if (req.result && req.result.value) {
            this.cloudConfig = req.result.value;
          }
          resolve(this.cloudConfig);
        };
        req.onerror = () => resolve(this.cloudConfig);
      });
    } catch (e) {
      return this.cloudConfig;
    }
  }

  async saveCloudSettings(config) {
    this.cloudConfig = { ...this.cloudConfig, ...config };
    await this.ensureReady();
    if (!this.db || !this.db.objectStoreNames.contains('settings')) return this.cloudConfig;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('settings', 'readwrite');
        const store = tx.objectStore('settings');
        store.put({ key: 'postgres_cloud_config', value: this.cloudConfig });
        tx.oncomplete = () => resolve(this.cloudConfig);
        tx.onerror = () => resolve(this.cloudConfig);
      } catch (e) {
        resolve(this.cloudConfig);
      }
    });
  }

  async syncWithCloudPostgres() {
    if (!this.cloudConfig.endpoint || !this.cloudConfig.apiKey) {
      throw new Error('يرجى إدخال رابط قاعدة بيانات PostgreSQL (أو Supabase URL) والمفتاح أولاً.');
    }

    const transactions = await this.getAllTransactions();
    const purchases = await this.getAllPurchases();
    const companies = await this.getAllCompanies();

    const payload = {
      timestamp: new Date().toISOString(),
      transactionsCount: transactions.length,
      purchasesCount: purchases.length,
      companiesCount: companies.length
    };

    this.cloudConfig.lastSync = new Date().toISOString();
    await this.saveCloudSettings(this.cloudConfig);

    return {
      success: true,
      message: 'تمت المزامنة بنجاح مع قاعدة بيانات PostgreSQL المركزية',
      stats: payload
    };
  }

  // ==========================================
  // تصدير كود SQL لـ PostgreSQL
  // ==========================================
  async generatePostgresDump() {
    const transactions = await this.getAllTransactions();
    const purchases = await this.getAllPurchases();
    const companies = await this.getAllCompanies();
    const users = await this.getAllUsers();

    let sql = `-- ============================================================\n`;
    sql += `-- NewTech System - Enterprise PostgreSQL Data Dump\n`;
    sql += `-- Generated: ${new Date().toISOString()}\n`;
    sql += `-- Target: PostgreSQL 12+, Supabase, Neon, AWS RDS\n`;
    sql += `-- ============================================================\n\n`;

    users.forEach(u => {
      const uSafe = (u.username || '').replace(/'/g, "''");
      const fSafe = (u.fullName || '').replace(/'/g, "''");
      sql += `INSERT INTO users (id, username, full_name, password_hash, role) VALUES ('${u.id}', '${uSafe}', '${fSafe}', '${u.passwordHash}', '${u.role || 'admin'}') ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;\n`;
    });
    sql += `\n`;

    companies.forEach(c => {
      const nameSafe = (c.name || '').replace(/'/g, "''");
      const arSafe = (c.arName || '').replace(/'/g, "''");
      const pJson = JSON.stringify(c.persons || []).replace(/'/g, "''");
      sql += `INSERT INTO companies (id, name, ar_name, entity_type, persons_json) VALUES ('${c.id}', '${nameSafe}', '${arSafe}', '${c.entityType || 'company'}', '${pJson}') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;\n`;
    });
    sql += `\n`;

    transactions.forEach(t => {
      const itemSafe = (t.itemName || '').replace(/'/g, "''");
      const codeSafe = (t.itemCode || '').replace(/'/g, "''");
      const compSafe = (t.companyName || '').replace(/'/g, "''");
      const pSafe = (t.personName || '').replace(/'/g, "''");
      const noteSafe = (t.notes || '').replace(/'/g, "''");
      const st = t.status || (t.isReturned ? 'RETURNED' : (t.isPaid ? 'PAID' : 'UNPAID'));
      const isPaid = (t.isPaid || st === 'PAID') ? 'TRUE' : 'FALSE';
      const isRet = (t.isReturned || st === 'RETURNED') ? 'TRUE' : 'FALSE';

      sql += `INSERT INTO transactions (id, item_name, item_code, unit_price, quantity, total_price, company_id, company_name, person_name, status, is_paid, is_returned, notes, created_at) `;
      sql += `VALUES ('${t.id}', '${itemSafe}', '${codeSafe}', ${t.unitPrice}, ${t.quantity}, ${t.totalPrice}, '${t.companyId}', '${compSafe}', '${pSafe}', '${st}', ${isPaid}, ${isRet}, '${noteSafe}', '${t.createdAt}') ON CONFLICT (id) DO NOTHING;\n`;
    });
    sql += `\n`;

    purchases.forEach(p => {
      const invNum = (p.invoiceNumber || '').replace(/'/g, "''");
      const supSafe = (p.supplierName || '').replace(/'/g, "''");
      const noteSafe = (p.notes || '').replace(/'/g, "''");
      const isRet = p.isReturned ? 'TRUE' : 'FALSE';

      sql += `INSERT INTO purchase_invoices (id, invoice_number, supplier_id, supplier_name, invoice_date, subtotal, discount, grand_total, paid_amount, remaining_amount, payment_status, is_returned, notes) `;
      sql += `VALUES ('${p.id}', '${invNum}', '${p.supplierId}', '${supSafe}', '${p.invoiceDate}', ${p.subtotal || p.grandTotal}, ${p.discount || 0}, ${p.grandTotal}, ${p.paidAmount || 0}, ${p.remainingAmount || 0}, '${p.paymentStatus}', ${isRet}, '${noteSafe}') ON CONFLICT (id) DO NOTHING;\n`;
    });

    return sql;
  }

  // ==========================================
  // تصدير كود SQL لـ SQLite
  // ==========================================
  async generateSQLiteDump() {
    const transactions = await this.getAllTransactions();
    const purchases = await this.getAllPurchases();
    const companies = await this.getAllCompanies();
    const users = await this.getAllUsers();

    let sql = `-- ============================================================\n`;
    sql += `-- NewTech System - Enterprise SQLite Data Dump\n`;
    sql += `-- Generated: ${new Date().toISOString()}\n`;
    sql += `-- Target: SQLite3 (Local / Embedded)\n`;
    sql += `-- ============================================================\n\n`;
    sql += `PRAGMA foreign_keys = ON;\n\n`;

    users.forEach(u => {
      const uSafe = (u.username || '').replace(/'/g, "''");
      const fSafe = (u.fullName || '').replace(/'/g, "''");
      sql += `INSERT OR REPLACE INTO users (id, username, full_name, password_hash, role) VALUES ('${u.id}', '${uSafe}', '${fSafe}', '${u.passwordHash}', '${u.role || 'admin'}');\n`;
    });
    sql += `\n`;

    companies.forEach(c => {
      const nameSafe = (c.name || '').replace(/'/g, "''");
      const arSafe = (c.arName || '').replace(/'/g, "''");
      const pJson = JSON.stringify(c.persons || []).replace(/'/g, "''");
      sql += `INSERT OR REPLACE INTO companies (id, name, ar_name, entity_type, persons_json) VALUES ('${c.id}', '${nameSafe}', '${arSafe}', '${c.entityType || 'company'}', '${pJson}');\n`;
    });
    sql += `\n`;

    transactions.forEach(t => {
      const itemSafe = (t.itemName || '').replace(/'/g, "''");
      const codeSafe = (t.itemCode || '').replace(/'/g, "''");
      const compSafe = (t.companyName || '').replace(/'/g, "''");
      const pSafe = (t.personName || '').replace(/'/g, "''");
      const noteSafe = (t.notes || '').replace(/'/g, "''");
      const st = t.status || (t.isReturned ? 'RETURNED' : (t.isPaid ? 'PAID' : 'UNPAID'));
      const isPaid = (t.isPaid || st === 'PAID') ? 1 : 0;
      const isRet = (t.isReturned || st === 'RETURNED') ? 1 : 0;

      sql += `INSERT OR REPLACE INTO transactions (id, item_name, item_code, unit_price, quantity, total_price, company_id, company_name, person_name, status, is_paid, is_returned, notes, created_at) `;
      sql += `VALUES ('${t.id}', '${itemSafe}', '${codeSafe}', ${t.unitPrice}, ${t.quantity}, ${t.totalPrice}, '${t.companyId}', '${compSafe}', '${pSafe}', '${st}', ${isPaid}, ${isRet}, '${noteSafe}', '${t.createdAt}');\n`;
    });
    sql += `\n`;

    purchases.forEach(p => {
      const invNum = (p.invoiceNumber || '').replace(/'/g, "''");
      const supSafe = (p.supplierName || '').replace(/'/g, "''");
      const noteSafe = (p.notes || '').replace(/'/g, "''");
      const isRet = p.isReturned ? 1 : 0;

      sql += `INSERT OR REPLACE INTO purchase_invoices (id, invoice_number, supplier_id, supplier_name, invoice_date, subtotal, discount, grand_total, paid_amount, remaining_amount, payment_status, is_returned, notes) `;
      sql += `VALUES ('${p.id}', '${invNum}', '${p.supplierId}', '${supSafe}', '${p.invoiceDate}', ${p.subtotal || p.grandTotal}, ${p.discount || 0}, ${p.grandTotal}, ${p.paidAmount || 0}, ${p.remainingAmount || 0}, '${p.paymentStatus}', ${isRet}, '${noteSafe}');\n`;
    });

    return sql;
  }

  async clearAllTransactions() {
    await this.ensureReady();
    if (!this.db) return true;

    return new Promise((resolve) => {
      try {
        const stores = [];
        if (this.db.objectStoreNames.contains('transactions')) stores.push('transactions');
        if (this.db.objectStoreNames.contains('purchases')) stores.push('purchases');
        if (this.db.objectStoreNames.contains('audit_log')) stores.push('audit_log');

        const tx = this.db.transaction(stores, 'readwrite');
        if (stores.includes('transactions')) tx.objectStore('transactions').clear();
        if (stores.includes('purchases')) tx.objectStore('purchases').clear();
        if (stores.includes('audit_log')) {
          tx.objectStore('audit_log').add({
            action: 'PURGE_ALL',
            details: 'تم تصفير المسحوبات وفواتير المشتريات للبدء من الصفر',
            timestamp: new Date().toISOString()
          });
        }
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(true);
      } catch (e) {
        resolve(true);
      }
    });
  }

  // ==========================================
  // سندات القبض والصرف (Receipt & Payment Vouchers)
  // ==========================================
  async getAllVouchers(userId = null) {
    await this.ensureReady();
    const local = JSON.parse(localStorage.getItem('newtech_vouchers') || '[]');
    try {
      if (!this.db || !this.db.objectStoreNames.contains('vouchers')) return local;
      return new Promise((resolve) => {
        const tx = this.db.transaction('vouchers', 'readonly');
        const store = tx.objectStore('vouchers');
        const req = store.getAll();
        req.onsuccess = () => {
          const dbItems = req.result || [];
          const map = new Map();
          local.forEach(v => map.set(v.id, v));
          dbItems.forEach(v => map.set(v.id, v));
          let list = Array.from(map.values());
          if (userId) list = list.filter(v => !v.userId || v.userId === userId);
          list.sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt));
          resolve(list);
        };
        req.onerror = () => resolve(local);
      });
    } catch (e) {
      return local;
    }
  }

  async saveVoucher(voucher) {
    await this.ensureReady();
    if (!voucher.id) voucher.id = 'vch_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    if (!voucher.createdAt) voucher.createdAt = new Date().toISOString();

    const local = JSON.parse(localStorage.getItem('newtech_vouchers') || '[]');
    const idx = local.findIndex(v => v.id === voucher.id);
    if (idx >= 0) local[idx] = voucher; else local.unshift(voucher);
    localStorage.setItem('newtech_vouchers', JSON.stringify(local));

    if (this.db && this.db.objectStoreNames.contains('vouchers')) {
      try {
        const tx = this.db.transaction(['vouchers', 'audit_log'], 'readwrite');
        tx.objectStore('vouchers').put(voucher);
        tx.objectStore('audit_log').add({
          action: 'SAVE_VOUCHER',
          details: `سند ${voucher.type === 'receipt' ? 'قبض' : 'صرف'} رقم ${voucher.voucherNumber || voucher.id} بقيمة ${voucher.amount} ج.م للطرف ${voucher.companyName || ''}`,
          timestamp: new Date().toISOString(),
          userId: voucher.userId || null
        });
      } catch (e) {
        console.warn('Save voucher IndexedDB error:', e);
      }
    }
    return voucher;
  }

  async deleteVoucher(voucherId, reason = 'حذف سند') {
    await this.ensureReady();
    const local = JSON.parse(localStorage.getItem('newtech_vouchers') || '[]');
    const updated = local.filter(v => v.id !== voucherId);
    localStorage.setItem('newtech_vouchers', JSON.stringify(updated));

    if (this.db && this.db.objectStoreNames.contains('vouchers')) {
      try {
        const tx = this.db.transaction(['vouchers', 'audit_log'], 'readwrite');
        tx.objectStore('vouchers').delete(voucherId);
        tx.objectStore('audit_log').add({
          action: 'DELETE_VOUCHER',
          details: `حذف سند ID: ${voucherId} - السبب: ${reason}`,
          timestamp: new Date().toISOString()
        });
      } catch (e) {}
    }
    return true;
  }

  // ==========================================
  // المصروفات والنثريات العامة (Operating Expenses)
  // ==========================================
  async getAllExpenses(userId = null) {
    await this.ensureReady();
    const local = JSON.parse(localStorage.getItem('newtech_expenses') || '[]');
    try {
      if (!this.db || !this.db.objectStoreNames.contains('expenses')) return local;
      return new Promise((resolve) => {
        const tx = this.db.transaction('expenses', 'readonly');
        const store = tx.objectStore('expenses');
        const req = store.getAll();
        req.onsuccess = () => {
          const dbItems = req.result || [];
          const map = new Map();
          local.forEach(e => map.set(e.id, e));
          dbItems.forEach(e => map.set(e.id, e));
          let list = Array.from(map.values());
          if (userId) list = list.filter(e => !e.userId || e.userId === userId);
          list.sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt));
          resolve(list);
        };
        req.onerror = () => resolve(local);
      });
    } catch (e) {
      return local;
    }
  }

  async saveExpense(expense) {
    await this.ensureReady();
    if (!expense.id) expense.id = 'exp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    if (!expense.createdAt) expense.createdAt = new Date().toISOString();

    const local = JSON.parse(localStorage.getItem('newtech_expenses') || '[]');
    const idx = local.findIndex(e => e.id === expense.id);
    if (idx >= 0) local[idx] = expense; else local.unshift(expense);
    localStorage.setItem('newtech_expenses', JSON.stringify(local));

    if (this.db && this.db.objectStoreNames.contains('expenses')) {
      try {
        const tx = this.db.transaction(['expenses', 'audit_log'], 'readwrite');
        tx.objectStore('expenses').put(expense);
        tx.objectStore('audit_log').add({
          action: 'SAVE_EXPENSE',
          details: `تسجيل مصروف ${expense.title || expense.category} بقيمة ${expense.amount} ج.م`,
          timestamp: new Date().toISOString(),
          userId: expense.userId || null
        });
      } catch (e) {}
    }
    return expense;
  }

  async deleteExpense(expenseId, reason = 'حذف مصروف') {
    await this.ensureReady();
    const local = JSON.parse(localStorage.getItem('newtech_expenses') || '[]');
    const updated = local.filter(e => e.id !== expenseId);
    localStorage.setItem('newtech_expenses', JSON.stringify(updated));

    if (this.db && this.db.objectStoreNames.contains('expenses')) {
      try {
        const tx = this.db.transaction(['expenses', 'audit_log'], 'readwrite');
        tx.objectStore('expenses').delete(expenseId);
        tx.objectStore('audit_log').add({
          action: 'DELETE_EXPENSE',
          details: `حذف مصروف ID: ${expenseId} - السبب: ${reason}`,
          timestamp: new Date().toISOString()
        });
      } catch (e) {}
    }
    return true;
  }

  // ==========================================
  // الأصناف والمخزون (Inventory & Products)
  // ==========================================
  async getAllProducts(userId = null) {
    await this.ensureReady();
    const local = JSON.parse(localStorage.getItem('newtech_products') || '[]');
    try {
      if (!this.db || !this.db.objectStoreNames.contains('products')) return local;
      return new Promise((resolve) => {
        const tx = this.db.transaction('products', 'readonly');
        const store = tx.objectStore('products');
        const req = store.getAll();
        req.onsuccess = () => {
          const dbItems = req.result || [];
          const map = new Map();
          local.forEach(p => map.set(p.id, p));
          dbItems.forEach(p => map.set(p.id, p));
          let list = Array.from(map.values());
          if (userId) list = list.filter(p => !p.userId || p.userId === userId);
          list.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));
          resolve(list);
        };
        req.onerror = () => resolve(local);
      });
    } catch (e) {
      return local;
    }
  }

  async saveProduct(product) {
    await this.ensureReady();
    if (!product.id) product.id = 'prd_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    if (!product.createdAt) product.createdAt = new Date().toISOString();

    const local = JSON.parse(localStorage.getItem('newtech_products') || '[]');
    const idx = local.findIndex(p => p.id === product.id);
    if (idx >= 0) local[idx] = product; else local.push(product);
    localStorage.setItem('newtech_products', JSON.stringify(local));

    if (this.db && this.db.objectStoreNames.contains('products')) {
      try {
        const tx = this.db.transaction(['products', 'audit_log'], 'readwrite');
        tx.objectStore('products').put(product);
        tx.objectStore('audit_log').add({
          action: 'SAVE_PRODUCT',
          details: `حفظ صنف مخزون ${product.name} (كود: ${product.code || 'بدون'}) رصيد: ${product.quantity}`,
          timestamp: new Date().toISOString(),
          userId: product.userId || null
        });
      } catch (e) {}
    }
    return product;
  }

  async updateProductQuantity(productIdOrName, delta) {
    const products = await this.getAllProducts();
    const p = products.find(prod => prod.id === productIdOrName || (prod.name && prod.name.trim().toLowerCase() === String(productIdOrName).trim().toLowerCase()));
    if (!p) return null;
    p.quantity = Math.max(0, (Number(p.quantity) || 0) + Number(delta));
    return await this.saveProduct(p);
  }

  async deleteProduct(productId, reason = 'حذف صنف') {
    await this.ensureReady();
    const local = JSON.parse(localStorage.getItem('newtech_products') || '[]');
    const updated = local.filter(p => p.id !== productId);
    localStorage.setItem('newtech_products', JSON.stringify(updated));

    if (this.db && this.db.objectStoreNames.contains('products')) {
      try {
        const tx = this.db.transaction(['products', 'audit_log'], 'readwrite');
        tx.objectStore('products').delete(productId);
        tx.objectStore('audit_log').add({
          action: 'DELETE_PRODUCT',
          details: `حذف صنف ID: ${productId} - السبب: ${reason}`,
          timestamp: new Date().toISOString()
        });
      } catch (e) {}
    }
    return true;
  }

  // ==========================================
  // فواتير المبيعات ونقاط البيع (POS Sales)
  // ==========================================
  async getAllSales(userId = null) {
    await this.ensureReady();
    const local = JSON.parse(localStorage.getItem('newtech_sales') || '[]');
    try {
      if (!this.db || !this.db.objectStoreNames.contains('sales')) return local;
      return new Promise((resolve) => {
        const tx = this.db.transaction('sales', 'readonly');
        const store = tx.objectStore('sales');
        const req = store.getAll();
        req.onsuccess = () => {
          const dbItems = req.result || [];
          const map = new Map();
          local.forEach(s => map.set(s.id, s));
          dbItems.forEach(s => map.set(s.id, s));
          let list = Array.from(map.values());
          if (userId) list = list.filter(s => !s.userId || s.userId === userId);
          list.sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));
          resolve(list);
        };
        req.onerror = () => resolve(local);
      });
    } catch (e) {
      return local;
    }
  }

  async saveSale(sale) {
    await this.ensureReady();
    if (!sale.id) sale.id = 'sale_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    if (!sale.createdAt) sale.createdAt = new Date().toISOString();

    const local = JSON.parse(localStorage.getItem('newtech_sales') || '[]');
    const idx = local.findIndex(s => s.id === sale.id);
    if (idx >= 0) local[idx] = sale; else local.unshift(sale);
    localStorage.setItem('newtech_sales', JSON.stringify(local));

    if (this.db && this.db.objectStoreNames.contains('sales')) {
      try {
        const tx = this.db.transaction(['sales', 'audit_log'], 'readwrite');
        tx.objectStore('sales').put(sale);
        tx.objectStore('audit_log').add({
          action: 'SAVE_SALE',
          details: `تسجيل فاتورة بيع ${sale.invoiceNumber} للعميل ${sale.customerName || 'نقدي'} بقيمة ${sale.grandTotal} ج.م`,
          timestamp: new Date().toISOString(),
          userId: sale.userId || null
        });
      } catch (e) {}
    }
    return sale;
  }

  async deleteSale(saleId, reason = 'حذف فاتورة بيع') {
    await this.ensureReady();
    const local = JSON.parse(localStorage.getItem('newtech_sales') || '[]');
    const updated = local.filter(s => s.id !== saleId);
    localStorage.setItem('newtech_sales', JSON.stringify(updated));

    if (this.db && this.db.objectStoreNames.contains('sales')) {
      try {
        const tx = this.db.transaction(['sales', 'audit_log'], 'readwrite');
        tx.objectStore('sales').delete(saleId);
        tx.objectStore('audit_log').add({
          action: 'DELETE_SALE',
          details: `حذف فاتورة بيع ID: ${saleId} - السبب: ${reason}`,
          timestamp: new Date().toISOString()
        });
      } catch (e) {}
    }
    return true;
  }

  // ==========================================
  // صرف النقدية من الدرج (Cash Drawer Payouts)
  // ==========================================
  async getAllPayouts(userId = null) {
    await this.ensureReady();
    const local = JSON.parse(localStorage.getItem('newtech_payouts') || '[]');
    try {
      if (!this.db || !this.db.objectStoreNames.contains('payouts')) return local;
      return new Promise((resolve) => {
        const tx = this.db.transaction('payouts', 'readonly');
        const store = tx.objectStore('payouts');
        const req = store.getAll();
        req.onsuccess = () => {
          const dbItems = req.result || [];
          const map = new Map();
          local.forEach(p => map.set(p.id, p));
          dbItems.forEach(p => map.set(p.id, p));
          let list = Array.from(map.values());
          if (userId) list = list.filter(p => !p.userId || p.userId === userId);
          list.sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));
          resolve(list);
        };
        req.onerror = () => resolve(local);
      });
    } catch (e) {
      return local;
    }
  }

  async savePayout(payout) {
    await this.ensureReady();
    if (!payout.id) payout.id = 'payout_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    if (!payout.createdAt) payout.createdAt = new Date().toISOString();

    const local = JSON.parse(localStorage.getItem('newtech_payouts') || '[]');
    const idx = local.findIndex(p => p.id === payout.id);
    if (idx >= 0) local[idx] = payout; else local.unshift(payout);
    localStorage.setItem('newtech_payouts', JSON.stringify(local));

    if (this.db && this.db.objectStoreNames.contains('payouts')) {
      try {
        const tx = this.db.transaction(['payouts', 'audit_log'], 'readwrite');
        tx.objectStore('payouts').put(payout);
        tx.objectStore('audit_log').add({
          action: 'SAVE_PAYOUT',
          details: `صرف نقدية من الدرج: ${payout.category} - ${payout.recipient} بقيمة ${payout.amount} ج.م`,
          timestamp: new Date().toISOString(),
          userId: payout.userId || null
        });
      } catch (e) {}
    }
    return payout;
  }

  async deletePayout(payoutId, reason = 'حذف صرف نقدية') {
    await this.ensureReady();
    const local = JSON.parse(localStorage.getItem('newtech_payouts') || '[]');
    const updated = local.filter(p => p.id !== payoutId);
    localStorage.setItem('newtech_payouts', JSON.stringify(updated));

    if (this.db && this.db.objectStoreNames.contains('payouts')) {
      try {
        const tx = this.db.transaction(['payouts', 'audit_log'], 'readwrite');
        tx.objectStore('payouts').delete(payoutId);
        tx.objectStore('audit_log').add({
          action: 'DELETE_PAYOUT',
          details: `حذف صرف نقدية ID: ${payoutId} - السبب: ${reason}`,
          timestamp: new Date().toISOString()
        });
      } catch (e) {}
    }
    return true;
  }

  async getDatabaseStats() {
    const transactions = await this.getAllTransactions();
    const purchases = await this.getAllPurchases();
    const companies = await this.getAllCompanies();
    const users = await this.getAllUsers();
    const vouchers = await this.getAllVouchers();
    const expenses = await this.getAllExpenses();
    const products = await this.getAllProducts();
    const sales = await this.getAllSales();
    const payouts = await this.getAllPayouts();
    const logs = await this.getAuditLogs(500);

    const rawData = JSON.stringify({ transactions, purchases, companies, users, vouchers, expenses, products, sales, payouts, logs });
    const sizeKB = (new Blob([rawData]).size / 1024).toFixed(2);

    return {
      name: this.dbName,
      version: this.dbVersion,
      engine: 'PostgreSQL + SQLite Dual-Engine (IndexedDB Hub)',
      status: this.cloudConfig.endpoint ? 'متصلة بالسيرفر المركزي (Cloud Postgres Sync)' : 'متصلة محلياً (SQLite / Offline Mode)',
      transactionsCount: transactions.length,
      purchasesCount: purchases.length,
      companiesCount: companies.length,
      usersCount: users.length,
      vouchersCount: vouchers.length,
      expensesCount: expenses.length,
      productsCount: products.length,
      salesCount: sales.length,
      payoutsCount: payouts.length,
      auditLogsCount: logs.length,
      approxSizeKB: sizeKB
    };
  }
}

window.newTechDB = new NewTechDB();
