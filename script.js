const API_URL = 'https://buy-sell-marketplace-kjz1.onrender.com';

let items = [];
let isLoggedIn = false;
let currentUsername = "";
let currentBalance = 0;
let authToken = "";
let authMode = "login";
let currentChatPartner = null;
let chatPollInterval = null;

function authHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + authToken
    };
}

function toggleMenu() {
    const menu = document.getElementById("dropdown-menu");
    menu.classList.toggle("active");
}

function renderItems(itemsToRender) {
    const container = document.getElementById("items-container");
    container.innerHTML = "";
    
    if (itemsToRender.length === 0) {
        container.innerHTML = "<p style='color: #aaa;'>Ничего не найдено</p>";
        return;
    }

    itemsToRender.forEach(item => {
        const itemDiv = document.createElement("div");
        itemDiv.className = "item";
        
        const isOwner = isLoggedIn && item.owner === currentUsername;
        const canBuy = isLoggedIn && !isOwner;
        
        itemDiv.innerHTML = `
            <div class="item-name">${item.name}</div>
            <div class="item-game">${item.game}</div>
            <div class="item-price">${item.price} руб.</div>
            <div class="item-owner">Продавец: ${item.owner}</div>
            ${isOwner ? `<button class="delete-btn" onclick="deleteItem(${item.id})">Удалить</button>` : ''}
            ${canBuy ? `<button class="buy-btn" onclick="buyItem(${item.id})">Купить</button><button class="message-seller-btn" onclick="startChatWith('${item.owner}')">Написать</button>` : ''}
        `;
        container.appendChild(itemDiv);
    });
}

function filterItems() {
    const query = document.getElementById("search-input").value.toLowerCase();
    const filtered = items.filter(item => 
        item.name.toLowerCase().includes(query) || 
        item.game.toLowerCase().includes(query)
    );
    renderItems(filtered);
}

function loadItems() {
    fetch(`${API_URL}/api/items`)
        .then(response => response.json())
        .then(data => {
            items = data;
            renderItems(items);
        })
        .catch(error => {
            console.error('Ошибка загрузки товаров:', error);
            document.getElementById("items-container").innerHTML = "<p style='color: #e74c3c;'>Не удалось загрузить товары. Проверь, запущен ли сервер.</p>";
        });
}

loadItems();

document.getElementById("search-input").addEventListener("input", filterItems);

document.addEventListener("click", function(event) {
    const profileContainer = document.querySelector(".profile-container");
    if (!profileContainer.contains(event.target)) {
        document.getElementById("dropdown-menu").classList.remove("active");
    }
});

function openAuthForm(mode) {
    authMode = mode;
    document.getElementById("auth-title").textContent = mode === "login" ? "Вход" : "Регистрация";
    document.getElementById("auth-submit-btn").textContent = mode === "login" ? "Войти" : "Создать аккаунт";
    document.getElementById("auth-error").style.display = "none";
    document.getElementById("auth-username").value = "";
    document.getElementById("auth-password").value = "";
    document.getElementById("auth-overlay").style.display = "flex";
    document.getElementById("dropdown-menu").classList.remove("active");
}

function closeAuthForm() {
    document.getElementById("auth-overlay").style.display = "none";
}

function submitAuth() {
    const username = document.getElementById("auth-username").value;
    const password = document.getElementById("auth-password").value;
    const errorEl = document.getElementById("auth-error");

    if (!username || !password) {
        errorEl.textContent = "Заполни все поля";
        errorEl.style.display = "block";
        return;
    }

    const endpoint = authMode === "login" ? "/api/login" : "/api/register";

    fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            errorEl.textContent = data.error;
            errorEl.style.display = "block";
        } else {
            isLoggedIn = true;
            currentUsername = data.username;
            currentBalance = data.balance;
            authToken = data.token;
            updateProfileMenu();
            closeAuthForm();
            loadItems();
        }
    })
    .catch(error => {
        console.error('Ошибка:', error);
        errorEl.textContent = "Ошибка соединения с сервером";
        errorEl.style.display = "block";
    });
}

function logout() {
    isLoggedIn = false;
    currentUsername = "";
    currentBalance = 0;
    authToken = "";
    stopChatPolling();
    updateProfileMenu();
    loadItems();
}

function goToProfile() {
    alert("Профиль: " + currentUsername + "\nБаланс: " + currentBalance + " руб.");
}

function goToSettings() {
    alert("Здесь будут настройки");
}

function updateProfileMenu() {
    document.getElementById("login-btn").style.display = isLoggedIn ? "none" : "block";
    document.getElementById("register-btn").style.display = isLoggedIn ? "none" : "block";
    document.getElementById("profile-btn").style.display = isLoggedIn ? "block" : "none";
    document.getElementById("orders-btn").style.display = isLoggedIn ? "block" : "none";
    document.getElementById("messages-btn").style.display = isLoggedIn ? "block" : "none";
    document.getElementById("deposit-btn").style.display = isLoggedIn ? "block" : "none";
    document.getElementById("settings-btn").style.display = isLoggedIn ? "block" : "none";
    document.getElementById("logout-btn").style.display = isLoggedIn ? "block" : "none";
    document.getElementById("wallet-display").style.display = isLoggedIn ? "block" : "none";
    document.getElementById("wallet-balance").textContent = currentBalance;
}

