'use client';

const DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function Heatmap({ matrix, max, accent = '#3b82f6' }: {
  matrix: number[][];
  max: number;
  accent?: string;
}) {
  if (max === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-xs text-zinc-400">
        Sem dados no período
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-[36px_repeat(24,minmax(0,1fr))] gap-px">
          <div />
          {HOURS.map((h) => (
            <div key={h} className="text-center text-[9px] tabular-nums text-zinc-400">
              {h % 3 === 0 ? h : ''}
            </div>
          ))}

          {DOW.map((label, dow) => (
            <Row key={dow} label={label} dow={dow} matrix={matrix} max={max} accent={accent} />
          ))}
        </div>

        <div className="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-zinc-500">
          <span>menos</span>
          {[0.1, 0.3, 0.5, 0.75, 1].map((o, i) => (
            <div
              key={i}
              className="h-2.5 w-3 rounded-sm"
              style={{ backgroundColor: accent, opacity: o }}
            />
          ))}
          <span>mais</span>
        </div>
      </div>
    </div>
  );
}

function Row({
  label, dow, matrix, max, accent,
}: { label: string; dow: number; matrix: number[][]; max: number; accent: string }) {
  return (
    <>
      <div className="pr-1 text-right text-[10px] font-medium text-zinc-400">{label}</div>
      {HOURS.map((h) => {
        const v = matrix[dow][h];
        const opacity = v === 0 ? 0.04 : 0.15 + (v / max) * 0.85;
        return (
          <div
            key={h}
            className="group relative aspect-square min-h-[14px] rounded-[3px] transition-opacity hover:opacity-100"
            style={{ backgroundColor: accent, opacity }}
            title={`${label} ${h}h: ${v} conversa${v === 1 ? '' : 's'}`}
          />
        );
      })}
    </>
  );
}
