'use client';

const nodeTemplates = [
  { type: 'MESSAGE', label: 'Mensagem', icon: '💬', color: 'bg-blue-500' },
  { type: 'MENU', label: 'Menu', icon: '📋', color: 'bg-violet-500' },
  { type: 'CONDITION', label: 'Condição', icon: '🔀', color: 'bg-amber-500' },
  { type: 'WAIT', label: 'Aguardar', icon: '⏳', color: 'bg-cyan-500' },
  { type: 'TRANSFER', label: 'Transferir', icon: '🔄', color: 'bg-rose-500' },
  { type: 'END_FLOW', label: 'Fim', icon: '🏁', color: 'bg-zinc-500' },
];

interface NodeToolbarProps {
  onAddNode: (type: string) => void;
}

export function NodeToolbar({ onAddNode }: NodeToolbarProps) {
  return (
    <div className="absolute left-4 top-4 z-10 flex flex-col gap-1.5 rounded-xl border border-zinc-200 bg-white/95 p-2 shadow-lg backdrop-blur-sm dark:border-zinc-700 dark:bg-zinc-900/95">
      <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Nós</p>
      {nodeTemplates.map((t) => (
        <button
          key={t.type}
          onClick={() => onAddNode(t.type)}
          className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <span className={`flex h-6 w-6 items-center justify-center rounded-md text-xs ${t.color}`}>
            {t.icon}
          </span>
          {t.label}
        </button>
      ))}
    </div>
  );
}
