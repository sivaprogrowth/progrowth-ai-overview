'use client'

interface Summary {
  domain: string
  totalKeywords: number
  googlePresent: number
  chatgptPresent: number
  perplexityPresent: number
  claudePresent: number
  contentGaps: number
}

interface Props {
  summary: Summary | null
}

export default function SummaryDashboard({ summary }: Props) {
  if (!summary) return null

  const cards = [
    { label: 'Google AI Overview', value: summary.googlePresent, total: summary.totalKeywords, color: 'text-blue-400' },
    { label: 'ChatGPT', value: summary.chatgptPresent, total: summary.totalKeywords, color: 'text-green-400' },
    { label: 'Perplexity', value: summary.perplexityPresent, total: summary.totalKeywords, color: 'text-purple-400' },
    { label: 'Claude', value: summary.claudePresent, total: summary.totalKeywords, color: 'text-orange-400' },
    { label: 'Content Gaps', value: summary.contentGaps, total: summary.totalKeywords, color: 'text-red-400' },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {cards.map((card) => (
        <div key={card.label} className="bg-gray-800 border border-gray-700 rounded-lg p-4 text-center">
          <div className={`text-2xl font-bold ${card.color}`}>
            {card.value}/{card.total}
          </div>
          <div className="text-xs text-gray-400 mt-1">{card.label}</div>
        </div>
      ))}
    </div>
  )
}
