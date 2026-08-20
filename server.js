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

const INSIGHTEAR_INSTRUCTIONS = fs.readFileSync(
    path.join(__dirname, 'insightear-prompt.txt'),
    'utf8'
);

const INSIGHTEAR_TOOLS = [
    {
        type: 'function',
        name: 'search_real_web_data',
        description: 'Search current Reddit and NewsAPI data for a research topic.',
        strict: true,
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Research topic or search query'
                }
            },
            required: ['query'],
            additionalProperties: false
        }
    },
    {
        type: 'function',
        name: 'analyze_real_market_data',
        description: 'Perform market analysis using Reddit and NewsAPI data.',
        strict: true,
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Brand, market, category, or research topic'
                }
            },
            required: ['query'],
            additionalProperties: false
        }
    },
    {
        type: 'function',
        name: 'get_company_background',
        description: 'Get available background information for a company or topic.',
        strict: true,
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Company or topic'
                }
            },
            required: ['query'],
            additionalProperties: false
        }
    }
];

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
console.log(
    '📰 NewsAPI Key:',
    API_CONFIG.newsApi.key ? '✅ Configured' : '❌ Missing'
);
console.log(
    '📱 Reddit API:',
    API_CONFIG.reddit.clientId ? '✅ Configured' : '❌ Missing'
);
console.log(
    '🤖 OpenAI Assistant:',
    process.env.OPENAI_API_KEY ? '✅ Configured' : '❌ Missing'
);

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(
    express.urlencoded({
        extended: true,
        limit: '50mb'
    })
);
app.use(express.static('public'));

// File storage configuration
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = './uploads';

        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, {
                recursive: true
            });
        }

        cb(null, uploadDir);
    },

    filename: function (req, file, cb) {
        const uniqueName =
            Date.now() + '-' + file.originalname;

        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024
    }
});

// ENHANCED REDDIT API INTEGRATION WITH BETTER ERROR HANDLING
async function ensureRedditToken() {

    if (
        redditToken &&
        redditTokenExpiry &&
        Date.now() < redditTokenExpiry
    ) {
        return redditToken;
    }

    try {

        const auth = Buffer.from(
            `${API_CONFIG.reddit.clientId}:${API_CONFIG.reddit.clientSecret}`
        ).toString('base64');

        console.log(
            '🔍 Attempting Reddit authentication...'
        );

        console.log(
            'Client ID length:',
            API_CONFIG.reddit.clientId
                ? API_CONFIG.reddit.clientId.length
                : 'missing'
        );

        console.log(
            'Client Secret length:',
            API_CONFIG.reddit.clientSecret
                ? API_CONFIG.reddit.clientSecret.length
                : 'missing'
        );

        // Try multiple user agents for better compatibility
        const userAgents = [
            'web:InsightEarGPT:v2.0.0 (by /u/marketresearch)',
            'InsightEar:2.0:market-research (by /u/apiuser)',
            'script:InsightEar:v2.0 by /u/research'
        ];

        for (
            let i = 0;
            i < userAgents.length;
            i++
        ) {

            try {

                console.log(
                    `🔄 Trying user agent ${i + 1}/${userAgents.length}: ${userAgents[i]}`
                );

                const response =
                    await axios.post(
                        'https://www.reddit.com/api/v1/access_token',
                        'grant_type=client_credentials',
                        {
                            headers: {
                                'Authorization':
                                    `Basic ${auth}`,
                                'Content-Type':
                                    'application/x-www-form-urlencoded',
                                'User-Agent':
                                    userAgents[i]
                            },
                            timeout: 15000
                        }
                    );

                redditToken =
                    response.data.access_token;

                redditTokenExpiry =
                    Date.now() +
                    (
                        response.data.expires_in *
                        1000
                    ) -
                    60000;

                console.log(
                    '✅ Reddit token obtained successfully with user agent:',
                    userAgents[i]
                );

                console.log(
                    '✅ Token expires in:',
                    response.data.expires_in,
                    'seconds'
                );

                return redditToken;

            } catch (authError) {

                console.log(
                    `❌ User agent ${i + 1} failed:`,
                    authError.response?.status,
                    authError.response?.data?.message ||
                    authError.message
                );

                if (
                    i ===
                    userAgents.length - 1
                ) {
                    throw authError;
                }

                continue;
            }
        }

    } catch (error) {

        console.error(
            '❌ Reddit auth complete failure:'
        );

        console.error(
            'Status:',
            error.response?.status
        );

        console.error(
            'Data:',
            error.response?.data
        );

        throw new Error(
            'Reddit authentication failed after all attempts: ' +
            (
                error.response?.data?.message ||
                error.message
            )
        );
    }
}

// ENHANCED REDDIT SEARCH FUNCTION WITH MULTIPLE FALLBACKS
async function searchRedditData(query) {

    console.log(
        '🔍 Searching Reddit for:',
        query
    );

    try {

        const token =
            await ensureRedditToken();

        const searchStrategies = [

            // Strategy 1: Subreddit-specific searches
            async () => {

                const subreddits = [
                    'stocks',
                    'investing',
                    'SecurityAnalysis',
                    'ValueInvesting',
                    'business',
                    'entrepreneur'
                ];

                let allPosts = [];

                for (
                    const subreddit of subreddits
                ) {

                    try {

                        console.log(
                            `🔍 Searching r/${subreddit} for ${query}...`
                        );

                        const searchResponse =
                            await axios.get(
                                `https://oauth.reddit.com/r/${subreddit}/search`,
                                {
                                    headers: {
                                        'Authorization':
                                            `Bearer ${token}`,
                                        'User-Agent':
                                            API_CONFIG.reddit.userAgent
                                    },

                                    params: {
                                        q: query,
                                        restrict_sr: true,
                                        sort: 'relevance',
                                        limit: 8,
                                        t: 'month'
                                    },

                                    timeout: 10000
                                }
                            );

                        if (
                            searchResponse
                                .data
                                .data
                                .children
                                .length > 0
                        ) {

                            allPosts.push(
                                ...searchResponse
                                    .data
                                    .data
                                    .children
                                    .map(
                                        child =>
                                            child.data
                                    )
                            );

                            console.log(
                                `📱 Found ${searchResponse.data.data.children.length} posts in r/${subreddit}`
                            );
                        }

                        // Rate limiting
                        await new Promise(
                            resolve =>
                                setTimeout(
                                    resolve,
                                    1500
                                )
                        );

                    } catch (
                        subError
                    ) {

                        console.log(
                            `⚠️ r/${subreddit} search failed:`,
                            subError.message
                        );

                        continue;
                    }
                }

                return allPosts;
            },

            // Strategy 2: General search
            async () => {

                console.log(
                    '🔄 Trying general Reddit search...'
                );

                const generalResponse =
                    await axios.get(
                        'https://oauth.reddit.com/search',
                        {
                            headers: {
                                'Authorization':
                                    `Bearer ${token}`,
                                'User-Agent':
                                    API_CONFIG.reddit.userAgent
                            },

                            params: {
                                q: query,
                                sort: 'relevance',
                                limit: 20,
                                t: 'month',
                                type: 'link'
                            },

                            timeout: 10000
                        }
                    );

                return generalResponse
                    .data
                    .data
                    .children
                    .map(
                        child =>
                            child.data
                    );
            }
        ];

        let allPosts = [];

        // Try each strategy
        for (
            let i = 0;
            i < searchStrategies.length;
            i++
        ) {

            try {

                const posts =
                    await searchStrategies[i]();

                if (
                    posts.length > 0
                ) {

                    allPosts =
                        posts;

                    console.log(
                        `✅ Strategy ${i + 1} succeeded with ${posts.length} posts`
                    );

                    break;
                }

            } catch (
                strategyError
            ) {

                console.log(
                    `❌ Strategy ${i + 1} failed:`,
                    strategyError.message
                );

                continue;
            }
        }

        // Deduplicate AFTER retrieval is finished
        const retrievedPostCount =
            allPosts.length;

        const uniquePosts =
            Array.from(
                new Map(
                    allPosts
                        .filter(
                            post =>
                                post &&
                                post.id
                        )
                        .map(
                            post => [
                                post.id,
                                post
                            ]
                        )
                ).values()
            );

        const redditDuplicatesRemoved =
            retrievedPostCount -
            uniquePosts.length;

        // Keep payload manageable
        allPosts =
            uniquePosts.slice(
                0,
                12
            );

        console.log(
            `🧹 Reddit dedupe: ${retrievedPostCount} retrieved → ${uniquePosts.length} unique → ${allPosts.length} retained`
        );

        console.log(
            `📱 Total Reddit posts retained for ${query}: ${allPosts.length}`
        );

        if (
            allPosts.length === 0
        ) {

            return {
                search_successful: false,

                error:
                    'No Reddit posts found for query: ' +
                    query,

                total_posts: 0,

                retrieved_before_dedup:
                    retrievedPostCount,

                duplicates_removed:
                    redditDuplicatesRemoved,

                fallback_message:
                    'Try searching for a more popular brand or topic'
            };
        }

        // Keep legacy sentiment/themes for old drilldown functions.
        // Responses tool output strips sentiment before sending evidence to GPT.
        const processedPosts =
            allPosts.map(
                post => ({
                    id:
                        post.id,

                    title:
                        post.title,

                    content:
                        (
                            post.selftext ||
                            post.title
                        ).substring(
                            0,
                            1500
                        ),

                    subreddit:
                        post.subreddit,

                    score:
                        post.score,

                    comments:
                        post.num_comments,

                    url:
                        `https://reddit.com${post.permalink}`,

                    created:
                        new Date(
                            post.created_utc *
                            1000
                        ).toISOString(),

                    sentiment:
                        analyzeSentiment(
                            post.title +
                            ' ' +
                            (
                                post.selftext ||
                                ''
                            )
                        ),

                    author:
                        post.author
                })
            );

        const sentiment =
            calculateSentimentFromPosts(
                processedPosts
            );

        const themes =
            extractThemesFromPosts(
                processedPosts
            );

        const topSubreddits =
            getTopSubreddits(
                allPosts
            );

        return {
            search_successful: true,

            query_processed:
                query,

            total_posts:
                allPosts.length,

            retrieved_before_dedup:
                retrievedPostCount,

            duplicates_removed:
                redditDuplicatesRemoved,

            processed_posts:
                processedPosts,

            sentiment_breakdown:
                sentiment,

            themes:
                themes,

            top_subreddits:
                topSubreddits,

            data_quality:
                'real_reddit_api',

            timestamp:
                new Date()
                    .toISOString()
        };

    } catch (error) {

        console.error(
            '❌ Reddit search complete failure:',
            error.message
        );

        return {
            search_successful: false,

            error:
                'Reddit API error: ' +
                error.message,

            fallback_used: true,

            total_posts: 0,

            retrieved_before_dedup: 0,

            duplicates_removed: 0
        };
    }
}

