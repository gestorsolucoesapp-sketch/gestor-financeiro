// Edge Function: excluir-conta
// Apaga TODOS os dados do usuario autenticado e remove o login do auth.users.
// Só o próprio dono da conta consegue apagar a si mesmo (valida o JWT).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const auth = req.headers.get('Authorization') || '';
    const jwt = auth.replace(/^Bearer\s+/i, '').trim();
    if (!jwt) {
      return new Response(JSON.stringify({ ok: false, erro: 'sem token' }), {
        status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const url = Deno.env.get('SUPABASE_URL')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, service, { auth: { persistSession: false } });

    // quem esta chamando?
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ ok: false, erro: 'token invalido' }), {
        status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    const uid = userData.user.id;

    // confirmacao explicita no corpo, pra evitar chamada acidental
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch (_e) { /* corpo vazio */ }
    if (body?.confirmar !== 'EXCLUIR') {
      return new Response(JSON.stringify({ ok: false, erro: 'confirmacao ausente' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const { data, error } = await admin.rpc('apagar_conta_completa', { p_uid: uid });
    if (error) {
      return new Response(JSON.stringify({ ok: false, erro: error.message }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(data), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, erro: String(e) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
