// ============================================================
//  COD CRM ENTERPRISE SYSTEM - الجزائر
//  المرحلة 1: المنتجات + المخزون + المستخدمين + توزيع الطلبيات
// ============================================================

require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ======================== MIDDLEWARE ========================
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ======================== DATABASE ========================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// ======================== إنشاء الجداول ========================
async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
     await client.query(`DROP TABLE IF EXISTS order_history, order_items, orders, products, wilayas, users, settings CASCADE;`);
    // -------- جدول المستخدمين --------
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(100) NOT NULL,
        role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'supervisor', 'agent')),
        phone VARCHAR(20),
        is_active BOOLEAN DEFAULT true,
        max_daily_orders INT DEFAULT 50,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // -------- جدول المنتجات --------
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        sku VARCHAR(50) UNIQUE NOT NULL,
        description TEXT,
        purchase_price DECIMAL(10,2) NOT NULL DEFAULT 0,
        sale_price DECIMAL(10,2) NOT NULL,
        weight DECIMAL(5,2) DEFAULT 0.5,
        stock_quantity INT NOT NULL DEFAULT 0,
        reserved_quantity INT NOT NULL DEFAULT 0,
        min_stock_alert INT DEFAULT 10,
        image_url VARCHAR(500),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // -------- جدول ولايات الجزائر --------
    await client.query(`
      CREATE TABLE IF NOT EXISTS wilayas (
        id SERIAL PRIMARY KEY,
        code VARCHAR(5) NOT NULL,
        name_ar VARCHAR(100) NOT NULL,
        name_fr VARCHAR(100),
        delivery_cost_desk DECIMAL(10,2) DEFAULT 0,
        delivery_cost_home DECIMAL(10,2) DEFAULT 0
      );
    `);

    // -------- جدول الطلبيات --------
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        tracking_id VARCHAR(30) UNIQUE NOT NULL,
        customer_name VARCHAR(100) NOT NULL,
        customer_phone VARCHAR(20) NOT NULL,
        customer_phone2 VARCHAR(20),
        wilaya_id INT REFERENCES wilayas(id),
        commune VARCHAR(100),
        address TEXT,
        delivery_type VARCHAR(10) DEFAULT 'desk' CHECK (delivery_type IN ('desk', 'home')),
        
        status VARCHAR(30) DEFAULT 'new' CHECK (status IN (
          'new', 'confirmed', 'cancelled', 'duplicate',
          'no_answer', 'callback', 'shipped', 'delivered',
          'returned', 'exchange'
        )),
        
        total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
        delivery_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
        net_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
        
        assigned_to INT REFERENCES users(id),
        confirmed_by INT REFERENCES users(id),
        
        notes TEXT,
        call_attempts INT DEFAULT 0,
        last_call_at TIMESTAMP,
        
        shipping_company VARCHAR(50),
        shipping_tracking VARCHAR(50),
        bordereau_printed BOOLEAN DEFAULT false,
        
        source VARCHAR(50) DEFAULT 'manual',
        
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        confirmed_at TIMESTAMP,
        shipped_at TIMESTAMP,
        delivered_at TIMESTAMP
      );
    `);

    // -------- جدول عناصر الطلبية (Multi-Product) --------
    await client.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id INT REFERENCES orders(id) ON DELETE CASCADE,
        product_id INT REFERENCES products(id),
        product_name VARCHAR(200) NOT NULL,
        quantity INT NOT NULL DEFAULT 1,
        unit_price DECIMAL(10,2) NOT NULL,
        total_price DECIMAL(10,2) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // -------- جدول سجل الإجراءات --------
    await client.query(`
      CREATE TABLE IF NOT EXISTS order_history (
        id SERIAL PRIMARY KEY,
        order_id INT REFERENCES orders(id) ON DELETE CASCADE,
        user_id INT REFERENCES users(id),
        action VARCHAR(50) NOT NULL,
        old_status VARCHAR(30),
        new_status VARCHAR(30),
        note TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // -------- جدول إعدادات النظام --------
    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id SERIAL PRIMARY KEY,
        key VARCHAR(100) UNIQUE NOT NULL,
        value TEXT,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // -------- إنشاء الفهارس --------
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_orders_assigned ON orders(assigned_to);
      CREATE INDEX IF NOT EXISTS idx_orders_tracking ON orders(tracking_id);
      CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(customer_phone);
      CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
      CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
      CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
    `);

    // -------- إدخال الولايات الجزائرية --------
    const wilayaCount = await client.query('SELECT COUNT(*) FROM wilayas');
    if (parseInt(wilayaCount.rows[0].count) === 0) {
      const wilayas = [
        ['01','أدرار','Adrar',800,1000],['02','الشلف','Chlef',500,700],
        ['03','الأغواط','Laghouat',600,800],['04','أم البواقي','Oum El Bouaghi',500,700],
        ['05','باتنة','Batna',500,700],['06','بجاية','Béjaïa',500,700],
        ['07','بسكرة','Biskra',500,700],['08','بشار','Béchar',800,1000],
        ['09','البليدة','Blida',400,500],['10','البويرة','Bouira',400,600],
        ['11','تمنراست','Tamanrasset',1000,1200],['12','تبسة','Tébessa',600,800],
        ['13','تلمسان','Tlemcen',500,700],['14','تيارت','Tiaret',500,700],
        ['15','تيزي وزو','Tizi Ouzou',400,600],['16','الجزائر','Alger',300,400],
        ['17','الجلفة','Djelfa',500,700],['18','جيجل','Jijel',500,700],
        ['19','سطيف','Sétif',400,600],['20','سعيدة','Saïda',600,800],
        ['21','سكيكدة','Skikda',500,700],['22','سيدي بلعباس','Sidi Bel Abbès',500,700],
        ['23','عنابة','Annaba',500,700],['24','قالمة','Guelma',500,700],
        ['25','قسنطينة','Constantine',400,600],['26','المدية','Médéa',400,600],
        ['27','مستغانم','Mostaganem',500,700],['28','المسيلة','M\'sila',500,700],
        ['29','معسكر','Mascara',500,700],['30','ورقلة','Ouargla',700,900],
        ['31','وهران','Oran',400,600],['32','البيض','El Bayadh',700,900],
        ['33','إليزي','Illizi',1000,1200],['34','برج بوعريريج','Bordj Bou Arréridj',400,600],
        ['35','بومرداس','Boumerdès',400,500],['36','الطارف','El Tarf',500,700],
        ['37','تندوف','Tindouf',1000,1200],['38','تيسمسيلت','Tissemsilt',500,700],
        ['39','الوادي','El Oued',600,800],['40','خنشلة','Khenchela',600,800],
        ['41','سوق أهراس','Souk Ahras',500,700],['42','تيبازة','Tipaza',400,500],
        ['43','ميلة','Mila',500,700],['44','عين الدفلى','Aïn Defla',400,600],
        ['45','النعامة','Naâma',700,900],['46','عين تيموشنت','Aïn Témouchent',500,700],
        ['47','غرداية','Ghardaïa',600,800],['48','غليزان','Relizane',500,700],
        ['49','تيميمون','Timimoun',900,1100],['50','برج باجي مختار','Bordj Badji Mokhtar',1000,1200],
        ['51','أولاد جلال','Ouled Djellal',600,800],['52','بني عباس','Béni Abbès',900,1100],
        ['53','عين صالح','In Salah',1000,1200],['54','عين قزام','In Guezzam',1000,1200],
        ['55','توقرت','Touggourt',600,800],['56','جانت','Djanet',1000,1200],
        ['57','المغير','El Meghaïer',600,800],['58','المنيعة','El Meniaa',700,900]
      ];

      for (const w of wilayas) {
        await client.query(
          `INSERT INTO wilayas (code, name_ar, name_fr, delivery_cost_desk, delivery_cost_home) 
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
          w
        );
      }
    }

    // -------- إنشاء حساب Admin افتراضي --------
    const adminExists = await client.query(
      "SELECT id FROM users WHERE username = 'admin'"
    );
    if (adminExists.rows.length === 0) {
      const hash = await bcrypt.hash('admin123', 12);
      await client.query(
        `INSERT INTO users (username, password_hash, full_name, role, phone)
         VALUES ('admin', $1, 'مدير النظام', 'admin', '0550000000')`,
        [hash]
      );
      console.log('✅ Admin account created: admin / admin123');
    }

    await client.query('COMMIT');
    console.log('✅ Database initialized successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Database init error:', err);
    throw err;
  } finally {
    client.release();
  }
}

