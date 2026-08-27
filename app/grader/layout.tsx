import type { Metadata } from 'next'
import { Plus_Jakarta_Sans, Cormorant_Garamond } from 'next/font/google'
import './grader-theme.css'

// Self-hosted via next/font (downloaded at build time, no runtime request to
// Google) — matches the two families actually used on proelevate.ai: Plus
// Jakarta Sans for body copy, Cormorant Garamond (italic) as the display
// accent face. Scoped to this layout only; the internal product keeps Geist.
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--grader-font-jakarta',
  display: 'swap',
})

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  style: ['italic', 'normal'],
  variable: '--grader-font-cormorant',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    template: '%s | ProGrowth AI Grader',
    default: 'AI Visibility Grader | ProGrowth',
  },
  description:
    'See how visible your brand is across AI search, compare your presence with competitors, analyze citation sources, and uncover opportunities to improve your AI visibility.',
}

export default function GraderLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`grader-theme ${jakarta.variable} ${cormorant.variable} min-h-screen`}>
      {children}
    </div>
  )
}
