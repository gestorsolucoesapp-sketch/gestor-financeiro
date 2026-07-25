// Lê uma foto de fatura com a IA (Claude) e devolve as compras em JSON.
// A chave da Anthropic fica em segredo aqui no servidor — nunca no app.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    // 1) quem está chamando (via JWT do Supabase)
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return json({ error: "Não autenticado" }, 401);

    // 2) só quem está liberado pode usar (protege seus créditos)
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: permitido } = await admin
      .from("scanner_ia").select("user_id, usos_mes, limite_mes").eq("user_id", user.id).maybeSingle();
    if (!permitido) return json({ error: "Scanner não liberado para esta conta" }, 403);
    if ((permitido.usos_mes ?? 0) >= (permitido.limite_mes ?? 100))
      return json({ error: "Limite mensal do scanner atingido" }, 429);

    // 3) recebe a imagem (base64) e o media type
    const { imagem, media_type } = await req.json();
    if (!imagem) return json({ error: "Sem imagem" }, 400);

    // 4) chama a IA
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": (Deno.env.get("ANTHROPIC_API_KEY") || Deno.env.get("ANTHROPIC_KEY") || Deno.env.get("CLAUDE_API_KEY"))!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 4000,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: media_type || "image/jpeg", data: imagem } },
            { type: "text", text:
`Esta é a foto de uma FATURA DE CARTÃO DE CRÉDITO brasileira. Extraia TODAS as compras/lançamentos.
Responda APENAS com um array JSON válido, sem texto antes ou depois, no formato:
[{"data":"AAAA-MM-DD","desc":"estabelecimento","valor":123.45,"parcela":null,"parcelas":null}]
Regras: valor sempre número positivo (ponto decimal). Se a compra for parcelada (ex: 03/12), preencha parcela e parcelas. Se não houver ano na data, use ${new Date().getFullYear()}. Ignore linhas de total, pagamento, encargos, limite e saldo. Se não conseguir ler nada, responda [].` },
          ],
        }],
      }),
    });

    if (!resp.ok) return json({ error: "IA falhou: " + (await resp.text()).slice(0, 200) }, 502);
    const data = await resp.json();
    let texto = (data.content?.[0]?.text || "[]").trim();
    texto = texto.replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();

    let itens;
    try { itens = JSON.parse(texto); } catch { return json({ error: "Não entendi a fatura", raw: texto.slice(0, 200) }, 200); }

    // 5) conta o uso
    await admin.from("scanner_ia")
      .update({ usos_mes: (permitido.usos_mes ?? 0) + 1, ultimo_uso: new Date().toISOString() })
      .eq("user_id", user.id);

    return json({ itens });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
