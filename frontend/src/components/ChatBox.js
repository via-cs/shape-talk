import React, { useState, useRef, useEffect } from 'react';

const ChatBox = ({ user_window_length, setMatchedSegments, setFeatureDescriptions }) => {
  const [messages, setMessages] = useState([
    { id: 1, sender: 'agent', text: 'Instructions: you can query about general statistics regarding the dataset by asking questions such as "What is the mean of this dataset", "Tell me about the outliers of this dataset", "Summarize this dataset for me". You can also Query segments by natural language such as "Show me all segments that rises first then goes down","Select lines that are periodic". For more instructions please type help.', timestamp: new Date() }
  ]);
  const [inputMessage, setInputMessage] = useState('');

  const [showSuggestions, setShowSuggestions] = useState(true);

  const chatHistoryRef = useRef(null);
  const textareaRef = useRef(null);




  const suggestions = [
    'Help',
    'Summarize this dataset',
    'Show me all rising line',
    'Tell me about my sketch',
  ];



  const adjustTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '32px';
      const scrollHeight = textareaRef.current.scrollHeight;
      const singleLineHeight = 32;
      const maxHeight = window.innerHeight * 0.25;
      const newHeight = scrollHeight > singleLineHeight ? Math.min(scrollHeight, maxHeight) : singleLineHeight;
      textareaRef.current.style.height = `${newHeight}px`;
    }
  };

  const RespondMessage = (userInput) => {
    return fetch("http://127.0.0.1:8000/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: userInput, window_length: user_window_length })
    })
    .then(response => response.json())
    .catch(error => {
      console.error("Error:", error);
      return { reply: "Error: Could not reach server." };
    });
  };

  // Accepts optional override text (used by suggestion bubbles)
  const sendMessage = (overrideText) => {
    const text = (typeof overrideText === 'string' ? overrideText : inputMessage).trim();
    if (text === '') return;

    const userMessage = {
      id: Date.now(),
      sender: 'user',
      text,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputMessage('');

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    // Hide suggestions after first send and persist
    if (showSuggestions) setShowSuggestions(false);

    RespondMessage(text).then(agentReply => {
      const agentMessage = {
        id: Date.now() + 1,
        sender: 'agent',
        text: agentReply.reply,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, agentMessage]);
      setMatchedSegments(agentReply['Matched Segments'] || []);
      setFeatureDescriptions(agentReply['Feature Descriptions'] || '');
    });
  };

  const handleChatInputChange = (e) => {
    const val = e.target.value;
    setInputMessage(val);
    // do not hide suggestions just from typing, only hide after sending
    adjustTextareaHeight();
  };

  const handleChatKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleSuggestionClick = (text) => {
    sendMessage(text);
    setShowSuggestions(false); // persists via effect
  };

  useEffect(() => {
    if (chatHistoryRef.current) {
      chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    adjustTextareaHeight();
  }, [inputMessage]);


  // Shared style + hover handlers so all chips look identical
  const chipStyle = {
    border: '1px solid #444a57',
    backgroundColor: '#23272f',
    color: '#e7eef7',
    borderRadius: '999px',
    padding: '12px 20px',
    cursor: 'pointer',
    fontSize: '1.05em',
    fontWeight: 500,
    lineHeight: 1.3,
    transition: 'transform 0.08s ease, background-color 0.15s ease, border-color 0.15s ease'
  };

  const onChipEnter = (e) => {
    e.currentTarget.style.backgroundColor = '#2b313a';
    e.currentTarget.style.borderColor = '#5a7a9a';
  };
  const onChipLeave = (e) => {
    e.currentTarget.style.backgroundColor = '#23272f';
    e.currentTarget.style.borderColor = '#444a57';
  };


  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: '#2E343A',
      borderRight: '1px solid #444a57',
      borderRadius: '16px',
      overflow: 'hidden'
    }}>
      {/* Chat History */}
      <div 
        ref={chatHistoryRef}
        style={{ 
          flex: '1', 
          padding: '20px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '15px',
          minHeight: 0
        }}
      >
        {messages.map((message) => (
          <div 
            key={message.id}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              justifyContent: message.sender === 'user' ? 'flex-end' : 'flex-start'
            }}
          >
            {message.sender === 'agent' && (
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                backgroundColor: '#42657E',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                flexShrink: 0
              }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style={{ transform: 'translate(-1px, 4px)' }}>
                  <path d="M8 6C8 4.9 8.9 4 10 4H14C15.1 4 16 4.9 16 6V12C16 13.1 15.1 14 14 14H10C8.9 14 8 13.1 8 12V6Z" stroke="currentColor" strokeWidth="2" fill="none"/>
                  <rect x="6" y="8" width="2" height="4" rx="1" fill="currentColor"/>
                  <rect x="16" y="8" width="2" height="4" rx="1" fill="currentColor"/>
                  <line x1="12" y1="2" x2="12" y2="4" stroke="currentColor" strokeWidth="2"/>
                  <circle cx="12" cy="2" r="1" fill="currentColor"/>
                  <circle cx="10" cy="8" r="1" fill="currentColor"/>
                  <path d="M10 12Q12 14 14 12" stroke="currentColor" strokeWidth="2" fill="none"/>
                </svg>
              </div>
            )}
            
            <div style={{
              maxWidth: '70%',
              padding: '12px 16px',
              borderRadius: '18px',
              backgroundColor: message.sender === 'user' ? '#42657E' : '#2E343A',
              color: 'white',
              border: message.sender === 'agent' ? '1px solid #444a57' : 'none',
              wordWrap: 'break-word',
              fontSize: '1.2em',
              lineHeight: '1.4'
            }}>
              {message.text}
            </div>

            {message.sender === 'user' && (
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                backgroundColor: '#42657E',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                flexShrink: 0
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 12C14.21 12 16 10.21 16 8C16 5.79 14.21 4 12 4C9.79 4 8 5.79 8 8C8 10.21 9.79 12 12 12ZM12 14C9.33 14 4 15.34 4 18V20H20V18C20 15.34 14.67 14 12 14Z"/>
                </svg>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Input Area */}
      <div style={{ 
        padding: '20px',
        borderTop: '1px solid #444a57',
        backgroundColor: '#2E343A',
        flexShrink: 0,
        minHeight: '60px'
      }}>

        {/* Toggle to restore suggestions when hidden */}
        {!showSuggestions && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '10px' }}>
            <button
              onClick={() => setShowSuggestions(true)}
              aria-label="Show suggestions"
              style={chipStyle}
              onMouseEnter={onChipEnter}
              onMouseLeave={onChipLeave}
            >
              Suggestions
            </button>
          </div>
        )}

        {/* Suggestion Bubbles */}
        {showSuggestions && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '12px 14px',
              marginBottom: '16px',
              justifyContent: 'center'
            }}
          >
          {suggestions.map((s, idx) => (
            <button
              key={idx}
              onClick={() => handleSuggestionClick(s)}
              style={chipStyle}
              onMouseEnter={onChipEnter}
              onMouseLeave={onChipLeave}
              aria-label={`Send: ${s}`}
            >
              {s}
            </button>
          ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
          <textarea
            ref={textareaRef}
            value={inputMessage}
            onChange={handleChatInputChange}
            onKeyPress={handleChatKeyPress}
            onFocus={(e) => e.target.style.borderColor = '#42657E'}
            onBlur={(e) => e.target.style.borderColor = '#444a57'}
            placeholder="Type your message..."
            style={{
              flex: '1',
              padding: '12px 16px 0px 16px',
              borderRadius: '20px',
              border: '1px solid #444a57',   // <- fixed
              backgroundColor: '#23272f',
              color: 'white',
              fontSize: '1.2em',
              outline: 'none',
              userSelect: 'text',
              cursor: 'text',
              resize: 'none',
              minHeight: '20px',
              maxHeight: '25vh',
              overflowY: 'auto',
              overflowX: 'hidden',
              wordWrap: 'break-word',
              whiteSpace: 'pre-wrap',
              fontFamily: 'inherit',
              lineHeight: '1.4'
            }}
          />

          <button
            onClick={() => sendMessage()}
            style={{
              width: '54px',
              height: '54px',
              borderRadius: '50%',
              border: 'none',
              backgroundColor: '#42657E',
              color: 'white',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background-color 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#5a7a9a'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#42657E'}
            aria-label="Send message"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" fill="currentColor"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatBox;
