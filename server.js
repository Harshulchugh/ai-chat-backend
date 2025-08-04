const express = require('express');
const multer = require('multer');
const OpenAI = require('openai');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ASSISTANT_ID = process.env.ASSISTANT_ID;

if (!OPENAI_API_KEY || !ASSISTANT_ID) {
    console.error('❌ Missing required environment variables:');
    console.error('   OPENAI_API_KEY=your_openai_api_key');
    console.error('   ASSISTANT_ID=your_assistant_id');
    process.exit(1);
}

// Initialize OpenAI
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Middleware
app.use(cors({
    origin: '*',
    credentials: true
}));
app.use(express.json());

// File upload configuration
const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, true)
});

// In-memory storage for threads
const threads = new Map();

// API Routes

// Create new chat thread
app.post('/api/chat/thread', async (req, res) => {
    try {
        const thread = await openai.beta.threads.create();
        threads.set(thread.id, { id: thread.id, created: new Date() });
        
        res.json({ 
            thread_id: thread.id,
            status: 'success'
        });
    } catch (error) {
        console.error('Thread creation failed:', error);
        res.status(500).json({ error: 'Failed to create chat thread' });
    }
});

// Upload file
app.post('/api/chat/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file provided' });
        }

        const file = await openai.files.create({
            file: fs.createReadStream(req.file.path),
            purpose: 'assistants'
        });

        fs.unlinkSync(req.file.path);

        res.json({
            file_id: file.id,
            filename: req.file.originalname,
            status: 'uploaded'
        });
    } catch (error) {
        console.error('File upload failed:', error);
        
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        
        res.status(500).json({ error: 'File upload failed' });
    }
});

// Send message to assistant
app.post('/api/chat/message', async (req, res) => {
    try {
        const { thread_id, message, file_ids = [] } = req.body;

        if (!thread_id || !threads.has(thread_id)) {
            return res.status(400).json({ error: 'Invalid thread ID' });
        }

        if (!message && file_ids.length === 0) {
            return res.status(400).json({ error: 'Message or files required' });
        }

        // Check for active runs and cancel them
        await cancelActiveRuns(thread_id);

        let content = [{ type: "text", text: message }];
        
        file_ids.forEach(fileId => {
            content.push({ type: "file", file_id: fileId });
        });

        await openai.beta.threads.messages.create(thread_id, {
            role: "user",
            content: content
        });

        const run = await openai.beta.threads.runs.create(thread_id, {
            assistant_id: ASSISTANT_ID
        });

        const result = await waitForCompletion(thread_id, run.id);

        if (result.error) {
            return res.status(500).json({ error: result.error });
        }

        res.json({
            response: result.message,
            thread_id: thread_id,
            status: 'completed'
        });

    } catch (error) {
        console.error('Message processing failed:', error);
        res.status(500).json({ error: 'Failed to process message' });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        assistant_id: ASSISTANT_ID ? 'configured' : 'missing',
        timestamp: new Date().toISOString()
    });
});

