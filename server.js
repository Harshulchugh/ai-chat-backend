// ENHANCED FILE UPLOAD SECTIONS - Add these to your existing server.js

// 1. REPLACE your existing multer configuration with this enhanced version:
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = './uploads';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Keep original filename with timestamp for uniqueness
        const uniqueName = Date.now() + '-' + file.originalname;
        cb(null, uniqueName);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 } // Increased to 50MB
});

// 2. ENHANCE your session management - replace your existing sessions section:
const sessions = new Map();

function getSession(sessionId) {
    if (!sessions.has(sessionId)) {
        sessions.set(sessionId, {
            lastQuery: null,
            lastResponse: null,
            uploadedFiles: [], // NEW: Track uploaded files
            created: new Date(),
            lastActivity: Date.now()
        });
    }
    
    // Update activity timestamp
    const session = sessions.get(sessionId);
    session.lastActivity = Date.now();
    return session;
}

// Enhanced session cleanup
setInterval(() => {
    const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000; // 30 minutes
    let cleanedCount = 0;
    for (const [sessionId, session] of sessions.entries()) {
        if (session.lastActivity < thirtyMinutesAgo) {
            sessions.delete(sessionId);
            cleanedCount++;
        }
    }
    if (cleanedCount > 0) {
        console.log('🧹 Cleaned up ' + cleanedCount + ' old sessions');
    }
}, 5 * 60 * 1000);

// 3. REPLACE your /chat endpoint with this enhanced version:
app.post('/chat', upload.array('files', 10), async (req, res) => {
    try {
        const userMessage = req.body.message || '';
        const sessionId = req.headers['x-session-id'] || req.ip || 'browser-session';
        const uploadedFiles = req.files || [];

        console.log(`📝 User message: "${userMessage}"`);
        console.log(`🔍 Session ID: ${sessionId}`);
        console.log(`📁 Files uploaded: ${uploadedFiles.length}`);

        // Get or create session
        const session = getSession(sessionId);

        // Handle uploaded files
        if (uploadedFiles.length > 0) {
            console.log(`📎 Processing ${uploadedFiles.length} uploaded files`);
            
            // Store file information in session
            for (const file of uploadedFiles) {
                const fileInfo = {
                    originalName: file.originalname,
                    filename: file.filename,
                    path: file.path,
                    size: file.size,
                    mimetype: file.mimetype,
                    uploadTime: Date.now()
                };
                session.uploadedFiles.push(fileInfo);
                console.log(`📄 Stored file: ${file.originalname} (${file.size} bytes)`);
            }

            // Auto-analyze if no message provided or message suggests analysis
            const shouldAutoAnalyze = !userMessage || 
                                    userMessage.trim().length === 0 || 
                                    ['analyze', 'what is this', 'summary', 'review', 'what is', 'summarize'].some(keyword => 
                                        userMessage.toLowerCase().includes(keyword));

            if (shouldAutoAnalyze) {
                console.log(`🤖 Auto-analyzing uploaded files`);
                
                // Create analysis message for assistant
                const fileNames = uploadedFiles.map(f => f.originalname).join(', ');
                const analysisPrompt = `IMPORTANT: Please analyze the uploaded file(s): ${fileNames}. 

The user has uploaded these files and wants analysis. Please read the file content using window.fs.readFile('${uploadedFiles[0]?.filename}', { encoding: 'utf8' }) and provide a comprehensive analysis including:

## Document Analysis
**File:** ${fileNames}
**Type:** [Document type]

## Summary
[What the document is and its purpose]

## Key Content
[Main points and information]

## Observations
[Professional insights and recommendations]

Use the file reading capabilities to analyze the actual content.`;
                
                // Process with assistant for auto-analysis
                const response = await processWithAssistant(analysisPrompt, sessionId, session);
                
                return res.json({
                    response: response,
                    sessionId: sessionId,
                    filesAnalyzed: uploadedFiles.map(f => f.originalname),
                    autoAnalyzed: true
                });
            }
        }

        // Handle file-related queries for existing files
        if (userMessage && session.uploadedFiles.length > 0) {
            const fileRelatedKeywords = ['this file', 'this document', 'the file', 'uploaded', 'what is this', 'analyze', 'summary', 'review', 'summarize'];
            const isFileQuery = fileRelatedKeywords.some(keyword => 
                userMessage.toLowerCase().includes(keyword));

            if (isFileQuery) {
                console.log(`📋 File-related query detected for existing files`);
                const fileNames = session.uploadedFiles.map(f => f.originalName).join(', ');
                const enhancedMessage = `${userMessage} 

IMPORTANT: The user is asking about previously uploaded files: ${fileNames}

Please use window.fs.readFile('${session.uploadedFiles[0]?.filename}', { encoding: 'utf8' }) to read and analyze the file content to answer their question.

Provide a helpful analysis based on the actual file content.`;
                
                const response = await processWithAssistant(enhancedMessage, sessionId, session);
                return res.json({
                    response: response,
                    sessionId: sessionId,
                    filesReferenced: session.uploadedFiles.map(f => f.originalName)
                });
            }
        }

        // PDF request handling (keep your existing logic)
        const pdfRequestTerms = ['yes', 'yes please', 'generate pdf', 'create pdf', 'pdf report', 'download pdf', 'make pdf'];
        const isPdfRequest = pdfRequestTerms.some(term => 
            userMessage.toLowerCase().trim() === term || userMessage.toLowerCase().includes('pdf')
        );
        
        if (isPdfRequest) {
            console.log('📄 PDF request detected');
            
            if (session.lastResponse && session.lastQuery) {
                console.log('✅ Found previous analysis for PDF: ' + session.lastQuery);
                const pdfResponse = `✅ **PDF Report Generated Successfully!**

I've created a comprehensive PDF report of the **${session.lastQuery}** analysis.

**📥 [Download PDF Report](/download-pdf/${sessionId})**

The report includes all findings, data sources, and recommendations from our analysis.`;

                return res.json({ 
                    response: pdfResponse,
                    sessionId: sessionId,
                    pdfReady: true
                });
            } else {
                return res.json({
                    response: "I don't have a recent analysis to generate a PDF from. Please ask me to analyze something first.",
                    sessionId: sessionId
                });
            }
        }

        // Handle simple greetings (your existing logic)
        const simpleGreetings = ['hi', 'hello', 'hey', 'howdy', 'sup', 'yo'];
        const isSimpleGreeting = simpleGreetings.some(greeting => 
            userMessage.toLowerCase().trim() === greeting
        );
        
        if (isSimpleGreeting) {
            console.log('✅ Simple greeting detected - bypassing Assistant to save tokens');
            const greetingResponse = "Hello! I'm InsightEar GPT, your market research assistant. I can help you analyze brands, consumer sentiment, market trends, and uploaded files using real-time web data. What would you like to research today?";
            return res.json({ 
                response: greetingResponse,
                sessionId: sessionId 
            });
        }

        // Regular processing for market intelligence
        console.log('🎯 Processing market intelligence query');
        session.lastQuery = userMessage;
        
        // Use your existing Assistant processing logic here...
        // (Keep your existing thread creation and Assistant interaction code)
        
        // Create minimal thread
        const thread = await openai.beta.threads.create();
        
        // Enhanced message with file context if available
        let enhancedMessage = userMessage;
        if (session.uploadedFiles.length > 0) {
            const fileContext = session.uploadedFiles.map(f => 
                `📁 ${f.originalName} (${f.mimetype}, ${Math.round(f.size/1024)}KB)`
            ).join('\n');
            
            enhancedMessage = `${userMessage}

📎 **Available Files for Analysis:**
${fileContext}

Note: Use window.fs.readFile('${session.uploadedFiles[0]?.filename}', { encoding: 'utf8' }) to read file content if needed.`;
        }
        
        await openai.beta.threads.messages.create(thread.id, {
            role: 'user',
            content: enhancedMessage + '\n\nIMPORTANT: Please use search_web_data function if this is a market intelligence query.'
        });

        // Continue with your existing Assistant processing...
        const run = await openai.beta.threads.runs.create(thread.id, {
            assistant_id: process.env.ASSISTANT_ID,
            max_prompt_tokens: 15000,
            max_completion_tokens: 6000
        });

        // Keep your existing polling and function handling logic...
        // [Your existing polling code here]
        
    } catch (error) {
        console.error('❌ Chat error:', error);
        res.json({ 
            response: "I'm experiencing technical difficulties. Please try again in a moment.",
            error: error.message 
        });
    }
});

