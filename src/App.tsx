import { useState, useRef, useEffect } from "react";
import { UploadCloud, FileText, Send, Loader2, Bot, User, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { GoogleGenAI } from "@google/genai";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachedFile?: {
    name: string;
    mimeType: string;
    base64: string;
  };
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileBase64, setFileBase64] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Handle file selection and convert to base64
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith('.pdf');
    const isWord = file.type === "application/msword" || 
                   file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || 
                   file.name.toLowerCase().endsWith('.doc') || 
                   file.name.toLowerCase().endsWith('.docx');

    if (!isPdf && !isWord) {
      alert("Per favore, carica solo file PDF o documenti Word (.doc, .docx).");
      return;
    }

    if (file.size > 40 * 1024 * 1024) {
      alert("Il file è troppo grande. Il limite è 40MB.");
      return;
    }

    setSelectedFile(file);
    setFileBase64(null); // Reset while loading

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64String = (event.target?.result as string).split(",")[1];
      setFileBase64(base64String);
    };
    reader.onerror = () => {
      console.error("Error reading file");
      alert("Si è verificato un errore durante la lettura del file.");
      removeFile();
    };
    reader.readAsDataURL(file);
  };

  const removeFile = () => {
    setSelectedFile(null);
    setFileBase64(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const isFileLoading = selectedFile !== null && fileBase64 === null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && !selectedFile) || isLoading || isFileLoading) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      text: input,
      ...(selectedFile && fileBase64
        ? {
            attachedFile: {
              name: selectedFile.name,
              mimeType: selectedFile.type || (selectedFile.name.toLowerCase().endsWith('.pdf') ? "application/pdf" : "application/msword"),
              base64: fileBase64,
            },
          }
        : {}),
    };

    setMessages((prev) => [...prev, newMessage]);
    setInput("");
    removeFile();
    setIsLoading(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

      const contents = [...messages, newMessage].map((msg) => {
        const parts: any[] = [];
        if (msg.attachedFile) {
          parts.push({
            inlineData: {
              data: msg.attachedFile.base64,
              mimeType: msg.attachedFile.mimeType,
            },
          });
          // Explicitly tell the model about the attachment to avoid confusion
          parts.push({ text: `[Documento allegato: ${msg.attachedFile.name}]\n\n${msg.text}` });
        } else if (msg.text) {
          parts.push({ text: msg.text });
        }
        return {
          role: msg.role === "assistant" ? "model" : "user",
          parts,
        };
      });

      const responseStream = await ai.models.generateContentStream({
        model: "gemini-3.1-pro-preview",
        contents,
        config: {
          systemInstruction: "Sei un assistente AI esperto nell'analisi di documenti. Rispondi alle domande dell'utente basandoti sul documento fornito. Estrai le informazioni rilevanti e spiegale chiaramente in italiano.",
        }
      });

      const assistantMessageId = (Date.now() + 1).toString();
      setMessages((prev) => [
        ...prev,
        { id: assistantMessageId, role: "assistant", text: "" },
      ]);

      let assistantText = "";
      for await (const chunk of responseStream) {
        if (chunk.text) {
          assistantText += chunk.text;
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? { ...msg, text: assistantText }
                : msg
            )
          );
        }
      }
    } catch (error: any) {
      console.error("Error:", error);
      
      let errorMessage = "Scusa, si è verificato un errore durante l'elaborazione della tua richiesta. Riprova.";
      
      if (error.message && (error.message.includes("API key not valid") || error.message.includes("API_KEY_INVALID"))) {
        errorMessage = "⚠️ **Errore: La chiave API di Gemini non è valida.**\n\nLa chiave che stai utilizzando è stata rifiutata dai server di Google. \n\n**Come risolvere:**\n1. Vai su [Google AI Studio API Keys](https://aistudio.google.com/app/apikey) e genera una nuova chiave.\n2. Clicca sull'icona dell'ingranaggio (⚙️ Settings) in alto a destra qui in AI Studio.\n3. Vai su **Secrets**.\n4. Aggiorna il valore di `GEMINI_API_KEY` con la tua nuova chiave.";
      } else if (error.message) {
        errorMessage = `⚠️ **Errore:** ${error.message}`;
      }

      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "assistant",
          text: errorMessage,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-slate-50 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center shadow-sm z-10">
        <div className="bg-indigo-600 p-2 rounded-lg mr-3">
          <FileText className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-slate-800">
            Assistente Documenti Intelligente
          </h1>
          <p className="text-sm text-slate-500">
            Carica un documento e fai domande sul suo contenuto
          </p>
        </div>
      </header>

      {/* Chat Area */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full mt-20 text-center space-y-4">
              <div className="bg-indigo-50 p-6 rounded-full">
                <UploadCloud className="w-12 h-12 text-indigo-500" />
              </div>
              <h2 className="text-2xl font-semibold text-slate-700">
                Inizia caricando un documento
              </h2>
              <p className="text-slate-500 max-w-md">
                Puoi chiedermi di riassumere il documento, cercare formule
                specifiche o spiegare concetti complessi presenti nel testo. Supporto PDF e documenti Word.
              </p>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${
                  msg.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`flex max-w-[85%] sm:max-w-[75%] ${
                    msg.role === "user" ? "flex-row-reverse" : "flex-row"
                  }`}
                >
                  {/* Avatar */}
                  <div
                    className={`flex-shrink-0 h-10 w-10 rounded-full flex items-center justify-center ${
                      msg.role === "user"
                        ? "bg-indigo-100 ml-3"
                        : "bg-emerald-100 mr-3"
                    }`}
                  >
                    {msg.role === "user" ? (
                      <User className="w-6 h-6 text-indigo-600" />
                    ) : (
                      <Bot className="w-6 h-6 text-emerald-600" />
                    )}
                  </div>

                  {/* Message Bubble */}
                  <div
                    className={`flex flex-col ${
                      msg.role === "user" ? "items-end" : "items-start"
                    }`}
                  >
                    <div
                      className={`px-5 py-3.5 rounded-2xl shadow-sm ${
                        msg.role === "user"
                          ? "bg-indigo-600 text-white rounded-tr-sm"
                          : "bg-white border border-slate-200 text-slate-800 rounded-tl-sm"
                      }`}
                    >
                      {/* Attached File Indicator */}
                      {msg.attachedFile && (
                        <div className="flex items-center space-x-2 bg-indigo-500/30 p-2 rounded-lg mb-2 text-sm border border-indigo-400/30">
                          <FileText className="w-4 h-4" />
                          <span className="truncate max-w-[200px] font-medium">
                            {msg.attachedFile.name}
                          </span>
                        </div>
                      )}

                      {/* Message Text (Markdown for Assistant) */}
                      {msg.role === "assistant" ? (
                        <div className="prose prose-slate prose-sm sm:prose-base max-w-none">
                          <ReactMarkdown
                            remarkPlugins={[remarkMath]}
                            rehypePlugins={[rehypeKatex]}
                          >
                            {msg.text}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap">{msg.text}</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Input Area */}
      <footer className="bg-white border-t border-slate-200 p-4 sm:p-6">
        <div className="max-w-4xl mx-auto">
          {/* File Preview */}
          {selectedFile && (
            <div className="flex items-center justify-between bg-indigo-50 border border-indigo-100 rounded-lg p-3 mb-3">
              <div className="flex items-center space-x-3 overflow-hidden">
                <div className="bg-indigo-100 p-2 rounded-md">
                  <FileText className="w-5 h-5 text-indigo-600" />
                </div>
                <div className="truncate">
                  <p className="text-sm font-medium text-slate-700 truncate">
                    {selectedFile.name}
                  </p>
                  <p className="text-xs text-slate-500">
                    {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
              </div>
              <button
                onClick={removeFile}
                className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                title="Rimuovi file"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
          )}

          {/* Input Form */}
          <form
            onSubmit={handleSubmit}
            className="flex items-end space-x-2 sm:space-x-4"
          >
            <div className="relative flex-1">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Chiedimi qualcosa sul documento..."
                className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-4 pr-12 py-3.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none h-[52px] max-h-32 min-h-[52px]"
                rows={1}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
              />
              
              {/* Hidden File Input */}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.doc,.docx"
                className="hidden"
              />
              
              {/* Attachment Button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="absolute right-3 bottom-2.5 p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                title="Allega Documento"
              >
                <UploadCloud className="w-5 h-5" />
              </button>
            </div>

            <button
              type="submit"
              disabled={(!input.trim() && !selectedFile) || isLoading || isFileLoading}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-xl p-3.5 h-[52px] w-[52px] flex items-center justify-center transition-colors shadow-sm"
            >
              {isLoading || isFileLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </form>
          <div className="text-center mt-2">
             <p className="text-xs text-slate-400">
               Sviluppato con Gemini 3.1 Pro. I documenti vengono elaborati in tempo reale.
             </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
