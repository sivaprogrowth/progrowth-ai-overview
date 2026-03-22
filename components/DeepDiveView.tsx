'use client'

import { useState } from 'react'
import { DeepDiveResult, DeepDivePlatformResponse } from '@/lib/transform'

interface Props {
  result: DeepDiveResult
}

const PLATFORMS = [
  { key: 'google' as const, label: 'Google AI Overview', color: 'bg-blue-500' },
  { key: 'chatgpt' as const, label: 'ChatGPT', color: 'bg-green-500' },
  { key: 'perplexity' as const, label: 'Perplexity', color: 'bg-purple-500' },
  { key: 'claude' as const, label: 'Claude', color: 'bg-orange-500' },
]

function highlightDomain(text: string, domain: string | null): string {
  if (!domain) return text
  const domainLower = domain.toLowerCase().replace(/^www\./, '')
  const regex = new RegExp(`(${domainLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  return text.replace(regex, '<mark class="bg-yellow-500/40 text-yellow-200 px-0.5 rounded">$1</mark>')
}

export default function DeepDiveView({ result }: Props) {
  const [activeTab, setActiveTab] = useState<'google' | 'chatgpt' | 'perplexity' | 'claude'>('google')

  const platformMap = new Map(result.platforms.map((p) => [p.platform, p]))
  const active = platformMap.get(activeTab)

  const mentionedCount = result.platforms.filter((p) => p.domainMentioned).length

  return (
    <div className="space-y-4">
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
        <div className="text-sm text-gray-400">Query analyzed:</div>
        <div className="text-lg text-white font-medium mt-1">&ldquo;{result.query}&rdquo;</div>
        {result.domain && (
          <div className="mt-2 text-sm">
            <span className="text-gray-400">Your domain: </span>
            <span className="text-lime-400">{result.domain}</span>
            <span className="text-gray-400 ml-3">Mentioned on </span>
            <span className={mentionedCount > 0 ? 'text-green-400' : 'text-red-400'}>
              {mentionedCount}/4 platforms
            </span>
          </div>
        )}
      </div>

      <div className="flex gap-1 flex-wrap">
        {PLATFORMS.map((p) => {
          const data = platformMap.get(p.key)
          const mentioned = data?.domainMentioned
          return (
            <button
              key={p.key}
              onClick={() => setActiveTab(p.key)}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center gap-2 ${
                activeTab === p.key
                  ? `${p.color} text-white`
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              {p.label}
              {result.domain && (
                <span className={`w-2 h-2 rounded-full ${mentioned ? 'bg-green-400' : 'bg-red-400'}`} />
              )}
            </button>
          )
        })}
      </div>

      {active && (
        <div className="border border-gray-700 rounded-lg overflow-hidden">
          {active.error && !active.answer ? (
            <div className="p-6 text-gray-400 text-sm">{active.error}</div>
          ) : (
            <>
              <div className="p-6 bg-gray-900/50 max-h-[600px] overflow-y-auto">
                <div
                  className="prose prose-invert prose-sm max-w-none text-gray-300 leading-relaxed whitespace-pre-wrap break-words [&_h3]:text-lime-400 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 [&_a]:text-blue-400 [&_a]:underline [&_mark]:bg-yellow-500/40 [&_mark]:text-yellow-200"
                  dangerouslySetInnerHTML={{
                    __html: highlightDomain(
                      active.answer
                        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
                        .replace(/### (.+)/g, '<h3>$1</h3>')
                        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
                        .replace(/^- /gm, '&bull; ')
                        .replace(/---/g, '<hr class="border-gray-700 my-4">'),
                      result.domain
                    ),
                  }}
                />
              </div>

              {active.sources.length > 0 && (
                <div className="border-t border-gray-700 p-4 bg-gray-900">
                  <div className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-3">
                    Sources cited ({active.sources.length}):
                  </div>
                  <ul className="space-y-2">
                    {active.sources.map((s, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <img
                          src={`https://www.google.com/s2/favicons?domain=${s.domain}&sz=16`}
                          alt=""
                          width={16}
                          height={16}
                          className="mt-0.5 shrink-0"
                        />
                        <div className="min-w-0">
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noopener"
                            className={`hover:underline break-all ${
                              s.isUserDomain ? 'text-lime-400 font-medium' : 'text-blue-400'
                            }`}
                          >
                            {s.title || s.domain}
                          </a>
                          <div className="text-xs text-gray-500 truncate">{s.domain}</div>
                        </div>
                        {s.isUserDomain && (
                          <span className="shrink-0 text-xs bg-lime-500/20 text-lime-400 px-2 py-0.5 rounded">
                            Your site
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
