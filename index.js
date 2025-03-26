const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const express = require('express');
const bodyParser = require('body-parser');
const QRCode = require('qrcode');
const axios = require('axios');
const app = express();

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
});

app.use(bodyParser.json());

let qrCodeImage = null;
let clientInfo = null;

client.on('qr', (qr) => {
    console.log('QR Code recebido. Acesse /qrcode-wpp para visualizar.');
    QRCode.toDataURL(qr, (err, url) => {
        if (err) {
            console.error('Erro ao gerar QR code:', err);
            qrCodeImage = null;
        } else {
            qrCodeImage = url;
        }
    });
});

client.on('message_create', message => {
    if (message.body === '!ping') {
        client.sendMessage(message.from, 'pong');
    }
});

client.on('ready', async () => {
    console.log('Cliente WhatsApp está pronto!');
    qrCodeImage = null;
    clientInfo = await client.getState();
});

client.on('authenticated', async () => {
    console.log('Cliente autenticado!');
    clientInfo = await client.getState();
});

client.on('message', async (message) => {
    console.log(`Mensagem recebida de ${message.from}: ${message.body}`);

    let quotedMessage = null;

    if (message.hasQuotedMsg) {
        try {
            const quoted = await message.getQuotedMessage();
            quotedMessage = {
                from: quoted.from,
                body: quoted.body,
                timestamp: quoted.timestamp
            };
        } catch (err) {
            console.error("Erro ao obter a mensagem respondida:", err);
        }
    }

    const isGroupMessage = message.from.endsWith('@g.us');

    axios.post('http://localhost:1880/whatsapp', {
        from: message.from,
        body: message.body,
        isGroup: isGroupMessage,
        quotedMessage: quotedMessage  // Adicionando mensagem respondida no payload
    }).then(() => {
        console.log('Mensagem enviada ao Node-RED.');
    }).catch((err) => {
        console.error('Erro ao enviar mensagem ao Node-RED:', err);
    });
});


// Função para buscar mensagens de um número específico
app.get('/fetch-messages', async (req, res) => {
    const { number } = req.query;
    
    if (!number) {
        return res.status(400).json({ error: 'O parâmetro "number" é obrigatório.' });
    }

    try {
        const chat = await client.getChatById(number);
        const messages = await chat.fetchMessages({ limit: 10 }); // Busca as últimas 10 mensagens
        
        const formattedMessages = messages.map(msg => ({
            id: msg.id.id,
            from: msg.from,
            body: msg.body,
            timestamp: msg.timestamp
        }));

        res.json({ success: true, messages: formattedMessages });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/send', async (req, res) => {
    const { to, message, imagePath } = req.body;

    if (!to || !message) {
        return res.status(400).json({ error: 'Parâmetros "to" e "message" são obrigatórios.' });
    }

    try {
        let chatId;
        
        if (to.includes('@g.us')) {
            chatId = to; // ID de grupo
        } else if (to.includes('@c.us')) {
            chatId = to; // ID de contato
        } else {
            chatId = `${to}@c.us`; // Formato padrão para números individuais
        }

        const chat = await client.getChatById(chatId);

        if (!chat) {
            return res.status(404).json({ success: false, error: 'Chat não encontrado.' });
        }

        if (imagePath) {
            const media = MessageMedia.fromFilePath(imagePath);
            await chat.sendMessage(media, { caption: message });
        } else {
            await chat.sendMessage(message);
        }

        res.json({ success: true, message: 'Mensagem enviada com sucesso!' });
    } catch (error) {
        console.error('Erro ao enviar mensagem:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});



app.listen(3000, () => {
    console.log('Servidor HTTP rodando na porta 3000.');
});

client.initialize();
