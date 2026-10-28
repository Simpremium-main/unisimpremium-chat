/**
 * Cores de identificação dos membros (fundo da bolinha de iniciais),
 * escolhidas em Configurações > Membros. Tons médios/escuros pra iniciais
 * brancas lerem bem nos dois temas.
 */
export const MEMBER_COLORS = [
  '#ef4444',
  '#f97316',
  '#d97706',
  '#65a30d',
  '#16a34a',
  '#0d9488',
  '#0891b2',
  '#2563eb',
  '#4f46e5',
  '#7c3aed',
  '#c026d3',
  '#db2777',
  '#57534e',
] as const;

/** Iniciais pretas ou brancas conforme a luminância do fundo (cor custom). */
export function initialsColorFor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? '#18181b' : '#ffffff';
}
