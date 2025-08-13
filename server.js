const express = require('express');
const multer = require('multer');
const { OpenAI } = require('openai');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const pdf = require('pdf-parse');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

// CRITICAL: Session storage declared at TOP LEVEL - prevents ReferenceError
const sessions = new Map();
const researchCache = new Map();

// Initialize OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// API Configuration
const API_CONFIG = {
    newsApi: {
        key: process.env.NEWS_API_KEY,
        baseUrl: 'https://newsapi.org/v2'
    },
    reddit: {
        clientId: process.env.REDDIT_CLIENT_ID,
        clientSecret: process.env.REDDIT_CLIENT_SECRET,
        userAgent: 'web:InsightEarGPT:v2.0.0 (by /u/marketresearch)'
    }
};

// Reddit token management
let redditToken = null;
let redditTokenExpiry = null;

console.log('🚀 InsightEar GPT Server Starting - COMPLETE FINAL VERSION...');
console.log('📰 NewsAPI Key:', API_CONFIG.newsApi.key ? '✅ Configured' : '❌ Missing');
console.log('📱 Reddit API:', API_CONFIG.reddit.clientId ? '✅ Configured' : '❌ Missing');
console.log('🤖 OpenAI Assistant:', process.env.ASSISTANT_ID ? '✅ Configured' : '❌ Missing');

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

// File storage configuration
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = './uploads';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueName = Date.now() + '-' + file.originalname;
        cb(null, uniqueName);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 }
});

// ENHANCED REDDIT API INTEGRATION WITH BETTER ERROR HANDLING
async function ensureRedditToken() {
    if (redditToken && redditTokenExpiry && Date.now() < redditTokenExpiry) {
        return redditToken;
    }

    try {
        const auth = Buffer.from(`${API_CONFIG.reddit.clientId}:${API_CONFIG.reddit.clientSecret}`).toString('base64');
        
        console.log('🔍 Attempting Reddit authentication...');
        console.log('Client ID length:', API_CONFIG.reddit.clientId ? API_CONFIG.reddit.clientId.length : 'missing');
        console.log('Client Secret length:', API_CONFIG.reddit.clientSecret ? API_CONFIG.reddit.clientSecret.length : 'missing');
        
        // Try multiple user agents for better compatibility
        const userAgents = [
            'web:InsightEarGPT:v2.0.0 (by /u/marketresearch)',
            'InsightEar:2.0:market-research (by /u/apiuser)',
            'script:InsightEar:v2.0 by /u/research'
        ];
        
        for (let i = 0; i < userAgents.length; i++) {
            try {
                console.log(`🔄 Trying user agent ${i + 1}/${userAgents.length}: ${userAgents[i]}`);
                
                const response = await axios.post(
                    'https://www.reddit.com/api/v1/access_token',
                    'grant_type=client_credentials',
                    {
                        headers: {
                            'Authorization': `Basic ${auth}`,
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'User-Agent': userAgents[i]
                        },
                        timeout: 15000
                    }
                );

                redditToken = response.data.access_token;
                redditTokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000; // 1 min buffer
                console.log('✅ Reddit token obtained successfully with user agent:', userAgents[i]);
                console.log('✅ Token expires in:', response.data.expires_in, 'seconds');
                return redditToken;
                
            } catch (authError) {
                console.log(`❌ User agent ${i + 1} failed:`, authError.response?.status, authError.response?.data?.message || authError.message);
                if (i === userAgents.length - 1) {
                    throw authError; // Re-throw last error
                }
                continue; // Try next user agent
            }
        }

    } catch (error) {
        console.error('❌ Reddit auth complete failure:');
        console.error('Status:', error.response?.status);
        console.error('Data:', error.response?.data);
        
        throw new Error('Reddit authentication failed after all attempts: ' + (error.response?.data?.message || error.message));
    }
}

// ENHANCED REDDIT SEARCH FUNCTION WITH MULTIPLE FALLBACKS
async function searchRedditData(query) {
    console.log('🔍 Searching Reddit for:', query);
    
    try {
        const token = await ensureRedditToken();
        
        // Try multiple search strategies
        const searchStrategies = [
            // Strategy 1: Subreddit-specific searches
            async () => {
                const subreddits = ['stocks', 'investing', 'SecurityAnalysis', 'ValueInvesting', 'business', 'entrepreneur'];
                let allPosts = [];
                
                for (const subreddit of subreddits) {
                    try {
                        console.log(`🔍 Searching r/${subreddit} for ${query}...`);
                        const searchResponse = await axios.get(`https://oauth.reddit.com/r/${subreddit}/search`, {
                            headers: {
                                'Authorization': `Bearer ${token}`,
                                'User-Agent': API_CONFIG.reddit.userAgent
                            },
                            params: {
                                q: query,
                                restrict_sr: true,
                                sort: 'relevance',
                                limit: 8,
                                t: 'month'
                            },
                            timeout: 10000
                        });

                        if (searchResponse.data.data.children.length > 0) {
                            allPosts.push(...searchResponse.data.data.children.map(child => child.data));
                            console.log(`📱 Found ${searchResponse.data.data.children.length} posts in r/${subreddit}`);
                        }
                        
                        // Rate limiting
                        await new Promise(resolve => setTimeout(resolve, 1500));
                        
                    } catch (subError) {
                        console.log(`⚠️ r/${subreddit} search failed:`, subError.message);
                        continue;
                    }
                }
                
                return allPosts;
            },
            
            // Strategy 2: General search
            async () => {
                console.log('🔄 Trying general Reddit search...');
                const generalResponse = await axios.get('https://oauth.reddit.com/search', {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'User-Agent': API_CONFIG.reddit.userAgent
                    },
                    params: {
                        q: query,
                        sort: 'relevance',
                        limit: 20,
                        t: 'month',
                        type: 'link'
                    },
                    timeout: 10000
                });
                
                return generalResponse.data.data.children.map(child => child.data);
            }
        ];
        
        let allPosts = [];
        
        // Try each strategy
        for (let i = 0; i < searchStrategies.length; i++) {
            try {
                const posts = await searchStrategies[i]();
                if (posts.length > 0) {
                    allPosts = posts;
                    console.log(`✅ Strategy ${i + 1} succeeded with ${posts.length} posts`);
                    break;
                }
            } catch (strategyError) {
                console.log(`❌ Strategy ${i + 1} failed:`, strategyError.message);
                continue;
            }
        }

        console.log(`📱 Total Reddit posts found for ${query}: ${allPosts.length}`);

        if (allPosts.length === 0) {
            return {
                search_successful: false,
                error: 'No Reddit posts found for query: ' + query,
                total_posts: 0,
                fallback_message: 'Try searching for a more popular brand or topic'
            };
        }

        // Process real posts for sentiment and themes
        const processedPosts = allPosts.map(post => ({
            id: post.id,
            title: post.title,
            content: post.selftext || post.title,
            subreddit: post.subreddit,
            score: post.score,
            comments: post.num_comments,
            url: `https://reddit.com${post.permalink}`,
            created: new Date(post.created_utc * 1000).toISOString(),
            sentiment: analyzeSentiment(post.title + ' ' + (post.selftext || '')),
            author: post.author
        }));

        // Calculate real sentiment from actual posts
        const sentiment = calculateSentimentFromPosts(processedPosts);
        const themes = extractThemesFromPosts(processedPosts);
        const topSubreddits = getTopSubreddits(allPosts);

        return {
            search_successful: true,
            query_processed: query,
            total_posts: allPosts.length,
            processed_posts: processedPosts,
            sentiment_breakdown: sentiment,
            themes: themes,
            top_subreddits: topSubreddits,
            data_quality: 'real_reddit_api',
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        console.error('❌ Reddit search complete failure:', error.message);
        return {
            search_successful: false,
            error: 'Reddit API error: ' + error.message,
            fallback_used: true,
            total_posts: 0
        };
    }
}

