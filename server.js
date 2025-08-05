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
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');

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

// Chart configuration
const chartCanvas = new ChartJSNodeCanvas({ width: 800, height: 600 });

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

// ===== ENHANCED WEB INTELLIGENCE WITH SOURCES =====

// Enhanced Reddit scraper with source URLs
async function scrapeRedditWithSources(query, limit = 25) {
    try {
        console.log(`🔍 Scraping Reddit for: ${query}`);
        
        const searchUrl = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=relevance&limit=${limit}&t=month`;
        
        const response = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'InsightEar-Research-Bot/1.0',
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
                        classification: sentimentScore.score > 0 ? 'positive' : sentimentScore.score < 0 ? 'negative' : 'neutral'
                    }
                };
            });

        const sources = posts.map(post => ({
            url: post.source_url,
            title: post.title,
            platform: 'Reddit',
            subreddit: post.subreddit,
            engagement: `${post.score} upvotes, ${post.comments} comments`
        }));

        console.log(`✅ Found ${posts.length} Reddit posts with source URLs`);
        return { posts, sources, platform: 'Reddit', query };

    } catch (error) {
        console.error('Reddit scraping error:', error.message);
        return { posts: [], sources: [], platform: 'Reddit', error: error.message };
    }
}

// Enhanced review scraper with detailed sources
async function scrapeReviewsWithSources(productQuery, platform = 'general') {
    try {
        console.log(`⭐ Scraping reviews for: ${productQuery}`);
        
        const reviews = [];
        const sources = [];

        // Try multiple review sources
        const searchQueries = [
            `${productQuery} reviews site:amazon.com`,
            `${productQuery} reviews site:trustpilot.com`,
            `${productQuery} reviews site:yelp.com`,
            `${productQuery} customer feedback`,
            `${productQuery} product review`
        ];

        for (const searchQuery of searchQueries.slice(0, 3)) { // Limit to 3 sources for speed
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
                    if (i >= 5) return false; // Limit per source
                    
                    const titleElement = $(element).find('.result__title a');
                    const snippetElement = $(element).find('.result__snippet');
                    
                    const title = titleElement.text().trim();
                    const snippet = snippetElement.text().trim();
                    const url = titleElement.attr('href');
                    
                    if (snippet && snippet.length > 50 && url) {
                        const sentimentScore = sentiment.analyze(snippet);
                        
                        reviews.push({
                            title: title,
                            content: snippet,
                            source_url: url,
                            platform: searchQuery.includes('amazon') ? 'Amazon' : 
                                     searchQuery.includes('trustpilot') ? 'Trustpilot' :
                                     searchQuery.includes('yelp') ? 'Yelp' : 'Web Reviews',
                            sentiment: {
                                score: sentimentScore.score,
                                classification: sentimentScore.score > 0 ? 'positive' : sentimentScore.score < 0 ? 'negative' : 'neutral'
                            },
                            scraped_at: new Date().toISOString()
                        });

                        sources.push({
                            url: url,
                            title: title,
                            platform: searchQuery.includes('amazon') ? 'Amazon' : 
                                     searchQuery.includes('trustpilot') ? 'Trustpilot' :
                                     searchQuery.includes('yelp') ? 'Yelp' : 'Review Sites',
                            content_preview: snippet.substring(0, 100) + '...'
                        });
                    }
                });
                
                // Small delay between requests
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (searchError) {
                console.log(`Search failed for: ${searchQuery}`);
            }
        }

        console.log(`✅ Found ${reviews.length} reviews with source URLs`);
        return { reviews, sources, platform: 'Multi-Platform Reviews', query: productQuery };

    } catch (error) {
        console.error('Review scraping error:', error.message);
        return { reviews: [], sources: [], platform: 'Reviews', error: error.message };
    }
}

// News and trend scraper with sources
async function scrapeNewsWithSources(query) {
    try {
        console.log(`📰 Scraping news for: ${query}`);
        
        const newsItems = [];
        const sources = [];
        
        const newsSearchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(query + ' news 2024 2025')}`;
        
        const response = await axios.get(newsSearchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 10000
        });

        const $ = cheerio.load(response.data);
        
        $('.result').each((i, element) => {
            if (i >= 10) return false;
            
            const titleElement = $(element).find('.result__title a');
            const snippetElement = $(element).find('.result__snippet');
            
            const title = titleElement.text().trim();
            const snippet = snippetElement.text().trim();
            const url = titleElement.attr('href');
            
            if (title && snippet && url) {
                const sentimentScore = sentiment.analyze(title + ' ' + snippet);
                
                newsItems.push({
                    headline: title,
                    summary: snippet,
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
                    platform: 'News',
                    summary: snippet.substring(0, 150) + '...'
                });
            }
        });

        console.log(`✅ Found ${newsItems.length} news items with sources`);
        return { newsItems, sources, platform: 'News & Trends', query };

    } catch (error) {
        console.error('News scraping error:', error.message);
        return { newsItems: [], sources: [], platform: 'News', error: error.message };
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

// Master web intelligence function with comprehensive sourcing
async function gatherComprehensiveIntelligence(query) {
    try {
        console.log(`🌐 Gathering comprehensive intelligence for: ${query}`);
        
        const startTime = Date.now();
        const results = {
            query: query,
            timestamp: new Date().toISOString(),
            research_methodology: 'Real-time web intelligence gathering across multiple platforms',
            data_sources: [],
            sentiment_analysis: {},
            key_insights: [],
            recommendations: [],
            source_references: [],
            processing_time_ms: 0
        };

        // Extract main topic
        const words = query.toLowerCase().split(' ');
        const stopWords = ['sentiment', 'analysis', 'review', 'customer', 'feedback', 'social', 'media', 'what', 'how', 'the', 'and', 'for', 'are'];
        const keywords = words.filter(word => word.length > 3 && !stopWords.includes(word));
        const mainTopic = keywords[0] || query.split(' ')[0];

        console.log(`🎯 Primary research focus: ${mainTopic}`);

        // Parallel intelligence gathering
        const [redditData, reviewData, newsData] = await Promise.all([
            scrapeRedditWithSources(mainTopic, 20),
            scrapeReviewsWithSources(mainTopic),
            scrapeNewsWithSources(mainTopic)
        ]);

        // Process Reddit intelligence
        if (redditData.posts.length > 0) {
            const redditSentiment = analyzeSentimentData(redditData.posts.map(post => post.title + ' ' + post.content));
            
            results.data_sources.push({
                platform: 'Reddit Community Discussions',
                data_points: redditData.posts.length,
                sentiment_analysis: redditSentiment,
                top_discussions: redditData.posts.slice(0, 5).map(post => ({
                    title: post.title,
                    subreddit: post.subreddit,
                    engagement: `${post.score} upvotes, ${post.comments} comments`,
                    sentiment: post.sentiment.classification,
                    source_url: post.source_url
                })),
                source_urls: redditData.sources.map(s => s.url)
            });

            // Add sources to references
            redditData.sources.forEach(source => {
                results.source_references.push({
                    title: source.title,
                    url: source.url,
                    platform: 'Reddit',
                    subreddit: source.subreddit,
                    type: 'Community Discussion'
                });
            });
        }

        // Process Review intelligence
        if (reviewData.reviews.length > 0) {
            const reviewSentiment = analyzeSentimentData(reviewData.reviews.map(review => review.content));
            
            results.data_sources.push({
                platform: 'Customer Reviews & Feedback',
                data_points: reviewData.reviews.length,
                sentiment_analysis: reviewSentiment,
                review_sample: reviewData.reviews.slice(0, 3).map(review => ({
                    title: review.title,
                    content_preview: review.content.substring(0, 200) + '...',
                    sentiment: review.sentiment.classification,
                    platform: review.platform,
                    source_url: review.source_url
                })),
                source_urls: reviewData.sources.map(s => s.url)
            });

            // Add sources to references
            reviewData.sources.forEach(source => {
                results.source_references.push({
                    title: source.title,
                    url: source.url,
                    platform: source.platform,
                    type: 'Customer Review'
                });
            });
        }

        // Process News intelligence
        if (newsData.newsItems.length > 0) {
            const newsSentiment = analyzeSentimentData(newsData.newsItems.map(news => news.headline + ' ' + news.summary));
            
            results.data_sources.push({
                platform: 'News & Market Coverage',
                data_points: newsData.newsItems.length,
                sentiment_analysis: newsSentiment,
                trending_headlines: newsData.newsItems.slice(0, 5).map(news => ({
                    headline: news.headline,
                    summary: news.summary.substring(0, 150) + '...',
                    sentiment: news.sentiment.classification,
                    source_url: news.source_url
                })),
                source_urls: newsData.sources.map(s => s.url)
            });

            // Add sources to references
            newsData.sources.forEach(source => {
                results.source_references.push({
                    title: source.title,
                    url: source.url,
                    platform: 'News Media',
                    type: 'News Article'
                });
            });
        }

        // Generate comprehensive sentiment analysis
        const allData = [
            ...redditData.posts.map(p => p.title + ' ' + p.content),
            ...reviewData.reviews.map(r => r.content),
            ...newsData.newsItems.map(n => n.headline + ' ' + n.summary)
        ];

        if (allData.length > 0) {
            results.sentiment_analysis = analyzeSentimentData(allData);
            
            // Generate insights
            results.key_insights = [
                `Analyzed ${allData.length} data points across ${results.data_sources.length} platforms`,
                `Overall sentiment: ${results.sentiment_analysis.overall_sentiment} (${results.sentiment_analysis.confidence}% confidence)`,
                `Reddit community shows ${redditData.posts.length} active discussions`,
                `Customer reviews indicate ${reviewData.reviews.length} feedback instances`,
                `News coverage includes ${newsData.newsItems.length} recent articles`
            ];

            // Generate recommendations
            results.recommendations = generateActionableRecommendations(results.data_sources, results.sentiment_analysis);
        }

        results.processing_time_ms = Date.now() - startTime;
        
        console.log(`✅ Comprehensive intelligence complete - ${allData.length} data points, ${results.source_references.length} sources in ${results.processing_time_ms}ms`);
        return results;

    } catch (error) {
        console.error('Intelligence gathering error:', error);
        return {
            query: query,
            error: 'Failed to gather comprehensive intelligence',
            timestamp: new Date().toISOString(),
            source_references: []
        };
    }
}

// Generate actionable recommendations
function generateActionableRecommendations(dataSources, sentimentAnalysis) {
    const recommendations = [];
    
    if (sentimentAnalysis.overall_sentiment === 'positive') {
        recommendations.push('Leverage positive sentiment in marketing campaigns and testimonials');
        recommendations.push('Amplify successful strategies that are driving positive reception');
    } else if (sentimentAnalysis.overall_sentiment === 'negative') {
        recommendations.push('Address negative sentiment through improved customer communication');
        recommendations.push('Investigate root causes of negative feedback for product/service improvements');
    }

    dataSources.forEach(source => {
        if (source.platform.includes('Reddit')) {
            recommendations.push('Engage with Reddit communities for brand awareness and feedback collection');
        }
        if (source.platform.includes('Review')) {
            recommendations.push('Monitor and respond to customer reviews to improve satisfaction scores');
        }
        if (source.platform.includes('News')) {
            recommendations.push('Track media coverage for reputation management and PR opportunities');
        }
    });

    if (recommendations.length === 0) {
        recommendations.push('Establish regular monitoring across identified platforms');
        recommendations.push('Develop targeted engagement strategies based on platform-specific insights');
    }

    return recommendations;
}

// ===== PDF REPORT GENERATION =====

async function generatePDFReport(intelligenceData) {
    try {
        console.log('📄 Generating PDF report...');
        
        const doc = new jsPDF();
        const pageWidth = doc.internal.pageSize.width;
        const pageHeight = doc.internal.pageSize.height;
        let yPosition = 30;

        // Helper function to add new page if needed
        const checkPageBreak = (neededHeight) => {
            if (yPosition + neededHeight > pageHeight - 20) {
                doc.addPage();
                yPosition = 30;
            }
        };

        // Title and Header
        doc.setFontSize(24);
        doc.setTextColor(102, 126, 234); // Brand color
        doc.text('InsightEar Intelligence Report', 20, yPosition);
        yPosition += 15;

        doc.setFontSize(12);
        doc.setTextColor(100, 100, 100);
        doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 20, yPosition);
        yPosition += 10;
        doc.text(`Query: ${intelligenceData.query}`, 20, yPosition);
        yPosition += 20;

        // Executive Summary
        checkPageBreak(30);
        doc.setFontSize(16);
        doc.setTextColor(0, 0, 0);
        doc.text('Executive Summary', 20, yPosition);
        yPosition += 10;

        doc.setFontSize(10);
        const summaryText = `Analysis of ${intelligenceData.source_references.length} sources across ${intelligenceData.data_sources.length} platforms reveals ${intelligenceData.sentiment_analysis.overall_sentiment} sentiment. Key findings include comprehensive community discussions, customer feedback patterns, and media coverage insights.`;
        const splitSummary = doc.splitTextToSize(summaryText, pageWidth - 40);
        doc.text(splitSummary, 20, yPosition);
        yPosition += splitSummary.length * 5 + 10;

        // Sentiment Overview
        checkPageBreak(40);
        doc.setFontSize(16);
        doc.text('Sentiment Overview', 20, yPosition);
        yPosition += 15;

        if (intelligenceData.sentiment_analysis.distribution) {
            doc.setFontSize(10);
            doc.text(`Positive: ${intelligenceData.sentiment_analysis.distribution.positive}%`, 20, yPosition);
            doc.text(`Neutral: ${intelligenceData.sentiment_analysis.distribution.neutral}%`, 80, yPosition);
            doc.text(`Negative: ${intelligenceData.sentiment_analysis.distribution.negative}%`, 140, yPosition);
            yPosition += 20;
        }

        // Data Sources
        checkPageBreak(30);
        doc.setFontSize(16);
        doc.text('Data Sources', 20, yPosition);
        yPosition += 15;

        intelligenceData.data_sources.forEach((source, index) => {
            checkPageBreak(25);
            doc.setFontSize(12);
            doc.setTextColor(102, 126, 234);
            doc.text(`${index + 1}. ${source.platform}`, 20, yPosition);
            yPosition += 8;
            
            doc.setFontSize(10);
            doc.setTextColor(0, 0, 0);
            doc.text(`Data Points: ${source.data_points}`, 25, yPosition);
            yPosition += 6;
            doc.text(`Sentiment: ${source.sentiment_analysis.overall_sentiment}`, 25, yPosition);
            yPosition += 10;
        });

        // Source References
        checkPageBreak(30);
        doc.setFontSize(16);
        doc.text('Source References', 20, yPosition);
        yPosition += 15;

        intelligenceData.source_references.slice(0, 10).forEach((source, index) => {
            checkPageBreak(20);
            doc.setFontSize(9);
            doc.setTextColor(0, 0, 255);
            const titleText = doc.splitTextToSize(`${index + 1}. ${source.title}`, pageWidth - 40);
            doc.text(titleText, 20, yPosition);
            yPosition += titleText.length * 4;
            
            doc.setFontSize(8);
            doc.setTextColor(100, 100, 100);
            doc.text(source.url, 25, yPosition);
            yPosition += 8;
        });

        // Recommendations
        checkPageBreak(30);
        doc.setFontSize(16);
        doc.setTextColor(0, 0, 0);
        doc.text('Actionable Recommendations', 20, yPosition);
        yPosition += 15;

        intelligenceData.recommendations.forEach((rec, index) => {
            checkPageBreak(15);
            doc.setFontSize(10);
            const recText = doc.splitTextToSize(`${index + 1}. ${rec}`, pageWidth - 40);
            doc.text(recText, 20, yPosition);
            yPosition += recText.length * 5 + 5;
        });

        // Footer
        const totalPages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setTextColor(150, 150, 150);
            doc.text('InsightEar GPT - Market Intelligence Report', pageWidth - 80, pageHeight - 10);
            doc.text(`Page ${i} of ${totalPages}`, 20, pageHeight - 10);
        }

        // Save PDF
        const reportId = `report_${Date.now()}`;
        const filename = `reports/${reportId}.pdf`;
        doc.save(filename);

        console.log(`✅ PDF report generated: ${filename}`);
        return {
            reportId,
            filename,
            downloadUrl: `/reports/${reportId}.pdf`
        };

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

        // Detect intelligence requests
        const intelligenceKeywords = ['sentiment', 'analysis', 'review', 'customer', 'feedback', 'market', 'competitor', 'social', 'reddit', 'brand', 'opinion', 'insight'];
        const needsIntelligence = intelligenceKeywords.some(keyword => 
            message.toLowerCase().includes(keyword.toLowerCase())
        );

        let intelligence = null;
        let pdfReport = null;

        if (needsIntelligence) {
            console.log('🧠 Intelligence request detected, gathering comprehensive data...');
            intelligence = await gatherComprehensiveIntelligence(message);
            
            // Generate PDF report for comprehensive requests
            if (intelligence && intelligence.source_references.length > 0) {
                pdfReport = await generatePDFReport(intelligence);
            }
        }

        await cancelActiveRuns(thread_id);

        let content = [{ 
            type: "text", 
            text: `USER REQUEST: ${message}

IMPORTANT: You have access to real-time web intelligence data. Use the provided data to give detailed, specific insights with proper source citations. Do not mention limitations about browsing or web access.` 
        }];
        
        // Add comprehensive intelligence data
        if (intelligence) {
            content.push({
                type: "text",
                text: `

REAL-TIME WEB INTELLIGENCE DATA:
Research Query: ${intelligence.query}
Data Collection Method: ${intelligence.research_methodology}
Processing Time: ${intelligence.processing_time_ms}ms
Total Sources Analyzed: ${intelligence.source_references.length}

SENTIMENT ANALYSIS OVERVIEW:
- Overall Sentiment: ${intelligence.sentiment_analysis.overall_sentiment || 'N/A'}
- Confidence Level: ${intelligence.sentiment_analysis.confidence || 'N/A'}%
- Distribution: ${JSON.stringify(intelligence.sentiment_analysis.distribution || {})}
- Total Data Points: ${intelligence.sentiment_analysis.total_analyzed || 0}

PLATFORM BREAKDOWN:
${intelligence.data_sources.map(source => `
Platform: ${source.platform}
Data Points: ${source.data_points}
Sentiment: ${source.sentiment_analysis.overall_sentiment}
Source URLs Available: ${source.source_urls ? source.source_urls.length : 0}
`).join('\n')}

VERIFIED SOURCE REFERENCES:
${intelligence.source_references.map((source, index) => `
${index + 1}. ${source.title}
   URL: ${source.url}
   Platform: ${source.platform}
   Type: ${source.type}
`).join('\n')}

KEY INSIGHTS:
${intelligence.key_insights.map(insight => `- ${insight}`).join('\n')}

ACTIONABLE RECOMMENDATIONS:
${intelligence.recommendations.map(rec => `- ${rec}`).join('\n')}

${pdfReport ? `
PDF REPORT GENERATED:
Download URL: ${pdfReport.downloadUrl}
Report ID: ${pdfReport.reportId}
` : ''}

Please analyze this data and provide detailed insights using the InsightEar framework with proper source citations.`
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
            pdf_report: pdfReport || null
        });

    } catch (error) {
        console.error('Message processing failed:', error);
        res.status(500).json({ error: 'Failed to process message' });
    }
});

