import { Injectable } from '@nestjs/common';

import { DEFAULT_MODEL_ALIAS, formatModelId, parseModelId } from '../llm/llm.constants';

/**
 * Fase da chamada LLM dentro de um turno do agente.
 *  - `tool`      → iteração que (provavelmente) vai pedir/encadear ferramentas.
 *  - `synthesis` → a resposta final ao cliente.
 */
export type LlmPhase = 'tool' | 'synthesis';

export type AgentKind = 'ORCHESTRATOR' | 'WORKER';

/**
 * Override opcional por agente, gravado em `AiAgent.modelParams.routing`
 * (coluna JSON já existente — sem migration). Ex.:
 *   { "routing": { "primary": "anthropic/claude-haiku-5-5" } }
 * faz as iterações de ferramenta rodarem no Haiku e a resposta final no
 * modelo do agente (`AiAgent.modelId`).
 */
interface RoutingOverride {
  /** Modelo das iterações de ferramenta. Ausente = o próprio modelo do agente. */
  primary?: string;
  /** Modelo da resposta final. Ausente = `AiAgent.modelId`. */
  escalation?: string;
  /** Trava o agente inteiro no `primary` (nunca escala). */
  alwaysPrimary?: boolean;
  /** Força/inibe escalonamento da síntese independente do kind. */
  escalateSynthesis?: boolean;
}

export interface SelectModelInput {
  agentKind: AgentKind;
  /** `AiAgent.modelId` — `provedor/modelo` ou `default` (padrão da org). */
  modelId: string;
  /** `AiAgent.modelParams` cru do banco. */
  modelParams?: Record<string, unknown> | null;
  phase: LlmPhase;
}

/**
 * Decide qual modelo usar em cada chamada do loop do agente. Por padrão o
 * agente usa o modelo dele em tudo. Com `routing.primary`, as iterações de
 * ferramenta vão para esse modelo (normalmente um mais barato) e a resposta
 * final:
 *   • WORKER → volta para o modelo do agente (é o que o cliente lê);
 *   • ORCHESTRATOR (triagem) → fica no `primary`.
 * Provedor/chave são resolvidos depois, no LlmService.
 */
@Injectable()
export class ModelRouterService {
  selectModel(input: SelectModelInput): string {
    const routing = this.parseRouting(input.modelParams);
    const agentModel = normalize(input.modelId);
    const escalation = routing.escalation ?? agentModel;
    if (!routing.primary) return escalation;

    const primary = routing.primary;
    if (routing.alwaysPrimary) return primary;
    if (input.phase === 'tool') return primary;

    const escalate = routing.escalateSynthesis ?? input.agentKind === 'WORKER';
    return escalate ? escalation : primary;
  }

  private parseRouting(
    modelParams: Record<string, unknown> | null | undefined,
  ): RoutingOverride {
    const raw = modelParams?.routing;
    if (!raw || typeof raw !== 'object') return {};
    const r = raw as Record<string, unknown>;
    const model = (v: unknown) => (typeof v === 'string' && v.trim() ? normalize(v) : undefined);
    return {
      primary: model(r.primary),
      escalation: model(r.escalation),
      alwaysPrimary: r.alwaysPrimary === true,
      escalateSynthesis:
        typeof r.escalateSynthesis === 'boolean'
          ? r.escalateSynthesis
          : undefined,
    };
  }
}

/**
 * `provedor/modelo` canônico; `default` para o alias, vazio e IDs legados
 * (ex.: `sakana/fugu`). Assim dois legados diferentes viram o mesmo modelo e
 * o runner não refaz a resposta final à toa.
 */
function normalize(id: string | null | undefined): string {
  const parsed = parseModelId(id);
  return parsed ? formatModelId(parsed.provider, parsed.model) : DEFAULT_MODEL_ALIAS;
}
