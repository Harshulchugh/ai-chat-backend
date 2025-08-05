const express = require('express');
const multer = require('multer');
const OpenAI = require('openai');
const cors = require('cors');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

// Initialize OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const ASSISTANT_ID = process.env.ASSISTANT_ID;

// Basic middleware
app.use(cors());
app.use(express.json());

// Configure multer for file uploads
const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 20 * 1024 * 1024 }
});

// Store active threads
const threads = new Map();

// Serve basic chat widget
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Chat Widget</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
        .chat { border: 1px solid #ddd; height: 400px; overflow-y: auto; padding: 10px; margin-bottom: 10px; }
        .message { margin: 10px 0; padding: 10px; border-radius: 5px; }
        .user { background: #e3f2fd; text-align: right; }
        .assistant { background: #f5f5f5; }
        .input-area { display: flex; gap: 10px; }
        input { flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 5px; }
        button { padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; }
    </style>
</head>
<body>
    <h1>Simple Chat Widget</h1>
    <div id="chat" class="chat">
        <div class="message assistant">Hello! How can I help you today?</div>
    </div>
    <div class="input-area">
        <input type="text" id="messageInput" placeholder="Type your message..." onkeypress="if(event.key==='Enter') sendMessage()">
        <button onclick="sendMessage()">Send</button>
    </div>

    <script>
        let threadId = null;

        async function initChat() {
            try {
                const response = await fetch('/api/chat/create', { method: 'POST' });
                const data = await response.json();
                threadId = data.thread_id;
                console.log('Chat initialized:', threadId);
            } catch (error) {
                console.error('Init error:', error);
                addMessage('Connection error. Please refresh.', 'assistant');
            }
        }

        async function sendMessage() {
            const input = document.getElementById('messageInput');
            const message = input.value.trim();
            if (!message) return;

            if (!threadId) await initChat();
            if (!threadId) return;

            addMessage(message, 'user');
            input.value = '';

            try {
                const response = await fetch('/api/chat/message', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ thread_id: threadId, message: message })
                });

                const data = await response.json();
                addMessage(data.response || 'Error: ' + (data.error || 'Unknown error'), 'assistant');
            } catch (error) {
                console.error('Send error:', error);
                addMessage('Error sending message. Check console.', 'assistant');
            }
        }

        function addMessage(content, sender) {
            const chat = document.getElementById('chat');
            const div = document.createElement('div');
            div.className = 'message ' + sender;
            div.textContent = content;
            chat.appendChild(div);
            chat.scrollTop = chat.scrollHeight;
        }

        window.onload = initChat;
    </script>
</body>
</html>
    `);
});

// Create chat thread
app.post('/api/chat/create', async (req, res) => {
    try {
        const thread = await openai.beta.threads.create();
        threads.set(thread.id, { created: new Date() });
        res.json({ thread_id: thread.id, status: 'created' });
    } catch (error) {
        console.error('Thread creation failed:', error);
        res.status(500).json({ error: 'Failed to create thread' });
    }
});

// Send message
app.post('/api/chat/message', async (req, res) => {
    try {
        const { thread_id, message } = req.body;

        console.log('Received message:', message, 'for thread:', thread_id);

        if (!thread_id || !message) {
            return res.status(400).json({ error: 'Missing thread_id or message' });
        }

        // Add message to thread
        await openai.beta.threads.messages.create(thread_id, {
            role: "user",
            content: message
        });

        // Run assistant
        const run = await openai.beta.threads.runs.create(thread_id, {
            assistant_id: ASSISTANT_ID
        });

        // Wait for completion
        let attempts = 0;
        while (attempts < 30) {
            const runStatus = await openai.beta.threads.runs.retrieve(thread_id, run.id);
            
            if (runStatus.status === 'completed') {
                const messages = await openai.beta.threads.messages.list(thread_id);
                const response = messages.data[0].content[0].text.value;
                return res.json({ response: response });
            } else if (runStatus.status === 'failed') {
                return res.status(500).json({ error: 'Assistant run failed' });
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
        }

        res.status(500).json({ error: 'Response timeout' });

    } catch (error) {
        console.error('Message error:', error);
        res.status(500).json({ error: error.message || 'Message processing failed' });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', assistant_id: ASSISTANT_ID ? 'set' : 'missing' });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`Assistant ID: ${ASSISTANT_ID || 'NOT SET'}`);
    console.log(`OpenAI API Key: ${process.env.OPENAI_API_KEY ? 'SET' : 'NOT SET'}`);
});
