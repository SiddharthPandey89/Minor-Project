import React from 'react';

function EmptyState({
  title,
  message,
  icon,
  className = '',
  action,
  actionLabel,
  illustration = 'default',
  size = 'md',
  ...props
}) {
  const illustrations = {
    default: (
      <svg className="empty-state__illustration" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <circle cx="32" cy="32" r="28" opacity="0.3" />
        <path d="M32 16v20M32 36v12M16 32h20M36 32h12" strokeLinecap="round" />
      </svg>
    ),
    search: (
      <svg className="empty-state__illustration" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <circle cx="32" cy="32" r="20" opacity="0.3" />
        <path d="M44 44l14 14" strokeLinecap="round" />
        <path d="M32 20v20M32 40v12M20 32h20M40 32h12" strokeLinecap="round" opacity="0.5" />
      </svg>
    ),
    location: (
      <svg className="empty-state__illustration" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="M32 8C22.7 8 15 15.7 15 25c0 7.2 6.5 14.8 15 22 8.5-7.2 15-14.8 15-22C49 15.7 41.3 8 32 8z" opacity="0.3" />
        <circle cx="32" cy="25" r="5" />
      </svg>
    ),
    data: (
      <svg className="empty-state__illustration" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <rect x="10" y="12" width="44" height="40" rx="3" opacity="0.3" />
        <path d="M18 22h28M18 32h20M18 42h14" strokeLinecap="round" />
      </svg>
    ),
    chart: (
      <svg className="empty-state__illustration" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="M14 48h36v-36" opacity="0.3" />
        <path d="M18 42L28 28L38 34L48 20" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="18" cy="42" r="3" />
        <circle cx="28" cy="28" r="3" />
        <circle cx="38" cy="34" r="3" />
        <circle cx="48" cy="20" r="3" />
      </svg>
    ),
  };

  const sizeClasses = {
    sm: 'empty-state--sm',
    md: 'empty-state--md',
    lg: 'empty-state--lg',
  };

  const classes = [
    'empty-state',
    sizeClasses[size] || sizeClasses.md,
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={classes} {...props}>
      <div className="empty-state__icon-wrapper">
        {icon || illustrations[illustration] || illustrations.default}
      </div>
      {title && <h3 className="empty-state__title">{title}</h3>}
      {message && <p className="empty-state__message">{message}</p>}
      {action && actionLabel && (
        <button type="button" className="analyze-button empty-state__action" onClick={action}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export default EmptyState;