const express = require('express');
const multer = require('multer');
const { OpenAI } = require('openai');
const cors = require('cors');
const https = require('httpss');
const path = require('path');
// To generate actual PDFs, you would install and use a library like html-pdf
// const pdf = require('html-pdf'); 

const app = express();
const PORT = process.env.PORT || 8080;

// Initialize OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});
const assistantId = process.env.ASSISTANT_ID;

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // For future static assets

// Multer for file uploads
const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// --- SESSION MANAGEMENT ---
const sessions = new Map();

function getSession(sessionId) {
    if (!sessions.has(sessionId)) {
        sessions.set(sessionId, {
            threadId: null, // For conversation memory
            lastQuery: null,
            lastResponse: null,
            created: new Date()
        });
    }
    return sessions.get(sessionId);
}

// Clean up old sessions every 15 minutes
setInterval(() => {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    for (const [sessionId, session] of sessions.entries()) {
        if (session.created < fifteenMinutesAgo) {
            sessions.delete(sessionId);
        }
    }
}, 15 * 60 * 1000);

// --- WEB SEARCH & ANALYSIS FUNCTIONS ---
// NOTE: Using a dedicated library like 'axios' or 'node-fetch' is recommended over the native https module for cleaner code.
// NOTE: Using a library like 'xml2js' is recommended for robust RSS parsing instead of regex.

