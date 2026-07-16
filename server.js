require('dotenv').config();
const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const app = express();
const PORT = process.env.PORT || 3000;
const COMMISSION_RATE = 0.07;
const JWT_SECRET = process.env.JWT_SECRET;
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

const db = new Database('marketplace.db');

db.exec(`
    CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        game TEXT NOT NULL,
        price INTEGER NOT NULL,
        owner TEXT NOT NULL DEFAULT 'unknown',
        sold INTEGER NOT NULL DEFAULT 0
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        balance INTEGER NOT NULL DEFAULT 0
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL,
        item_name TEXT NOT NULL,
        price INTEGER NOT NULL,
        commission INTEGER NOT NULL DEFAULT 0,
        buyer TEXT NOT NULL,
        seller TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender TEXT NOT NULL,
        receiver TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
`);

const count = db.prepare('SELECT COUNT(*) as count FROM items').get();
if (count.count === 0) {
    const insert = db.prepare('INSERT INTO items (name, game, price, owner) VALUES (?, ?, ?, ?)');
    insert.run('Меч огня', 'Minecraft', 500, 'admin');
    insert.run("Скин 'Тень'", 'Fortnite', 1200, 'admin');
    insert.run("Кейс 'Дракон'", 'CS2', 800, 'admin');
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

app.get('/api/items', (req, res) => {
    const items = db.prepare('SELECT * FROM items WHERE sold = 0').all();
    res.json(items);
});

app.post('/api/items', authenticateToken, (req, res) => {
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

    const insert = db.prepare('INSERT INTO items (name, game, price, owner) VALUES (?, ?, ?, ?)');
    const result = insert.run(name.trim(), game.trim(), price, owner);
    const newItem = db.prepare('SELECT * FROM items WHERE id = ?').get(result.lastInsertRowid);
    res.json(newItem);
});

app.delete('/api/items/:id', authenticateToken, (req, res) => {
    const { id } = req.params;
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    if (!item) {
        return res.status(404).json({ error: 'Товар не найден' });
    }
    if (item.owner !== req.user.username) {
        return res.status(403).json({ error: 'Это не твой товар' });
    }
    db.prepare('DELETE FROM items WHERE id = ?').run(id);
    res.json({ success: true });
});

app.post('/api/register', authLimiter, async (req, res) => {
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

    const existingUser = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (existingUser) {
        return res.status(400).json({ error: 'Такой пользователь уже существует' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const insert = db.prepare('INSERT INTO users (username, password, balance) VALUES (?, ?, ?)');
    insert.run(username, hashedPassword, 0);

    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, username, balance: 0, token });
});

app.post('/api/login', authLimiter, async (req, res) => {
    const { username, password } = req.body;

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
        return res.status(400).json({ error: 'Неверный логин или пароль' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
        return res.status(400).json({ error: 'Неверный логин или пароль' });
    }

    const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, username: user.username, balance: user.balance, token });
});

app.get('/api/wallet/:username', authenticateToken, (req, res) => {
    const { username } = req.params;
    if (username !== req.user.username) {
        return res.status(403).json({ error: 'Доступ запрещён' });
    }
    const user = db.prepare('SELECT balance FROM users WHERE username = ?').get(username);
    if (!user) {
        return res.status(404).json({ error: 'Пользователь не найден' });
    }
    res.json({ balance: user.balance });
});

app.post('/api/orders', authenticateToken, (req, res) => {
    const { item_id } = req.body;
    const buyer = req.user.username;

    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(item_id);
    if (!item) {
        return res.status(404).json({ error: 'Товар не найден' });
    }
    if (item.sold) {
        return res.status(400).json({ error: 'Товар уже продан' });
    }
    if (item.owner === buyer) {
        return res.status(400).json({ error: 'Нельзя купить свой же товар' });
    }

    const buyerUser = db.prepare('SELECT * FROM users WHERE username = ?').get(buyer);
    if (buyerUser.balance < item.price) {
        return res.status(400).json({ error: 'Недостаточно средств на балансе' });
    }

    const commission = Math.round(item.price * COMMISSION_RATE);

    db.prepare('UPDATE users SET balance = balance - ? WHERE username = ?').run(item.price, buyer);

    const insert = db.prepare('INSERT INTO orders (item_id, item_name, price, commission, buyer, seller) VALUES (?, ?, ?, ?, ?, ?)');
    const result = insert.run(item.id, item.name, item.price, commission, buyer, item.owner);

    db.prepare('UPDATE items SET sold = 1 WHERE id = ?').run(item.id);

    const newOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(result.lastInsertRowid);
    res.json(newOrder);
});

app.get('/api/orders/:username', authenticateToken, (req, res) => {
    const { username } = req.params;
    if (username !== req.user.username) {
        return res.status(403).json({ error: 'Доступ запрещён' });
    }
    const orders = db.prepare('SELECT * FROM orders WHERE buyer = ? OR seller = ? ORDER BY id DESC').all(username, username);
    res.json(orders);
});

app.put('/api/orders/:id/status', authenticateToken, (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const username = req.user.username;

    const validStatuses = ['pending', 'shipped', 'received'];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Неверный статус' });
    }

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!order) {
        return res.status(404).json({ error: 'Сделка не найдена' });
    }

    if (status === 'shipped' && order.seller !== username) {
        return res.status(403).json({ error: 'Только продавец может отметить отправку' });
    }
    if (status === 'received' && order.buyer !== username) {
        return res.status(403).json({ error: 'Только покупатель может подтвердить получение' });
    }

    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);

    if (status === 'received' && order.status !== 'received') {
        const payout = order.price - order.commission;
        db.prepare('UPDATE users SET balance = balance + ? WHERE username = ?').run(payout, order.seller);
    }

    const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    res.json(updated);
});

