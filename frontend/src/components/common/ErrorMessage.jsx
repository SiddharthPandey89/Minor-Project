import React from 'react';

function ErrorMessage({
  title,
  message,
  className = '',
  onRetry,
  retryLabel = 'Try Again',
  dismissible = false,
  onDismiss,
  variant = 'error',
  icon = true,
  ...props
}) {
  const icons = {
    error: (
      <svg className="error-message__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    ),
    warning: (
      <svg className="error-message__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
    info: (
      <svg className="error-message__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    ),
  };

  const variantClasses = {
    error: 'alert',
    warning: 'alert alert--warning',
    info: 'alert alert--info',
  };

  const classes = [
    variantClasses[variant] || variantClasses.error,
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={classes} role="alert" {...props}>
      {icon && icons[variant]}
      <div className="error-message__content">
        {title && <strong className="error-message__title">{title}</strong>}
        {message && <p className="error-message__message">{message}</p>}
        {(onRetry || onDismiss) && (
          <div className="error-message__actions">
            {onDismiss && dismissible && (
              <button
                type="button"
                className="error-message__dismiss"
                onClick={onDismiss}
                aria-label="Dismiss"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
            {onRetry && (
              <button
                type="button"
                className="analyze-button error-message__retry"
                onClick={onRetry}
              >
                {retryLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default ErrorMessage;