// ======================== JWT MIDDLEWARE ========================
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'غير مصرح' });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'جلسة منتهية' });
    req.user = user;
    next();
  });
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'ليس لديك صلاحية' });
    }
    next();
  };
}

// ======================== HELPER FUNCTIONS ========================
function generateTrackingId() {
  const date = new Date();
  const prefix = 'DZ';
  const datePart = date.toISOString().slice(2, 10).replace(/-/g, '');
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `${prefix}${datePart}${random}`;
}

// ======================== AUTH ROUTES ========================

// تسجيل الدخول
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1 AND is_active = true',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, full_name: user.full_name },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// ======================== USERS MANAGEMENT ========================

// جلب جميع المستخدمين
app.get('/api/users', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, full_name, role, phone, is_active, max_daily_orders,
              created_at,
              (SELECT COUNT(*) FROM orders WHERE assigned_to = users.id AND status = 'new') as pending_orders,
              (SELECT COUNT(*) FROM orders WHERE confirmed_by = users.id 
               AND DATE(confirmed_at) = CURRENT_DATE) as today_confirmed
       FROM users ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ error: 'خطأ في جلب المستخدمين' });
  }
});

// إنشاء مستخدم جديد
app.post('/api/users', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { username, password, full_name, role, phone, max_daily_orders } = req.body;

    if (!username || !password || !full_name || !role) {
      return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, full_name, role, phone, max_daily_orders)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, username, full_name, role`,
      [username, hash, full_name, role, phone, max_daily_orders || 50]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'اسم المستخدم موجود مسبقاً' });
    }
    console.error('Create user error:', err);
    res.status(500).json({ error: 'خطأ في إنشاء المستخدم' });
  }
});

// تحديث مستخدم
app.put('/api/users/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { full_name, role, phone, is_active, max_daily_orders, password } = req.body;
    
    let query, params;
    if (password) {
      const hash = await bcrypt.hash(password, 12);
      query = `UPDATE users SET full_name=$1, role=$2, phone=$3, is_active=$4, 
               max_daily_orders=$5, password_hash=$6, updated_at=NOW() WHERE id=$7 RETURNING *`;
      params = [full_name, role, phone, is_active, max_daily_orders, hash, req.params.id];
    } else {
      query = `UPDATE users SET full_name=$1, role=$2, phone=$3, is_active=$4, 
               max_daily_orders=$5, updated_at=NOW() WHERE id=$6 RETURNING *`;
      params = [full_name, role, phone, is_active, max_daily_orders, req.params.id];
    }

    const result = await pool.query(query, params);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'خطأ في تحديث المستخدم' });
  }
});

// ======================== PRODUCTS MANAGEMENT ========================

// جلب جميع المنتجات
app.get('/api/products', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT *, 
              (stock_quantity - reserved_quantity) as available_quantity,
              CASE WHEN (stock_quantity - reserved_quantity) <= min_stock_alert 
                   THEN true ELSE false END as low_stock
       FROM products ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get products error:', err);
    res.status(500).json({ error: 'خطأ في جلب المنتجات' });
  }
});

// إنشاء منتج جديد
app.post('/api/products', authenticateToken, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    const { name, sku, description, purchase_price, sale_price, weight, 
            stock_quantity, min_stock_alert, image_url } = req.body;

    if (!name || !sku || !sale_price) {
      return res.status(400).json({ error: 'الاسم، SKU، وسعر البيع مطلوبين' });
    }

    const result = await pool.query(
      `INSERT INTO products (name, sku, description, purchase_price, sale_price, weight,
                             stock_quantity, min_stock_alert, image_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [name, sku, description, purchase_price || 0, sale_price, weight || 0.5,
       stock_quantity || 0, min_stock_alert || 10, image_url]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'رمز SKU موجود مسبقاً' });
    }
    console.error('Create product error:', err);
    res.status(500).json({ error: 'خطأ في إنشاء المنتج' });
  }
});