app.post('/api/messages', authenticateToken, (req, res) => {
    const { receiver, content } = req.body;
    const sender = req.user.username;

    if (!receiver || !content || !content.trim()) {
        return res.status(400).json({ error: 'Сообщение не может быть пустым' });
    }

    const insert = db.prepare('INSERT INTO messages (sender, receiver, content) VALUES (?, ?, ?)');
    const result = insert.run(sender, receiver, content.trim());
    const newMessage = db.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid);
    res.json(newMessage);
});

app.get('/api/messages/:user1/:user2', authenticateToken, (req, res) => {
    const { user1, user2 } = req.params;
    if (req.user.username !== user1 && req.user.username !== user2) {
        return res.status(403).json({ error: 'Доступ запрещён' });
    }
    const messages = db.prepare(`
        SELECT * FROM messages 
        WHERE (sender = ? AND receiver = ?) OR (sender = ? AND receiver = ?)
        ORDER BY id ASC
    `).all(user1, user2, user2, user1);
    res.json(messages);
});

app.get('/api/conversations/:username', authenticateToken, (req, res) => {
    const { username } = req.params;
    if (username !== req.user.username) {
        return res.status(403).json({ error: 'Доступ запрещён' });
    }
    const conversations = db.prepare(`
        SELECT 
            CASE WHEN sender = ? THEN receiver ELSE sender END as partner,
            MAX(id) as last_id
        FROM messages
        WHERE sender = ? OR receiver = ?
        GROUP BY partner
        ORDER BY last_id DESC
    `).all(username, username, username);

    const result = conversations.map(c => {
        const lastMessage = db.prepare('SELECT * FROM messages WHERE id = ?').get(c.last_id);
        return {
            partner: c.partner,
            lastContent: lastMessage.content,
            lastSender: lastMessage.sender
        };
    });

    res.json(result);
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

app.post('/api/payment/confirm', authenticateToken, (req, res) => {
    const { payment_id, amount } = req.body;
    const username = req.user.username;

    db.prepare('UPDATE users SET balance = balance + ? WHERE username = ?').run(amount, username);
    const updated = db.prepare('SELECT balance FROM users WHERE username = ?').get(username);

    res.json({ success: true, balance: updated.balance, payment_id });
});

app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});