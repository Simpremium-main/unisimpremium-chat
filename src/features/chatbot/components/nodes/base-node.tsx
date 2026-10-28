'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';

interface BaseNodeProps {
  label: string;
  icon: string;
  color: string;
  children?: React.ReactNode;
  selected?: boolean;
  hasInput?: boolean;
  hasOutput?: boolean;
  outputCount?: number;
}

export function BaseNode({
  label,
  icon,
  color,
  children,
  selected,
  hasInput = true,
  hasOutput = true,
  outputCount = 1,
}: BaseNodeProps) {
  return (
    <div
      className={`min-w-[180px] max-w-[240px] rounded-xl border-2 bg-white shadow-md transition-shadow dark:bg-zinc-900 ${
        selected ? 'border-primary shadow-lg ring-2 ring-primary/20' : 'border-zinc-200 dark:border-zinc-700'
      }`}
    >
      {hasInput && (
        <Handle
          type="target"
          position={Position.Top}
          className="!h-3 !w-3 !border-2 !border-white !bg-zinc-400 dark:!border-zinc-900"
        />
      )}
      <div className={`flex items-center gap-2 rounded-t-[10px] px-3 py-2 ${color}`}>
        <span className="text-base">{icon}</span>
        <span className="text-xs font-semibold text-white">{label}</span>
      </div>
      {children && (
        <div className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">
          {children}
        </div>
      )}
      {hasOutput &&
        Array.from({ length: outputCount }).map((_, i) => (
          <Handle
            key={i}
            type="source"
            position={Position.Bottom}
            id={`output-${i}`}
            className="!h-3 !w-3 !border-2 !border-white !bg-primary dark:!border-zinc-900"
            style={
              outputCount > 1
                ? { left: `${((i + 1) / (outputCount + 1)) * 100}%` }
                : undefined
            }
          />
        ))}
    </div>
  );
}
