'use client'

interface Props {
  onSubmit: (domain: string, keywords: string[]) => void
  isRunning: boolean
}

export default function AnalysisForm({ onSubmit, isRunning }: Props) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const form = e.target as HTMLFormElement
        const domain = (form.elements.namedItem('domain') as HTMLInputElement).value.trim()
        const keywordsText = (form.elements.namedItem('keywords') as HTMLTextAreaElement).value
        const keywords = keywordsText
          .split('\n')
          .map((k) => k.trim())
          .filter(Boolean)
        if (domain && keywords.length > 0) {
          onSubmit(domain, keywords)
        }
      }}
      className="space-y-4"
    >
      <div>
        <label htmlFor="domain" className="block text-sm font-medium text-gray-300 mb-1">
          Domain
        </label>
        <input
          id="domain"
          name="domain"
          type="text"
          required
          placeholder="e.g. progrowth.services"
          className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-lime-500 focus:border-transparent"
        />
      </div>

      <div>
        <label htmlFor="keywords" className="block text-sm font-medium text-gray-300 mb-1">
          Keywords <span className="text-gray-500">(one per line)</span>
        </label>
        <textarea
          id="keywords"
          name="keywords"
          required
          rows={8}
          placeholder={"fractional cmo\nai marketing agency\nb2b marketing automation\nfractional marketing services"}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-lime-500 focus:border-transparent font-mono text-sm"
        />
      </div>

      <button
        type="submit"
        disabled={isRunning}
        className="w-full py-3 px-4 bg-lime-500 hover:bg-lime-400 disabled:bg-gray-600 disabled:cursor-not-allowed text-black font-semibold rounded-lg transition-colors"
      >
        {isRunning ? 'Analyzing...' : 'Run Analysis'}
      </button>
    </form>
  )
}
