const express = require('express');
const multer = require('multer');
const OpenAI = require('openai');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const Sentiment = require('sentiment');

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

// Initialize services
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const sentiment = new Sentiment();

// Middleware
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());

// File upload configuration
const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, true)
});

// In-memory storage
const threads = new Map();
const cache = new Map();

// ===== REAL WEB CRAWLING FUNCTIONS =====

// Real Reddit scraper using public JSON API
async function scrapeRedditRealtime(query, limit = 25) {
    try {
        console.log(`🔍 Scraping Reddit for: ${query}`);
        
        // Reddit search via public JSON API
        const searchUrl = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=relevance&limit=${limit}&t=month`;
        
        const response = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'InsightEar-Market-Research-Bot/1.0',
                'Accept': 'application/json'
            },
            timeout: 10000
        });

        if (!response.data || !response.data.data) {
            throw new Error('Invalid Reddit API response');
        }

        const posts = response.data.data.children
            .filter(post => post.data && post.data.title)
            .map(post => {
                const postData = post.data;
                const text = (postData.title + ' ' + (postData.selftext || '')).toLowerCase();
                const sentimentScore = sentiment.analyze(text);
                
                return {
                    title: postData.title,
                    content: postData.selftext || '',
                    score: postData.score || 0,
                    comments: postData.num_comments || 0,
                    subreddit: postData.subreddit,
                    url: `https://reddit.com${postData.permalink}`,
                    created: new Date(postData.created_utc * 1000),
                    upvote_ratio: postData.upvote_ratio || 0,
                    sentiment: {
                        score: sentimentScore.score,
                        comparative: sentimentScore.comparative,
                        positive: sentimentScore.positive,
                        negative: sentimentScore.negative,
                        classification: sentimentScore.score > 0 ? 'positive' : sentimentScore.score < 0 ? 'negative' : 'neutral'
                    }
                };
            });

        console.log(`✅ Found ${posts.length} Reddit posts with sentiment analysis`);
        return posts;

    } catch (error) {
        console.error('Reddit scraping error:', error.message);
        return [];
    }
}

// Real review scraper from accessible sources
async function scrapeProductReviews(productQuery, platform = 'general') {
    try {
        console.log(`⭐ Scraping reviews for: ${productQuery} on ${platform}`);
        
        let reviews = [];
        
        if (platform === 'general' || platform === 'shopping') {
            // Try to scrape from shopping comparison sites
            const searchQuery = encodeURIComponent(productQuery + ' reviews');
            const searchUrl = `https://duckduckgo.com/html/?q=${searchQuery}+site:consumerreports.com+OR+site:wirecutter.com+OR+site:rtings.com`;
            
            try {
                const response = await axios.get(searchUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                    },
                    timeout: 8000
                });

                const $ = cheerio.load(response.data);
                
                // Extract review snippets from search results
                $('.result__snippet, .result__body').each((i, element) => {
                    if (i >= 10) return false; // Limit to 10 reviews
                    
                    const reviewText = $(element).text().trim();
                    if (reviewText && reviewText.length > 50) {
                        const sentimentScore = sentiment.analyze(reviewText);
                        
                        reviews.push({
                            content: reviewText,
                            source: 'Consumer Reviews',
                            platform: platform,
                            sentiment: {
                                score: sentimentScore.score,
                                classification: sentimentScore.score > 0 ? 'positive' : sentimentScore.score < 0 ? 'negative' : 'neutral',
                                positive_words: sentimentScore.positive,
                                negative_words: sentimentScore.negative
                            },
                            scraped_at: new Date().toISOString()
                        });
                    }
                });
                
            } catch (searchError) {
                console.log('Search scraping failed, using alternate method');
            }
        }
        
        // If no reviews found, try Google shopping results
        if (reviews.length === 0) {
            try {
                const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(productQuery + ' reviews rating')}&num=10`;
                
                const response = await axios.get(googleUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    },
                    timeout: 8000
                });

                const $ = cheerio.load(response.data);
                
                // Extract review snippets from Google results
                $('.VwiC3b, .hgKElc, .s3v9rd').each((i, element) => {
                    if (i >= 15) return false;
                    
                    const reviewText = $(element).text().trim();
                    if (reviewText && reviewText.length > 30 && reviewText.includes(productQuery.split(' ')[0])) {
                        const sentimentScore = sentiment.analyze(reviewText);
                        
                        reviews.push({
                            content: reviewText,
                            source: 'Web Reviews',
                            platform: 'Google Search',
                            sentiment: {
                                score: sentimentScore.score,
                                classification: sentimentScore.score > 0 ? 'positive' : sentimentScore.score < 0 ? 'negative' : 'neutral',
                                positive_words: sentimentScore.positive,
                                negative_words: sentimentScore.negative
                            },
                            scraped_at: new Date().toISOString()
                        });
                    }
                });
                
            } catch (googleError) {
                console.log('Google scraping failed');
            }
        }

        console.log(`✅ Found ${reviews.length} product reviews`);
        return reviews;

    } catch (error) {
        console.error('Review scraping error:', error.message);
        return [];
    }
}

// Social media mentions scraper
async function scrapeSocialMentions(brandQuery) {
    try {
        console.log(`📱 Scraping social mentions for: ${brandQuery}`);
        
        const mentions = [];
        
        // Try to find Twitter-like mentions from web search
        const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(brandQuery)}+site:twitter.com+OR+site:facebook.com+OR+site:instagram.com`;
        
        try {
            const response = await axios.get(searchUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 8000
            });

            const $ = cheerio.load(response.data);
            
            $('.result__snippet').each((i, element) => {
                if (i >= 20) return false;
                
                const mentionText = $(element).text().trim();
                if (mentionText && mentionText.length > 20) {
                    const sentimentScore = sentiment.analyze(mentionText);
                    
                    mentions.push({
                        text: mentionText,
                        platform: 'Social Media',
                        sentiment: {
                            score: sentimentScore.score,
                            classification: sentimentScore.score > 0 ? 'positive' : sentimentScore.score < 0 ? 'negative' : 'neutral'
                        },
                        scraped_at: new Date().toISOString()
                    });
                }
            });
            
        } catch (scrapeError) {
            console.log('Social scraping failed:', scrapeError.message);
        }

        console.log(`✅ Found ${mentions.length} social media mentions`);
        return mentions;

    } catch (error) {
        console.error('Social mentions error:', error.message);
        return [];
    }
}

