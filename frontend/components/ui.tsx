import type { ButtonHTMLAttributes, ComponentProps, HTMLAttributes, ReactNode } from 'react';

// These components use the existing shared classes, so legacy callers use the same system.
export function Button({ variant = 'secondary', size = 'medium', loading = false, disabled, className = '', children, ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'small' | 'medium' | 'large'; loading?: boolean }) {
  return <button type="button" {...props} className={`button ${variant} button-${size} ${className}`}
    disabled={disabled || loading} aria-busy={loading || undefined}>{children}</button>;
}

export function Input(props: ComponentProps<'input'>) { return <input {...props} className={`ui-input ${props.className || ''}`} />; }
export function Select(props: ComponentProps<'select'>) { return <select {...props} className={`ui-select ${props.className || ''}`} />; }

export function FormField({ id, label, required, description, error, children }: {
  id: string; label: string; required?: boolean; description?: ReactNode; error?: string; children: ReactNode;
}) {
  return <div className="form-field">
    <label htmlFor={id}>{label}{required ? <span className="required" aria-hidden="true"> *</span> : null}</label>
    {children}
    {description ? <small id={`${id}-description`}>{description}</small> : null}
    {error ? <small id={`${id}-error`} className="field-error" role="alert">{error}</small> : null}
  </div>;
}

export function Card({ variant = 'default', className = '', ...props }: HTMLAttributes<HTMLDivElement> & { variant?: 'default' | 'secondary' | 'interactive' }) {
  return <div {...props} className={`ui-card ui-card-${variant} ${className}`} />;
}

export function PageContainer({ size = 'standard', className = '', ...props }: ComponentProps<'div'> & { size?: 'narrow' | 'standard' | 'wide' | 'full' }) {
  return <div {...props} className={`page-container page-container-${size} ${className}`} />;
}

export function PageHeader({ id, title, description }: { id?: string; title: string; description?: string }) {
  return <header className="ui-page-header"><h1 id={id}>{title}</h1>{description ? <p>{description}</p> : null}</header>;
}

export function Breadcrumb({ children }: { children: ReactNode }) { return <nav className="breadcrumb" aria-label="面包屑">{children}</nav>; }
