/* server.js - Backend Seguro */
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
const server = http.createServer(app);

// --- CONFIGURACIÓN DE SEGURIDAD ---
const PASSWORD_APP = "admin123@"; // 🔑 CAMBIA ESTA CONTRASEÑA
const COOKIE_NAME = "usaquenluis";

// Configuración Socket.io (Permite conexiones desde cualquier origen para pruebas)
const io = new Server(server, { cors: { origin: "*" } });

// --- BASE DE DATOS EN MEMORIA ---
let contactsDB = [];
// CAMBIA esto por lo siguiente:
let botFlows = {
    "default": [ // Este es el flujo que se ejecuta si no entiende la palabra
        { id: 1, type: 'reply', content: 'No entendí tu mensaje. ¿Puedes ser más específico?' }
    ],
    "hola": [   // Si el cliente escribe "hola", va esto
        { id: 1, type: 'reply', content: '¡Hola! Bienvenido a nuestra tienda.' },
        { id: 2, type: 'reply', content: 'Escribe PRECIO para ver las tarifas.' }
    ],
    "precio": [ // Si escribe "precio", va esto
        { id: 1, type: 'reply', content: 'Nuestro plan básico cuesta $10/mes.' },
        { id: 2, type: 'reply', content: '¿Te interesa?' }
    ]
};

let config = {
    token: 'EAAaf9V8OmS4BQ7eGIFzlXF9GfwDZAeatjm6kXUW9W1olT4TuSsBMtHwRlg2cHevRvJzl8ZB1LtKebYi1500JyZBlIZBC8Eby9dTBAsw6nhoArSZAyp8eMqkf39nwNCJpAAS7f6uZB2355YPUtt4l8EjPXm2RsQSJ2NsXYHaFcoDaWj5Ou7GZC8lWSZBlUsZBZAoHkAACScULGk1npxXuZCMdCnKZBFgjA9FEZCZAiNjitGJUjDHVLdBRTkJhXV72hxG6ijQnRPTvJf0aS8TxTZCGt8ZAQXgMMQZDZD',
    phoneId: '966405619898658',
    verifyToken: 'EAAaf9V8OmS4BQ7eGIFzlXF9GfwDZAeatjm6kXUW9W1olT4TuSsBMtHwRlg2cHevRvJzl8ZB1LtKebYi1500JyZBlIZBC8Eby9dTBAsw6nhoArSZAyp8eMqkf39nwNCJpAAS7f6uZB2355YPUtt4l8EjPXm2RsQSJ2NsXYHaFcoDaWj5Ou7GZC8lWSZBlUsZBZAoHkAACScULGk1npxXuZCMdCnKZBFgjA9FEZCZAiNjitGJUjDHVLdBRTkJhXV72hxG6ijQnRPTvJf0aS8TxTZCGt8ZAQXgMMQZDZD' // Token de verificación de Meta
};

// MIDDLEWARES
app.use(bodyParser.json());
app.use(cors());
app.use(cookieParser());


// --- RUTAS DE AUTENTICACIÓN ---


// Ruta para procesar el login
app.post('/do-login', (req, res) => {
    const { password } = req.body;
    if (password === PASSWORD_APP) {
        // Crea cookie válida por 24 horas (86400000 ms)
        res.cookie(COOKIE_NAME, PASSWORD_APP, { 
            maxAge: 86400000, 
            httpOnly: true, 
            secure: process.env.NODE_ENV === 'production' // Solo HTTPS en producción
        });
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Contraseña incorrecta' });
    }
});

// Ruta para cerrar sesión
app.get('/logout', (req, res) => {
    res.clearCookie(COOKIE_NAME);
    res.redirect('/');
});

// --- RUTAS DE LA API (PROTEGIDAS IMPLÍCITAMENTE POR EL FRONTEND) ---

app.post('/api/config', (req, res) => {
    config = { ...config, ...req.body };
    console.log('Config actualizada');
    res.send({ status: 'ok' });
});

// RUTA ACTUALIZADA PARA GUARDAR VARIOS FLUJOS
app.post('/api/flow', (req, res) => {
    // Ahora recibimos un objeto con claves (ej: { "hola": [...], "precio": [...] })
    botFlows = req.body.flows; 
    console.log('Flujos condicionales actualizados');
    res.send({ status: 'ok' });
});

app.get('/api/contacts', (req, res) => {
    res.json(contactsDB);
});

app.post('/api/send-message', async (req, res) => {
    try {
        const { to, text } = req.body;
        await sendWhatsAppMessage(to, text);
        io.emit('chat_update', { from: 'me', text: text, to: to });
        res.send({ status: 'sent' });
    } catch (error) {
        res.status(500).send({ error: error.message });
    }
});

// --- WEBHOOK DE WHATSAPP ---

app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === config.verifyToken) {
            console.log('Webhook verificado');
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    }
});

app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object) {
        if (body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
            const message = body.entry[0].changes[0].value.messages[0];
            const phone = message.from;
            const text = message.text.body;

            console.log(`Msg de ${phone}: ${text}`);

            updateContact(phone, text);
            io.emit('new_message', { from: phone, text: text });
            runBotLogic(phone);
        }
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

// --- LÓGICA DEL BOT ---

// LÓGICA INTELIGENTE DE DETECCIÓN DE PALABRAS CLAVE
async function runBotLogic(phone, text) {
    // Convertir mensaje a minúsculas para facilitar la comparación
    const userMsg = text.toLowerCase();
    
    // Por defecto, usamos el flujo "default"
    let selectedFlow = botFlows['default'];

    // Buscar si alguna palabra clave está en el mensaje
    for (const key in botFlows) {
        if (key !== 'default' && userMsg.includes(key)) {
            selectedFlow = botFlows[key];
            console.log(`Palabra clave "${key}" detectada. Ejecutando flujo.`);
            break; // Paramos en la primera coincidencia
        }
    }

    // Si no hay flujo seleccionado o el array está vacío, no hacer nada
    if (!selectedFlow || selectedFlow.length === 0) return;

    await new Promise(r => setTimeout(r, 500));

    // Ejecutar el flujo seleccionado
    for (const step of selectedFlow) {
        if (step.type === 'delay') await new Promise(r => setTimeout(r, step.content * 1000));
        else if (step.type === 'reply') {
            await sendWhatsAppMessage(phone, step.content);
            io.emit('chat_update', { from: 'bot', text: step.content, to: phone });
        }
        else if (step.type === 'tag') tagContact(phone, step.content);
    }
}

function sendWhatsAppMessage(to, text) {
    if (!config.token || !config.phoneId) throw new Error("Falta config API");
    return axios.post(`https://graph.facebook.com/v18.0/${config.phoneId}/messages`, {
        messaging_product: "whatsapp", to, type: "text", text: { body: text }
    }, { headers: { "Authorization": `Bearer ${config.token}` } });
}

function updateContact(phone, msg) {
    let c = contactsDB.find(x => x.phone === phone);
    if (!c) { c = { phone, name: phone, tags: [], lastActive: new Date().toLocaleString() }; contactsDB.unshift(c); }
    else { c.lastActive = new Date().toLocaleString(); }
}

function tagContact(phone, tag) {
    let c = contactsDB.find(x => x.phone === phone);
    if (c && !c.tags.includes(tag)) c.tags.push(tag);
}

// INICIAR SERVIDOR
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Servidor en puerto ${PORT}`);
});