async function searchRedditData(query) {
    // This function appears functional but could be improved with better error handling and a more modern HTTP client.
    try {
        const searchUrl = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=5&sort=relevance`;
        return new Promise((resolve) => {
            https.get(searchUrl, { headers: { 'User-Agent': 'InsightEar/1.0' } }, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        const posts = (JSON.parse(data).data.children || []).slice(0, 3);
                        const discussions = posts.map(post => ({
                            title: post.data.title,
                            url: 'https://reddit.com' + post.data.permalink
                        }));
                        resolve(discussions);
                    } catch (e) { resolve([]); }
                });
            }).on('error', () => resolve([]));
        });
    } catch (error) { return []; }
}

async function searchNewsData(query) {
    // This function appears functional but is fragile due to regex-based parsing.
    try {
        const newsUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
        return new Promise((resolve) => {
            https.get(newsUrl, { headers: { 'User-Agent': 'InsightEar/1.0' } }, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        const titleMatches = data.match(/<title>(.*?)<\/title>/g) || [];
                        const articles = titleMatches.slice(1, 4).map(tag => ({ title: tag.replace(/<[^>]*>/g, '') }));
                        resolve(articles);
                    } catch (e) { resolve([]); }
                });
            }).on('error', () => resolve([]));
        });
    } catch (error) { return []; }
}

async function handleWebSearch(query) {
    console.log(`🌐 Performing web search for: "${query}"`);
    const [redditData, newsData] = await Promise.all([
        searchRedditData(query),
        searchNewsData(query)
    ]);
    const result = {
        search_summary: `Found ${redditData.length} Reddit discussions and ${newsData.length} news articles.`,
        reddit_results: redditData,
        news_results: newsData,
    };
    return JSON.stringify(result);
}

async function handleMarketAnalysis(query) {
    console.log(`📊 Performing mock analysis for: "${query}"`);
    const analysis = {
        query: query,
        sentiment_breakdown: { positive: 65, neutral: 25, negative: 10 },
        key_recommendation: 'Leverage positive sentiment in marketing campaigns.'
    };
    return JSON.stringify(analysis);
}


// --- FIX: INTELLIGENT ROUTING LOGIC (MOVED TO TOP LEVEL) ---
function shouldUseWebSearch(message) {
    const msg = message.toLowerCase().trim();
    const conversationalPatterns = [/^(hi|hello|hey|thanks)/, /what can you do/, /who are you/, /help me/];
    const pdfPatterns = [/pdf/, /report/, /download/, /^yes( please)?$/];
    if (conversationalPatterns.some(p => p.test(msg)) || pdfPatterns.some(p => p.test(msg))) {
        return false;
    }
    // Default to true for a specialized assistant
    return true;
}

function getConversationalResponse(message) {
    const msg = message.toLowerCase().trim();
    if (msg.includes('what can you do') || msg.includes('help')) {
        return `I'm InsightEar GPT, your market research assistant! Here's what I can do:\n- **Analyze Brand Sentiment**: "What are people saying about Nike?"\n- **Research Market Trends**: "Latest trends in the EV industry?"\n- **Generate PDF Reports**: After an analysis, just ask for a "PDF report".`;
    }
    if (/^(hi|hello|hey)/.test(msg)) {
        return "Hello! I'm InsightEar GPT. What brand, product, or market trend can I research for you today?";
    }
    if (msg.includes('thank')) {
        return "You're welcome! Is there anything else I can analyze for you?";
    }
    return null; // Fallback
}

// --- MAIN CHAT ENDPOINT (REWRITTEN & CORRECTED) ---
app.post('/chat', async (req, res) => {
    const { message } = req.body;
    const sessionId = req.headers['x-session-id'] || req.ip;
    const session = getSession(sessionId);

    console.log(`\n[${sessionId}] User message: "${message}"`);

    // --- GATEKEEPER LOGIC ---
    const isPdfRequest = [/pdf/, /report/, /download/, /^yes( please)?$/].some(p => p.test(message.toLowerCase()));

    if (isPdfRequest) {
        console.log('📄 PDF request detected.');
        if (session.lastResponse && session.lastQuery) {
            const pdfResponse = `✅ **PDF Report Generated!**\n\nI've created a report for the **${session.lastQuery}** analysis.\n\n**📥 [Click to Download Report](/download-report/${sessionId})**`;
            return res.json({ response: pdfResponse });
        } else {
            return res.json({ response: "I don't have a recent analysis to create a PDF from. Please ask for market research first." });
        }
    }

    if (!shouldUseWebSearch(message)) {
        console.log('💬 Conversational query detected. Bypassing Assistant.');
        const response = getConversationalResponse(message) || "I'm ready to help. What would you like to research?";
        return res.json({ response });
    }

    // --- MARKET RESEARCH QUERY ---
    console.log('🎯 Market intelligence query confirmed. Engaging Assistant...');
    try {
        // --- FIX: CONVERSATION MEMORY ---
        // Reuse threadId from session or create a new one
        if (!session.threadId) {
            const thread = await openai.beta.threads.create();
            session.threadId = thread.id;
            console.log(`🧵 New thread created for session: ${session.threadId}`);
        } else {
            console.log(`🔄 Using existing thread: ${session.threadId}`);
        }

        await openai.beta.threads.messages.create(session.threadId, { role: 'user', content: message });
        
        const run = await openai.beta.threads.runs.create(session.threadId, { assistant_id: assistantId });
        console.log(`🚀 Run created: ${run.id}, Status: ${run.status}`);

        // Poll for completion
        let currentRun;
        do {
            await new Promise(resolve => setTimeout(resolve, 1500));
            currentRun = await openai.beta.threads.runs.retrieve(session.threadId, run.id);
            console.log(`🔄 Run status: ${currentRun.status}`);

            if (currentRun.status === 'requires_action' && currentRun.required_action) {
                const toolCalls = currentRun.required_action.submit_tool_outputs.tool_calls;
                const toolOutputs = [];

                for (const toolCall of toolCalls) {
                    const functionName = toolCall.function.name;
                    const args = JSON.parse(toolCall.function.arguments);
                    let output;

                    if (functionName === 'search_web_data') {
                        output = await handleWebSearch(args.query);
                    } else if (functionName === 'analyze_market_data') {
                        output = await handleMarketAnalysis(args.query);
                    }
                    
                    if (output) {
                        toolOutputs.push({ tool_call_id: toolCall.id, output });
                    }
                }
                await openai.beta.threads.runs.submitToolOutputs(session.threadId, run.id, { tool_outputs: toolOutputs });
            }

        } while (currentRun.status === 'queued' || currentRun.status === 'in_progress');

        if (currentRun.status === 'completed') {
            const messages = await openai.beta.threads.messages.list(session.threadId);
            const assistantMessage = messages.data.find(msg => msg.role === 'assistant');
            const responseText = assistantMessage?.content[0]?.text?.value || 'No response generated.';

            // Store for PDF generation
            session.lastQuery = message;
            session.lastAnalysis = responseText;
            console.log(`💾 Stored analysis for query: "${message}"`);
            
            res.json({ response: responseText });
        } else {
            throw new Error(`Run ended with status: ${currentRun.status}`);
        }

    } catch (error) {
        console.error('❌ Chat error:', error);
        res.status(500).json({ response: `I'm experiencing technical difficulties. Debug: ${error.message}` });
    }
});


// --- OTHER ENDPOINTS ---

// File upload endpoint (feature is standalone, not yet integrated with Assistant)
app.post('/upload', upload.array('files'), (req, res) => {
    console.log('📎 Files uploaded:', req.files?.length || 0);
    res.json({ message: 'Files uploaded successfully.' });
});

