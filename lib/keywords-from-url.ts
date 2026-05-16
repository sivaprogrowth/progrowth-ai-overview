// Static keyword map for known ProGrowth pages
const PAGE_KEYWORD_MAP: Record<string, string[]> = {
  '/': ['AI marketing agency', 'B2B marketing agency', 'AI marketing services'],
  '/ai-marketing/': ['AI marketing', 'AI marketing agency', 'AI marketing services'],
  '/fractional-cmo/': ['fractional CMO', 'fractional CMO services', 'fractional chief marketing officer'],
  '/services/': ['marketing services', 'B2B marketing agency', 'digital marketing services'],
  '/services/ai-marketing-services/': ['AI marketing services', 'AI powered marketing'],
  '/services/marketing-automation/': ['marketing automation', 'marketing automation agency'],
  '/services/lead-generation/': ['B2B lead generation', 'lead generation agency'],
  '/services/seo-services/': ['SEO services', 'B2B SEO agency'],
  '/services/content-marketing/': ['content marketing agency', 'B2B content marketing'],
  '/ai-video/': ['AI video generation', 'AI video editing', 'AI video production'],
  '/video-portfolio/': ['marketing video production', 'video marketing agency'],
  '/contactus/': ['marketing agency contact', 'hire marketing agency'],
  '/blog/': ['marketing blog', 'AI marketing insights'],
  '/industries/saas/': ['SaaS marketing agency', 'SaaS marketing services'],
  '/industries/financial-services/': ['financial services marketing', 'fintech marketing agency'],
  '/industries/credit-unions/': ['credit union marketing', 'credit union digital marketing'],
  '/industries/insurance/': ['insurance marketing agency', 'insurance digital marketing'],
  '/industries/fintechs/': ['fintech marketing', 'fintech marketing agency'],
  '/industries/fintechs/performance-marketing/': ['fintech performance marketing'],
}

function extractFromSlug(path: string): string[] {
  // Remove leading/trailing slashes, get the most specific segment
  const segments = path.replace(/^\/|\/$/g, '').split('/')
  const slug = segments[segments.length - 1] || ''
  if (!slug) return []

  // Convert hyphens to spaces
  const phrase = slug.replace(/-/g, ' ').trim()
  if (phrase.length < 3) return []

  // For blog posts, use the full slug as a long-tail keyword
  if (path.startsWith('/blog/')) {
    // Truncate very long slugs to first 6 words
    const words = phrase.split(' ')
    return [words.slice(0, 6).join(' ')]
  }

  return [phrase]
}

export function extractKeywordsFromUrl(
  path: string,
  maxKeywords = 3
): string[] {
  // Normalize path
  const normalizedPath = path.endsWith('/') ? path : path + '/'

  // Check static map first
  const mapped = PAGE_KEYWORD_MAP[normalizedPath]
  if (mapped) return mapped.slice(0, maxKeywords)

  // Fallback: extract from URL slug
  const slugKeywords = extractFromSlug(path)
  return slugKeywords.slice(0, maxKeywords)
}

export function extractKeywordsForPages(
  pages: Array<{ path: string }>,
  maxKeywordsPerPage = 3
): Map<string, string[]> {
  const result = new Map<string, string[]>()
  const seen = new Set<string>()

  for (const page of pages) {
    const keywords = extractKeywordsFromUrl(page.path, maxKeywordsPerPage)
      .filter((kw) => {
        if (seen.has(kw.toLowerCase())) return false
        seen.add(kw.toLowerCase())
        return true
      })
    result.set(page.path, keywords)
  }

  return result
}
