import React, { useState, useRef, useEffect } from 'react';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
}

interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
}

interface ChatProps {
  messages: Message[];
  streamingMessage: string;
  isGenerating: boolean;
  onSend: (content: string) => void;
  onCancel: () => void;
}

export function Chat({ messages, streamingMessage, isGenerating, onSend, onCancel }: ChatProps): React.ReactElement {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingMessage]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isGenerating) return;
    onSend(input.trim());
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const formatTime = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="chat-container">
      <div className="chat-messages">
        {messages.length === 0 && !streamingMessage && (
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg width="64" height="64" viewBox="0 0 32 32" fill="none">
                <defs>
                  <linearGradient id="empty-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#6366f1" />
                    <stop offset="100%" stopColor="#8b5cf6" />
                  </linearGradient>
                </defs>
                <rect width="32" height="32" rx="8" fill="url(#empty-gradient)" />
                <text x="16" y="22" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold">F</text>
              </svg>
            </div>
            <h2>Welcome to FreeClaude</h2>
            <p>Your AI coding assistant powered by GLM-5.1 and more.</p>
            <div className="suggestions">
              <button onClick={() => onSend('Help me understand this codebase')}>
                Help me understand this codebase
              </button>
              <button onClick={() => onSend('Explain this file to me')}>
                Explain this file to me
              </button>
              <button onClick={() => onSend('Show me how to refactor this')}>
                Show me how to refactor this
              </button>
            </div>
          </div>
        )}

        {messages.map(message => (
          <div key={message.id} className={`message message-${message.role}`}>
            <div className="message-header">
              <span className="message-role">
                {message.role === 'user' ? 'You' : message.role === 'assistant' ? 'FreeClaude' : 'Tool'}
              </span>
              <span className="message-time">{formatTime(message.timestamp)}</span>
            </div>
            <div className="message-content">
              <pre className="message-text">{message.content}</pre>
              {message.toolCalls && message.toolCalls.length > 0 && (
                <div className="tool-calls">
                  {message.toolCalls.map(tool => (
                    <div key={tool.id} className="tool-call">
                      <div className="tool-header">
                        <span className="tool-icon">🔧</span>
                        <span className="tool-name">{tool.name}</span>
                      </div>
                      <div className="tool-input">
                        <code>{JSON.stringify(tool.input, null, 2)}</code>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {streamingMessage && (
          <div className="message message-assistant streaming">
            <div className="message-header">
              <span className="message-role">FreeClaude</span>
              <span className="streaming-indicator">▋</span>
            </div>
            <div className="message-content">
              <pre className="message-text">{streamingMessage}</pre>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-container">
        <form onSubmit={handleSubmit} className="chat-input-form">
          <div className="input-wrapper">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask FreeClaude anything..."
              rows={1}
              disabled={isGenerating}
              className="chat-input"
            />
            {isGenerating ? (
              <button
                type="button"
                className="send-button cancel"
                onClick={onCancel}
              >
                <span className="icon">⏹</span>
              </button>
            ) : (
              <button
                type="submit"
                className="send-button"
                disabled={!input.trim()}
              >
                <span className="icon">➤</span>
              </button>
            )}
          </div>
        </form>
        <div className="input-hint">
          Press <kbd>Enter</kbd> to send, <kbd>Shift+Enter</kbd> for new line
        </div>
      </div>
    </div>
  );
}