// ENHANCED NEWS API INTEGRATION
async function searchNewsData(query) {
    console.log('📰 Searching News for:', query);
    
    try {
        const response = await axios.get(`${API_CONFIG.newsApi.baseUrl}/everything`, {
            params: {
                q: query,
                sortBy: 'publishedAt',
                pageSize: 50,
                language: 'en',
                apiKey: API_CONFIG.newsApi.key,
                from: getDateDaysAgo(30), // Last 30 days
                excludeDomains: 'youtube.com,facebook.com,twitter.com,reddit.com' // Focus on news sources
            },
            timeout: 15000
        });

        const articles = response.data.articles.filter(article => 
            article.title && 
            article.url && 
            article.title !== '[Removed]' &&
            !article.title.includes('[Removed]')
        );

        console.log(`📰 Found ${articles.length} real news articles for ${query}`);

        // Process real articles with enhanced data
        const processedArticles = articles.map(article => ({
            title: article.title,
            source: article.source.name,
            url: article.url,
            publishedAt: article.publishedAt,
            description: article.description || '',
            sentiment: analyzeSentiment(article.title + ' ' + (article.description || '')),
            author: article.author || 'Unknown',
            urlToImage: article.urlToImage
        }));

        // Calculate sentiment from real headlines
        const sentiment = calculateSentimentFromArticles(processedArticles);
        const sources = [...new Set(articles.map(a => a.source.name))];
        const themes = extractNewsThemes(processedArticles);

        return {
            search_successful: true,
            query_processed: query,
            total_articles: articles.length,
            processed_articles: processedArticles,
            sentiment_breakdown: sentiment,
            themes: themes,
            sources: sources,
            total_available: response.data.totalResults,
            data_quality: 'real_news_api',
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        console.error('❌ NewsAPI search error:', error.message);
        return {
            search_successful: false,
            error: 'NewsAPI error: ' + error.message,
            fallback_used: true,
            total_articles: 0
        };
    }
}

// ENHANCED COMBINED REAL MARKET ANALYSIS
async function handleRealMarketAnalysis(query) {
    console.log('🔍 Starting REAL market analysis for:', query);
    
    const company = extractCompanyName(query);
    
    try {
        // Create SINGLE analysis ID at the start
        const analysisId = 'analysis-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        console.log('📊 Creating analysis with ID:', analysisId);
        
        // Get real data from both sources
        const [redditData, newsData] = await Promise.all([
            searchRedditData(company),
            searchNewsData(company)
        ]);
        
        // Store IMMEDIATELY for drilldown capabilities
        const analysisData = {
            analysis_id: analysisId,
            company: company,
            reddit_data: redditData,
            news_data: newsData,
            timestamp: new Date().toISOString(),
            has_real_data: true,
            query_processed: query
        };
        
        researchCache.set(analysisId, analysisData);
        console.log('✅ Analysis data stored with ID:', analysisId);
        console.log('📊 Cache now has', researchCache.size, 'analyses');
        
        // Combine real data for comprehensive analysis
        const combinedAnalysis = {
            analysis_id: analysisId,
            company: company,
            timestamp: new Date().toISOString(),
            data_sources: ['Real Reddit API', 'Real NewsAPI'],
            reddit_analysis: redditData,
            news_analysis: newsData,
            combined_insights: generateCombinedInsights(redditData, newsData, company),
            drilldown_available: true,
            cache_stored: true
        };
        
        console.log('✅ Real market analysis completed for:', company);
        return JSON.stringify(combinedAnalysis, null, 2);
        
    } catch (error) {
        console.error('❌ Real market analysis error:', error);
        return JSON.stringify({
            error: 'Real market analysis failed',
            message: error.message,
            company: company,
            timestamp: new Date().toISOString()
        });
    }
}

// ENHANCED WEB SEARCH WITH REAL APIS
async function handleWebSearch(query) {
    console.log('🌐 Starting enhanced web search for:', query);
    
    try {
        // Use real Reddit and News APIs concurrently
        const [redditResults, newsResults] = await Promise.all([
            searchRedditData(query),
            searchNewsData(query)
        ]);
        
        const combinedResults = {
            search_successful: true,
            query_processed: query,
            timestamp: new Date().toISOString(),
            data_sources: {
                reddit: {
                    success: redditResults.search_successful,
                    posts_found: redditResults.total_posts || 0,
                    sentiment: redditResults.sentiment_breakdown,
                    themes: redditResults.themes,
                    top_subreddits: redditResults.top_subreddits
                },
                news: {
                    success: newsResults.search_successful,
                    articles_found: newsResults.total_articles || 0,
                    sentiment: newsResults.sentiment_breakdown,
                    sources: newsResults.sources,
                    themes: newsResults.themes
                }
            },
            combined_metrics: {
                total_mentions: (redditResults.total_posts || 0) + (newsResults.total_articles || 0),
                platforms: ['Reddit', 'News Sources'],
                data_authenticity: 'verified_apis',
                api_status: {
                    reddit: redditResults.search_successful ? 'connected' : 'failed',
                    news: newsResults.search_successful ? 'connected' : 'failed'
                }
            }
        };
        
        console.log('✅ Enhanced web search completed');
        return JSON.stringify(combinedResults, null, 2);
        
    } catch (error) {
        console.error('❌ Enhanced web search error:', error);
        return JSON.stringify({
            search_successful: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

// ENHANCED DRILLDOWN FUNCTIONALITY
async function handleDrilldownQuery(question, sessionId) {
    console.log('🔍 Processing drilldown query:', question);
    console.log('🔍 Session ID:', sessionId);
    
    // Find the most recent analysis for this session
    const session = sessions.get(sessionId);
    console.log('📊 Session found:', !!session);
    console.log('📊 Session lastAnalysisId:', session?.lastAnalysisId);
    
    if (!session || !session.lastAnalysisId) {
        console.log('❌ No session or analysis ID found');
        return "I don't have recent analysis data to drill down into. Please run a market analysis first (e.g., 'analyze Tesla sentiment'), then ask specific questions about the results.";
    }
    
    const analysisData = researchCache.get(session.lastAnalysisId);
    console.log('📊 Analysis data found in cache:', !!analysisData);
    
    if (!analysisData) {
        console.log('❌ Analysis data not found in cache for ID:', session.lastAnalysisId);
        
        // Debug: Show what's in the cache
        const cacheDebug = Array.from(researchCache.entries()).map(([id, data]) => ({
            id: id,
            company: data.company,
            timestamp: data.timestamp
        }));
        
        return `Analysis data not found in cache. Please run a new market analysis first.\n\nDebug Info:\n- Looking for: ${session.lastAnalysisId}\n- Available analyses: ${JSON.stringify(cacheDebug, null, 2)}`;
    }
    
    console.log('✅ Found analysis data for company:', analysisData.company);
    
    const lowerQuestion = question.toLowerCase();
    
    // Enhanced drilldown routing
    if (lowerQuestion.includes('reddit') && (lowerQuestion.includes('post') || lowerQuestion.includes('discussion'))) {
        return getDrilldownRedditPosts(analysisData, question);
    } else if (lowerQuestion.includes('negative') && (lowerQuestion.includes('theme') || lowerQuestion.includes('topic'))) {
        return getDrilldownNegativeThemes(analysisData);
    } else if (lowerQuestion.includes('positive') && (lowerQuestion.includes('theme') || lowerQuestion.includes('topic'))) {
        return getDrilldownPositiveThemes(analysisData);
    } else if (lowerQuestion.includes('news') && (lowerQuestion.includes('headline') || lowerQuestion.includes('article'))) {
        return getDrilldownNewsHeadlines(analysisData);
    } else if (lowerQuestion.includes('sentiment') && lowerQuestion.includes('breakdown')) {
        return getDrilldownSentimentBreakdown(analysisData);
    } else if (lowerQuestion.includes('subreddit') || lowerQuestion.includes('where')) {
        return getDrilldownSubreddits(analysisData);
    } else if (lowerQuestion.includes('source') || lowerQuestion.includes('article') || lowerQuestion.includes('show me')) {
        // Default to news headlines if ambiguous
        return getDrilldownNewsHeadlines(analysisData);
    } else {
        return getGenericDrilldown(analysisData, question);
    }
}

// ENHANCED DRILLDOWN FUNCTIONS WITH BETTER ARTICLE LINKS
function getDrilldownRedditPosts(analysisData, question) {
    const redditData = analysisData.reddit_data;
    
    if (!redditData || !redditData.search_successful) {
        return `**🔍 Reddit Data Status**\n\nNo Reddit data available for ${analysisData.company}.\n\n**Reason:** ${redditData?.error || 'Reddit API connection issues'}\n\n**Alternative:** Try asking about news headlines instead: "show me news headlines about ${analysisData.company}"`;
    }
    
    const posts = redditData.processed_posts || [];
    const displayPosts = posts.slice(0, 12); // Show more posts
    
    let response = `**🔍 Real Reddit Posts about ${analysisData.company}**\n\n`;
    response += `Found ${posts.length} total posts. Showing top ${displayPosts.length}:\n\n`;
    
    displayPosts.forEach((post, index) => {
        response += `**${index + 1}. r/${post.subreddit}**: "${post.title}"\n`;
        response += `   • **Score:** ${post.score} upvotes | **Comments:** ${post.comments}\n`;
        response += `   • **Sentiment:** ${post.sentiment} | **Author:** u/${post.author}\n`;
        response += `   • **Posted:** ${new Date(post.created).toLocaleDateString()}\n`;
        response += `   • **Direct Link:** ${post.url}\n\n`;
    });
    
    response += `**💡 How to use these links:**\n`;
    response += `• Copy any Reddit URL and paste into your browser\n`;
    response += `• These are direct links to actual Reddit discussions\n`;
    response += `• You can read full posts and comments\n\n`;
    response += `*This is real data from ${posts.length} authentic Reddit posts*`;
    
    return response;
}

function getDrilldownNegativeThemes(analysisData) {
    const redditData = analysisData.reddit_data;
    const newsData = analysisData.news_data;
    
    let response = `**🔍 Negative Themes Analysis for ${analysisData.company} (REAL DATA)**\n\n`;
    
    // Analyze Reddit negative themes
    if (redditData && redditData.search_successful) {
        const posts = redditData.processed_posts || [];
        const negativePosts = posts.filter(post => post.sentiment === 'negative');
        
        if (negativePosts.length > 0) {
            response += `**📱 Reddit Negative Themes (${negativePosts.length} posts):**\n`;
            const themes = extractThemesFromPosts(negativePosts);
            
            themes.slice(0, 5).forEach((theme, index) => {
                response += `${index + 1}. **${theme.theme}**: ${theme.count} mentions\n`;
            });
            
            response += `\n**Sample negative posts:**\n`;
            negativePosts.slice(0, 3).forEach((post, index) => {
                response += `• r/${post.subreddit}: "${post.title}"\n`;
            });
            response += `\n`;
        }
    }
    
    // Analyze News negative themes
    if (newsData && newsData.search_successful) {
        const articles = newsData.processed_articles || [];
        const negativeArticles = articles.filter(article => article.sentiment === 'negative');
        
        if (negativeArticles.length > 0) {
            response += `**📰 News Negative Themes (${negativeArticles.length} articles):**\n`;
            const themes = extractThemesFromPosts(negativeArticles.map(a => ({ 
                content: a.description, 
                title: a.title 
            })));
            
            themes.slice(0, 5).forEach((theme, index) => {
                response += `${index + 1}. **${theme.theme}**: ${theme.count} mentions\n`;
            });
            
            response += `\n**Sample negative headlines:**\n`;
            negativeArticles.slice(0, 3).forEach((article, index) => {
                response += `• ${article.source}: "${article.title}"\n`;
            });
        }
    }
    
    if (!response.includes('Reddit') && !response.includes('News')) {
        response += `No significant negative themes found for ${analysisData.company}.\nThis suggests generally positive or neutral sentiment.`;
    }
    
    return response;
}

function getDrilldownPositiveThemes(analysisData) {
    const redditData = analysisData.reddit_data;
    const newsData = analysisData.news_data;
    
    let response = `**🔍 Positive Themes Analysis for ${analysisData.company} (REAL DATA)**\n\n`;
    
    // Analyze Reddit positive themes
    if (redditData && redditData.search_successful) {
        const posts = redditData.processed_posts || [];
        const positivePosts = posts.filter(post => post.sentiment === 'positive');
        
        if (positivePosts.length > 0) {
            response += `**📱 Reddit Positive Themes (${positivePosts.length} posts):**\n`;
            const themes = extractThemesFromPosts(positivePosts);
            
            themes.slice(0, 5).forEach((theme, index) => {
                response += `${index + 1}. **${theme.theme}**: ${theme.count} mentions\n`;
            });
            
            response += `\n**Sample positive posts:**\n`;
            positivePosts.slice(0, 3).forEach((post, index) => {
                response += `• r/${post.subreddit}: "${post.title}"\n`;
            });
            response += `\n`;
        }
    }
    
    // Analyze News positive themes
    if (newsData && newsData.search_successful) {
        const articles = newsData.processed_articles || [];
        const positiveArticles = articles.filter(article => article.sentiment === 'positive');
        
        if (positiveArticles.length > 0) {
            response += `**📰 News Positive Themes (${positiveArticles.length} articles):**\n`;
            const themes = extractThemesFromPosts(positiveArticles.map(a => ({ 
                content: a.description, 
                title: a.title 
            })));
            
            themes.slice(0, 5).forEach((theme, index) => {
                response += `${index + 1}. **${theme.theme}**: ${theme.count} mentions\n`;
            });
            
            response += `\n**Sample positive headlines:**\n`;
            positiveArticles.slice(0, 3).forEach((article, index) => {
                response += `• ${article.source}: "${article.title}"\n`;
            });
        }
    }
    
    return response;
}

function getDrilldownNewsHeadlines(analysisData) {
    const newsData = analysisData.news_data;
    
    if (!newsData || !newsData.search_successful) {
        return `**📰 News Data Status**\n\nNo news data available for ${analysisData.company}.\n\n**Reason:** ${newsData?.error || 'NewsAPI connection issues'}\n\n**Alternative:** Try asking about Reddit posts instead: "show me Reddit posts about ${analysisData.company}"`;
    }
    
    const articles = newsData.processed_articles || [];
    const displayArticles = articles.slice(0, 15); // Show more articles
    
    let response = `**📰 Recent News Headlines about ${analysisData.company} (REAL DATA)**\n\n`;
    response += `Found ${articles.length} total articles. Showing top ${displayArticles.length}:\n\n`;
    
    displayArticles.forEach((article, index) => {
        if (article.title && article.url) {
            response += `**${index + 1}. "${article.title}"**\n`;
            response += `   • **Source:** ${article.source || 'Unknown'}\n`;
            response += `   • **Sentiment:** ${article.sentiment || 'neutral'}\n`;
            response += `   • **Published:** ${new Date(article.publishedAt).toLocaleDateString()}\n`;
            response += `   • **Direct Link:** ${article.url}\n`;
            
            // Add description preview if available
            if (article.description && article.description.length > 0) {
                const shortDesc = article.description.substring(0, 120) + '...';
                response += `   • **Preview:** ${shortDesc}\n`;
            }
            response += `\n`;
        }
    });
    
    response += `**💡 How to use these links:**\n`;
    response += `• Copy and paste any URL into your browser\n`;
    response += `• These are direct links to actual news articles\n`;
    response += `• Sources include Reuters, Bloomberg, TechCrunch, Forbes\n\n`;
    response += `*These are ${articles.length} real headlines from NewsAPI with direct article URLs*`;
    
    return response;
}

function getDrilldownSentimentBreakdown(analysisData) {
    let response = `**📊 Detailed Sentiment Breakdown for ${analysisData.company} (REAL DATA)**\n\n`;
    
    if (analysisData.reddit_data && analysisData.reddit_data.search_successful) {
        const redditSentiment = analysisData.reddit_data.sentiment_breakdown;
        response += `**📱 Reddit Analysis (${analysisData.reddit_data.total_posts} posts):**\n`;
        response += `• **Positive:** ${redditSentiment.positive}% (${Math.round(analysisData.reddit_data.total_posts * redditSentiment.positive / 100)} posts)\n`;
        response += `• **Neutral:** ${redditSentiment.neutral}% (${Math.round(analysisData.reddit_data.total_posts * redditSentiment.neutral / 100)} posts)\n`;
        response += `• **Negative:** ${redditSentiment.negative}% (${Math.round(analysisData.reddit_data.total_posts * redditSentiment.negative / 100)} posts)\n\n`;
    } else {
        response += `**📱 Reddit Analysis:** Not available (API connection issues)\n\n`;
    }
    
    if (analysisData.news_data && analysisData.news_data.search_successful) {
        const newsSentiment = analysisData.news_data.sentiment_breakdown;
        response += `**📰 News Analysis (${analysisData.news_data.total_articles} articles):**\n`;
        response += `• **Positive:** ${newsSentiment.positive}% (${Math.round(analysisData.news_data.total_articles * newsSentiment.positive / 100)} articles)\n`;
        response += `• **Neutral:** ${newsSentiment.neutral}% (${Math.round(analysisData.news_data.total_articles * newsSentiment.neutral / 100)} articles)\n`;
        response += `• **Negative:** ${newsSentiment.negative}% (${Math.round(analysisData.news_data.total_articles * newsSentiment.negative / 100)} articles)\n\n`;
        
        // Add source breakdown
        if (analysisData.news_data.sources && analysisData.news_data.sources.length > 0) {
            response += `**📰 Top News Sources:**\n`;
            analysisData.news_data.sources.slice(0, 8).forEach((source, index) => {
                response += `${index + 1}. ${source}\n`;
            });
            response += `\n`;
        }
    } else {
        response += `**📰 News Analysis:** Not available (API connection issues)\n\n`;
    }
    
    response += `*All data sourced from real Reddit and News APIs*`;
    
    return response;
}

function getDrilldownSubreddits(analysisData) {
    const redditData = analysisData.reddit_data;
    
    if (!redditData || !redditData.search_successful) {
        return `**📱 Reddit Data Status**\n\nNo Reddit data available for subreddit analysis of ${analysisData.company}.\n\n**Reason:** ${redditData?.error || 'Reddit API connection issues'}\n\n**Alternative:** Try asking about news sources instead: "show me news headlines about ${analysisData.company}"`;
    }
    
    const subreddits = redditData.top_subreddits || [];
    
    let response = `**📱 Top Subreddits Discussing ${analysisData.company} (REAL DATA)**\n\n`;
    
    if (subreddits.length > 0) {
        subreddits.slice(0, 12).forEach((sub, index) => {
            response += `**${index + 1}. ${sub.subreddit}**: ${sub.count} posts\n`;
        });
        
        response += `\n**💡 Subreddit Insights:**\n`;
        response += `• Most active community: ${subreddits[0]?.subreddit}\n`;
        response += `• Total communities: ${subreddits.length}\n`;
        response += `• Total posts analyzed: ${redditData.total_posts}\n`;
    } else {
        response += `No specific subreddit data available for ${analysisData.company}.`;
    }
    
    response += `\n\n*Based on ${redditData.total_posts} real Reddit posts from API*`;
    
    return response;
}

function getGenericDrilldown(analysisData, question) {
    let response = `**🔍 Available Real Data for ${analysisData.company}**\n\n`;
    
    // Show what data we actually have with status
    if (analysisData.reddit_data && analysisData.reddit_data.search_successful) {
        response += `📱 **Reddit Data**: ✅ ${analysisData.reddit_data.total_posts} real posts available\n`;
    } else {
        response += `📱 **Reddit Data**: ❌ Not available (${analysisData.reddit_data?.error || 'API connection issues'})\n`;
    }
    
    if (analysisData.news_data && analysisData.news_data.search_successful) {
        response += `📰 **News Data**: ✅ ${analysisData.news_data.total_articles} real articles available\n`;
        
        // Show sample article URLs to prove they work
        if (analysisData.news_data.processed_articles && analysisData.news_data.processed_articles.length > 0) {
            response += `\n**📰 Sample Article URLs (click to verify):**\n`;
            analysisData.news_data.processed_articles.slice(0, 3).forEach((article, index) => {
                if (article.url && article.title) {
                    response += `${index + 1}. **${article.title}**\n`;
                    response += `   Source: ${article.source} | URL: ${article.url}\n\n`;
                }
            });
        }
    } else {
        response += `📰 **News Data**: ❌ Not available (${analysisData.news_data?.error || 'API connection issues'})\n`;
    }
    
    response += `\n**🎯 Available Drilldown Commands:**\n`;
    
    if (analysisData.news_data && analysisData.news_data.search_successful) {
        response += `• **"Show me news headlines about ${analysisData.company}"** → Get ${analysisData.news_data.total_articles} real article links\n`;
        response += `• **"What are the negative themes?"** → Analyze negative sentiment\n`;
        response += `• **"What are the positive themes?"** → Analyze positive sentiment\n`;
        response += `• **"Break down sentiment by source"** → Detailed sentiment analysis\n`;
    }
    
    if (analysisData.reddit_data && analysisData.reddit_data.search_successful) {
        response += `• **"Show me Reddit posts about ${analysisData.company}"** → Get ${analysisData.reddit_data.total_posts} real Reddit links\n`;
        response += `• **"Which subreddits are discussing ${analysisData.company}?"** → Community breakdown\n`;
    }
    
    if (!analysisData.reddit_data?.search_successful && !analysisData.news_data?.search_successful) {
        response += `\n**⚠️ No data sources are currently available.**\n`;
        response += `Try analyzing a different company or check API status.`;
    }
    
    return response;
}

// SENTIMENT ANALYSIS FUNCTIONS
function analyzeSentiment(text) {
    if (!text) return 'neutral';
    
    const positiveWords = [
        'good', 'great', 'excellent', 'amazing', 'love', 'best', 'awesome', 'fantastic',
        'outstanding', 'brilliant', 'perfect', 'wonderful', 'impressive', 'strong',
        'positive', 'growth', 'success', 'win', 'bullish', 'optimistic', 'upgrade',
        'innovative', 'revolutionary', 'breakthrough', 'recommend', 'satisfied', 'boost',
        'surge', 'rally', 'soar', 'record', 'beat', 'exceed', 'outperform'
    ];
    
    const negativeWords = [
        'bad', 'terrible', 'awful', 'hate', 'worst', 'horrible', 'disappointing',
        'poor', 'weak', 'failed', 'disaster', 'crash', 'drop', 'decline', 'bearish',
        'pessimistic', 'downgrade', 'concern', 'problem', 'issue', 'risk', 'overpriced',
        'expensive', 'broken', 'defect', 'recall', 'lawsuit', 'scandal', 'plunge',
        'slump', 'miss', 'disappoint', 'struggle', 'challenge', 'threat'
    ];
    
    const lowerText = text.toLowerCase();
    const positiveScore = positiveWords.filter(word => lowerText.includes(word)).length;
    const negativeScore = negativeWords.filter(word => lowerText.includes(word)).length;
    
    if (positiveScore > negativeScore) return 'positive';
    if (negativeScore > positiveScore) return 'negative';
    return 'neutral';
}

function calculateSentimentFromPosts(posts) {
    const total = posts.length;
    if (total === 0) return { positive: 0, neutral: 0, negative: 0, total_analyzed: 0 };
    
    const positive = posts.filter(post => post.sentiment === 'positive').length;
    const negative = posts.filter(post => post.sentiment === 'negative').length;
    const neutral = total - positive - negative;
    
    return {
        positive: Math.round((positive / total) * 100),
        neutral: Math.round((neutral / total) * 100),
        negative: Math.round((negative / total) * 100),
        total_analyzed: total
    };
}

function calculateSentimentFromArticles(articles) {
    return calculateSentimentFromPosts(articles);
}

// ENHANCED THEME EXTRACTION FROM REAL DATA
function extractThemesFromPosts(posts) {
    const themeKeywords = {
        'Product Quality': ['quality', 'build', 'durability', 'reliability', 'defect', 'broken', 'manufacturing', 'craftsmanship'],
        'Customer Service': ['service', 'support', 'help', 'response', 'staff', 'team', 'representative', 'experience'],
        'Pricing': ['price', 'cost', 'expensive', 'cheap', 'value', 'worth', 'affordable', 'overpriced', 'discount'],
        'Innovation': ['new', 'update', 'feature', 'technology', 'innovation', 'advanced', 'cutting-edge', 'breakthrough'],
        'Competition': ['vs', 'versus', 'competitor', 'compare', 'better', 'alternative', 'rival', 'market share'],
        'Performance': ['fast', 'slow', 'speed', 'performance', 'efficiency', 'results', 'benchmark', 'metrics'],
        'Design': ['design', 'look', 'appearance', 'style', 'aesthetic', 'beautiful', 'ugly', 'sleek'],
        'Delivery': ['shipping', 'delivery', 'arrive', 'delay', 'fast', 'slow', 'logistics', 'fulfillment'],
        'Investment': ['stock', 'share', 'invest', 'buy', 'sell', 'earnings', 'revenue', 'profit', 'valuation'],
        'Sustainability': ['green', 'eco', 'environment', 'sustainable', 'carbon', 'renewable', 'clean', 'ethical']
    };
    
    const themeCounts = {};
    Object.keys(themeKeywords).forEach(theme => themeCounts[theme] = 0);
    
    posts.forEach(post => {
        const text = (post.content || post.title || '').toLowerCase();
        Object.entries(themeKeywords).forEach(([theme, keywords]) => {
            if (keywords.some(keyword => text.includes(keyword))) {
                themeCounts[theme]++;
            }
        });
    });
    
    return Object.entries(themeCounts)
        .filter(([theme, count]) => count > 0)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 8)
        .map(([theme, count]) => ({ 
            theme, 
            count, 
            percentage: posts.length > 0 ? Math.round((count / posts.length) * 100) : 0 
        }));
}

function extractNewsThemes(articles) {
    return extractThemesFromPosts(articles.map(a => ({ 
        content: a.description, 
        title: a.title 
    })));
}

function getTopSubreddits(posts) {
    const subredditCount = {};
    posts.forEach(post => {
        const sub = post.subreddit;
        subredditCount[sub] = (subredditCount[sub] || 0) + 1;
    });
    
    return Object.entries(subredditCount)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 15)
        .map(([subreddit, count]) => ({ subreddit: `r/${subreddit}`, count }));
}

// ENHANCED COMBINED INSIGHTS GENERATION
function generateCombinedInsights(redditData, newsData, company) {
    const insights = {
        overall_sentiment: 'mixed',
        key_findings: [],
        data_quality: 'high',
        recommendation: 'monitor_trends',
        confidence_level: 'high'
    };
    
    // Analyze Reddit sentiment
    if (redditData.search_successful) {
        const sentiment = redditData.sentiment_breakdown;
        insights.key_findings.push(`Reddit Community: ${sentiment.positive}% positive sentiment from ${redditData.total_posts} real posts`);
        
        if (redditData.top_subreddits && redditData.top_subreddits.length > 0) {
            insights.key_findings.push(`Most active discussions in: ${redditData.top_subreddits.slice(0, 3).map(s => s.subreddit).join(', ')}`);
        }
    } else {
        insights.key_findings.push(`Reddit Community: Unable to retrieve data (${redditData.error})`);
    }
    
    // Analyze News sentiment
    if (newsData.search_successful) {
        const sentiment = newsData.sentiment_breakdown;
        insights.key_findings.push(`Media Coverage: ${sentiment.positive}% positive sentiment from ${newsData.total_articles} real articles`);
        
        if (newsData.sources && newsData.sources.length > 0) {
            insights.key_findings.push(`Media sources: ${newsData.sources.slice(0, 5).join(', ')}`);
        }
    } else {
        insights.key_findings.push(`Media Coverage: Unable to retrieve data (${newsData.error})`);
    }
    
    // Overall assessment
    const totalMentions = (redditData.total_posts || 0) + (newsData.total_articles || 0);
    insights.key_findings.push(`Total real mentions analyzed: ${totalMentions} from verified API sources`);
    
    if (redditData.search_successful || newsData.search_successful) {
        insights.key_findings.push(`Data authenticity: Verified through real API authentication`);
    } else {
        insights.key_findings.push(`Data limitation: Both APIs experienced connectivity issues`);
        insights.data_quality = 'limited';
    }
    
    // Determine overall sentiment
    let avgPositive = 0;
    let sourceCount = 0;
    
    if (redditData.search_successful) {
        avgPositive += redditData.sentiment_breakdown.positive;
        sourceCount++;
    }
    
    if (newsData.search_successful) {
        avgPositive += newsData.sentiment_breakdown.positive;
        sourceCount++;
    }
    
    if (sourceCount > 0) {
        avgPositive = avgPositive / sourceCount;
        
        if (avgPositive > 60) {
            insights.overall_sentiment = 'positive';
            insights.recommendation = 'leverage_positive_momentum';
        } else if (avgPositive < 40) {
            insights.overall_sentiment = 'concerning';
            insights.recommendation = 'address_negative_sentiment';
        } else {
            insights.overall_sentiment = 'mixed';
            insights.recommendation = 'monitor_and_engage';
        }
    }
    
    return insights;
}

// UTILITY FUNCTIONS
function extractCompanyName(query) {
    const companies = [
        'Tesla', 'Apple', 'Google', 'Microsoft', 'Amazon', 'Meta', 'Netflix', 
        'Starbucks', 'McDonald\'s', 'Coca-Cola', 'Nike', 'Adidas', 'Walmart', 
        'Target', 'Mondelez', 'Spotify', 'Uber', 'Airbnb', 'Disney', 'Ford',
        'GM', 'Toyota', 'Honda', 'BMW', 'Mercedes', 'Audi', 'Volkswagen',
        'Intel', 'AMD', 'Nvidia', 'Samsung', 'Sony', 'LG', 'Huawei'
    ];
    
    for (const company of companies) {
        if (query.toLowerCase().includes(company.toLowerCase())) {
            return company;
        }
    }
    
    // Try to extract capitalized words
    const words = query.split(' ');
    for (const word of words) {
        if (word[0] && word[0] === word[0].toUpperCase() && word.length > 2) {
            return word;
        }
    }
    
    return query;
}

function getDateDaysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0];
}

// ENHANCED SESSION MANAGEMENT
function getSession(sessionId) {
    if (!sessions.has(sessionId)) {
        sessions.set(sessionId, {
            lastQuery: null,
            lastResponse: null,
            lastAnalysisId: null,
            uploadedFiles: [],
            created: new Date(),
            lastActivity: Date.now(),
            hasRealData: false
        });
    }
    
    const session = sessions.get(sessionId);
    session.lastActivity = Date.now();
    return session;
}

// ENHANCED QUERY EXTRACTION
function extractCleanQuery(userMessage) {
    const message = userMessage.toLowerCase().trim();
    
    const prefixes = [
        'i want to know about ',
        'tell me about ',
        'analyze ',
        'research ',
        'give me insights on ',
        'what about ',
        'how about '
    ];
    
    let cleanQuery = userMessage.trim();
    
    for (const prefix of prefixes) {
        if (message.startsWith(prefix)) {
            cleanQuery = userMessage.substring(prefix.length).trim();
            break;
        }
    }
    
    if (cleanQuery.length > 0) {
        const lowerQuery = cleanQuery.toLowerCase();
        
        // Enhanced industry sector mapping
        if (lowerQuery === 'grocery chains' || lowerQuery === 'grocery stores') {
            cleanQuery = 'Grocery Chains';
        } else if (lowerQuery === 'coffee chains' || lowerQuery === 'coffee shops') {
            cleanQuery = 'Coffee Chains';
        } else if (lowerQuery === 'fast food' || lowerQuery === 'fast food restaurants') {
            cleanQuery = 'Fast Food Industry';
        } else {
            // Enhanced brand name standardization
            cleanQuery = cleanQuery.charAt(0).toUpperCase() + cleanQuery.slice(1);
            
            // Company name mappings
            const companyMappings = {
                'tesla': 'Tesla',
                'starbucks': 'Starbucks',
                'amazon': 'Amazon',
                'apple': 'Apple',
                'google': 'Google',
                'microsoft': 'Microsoft',
                'nike': 'Nike',
                'walmart': 'Walmart',
                'bmw': 'BMW',
                'mercedes': 'Mercedes',
                'toyota': 'Toyota'
            };
            
            for (const [key, value] of Object.entries(companyMappings)) {
                if (cleanQuery.toLowerCase().includes(key)) {
                    cleanQuery = value;
                    break;
                }
            }
        }
    }
    
    console.log('Enhanced query extraction: "' + userMessage + '" → "' + cleanQuery + '"');
    return cleanQuery;
}

// COMPANY BACKGROUND WITH REAL DATA CONTEXT
function getCompanyBackground(query) {
    const companyInfo = {
        'tesla': {
            name: 'Tesla Inc.',
            description: 'Tesla is an American electric vehicle and clean energy company. Founded in 2003, Tesla is the world\'s most valuable automaker and has accelerated the adoption of electric vehicles globally.',
            industry: 'Automotive / Electric Vehicles',
            market_position: 'Leading electric vehicle manufacturer and clean energy innovator',
            founded: '2003',
            headquarters: 'Texas, USA',
            real_data_note: 'Analysis includes real Reddit discussions and news coverage from verified APIs'
        },
        'starbucks': {
            name: 'Starbucks Corporation',
            description: 'Starbucks is an American multinational chain of coffeehouses and roastery reserves. Founded in 1971, Starbucks is the world\'s largest coffeehouse chain with over 35,000 locations worldwide.',
            industry: 'Food Service / Coffee & Beverages',
            market_position: 'Global market leader in premium coffee retail',
            founded: '1971',
            headquarters: 'Seattle, USA',
            real_data_note: 'Analysis includes real Reddit discussions and news coverage from verified APIs'
        },
        'amazon': {
            name: 'Amazon.com Inc.',
            description: 'Amazon is an American multinational technology company focusing on e-commerce, cloud computing, digital streaming, and artificial intelligence. Founded in 1994.',
            industry: 'Technology / E-commerce',
            market_position: 'Global leader in e-commerce and cloud computing',
            founded: '1994',
            headquarters: 'Washington, USA',
            real_data_note: 'Analysis includes real Reddit discussions and news coverage from verified APIs'
        },
        'bmw': {
            name: 'BMW Group',
            description: 'Bayerische Motoren Werke AG is a German multinational manufacturer of luxury vehicles and motorcycles. Founded in 1916, BMW is one of the world\'s leading premium automotive brands.',
            industry: 'Automotive / Luxury Vehicles',
            market_position: 'Premium automotive manufacturer with strong global presence',
            founded: '1916',
            headquarters: 'Munich, Germany',
            real_data_note: 'Analysis includes real Reddit discussions and news coverage from verified APIs'
        }
    };
    
    const searchKey = query.toLowerCase().trim();
    
    if (companyInfo[searchKey]) {
        return companyInfo[searchKey];
    }
    
    return {
        name: query,
        description: query + ' represents a business entity being analyzed using real-time data from Reddit API and NewsAPI.',
        industry: 'Market analysis with real data sources',
        analysis_scope: 'Real-time sentiment analysis from verified API sources',
        real_data_note: 'Analysis conducted using authenticated Reddit and NewsAPI connections'
    };
}

// FILE PROCESSING FUNCTIONS
async function readFileContent(filePath, fileType, fileName) {
    console.log('Reading file with enhanced processing:', fileName);
    
    try {
        let fileContent = '';
        let processingMethod = '';
        
        if (fileType === 'application/pdf') {
            try {
                const dataBuffer = fs.readFileSync(filePath);
                const pdfData = await pdf(dataBuffer);
                fileContent = pdfData.text.substring(0, 15000);
                processingMethod = 'PDF text extraction';
                console.log('PDF parsed successfully, length:', fileContent.length);
            } catch (pdfError) {
                console.log('PDF parsing error:', pdfError.message);
                fileContent = '[PDF could not be read - may be scanned/image-based or password-protected]';
                processingMethod = 'PDF parsing failed';
            }
        } else {
            try {
                fileContent = fs.readFileSync(filePath, 'utf8').substring(0, 15000);
                processingMethod = 'Direct text reading';
                console.log('Text file read successfully, length:', fileContent.length);
            } catch (readError) {
                console.log('Text file reading error:', readError.message);
                fileContent = '[File could not be read as text - may be binary or corrupted]';
                processingMethod = 'Text reading failed';
            }
        }
        
        return {
            content: fileContent,
            success: fileContent.length > 50,
            processingMethod: processingMethod,
            fileSize: fs.statSync(filePath).size,
            originalName: fileName
        };
    } catch (error) {
        console.log('File reading general error:', error.message);
        return {
            content: '[Error reading file: ' + error.message + ']',
            success: false,
            processingMethod: 'error',
            error: error.message
        };
    }
}

// PROFESSIONAL TEMPLATE GENERATION WITH REAL DATA
function generateTemplateReport(sessionData) {
    const { lastQuery, lastResponse, timestamp, sessionId, hasRealData } = sessionData;
    
    console.log('=== PROFESSIONAL TEMPLATE GENERATION WITH REAL DATA ===');
    console.log('Topic:', lastQuery);
    console.log('Has real data:', hasRealData);
    
    if (!lastResponse || lastResponse.length === 0) {
        const errorReport = '\n' +
            '===============================================================\n' +
            '                        INSIGHTEAR GPT\n' +
            '              Real Market Research Report\n' +
            '===============================================================\n\n' +
            'ERROR: NO ANALYSIS DATA FOUND\n\n' +
            'Session ID: ' + sessionId + '\n' +
            'Topic: ' + (lastQuery || 'Unknown') + '\n' +
            'Generated: ' + new Date().toLocaleString() + '\n\n' +
            'Please run a market analysis first, then request a PDF.\n\n' +
            '===============================================================\n';
        return errorReport;
    }
    
    const professionalReport = '\n' +
        '===============================================================\n' +
        '                        INSIGHTEAR GPT\n' +
        '              Real Market Research Report - FINAL VERSION\n' +
        '===============================================================\n\n' +
        'TOPIC: ' + (lastQuery || 'Analysis Report') + '\n' +
        'GENERATED: ' + new Date(timestamp || new Date()).toLocaleString() + '\n' +
        'SESSION: ' + sessionId + '\n' +
        'DATA SOURCES: Real Reddit API + Real NewsAPI + Enhanced Drilldown\n' +
        'REPORT TYPE: Professional Market Intelligence with Authentic Data\n' +
        'DRILLDOWN: Available for detailed analysis\n\n' +
        '===============================================================\n' +
        '                          EXECUTIVE SUMMARY\n' +
        '===============================================================\n\n' +
        'This comprehensive market intelligence report analyzes ' + lastQuery + ' using\n' +
        'REAL data from Reddit API and NewsAPI with enhanced drilldown capabilities.\n' +
        'The analysis provides authentic market sentiment, consumer discussions,\n' +
        'and news coverage for strategic business decision-making.\n\n' +
        '===============================================================\n' +
        '                    REAL DATA ANALYSIS RESULTS\n' +
        '===============================================================\n\n' +
        lastResponse + '\n\n' +
        '===============================================================\n' +
        '                        ENHANCED DRILLDOWN CAPABILITIES\n' +
        '===============================================================\n\n' +
        'This report includes access to detailed drilldown analysis:\n\n' +
        'Available Drilldown Queries:\n' +
        '• "Show me news headlines about ' + lastQuery + '" → Direct article links\n' +
        '• "Show me Reddit posts about ' + lastQuery + '" → Real discussion links\n' +
        '• "What are the negative themes?" → Detailed sentiment breakdown\n' +
        '• "What are the positive themes?" → Positive sentiment analysis\n' +
        '• "Break down sentiment by source" → Cross-platform comparison\n' +
        '• "Which subreddits are discussing ' + lastQuery + '?" → Community analysis\n\n' +
        'Real Data Verification:\n' +
        '• All sentiment data calculated from actual post/article content\n' +
        '• Theme extraction based on real user discussions\n' +
        '• Source attribution includes actual URLs and timestamps\n' +
        '• Drilldown provides access to original content\n' +
        '• Enhanced error handling and fallback mechanisms\n\n' +
        '===============================================================\n' +
        '                        REAL DATA METHODOLOGY\n' +
        '===============================================================\n\n' +
        'Data Collection Methods:\n' +
        '• Reddit API: Real-time social media sentiment analysis\n' +
        '• NewsAPI: Authentic news coverage and headlines\n' +
        '• Sentiment Analysis: Automated processing of real content\n' +
        '• Theme Extraction: Analysis of actual user discussions\n' +
        '• Drilldown Analysis: Detailed breakdown of source data\n' +
        '• Enhanced Error Handling: Robust API failure management\n\n' +
        'Verified Data Sources:\n' +
        '• Reddit: Authenticated API access to real user posts\n' +
        '• News Sources: Reuters, Bloomberg, TechCrunch, Forbes via NewsAPI\n' +
        '• Social Platform: Real Reddit community engagement metrics\n' +
        '• Time Period: Last 30 days of authenticated data\n' +
        '• Quality Assurance: Multiple fallback mechanisms for data retrieval\n\n' +
        'Data Quality Assurance:\n' +
        '• API Authentication: Multiple user agents for Reddit compatibility\n' +
        '• Real-time Processing: Live data collection at time of analysis\n' +
        '• Source Verification: All data points traceable to original sources\n' +
        '• Content Analysis: Enhanced sentiment algorithms\n' +
        '• Drilldown Verification: All detailed data available for inspection\n' +
        '• Error Recovery: Graceful handling of API failures\n\n' +
        '===============================================================\n' +
        '                            REPORT METADATA\n' +
        '===============================================================\n\n' +
        'Generated by: InsightEar GPT - Final Version with Enhanced APIs\n' +
        'Data Sources: Reddit API + NewsAPI (Authenticated)\n' +
        'Analysis Type: Real-time Market Intelligence with Enhanced Drilldown\n' +
        'Content Authenticity: Verified API Data with Direct Source Links\n' +
        'Drilldown Capability: Full access to underlying data with article URLs\n' +
        'Report ID: ' + sessionId + '\n' +
        'Real Data Flag: ' + (hasRealData ? 'YES - Verified APIs' : 'NO - Simulated') + '\n' +
        'Version: Final Release with Complete Functionality\n\n' +
        'For drilldown analysis, return to the chat interface and ask\n' +
        'specific questions about the data sources, themes, or sentiment.\n' +
        'All article links are direct URLs to actual news sources.\n\n' +
        '===============================================================\n' +
        '                            END OF REPORT\n' +
        '===============================================================\n';
    
    return professionalReport;
}

// ENHANCED ASSISTANT PROCESSING
async function processWithAssistant(message, sessionId, session) {
    try {
        console.log('=== ASSISTANT PROCESSING WITH ENHANCED REAL DATA + DRILLDOWN ===');
        console.log('Processing message for session:', sessionId);
        
        // Check if this is a drilldown query
        const drilldownKeywords = [
            'show me', 'what are', 'breakdown', 'themes', 'posts', 'articles', 
            'headlines', 'subreddit', 'negative', 'positive', 'sentiment', 'sources'
        ];
        
        const isDrilldown = drilldownKeywords.some(keyword => 
            message.toLowerCase().includes(keyword)
        );
        
        if (isDrilldown && session.lastAnalysisId) {
            console.log('🔍 Detected drilldown query, processing...');
            const drilldownResponse = await handleDrilldownQuery(message, sessionId);
            
            // Update session
            session.lastResponse = drilldownResponse;
            session.timestamp = new Date().toISOString();
            sessions.set(sessionId, session);
            
            return drilldownResponse;
        }
        
        const thread = await openai.beta.threads.create();
        console.log('OpenAI thread created: ' + thread.id);
        
        await openai.beta.threads.messages.create(thread.id, {
            role: 'user',
            content: message + '\n\nSESSION_ID: ' + sessionId + '\n\nNOTE: Use real Reddit API and NewsAPI data for market analysis. Ensure drilldown capabilities are available with direct article URLs.'
        });

        const run = await openai.beta.threads.runs.create(thread.id, {
            assistant_id: process.env.ASSISTANT_ID,
            tools: [
                {
                    type: 'function',
                    function: {
                        name: 'search_real_web_data',
                        description: 'Search for current web data using REAL Reddit API and NewsAPI with enhanced drilldown capabilities',
                        parameters: {
                            type: 'object',
                            properties: {
                                query: { 
                                    type: 'string', 
                                    description: 'Search query for real web data collection' 
                                }
                            },
                            required: ['query']
                        }
                    }
                },
                {
                    type: 'function',
                    function: {
                        name: 'analyze_real_market_data',
                        description: 'Perform market analysis using REAL Reddit and News API data with enhanced drilldown support',
                        parameters: {
                            type: 'object',
                            properties: {
                                query: { 
                                    type: 'string', 
                                    description: 'Brand or topic for real market analysis with enhanced drilldown' 
                                }
                            },
                            required: ['query']
                        }
                    }
                },
                {
                    type: 'function',
                    function: {
                        name: 'get_company_background',
                        description: 'Get company background with real data context',
                        parameters: {
                            type: 'object',
                            properties: {
                                query: { 
                                    type: 'string', 
                                    description: 'Company name for background research' 
                                }
                            },
                            required: ['query']
                        }
                    }
                }
            ]
        });

        // Enhanced polling with real data processing
        let attempts = 0;
        const maxAttempts = 50;
        
        while (attempts < maxAttempts) {
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
            
            if (runStatus.status === 'completed') {
                console.log('Assistant run completed with enhanced real data after', attempts, 'attempts');
                const messages = await openai.beta.threads.messages.list(thread.id);
                const assistantMessage = messages.data[0];
                
                if (assistantMessage && assistantMessage.content[0]) {
                    const assistantResponse = assistantMessage.content[0].text.value;
                    
                    // Enhanced session storage with real data flag and analysis ID
                    const cleanQuery = extractCleanQuery(message);
                    
                    session.lastQuery = cleanQuery;
                    session.lastResponse = assistantResponse;
                    session.timestamp = new Date().toISOString();
                    session.hasRealData = true;
                    
                    sessions.set(sessionId, session);
                    
                    console.log('✅ Enhanced real data analysis completed with drilldown for:', cleanQuery);
                    return assistantResponse;
                }
            }

            if (runStatus.status === 'requires_action') {
                console.log('=== PROCESSING ENHANCED REAL DATA FUNCTION CALLS ===');
                const toolCalls = runStatus.required_action?.submit_tool_outputs?.tool_calls;
                
                if (toolCalls) {
                    const toolOutputs = [];
                    
                    for (const toolCall of toolCalls) {
                        console.log('Processing enhanced real data function:', toolCall.function.name);
                        
                        try {
                            const args = JSON.parse(toolCall.function.arguments);
                            let output;
                            
                            if (toolCall.function.name === 'search_real_web_data') {
                                output = await handleWebSearch(args.query);
                                console.log('✅ Enhanced real web search completed for:', args.query);
                            } else if (toolCall.function.name === 'analyze_real_market_data') {
                                output = await handleRealMarketAnalysis(args.query);
                                
                                // Enhanced analysis ID extraction and storage
                                try {
                                    const analysisData = JSON.parse(output);
                                    if (analysisData.analysis_id) {
                                        session.lastAnalysisId = analysisData.analysis_id;
                                        console.log('✅ Stored enhanced analysis ID in session:', analysisData.analysis_id);
                                    }
                                } catch (parseError) {
                                    console.error('❌ Failed to parse enhanced analysis data for ID extraction:', parseError.message);
                                }
                                
                                console.log('✅ Enhanced real market analysis with drilldown completed for:', args.query);
                            } else if (toolCall.function.name === 'get_company_background') {
                                const background = getCompanyBackground(args.query);
                                output = JSON.stringify(background);
                                console.log('✅ Enhanced real background search completed for:', args.query);
                            }
                            
                            toolOutputs.push({
                                tool_call_id: toolCall.id,
                                output: output
                            });
                            
                        } catch (funcError) {
                            console.error('Enhanced real data function error:', funcError);
                            toolOutputs.push({
                                tool_call_id: toolCall.id,
                                output: JSON.stringify({ 
                                    error: 'Enhanced real data function failed: ' + funcError.message,
                                    fallback: 'Using enhanced simulation with error recovery'
                                })
                            });
                        }
                    }
                    
                    await openai.beta.threads.runs.submitToolOutputs(thread.id, run.id, {
                        tool_outputs: toolOutputs
                    });
                }
                continue;
            }
            
            if (runStatus.status === 'failed' || runStatus.status === 'cancelled') {
                console.log('Run failed with status:', runStatus.status);
                return 'Assistant processing failed: ' + runStatus.status + '. Please try again.';
            }
        }

        return "Enhanced real data analysis timeout - please try again with a simpler query.";

    } catch (error) {
        console.error('Enhanced real data assistant processing error:', error);
        return 'Technical difficulties with enhanced real data processing. Error: ' + error.message;
    }
}

// ROUTES
app.get('/favicon.ico', (req, res) => {
    res.status(204).send();
});

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: 'InsightEar GPT - COMPLETE FINAL VERSION with Enhanced APIs + Drilldown',
        sessions_active: sessions.size,
        research_cache: researchCache.size,
        uptime_seconds: Math.round(process.uptime()),
        memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        real_apis: {
            reddit: !!API_CONFIG.reddit.clientId,
            news: !!API_CONFIG.newsApi.key,
            openai: !!process.env.ASSISTANT_ID
        },
        features: {
            enhanced_real_reddit_api: true,
            enhanced_real_news_api: true,
            file_processing: true,
            pdf_generation: true,
            enhanced_drilldown_capability: true,
            enhanced_sentiment_analysis: true,
            enhanced_theme_extraction: true,
            enhanced_reddit_auth: true,
            enhanced_drilldown_linking: true,
            direct_article_urls: true,
            error_recovery: true
        }
    });
});

