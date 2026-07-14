// Avisa no celular os compromissos DE HOJE da agenda (com avisar=true).
// Chamada pelo cron do GitHub Actions toda manhã.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  try {
    // trava: só o cron (com a chave) pode disparar
    const key = req.headers.get("x-cron-key") || "";
    if (key !== Deno.env.get("CRON_SECRET")) {
      return new Response("negado", { status: 401 });
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // hoje no fuso de São Paulo
    const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

    const { data: itens, error } = await sb
      .from("agenda")
      .select("id, user_id, titulo, hora")
      .eq("data", hoje)
      .eq("avisar", true)
      .eq("feito", false)
      .is("avisado_em", null);

    if (error) return new Response("erro agenda: " + error.message, { status: 200 });
    if (!itens?.length) return new Response("nada para avisar", { status: 200 });

    // agrupa por usuário
    const porUser = new Map<string, typeof itens>();
    for (const it of itens) {
      if (!porUser.has(it.user_id)) porUser.set(it.user_id, []);
      porUser.get(it.user_id)!.push(it);
    }

    webpush.setVapidDetails(
      Deno.env.get("VAPID_SUBJECT")!,
      Deno.env.get("VAPID_PUBLIC")!,
      Deno.env.get("VAPID_PRIVATE")!,
    );

    let enviados = 0;
    for (const [userId, lista] of porUser) {
      const { data: subs } = await sb
        .from("push_subs")
        .select("id, subscription")
        .eq("user_id", userId);
      if (!subs?.length) continue;

      const linhas = lista.map((a) =>
        a.hora ? `${a.titulo} às ${String(a.hora).slice(0, 5)}` : a.titulo
      );
      const body = lista.length === 1
        ? `Hoje: ${linhas[0]}`
        : `Hoje você tem ${lista.length} compromissos:\n• ` + linhas.join("\n• ");

      const payload = JSON.stringify({
        title: "📅 Agenda",
        body,
        url: "./",
      });

      await Promise.all(subs.map(async (s) => {
        try {
          await webpush.sendNotification(s.subscription, payload);
          enviados++;
        } catch (err: any) {
          if (err && (err.statusCode === 404 || err.statusCode === 410)) {
            await sb.from("push_subs").delete().eq("id", s.id);
          }
        }
      }));

      // marca como avisado (não repete no mesmo dia)
      await sb.from("agenda")
        .update({ avisado_em: new Date().toISOString() })
        .in("id", lista.map((a) => a.id));
    }

    return new Response(`ok: ${enviados} push(es) para ${porUser.size} pessoa(s)`, { status: 200 });
  } catch (e: any) {
    return new Response("erro: " + (e?.message || e), { status: 200 });
  }
});