// News and trend scraper
async function scrapeNewsTrends(query) {
    try {
        console.log(`📰 Scraping news trends for: ${query}`);
        
        const newsItems = [];
        const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(query + ' news trends 2024 2025')}`;
        
        const response = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 8000
        });

        const $ = cheerio.load(response.data);
        
        $('.result__title, .result__snippet').each((i, element) => {
            if (i >= 15) return false;
            
            const newsText = $(element).text().trim();
            if (newsText && newsText.length > 30) {
                const sentimentScore = sentiment.analyze(newsText);
                
                newsItems.push({
                    headline: newsText,
                    sentiment: {
                        score: sentimentScore.score,
                        classification: sentimentScore.score > 0 ? 'positive' : sentimentScore.score < 0 ? 'negative' : 'neutral'
                    },
                    scraped_at: new Date().toISOString()
                });
            }
        });

        console.log(`✅ Found ${newsItems.length} news items`);
        return newsItems;

    } catch (error) {
        console.error('News scraping error:', error.message);
        return [];
    }
}

// Comprehensive sentiment analysis
function analyzeSentimentData(dataArray) {
    if (!dataArray || dataArray.length === 0) {
        return {
            overall_sentiment: 'neutral',
            confidence: 0,
            distribution: { positive: 0, neutral: 0, negative: 0 },
            total_analyzed: 0
        };
    }

    const sentiments = dataArray.map(item => {
        const text = typeof item === 'string' ? item : 
                    item.content || item.text || item.title || item.headline || '';
        return sentiment.analyze(text);
    });

    const totalScore = sentiments.reduce((sum, s) => sum + s.score, 0);
    const avgScore = totalScore / sentiments.length;
    
    const positive = sentiments.filter(s => s.score > 0).length;
    const negative = sentiments.filter(s => s.score < 0).length;
    const neutral = sentiments.filter(s => s.score === 0).length;
    
    const total = sentiments.length;
    
    return {
        overall_sentiment: avgScore > 0.5 ? 'positive' : avgScore < -0.5 ? 'negative' : 'neutral',
        average_score: Math.round(avgScore * 100) / 100,
        confidence: Math.min(Math.abs(avgScore) * 20, 100),
        distribution: {
            positive: Math.round((positive / total) * 100),
            negative: Math.round((negative / total) * 100),
            neutral: Math.round((neutral / total) * 100)
        },
        total_analyzed: total,
        key_positive_words: [...new Set(sentiments.flatMap(s => s.positive))].slice(0, 10),
        key_negative_words: [...new Set(sentiments.flatMap(s => s.negative))].slice(0, 10)
    };
}

// Master web intelligence function
async function gatherWebIntelligence(query) {
    try {
        console.log(`🌐 Gathering comprehensive web intelligence for: ${query}`);
        
        const startTime = Date.now();
        const results = {
            query: query,
            timestamp: new Date().toISOString(),
            sources: [],
            summary: {}
        };

        // Extract main topic from query
        const words = query.toLowerCase().split(' ');
        const stopWords = ['sentiment', 'analysis', 'review', 'customer', 'feedback', 'social', 'media', 'what', 'how', 'the', 'and', 'for', 'are'];
        const keywords = words.filter(word => word.length > 3 && !stopWords.includes(word));
        const mainTopic = keywords[0] || query.split(' ')[0];

        console.log(`🎯 Analyzing main topic: ${mainTopic}`);

        // Parallel data gathering for speed
        const [redditData, reviewData, socialData, newsData] = await Promise.all([
            scrapeRedditRealtime(mainTopic, 20),
            scrapeProductReviews(mainTopic, 'general'),
            scrapeSocialMentions(mainTopic),
            scrapeNewsTrends(mainTopic)
        ]);

        // Process Reddit data
        if (redditData && redditData.length > 0) {
            const redditSentiment = analyzeSentimentData(redditData.map(post => post.title + ' ' + post.content));
            results.sources.push({
                platform: 'Reddit',
                type: 'Community Discussions',
                data_points: redditData.length,
                sentiment_analysis: redditSentiment,
                top_posts: redditData.slice(0, 5).map(post => ({
                    title: post.title,
                    score: post.score,
                    comments: post.comments,
                    sentiment: post.sentiment.classification,
                    subreddit: post.subreddit
                }))
            });
        }

        // Process review data
        if (reviewData && reviewData.length > 0) {
            const reviewSentiment = analyzeSentimentData(reviewData.map(review => review.content));
            results.sources.push({
                platform: 'Product Reviews',
                type: 'Customer Feedback',
                data_points: reviewData.length,
                sentiment_analysis: reviewSentiment,
                sample_reviews: reviewData.slice(0, 3).map(review => ({
                    content: review.content.substring(0, 200) + '...',
                    sentiment: review.sentiment.classification,
                    source: review.source
                }))
            });
        }

        // Process social data
        if (socialData && socialData.length > 0) {
            const socialSentiment = analyzeSentimentData(socialData.map(mention => mention.text));
            results.sources.push({
                platform: 'Social Media',
                type: 'Brand Mentions',
                data_points: socialData.length,
                sentiment_analysis: socialSentiment
            });
        }

        // Process news data
        if (newsData && newsData.length > 0) {
            const newsSentiment = analyzeSentimentData(newsData.map(news => news.headline));
            results.sources.push({
                platform: 'News & Trends',
                type: 'Market Coverage',
                data_points: newsData.length,
                sentiment_analysis: newsSentiment,
                trending_topics: newsData.slice(0, 3).map(news => news.headline.substring(0, 100))
            });
        }

        // Generate comprehensive summary
        const allSentiments = [...redditData, ...reviewData, ...socialData, ...newsData];
        if (allSentiments.length > 0) {
            results.summary = {
                total_data_points: allSentiments.length,
                overall_sentiment: analyzeSentimentData(allSentiments),
                key_insights: [
                    `Found ${allSentiments.length} data points across ${results.sources.length} platforms`,
                    `Reddit shows ${redditData.length} community discussions`,
                    `Reviews indicate ${reviewData.length} customer feedback instances`,
                    `Social media contains ${socialData.length} brand mentions`
                ],
                recommendations: generateRecommendations(results.sources),
                processing_time: `${Date.now() - startTime}ms`
            };
        }

        console.log(`✅ Web intelligence complete - ${allSentiments.length} data points in ${Date.now() - startTime}ms`);
        return results;

    } catch (error) {
        console.error('Web intelligence error:', error);
        return {
            query: query,
            error: 'Failed to gather web intelligence',
            timestamp: new Date().toISOString()
        };
    }
}

// Generate actionable recommendations
function generateRecommendations(sources) {
    const recommendations = [];
    
    sources.forEach(source => {
        const sentiment = source.sentiment_analysis;
        if (sentiment && sentiment.overall_sentiment === 'positive') {
            recommendations.push(`Leverage positive ${source.type.toLowerCase()} sentiment in marketing`);
        } else if (sentiment && sentiment.overall_sentiment === 'negative') {
            recommendations.push(`Address concerns raised in ${source.type.toLowerCase()}`);
        }
    });

    if (recommendations.length === 0) {
        recommendations.push('Monitor sentiment trends regularly');
        recommendations.push('Engage with customer feedback');
        recommendations.push('Track competitor discussions');
    }

    return recommendations;
}

// ===== API ROUTES =====

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

// Enhanced message handler with REAL web crawling
app.post('/api/chat/message', async (req, res) => {
    try {
        const { thread_id, message, file_ids = [] } = req.body;

        if (!thread_id || !threads.has(thread_id)) {
            return res.status(400).json({ error: 'Invalid thread ID' });
        }

        if (!message && file_ids.length === 0) {
            return res.status(400).json({ error: 'Message or files required' });
        }

        // Detect web intelligence requests
        const webKeywords = ['sentiment', 'review', 'customer', 'feedback', 'social', 'reddit', 'analysis', 'competitor', 'market', 'brand', 'opinion'];
        const needsWebIntelligence = webKeywords.some(keyword => 
            message.toLowerCase().includes(keyword.toLowerCase())
        );

        let webIntelligence = null;
        if (needsWebIntelligence) {
            console.log('🔍 Web intelligence request detected, gathering real-time data...');
            webIntelligence = await gatherWebIntelligence(message);
        }

        await cancelActiveRuns(thread_id);

        let content = [{ type: "text", text: message }];
        
        // Add web intelligence data
        if (webIntelligence && webIntelligence.sources) {
            content.push({
                type: "text",
                text: `\n\n🌐 LIVE WEB INTELLIGENCE DATA:\n${JSON.stringify(webIntelligence, null, 2)}`
            });
        }
        
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
            status: 'completed',
            web_intelligence_included: !!webIntelligence,
            data_sources: webIntelligence ? webIntelligence.sources.length : 0
        });

    } catch (error) {
        console.error('Message processing failed:', error);
        res.status(500).json({ error: 'Failed to process message' });
    }
});

// Direct web intelligence endpoints
app.post('/api/intelligence/comprehensive', async (req, res) => {
    try {
        const { query } = req.body;
        if (!query) {
            return res.status(400).json({ error: 'Query required' });
        }
        
        const intelligence = await gatherWebIntelligence(query);
        res.json({ status: 'success', data: intelligence });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/intelligence/reddit', async (req, res) => {
    try {
        const { query, limit = 25 } = req.body;
        const data = await scrapeRedditRealtime(query, limit);
        const sentiment = analyzeSentimentData(data.map(post => post.title + ' ' + post.content));
        res.json({ 
            status: 'success', 
            data: data, 
            sentiment_analysis: sentiment,
            count: data.length 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/intelligence/reviews', async (req, res) => {
    try {
        const { query, platform = 'general' } = req.body;
        const data = await scrapeProductReviews(query, platform);
        const sentiment = analyzeSentimentData(data.map(review => review.content));
        res.json({ 
            status: 'success', 
            data: data, 
            sentiment_analysis: sentiment,
            count: data.length 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        assistant_id: ASSISTANT_ID ? 'configured' : 'missing',
        timestamp: new Date().toISOString(),
        web_crawling: 'ENABLED - REAL-TIME',
        sentiment_analysis: 'ENABLED',
        features: ['Reddit API', 'Review Scraping', 'Social Monitoring', 'News Trends'],
        version: '3.0-production'
    });
});

// Serve enhanced chat widget
app.get('/', (req, res) => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>InsightEar GPT - Real-Time Market Intelligence</title>
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
        .crawling-badge {
            background: linear-gradient(135deg, #FF6B6B 0%, #4ECDC4 100%);
            color: white; padding: 4px 8px; border-radius: 12px; font-size: 10px;
            margin-left: 8px; animation: glow 3s infinite;
        }
        @keyframes glow { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.8; transform: scale(1.05); } }
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
        .message.assistant .message-avatar { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
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
        .input-wrapper:focus-within { border-color: #667eea; }
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
        .send-btn { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; }
        .send-btn:hover:not(:disabled) { background: linear-gradient(135deg, #5a6fd8 0%, #6b4c96 100%); transform: scale(1.05); }
        .send-btn:disabled { background: #adb5bd; cursor: not-allowed; transform: none; }
        .file-input { display: none; }
        .typing-indicator {
            display: none; align-items: center; gap: 12px; padding: 16px 20px;
            color: #6c757d; font-style: italic; animation: fadeIn 0.3s ease-out;
        }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .typing-dots { display: flex; gap: 4px; }
        .typing-dot {
            width: 8px; height: 8px; background: #667eea; border-radius: 50%;
            animation: typing 1.4s infinite ease-in-out;
        }
        .typing-dot:nth-child(1) { animation-delay: -0.32s; }
        .typing-dot:nth-child(2) { animation-delay: -0.16s; }
        @keyframes typing {
            0%, 80%, 100% { transform: scale(0.8); opacity: 0.5; }
            40% { transform: scale(1); opacity: 1; }
        }
        .web-data-badge {
            background: linear-gradient(135deg, #FF6B6B 0%, #4ECDC4 100%);
            color: white; padding: 2px 8px; border-radius: 12px; font-size: 10px;
            margin-top: 8px; display: inline-block; animation: shimmer 2s infinite;
        }
        @keyframes shimmer { 0%, 100% { opacity: 1; } 50% { opacity: 0.8; } }
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
            🧠 InsightEar GPT
            <div class="crawling-badge">LIVE CRAWLING</div>
        </div>
        
        <div class="chat-messages" id="chatMessages">
            <div class="message assistant">
                <div class="message-avatar">IE</div>
                <div class="message-content">
                    🚀 Welcome to InsightEar GPT with <strong>LIVE WEB CRAWLING</strong>! I can analyze real-time sentiment from Reddit, scrape product reviews, monitor social media, and provide actionable market intelligence.
                    <br><br>
                    Try: "Analyze customer sentiment for Tesla" or "What are Reddit users saying about iPhone?"
                </div>
            </div>
        </div>
        
        <div class="typing-indicator" id="typingIndicator">
            <div class="message-avatar">IE</div>
            <div>
                Crawling live web data
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
                <textarea id="chatInput" class="chat-input" placeholder="Ask for real-time sentiment analysis, Reddit insights, or market intelligence..." rows="1"></textarea>
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
                showError('Failed to connect to InsightEar GPT. Please refresh the page.');
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
            
            // Show web crawling indicator for intelligence requests
            const webKeywords = ['sentiment', 'reddit', 'review', 'social', 'customer', 'feedback', 'analysis', 'market'];
            const isWebQuery = webKeywords.some(keyword => message.toLowerCase().includes(keyword));
            
            if (isWebQuery) {
                showWebCrawlingIndicator();
            } else {
                showTypingIndicator();
            }

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
                
                if (data.web_intelligence_included) {
                    addWebDataBadge(data.data_sources || 'multiple');
                }
                
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
            
            messageDiv.innerHTML = '<div class="message-avatar">' + (sender === 'user' ? 'You' : 'IE') + '</div><div class="message-content">' + (content ? content.replace(/\\n/g, '<br>') : '') + fileAttachments + '</div>';
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
        
        function showWebCrawlingIndicator() {
            const indicator = document.getElementById('typingIndicator');
            indicator.querySelector('div:nth-child(2)').innerHTML = 'Crawling live web data<div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>';
            indicator.style.display = 'flex';
            const container = document.getElementById('chatMessages');
            container.scrollTop = container.scrollHeight; 
        }
        
        function hideTypingIndicator() { 
            document.getElementById('typingIndicator').style.display = 'none';
            // Reset typing text
            document.getElementById('typingIndicator').querySelector('div:nth-child(2)').innerHTML = 'Crawling live web data<div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>';
        }
        
        function addWebDataBadge(sources) {
            const lastMessage = document.querySelector('.message.assistant:last-child .message-content');
            if (lastMessage && !lastMessage.querySelector('.web-data-badge')) {
                const badge = document.createElement('div');
                badge.className = 'web-data-badge';
                badge.textContent = '🌐 Live Web Data (' + sources + ' sources)';
                lastMessage.appendChild(badge);
            }
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

// Helper functions
async function cancelActiveRuns(threadId) {
    try {
        const runs = await openai.beta.threads.runs.list(threadId);
        
        for (const run of runs.data) {
            if (['queued', 'in_progress', 'requires_action'].includes(run.status)) {
                console.log(`Cancelling active run: ${run.id}`);
                await openai.beta.threads.runs.cancel(threadId, run.id);
            }
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
        console.error('Error cancelling runs:', error);
    }
}

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
    console.log(`🚀 InsightEar GPT with REAL WEB CRAWLING running on port ${port}`);
    console.log(`🌐 Live Data Sources: Reddit API, Review Scraping, Social Monitoring`);
    console.log(`📊 Real-time Sentiment Analysis: ENABLED`);
    console.log(`🧠 Market Intelligence: http://localhost:${port}`);
    console.log(`🤖 Assistant ID: ${ASSISTANT_ID}`);
    console.log(`✅ Ready for live market intelligence!`);
});

module.exports = app;
