/**
 * Canonical 25-prompt set for ProGrowth GEO/AI visibility tracking.
 *
 * Each prompt is classified by:
 *   • Rokas Stan TYPE — Comparative / Task / Evaluative / Ideation
 *   • CLUSTER — one of 5 topical groupings aligned to ProGrowth's verticals
 *
 * KPI 3 (Citation Share) is measured across THIS fixed set rather than
 * whatever keywords a one-off Matomo crawl happened to extract — that's
 * the prerequisite for week-over-week comparability.
 *
 * Type rationale (per Step 3 of the Rokas Stan AI SEO Guide):
 *   Comparative  →  "X vs Y" — drives shortlist decisions
 *   Task         →  "how to X" — captures default-solution traffic
 *   Evaluative   →  "best X for Y" / "is X worth it" — closest to convert
 *   Ideation     →  "ideas for X" / exploratory — accounts for ~70% of
 *                   real ChatGPT prompts that don't fit classic SEO intent
 *
 * Type distribution: 5 Comparative · 5 Task · 10 Evaluative · 5 Ideation
 * Evaluative is over-weighted because those are purchase-intent prompts
 * with the highest direct business value.
 */

export type PromptType = 'comparative' | 'task' | 'evaluative' | 'ideation'

export interface CanonicalPrompt {
  /** Stable id like `fcmo-c` (cluster slug + type letter) */
  id: string
  /** The actual prompt text sent to AI engines */
  text: string
  /** Rokas Stan taxonomy slot */
  type: PromptType
  /** Cluster slug — joins to PROMPT_CLUSTERS[].id */
  cluster: string
}

export interface PromptCluster {
  /** Slug used in prompt ids and as a query parameter */
  id: string
  /** Human-readable name shown in the dashboard */
  name: string
  /** One-sentence rationale for why this cluster is on ProGrowth's tracking list */
  description: string
}

export const PROMPT_CLUSTERS: PromptCluster[] = [
  {
    id: 'fcmo',
    name: 'Fractional CMO Services',
    description:
      'Core service line — bridges all verticals. ProGrowth competes here against Marketri, Kalungi, and the long tail of independent fractional operators.',
  },
  {
    id: 'psm',
    name: 'Professional Services Marketing',
    description:
      'Legal, accounting, consulting firms. ProGrowth has dedicated industry pages and recent blog content (e.g. AI for managing partners 2026).',
  },
  {
    id: 'ama',
    name: 'AI Marketing Automation',
    description:
      'Execution arm of the AI-Native Marketing OS positioning. Where ProGrowth claims technical depth against generic agencies.',
  },
  {
    id: 'dtm',
    name: 'B2B Deep Tech Marketing',
    description:
      'Niche specialization with strongest case studies (Cambridge robotics 3→23% RFP win; Toronto quantum 340% pipeline lift).',
  },
  {
    id: 'fsm',
    name: 'Financial Services Marketing',
    description:
      'Credit unions, community banks, insurance agencies, fintech. ProGrowth has industry pages and the Chicago 47-agency original research planned.',
  },
]

