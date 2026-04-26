import React, { useState, useCallback } from 'react';
import { Chat } from './components/Chat';
import { Terminal } from './components/Terminal';
import { FileExplorer } from './components/FileExplorer';
import { Settings } from './components/Settings';
import { StatusBar } from './components/StatusBar';
import { Sidebar } from './components/Sidebar';

type View = 'chat' | 'terminal' | 'files' | 'settings';

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

export default function App(): React.ReactElement {
  const [activeView, setActiveView] = useState<View>('chat');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentStreamingMessage, setCurrentStreamingMessage] = useState<string>('');

  const handleSendMessage = useCallback(async (content: string) => {
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMessage]);
    setIsGenerating(true);
    setCurrentStreamingMessage('');

    // Send to FreeClaude bridge
    window.electron.freeclaude.send({
      type: 'message',
      content,
      history: messages.map(m => ({
        role: m.role,
        content: m.content
      }))
    });
  }, [messages]);

  const handleCancel = useCallback(() => {
    window.electron.freeclaude.cancel();
    setIsGenerating(false);
  }, []);

  // Listen for messages from FreeClaude
  React.useEffect(() => {
    const unsubscribe = window.electron.freeclaude.onMessage((data: unknown) => {
      const msg = data as { type: string; content?: string; done?: boolean };

      if (msg.type === 'content') {
        setCurrentStreamingMessage(prev => prev + (msg.content || ''));
      } else if (msg.done) {
        const assistantMessage: Message = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: currentStreamingMessage,
          timestamp: Date.now()
        };
        setMessages(prev => [...prev, assistantMessage]);
        setCurrentStreamingMessage('');
        setIsGenerating(false);
      }
    });

    return () => unsubscribe();
  }, [currentStreamingMessage]);

  const renderView = () => {
    switch (activeView) {
      case 'chat':
        return (
          <Chat
            messages={messages}
            streamingMessage={currentStreamingMessage}
            isGenerating={isGenerating}
            onSend={handleSendMessage}
            onCancel={handleCancel}
          />
        );
      case 'terminal':
        return <Terminal />;
      case 'files':
        return <FileExplorer />;
      case 'settings':
        return <Settings />;
      default:
        return <Chat messages={messages} streamingMessage="" isGenerating={false} onSend={handleSendMessage} onCancel={handleCancel} />;
    }
  };

  return (
    <div className="app">
      <Sidebar activeView={activeView} onViewChange={setActiveView} />
      <main className="main-content">
        {renderView()}
      </main>
      <StatusBar isGenerating={isGenerating} />
    </div>
  );
}
