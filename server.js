import express from 'express';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3001;
const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error("❌ ERROR: GEMINI_API_KEY is not set in .env!");
} else {
  console.log("✅ GEMINI_API_KEY loaded successfully.");
}

const ai = new GoogleGenAI({ apiKey: apiKey });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function generateAiStream(contents) {
  const systemInstruction = `You are an intelligent, polite, and technical AI assistant built for an internship demonstration.
- Provide structured, concise, and helpful answers.
- Format code blocks and technical lists using clean Markdown.
- Keep responses friendly and relevant to the user's conversation context.`;

  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await ai.models.generateContentStream({
        model: 'gemini-3.8-flash',
        contents,
        config: {
          systemInstruction,
        },
      });
    } catch (error) {
      lastError = error;
      const message = error?.message || JSON.stringify(error || {});
      const shouldRetry = /503|429|rate limit|temporar|high demand|unavailable|timeout/i.test(message);

      if (!shouldRetry || attempt === 3) {
        throw error;
      }

      const delayMs = attempt * 1000;
      console.warn(`Gemini request failed (attempt ${attempt}/3). Retrying in ${delayMs}ms...`);
      await wait(delayMs);
    }
  }

  throw lastError;
}

app.use(express.json());
app.use(express.static('public'));

// API Endpoint handling history, validation, error handling & streaming
app.post('/api/chat/stream', async (req, res) => {
  try {
    const { messages } = req.body;

    // --- Input Validation ---
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Message history cannot be empty.' });
    }

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || !lastMessage.content || lastMessage.content.trim() === '') {
      return res.status(400).json({ error: 'User message cannot be blank.' });
    }

    // --- Server API Key Check ---
    if (!apiKey) {
      return res.status(500).json({ error: 'API key missing on server. Check .env file.' });
    }

    // --- Set Server-Sent Events (SSE) Headers ---
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // --- Context & Memory Mapping ---
    const contents = messages.map((msg) => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }],
    }));

    // --- Better Prompt Structure (System Instruction) ---
    const responseStream = await generateAiStream(contents);

    // --- Stream Response Chunks ---
    for await (const chunk of responseStream) {
      if (chunk.text) {
        res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    // --- Response / Error Handling ---
    console.error('API Error:', error?.message || error);
    res.write(`data: ${JSON.stringify({ error: 'An error occurred while fetching the AI response.' })}\n\n`);
    res.end();
  }
});

function startServer(listenPort) {
  const server = app.listen(listenPort, () => {
    console.log(`Server running at http://localhost:${listenPort}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      const nextPort = listenPort + 1;
      console.warn(`Port ${listenPort} is busy. Trying ${nextPort} instead...`);
      startServer(nextPort);
      return;
    }

    console.error('Failed to start server:', error);
    process.exit(1);
  });
}

startServer(port);