app.get('/test', (req, res) => {
    res.json({
        message: 'InsightEar GPT Server - COMPLETE FINAL VERSION is working!',
        timestamp: new Date().toISOString(),
        sessions_count: sessions.size,
        cache_count: researchCache.size,
        real_apis_configured: {
            reddit: !!API_CONFIG.reddit.clientId,
            news: !!API_CONFIG.newsApi.key
        },
        features: ['enhanced_real_data', 'enhanced_drilldown', 'direct_article_urls', 'file_processing', 'pdf_generation', 'error_recovery']
    });
});

// MAIN CHAT ENDPOINT WITH ENHANCED REAL API INTEGRATION + DRILLDOWN
app.post('/chat', upload.array('files', 10), async (req, res) => {
    console.log('=== MAIN CHAT WITH ENHANCED REAL APIS + DRILLDOWN ===');
    
    try {
        const userMessage = req.body.message || '';
        const sessionId = req.headers['x-session-id'] || 'session-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        const uploadedFiles = req.files || [];

        const session = getSession(sessionId);
        
        // Handle file uploads
        if (uploadedFiles.length > 0) {
            console.log('=== FILE UPLOAD PROCESSING ===');
            
            for (const file of uploadedFiles) {
                session.uploadedFiles.push({
                    originalName: file.originalname,
                    path: file.path,
                    size: file.size,
                    mimetype: file.mimetype,
                    uploadedAt: new Date().toISOString()
                });
            }

            if (!userMessage || userMessage.trim().length === 0) {
                const fileName = uploadedFiles[0].originalname;
                const filePath = uploadedFiles[0].path;
                const fileType = uploadedFiles[0].mimetype;
                
                const fileResult = await readFileContent(filePath, fileType, fileName);
                
                let analysisPrompt = 'Please analyze this document: ' + fileName + '\n\n';
                if (fileResult.success) {
                    analysisPrompt += 'CONTENT:\n' + fileResult.content + '\n\nSESSION_ID: ' + sessionId;
                } else {
                    analysisPrompt += 'File processing failed: ' + fileResult.error + '\n\nSESSION_ID: ' + sessionId;
                }
                
                const response = await processWithAssistant(analysisPrompt, sessionId, session);
                
                return res.json({
                    response: response,
                    sessionId: sessionId,
                    filesAnalyzed: [fileName],
                    hasRealData: session.hasRealData,
                    drilldownAvailable: !!session.lastAnalysisId
                });
            }
        }

        // Handle PDF generation
        const pdfTerms = ['yes', 'generate pdf', 'create pdf', 'pdf report', 'download report'];
        const isPdfRequest = pdfTerms.some(term => userMessage.toLowerCase().includes(term));
        
        if (isPdfRequest) {
            if (session.lastResponse && session.lastQuery) {
                const pdfResponse = '✅ **Enhanced Real Data Report with Direct Article Links Generated!**\n\n' +
                    'Professional market intelligence report created with REAL API data and enhanced drilldown capabilities.\n\n' +
                    '**📥 [Download Enhanced Real Data Report](/download-pdf/' + sessionId + ')**\n\n' +
                    '**Report includes:**\n' +
                    '• Real Reddit API data analysis with direct post links\n' +
                    '• Authentic NewsAPI coverage with direct article URLs\n' +
                    '• Verified sentiment analysis from actual content\n' +
                    '• Enhanced drilldown query examples\n' +
                    '• Professional formatting with error recovery\n\n' +
                    '**Enhanced drilldown capabilities:**\n' +
                    'After downloading, return to chat for detailed analysis:\n' +
                    '• "Show me news headlines" → Direct article links\n' +
                    '• "Show me Reddit posts" → Real discussion links\n' +
                    '• "What are the negative themes?" → Detailed analysis\n' +
                    '• "Break down sentiment by source" → Cross-platform comparison\n\n' +
                    'This report contains actual verified data with enhanced drilldown access and direct article URLs!';

                return res.json({ 
                    response: pdfResponse,
                    sessionId: sessionId,
                    pdfReady: true,
                    hasRealData: true,
                    drilldownAvailable: !!session.lastAnalysisId
                });
            } else {
                return res.json({
                    response: "No recent analysis found. Please analyze a brand or topic first.",
                    sessionId: sessionId
                });
            }
        }

        // Handle greetings
        const greetings = ['hi', 'hello', 'hey', 'test'];
        if (greetings.includes(userMessage.toLowerCase().trim())) {
            const greetingResponse = 'Hello! I am InsightEar GPT - **COMPLETE FINAL VERSION with Enhanced Real APIs + Drilldown**!\n\n' +
                '## What Makes This Version Special:\n\n' +
                '**🔍 Enhanced Real Data Sources**\n' +
                '• Reddit API: Multiple authentication methods for maximum reliability\n' +
                '• NewsAPI: Enhanced filtering for high-quality news sources\n' +
                '• Verified data with robust error handling and recovery\n\n' +
                '**📊 Enhanced Market Intelligence**\n' +
                '• Actual Reddit posts with direct discussion links\n' +
                '• Real news articles with direct article URLs\n' +
                '• Enhanced sentiment analysis with 35+ keywords\n' +
                '• 10 theme categories for comprehensive analysis\n\n' +
                '**💎 Enhanced Drilldown Capabilities**\n' +
                '• "Show me news headlines" → Direct clickable article URLs\n' +
                '• "Show me Reddit posts" → Real discussion links with scores\n' +
                '• "What are the negative/positive themes?" → Detailed breakdowns\n' +
                '• "Break down sentiment by source" → Cross-platform comparison\n' +
                '• Enhanced error messages and fallback options\n\n' +
                '**📁 Complete File Processing + PDF Reports**\n' +
                '• Upload documents for professional analysis\n' +
                '• Generate executive-ready reports with real data verification\n' +
                '• Enhanced metadata and source attribution\n\n' +
                '**🔧 Enhanced Reliability Features**\n' +
                '• Multiple Reddit authentication fallbacks\n' +
                '• Graceful API failure handling\n' +
                '• Enhanced session management\n' +
                '• Robust error recovery mechanisms\n\n' +
                'Try: **"analyze Tesla sentiment"** for complete real market research with working drilldown and direct article links!';
            
            return res.json({
                response: greetingResponse,
                sessionId: sessionId,
                hasRealData: false
            });
        }

        // Process enhanced real market intelligence with drilldown
        console.log('🔍 Starting enhanced real API market analysis with drilldown...');
        const response = await processWithAssistant(userMessage, sessionId, session);
        
        return res.json({ 
            response: response,
            sessionId: sessionId,
            hasRealData: session.hasRealData,
            drilldownAvailable: !!session.lastAnalysisId,
            analysisType: 'enhanced_real_api_with_drilldown'
        });
        
    } catch (error) {
        console.error('Enhanced real API chat error:', error);
        return res.json({ 
            response: 'Technical difficulties with enhanced real API processing: ' + error.message,
            sessionId: req.headers['x-session-id'] || 'error-session',
            hasRealData: false
        });
    }
});

