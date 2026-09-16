const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const { validateSqlQuery } = require('../../services/aiValidator.service');
const { PrismaClient } = require('@prisma/client');
const { searchDocuments } = require('../../services/qdrant.service');

// Polyfill to allow JSON.stringify to serialize BigInts (like COUNT(*)) returned by Prisma queryRaw
BigInt.prototype.toJSON = function () {
    return Number(this);
};

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
        const schemaPath = path.join(__dirname, '../../../prisma/schema.prisma');
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

        // 1.8 Dynamic Date Context
        const currentDate = new Date().toISOString().split('T')[0];

        // 2. Instruct the AI
        const systemPrompt = `
You are a highly intelligent Property Management System (PMS) AI Assistant.
Your job is to translate the user's natural language question into a valid MySQL query based EXACTLY on the Prisma schema provided below.

CRITICAL RULES:
1. ONLY return the raw SQL query. Do not wrap it in markdown or backticks. Do not include any explanations.
2. You MUST ONLY generate SELECT queries. Never generate UPDATE, DELETE, INSERT, DROP, or ALTER.
3. If you do not know the answer, or if the schema does not have the required data, return exactly the string: "ERROR: Missing required data."
4. If the answer is found within the Document Excerpts provided below, you may still need to write a SQL query to verify the tenant/unit, or if it entirely answers the question without DB, you can return "DOC_ANSWER: " followed by the answer. However, normally stick to SQL.
5. DATABASE TABLE NAMES ARE CASE SENSITIVE. You MUST use the exact underlying table name defined by the @@map("tablename") directive in the schema. For example, use 'unit' instead of 'Unit', 'property' instead of 'Property', 'user' instead of 'User', 'movein' instead of 'MoveIn', 'moveout' instead of 'MoveOut'. When the user asks about "buildings", you MUST query the 'property' table.
6. When asked about "Vacant Units", you MUST follow this exact dashboard business logic: Only consider units where unit_status = 'ACTIVE' OR reserved_flag = 1. For rentalMode = 'FULL_UNIT', a unit is vacant ONLY IF it does NOT have an active lease (lease.status = 'Active'), reserved_flag = 0, and physical_occupancy_status != 'Temporarily Occupied'. For rentalMode = 'BEDROOM_WISE', a unit is vacant ONLY IF ALL of its bedrooms are vacant (no active leases and reserved_flag = 0). Use LEFT JOINs or EXISTS subqueries.
7. When asked about "Occupied Units" as a strict filter, a unit is considered occupied ONLY IF the 'status' column is exactly 'Occupied'. Do not count 'Fully Booked'.
8. When asked about "Fully Booked Units", a unit is considered fully booked ONLY IF the 'status' column is exactly 'Fully Booked'.
9. When asked about "Occupancy Percentage", "Vacancy Rate", or "Breakdown by building", you must calculate it out of total active units. Occupancy % formula: (SUM(CASE WHEN status IN ('Occupied', 'Fully Booked') THEN 1 ELSE 0 END) / COUNT(*)) * 100. Vacancy % formula: (SUM(CASE WHEN status NOT IN ('Occupied', 'Fully Booked') THEN 1 ELSE 0 END) / COUNT(*)) * 100. For breakdowns or 'highest/lowest', JOIN the 'property' table, GROUP BY property.name, and use ORDER BY ... DESC LIMIT 1 if needed.
10. CONVERSATIONAL FALLBACK: If the user asks a question with poor grammar that you cannot confidently turn into SQL, or if they are just making small talk/asking a general question, you MUST return exactly: "CONVERSATION: " followed by your response. You are absolutely forbidden from returning plain conversational text without the "CONVERSATION: " prefix.
11. HUMAN-READABLE OUTPUT: Whenever you return lists of records (like Leases, Tickets, Units, etc.), you MUST use JOINs to replace raw IDs with human-readable names. For example, join the 'user' table to return the tenant's 'firstName' and 'lastName' instead of 'tenantId', and join the 'unit' and 'property' tables to return the unit and building names instead of 'unitId'. Do not return raw IDs to the user.
12. RENT ROLL & REVENUE: To calculate "Total Current Monthly Rent" or "Rent Roll", you MUST SUM the 'monthlyRent' column from the 'lease' table where status = 'Active'. To calculate "Collected Rent" or "Revenue", you MUST SUM the 'paidAmount' column from the 'invoice' table where status = 'paid'. To calculate "Potential Rent", you MUST JOIN the 'unittyperates' table ON unit.unitType = unittyperates.typeName and SUM(unittyperates.fullUnitRate). Do NOT use unit.rentAmount for Potential Rent.
13. RESERVATIONS: There is no 'reservation' table. To query reservations, you MUST query the 'unit' or 'bedroom' tables and filter by reserved_flag = 1. The date a reservation "starts" refers to the 'tentative_move_in_date' column.
14. MAINTENANCE REPORTS: When asked to "prepare a maintenance report", you MUST query BOTH the 'ticket' table (for maintenance tickets) AND the 'maintenancetask' table (for scheduled tasks) and return combined or separate result sets. For the ticket table, filter by createdAt within the requested date range. For maintenancetask, filter by dueDate within the requested date range. "Last month" means the previous calendar month.
15. RENT/PAYMENT BUSINESS RULES:
- "Unpaid rent" or "not paid rent" means the tenant has an invoice where status = 'Unpaid' OR status = 'Pending'.
- "Partial payments" means status = 'Partial'.
- "Outstanding balances" means looking at total amounts across invoices where status != 'Paid'.
- For date-based questions (e.g., "September rent"), you MUST look at the invoice dueDate.

FEW-SHOT EXAMPLES:
- User: "tenants who have not paid September rent"
  SQL: SELECT u.firstName, u.lastName, i.dueDate, i.amount FROM user u JOIN lease l ON u.id = l.tenantId JOIN invoice i ON l.id = i.leaseId WHERE (i.status = 'Unpaid' OR i.status = 'Pending') AND i.dueDate >= 'YYYY-09-01' AND i.dueDate < 'YYYY-10-01'
- User: "occupancy percentage"
  SQL: SELECT (SUM(CASE WHEN status IN ('Occupied', 'Fully Booked') THEN 1 ELSE 0 END) / COUNT(*)) * 100 as occupancy_percentage FROM unit WHERE unit_status = 'ACTIVE'

CURRENT DATE CONTEXT: Today's date is ${currentDate}. If a user asks for a month without specifying a year, assume the year closest to ${currentDate}.

Document Context (From Uploaded Leases/Inspections):
${documentContext}

Database Schema:
${schema}
`;

        // 3. Agentic Retry Loop
        let messages = [
            { role: "system", content: systemPrompt },
            ...history,
            { role: "user", content: question }
        ];

        let safeSql = "";
        let resultData = [];
        let finalAnswer = "";
        let isDirectAnswer = false;
        
        for (let attempt = 1; attempt <= 3; attempt++) {
            const chatCompletion = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: messages,
                temperature: 0, 
            });

            let generatedSql = chatCompletion.choices[0].message.content.trim();
            generatedSql = generatedSql.replace(/```sql/gi, '').replace(/```/g, '').trim();

            if (generatedSql.startsWith("ERROR:")) {
                return res.status(400).json({ error: "The AI could not find the required data to answer that question." });
            }

            if (generatedSql.startsWith("DOC_ANSWER:")) {
                isDirectAnswer = true;
                finalAnswer = generatedSql.replace("DOC_ANSWER:", "").trim();
                break;
            }

            if (generatedSql.startsWith("CONVERSATION:")) {
                isDirectAnswer = true;
                finalAnswer = generatedSql.replace("CONVERSATION:", "").trim();
                break;
            }

            try {
                safeSql = validateSqlQuery(generatedSql);
            } catch (astError) {
                console.error(`AST Parser Error Attempt ${attempt}:`, astError.message);
                messages.push({ role: "assistant", content: generatedSql });
                messages.push({ role: "user", content: `SQL syntax or security error: ${astError.message}. Fix the query and ONLY return the raw SELECT SQL.` });
                continue;
            }

            try {
                if (selectedPropertyId === 'stagathe') {
                    console.log(`Proxying AI SQL to Backend 2 (St-Agathe)...`);
                    const axios = require('axios');
                    const backend2Url = 'https://saif-property2-client-railway-production.up.railway.app/api/internal/ai-execute';
                    const serviceToken = process.env.INTERNAL_SERVICE_TOKEN || 'saif-ai-super-secret-token';
                    
                    const proxyResponse = await axios.post(backend2Url, { sql: safeSql }, {
                        headers: { 'x-service-token': serviceToken }
                    });
                    resultData = proxyResponse.data.data;
                } else {
                    console.log(`Executing AI SQL on this backend's database (Masteko)...`);
                    resultData = await prisma.$queryRawUnsafe(safeSql);
                }
                
                // Context-Aware Verification Step
                const verificationPrompt = `You generated this SQL: ${safeSql}\nIt returned this data: ${JSON.stringify(resultData).substring(0, 5000)}\nDoes this data logically answer the user's original question based on the business rules and schema? If yes, respond EXACTLY with the word "SUCCESS". If no (e.g., unexpected empty result, wrong logic, missing fields), generate a NEW, corrected SQL query. ONLY return the new SQL query without explanation.`;
                
                const verifyCompletion = await openai.chat.completions.create({
                    model: "gpt-4o",
                    messages: [...messages, { role: "assistant", content: generatedSql }, { role: "user", content: verificationPrompt }],
                    temperature: 0,
                });
                
                let verifyContent = verifyCompletion.choices[0].message.content.trim();
                verifyContent = verifyContent.replace(/```sql/gi, '').replace(/```/g, '').trim();
                
                if (verifyContent === "SUCCESS") {
                    break; // The data is correct
                } else {
                    // Logic failed, try the new query in the next loop
                    console.log(`Verification failed on attempt ${attempt}. Retrying with new SQL...`);
                    messages.push({ role: "assistant", content: generatedSql });
                    messages.push({ role: "user", content: `The data was incorrect or missing. Using your corrected SQL: ${verifyContent}` });
                    continue;
                }
            } catch (execError) {
                console.error(`Execution Error Attempt ${attempt}:`, execError.message);
                messages.push({ role: "assistant", content: generatedSql });
                messages.push({ role: "user", content: `Database execution error: ${execError.message}. Check your column names against the schema and return a corrected SELECT query.` });
                continue;
            }
        }
        
        if (isDirectAnswer) {
            return res.status(200).json({
                success: true,
                sqlGenerated: null,
                isDocumentAnswer: true,
                data: [{ answer: finalAnswer }],
                answer: finalAnswer
            });
        }
        
        // Final Humanization Step
        if (!finalAnswer) {
            const summarizePrompt = `Based on the user's original question ("${question}") and this database result: ${JSON.stringify(resultData).substring(0, 5000)}, write a short, natural, human-readable answer.`;
            const summaryCompletion = await openai.chat.completions.create({
                model: "gpt-4o-mini", // Use mini for fast summarization
                messages: [{ role: "user", content: summarizePrompt }],
                temperature: 0.5,
            });
            finalAnswer = summaryCompletion.choices[0].message.content.trim();
        }

        return res.status(200).json({
            success: true,
            sqlGenerated: safeSql,
            data: resultData,
            answer: finalAnswer
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
