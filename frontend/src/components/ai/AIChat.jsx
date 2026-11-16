import React, { useCallback, useEffect, useRef, useState } from 'react';
import { chatWithAI } from '../../services/aiService.js';
import AIMessage from './AIMessage.jsx';
import Card from '../common/Card.jsx';
import Loader from '../common/Loader.jsx';
import ErrorMessage from '../common/ErrorMessage.jsx';
import Button from '../common/Button.jsx';

const AIChat = ({ context, className = '' }) => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (messages.length === 0) {
      const available = [];
      if (context?.weather?.status === 'available') available.push('weather');
      if (context?.soil?.status === 'available') available.push('soil');
      if (context?.vegetation?.status === 'available') available.push('vegetation');
      if (context?.habitability?.assessment) available.push('habitability');
      const welcome = `Hello! I can help you interpret the environmental analysis results for this location. Available data: ${available.length > 0 ? available.join(', ') : 'none'}.

Ask me about soil properties, vegetation (NDVI), weather conditions, or habitability.`;
      setMessages([{ text: welcome, isUser: false }]);
    }
  }, [context, messages.length]);

  const handleSend = useCallback(async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const userMsg = { text, isUser: true };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setError(null);
    setLoading(true);

    try {
      const data = await chatWithAI({ message: text, context });
      setMessages((prev) => [...prev, { text: data.response || 'No response.', isUser: false }]);
    } catch (err) {
      setError(err.message || 'The AI chat request failed.');
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.focus();
    }
  }, [input, loading, context]);

  const handleInputChange = useCallback((e) => {
    setInput(e.target.value);
    setError(null);
  }, []);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  }, [handleSend]);

  return (
    <Card className={`ai-chat ${className}`} padding bordered elevated>
      <Card.Header>
        <div>
          <p className="eyebrow">AI ASSISTANT</p>
          <h2>Analysis chat</h2>
        </div>
      </Card.Header>
      <Card.Body className="ai-chat__body">
        <div className="ai-chat__messages">
          {messages.map((msg, index) => (
            <AIMessage key={index} message={msg.text} isUser={msg.isUser} />
          ))}
          {loading && (
            <div className="aimessage aimessage--assistant">
              <div className="aimessage__bubble aimessage__bubble--assistant">
                <Loader inline size="sm" label="Thinking…" />
              </div>
            </div>
          )}
        </div>
        {error && <ErrorMessage title="Chat error" message={error} onRetry={() => setError(null)} />}
        <form className="ai-chat__form" onSubmit={handleSend}>
          <textarea
            ref={inputRef}
            className="ai-chat__input"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask about soil, vegetation, weather, or habitability…"
            rows={3}
            disabled={loading}
          />
          <Button type="submit" variant="primary" disabled={loading || !input.trim()}>
            Send
          </Button>
        </form>
      </Card.Body>
      <Card.Footer>
        <p className="ai-chat__hint">Responses are generated from available analysis data; no external AI service is used.</p>
      </Card.Footer>
    </Card>
  );
};

export default AIChat;
