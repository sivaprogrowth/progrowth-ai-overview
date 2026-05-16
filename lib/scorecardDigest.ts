/**
 * Weekly GEO Scorecard digest email.
 *
 * Composes a 5-KPI summary and sends it via Brevo SMTP (the same transport
 * the OTP login flow uses, so no new credentials needed). Triggered by the
 * /api/cron/geo-seo-gap cron at the end of its weekly run.
 *
 * The digest deliberately keeps two distinct calls to fetchKPIScorecard:
 * one BEFORE the cron writes a new KPI 5 snapshot (so we can compute
 * week-over-week deltas for KPI 5) — but in practice we compute KPI 5
 * deltas separately by reading the two most recent __kpi5_snapshot__ rows.
 */

import nodemailer from 'nodemailer'
import { fetchKPIScorecard, fetchAiReadinessFromSnapshot, type KPICard } from './scorecard'
import { buildRecommendations, type Recommendation } from './recommendations'
import type { Client } from './clients'

const REC_SEVERITY_COLOR: Record<Recommendation['severity'], string> = {
  critical: '#ef4444',
  high: '#f59e0b',
  medium: '#0ea5e9',
  low: '#6b7280',
}

const FALLBACK_RECIPIENT = process.env.DIGEST_EMAIL_RECIPIENT || 'siva@progrowth.services'
const FROM_ADDRESS = '"ProGrowth GEO Scorecard" <siva@progrowth.services>'

const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  auth: {
    user: process.env.BREVO_SMTP_USER || '',
    pass: process.env.BREVO_SMTP_PASS || '',
  },
})

function fmtNumber(v: number | string | null | undefined): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'string') return v
  return v.toLocaleString()
}

function deltaPct(current: number | null | undefined, previous: number | null | undefined): string {
  if (current === null || current === undefined) return ''
  if (previous === null || previous === undefined || previous === 0) return ''
  const pct = Math.round(((current - previous) / previous) * 100)
  if (pct > 0) return ` <span style="color:#84cc16;">(+${pct}%)</span>`
  if (pct < 0) return ` <span style="color:#f59e0b;">(${pct}%)</span>`
  return ' <span style="color:#9ca3af;">(flat)</span>'
}

function statusBadge(status: KPICard['status']): string {
  const map: Record<KPICard['status'], { color: string; label: string }> = {
    ahead: { color: '#84cc16', label: 'AHEAD' },
    'on-track': { color: '#10b981', label: 'ON TRACK' },
    behind: { color: '#f59e0b', label: 'BEHIND' },
    pending: { color: '#6b7280', label: 'PENDING' },
  }
  const s = map[status]
  return `<span style="background:${s.color}22;color:${s.color};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;letter-spacing:0.5px;">${s.label}</span>`
}

