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
import { fetchKPIScorecard, type KPICard } from './scorecard'

const DEFAULT_RECIPIENT = process.env.DIGEST_EMAIL_RECIPIENT || 'siva@progrowth.services'
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

function buildDigestHtml(cards: KPICard[], snapshotDate: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:#f9fafb;color:#111827;">
  <div style="max-width:640px;margin:0 auto;padding:24px;">
    <div style="margin-bottom:24px;">
      <div style="color:#84cc16;font-weight:700;font-size:14px;letter-spacing:1px;text-transform:uppercase;">ProGrowth · Weekly GEO Scorecard</div>
      <div style="color:#6b7280;font-size:13px;margin-top:4px;">${snapshotDate}</div>
    </div>
    ${cards.map(buildCardHtml).join('')}
    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;">
      Live dashboard: <a href="https://aioverviews.progrowth.services/scorecard" style="color:#84cc16;">aioverviews.progrowth.services/scorecard</a><br/>
      KPI definitions: <code>~/ProGrowth_GEO_KPI_Scorecard.md</code>
    </div>
  </div>
</body>
</html>`
}

function buildDigestText(cards: KPICard[], snapshotDate: string): string {
  const lines = [`PROGROWTH WEEKLY GEO SCORECARD — ${snapshotDate}`, '']
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
  lines.push('Dashboard: https://aioverviews.progrowth.services/scorecard')
  return lines.join('\n')
}

export interface DigestSendResult {
  sent: boolean
  recipient: string
  error?: string
  messageId?: string
  kpiCount: number
}

export async function sendScorecardDigest(toEmail: string = DEFAULT_RECIPIENT): Promise<DigestSendResult> {
  if (!process.env.BREVO_SMTP_USER || !process.env.BREVO_SMTP_PASS) {
    return { sent: false, recipient: toEmail, error: 'Brevo SMTP credentials not configured', kpiCount: 0 }
  }

  try {
    const cards = await fetchKPIScorecard()
    const snapshotDate = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
    const html = buildDigestHtml(cards, snapshotDate)
    const text = buildDigestText(cards, snapshotDate)

    const result = await transporter.sendMail({
      from: FROM_ADDRESS,
      to: toEmail,
      subject: `GEO Scorecard · ${snapshotDate}`,
      html,
      text,
    })

    return {
      sent: true,
      recipient: toEmail,
      messageId: result.messageId,
      kpiCount: cards.length,
    }
  } catch (error: any) {
    return {
      sent: false,
      recipient: toEmail,
      error: error?.message || String(error),
      kpiCount: 0,
    }
  }
}
