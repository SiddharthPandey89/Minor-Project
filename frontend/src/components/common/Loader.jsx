import React from 'react';

function Loader({
  size = 'md',
  inline = false,
  label,
  className = '',
  ...props
}) {
  const sizeClasses = {
    sm: 'loader--sm',
    md: 'loader--md',
    lg: 'loader--lg',
    xl: 'loader--xl',
  };

  const classes = [
    'loader',
    sizeClasses[size] || sizeClasses.md,
    inline ? 'loader--inline' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={classes} {...props} role="status" aria-live="polite" aria-label={label || 'Loading'}>
      <svg className="loader__spinner" viewBox="0 0 50 50" aria-hidden="true">
        <circle
          className="loader__track"
          cx="25"
          cy="25"
          r="20"
          fill="none"
          strokeWidth="4"
        />
        <circle
          className="loader__indicator"
          cx="25"
          cy="25"
          r="20"
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray="80 160"
        />
      </svg>
      {label && <span className="loader__label">{label}</span>}
    </div>
  );
}

Loader.Dots = function LoaderDots({ className = '', size = 'md', ...props }) {
  const sizeClasses = {
    sm: 'loader-dots--sm',
    md: 'loader-dots--md',
    lg: 'loader-dots--lg',
  };
  return (
    <div className={`loader-dots ${sizeClasses[size] || sizeClasses.md} ${className}`} {...props} role="status" aria-live="polite">
      <span className="loader-dots__dot" />
      <span className="loader-dots__dot" />
      <span className="loader-dots__dot" />
    </div>
  );
};

Loader.Bar = function LoaderBar({ className = '', ...props }) {
  return (
    <div className={`loader-bar ${className}`} {...props} role="progressbar" aria-valuemin={0} aria-valuemax={100}>
      <div className="loader-bar__fill" />
    </div>
  );
};

export default Loader;