// تحديث منتج
app.put('/api/products/:id', authenticateToken, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    const { name, description, purchase_price, sale_price, weight,
            stock_quantity, min_stock_alert, image_url, is_active } = req.body;

    const result = await pool.query(
      `UPDATE products SET name=$1, description=$2, purchase_price=$3, sale_price=$4,
       weight=$5, stock_quantity=$6, min_stock_alert=$7, image_url=$8, is_active=$9,
       updated_at=NOW() WHERE id=$10 RETURNING *`,
      [name, description, purchase_price, sale_price, weight, stock_quantity,
       min_stock_alert, image_url, is_active, req.params.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update product error:', err);
    res.status(500).json({ error: 'خطأ في تحديث المنتج' });
  }
});

// حذف منتج (soft delete)
app.delete('/api/products/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    await pool.query(
      'UPDATE products SET is_active = false, updated_at = NOW() WHERE id = $1',
      [req.params.id]
    );
    res.json({ message: 'تم تعطيل المنتج' });
  } catch (err) {
    console.error('Delete product error:', err);
    res.status(500).json({ error: 'خطأ في حذف المنتج' });
  }
});

// ======================== WILAYAS ========================
app.get('/api/wilayas', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM wilayas ORDER BY code::int');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'خطأ في جلب الولايات' });
  }
});

