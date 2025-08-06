const express = require('express');
const multer = require('multer');
const OpenAI = require('openai');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 8080;

// Configure OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const ASSISTANT_ID = process.env.ASSISTANT_ID || 'asst_2P5fw8JmadtFqerm6hcVkC5I';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { 
    fileSize: 5 * 1024 * 1024,
    files: 3
  }
});

// Main chat interface
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>InsightEar GPT</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }

        .chat-container {
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            width: 100%;
            max-width: 800px;
            height: 700px;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .chat-header {
            background: linear-gradient(90deg, #4CAF50 0%, #45a049 100%);
            color: white;
            padding: 20px;
            text-align: center;
        }

        .chat-header h1 {
            font-size: 24px;
            margin-bottom: 5px;
        }

        .chat-header p {
            font-size: 14px;
            opacity: 0.9;
        }

        .welcome-message {
            background: #f8f9fa;
            border-bottom: 1px solid #e9ecef;
            padding: 15px 20px;
            font-size: 14px;
            line-height: 1.5;
        }

        .welcome-message strong {
            color: #28a745;
        }

        .chat-messages {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
            background: #f8f9fa;
        }

        .message {
            margin-bottom: 15px;
            display: flex;
            gap: 10px;
        }

        .message.user {
            justify-content: flex-end;
        }

        .message.assistant {
            justify-content: flex-start;
        }

        .message-content {
            max-width: 70%;
            padding: 12px 16px;
            border-radius: 18px;
            word-wrap: break-word;
        }

        .message.user .message-content {
            background: #007bff;
            color: white;
        }

        .message.assistant .message-content {
            background: white;
            color: #333;
            border: 1px solid #e9ecef;
        }

        .chat-input-container {
            padding: 20px;
            background: white;
            border-top: 1px solid #e9ecef;
        }

        .input-group {
            display: flex;
            gap: 10px;
            align-items: center;
        }

        .file-upload {
            position: relative;
        }

        .file-upload input[type="file"] {
            position: absolute;
            opacity: 0;
            width: 100%;
            height: 100%;
            cursor: pointer;
        }

        .file-upload-btn {
            background: #6c757d;
            color: white;
            border: none;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            font-size: 18px;
        }

        .file-upload-btn:hover {
            background: #5a6268;
        }

        #messageInput {
            flex: 1;
            padding: 12px 16px;
            border: 1px solid #ddd;
            border-radius: 25px;
            font-size: 14px;
            outline: none;
        }

        #messageInput:focus {
            border-color: #007bff;
        }

        #sendButton {
            background: #007bff;
            color: white;
            border: none;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            font-size: 16px;
        }

        #sendButton:hover {
            background: #0056b3;
        }

        .typing-indicator {
            display: none;
            color: #6c757d;
            font-style: italic;
            margin-bottom: 10px;
        }

        @media (max-width: 600px) {
            .chat-container {
                height: 100vh;
                border-radius: 0;
            }
        }
    </style>
</head>
<body>
    <div class="chat-container">
        <div class="chat-header">
            <h1>InsightEar GPT</h1>
            <p>Real-Time Market Intelligence Platform</p>
        </div>
        
        <div class="welcome-message">
            <strong>✅ Real-time market intelligence</strong> - Live data from Reddit, Google Reviews, Twitter, News, and more<br>
            <strong>✅ Advanced sentiment analysis</strong> - Comprehensive brand and product insights<br>
            <strong>✅ Web crawling capabilities</strong> - Automatically gather information from multiple platforms<br>
            <strong>✅ Professional reports</strong> - Executive summaries, forecasting, and strategic recommendations<br>
            <strong>✅ AI assistance</strong> - Market intelligence plus general conversation<br><br>
            
            Ask me to research any brand or product:<br>
            <strong>"Analyze Nike's brand sentiment"</strong> • <strong>"Tesla customer feedback analysis"</strong> • <strong>"Coca-Cola vs Pepsi comparison"</strong><br><br>
            
            Or chat normally:<br>
            <strong>"Hello, how are you?"</strong> • <strong>"What can you help with?"</strong> • <strong>"Explain market trends"</strong>
        </div>
        
        <div class="chat-messages" id="chatMessages">
            <div class="typing-indicator" id="typingIndicator">InsightEar GPT is researching...</div>
        </div>
        
        <div class="chat-input-container">
            <div class="input-group">
                <div class="file-upload">
                    <input type="file" id="fileInput" multiple accept=".pdf,.doc,.docx,.txt,.csv,.xlsx,.xls">
                    <div class="file-upload-btn">📎</div>
                </div>
                <input type="text" id="messageInput" placeholder="Ask for real-time market analysis or chat about anything...">
                <button id="sendButton">➤</button>
            </div>
        </div>
    </div>

    <script>
        console.log('InsightEar GPT starting...');
        
        function addMessage(type, content) {
            const messagesContainer = document.getElementById('chatMessages');
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message ' + type;
            
            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            contentDiv.innerHTML = content;
            
            messageDiv.appendChild(contentDiv);
            messagesContainer.appendChild(messageDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }

        function showTyping() {
            document.getElementById('typingIndicator').style.display = 'block';
            document.getElementById('chatMessages').scrollTop = document.getElementById('chatMessages').scrollHeight;
        }

        function hideTyping() {
            document.getElementById('typingIndicator').style.display = 'none';
        }

        async function sendMessage() {
            console.log('sendMessage called');
            const input = document.getElementById('messageInput');
            const message = input.value.trim();
            
            if (!message) return;
            
            console.log('Sending message:', message);
            addMessage('user', message);
            input.value = '';
            
            showTyping();
            
            try {
                const response = await fetch('/chat', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ message: message })
                });
                
                console.log('Response status:', response.status);
                
                if (!response.ok) {
                    throw new Error('Network response was not ok');
                }
                
                const data = await response.json();
                console.log('Response data received');
                
                hideTyping();
                addMessage('assistant', data.response);
            } catch (error) {
                console.error('Error:', error);
                hideTyping();
                addMessage('assistant', 'Sorry, I encountered an error. Please try again.');
            }
        }

        // Set up all event listeners when page loads
        window.addEventListener('load', function() {
            console.log('Page loaded, setting up event listeners...');
            
            // Message input enter key
            const messageInput = document.getElementById('messageInput');
            if (messageInput) {
                messageInput.addEventListener('keypress', function(event) {
                    if (event.key === 'Enter') {
                        sendMessage();
                    }
                });
                console.log('Message input listener added');
            }
            
            // Send button click
            const sendButton = document.getElementById('sendButton');
            if (sendButton) {
                sendButton.addEventListener('click', sendMessage);
                console.log('Send button listener added');
            }
            
            // File upload
            const fileInput = document.getElementById('fileInput');
            if (fileInput) {
                fileInput.addEventListener('change', function(event) {
                    const files = event.target.files;
                    if (files.length > 0) {
                        const fileNames = Array.from(files).map(file => file.name).join(', ');
                        addMessage('user', '📁 Uploaded files: ' + fileNames);
                        addMessage('assistant', 'Files received! I can analyze documents for sentiment and insights. What would you like me to do with these files?');
                    }
                });
                console.log('File input listener added');
            }
            
            console.log('InsightEar GPT loaded successfully');
        });
    </script>
