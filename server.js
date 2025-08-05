const express = require('express');
const multer = require('multer');
const OpenAI = require('openai');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const Sentiment = require('sentiment');
const { jsPDF } = require('jspdf');
const pdf = require('html-pdf');
const Mustache = require('mustache');

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
app.use('/reports', express.static('reports')); // Serve generated reports

// File upload configuration
const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, true)
});

// In-memory storage
const threads = new Map();

// Create reports directory
if (!fs.existsSync('reports')) {
    fs.mkdirSync('reports');
}

// ===== ENTERPRISE WEB INTELLIGENCE WITH SOURCES =====

// Enhanced Reddit scraper with comprehensive source tracking
async function scrapeRedditWithSources(query, limit = 30) {
    try {
        console.log(`🔍 Scraping Reddit for: ${query}`);
        
        const searchUrl = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=relevance&limit=${limit}&t=month`;
        
        const response = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'InsightEar-Enterprise-Bot/1.0',
                'Accept': 'application/json'
            },
            timeout: 15000
        });

        if (!response.data?.data?.children) {
            return { posts: [], sources: [], platform: 'Reddit' };
        }

        const posts = response.data.data.children
            .filter(post => post.data?.title)
            .map(post => {
                const postData = post.data;
                const fullUrl = `https://reddit.com${postData.permalink}`;
                const text = (postData.title + ' ' + (postData.selftext || '')).toLowerCase();
                const sentimentScore = sentiment.analyze(text);
                
                return {
                    title: postData.title,
                    content: postData.selftext || '',
                    score: postData.score || 0,
                    comments: postData.num_comments || 0,
                    subreddit: postData.subreddit,
                    url: fullUrl,
                    source_url: fullUrl,
                    created: new Date(postData.created_utc * 1000),
                    upvote_ratio: postData.upvote_ratio || 0,
                    sentiment: {
                        score: sentimentScore.score,
                        comparative: sentimentScore.comparative,
                        classification: sentimentScore.score > 0 ? 'positive' : sentimentScore.score < 0 ? 'negative' : 'neutral',
                        positive_words: sentimentScore.positive,
                        negative_words: sentimentScore.negative
                    }
                };
            });

        const sources = posts.map(post => ({
            url: post.source_url,
            title: post.title,
            platform: 'Reddit',
            subreddit: post.subreddit,
            engagement: `${post.score} upvotes, ${post.comments} comments`,
            date: post.created.toISOString().split('T')[0],
            sentiment: post.sentiment.classification
        }));

        console.log(`✅ Found ${posts.length} Reddit posts with comprehensive source data`);
        return { posts, sources, platform: 'Reddit', query };

    } catch (error) {
        console.error('Reddit scraping error:', error.message);
        return { posts: [], sources: [], platform: 'Reddit', error: error.message };
    }
}

// Enhanced multi-platform review scraper
async function scrapeReviewsWithSources(productQuery, platforms = ['amazon', 'trustpilot', 'yelp']) {
    try {
        console.log(`⭐ Scraping reviews for: ${productQuery}`);
        
        const reviews = [];
        const sources = [];

        // Enhanced search queries for better coverage
        const searchQueries = [
            `${productQuery} reviews site:amazon.com`,
            `${productQuery} reviews site:trustpilot.com`,
            `${productQuery} reviews site:yelp.com`,
            `${productQuery} customer feedback site:consumerreports.org`,
            `${productQuery} product review site:wirecutter.com`,
            `"${productQuery}" customer experience`,
            `${productQuery} user opinion rating`
        ];

        for (const searchQuery of searchQueries.slice(0, 5)) { // Use 5 sources for comprehensive coverage
            try {
                const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
                
                const response = await axios.get(searchUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    },
                    timeout: 12000
                });

                const $ = cheerio.load(response.data);
                
                $('.result').each((i, element) => {
                    if (i >= 8) return false; // Increased limit per source
                    
                    const titleElement = $(element).find('.result__title a');
                    const snippetElement = $(element).find('.result__snippet');
                    
                    const title = titleElement.text().trim();
                    const snippet = snippetElement.text().trim();
                    const url = titleElement.attr('href');
                    
                    if (snippet && snippet.length > 40 && url) {
                        const sentimentScore = sentiment.analyze(snippet);
                        
                        // Determine platform from URL
                        let platform = 'General Reviews';
                        if (url.includes('amazon.com')) platform = 'Amazon';
                        else if (url.includes('trustpilot.com')) platform = 'Trustpilot';
                        else if (url.includes('yelp.com')) platform = 'Yelp';
                        else if (url.includes('consumerreports.org')) platform = 'Consumer Reports';
                        else if (url.includes('wirecutter.com')) platform = 'Wirecutter';
                        
                        reviews.push({
                            title: title,
                            content: snippet,
                            source_url: url,
                            platform: platform,
                            sentiment: {
                                score: sentimentScore.score,
                                classification: sentimentScore.score > 0 ? 'positive' : sentimentScore.score < 0 ? 'negative' : 'neutral',
                                positive_words: sentimentScore.positive,
                                negative_words: sentimentScore.negative
                            },
                            scraped_at: new Date().toISOString(),
                            relevance_score: snippet.toLowerCase().includes(productQuery.toLowerCase()) ? 1 : 0.5
                        });

                        sources.push({
                            url: url,
                            title: title,
                            platform: platform,
                            content_preview: snippet.substring(0, 120) + '...',
                            sentiment: sentimentScore.score > 0 ? 'positive' : sentimentScore.score < 0 ? 'negative' : 'neutral',
                            date: new Date().toISOString().split('T')[0]
                        });
                    }
                });
                
                // Respectful delay between requests
                await new Promise(resolve => setTimeout(resolve, 1500));
                
            } catch (searchError) {
                console.log(`Search failed for: ${searchQuery.substring(0, 50)}...`);
            }
        }

        // Sort reviews by relevance and sentiment strength
        reviews.sort((a, b) => {
            return (b.relevance_score - a.relevance_score) || (Math.abs(b.sentiment.score) - Math.abs(a.sentiment.score));
        });

        console.log(`✅ Found ${reviews.length} reviews across multiple platforms with source URLs`);
        return { reviews, sources, platform: 'Multi-Platform Reviews', query: productQuery };

    } catch (error) {
        console.error('Review scraping error:', error.message);
        return { reviews: [], sources: [], platform: 'Reviews', error: error.message };
    }
}