// ======================== ORDERS MANAGEMENT ========================

// جلب الطلبيات (مع فلترة وتصفح)
app.get('/api/orders', authenticateToken, async (req, res) => {
  try {
    const { status, assigned_to, page = 1, limit = 50, search, date_from, date_to } = req.query;
    let where = [];
    let params = [];
    let paramIndex = 1;

    // Agent يشوف غير الطلبيات المخصصة له
    if (req.user.role === 'agent') {
      where.push(`o.assigned_to = $${paramIndex++}`);
      params.push(req.user.id);
    } else if (assigned_to) {
      where.push(`o.assigned_to = $${paramIndex++}`);
      params.push(assigned_to);
    }

    if (status) {
      where.push(`o.status = $${paramIndex++}`);
      params.push(status);
    }

    if (search) {
      where.push(`(o.customer_name ILIKE $${paramIndex} OR o.customer_phone ILIKE $${paramIndex} 
                   OR o.tracking_id ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (date_from) {
      where.push(`o.created_at >= $${paramIndex++}`);
      params.push(date_from);
    }

    if (date_to) {
      where.push(`o.created_at <= $${paramIndex++}`);
      params.push(date_to + ' 23:59:59');
    }

    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
    const offset = (page - 1) * limit;

    // Count total
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM orders o ${whereClause}`, params
    );

    // Get orders
    params.push(limit, offset);
    const result = await pool.query(
      `SELECT o.*, 
              w.name_ar as wilaya_name, w.code as wilaya_code,
              u1.full_name as assigned_to_name,
              u2.full_name as confirmed_by_name
       FROM orders o
       LEFT JOIN wilayas w ON o.wilaya_id = w.id
       LEFT JOIN users u1 ON o.assigned_to = u1.id
       LEFT JOIN users u2 ON o.confirmed_by = u2.id
       ${whereClause}
       ORDER BY o.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      params
    );

    // Get items for each order
    for (let order of result.rows) {
      const items = await pool.query(
        `SELECT oi.*, p.sku FROM order_items oi 
         LEFT JOIN products p ON oi.product_id = p.id
         WHERE oi.order_id = $1`,
        [order.id]
      );
      order.items = items.rows;
    }

    res.json({
      orders: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      totalPages: Math.ceil(countResult.rows[0].count / limit)
    });
  } catch (err) {
    console.error('Get orders error:', err);
    res.status(500).json({ error: 'خطأ في جلب الطلبيات' });
  }
});

// إنشاء طلبية جديدة (متعددة المنتجات)
app.post('/api/orders', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const {
      customer_name, customer_phone, customer_phone2,
      wilaya_id, commune, address, delivery_type,
      items, notes, source
    } = req.body;

    if (!customer_name || !customer_phone || !wilaya_id || !items || items.length === 0) {
      return res.status(400).json({ error: 'البيانات ناقصة: الاسم، الهاتف، الولاية، والمنتجات مطلوبة' });
    }

    // كشف التكرار (نفس الرقم في آخر 24 ساعة)
    const duplicateCheck = await client.query(
      `SELECT id, tracking_id FROM orders 
       WHERE customer_phone = $1 AND created_at > NOW() - INTERVAL '24 hours'
       AND status NOT IN ('cancelled', 'returned')`,
      [customer_phone]
    );

    let isDuplicate = duplicateCheck.rows.length > 0;

    // جلب تكاليف التوصيل
    const wilaya = await client.query('SELECT * FROM wilayas WHERE id = $1', [wilaya_id]);
    if (wilaya.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'الولاية المختارة غير موجودة' });
    }

    const delivery_cost = delivery_type === 'home' 
      ? wilaya.rows[0].delivery_cost_home 
      : wilaya.rows[0].delivery_cost_desk;

    // حساب المجموع
    let totalAmount = 0;
    const orderItems = [];

    for (const item of items) {
      const product = await client.query(
        'SELECT * FROM products WHERE id = $1 AND is_active = true', [item.product_id]
      );
      if (product.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `المنتج غير موجود` });
      }

      const p = product.rows[0];
      const available = p.stock_quantity - p.reserved_quantity;
      if (available < item.quantity) {
        await client.query('ROLLBACK');
        return res.status(400).json({ 
          error: `المخزون غير كافي للمنتج "${p.name}". المتوفر: ${available}` 
        });
      }

      const itemTotal = p.sale_price * item.quantity;
      totalAmount += itemTotal;
      orderItems.push({
        product_id: p.id,
        product_name: p.name,
        quantity: item.quantity,
        unit_price: p.sale_price,
        total_price: itemTotal
      });
    }

    // التوزيع التلقائي على الـ Agent (معدل ومصحح لـ PostgreSQL)
    let assignedTo = null;
    if (req.user.role === 'admin' || req.user.role === 'supervisor') {
      const agents = await client.query(
        `SELECT id FROM (
           SELECT u.id, u.max_daily_orders,
                  (SELECT COUNT(*) FROM orders WHERE assigned_to = u.id 
                   AND DATE(created_at) = CURRENT_DATE AND status = 'new') as today_count
           FROM users u 
           WHERE u.role = 'agent' AND u.is_active = true
         ) agent_stats
         WHERE today_count < max_daily_orders
         ORDER BY today_count ASC
         LIMIT 1`
      );
      if (agents.rows.length > 0) {
        assignedTo = agents.rows[0].id;
      }
    } else if (req.user.role === 'agent') {
      assignedTo = req.user.id;
    }

    const trackingId = generateTrackingId();
    const netAmount = totalAmount;

    // إدخال الطلبية
    const orderResult = await client.query(
      `INSERT INTO orders (tracking_id, customer_name, customer_phone, customer_phone2,
       wilaya_id, commune, address, delivery_type, status, total_amount, delivery_cost,
       net_amount, assigned_to, notes, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [trackingId, customer_name, customer_phone, customer_phone2,
       wilaya_id, commune, address, delivery_type || 'desk',
       isDuplicate ? 'duplicate' : 'new',
       totalAmount, delivery_cost, netAmount, assignedTo, notes, source || 'manual']
    );

    const orderId = orderResult.rows[0].id;

    // إدخال عناصر الطلبية وحجز المخزون
    for (const item of orderItems) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, total_price)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [orderId, item.product_id, item.product_name, item.quantity, item.unit_price, item.total_price]
      );

      // حجز المخزون
      await client.query(
        'UPDATE products SET reserved_quantity = reserved_quantity + $1, updated_at = NOW() WHERE id = $2',
        [item.quantity, item.product_id]
      );
    }

    // تسجيل في السجل
    await client.query(
      `INSERT INTO order_history (order_id, user_id, action, new_status, note)
       VALUES ($1, $2, 'created', $3, $4)`,
      [orderId, req.user.id, isDuplicate ? 'duplicate' : 'new',
       isDuplicate ? `⚠️ تكرار مع الطلبية ${duplicateCheck.rows[0].tracking_id}` : 'طلبية جديدة']
    );

    await client.query('COMMIT');

    // إرجاع الطلبية مع التفاصيل
    const fullOrder = await pool.query(
      `SELECT o.*, w.name_ar as wilaya_name, w.code as wilaya_code
       FROM orders o LEFT JOIN wilayas w ON o.wilaya_id = w.id
       WHERE o.id = $1`, [orderId]
    );
    fullOrder.rows[0].items = orderItems;

    res.status(201).json({
      order: fullOrder.rows[0],
      warning: isDuplicate ? `⚠️ رقم الهاتف موجود في طلبية سابقة` : null
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create order error:', err);
    res.status(500).json({ error: err.message || 'خطأ في إنشاء الطلبية' });
  } finally {
    client.release();
  }
});
// تحديث حالة الطلبية
app.put('/api/orders/:id/status', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { status, note } = req.body;
    const orderId = req.params.id;

    const currentOrder = await client.query('SELECT * FROM orders WHERE id = $1', [orderId]);
    if (currentOrder.rows.length === 0) {
      return res.status(404).json({ error: 'الطلبية غير موجودة' });
    }

    const oldStatus = currentOrder.rows[0].status;

    // تحديث إضافي حسب الحالة
    let extraFields = '';
    if (status === 'confirmed') {
      extraFields = ', confirmed_by = ' + req.user.id + ", confirmed_at = NOW()";
    } else if (status === 'shipped') {
      extraFields = ", shipped_at = NOW()";
    } else if (status === 'delivered') {
      extraFields = ", delivered_at = NOW()";
    }

    // إذا تأكدت الطلبية → خصم من المخزون الحقيقي
    if (status === 'confirmed' && oldStatus !== 'confirmed') {
      const items = await client.query(
        'SELECT * FROM order_items WHERE order_id = $1', [orderId]
      );
      for (const item of items.rows) {
        await client.query(
          `UPDATE products SET 
           stock_quantity = stock_quantity - $1,
           reserved_quantity = reserved_quantity - $1,
           updated_at = NOW()
           WHERE id = $2`,
          [item.quantity, item.product_id]
        );
      }
    }

    // إذا ألغيت → إرجاع الحجز
    if ((status === 'cancelled' || status === 'duplicate') && 
        !['confirmed', 'shipped', 'delivered'].includes(oldStatus)) {
      const items = await client.query(
        'SELECT * FROM order_items WHERE order_id = $1', [orderId]
      );
      for (const item of items.rows) {
        await client.query(
          `UPDATE products SET reserved_quantity = GREATEST(reserved_quantity - $1, 0),
           updated_at = NOW() WHERE id = $2`,
          [item.quantity, item.product_id]
        );
      }
    }

    // إذا مرتجعة → إرجاع المخزون
    if (status === 'returned' && ['confirmed', 'shipped', 'delivered'].includes(oldStatus)) {
      const items = await client.query(
        'SELECT * FROM order_items WHERE order_id = $1', [orderId]
      );
      for (const item of items.rows) {
        await client.query(
          `UPDATE products SET stock_quantity = stock_quantity + $1,
           updated_at = NOW() WHERE id = $2`,
          [item.quantity, item.product_id]
        );
      }
    }

    await client.query(
      `UPDATE orders SET status = $1, call_attempts = call_attempts + 1,
       last_call_at = NOW(), updated_at = NOW() ${extraFields} WHERE id = $2`,
      [status, orderId]
    );

    // سجل الإجراء
    await client.query(
      `INSERT INTO order_history (order_id, user_id, action, old_status, new_status, note)
       VALUES ($1, $2, 'status_change', $3, $4, $5)`,
      [orderId, req.user.id, oldStatus, status, note || '']
    );

    await client.query('COMMIT');
    res.json({ message: 'تم تحديث الحالة بنجاح' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update status error:', err);
    res.status(500).json({ error: 'خطأ في تحديث الحالة' });
  } finally {
    client.release();
  }
});

// توزيع الطلبيات يدوياً
app.post('/api/orders/assign', authenticateToken, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    const { order_ids, agent_id } = req.body;
    
    const agent = await pool.query(
      'SELECT * FROM users WHERE id = $1 AND role = $2 AND is_active = true',
      [agent_id, 'agent']
    );
    if (agent.rows.length === 0) {
      return res.status(400).json({ error: 'العامل غير موجود أو غير نشط' });
    }

    await pool.query(
      `UPDATE orders SET assigned_to = $1, updated_at = NOW() 
       WHERE id = ANY($2) AND status IN ('new', 'callback', 'no_answer')`,
      [agent_id, order_ids]
    );

    res.json({ message: `تم توزيع ${order_ids.length} طلبية على ${agent.rows[0].full_name}` });
  } catch (err) {
    console.error('Assign orders error:', err);
    res.status(500).json({ error: 'خطأ في توزيع الطلبيات' });
  }
});

