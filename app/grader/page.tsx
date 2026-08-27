import { GraderHero } from '@/components/grader/GraderHero'
import { GraderForm } from '@/components/grader/GraderForm'

export default function GraderPage() {
  return (
    <main className="grader-glow-ambient">
      <GraderHero />
      <GraderForm />
    </main>
  )
}