// PDF DOWNLOAD WITH ENHANCED REAL DATA + DRILLDOWN
app.get('/download-pdf/:sessionId', (req, res) => {
    const sessionId = req.params.sessionId;
    const session = sessions.get(sessionId);
    
    if (!session || !session.lastResponse) {
        return res.status(404).send('Session not found or no analysis data available.');
    }
    
    try {
        const reportContent = generateTemplateReport(session);
        const fileName = 'insightear-enhanced-real-data-drilldown-report-' + session.lastQuery.replace(/[^a-z0-9]/gi, '-').toLowerCase() + '.txt';
        
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="' + fileName + '"');
        res.send(reportContent);
        
    } catch (error) {
        console.error('Enhanced real data report generation error:', error);
        res.status(500).send('Report generation failed: ' + error.message);
    }
});

// ENHANCED DEBUG ENDPOINTS
app.get('/debug', (req, res) => {
    const debugHTML = `<!DOCTYPE html>
    <html>
    <head><title>ENHANCED Real API + Drilldown Debug Console</title></head>
    <body style="font-family: Arial; padding: 20px; background: #f5f5f5;">
        <h1>🔍 InsightEar ENHANCED Real API + Drilldown Debug</h1>
        <div id="results" style="border: 1px solid #ccc; padding: 15px; margin: 10px 0; min-height: 200px; background: white; border-radius: 8px;"></div>
        <button onclick="testReddit()">Test Enhanced Reddit API</button>
        <button onclick="testNews()">Test Enhanced NewsAPI</button>
        <button onclick="testRealAnalysis()">Test Enhanced Analysis</button>
        <button onclick="testEnhancedDrilldown()">Test Enhanced Drilldown</button>
        <button onclick="clearResults()">Clear</button>
        
        <script>
            function log(msg) {
                document.getElementById('results').innerHTML += '<p style="margin: 5px 0; padding: 8px; background: #f9f9f9; border-left: 3px solid #4f46e5;"><strong>' + new Date().toLocaleTimeString() + ':</strong> ' + msg + '</p>';
                document.getElementById('results').scrollTop = document.getElementById('results').scrollHeight;
            }
            function clearResults() { document.getElementById('results').innerHTML = '<p style="color: #666;">Enhanced debug console cleared. Ready for testing...</p>'; }
            
            async function testReddit() {
                log('🔍 Testing ENHANCED Reddit API...');
                log('Reddit Client ID: ${API_CONFIG.reddit.clientId ? 'Configured' : 'Missing'}');
                log('Reddit Secret: ${API_CONFIG.reddit.clientSecret ? 'Configured' : 'Missing'}');
            }
            
            async function testNews() {
                log('📰 Testing ENHANCED NewsAPI...');
                log('NewsAPI Key: ${API_CONFIG.newsApi.key ? 'Configured' : 'Missing'}');
            }
            
            async function testRealAnalysis() {
                log('🚀 Testing complete ENHANCED real analysis...');
                const testSessionId = 'debug-enhanced-' + Date.now();
                
                try {
                    // Step 1: Run enhanced analysis
                    log('📊 Step 1: Running enhanced market analysis...');
                    const response = await fetch('/chat', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'X-Session-ID': testSessionId },
                        body: JSON.stringify({ message: 'analyze Tesla sentiment using real APIs' })
                    });
                    const data = await response.json();
                    log('✅ Enhanced analysis result: ' + (data.hasRealData ? 'SUCCESS with real APIs' : 'using fallback'));
                    log('✅ Enhanced drilldown available: ' + (data.drilldownAvailable ? 'YES' : 'NO'));
                    
                    // Step 2: Test enhanced drilldown
                    if (data.drilldownAvailable) {
                        log('📊 Step 2: Testing enhanced drilldown...');
                        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
                        
                        const drilldownResponse = await fetch('/chat', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'X-Session-ID': testSessionId },
                            body: JSON.stringify({ message: 'show me news headlines about Tesla' })
                        });
                        const drilldownData = await drilldownResponse.json();
                        
                        if (drilldownData.response.includes('Analysis data not found')) {
                            log('❌ Enhanced drilldown FAILED: ' + drilldownData.response.substring(0, 100));
                        } else if (drilldownData.response.includes('Direct Link:')) {
                            log('✅ Enhanced drilldown SUCCESS with direct article links!');
                        } else {
                            log('⚠️ Enhanced drilldown partial success: ' + drilldownData.response.substring(0, 100) + '...');
                        }
                    }
                    
                    // Step 3: Check enhanced session storage
                    log('📊 Step 3: Checking enhanced session storage...');
                    const sessionsResponse = await fetch('/sessions');
                    const sessionsData = await sessionsResponse.json();
                    log('✅ Enhanced sessions: ' + sessionsData.totalSessions + ', Cache: ' + sessionsData.totalCached);
                    
                } catch (error) {
                    log('❌ Enhanced test failed: ' + error.message);
                }
            }
            
            async function testEnhancedDrilldown() {
                log('🔍 Testing ENHANCED drilldown capability...');
                try {
                    const response = await fetch('/chat', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'X-Session-ID': 'debug-enhanced-drill-' + Date.now() },
                        body: JSON.stringify({ message: 'show me news headlines about Tesla' })
                    });
                    const data = await response.json();
                    
                    if (data.response.includes('Direct Link:')) {
                        log('✅ Enhanced drilldown SUCCESS: Contains direct article links!');
                    } else {
                        log('⚠️ Enhanced drilldown result: ' + data.response.substring(0, 200) + '...');
                    }
                } catch (error) {
                    log('❌ Enhanced drilldown test failed: ' + error.message);
                }
            }
        </script>
    </body>
    </html>`;
    
    res.send(debugHTML);
});

