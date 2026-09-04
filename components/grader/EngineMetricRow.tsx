/**
 * One compact metric row inside an EngineScoreCard — a label, a value, and
 * an optional progress bar. The bar is only rendered when `percent` is
 * provided: some metrics (average position, a raw competitor count) have
 * no natural 0–100 denominator, and a bar implies a proportion that isn't
 * there (per the multi-engine scorecard brief: never render a bar without
 * a meaningful finite denominator).
 */

export function EngineMetricRow({
  label,
  value,
  percent,
  ariaLabel,
}: {
  label: string
  value: string
  /** 0–100, or omit entirely to render a plain stat row with no bar. */
  percent?: number
  /** Full accessible description of the bar, e.g. "Brand mentions: 7 out of 10". Required when `percent` is set. */
  ariaLabel?: string
}) {
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span style={{ color: 'var(--grader-muted-foreground)' }}>{label}</span>
        <span className="font-semibold tabular-nums" style={{ color: 'var(--grader-foreground)' }}>
          {value}
        </span>
      </div>
      {percent !== undefined && (
        <div
          className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full"
          style={{ backgroundColor: 'var(--grader-border)' }}
          role="progressbar"
          aria-valuenow={Math.round(percent)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={ariaLabel ?? label}
        >
          <div
            className="h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none"
            style={{
              width: `${Math.max(0, Math.min(100, percent))}%`,
              backgroundImage: 'var(--grader-accent-gradient)',
            }}
          />
        </div>
      )}
    </div>
  )
}
