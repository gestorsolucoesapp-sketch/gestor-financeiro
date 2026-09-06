// Lê foto de fatura, print de notificações ou e-mail do banco com a IA (Claude)
// e devolve os movimentos em JSON: compras no cartão E movimentos de conta (Pix/transferência/débito).
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
`Esta imagem é UMA das três coisas:
(A) foto de uma FATURA DE CARTÃO DE CRÉDITO brasileira,
(B) print de NOTIFICAÇÕES do iPhone, ou
(C) print de CAIXA DE ENTRADA DE E-MAIL ou de app de banco.

Extraia todo MOVIMENTO DE DINHEIRO REAL, um objeto por movimento.

Responda APENAS com um array JSON válido, começando com [ e terminando com ], sem nenhum texto antes ou depois, sem crases:
[{"tipo":"despesa","origem":"credito","data":"AAAA-MM-DD","hora":"HH:MM","desc":"estabelecimento","valor":123.45,"final":"3969","banco":"C6 Bank","parcela":null,"parcelas":null,"fonte":"notificacao","evidencia":"Compra no crédito aprovada"}]

CAMPO "origem" — o mais importante, define onde o dinheiro passou:
- "credito": compra no CARTÃO DE CRÉDITO. Ex.: "Compra no crédito aprovada", "Sua compra no cartão final 3969", Apple Pay/Carteira.
- "debito": compra no cartão de DÉBITO (sai da conta na hora).
- "transferencia": Pix, TED, DOC ou transferência que SAIU DA CONTA. Ex.: "Transferência de R$ 3,00 para AUTO POSTO IGARAI LTDA foi concluída", "Pix enviado para", "Pagamento realizado para".
Nunca marque "credito" quando o texto falar em transferência, Pix, TED ou DOC — mesmo que o destinatário seja claramente uma loja ou posto. Nesse caso é sempre "transferencia".

CAMPO "tipo":
- "despesa": dinheiro saiu (compra, Pix enviado, transferência enviada).
- "receita": dinheiro entrou (Pix recebido, transferência recebida, salário). Nesse caso "desc" é o nome de quem pagou.

CAMPOS DE PROVA:
- "fonte": "fatura" (veio de fatura impressa), "carteira" (bloco curto de carteira, ver regra abaixo) ou "notificacao" (notificação, e-mail ou tela de app).
- "evidencia": copie LITERALMENTE o trecho que prova o movimento ("Compra no crédito aprovada", "Transferência realizada com sucesso", "Pix recebido de"). Se não houver trecho assim, NÃO inclua o item. Nunca invente.

NOTIFICAÇÃO DE CARTEIRA SEM VERBO — REGRA FIRME:
Bloco curto formado por três pedaços — nome de banco ou instituição financeira ("Sicoob", "C6 Bank", "Nubank", "Mercado Pago", "Inter", "Itaú", "Bradesco", "Caixa", "PicPay", "Neon", "Will Bank"), nome de estabelecimento e um valor em R$ — É COMPRA, mesmo sem nenhum verbo, sem a palavra "compra", sem data, sem hora e sem o final do cartão.
Nesses casos use fonte "carteira" e copie o bloco inteiro em "evidencia". Aqui o "na dúvida não inclua" NÃO se aplica: inclua.
Exemplo real que PRECISA entrar:
  Sicoob / Vap Gas Auto Posto / R$ 200,00
  -> {"tipo":"despesa","origem":"credito","data":"${hojeISO}","desc":"Vap Gas Auto Posto","valor":200,"final":null,"banco":"Sicoob","fonte":"carteira","evidencia":"Sicoob · Vap Gas Auto Posto · R$ 200,00"}
Não confunda com linha de saldo: "Saldo disponível R$ 4.169,27" e "0% do limite de R$ 1.700,00" continuam FORA.

Regras de formato:
- valor: número positivo, ponto decimal (R$ 1.234,56 -> 1234.56).
- data: hoje é ${hojeISO}. "há X min", "agora" e horários soltos = HOJE. "Ontem" = o dia anterior. Dia da semana abreviado ("sex.", "sáb.") = a ocorrência mais recente antes de hoje. Sem ano, use ${anoAtual}. Data completa no texto ("dia 21/08/2026") MANDA sobre o horário.
- final: 4 últimos dígitos do cartão quando aparecer; senão null.
- banco: nome do banco/emissor que aparece no bloco ("C6 Bank", "Nubank", "Itaú", "Sicoob", "Mercado Pago"). Se não der pra saber, null.

REGRA DO CAMPO "desc":
Só o nome do estabelecimento ou da pessoa, sem a cidade que o adquirente gruda no fim.
  "AUTO POSTO IGARAI MOCOCA" -> "Auto Posto Igarai"
  "DROGARIA TOTAL SAO JOSE DO RIO PARDO" -> "Drogaria Total"
  "MARTA G GAINO E CIA SAO JOSE DO RIO" -> "Marta G. Gaino e Cia"
  "VALERIA GUAXUPE" -> "Valeria"
  "AUTO POSTO IGARAI LTDA" -> "Auto Posto Igarai"
Remova: "BRA", "BR", sigla de estado no fim, prefixos de adquirente ("PAG*", "MP*", "PICPAY*", "IFD*"), códigos numéricos e sufixos LTDA/ME/EPP/EIRELI/S.A.
NÃO corte quando a palavra faz parte do nome do negócio ("Olympia Eventos", "Fonseca Supermercados").
Corrija entidades HTML (&amp; -> &). Separe palavras grudadas ("AutoPostoIgarai" -> "Auto Posto Igarai"). Capitalização Normal. Se estiver truncado na tela, devolva o que dá pra ler, sem inventar.

O QUE IGNORAR COMPLETAMENTE (nunca inclua):
- PAGAMENTO DA PRÓPRIA FATURA e cobranças do emissor como se fossem loja: "Nu Pagamentos", "Nubank Pagamentos", "Pagamento de fatura", "Pagamento efetuado", "PAG FATURA". Isso só quita algo já lançado.
- transferência ENTRE CONTAS DO PRÓPRIO DONO ("transferi para minha conta", "resgate", "aplicação", "CDB", "caixinha", "rendimento")
- saldo disponível, limite disponível, fatura fechada, boleto (novo, vencendo ou pago), empréstimo, saque, cashback, score de crédito, negociação de dívida
- propaganda e promoção de app: Shopee, Mercado Livre, Amazon, AliExpress, anúncio com preço, cupom, pontos
- cotações de cripto/bolsa: "BTC ultrapassa 77.000 USDT" NÃO é movimento
- lembretes, códigos de verificação, avisos de login, e-mail de rede social
- estorno, cancelamento, compra recusada/não aprovada
Na dúvida, NÃO inclua — a única exceção é a regra da carteira sem verbo, logo acima.

Outras regras:
- Cada notificação vira UM item.
- Bloco cortado sem valor OU sem nome: ignore.
- Movimento repetido na tela entra uma vez só. Mas dois valores diferentes no mesmo lugar (R$ 10,00 e R$ 20,00 no mesmo posto) SÃO movimentos diferentes: inclua os dois.

Se for FATURA (A): todas as linhas são tipo="despesa", origem="credito", fonte="fatura"; ignore total, pagamento efetuado, encargos, juros, IOF, limite e saldo.

Se não houver nenhum movimento, responda [].`;

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
          // força a resposta a começar no array — mata o "não entendi a imagem"
        }),
      });
      if (resp.ok) break;
      ultimoErro = (await resp.text()).slice(0, 300);
      if (!/not_found|model/i.test(ultimoErro)) break;
      resp = null;
    }

    if (!resp || !resp.ok) return json({ error: "IA falhou: " + ultimoErro }, 502);
    const data = await resp.json();
    let texto = (data.content || []).filter((c: any) => c?.type === "text").map((c: any) => c.text).join("\n").trim();
    texto = texto.replace(/```json/gi, "").replace(/```/g, "").trim();

    let itens: any = null;
    try { itens = JSON.parse(texto); } catch { /* segue pro plano B */ }
    if (!Array.isArray(itens)) {
      // plano B: pesca o primeiro array que existir no meio do texto
      const i = texto.indexOf("["), f = texto.lastIndexOf("]");
      if (i >= 0 && f > i) { try { itens = JSON.parse(texto.slice(i, f + 1)); } catch { /* nada */ } }
    }
    if (!Array.isArray(itens)) return json({ itens: [], ignorados: [], aviso: "Não consegui identificar movimentos nessa imagem" });

    const proibido = /(nu ?pagament|nubank pagament|pagamento (de |da )?fatura|pagamento efetuado|pag ?fatura|boleto|saldo dispon[ií]vel|limite dispon[ií]vel|limite|empr[eé]stimo|saque|rendiment|cashback|cupom|estorno|cancelad|recusad|usdt|btc ultrapassa|score)/i;
    const provaOk = /(compra|aprovad|carteira|apple ?pay|google ?pay|wallet|no cr[eé]dito|no d[eé]bito|transfer|pix|enviad|recebid|conclu[ií]d)/i;

    const vistos = new Set<string>();
    const ignorados: string[] = [];
    itens = itens.filter((x: any) => {
      const v = Math.abs(Number(x?.valor) || 0);
      if (!(v > 0)) return false;
      const desc = String(x?.desc ?? "").trim();
      if (!desc) return false;
      if (proibido.test(desc)) { ignorados.push(desc); return false; }

      const fonte = String(x?.fonte ?? "notificacao").toLowerCase();
      const evid = String(x?.evidencia ?? "");
      // "fatura" e "carteira" não precisam de verbo na evidência: o formato do bloco já é a prova
      if (fonte !== "fatura" && fonte !== "carteira" && (!evid || !provaOk.test(evid))) { ignorados.push(desc); return false; }
      if (fonte === "carteira" && proibido.test(evid)) { ignorados.push(desc); return false; }

      // rede de segurança: se a evidência fala em transferência/Pix, a origem NUNCA pode ser crédito
      if (/(transfer|\bpix\b|\bted\b|\bdoc\b|enviad[oa] para|pagamento para)/i.test(evid)) x.origem = "transferencia";
      if (!x.origem) x.origem = fonte === "fatura" ? "credito" : "credito";
      if (!x.tipo) x.tipo = /recebid/i.test(evid) ? "receita" : "despesa";

      const k = `${v}|${x?.data ?? ""}|${x?.hora ?? ""}|${desc.toLowerCase()}`;
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });

    await admin.from("scanner_ia")
      .update({ usos_mes: (permitido.usos_mes ?? 0) + 1, ultimo_uso: new Date().toISOString() })
      .eq("user_id", user.id);

    return json({ itens, ignorados: ignorados.slice(0, 10) });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
