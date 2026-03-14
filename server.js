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
let botFlow = [
    { id: 1, type: 'reply', content: '¡Hola! Gracias por escribirnos.' },
    { id: 2, type: 'tag', content: 'Cliente Nuevo' },
    { id: 3, type: 'delay', content: 1 },
    { id: 4, type: 'reply', content: '¿En qué podemos ayudarte?' }
];

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

app.post('/api/flow', (req, res) => {
    botFlow = req.body.flow;
    console.log('Flujo actualizado');
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

async function runBotLogic(phone) {
    await new Promise(r => setTimeout(r, 500));
    for (const step of botFlow) {
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