// 4. ADD this new helper function for processing with Assistant:
async function processWithAssistant(message, sessionId, session) {
    try {
        // Create thread
        const thread = await openai.beta.threads.create();
        
        // Add message
        await openai.beta.threads.messages.create(thread.id, {
            role: 'user',
            content: message
        });

        // Run assistant
        const run = await openai.beta.threads.runs.create(thread.id, {
            assistant_id: process.env.ASSISTANT_ID,
            max_prompt_tokens: 15000,
            max_completion_tokens: 6000
        });

        // Poll for completion
        let attempts = 0;
        const maxAttempts = 90;
        
        while (attempts < maxAttempts) {
            attempts++;
            const runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
            
            if (runStatus.status === 'completed') {
                const messages = await openai.beta.threads.messages.list(thread.id);
                const assistantMessage = messages.data[0];
                
                if (assistantMessage && assistantMessage.content[0]) {
                    const response = assistantMessage.content[0].text.value;
                    
                    // Store for PDF generation
                    session.lastResponse = response;
                    
                    return response;
                }
                break;
            }

            if (runStatus.status === 'failed' || runStatus.status === 'cancelled') {
                throw new Error(`Assistant run failed: ${runStatus.status}`);
            }

            if (runStatus.status === 'requires_action') {
                // Handle function calls (use your existing function handling code)
                const toolCalls = runStatus.required_action?.submit_tool_outputs?.tool_calls;
                if (toolCalls) {
                    const toolOutputs = [];
                    
                    for (const toolCall of toolCalls) {
                        const args = JSON.parse(toolCall.function.arguments);
                        let output;
                        
                        if (toolCall.function.name === 'search_web_data') {
                            output = await handleWebSearch(args.query, args.sources, args.date_range);
                        } else if (toolCall.function.name === 'analyze_market_data') {
                            output = await handleMarketAnalysis(args.query, args.analysis_type);
                        } else if (toolCall.function.name === 'get_company_background') {
                            output = await handleCompanyBackgroundSearch(args.query);
                        }
                        
                        toolOutputs.push({
                            tool_call_id: toolCall.id,
                            output: output
                        });
                    }
                    
                    await openai.beta.threads.runs.submitToolOutputs(thread.id, run.id, {
                        tool_outputs: toolOutputs
                    });
                }
                continue;
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        return "I'm taking longer than expected to respond. Please try again.";

    } catch (error) {
        console.error('❌ Assistant processing error:', error);
        return "I'm experiencing technical difficulties. Please try again in a moment.";
    }
}
