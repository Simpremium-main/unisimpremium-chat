/**
 * Sinais leves entre o código de domínio e o runtime serverless — sem
 * dependências, para poder ser importado de qualquer service.
 */
const g = globalThis as unknown as { __outboxDirty?: boolean };

/** Um evento foi gravado no outbox: o poller precisa rodar após a resposta. */
export function markOutboxDirty(): void {
  g.__outboxDirty = true;
}

/** Lê e zera a flag. */
export function consumeOutboxDirty(): boolean {
  const v = !!g.__outboxDirty;
  g.__outboxDirty = false;
  return v;
}
