'use client'

export interface ProgressEvent {
  step: number
  total: number
  message: string
  timestamp: string
}

interface Props {
  events: ProgressEvent[]
}

export default function ProgressLog({ events }: Props) {
  if (events.length === 0) return null

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 font-mono text-sm">
      <div className="space-y-1">
        {events.map((e, i) => (
          <div key={i} className="flex gap-3 text-gray-300">
            <span className="text-gray-500 shrink-0">{e.timestamp}</span>
            <span className="text-lime-400 shrink-0">[{e.step}/{e.total}]</span>
            <span>{e.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
