import { supabase } from '../lib/supabase'

async function main() {
  console.log('--- select("id").limit(1) ---')
  const a = await supabase.from('public_grader_runs').select('id').limit(1)
  console.log(JSON.stringify({ dataLen: a.data?.length ?? null, error: a.error?.message ?? null, status: a.status, statusText: a.statusText }, null, 2))

  console.log('\n--- select("*", {count:"exact", head:true}) ---')
  const b = await supabase.from('public_grader_runs').select('*', { count: 'exact', head: true })
  console.log(JSON.stringify({ count: b.count, error: b.error?.message ?? null, status: b.status, statusText: b.statusText }, null, 2))

  console.log('\n--- select("company_name,domain").limit(1) ---')
  const c = await supabase.from('public_grader_runs').select('company_name,domain').limit(1)
  console.log(JSON.stringify({ dataLen: c.data?.length ?? null, error: c.error?.message ?? null, status: c.status }, null, 2))
}
main()
