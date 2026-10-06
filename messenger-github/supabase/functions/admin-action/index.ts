import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    if (!token) throw new Error('Unauthorized')

    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const userClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } })
    const adminClient = createClient(url, service)

    const { data: { user }, error: userError } = await userClient.auth.getUser(token)
    if (userError || !user) throw new Error('Unauthorized')

    const { data: owner } = await adminClient.from('app_owner').select('owner_user_id').eq('singleton', true).maybeSingle()
    if (!owner || owner.owner_user_id !== user.id) throw new Error('Admin only')

    const body = await req.json()
    const action = body.action

    if (action === 'delete_user') {
      if (!body.user_id || body.user_id === user.id) throw new Error('Invalid user')
      const { error } = await adminClient.auth.admin.deleteUser(body.user_id)
      if (error) throw error
      return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    if (action === 'set_banned') {
      if (!body.user_id || body.user_id === user.id) throw new Error('Invalid user')
      const { error } = await adminClient.from('profiles').update({ is_banned: !!body.value, updated_at: new Date().toISOString() }).eq('id', body.user_id)
      if (error) throw error
      return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    if (action === 'delete_message') {
      const { error } = await adminClient.from('messages').delete().eq('id', body.message_id)
      if (error) throw error
      return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    if (action === 'delete_conversation') {
      const { error } = await adminClient.from('conversations').delete().eq('id', body.conversation_id)
      if (error) throw error
      return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    throw new Error('Unknown action')
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
