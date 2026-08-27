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

// No absolute production URL is hardcoded here (Phase 3, Task 30): the
// launch domain for /grader isn't settled in this repo — the internal
// product's own domain (aioverviews.progrowth.services) is the current
// Vercel deployment's host, and Task 39 leaves open whether launch uses
// that host's /grader path or a dedicated grader.progrowth.services
// subdomain. `metadataBase`/canonical is left for whoever wires up the
// production domain to set once, rather than guessing here and risking a
// wrong canonical URL shipping to launch. Title/description/OG/Twitter
// content itself does not depend on knowing the domain, so it's set now.
const TITLE = 'AI Visibility Grader | ProGrowth'
const DESCRIPTION =
  'See how visible your brand is across AI search, compare your presence with competitors, analyze citation sources, and uncover opportunities to improve your AI visibility.'

export const metadata: Metadata = {
  title: {
    template: '%s | ProGrowth AI Grader',
    default: TITLE,
  },
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    siteName: 'ProGrowth AI Grader',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
}

export default function GraderLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`grader-theme ${jakarta.variable} ${cormorant.variable} min-h-screen`}>
      {children}
    </div>
  )
}