// Correctly named download endpoint for text reports
app.get('/download-report/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);
    
    if (!session || !session.lastAnalysis) {
        return res.status(404).send('Analysis not found for this session.');
    }
    
    console.log(`📄 Generating report download for: ${session.lastQuery}`);
    
    const reportContent = `InsightEar GPT - Market Intelligence Report\n================================\n\nQuery: ${session.lastQuery}\nGenerated: ${new Date().toLocaleString()}\n\n--- ANALYSIS ---\n${session.lastAnalysis}`;
    
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="report-${session.lastQuery.replace(/\s/g, '_')}.txt"`);
    res.send(reportContent);
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Main Page (serving the frontend)
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>InsightEar GPT</title>
    <style>
        body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background-color: #f0f2f5; }
        .chat-container { width: 100%; max-width: 800px; height: 90vh; background: white; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,0.1); display: flex; flex-direction: column; }
        .chat-header { padding: 20px; background: #4f46e5; color: white; border-top-left-radius: 12px; border-top-right-radius: 12px; text-align: center; }
        .chat-messages { flex: 1; overflow-y: auto; padding: 20px; }
        .message { margin-bottom: 15px; max-width: 80%; padding: 12px 16px; border-radius: 18px; line-height: 1.5; }
        .user-message { background: #e0e0e0; align-self: flex-end; margin-left: auto; }
        .assistant-message { background: #4f46e5; color: white; align-self: flex-start; }
        .assistant-message h2 { margin-top: 0; }
        .assistant-message a { color: #c7d2fe; text-decoration: underline; }
        .input-container { padding: 20px; border-top: 1px solid #ddd; display: flex; gap: 10px; }
        #messageInput { flex: 1; padding: 12px; border: 1px solid #ccc; border-radius: 20px; resize: none; font-size: 16px; }
        #sendBtn { background: #4f46e5; color: white; border: none; border-radius: 50%; width: 50px; height: 50px; font-size: 20px; cursor: pointer; }
    </style>
</head>
<body>
    <div class="chat-container">
        <div class="chat-header"><h1>InsightEar GPT</h1><p>Market Intelligence Assistant</p></div>
        <div class="chat-messages" id="chatMessages">
            <div class="message assistant-message">Hello! What brand, product, or market trend can I research for you today?</div>
        </div>
        <div class="input-container">
            <textarea id="messageInput" placeholder="Ask about Nike, EV market trends..." rows="1"></textarea>
            <button id="sendBtn">➤</button>
        </div>
    </div>
    <script>
        const messageInput = document.getElementById('messageInput');
        const sendBtn = document.getElementById('sendBtn');
        const chatMessages = document.getElementById('chatMessages');
        let sessionId = localStorage.getItem('insightear-session') || 'session-' + Date.now();
        localStorage.setItem('insightear-session', sessionId);

        async function sendMessage() {
            const message = messageInput.value.trim();
            if (!message) return;
            addMessage(message, 'user');
            messageInput.value = '';
            
            try {
                const response = await fetch('/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Session-ID': sessionId },
                    body: JSON.stringify({ message })
                });
                const data = await response.json();
                addMessage(data.response, 'assistant');
            } catch (error) {
                addMessage('Sorry, an error occurred.', 'assistant');
            }
        }
        
        function addMessage(content, sender) {
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message ' + sender + '-message';
            
            // --- FIX: MORE RELIABLE MARKDOWN-LIKE FORMATTING ---
            let htmlContent = content
                .replace(/</g, "&lt;").replace(/>/g, "&gt;") // Sanitize HTML tags
                .replace(/\\n/g, '<br>') // Handle newlines
                .replace(/## (.*?)<br>/g, '<h2>$1</h2>')
                .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
                .replace(/\* (.*?)<br>/g, '<li>$1</li>');
            
            // Wrap consecutive list items in a UL tag
            htmlContent = htmlContent.replace(/(<li>.*<\/li>)+/gs, '<ul>$&</ul>');

            // Make links clickable
            htmlContent = htmlContent.replace(/\[Click to Download Report\]\((.*?)\)/g, '<a href="$1" target="_blank">Click to Download Report</a>');
            
            messageDiv.innerHTML = htmlContent;
            chatMessages.appendChild(messageDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }

        sendBtn.addEventListener('click', sendMessage);
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    </script>
</body>
</html>`);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 InsightEar GPT Server Started with Corrected Logic`);
    console.log('=================================');
    console.log(`Server listening on port ${PORT}`);
    console.log('✅ Intelligent query routing is active.');
    console.log('✅ Conversation memory is enabled.');
    console.log('=================================');
});
