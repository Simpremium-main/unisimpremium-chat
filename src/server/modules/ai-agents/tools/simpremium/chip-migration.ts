/**
 * Migração de chip (trocar de aparelho / passar o chip para outro celular).
 *
 * Regras da Simpremium:
 *  - Chip físico → outro aparelho: funciona em qualquer aparelho desbloqueado.
 *  - Físico → virtual e virtual → virtual: só nos planos das operadoras
 *    PREPAID, UNI e TIM; nas demais não é possível.
 *  - Virtual → virtual, dados necessários por operadora:
 *      PREPAID: EID e IMEI2 do aparelho anterior e do novo (2 a 4 horas, entre 12h e 20h)
 *      UNI:     IMEI2 do aparelho anterior e do novo (1 a 3 horas)
 *      TIM:     ICCID do eSIM instalado no aparelho anterior (alguns minutos)
 *    Instruções por e-mail e nova taxa de ativação (USD 5,95 / R$ 30) pelo Pix.
 *  - Sempre termina em transferência para o atendente, com o pedido na nota.
 *
 * A operadora sai das ativações do pedido aqui no servidor; a IA só recebe
 * o que dizer ao cliente (nunca o nome da operadora).
 */

export type MigrationOperator = 'PREPAID' | 'UNI' | 'TIM';
export type ChipKind = 'fisico' | 'virtual';

export const MIGRATION_FEE = { usd: '5,95', brl: '30' } as const;
export const MIGRATION_PIX = 'pix@simpremium.com.br';

const OPERATOR_KEYS = new Set(['operator', 'operadora', 'operator_name', 'operatorname', 'plan', 'plan_name', 'planname', 'plan_code', 'plancode']);

/** Operadora de cada ativação, pelo nome da operadora/plano (TIM-EUROPA → TIM). */
export function operatorOf(text: string): MigrationOperator | 'OUTRA' {
  if (/\bPREPAID\b/i.test(text)) return 'PREPAID';
  if (/\bUNI\b/i.test(text)) return 'UNI';
  if (/\bTIM\b/i.test(text)) return 'TIM';
  return 'OUTRA';
}

/**
 * Operadora das ativações de um pedido: null se não veio; 'VARIAS' se o
 * pedido tem chips de operadoras diferentes (o atendente confere qual).
 */
export function migrationOperator(raw: unknown): MigrationOperator | 'OUTRA' | 'VARIAS' | null {
  const found = new Set<MigrationOperator | 'OUTRA'>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    const parts: string[] = [];
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (OPERATOR_KEYS.has(k.toLowerCase()) && typeof val === 'string' && val.trim()) parts.push(val);
      else if (val && typeof val === 'object') walk(val);
    }
    if (parts.length) found.add(operatorOf(parts.join(' ')));
  };
  walk(raw);
  if (found.size === 0) return null;
  if (found.size > 1) return 'VARIAS';
  return [...found][0];
}

const VIRTUAL_RULES: Record<MigrationOperator, { dados: string; prazo: string }> = {
  PREPAID: {
    dados:
      'o EID e o IMEI2 do aparelho ANTERIOR e do aparelho NOVO (nos dois aparelhos, discando *#06# aparecem o EID e os IMEIs)',
    prazo: 'de 2 a 4 horas, feito entre 12h e 20h',
  },
  UNI: {
    dados: 'o IMEI2 do aparelho ANTERIOR e do aparelho NOVO (discando *#06# aparecem os IMEIs)',
    prazo: 'de 1 a 3 horas',
  },
  TIM: {
    dados:
      'o ICCID do eSIM instalado no aparelho ANTERIOR (é o número que vem abaixo do QR Code no e-mail do eSIM; se não tiver o e-mail, ele aparece nos ajustes do aparelho, nas informações do chip)',
    prazo: 'alguns minutos',
  },
};

const transfer = (orderId: string, what: string, extra = '') =>
  `Depois, chame escalar_para_humano (department "suporte") com reason começando por "Migração de chip — pedido ${orderId}: ${what}"${extra}, e motivo_cliente "dar andamento à migração do seu chip".`;

