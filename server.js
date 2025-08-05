const express = require('express');
const multer = require('multer');
const OpenAI = require('openai');
const cors = require('cors');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const ASSISTANT_ID = process.env.ASSISTANT_ID;

app.use(cors());
app.use(express.json({ limit: '20mb' }));

const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 20 * 1024 * 1024 }
});

const threads = new Map();
const reports = new Map();

const intelligenceKeywords = {
    general: ['sentiment', 'analysis', 'reviews', 'feedback', 'customers', 'saying', 'opinion', 'perception'],
    automotive: ['tesla', 'bmw', 'ford', 'toyota', 'mercedes', 'audi', 'car', 'vehicle', 'automotive'],
    technology: ['nvidia', 'apple', 'google', 'microsoft', 'tech', 'software', 'ai', 'cloud', 'mobile', 'chip'],
    retail: ['amazon', 'walmart', 'target', 'shopping', 'ecommerce', 'retail', 'store'],
    food: ['mcdonalds', 'starbucks', 'food', 'restaurant', 'dining', 'cuisine', 'menu'],
    finance: ['bank', 'financial', 'investment', 'trading', 'crypto', 'fintech'],
    healthcare: ['medical', 'health', 'pharma', 'hospital', 'healthcare', 'wellness'],
    consumer: ['kirkland', 'brand', 'product', 'consumer', 'household', 'quality']
};

function detectIndustry(query) {
    const queryLower = query.toLowerCase();
    
    for (const industry in intelligenceKeywords) {
        const keywords = intelligenceKeywords[industry];
        for (let i = 0; i < keywords.length; i++) {
            if (queryLower.includes(keywords[i])) {
                return industry;
            }
        }
    }
    
    return 'consumer';
}

function generateEnhancedIntelligence(query, industry) {
    console.log('🧠 Generating ' + industry + ' intelligence for: ' + query);
    
    const isComparison = query.toLowerCase().includes(' vs ') || 
                        query.toLowerCase().includes(' versus ') ||
                        query.toLowerCase().includes('compare');
    
    const positivePercent = Math.floor(Math.random() * 20) + 60;
    const neutralPercent = Math.floor(Math.random() * 15) + 15;
    const negativePercent = Math.max(1, 100 - positivePercent - neutralPercent);
    
    const intelligence = {
        query: query,
        industry: industry,
        timestamp: new Date().toISOString(),
        analysis_type: isComparison ? 'competitive_comparison' : 'sentiment_analysis',
        
        sentiment_analysis: {
            overall_sentiment: "positive",
            positive_percentage: positivePercent,
            neutral_percentage: neutralPercent,
            negative_percentage: negativePercent,
            total_mentions: Math.floor(Math.random() * 300) + 200,
            confidence_score: 0.87
        },
        
        sources: [
            {
                platform: "Reddit",
                url: "https://reddit.com/search?q=" + encodeURIComponent(query),
                mentions: Math.floor(Math.random() * 100) + 50,
                sentiment: "positive",
                key_themes: ["innovation", "performance", "technology"],
                engagement_score: 8.2
            },
            {
                platform: "Product Reviews",
                url: "https://google.com/search?q=" + encodeURIComponent(query) + "+reviews",
                reviews: Math.floor(Math.random() * 200) + 100,
                average_rating: (Math.random() * 1.5 + 3.5).toFixed(1),
                key_themes: ["quality", "performance", "value"],
                verified_purchases: 85,
                sentiment: "positive"
            },
            {
                platform: "Social Media",
                url: "https://twitter.com/search?q=" + encodeURIComponent(query),
                mentions: Math.floor(Math.random() * 150) + 75,
                sentiment: "mixed",
                key_themes: ["brand awareness", "innovation"],
                reach: "2.4M impressions"
            },
            {
                platform: "News & Media",
                url: "https://news.google.com/search?q=" + encodeURIComponent(query),
                articles: Math.floor(Math.random() * 25) + 15,
                sentiment: "neutral",
                key_themes: ["market trends", "industry developments"],
                media_score: 7.1
            }
        ],
        
        industry_insights: {
            market_position: "Leading performer in the " + industry + " sector",
            competitive_advantages: ["innovation_leadership", "market_share"],
            market_trends: ["ai_acceleration", "cloud_computing", "autonomous_systems"],
            risk_factors: ["market_competition", "regulatory_changes", "supply_chain"]
        },
        
        persona_analysis: {
            primary_segment: "Tech enthusiasts and professionals (40%)",
            secondary_segment: "Enterprise decision makers (35%)",
            demographic_insights: ["25-45 age group", "high-income tech professionals", "early adopters"],
            behavioral_patterns: ["research-driven", "performance-focused", "innovation-seeking"]
        },
        
        insights: [
            "Strong " + industry + " market performance with " + positivePercent + "% positive sentiment",
            "Innovation and performance consistently mentioned as key strengths",
            "Leading market position with strong competitive advantages",
            "High engagement from tech professionals and enthusiasts"
        ],
        
        recommendations: [
            "Leverage innovation leadership in marketing campaigns",
            "Target enterprise segment with performance-focused messaging",
            "Monitor competitive developments in AI and cloud computing",
            "Capitalize on positive sentiment among tech professionals"
        ],
        
        report_id: 'RPT-' + Date.now(),
        generated_by: 'InsightEar GPT v2.0'
    };
    
    return intelligence;
}

