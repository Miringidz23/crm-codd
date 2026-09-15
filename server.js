const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// قاعدة البيانات
const db = new sqlite3.Database('./orders.db', (err) => {
    if (err) console.error('Database connection error:', err);
    else console.log('SQLite Database Connected.');
});

// جدول الطلبيات والإعدادات
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            phone TEXT,
            wilaya TEXT,
            commune TEXT,
            product TEXT,
            quantity INTEGER,
            price INTEGER,
            status TEXT DEFAULT 'جديد',
            notes TEXT DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY,
            product_name TEXT DEFAULT 'Smart Watch Series 9',
            price INTEGER DEFAULT 4500,
            buy_price INTEGER DEFAULT 2000,
            shipping_cost INTEGER DEFAULT 600,
            ad_cost INTEGER DEFAULT 500,
            image_url TEXT DEFAULT 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&q=80',
            password TEXT DEFAULT 'admin123',
            telegram_token TEXT DEFAULT '',
            telegram_chat_id TEXT DEFAULT ''
        )
    `);

    // إدخال إعدادات افتراضية إذا كانت فارغة
    db.get('SELECT COUNT(*) as count FROM settings', (err, row) => {
        if (row.count === 0) {
            db.run(`INSERT INTO settings (id) VALUES (1)`);
        }
    });
});

// دالة إرسال إشعار التلغرام
function sendTelegramNotification(order, settings) {
    if (!settings.telegram_token || !settings.telegram_chat_id) return;

    const message = encodeURIComponent(
        `🥳 *طلب جديد في المتجر!*\n\n` +
        `👤 *الاسم:* ${order.name}\n` +
        `📞 *الهاتف:* ${order.phone}\n` +
        `📍 *العنوان:* ${order.wilaya} - ${order.commune}\n` +
        `🛍️ *المنتج:* ${order.product}\n` +
        `💰 *السعر:* ${order.price} د.ج`
    );

    const url = `https://api.telegram.org/bot${settings.telegram_token}/sendMessage?chat_id=${settings.telegram_chat_id}&text=${message}&parse_mode=Markdown`;

    https.get(url, (res) => {}).on('error', (e) => console.error(e));
}

// 🌐 Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// جلب إعدادات المتجر
app.get('/api/settings', (req, res) => {
    db.get('SELECT * FROM settings WHERE id = 1', (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(row);
    });
});

// تحديث الإعدادات
app.put('/api/settings', (req, res) => {
    const { product_name, price, buy_price, shipping_cost, ad_cost, image_url, password, telegram_token, telegram_chat_id } = req.body;
    const query = `UPDATE settings SET product_name=?, price=?, buy_price=?, shipping_cost=?, ad_cost=?, image_url=?, password=?, telegram_token=?, telegram_chat_id=? WHERE id=1`;
    db.run(query, [product_name, price, buy_price, shipping_cost, ad_cost, image_url, password, telegram_token, telegram_chat_id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// تسجيل الدخول للـ CRM
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    db.get('SELECT password FROM settings WHERE id = 1', (err, row) => {
        if (row && row.password === password) {
            res.json({ success: true });
        } else {
            res.status(401).json({ success: false, message: 'كلمة السر غير صحيحة' });
        }
    });
});

// إضافة طلب جديد
app.post('/api/orders', (req, res) => {
    const { name, phone, wilaya, commune } = req.body;
    
    db.get('SELECT * FROM settings WHERE id = 1', (err, settings) => {
        const query = `INSERT INTO orders (name, phone, wilaya, commune, product, quantity, price) VALUES (?, ?, ?, ?, ?, ?, ?)`;
        db.run(query, [name, phone, wilaya, commune, settings.product_name, 1, settings.price], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            
            const newOrder = { name, phone, wilaya, commune, product: settings.product_name, price: settings.price };
            sendTelegramNotification(newOrder, settings);
            
            res.json({ success: true, orderId: this.lastID });
        });
    });
});

// جلب كل الطلبيات
app.get('/api/orders', (req, res) => {
    db.all('SELECT * FROM orders ORDER BY id DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// تحديث حالة الطلب
app.put('/api/orders/:id', (req, res) => {
    const { status, notes } = req.body;
    const { id } = req.params;
    db.run(`UPDATE orders SET status = ?, notes = ? WHERE id = ?`, [status, notes, id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// تصدير CSV
app.get('/api/export-csv', (req, res) => {
    db.all('SELECT * FROM orders WHERE status = "مؤكد"', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        let csv = '\uFEFF';
        csv += 'رقم الطلب,الاسم,الهاتف,الولاية,البلدية,المنتج,الكمية,السعر الإجمالي\n';
        rows.forEach(r => {
            csv += `"${r.id}","${r.name}","${r.phone}","${r.wilaya}","${r.commune}","${r.product}","${r.quantity}","${r.price}"\n`;
        });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=confirmed_orders.csv');
        res.status(200).send(csv);
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