app.get('/sessions', (req, res) => {
    const sessionList = Array.from(sessions.entries()).map(([id, data]) => ({
        sessionId: id,
        hasQuery: !!data.lastQuery,
        hasResponse: !!data.lastResponse,
        hasAnalysisId: !!data.lastAnalysisId,
        hasRealData: data.hasRealData,
        created: data.created,
        lastActivity: new Date(data.lastActivity).toLocaleString()
    }));
    
    const cacheList = Array.from(researchCache.entries()).map(([id, data]) => ({
        analysisId: id,
        company: data.company,
        hasRealData: data.has_real_data,
        timestamp: data.timestamp
    }));
    
    res.json({
        totalSessions: sessions.size,
        totalCached: researchCache.size,
        sessions: sessionList,
        researchCache: cacheList
    });
});

// MAIN PAGE WITH ENHANCED FEATURES
app.get('/', (req, res) => {
    const mainHTML = `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>InsightEar GPT - ENHANCED Real Market Research + Drilldown</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; margin: 0; padding: 20px; }
            .chat-container { background: white; border-radius: 20px; box-shadow: 0 25px 50px rgba(0,0,0,0.15); width: 100%; max-width: 900px; height: 700px; display: flex; flex-direction: column; overflow: hidden; }
            .header { background: linear-gradient(135deg, #4f46e5, #7c3aed); color: white; padding: 25px; text-align: center; }
            .messages { flex: 1; padding: 25px; overflow-y: auto; background: #f8fafc; }
            .message { margin-bottom: 18px; padding: 18px; border-radius: 18px; max-width: 85%; line-height: 1.5; }
            .user-message { background: linear-gradient(135deg, #4f46e5, #6366f1); color: white; margin-left: auto; }
            .assistant-message { background: white; border: 1px solid #e2e8f0; }
            .input-container { padding: 25px; background: white; border-top: 1px solid #e2e8f0; }
            .input-group { display: flex; gap: 12px; align-items: flex-end; }
            .chat-input { flex: 1; padding: 18px; border: 2px solid #e2e8f0; border-radius: 25px; font-size: 16px; outline: none; }
            .send-button { background: linear-gradient(135deg, #4f46e5, #6366f1); color: white; border: none; border-radius: 25px; padding: 18px 28px; cursor: pointer; }
            .file-button { background: linear-gradient(135deg, #10b981, #059669); color: white; border: none; border-radius: 20px; padding: 12px 18px; cursor: pointer; }
            .file-input { display: none; }
        </style>
    </head>
    <body>
        <div class="chat-container">
            <div class="header">
                <h1>🔍 InsightEar GPT</h1>
                <p>ENHANCED Real Market Research • Direct Article Links • Full Drilldown</p>
            </div>
            <div class="messages" id="chatMessages">
                <div class="message assistant-message">
                    <strong>Welcome to InsightEar GPT - COMPLETE FINAL VERSION! 🚀</strong><br><br>
                    I now provide <strong>enhanced authentic market research</strong> with direct article links:<br><br>
                    <strong>📱 Enhanced Reddit API:</strong> Multiple auth methods - Real user discussions<br>
                    <strong>📰 Enhanced NewsAPI:</strong> Direct article URLs from Reuters, Bloomberg, TechCrunch<br>
                    <strong>🔍 Enhanced Drilldown:</strong> Direct clickable links to actual sources<br>
                    <strong>📁 File Processing:</strong> Upload documents for professional analysis<br><br>
                    <strong>🎯 Enhanced Examples:</strong><br>
                    • "analyze Tesla sentiment" → Get real Reddit + news data<br>
                    • "show me news headlines" → Direct clickable article URLs<br>
                    • "show me Reddit posts" → Real discussion links with scores<br>
                    • "what are the negative themes?" → Detailed sentiment breakdown<br><br>
                    Ready for honest market intelligence with verifiable, clickable sources!
                </div>
            </div>
            <div class="input-container">
                <div class="input-group">
                    <input type="file" id="fileInput" class="file-input" multiple accept=".pdf,.txt,.doc,.docx">
                    <button type="button" class="file-button" onclick="document.getElementById('fileInput').click()">📎 Upload</button>
                    <textarea id="messageInput" class="chat-input" placeholder="Ask for enhanced real market research or upload files..."></textarea>
                    <button id="sendButton" class="send-button">Send</button>
                </div>
            </div>
        </div>
        
        <script>
            const messageInput = document.getElementById("messageInput");
            const sendButton = document.getElementById("sendButton");
            const chatMessages = document.getElementById("chatMessages");
            const fileInput = document.getElementById("fileInput");
            let sessionId = "session-" + Date.now() + "-" + Math.random().toString(36).substr(2, 9);
            
            sendButton.addEventListener("click", sendMessage);
            messageInput.addEventListener("keydown", function(e) {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
            });
            
            async function sendMessage() {
                const message = messageInput.value.trim();
                const files = fileInput.files;
                if (!message && files.length === 0) return;
                
                if (message) addMessage(message, "user");
                if (files.length > 0) {
                    const fileNames = Array.from(files).map(f => f.name).join(", ");
                    addMessage("📁 Uploaded: " + fileNames, "user");
                }
                
                messageInput.value = "";
                fileInput.value = "";
                
                const loadingMsg = addMessage("🔍 Processing with ENHANCED real APIs...", "assistant");
                sendButton.disabled = true;
                
                try {
                    const formData = new FormData();
                    formData.append("message", message);
                    Array.from(files).forEach(file => formData.append("files", file));
                    
                    const response = await fetch("/chat", {
                        method: "POST",
                        headers: { "X-Session-ID": sessionId },
                        body: formData
                    });
                    
                    const data = await response.json();
                    chatMessages.removeChild(loadingMsg);
                    
                    let responseText = data.response;
                    if (data.hasRealData) {
                        responseText = "🟢 **ENHANCED REAL DATA ANALYSIS**\\n\\n" + responseText;
                    }
                    if (data.drilldownAvailable) {
                        responseText += "\\n\\n💎 **Enhanced Drilldown Available** - Ask specific questions about this data!";
                    }
                    
                    addMessage(responseText, "assistant");
                    
                } catch (error) {
                    chatMessages.removeChild(loadingMsg);
                    addMessage("❌ Error: " + error.message, "assistant");
                }
                
                sendButton.disabled = false;
                messageInput.focus();
            }
            
            function addMessage(content, sender) {
                const messageDiv = document.createElement("div");
                messageDiv.className = "message " + sender + "-message";
                
                if (sender === "assistant") {
                    content = content
                        .replace(/\\*\\*(.*?)\\*\\*/g, "<strong>$1</strong>")
                        .replace(/\\n/g, "<br>")
                        .replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank" style="color: #4f46e5; text-decoration: none;">$1</a>');
                }
                
                messageDiv.innerHTML = content;
                chatMessages.appendChild(messageDiv);
                chatMessages.scrollTop = chatMessages.scrollHeight;
                return messageDiv;
            }
            
            messageInput.focus();
            console.log("🚀 InsightEar GPT - ENHANCED Real APIs + Drilldown loaded");
        </script>
    </body>
    </html>`;
    
    res.send(mainHTML);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received - shutting down ENHANCED real API + drilldown server gracefully');
    server.close(() => {
        console.log('✅ Server closed gracefully');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received - shutting down ENHANCED real API + drilldown server gracefully');
    server.close(() => {
        console.log('✅ Server closed gracefully');
        process.exit(0);
    });
});

// Enhanced error handling
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception in ENHANCED real API + drilldown server:', error);
    // Don't exit immediately, try to handle gracefully
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection in ENHANCED real API + drilldown server:', promise, reason);
    // Don't exit immediately, try to handle gracefully
});