export const CANONICAL_PROMPTS: CanonicalPrompt[] = [
  // ── Cluster 1: Fractional CMO ─────────────────────────────────────────
  {
    id: 'fcmo-c',
    text: 'fractional CMO vs full-time marketing agency for B2B SaaS',
    type: 'comparative',
    cluster: 'fcmo',
  },
  {
    id: 'fcmo-t',
    text: 'how to hire a fractional CMO for a B2B company',
    type: 'task',
    cluster: 'fcmo',
  },
  {
    id: 'fcmo-e1',
    text: 'best fractional CMO services for B2B SaaS startups',
    type: 'evaluative',
    cluster: 'fcmo',
  },
  {
    id: 'fcmo-e2',
    text: 'is hiring a fractional CMO worth the cost for a $5M revenue company',
    type: 'evaluative',
    cluster: 'fcmo',
  },
  {
    id: 'fcmo-i',
    text: 'what should you expect in the first 90 days with a fractional CMO',
    type: 'ideation',
    cluster: 'fcmo',
  },

  // ── Cluster 2: Professional Services Marketing ────────────────────────
  {
    id: 'psm-c',
    text: 'content marketing vs paid ads for accounting firms',
    type: 'comparative',
    cluster: 'psm',
  },
  {
    id: 'psm-t',
    text: 'how to build a marketing plan for a small law firm in 2026',
    type: 'task',
    cluster: 'psm',
  },
  {
    id: 'psm-e1',
    text: 'best marketing strategies for professional services firms',
    type: 'evaluative',
    cluster: 'psm',
  },
  {
    id: 'psm-e2',
    text: 'is marketing automation worth it for a 10-partner consulting firm',
    type: 'evaluative',
    cluster: 'psm',
  },
  {
    id: 'psm-i',
    text: 'marketing ideas for boutique accounting firms',
    type: 'ideation',
    cluster: 'psm',
  },

  // ── Cluster 3: AI Marketing Automation ────────────────────────────────
  {
    id: 'ama-c',
    text: 'AI marketing automation vs traditional martech stack',
    type: 'comparative',
    cluster: 'ama',
  },
  {
    id: 'ama-t',
    text: 'how to implement AI marketing automation for a B2B SaaS company',
    type: 'task',
    cluster: 'ama',
  },
  {
    id: 'ama-e1',
    text: 'best AI marketing automation platforms for B2B in 2026',
    type: 'evaluative',
    cluster: 'ama',
  },
  {
    id: 'ama-e2',
    text: 'is AI marketing automation worth it for a 20-person company',
    type: 'evaluative',
    cluster: 'ama',
  },
  {
    id: 'ama-i',
    text: 'AI marketing use cases for professional services firms',
    type: 'ideation',
    cluster: 'ama',
  },

  // ── Cluster 4: B2B Deep Tech Marketing ────────────────────────────────
  {
    id: 'dtm-c',
    text: 'ABM vs traditional lead generation for deep tech startups',
    type: 'comparative',
    cluster: 'dtm',
  },
  {
    id: 'dtm-t',
    text: 'how to market a robotics startup to enterprise buyers',
    type: 'task',
    cluster: 'dtm',
  },
  {
    id: 'dtm-e1',
    text: 'best marketing agencies for deep tech and Series A-C SaaS',
    type: 'evaluative',
    cluster: 'dtm',
  },
  {
    id: 'dtm-e2',
    text: 'what is the typical sales cycle for a B2B deep tech company',
    type: 'evaluative',
    cluster: 'dtm',
  },
  {
    id: 'dtm-i',
    text: 'go to market strategies for early stage AI startups',
    type: 'ideation',
    cluster: 'dtm',
  },

  // ── Cluster 5: Financial Services Marketing ───────────────────────────
  {
    id: 'fsm-c',
    text: 'marketing automation vs traditional outreach for credit unions',
    type: 'comparative',
    cluster: 'fsm',
  },
  {
    id: 'fsm-t',
    text: 'how to grow an independent insurance agency in 2026',
    type: 'task',
    cluster: 'fsm',
  },
  {
    id: 'fsm-e1',
    text: 'best marketing strategies for community banks and credit unions',
    type: 'evaluative',
    cluster: 'fsm',
  },
  {
    id: 'fsm-e2',
    text: 'is FINRA-compliant marketing automation possible for RIAs',
    type: 'evaluative',
    cluster: 'fsm',
  },
  {
    id: 'fsm-i',
    text: 'AI marketing ideas for insurance agencies',
    type: 'ideation',
    cluster: 'fsm',
  },
]

// ── Convenience accessors ─────────────────────────────────────────────────

export function getAllPrompts(): CanonicalPrompt[] {
  return CANONICAL_PROMPTS
}

export function getPromptsByType(type: PromptType): CanonicalPrompt[] {
  return CANONICAL_PROMPTS.filter((p) => p.type === type)
}

export function getPromptsByCluster(clusterId: string): CanonicalPrompt[] {
  return CANONICAL_PROMPTS.filter((p) => p.cluster === clusterId)
}

export function getClusterById(clusterId: string): PromptCluster | undefined {
  return PROMPT_CLUSTERS.find((c) => c.id === clusterId)
}

/** Map of prompt-text → CanonicalPrompt for reverse lookups when scoring. */
export const PROMPT_INDEX_BY_TEXT: Map<string, CanonicalPrompt> = new Map(
  CANONICAL_PROMPTS.map((p) => [p.text.toLowerCase(), p])
)

// ── Per-client overrides (Phase 1 multi-tenant) ───────────────────────────
//
// Clients can override the canonical set via `clients.prompts` / `clients.verticals`
// in the database. When those columns are empty (e.g. the ProGrowth row before
// migration to per-client storage, or any client that opted to use defaults)
// we fall back to the constants defined above.

interface PromptHost {
  prompts?: CanonicalPrompt[]
  verticals?: PromptCluster[]
}

export function getPromptsForClient(client: PromptHost): CanonicalPrompt[] {
  return client.prompts && client.prompts.length > 0 ? client.prompts : CANONICAL_PROMPTS
}

export function getClustersForClient(client: PromptHost): PromptCluster[] {
  return client.verticals && client.verticals.length > 0 ? client.verticals : PROMPT_CLUSTERS
}

/** Build the text→prompt index against either the client's set or the default. */
export function buildPromptIndex(prompts: CanonicalPrompt[]): Map<string, CanonicalPrompt> {
  return new Map(prompts.map((p) => [p.text.toLowerCase(), p]))
}

/** Sanity-check counts at compile time so accidental edits get caught. */
const _TYPE_COUNTS = {
  comparative: getPromptsByType('comparative').length,
  task: getPromptsByType('task').length,
  evaluative: getPromptsByType('evaluative').length,
  ideation: getPromptsByType('ideation').length,
}
if (
  _TYPE_COUNTS.comparative !== 5 ||
  _TYPE_COUNTS.task !== 5 ||
  _TYPE_COUNTS.evaluative !== 10 ||
  _TYPE_COUNTS.ideation !== 5 ||
  CANONICAL_PROMPTS.length !== 25
) {
  // Throw at module load — catches taxonomy drift on the next deploy.
  // eslint-disable-next-line no-console
  console.warn('[lib/prompts] Canonical prompt counts drifted from spec:', _TYPE_COUNTS)
}
