const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');

require('dotenv').config();

const { OpenAI } = require('openai');
const mongoose = require('mongoose');

const app = express();

app.use(express.static(path.join(__dirname, 'public')));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const retrievalService = require('./services/retrievalService');
const confidenceCalculator = require("./services/confidenceCalculator");

const PORT = process.env.PORT || 3000;

mongoose.connect(process.env.MONGO_URI)
    .then(async () => {
        console.log('MongoDB connected')
        await retrievalService.initialize();

        app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
        });
  })
    .catch((err) => console.error('MongoDB connection error:', err));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/chat', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

const Interaction = require('./models/Interaction'); // Import Interaction model

// Define a POST route for chat interactions
// openai.createCompletion is deprecated, change to
// completions.create()
app.post('/chat', async (req, res) => {
    // 1. Receive user input from client script.js
    // Also pass participantID
    const { history = [], input: userInput, participantID, systemID, retrievalMethod = 'semantic'} =
req.body;
  
    // Check for participantID
    if (!participantID) {
      return res.status(400).send('Participant ID is required');
    }

    if (!userInput) {
        return res.status(400).send('Message is required');
    }

    try {
        console.log(`Processing query: "${userInput}" for participant: ${participantID}`);

        const isBaselineRequest = parseInt(systemID) === 1;

        const hasDocuments = !!(await Document.exists({ participantID }));

        const topK = await retrievalService.retrieve(userInput, {
          method: retrievalMethod,
          topK: 5,
          minScore: retrievalMethod === 'tfidf' ? 0 : 0.35,
          participantID: participantID
        });

        console.log(`Retrieved ${topK.length} documents`);

        const context = topK.length > 0
          ? topK.map((c, i) =>
              `[Source ${i + 1} | ${c.documentName} | chunk ${c.chunkIndex}]\n${c.chunkText}`
            ).join("\n\n---\n\n")
          : null;

        let prompt = context
          ? `You are a travel planner that helps the user build trips, itineraries, and recommendations using the SOURCES below. The sources come from PDF travel guides the user uploaded.

YOUR JOB: Take the facts in the SOURCES (landmarks, neighborhoods, transport tips, foods, hours, prices, etiquette, etc.) and organize them into a useful answer to the user's request — e.g. a day-by-day itinerary, a packing list, a budget breakdown, a shortlist of recommendations.

RULES:
1. Every concrete FACT (place name, price, opening hours, neighborhood, food, custom, transport rule) must come from the SOURCES. Do not invent facts the sources don't contain.
2. You CAN structure, sequence, group, and recommend based on those facts — that's the whole point. If the user asks for an itinerary, match the duration they specify (e.g. a weekend, 5 days, 2 weeks); never default to a fixed length. If they don't specify, ask or pick a sensible length and say why.
3. After each fact you use, cite the source like [Source 1] or [Source 2].
4. If the user gives a constraint (budget, days, interests, dietary, etc.), use it to filter and organize what's in the sources. If the sources don't contain prices and the user gives a budget, allocate the user's budget across categories (lodging, food, transport, activities) and say which exact prices/numbers came from the user vs. were not specified in the sources.
5. If a key fact is genuinely missing (e.g. user asks about visa rules and the docs are tourism guides only), do NOT just refuse. Use this pattern: "The uploaded docs don't have specific info on [missing topic], but here's what's relevant from them: ..." — then give them everything related you CAN ground with citations. Be a planner, not a gatekeeper.
6. Even if the question is far from the uploaded docs, still try to bridge: open with "The docs don't directly cover [X], but they do have related info on [Y] which might help: ..." and pull anything tangentially useful. Only say "the documents don't cover this at all" if there is genuinely zero overlap (e.g. user asks about Tokyo when only European city guides are uploaded).
7. Keep the answer focused and useful. Prefer a structured plan over a paragraph of disclaimers.
8. If the answer involves trade-offs (choosing between options, balancing constraints like budget vs. preferences, picking one city/plan/route over another, recommending a compromise for a group), end your answer with a section in EXACTLY this format:

TRADE-OFFS:
- <one full sentence explaining a strength or a compromise of the recommendation>
- <another full sentence>
- <as many bullets as needed; each bullet covers one dimension the user cared about>

The bullets must reflect the dimensions the user actually asked about (e.g., if they asked about nightlife/budget/dietary, the bullets cover those exact dimensions). Skip this section entirely for factual lookups, greetings, or answers with no real trade-off.

SOURCES:
${context}

QUESTION: ${userInput}

ANSWER (organized, with [Source N] citations on each fact, and a TRADE-OFFS section at the end if applicable):`
          : `You are a friendly travel assistant. The user said: "${userInput}"

There are no uploaded documents yet, so you cannot ground travel facts in sources.

How to respond:
- If the user is greeting you, making small talk, or asking how to use the system, reply naturally and warmly. Briefly let them know you can help plan trips once they upload travel documents (PDF guides, visa info, budget breakdowns, etc.).
- If the user is asking a substantive travel question (a destination, an itinerary, prices, customs, visas), tell them you'd love to help but you need them to upload a relevant travel document first. Do NOT answer travel facts from general knowledge.
- Keep the reply short and conversational. Do not lecture.`;

        // Baseline override: when systemID === 1 and we have context, replace the
        // strict enhanced prompt with a softer prompt that does not require
        // [Source N] citations or a TRADE-OFFS section.
        if (isBaselineRequest && context) {
            prompt = `You are a travel assistant. The user has uploaded travel documents. Refer to the SOURCES below when answering the user's question.

SOURCES:
${context}

QUESTION: ${userInput}`;
        }

        const safeHistory = Array.isArray(history)
          ? history
            .filter(m => m && (m.role === 'user' || m.role === 'assistant'))
            .map(m => ({ role: m.role, content: String(m.content ?? '') }))
          : [];
        const input = safeHistory.length === 0
          ? [{ role: 'user', content: prompt }]
          : [...safeHistory, { role: 'user', content: prompt }];
        // OpenAI call uses the last N turns in `history
        console.log('Sending request to OpenAI...');

        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: input,
          max_tokens: 500,
          temperature: 0.2
        });

        console.log('Received response from OpenAI');
        
        const botResponse = completion.choices[0].message.content.trim();
        
        const retrievedDocuments = topK;
        
        const confidenceMetrics = confidenceCalculator.calculate({
          retrievedDocs: topK,
          retrievalMethod
        });

        // Log the interaction to MongoDB
        const interaction = new Interaction({
            participantID: participantID,
            systemID: systemID,
            userInput: userInput,
            botResponse: botResponse,
            retrievalMethod: retrievalMethod,
            retrievedDocuments: retrievedDocuments.map((d) => ({
            docName: d.documentName,
            chunkIndex: d.chunkIndex,
            chunkText: d.chunkText,
            relevanceScore: d.relevanceScore ?? d.score
            })),
            confidenceMetrics: confidenceMetrics
        });
    
        await interaction.save(); // Save the interaction to MongoDB
    
        res.json({ botResponse, retrievedDocuments, confidenceMetrics, hasDocuments });
    
    } catch (error) {
        console.error('Error interacting with OpenAI API:', error.message);
        res.status(500).send('Internal Server Error');
    }
});