// Generate standalone report
app.post('/api/generate-report', async (req, res) => {
    try {
        const { query } = req.body;
        if (!query) {
            return res.status(400).json({ error: 'Query required' });
        }
        
        const intelligence = await gatherComprehensiveIntelligence(query);
        const pdfReport = await generatePDFReport(intelligence);
        
        res.json({ 
            status: 'success', 
            intelligence: intelligence,
            report: pdfReport
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
        capabilities: [
            'Real-time Web Intelligence',
            'Multi-platform Sentiment Analysis', 
            'PDF Report Generation',
            'Source Citation & Verification',
            'InsightEar Framework Implementation'
        ],
        version: '4.0-enterprise'
    });
});

// Serve enhanced chat widget
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>InsightEar GPT - Enterprise Market Intelligence</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        .ai-chat-widget {
            width: 100%; max-width: 600px; height: 700px; margin: 0 auto;
            border: none; border-radius: 16px; display: flex; flex-direction: column;
            background: white; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            overflow: hidden; position: relative;
        }
        .chat-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white; padding: 24px; text-align: center; font-weight: 600; font-size: 18px;
            display: flex; align-items: center; justify-content: center; gap: 12px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
        }
        .enterprise-badge {
            background: linear-gradient(135deg, #FF6B6B 0%, #4ECDC4 100%);
            color: white; padding: 6px 12px; border-radius: 16px; font-size: 11px;
            font-weight: bold; letter-spacing: 0.5px; animation: shimmer 3s infinite;
        }
        @keyframes shimmer { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.85; transform: scale(1.02); } }
        .chat-messages {
            flex: 1; overflow-y: auto; padding: 24px;
            background: linear-gradient(to bottom, #f8f9fa 0%, #e9ecef 100%);
        }
        .message {
            margin-bottom: 20px; display: flex; align-items: flex-start; gap: 14px;
            animation: messageSlide 0.4s ease-out;
        }
        @keyframes messageSlide { from { opacity: 0; transform: translateY(15px); } to { opacity: 1; transform: translateY(0); } }
        .message.user { flex-direction: row-reverse; }
        .message-content {
            max-width: 80%; padding: 16px 20px; border-radius: 24px;
            word-wrap: break-word; line-height: 1.5; position: relative;
        }
        .message.user .message-content {
            background: linear-gradient(135deg, #007bff 0%, #0056b3 100%);
            color: white; border-bottom-right-radius: 8px;
            box-shadow: 0 4px 16px rgba(0, 123, 255, 0.3);
        }
        .message.assistant .message-content {
            background: white; color: #333; border: 1px solid #e1e5e9;
            border-bottom-left-radius: 8px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
        }
        .message-avatar {
            width: 42px; height: 42px; border-radius: 50%; display: flex;
            align-items: center; justify-content: center; font-size: 14px;
            font-weight: bold; color: white; flex-shrink: 0;
        }
        .message.user .message-avatar { background: linear-gradient(135deg, #007bff 0%, #0056b3 100%); }
        .message.assistant .message-avatar { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
        .intelligence-badge {
            background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
            color: white; padding: 4px 10px; border-radius: 12px; font-size: 10px;
            margin-top: 8px; display: inline-block; animation: glow 2s infinite;
        }
        @keyframes glow { 0%, 100% { opacity: 1; } 50% { opacity: 0.8; } }
        .typing-indicator {
            display: none; align-items: center; gap: 14px; padding: 20px 24px;
            color: #6c757d; font-style: italic; animation: fadeIn 0.3s ease-out;
        }
        .typing-dots { display: flex; gap: 6px; }
        .typing-dot {
            width: 10px; height: 10px; background: #667eea; border-radius: 50%;
            animation: typing 1.4s infinite ease-in-out;
        }
        .typing-dot:nth-child(1) { animation-delay: -0.32s; }
        .typing-dot:nth-child(2) { animation-delay: -0.16s; }
        @keyframes typing { 0%, 80%, 100% { transform: scale(0.8); opacity: 0.5; } 40% { transform: scale(1); opacity: 1; } }
        .chat-input-container { padding: 24px; background: white; border-top: 1px solid #e1e5e9; }
        .input-wrapper {
            display: flex; gap: 12px; align-items: flex-end; background: #f8f9fa;
            border-radius: 28px; padding: 6px; border: 2px solid #e9ecef;
            transition: border-color 0.2s;
        }
        .input-wrapper:focus-within { border-color: #667eea; }
        .chat-input {
            flex: 1; min-height: 44px; max-height: 120px; padding: 12px 18px;
            border: none; background: transparent; resize: none; font-family: inherit;
            font-size: 15px; line-height: 1.4; outline: none;
        }
        .send-btn {
            width: 44px; height: 44px; border-radius: 50%; border: none; cursor: pointer;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;
            display: flex; align-items: center; justify-content: center; font-size: 18px;
            transition: all 0.2s;
        }
        .send-btn:hover:not(:disabled) { transform: scale(1.05); box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4); }
        .send-btn:disabled { background: #adb5bd; cursor: not-allowed; transform: none; }
    </style>
</head>
<body>
    <div class="ai-chat-widget">
        <div class="chat-header">
            🧠 InsightEar GPT
            <div class="enterprise-badge">ENTERPRISE</div>
        </div>
        
        <div class="chat-messages" id="chatMessages">
            <div class="message assistant">
                <div class="message-avatar">IE</div>
                <div class="message-content">
                    🚀 Welcome to InsightEar GPT Enterprise! I provide comprehensive market intelligence with real-time sentiment analysis, multi-platform data gathering, and detailed PDF reports.
                    <br><br>
                    Try: "Analyze market sentiment for Tesla" or "Customer feedback insights for iPhone"
                </div>
            </div>
        </div>
        
        <div class="typing-indicator" id="typingIndicator">
            <div class="message-avatar">IE</div>
            <div>
                Gathering intelligence
                <div class="typing-dots">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
            </div>
        </div>
        
        <div class="chat-input-container">
            <div class="input-wrapper">
                <textarea id="chatInput" class="chat-input" placeholder="Request market intelligence, sentiment analysis, or comprehensive reports..." rows="1"></textarea>
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
                addMessage('assistant', data.response);
                
                if (data.intelligence_included) {
                    addIntelligenceBadge(data.sources_analyzed);
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
        
        function addIntelligenceBadge(sources) {
            const lastMessage = document.querySelector('.message.assistant:last-child .message-content');
            if (lastMessage && !lastMessage.querySelector('.intelligence-badge')) {
                const badge = document.createElement('div');
                badge.className = 'intelligence-badge';
                badge.textContent = '🌐 Live Intelligence (' + sources + ' sources)';
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
    console.log(`🚀 InsightEar GPT Enterprise running on port ${port}`);
    console.log(`🌐 Real-time Intelligence: ENABLED`);
    console.log(`📄 PDF Report Generation: ENABLED`);
    console.log(`🔗 Source Citation: ENABLED`);
    console.log(`✅ Enterprise Market Intelligence Ready!`);
});

module.exports = app;
