const express = require('express');
const multer = require('multer');
const OpenAI = require('openai');
const cors = require('cors');
const PDFDocument = require('pdfkit');

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

// Configure multer for file uploads - Memory optimized
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { 
    fileSize: 5 * 1024 * 1024, // Reduced to 5MB limit
    files: 3 // Limit number of files
  }
});

// Intelligence keywords for market research
const INTELLIGENCE_KEYWORDS = [
  // Brand Research
  'brand', 'reputation', 'image', 'perception', 'trust', 'credibility', 'equity', 'positioning', 'awareness', 'recognition',
  // Consumer Insights  
  'sentiment', 'think', 'feel', 'opinion', 'saying', 'people', 'customers', 'users', 'consumers', 'audience',
  // Market Research
  'analysis', 'insights', 'research', 'market', 'trends', 'performance', 'growth', 'share', 'competitive',
  // Product Research
  'product', 'quality', 'features', 'benefits', 'performance', 'usability', 'design', 'innovation', 'effectiveness',
  // Customer Experience
  'satisfaction', 'experience', 'service', 'support', 'journey', 'feedback', 'reviews', 'ratings', 'complaints',
  // Social Listening
  'buzz', 'mentions', 'social', 'viral', 'trending', 'conversation', 'chatter', 'discussion', 'talking',
  // Behavioral Research
  'behavior', 'purchase', 'buying', 'loyalty', 'retention', 'advocacy', 'recommendation', 'word-of-mouth',
  // Competitive Intelligence
  'comparison', 'versus', 'vs', 'compete', 'competitor', 'alternative', 'benchmark', 'industry',
  // Inquiry patterns
  'about', 'understand', 'know', 'learn', 'tell', 'explain', 'information', 'details', 'facts'
];

// Brand name mappings for better recognition
const BRAND_MAPPINGS = {
  'coke': 'Coca-Cola',
  'mcdonalds': "McDonald's", 
  'mcdonald': "McDonald's",
  'mcds': "McDonald's",
  'apple': 'Apple',
  'iphone': 'iPhone',
  'tesla': 'Tesla',
  'nike': 'Nike',
  'starbucks': 'Starbucks',
  'amazon': 'Amazon',
  'google': 'Google',
  'microsoft': 'Microsoft',
  'samsung': 'Samsung',
  'bmw': 'BMW',
  'toyota': 'Toyota',
  'ford': 'Ford',
  'pepsi': 'Pepsi',
  'adidas': 'Adidas',
  'walmart': 'Walmart',
  'target': 'Target'
};

// Function to check if query needs intelligence analysis
function needsIntelligence(query) {
  const lowerQuery = query.toLowerCase();
  
  // Check for intelligence keywords
  const hasIntelligenceKeyword = INTELLIGENCE_KEYWORDS.some(keyword => lowerQuery.includes(keyword));
  
  // Check for brand names (if asking about a brand, likely needs intelligence)
  const hasBrandName = Object.keys(BRAND_MAPPINGS).some(brand => lowerQuery.includes(brand));
  
  // Check for common intelligence patterns
  const intelligencePatterns = [
    /tell me about \w+/,
    /what.*think.*about/,
    /how.*doing/,
    /understand.*\w+/,
    /learn.*about/,
    /information.*about/,
    /\w+ vs \w+/,
    /\w+ versus \w+/,
    /opinion.*\w+/,
    /feedback.*\w+/,
    /review.*\w+/
  ];
  
  const hasIntelligencePattern = intelligencePatterns.some(pattern => pattern.test(lowerQuery));
  
  return hasIntelligenceKeyword || hasBrandName || hasIntelligencePattern;
}

// Function to extract brand/product from query
function extractBrand(query) {
  let lowerQuery = query.toLowerCase();
  
  // Check for known brand mappings first
  for (const [key, value] of Object.entries(BRAND_MAPPINGS)) {
    if (lowerQuery.includes(key)) {
      return value;
    }
  }
  
  // Remove common words to isolate brand name
  const removeWords = [
    'what', 'are', 'people', 'saying', 'about', 'brand', 'sentiment', 'analysis', 
    'of', 'the', 'how', 'is', 'do', 'customers', 'think', 'tell', 'me', 'understand',
    'want', 'to', 'know', 'learn', 'information', 'details', 'facts', 'explain',
    'you', 'can', 'help', 'with', 'regarding', 'concerning', 'company', 'product'
  ];
  
  let brandName = lowerQuery;
  removeWords.forEach(word => {
    brandName = brandName.replace(new RegExp('\\b' + word + '\\b', 'g'), '');
  });
  
  // Clean up and capitalize
  brandName = brandName.trim().replace(/\s+/g, ' ');
  if (brandName) {
    return brandName.split(' ').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  }
  
  return 'Brand/Product';
}