const EventLog = require('./models/EventLog'); // Import EventLog model

app.post('/log-event', async (req, res) => {
    const { participantID, eventType, elementName, timestamp } = req.body;

    // Check for participantID
    if (!participantID) {
        return res.status(400).send('Participant ID is required');
    }

    try {
        // Log the event to MongoDB
        const event = new EventLog({ participantID, eventType, elementName, timestamp}); 
        await event.save();
        res.status(200).send('Event logged successfully');
        
    } catch (error) {
        console.error('Error logging event:', error.message);
        res.status(500).send('Internal Server Error');
    }
});

app.post('/history', async (req, res) => {
    const { participantID, limit = 5 } = req.body;

    if (!participantID) {
      return res.status(400).send('Participant ID is required');
    }

    try {
        // Fetch the last N interactions from the database for the given
        // participantID and sort by time so they are in order for displaying
        const interactions = await Interaction.find({ participantID })
            .sort({ timestamp: -1 })
            .limit(limit)
            .sort({ timestamp: 1 });
        // Send the conversation history back to the client to display
        res.json({ interactions });
    } catch (error) {
        console.error('Error fetching conversation history:', error.message);
        res.status(500).send('Server Error');
    }
});
        

const multer = require("multer");
const Document = require("./models/Document"); // Import Document model
const documentProcessor = require("./services/documentProcessor");
const embeddingService = require("./services/embeddingService");
// Save uploaded files so documentProcessor.js can read them
const upload = multer({ dest: "uploads/" });

app.post("/upload-document", upload.single("document") , async (req, res) => {
  if (!req.file ) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  const { participantID } = req.body;
  if (!participantID) {
    return res.status(400).json({ error: "Participant ID is required" });
  }
  const processed = await documentProcessor.processDocument(req.file);

  const chunkObjects = processed.chunks.map((chunk, index) => ({
    chunkIndex: index,
    text: chunk.text || chunk
  }));

  const chunksWithEmbeddings = await embeddingService.generateEmbeddings(chunkObjects);

  await Document.create({
    participantID: participantID,
    filename: req.file.originalname,
    text: processed.fullText,
    chunks: chunksWithEmbeddings,
    processingStatus: "completed"
  });

    await retrievalService.rebuildIndex();

  res.json({
    status: "ok",
    filename: req.file.originalname,
    chunkCount: processed.chunks.length
  });
});

app.get("/documents", async (req, res) => {
  const { participantID } = req.query;
  if (!participantID) {
    return res.status(400).json({ error: "Participant ID is required" });
  }
  const docs = await Document.find({ participantID })
  .select("_id filename processingStatus processedAt")
  .sort({ processedAt: -1 });
  res.json(docs);
});

app.delete("/documents/:id", async (req, res) => {
  const { participantID } = req.query;
  if (!participantID) {
    return res.status(400).json({ error: "Participant ID is required" });
  }
  const doc = await Document.findOne({ _id: req.params.id, participantID });
  if (!doc) {
    return res.status(404).json({ error: "Document not found" });
  }
  await Document.deleteOne({ _id: doc._id });
  await retrievalService.rebuildIndex();
  res.json({ status: "ok", deletedId: doc._id });
});

// const PORT = process.env.PORT || 30003w5

// Qualtrics survey URLs per surveyType.
const SURVEY_URLS = {
  demographics: 'https://usfca.qualtrics.com/jfe/form/SV_0HAvrRsPZS6bdP0',
  posttask:     'https://usfca.qualtrics.com/jfe/form/SV_8p5rOWH0ArN0yTc',
  usability:    'https://usfca.qualtrics.com/jfe/form/SV_e3sF7XrBIiLYzUG'
};

app.post('/redirect-to-survey', (req, res) => {
  const { participantID, surveyType = 'demographics' } = req.body;

  const baseUrl = SURVEY_URLS[surveyType];
  if (!baseUrl) {
    return res.status(400).send(`Unknown surveyType: ${surveyType}`);
  }

  const surveyUrl = `${baseUrl}?participantID=${encodeURIComponent(participantID)}`;
  res.send(surveyUrl);
});



