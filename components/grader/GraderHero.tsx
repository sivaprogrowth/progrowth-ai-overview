/**
 * Static hero copy for the /grader landing page (Task 4). Server-renderable
 * — no client interactivity lives here, only the form below it is a client
 * component.
 */

export function GraderHero() {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-4 pt-16 text-center sm:pt-24">
      <div className="mb-6 flex justify-center">
        <span
          className="rounded-full border px-4 py-1.5 text-xs font-bold uppercase tracking-[0.2em]"
          style={{ borderColor: 'var(--grader-border-muted)', color: 'var(--grader-accent-soft)' }}
        >
          AI Search Visibility
        </span>
      </div>
      <h1 className="text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-6xl">
        See How{' '}
        <em
          className="font-medium not-italic"
          style={{
            fontFamily: 'var(--grader-font-display)',
            fontStyle: 'italic',
            backgroundImage: 'var(--grader-accent-gradient)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          AI Sees
        </em>{' '}
        Your Brand.
      </h1>
      <p
        className="mx-auto mt-6 max-w-2xl text-base leading-relaxed sm:text-lg"
        style={{ color: 'var(--grader-subtle-foreground)' }}
      >
        Discover how visible your company is across leading AI answer engines, which
        competitors are being recommended instead, where AI systems get their
        information, and what you can do to improve your visibility.
      </p>
    </div>
  )
}