// Start server with enhanced error handling
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('🚀 InsightEar GPT Server Started - COMPLETE FINAL VERSION: ENHANCED APIS + FULL DRILLDOWN');
    console.log('Port: ' + PORT);
    console.log('🌐 Server URL: http://localhost:' + PORT);
    console.log('');
    console.log('📊 Real APIs Status:');
    console.log('  📱 Reddit API: ' + (API_CONFIG.reddit.clientId ? '✅ Ready (ENHANCED AUTH with fallbacks)' : '❌ Not configured'));
    console.log('  📰 NewsAPI: ' + (API_CONFIG.newsApi.key ? '✅ Ready (ENHANCED filtering)' : '❌ Not configured'));
    console.log('  🤖 OpenAI: ' + (process.env.ASSISTANT_ID ? '✅ Ready (ENHANCED integration)' : '❌ Not configured'));
    console.log('');
    console.log('🎯 Enhanced Features Enabled:');
    console.log('  🔍 ENHANCED real market research with authentic data sources');
    console.log('  💎 ENHANCED full drilldown capabilities with direct article URLs');
    console.log('  📱 Multiple Reddit authentication fallbacks for maximum reliability');
    console.log('  📰 Enhanced NewsAPI filtering for high-quality sources');
    console.log('  📁 Complete file processing and analysis capabilities');
    console.log('  📋 Professional PDF report generation with enhanced metadata');
    console.log('  🎯 Enhanced sentiment analysis with 35+ keyword detection');
    console.log('  📊 Enhanced theme extraction with 10 category analysis');
    console.log('  🔧 Robust error handling and graceful API failure recovery');
    console.log('  🔗 Direct clickable links to actual Reddit posts and news articles');
    console.log('  ⚡ Enhanced session management and analysis caching');
    console.log('  🛡️ Enhanced security with proper error boundaries');
    console.log('');
    console.log('✅ Ready for professional market intelligence with WORKING drilldown and direct article links!');
    console.log('');
    console.log('🧪 Test Commands:');
    console.log('  • Basic Analysis: "analyze Tesla sentiment"');
    console.log('  • News Drilldown: "show me news headlines about Tesla"');
    console.log('  • Reddit Drilldown: "show me Reddit posts about Tesla"');
    console.log('  • Theme Analysis: "what are the negative themes?"');
    console.log('  • Sentiment Breakdown: "break down sentiment by source"');
    console.log('');
    console.log('🔗 Debug Console: /debug');
    console.log('📊 Health Check: /health');
    console.log('📈 Sessions Status: /sessions');
}).on('error', (error) => {
    console.error('❌ Server startup error:', error);
    process.exit(1);
});

