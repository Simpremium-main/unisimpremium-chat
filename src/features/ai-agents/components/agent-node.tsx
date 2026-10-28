'use client';

import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Sparkles, Power, PowerOff } from 'lucide-react';
import {
  type AiAgent,
  DEPARTMENT_COLORS,
} from '../services/ai-agents.service';

// React Flow v12 requires node data to be assignable to Record<string,unknown>.
export type AgentNodeData = {
  agent: AiAgent;
  onClick: (agent: AiAgent) => void;
  onToggleActive: (agent: AiAgent) => void;
} & Record<string, unknown>;

/**
 * Custom React Flow node rendering an AgentCard. Identical visual to the
 * legacy grid card so users still recognize it — only difference is React
 * Flow connection handles top/bottom and a department-tinted ring/badge.
 */
function AgentNodeBase({ data }: { data: AgentNodeData }) {
  const { agent, onClick, onToggleActive } = data;
  const isOrchestrator = agent.kind === 'ORCHESTRATOR';
  const dept = agent.department && DEPARTMENT_COLORS[agent.department];

  return (
    <div className="relative">
      <Handle
        type="target"
        position={Position.Top}
        className="!h-2 !w-2 !border-zinc-300 !bg-zinc-400 dark:!border-zinc-600"
      />
      <button
        onClick={() => onClick(agent)}
        className={`group w-[320px] rounded-xl border bg-white p-4 text-left shadow-sm transition-shadow hover:shadow-md dark:bg-zinc-900 ${
          isOrchestrator
            ? 'border-primary/40 ring-1 ring-primary/10 dark:border-primary/30'
            : dept
              ? `border-zinc-200 ring-1 ${dept.ring} dark:border-zinc-800`
              : 'border-zinc-200 dark:border-zinc-800'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${
                isOrchestrator
                  ? 'bg-primary/15 text-primary'
                  : dept
                    ? `${dept.bg} ${dept.text}`
                    : 'bg-primary/10 text-primary'
              }`}
            >
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                  {agent.name}
                </p>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase ${
                    isOrchestrator
                      ? 'bg-primary/10 text-primary'
                      : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                  }`}
                >
                  {isOrchestrator ? 'Orquestrador' : 'Worker'}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                {agent.modelId}
              </p>
              {agent.description && (
                <p className="mt-1.5 line-clamp-2 text-[12px] text-zinc-600 dark:text-zinc-400">
                  {agent.description}
                </p>
              )}
            </div>
          </div>
          <span
            onClick={(e) => {
              e.stopPropagation();
              onToggleActive(agent);
            }}
            className={`inline-flex flex-shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
              agent.isActive
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
                : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800'
            }`}
          >
            {agent.isActive ? (
              <>
                <Power className="h-3 w-3" /> Ativo
              </>
            ) : (
              <>
                <PowerOff className="h-3 w-3" /> Pausado
              </>
            )}
          </span>
        </div>

        {(agent.department || agent.squad) && (
          <div className="mt-3 flex flex-wrap gap-1">
            {agent.department && (
              <span
                className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                  dept
                    ? `${dept.bg} ${dept.text}`
                    : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                }`}
              >
                {agent.department}
              </span>
            )}
            {agent.squad && (
              <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                ⚡ {agent.squad}
              </span>
            )}
          </div>
        )}

        {agent.channels && agent.channels.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {agent.channels.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center gap-0.5 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              >
                {c.channel.name}
                <span className="text-zinc-400">· {c.mode.toLowerCase()}</span>
              </span>
            ))}
          </div>
        )}
      </button>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-2 !w-2 !border-zinc-300 !bg-zinc-400 dark:!border-zinc-600"
      />
    </div>
  );
}

export const AgentNode = memo(AgentNodeBase);
