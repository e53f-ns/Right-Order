import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface AIResponse {
  success?: boolean;
  response?: string;  // backend sends 'response'
  content?: string;   // fallback field name
  sessionId?: string;
  tokensUsed?: number;
  model?: string;
  error?: string;
  rateLimited?: boolean;
  retryAfter?: number;
}

export function AIChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rateLimited, setRateLimited] = useState(false);
  const [retryCountdown, setRetryCountdown] = useState(0);
  const [lastQuery, setLastQuery] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Start countdown timer for rate limit
  const startCountdown = (seconds: number) => {
    setRetryCountdown(seconds);
    setRateLimited(true);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setRetryCountdown(prev => {
        if (prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          setRateLimited(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const doSend = async (query: string, addUserMsg: boolean) => {
    if (!query.trim() || isLoading) return;

    if (addUserMsg) {
      const userMessage: Message = {
        id: `user_${Date.now()}`,
        role: 'user',
        content: query.trim(),
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, userMessage]);
    }

    setLastQuery(query.trim());
    setInput('');
    setIsLoading(true);
    setError(null);
    setRateLimited(false);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: query.trim(), sessionId }),
      });

      if (res.status === 429) {
        setError('OpenAI rate limit reached. Retrying in 60s...');
        startCountdown(60);
        setIsLoading(false);
        return;
      }

      if (!res.ok) throw new Error(`API error: ${res.status}`);

      const data = await res.json() as AIResponse;

      // Handle rate limit forwarded from backend
      if (data.rateLimited) {
        const wait = data.retryAfter ?? 60;
        setError(`OpenAI rate limit reached. Retrying in ${wait}s...`);
        startCountdown(wait);
        setIsLoading(false);
        return;
      }

      if (data.sessionId) setSessionId(data.sessionId);

      const raw = data.response ?? data.content;
      const safeContent = typeof raw === 'string'
        ? raw
        : (raw != null ? JSON.stringify(raw) : 'No response from AI.');

      // Show response even if error (backend sends user-facing content)
      if (safeContent) {
        setMessages(prev => [...prev, {
          id: `assistant_${Date.now()}`,
          role: 'assistant',
          content: safeContent,
          timestamp: Date.now(),
        }]);
      }

      if (data.error && !data.rateLimited) {
        setError(typeof data.error === 'string' ? data.error : 'AI request failed');
      } else {
        setError(null);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send message';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;
    await doSend(input, true);
  };

  const retryLastMessage = () => {
    if (lastQuery && !isLoading) {
      void doSend(lastQuery, false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setSessionId(null);
    setError(null);
    setRateLimited(false);
    setRetryCountdown(0);
    setLastQuery('');
    if (countdownRef.current) clearInterval(countdownRef.current);
  };

  return (
    <div className="flex flex-col h-[600px] bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card/50">
        <div>
          <h2 className="font-semibold">AI Assistant</h2>
          <p className="text-xs text-muted-foreground">Powered by GPT-4o-mini</p>
        </div>
        <button
          onClick={clearChat}
          className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
        >
          Clear Chat
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-4xl mb-4 opacity-50">AI</div>
            <h3 className="text-lg font-medium mb-2">Right Order AI Assistant</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Ask about arbitrage spreads, funding rates, wallet analysis, or trading strategies.
              I have access to real-time dashboard data.
            </p>
            <div className="mt-6 flex flex-wrap gap-2 justify-center">
              {[
                "Show top spreads",
                "Analyze funding rates",
                "Best opportunities now?",
                "Explain triangular arb",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => setInput(suggestion)}
                  className="px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded-full transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((message) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-xl px-4 py-3 ${
                  message.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted'
                }`}
              >
                <div className="text-sm whitespace-pre-wrap prose prose-invert prose-sm max-w-none">
                  {typeof message.content === 'string' ? message.content : String(message.content ?? '')}
                </div>
                <div className={`text-xs mt-2 ${
                  message.role === 'user' ? 'text-primary-foreground/60' : 'text-muted-foreground'
                }`}>
                  {typeof message.timestamp === 'number' ? new Date(message.timestamp).toLocaleTimeString() : ''}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {isLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex justify-start"
          >
            <div className="bg-muted rounded-xl px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-xs text-muted-foreground">Thinking...</span>
              </div>
            </div>
          </motion.div>
        )}

        {error && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-3 text-sm"
          >
            <div className="flex items-center justify-between gap-3">
              <span>{typeof error === 'string' ? error : String(error ?? '')}</span>
              {rateLimited && retryCountdown > 0 ? (
                <span className="text-xs whitespace-nowrap opacity-70">Retry in {retryCountdown}s</span>
              ) : (
                <button
                  onClick={retryLastMessage}
                  disabled={isLoading || !lastQuery}
                  className="px-3 py-1 text-xs bg-red-500/20 hover:bg-red-500/30 rounded transition-colors whitespace-nowrap disabled:opacity-40"
                >
                  Retry
                </button>
              )}
            </div>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-border">
        <div className="flex gap-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about spreads, funding rates, or strategies..."
            className="flex-1 bg-muted border-0 rounded-lg px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
            rows={1}
            disabled={isLoading}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isLoading}
            className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
