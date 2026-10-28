import { AsyncLocalStorage } from 'async_hooks';

/**
 * Organização "dona" das chamadas LLM em andamento. Os pontos de entrada
 * (run do agente, roteador, extrator de memória, evals) envolvem o trabalho
 * em `runWithLlmOrg` e tudo que roda dentro — inclusive reranker, embeddings
 * e tools — usa as chaves de IA daquela org sem precisar receber o id.
 */
const storage = new AsyncLocalStorage<{ organizationId: string }>();

export function runWithLlmOrg<T>(organizationId: string, fn: () => T): T {
  return storage.run({ organizationId }, fn);
}

export function currentLlmOrg(): string | undefined {
  return storage.getStore()?.organizationId;
}