function toggleAddForm() {
    const form = document.getElementById("add-item-form");
    form.style.display = form.style.display === "none" ? "flex" : "none";
}

function submitNewItem() {
    const name = document.getElementById("new-item-name").value;
    const game = document.getElementById("new-item-game").value;
    const price = document.getElementById("new-item-price").value;

    if (!name || !game || !price) {
        alert("Заполни все поля!");
        return;
    }

    if (!isLoggedIn) {
        alert("Нужно войти в аккаунт, чтобы добавить товар");
        return;
    }

    fetch(`${API_URL}/api/items`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name, game, price: parseInt(price) })
    })
    .then(response => response.json())
    .then(() => {
        document.getElementById("new-item-name").value = "";
        document.getElementById("new-item-game").value = "";
        document.getElementById("new-item-price").value = "";
        toggleAddForm();
        loadItems();
    })
    .catch(error => {
        console.error('Ошибка добавления товара:', error);
        alert("Не удалось добавить товар. Проверь, запущен ли сервер.");
    });
}

function deleteItem(id) {
    if (!confirm("Точно удалить этот товар?")) return;
    
    fetch(`${API_URL}/api/items/${id}`, {
        method: 'DELETE',
        headers: authHeaders()
    })
    .then(response => response.json())
    .then(() => {
        loadItems();
    })
    .catch(error => {
        console.error('Ошибка удаления товара:', error);
        alert("Не удалось удалить товар");
    });
}

function buyItem(id) {
    if (!confirm("Купить этот товар?")) return;

    fetch(`${API_URL}/api/orders`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ item_id: id })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            alert(data.error);
        } else {
            alert("Покупка оформлена! Смотри статус в разделе 'Мои сделки'.");
            refreshBalance();
            loadItems();
        }
    })
    .catch(error => {
        console.error('Ошибка покупки:', error);
        alert("Не удалось оформить покупку");
    });
}

function refreshBalance() {
    fetch(`${API_URL}/api/wallet/${currentUsername}`, {
        headers: authHeaders()
    })
        .then(response => response.json())
        .then(data => {
            currentBalance = data.balance;
            document.getElementById("wallet-balance").textContent = currentBalance;
        })
        .catch(error => console.error('Ошибка обновления баланса:', error));
}

function openDepositForm() {
    document.getElementById("dropdown-menu").classList.remove("active");
    document.getElementById("deposit-amount").value = "";
    document.getElementById("deposit-overlay").style.display = "flex";
}

function closeDepositForm() {
    document.getElementById("deposit-overlay").style.display = "none";
}

function submitDeposit() {
    const amount = parseInt(document.getElementById("deposit-amount").value);

    if (!amount || amount <= 0) {
        alert("Введи корректную сумму");
        return;
    }

    fetch(`${API_URL}/api/payment/create`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ amount })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            alert(data.error);
            return;
        }
        if (confirm(`Тестовая оплата: пополнить баланс на ${amount} руб.?\n(В будущем здесь откроется настоящая страница оплаты)`)) {
            return fetch(`${API_URL}/api/payment/confirm`, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ payment_id: data.payment_id, amount })
            })
            .then(response => response.json())
            .then(result => {
                currentBalance = result.balance;
                document.getElementById("wallet-balance").textContent = currentBalance;
                closeDepositForm();
                alert("Баланс пополнен!");
            });
        }
    })
    .catch(error => {
        console.error('Ошибка пополнения:', error);
        alert("Не удалось пополнить баланс");
    });
}

function openOrdersOverlay() {
    document.getElementById("dropdown-menu").classList.remove("active");
    document.getElementById("orders-overlay").style.display = "flex";
    loadOrders();
}

function closeOrdersOverlay() {
    document.getElementById("orders-overlay").style.display = "none";
}

function loadOrders() {
    fetch(`${API_URL}/api/orders/${currentUsername}`, {
        headers: authHeaders()
    })
        .then(response => response.json())
        .then(orders => {
            renderOrders(orders);
        })
        .catch(error => {
            console.error('Ошибка загрузки сделок:', error);
        });
}

