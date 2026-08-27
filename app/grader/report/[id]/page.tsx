import type { Metadata } from 'next'
import { ReportView } from '@/components/grader/ReportView'

/**
 * Report pages are user-generated and may reference a real (potentially
 * unlisted) business — never indexed (Task 39). The report link itself
 * stays shareable; it's just excluded from search engines.
 */
export const metadata: Metadata = {
  title: 'Your AI Visibility Report',
  robots: { index: false, follow: false },
}

export default function GraderReportPage({ params }: { params: { id: string } }) {
  return <ReportView reportId={params.id} />
}
