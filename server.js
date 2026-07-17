require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const app = express();
const PORT = process.env.PORT || 3000;
const COMMISSION_RATE = 0.07;
const JWT_SECRET = process.env.JWT_SECRET;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: { error: 'Слишком много запросов, попробуй позже' }
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Слишком много попыток входа, попробуй через 15 минут' }
});

async function initDatabase() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS items (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            game TEXT NOT NULL,
            price INTEGER NOT NULL,
            owner TEXT NOT NULL DEFAULT 'unknown',
            sold INTEGER NOT NULL DEFAULT 0
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            balance INTEGER NOT NULL DEFAULT 0
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS orders (
            id SERIAL PRIMARY KEY,
            item_id INTEGER NOT NULL,
            item_name TEXT NOT NULL,
            price INTEGER NOT NULL,
            commission INTEGER NOT NULL DEFAULT 0,
            buyer TEXT NOT NULL,
            seller TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending'
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS messages (
            id SERIAL PRIMARY KEY,
            sender TEXT NOT NULL,
            receiver TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
    `);

    const countResult = await pool.query('SELECT COUNT(*) as count FROM items');
    if (parseInt(countResult.rows[0].count) === 0) {
        await pool.query(
            'INSERT INTO items (name, game, price, owner) VALUES ($1, $2, $3, $4)',
            ['Меч огня', 'Minecraft', 500, 'admin']
        );
        await pool.query(
            'INSERT INTO items (name, game, price, owner) VALUES ($1, $2, $3, $4)',
            ["Скин 'Тень'", 'Fortnite', 1200, 'admin']
        );
        await pool.query(
            'INSERT INTO items (name, game, price, owner) VALUES ($1, $2, $3, $4)',
            ["Кейс 'Дракон'", 'CS2', 800, 'admin']
        );
    }
}

app.use(express.json());
app.use(generalLimiter);

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, PUT');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
});

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Нужна авторизация' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Недействительный токен' });
        }
        req.user = user;
        next();
    });
}

function requireAdmin(req, res, next) {
    if (req.user.username !== process.env.ADMIN_USERNAME) {
        return res.status(403).json({ error: 'Доступ только для администратора' });
    }
    next();
}

app.get('/api/items', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM items WHERE sold = 0');
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/items', authenticateToken, async (req, res) => {
    try {
        const { name, game, price } = req.body;
        const owner = req.user.username;

        if (!name || !game || typeof name !== 'string' || typeof game !== 'string') {
            return res.status(400).json({ error: 'Заполни название и игру' });
        }
        if (name.length > 100 || game.length > 50) {
            return res.status(400).json({ error: 'Слишком длинное название' });
        }
        if (!Number.isInteger(price) || price <= 0 || price > 1000000) {
            return res.status(400).json({ error: 'Некорректная цена' });
        }

        const result = await pool.query(
            'INSERT INTO items (name, game, price, owner) VALUES ($1, $2, $3, $4) RETURNING *',
            [name.trim(), game.trim(), price, owner]
        );
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.delete('/api/items/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const itemResult = await pool.query('SELECT * FROM items WHERE id = $1', [id]);
        const item = itemResult.rows[0];

        if (!item) {
            return res.status(404).json({ error: 'Товар не найден' });
        }
        if (item.owner !== req.user.username) {
            return res.status(403).json({ error: 'Это не твой товар' });
        }

        await pool.query('DELETE FROM items WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/register', authLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
            return res.status(400).json({ error: 'Заполни все поля' });
        }
        if (username.length < 3 || username.length > 20) {
            return res.status(400).json({ error: 'Имя пользователя должно быть от 3 до 20 символов' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'Пароль должен быть минимум 6 символов' });
        }

        const existingResult = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (existingResult.rows.length > 0) {
            return res.status(400).json({ error: 'Такой пользователь уже существует' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query(
            'INSERT INTO users (username, password, balance) VALUES ($1, $2, $3)',
            [username, hashedPassword, 0]
        );

        const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
        const isAdmin = username === process.env.ADMIN_USERNAME;
        res.json({ success: true, username, balance: 0, token, isAdmin });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/login', authLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;

        const userResult = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        const user = userResult.rows[0];

        if (!user) {
            return res.status(400).json({ error: 'Неверный логин или пароль' });
        }

        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return res.status(400).json({ error: 'Неверный логин или пароль' });
        }

        const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '7d' });
        const isAdmin = user.username === process.env.ADMIN_USERNAME;
        res.json({ success: true, username: user.username, balance: user.balance, token, isAdmin });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.get('/api/wallet/:username', authenticateToken, async (req, res) => {
    try {
        const { username } = req.params;
        if (username !== req.user.username) {
            return res.status(403).json({ error: 'Доступ запрещён' });
        }
        const result = await pool.query('SELECT balance FROM users WHERE username = $1', [username]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        res.json({ balance: result.rows[0].balance });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/orders', authenticateToken, async (req, res) => {
    try {
        const { item_id } = req.body;
        const buyer = req.user.username;

        const itemResult = await pool.query('SELECT * FROM items WHERE id = $1', [item_id]);
        const item = itemResult.rows[0];

        if (!item) {
            return res.status(404).json({ error: 'Товар не найден' });
        }
        if (item.sold) {
            return res.status(400).json({ error: 'Товар уже продан' });
        }
        if (item.owner === buyer) {
            return res.status(400).json({ error: 'Нельзя купить свой же товар' });
        }

        const buyerResult = await pool.query('SELECT * FROM users WHERE username = $1', [buyer]);
        const buyerUser = buyerResult.rows[0];

        if (buyerUser.balance < item.price) {
            return res.status(400).json({ error: 'Недостаточно средств на балансе' });
        }

        const commission = Math.round(item.price * COMMISSION_RATE);

        await pool.query('UPDATE users SET balance = balance - $1 WHERE username = $2', [item.price, buyer]);

        const orderResult = await pool.query(
            'INSERT INTO orders (item_id, item_name, price, commission, buyer, seller) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [item.id, item.name, item.price, commission, buyer, item.owner]
        );

        await pool.query('UPDATE items SET sold = 1 WHERE id = $1', [item.id]);

        res.json(orderResult.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.get('/api/orders/:username', authenticateToken, async (req, res) => {
    try {
        const { username } = req.params;
        if (username !== req.user.username) {
            return res.status(403).json({ error: 'Доступ запрещён' });
        }
        const result = await pool.query(
            'SELECT * FROM orders WHERE buyer = $1 OR seller = $1 ORDER BY id DESC',
            [username]
        );
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.put('/api/orders/:id/status', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const username = req.user.username;

        const validStatuses = ['pending', 'shipped', 'received'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Неверный статус' });
        }

        const orderResult = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
        const order = orderResult.rows[0];

        if (!order) {
            return res.status(404).json({ error: 'Сделка не найдена' });
        }

        if (status === 'shipped' && order.seller !== username) {
            return res.status(403).json({ error: 'Только продавец может отметить отправку' });
        }
        if (status === 'received' && order.buyer !== username) {
            return res.status(403).json({ error: 'Только покупатель может подтвердить получение' });
        }

        await pool.query('UPDATE orders SET status = $1 WHERE id = $2', [status, id]);

        if (status === 'received' && order.status !== 'received') {
            const payout = order.price - order.commission;
            await pool.query('UPDATE users SET balance = balance + $1 WHERE username = $2', [payout, order.seller]);
        }

        const updatedResult = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
        res.json(updatedResult.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.delete('/api/orders/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { action } = req.body;

        const orderResult = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
        const order = orderResult.rows[0];

        if (!order) {
            return res.status(404).json({ error: 'Сделка не найдена' });
        }

        if (action === 'refund') {
            await pool.query('UPDATE users SET balance = balance + $1 WHERE username = $2', [order.price, order.buyer]);

            if (order.status === 'received') {
                const payout = order.price - order.commission;
                await pool.query('UPDATE users SET balance = balance - $1 WHERE username = $2', [payout, order.seller]);
            }

            await pool.query('UPDATE items SET sold = 0 WHERE id = $1', [order.item_id]);
        }

        await pool.query('DELETE FROM orders WHERE id = $1', [id]);
        res.json({ success: true, action: action || 'delete' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/messages', authenticateToken, async (req, res) => {
    try {
        const { receiver, content } = req.body;
        const sender = req.user.username;

        if (!receiver || !content || !content.trim()) {
            return res.status(400).json({ error: 'Сообщение не может быть пустым' });
        }

        const result = await pool.query(
            'INSERT INTO messages (sender, receiver, content) VALUES ($1, $2, $3) RETURNING *',
            [sender, receiver, content.trim()]
        );
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.get('/api/messages/:user1/:user2', authenticateToken, async (req, res) => {
    try {
        const { user1, user2 } = req.params;
        if (req.user.username !== user1 && req.user.username !== user2) {
            return res.status(403).json({ error: 'Доступ запрещён' });
        }
        const result = await pool.query(
            `SELECT * FROM messages 
             WHERE (sender = $1 AND receiver = $2) OR (sender = $2 AND receiver = $1)
             ORDER BY id ASC`,
            [user1, user2]
        );
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.get('/api/conversations/:username', authenticateToken, async (req, res) => {
    try {
        const { username } = req.params;
        if (username !== req.user.username) {
            return res.status(403).json({ error: 'Доступ запрещён' });
        }

        const convResult = await pool.query(
            `SELECT 
                CASE WHEN sender = $1 THEN receiver ELSE sender END as partner,
                MAX(id) as last_id
            FROM messages
            WHERE sender = $1 OR receiver = $1
            GROUP BY partner
            ORDER BY last_id DESC`,
            [username]
        );

        const result = [];
        for (const c of convResult.rows) {
            const msgResult = await pool.query('SELECT * FROM messages WHERE id = $1', [c.last_id]);
            const lastMessage = msgResult.rows[0];
            result.push({
                partner: c.partner,
                lastContent: lastMessage.content,
                lastSender: lastMessage.sender
            });
        }

        res.json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/payment/create', authenticateToken, (req, res) => {
    const { amount } = req.body;
    const username = req.user.username;

    if (!Number.isInteger(amount) || amount <= 0 || amount > 500000) {
        return res.status(400).json({ error: 'Некорректная сумма (максимум 500000 руб.)' });
    }

    const fakePaymentId = 'pay_' + Date.now();

    res.json({
        payment_id: fakePaymentId,
        amount: amount,
        username: username,
        status: 'pending'
    });
});

app.post('/api/payment/confirm', authenticateToken, async (req, res) => {
    try {
        const { payment_id, amount } = req.body;
        const username = req.user.username;

        await pool.query('UPDATE users SET balance = balance + $1 WHERE username = $2', [amount, username]);
        const result = await pool.query('SELECT balance FROM users WHERE username = $1', [username]);

        res.json({ success: true, balance: result.rows[0].balance, payment_id });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

initDatabase()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Сервер запущен на http://localhost:${PORT}`);
        });
    })
    .catch(error => {
        console.error('Ошибка инициализации базы данных:', error);
    });
