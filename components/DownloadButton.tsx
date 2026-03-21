'use client'

interface Props {
  csvData: string | null
  domain: string
}

export default function DownloadButton({ csvData, domain }: Props) {
  if (!csvData) return null

  function handleDownload() {
    const blob = new Blob([csvData!], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const date = new Date().toISOString().split('T')[0]
    const a = document.createElement('a')
    a.href = url
    a.download = `ai-overview-${domain}-${date}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <button
      onClick={handleDownload}
      className="px-6 py-3 bg-green-600 hover:bg-green-500 text-white font-semibold rounded-lg transition-colors"
    >
      Download CSV
    </button>
  )
}
