import React from 'react';

function Card({
  children,
  className = '',
  padding = true,
  bordered = true,
  elevated = false,
  variant = 'default',
  ...props
}) {
  const baseClasses = ['panel'];

  if (padding) baseClasses.push('panel--padded');
  if (bordered) baseClasses.push('panel--bordered');
  if (elevated) baseClasses.push('panel--elevated');
  if (variant !== 'default') baseClasses.push(`panel--${variant}`);
  if (className) baseClasses.push(className);

  return (
    <div className={baseClasses.join(' ')} {...props}>
      {children}
    </div>
  );
}

Card.Panel = function Panel({ children, className = '', ...props }) {
  return <Card className={className} padding={false} bordered={false} {...props}>{children}</Card>;
};

Card.Header = function Header({ children, className = '', ...props }) {
  return <div className={`panel-heading ${className}`} {...props}>{children}</div>;
};

Card.Body = function Body({ children, className = '', ...props }) {
  return <div className={`panel-body ${className}`} {...props}>{children}</div>;
};

Card.Footer = function Footer({ children, className = '', ...props }) {
  return <div className={`panel-footer ${className}`} {...props}>{children}</div>;
};

export default Card;