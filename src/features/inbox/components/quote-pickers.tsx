'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

// Códigos ISO dos países; o nome em português vem do navegador (Intl), igual
// ao que o Pedido Central espera ("Estados Unidos", "Reino Unido"…).
const ISO_CODES =
  'AD AE AF AG AI AL AM AO AR AT AU AW AZ BA BB BD BE BF BG BH BI BJ BM BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CW CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FO FR GA GB GD GE GF GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KM KN KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MK ML MM MN MO MQ MR MT MU MV MW MX MY MZ NA NC NE NG NI NL NO NP NZ OM PA PE PF PG PH PK PL PR PS PT PY QA RE RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TL TM TN TO TR TT TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WS XK YE ZA ZM ZW'.split(' ');

/** Nome usado no Brasil quando o do navegador é diferente. */
const NAME_OVERRIDES: Record<string, string> = {
  CZ: 'República Tcheca',
  VA: 'Vaticano',
};

/** Como o atendente costuma digitar → nome do país. */
const ALIASES: Record<string, string> = {
  eua: 'Estados Unidos',
  usa: 'Estados Unidos',
  inglaterra: 'Reino Unido',
  escocia: 'Reino Unido',
  holanda: 'Países Baixos',
  dubai: 'Emirados Árabes Unidos',
};

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

function useCountryNames(): string[] {
  return useMemo(() => {
    let names: string[] = [];
    try {
      const dn = new Intl.DisplayNames(['pt-BR'], { type: 'region' });
      names = ISO_CODES.map((c) => NAME_OVERRIDES[c] ?? dn.of(c) ?? c);
    } catch {
      names = [];
    }
    return [...new Set(names)].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, []);
}

const FIELD =
  'w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-800 outline-none focus:border-primary dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200';

/** Vários países, escolhidos da lista (busca sem acento; "EUA" acha Estados Unidos). */
export function CountryMultiSelect({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const names = useCountryNames();
  const [q, setQ] = useState('');
  const matches = useMemo(() => {
    const n = norm(q);
    if (!n) return [];
    const alias = ALIASES[n];
    const found = names.filter((c) => norm(c).includes(n) && !value.includes(c));
    const sorted = found.sort((a, b) => Number(!norm(a).startsWith(n)) - Number(!norm(b).startsWith(n)));
    return alias && !value.includes(alias) ? [alias, ...sorted.filter((c) => c !== alias)] : sorted;
  }, [q, names, value]);

  const add = (c: string) => {
    onChange([...value, c]);
    setQ('');
  };

  return (
    <div className="relative">
      {value.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1">
          {value.map((c) => (
            <span
              key={c}
              className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
            >
              {c}
              <button type="button" onClick={() => onChange(value.filter((x) => x !== c))} aria-label={`Remover ${c}`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        className={FIELD}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (matches[0]) add(matches[0]);
          } else if (e.key === 'Backspace' && !q && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        placeholder={value.length ? 'Adicionar outro país…' : 'Buscar país (ex.: Estados Unidos)'}
      />
      {matches.length > 0 && (
        <div className="absolute left-0 right-0 z-10 mt-1 max-h-44 overflow-y-auto rounded-md border border-zinc-200 bg-white shadow-md dark:border-zinc-700 dark:bg-zinc-900">
          {matches.slice(0, 30).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => add(c)}
              className="block w-full px-2 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const brDate = (s: string) => s.split('-').reverse().join('/');

/** Dias da viagem contando ida e volta (mesma conta do servidor). */
export function tripDays(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
}

const WEEK = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

/** Calendário: 1º clique = ida, 2º clique = volta. */
export function DateRangePicker({
  start,
  end,
  onChange,
}: {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
}) {
  const [month, setMonth] = useState(() => {
    const d = start ? new Date(`${start}T12:00:00`) : new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const today = iso(new Date());
  const cells: (string | null)[] = [];
  for (let i = 0; i < month.getDay(); i++) cells.push(null);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  for (let d = 1; d <= last; d++) cells.push(iso(new Date(month.getFullYear(), month.getMonth(), d)));

  const pick = (day: string) => {
    if (!start || end || day < start) onChange(day, '');
    else onChange(start, day);
  };

  return (
    <div className="rounded-md border border-zinc-200 p-2 dark:border-zinc-700">
      <div className="mb-1 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          aria-label="Mês anterior"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="text-xs font-medium capitalize text-zinc-700 dark:text-zinc-200">
          {month.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
        </span>
        <button
          type="button"
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          aria-label="Próximo mês"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 text-center text-[11px]">
        {WEEK.map((w, i) => (
          <span key={i} className="py-0.5 text-zinc-400">
            {w}
          </span>
        ))}
        {cells.map((day, i) => {
          if (!day) return <span key={i} />;
          const edge = day === start || day === end;
          const inside = start && end && day > start && day < end;
          return (
            <button
              key={day}
              type="button"
              onClick={() => pick(day)}
              className={`py-1 ${
                edge
                  ? 'rounded-md bg-primary font-semibold text-white'
                  : inside
                    ? 'bg-primary/10 text-primary'
                    : `rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 ${day < today ? 'text-zinc-300 dark:text-zinc-600' : 'text-zinc-700 dark:text-zinc-200'}`
              }`}
            >
              {Number(day.slice(8))}
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-center text-[11px] text-zinc-500">
        {start && end
          ? `${brDate(start)} - ${brDate(end)} · ${tripDays(start, end)} dias`
          : start
            ? `Ida ${brDate(start)} — escolha a volta`
            : 'Escolha a ida e a volta'}
      </p>
    </div>
  );
}
