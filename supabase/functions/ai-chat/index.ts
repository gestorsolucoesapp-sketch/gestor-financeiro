// Edge Function: ai-chat — Assistente do Gestor Financeiro (protegida + admin ilimitado)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const LIMITE_DIA = 40;
const ADMIN_ID = "9edee685-c907-4fb2-9782-41f3ab44e315";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const jwt = (req.headers.get("authorization") || "").replace("Bearer ", "");
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user } } = await supa.auth.getUser(jwt);
    if (!user) {
      return new Response(JSON.stringify({ ok: false, erro: "não autenticado" }), { status: 401, headers: { ...CORS, "content-type": "application/json" } });
    }

    const ehAdmin = user.id === ADMIN_ID;
    const hoje = new Date().toISOString().slice(0, 10);
    const { data: u } = await supa.from("ia_uso").select("usos").eq("user_id", user.id).eq("dia", hoje).maybeSingle();
    const usos = u?.usos ?? 0;
    if (!ehAdmin && usos >= LIMITE_DIA) {
      return new Response(JSON.stringify({ ok: false, erro: `Limite diário de ${LIMITE_DIA} mensagens atingido. Volta amanhã 😉`, limite: { usos_hoje: usos, limite_dia: LIMITE_DIA } }), { status: 429, headers: { ...CORS, "content-type": "application/json" } });
    }
    await supa.from("ia_uso").upsert({ user_id: user.id, dia: hoje, usos: usos + 1 });

    const { mensagens, resumo, pode_excluir } = await req.json();

    const acaoExcluir = pode_excluir
      ? `\n3) SEMPRE que o usuário pedir para excluir/apagar/remover/deletar um lançamento, retorne: {"acao":"excluir_lancamento","descricao":"o que o usuário disse (se ele citou um nome)","valor":123.45 (se ele citou um valor),"data":"YYYY-MM-DD" (se ele citou quando)}. IMPORTANTE: NÃO confira se o lançamento existe no resumo — o resumo mostra só uma parte, e é o APP que faz a busca completa no banco. Nunca responda "não encontrei" para pedidos de exclusão. Só use acao responder se o pedido não tiver NEM descrição NEM valor (aí pergunte qual lançamento ele quer excluir).`
      : `\nO usuário NÃO autorizou exclusão por aqui. Se ele pedir pra excluir/apagar algo, responda com "acao":"responder" explicando que precisa ativar "IA pode excluir lançamentos" nas configurações do assistente primeiro.`;

    const system = `Você é o assistente do app Gestor Financeiro do usuário. Responda em português do Brasil, curto e direto.
Dados atuais do usuário: ${resumo}

Você DEVE responder SEMPRE com JSON puro, sem markdown, em UM destes formatos:
1) Para responder perguntas: {"acao":"responder","texto":"sua resposta aqui"}
2) Quando o usuário pedir para lançar/registrar uma despesa ou receita: {"acao":"criar_lancamento","tipo":"despesa" ou "receita","descricao":"...","valor":123.45,"data":"YYYY-MM-DD","conta_nome":"nome de uma das contas disponíveis","categoria_nome":"nome de uma das categorias disponíveis"}${acaoExcluir}

Regras: use as contas e categorias listadas no resumo (escolha a mais parecida). Se o usuário não disser a data, use a de hoje. Se faltar informação essencial (valor), pergunte via acao responder. Valores em reais, número com ponto decimal.`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 800, system, messages: mensagens }),
    });

    const data = await r.json();
    if (data.error) throw new Error(data.error.message || "Erro na API");
    const texto = (data.content || []).map((c) => c.text || "").join("");

    return new Response(JSON.stringify({ ok: true, texto, limite: { usos_hoje: usos + 1, limite_dia: ehAdmin ? 9999 : LIMITE_DIA } }), { headers: { ...CORS, "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, erro: String(e?.message || e) }), { status: 500, headers: { ...CORS, "content-type": "application/json" } });
  }
});
