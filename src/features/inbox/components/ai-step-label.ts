/** Passo ao vivo da IA (evento `ai:run:step`). */
export type AiStep =
  | { kind: 'thinking'; iteration: number }
  | { kind: 'tool'; toolName: string; input?: Record<string, unknown> | null };

const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');
const list = (v: unknown) => (Array.isArray(v) ? v.map(String).join(', ') : str(v));

/** Frase curta para a faixa de status: "consultando o pedido 141447…". */
export function aiStepLabel(step: AiStep): string {
  if (step.kind === 'thinking') {
    return step.iteration <= 1 ? 'lendo a conversa…' : 'analisando o resultado…';
  }
  const i = step.input ?? {};
  const orderId = str(i.orderId);
  switch (step.toolName) {
    case 'consultar_pedido':
      if (orderId) return `consultando o pedido ${orderId}…`;
      if (str(i.email)) return `procurando pedidos pelo e-mail ${str(i.email)}…`;
      if (str(i.cpf)) return 'procurando pedidos pelo CPF…';
      return 'consultando o pedido…';
    case 'pedidos_do_cliente':
      return 'procurando pedidos deste WhatsApp…';
    case 'consultar_ativacoes':
      return orderId ? `consultando a ativação do pedido ${orderId}…` : 'consultando a ativação…';
    case 'status_entrega':
      return orderId ? `consultando a entrega do pedido ${orderId}…` : 'consultando a entrega…';
    case 'migracao_chip':
      return orderId ? `verificando a migração do chip do pedido ${orderId}…` : 'verificando a migração do chip…';
    case 'consultar_seguro':
      return 'consultando o seguro viagem…';
    case 'cotacao_chip': {
      const parts = [list(i.countries), str(i.days) && `${str(i.days)} dias`].filter(Boolean).join(', ');
      return parts ? `calculando a cotação do chip (${parts})…` : 'calculando a cotação do chip…';
    }
    case 'consultar_parceiro':
      return 'conferindo o cadastro de parceiro…';
    case 'cotacao_seguro':
      return 'calculando o seguro viagem…';
    case 'calcular_frete':
      return str(i.cep) ? `calculando o frete para o CEP ${str(i.cep)}…` : 'calculando o frete…';
    case 'enviar_instrucoes_roaming':
      return 'enviando as instruções de roaming…';
    case 'enviarMensagensDoFluxo':
      return str(i.fluxo) ? `enviando o fluxo "${str(i.fluxo)}"…` : 'enviando mensagens do fluxo…';
    case 'replyToConversation':
      return 'enviando a resposta…';
    case 'buscar_conhecimento':
      return 'buscando na base de conhecimento…';
    case 'pedir_ajuda':
      return 'pedindo ajuda à equipe…';
    case 'escalar_para_humano':
    case 'transferToHuman':
      return 'transferindo para a equipe…';
    case 'finalizar_atendimento':
      return 'finalizando o atendimento…';
    case 'addInternalNote':
      return 'escrevendo uma nota interna…';
    case 'set_label':
    case 'tagConversation':
      return 'classificando o atendimento…';
    case 'delegateToAgent':
      return 'passando para outro agente…';
    default:
      return `usando ${step.toolName}…`;
  }
}
