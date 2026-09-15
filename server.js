const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// توجيه الرابط الرئيسي ديريكت لصفحة المتجر
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// توجيه رابط /crm ديريكت لصفحة الـ CRM
app.get('/crm', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'crm.html'));
});

// إنشاء قاعدة البيانات
const db = new sqlite3.Database('./orders.db', (err) => {
    if (err) console.error('Database connection error:', err);
    else console.log('SQLite Database Connected.');
});

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

app.post('/api/orders', (req, res) => {
    const { name, phone, wilaya, commune, product, quantity, price } = req.body;
    const query = `INSERT INTO orders (name, phone, wilaya, commune, product, quantity, price) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    db.run(query, [name, phone, wilaya, commune, product, quantity, price], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, orderId: this.lastID });
    });
});

app.get('/api/orders', (req, res) => {
    db.all('SELECT * FROM orders ORDER BY id DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.put('/api/orders/:id', (req, res) => {
    const { status, notes } = req.body;
    const { id } = req.params;
    db.run(`UPDATE orders SET status = ?, notes = ? WHERE id = ?`, [status, notes, id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

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
    console.log(`Server is running on port ${PORT}`);
});
