/**
 * Encerramento de dúvida respondida: regras puras (sem banco).
 *
 * A IA respondeu e não deixou pergunta para o cliente; 5 min sem mensagem
 * dele → mensagem de encerramento ("Qualquer dúvida, ficamos à disposição!")
 * e o atendimento é encerrado. Se depois o cliente só agradecer ("ok,
 * obrigado"), a conversa fecha de novo sem resposta (inbound-message.processor).
 */
import { FollowupMessage, isQuoteText } from './quote-followup';

export const IDLE_CLOSE_DELAY_MS = 5 * 60_000;
/** Passou desse atraso sem encerrar (deploy, fila parada): deixa como está. */
export const IDLE_CLOSE_MAX_LATE_MS = 30 * 60_000;

/** Mensagem de encerramento (o fluxo `encerramento-duvidas`, se existir, substitui). */
export const IDLE_CLOSE_FLOW_SLUG = 'encerramento-duvidas';
export const DEFAULT_IDLE_CLOSE_MESSAGES = ['Qualquer dúvida, ficamos à disposição!'];

/** Transferência para a equipe: quem continua é o atendente. */
const TRANSFER_RE = /vou transferir (o )?seu atendimento/i;
/**
 * Pedido de retorno sem "?" ("Depois me diga se alguma operadora conectou.",
 * "Me envie o print da tela…"): o cliente ainda tem que responder.
 */
const AWAITS_REPLY_RE =
  /\b(me|nos)\s+(diga|avise|conte|conta|envie|mande|manda|informe|fale|fala|retorne|responda)\b|\b(aguardo|fico no aguardo)\b|\bassim que (testar|conseguir|fizer|puder)\b/i;
/**
 * Cliente relatou problema no chip (sem internet, lenta, sem sinal…): é
 * suporte, não dúvida — quem encerra é a IA quando resolver ou o atendente.
 */
const PROBLEM_RE =
  /\b(sem (internet|sinal|rede|dados|servi[çc]o)|lent[oa]|devagar|n[ãa]o (funciona|conecta|pega|carrega|abre|navega|est[áa] funcionando)|parou|caindo|cai toda hora|inst[áa]vel|travando|n[ãa]o consigo (usar|instalar|navegar|conectar))\b/i;
/** A IA já se despediu: encerra sem mandar outra mensagem. */
const FAREWELL_RE = /[óo]tima viagem|at[ée] mais|ficamos [àa] disposi|estamos [àa] disposi/i;

export type IdleCloseDecision =
  | { close: true; agentId: string; lastMessageId: string; sendMessage: boolean }
  | { close: false; reason: string };

/** `messages` em ordem cronológica (só as que a IA enxerga). */
export function decideIdleClose(messages: FollowupMessage[], now: Date): IdleCloseDecision {
  const real = messages.filter((m) => !m.fromChatbot);
  const last = real[real.length - 1];
  if (!last) return { close: false, reason: 'vazia' };
  if (last.direction !== 'OUTBOUND' || !last.aiAgentId) return { close: false, reason: 'ultima-nao-e-da-ia' };

  // A última resposta: as mensagens nossas depois da última do cliente.
  let i = real.length - 1;
  while (i >= 0 && real[i].direction === 'OUTBOUND') i--;
  if (i < 0) return { close: false, reason: 'cliente-nao-falou' };
  const turn = real.slice(i + 1);
  if (turn.some((m) => !m.aiAgentId)) return { close: false, reason: 'atendente' };
  if (turn.some((m) => TRANSFER_RE.test(m.text))) return { close: false, reason: 'transferido' };
  // Pergunta para o cliente (links com "?" não contam) ou pedido de retorno.
  if (turn.some((m) => m.text.replace(/https?:\/\/\S+/gi, ' ').includes('?') || AWAITS_REPLY_RE.test(m.text))) {
    return { close: false, reason: 'pergunta-pendente' };
  }
  // Problema relatado no chip: não é dúvida respondida.
  if (real.some((m) => m.direction === 'INBOUND' && PROBLEM_RE.test(m.text))) return { close: false, reason: 'suporte' };
  // Cotação: quem cobra e encerra é a cobrança de cotação.
  if (real.some((m) => m.direction === 'OUTBOUND' && isQuoteText(m.text))) return { close: false, reason: 'cotacao' };

  const idle = now.getTime() - last.createdAt.getTime();
  if (idle < IDLE_CLOSE_DELAY_MS) return { close: false, reason: 'ainda-nao' };
  if (idle > IDLE_CLOSE_DELAY_MS + IDLE_CLOSE_MAX_LATE_MS) return { close: false, reason: 'atrasado-demais' };
  return {
    close: true,
    agentId: last.aiAgentId,
    lastMessageId: last.id,
    sendMessage: !turn.some((m) => FAREWELL_RE.test(m.text)),
  };
}

const ACK_WORDS = new Set(
  (
    'ok okay oks okk okey blz beleza obrigado obrigada obrigadao obrigadinho obrigadinha obg brigado brigada ' +
    'valeu vlw perfeito otimo show top certo entendi entendido combinado ta legal joia grato grata agradeco ' +
    'agradecido agradecida muito mto mt muitissimo sim boa bom noite dia tarde abraco abracos abs tchau ate ' +
    'mais logo pra pela atencao ajuda de nada tudo certinho maravilha excelente massa fechado e voce vc tambem tb ' +
    'thanks thank you thx gracias'
  ).split(' '),
);

/** Mensagem que só agradece/confirma ("ok, obrigado!", "Valeu 🙏", "👍"). */
export function isAcknowledgment(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const words = t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return true; // só emoji/pontuação: 👍 🙏
  if (words.length > 8) return false;
  // "Boa noite" sozinho é cumprimento (pode vir uma pergunta nova), não agradecimento.
  return words.every((w) => ACK_WORDS.has(w)) && words.some((w) => ACK_CORE.has(w));
}

const ACK_CORE = new Set(
  (
    'ok okay oks okk okey blz beleza obrigado obrigada obrigadao obrigadinho obrigadinha obg brigado brigada ' +
    'valeu vlw perfeito otimo show top certo entendi entendido combinado joia grato grata agradeco agradecido ' +
    'agradecida certinho maravilha excelente fechado thanks thank thx gracias'
  ).split(' '),
);