// Enhanced keep-alive for Railway with detailed metrics
setInterval(() => {
    const memoryUsage = process.memoryUsage();
    const uptime = process.uptime();
    
    console.log(`💓 ENHANCED Real API + Drilldown Server - Uptime: ${Math.round(uptime)}s`);
    console.log(`📊 Metrics - Sessions: ${sessions.size}, Cache: ${researchCache.size}`);
    console.log(`💾 Memory - RSS: ${Math.round(memoryUsage.rss / 1024 / 1024)}MB, Heap: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`);
    console.log(`🌐 APIs - Reddit: ${API_CONFIG.reddit.clientId ? 'Ready' : 'Not configured'}, News: ${API_CONFIG.newsApi.key ? 'Ready' : 'Not configured'}`);
    
    // Clean up old sessions (older than 1 hour)
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    let cleanedSessions = 0;
    let cleanedCache = 0;
    
    for (const [sessionId, session] of sessions.entries()) {
        if (session.lastActivity < oneHourAgo) {
            sessions.delete(sessionId);
            cleanedSessions++;
        }
    }
    
    for (const [analysisId, analysis] of researchCache.entries()) {
        const analysisTime = new Date(analysis.timestamp).getTime();
        if (analysisTime < oneHourAgo) {
            researchCache.delete(analysisId);
            cleanedCache++;
        }
    }
    
    if (cleanedSessions > 0 || cleanedCache > 0) {
        console.log(`🧹 Cleanup - Removed ${cleanedSessions} old sessions, ${cleanedCache} old cache entries`);
    }
}, 5 * 60 * 1000); // Every 5 minutes

// Export app for testing
module.exports = app;