// التوزيع التلقائي للطلبيات الجديدة
app.post('/api/orders/auto-assign', authenticateToken, requireRole('admin', 'supervisor'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const unassigned = await client.query(
      "SELECT id FROM orders WHERE assigned_to IS NULL AND status = 'new' ORDER BY created_at ASC"
    );

    const agents = await client.query(
      `SELECT u.id, u.full_name, u.max_daily_orders,
              (SELECT COUNT(*) FROM orders WHERE assigned_to = u.id 
               AND DATE(created_at) = CURRENT_DATE) as today_count
       FROM users u WHERE u.role = 'agent' AND u.is_active = true
       ORDER BY (SELECT COUNT(*) FROM orders WHERE assigned_to = u.id 
                 AND DATE(created_at) = CURRENT_DATE) ASC`
    );

    if (agents.rows.length === 0) {
      return res.status(400).json({ error: 'لا يوجد عمال تأكيد نشطين' });
    }

    let assigned = 0;
    let agentIndex = 0;

    for (const order of unassigned.rows) {
      let found = false;
      for (let i = 0; i < agents.rows.length; i++) {
        const idx = (agentIndex + i) % agents.rows.length;
        const agent = agents.rows[idx];
        if (parseInt(agent.today_count) + assigned < agent.max_daily_orders) {
          await client.query(
            'UPDATE orders SET assigned_to = $1, updated_at = NOW() WHERE id = $2',
            [agent.id, order.id]
          );
          assigned++;
          agentIndex = (idx + 1) % agents.rows.length;
          found = true;
          break;
        }
      }
      if (!found) break;
    }

    await client.query('COMMIT');
    res.json({ message: `تم توزيع ${assigned} طلبية تلقائياً` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Auto-assign error:', err);
    res.status(500).json({ error: 'خطأ في التوزيع التلقائي' });
  } finally {
    client.release();
  }
});

// ======================== DASHBOARD STATS ========================
app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
  try {
    let agentFilter = '';
    let params = [];
    if (req.user.role === 'agent') {
      agentFilter = 'AND assigned_to = $1';
      params = [req.user.id];
    }

    // إحصائيات اليوم
    const todayStats = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'new') as new_orders,
        COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed,
        COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled,
        COUNT(*) FILTER (WHERE status = 'no_answer') as no_answer,
        COUNT(*) FILTER (WHERE status = 'callback') as callback,
        COUNT(*) FILTER (WHERE status = 'shipped') as shipped,
        COUNT(*) FILTER (WHERE status = 'delivered') as delivered,
        COUNT(*) FILTER (WHERE status = 'returned') as returned,
        COUNT(*) FILTER (WHERE status = 'duplicate') as duplicate,
        COUNT(*) as total,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'confirmed'), 0) as confirmed_revenue,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'delivered'), 0) as delivered_revenue
      FROM orders 
      WHERE DATE(created_at) = CURRENT_DATE ${agentFilter}
    `, params);

    // إحصائيات عامة
    const totalStats = await pool.query(`
      SELECT 
        COUNT(*) as total_orders,
        COUNT(*) FILTER (WHERE status = 'confirmed') as total_confirmed,
        COUNT(*) FILTER (WHERE status = 'delivered') as total_delivered,
        COUNT(*) FILTER (WHERE status = 'returned') as total_returned,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'delivered'), 0) as total_revenue,
        CASE WHEN COUNT(*) FILTER (WHERE status IN ('confirmed','shipped','delivered','returned')) > 0
          THEN ROUND(
            COUNT(*) FILTER (WHERE status = 'confirmed') * 100.0 / 
            NULLIF(COUNT(*) FILTER (WHERE status NOT IN ('duplicate')), 0), 1
          ) ELSE 0 END as confirmation_rate,
        CASE WHEN COUNT(*) FILTER (WHERE status IN ('delivered','returned')) > 0
          THEN ROUND(
            COUNT(*) FILTER (WHERE status = 'returned') * 100.0 / 
            NULLIF(COUNT(*) FILTER (WHERE status IN ('delivered','returned')), 0), 1
          ) ELSE 0 END as return_rate
      FROM orders ${agentFilter ? 'WHERE ' + agentFilter.replace('AND ', '') : ''}
    `, params);

    // منتجات منخفضة المخزون
    const lowStock = await pool.query(
      `SELECT name, sku, stock_quantity, reserved_quantity,
              (stock_quantity - reserved_quantity) as available
       FROM products 
       WHERE (stock_quantity - reserved_quantity) <= min_stock_alert AND is_active = true
       ORDER BY (stock_quantity - reserved_quantity) ASC LIMIT 10`
    );

    // أداء العمال (اليوم)
    let agentPerformance = [];
    if (req.user.role !== 'agent') {
      const perf = await pool.query(`
        SELECT u.full_name, u.id,
          COUNT(*) FILTER (WHERE o.status = 'confirmed' AND DATE(o.updated_at) = CURRENT_DATE) as confirmed_today,
          COUNT(*) FILTER (WHERE o.status = 'cancelled' AND DATE(o.updated_at) = CURRENT_DATE) as cancelled_today,
          COUNT(*) FILTER (WHERE o.status = 'no_answer' AND DATE(o.updated_at) = CURRENT_DATE) as no_answer_today,
          COUNT(*) FILTER (WHERE o.status = 'new') as pending
        FROM users u
        LEFT JOIN orders o ON o.assigned_to = u.id
        WHERE u.role = 'agent' AND u.is_active = true
        GROUP BY u.id, u.full_name
        ORDER BY confirmed_today DESC
      `);
      agentPerformance = perf.rows;
    }

    res.json({
      today: todayStats.rows[0],
      overall: totalStats.rows[0],
      lowStock: lowStock.rows,
      agentPerformance
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    res.status(500).json({ error: 'خطأ في جلب الإحصائيات' });
  }
});

// ======================== ORDER HISTORY ========================
app.get('/api/orders/:id/history', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT oh.*, u.full_name as user_name
       FROM order_history oh
       LEFT JOIN users u ON oh.user_id = u.id
       WHERE oh.order_id = $1
       ORDER BY oh.created_at DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'خطأ في جلب السجل' });
  }
});

// ======================== ROUTES ========================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/crm', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'crm.html'));
});

// ======================== START SERVER ========================
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 COD CRM Server running on port ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/crm`);
    console.log(`🔐 Default login: admin / admin123`);
  });
}).catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