function renderOrders(orders) {
    const container = document.getElementById("orders-list");
    container.innerHTML = "";

    if (orders.length === 0) {
        container.innerHTML = "<p style='color:#aaa;'>Сделок пока нет</p>";
        return;
    }

    const statusLabels = {
        pending: "В ожидании отправки",
        shipped: "Отправлено",
        received: "Получено"
    };

    orders.forEach(order => {
        const isBuyer = order.buyer === currentUsername;
        const role = isBuyer ? "Покупка" : "Продажа";
        const otherParty = isBuyer ? order.seller : order.buyer;
        const payout = order.price - order.commission;

        let actionButton = "";
        if (!isBuyer && order.status === "pending") {
            actionButton = `<button class="order-action-btn" onclick="updateOrderStatus(${order.id}, 'shipped')">Отметить отправленным</button>`;
        }
        if (isBuyer && order.status === "shipped") {
            actionButton = `<button class="order-action-btn" onclick="updateOrderStatus(${order.id}, 'received')">Подтвердить получение</button>`;
        }

        const card = document.createElement("div");
        card.className = "order-card";
        card.innerHTML = `
            <p><strong>${role}:</strong> ${order.item_name} — ${order.price} руб.</p>
            <p>${isBuyer ? "Продавец" : "Покупатель"}: ${otherParty}</p>
            ${!isBuyer ? `<p>К получению: ${payout} руб. (комиссия ${order.commission} руб.)</p>` : ''}
            <p>Статус: <span class="order-status ${order.status === 'received' ? 'received' : ''}">${statusLabels[order.status]}</span></p>
            ${actionButton}
        `;
        container.appendChild(card);
    });
}

function updateOrderStatus(orderId, newStatus) {
    fetch(`${API_URL}/api/orders/${orderId}/status`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ status: newStatus })
    })
    .then(response => response.json())
    .then(() => {
        loadOrders();
        refreshBalance();
    })
    .catch(error => {
        console.error('Ошибка обновления статуса:', error);
        alert("Не удалось обновить статус");
    });
}

function openMessagesOverlay() {
    document.getElementById("dropdown-menu").classList.remove("active");
    document.getElementById("messages-overlay").style.display = "flex";
    loadConversations();
}

function closeMessagesOverlay() {
    document.getElementById("messages-overlay").style.display = "none";
    stopChatPolling();
    currentChatPartner = null;
}

function loadConversations() {
    fetch(`${API_URL}/api/conversations/${currentUsername}`, {
        headers: authHeaders()
    })
        .then(response => response.json())
        .then(conversations => {
            renderConversations(conversations);
        })
        .catch(error => console.error('Ошибка загрузки переписок:', error));
}

function renderConversations(conversations) {
    const container = document.getElementById("conversations-list");
    container.innerHTML = "";

    if (conversations.length === 0) {
        container.innerHTML = "<p style='color:#aaa; font-size:13px;'>Переписок пока нет</p>";
        return;
    }

    conversations.forEach(conv => {
        const div = document.createElement("div");
        div.className = "conversation-item" + (conv.partner === currentChatPartner ? " active" : "");
        const prefix = conv.lastSender === currentUsername ? "Вы: " : "";
        div.innerHTML = `
            <div class="partner-name">${conv.partner}</div>
            <div class="last-msg">${prefix}${conv.lastContent}</div>
        `;
        div.onclick = () => openChatWith(conv.partner);
        container.appendChild(div);
    });
}

function startChatWith(partner) {
    document.getElementById("messages-overlay").style.display = "flex";
    loadConversations();
    openChatWith(partner);
}

function openChatWith(partner) {
    currentChatPartner = partner;
    document.getElementById("chat-header").textContent = "Чат с " + partner;
    document.getElementById("chat-input-row").style.display = "flex";
    loadChatMessages();
    stopChatPolling();
    chatPollInterval = setInterval(loadChatMessages, 3000);
}

function loadChatMessages() {
    if (!currentChatPartner) return;
    fetch(`${API_URL}/api/messages/${currentUsername}/${currentChatPartner}`, {
        headers: authHeaders()
    })
        .then(response => response.json())
        .then(messages => {
            renderChatMessages(messages);
        })
        .catch(error => console.error('Ошибка загрузки сообщений:', error));
}

function renderChatMessages(messages) {
    const container = document.getElementById("chat-messages");
    container.innerHTML = "";

    messages.forEach(msg => {
        const div = document.createElement("div");
        div.className = "chat-message " + (msg.sender === currentUsername ? "mine" : "theirs");
        div.textContent = msg.content;
        container.appendChild(div);
    });

    container.scrollTop = container.scrollHeight;
}

function sendChatMessage() {
    const input = document.getElementById("chat-input");
    const content = input.value.trim();

    if (!content || !currentChatPartner) return;

    fetch(`${API_URL}/api/messages`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ receiver: currentChatPartner, content })
    })
    .then(response => response.json())
    .then(() => {
        input.value = "";
        loadChatMessages();
        loadConversations();
    })
    .catch(error => {
        console.error('Ошибка отправки сообщения:', error);
        alert("Не удалось отправить сообщение");
    });
}

document.addEventListener("DOMContentLoaded", () => {
    const chatInput = document.getElementById("chat-input");
    if (chatInput) {
        chatInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") sendChatMessage();
        });
    }
});

function stopChatPolling() {
    if (chatPollInterval) {
        clearInterval(chatPollInterval);
        chatPollInterval = null;
    }
}
