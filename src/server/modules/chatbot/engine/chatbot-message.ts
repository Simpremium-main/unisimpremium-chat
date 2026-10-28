import { ChannelType } from '@prisma/client';

/**
 * Menu do robô como mensagem interativa (botões/lista do WhatsApp).
 *
 * `content` de uma mensagem INTERACTIVE:
 *   text          corpo (título do menu)
 *   fallbackText  o mesmo menu em texto numerado (canal sem interativo ou
 *                 envio interativo recusado pelo provedor)
 *   interactive   { kind, options: [{ id, title }], listButton }
 */
export interface MenuOption {
  id: string;
  title: string;
}

export interface InteractiveContent {
  text: string;
  fallbackText: string;
  interactive: {
    kind: 'buttons' | 'list';
    options: MenuOption[];
    listButton: string;
  };
}

/** Até 3 opções curtas viram botões; o resto vira lista. */
export const MAX_BUTTONS = 3;
export const MAX_BUTTON_TITLE = 20;
export const MAX_LIST_ROWS = 10;
export const MAX_LIST_TITLE = 24;

export function numberedMenu(title: string, options: { label: string }[]): string {
  return [title || 'Escolha uma opção:', '', ...options.map((o, i) => `${i + 1}. ${o.label}`)].join('\n');
}

export function buildMenuContent(
  title: string,
  options: { label: string; value: string }[],
  listButton = 'Ver opções',
): InteractiveContent {
  const opts = options.map((o, i) => ({ id: o.value || String(i + 1), title: o.label }));
  const fitsButtons =
    opts.length <= MAX_BUTTONS && opts.every((o) => o.title.length <= MAX_BUTTON_TITLE);
  return {
    text: title || 'Escolha uma opção:',
    fallbackText: numberedMenu(title, options),
    interactive: { kind: fitsButtons ? 'buttons' : 'list', options: opts, listButton },
  };
}

/** Canais que recebem o menu como botões/lista. */
const INTERACTIVE_CHANNELS = new Set<ChannelType>([
  ChannelType.WHATSAPP_OFFICIAL,
  ChannelType.WHATSAPP_ZAPPFY,
]);

/** Canais que não mostram legenda na imagem: o texto vai numa mensagem depois. */
const CAPTIONLESS_CHANNELS = new Set<ChannelType>([ChannelType.INSTAGRAM]);

/**
 * Como toChannelMessage, mas pode desdobrar uma mensagem em duas (imagem
 * com legenda em canal sem legenda → imagem + texto).
 */
export function toChannelMessages(
  msg: { type: string; content: Record<string, any>; delayMs?: number },
  channelType: ChannelType | null,
): { type: string; content: Record<string, any>; delayMs?: number }[] {
  const { type, content } = toChannelMessage(msg, channelType);
  // A espera do bloco vale antes da primeira mensagem que ele gera.
  const wait = msg.delayMs ? { delayMs: msg.delayMs } : {};
  const caption = type === 'IMAGE' ? content.caption : undefined;
  if (caption && channelType && CAPTIONLESS_CHANNELS.has(channelType)) {
    const { caption: _caption, ...media } = content;
    return [
      { type: 'IMAGE', content: media, ...wait },
      { type: 'TEXT', content: { text: caption } },
    ];
  }
  return [{ type, content, ...wait }];
}

/**
 * Adapta a mensagem do robô ao canal: interativo onde dá; texto numerado
 * nos demais (Instagram, Gmail) ou quando o menu não cabe numa lista.
 */
export function toChannelMessage(
  msg: { type: string; content: Record<string, any> },
  channelType: ChannelType | null,
): { type: string; content: Record<string, any> } {
  if (msg.type !== 'INTERACTIVE') return msg;
  const content = msg.content as InteractiveContent;
  const tooMany = (content.interactive?.options?.length ?? 0) > MAX_LIST_ROWS;
  if (!channelType || !INTERACTIVE_CHANNELS.has(channelType) || tooMany) {
    return { type: 'TEXT', content: { text: content.fallbackText } };
  }
  return msg;
}