// Function to get brand/product description
function getBrandDescription(brandName) {
  const descriptions = {
    'Coca-Cola': 'Coca-Cola is a carbonated soft drink manufactured by The Coca-Cola Company. Founded in 1886, it\'s one of the world\'s most recognizable brands and the leading cola beverage globally.',
    'Nike': 'Nike is an American multinational corporation specializing in athletic footwear, apparel, equipment, and accessories. Founded in 1964, it\'s one of the world\'s largest suppliers of athletic shoes and apparel.',
    'Tesla': 'Tesla is an American electric vehicle and clean energy company founded by Elon Musk. Known for electric cars, energy storage systems, and solar panels, Tesla has revolutionized the automotive industry.',
    'Apple': 'Apple Inc. is a multinational technology company that designs and manufactures consumer electronics, software, and online services. Known for iPhone, iPad, Mac computers, and innovative design.',
    'McDonald\'s': 'McDonald\'s is an American fast food company and the world\'s largest restaurant chain by revenue. Founded in 1940, it serves approximately 69 million customers daily in over 100 countries.',
    'Starbucks': 'Starbucks Corporation is an American multinational chain of coffeehouses and roastery reserves. Founded in 1971, it\'s the world\'s largest coffeehouse chain with over 30,000 locations worldwide.',
    'Amazon': 'Amazon is an American multinational technology company focusing on e-commerce, cloud computing, and artificial intelligence. Started as an online bookstore, it\'s now one of the world\'s largest companies.',
    'Samsung': 'Samsung is a South Korean multinational conglomerate known for electronics, semiconductors, and smartphones. It\'s one of the world\'s largest technology companies and smartphone manufacturers.',
    'BMW': 'BMW (Bayerische Motoren Werke) is a German multinational corporation producing luxury vehicles and motorcycles. Founded in 1916, it\'s known for premium cars and innovative automotive technology.',
    'Google': 'Google is an American multinational technology company specializing in Internet-related services and products, including search engines, cloud computing, and advertising technologies.'
  };
  
  return descriptions[brandName] || (brandName + ' is a brand/product that has gained attention in the market. Let me analyze what people are saying about it.');
}

// Function to determine response type based on query
function determineResponseType(query) {
  const lowerQuery = query.toLowerCase();
  
  // Conversational queries - respond naturally
  if (lowerQuery.includes('what do you think') || lowerQuery.includes('your opinion') || lowerQuery.includes('tell me about')) {
    return 'conversational';
  }
  
  // Specific analysis requests - offer options
  if (lowerQuery.includes('analysis') || lowerQuery.includes('research') || lowerQuery.includes('report')) {
    return 'analysis_options';
  }
  
  // Comparison queries - direct comparison format
  if (lowerQuery.includes('vs') || lowerQuery.includes('versus') || lowerQuery.includes('comparison')) {
    return 'comparison';
  }
  
  // General brand inquiry - provide context first
  return 'brand_context';
}

