import { Injectable } from '@nestjs/common';
import { AiTool, ToolContext, ToolResult } from '../tool.types';
import { KnowledgeService } from '../../knowledge/knowledge.service';

/**
 * Consulta a base de conhecimento (aprendida com a equipe). Os itens que
 * batem com a última mensagem já vêm no prompt; esta ferramenta é pra
 * quando a IA precisa procurar outro termo antes de pedir ajuda.
 */
@Injectable()
export class SearchKnowledgeTool implements AiTool {
  readonly name = 'buscar_conhecimento';
  readonly description =
    'Procura na base de conhecimento da empresa (informações e regras ensinadas pela equipe). Use ANTES de pedir_ajuda quando não souber responder algo — com palavras-chave do assunto (ex.: "esim cuba operadora", "troca de aparelho").';
  readonly parameters = {
    type: 'object',
    additionalProperties: false,
    required: ['pergunta'],
    properties: {
      pergunta: { type: 'string', minLength: 3, description: 'Assunto ou palavras-chave a procurar.' },
    },
  };

  constructor(private readonly knowledge: KnowledgeService) {}

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const hits = await this.knowledge.search(ctx.organizationId, String(input.pergunta ?? ''), 5);
    if (hits.length === 0) {
      return { output: { ok: true, encontrados: 0, aviso: 'Nada na base sobre isso. Se não tiver certeza da resposta, use pedir_ajuda.' } };
    }
    return { output: { ok: true, encontrados: hits.length, itens: hits.map(({ title, content }) => ({ title, content })) } };
  }
}