// ENHANCED NEWS API INTEGRATION
async function searchNewsData(query) {

    console.log(
        '📰 Searching News for:',
        query
    );

    try {

        const response =
            await axios.get(
                `${API_CONFIG.newsApi.baseUrl}/everything`,
                {
                    params: {
                        q: query,
                        sortBy:
                            'publishedAt',
                        pageSize:
                            15,
                        language:
                            'en',
                        apiKey:
                            API_CONFIG.newsApi.key,
                        from:
                            getDateDaysAgo(
                                30
                            ),

                        excludeDomains:
                            'youtube.com,facebook.com,twitter.com,reddit.com'
                    },

                    timeout:
                        15000
                }
            );

        const retrievedArticles =
            response
                .data
                .articles
                .filter(
                    article =>
                        article.title &&
                        article.url &&
                        article.title !==
                            '[Removed]' &&
                        !article.title.includes(
                            '[Removed]'
                        )
                );

        const articles =
            Array.from(
                new Map(
                    retrievedArticles.map(
                        article => [
                            article.url,
                            article
                        ]
                    )
                ).values()
            );

        const newsDuplicatesRemoved =
            retrievedArticles.length -
            articles.length;

        console.log(
            `🧹 News dedupe: ${retrievedArticles.length} retrieved → ${articles.length} unique`
        );

        console.log(
            `📰 Found ${articles.length} real news articles for ${query}`
        );

        const processedArticles =
            articles.map(
                article => ({
                    title:
                        article.title,

                    source:
                        article
                            .source
                            .name,

                    url:
                        article.url,

                    publishedAt:
                        article.publishedAt,

                    description:
                        article.description ||
                        '',

                    sentiment:
                        analyzeSentiment(
                            article.title +
                            ' ' +
                            (
                                article.description ||
                                ''
                            )
                        ),

                    author:
                        article.author ||
                        'Unknown',

                    urlToImage:
                        article.urlToImage
                })
            );

        const sentiment =
            calculateSentimentFromArticles(
                processedArticles
            );

        const sources =
            [
                ...new Set(
                    articles.map(
                        a =>
                            a.source.name
                    )
                )
            ];

        const themes =
            extractNewsThemes(
                processedArticles
            );

        return {
            search_successful:
                true,

            query_processed:
                query,

            total_articles:
                articles.length,

            retrieved_before_dedup:
                retrievedArticles.length,

            duplicates_removed:
                newsDuplicatesRemoved,

            processed_articles:
                processedArticles,

            sentiment_breakdown:
                sentiment,

            themes:
                themes,

            sources:
                sources,

            total_available:
                response.data.totalResults,

            data_quality:
                'real_news_api',

            timestamp:
                new Date()
                    .toISOString()
        };

    } catch (error) {

        console.error(
            '❌ NewsAPI search error:',
            error.message
        );

        return {
            search_successful:
                false,

            error:
                'NewsAPI error: ' +
                error.message,

            fallback_used:
                true,

            total_articles:
                0
        };
    }
}

// ENHANCED COMBINED REAL MARKET ANALYSIS
async function handleRealMarketAnalysis(
    query
) {

    console.log(
        '🔍 Starting REAL market analysis for:',
        query
    );

    const company =
        extractCompanyName(
            query
        );

    try {

        const analysisId =
            'analysis-' +
            Date.now() +
            '-' +
            Math
                .random()
                .toString(36)
                .substr(
                    2,
                    9
                );

        console.log(
            '📊 Creating analysis with ID:',
            analysisId
        );

        const [
            redditData,
            newsData
        ] =
            await Promise.all([
                searchRedditData(
                    company
                ),
                searchNewsData(
                    company
                )
            ]);

        // Keep complete source data in cache for drilldown
        const analysisData = {
            analysis_id:
                analysisId,

            company:
                company,

            reddit_data:
                redditData,

            news_data:
                newsData,

            timestamp:
                new Date()
                    .toISOString(),

            has_real_data:
                true,

            query_processed:
                query
        };

        researchCache.set(
            analysisId,
            analysisData
        );

        console.log(
            '✅ Analysis data stored with ID:',
            analysisId
        );

        console.log(
            '📊 Cache now has',
            researchCache.size,
            'analyses'
        );

        // Responses receives raw evidence without legacy sentiment labels.
        const combinedAnalysis = {
            analysis_id:
                analysisId,

            topic:
                company,

            timestamp:
                new Date()
                    .toISOString(),

            data_sources: [
                'Reddit API',
                'NewsAPI'
            ],

            reddit: {
                success:
                    redditData
                        .search_successful,

                retrieved_before_dedup:
                    redditData
                        .retrieved_before_dedup ||
                    redditData
                        .total_posts ||
                    0,

                unique_items:
                    redditData
                        .total_posts ||
                    0,

                duplicates_removed:
                    redditData
                        .duplicates_removed ||
                    0,

                posts:
                    (
                        redditData
                            .processed_posts ||
                        []
                    ).map(
                        ({
                            sentiment,
                            ...post
                        }) =>
                            post
                    ),

                top_subreddits:
                    redditData
                        .top_subreddits ||
                    []
            },

            news: {
                success:
                    newsData
                        .search_successful,

                retrieved_before_dedup:
                    newsData
                        .retrieved_before_dedup ||
                    newsData
                        .total_articles ||
                    0,

                unique_items:
                    newsData
                        .total_articles ||
                    0,

                duplicates_removed:
                    newsData
                        .duplicates_removed ||
                    0,

                articles:
                    (
                        newsData
                            .processed_articles ||
                        []
                    ).map(
                        ({
                            sentiment,
                            ...article
                        }) =>
                            article
                    ),

                sources:
                    newsData
                        .sources ||
                    []
            },

            methodology_note:
                'These are retrieved source items. Validate relevance before calculating sentiment, themes, trends, confidence, or recommendations.',

            drilldown_available:
                true,

            cache_stored:
                true
        };

        return JSON.stringify(
            combinedAnalysis,
            null,
            2
        );

    } catch (error) {

        console.error(
            '❌ Real market analysis error:',
            error
        );

        return JSON.stringify(
            {
                error:
                    'Real market analysis failed',

                message:
                    error.message,

                company:
                    company,

                timestamp:
                    new Date()
                        .toISOString()
            }
        );
    }
}

// ENHANCED WEB SEARCH WITH REAL APIS
async function handleWebSearch(
    query
) {

    console.log(
        '🌐 Starting enhanced web search for:',
        query
    );

    try {

        const [
            redditResults,
            newsResults
        ] =
            await Promise.all([
                searchRedditData(
                    query
                ),
                searchNewsData(
                    query
                )
            ]);

        const combinedResults = {
            search_successful:
                true,

            query_processed:
                query,

            timestamp:
                new Date()
                    .toISOString(),

            data_sources: {
                reddit: {
                    success:
                        redditResults
                            .search_successful,

                    posts_found:
                        redditResults
                            .total_posts ||
                        0,

                    retrieved_before_dedup:
                        redditResults
                            .retrieved_before_dedup ||
                        redditResults
                            .total_posts ||
                        0,

                    duplicates_removed:
                        redditResults
                            .duplicates_removed ||
                        0,

                    posts:
                        (
                            redditResults
                                .processed_posts ||
                            []
                        ).map(
                            ({
                                sentiment,
                                ...post
                            }) =>
                                post
                        ),

                    top_subreddits:
                        redditResults
                            .top_subreddits ||
                        []
                },

                news: {
                    success:
                        newsResults
                            .search_successful,

                    articles_found:
                        newsResults
                            .total_articles ||
                        0,

                    retrieved_before_dedup:
                        newsResults
                            .retrieved_before_dedup ||
                        newsResults
                            .total_articles ||
                        0,

                    duplicates_removed:
                        newsResults
                            .duplicates_removed ||
                        0,

                    articles:
                        (
                            newsResults
                                .processed_articles ||
                            []
                        ).map(
                            ({
                                sentiment,
                                ...article
                            }) =>
                                article
                        ),

                    sources:
                        newsResults
                            .sources ||
                        []
                }
            },

            combined_metrics: {
                total_mentions:
                    (
                        redditResults
                            .total_posts ||
                        0
                    ) +
                    (
                        newsResults
                            .total_articles ||
                        0
                    ),

                platforms: [
                    'Reddit',
                    'News Sources'
                ],

                data_authenticity:
                    'verified_apis',

                api_status: {
                    reddit:
                        redditResults
                            .search_successful
                            ? 'connected'
                            : 'failed',

                    news:
                        newsResults
                            .search_successful
                            ? 'connected'
                            : 'failed'
                }
            }
        };

        console.log(
            '✅ Enhanced web search completed'
        );

        return JSON.stringify(
            combinedResults,
            null,
            2
        );

    } catch (error) {

        console.error(
            '❌ Enhanced web search error:',
            error
        );

        return JSON.stringify(
            {
                search_successful:
                    false,

                error:
                    error.message,

                timestamp:
                    new Date()
                        .toISOString()
            }
        );
    }
}

