import express from "express";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import path from "path";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Increase payload limit for base64 PDF uploads
  app.use(express.json({ limit: "50mb" }));

  // Chat API endpoint
  app.post("/api/chat", async (req, res) => {
    try {
      const { messages } = req.body;
      
      if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY environment variable is missing.");
      }
      
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

      // Map frontend messages to Gemini format
      const contents = messages.map((msg: any) => {
        const parts: any[] = [];
        
        // If the message has an attached PDF, include it as inlineData
        if (msg.attachedFile) {
          parts.push({
            inlineData: {
              data: msg.attachedFile.base64,
              mimeType: msg.attachedFile.mimeType,
            },
          });
        }
        
        if (msg.text) {
          parts.push({ text: msg.text });
        }
        
        return {
          role: msg.role === "assistant" ? "model" : "user",
          parts,
        };
      });

      // Generate response stream
      const responseStream = await ai.models.generateContentStream({
        model: "gemini-3.1-pro-preview", // Pro model is best for complex document reasoning
        contents,
        config: {
          systemInstruction: "Sei un assistente AI esperto nell'analisi di documenti. Rispondi alle domande dell'utente basandoti sul documento fornito. Se il documento è un PDF, estrai le informazioni rilevanti e spiegale chiaramente in italiano.",
        }
      });

      // Set headers for streaming
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Transfer-Encoding", "chunked");

      // Stream chunks back to the client
      for await (const chunk of responseStream) {
        if (chunk.text) {
          res.write(chunk.text);
        }
      }
      res.end();
    } catch (error: any) {
      console.error("Chat API Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