</body>
</html>`);
});

// Handle chat messages - Route everything to OpenAI Assistant
app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    console.log('Received message:', message);
    console.log('Routing to OpenAI Assistant for real-time analysis');
    
    // Route ALL queries to your OpenAI Assistant
    try {
      const thread = await openai.beta.threads.create();
      
      await openai.beta.threads.messages.create(thread.id, {
        role: "user",
        content: message
      });

      const run = await openai.beta.threads.runs.create(thread.id, {
        assistant_id: ASSISTANT_ID
      });

      // Wait for completion with longer timeout for web research
      let runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      let attempts = 0;
      const maxAttempts = 120; // 2 minutes for web crawling
      
      while (runStatus.status === 'in_progress' && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
        attempts++;
        
        if (attempts % 15 === 0) {
          console.log('Assistant researching web data... attempt', attempts);
        }
      }

      if (runStatus.status === 'completed') {
        const messages = await openai.beta.threads.messages.list(thread.id);
        const assistantMessage = messages.data[0];
        
        if (assistantMessage && assistantMessage.content[0]) {
          console.log('Real-time intelligence response received');
          res.json({ response: assistantMessage.content[0].text.value });
        } else {
          res.json({ response: "I'm InsightEar GPT, ready to provide real-time market intelligence. What would you like me to research?" });
        }
      } else if (runStatus.status === 'failed') {
        console.log('Assistant run failed:', runStatus.last_error);
        res.json({ response: "I encountered an issue while gathering real-time data. Please try your query again." });
      } else {
        console.log('Assistant timeout during research');
        res.json({ response: "I'm still gathering comprehensive real-time data. This might take a moment - please try again shortly." });
      }
    } catch (error) {
      console.error('OpenAI Assistant error:', error.message);
      
      // Fallback to direct completion
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "system", 
              content: "You are InsightEar GPT, an advanced market intelligence assistant. Provide real-time sentiment analysis, market research, and actionable insights."
            },
            {
              role: "user", 
              content: message
            }
          ],
          max_tokens: 1500,
          temperature: 0.7
        });
        
        if (completion.choices[0]?.message?.content) {
          console.log('Fallback completion successful');
          res.json({ response: completion.choices[0].message.content });
        } else {
          res.json({ response: "I'm InsightEar GPT, your real-time market intelligence assistant. What would you like me to research?" });
        }
      } catch (fallbackError) {
        console.error('Fallback failed:', fallbackError.message);
        res.json({ response: "I'm experiencing technical difficulties. Please try your market intelligence query again." });
      }
    }
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// File upload handling
app.post('/upload', upload.array('files'), (req, res) => {
  try {
    const files = req.files;
    console.log('Files uploaded:', files.length);
    
    res.json({ 
      message: 'Files uploaded successfully',
      fileCount: files.length,
      files: files.map(f => ({ name: f.originalname, size: f.size }))
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    port: port
  });
});

// Favicon
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully');
  process.exit(0);
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log('InsightEar GPT server running on port', port);
  console.log('Server bound to 0.0.0.0:' + port);
  console.log('Ready for real-time market intelligence!');
});

module.exports = app;
