'use client'

/**
 * Small shared visual primitives for the grader UI. Every color/spacing
 * value here reads from the CSS custom properties defined in
 * app/grader/grader-theme.css — nothing is a hardcoded hex value scattered
 * through a component (Task 32).
 */

import type { ReactNode } from 'react'

const TONE_STYLES = {
  success: { color: 'var(--grader-success)', border: 'color-mix(in srgb, var(--grader-success) 40%, transparent)', bg: 'color-mix(in srgb, var(--grader-success) 12%, transparent)' },
  accent: { color: 'var(--grader-accent-soft)', border: 'color-mix(in srgb, var(--grader-accent) 40%, transparent)', bg: 'color-mix(in srgb, var(--grader-accent) 12%, transparent)' },
  warning: { color: 'var(--grader-warning)', border: 'color-mix(in srgb, var(--grader-warning) 40%, transparent)', bg: 'color-mix(in srgb, var(--grader-warning) 12%, transparent)' },
  danger: { color: 'var(--grader-danger)', border: 'color-mix(in srgb, var(--grader-danger) 40%, transparent)', bg: 'color-mix(in srgb, var(--grader-danger) 12%, transparent)' },
  muted: { color: 'var(--grader-muted-foreground)', border: 'var(--grader-border)', bg: 'transparent' },
} as const

export type Tone = keyof typeof TONE_STYLES

export function Pill({ tone = 'muted', children }: { tone?: Tone; children: ReactNode }) {
  const t = TONE_STYLES[tone]
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold tracking-wide"
      style={{ color: t.color, borderColor: t.border, backgroundColor: t.bg }}
    >
      {children}
    </span>
  )
}

/** Non-color status indicator (Task 35: never rely on color alone). */
export function StatusDot({ tone }: { tone: Tone }) {
  const glyph = tone === 'success' ? '✓' : tone === 'danger' ? '✕' : tone === 'warning' ? '!' : '–'
  const t = TONE_STYLES[tone]
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
      style={{ color: t.color, backgroundColor: t.bg, border: `1px solid ${t.border}` }}
    >
      {glyph}
    </span>
  )
}

export function Card({
  children,
  className = '',
  elevated = false,
}: {
  children: ReactNode
  className?: string
  elevated?: boolean
}) {
  return (
    <div
      className={`rounded-2xl border p-6 ${className}`}
      style={{
        backgroundColor: elevated ? 'var(--grader-surface-elevated)' : 'var(--grader-surface)',
        borderColor: 'var(--grader-border)',
      }}
    >
      {children}
    </div>
  )
}

export function SectionEyebrow({ children }: { children: ReactNode }) {
  return (
    <p
      className="mb-3 text-xs font-bold uppercase tracking-[0.2em]"
      style={{ color: 'var(--grader-accent-soft)' }}
    >
      {children}
    </p>
  )
}

/** Consistent section shell used by every report section (Task 33). */
export function ReportSection({
  eyebrow,
  title,
  description,
  children,
  id,
}: {
  eyebrow?: string
  title: string
  description?: string
  children: ReactNode
  id?: string
}) {
  return (
    <section id={id} className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      {eyebrow && <SectionEyebrow>{eyebrow}</SectionEyebrow>}
      <h2 className="text-2xl font-bold sm:text-3xl" style={{ color: 'var(--grader-foreground)' }}>
        {title}
      </h2>
      {description && (
        <p className="mt-2 max-w-2xl text-sm leading-relaxed" style={{ color: 'var(--grader-muted-foreground)' }}>
          {description}
        </p>
      )}
      <div className="mt-6">{children}</div>
    </section>
  )
}

export function PrimaryButton({
  children,
  onClick,
  type = 'button',
  disabled = false,
  fullWidth = false,
  href,
}: {
  children: ReactNode
  onClick?: () => void
  type?: 'button' | 'submit'
  disabled?: boolean
  fullWidth?: boolean
  href?: string
}) {
  const className = `inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-bold text-white shadow-lg transition-all duration-200 ${
    disabled ? 'cursor-not-allowed opacity-60' : 'hover:brightness-110 hover:-translate-y-0.5 active:translate-y-0'
  } ${fullWidth ? 'w-full' : ''} motion-reduce:transition-none motion-reduce:hover:translate-y-0`
  const style = {
    backgroundImage: 'var(--grader-primary-gradient)',
    boxShadow: disabled ? 'none' : '0 12px 30px -12px var(--grader-glow)',
  }
  if (href) {
    return (
      <a href={href} onClick={onClick} className={className} style={style}>
        {children}
      </a>
    )
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={className} style={style}>
      {children}
    </button>
  )
}

export function SecondaryButton({
  children,
  onClick,
  type = 'button',
  href,
}: {
  children: ReactNode
  onClick?: () => void
  type?: 'button' | 'submit'
  href?: string
}) {
  const className =
    'inline-flex items-center justify-center rounded-full border px-6 py-3 text-sm font-semibold transition-colors duration-200 hover:border-[var(--grader-border-muted)] motion-reduce:transition-none'
  const style = {
    borderColor: 'var(--grader-border-muted)',
    color: 'var(--grader-subtle-foreground)',
    backgroundColor: 'var(--grader-surface)',
  }
  if (href) {
    return (
      <a href={href} onClick={onClick} className={className} style={style}>
        {children}
      </a>
    )
  }
  return (
    <button type={type} onClick={onClick} className={className} style={style}>
      {children}
    </button>
  )
}
