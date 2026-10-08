-- ============================================================================
-- NewTech System - Enterprise SQLite Database Schema
-- قاعدة البيانات المحلية المتوافقة مع SQLite والتشغيل Offline بدون إنترنت
-- ============================================================================

PRAGMA foreign_keys = ON;

-- 1. جدول المستخدمين (Users)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'admin',
    branch_name TEXT DEFAULT 'المول الرئيسي',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 2. جدول الشركات والموردين (Companies & Suppliers)
CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    name TEXT NOT NULL,
    ar_name TEXT NOT NULL,
    entity_type TEXT DEFAULT 'company', -- 'company', 'supplier', 'both'
    phone TEXT,
    address TEXT,
    persons_json TEXT,
    initial_balance REAL DEFAULT 0.00,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3. جدول المسحوبات والمبيعات للشركات (Withdrawals / Sales Transactions)
CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    company_id TEXT NOT NULL,
    company_name TEXT NOT NULL,
    person_name TEXT NOT NULL,
    item_code TEXT NOT NULL,
    item_name TEXT NOT NULL,
    unit_price REAL NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    total_price REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'UNPAID', -- 'UNPAID', 'PAID', 'RETURNED'
    is_paid INTEGER NOT NULL DEFAULT 0,
    is_returned INTEGER NOT NULL DEFAULT 0,
    paid_at TEXT,
    returned_at TEXT,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE RESTRICT
);

-- 4. جدول فواتير المشتريات من الشركات والموردين (Purchase Invoices)
CREATE TABLE IF NOT EXISTS purchase_invoices (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    invoice_number TEXT NOT NULL,
    supplier_id TEXT NOT NULL,
    supplier_name TEXT NOT NULL,
    invoice_date TEXT NOT NULL,
    subtotal REAL NOT NULL DEFAULT 0.00,
    discount REAL NOT NULL DEFAULT 0.00,
    grand_total REAL NOT NULL DEFAULT 0.00,
    paid_amount REAL NOT NULL DEFAULT 0.00,
    remaining_amount REAL NOT NULL DEFAULT 0.00,
    payment_status TEXT DEFAULT 'UNPAID', -- 'PAID', 'PARTIAL', 'UNPAID', 'RETURNED'
    is_returned INTEGER DEFAULT 0,
    returned_at TEXT,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(supplier_id) REFERENCES companies(id) ON DELETE RESTRICT
);

-- 5. جدول بنود فواتير المشتريات (Purchase Items)
CREATE TABLE IF NOT EXISTS purchase_items (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL,
    item_name TEXT NOT NULL,
    item_code TEXT,
    quantity REAL NOT NULL DEFAULT 1,
    unit_price REAL NOT NULL,
    discount REAL DEFAULT 0.00,
    final_price REAL NOT NULL,
    status TEXT DEFAULT 'NORMAL',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(invoice_id) REFERENCES purchase_invoices(id) ON DELETE CASCADE
);

-- 6. جدول سجل التدقيق والمراجعة (Audit Log)
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    details TEXT,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 7. فهارس الأداء السريع (Indexes)
CREATE INDEX IF NOT EXISTS idx_trans_company ON transactions(company_id);
CREATE INDEX IF NOT EXISTS idx_trans_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchase_invoices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purch_items_inv ON purchase_items(invoice_id);

-- 8. عرض المقاصة التلقائية في SQLite (View Netting)
CREATE VIEW IF NOT EXISTS view_company_netting AS
SELECT 
    c.id AS company_id,
    c.name AS company_name,
    c.ar_name AS company_ar_name,
    c.entity_type,
    
    -- ما لي عند الشركة (مسحوبات غير مسددة وليست مرتجعة)
    COALESCE((
        SELECT SUM(t.total_price) 
        FROM transactions t 
        WHERE t.company_id = c.id AND t.status = 'UNPAID' AND t.is_returned = 0
    ), 0) AS due_from_them,

    -- ما عليّ للشركة (مشتريات غير مسددة وليست مرتجعة)
    COALESCE((
        SELECT SUM(p.remaining_amount) 
        FROM purchase_invoices p 
        WHERE p.supplier_id = c.id AND p.is_returned = 0
    ), 0) AS due_to_them,

    -- الصافي بعد المقاصة
    (
        COALESCE((
            SELECT SUM(t.total_price) 
            FROM transactions t 
            WHERE t.company_id = c.id AND t.status = 'UNPAID' AND t.is_returned = 0
        ), 0)
        -
        COALESCE((
            SELECT SUM(p.remaining_amount) 
            FROM purchase_invoices p 
            WHERE p.supplier_id = c.id AND p.is_returned = 0
        ), 0)
    ) AS net_balance

FROM companies c;