// Enhanced news and market intelligence scraper
async function scrapeNewsWithSources(query) {
    try {
        console.log(`📰 Scraping news and market intelligence for: ${query}`);
        
        const newsItems = [];
        const sources = [];
        
        // Multiple search strategies for comprehensive coverage
        const newsSearchQueries = [
            `${query} news 2024 2025`,
            `${query} market trends`,
            `${query} industry analysis`,
            `"${query}" business news`,
            `${query} market research report`
        ];
        
        for (const searchQuery of newsSearchQueries.slice(0, 3)) {
            try {
                const newsSearchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
                
                const response = await axios.get(newsSearchUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    },
                    timeout: 12000
                });

                const $ = cheerio.load(response.data);
                
                $('.result').each((i, element) => {
                    if (i >= 8) return false;
                    
                    const titleElement = $(element).find('.result__title a');
                    const snippetElement = $(element).find('.result__snippet');
                    
                    const title = titleElement.text().trim();
                    const snippet = snippetElement.text().trim();
                    const url = titleElement.attr('href');
                    
                    if (title && snippet && url) {
                        const sentimentScore = sentiment.analyze(title + ' ' + snippet);
                        
                        // Determine source credibility
                        let credibilityScore = 0.5;
                        if (url.includes('reuters.com') || url.includes('bloomberg.com') || url.includes('wsj.com')) {
                            credibilityScore = 1.0;
                        } else if (url.includes('forbes.com') || url.includes('businessinsider.com')) {
                            credibilityScore = 0.8;
                        }
                        
                        newsItems.push({
                            headline: title,
                            summary: snippet,
                            source_url: url,
                            sentiment: {
                                score: sentimentScore.score,
                                classification: sentimentScore.score > 0 ? 'positive' : sentimentScore.score < 0 ? 'negative' : 'neutral'
                            },
                            credibility_score: credibilityScore,
                            scraped_at: new Date().toISOString(),
                            relevance: snippet.toLowerCase().includes(query.toLowerCase()) ? 1 : 0.5
                        });

                        sources.push({
                            url: url,
                            title: title,
                            platform: 'News Media',
                            summary: snippet.substring(0, 150) + '...',
                            credibility: credibilityScore > 0.8 ? 'High' : credibilityScore > 0.5 ? 'Medium' : 'Standard',
                            date: new Date().toISOString().split('T')[0]
                        });
                    }
                });
                
                await new Promise(resolve => setTimeout(resolve, 1500));
                
            } catch (newsError) {
                console.log(`News search failed for: ${searchQuery}`);
            }
        }

        // Sort by relevance and credibility
        newsItems.sort((a, b) => {
            return (b.relevance - a.relevance) || (b.credibility_score - a.credibility_score);
        });

        console.log(`✅ Found ${newsItems.length} news items with comprehensive source data`);
        return { newsItems, sources, platform: 'News & Market Intelligence', query };

    } catch (error) {
        console.error('News scraping error:', error.message);
        return { newsItems: [], sources: [], platform: 'News', error: error.message };
    }
}

// Social media mentions and brand monitoring
async function scrapeSocialMentions(brandQuery) {
    try {
        console.log(`📱 Scraping social mentions for: ${brandQuery}`);
        
        const mentions = [];
        const sources = [];
        
        // Search for social media mentions
        const socialSearchQueries = [
            `${brandQuery} site:twitter.com`,
            `${brandQuery} site:facebook.com`,
            `${brandQuery} social media mention`,
            `"${brandQuery}" customer experience`,
            `${brandQuery} brand discussion`
        ];

        for (const searchQuery of socialSearchQueries.slice(0, 3)) {
            try {
                const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
                
                const response = await axios.get(searchUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    },
                    timeout: 10000
                });

                const $ = cheerio.load(response.data);
                
                $('.result').each((i, element) => {
                    if (i >= 6) return false;
                    
                    const titleElement = $(element).find('.result__title a');
                    const snippetElement = $(element).find('.result__snippet');
                    
                    const title = titleElement.text().trim();
                    const snippet = snippetElement.text().trim();
                    const url = titleElement.attr('href');
                    
                    if (snippet && snippet.length > 30 && url) {
                        const sentimentScore = sentiment.analyze(snippet);
                        
                        let platform = 'Social Media';
                        if (url.includes('twitter.com')) platform = 'Twitter';
                        else if (url.includes('facebook.com')) platform = 'Facebook';
                        else if (url.includes('instagram.com')) platform = 'Instagram';
                        
                        mentions.push({
                            title: title,
                            text: snippet,
                            platform: platform,
                            source_url: url,
                            sentiment: {
                                score: sentimentScore.score,
                                classification: sentimentScore.score > 0 ? 'positive' : sentimentScore.score < 0 ? 'negative' : 'neutral'
                            },
                            scraped_at: new Date().toISOString()
                        });

                        sources.push({
                            url: url,
                            title: title,
                            platform: platform,
                            preview: snippet.substring(0, 100) + '...',
                            sentiment: sentimentScore.score > 0 ? 'positive' : sentimentScore.score < 0 ? 'negative' : 'neutral'
                        });
                    }
                });
                
                await new Promise(resolve => setTimeout(resolve, 1500));
                
            } catch (socialError) {
                console.log(`Social search failed for: ${searchQuery}`);
            }
        }

        console.log(`✅ Found ${mentions.length} social media mentions with sources`);
        return { mentions, sources, platform: 'Social Media', query: brandQuery };

    } catch (error) {
        console.error('Social mentions error:', error.message);
        return { mentions: [], sources: [], platform: 'Social Media', error: error.message };
    }
}

// Advanced sentiment analysis with detailed insights
function analyzeSentimentData(dataArray) {
    if (!dataArray || dataArray.length === 0) {
        return {
            overall_sentiment: 'neutral',
            confidence: 0,
            distribution: { positive: 0, neutral: 0, negative: 0 },
            total_analyzed: 0,
            insights: []
        };
    }

    const sentiments = dataArray.map(item => {
        const text = typeof item === 'string' ? item : 
                    item.content || item.text || item.title || item.headline || item.summary || '';
        return sentiment.analyze(text);
    });

    const totalScore = sentiments.reduce((sum, s) => sum + s.score, 0);
    const avgScore = totalScore / sentiments.length;
    
    const positive = sentiments.filter(s => s.score > 0).length;
    const negative = sentiments.filter(s => s.score < 0).length;
    const neutral = sentiments.filter(s => s.score === 0).length;
    
    const total = sentiments.length;
    const positivePercentage = Math.round((positive / total) * 100);
    const negativePercentage = Math.round((negative / total) * 100);
    const neutralPercentage = Math.round((neutral / total) * 100);
    
    // Generate insights
    const insights = [];
    if (positivePercentage > 60) {
        insights.push('Strong positive sentiment indicates favorable market reception');
    } else if (negativePercentage > 40) {
        insights.push('Significant negative sentiment suggests areas for improvement');
    }
    
    if (neutralPercentage > 50) {
        insights.push('High neutral sentiment indicates opportunity for stronger brand positioning');
    }
    
    return {
        overall_sentiment: avgScore > 0.5 ? 'positive' : avgScore < -0.5 ? 'negative' : 'neutral',
        average_score: Math.round(avgScore * 100) / 100,
        confidence: Math.min(Math.abs(avgScore) * 20, 100),
        distribution: {
            positive: positivePercentage,
            negative: negativePercentage,
            neutral: neutralPercentage
        },
        total_analyzed: total,
        key_positive_words: [...new Set(sentiments.flatMap(s => s.positive))].slice(0, 15),
        key_negative_words: [...new Set(sentiments.flatMap(s => s.negative))].slice(0, 15),
        insights: insights
    };
}

