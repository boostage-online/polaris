'use client';
import Link from 'next/link';
import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useEffect,
} from 'react';
import { ApiError } from '@/lib/api';

/** Petit kit d'interface : suffisant pour les écrans de gestion, sans dépendance supplémentaire. */

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
}) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition disabled:cursor-not-allowed disabled:opacity-50';
  const sizes = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm';
  const variants = {
    primary: 'bg-[var(--color-brand)] text-white hover:bg-[var(--color-brand-dark)]',
    secondary: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
    danger: 'border border-red-200 bg-white text-red-700 hover:bg-red-50',
    ghost: 'text-slate-700 hover:bg-slate-100',
  }[variant];
  return <button className={cx(base, sizes, variants, className)} {...props} />;
}

export function LinkButton({
  href,
  children,
  variant = 'secondary',
}: {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary';
}) {
  const cls =
    variant === 'primary'
      ? 'bg-[var(--color-brand)] text-white hover:bg-[var(--color-brand-dark)]'
      : 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50';
  return (
    <Link
      href={href}
      className={cx('inline-flex items-center rounded-md px-3.5 py-2 text-sm font-medium', cls)}
    >
      {children}
    </Link>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx('block text-sm', className)}>
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

const control =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[var(--color-brand)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]/20 disabled:bg-slate-50';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(control, props.className)} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(control, props.className)} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(control, 'font-mono text-xs', props.className)} />;
}

export function Card({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('rounded-lg border border-slate-200 bg-white', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <h2 className="font-medium">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Badge({
  children,
  tone = 'slate',
}: {
  children: ReactNode;
  tone?: 'slate' | 'green' | 'amber' | 'red' | 'blue';
}) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-800',
    red: 'bg-red-50 text-red-700',
    blue: 'bg-sky-50 text-sky-700',
  }[tone];
  return (
    <span className={cx('inline-block rounded px-1.5 py-0.5 text-xs font-medium', tones)}>
      {children}
    </span>
  );
}

export function Alert({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'error' | 'success' | 'warning';
  children: ReactNode;
}) {
  const tones = {
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    error: 'border-red-200 bg-red-50 text-red-800',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
  }[tone];
  return <div className={cx('rounded-md border px-3 py-2 text-sm', tones)}>{children}</div>;
}

/** Message d'erreur lisible depuis une erreur API (RFC 9457) ou autre. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const errors = (err.problem as { errors?: { path?: string; message: string }[] }).errors;
    if (errors?.length)
      return errors.map((e) => (e.path ? `${e.path} : ${e.message}` : e.message)).join(' · ');
    return err.problem.detail ?? err.problem.title;
  }
  if (err instanceof Error) return err.message;
  return 'Erreur inattendue';
}

export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  return <Alert tone="error">{errorMessage(error)}</Alert>;
}

export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
          <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:font-medium">{head}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100 [&>tr>td]:px-2 [&>tr>td]:py-2">
          {children}
        </tbody>
      </table>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-slate-500">{children}</p>;
}

export function Loading() {
  return <p className="py-6 text-center text-sm text-slate-400">Chargement…</p>;
}

export function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: 'amber' | 'red';
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={cx(
          'mt-1 text-2xl font-semibold',
          tone === 'amber' && 'text-amber-700',
          tone === 'red' && 'text-red-700',
        )}
      >
        {value}
      </p>
    </div>
  );
}

/** Boîte de dialogue simple (sans portail) : fermeture par Échap ou clic sur le fond. */
export function Modal({
  open,
  title,
  onClose,
  children,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-16"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx('w-full rounded-lg bg-white shadow-xl', wide ? 'max-w-3xl' : 'max-w-lg')}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="font-medium">{title}</h2>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-800"
            aria-label="Fermer"
          >
            ✕
          </button>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <nav className="mb-4 flex gap-1 border-b border-slate-200" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === value}
          onClick={() => onChange(t.id)}
          className={cx(
            '-mb-px border-b-2 px-3 py-2 text-sm',
            t.id === value
              ? 'border-[var(--color-brand)] font-medium text-[var(--color-brand)]'
              : 'border-transparent text-slate-600 hover:text-slate-900',
          )}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}
