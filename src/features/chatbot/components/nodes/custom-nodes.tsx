'use client';

import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './base-node';

export const StartNode = memo(({ selected }: NodeProps) => (
  <BaseNode label="Início" icon="▶️" color="bg-emerald-500" selected={selected} hasInput={false}>
    <p className="italic opacity-60">Ponto de entrada do fluxo</p>
  </BaseNode>
));
StartNode.displayName = 'StartNode';

export const MessageNode = memo(({ data, selected }: NodeProps) => {
  const image = (data as any).image as { url?: string } | undefined;
  return (
    <BaseNode label="Mensagem" icon="💬" color="bg-blue-500" selected={selected}>
      {image?.url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image.url} alt="" className="mb-1 max-h-24 w-full rounded object-cover" />
      )}
      <p className="line-clamp-2">{(data as any).message || (image?.url ? '' : 'Texto da mensagem...')}</p>
      {(data as any).delaySeconds > 0 && (
        <p className="mt-1 text-[10px] text-zinc-400">⏱ aguarda {(data as any).delaySeconds}s antes</p>
      )}
    </BaseNode>
  );
});
MessageNode.displayName = 'MessageNode';

export const MenuNode = memo(({ data, selected }: NodeProps) => {
  const options = (data as any).options || [];
  return (
    <BaseNode label="Menu" icon="📋" color="bg-violet-500" selected={selected} outputCount={Math.max(options.length, 1)}>
      <p className="font-medium">{(data as any).title || 'Menu de opções'}</p>
      {options.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {options.map((opt: any, i: number) => (
            <li key={i} className="flex items-center gap-1">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[9px] font-bold text-violet-600">{i + 1}</span>
              <span className="truncate">{opt.label}</span>
            </li>
          ))}
        </ul>
      )}
    </BaseNode>
  );
});
MenuNode.displayName = 'MenuNode';

export const ConditionNode = memo(({ data, selected }: NodeProps) => (
  <BaseNode label="Condição" icon="🔀" color="bg-amber-500" selected={selected} outputCount={2}>
    <p>{(data as any).variable || 'variavel'} {(data as any).operator || '=='} {(data as any).value || '?'}</p>
    <div className="mt-1 flex gap-2 text-[10px]">
      <span className="rounded bg-green-100 px-1 text-green-700">Sim ↓</span>
      <span className="rounded bg-red-100 px-1 text-red-700">Não ↓</span>
    </div>
  </BaseNode>
));
ConditionNode.displayName = 'ConditionNode';

export const WaitNode = memo(({ data, selected }: NodeProps) => (
  <BaseNode label="Aguardar Input" icon="⏳" color="bg-cyan-500" selected={selected}>
    <p>{(data as any).prompt || 'Aguardando resposta do usuário...'}</p>
    {(data as any).saveAs && <p className="mt-1 opacity-50">Salvar em: {(data as any).saveAs}</p>}
  </BaseNode>
));
WaitNode.displayName = 'WaitNode';

export const TransferNode = memo(({ data, selected }: NodeProps) => (
  <BaseNode label="Transferir" icon="🔄" color="bg-rose-500" selected={selected} hasOutput={false}>
    <p>{(data as any).message || 'Transferindo para atendente...'}</p>
    <p className="mt-1 text-[10px] font-semibold text-rose-600 dark:text-rose-400">→ Atendente humano</p>
  </BaseNode>
));
TransferNode.displayName = 'TransferNode';

export const EndNode = memo(({ data, selected }: NodeProps) => {
  const handoff = (data as any).handoff as 'AI' | 'HUMAN' | undefined;
  return (
    <BaseNode label="Fim" icon="🏁" color="bg-zinc-500" selected={selected} hasOutput={false}>
      {(data as any).message && <p className="mb-1">{(data as any).message}</p>}
      {handoff === 'AI' ? (
        <p className="text-[10px] font-semibold text-violet-600 dark:text-violet-400">→ Vai para a IA</p>
      ) : handoff === 'HUMAN' ? (
        <p className="text-[10px] font-semibold text-rose-600 dark:text-rose-400">→ Vai para atendente humano</p>
      ) : (
        <p className="text-[10px] font-semibold text-amber-600">⚠ Defina para onde vai (IA ou humano)</p>
      )}
    </BaseNode>
  );
});
EndNode.displayName = 'EndNode';

export const nodeTypes = {
  START: StartNode,
  MESSAGE: MessageNode,
  MENU: MenuNode,
  CONDITION: ConditionNode,
  WAIT: WaitNode,
  TRANSFER: TransferNode,
  END_FLOW: EndNode,
};