// Master comprehensive intelligence gathering function
async function gatherComprehensiveIntelligence(query) {
    try {
        console.log(`🌐 Gathering comprehensive intelligence for: ${query}`);
        
        const startTime = Date.now();
        const results = {
            query: query,
            timestamp: new Date().toISOString(),
            research_methodology: 'Multi-platform real-time intelligence gathering with sentiment analysis',
            executive_summary: '',
            sentiment_overview: {},
            key_themes: [],
            data_sources: [],
            actionable_recommendations: [],
            source_references: [],
            persona_insights: {},
            market_forecast: {},
            processing_metrics: {}
        };

        // Extract main topic and related keywords
        const words = query.toLowerCase().split(' ');
        const stopWords = ['sentiment', 'analysis', 'review', 'customer', 'feedback', 'social', 'media', 'what', 'how', 'the', 'and', 'for', 'are', 'market', 'brand'];
        const keywords = words.filter(word => word.length > 3 && !stopWords.includes(word));
        const mainTopic = keywords[0] || query.split(' ')[0];

        console.log(`🎯 Primary research focus: ${mainTopic}`);
        console.log(`🔍 Related keywords: ${keywords.slice(1, 4).join(', ')}`);

        // Parallel comprehensive intelligence gathering
        const [redditData, reviewData, newsData, socialData] = await Promise.all([
            scrapeRedditWithSources(mainTopic, 25),
            scrapeReviewsWithSources(mainTopic),
            scrapeNewsWithSources(mainTopic),
            scrapeSocialMentions(mainTopic)
        ]);

        // Process Reddit Community Intelligence
        if (redditData.posts.length > 0) {
            const redditSentiment = analyzeSentimentData(redditData.posts.map(post => post.title + ' ' + post.content));
            
            results.data_sources.push({
                platform: 'Reddit Community Discussions',
                data_points: redditData.posts.length,
                sentiment_analysis: redditSentiment,
                key_insights: [
                    `${redditData.posts.length} community discussions analyzed`,
                    `Average engagement: ${Math.round(redditData.posts.reduce((sum, p) => sum + p.score, 0) / redditData.posts.length)} upvotes`,
                    `Most active subreddits: ${[...new Set(redditData.posts.map(p => p.subreddit))].slice(0, 3).join(', ')}`
                ],
                top_discussions: redditData.posts.slice(0, 5).map(post => ({
                    title: post.title,
                    subreddit: post.subreddit,
                    engagement: `${post.score} upvotes, ${post.comments} comments`,
                    sentiment: post.sentiment.classification,
                    source_url: post.source_url,
                    key_topics: post.sentiment.positive_words.concat(post.sentiment.negative_words).slice(0, 5)
                }))
            });

            // Add Reddit sources to comprehensive references
            redditData.sources.forEach(source => {
                results.source_references.push({
                    title: source.title,
                    url: source.url,
                    platform: 'Reddit',
                    subreddit: source.subreddit,
                    type: 'Community Discussion',
                    engagement: source.engagement,
                    sentiment: source.sentiment,
                    date: source.date
                });
            });
        }

        // Process Customer Review Intelligence
        if (reviewData.reviews.length > 0) {
            const reviewSentiment = analyzeSentimentData(reviewData.reviews.map(review => review.content));
            
            // Extract common themes from reviews
            const allReviewText = reviewData.reviews.map(r => r.content).join(' ').toLowerCase();
            const commonWords = ['quality', 'price', 'service', 'fast', 'slow', 'good', 'bad', 'excellent', 'terrible', 'recommend', 'avoid'];
            const themes = commonWords.filter(word => allReviewText.includes(word));
            
            results.data_sources.push({
                platform: 'Customer Reviews & Feedback',
                data_points: reviewData.reviews.length,
                sentiment_analysis: reviewSentiment,
                platform_breakdown: [...new Set(reviewData.reviews.map(r => r.platform))],
                common_themes: themes,
                review_highlights: reviewData.reviews.slice(0, 3).map(review => ({
                    title: review.title,
                    content_preview: review.content.substring(0, 200) + '...',
                    sentiment: review.sentiment.classification,
                    platform: review.platform,
                    source_url: review.source_url,
                    key_phrases: review.sentiment.positive_words.concat(review.sentiment.negative_words).slice(0, 4)
                }))
            });

            // Add review sources to comprehensive references
            reviewData.sources.forEach(source => {
                results.source_references.push({
                    title: source.title,
                    url: source.url,
                    platform: source.platform,
                    type: 'Customer Review',
                    content_preview: source.content_preview,
                    sentiment: source.sentiment,
                    date: source.date
                });
            });
        }

        // Process News & Market Intelligence
        if (newsData.newsItems.length > 0) {
            const newsSentiment = analyzeSentimentData(newsData.newsItems.map(news => news.headline + ' ' + news.summary));
            
            results.data_sources.push({
                platform: 'News & Market Intelligence',
                data_points: newsData.newsItems.length,
                sentiment_analysis: newsSentiment,
                credibility_analysis: {
                    high_credibility: newsData.newsItems.filter(n => n.credibility_score > 0.8).length,
                    medium_credibility: newsData.newsItems.filter(n => n.credibility_score > 0.5 && n.credibility_score <= 0.8).length,
                    standard_credibility: newsData.newsItems.filter(n => n.credibility_score <= 0.5).length
                },
                trending_headlines: newsData.newsItems.slice(0, 5).map(news => ({
                    headline: news.headline,
                    summary: news.summary.substring(0, 150) + '...',
                    sentiment: news.sentiment.classification,
                    credibility: news.credibility_score > 0.8 ? 'High' : 'Medium',
                    source_url: news.source_url
                }))
            });

            // Add news sources to comprehensive references
            newsData.sources.forEach(source => {
                results.source_references.push({
                    title: source.title,
                    url: source.url,
                    platform: 'News Media',
                    type: 'News Article',
                    summary: source.summary,
                    credibility: source.credibility,
                    date: source.date
                });
            });
        }

        // Process Social Media Intelligence
        if (socialData.mentions.length > 0) {
            const socialSentiment = analyzeSentimentData(socialData.mentions.map(mention => mention.text));
            
            results.data_sources.push({
                platform: 'Social Media Monitoring',
                data_points: socialData.mentions.length,
                sentiment_analysis: socialSentiment,
                platform_distribution: [...new Set(socialData.mentions.map(m => m.platform))],
                mention_sample: socialData.mentions.slice(0, 3).map(mention => ({
                    text_preview: mention.text.substring(0, 120) + '...',
                    platform: mention.platform,
                    sentiment: mention.sentiment.classification,
                    source_url: mention.source_url
                }))
            });

            // Add social sources to comprehensive references
            socialData.sources.forEach(source => {
                results.source_references.push({
                    title: source.title,
                    url: source.url,
                    platform: source.platform,
                    type: 'Social Media Mention',
                    preview: source.preview,
                    sentiment: source.sentiment
                });
            });
        }

        // Generate comprehensive sentiment overview
        const allTextData = [
            ...redditData.posts.map(p => p.title + ' ' + p.content),
            ...reviewData.reviews.map(r => r.content),
            ...newsData.newsItems.map(n => n.headline + ' ' + n.summary),
            ...socialData.mentions.map(m => m.text)
        ];

        if (allTextData.length > 0) {
            results.sentiment_overview = analyzeSentimentData(allTextData);
            
            // Generate executive summary
            results.executive_summary = `Comprehensive analysis of ${allTextData.length} data points across ${results.data_sources.length} platforms reveals ${results.sentiment_overview.overall_sentiment} sentiment for ${mainTopic}. ${results.sentiment_overview.distribution.positive}% positive, ${results.sentiment_overview.distribution.neutral}% neutral, and ${results.sentiment_overview.distribution.negative}% negative sentiment detected. Analysis includes ${redditData.posts.length} community discussions, ${reviewData.reviews.length} customer reviews, ${newsData.newsItems.length} news articles, and ${socialData.mentions.length} social media mentions.`;
            
            // Extract key themes
            results.key_themes = [
                ...new Set([
                    ...results.sentiment_overview.key_positive_words.slice(0, 8),
                    ...results.sentiment_overview.key_negative_words.slice(0, 5)
                ])
            ].slice(0, 12);
            
            // Generate persona insights
            results.persona_insights = {
                primary_segments: generatePersonaInsights(results.data_sources),
                engagement_patterns: analyzeEngagementPatterns(redditData.posts, reviewData.reviews),
                communication_preferences: identifyCommnicationPreferences(allTextData)
            };
            
            // Generate market forecast insights
            results.market_forecast = generateMarketForecast(results.sentiment_overview, results.data_sources);
            
            // Generate actionable recommendations
            results.actionable_recommendations = generateEnhancedRecommendations(results.data_sources, results.sentiment_overview, results.key_themes);
        }

        // Processing metrics
        results.processing_metrics = {
            total_processing_time_ms: Date.now() - startTime,
            data_points_analyzed: allTextData.length,
            sources_verified: results.source_references.length,
            platforms_monitored: results.data_sources.length,
            confidence_score: Math.round(results.sentiment_overview.confidence || 0)
        };

        console.log(`✅ Comprehensive intelligence complete - ${allTextData.length} data points, ${results.source_references.length} sources in ${Date.now() - startTime}ms`);
        return results;

    } catch (error) {
        console.error('Comprehensive intelligence gathering error:', error);
        return {
            query: query,
            error: 'Failed to gather comprehensive intelligence',
            timestamp: new Date().toISOString(),
            source_references: []
        };
    }
}