// ENHANCED DRILLDOWN FUNCTIONALITY
async function handleDrilldownQuery(
    question,
    sessionId
) {

    console.log(
        '🔍 Processing drilldown query:',
        question
    );

    console.log(
        '🔍 Session ID:',
        sessionId
    );

    const session =
        sessions.get(
            sessionId
        );

    console.log(
        '📊 Session found:',
        !!session
    );

    console.log(
        '📊 Session lastAnalysisId:',
        session?.lastAnalysisId
    );

    if (
        !session ||
        !session.lastAnalysisId
    ) {

        console.log(
            '❌ No session or analysis ID found'
        );

        return "I don't have recent analysis data to drill down into. Please run a market analysis first (e.g., 'analyze Tesla sentiment'), then ask specific questions about the results.";
    }

    const analysisData =
        researchCache.get(
            session.lastAnalysisId
        );

    console.log(
        '📊 Analysis data found in cache:',
        !!analysisData
    );

    if (
        !analysisData
    ) {

        console.log(
            '❌ Analysis data not found in cache for ID:',
            session.lastAnalysisId
        );

        const cacheDebug =
            Array.from(
                researchCache.entries()
            ).map(
                ([id, data]) => ({
                    id:
                        id,

                    company:
                        data.company,

                    timestamp:
                        data.timestamp
                })
            );

        return (
            `Analysis data not found in cache. Please run a new market analysis first.\n\n` +
            `Debug Info:\n` +
            `- Looking for: ${session.lastAnalysisId}\n` +
            `- Available analyses: ${JSON.stringify(cacheDebug, null, 2)}`
        );
    }

    console.log(
        '✅ Found analysis data for company:',
        analysisData.company
    );

    const lowerQuestion =
        question.toLowerCase();

    if (
        lowerQuestion.includes(
            'reddit'
        ) &&
        (
            lowerQuestion.includes(
                'post'
            ) ||
            lowerQuestion.includes(
                'discussion'
            )
        )
    ) {

        return getDrilldownRedditPosts(
            analysisData,
            question
        );

    } else if (
        lowerQuestion.includes(
            'negative'
        ) &&
        (
            lowerQuestion.includes(
                'theme'
            ) ||
            lowerQuestion.includes(
                'topic'
            )
        )
    ) {

        return getDrilldownNegativeThemes(
            analysisData
        );

    } else if (
        lowerQuestion.includes(
            'positive'
        ) &&
        (
            lowerQuestion.includes(
                'theme'
            ) ||
            lowerQuestion.includes(
                'topic'
            )
        )
    ) {

        return getDrilldownPositiveThemes(
            analysisData
        );

    } else if (
        lowerQuestion.includes(
            'news'
        ) &&
        (
            lowerQuestion.includes(
                'headline'
            ) ||
            lowerQuestion.includes(
                'article'
            )
        )
    ) {

        return getDrilldownNewsHeadlines(
            analysisData
        );

    } else if (
        lowerQuestion.includes(
            'sentiment'
        ) &&
        lowerQuestion.includes(
            'breakdown'
        )
    ) {

        return getDrilldownSentimentBreakdown(
            analysisData
        );

    } else if (
        lowerQuestion.includes(
            'subreddit'
        ) ||
        lowerQuestion.includes(
            'where'
        )
    ) {

        return getDrilldownSubreddits(
            analysisData
        );

    } else if (
        lowerQuestion.includes(
            'source'
        ) ||
        lowerQuestion.includes(
            'article'
        ) ||
        lowerQuestion.includes(
            'show me'
        )
    ) {

        return getDrilldownNewsHeadlines(
            analysisData
        );

    } else {

        return getGenericDrilldown(
            analysisData,
            question
        );
    }
}

// ENHANCED DRILLDOWN FUNCTIONS WITH BETTER ARTICLE LINKS
function getDrilldownRedditPosts(
    analysisData,
    question
) {

    const redditData =
        analysisData.reddit_data;

    if (
        !redditData ||
        !redditData.search_successful
    ) {

        return (
            `**🔍 Reddit Data Status**\n\n` +
            `No Reddit data available for ${analysisData.company}.\n\n` +
            `**Reason:** ${redditData?.error || 'Reddit API connection issues'}\n\n` +
            `**Alternative:** Try asking about news headlines instead: "show me news headlines about ${analysisData.company}"`
        );
    }

    const posts =
        redditData.processed_posts ||
        [];

    const displayPosts =
        posts.slice(
            0,
            12
        );

    let response =
        `**🔍 Real Reddit Posts about ${analysisData.company}**\n\n`;

    response +=
        `Found ${posts.length} total posts. Showing top ${displayPosts.length}:\n\n`;

    displayPosts.forEach(
        (
            post,
            index
        ) => {

            response +=
                `**${index + 1}. r/${post.subreddit}**: "${post.title}"\n`;

            response +=
                `   • **Score:** ${post.score} upvotes | **Comments:** ${post.comments}\n`;

            response +=
                `   • **Sentiment:** ${post.sentiment} | **Author:** u/${post.author}\n`;

            response +=
                `   • **Posted:** ${new Date(post.created).toLocaleDateString()}\n`;

            response +=
                `   • **Direct Link:** ${post.url}\n\n`;
        }
    );

    response +=
        `**💡 How to use these links:**\n`;

    response +=
        `• Copy any Reddit URL and paste into your browser\n`;

    response +=
        `• These are direct links to actual Reddit discussions\n`;

    response +=
        `• You can read full posts and comments\n\n`;

    response +=
        `*This is real data from ${posts.length} authentic Reddit posts*`;

    return response;
}

function getDrilldownNegativeThemes(
    analysisData
) {

    const redditData =
        analysisData.reddit_data;

    const newsData =
        analysisData.news_data;

    let response =
        `**🔍 Negative Themes Analysis for ${analysisData.company} (REAL DATA)**\n\n`;

    if (
        redditData &&
        redditData.search_successful
    ) {

        const posts =
            redditData.processed_posts ||
            [];

        const negativePosts =
            posts.filter(
                post =>
                    post.sentiment ===
                    'negative'
            );

        if (
            negativePosts.length > 0
        ) {

            response +=
                `**📱 Reddit Negative Themes (${negativePosts.length} posts):**\n`;

            const themes =
                extractThemesFromPosts(
                    negativePosts
                );

            themes
                .slice(
                    0,
                    5
                )
                .forEach(
                    (
                        theme,
                        index
                    ) => {

                        response +=
                            `${index + 1}. **${theme.theme}**: ${theme.count} mentions\n`;
                    }
                );

            response +=
                `\n**Sample negative posts:**\n`;

            negativePosts
                .slice(
                    0,
                    3
                )
                .forEach(
                    post => {

                        response +=
                            `• r/${post.subreddit}: "${post.title}"\n`;
                    }
                );

            response +=
                `\n`;
        }
    }

    if (
        newsData &&
        newsData.search_successful
    ) {

        const articles =
            newsData.processed_articles ||
            [];

        const negativeArticles =
            articles.filter(
                article =>
                    article.sentiment ===
                    'negative'
            );

        if (
            negativeArticles.length > 0
        ) {

            response +=
                `**📰 News Negative Themes (${negativeArticles.length} articles):**\n`;

            const themes =
                extractThemesFromPosts(
                    negativeArticles.map(
                        a => ({
                            content:
                                a.description,

                            title:
                                a.title
                        })
                    )
                );

            themes
                .slice(
                    0,
                    5
                )
                .forEach(
                    (
                        theme,
                        index
                    ) => {

                        response +=
                            `${index + 1}. **${theme.theme}**: ${theme.count} mentions\n`;
                    }
                );

            response +=
                `\n**Sample negative headlines:**\n`;

            negativeArticles
                .slice(
                    0,
                    3
                )
                .forEach(
                    article => {

                        response +=
                            `• ${article.source}: "${article.title}"\n`;
                    }
                );
        }
    }

    return response;
}

