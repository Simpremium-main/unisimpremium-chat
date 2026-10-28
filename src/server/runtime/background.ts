/**
 * Registro de trabalho "depois da resposta".
 *
 * Em ambiente serverless (Vercel) a função congela assim que a resposta
 * HTTP termina — qualquer promise solta (broadcast do realtime, drenagem
 * de fila) morreria no meio. Tudo que precisa sobreviver à resposta passa
 * por `trackBackground`, e o handler HTTP entrega `drainBackground()` ao
 * `waitUntil` da Vercel. Fora da Vercel o processo é persistente e isso é
 * só um await a mais.
 */
const g = globalThis as unknown as { __bgTasks?: Set<Promise<unknown>> };
const tasks: Set<Promise<unknown>> = (g.__bgTasks ??= new Set());

export function trackBackground<T>(promise: Promise<T>): Promise<T> {
  const p = promise.catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[background] task failed:', err);
  });
  tasks.add(p);
  void p.finally(() => tasks.delete(p));
  return promise;
}

/** Aguarda todas as tarefas pendentes — inclusive as criadas enquanto espera. */
export async function drainBackground(): Promise<void> {
  while (tasks.size > 0) {
    await Promise.allSettled([...tasks]);
  }
}

/** Quantas tarefas em segundo plano ainda estão rodando. */
export function pendingBackgroundCount(): number {
  return tasks.size;
}