// Enhanced recommendation generation
function generateEnhancedRecommendations(dataSources, sentimentAnalysis, keyThemes) {
    const recommendations = [];
    
    // Sentiment-based recommendations
    if (sentimentAnalysis.overall_sentiment === 'positive') {
        recommendations.push('Leverage positive sentiment in marketing campaigns and customer testimonials');
        recommendations.push('Amplify successful strategies that are driving positive market reception');
        recommendations.push('Consider expanding market presence while sentiment momentum is strong');
    } else if (sentimentAnalysis.overall_sentiment === 'negative') {
        recommendations.push('Implement immediate damage control and communication strategy');
        recommendations.push('Address root causes of negative feedback through product/service improvements');
        recommendations.push('Develop targeted campaigns to rebuild brand trust and perception');
    } else {
        recommendations.push('Develop stronger brand differentiation to move beyond neutral sentiment');
        recommendations.push('Increase engagement initiatives to build emotional connection with audience');
    }
    
    // Platform-specific recommendations
    dataSources.forEach(source => {
        if (source.platform.includes('Reddit')) {
            recommendations.push('Engage authentically with Reddit communities for brand awareness and feedback');
            recommendations.push('Monitor subreddit discussions for product development insights');
        }
        if (source.platform.includes('Review')) {
            recommendations.push('Implement systematic review response strategy to improve customer satisfaction');
            recommendations.push('Use review insights for product feature prioritization');
        }
        if (source.platform.includes('News')) {
            recommendations.push('Develop proactive PR strategy based on media coverage patterns');
            recommendations.push('Position brand narrative to align with positive industry trends');
        }
        if (source.platform.includes('Social')) {
            recommendations.push('Increase social media engagement to capitalize on mention opportunities');
            recommendations.push('Develop crisis management protocols for negative social sentiment');
        }
    });
    
    // Theme-based recommendations
    if (keyThemes.includes('price') || keyThemes.includes('expensive')) {
        recommendations.push('Consider value communication strategy to address pricing concerns');
    }
    if (keyThemes.includes('quality') || keyThemes.includes('excellent')) {
        recommendations.push('Highlight quality advantages in marketing messaging');
    }
    
    return recommendations.slice(0, 12); // Limit to most relevant recommendations
}

// Generate persona insights
function generatePersonaInsights(dataSources) {
    const segments = [];
    
    dataSources.forEach(source => {
        if (source.platform.includes('Reddit')) {
            segments.push({
                segment: 'Tech-Savvy Community Members',
                characteristics: 'Active in online discussions, values peer opinions, detail-oriented',
                preferred_channels: 'Reddit communities, forums, peer reviews',
                messaging_approach: 'Authentic, detailed, community-focused'
            });
        }
        if (source.platform.includes('Review')) {
            segments.push({
                segment: 'Research-Driven Consumers',
                characteristics: 'Thorough researchers, comparison shoppers, review readers',
                preferred_channels: 'Review sites, comparison platforms, expert opinions',
                messaging_approach: 'Fact-based, comparison-friendly, transparent'
            });
        }
    });
    
    return segments;
}

// Analyze engagement patterns
function analyzeEngagementPatterns(redditPosts, reviews) {
    const patterns = {
        high_engagement_topics: [],
        peak_activity_indicators: [],
        content_preferences: []
    };
    
    if (redditPosts.length > 0) {
        const topEngagement = redditPosts
            .sort((a, b) => (b.score + b.comments) - (a.score + a.comments))
            .slice(0, 3)
            .map(post => post.title.substring(0, 50) + '...');
        
        patterns.high_engagement_topics = topEngagement;
    }
    
    patterns.content_preferences = ['Detailed discussions', 'Personal experiences', 'Comparison content'];
    
    return patterns;
}

// Identify communication preferences
function identifyCommnicationPreferences(textData) {
    const preferences = {
        tone: 'Professional yet accessible',
        key_topics: ['Features', 'Value proposition', 'User experience'],
        avoid: ['Overly technical jargon', 'Generic messaging']
    };
    
    return preferences;
}

