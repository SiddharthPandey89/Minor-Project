import React from 'react';

const AIMessage = ({ message, isUser = false, className = '' }) => {
  const bubbleClass = isUser ? 'aimessage__bubble aimessage__bubble--user' : 'aimessage__bubble aimessage__bubble--assistant';
  const alignClass = isUser ? 'aimessage--user' : 'aimessage--assistant';

  return (
    <div className={`aimessage ${alignClass} ${className}`}>
      <div className={bubbleClass}>{message}</div>
    </div>
  );
};

export default AIMessage;