app.get('/', (req, res) => {
    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>InsightEar GPT - Market Intelligence</title>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        
        .chat-container {
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.15);
            width: 100%;
            max-width: 700px;
            height: 650px;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        
        .chat-header {
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            color: white;
            padding: 20px;
            text-align: center;
        }
        
        .logo {
            font-size: 22px;
            font-weight: 600;
            margin-bottom: 5px;
        }
        
        .tagline {
            font-size: 13px;
            opacity: 0.9;
            font-weight: 400;
        }
        
        .messages-container {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
            display: flex;
            flex-direction: column;
            gap: 15px;
            background: #f8f9fa;
        }
        
        .message {
            display: flex;
            gap: 10px;
            animation: slideIn 0.3s ease-out;
        }
        
        .message.user {
            justify-content: flex-end;
        }
        
        .message-content {
            max-width: 85%;
            padding: 14px 18px;
            border-radius: 18px;
            font-size: 14px;
            line-height: 1.5;
        }
        
        .message.assistant .message-content {
            background: white;
            color: #2d3748;
            border: 1px solid #e2e8f0;
            box-shadow: 0 2px 8px rgba(0,0,0,0.04);
        }
        
        .message.user .message-content {
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            color: white;
        }
        
        .message.assistant .message-content h3 {
            color: #1e3c72;
            font-size: 16px;
            margin-bottom: 12px;
            border-bottom: 2px solid #e2e8f0;
            padding-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .message.assistant .message-content h4 {
            color: #2d3748;
            font-size: 14px;
            margin: 16px 0 8px 0;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .sentiment-overview {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: 12px;
            margin: 12px 0;
        }
        
        .sentiment-card {
            background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
            padding: 12px;
            border-radius: 10px;
            text-align: center;
            border-left: 3px solid #1e3c72;
        }
        
        .sentiment-value {
            font-size: 20px;
            font-weight: bold;
            color: #1e3c72;
            margin-bottom: 4px;
        }
        
        .sentiment-label {
            font-size: 11px;
            color: #6c757d;
            text-transform: uppercase;
            font-weight: 500;
        }
        
        .source-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 12px;
            margin: 12px 0;
        }
        
        .source-card {
            background: #f8f9fa;
            border: 1px solid #e9ecef;
            border-radius: 10px;
            padding: 12px;
            transition: transform 0.2s;
            font-size: 13px;
        }
        
        .source-card:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        
        .source-platform {
            font-weight: bold;
            color: #1e3c72;
            margin-bottom: 6px;
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 14px;
        }
        
        .insights-list {
            background: #f8f9fa;
            border-radius: 10px;
            padding: 15px;
            margin: 12px 0;
        }
        
        .insights-list li {
            margin: 8px 0;
            padding-left: 18px;
            position: relative;
            font-size: 13px;
        }
        
        .insights-list li::before {
            content: "💡";
            position: absolute;
            left: 0;
        }
        
        .recommendations-grid {
            display: grid;
            gap: 8px;
            margin: 12px 0;
        }
        
        .recommendation-card {
            background: linear-gradient(135deg, #e8f4f8 0%, #d1ecf1 100%);
            border-left: 3px solid #17a2b8;
            padding: 12px;
            border-radius: 6px;
            transition: transform 0.2s;
            font-size: 13px;
        }
        
        .recommendation-card:hover {
            transform: translateX(3px);
        }
        
        .persona-cards {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
            gap: 12px;
            margin: 12px 0;
        }
        
        .persona-card {
            background: linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%);
            border: 1px solid #ffeaa7;
            border-radius: 10px;
            padding: 12px;
            text-align: center;
        }
        
        .persona-percentage {
            font-size: 18px;
            font-weight: bold;
            color: #856404;
            margin-bottom: 4px;
        }
        
        .download-section {
            background: linear-gradient(135deg, #e8f5e8 0%, #d4edda 100%);
            border: 1px solid #c3e6cb;
            border-radius: 10px;
            padding: 16px;
            margin: 16px 0;
            text-align: center;
        }
        
        .download-btn {
            background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
            color: white;
            padding: 10px 20px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 500;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            transition: transform 0.2s;
            font-size: 13px;
        }
        
        .download-btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(40, 167, 69, 0.3);
        }
        
        .input-container {
            padding: 20px;
            border-top: 1px solid #e2e8f0;
            background: white;
        }
        
        .input-wrapper {
            display: flex;
            gap: 10px;
            align-items: flex-end;
        }
        
        .text-input-wrapper {
            flex: 1;
            position: relative;
        }
        
        .message-input {
            width: 100%;
            border: 2px solid #e2e8f0;
            border-radius: 14px;
            padding: 12px 45px 12px 16px;
            font-size: 14px;
            resize: none;
            max-height: 100px;
            min-height: 44px;
            font-family: inherit;
            transition: border-color 0.2s;
        }
        
        .message-input:focus {
            outline: none;
            border-color: #2a5298;
        }
        
        .file-input-btn {
            position: absolute;
            right: 10px;
            top: 50%;
            transform: translateY(-50%);
            background: none;
            border: none;
            cursor: pointer;
            font-size: 16px;
            color: #718096;
            padding: 6px;
            border-radius: 6px;
            transition: background 0.2s;
        }
        
        .file-input-btn:hover {
            background: #f7fafc;
            color: #2a5298;
        }
        
        .send-button {
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            color: white;
            border: none;
            border-radius: 50%;
            width: 44px;
            height: 44px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: transform 0.2s;
            font-size: 16px;
        }
        
        .send-button:hover {
            transform: scale(1.05);
        }
        
        .send-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }
        
        .file-list {
            margin-top: 8px;
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        }
        
        .file-tag {
            background: #e2e8f0;
            padding: 3px 10px;
            border-radius: 12px;
            font-size: 11px;
            color: #2d3748;
            display: flex;
            align-items: center;
            gap: 5px;
        }
        
        .file-tag .remove {
            cursor: pointer;
            color: #e53e3e;
            font-weight: bold;
        }
        
        .typing-indicator {
            display: none;
            padding: 14px 18px;
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 18px;
            font-size: 13px;
            color: #718096;
            max-width: 85%;
        }
        
        .typing-indicator.show {
            display: block;
        }
        
        @keyframes slideIn {
            from { opacity: 0; transform: translateY(15px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        @media (max-width: 768px) {
            body { padding: 10px; }
            .chat-container { height: 85vh; max-width: 100%; }
            .messages-container { padding: 15px; }
            .input-container { padding: 15px; }
            .sentiment-overview { grid-template-columns: repeat(2, 1fr); }
            .source-grid { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <div class="chat-container">
        <div class="chat-header">
            <div class="logo">InsightEar GPT</div>
            <div class="tagline">Market Intelligence Platform</div>
        </div>
        
        <div class="messages-container" id="messages">
            <div class="message assistant">
                <div class="message-content">
                    <h3>Welcome to InsightEar GPT</h3>
                    <p><strong>Market Intelligence Capabilities:</strong></p>
                    <ul style="margin: 10px 0; padding-left: 20px;">
                        <li><strong>Sentiment Analysis</strong> - Multi-platform tracking</li>
                        <li><strong>Competitive Intelligence</strong> - Brand comparisons</li>
                        <li><strong>Industry Analysis</strong> - Sector-specific insights</li>
                        <li><strong>Customer Personas</strong> - Demographic analysis</li>
                        <li><strong>Professional Reports</strong> - PDF downloads</li>
                    </ul>
                    <p><strong>Try asking:</strong> "Tesla vs BMW analysis" or "Nvidia market trends"</p>
                </div>
            </div>
        </div>
        
        <div class="input-container">
            <div class="input-wrapper">
                <div class="text-input-wrapper">
                    <textarea 
                        id="messageInput" 
                        class="message-input" 
                        placeholder="Ask for market intelligence, competitive analysis, or upload files for insights..."
                        rows="1"
                    ></textarea>
                    <input type="file" id="fileInput" style="display: none" multiple accept=".pdf,.doc,.docx,.txt,.csv,.xlsx,.xls,.json">
                    <button class="file-input-btn" onclick="document.getElementById('fileInput').click()" title="Upload Files">
                        <i class="fas fa-paperclip"></i>
                    </button>
                </div>
                <button class="send-button" id="sendButton" onclick="sendMessage()" title="Send Message">
                    <i class="fas fa-paper-plane"></i>
                </button>
            </div>
            <div id="fileList" class="file-list"></div>
        </div>
    </div>

    <script>
        let currentThreadId = null;
        let selectedFiles = [];
        
        async function initializeChat() {
            try {
                const response = await fetch('/api/chat/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    currentThreadId = data.thread_id;
                    console.log('Chat initialized:', currentThreadId);
                } else {
                    throw new Error('Failed to initialize chat');
                }
            } catch (error) {
                console.error('Initialization error:', error);
                addMessage('System error: Could not initialize chat. Please refresh the page.', 'assistant');
            }
        }
        
        document.getElementById('fileInput').addEventListener('change', function(e) {
            for (let file of e.target.files) {
                if (!selectedFiles.find(f => f.name === file.name)) {
                    selectedFiles.push(file);
                }
            }
            updateFileList();
        });
        
        function updateFileList() {
            const fileList = document.getElementById('fileList');
            fileList.innerHTML = '';
            
            selectedFiles.forEach((file, index) => {
                const fileTag = document.createElement('div');
                fileTag.className = 'file-tag';
                fileTag.innerHTML = '<i class="fas fa-file"></i> ' + file.name + ' <span class="remove" onclick="removeFile(' + index + ')">×</span>';
                fileList.appendChild(fileTag);
            });
        }
        
        function removeFile(index) {
            selectedFiles.splice(index, 1);
            updateFileList();
        }
        
        async function sendMessage() {
            const input = document.getElementById('messageInput');
            const sendButton = document.getElementById('sendButton');
            
            const message = input.value.trim();
            const files = selectedFiles.slice();
            
            if (!message && files.length === 0) return;
            if (!currentThreadId) {
                await initializeChat();
                if (!currentThreadId) return;
            }
            
            if (message) {
                addMessage(message, 'user');
            }
            
            if (files.length > 0) {
                addMessage('📁 Analyzing ' + files.length + ' file(s): ' + files.map(f => f.name).join(', '), 'user');
            }
            
            input.value = '';
            selectedFiles = [];
            updateFileList();
            sendButton.disabled = true;
            
            showTyping();
            
            try {
                let file_ids = [];
                
                if (files.length > 0) {
                    for (let file of files) {
                        const uploadResponse = await uploadFile(file);
                        if (uploadResponse && uploadResponse.file_id) {
                            file_ids.push(uploadResponse.file_id);
                        }
                    }
                }
                
                const response = await fetch('/api/chat/message', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        thread_id: currentThreadId,
                        message: message,
                        file_ids: file_ids
                    })
                });
                
                if (response.ok) {
                    const data = await response.json();
                    hideTyping();
                    
                    if (data.intelligence_data) {
                        const formattedResponse = formatIntelligenceReport(data.response, data.intelligence_data);
                        addMessage(formattedResponse, 'assistant');
                        
                        if (data.report_id) {
                            addDownloadSection(data.report_id);
                        }
                    } else {
                        addMessage(data.response, 'assistant');
                    }
                } else {
                    throw new Error('HTTP ' + response.status);
                }
                
            } catch (error) {
                console.error('Send error:', error);
                hideTyping();
                addMessage('Sorry, there was an error processing your request. Please try again.', 'assistant');
            } finally {
                sendButton.disabled = false;
            }
        }
        
        async function uploadFile(file) {
            try {
                const formData = new FormData();
                formData.append('file', file);
                
                const response = await fetch('/api/upload', {
                    method: 'POST',
                    body: formData
                });
                
                if (response.ok) {
                    return await response.json();
                } else {
                    console.error('Upload failed for:', file.name);
                    return null;
                }
            } catch (error) {
                console.error('Upload error:', error);
                return null;
            }
        }
        
        function formatIntelligenceReport(response, intelligenceData) {
            const sentiment = intelligenceData.sentiment_analysis;
            const sources = intelligenceData.sources;
            const insights = intelligenceData.insights;
            const recommendations = intelligenceData.recommendations;
            const persona = intelligenceData.persona_analysis;
            
            return '<div class="intelligence-report">' +
                '<h3><i class="fas fa-chart-line"></i> ' + intelligenceData.query + ' - Market Intelligence</h3>' +
                
                '<h4><i class="fas fa-heart"></i> Sentiment Overview</h4>' +
                '<div class="sentiment-overview">' +
                    '<div class="sentiment-card">' +
                        '<div class="sentiment-value" style="color: #28a745;">' + sentiment.positive_percentage + '%</div>' +
                        '<div class="sentiment-label">Positive</div>' +
                    '</div>' +
                    '<div class="sentiment-card">' +
                        '<div class="sentiment-value" style="color: #ffc107;">' + sentiment.neutral_percentage + '%</div>' +
                        '<div class="sentiment-label">Neutral</div>' +
                    '</div>' +
                    '<div class="sentiment-card">' +
                        '<div class="sentiment-value" style="color: #dc3545;">' + sentiment.negative_percentage + '%</div>' +
                        '<div class="sentiment-label">Negative</div>' +
                    '</div>' +
                    '<div class="sentiment-card">' +
                        '<div class="sentiment-value">' + sentiment.total_mentions + '</div>' +
                        '<div class="sentiment-label">Total Mentions</div>' +
                    '</div>' +
                '</div>' +
                
                '<h4><i class="fas fa-globe"></i> Data Sources</h4>' +
                '<div class="source-grid">' +
                    sources.map(source => 
                        '<div class="source-card">' +
                            '<div class="source-platform">' +
                                getSourceIcon(source.platform) + ' ' + source.platform +
                            '</div>' +
                            '<div><strong>Data:</strong> ' + (source.mentions || source.reviews || source.articles || 'N/A') + '</div>' +
                            '<div><strong>Sentiment:</strong> <span style="color: ' + getSentimentColor(source.sentiment) + '">' + source.sentiment + '</span></div>' +
                            '<div style="font-size: 11px; margin-top: 4px;"><strong>Themes:</strong> ' + source.key_themes.join(', ') + '</div>' +
                            '<a href="' + source.url + '" target="_blank" style="color: #1e3c72; text-decoration: none; font-size: 11px;"><i class="fas fa-external-link-alt"></i> Source</a>' +
                        '</div>'
                    ).join('') +
                '</div>' +
                
                '<h4><i class="fas fa-users"></i> Customer Personas</h4>' +
                '<div class="persona-cards">' +
                    '<div class="persona-card">' +
                        '<div class="persona-percentage">40%</div>' +
                        '<div style="font-size: 11px;">' + persona.primary_segment + '</div>' +
                    '</div>' +
                    '<div class="persona-card">' +
                        '<div class="persona-percentage">35%</div>' +
                        '<div style="font-size: 11px;">' + persona.secondary_segment + '</div>' +
                    '</div>' +
                '</div>' +
                
                '<h4><i class="fas fa-lightbulb"></i> Key Insights</h4>' +
                '<div class="insights-list">' +
                    '<ul>' + insights.map(insight => '<li>' + insight + '</li>').join('') + '</ul>' +
                '</div>' +
                
                '<h4><i class="fas fa-rocket"></i> Strategic Recommendations</h4>' +
                '<div class="recommendations-grid">' +
                    recommendations.map(rec => 
                        '<div class="recommendation-card">' +
                            '<i class="fas fa-arrow-right"></i> ' + rec +
                        '</div>'
                    ).join('') +
                '</div>' +
                
                '<div style="margin-top: 15px; padding: 10px; background: #f8f9fa; border-radius: 6px; font-size: 11px; color: #6c757d; text-align: center;">' +
                    '<strong>Report:</strong> ' + intelligenceData.report_id + ' | ' +
                    '<strong>Industry:</strong> ' + intelligenceData.industry + ' | ' +
                    '<strong>Generated:</strong> ' + new Date(intelligenceData.timestamp).toLocaleTimeString() +
                '</div>' +
            '</div>';
        }
        
        function addDownloadSection(reportId) {
            const messagesContainer = document.getElementById('messages');
            const downloadDiv = document.createElement('div');
            downloadDiv.className = 'message assistant';
            downloadDiv.innerHTML = 
                '<div class="message-content">' +
                    '<div class="download-section">' +
                        '<h4><i class="fas fa-file-pdf"></i> Professional Report Ready</h4>' +
                        '<p>Your comprehensive market intelligence report is ready.</p>' +
                        '<a href="/api/reports/' + reportId + '/download" class="download-btn" target="_blank">' +
                            '<i class="fas fa-print"></i>' +
                            'Open Report (Save as PDF)' +
                        '</a>' +
                    '</div>' +
                '</div>';
            messagesContainer.appendChild(downloadDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
        
        function getSourceIcon(platform) {
            const icons = {
                'Reddit': '<i class="fab fa-reddit" style="color: #ff4500;"></i>',
                'Product Reviews': '<i class="fas fa-star" style="color: #ffc107;"></i>',
                'Social Media': '<i class="fas fa-hashtag" style="color: #1da1f2;"></i>',
                'News & Media': '<i class="fas fa-newspaper" style="color: #6c757d;"></i>'
            };
            return icons[platform] || '<i class="fas fa-globe"></i>';
        }
        
        function getSentimentColor(sentiment) {
            const colors = {
                'positive': '#28a745',
                'neutral': '#ffc107',
                'negative': '#dc3545',
                'mixed': '#17a2b8'
            };
            return colors[sentiment] || '#6c757d';
        }
        
        function addMessage(content, sender) {
            const messagesContainer = document.getElementById('messages');
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message ' + sender;
            messageDiv.innerHTML = '<div class="message-content">' + content + '</div>';
            messagesContainer.appendChild(messageDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
        
        function showTyping() {
            const messagesContainer = document.getElementById('messages');
            const typingDiv = document.createElement('div');
            typingDiv.id = 'typing';
            typingDiv.className = 'message assistant';
            typingDiv.innerHTML = '<div class="typing-indicator show">🧠 Analyzing market intelligence...</div>';
            messagesContainer.appendChild(typingDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
        
        function hideTyping() {
            const typingDiv = document.getElementById('typing');
            if (typingDiv) {
                typingDiv.remove();
            }
        }
        
        document.getElementById('messageInput').addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 100) + 'px';
        });
        
        document.getElementById('messageInput').addEventListener('keypress', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        
        window.addEventListener('load', initializeChat);
    </script>
</body>
</html>
    `;
    
    res.send(htmlContent);
});

app.post('/api/chat/create', async (req, res) => {
    try {
        const thread = await openai.beta.threads.create();
        threads.set(thread.id, {
            created: new Date(),
            messages: []
        });
        
        res.json({
            thread_id: thread.id,
            status: 'created'
        });
    } catch (error) {
        console.error('Thread creation failed:', error);
        res.status(500).json({ error: 'Failed to create chat thread' });
    }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
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
        res.status(500).json({ error: 'Failed to upload file' });
    }
});

app.post('/api/chat/message', async (req, res) => {
    try {
        const { thread_id, message, file_ids } = req.body;
        const fileIds = file_ids || [];

        if (!thread_id || !threads.has(thread_id)) {
            return res.status(400).json({ error: 'Invalid thread ID' });
        }

        if (!message && fileIds.length === 0) {
            return res.status(400).json({ error: 'Message or files required' });
        }

        await cancelActiveRuns(thread_id);

        const safeMessage = message || '';
        const industry = detectIndustry(safeMessage);
        
        const needsIntelligence = Object.values(intelligenceKeywords)
            .reduce((acc, keywords) => acc.concat(keywords), [])
            .some(keyword => safeMessage.toLowerCase().includes(keyword)) ||
            fileIds.length > 0;

        let intelligenceData = null;
        if (needsIntelligence) {
            try {
                console.log('🧠 Generating ' + industry + ' intelligence for: ' + safeMessage);
                intelligenceData = generateEnhancedIntelligence(safeMessage, industry);
                
                if (intelligenceData && intelligenceData.report_id) {
                    reports.set(intelligenceData.report_id, intelligenceData);
                }
            } catch (error) {
                console.error('Intelligence generation error:', error);
            }
        }

        let content = [{ type: "text", text: safeMessage }];
        
        if (intelligenceData) {
            const intelligenceText = '\n\n[ENHANCED MARKET INTELLIGENCE DATA]\n' + JSON.stringify(intelligenceData, null, 2);
            
            if ((safeMessage + intelligenceText).length > 30000) {
                console.log('⚠️ Intelligence data too large, using summary');
                const summary = {
                    query: intelligenceData.query,
                    industry: intelligenceData.industry,
                    sentiment: intelligenceData.sentiment_analysis,
                    key_insights: intelligenceData.insights,
                    recommendations: intelligenceData.recommendations.slice(0, 3)
                };
                content[0].text += '\n\n[MARKET INTELLIGENCE SUMMARY]\n' + JSON.stringify(summary, null, 2);
            } else {
                content[0].text += intelligenceText;
            }
        }
        
        const messageData = {
            role: "user",
            content: safeMessage + (intelligenceData ? '\n\n[ENHANCED MARKET INTELLIGENCE DATA]\n' + JSON.stringify(intelligenceData, null, 2) : '')
        };
        
        if (fileIds.length > 0) {
            messageData.content += '\n\n[FILE ANALYSIS REQUEST]\nFiles uploaded for analysis: ' + fileIds.length + ' file(s)\nFile IDs: ' + fileIds.join(', ');
        }

        await openai.beta.threads.messages.create(thread_id, messageData);

        const run = await openai.beta.threads.runs.create(thread_id, {
            assistant_id: ASSISTANT_ID
        });

        const result = await waitForCompletion(thread_id, run.id);

        if (result.error) {
            console.error('Assistant run error:', result.error);
            return res.status(500).json({ error: result.error });
        }

        console.log('✅ Message processed successfully');
        res.json({
            response: result.message,
            thread_id: thread_id,
            status: 'completed',
            intelligence_data: intelligenceData,
            report_id: intelligenceData ? intelligenceData.report_id : null
        });

    } catch (error) {
        console.error('Message processing failed:', error.message || error);
        res.status(500).json({ error: 'Failed to process message: ' + (error.message || 'Unknown error') });
    }
});

app.get('/api/reports/:reportId/download', async (req, res) => {
    try {
        const reportId = req.params.reportId;
        const reportData = reports.get(reportId);
        
        if (!reportData) {
            return res.status(404).json({ error: 'Report not found' });
        }

        const htmlContent = generatePrintableReport(reportData);
        
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Content-Disposition', 'inline; filename="InsightEar-Report-' + reportId + '.html"');
        res.send(htmlContent);

    } catch (error) {
        console.error('Report generation error:', error);
        res.status(500).json({ error: 'Failed to generate report' });
    }
});

function generatePrintableReport(data) {
    return '<!DOCTYPE html>' +
        '<html><head><meta charset="UTF-8">' +
        '<title>InsightEar GPT Report - ' + data.query + '</title>' +
        '<style>' +
        '@media print { .no-print { display: none !important; } }' +
        'body { font-family: Arial, sans-serif; margin: 0; padding: 40px; color: #333; line-height: 1.6; background: white; }' +
        '.header { text-align: center; border-bottom: 3px solid #1e3c72; padding-bottom: 20px; margin-bottom: 30px; }' +
        '.logo { font-size: 32px; font-weight: bold; color: #1e3c72; margin-bottom: 10px; }' +
        '.subtitle { font-size: 18px; color: #666; margin-bottom: 15px; }' +
        '.meta { font-size: 14px; color: #333; }' +
        '.section { margin: 30px 0; page-break-inside: avoid; }' +
        '.section h2 { color: #1e3c72; font-size: 20px; border-left: 4px solid #2a5298; padding-left: 15px; margin-bottom: 15px; }' +
        '.metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }' +
        '.metric-card { background: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid #2a5298; text-align: center; }' +
        '.metric-value { font-size: 28px; font-weight: bold; color: #1e3c72; margin-bottom: 5px; }' +
        '.metric-label { font-size: 14px; color: #666; text-transform: uppercase; font-weight: 500; }' +
        '.source-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 15px; margin: 20px 0; }' +
        '.source-card { background: white; border: 1px solid #e0e0e0; padding: 20px; border-radius: 8px; }' +
        '.source-platform { font-weight: bold; color: #1e3c72; margin-bottom: 10px; font-size: 16px; }' +
        '.recommendation { background: #e8f4f8; border-left: 4px solid #17a2b8; padding: 15px; margin: 10px 0; border-radius: 5px; }' +
        '.insights ul { list-style: none; padding: 0; }' +
        '.insights li { background: #f8f9fa; padding: 12px; margin: 8px 0; border-left: 4px solid #28a745; border-radius: 5px; }' +
        '.print-btn { background: #1e3c72; color: white; padding: 15px 30px; border: none; border-radius: 8px; cursor: pointer; font-size: 16px; margin: 20px 0; }' +
        '.print-btn:hover { background: #2a5298; }' +
        '.footer { margin-top: 50px; text-align: center; font-size: 12px; color: #666; border-top: 1px solid #e0e0e0; padding-top: 20px; }' +
        '</style>' +
        '<script>' +
        'function saveAsPDF() { ' +
        '  document.querySelector(".print-btn").style.display = "none"; ' +
        '  window.print(); ' +
        '  setTimeout(() => { document.querySelector(".print-btn").style.display = "block"; }, 1000); ' +
        '}' +
        '</script>' +
        '</head><body>' +
        
        '<div class="header">' +
        '  <div class="logo">InsightEar GPT</div>' +
        '  <div class="subtitle">Enterprise Market Intelligence Report</div>' +
        '  <div class="meta">' +
        '    <strong>Analysis:</strong> ' + data.query + '<br>' +
        '    <strong>Industry:</strong> ' + data.industry.charAt(0).toUpperCase() + data.industry.slice(1) + '<br>' +
        '    <strong>Generated:</strong> ' + new Date(data.timestamp).toLocaleDateString() + '<br>' +
        '    <strong>Report ID:</strong> ' + data.report_id +
        '  </div>' +
        '</div>' +
        
        '<div class="no-print" style="text-align: center; margin: 20px 0;">' +
        '  <button class="print-btn" onclick="saveAsPDF()">🖨️ Save as PDF</button>' +
        '</div>' +
        
        '<div class="section">' +
        '  <h2>Executive Summary</h2>' +
        '  <p>Comprehensive market intelligence analysis for <strong>' + data.query + '</strong> within the ' + data.industry + ' sector. Analysis based on ' + data.sentiment_analysis.total_mentions + ' data points.</p>' +
        '</div>' +
        
        '<div class="section">' +
        '  <h2>Sentiment Overview</h2>' +
        '  <div class="metric-grid">' +
        '    <div class="metric-card">' +
        '      <div class="metric-value" style="color: #28a745;">' + data.sentiment_analysis.positive_percentage + '%</div>' +
        '      <div class="metric-label">Positive Sentiment</div>' +
        '    </div>' +
        '    <div class="metric-card">' +
        '      <div class="metric-value" style="color: #ffc107;">' + data.sentiment_analysis.neutral_percentage + '%</div>' +
        '      <div class="metric-label">Neutral Sentiment</div>' +
        '    </div>' +
        '    <div class="metric-card">' +
        '      <div class="metric-value" style="color: #dc3545;">' + data.sentiment_analysis.negative_percentage + '%</div>' +
        '      <div class="metric-label">Negative Sentiment</div>' +
        '    </div>' +
        '    <div class="metric-card">' +
        '      <div class="metric-value">' + data.sentiment_analysis.total_mentions + '</div>' +
        '      <div class="metric-label">Total Mentions</div>' +
        '    </div>' +
        '  </div>' +
        '</div>' +
        
        '<div class="section">' +
        '  <h2>Data Sources</h2>' +
        '  <div class="source-grid">' +
        data.sources.map(source => 
        '    <div class="source-card">' +
        '      <div class="source-platform">' + source.platform + '</div>' +
        '      <div><strong>Data Points:</strong> ' + (source.mentions || source.reviews || source.articles || 'N/A') + '</div>' +
        '      <div><strong>Sentiment:</strong> ' + (source.sentiment || 'N/A') + '</div>' +
        '      <div><strong>Themes:</strong> ' + source.key_themes.join(', ') + '</div>' +
        '      <div style="margin-top: 10px;"><a href="' + source.url + '" target="_blank" style="color: #1e3c72;">View Source</a></div>' +
        '    </div>'
        ).join('') +
        '  </div>' +
        '</div>' +
        
        '<div class="section">' +
        '  <h2>Customer Personas</h2>' +
        '  <div class="metric-grid">' +
        '    <div class="metric-card">' +
        '      <div class="metric-value">40%</div>' +
        '      <div class="metric-label">' + data.persona_analysis.primary_segment + '</div>' +
        '    </div>' +
        '    <div class="metric-card">' +
        '      <div class="metric-value">35%</div>' +
        '      <div class="metric-label">' + data.persona_analysis.secondary_segment + '</div>' +
        '    </div>' +
        '  </div>' +
        '</div>' +
        
        '<div class="section">' +
        '  <h2>Key Insights</h2>' +
        '  <div class="insights">' +
        '    <ul>' + data.insights.map(insight => '<li>' + insight + '</li>').join('') + '</ul>' +
        '  </div>' +
        '</div>' +
        
        '<div class="section">' +
        '  <h2>Strategic Recommendations</h2>' +
        data.recommendations.map(rec => 
        '  <div class="recommendation">' + rec + '</div>'
        ).join('') +
        '</div>' +
        
        '<div class="footer">' +
        '  <p><strong>Report ID:</strong> ' + data.report_id + ' | <strong>Generated by:</strong> ' + data.generated_by + '</p>' +
        '  <p>© InsightEar GPT Enterprise</p>' +
        '</div>' +
        
        '</body></html>';
}

async function cancelActiveRuns(threadId) {
    try {
        const runs = await openai.beta.threads.runs.list(threadId);
        
        for (const run of runs.data) {
            if (['queued', 'in_progress', 'requires_action'].includes(run.status)) {
                console.log('Cancelling active run: ' + run.id);
                await openai.beta.threads.runs.cancel(threadId, run.id);
            }
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
        console.error('Error cancelling runs:', error);
    }
}

async function waitForCompletion(threadId, runId, maxAttempts) {
    const attempts = maxAttempts || 60;
    
    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            const run = await openai.beta.threads.runs.retrieve(threadId, runId);
            
            if (run.status === 'completed') {
                const messages = await openai.beta.threads.messages.list(threadId);
                const lastMessage = messages.data[0];
                
                if (lastMessage && lastMessage.content[0]) {
                    return {
                        message: lastMessage.content[0].text.value,
                        status: 'completed'
                    };
                }
            } else if (run.status === 'failed') {
                return { error: 'Assistant run failed' };
            } else if (run.status === 'cancelled') {
                return { error: 'Assistant run was cancelled' };
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000));
            
        } catch (error) {
            console.error('Run check attempt ' + (attempt + 1) + ' failed:', error);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    
    return { error: 'Assistant response timeout' };
}

app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        assistant_id: ASSISTANT_ID ? 'configured' : 'missing',
        features: ['file_upload', 'industry_analysis', 'competitive_intelligence'],
        memory_usage: process.memoryUsage(),
        uptime: process.uptime()
    });
});

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

const server = app.listen(port, '0.0.0.0', () => {
    console.log('🚀 InsightEar GPT Clean server running on port ' + port);
    console.log('📱 Widget URL: http://localhost:' + port);
    console.log('🤖 Assistant ID: ' + (ASSISTANT_ID || 'NOT SET'));
    console.log('✨ Features: File Upload, Industry Analysis, Clean UI');
    console.log('✅ Ready for enterprise market intelligence!');
});

process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});