// Generate market forecast
function generateMarketForecast(sentimentAnalysis, dataSources) {
    const forecast = {
        short_term_outlook: '',
        growth_potential: '',
        risk_factors: [],
        opportunities: []
    };
    
    if (sentimentAnalysis.overall_sentiment === 'positive') {
        forecast.short_term_outlook = 'Positive market conditions with strong consumer sentiment';
        forecast.growth_potential = 'High - leverage current positive momentum';
        forecast.opportunities = ['Market expansion', 'Product line extension', 'Premium positioning'];
    } else if (sentimentAnalysis.overall_sentiment === 'negative') {
        forecast.short_term_outlook = 'Challenging market conditions requiring strategic intervention';
        forecast.growth_potential = 'Moderate - focus on reputation recovery';
        forecast.risk_factors = ['Brand reputation damage', 'Customer churn risk', 'Competitive vulnerability'];
    } else {
        forecast.short_term_outlook = 'Neutral market conditions with opportunity for differentiation';
        forecast.growth_potential = 'Moderate - requires strategic positioning';
        forecast.opportunities = ['Brand differentiation', 'Market education', 'Customer engagement'];
    }
    
    return forecast;
}

// ===== ENHANCED PDF REPORT GENERATION =====

const reportTemplate = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>InsightEar Intelligence Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; color: #333; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; margin: -40px -40px 30px -40px; }
        .logo { font-size: 28px; font-weight: bold; }
        .subtitle { font-size: 14px; margin-top: 10px; }
        .section { margin: 30px 0; }
        .section-title { font-size: 18px; font-weight: bold; color: #667eea; border-bottom: 2px solid #667eea; padding-bottom: 5px; margin-bottom: 15px; }
        .metric { background: #f8f9fa; padding: 15px; margin: 10px 0; border-left: 4px solid #667eea; }
        .sentiment-positive { color: #28a745; font-weight: bold; }
        .sentiment-negative { color: #dc3545; font-weight: bold; }
        .sentiment-neutral { color: #6c757d; font-weight: bold; }
        .source { background: #e9ecef; padding: 10px; margin: 5px 0; font-size: 12px; border-radius: 5px; }
        .recommendation { background: #d4edda; padding: 12px; margin: 8px 0; border-radius: 5px; border-left: 4px solid #28a745; }
        .chart-placeholder { background: #f8f9fa; border: 2px dashed #dee2e6; text-align: center; padding: 40px; margin: 20px 0; color: #6c757d; }
        .footer { text-align: center; margin-top: 50px; font-size: 12px; color: #6c757d; }
        .data-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin: 20px 0; }
        .data-card { background: #f8f9fa; padding: 15px; border-radius: 8px; text-align: center; }
        .big-number { font-size: 32px; font-weight: bold; color: #667eea; }
        .insights-list { background: #fff3cd; padding: 15px; border-radius: 5px; border-left: 4px solid #ffc107; }
    </style>
</head>
<body>
    <div class="header">
        <div class="logo">🧠 InsightEar Intelligence Report</div>
        <div class="subtitle">Comprehensive Market Intelligence Analysis</div>
        <div class="subtitle">Generated on {{date}} | Query: "{{query}}"</div>
    </div>

    <div class="section">
        <div class="section-title">Executive Summary</div>
        <p>{{executive_summary}}</p>
        
        <div class="data-grid">
            <div class="data-card">
                <div class="big-number">{{total_sources}}</div>
                <div>Sources Analyzed</div>
            </div>
            <div class="data-card">
                <div class="big-number">{{data_points}}</div>
                <div>Data Points</div>
            </div>
            <div class="data-card">
                <div class="big-number">{{confidence}}%</div>
                <div>Confidence Level</div>
            </div>
        </div>
    </div>

    <div class="section">
        <div class="section-title">Sentiment Overview</div>
        <div class="metric">
            <strong>Overall Sentiment:</strong> 
            <span class="sentiment-{{sentiment_class}}">{{overall_sentiment}}</span>
        </div>
        
        <div class="chart-placeholder">
            📊 Sentiment Distribution:<br>
            🟢 Positive: {{positive_percent}}% | 
            🔴 Negative: {{negative_percent}}% | 
            ⚪ Neutral: {{neutral_percent}}%
        </div>
        
        <div class="insights-list">
            <strong>Key Sentiment Insights:</strong>
            {{#sentiment_insights}}
            <li>{{.}}</li>
            {{/sentiment_insights}}
        </div>
    </div>

    <div class="section">
        <div class="section-title">Data Sources & Platform Analysis</div>
        {{#data_sources}}
        <div class="metric">
            <strong>{{platform}}</strong><br>
            Data Points: {{data_points}} | 
            Sentiment: <span class="sentiment-{{sentiment_class}}">{{sentiment}}</span><br>
            Key Insights: {{insights}}
        </div>
        {{/data_sources}}
    </div>

    <div class="section">
        <div class="section-title">Key Themes & Topics</div>
        <div class="metric">
            <strong>Identified Themes:</strong> {{key_themes}}
        </div>
    </div>

    <div class="section">
        <div class="section-title">Persona Insights</div>
        {{#persona_segments}}
        <div class="metric">
            <strong>{{segment}}:</strong> {{characteristics}}<br>
            <em>Preferred Channels:</em> {{channels}}<br>
            <em>Messaging Approach:</em> {{messaging}}
        </div>
        {{/persona_segments}}
    </div>

    <div class="section">
        <div class="section-title">Market Forecast</div>
        <div class="metric">
            <strong>Short-term Outlook:</strong> {{forecast_outlook}}<br>
            <strong>Growth Potential:</strong> {{growth_potential}}
        </div>
        {{#opportunities}}
        <div class="recommendation">📈 Opportunity: {{.}}</div>
        {{/opportunities}}
        {{#risk_factors}}
        <div style="background: #f8d7da; padding: 12px; margin: 8px 0; border-radius: 5px; border-left: 4px solid #dc3545;">
            ⚠️ Risk Factor: {{.}}
        </div>
        {{/risk_factors}}
    </div>

    <div class="section">
        <div class="section-title">Actionable Recommendations</div>
        {{#recommendations}}
        <div class="recommendation">💡 {{.}}</div>
        {{/recommendations}}
    </div>

    <div class="section">
        <div class="section-title">Source References</div>
        {{#source_references}}
        <div class="source">
            <strong>{{title}}</strong><br>
            Platform: {{platform}} | Type: {{type}}<br>
            URL: <a href="{{url}}">{{url}}</a>
            {{#sentiment}}<br>Sentiment: <span class="sentiment-{{sentiment}}">{{sentiment}}</span>{{/sentiment}}
        </div>
        {{/source_references}}
    </div>

    <div class="footer">
        <div>InsightEar GPT - Enterprise Market Intelligence</div>
        <div>Report ID: {{report_id}} | Processing Time: {{processing_time}}ms</div>
        <div>This report contains proprietary market intelligence. Handle confidentially.</div>
    </div>
</body>
</html>
`;

async function generateComprehensivePDFReport(intelligenceData) {
    try {
        console.log('📄 Generating comprehensive PDF report...');
        
        const reportId = `INSIGHT_${Date.now()}`;
        
        // Prepare template data
        const templateData = {
            date: new Date().toLocaleDateString(),
            query: intelligenceData.query,
            executive_summary: intelligenceData.executive_summary,
            total_sources: intelligenceData.source_references.length,
            data_points: intelligenceData.processing_metrics.data_points_analyzed,
            confidence: intelligenceData.processing_metrics.confidence_score,
            overall_sentiment: intelligenceData.sentiment_overview.overall_sentiment?.toUpperCase() || 'NEUTRAL',
            sentiment_class: intelligenceData.sentiment_overview.overall_sentiment || 'neutral',
            positive_percent: intelligenceData.sentiment_overview.distribution?.positive || 0,
            negative_percent: intelligenceData.sentiment_overview.distribution?.negative || 0,
            neutral_percent: intelligenceData.sentiment_overview.distribution?.neutral || 0,
            sentiment_insights: intelligenceData.sentiment_overview.insights || [],
            key_themes: intelligenceData.key_themes.join(', '),
            data_sources: intelligenceData.data_sources.map(source => ({
                platform: source.platform,
                data_points: source.data_points,
                sentiment: source.sentiment_analysis.overall_sentiment?.toUpperCase() || 'NEUTRAL',
                sentiment_class: source.sentiment_analysis.overall_sentiment || 'neutral',
                insights: source.key_insights ? source.key_insights.join('; ') : 'Analysis completed'
            })),
            persona_segments: intelligenceData.persona_insights.primary_segments || [],
            forecast_outlook: intelligenceData.market_forecast.short_term_outlook || 'Analysis in progress',
            growth_potential: intelligenceData.market_forecast.growth_potential || 'Under evaluation',
            opportunities: intelligenceData.market_forecast.opportunities || [],
            risk_factors: intelligenceData.market_forecast.risk_factors || [],
            recommendations: intelligenceData.actionable_recommendations || [],
            source_references: intelligenceData.source_references.slice(0, 20).map(source => ({
                ...source,
                sentiment: source.sentiment || 'neutral'
            })),
            report_id: reportId,
            processing_time: intelligenceData.processing_metrics.total_processing_time_ms
        };

        // Generate HTML from template
        const html = Mustache.render(reportTemplate, templateData);
        
        // Generate PDF
        const filename = `reports/${reportId}.pdf`;
        
        return new Promise((resolve, reject) => {
            const options = {
                format: 'A4',
                orientation: 'portrait',
                border: '0.5in',
                header: {
                    height: '0mm'
                },
                footer: {
                    height: '0mm'
                },
                type: 'pdf',
                timeout: 30000
            };

            pdf.create(html, options).toFile(filename, (err, res) => {
                if (err) {
                    console.error('PDF generation error:', err);
                    reject(err);
                } else {
                    console.log(`✅ Comprehensive PDF report generated: ${filename}`);
                    resolve({
                        reportId,
                        filename,
                        downloadUrl: `/reports/${reportId}.pdf`,
                        fileSize: fs.existsSync(filename) ? fs.statSync(filename).size : 0
                    });
                }
            });
        });

    } catch (error) {
        console.error('PDF generation error:', error);
        return null;
    }
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

// Enhanced message handler with comprehensive intelligence
app.post('/api/chat/message', async (req, res) => {
    try {
        const { thread_id, message, file_ids = [] } = req.body;

        if (!thread_id || !threads.has(thread_id)) {
            return res.status(400).json({ error: 'Invalid thread ID' });
        }

        if (!message && file_ids.length === 0) {
            return res.status(400).json({ error: 'Message or files required' });
        }

        // Detect comprehensive intelligence requests
        const intelligenceKeywords = ['sentiment', 'analysis', 'review', 'customer', 'feedback', 'market', 'competitor', 'social', 'reddit', 'brand', 'opinion', 'insight', 'intelligence', 'research', 'comprehensive'];
        const needsIntelligence = intelligenceKeywords.some(keyword => 
            message.toLowerCase().includes(keyword.toLowerCase())
        );

        let intelligence = null;
        let pdfReport = null;

        if (needsIntelligence) {
            console.log('🧠 Comprehensive intelligence request detected, gathering data...');
            intelligence = await gatherComprehensiveIntelligence(message);
            
            // Generate comprehensive PDF report
            if (intelligence && intelligence.source_references.length > 0) {
                pdfReport = await generateComprehensivePDFReport(intelligence);
            }
        }

        await cancelActiveRuns(thread_id);

        let content = [{ 
            type: "text", 
            text: `USER REQUEST: ${message}

You are InsightEar GPT with access to comprehensive real-time market intelligence. Use the provided data to deliver insights following the InsightEar framework. Include specific data points and source citations in your response.` 
        }];
        
        // Add comprehensive intelligence data
        if (intelligence) {
            content.push({
                type: "text",
                text: `

COMPREHENSIVE MARKET INTELLIGENCE DATA:

EXECUTIVE SUMMARY:
${intelligence.executive_summary}

SENTIMENT OVERVIEW:
- Overall Sentiment: ${intelligence.sentiment_overview.overall_sentiment || 'N/A'}
- Confidence Level: ${intelligence.sentiment_overview.confidence || 'N/A'}%
- Distribution: Positive ${intelligence.sentiment_overview.distribution?.positive || 0}%, Neutral ${intelligence.sentiment_overview.distribution?.neutral || 0}%, Negative ${intelligence.sentiment_overview.distribution?.negative || 0}%
- Total Data Points Analyzed: ${intelligence.sentiment_overview.total_analyzed || 0}

KEY THEMES IDENTIFIED:
${intelligence.key_themes.join(', ')}

DATA SOURCES ANALYSIS:
${intelligence.data_sources.map(source => `
Platform: ${source.platform}
- Data Points: ${source.data_points}
- Sentiment: ${source.sentiment_analysis.overall_sentiment}
- Key Insights: ${source.key_insights ? source.key_insights.join('; ') : 'Available'}
`).join('\n')}

PERSONA INSIGHTS:
Primary Segments: ${JSON.stringify(intelligence.persona_insights.primary_segments || [])}
Engagement Patterns: ${JSON.stringify(intelligence.persona_insights.engagement_patterns || {})}

MARKET FORECAST:
- Short-term Outlook: ${intelligence.market_forecast.short_term_outlook || 'Under analysis'}
- Growth Potential: ${intelligence.market_forecast.growth_potential || 'Evaluating'}
- Opportunities: ${intelligence.market_forecast.opportunities ? intelligence.market_forecast.opportunities.join('; ') : 'Identifying'}
- Risk Factors: ${intelligence.market_forecast.risk_factors ? intelligence.market_forecast.risk_factors.join('; ') : 'Monitoring'}

ACTIONABLE RECOMMENDATIONS:
${intelligence.actionable_recommendations.map(rec => `- ${rec}`).join('\n')}

VERIFIED SOURCE REFERENCES (${intelligence.source_references.length} sources):
${intelligence.source_references.slice(0, 15).map((source, index) => `
${index + 1}. ${source.title}
   URL: ${source.url}
   Platform: ${source.platform} | Type: ${source.type}
   ${source.sentiment ? `Sentiment: ${source.sentiment} | ` : ''}${source.date ? `Date: ${source.date}` : ''}
`).join('\n')}

PROCESSING METRICS:
- Total Processing Time: ${intelligence.processing_metrics.total_processing_time_ms}ms
- Sources Verified: ${intelligence.processing_metrics.sources_verified}
- Platforms Monitored: ${intelligence.processing_metrics.platforms_monitored}
- Confidence Score: ${intelligence.processing_metrics.confidence_score}%

${pdfReport ? `
COMPREHENSIVE PDF REPORT GENERATED:
Report ID: ${pdfReport.reportId}
Download URL: ${pdfReport.downloadUrl}
File Size: ${Math.round(pdfReport.fileSize / 1024)} KB
` : ''}

Provide a comprehensive analysis using the InsightEar framework with proper source citations and specific recommendations based on this data.`
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
            intelligence_included: !!intelligence,
            sources_analyzed: intelligence ? intelligence.source_references.length : 0,
            platforms_monitored: intelligence ? intelligence.data_sources.length : 0,
            pdf_report: pdfReport || null,
            processing_time: intelligence ? intelligence.processing_metrics.total_processing_time_ms : 0
        });

    } catch (error) {
        console.error('Message processing failed:', error);
        res.status(500).json({ error: 'Failed to process message' });
    }
});

// Generate standalone comprehensive report
app.post('/api/generate-report', async (req, res) => {
    try {
        const { query } = req.body;
        if (!query) {
            return res.status(400).json({ error: 'Query required' });
        }
        
        const intelligence = await gatherComprehensiveIntelligence(query);
        const pdfReport = await generateComprehensivePDFReport(intelligence);
        
        res.json({ 
            status: 'success', 
            intelligence: intelligence,
            report: pdfReport
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Direct intelligence endpoints
app.post('/api/intelligence/comprehensive', async (req, res) => {
    try {
        const { query } = req.body;
        if (!query) {
            return res.status(400).json({ error: 'Query required' });
        }
        
        const intelligence = await gatherComprehensiveIntelligence(query);
        res.json({ status: 'success', data: intelligence });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        assistant_id: ASSISTANT_ID ? 'configured' : 'missing',
        timestamp: new Date().toISOString(),
        capabilities: [
            'Comprehensive Real-time Web Intelligence',
            'Multi-platform Sentiment Analysis', 
            'Advanced PDF Report Generation',
            'Source Citation & Verification',
            'InsightEar Framework Implementation',
            'Persona Building & Market Forecasting',
            'Actionable Recommendations Engine'
        ],
        version: '5.0-enterprise-complete'
    });
});

// Serve enhanced enterprise chat widget
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>InsightEar GPT - Complete Enterprise Intelligence</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        .ai-chat-widget {
            width: 100%; max-width: 700px; height: 750px; margin: 0 auto;
            border: none; border-radius: 20px; display: flex; flex-direction: column;
            background: white; box-shadow: 0 15px 50px rgba(0, 0, 0, 0.2);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            overflow: hidden; position: relative;
        }
        .chat-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white; padding: 28px; text-align: center; font-weight: 600; font-size: 20px;
            display: flex; align-items: center; justify-content: center; gap: 15px;
            box-shadow: 0 5px 25px rgba(0, 0, 0, 0.2);
        }
        .enterprise-badge {
            background: linear-gradient(135deg, #FF6B6B 0%, #4ECDC4 100%);
            color: white; padding: 8px 16px; border-radius: 20px; font-size: 12px;
            font-weight: bold; letter-spacing: 1px; animation: premium 4s infinite;
        }
        @keyframes premium { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.9; transform: scale(1.03); } }
        .feature-indicators {
            display: flex; gap: 8px; margin-top: 8px; justify-content: center;
        }
        .indicator { background: rgba(255,255,255,0.2); padding: 4px 8px; border-radius: 12px; font-size: 10px; }
        .chat-messages {
            flex: 1; overflow-y: auto; padding: 28px;
            background: linear-gradient(to bottom, #f8f9fa 0%, #e9ecef 100%);
        }
        .message {
            margin-bottom: 24px; display: flex; align-items: flex-start; gap: 16px;
            animation: messageSlide 0.5s ease-out;
        }
        @keyframes messageSlide { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .message.user { flex-direction: row-reverse; }
        .message-content {
            max-width: 85%; padding: 18px 22px; border-radius: 28px;
            word-wrap: break-word; line-height: 1.6; position: relative;
        }
        .message.user .message-content {
            background: linear-gradient(135deg, #007bff 0%, #0056b3 100%);
            color: white; border-bottom-right-radius: 10px;
            box-shadow: 0 6px 20px rgba(0, 123, 255, 0.3);
        }
        .message.assistant .message-content {
            background: white; color: #333; border: 1px solid #e1e5e9;
            border-bottom-left-radius: 10px; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.1);
        }
        .message-avatar {
            width: 48px; height: 48px; border-radius: 50%; display: flex;
            align-items: center; justify-content: center; font-size: 16px;
            font-weight: bold; color: white; flex-shrink: 0;
        }
        .message.user .message-avatar { background: linear-gradient(135deg, #007bff 0%, #0056b3 100%); }
        .message.assistant .message-avatar { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
        .intelligence-badge {
            background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
            color: white; padding: 6px 12px; border-radius: 15px; font-size: 11px;
            margin-top: 10px; display: inline-block; animation: glow 3s infinite;
        }
        @keyframes glow { 0%, 100% { opacity: 1; box-shadow: 0 0 5px rgba(40, 167, 69, 0.5); } 50% { opacity: 0.9; box-shadow: 0 0 20px rgba(40, 167, 69, 0.8); } }
        .typing-indicator {
            display: none; align-items: center; gap: 16px; padding: 24px 28px;
            color: #6c757d; font-style: italic; animation: fadeIn 0.3s ease-out;
        }
        .typing-dots { display: flex; gap: 8px; }
        .typing-dot {
            width: 12px; height: 12px; background: #667eea; border-radius: 50%;
            animation: typing 1.4s infinite ease-in-out;
        }
        .typing-dot:nth-child(1) { animation-delay: -0.32s; }
        .typing-dot:nth-child(2) { animation-delay: -0.16s; }
        @keyframes typing { 0%, 80%, 100% { transform: scale(0.8); opacity: 0.5; } 40% { transform: scale(1); opacity: 1; } }
        .chat-input-container { padding: 28px; background: white; border-top: 1px solid #e1e5e9; }
        .input-wrapper {
            display: flex; gap: 15px; align-items: flex-end; background: #f8f9fa;
            border-radius: 32px; padding: 8px; border: 2px solid #e9ecef;
            transition: all 0.3s ease;
        }
        .input-wrapper:focus-within { border-color: #667eea; box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1); }
        .chat-input {
            flex: 1; min-height: 48px; max-height: 120px; padding: 14px 20px;
            border: none; background: transparent; resize: none; font-family: inherit;
            font-size: 16px; line-height: 1.5; outline: none;
        }
        .send-btn {
            width: 48px; height: 48px; border-radius: 50%; border: none; cursor: pointer;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;
            display: flex; align-items: center; justify-content: center; font-size: 20px;
            transition: all 0.3s ease; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
        }
        .send-btn:hover:not(:disabled) { 
            transform: scale(1.05); 
            box-shadow: 0 6px 25px rgba(102, 126, 234, 0.5); 
        }
        .send-btn:disabled { background: #adb5bd; cursor: not-allowed; transform: none; }
        .pdf-download {
            background: linear-gradient(135deg, #dc3545 0%, #c82333 100%);
            color: white; padding: 4px 10px; border-radius: 12px; font-size: 10px;
            margin-top: 8px; display: inline-block; text-decoration: none;
        }
    </style>
</head>
<body>
    <div class="ai-chat-widget">
        <div class="chat-header">
            🧠 InsightEar GPT
            <div class="enterprise-badge">ENTERPRISE</div>
            <div class="feature-indicators">
                <div class="indicator">🌐 LIVE DATA</div>
                <div class="indicator">📊 PDF REPORTS</div>
                <div class="indicator">🎯 AI INSIGHTS</div>
            </div>
        </div>
        
        <div class="chat-messages" id="chatMessages">
            <div class="message assistant">
                <div class="message-avatar">IE</div>
                <div class="message-content">
                    🚀 Welcome to InsightEar GPT Enterprise! I provide comprehensive market intelligence with:
                    <br><br>
                    📊 <strong>Real-time sentiment analysis</strong> across Reddit, reviews, news & social media<br>
                    📄 <strong>Professional PDF reports</strong> with detailed insights & source citations<br>
                    🎯 <strong>Persona building & market forecasting</strong> with actionable recommendations<br>
                    🔗 <strong>Complete source verification</strong> with URL citations<br>
                    <br>
                    Try: <em>"Comprehensive market analysis for Tesla Model 3"</em>
                </div>
            </div>
        </div>
        
        <div class="typing-indicator" id="typingIndicator">
            <div class="message-avatar">IE</div>
            <div>
                Gathering comprehensive intelligence
                <div class="typing-dots">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
            </div>
        </div>
        
        <div class="chat-input-container">
            <div class="input-wrapper">
                <textarea id="chatInput" class="chat-input" placeholder="Request comprehensive market intelligence, sentiment analysis, or detailed PDF reports..." rows="1"></textarea>
                <button id="sendButton" class="send-btn" title="Send">➤</button>
            </div>
        </div>
    </div>

    <script>
        const CONFIG = { API_BASE_URL: window.location.origin + '/api' };
        let threadId = null, isProcessing = false;

        document.addEventListener('DOMContentLoaded', initializeChat);

        async function initializeChat() {
            try {
                const response = await fetch(CONFIG.API_BASE_URL + '/chat/thread', {
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    threadId = data.thread_id;
                    setupEventListeners();
                }
            } catch (error) {
                console.error('Initialization failed:', error);
            }
        }

        function setupEventListeners() {
            const chatInput = document.getElementById('chatInput');
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
            
            sendButton.addEventListener('click', sendMessage);
        }

        async function sendMessage() {
            if (isProcessing || !threadId) return;
            
            const input = document.getElementById('chatInput');
            const message = input.value.trim();
            if (!message) return;

            isProcessing = true;
            document.getElementById('sendButton').disabled = true;

            addMessage('user', message);
            input.value = '';
            input.style.height = 'auto';
            showTypingIndicator();

            try {
                const response = await fetch(CONFIG.API_BASE_URL + '/chat/message', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        thread_id: threadId,
                        message: message
                    })
                });

                const data = await response.json();
                hideTypingIndicator();
                
                let responseContent = data.response;
                if (data.pdf_report) {
                    responseContent += '<br><br><a href="' + data.pdf_report.downloadUrl + '" class="pdf-download" target="_blank">📄 Download PDF Report</a>';
                }
                
                addMessage('assistant', responseContent);
                
                if (data.intelligence_included) {
                    addIntelligenceBadge(data.sources_analyzed, data.platforms_monitored, data.processing_time);
                }
                
            } catch (error) {
                hideTypingIndicator();
                addMessage('assistant', '❌ Sorry, I encountered an error: ' + error.message);
            } finally {
                isProcessing = false;
                document.getElementById('sendButton').disabled = false;
            }
        }

        function addMessage(sender, content) {
            const container = document.getElementById('chatMessages');
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message ' + sender;
            messageDiv.innerHTML = '<div class="message-avatar">' + (sender === 'user' ? 'You' : 'IE') + '</div><div class="message-content">' + content.replace(/\\n/g, '<br>') + '</div>';
            container.appendChild(messageDiv);
            container.scrollTop = container.scrollHeight;
        }

        function showTypingIndicator() { 
            document.getElementById('typingIndicator').style.display = 'flex'; 
            document.getElementById('chatMessages').scrollTop = document.getElementById('chatMessages').scrollHeight; 
        }
        
        function hideTypingIndicator() { 
            document.getElementById('typingIndicator').style.display = 'none';
        }
        
        function addIntelligenceBadge(sources, platforms, processingTime) {
            const lastMessage = document.querySelector('.message.assistant:last-child .message-content');
            if (lastMessage && !lastMessage.querySelector('.intelligence-badge')) {
                const badge = document.createElement('div');
                badge.className = 'intelligence-badge';
                badge.textContent = '🌐 Live Intelligence: ' + sources + ' sources, ' + platforms + ' platforms (' + processingTime + 'ms)';
                lastMessage.appendChild(badge);
            }
        }
    </script>
</body>
</html>`);
});

// Helper functions
async function cancelActiveRuns(threadId) {
    try {
        const runs = await openai.beta.threads.runs.list(threadId);
        for (const run of runs.data) {
            if (['queued', 'in_progress', 'requires_action'].includes(run.status)) {
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
                    let response = '';
                    messages.data[0].content.forEach(item => {
                        if (item.type === 'text') response += item.text.value;
                    });
                    return { message: response.trim() };
                }
            } else if (['failed', 'cancelled', 'expired'].includes(run.status)) {
                return { error: `Assistant ${run.status}` };
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
            return { error: 'Failed to get response' };
        }
    }
    return { error: 'Response timeout' };
}

app.listen(port, () => {
    console.log(`🚀 InsightEar GPT Complete Enterprise Edition running on port ${port}`);
    console.log(`🌐 Real-time Web Intelligence: ENABLED`);
    console.log(`📄 Comprehensive PDF Reports: ENABLED`);
    console.log(`🔗 Source Citation & Verification: ENABLED`);
    console.log(`🎯 Full InsightEar Framework: ENABLED`);
    console.log(`👥 Persona Building & Forecasting: ENABLED`);
    console.log(`✅ Complete Enterprise Intelligence Ready!`);
});

module.exports = app;