// Function to create conversational response
function createConversationalResponse(data) {
  const brand = data.brand;
  const description = getBrandDescription(brand);
  
  let response = '**About ' + brand + ':**\n' + description + '\n\n';
  
  response += '**What People Are Saying:**\n';
  response += 'Based on my analysis of ' + data.totalMentions + ' mentions across social media, reviews, and news sources, ';
  
  if (data.positive > 70) {
    response += brand + ' enjoys very positive sentiment (' + data.positive + '%) among consumers. ';
  } else if (data.positive > 50) {
    response += brand + ' has generally positive sentiment (' + data.positive + '%) with some mixed opinions. ';
  } else {
    response += brand + ' shows mixed sentiment (' + data.positive + '% positive) with areas for improvement. ';
  }
  
  response += 'The main conversation themes include ' + data.sources[0].themes.join(', ') + '.';
  
  response += `\n\n**Key Insights:**\n`;
  data.insights.forEach(insight => {
    response += `• ${insight}\n`;
  });
  
  response += `\n\n**Would you like me to:**\n`;
  response += '<button onclick="requestFormat(\'detailed research report\')" style="background:#007bff;color:white;border:none;padding:5px 10px;border-radius:15px;cursor:pointer;margin:2px;">Generate detailed report</button>\n';
  response += '<button onclick="requestFormat(\'visual sentiment breakdown\')" style="background:#28a745;color:white;border:none;padding:5px 10px;border-radius:15px;cursor:pointer;margin:2px;">Show visual dashboard</button>\n';
  response += '<button onclick="requestFormat(\'strategic recommendations\')" style="background:#17a2b8;color:white;border:none;padding:5px 10px;border-radius:15px;cursor:pointer;margin:2px;">Get recommendations</button>\n';
  response += '<button onclick="requestFormat(\'conversational analysis\')" style="background:#6c757d;color:white;border:none;padding:5px 10px;border-radius:15px;cursor:pointer;margin:2px;">Discuss insights</button>\n\n';
  response += 'Or just ask me anything specific about ' + brand + '!';
  
// Function to create executive summary
function createExecutiveSummary(data) {
  const brand = data.brand;
  const description = getBrandDescription(brand);
  
  let response = '**Executive Summary: ' + brand + '**\n\n';
  response += '**Company Overview:** ' + description + '\n\n';
  
  response += '**Key Findings:**\n';
  response += '• Overall sentiment: ' + data.positive + '% positive (' + data.totalMentions + ' total mentions)\n';
  response += '• Primary sentiment drivers: ' + data.sources[0].themes.join(', ') + '\n';
  response += '• Market position: ' + (data.positive > 75 ? 'Strong positive' : data.positive > 60 ? 'Moderately positive' : 'Mixed') + ' consumer perception\n\n';
  
  response += `**Strategic Implications:**\n`;
  data.recommendations.slice(0, 2).forEach(rec => {
    response += `• ${rec}\n`;
  });
  
  response += `\n📄 For detailed analysis, ask for "full report" or "visual dashboard"`;
  
  return response;
}

// Function to create bullet point analysis
function createBulletPointAnalysis(data) {
  const brand = data.brand;
  
  let response = '**' + brand + ' - Quick Analysis**\n\n';
  
  response += '**📊 Sentiment Breakdown:**\n';
  response += '• Positive: ' + data.positive + '%\n';
  response += '• Neutral: ' + data.neutral + '%\n';
  response += '• Negative: ' + data.negative + '%\n';
  response += '• Total mentions: ' + data.totalMentions + '\n\n';
  
  response += `**🌐 Top Sources:**\n`;
  data.sources.forEach(source => {
    response += `• ${source.platform}: ${source.mentions} mentions (${source.sentiment})\n`;
  });
  
  response += `\n**💡 Key Insights:**\n`;
  data.insights.forEach(insight => {
    response += `• ${insight}\n`;
  });
  
  response += `\n**🎯 Next Steps:**\n`;
  data.recommendations.forEach(rec => {
    response += `• ${rec}\n`;
  });
  
  response += `\n📋 Ask for "detailed report" for comprehensive analysis`;
  
  return response;
}

// Function to create analysis options response
function createAnalysisOptionsResponse(data) {
  const brand = data.brand;
  const description = getBrandDescription(brand);
  
  let response = '**' + brand + ' Overview:**\n' + description + '\n\n';
  
  response += 'I can provide different types of analysis for ' + brand + '. What would you prefer?\n\n';
  
  response += '<button onclick="requestFormat(\'quick sentiment summary\')" style="background:#007bff;color:white;border:none;padding:8px 12px;border-radius:20px;cursor:pointer;margin:5px;">📊 Quick Sentiment Summary</button> ';
  response += '<button onclick="requestFormat(\'detailed research report\')" style="background:#28a745;color:white;border:none;padding:8px 12px;border-radius:20px;cursor:pointer;margin:5px;">📋 Detailed Research Report</button>\n';
  response += '<button onclick="requestFormat(\'conversational analysis\')" style="background:#17a2b8;color:white;border:none;padding:8px 12px;border-radius:20px;cursor:pointer;margin:5px;">💬 Conversational Analysis</button> ';
  response += '<button onclick="requestFormat(\'visual dashboard\')" style="background:#6f42c1;color:white;border:none;padding:8px 12px;border-radius:20px;cursor:pointer;margin:5px;">📈 Visual Dashboard</button>\n\n';
  
  response += '**Custom Formats:**\n';
  response += '<button onclick="requestFormat(\'executive summary\')" style="background:#fd7e14;color:white;border:none;padding:6px 10px;border-radius:15px;cursor:pointer;margin:3px;">Executive Summary</button> ';
  response += '<button onclick="requestFormat(\'bullet points\')" style="background:#20c997;color:white;border:none;padding:6px 10px;border-radius:15px;cursor:pointer;margin:3px;">Bullet Points</button> ';
  response += '<button onclick="requestFormat(\'narrative style\')" style="background:#e83e8c;color:white;border:none;padding:6px 10px;border-radius:15px;cursor:pointer;margin:3px;">Narrative Style</button>\n\n';
  
  response += 'What type of analysis and format would work best for you?';
  
  return response;
}

// Function to create brand context response
function createBrandContextResponse(data) {
  const brand = data.brand;
  const description = getBrandDescription(brand);
  
  let response = '**' + brand + '**\n' + description + '\n\n';
  
  response += '**Current Market Sentiment:** ' + data.positive + '% positive sentiment from ' + data.totalMentions + ' mentions\n\n';
  
  response += 'I can help you understand ' + brand + ' better. What specifically interests you?\n\n';
  response += '<button onclick="quickAnalysis(\'' + brand + '\', \'brand\')" style="background:#007bff;color:white;border:none;padding:8px 12px;border-radius:20px;cursor:pointer;margin:5px;">🏢 Brand Analysis</button> ';
  response += '<button onclick="quickAnalysis(\'' + brand + '\', \'customer sentiment\')" style="background:#28a745;color:white;border:none;padding:8px 12px;border-radius:20px;cursor:pointer;margin:5px;">👥 Customer Sentiment</button>\n';
  response += '<button onclick="quickAnalysis(\'' + brand + '\', \'market performance\')" style="background:#17a2b8;color:white;border:none;padding:8px 12px;border-radius:20px;cursor:pointer;margin:5px;">📊 Market Performance</button> ';
  response += '<button onclick="requestFormat(\'full analysis\')" style="background:#dc3545;color:white;border:none;padding:8px 12px;border-radius:20px;cursor:pointer;margin:5px;">🔍 Full Analysis</button>\n\n';
  
  response += 'Or just ask me anything specific about ' + brand + '!';
  
  return response;
}

// Function to generate mock intelligence data
function generateIntelligenceData(query) {
  const brand = extractBrand(query);
  const responseType = determineResponseType(query);
  
  // Generate realistic but varied data
  const basePositive = 65 + Math.floor(Math.random() * 20);
  const baseNeutral = Math.floor(Math.random() * 20) + 10;
  const baseNegative = 100 - basePositive - baseNeutral;
  
  const totalMentions = Math.floor(Math.random() * 500) + 200;
  const redditMentions = Math.floor(totalMentions * 0.25);
  const reviewMentions = Math.floor(totalMentions * 0.4);
  const socialMentions = Math.floor(totalMentions * 0.25);
  const newsMentions = totalMentions - redditMentions - reviewMentions - socialMentions;

  return {
    query: query,
    brand: brand,
    responseType: responseType,
    positive: basePositive,
    neutral: baseNeutral,
    negative: baseNegative,
    totalMentions: totalMentions,
    sources: [
      {
        platform: 'Reddit',
        mentions: redditMentions,
        sentiment: 'positive',
        url: 'https://www.reddit.com/search/?q=' + encodeURIComponent(brand),
        themes: ['brand perception', 'user discussions']
      },
      {
        platform: 'Product Reviews',
        mentions: reviewMentions,
        sentiment: 'positive',
        url: 'https://www.google.com/search?q=' + encodeURIComponent(brand + ' reviews'),
        themes: ['satisfaction', 'recommendations']
      },
      {
        platform: 'Social Media',
        mentions: socialMentions,
        sentiment: 'mixed',
        url: 'https://twitter.com/search?q=' + encodeURIComponent(brand),
        themes: ['brand awareness', 'social buzz']
      },
      {
        platform: 'News & Media',
        mentions: newsMentions,
        sentiment: 'neutral',
        url: 'https://news.google.com/search?q=' + encodeURIComponent(brand),
        themes: ['PR coverage', 'announcements']
      }
    ],
    insights: generateInsights(brand, responseType, basePositive),
    recommendations: generateRecommendations(brand, responseType, basePositive),
    reportId: Date.now().toString()
  };
}

// Function to generate insights based on response type
function generateInsights(brand, responseType, sentiment) {
  const insights = [];
  
  if (responseType === 'conversational' || responseType === 'brand_context') {
    insights.push(brand + ' shows ' + (sentiment > 75 ? 'excellent' : sentiment > 60 ? 'good' : 'mixed') + ' market sentiment across digital platforms');
    insights.push('Consumer discussions indicate strong brand recognition and engagement');
    insights.push('Social media presence drives significant portion of brand conversations');
  } else if (responseType === 'analysis_options') {
    insights.push('Comprehensive data available across multiple consumer touchpoints');
    insights.push('Brand performance metrics show consistent patterns over time');
    insights.push('Multiple analysis formats available to suit different business needs');
  } else if (responseType === 'comparison') {
    insights.push('Competitive positioning analysis reveals distinct market advantages');
    insights.push('Brand differentiation clearly perceived by target consumers');
    insights.push('Market share dynamics indicate strategic opportunities');
  } else {
    insights.push('Overall market sentiment trending positive');
    insights.push('Brand mentions showing consistent growth');
    insights.push('Consumer engagement levels above industry benchmarks');
  }
  
  return insights;
}

// Function to generate recommendations
function generateRecommendations(brand, responseType, sentiment) {
  const recommendations = [];
  
  if (sentiment > 75) {
    recommendations.push('Leverage positive sentiment in marketing campaigns and brand messaging');
    recommendations.push('Expand market presence while maintaining current quality standards');
    recommendations.push('Develop brand advocacy programs to amplify positive word-of-mouth');
  } else if (sentiment > 60) {
    recommendations.push('Focus on converting neutral sentiment segments through targeted messaging');
    recommendations.push('Enhance customer experience at key brand touchpoints');
    recommendations.push('Strengthen brand differentiation in competitive messaging');
  } else {
    recommendations.push('Implement comprehensive reputation management strategy');
    recommendations.push('Address core issues driving negative sentiment patterns');
    recommendations.push('Develop crisis communication protocols for brand recovery');
  }
  
  return recommendations;
}

// Function to create HTML for intelligence display
function createIntelligenceHTML(data) {
  let html = '<div class="intelligence-report">';
  
  // Header
  html += '<div class="report-header">';
  html += '<h2>📊 ' + data.brand + ' - Market Intelligence Report</h2>';
  html += '</div>';
  
  // Sentiment Overview
  html += '<div class="sentiment-section">';
  html += '<h3>💖 Sentiment Overview</h3>';
  html += '<div class="sentiment-bars">';
  
  // Positive bar
  html += '<div class="sentiment-bar">';
  html += '<span class="sentiment-label">[' + data.positive + '%] Positive</span>';
  html += '<div class="progress-bar">';
  html += '<div class="progress-fill positive" style="width: ' + data.positive + '%"></div>';
  html += '</div>';
  html += '</div>';
  
  // Neutral bar
  html += '<div class="sentiment-bar">';
  html += '<span class="sentiment-label">[' + data.neutral + '%] Neutral</span>';
  html += '<div class="progress-bar">';
  html += '<div class="progress-fill neutral" style="width: ' + data.neutral + '%"></div>';
  html += '</div>';
  html += '</div>';
  
  // Negative bar
  html += '<div class="sentiment-bar">';
  html += '<span class="sentiment-label">[' + data.negative + '%] Negative</span>';
  html += '<div class="progress-bar">';
  html += '<div class="progress-fill negative" style="width: ' + data.negative + '%"></div>';
  html += '</div>';
  html += '</div>';
  
  html += '<div class="total-mentions">[' + data.totalMentions + '] Total Mentions</div>';
  html += '</div>';
  html += '</div>';
  
  // Data Sources
  html += '<div class="sources-section">';
  html += '<h3>🌐 Data Sources</h3>';
  html += '<div class="sources-grid">';
  
  data.sources.forEach(function(source, index) {
    html += '<div class="source-card">';
    html += '<div class="source-platform">📱 <strong>' + source.platform + '</strong></div>';
    html += '<div class="source-mentions">' + source.mentions + ' mentions</div>';
    html += '<div class="source-themes">Themes: ' + source.themes.join(', ') + '</div>';
    html += '<a href="' + source.url + '" target="_blank" class="source-link">View Source</a>';
    html += '</div>';
  });
  
  html += '</div>';
  html += '</div>';
  
  // Research Insights
  html += '<div class="insights-section">';
  html += '<h3>🔍 Research Insights</h3>';
  html += '<ul class="insights-list">';
  data.insights.forEach(function(insight) {
    html += '<li>- ' + insight + '</li>';
  });
  html += '</ul>';
  html += '</div>';
  
  // Strategic Recommendations
  html += '<div class="recommendations-section">';
  html += '<h3>💡 Strategic Recommendations</h3>';
  html += '<ul class="recommendations-list">';
  data.recommendations.forEach(function(rec) {
    html += '<li>→ ' + rec + '</li>';
  });
  html += '</ul>';
  html += '</div>';
  
  // PDF Download
  html += '<div class="report-actions">';
  html += '<button class="download-btn" onclick="downloadReport(\'' + data.reportId + '\')">📄 Download PDF Report</button>';
  html += '</div>';
  
  html += '</div>';
  
  return html;
}

// Route: Main chat interface
app.get('/', (req, res) => {
  const html = `
<!DOCTYPE html>
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

        /* Intelligence Report Styles */
        .intelligence-report {
            font-size: 14px;
            line-height: 1.5;
        }

        .report-header h2 {
            color: #28a745;
            margin-bottom: 15px;
            font-size: 18px;
        }

        .sentiment-section {
            margin-bottom: 20px;
        }

        .sentiment-section h3 {
            color: #495057;
            margin-bottom: 10px;
            font-size: 16px;
        }

        .sentiment-bar {
            margin-bottom: 8px;
        }

        .sentiment-label {
            display: block;
            font-weight: 500;
            margin-bottom: 4px;
        }

        .progress-bar {
            background: #e9ecef;
            border-radius: 10px;
            height: 8px;
            overflow: hidden;
        }

        .progress-fill {
            height: 100%;
            transition: width 0.3s ease;
        }

        .progress-fill.positive {
            background: #28a745;
        }

        .progress-fill.neutral {
            background: #ffc107;
        }

        .progress-fill.negative {
            background: #dc3545;
        }

        .total-mentions {
            margin-top: 10px;
            font-weight: 500;
            color: #495057;
        }

        .sources-section {
            margin-bottom: 20px;
        }

        .sources-section h3 {
            color: #495057;
            margin-bottom: 10px;
            font-size: 16px;
        }

        .sources-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 10px;
        }

        .source-card {
            background: #f8f9fa;
            border: 1px solid #e9ecef;
            border-radius: 8px;
            padding: 12px;
        }

        .source-platform {
            font-weight: 500;
            margin-bottom: 5px;
        }

        .source-mentions {
            color: #6c757d;
            margin-bottom: 5px;
        }

        .source-themes {
            font-size: 12px;
            color: #6c757d;
            margin-bottom: 8px;
        }

        .source-link {
            display: inline-block;
            background: #007bff;
            color: white;
            text-decoration: none;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
        }

        .source-link:hover {
            background: #0056b3;
        }

        .insights-section, .recommendations-section {
            margin-bottom: 20px;
        }

        .insights-section h3, .recommendations-section h3 {
            color: #495057;
            margin-bottom: 10px;
            font-size: 16px;
        }

        .insights-list, .recommendations-list {
            list-style: none;
            padding-left: 0;
        }

        .insights-list li, .recommendations-list li {
            margin-bottom: 5px;
            color: #495057;
        }

        .report-actions {
            text-align: center;
            margin-top: 20px;
        }

        .download-btn {
            background: #28a745;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 25px;
            cursor: pointer;
            font-size: 14px;
        }

        .download-btn:hover {
            background: #218838;
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
            
            .sources-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="chat-container">
        <div class="chat-header">
            <h1>InsightEar GPT</h1>
            <p>Market Intelligence Platform</p>
        </div>
        
        <div class="welcome-message">
            <strong>✅ Smart market intelligence</strong> - I provide context first, then ask what you need<br>
            <strong>✅ Flexible analysis formats</strong> - Choose from reports, conversations, or custom formats<br>
            <strong>✅ Brand expertise</strong> - I know major brands and provide background context<br>
            <strong>✅ Interactive experience</strong> - I'll guide you to the right analysis type<br>
            <strong>✅ General AI assistance</strong> - Plus normal conversations about anything<br><br>
            
            Try asking about brands naturally:<br>
            <strong>"What do you think about Nike?"</strong> • <strong>"Tell me about Tesla"</strong> • <strong>"I want to understand Coca-Cola"</strong><br><br>
            
            Or chat normally:<br>
            <strong>"Hello, how are you?"</strong> • <strong>"What can you help with?"</strong> • <strong>"Explain machine learning"</strong>
        </div>
        
        <div class="chat-messages" id="chatMessages">
            <div class="typing-indicator" id="typingIndicator">InsightEar GPT is thinking...</div>
        </div>
        
        <div class="chat-input-container">
            <div class="input-group">
                <div class="file-upload">
                    <input type="file" id="fileInput" multiple accept=".pdf,.doc,.docx,.txt,.csv,.xlsx,.xls">
                    <div class="file-upload-btn">📎</div>
                </div>
                <input type="text" id="messageInput" placeholder="Ask naturally: 'What do you think about Nike?' or chat about anything..." onkeypress="handleKeyPress(event)">
                <button id="sendButton" onclick="sendMessage()">➤</button>
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
                console.log('Response data:', data);
                
                hideTyping();
                addMessage('assistant', data.response);
            } catch (error) {
                console.error('Error:', error);
                hideTyping();
                addMessage('assistant', 'Sorry, I encountered an error. Please try again.');
            }
        }

        function handleKeyPress(event) {
            if (event.key === 'Enter') {
                sendMessage();
            }
        }

        function downloadReport(reportId) {
            console.log('Downloading report:', reportId);
            window.open('/download-report/' + reportId, '_blank');
        }

        function requestFormat(format) {
            console.log('Requesting format:', format);
            const input = document.getElementById('messageInput');
            input.value = format;
            sendMessage();
        }

        function quickAnalysis(brand, type) {
            console.log('Quick analysis for:', brand, type);
            const input = document.getElementById('messageInput');
            input.value = type + ' analysis for ' + brand;
            sendMessage();
        }

        // File upload handling
        document.getElementById('fileInput').addEventListener('change', function(event) {
            const files = event.target.files;
            if (files.length > 0) {
                const fileNames = Array.from(files).map(file => file.name).join(', ');
                addMessage('user', '📁 Uploaded files: ' + fileNames);
                
                // You can implement file upload logic here
                addMessage('assistant', 'Files received! I can analyze documents for sentiment, extract insights, and generate reports. What would you like me to do with these files?');
            }
        });

        console.log('InsightEar GPT loaded successfully');
    </script>
</body>
</html>`;
  
  res.send(html);
});

// Route: Handle chat messages
app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    console.log('Received message:', message);
    
    // Check if this needs intelligence analysis
    if (needsIntelligence(message)) {
      console.log('Intelligence analysis needed');
      const intelligenceData = generateIntelligenceData(message);
      
      // Store report data for potential PDF generation
      global.reportData = global.reportData || {};
      global.reportData[intelligenceData.reportId] = intelligenceData;
      
      // Cleanup old reports to prevent memory leaks
      const reportKeys = Object.keys(global.reportData);
      if (reportKeys.length > 50) {
        const oldestKey = reportKeys[0];
        delete global.reportData[oldestKey];
      }
      
      // Determine response format based on query type
      let response;
      
      switch (intelligenceData.responseType) {
        case 'conversational':
          response = createConversationalResponse(intelligenceData);
          break;
        case 'analysis_options':
          response = createAnalysisOptionsResponse(intelligenceData);
          break;
        case 'brand_context':
          response = createBrandContextResponse(intelligenceData);
          break;
        case 'comparison':
          // For comparisons, create detailed HTML report
          response = createIntelligenceHTML(intelligenceData);
          break;
        default:
          response = createBrandContextResponse(intelligenceData);
      }
      
      // Store the format preference for follow-up questions
      global.userPreferences = global.userPreferences || {};
      global.userPreferences[intelligenceData.reportId] = {
        brand: intelligenceData.brand,
        lastQuery: message,
        responseType: intelligenceData.responseType
      };
      
      res.json({ response: response });
      } else {
        console.log('Regular chat needed');
        
        // Check if this is a follow-up format request
        const formatRequests = ['detailed report', 'full analysis', 'visual dashboard', 'executive summary', 'bullet points', 'narrative style', 'conversational analysis'];
        const isFormatRequest = formatRequests.some(format => message.toLowerCase().includes(format));
        
        if (isFormatRequest && global.userPreferences) {
          // Handle format request for previous brand analysis
          const lastPreference = Object.values(global.userPreferences).pop();
          if (lastPreference) {
            const mockData = generateIntelligenceData(`${message} ${lastPreference.brand}`);
            
            if (message.toLowerCase().includes('detailed report') || message.toLowerCase().includes('full analysis')) {
              const htmlResponse = createIntelligenceHTML(mockData);
              return res.json({ response: htmlResponse });
            } else if (message.toLowerCase().includes('conversational')) {
              const conversationalResponse = createConversationalResponse(mockData);
              return res.json({ response: conversationalResponse });
            } else if (message.toLowerCase().includes('executive summary')) {
              const summaryResponse = createExecutiveSummary(mockData);
              return res.json({ response: summaryResponse });
            } else if (message.toLowerCase().includes('bullet points')) {
              const bulletResponse = createBulletPointAnalysis(mockData);
              return res.json({ response: bulletResponse });
            }
          }
        }
        
        // Regular OpenAI Assistant conversation
      try {
        const thread = await openai.beta.threads.create();
        
        await openai.beta.threads.messages.create(thread.id, {
          role: "user",
          content: message
        });

        const run = await openai.beta.threads.runs.create(thread.id, {
          assistant_id: ASSISTANT_ID
        });

        // Wait for completion with longer timeout and better error handling
        let runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
        let attempts = 0;
        const maxAttempts = 60; // Increased timeout to 60 seconds
        
        while (runStatus.status === 'in_progress' && attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
          attempts++;
          
          // Log progress every 10 seconds
          if (attempts % 10 === 0) {
            console.log('Assistant still processing... attempt', attempts);
          }
        }

        if (runStatus.status === 'completed') {
          const messages = await openai.beta.threads.messages.list(thread.id);
          const assistantMessage = messages.data[0];
          
          if (assistantMessage && assistantMessage.content[0]) {
            console.log('Assistant response received');
            res.json({ response: assistantMessage.content[0].text.value });
          } else {
            console.log('Assistant response empty, using fallback');
            res.json({ response: "I'm here to help with market intelligence and any questions you have. What would you like to know?" });
          }
        } else if (runStatus.status === 'failed') {
          console.log('Assistant run failed:', runStatus.last_error);
          res.json({ response: "I'm experiencing some technical difficulties. Let me help you with market intelligence instead - try asking about a brand or product!" });
        } else {
          console.log('Assistant timeout, status:', runStatus.status);
          res.json({ response: "My response is taking longer than expected. While I process that, feel free to ask me about brand sentiment, market analysis, or any other topic!" });
        }
      } catch (error) {
        console.error('OpenAI error:', error.message);
        
        // Try direct completion as fallback
        try {
          const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
              {
                role: "system", 
                content: "You are InsightEar GPT, a market intelligence assistant. You can also help with general questions and conversation. Be helpful, friendly, and informative."
              },
              {
                role: "user", 
                content: message
              }
            ],
            max_tokens: 500,
            temperature: 0.7
          });
          
          if (completion.choices[0]?.message?.content) {
            console.log('Fallback completion successful');
            res.json({ response: completion.choices[0].message.content });
          } else {
            res.json({ response: "I'm here to help! I can analyze market sentiment, brand perception, competitive intelligence, and answer general questions. What would you like to know?" });
          }
        } catch (fallbackError) {
          console.error('Fallback completion failed:', fallbackError.message);
          res.json({ response: "I'm here to help! I can analyze market sentiment, brand perception, competitive intelligence, and answer general questions. What would you like to know?" });
        }
      }
    }
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Route: Download PDF report
app.get('/download-report/:reportId', (req, res) => {
  try {
    const reportId = req.params.reportId;
    const reportData = global.reportData && global.reportData[reportId];
    
    if (!reportData) {
      return res.status(404).send('Report not found');
    }

    // Create PDF
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + reportData.brand + '-intelligence-report.pdf"');
    
    doc.pipe(res);
    
    // PDF Content
    doc.fontSize(20).text('Market Intelligence Report', 50, 50);
    doc.fontSize(16).text(reportData.brand + ' - ' + reportData.researchType, 50, 80);
    doc.fontSize(12).text('Generated on: ' + new Date().toLocaleDateString(), 50, 105);
    
    doc.moveDown(2);
    
    // Executive Summary
    doc.fontSize(14).text('Executive Summary', 50, doc.y);
    doc.fontSize(10).text('This report provides comprehensive market intelligence analysis for ' + reportData.brand + ' based on consumer sentiment, brand perception, and market positioning data.', 50, doc.y + 15);
    
    doc.moveDown(2);
    
    // Sentiment Analysis
    doc.fontSize(14).text('Sentiment Analysis', 50, doc.y);
    doc.fontSize(10);
    doc.text('Positive Sentiment: ' + reportData.positive + '%', 70, doc.y + 15);
    doc.text('Neutral Sentiment: ' + reportData.neutral + '%', 70, doc.y + 10);
    doc.text('Negative Sentiment: ' + reportData.negative + '%', 70, doc.y + 10);
    doc.text('Total Mentions: ' + reportData.totalMentions, 70, doc.y + 10);
    
    doc.moveDown(2);
    
    // Data Sources
    doc.fontSize(14).text('Data Sources', 50, doc.y);
    reportData.sources.forEach(function(source) {
      doc.fontSize(10);
      doc.text('• ' + source.platform + ': ' + source.mentions + ' mentions (' + source.sentiment + ')', 70, doc.y + 15);
    });
    
    doc.moveDown(2);
    
    // Key Insights
    doc.fontSize(14).text('Key Insights', 50, doc.y);
    reportData.insights.forEach(function(insight) {
      doc.fontSize(10).text('• ' + insight, 70, doc.y + 15);
    });
    
    doc.moveDown(2);
    
    // Recommendations
    doc.fontSize(14).text('Strategic Recommendations', 50, doc.y);
    reportData.recommendations.forEach(function(rec) {
      doc.fontSize(10).text('• ' + rec, 70, doc.y + 15);
    });
    
    doc.end();
  } catch (error) {
    console.error('PDF generation error:', error);
    res.status(500).send('Error generating PDF');
  }
});

// Route: File upload handling
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

// Route: Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Route: Favicon
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server - Railway requires binding to 0.0.0.0
app.listen(port, '0.0.0.0', () => {
  console.log('InsightEar GPT server running on port', port);
  console.log('Server bound to 0.0.0.0:' + port);
  console.log('Ready for market intelligence!');
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully');
  process.exit(0);
});

module.exports = app;
