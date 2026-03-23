import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function getEmailFromSession(req: NextRequest): string | null {
  try {
    const token = req.cookies.get('session')?.value
    if (!token) return null
    const [data] = token.split('.')
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString())
    return payload.email || null
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const email = getEmailFromSession(req)
  if (!email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('analyses')
    .select('id, domain, keywords, summary, created_at')
    .eq('email', email)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
