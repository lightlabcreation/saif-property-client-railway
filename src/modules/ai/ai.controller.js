const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const { validateSqlQuery } = require('../../services/aiValidator.service');
const { PrismaClient } = require('@prisma/client');
const { searchDocuments } = require('../../services/qdrant.service');
const prisma = new PrismaClient();

// Initialize OpenAI (Ensure OPENAI_API_KEY is in your .env)
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Handle AI Query Requests
 */
const queryAI = async (req, res) => {
    try {
        const { question, history = [], selectedPropertyId } = req.body;

        if (!question) {
            return res.status(400).json({ error: "Question is required." });
        }
        if (!selectedPropertyId) {
            return res.status(400).json({ error: "selectedPropertyId is required for multi-database routing." });
        }

        // 1. Load your Prisma schema to give the AI context of your database structure
        const schemaPath = path.join(__dirname, '../../../../prisma/schema.prisma');
        const schema = fs.readFileSync(schemaPath, 'utf8');

        // 1.5. Check Qdrant for relevant unstructured documents (RAG)
        let documentContext = "No additional document context found.";
        try {
            // Generate embedding for user's question
            const embedResponse = await openai.embeddings.create({
                model: "text-embedding-3-small",
                input: question,
            });
            const queryVector = embedResponse.data[0].embedding;
            
            // Search Qdrant
            const relevantChunks = await searchDocuments(queryVector, selectedPropertyId, 3);
            if (relevantChunks && relevantChunks.length > 0) {
                documentContext = "Relevant Document Excerpts:\n" + relevantChunks.map((chunk, i) => `[Excerpt ${i+1}]: ${chunk}`).join("\n\n");
            }
        } catch (qdrantErr) {
            console.error("Qdrant Search Error:", qdrantErr.message);
            // Continue without document context if Qdrant fails
        }

        // 2. Instruct the AI
        const systemPrompt = `
You are a highly intelligent Property Management System (PMS) AI Assistant.
Your job is to translate the user's natural language question into a valid MySQL query based EXACTLY on the Prisma schema provided below.

CRITICAL RULES:
1. ONLY return the raw SQL query. Do not wrap it in markdown or backticks. Do not include any explanations.
2. You MUST ONLY generate SELECT queries. Never generate UPDATE, DELETE, INSERT, DROP, or ALTER.
3. If you do not know the answer, or if the schema does not have the required data, return exactly the string: "ERROR: Missing required data."
4. If the answer is found within the Document Excerpts provided below, you may still need to write a SQL query to verify the tenant/unit, or if it entirely answers the question without DB, you can return "DOC_ANSWER: " followed by the answer. However, normally stick to SQL.

Document Context (From Uploaded Leases/Inspections):
${documentContext}

Database Schema:
${schema}
`;

        // 3. Get the SQL Query from OpenAI
        const messages = [
            { role: "system", content: systemPrompt },
            ...history,
            { role: "user", content: question }
        ];

        const chatCompletion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: messages,
            temperature: 0, // Keep it deterministic for SQL generation
        });

        const generatedSql = chatCompletion.choices[0].message.content.trim();

        if (generatedSql.startsWith("ERROR:")) {
            return res.status(400).json({ error: "The AI could not find the required data to answer that question." });
        }

        // Bypass SQL validation and execution if the AI answered directly from the document context
        if (generatedSql.startsWith("DOC_ANSWER:")) {
            return res.status(200).json({
                success: true,
                sqlGenerated: null,
                isDocumentAnswer: true,
                data: [{ answer: generatedSql.replace("DOC_ANSWER:", "").trim() }]
            });
        }

        // 4. SECURITY CHECK: Validate the SQL using our AST parser (Code-Level Blocking)
        // This will throw an error if the AI hallucinated an UPDATE or DELETE
        const safeSql = validateSqlQuery(generatedSql);

        // 5. Execute on the isolated database
        let resultData;
        
        if (selectedPropertyId === 'stagathe') {
            console.log(`Proxying AI SQL to Backend 2 (St-Agathe)...`);
            const axios = require('axios');
            const backend2Url = 'https://saif-property2-client-railway-production.up.railway.app/api/internal/ai-execute';
            const serviceToken = process.env.INTERNAL_SERVICE_TOKEN || 'saif-ai-super-secret-token';
            
            try {
                const proxyResponse = await axios.post(backend2Url, { sql: safeSql }, {
                    headers: { 'x-service-token': serviceToken }
                });
                resultData = proxyResponse.data.data;
            } catch (proxyErr) {
                console.error("Backend 2 Proxy Error:", proxyErr.message);
                throw new Error("Failed to execute query on St-Agathe database.");
            }
        } else {
            console.log(`Executing AI SQL on this backend's database (Masteko)...`);
            resultData = await prisma.$queryRawUnsafe(safeSql);
        }

        // 6. (Optional) You can send resultData back to OpenAI here to have it formatted nicely into a sentence.
        // For now, we just return the raw JSON data to the frontend for tables/graphs.
        
        return res.status(200).json({
            success: true,
            sqlGenerated: safeSql,
            data: resultData
        });

    } catch (error) {
        console.error("AI Controller Error:", error);
        return res.status(500).json({ 
            success: false, 
            error: error.message || "An error occurred while processing your AI request." 
        });
    }
};

module.exports = {
    queryAI
};