function getDrilldownPositiveThemes(
    analysisData
) {

    const redditData =
        analysisData.reddit_data;

    const newsData =
        analysisData.news_data;

    let response =
        `**🔍 Positive Themes Analysis for ${analysisData.company} (REAL DATA)**\n\n`;

    if (
        redditData &&
        redditData.search_successful
    ) {

        const posts =
            redditData.processed_posts ||
            [];

        const positivePosts =
            posts.filter(
                post =>
                    post.sentiment ===
                    'positive'
            );

        if (
            positivePosts.length > 0
        ) {

            response +=
                `**📱 Reddit Positive Themes (${positivePosts.length} posts):**\n`;

            const themes =
                extractThemesFromPosts(
                    positivePosts
                );

            themes
                .slice(
                    0,
                    5
                )
                .forEach(
                    (
                        theme,
                        index
                    ) => {

                        response +=
                            `${index + 1}. **${theme.theme}**: ${theme.count} mentions\n`;
                    }
                );

            response +=
                `\n**Sample positive posts:**\n`;

            positivePosts
                .slice(
                    0,
                    3
                )
                .forEach(
                    post => {

                        response +=
                            `• r/${post.subreddit}: "${post.title}"\n`;
                    }
                );

            response +=
                `\n`;
        }
    }

    if (
        newsData &&
        newsData.search_successful
    ) {

        const articles =
            newsData.processed_articles ||
            [];

        const positiveArticles =
            articles.filter(
                article =>
                    article.sentiment ===
                    'positive'
            );

        if (
            positiveArticles.length > 0
        ) {

            response +=
                `**📰 News Positive Themes (${positiveArticles.length} articles):**\n`;

            const themes =
                extractThemesFromPosts(
                    positiveArticles.map(
                        a => ({
                            content:
                                a.description,

                            title:
                                a.title
                        })
                    )
                );

            themes
                .slice(
                    0,
                    5
                )
                .forEach(
                    (
                        theme,
                        index
                    ) => {

                        response +=
                            `${index + 1}. **${theme.theme}**: ${theme.count} mentions\n`;
                    }
                );

            response +=
                `\n**Sample positive headlines:**\n`;

            positiveArticles
                .slice(
                    0,
                    3
                )
                .forEach(
                    article => {

                        response +=
                            `• ${article.source}: "${article.title}"\n`;
                    }
                );
        }
    }

    return response;
}

function getDrilldownNewsHeadlines(
    analysisData
) {

    const newsData =
        analysisData.news_data;

    if (
        !newsData ||
        !newsData.search_successful
    ) {

        return (
            `**📰 News Data Status**\n\n` +
            `No news data available for ${analysisData.company}.\n\n` +
            `**Reason:** ${newsData?.error || 'NewsAPI connection issues'}\n\n` +
            `**Alternative:** Try asking about Reddit posts instead: "show me Reddit posts about ${analysisData.company}"`
        );
    }

    const articles =
        newsData.processed_articles ||
        [];

    const displayArticles =
        articles.slice(
            0,
            15
        );

    let response =
        `**📰 Recent News Headlines about ${analysisData.company} (REAL DATA)**\n\n`;

    response +=
        `Found ${articles.length} total articles. Showing top ${displayArticles.length}:\n\n`;

    displayArticles.forEach(
        (
            article,
            index
        ) => {

            if (
                article.title &&
                article.url
            ) {

                response +=
                    `**${index + 1}. "${article.title}"**\n`;

                response +=
                    `   • **Source:** ${article.source || 'Unknown'}\n`;

                response +=
                    `   • **Sentiment:** ${article.sentiment || 'neutral'}\n`;

                response +=
                    `   • **Published:** ${new Date(article.publishedAt).toLocaleDateString()}\n`;

                response +=
                    `   • **Direct Link:** ${article.url}\n`;

                if (
                    article.description &&
                    article.description.length >
                    0
                ) {

                    const shortDesc =
                        article.description.substring(
                            0,
                            120
                        ) +
                        '...';

                    response +=
                        `   • **Preview:** ${shortDesc}\n`;
                }

                response +=
                    `\n`;
            }
        }
    );

    response +=
        `**💡 How to use these links:**\n`;

    response +=
        `• Copy and paste any URL into your browser\n`;

    response +=
        `• These are direct links to actual news articles\n`;

    response +=
        `*These are ${articles.length} real headlines from NewsAPI with direct article URLs*`;

    return response;
}

function getDrilldownSentimentBreakdown(
    analysisData
) {

    let response =
        `**📊 Detailed Sentiment Breakdown for ${analysisData.company} (REAL DATA)**\n\n`;

    if (
        analysisData.reddit_data &&
        analysisData.reddit_data
            .search_successful
    ) {

        const redditSentiment =
            analysisData
                .reddit_data
                .sentiment_breakdown;

        response +=
            `**📱 Reddit Analysis (${analysisData.reddit_data.total_posts} posts):**\n`;

        response +=
            `• **Positive:** ${redditSentiment.positive}% (${Math.round(analysisData.reddit_data.total_posts * redditSentiment.positive / 100)} posts)\n`;

        response +=
            `• **Neutral:** ${redditSentiment.neutral}% (${Math.round(analysisData.reddit_data.total_posts * redditSentiment.neutral / 100)} posts)\n`;

        response +=
            `• **Negative:** ${redditSentiment.negative}% (${Math.round(analysisData.reddit_data.total_posts * redditSentiment.negative / 100)} posts)\n\n`;
    }

    if (
        analysisData.news_data &&
        analysisData.news_data
            .search_successful
    ) {

        const newsSentiment =
            analysisData
                .news_data
                .sentiment_breakdown;

        response +=
            `**📰 News Analysis (${analysisData.news_data.total_articles} articles):**\n`;

        response +=
            `• **Positive:** ${newsSentiment.positive}% (${Math.round(analysisData.news_data.total_articles * newsSentiment.positive / 100)} articles)\n`;

        response +=
            `• **Neutral:** ${newsSentiment.neutral}% (${Math.round(analysisData.news_data.total_articles * newsSentiment.neutral / 100)} articles)\n`;

        response +=
            `• **Negative:** ${newsSentiment.negative}% (${Math.round(analysisData.news_data.total_articles * newsSentiment.negative / 100)} articles)\n\n`;
    }

    response +=
        `*All data sourced from real Reddit and News APIs*`;

    return response;
}

function getDrilldownSubreddits(
    analysisData
) {

    const redditData =
        analysisData.reddit_data;

    if (
        !redditData ||
        !redditData.search_successful
    ) {

        return (
            `**📱 Reddit Data Status**\n\n` +
            `No Reddit data available for subreddit analysis of ${analysisData.company}.`
        );
    }

    const subreddits =
        redditData.top_subreddits ||
        [];

    let response =
        `**📱 Top Subreddits Discussing ${analysisData.company} (REAL DATA)**\n\n`;

    if (
        subreddits.length > 0
    ) {

        subreddits
            .slice(
                0,
                12
            )
            .forEach(
                (
                    sub,
                    index
                ) => {

                    response +=
                        `**${index + 1}. ${sub.subreddit}**: ${sub.count} posts\n`;
                }
            );

        response +=
            `\n**💡 Subreddit Insights:**\n`;

        response +=
            `• Most active community: ${subreddits[0]?.subreddit}\n`;

        response +=
            `• Total communities: ${subreddits.length}\n`;

        response +=
            `• Total posts analyzed: ${redditData.total_posts}\n`;

    } else {

        response +=
            `No specific subreddit data available for ${analysisData.company}.`;
    }

    return response;
}

function getGenericDrilldown(
    analysisData,
    question
) {

    let response =
        `**🔍 Available Real Data for ${analysisData.company}**\n\n`;

    if (
        analysisData.reddit_data &&
        analysisData.reddit_data
            .search_successful
    ) {

        response +=
            `📱 **Reddit Data**: ✅ ${analysisData.reddit_data.total_posts} real posts available\n`;

    } else {

        response +=
            `📱 **Reddit Data**: ❌ Not available\n`;
    }

    if (
        analysisData.news_data &&
        analysisData.news_data
            .search_successful
    ) {

        response +=
            `📰 **News Data**: ✅ ${analysisData.news_data.total_articles} real articles available\n`;

    } else {

        response +=
            `📰 **News Data**: ❌ Not available\n`;
    }

    return response;
}

// SENTIMENT ANALYSIS FUNCTIONS
function analyzeSentiment(
    text
) {

    if (!text) {
        return 'neutral';
    }

    const positiveWords = [
        'good',
        'great',
        'excellent',
        'amazing',
        'love',
        'best',
        'awesome',
        'fantastic',
        'outstanding',
        'brilliant',
        'perfect',
        'wonderful',
        'impressive',
        'strong',
        'positive',
        'growth',
        'success',
        'win',
        'bullish',
        'optimistic',
        'upgrade',
        'innovative',
        'revolutionary',
        'breakthrough',
        'recommend',
        'satisfied',
        'boost',
        'surge',
        'rally',
        'soar',
        'record',
        'beat',
        'exceed',
        'outperform'
    ];

    const negativeWords = [
        'bad',
        'terrible',
        'awful',
        'hate',
        'worst',
        'horrible',
        'disappointing',
        'poor',
        'weak',
        'failed',
        'disaster',
        'crash',
        'drop',
        'decline',
        'bearish',
        'pessimistic',
        'downgrade',
        'concern',
        'problem',
        'issue',
        'risk',
        'overpriced',
        'expensive',
        'broken',
        'defect',
        'recall',
        'lawsuit',
        'scandal',
        'plunge',
        'slump',
        'miss',
        'disappoint',
        'struggle',
        'challenge',
        'threat'
    ];

    const lowerText =
        text.toLowerCase();

    const positiveScore =
        positiveWords.filter(
            word =>
                lowerText.includes(
                    word
                )
        ).length;

    const negativeScore =
        negativeWords.filter(
            word =>
                lowerText.includes(
                    word
                )
        ).length;

    if (
        positiveScore >
        negativeScore
    ) {
        return 'positive';
    }

    if (
        negativeScore >
        positiveScore
    ) {
        return 'negative';
    }

    return 'neutral';
}

