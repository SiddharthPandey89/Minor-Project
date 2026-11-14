import React from 'react';

/**
 * Reusable button component with consistent styling and variants.
 *
 * @param {object} props
 * @param {'button'|'submit'|'reset'} [props.type='button']
 * @param {'primary'|'secondary'|'ghost'|'danger'} [props.variant='primary']
 * @param {'sm'|'md'|'lg'} [props.size='md']
 * @param {boolean} [props.fullWidth=false]
 * @param {boolean} [props.loading=false]
 * @param {boolean} [props.disabled=false]
 * @param {string} [props.className]
 * @param {string} [props.leftIcon]
 * @param {string} [props.rightIcon]
 * @param {React.ReactNode} [props.children]
 * @param {(event: React.MouseEvent<HTMLButtonElement>) => void} [props.onClick]
 */
const Button = ({
  type = 'button',
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  disabled = false,
  className = '',
  leftIcon,
  rightIcon,
  children,
  onClick,
  ...props
}) => {
  const variantClasses = {
    primary: 'button--primary',
    secondary: 'button--secondary',
    ghost: 'button--ghost',
    danger: 'button--danger',
  };

  const sizeClasses = {
    sm: 'button--sm',
    md: 'button--md',
    lg: 'button--lg',
  };

  const classes = [
    'button',
    variantClasses[variant] || variantClasses.primary,
    sizeClasses[size] || sizeClasses.md,
    fullWidth ? 'button--full' : '',
    loading ? 'button--loading' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || loading}
      onClick={onClick}
      {...props}
    >
      {loading && (
        <span className="button__spinner" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" opacity="0.3" />
            <path
              d="M12 2a10 10 0 0 1 10 10"
              strokeLinecap="round"
            />
          </svg>
        </span>
      )}
      {!loading && leftIcon && <span className="button__icon button__icon--left" aria-hidden="true">{leftIcon}</span>}
      <span className="button__label">{children}</span>
      {!loading && rightIcon && <span className="button__icon button__icon--right" aria-hidden="true">{rightIcon}</span>}
    </button>
  );
};

export default Button;