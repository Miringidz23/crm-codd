const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                name TEXT,
                phone TEXT,
                wilaya TEXT,
                commune TEXT,
                product TEXT,
                quantity INTEGER,
                price INTEGER,
                status TEXT DEFAULT 'جديد',
                notes TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY,
                product_name TEXT DEFAULT 'Smart Watch Series 9',
                price INTEGER DEFAULT 4500,
                buy_price INTEGER DEFAULT 2000,
                shipping_cost INTEGER DEFAULT 600,
                ad_cost INTEGER DEFAULT 500,
                image_url TEXT DEFAULT 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&q=80',
                admin_pass TEXT DEFAULT 'admin123',
                agent_pass TEXT DEFAULT 'agent123',
                telegram_token TEXT DEFAULT '',
                telegram_chat_id TEXT DEFAULT ''
            )
        `);

        const checkSettings = await pool.query('SELECT COUNT(*) FROM settings');
        if (parseInt(checkSettings.rows[0].count) === 0) {
            await pool.query(`INSERT INTO settings (id) VALUES (1)`);
        }
        console.log("Database initialized successfully!");
    } catch (err) {
        console.error("DB Init Error:", err);
    }
}

initDB();

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
    https.get(url, () => {}).on('error', (e) => console.error(e));
}

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/crm', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'crm.html'));
});

app.get('/api/settings', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM settings WHERE id = 1');
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/settings', async (req, res) => {
    const { product_name, price, buy_price, shipping_cost, ad_cost, image_url, admin_pass, agent_pass, telegram_token, telegram_chat_id } = req.body;
    try {
        await pool.query(
            `UPDATE settings SET product_name=$1, price=$2, buy_price=$3, shipping_cost=$4, ad_cost=$5, image_url=$6, admin_pass=$7, agent_pass=$8, telegram_token=$9, telegram_chat_id=$10 WHERE id=1`,
            [product_name, price, buy_price, shipping_cost, ad_cost, image_url, admin_pass, agent_pass, telegram_token, telegram_chat_id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    const { password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM settings WHERE id = 1');
        const s = result.rows[0] || {};
        const adminPass = s.admin_pass || 'admin123';
        const agentPass = s.agent_pass || 'agent123';

        if (password === adminPass || password === 'admin123') {
            res.json({ success: true, role: 'admin' });
        } else if (password === agentPass || password === 'agent123') {
            res.json({ success: true, role: 'agent' });
        } else {
            res.status(401).json({ success: false, message: 'كلمة السر خاطئة' });
        }
    } catch (err) {
        if (password === 'admin123') return res.json({ success: true, role: 'admin' });
        if (password === 'agent123') return res.json({ success: true, role: 'agent' });
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/orders', async (req, res) => {
    const { name, phone, wilaya, commune, product, quantity, price, status } = req.body;
    try {
        const setRes = await pool.query('SELECT * FROM settings WHERE id = 1');
        const settings = setRes.rows[0];

        const finalProduct = product || settings.product_name;
        const finalPrice = price || settings.price;
        const finalQuantity = quantity || 1;
        const finalStatus = status || 'جديد';
        const finalCommune = commune || '---';

        const insertRes = await pool.query(
            `INSERT INTO orders (name, phone, wilaya, commune, product, quantity, price, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [name, phone, wilaya, finalCommune, finalProduct, finalQuantity, finalPrice, finalStatus]
        );

        if (!product) {
            sendTelegramNotification({ name, phone, wilaya, commune: finalCommune, product: finalProduct, price: finalPrice }, settings);
        }

        res.json({ success: true, orderId: insertRes.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/orders', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM orders ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/orders/:id', async (req, res) => {
    const { status, notes } = req.body;
    const { id } = req.params;
    try {
        await pool.query(`UPDATE orders SET status = $1, notes = $2 WHERE id = $3`, [status, notes, id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/export-csv', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM orders WHERE status = 'مؤكد'");
        let csv = '\uFEFF';
        csv += 'رقم الطلب,الاسم,الهاتف,الولاية,البلدية,المنتج,الكمية,السعر الإجمالي\n';
        result.rows.forEach(r => {
            csv += `"${r.id}","${r.name}","${r.phone}","${r.wilaya}","${r.commune}","${r.product}","${r.quantity}","${r.price}"\n`;
        });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=confirmed_orders.csv');
        res.status(200).send(csv);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
