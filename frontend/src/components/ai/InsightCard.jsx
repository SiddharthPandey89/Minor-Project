import React from 'react';

const InsightCard = ({ title, value, subtitle, tone = 'info', className = '' }) => {
  const toneClasses = {
    info: 'insight--info',
    success: 'insight--success',
    warning: 'insight--warning',
    danger: 'insight--danger',
  };

  return (
    <div className={`insight-card ${toneClasses[tone] || toneClasses.info} ${className}`}>
      <div className="insight-card__value">{value}</div>
      <div className="insight-card__label">{title}</div>
      {subtitle && <div className="insight-card__subtitle">{subtitle}</div>}
    </div>
  );
};

export default InsightCard;