function calculateSentimentFromPosts(
    posts
) {

    const total =
        posts.length;

    if (
        total === 0
    ) {

        return {
            positive: 0,
            neutral: 0,
            negative: 0,
            total_analyzed: 0
        };
    }

    const positive =
        posts.filter(
            post =>
                post.sentiment ===
                'positive'
        ).length;

    const negative =
        posts.filter(
            post =>
                post.sentiment ===
                'negative'
        ).length;

    const neutral =
        total -
        positive -
        negative;

    return {
        positive:
            Math.round(
                (
                    positive /
                    total
                ) *
                100
            ),

        neutral:
            Math.round(
                (
                    neutral /
                    total
                ) *
                100
            ),

        negative:
            Math.round(
                (
                    negative /
                    total
                ) *
                100
            ),

        total_analyzed:
            total
    };
}

function calculateSentimentFromArticles(
    articles
) {

    return calculateSentimentFromPosts(
        articles
    );
}

// THEME EXTRACTION
function extractThemesFromPosts(
    posts
) {

    const themeKeywords = {
        'Product Quality': [
            'quality',
            'build',
            'durability',
            'reliability',
            'defect',
            'broken',
            'manufacturing',
            'craftsmanship'
        ],

        'Customer Service': [
            'service',
            'support',
            'help',
            'response',
            'staff',
            'team',
            'representative',
            'experience'
        ],

        'Pricing': [
            'price',
            'cost',
            'expensive',
            'cheap',
            'value',
            'worth',
            'affordable',
            'overpriced',
            'discount'
        ],

        'Innovation': [
            'new',
            'update',
            'feature',
            'technology',
            'innovation',
            'advanced',
            'cutting-edge',
            'breakthrough'
        ],

        'Competition': [
            'vs',
            'versus',
            'competitor',
            'compare',
            'better',
            'alternative',
            'rival',
            'market share'
        ],

        'Performance': [
            'fast',
            'slow',
            'speed',
            'performance',
            'efficiency',
            'results',
            'benchmark',
            'metrics'
        ],

        'Design': [
            'design',
            'look',
            'appearance',
            'style',
            'aesthetic',
            'beautiful',
            'ugly',
            'sleek'
        ],

        'Delivery': [
            'shipping',
            'delivery',
            'arrive',
            'delay',
            'fast',
            'slow',
            'logistics',
            'fulfillment'
        ],

        'Investment': [
            'stock',
            'share',
            'invest',
            'buy',
            'sell',
            'earnings',
            'revenue',
            'profit',
            'valuation'
        ],

        'Sustainability': [
            'green',
            'eco',
            'environment',
            'sustainable',
            'carbon',
            'renewable',
            'clean',
            'ethical'
        ]
    };

    const themeCounts = {};

    Object
        .keys(
            themeKeywords
        )
        .forEach(
            theme =>
                themeCounts[
                    theme
                ] = 0
        );

    posts.forEach(
        post => {

            const text =
                (
                    post.content ||
                    post.title ||
                    ''
                ).toLowerCase();

            Object
                .entries(
                    themeKeywords
                )
                .forEach(
                    ([
                        theme,
                        keywords
                    ]) => {

                        if (
                            keywords.some(
                                keyword =>
                                    text.includes(
                                        keyword
                                    )
                            )
                        ) {

                            themeCounts[
                                theme
                            ]++;
                        }
                    }
                );
        }
    );

    return Object
        .entries(
            themeCounts
        )
        .filter(
            ([
                theme,
                count
            ]) =>
                count > 0
        )
        .sort(
            (
                [, a],
                [, b]
            ) =>
                b - a
        )
        .slice(
            0,
            8
        )
        .map(
            ([
                theme,
                count
            ]) => ({
                theme:
                    theme,

                count:
                    count,

                percentage:
                    posts.length > 0
                        ? Math.round(
                            (
                                count /
                                posts.length
                            ) *
                            100
                        )
                        : 0
            })
        );
}

function extractNewsThemes(
    articles
) {

    return extractThemesFromPosts(
        articles.map(
            a => ({
                content:
                    a.description,

                title:
                    a.title
            })
        )
    );
}

function getTopSubreddits(
    posts
) {

    const subredditCount =
        {};

    posts.forEach(
        post => {

            const sub =
                post.subreddit;

            subredditCount[
                sub
            ] =
                (
                    subredditCount[
                        sub
                    ] ||
                    0
                ) +
                1;
        }
    );

    return Object
        .entries(
            subredditCount
        )
        .sort(
            (
                [, a],
                [, b]
            ) =>
                b - a
        )
        .slice(
            0,
            15
        )
        .map(
            ([
                subreddit,
                count
            ]) => ({
                subreddit:
                    `r/${subreddit}`,

                count:
                    count
            })
        );
}

// Kept for backwards compatibility.
// Responses API no longer receives this object.
function generateCombinedInsights(
    redditData,
    newsData,
    company
) {

    const insights = {
        overall_sentiment:
            'mixed',

        key_findings:
            [],

        data_quality:
            'high',

        recommendation:
            'monitor_trends',

        confidence_level:
            'high'
    };

    if (
        redditData.search_successful
    ) {

        const sentiment =
            redditData
                .sentiment_breakdown;

        insights
            .key_findings
            .push(
                `Reddit Community: ${sentiment.positive}% positive sentiment from ${redditData.total_posts} real posts`
            );
    }

    if (
        newsData.search_successful
    ) {

        const sentiment =
            newsData
                .sentiment_breakdown;

        insights
            .key_findings
            .push(
                `Media Coverage: ${sentiment.positive}% positive sentiment from ${newsData.total_articles} real articles`
            );
    }

    return insights;
}

// UTILITY FUNCTIONS
function extractCompanyName(
    query
) {

    const companies = [
        'Tesla',
        'Apple',
        'Google',
        'Microsoft',
        'Amazon',
        'Meta',
        'Netflix',
        'Starbucks',
        'McDonald\'s',
        'Coca-Cola',
        'Nike',
        'Adidas',
        'Walmart',
        'Target',
        'Mondelez',
        'Spotify',
        'Uber',
        'Airbnb',
        'Disney',
        'Ford',
        'GM',
        'Toyota',
        'Honda',
        'BMW',
        'Mercedes',
        'Audi',
        'Volkswagen',
        'Intel',
        'AMD',
        'Nvidia',
        'Samsung',
        'Sony',
        'LG',
        'Huawei'
    ];

    for (
        const company of companies
    ) {

        const escapedCompany =
            company.replace(
                /[.*+?^${}()|[\]\\]/g,
                '\\$&'
            );

        const companyRegex =
            new RegExp(
                `\\b${escapedCompany}\\b`,
                'i'
            );

        if (
            companyRegex.test(
                query
            )
        ) {

            return company;
        }
    }

    return query.trim();
}

function getDateDaysAgo(
    days
) {

    const date =
        new Date();

    date.setDate(
        date.getDate() -
        days
    );

    return date
        .toISOString()
        .split(
            'T'
        )[0];
}

// SESSION MANAGEMENT
function getSession(
    sessionId
) {

    if (
        !sessions.has(
            sessionId
        )
    ) {

        sessions.set(
            sessionId,
            {
                conversationId:
                    null,

                lastQuery:
                    null,

                lastResponse:
                    null,

                lastAnalysisId:
                    null,

                uploadedFiles:
                    [],

                created:
                    new Date(),

                lastActivity:
                    Date.now(),

                hasRealData:
                    false
            }
        );
    }

    const session =
        sessions.get(
            sessionId
        );

    session.lastActivity =
        Date.now();

    return session;
}

async function getOrCreateConversation(
    sessionId,
    session
) {

    if (
        session.conversationId
    ) {

        return session
            .conversationId;
    }

    const conversation =
        await openai
            .conversations
            .create({
                metadata: {
                    session_id:
                        sessionId
                }
            });

    session.conversationId =
        conversation.id;

    sessions.set(
        sessionId,
        session
    );

    console.log(
        '✅ OpenAI Conversation created:',
        conversation.id
    );

    return conversation.id;
}

