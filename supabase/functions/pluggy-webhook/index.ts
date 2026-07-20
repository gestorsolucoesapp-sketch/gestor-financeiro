// Webhook da Pluggy (Open Finance) — recebe eventos e responde 200.
// Exigido pela Pluggy pra liberar produção. Loga os eventos em of_webhook_log.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  let body: any = {};
  try { body = await req.json(); } catch (_e) { /* corpo vazio/inválido */ }

  const event  = body?.event ?? body?.eventName ?? "unknown";
  const itemId = body?.itemId ?? body?.item?.id ?? null;

  // registra o evento (best-effort — nunca bloqueia a resposta 200)
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (url && key) {
      const sb = createClient(url, key);
      await sb.from("of_webhook_log").insert({ event, item_id: itemId, payload: body });
    }
  } catch (_e) { /* ignora: o importante é responder 2xx pra Pluggy */ }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