function buildCardHtml(card: KPICard): string {
  const rowsHtml = `
    <tr>
      <td style="padding:4px 0;color:#6b7280;font-size:12px;">Current</td>
      <td style="padding:4px 0;text-align:right;font-weight:600;color:#111827;">${fmtNumber(card.current)}${deltaPct(card.current, card.previousPeriod)}</td>
    </tr>
    <tr>
      <td style="padding:4px 0;color:#6b7280;font-size:12px;">Baseline</td>
      <td style="padding:4px 0;text-align:right;color:#374151;">${fmtNumber(card.baseline)}</td>
    </tr>
    <tr>
      <td style="padding:4px 0;color:#6b7280;font-size:12px;">30d target</td>
      <td style="padding:4px 0;text-align:right;color:#374151;">${fmtNumber(card.target30d)}</td>
    </tr>
    <tr>
      <td style="padding:4px 0;color:#6b7280;font-size:12px;">90d target</td>
      <td style="padding:4px 0;text-align:right;color:#374151;">${fmtNumber(card.target90d)}</td>
    </tr>
  `

  const perEngineHtml =
    card.perEngine && card.perEngine.length > 0
      ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid #e5e7eb;">
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Per engine</div>
          ${card.perEngine
            .map(
              (s) =>
                `<div style="display:flex;justify-content:space-between;font-size:13px;padding:2px 0;"><span style="color:#374151;">${s.engine}</span><span style="color:#6b7280;">${fmtNumber(s.visits)}${card.perEngineUnit === 'percent' ? '%' : ''}</span></div>`
            )
            .join('')}
        </div>`
      : ''

  return `
    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:12px;background:#fff;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
        <div>
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;">KPI ${card.id} · ${card.funnelStage}</div>
          <div style="font-size:16px;font-weight:600;color:#111827;margin-top:4px;">${card.name}</div>
        </div>
        ${statusBadge(card.status)}
      </div>
      <table style="width:100%;border-collapse:collapse;">${rowsHtml}</table>
      ${perEngineHtml}
      ${card.caveat ? `<div style="margin-top:12px;padding:10px;background:#fef3c7;border-radius:6px;font-size:12px;color:#92400e;">${card.caveat}</div>` : ''}
      ${card.pendingReason ? `<div style="margin-top:12px;padding:10px;background:#f3f4f6;border-radius:6px;font-size:12px;color:#4b5563;">${card.pendingReason}</div>` : ''}
    </div>
  `
}

function buildRecommendationsHtml(recs: Recommendation[]): string {
  if (recs.length === 0) return ''
  const top = recs.slice(0, 3)
  return `
    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:12px;background:#fff;">
      <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Top recommended actions · Google-aligned</div>
      ${top
        .map((r) => {
          const c = REC_SEVERITY_COLOR[r.severity]
          return `<div style="border-left:3px solid ${c};padding:4px 0 4px 12px;margin-bottom:14px;">
            <div style="font-size:11px;font-weight:600;color:${c};text-transform:uppercase;letter-spacing:0.5px;">${r.severity}${r.kpiId ? ` · KPI ${r.kpiId}` : ''}</div>
            <div style="font-size:13px;color:#374151;margin-top:4px;">${r.finding}</div>
            <div style="font-size:13px;color:#111827;font-weight:600;margin-top:4px;">→ ${r.action}</div>
            <a href="${r.docUrl}" style="font-size:12px;color:#84cc16;">Google guidance ↗</a>
          </div>`
        })
        .join('')}
    </div>`
}

function buildDigestHtml(
  client: Client,
  cards: KPICard[],
  recs: Recommendation[],
  snapshotDate: string
): string {
  const dashboardUrl = `https://aioverviews.progrowth.services/clients/${client.slug}/scorecard`
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:#f9fafb;color:#111827;">
  <div style="max-width:640px;margin:0 auto;padding:24px;">
    <div style="margin-bottom:24px;">
      <div style="color:#84cc16;font-weight:700;font-size:14px;letter-spacing:1px;text-transform:uppercase;">ProGrowth · Weekly GEO Scorecard for ${client.company_name}</div>
      <div style="color:#6b7280;font-size:13px;margin-top:4px;">${snapshotDate}</div>
    </div>
    ${buildRecommendationsHtml(recs)}
    ${cards.map(buildCardHtml).join('')}
    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;">
      Live dashboard: <a href="${dashboardUrl}" style="color:#84cc16;">${dashboardUrl.replace(/^https?:\/\//, '')}</a><br/>
      KPI definitions: <code>~/ProGrowth_GEO_KPI_Scorecard.md</code>
    </div>
  </div>
</body>
</html>`
}

function buildDigestText(
  client: Client,
  cards: KPICard[],
  recs: Recommendation[],
  snapshotDate: string
): string {
  const dashboardUrl = `https://aioverviews.progrowth.services/clients/${client.slug}/scorecard`
  const lines = [`PROGROWTH WEEKLY GEO SCORECARD — ${client.company_name} — ${snapshotDate}`, '']
  if (recs.length > 0) {
    lines.push('TOP RECOMMENDED ACTIONS (Google-aligned)')
    for (const r of recs.slice(0, 3)) {
      lines.push(`  [${r.severity.toUpperCase()}${r.kpiId ? ` · KPI ${r.kpiId}` : ''}] ${r.finding}`)
      lines.push(`    -> ${r.action}`)
      lines.push(`    ${r.docUrl}`)
    }
    lines.push('')
  }
  for (const c of cards) {
    lines.push(`KPI ${c.id} · ${c.name}  [${c.status.toUpperCase()}]`)
    lines.push(`  ${c.question}`)
    lines.push(`  Current:   ${fmtNumber(c.current)}${c.previousPeriod ? ` (prev 30d: ${fmtNumber(c.previousPeriod)})` : ''}`)
    lines.push(`  Baseline:  ${fmtNumber(c.baseline)}`)
    lines.push(`  30d goal:  ${fmtNumber(c.target30d)}`)
    lines.push(`  90d goal:  ${fmtNumber(c.target90d)}`)
    if (c.perEngine && c.perEngine.length) {
      lines.push(`  Per engine: ${c.perEngine.map((s) => `${s.engine}=${s.visits}${c.perEngineUnit === 'percent' ? '%' : ''}`).join(', ')}`)
    }
    if (c.caveat) lines.push(`  Note: ${c.caveat}`)
    if (c.pendingReason) lines.push(`  Pending: ${c.pendingReason}`)
    lines.push('')
  }
  lines.push('---')
  lines.push(`Dashboard: ${dashboardUrl}`)
  return lines.join('\n')
}

export interface DigestSendResult {
  sent: boolean
  recipient: string
  error?: string
  messageId?: string
  kpiCount: number
}

export async function sendScorecardDigest(client: Client, toEmail?: string): Promise<DigestSendResult> {
  const recipient = toEmail ?? client.notification_email ?? FALLBACK_RECIPIENT

  if (!process.env.BREVO_SMTP_USER || !process.env.BREVO_SMTP_PASS) {
    return { sent: false, recipient, error: 'Brevo SMTP credentials not configured', kpiCount: 0 }
  }

  try {
    const [cards, readiness] = await Promise.all([
      fetchKPIScorecard(client),
      fetchAiReadinessFromSnapshot(client),
    ])
    const recommendations = buildRecommendations(cards, readiness, {
      verticals: client.verticals.flatMap((v) => [v.id, v.name, v.description].filter(Boolean)),
    })
    const snapshotDate = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
    const html = buildDigestHtml(client, cards, recommendations, snapshotDate)
    const text = buildDigestText(client, cards, recommendations, snapshotDate)

    const result = await transporter.sendMail({
      from: FROM_ADDRESS,
      to: recipient,
      subject: `GEO Scorecard · ${client.company_name} · ${snapshotDate}`,
      html,
      text,
    })

    return {
      sent: true,
      recipient,
      messageId: result.messageId,
      kpiCount: cards.length,
    }
  } catch (error: any) {
    return {
      sent: false,
      recipient,
      error: error?.message || String(error),
      kpiCount: 0,
    }
  }
}