// QUERY EXTRACTION
function extractCleanQuery(
    userMessage
) {

    const message =
        userMessage
            .toLowerCase()
            .trim();

    const prefixes = [
        'i want to know about ',
        'tell me about ',
        'analyze ',
        'research ',
        'give me insights on ',
        'what about ',
        'how about '
    ];

    let cleanQuery =
        userMessage.trim();

    for (
        const prefix of prefixes
    ) {

        if (
            message.startsWith(
                prefix
            )
        ) {

            cleanQuery =
                userMessage
                    .substring(
                        prefix.length
                    )
                    .trim();

            break;
        }
    }

    if (
        cleanQuery.length > 0
    ) {

        const lowerQuery =
            cleanQuery.toLowerCase();

        if (
            lowerQuery ===
                'grocery chains' ||
            lowerQuery ===
                'grocery stores'
        ) {

            cleanQuery =
                'Grocery Chains';

        } else if (
            lowerQuery ===
                'coffee chains' ||
            lowerQuery ===
                'coffee shops'
        ) {

            cleanQuery =
                'Coffee Chains';

        } else if (
            lowerQuery ===
                'fast food' ||
            lowerQuery ===
                'fast food restaurants'
        ) {

            cleanQuery =
                'Fast Food Industry';

        } else {

            cleanQuery =
                cleanQuery
                    .charAt(
                        0
                    )
                    .toUpperCase() +
                cleanQuery.slice(
                    1
                );

            const companyMappings = {
                'tesla':
                    'Tesla',

                'starbucks':
                    'Starbucks',

                'amazon':
                    'Amazon',

                'apple':
                    'Apple',

                'google':
                    'Google',

                'microsoft':
                    'Microsoft',

                'nike':
                    'Nike',

                'walmart':
                    'Walmart',

                'bmw':
                    'BMW',

                'mercedes':
                    'Mercedes',

                'toyota':
                    'Toyota'
            };

            for (
                const [
                    key,
                    value
                ] of Object.entries(
                    companyMappings
                )
            ) {

                if (
                    cleanQuery
                        .toLowerCase()
                        .includes(
                            key
                        )
                ) {

                    cleanQuery =
                        value;

                    break;
                }
            }
        }
    }

    console.log(
        'Enhanced query extraction: "' +
        userMessage +
        '" → "' +
        cleanQuery +
        '"'
    );

    return cleanQuery;
}

// COMPANY BACKGROUND
function getCompanyBackground(
    query
) {

    const companyInfo = {
        'tesla': {
            name:
                'Tesla Inc.',

            description:
                'Tesla is an American electric vehicle and clean energy company. Founded in 2003.',

            industry:
                'Automotive / Electric Vehicles',

            founded:
                '2003',

            headquarters:
                'Texas, USA'
        },

        'starbucks': {
            name:
                'Starbucks Corporation',

            description:
                'Starbucks is an American multinational coffeehouse company.',

            industry:
                'Food Service / Coffee & Beverages',

            founded:
                '1971',

            headquarters:
                'Seattle, USA'
        },

        'amazon': {
            name:
                'Amazon.com Inc.',

            description:
                'Amazon is an American multinational technology company focusing on e-commerce, cloud computing, digital streaming, and artificial intelligence.',

            industry:
                'Technology / E-commerce',

            founded:
                '1994',

            headquarters:
                'Washington, USA'
        },

        'bmw': {
            name:
                'BMW Group',

            description:
                'BMW is a German multinational manufacturer of luxury vehicles and motorcycles.',

            industry:
                'Automotive / Luxury Vehicles',

            founded:
                '1916',

            headquarters:
                'Munich, Germany'
        }
    };

    const searchKey =
        query
            .toLowerCase()
            .trim();

    if (
        companyInfo[
            searchKey
        ]
    ) {

        return companyInfo[
            searchKey
        ];
    }

    return {
        name:
            query,

        description:
            query +
            ' is being analyzed using current Reddit and NewsAPI evidence.',

        analysis_scope:
            'Current market intelligence'
    };
}

// FILE PROCESSING FUNCTIONS
async function readFileContent(
    filePath,
    fileType,
    fileName
) {

    console.log(
        'Reading file with enhanced processing:',
        fileName
    );

    try {

        let fileContent =
            '';

        let processingMethod =
            '';

        if (
            fileType ===
            'application/pdf'
        ) {

            try {

                const dataBuffer =
                    fs.readFileSync(
                        filePath
                    );

                const pdfData =
                    await pdf(
                        dataBuffer
                    );

                fileContent =
                    pdfData
                        .text
                        .substring(
                            0,
                            15000
                        );

                processingMethod =
                    'PDF text extraction';

            } catch (
                pdfError
            ) {

                console.log(
                    'PDF parsing error:',
                    pdfError.message
                );

                fileContent =
                    '[PDF could not be read - may be scanned/image-based or password-protected]';

                processingMethod =
                    'PDF parsing failed';
            }

        } else {

            try {

                fileContent =
                    fs
                        .readFileSync(
                            filePath,
                            'utf8'
                        )
                        .substring(
                            0,
                            15000
                        );

                processingMethod =
                    'Direct text reading';

            } catch (
                readError
            ) {

                console.log(
                    'Text file reading error:',
                    readError.message
                );

                fileContent =
                    '[File could not be read as text - may be binary or corrupted]';

                processingMethod =
                    'Text reading failed';
            }
        }

        return {
            content:
                fileContent,

            success:
                fileContent.length >
                50,

            processingMethod:
                processingMethod,

            fileSize:
                fs.statSync(
                    filePath
                ).size,

            originalName:
                fileName
        };

    } catch (error) {

        return {
            content:
                '[Error reading file: ' +
                error.message +
                ']',

            success:
                false,

            processingMethod:
                'error',

            error:
                error.message
        };
    }
}

// REPORT GENERATION
function generateTemplateReport(
    sessionData
) {

    const {
        lastQuery,
        lastResponse,
        timestamp,
        sessionId,
        hasRealData
    } =
        sessionData;

    if (
        !lastResponse
    ) {

        return (
            'INSIGHTEAR GPT\n\n' +
            'ERROR: NO ANALYSIS DATA FOUND\n'
        );
    }

    return (
        '===============================================================\n' +
        '                        INSIGHTEAR GPT\n' +
        '                  Market Research Report\n' +
        '===============================================================\n\n' +

        'TOPIC: ' +
        (
            lastQuery ||
            'Analysis Report'
        ) +
        '\n' +

        'GENERATED: ' +
        new Date(
            timestamp ||
            new Date()
        ).toLocaleString() +
        '\n\n' +

        lastResponse +
        '\n\n' +

        '===============================================================\n' +
        'DATA SOURCES: Reddit API + NewsAPI\n' +
        'REAL DATA FLAG: ' +
        (
            hasRealData
                ? 'YES'
                : 'NO'
        ) +
        '\n' +

        '===============================================================\n'
    );
}

// RESPONSES API PROCESSING
async function processWithAssistant(
    message,
    sessionId,
    session
) {

    try {

        console.log(
            '=== RESPONSES API PROCESSING ==='
        );

        console.log(
            'Processing message for session:',
            sessionId
        );

        const drilldownKeywords = [
            'show me',
            'what are',
            'breakdown',
            'themes',
            'posts',
            'articles',
            'headlines',
            'subreddit',
            'negative',
            'positive',
            'sentiment',
            'sources'
        ];

        const isDrilldown =
            drilldownKeywords.some(
                keyword =>
                    message
                        .toLowerCase()
                        .includes(
                            keyword
                        )
            );

        if (
            isDrilldown &&
            session.lastAnalysisId
        ) {

            console.log(
                '🔍 Detected drilldown query, processing...'
            );

            const drilldownResponse =
                await handleDrilldownQuery(
                    message,
                    sessionId
                );

            session.lastResponse =
                drilldownResponse;

            session.timestamp =
                new Date()
                    .toISOString();

            sessions.set(
                sessionId,
                session
            );

            return drilldownResponse;
        }

        const conversationId =
            await getOrCreateConversation(
                sessionId,
                session
            );

        console.log(
            'Using OpenAI Conversation:',
            conversationId
        );

        let usedRealData =
            false;

        let response =
            await openai
                .responses
                .create({
                    model:
                        process.env.OPENAI_MODEL ||
                        'gpt-4.1',

                    conversation:
                        conversationId,

                    instructions:
                        INSIGHTEAR_INSTRUCTIONS,

                    input:
                        message +
                        '\n\nSESSION_ID: ' +
                        sessionId,

                    max_output_tokens:
                        3000,

                    tools:
                        INSIGHTEAR_TOOLS
                });

        let toolRounds =
            0;

        const MAX_TOOL_ROUNDS =
            8;

        while (
            toolRounds <
            MAX_TOOL_ROUNDS
        ) {

            const functionCalls =
                response.output.filter(
                    item =>
                        item.type ===
                        'function_call'
                );

            if (
                functionCalls.length ===
                0
            ) {

                const assistantResponse =
                    response.output_text ||
                    'No response was generated. Please try again.';

                const cleanQuery =
                    extractCleanQuery(
                        message
                    );

                session.lastQuery =
                    cleanQuery;

                session.lastResponse =
                    assistantResponse;

                session.timestamp =
                    new Date()
                        .toISOString();

                if (
                    usedRealData
                ) {

                    session.hasRealData =
                        true;
                }

                sessions.set(
                    sessionId,
                    session
                );

                console.log(
                    '✅ Responses API analysis completed for:',
                    cleanQuery
                );

                return assistantResponse;
            }

            toolRounds++;

            console.log(
                `🔧 Processing ${functionCalls.length} tool call(s), round ${toolRounds}`
            );

            const toolOutputs =
                [];

            for (
                const call of functionCalls
            ) {

                try {

                    const args =
                        JSON.parse(
                            call.arguments
                        );

                    let output;

                    console.log(
                        'Processing function:',
                        call.name,
                        'Query:',
                        args.query
                    );

                    if (
                        call.name ===
                        'search_real_web_data'
                    ) {

                        output =
                            await handleWebSearch(
                                args.query
                            );

                        usedRealData =
                            true;

                    } else if (
                        call.name ===
                        'analyze_real_market_data'
                    ) {

                        output =
                            await handleRealMarketAnalysis(
                                args.query
                            );

                        usedRealData =
                            true;

                        try {

                            const analysisData =
                                JSON.parse(
                                    output
                                );

                            if (
                                analysisData.analysis_id
                            ) {

                                session.lastAnalysisId =
                                    analysisData
                                        .analysis_id;
                            }

                        } catch (
                            parseError
                        ) {

                            console.error(
                                'Could not extract analysis ID:',
                                parseError.message
                            );
                        }

                    } else if (
                        call.name ===
                        'get_company_background'
                    ) {

                        output =
                            JSON.stringify(
                                getCompanyBackground(
                                    args.query
                                )
                            );

                    } else {

                        output =
                            JSON.stringify({
                                error:
                                    'Unknown tool requested: ' +
                                    call.name
                            });
                    }

                    toolOutputs.push({
                        type:
                            'function_call_output',

                        call_id:
                            call.call_id,

                        output:
                            typeof output ===
                            'string'
                                ? output
                                : JSON.stringify(
                                    output
                                )
                    });

                } catch (
                    toolError
                ) {

                    console.error(
                        'Tool execution error:',
                        toolError
                    );

                    toolOutputs.push({
                        type:
                            'function_call_output',

                        call_id:
                            call.call_id,

                        output:
                            JSON.stringify({
                                success:
                                    false,

                                error:
                                    toolError.message
                            })
                    });
                }
            }

            response =
                await openai
                    .responses
                    .create({
                        model:
                            process.env.OPENAI_MODEL ||
                            'gpt-4.1',

                        conversation:
                            conversationId,

                        instructions:
                            INSIGHTEAR_INSTRUCTIONS,

                        input:
                            toolOutputs,

                        max_output_tokens:
                            3000,

                        tools:
                            INSIGHTEAR_TOOLS
                    });
        }

        return (
            'InsightEar reached the maximum number of research steps. Please try your question again.'
        );

    } catch (error) {

        console.error(
            'Responses API processing error:',
            error
        );

        return (
            'Technical difficulties processing your request. Error: ' +
            error.message
        );
    }
}

