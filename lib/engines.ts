/**
 * Answer-engine enum — a DEPENDENCY-FREE leaf module.
 *
 * Kept separate from lib/citationNetwork (which transitively imports
 * lib/clients → lib/supabase, a server-only module) so client components
 * can use the engine list/type without dragging the Supabase client into
 * the browser bundle (that throws "supabaseKey is required" at module
 * init since SUPABASE_SERVICE_ROLE_KEY is server-only). Do not add imports
 * with runtime side effects to this file.
 */

export type Engine = 'chatgpt' | 'claude' | 'perplexity' | 'gemini' | 'grok'

export const ALL_ENGINES: Engine[] = ['chatgpt', 'claude', 'perplexity', 'gemini', 'grok']
