// Lê uma foto de fatura OU um print de notificações do banco com a IA (Claude)
// e devolve as compras em JSON. A chave da Anthropic fica em segredo aqui no servidor.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const MODELOS = ["claude-haiku-4-5-20251001", "claude-sonnet-5", "claude-3-5-haiku-latest"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return json({ error: "Não autenticado" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: permitido } = await admin
      .from("scanner_ia").select("user_id, usos_mes, limite_mes").eq("user_id", user.id).maybeSingle();
    if (!permitido) return json({ error: "Scanner não liberado para esta conta" }, 403);
    if ((permitido.usos_mes ?? 0) >= (permitido.limite_mes ?? 100))
      return json({ error: "Limite mensal do scanner atingido" }, 429);

    const { imagem, media_type } = await req.json();
    if (!imagem) return json({ error: "Sem imagem" }, 400);

    const hoje = new Date();
    const anoAtual = hoje.getFullYear();
    const hojeISO = hoje.toISOString().slice(0, 10);
    const chave = (Deno.env.get("ANTHROPIC_API_KEY") || Deno.env.get("ANTHROPIC_KEY") || Deno.env.get("CLAUDE_API_KEY"))!;

    const instrucao =
`Esta imagem é UMA das duas coisas:
(A) a foto de uma FATURA DE CARTÃO DE CRÉDITO brasileira, ou
(B) um PRINT DE TELA com NOTIFICAÇÕES do iPhone.

Extraia as COMPRAS NO CARTÃO, UM OBJETO POR COMPRA.

Responda APENAS com um array JSON válido, sem texto antes ou depois:
[{"data":"AAAA-MM-DD","hora":"HH:MM","desc":"estabelecimento","valor":123.45,"final":"3969","banco":"C6 Bank","parcela":null,"parcelas":null,"origem":"credito"}]

Regras de formato:
- valor: número positivo, ponto decimal (R$ 1.234,56 -> 1234.56).
- data: hoje é ${hojeISO}. "há X min", "agora" e horários soltos = HOJE. "Ontem" = o dia anterior a hoje. Nome de dia da semana abreviado ("sex.", "sáb.") = a ocorrência mais recente daquele dia antes de hoje. Sem ano, use ${anoAtual}. Se o próprio texto trouxer a data completa (ex.: "dia 21/08/2026"), ela MANDA sobre o horário da notificação.
- final: 4 últimos dígitos do cartão quando aparecer no texto; senão null.
- banco: SEMPRE preencha com o nome do banco/emissor que aparece na notificação ou no ícone/título do bloco ("C6 Bank", "Nubank", "Itaú", "Bradesco", "Sicoob", "Mercado Pago"). Se não der pra saber, null.
- origem: "credito" ou "debito"; na dúvida "credito".

REGRA DO CAMPO "desc" (muito importante — siga à risca):
Devolva SÓ o nome do estabelecimento, sem a praça/cidade que o adquirente gruda no fim do texto.
- CORTE a cidade e o estado no final, mesmo sem vírgula separando. Exemplos obrigatórios:
  "AUTO POSTO IGARAI MOCOCA" -> "Auto Posto Igarai"
  "DROGARIA TOTAL SAO JOSE DO RIO PARDO" -> "Drogaria Total"
  "MARTA G GAINO E CIA SAO JOSE DO RIO" -> "Marta G. Gaino e Cia"
  "VALERIA GUAXUPE" -> "Valeria"
  "CARDOSO MOCO MOCOCA" -> "Cardoso Moco"
  "PAG*Restaurante SAO PAULO BRA" -> "Restaurante"
- Se a cidade estiver cortada pela metade no texto ("SAO JOSE DO RIO"), corte assim mesmo.
- Remova também: "BRA", "BR", sigla de estado no fim, prefixos de adquirente ("PAG*", "MP*", "PICPAY*", "IFD*"), códigos numéricos e sufixos LTDA/ME/EPP/EIRELI/S.A.
- NÃO corte quando a palavra faz parte do nome do negócio (ex.: "Olympia Eventos", "Fonseca Supermercados" ficam inteiros).
- Corrija entidades HTML (&amp; -> &). Separe palavras grudadas quando óbvio ("AutoPostoIgarai" -> "Auto Posto Igarai"). Capitalização Normal.
- Se o nome estiver visivelmente truncado na tela ("Pac Centro de Treiname"), devolva exatamente o que dá pra ler, sem inventar o resto.

O QUE CONTA COMO COMPRA (inclua):
1. Notificação com a palavra "compra": "Compra no crédito aprovada", "Sua compra no cartão final X", "Compra aprovada".
2. Notificação da CARTEIRA / APPLE PAY / Wallet: bloco curto com o nome do banco ou cartão (ex.: "C6 Bank", "Nubank", "Sicoob", "Mercado Pago", "Inter", "Itaú", "Bradesco", "Caixa", "PicPay", "Will Bank", "Neon"), o nome do estabelecimento e um valor em R$, sem mais texto. Essas SÃO compras — inclua todas, usando o nome do banco no campo "banco".
   REGRA FIRME: três pedaços na mesma notificação — nome de banco/instituição financeira + nome de estabelecimento + valor em R$ — é SEMPRE compra, mesmo sem a palavra "compra", sem verbo nenhum, sem data, sem hora e sem o final do cartão. Não deixe de fora por falta de contexto; nesse caso o "na dúvida não inclua" NÃO se aplica.
   Exemplo real que precisa entrar: "Sicoob / Vap Gas Auto Posto / R$ 200,00" -> { "desc": "Vap Gas Auto Posto", "valor": 200, "banco": "Sicoob" }.

O QUE IGNORAR COMPLETAMENTE (nunca inclua):
- PAGAMENTO DA PRÓPRIA FATURA e cobranças do emissor aparecendo como se fossem loja: "Nu Pagamentos", "Nubank Pagamentos", "Pagamento de fatura", "Pagamento efetuado", "Pagamento recebido", "PAG FATURA". Se o "estabelecimento" for o nome do próprio banco/emissor do cartão, NÃO é compra.
- Pix (enviado/recebido), transferência, TED, DOC
- boleto (novo boleto, boleto vencendo, pagamento de boleto)
- fatura (fechou, vence, pagamento), limite, empréstimo, saque, rendimento, cashback
- propaganda e promoção de QUALQUER app: lojas e marketplaces (Shopee, Mercado Livre, Amazon, AliExpress), anúncios de produto com preço, cupons e descontos ("cupom de R$10"), programas de pontos
- cotações e alertas de cripto/bolsa (Binance, corretoras): "BTC ultrapassa 77.000 USDT" NÃO é compra
- lembretes pessoais, códigos de verificação, avisos de login e mensagens de segurança
- estorno, cancelamento, compra recusada/não aprovada
Na dúvida sobre um bloco, NÃO inclua.

Outras regras do print:
- Cada notificação de compra vira UM item separado.
- Se um bloco estiver cortado e faltar o valor OU o estabelecimento, ignore.
- A mesma compra repetida na tela entra uma vez só. Mas dois valores diferentes no mesmo estabelecimento (ex.: R$ 10,00 e R$ 20,00 no mesmo posto) SÃO compras diferentes: inclua as duas.

Se for FATURA (A): extraia todas as compras; ignore total, pagamento efetuado, encargos, juros, IOF, limite e saldo.

Se não houver nenhuma compra, responda [].`;

    let resp: Response | null = null;
    let ultimoErro = "";
    for (const modelo of MODELOS) {
      resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": chave, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: modelo,
          max_tokens: 4000,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: media_type || "image/jpeg", data: imagem } },
              { type: "text", text: instrucao },
            ],
          }],
        }),
      });
      if (resp.ok) break;
      ultimoErro = (await resp.text()).slice(0, 300);
      if (!/not_found|model/i.test(ultimoErro)) break;
      resp = null;
    }

    if (!resp || !resp.ok) return json({ error: "IA falhou: " + ultimoErro }, 502);
    const data = await resp.json();
    let texto = (data.content?.[0]?.text || "[]").trim();
    texto = texto.replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();

    let itens;
    try { itens = JSON.parse(texto); } catch { return json({ error: "Não entendi a imagem", raw: texto.slice(0, 200) }, 200); }
    if (!Array.isArray(itens)) itens = [];

    const proibido = /(pix|transfer|\bted\b|\bdoc\b|boleto|fatura|limite|empr[eé]stimo|saque|rendiment|cashback|cupom|estorno|cancelad|recusad|usdt|btc ultrapassa|nu ?pagament|nubank pagament|pagamento (de |da )?fatura|pagamento efetuado|pagamento recebido|pag ?fatura)/i;
    const vistos = new Set<string>();
    itens = itens.filter((x: any) => {
      const v = Math.abs(Number(x?.valor) || 0);
      if (!(v > 0)) return false;
      const desc = String(x?.desc ?? "").trim();
      if (!desc) return false;
      if (proibido.test(desc)) return false;
      const k = `${v}|${x?.data ?? ""}|${desc.toLowerCase()}`;
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });

    await admin.from("scanner_ia")
      .update({ usos_mes: (permitido.usos_mes ?? 0) + 1, ultimo_uso: new Date().toISOString() })
      .eq("user_id", user.id);

    return json({ itens });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
