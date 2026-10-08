-- ============================================================================
-- NewTech System - Enterprise PostgreSQL Database Schema
-- قاعدة البيانات المركزية المتوافقة مع السيرفرات والمزامنة السحابية (PostgreSQL)
-- ============================================================================

-- 1. جدول المستخدمين وحسابات النظام (Users & Authentication)
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    username VARCHAR(64) UNIQUE NOT NULL,
    full_name VARCHAR(128) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(32) DEFAULT 'admin', -- 'admin', 'manager', 'cashier'
    branch_name VARCHAR(128) DEFAULT 'المول الرئيسي',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. جدول الشركات والموردين (Companies & Suppliers)
CREATE TABLE IF NOT EXISTS companies (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(128) NOT NULL,
    ar_name VARCHAR(128) NOT NULL,
    entity_type VARCHAR(32) DEFAULT 'company', -- 'company', 'supplier', 'both'
    phone VARCHAR(32),
    address TEXT,
    persons_json TEXT, -- أسماء الأشخاص المفوضين
    initial_balance DECIMAL(12, 2) DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. جدول المسحوبات والمبيعات للشركات (Withdrawals / Sales Transactions)
CREATE TABLE IF NOT EXISTS transactions (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
    company_id VARCHAR(64) REFERENCES companies(id) ON DELETE RESTRICT,
    company_name VARCHAR(128) NOT NULL,
    person_name VARCHAR(128) NOT NULL,
    item_code VARCHAR(64) NOT NULL,
    itemName VARCHAR(255) NOT NULL,
    unit_price DECIMAL(12, 2) NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    total_price DECIMAL(12, 2) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'UNPAID', -- 'UNPAID' (آجل), 'PAID' (مدفوع), 'RETURNED' (مرتجع)
    is_paid BOOLEAN NOT NULL DEFAULT FALSE,
    is_returned BOOLEAN NOT NULL DEFAULT FALSE,
    paid_at TIMESTAMP WITH TIME ZONE,
    returned_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. جدول فواتير المشتريات من الشركات والموردين (Purchase Invoices)
CREATE TABLE IF NOT EXISTS purchase_invoices (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
    invoice_number VARCHAR(64) NOT NULL,
    supplier_id VARCHAR(64) REFERENCES companies(id) ON DELETE RESTRICT,
    supplier_name VARCHAR(128) NOT NULL,
    invoice_date DATE NOT NULL,
    subtotal DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    discount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    grand_total DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    paid_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    remaining_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    payment_status VARCHAR(32) DEFAULT 'UNPAID', -- 'PAID', 'PARTIAL', 'UNPAID', 'RETURNED'
    is_returned BOOLEAN DEFAULT FALSE,
    returned_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. جدول بنود فواتير المشتريات (Purchase Invoice Line Items - غير محدودة)
CREATE TABLE IF NOT EXISTS purchase_items (
    id VARCHAR(64) PRIMARY KEY,
    invoice_id VARCHAR(64) REFERENCES purchase_invoices(id) ON DELETE CASCADE,
    item_name VARCHAR(255) NOT NULL,
    item_code VARCHAR(64),
    quantity DECIMAL(10, 2) NOT NULL DEFAULT 1,
    unit_price DECIMAL(12, 2) NOT NULL,
    discount DECIMAL(12, 2) DEFAULT 0.00,
    final_price DECIMAL(12, 2) NOT NULL,
    status VARCHAR(32) DEFAULT 'NORMAL', -- 'NORMAL', 'RETURNED'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. جدول مدفوعات وسندات القبض والصرف (Payments & Receipts)
CREATE TABLE IF NOT EXISTS payments (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
    company_id VARCHAR(64) REFERENCES companies(id) ON DELETE RESTRICT,
    payment_type VARCHAR(32) NOT NULL, -- 'RECEIPT' (قبض من شركة), 'PAYMENT' (صرف لمورد)
    amount DECIMAL(12, 2) NOT NULL,
    reference_type VARCHAR(32), -- 'TRANSACTION', 'INVOICE', 'MANUAL_SETTLEMENT'
    reference_id VARCHAR(64),
    payment_method VARCHAR(32) DEFAULT 'CASH', -- 'CASH', 'TRANSFER', 'CHECK'
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. جدول سجل التدقيق والمراجعة المالية (Audit Log)
CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    user_id VARCHAR(64),
    action VARCHAR(64) NOT NULL, -- 'INSERT', 'UPDATE', 'DELETE', 'PAY', 'RETURN', 'SETTLE'
    entity_type VARCHAR(64) NOT NULL, -- 'transaction', 'purchase', 'company', 'auth'
    entity_id VARCHAR(64),
    details TEXT,
    ip_address VARCHAR(45),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. فهارس الأداء السريع (Performance Indexes)
CREATE INDEX IF NOT EXISTS idx_trans_company_id ON transactions(company_id);
CREATE INDEX IF NOT EXISTS idx_trans_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_trans_created_at ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier_id ON purchase_invoices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchase_invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_purch_items_invoice ON purchase_items(invoice_id);

-- 9. عرض محاسبي للمقاصة التلقائية بين الحسابات (Automatic Netting & Settlement View)
CREATE OR REPLACE VIEW view_company_netting AS
SELECT 
    c.id AS company_id,
    c.name AS company_name,
    c.ar_name AS company_ar_name,
    c.entity_type,
    
    -- ما لي عند الشركة (المسحوبات غير المسددة - عدا المرتجعات)
    COALESCE(SUM(CASE 
        WHEN t.status = 'UNPAID' AND t.is_returned = FALSE 
        THEN t.total_price ELSE 0 END), 0) AS due_from_them,
        
    -- ما تم سداده من مسحوباتهم
    COALESCE(SUM(CASE 
        WHEN t.status = 'PAID' AND t.is_returned = FALSE 
        THEN t.total_price ELSE 0 END), 0) AS paid_by_them,

    -- ما عليّ للشركة (المشتريات غير المسددة - عدا المرتجعات)
    COALESCE(p.due_to_them, 0) AS due_to_them,
    COALESCE(p.paid_to_them, 0) AS paid_to_them,

    -- الرصيد الصافي بعد المقاصة:
    -- موجب (> 0) = لي عندهم مبلغ (يظهر أحمر)
    -- سالب (< 0) = عليّ لهم مبلغ (يظهر أخضر)
    (COALESCE(SUM(CASE 
        WHEN t.status = 'UNPAID' AND t.is_returned = FALSE 
        THEN t.total_price ELSE 0 END), 0) - COALESCE(p.due_to_them, 0)) AS net_balance

FROM companies c
LEFT JOIN transactions t ON c.id = t.company_id
LEFT JOIN (
    SELECT 
        supplier_id,
        SUM(remaining_amount) AS due_to_them,
        SUM(paid_amount) AS paid_to_them
    FROM purchase_invoices
    WHERE is_returned = FALSE
    GROUP BY supplier_id
) p ON c.id = p.supplier_id
GROUP BY c.id, c.name, c.ar_name, c.entity_type, p.due_to_them, p.paid_to_them;
