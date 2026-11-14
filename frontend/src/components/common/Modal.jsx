import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Button from './Button.jsx';

/**
 * Reusable modal dialog component with backdrop, focus management, and
 * keyboard support (Escape to close).
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {(event: React.MouseEvent) => void} props.onClose
 * @param {string} [props.title]
 * @param {string} [props.description]
 * @param {'sm'|'md'|'lg'|'xl'} [props.size='md']
 * @param {boolean} [props.closeOnBackdrop=true]
 * @param {boolean} [props.closeOnEscape=true]
 * @param {boolean} [props.showFooter=true]
 * @param {React.ReactNode} [props.children]
 * @param {React.ReactNode} [props.footer]
 * @param {string} [props.className]
 */
const Modal = ({
  open,
  onClose,
  title,
  description,
  size = 'md',
  closeOnBackdrop = true,
  closeOnEscape = true,
  showFooter = true,
  children,
  footer,
  className = '',
  ...props
}) => {
  const overlayRef = useRef(null);
  const contentRef = useRef(null);

  useEffect(() => {
    if (!open) return;

    const handleEscape = (event) => {
      if (event.key === 'Escape' && closeOnEscape) {
        onClose(event);
      }
    };

    const previousActiveElement = document.activeElement;
    document.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';

    // Focus the modal content for accessibility
    const focusTimer = window.setTimeout(() => {
      contentRef.current?.focus();
    }, 0);

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
      window.clearTimeout(focusTimer);
      if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
        previousActiveElement.focus();
      }
    };
  }, [open, onClose, closeOnEscape]);

  if (!open) return null;

  const sizeClasses = {
    sm: 'modal--sm',
    md: 'modal--md',
    lg: 'modal--lg',
    xl: 'modal--xl',
  };

  const handleBackdropClick = (event) => {
    if (closeOnBackdrop && event.target === overlayRef.current) {
      onClose(event);
    }
  };

  const defaultFooter = (
    <div className="modal__footer-actions">
      <Button variant="ghost" onClick={onClose}>
        Close
      </Button>
    </div>
  );

  return createPortal(
    <div
      className="modal__overlay"
      ref={overlayRef}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'modal-title' : undefined}
      aria-describedby={description ? 'modal-description' : undefined}
      {...props}
    >
      <div
        className={`modal ${sizeClasses[size] || sizeClasses.md} ${className}`}
        ref={contentRef}
        tabIndex={-1}
        role="document"
      >
        <div className="modal__header">
          <div>
            {title && (
              <h2 className="modal__title" id="modal-title">
                {title}
              </h2>
            )}
            {description && (
              <p className="modal__description" id="modal-description">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            className="modal__close"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {showFooter && (footer !== null && footer !== undefined ? footer : defaultFooter)}
      </div>
    </div>,
    document.body,
  );
};

export default Modal;