// ROUTES
app.get(
    '/favicon.ico',
    (
        req,
        res
    ) => {

        res
            .status(
                204
            )
            .send();
    }
);

app.get(
    '/health',
    (
        req,
        res
    ) => {

        res
            .status(
                200
            )
            .json({
                status:
                    'healthy',

                timestamp:
                    new Date()
                        .toISOString(),

                version:
                    'InsightEar GPT - Responses API',

                sessions_active:
                    sessions.size,

                research_cache:
                    researchCache.size,

                uptime_seconds:
                    Math.round(
                        process.uptime()
                    ),

                memory_mb:
                    Math.round(
                        process
                            .memoryUsage()
                            .rss /
                        1024 /
                        1024
                    ),

                real_apis: {
                    reddit:
                        !!API_CONFIG
                            .reddit
                            .clientId,

                    news:
                        !!API_CONFIG
                            .newsApi
                            .key,

                    openai:
                        !!process
                            .env
                            .OPENAI_API_KEY
                }
            });
    }
);

app.get(
    '/test',
    (
        req,
        res
    ) => {

        res.json({
            message:
                'InsightEar GPT Server is working!',

            timestamp:
                new Date()
                    .toISOString()
        });
    }
);

// CHAT ENDPOINT
app.post(
    '/chat',
    upload.array(
        'files',
        10
    ),
    async (
        req,
        res
    ) => {

        try {

            const userMessage =
                req.body.message ||
                '';

            const sessionId =
                req.headers[
                    'x-session-id'
                ] ||
                (
                    'session-' +
                    Date.now() +
                    '-' +
                    Math
                        .random()
                        .toString(36)
                        .substr(
                            2,
                            9
                        )
                );

            const uploadedFiles =
                req.files ||
                [];

            const session =
                getSession(
                    sessionId
                );

            if (
                uploadedFiles.length >
                0
            ) {

                for (
                    const file of uploadedFiles
                ) {

                    session
                        .uploadedFiles
                        .push({
                            originalName:
                                file.originalname,

                            path:
                                file.path,

                            size:
                                file.size,

                            mimetype:
                                file.mimetype,

                            uploadedAt:
                                new Date()
                                    .toISOString()
                        });
                }

                if (
                    !userMessage ||
                    userMessage
                        .trim()
                        .length ===
                        0
                ) {

                    const file =
                        uploadedFiles[0];

                    const fileResult =
                        await readFileContent(
                            file.path,
                            file.mimetype,
                            file.originalname
                        );

                    let analysisPrompt =
                        'Please analyze this document: ' +
                        file.originalname +
                        '\n\n';

                    if (
                        fileResult.success
                    ) {

                        analysisPrompt +=
                            'CONTENT:\n' +
                            fileResult.content;

                    } else {

                        analysisPrompt +=
                            'File processing failed.';
                    }

                    const response =
                        await processWithAssistant(
                            analysisPrompt,
                            sessionId,
                            session
                        );

                    return res.json({
                        response:
                            response,

                        sessionId:
                            sessionId,

                        filesAnalyzed: [
                            file.originalname
                        ],

                        hasRealData:
                            session.hasRealData,

                        drilldownAvailable:
                            !!session.lastAnalysisId
                    });
                }
            }

            const pdfTerms = [
                'generate pdf',
                'create pdf',
                'pdf report',
                'download report'
            ];

            const isPdfRequest =
                pdfTerms.some(
                    term =>
                        userMessage
                            .toLowerCase()
                            .includes(
                                term
                            )
                );

            if (
                isPdfRequest
            ) {

                if (
                    session.lastResponse &&
                    session.lastQuery
                ) {

                    return res.json({
                        response:
                            `✅ **Report Generated**\n\n` +
                            `**📥 [Download Report](/download-pdf/${sessionId})**`,

                        sessionId:
                            sessionId,

                        pdfReady:
                            true,

                        hasRealData:
                            session.hasRealData,

                        drilldownAvailable:
                            !!session.lastAnalysisId
                    });

                } else {

                    return res.json({
                        response:
                            'No recent analysis found. Please analyze a topic first.',

                        sessionId:
                            sessionId
                    });
                }
            }

            const greetings = [
                'hi',
                'hello',
                'hey',
                'test'
            ];

            if (
                greetings.includes(
                    userMessage
                        .toLowerCase()
                        .trim()
                )
            ) {

                return res.json({
                    response:
                        `Hello! I am **InsightEar**.\n\n` +
                        `Ask me to analyze customer sentiment, Reddit discussions, news coverage, market themes, or an emerging topic.`,

                    sessionId:
                        sessionId,

                    hasRealData:
                        false
                });
            }

            console.log(
                '🔍 Starting Responses API market analysis...'
            );

            const response =
                await processWithAssistant(
                    userMessage,
                    sessionId,
                    session
                );

            return res.json({
                response:
                    response,

                sessionId:
                    sessionId,

                hasRealData:
                    session.hasRealData,

                drilldownAvailable:
                    !!session.lastAnalysisId,

                analysisType:
                    'responses_api_market_intelligence'
            });

        } catch (error) {

            console.error(
                'Chat error:',
                error
            );

            return res.json({
                response:
                    'Technical difficulties processing request: ' +
                    error.message,

                sessionId:
                    req.headers[
                        'x-session-id'
                    ] ||
                    'error-session',

                hasRealData:
                    false
            });
        }
    }
);

// REPORT DOWNLOAD
app.get(
    '/download-pdf/:sessionId',
    (
        req,
        res
    ) => {

        const sessionId =
            req.params.sessionId;

        const session =
            sessions.get(
                sessionId
            );

        if (
            !session ||
            !session.lastResponse
        ) {

            return res
                .status(
                    404
                )
                .send(
                    'Session not found or no analysis data available.'
                );
        }

        try {

            const reportContent =
                generateTemplateReport(
                    session
                );

            const safeQuery =
                (
                    session.lastQuery ||
                    'report'
                )
                    .replace(
                        /[^a-z0-9]/gi,
                        '-'
                    )
                    .toLowerCase();

            const fileName =
                'insightear-report-' +
                safeQuery +
                '.txt';

            res.setHeader(
                'Content-Type',
                'text/plain; charset=utf-8'
            );

            res.setHeader(
                'Content-Disposition',
                'attachment; filename="' +
                fileName +
                '"'
            );

            res.send(
                reportContent
            );

        } catch (error) {

            console.error(
                'Report generation error:',
                error
            );

            res
                .status(
                    500
                )
                .send(
                    'Report generation failed: ' +
                    error.message
                );
        }
    }
);

// SESSION DEBUG
app.get(
    '/sessions',
    (
        req,
        res
    ) => {

        const sessionList =
            Array.from(
                sessions.entries()
            ).map(
                ([
                    id,
                    data
                ]) => ({
                    sessionId:
                        id,

                    hasQuery:
                        !!data.lastQuery,

                    hasResponse:
                        !!data.lastResponse,

                    hasAnalysisId:
                        !!data.lastAnalysisId,

                    hasRealData:
                        data.hasRealData,

                    created:
                        data.created,

                    lastActivity:
                        new Date(
                            data.lastActivity
                        ).toLocaleString()
                })
            );

        const cacheList =
            Array.from(
                researchCache.entries()
            ).map(
                ([
                    id,
                    data
                ]) => ({
                    analysisId:
                        id,

                    company:
                        data.company,

                    hasRealData:
                        data.has_real_data,

                    timestamp:
                        data.timestamp
                })
            );

        res.json({
            totalSessions:
                sessions.size,

            totalCached:
                researchCache.size,

            sessions:
                sessionList,

            researchCache:
                cacheList
        });
    }
);