// Serve chat widget HTML
app.get('/', (req, res) => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Assistant Chat</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        .ai-chat-widget {
            width: 100%; max-width: 500px; height: 600px; margin: 0 auto;
            border: none; border-radius: 16px; display: flex; flex-direction: column;
            background: white; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            overflow: hidden; position: relative;
        }
        .chat-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white; padding: 20px; text-align: center; font-weight: 600; font-size: 16px;
            display: flex; align-items: center; justify-content: center; gap: 10px;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
        }
        .status-dot {
            width: 8px; height: 8px; border-radius: 50%; background: #4CAF50;
            animation: pulse 2s infinite;
        }
        @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.7; transform: scale(1.1); } }
        .chat-messages {
            flex: 1; overflow-y: auto; padding: 20px;
            background: linear-gradient(to bottom, #f8f9fa 0%, #e9ecef 100%);
            scrollbar-width: thin; scrollbar-color: #cbd5e0 transparent;
        }
        .chat-messages::-webkit-scrollbar { width: 6px; }
        .chat-messages::-webkit-scrollbar-track { background: transparent; }
        .chat-messages::-webkit-scrollbar-thumb { background: #cbd5e0; border-radius: 3px; }
        .message {
            margin-bottom: 16px; display: flex; align-items: flex-start; gap: 12px;
            animation: messageSlide 0.3s ease-out;
        }
        @keyframes messageSlide { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .message.user { flex-direction: row-reverse; }
        .message-content {
            max-width: 75%; padding: 12px 16px; border-radius: 20px;
            word-wrap: break-word; line-height: 1.4; position: relative;
        }
        .message.user .message-content {
            background: linear-gradient(135deg, #007bff 0%, #0056b3 100%);
            color: white; border-bottom-right-radius: 6px;
            box-shadow: 0 2px 8px rgba(0, 123, 255, 0.3);
        }
        .message.assistant .message-content {
            background: white; color: #333; border: 1px solid #e1e5e9;
            border-bottom-left-radius: 6px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }
        .message-avatar {
            width: 36px; height: 36px; border-radius: 50%; display: flex;
            align-items: center; justify-content: center; font-size: 12px;
            font-weight: bold; color: white; flex-shrink: 0;
        }
        .message.user .message-avatar { background: linear-gradient(135deg, #007bff 0%, #0056b3 100%); }
        .message.assistant .message-avatar { background: linear-gradient(135deg, #6c757d 0%, #495057 100%); }
        .chat-input-container { padding: 20px; background: white; border-top: 1px solid #e1e5e9; }
        .file-preview {
            background: #e3f2fd; border: 1px solid #bbdefb; border-radius: 12px;
            padding: 10px 12px; margin-bottom: 12px; display: flex;
            align-items: center; gap: 10px; font-size: 13px; color: #1976d2;
        }
        .file-preview .remove-file {
            margin-left: auto; cursor: pointer; color: #666; font-weight: bold;
            padding: 4px; border-radius: 50%; transition: all 0.2s;
        }
        .file-preview .remove-file:hover { background: #ffebee; color: #f44336; }
        .input-wrapper {
            display: flex; gap: 10px; align-items: flex-end; background: #f8f9fa;
            border-radius: 25px; padding: 4px; border: 2px solid #e9ecef;
            transition: border-color 0.2s;
        }
        .input-wrapper:focus-within { border-color: #007bff; }
        .chat-input {
            flex: 1; min-height: 40px; max-height: 120px; padding: 10px 16px;
            border: none; background: transparent; resize: none; font-family: inherit;
            font-size: 14px; line-height: 1.4; outline: none;
        }
        .input-controls { display: flex; gap: 6px; padding: 4px; }
        .control-btn {
            width: 36px; height: 36px; border-radius: 50%; border: none; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            transition: all 0.2s; font-size: 16px;
        }
        .file-btn { background: #6c757d; color: white; }
        .file-btn:hover { background: #5a6268; transform: scale(1.05); }
        .send-btn { background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; }
        .send-btn:hover:not(:disabled) { background: linear-gradient(135deg, #218838 0%, #1abc9c 100%); transform: scale(1.05); }
        .send-btn:disabled { background: #adb5bd; cursor: not-allowed; transform: none; }
        .file-input { display: none; }
        .typing-indicator {
            display: none; align-items: center; gap: 12px; padding: 16px 20px;
            color: #6c757d; font-style: italic; animation: fadeIn 0.3s ease-out;
        }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .typing-dots { display: flex; gap: 4px; }
        .typing-dot {
            width: 8px; height: 8px; background: #6c757d; border-radius: 50%;
            animation: typing 1.4s infinite ease-in-out;
        }
        .typing-dot:nth-child(1) { animation-delay: -0.32s; }
        .typing-dot:nth-child(2) { animation-delay: -0.16s; }
        @keyframes typing {
            0%, 80%, 100% { transform: scale(0.8); opacity: 0.5; }
            40% { transform: scale(1); opacity: 1; }
        }
        .file-attachment {
            background: rgba(255, 255, 255, 0.2); border: 1px solid rgba(255, 255, 255, 0.3);
            border-radius: 8px; padding: 8px 12px; margin-top: 8px; font-size: 12px;
            display: flex; align-items: center; gap: 8px;
        }
        .message.assistant .file-attachment { background: #f1f3f4; border: 1px solid #dadce0; color: #5f6368; }
        @media (max-width: 480px) {
            .ai-chat-widget { height: 500px; border-radius: 8px; }
            .message-content { max-width: 85%; }
            .chat-header { padding: 16px; font-size: 15px; }
        }
    </style>
</head>
<body>
    <div class="ai-chat-widget">
        <div class="chat-header">
            <div class="status-dot"></div>
            🤖 AI Assistant
        </div>
        
        <div class="chat-messages" id="chatMessages">
            <div class="message assistant">
                <div class="message-avatar">AI</div>
                <div class="message-content">
                    👋 Hello! I'm your AI assistant. I can help answer questions and analyze any files you'd like to share. How can I assist you today?
                </div>
            </div>
        </div>
        
        <div class="typing-indicator" id="typingIndicator">
            <div class="message-avatar">AI</div>
            <div>
                Thinking
                <div class="typing-dots">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
            </div>
        </div>
        
        <div class="chat-input-container">
            <div id="filePreview"></div>
            <div class="input-wrapper">
                <textarea id="chatInput" class="chat-input" placeholder="Type your message here..." rows="1"></textarea>
                <div class="input-controls">
                    <label for="fileInput" class="control-btn file-btn" title="Upload file">📎</label>
                    <input type="file" id="fileInput" class="file-input" multiple />
                    <button id="sendButton" class="control-btn send-btn" title="Send message">➤</button>
                </div>
            </div>
        </div>
    </div>

    <script>
        const CONFIG = { 
            API_BASE_URL: window.location.origin + '/api', 
            MAX_FILE_SIZE: 20 * 1024 * 1024 
        };
        
        let threadId = null;
        let currentFiles = [];
        let isProcessing = false;

        document.addEventListener('DOMContentLoaded', function() {
            initializeChat();
        });

        async function initializeChat() {
            try {
                const response = await fetch(CONFIG.API_BASE_URL + '/chat/thread', {
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    threadId = data.thread_id;
                    updateStatusIndicator(true);
                    setupEventListeners();
                } else {
                    throw new Error('Server error: ' + response.status);
                }
            } catch (error) {
                console.error('Initialization failed:', error);
                updateStatusIndicator(false);
                showError('Failed to connect to assistant. Please refresh the page.');
            }
        }

        function setupEventListeners() {
            const chatInput = document.getElementById('chatInput');
            const fileInput = document.getElementById('fileInput');
            const sendButton = document.getElementById('sendButton');
            
            chatInput.addEventListener('input', function() {
                this.style.height = 'auto';
                this.style.height = Math.min(this.scrollHeight, 120) + 'px';
            });

            chatInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' && !e.shiftKey && !isProcessing) {
                    e.preventDefault(); 
                    sendMessage();
                }
            });

            fileInput.addEventListener('change', function(e) {
                Array.from(e.target.files).forEach(function(file) {
                    if (file.size <= CONFIG.MAX_FILE_SIZE) {
                        addFileToQueue(file);
                    } else {
                        showError('File "' + file.name + '" is too large. Maximum size is 20MB.');
                    }
                });
                e.target.value = '';
            });
            
            sendButton.addEventListener('click', sendMessage);
        }

        function addFileToQueue(file) {
            currentFiles.push(file);
            const preview = document.createElement('div');
            preview.className = 'file-preview';
            preview.innerHTML = '<div>📄</div><span>' + file.name + ' (' + (file.size / 1024).toFixed(1) + ' KB)</span><span class="remove-file" data-filename="' + file.name + '">✕</span>';
            
            preview.querySelector('.remove-file').addEventListener('click', function() {
                removeFile(this.getAttribute('data-filename'));
            });
            
            document.getElementById('filePreview').appendChild(preview);
        }

        function removeFile(fileName) {
            currentFiles = currentFiles.filter(function(file) {
                return file.name !== fileName;
            });
            
            const previews = document.querySelectorAll('.file-preview');
            previews.forEach(function(preview) {
                if (preview.textContent.includes(fileName)) {
                    preview.remove();
                }
            });
        }

        function clearFiles() {
            currentFiles = [];
            document.getElementById('filePreview').innerHTML = '';
        }

        async function sendMessage() {
            if (isProcessing || !threadId) return;
            
            const input = document.getElementById('chatInput');
            const message = input.value.trim();
            
            if (!message && currentFiles.length === 0) return;

            isProcessing = true;
            document.getElementById('sendButton').disabled = true;

            if (message || currentFiles.length > 0) {
                addMessage('user', message, currentFiles.slice());
            }

            input.value = '';
            input.style.height = 'auto';
            const filesToSend = currentFiles.slice();
            clearFiles();
            showTypingIndicator();

            try {
                let fileIds = [];
                if (filesToSend.length > 0) {
                    fileIds = await uploadFiles(filesToSend);
                }

                const response = await fetch(CONFIG.API_BASE_URL + '/chat/message', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        thread_id: threadId,
                        message: message || "Please analyze the uploaded files.",
                        file_ids: fileIds
                    })
                });

                if (!response.ok) {
                    throw new Error('Failed to send message: ' + response.status);
                }
                
                const data = await response.json();
                
                if (data.error) {
                    throw new Error(data.error);
                }

                hideTypingIndicator();
                addMessage('assistant', data.response);
                
            } catch (error) {
                console.error('Send failed:', error);
                hideTypingIndicator();
                showError('Sorry, I encountered an error: ' + error.message);
            } finally {
                isProcessing = false;
                document.getElementById('sendButton').disabled = false;
            }
        }

        async function uploadFiles(files) {
            const fileIds = [];
            
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                try {
                    const formData = new FormData();
                    formData.append('file', file);
                    
                    const response = await fetch(CONFIG.API_BASE_URL + '/chat/upload', { 
                        method: 'POST', 
                        body: formData 
                    });
                    
                    if (response.ok) {
                        const data = await response.json();
                        fileIds.push(data.file_id);
                    }
                } catch (error) {
                    console.error('Upload error for ' + file.name + ':', error);
                }
            }
            
            return fileIds;
        }

        function addMessage(sender, content, files) {
            files = files || [];
            const container = document.getElementById('chatMessages');
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message ' + sender;
            
            let fileAttachments = '';
            if (files.length > 0) {
                fileAttachments = files.map(function(file) {
                    return '<div class="file-attachment"><div>📄</div><span>' + file.name + '</span></div>';
                }).join('');
            }
            
            messageDiv.innerHTML = '<div class="message-avatar">' + (sender === 'user' ? 'You' : 'AI') + '</div><div class="message-content">' + (content ? content.replace(/\\n/g, '<br>') : '') + fileAttachments + '</div>';
            container.appendChild(messageDiv);
            container.scrollTop = container.scrollHeight;
        }

        function showError(message) { 
            addMessage('assistant', '❌ ' + message); 
        }
        
        function showTypingIndicator() { 
            document.getElementById('typingIndicator').style.display = 'flex'; 
            const container = document.getElementById('chatMessages');
            container.scrollTop = container.scrollHeight; 
        }
        
        function hideTypingIndicator() { 
            document.getElementById('typingIndicator').style.display = 'none'; 
        }
        
        function updateStatusIndicator(connected) {
            const dot = document.querySelector('.status-dot');
            if (connected) { 
                dot.style.background = '#4CAF50'; 
                dot.style.animation = 'pulse 2s infinite'; 
            } else { 
                dot.style.background = '#f44336'; 
                dot.style.animation = 'none'; 
            }
        }
    </script>
</body>
</html>`;
    
    res.send(html);
});

// Helper function to cancel active runs
async function cancelActiveRuns(threadId) {
    try {
        const runs = await openai.beta.threads.runs.list(threadId);
        
        for (const run of runs.data) {
            if (['queued', 'in_progress', 'requires_action'].includes(run.status)) {
                console.log(`Cancelling active run: ${run.id}`);
                await openai.beta.threads.runs.cancel(threadId, run.id);
            }
        }
        
        // Wait a moment for cancellation to complete
        await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
        console.error('Error cancelling runs:', error);
        // Continue anyway - the new message might still work
    }
}

// Helper function to wait for assistant response
async function waitForCompletion(threadId, runId, maxAttempts = 30) {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const run = await openai.beta.threads.runs.retrieve(threadId, runId);
            
            if (run.status === 'completed') {
                const messages = await openai.beta.threads.messages.list(threadId, { limit: 1 });
                if (messages.data.length > 0) {
                    const content = messages.data[0].content;
                    let response = '';
                    content.forEach(item => {
                        if (item.type === 'text') {
                            response += item.text.value;
                        }
                    });
                    return { message: response.trim() };
                }
                return { error: 'No response received' };
            } 
            else if (['failed', 'cancelled', 'expired'].includes(run.status)) {
                return { error: `Assistant ${run.status}: ${run.last_error?.message || 'Unknown error'}` };
            }
            else if (run.status === 'requires_action') {
                return { error: 'Assistant requires action (not implemented)' };
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
            console.error('Error checking run status:', error);
            return { error: 'Failed to get response' };
        }
    }
    return { error: 'Response timeout' };
}

// Cleanup old threads
setInterval(() => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    for (const [id, thread] of threads.entries()) {
        if (thread.created < oneHourAgo) {
            threads.delete(id);
        }
    }
}, 60 * 60 * 1000);

app.listen(port, () => {
    console.log(`🚀 Chat widget server running on port ${port}`);
    console.log(`📱 Widget URL: http://localhost:${port}`);
    console.log(`🤖 Assistant ID: ${ASSISTANT_ID}`);
    console.log(`✅ Ready to embed in Typedream!`);
});

module.exports = app;
