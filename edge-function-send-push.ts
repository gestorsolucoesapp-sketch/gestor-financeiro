// Supabase Edge Function: send-push
// Dispara notificação push para quem visualiza as finanças do autor do lançamento.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const record = body.record || body; // webhook do Supabase manda { record: {...} }
    if (!record || !record.user_id) {
      return new Response("sem registro", { status: 200 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // quem pode VER as finanças deste autor (parceiros ativos)
    const { data: shares } = await supabase
      .from("compartilhamentos")
      .select("viewer_id")
      .eq("owner_id", record.user_id)
      .eq("status", "ativo");

    const viewerIds = (shares || []).map((s) => s.viewer_id).filter(Boolean);
    if (!viewerIds.length) return new Response("sem visualizadores", { status: 200 });

    const { data: subs } = await supabase
      .from("push_subs")
      .select("id, subscription")
      .in("user_id", viewerIds);

    if (!subs || !subs.length) return new Response("sem dispositivos", { status: 200 });

    webpush.setVapidDetails(
      Deno.env.get("VAPID_SUBJECT")!,
      Deno.env.get("VAPID_PUBLIC")!,
      Deno.env.get("VAPID_PRIVATE")!
    );

    const valor = Number(record.valor || 0).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
    const verbo = record.tipo === "receita" ? "Entrada" : "Gasto";
    const payload = JSON.stringify({
      title: "Gestor Financeiro",
      body: `${verbo}: ${record.descricao || "lançamento"} · ${valor}`,
      url: "./",
    });

    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(s.subscription, payload);
        } catch (err) {
          // assinatura expirada/inválida → remove
          if (err && (err.statusCode === 404 || err.statusCode === 410)) {
            await supabase.from("push_subs").delete().eq("id", s.id);
          }
        }
      })
    );

    return new Response("ok", { status: 200 });
  } catch (e) {
    return new Response("erro: " + (e?.message || e), { status: 200 });
  }
});
