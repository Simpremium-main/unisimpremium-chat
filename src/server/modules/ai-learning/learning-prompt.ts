/**
 * Prompt do "redator" do aprendizado: a partir da orientação do admin,
 * escreve a resposta pro cliente (casos de pedir_ajuda) e propõe onde o
 * aprendizado deve ficar. Sai em JSON pro admin revisar e aprovar.
 */
export const LEARNING_SYSTEM_PROMPT = `Você ajuda a equipe da Uni (chips internacionais e eSIM) a ensinar o assistente virtual que atende clientes no WhatsApp.

Responda SOMENTE com um JSON válido, sem texto antes ou depois.

## Onde guardar o aprendizado ("aprendizado.tipo")
- "FLUXO": o cliente deve receber SEMPRE as mesmas mensagens prontas (passo a passo, texto fixo, links). Preencha "gatilho" (a situação do cliente, descrita de forma geral), "mensagens" (lista, uma ideia por mensagem, formato WhatsApp com *negrito*) e, se precisar, "instrucoes" (o que a IA faz antes/depois de enviar).
- "CONHECIMENTO": fato, informação ou política que a IA usa para responder com as próprias palavras. Só entra na conversa quando o assunto aparece — preferível para informações específicas. Preencha "conteudo" (claro e completo) e "palavras_chave" (termos e sinônimos que o CLIENTE usaria, sem acento).
- "TEMPORARIO": igual a CONHECIMENTO, mas vale por tempo limitado (promoção, greve, instabilidade de operadora). Preencha também "expira_em" (AAAA-MM-DD).
- "REGRA": muda o comportamento da IA em TODAS as conversas (como agir, o que nunca fazer, quando transferir). Fica sempre no prompt, então use só para regras gerais e curtas. Preencha "regra" (uma frase imperativa).
- "NENHUM": só vale para este caso (dados de um pedido específico, exceção pontual).

## Regras
- Use SOMENTE o que a equipe orientou. Não invente preços, prazos, links ou políticas.
- NUNCA coloque dados pessoais no aprendizado (nome, telefone, e-mail, CPF, número de pedido) — generalize.
- Se um item existente (lista "Já cadastrado") trata do mesmo assunto, prefira atualizá-lo: "atualizar": {"tipo": "FLUXO"|"CONHECIMENTO", "id": "..."} e escreva o conteúdo completo já atualizado. Se a orientação contradiz um item existente, diga isso em "motivo".
- "titulo": curto (até 60 caracteres). "motivo": 1 frase explicando a escolha do tipo.
- Mensagens para o cliente: tom de atendente de WhatsApp, frases curtas, sem "Fico à disposição", "Se precisar…", "Posso ajudar em mais alguma coisa?". Sem markdown (#, **), negrito com *asterisco simples*.`;

export const HELP_JSON_SHAPE = `{
  "resumo": "1-2 frases: o que o cliente queria e por que a IA não soube",
  "resposta": ["mensagem 1 para ESTE cliente", "mensagem 2 (opcional)"],
  "aprendizado": {
    "tipo": "FLUXO | CONHECIMENTO | TEMPORARIO | REGRA | NENHUM",
    "motivo": "...", "titulo": "...",
    "gatilho": "...", "instrucoes": "...", "mensagens": ["..."],
    "conteudo": "...", "palavras_chave": "...", "expira_em": "AAAA-MM-DD ou null",
    "regra": "...",
    "atualizar": null
  }
}`;

export const TEACH_JSON_SHAPE = `{
  "aprendizado": {
    "tipo": "FLUXO | CONHECIMENTO | TEMPORARIO | REGRA",
    "motivo": "...", "titulo": "...",
    "gatilho": "...", "instrucoes": "...", "mensagens": ["..."],
    "conteudo": "...", "palavras_chave": "...", "expira_em": "AAAA-MM-DD ou null",
    "regra": "...",
    "atualizar": null
  }
}`;

export interface ExistingItems {
  knowledge: Array<{ id: string; title: string; content: string }>;
  flows: Array<{ id: string; name: string; trigger: string }>;
  rules: string[];
}

export function renderExisting(e: ExistingItems): string {
  const k = e.knowledge.length
    ? e.knowledge.map((x) => `- [CONHECIMENTO id=${x.id}] ${x.title}: ${x.content.replace(/\s+/g, ' ').slice(0, 300)}`).join('\n')
    : '- (nenhum conhecimento parecido)';
  const f = e.flows.length
    ? e.flows.map((x) => `- [FLUXO id=${x.id}] ${x.name} — gatilho: ${x.trigger.replace(/\s+/g, ' ').slice(0, 200)}`).join('\n')
    : '- (nenhum fluxo)';
  const r = e.rules.length ? e.rules.map((x) => `- ${x}`).join('\n') : '- (nenhuma regra aprendida)';
  return `## Já cadastrado\n### Conhecimento parecido\n${k}\n### Fluxos\n${f}\n### Regras aprendidas no prompt\n${r}`;
}

/** Primeiro objeto JSON do texto (o modelo às vezes embrulha em ```json). */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Seção do prompt do agente onde ficam as regras aprendidas. */
export const LEARNED_RULES_HEADER = '## Regras aprendidas (Jarvis → Aprendizado)';

export function learnedRules(systemPrompt: string): string[] {
  const i = systemPrompt.indexOf(LEARNED_RULES_HEADER);
  if (i < 0) return [];
  const rest = systemPrompt.slice(i + LEARNED_RULES_HEADER.length);
  const next = rest.search(/\n## /);
  return (next >= 0 ? rest.slice(0, next) : rest)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2));
}

/** Acrescenta a regra na seção (cria a seção no fim se não existir). */
export function appendRule(systemPrompt: string, rule: string): string {
  const line = `- ${rule.replace(/\s+/g, ' ').trim()}`;
  const i = systemPrompt.indexOf(LEARNED_RULES_HEADER);
  if (i < 0) return `${systemPrompt.trimEnd()}\n\n${LEARNED_RULES_HEADER}\n${line}\n`;
  const after = i + LEARNED_RULES_HEADER.length;
  const rest = systemPrompt.slice(after);
  const next = rest.search(/\n## /);
  const end = next >= 0 ? after + next : systemPrompt.length;
  return `${systemPrompt.slice(0, end).trimEnd()}\n${line}${systemPrompt.slice(end)}`;
}
