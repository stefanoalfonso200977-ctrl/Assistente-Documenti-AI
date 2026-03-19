import { useState, useRef, useEffect } from "react";
import { UploadCloud, FileText, Send, Loader2, Bot, User, Trash2, LogIn, LogOut, Menu, Plus, MessageSquare } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { GoogleGenAI } from "@google/genai";
import { auth, db, googleProvider } from "./firebase";
import { signInWithPopup, signOut, onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { collection, query, where, orderBy, onSnapshot, addDoc, updateDoc, doc, deleteDoc } from "firebase/firestore";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachedFile?: {
    name: string;
    mimeType: string;
    base64: string;
  };
  hasAttachment?: boolean;
  attachmentName?: string;
}

interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileBase64, setFileBase64] = useState<string | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auth State Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Fetch Chats
  useEffect(() => {
    if (!user) {
      setChats([]);
      return;
    }
    const q = query(
      collection(db, "chats"),
      where("userId", "==", user.uid),
      orderBy("updatedAt", "desc")
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedChats = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ChatSession[];
      setChats(fetchedChats);
    }, (error) => {
      console.error("Firestore error:", error);
    });
    return () => unsubscribe();
  }, [user]);

  // Auto-scroll to bottom internally
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login error:", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setCurrentChatId(null);
      setMessages([]);
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const createNewChat = () => {
    setCurrentChatId(null);
    setMessages([]);
    removeFile();
    setIsSidebarOpen(false);
  };

  const loadChat = (chat: ChatSession) => {
    setCurrentChatId(chat.id);
    setMessages(chat.messages.map(m => ({
      ...m,
      ...(m.hasAttachment ? { attachedFile: { name: m.attachmentName || "Documento", mimeType: "", base64: "" } } : {})
    })));
    removeFile();
    setIsSidebarOpen(false);
  };

  const deleteChat = async (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation();
    try {
      await deleteDoc(doc(db, "chats", chatId));
      if (currentChatId === chatId) {
        createNewChat();
      }
    } catch (error) {
      console.error("Delete error:", error);
    }
  };

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

    const newMessages = [...messages, newMessage];
    setMessages(newMessages);
    setInput("");
    removeFile();
    setIsLoading(true);

    let activeChatId = currentChatId;
    const title = newMessages[0].text.slice(0, 40) || "Nuova Chat";

    // Save user message to Firestore
    if (user) {
      const firestoreMessages = newMessages.map(m => ({
        id: m.id,
        role: m.role,
        text: m.text,
        hasAttachment: !!m.attachedFile,
        attachmentName: m.attachedFile?.name || null
      }));
      
      try {
        if (!activeChatId) {
          const docRef = await addDoc(collection(db, "chats"), {
            userId: user.uid,
            title: title,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messages: firestoreMessages
          });
          activeChatId = docRef.id;
          setCurrentChatId(docRef.id);
        } else {
          await updateDoc(doc(db, "chats", activeChatId), {
            updatedAt: new Date().toISOString(),
            messages: firestoreMessages
          });
        }
      } catch (error) {
        console.error("Error saving chat:", error);
      }
    }

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

      const contents = newMessages.map((msg) => {
        const parts: any[] = [];
        if (msg.attachedFile && msg.attachedFile.base64) {
          parts.push({
            inlineData: {
              data: msg.attachedFile.base64,
              mimeType: msg.attachedFile.mimeType,
            },
          });
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
        model: "gemini-3-flash-preview",
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

      // Save assistant message to Firestore
      if (user && activeChatId) {
        const finalMessages = [...newMessages, { id: assistantMessageId, role: "assistant", text: assistantText }];
        const firestoreMessages = finalMessages.map(m => ({
          id: m.id,
          role: m.role,
          text: m.text,
          hasAttachment: !!m.attachedFile,
          attachmentName: m.attachedFile?.name || null
        }));
        await updateDoc(doc(db, "chats", activeChatId), {
          updatedAt: new Date().toISOString(),
          messages: firestoreMessages
        });
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

  if (!isAuthReady) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] bg-slate-50 font-sans overflow-hidden">
      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setIsSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 text-white transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0 transition-transform duration-200 ease-in-out flex flex-col`}>
        <div className="p-4 border-b border-slate-800">
          <button onClick={createNewChat} className="w-full flex items-center justify-center space-x-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 py-2 transition-colors">
            <Plus className="w-5 h-5" />
            <span>Nuova Chat</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {chats.map(chat => (
            <div key={chat.id} className={`group flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors ${currentChatId === chat.id ? 'bg-slate-800' : 'hover:bg-slate-800'}`} onClick={() => loadChat(chat)}>
              <div className="flex items-center space-x-2 overflow-hidden">
                <MessageSquare className="w-4 h-4 text-slate-400 flex-shrink-0" />
                <span className="truncate text-sm text-slate-300">{chat.title}</span>
              </div>
              <button onClick={(e) => deleteChat(e, chat.id)} className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-red-400 transition-opacity">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          {chats.length === 0 && user && (
            <div className="text-center text-slate-500 text-sm mt-4">
              Nessuna chat recente
            </div>
          )}
          {!user && (
            <div className="text-center text-slate-500 text-sm mt-4 px-4">
              Accedi per salvare le tue chat
            </div>
          )}
        </div>
        <div className="p-4 border-t border-slate-800">
          {user ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 overflow-hidden">
                <img src={user.photoURL || ""} alt="Avatar" className="w-8 h-8 rounded-full" />
                <span className="truncate text-sm text-slate-300">{user.displayName}</span>
              </div>
              <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-white transition-colors" title="Esci">
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <button onClick={handleLogin} className="w-full flex items-center justify-center space-x-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg px-4 py-2 transition-colors">
              <LogIn className="w-5 h-5" />
              <span>Accedi con Google</span>
            </button>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-[100dvh] min-w-0">
        {/* Header */}
        <header className="bg-white border-b border-slate-200 px-4 sm:px-6 py-4 flex items-center justify-between shadow-sm z-10">
          <div className="flex items-center">
            <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="md:hidden mr-4 p-2 text-slate-500 hover:bg-slate-100 rounded-lg">
              <Menu className="w-6 h-6" />
            </button>
            <div className="bg-indigo-600 p-2 rounded-lg mr-3 hidden sm:block">
              <FileText className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-slate-800">
                Assistente Documenti
              </h1>
              <p className="text-sm text-slate-500 hidden sm:block">
                Carica un documento e fai domande sul suo contenuto
              </p>
            </div>
          </div>
        </header>

        {/* Chat Area */}
        <main ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 sm:p-6 scroll-smooth">
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
                {!user && (
                  <p className="text-sm text-indigo-600 mt-4">
                    Accedi per salvare la cronologia delle tue chat.
                  </p>
                )}
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
                 Sviluppato con Gemini 3 Flash. I documenti vengono elaborati in tempo reale.
               </p>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