/** O que a IA diz ao cliente e como transfere, para cada caso. */
export function migrationGuidance(input: {
  orderId: string;
  chipAtual: ChipKind;
  destino: ChipKind;
  operator: MigrationOperator | 'OUTRA' | 'VARIAS' | null;
}): string {
  const { orderId, chipAtual, destino, operator } = input;
  const head = '[MIGRAÇÃO DE CHIP — siga exatamente. NÃO cite o nome da operadora nem o plano ao cliente.]';
  const fee = `uma nova taxa de ativação de USD ${MIGRATION_FEE.usd} (R$ ${MIGRATION_FEE.brl}) para gerar o novo eSIM / QR Code, paga pelo Pix ${MIGRATION_PIX}`;

  if (chipAtual === 'fisico' && destino === 'fisico') {
    return [
      head,
      'Chip físico: diga que ele pode ser colocado em qualquer aparelho desbloqueado — basta tirar do aparelho anterior e colocar no novo.',
      transfer(orderId, 'cliente vai usar o chip físico em outro aparelho (orientado: funciona em qualquer aparelho desbloqueado)'),
    ].join('\n');
  }

  if (chipAtual === 'virtual' && destino === 'fisico') {
    return [
      head,
      'Virtual → físico não está nas regras de migração: diga que vai encaminhar para a equipe verificar. Não prometa nada.',
      transfer(orderId, 'cliente quer passar o eSIM para chip físico (caso fora das regras — verificar)'),
    ].join('\n');
  }

  // destino virtual (eSIM no aparelho novo)
  if (operator === null || operator === 'VARIAS') {
    return [
      head,
      operator === null
        ? 'Não foi possível confirmar o plano deste pedido.'
        : 'O pedido tem chips de planos diferentes.',
      'Diga que vai encaminhar para a equipe confirmar se a migração para eSIM é possível. Não prometa nada.',
      transfer(orderId, `cliente quer migrar ${chipAtual === 'fisico' ? 'chip físico' : 'eSIM'} para eSIM (confirmar o plano/operadora)`),
    ].join('\n');
  }

  if (operator === 'OUTRA') {
    return [
      head,
      `Não é possível: o plano deste pedido não permite migrar ${chipAtual === 'fisico' ? 'o chip físico para eSIM' : 'o eSIM para outro aparelho'}. Diga isso com gentileza, sem citar a operadora.`,
      transfer(orderId, `cliente pediu migração ${chipAtual === 'fisico' ? 'físico → virtual' : 'virtual → virtual'}; plano NÃO permite (cliente já informado)`),
    ].join('\n');
  }

  if (chipAtual === 'fisico') {
    return [
      head,
      'Físico → virtual: é possível no plano deste pedido. Diga que dá para gerar um eSIM para o aparelho novo e que a equipe vai passar os próximos passos.',
      transfer(orderId, 'cliente quer migrar o chip físico para eSIM; plano permite'),
    ].join('\n');
  }

  const r = VIRTUAL_RULES[operator];
  return [
    head,
    'Virtual → virtual: é possível no plano deste pedido.',
    `1. Peça ao cliente ${r.dados}.`,
    `2. Informe que as instruções vão por e-mail, que há ${fee}, e que o novo eSIM fica pronto em ${r.prazo} depois do pagamento e dos dados.`,
    '3. Quando o cliente mandar os dados (ou disser que não consegue encontrá-los), transfira — não espere o comprovante do Pix.',
    transfer(
      orderId,
      'cliente quer migrar o eSIM para outro aparelho; plano permite',
      `, seguido dos dados que o cliente enviou (${operator === 'TIM' ? 'ICCID' : operator === 'UNI' ? 'IMEI2 anterior e novo' : 'EID e IMEI2 anterior e novo'}) e se ele já pagou a taxa`,
    ),
  ].join('\n');
}