// MAIN PAGE
app.get(
    '/',
    (
        req,
        res
    ) => {

        const mainHTML =
            `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0"
    >

    <title>
        InsightEar
    </title>

    <style>
        body {
            font-family:
                -apple-system,
                BlinkMacSystemFont,
                "Segoe UI",
                Roboto,
                sans-serif;

            background:
                linear-gradient(
                    135deg,
                    #667eea 0%,
                    #764ba2 100%
                );

            min-height:
                100vh;

            display:
                flex;

            align-items:
                center;

            justify-content:
                center;

            margin:
                0;

            padding:
                20px;
        }

        .chat-container {
            background:
                white;

            border-radius:
                20px;

            width:
                100%;

            max-width:
                900px;

            height:
                700px;

            display:
                flex;

            flex-direction:
                column;

            overflow:
                hidden;
        }

        .header {
            background:
                linear-gradient(
                    135deg,
                    #4f46e5,
                    #7c3aed
                );

            color:
                white;

            padding:
                25px;

            text-align:
                center;
        }

        .messages {
            flex:
                1;

            padding:
                25px;

            overflow-y:
                auto;

            background:
                #f8fafc;
        }

        .message {
            margin-bottom:
                18px;

            padding:
                18px;

            border-radius:
                18px;

            max-width:
                85%;

            line-height:
                1.5;
        }

        .user-message {
            background:
                #4f46e5;

            color:
                white;

            margin-left:
                auto;
        }

        .assistant-message {
            background:
                white;

            border:
                1px solid #e2e8f0;
        }

        .input-container {
            padding:
                25px;

            background:
                white;

            border-top:
                1px solid #e2e8f0;
        }

        .input-group {
            display:
                flex;

            gap:
                12px;
        }

        .chat-input {
            flex:
                1;

            padding:
                18px;

            border:
                2px solid #e2e8f0;

            border-radius:
                25px;
        }

        .send-button {
            background:
                #4f46e5;

            color:
                white;

            border:
                none;

            border-radius:
                25px;

            padding:
                18px 28px;

            cursor:
                pointer;
        }

        .file-input {
            display:
                none;
        }

        .file-button {
            background:
                #10b981;

            color:
                white;

            border:
                none;

            border-radius:
                20px;

            padding:
                12px 18px;

            cursor:
                pointer;
        }
    </style>
</head>

<body>

<div class="chat-container">

    <div class="header">
        <h1>
            🔍 InsightEar
        </h1>

        <p>
            Market & Consumer Intelligence
        </p>
    </div>

    <div
        class="messages"
        id="chatMessages"
    >

        <div
            class="message assistant-message"
        >
            <strong>
                Welcome to InsightEar
            </strong>

            <br><br>

            Ask me about customer sentiment,
            Reddit discussions, market themes,
            current news, brands, products,
            or emerging concepts.
        </div>

    </div>

    <div class="input-container">

        <div class="input-group">

            <input
                type="file"
                id="fileInput"
                class="file-input"
                multiple
                accept=".pdf,.txt,.doc,.docx"
            >

            <button
                type="button"
                class="file-button"
                onclick="document.getElementById('fileInput').click()"
            >
                📎
            </button>

            <textarea
                id="messageInput"
                class="chat-input"
                placeholder="Ask InsightEar..."
            ></textarea>

            <button
                id="sendButton"
                class="send-button"
            >
                Send
            </button>

        </div>

    </div>

</div>

<script>

const messageInput =
    document.getElementById(
        "messageInput"
    );

const sendButton =
    document.getElementById(
        "sendButton"
    );

const chatMessages =
    document.getElementById(
        "chatMessages"
    );

const fileInput =
    document.getElementById(
        "fileInput"
    );

let sessionId =
    "session-" +
    Date.now() +
    "-" +
    Math
        .random()
        .toString(36)
        .substr(
            2,
            9
        );

sendButton.addEventListener(
    "click",
    sendMessage
);

messageInput.addEventListener(
    "keydown",
    function (e) {

        if (
            e.key ===
                "Enter" &&
            !e.shiftKey
        ) {

            e.preventDefault();

            sendMessage();
        }
    }
);

async function sendMessage() {

    const message =
        messageInput.value.trim();

    const files =
        fileInput.files;

    if (
        !message &&
        files.length ===
        0
    ) {
        return;
    }

    if (
        message
    ) {

        addMessage(
            message,
            "user"
        );
    }

    const loadingMsg =
        addMessage(
            "🔍 Researching...",
            "assistant"
        );

    sendButton.disabled =
        true;

    try {

        const formData =
            new FormData();

        formData.append(
            "message",
            message
        );

        Array
            .from(
                files
            )
            .forEach(
                file =>
                    formData.append(
                        "files",
                        file
                    )
            );

        messageInput.value =
            "";

        fileInput.value =
            "";

        const response =
            await fetch(
                "/chat",
                {
                    method:
                        "POST",

                    headers: {
                        "X-Session-ID":
                            sessionId
                    },

                    body:
                        formData
                }
            );

        const data =
            await response.json();

        chatMessages.removeChild(
            loadingMsg
        );

        let responseText =
            data.response;

        if (
            data.drilldownAvailable
        ) {

            responseText +=
                "\\n\\n💎 **Drilldown available** — ask to see posts, articles, themes, or sentiment details.";
        }

        addMessage(
            responseText,
            "assistant"
        );

    } catch (error) {

        chatMessages.removeChild(
            loadingMsg
        );

        addMessage(
            "❌ Error: " +
            error.message,
            "assistant"
        );
    }

    sendButton.disabled =
        false;

    messageInput.focus();
}

function addMessage(
    content,
    sender
) {

    const messageDiv =
        document.createElement(
            "div"
        );

    messageDiv.className =
        "message " +
        sender +
        "-message";

    if (
        sender ===
        "assistant"
    ) {

        content =
            content
                .replace(
                    /\\*\\*(.*?)\\*\\*/g,
                    "<strong>$1</strong>"
                )
                .replace(
                    /\\n/g,
                    "<br>"
                )
                .replace(
                    /\\[([^\\]]+)\\]\\(([^)]+)\\)/g,
                    '<a href="$2" target="_blank">$1</a>'
                );
    }

    messageDiv.innerHTML =
        content;

    chatMessages.appendChild(
        messageDiv
    );

    chatMessages.scrollTop =
        chatMessages.scrollHeight;

    return messageDiv;
}

messageInput.focus();

</script>

</body>
</html>`;

        res.send(
            mainHTML
        );
    }
);

// Graceful shutdown
process.on(
    'SIGTERM',
    () => {

        console.log(
            'SIGTERM received'
        );

        server.close(
            () => {

                console.log(
                    '✅ Server closed gracefully'
                );

                process.exit(
                    0
                );
            }
        );
    }
);

process.on(
    'SIGINT',
    () => {

        console.log(
            'SIGINT received'
        );

        server.close(
            () => {

                console.log(
                    '✅ Server closed gracefully'
                );

                process.exit(
                    0
                );
            }
        );
    }
);

// Error handling
process.on(
    'uncaughtException',
    error => {

        console.error(
            'Uncaught Exception:',
            error
        );
    }
);

process.on(
    'unhandledRejection',
    (
        reason,
        promise
    ) => {

        console.error(
            'Unhandled Rejection:',
            promise,
            reason
        );
    }
);

// Start server
const server =
    app
        .listen(
            PORT,
            '0.0.0.0',
            () => {

                console.log(
                    '🚀 InsightEar Server Started'
                );

                console.log(
                    'Port:',
                    PORT
                );

                console.log(
                    '📱 Reddit:',
                    API_CONFIG
                        .reddit
                        .clientId
                        ? '✅ Ready'
                        : '❌ Missing'
                );

                console.log(
                    '📰 NewsAPI:',
                    API_CONFIG
                        .newsApi
                        .key
                        ? '✅ Ready'
                        : '❌ Missing'
                );

                console.log(
                    '🤖 OpenAI:',
                    process.env
                        .OPENAI_API_KEY
                        ? '✅ Ready'
                        : '❌ Missing'
                );
            }
        )
        .on(
            'error',
            error => {

                console.error(
                    '❌ Server startup error:',
                    error
                );

                process.exit(
                    1
                );
            }
        );

// Cleanup sessions/cache every 5 minutes
setInterval(
    () => {

        const oneHourAgo =
            Date.now() -
            (
                60 *
                60 *
                1000
            );

        let cleanedSessions =
            0;

        let cleanedCache =
            0;

        for (
            const [
                sessionId,
                session
            ] of sessions.entries()
        ) {

            if (
                session.lastActivity <
                oneHourAgo
            ) {

                sessions.delete(
                    sessionId
                );

                cleanedSessions++;
            }
        }

        for (
            const [
                analysisId,
                analysis
            ] of researchCache.entries()
        ) {

            const analysisTime =
                new Date(
                    analysis.timestamp
                ).getTime();

            if (
                analysisTime <
                oneHourAgo
            ) {

                researchCache.delete(
                    analysisId
                );

                cleanedCache++;
            }
        }

        if (
            cleanedSessions >
                0 ||
            cleanedCache >
                0
        ) {

            console.log(
                `🧹 Cleanup - Removed ${cleanedSessions} old sessions, ${cleanedCache} old cache entries`
            );
        }

    },
    5 *
    60 *
    1000
);

// Export app for testing
module.exports = app;
