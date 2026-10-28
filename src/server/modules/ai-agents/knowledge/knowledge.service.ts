import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

export interface KnowledgeHit {
  id: string;
  title: string;
  content: string;
  rank: number;
}

/** Palavras que não ajudam a achar nada (o dicionário "portuguese" tira o resto). */
const STOPWORDS = new Set([
  'que', 'com', 'para', 'pra', 'por', 'uma', 'umas', 'uns', 'dos', 'das', 'nos', 'nas', 'meu', 'minha',
  'seu', 'sua', 'esta', 'este', 'isso', 'esse', 'essa', 'tem', 'ter', 'sim', 'nao', 'ola', 'oi', 'bom',
  'boa', 'dia', 'tarde', 'noite', 'obrigado', 'obrigada', 'favor', 'gentileza', 'voce', 'voces', 'como',
  'qual', 'quais', 'quando', 'onde', 'mais', 'muito', 'tudo', 'bem', 'aqui', 'ainda', 'pode', 'posso',
  // Genéricas do negócio: aparecem em quase toda conversa e em quase todo
  // item — sozinhas puxariam conhecimento sem relação ("meu chip não funciona").
  'chip', 'chips', 'esim', 'celular', 'aparelho', 'plano', 'planos', 'pedido', 'pedidos', 'internet',
  'funciona', 'funcionar', 'funcionando', 'funcionou', 'viagem', 'viajar', 'quero', 'queria', 'gostaria',
  'usar', 'uso', 'saber', 'preciso', 'comprar', 'compra', 'valor', 'quanto', 'custa', 'ajuda', 'ajudar',
  'problema', 'status', 'cliente', 'vai', 'vou', 'fazer', 'consegue', 'consigo',
]);

/** Minúsculo e sem acento — cliente escreve "ativacao", o cadastro "ativação". */
export function normalizeText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Texto livre → consulta "termo1 | termo2" (só letras/números, sem stopwords). */
export function buildTsQuery(text: string, max = 24): string | null {
  const terms = [...new Set(normalizeText(text).match(/[a-z0-9]{3,}/g) ?? [])]
    .filter((t) => !STOPWORDS.has(t) && !/^\d+$/.test(t))
    .slice(0, max);
  return terms.length ? terms.join(' | ') : null;
}

export function knowledgeSearchText(k: { title: string; keywords?: string | null; content: string }): string {
  return normalizeText([k.title, k.keywords ?? '', k.content].join('\n'));
}

/** Corte mínimo de relevância — abaixo disso é coincidência de palavra solta. */
const MIN_RANK = 0.1;

/**
 * Base de conhecimento da IA. A busca é por texto no próprio Postgres
 * (tsvector, dicionário português) — sem chamada a modelo de embeddings:
 * não deixa a resposta mais lenta nem mais cara. Só os itens que batem com
 * o que o cliente escreveu entram no prompt.
 */
@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(private readonly prisma: PrismaService) {}

  async search(organizationId: string, text: string, k = 3): Promise<KnowledgeHit[]> {
    const q = buildTsQuery(text);
    if (!q) return [];
    try {
      const rows = await this.prisma.$queryRaw<KnowledgeHit[]>`
        SELECT id, title, content, ts_rank_cd(search, query, 32)::float AS rank
          FROM ai_knowledge, to_tsquery('portuguese', ${q}) AS query
         WHERE organization_id = ${organizationId}
           AND is_active
           AND (expires_at IS NULL OR expires_at > now())
           AND search @@ query
         ORDER BY rank DESC
         LIMIT ${k}`;
      return rows.filter((r) => r.rank >= MIN_RANK);
    } catch (err: any) {
      // Base de conhecimento é um extra: falhar aqui não pode travar a resposta.
      this.logger.warn(`knowledge search failed: ${err?.message ?? err}`);
      return [];
    }
  }

  create(data: {
    organizationId: string;
    title: string;
    content: string;
    keywords?: string;
    expiresAt?: Date | null;
    sourceHelpRequestId?: string | null;
    createdById?: string | null;
  }) {
    return this.prisma.aiKnowledge.create({
      data: { ...data, keywords: data.keywords ?? '', searchText: knowledgeSearchText(data) },
    });
  }

  async update(
    id: string,
    organizationId: string,
    patch: { title?: string; content?: string; keywords?: string; isActive?: boolean; expiresAt?: Date | null },
  ) {
    const current = await this.prisma.aiKnowledge.findFirst({ where: { id, organizationId } });
    if (!current) return null;
    const next = { ...current, ...patch };
    return this.prisma.aiKnowledge.update({
      where: { id },
      data: { ...patch, searchText: knowledgeSearchText(next) },
    });
  }

  list(organizationId: string) {
    return this.prisma.aiKnowledge.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, title: true, content: true, keywords: true, isActive: true, expiresAt: true,
        sourceHelpRequestId: true, createdById: true, createdAt: true, updatedAt: true,
      },
    });
  }

  async remove(id: string, organizationId: string) {
    await this.prisma.aiKnowledge.deleteMany({ where: { id, organizationId } });
  }
}

/** Bloco do prompt com o que a base sabe sobre o assunto da conversa. */
export function renderKnowledgeSection(hits: KnowledgeHit[]): string {
  if (hits.length === 0) return '';
  const items = hits.map((h) => `- ${h.title}: ${h.content.replace(/\s+/g, ' ').trim().slice(0, 700)}`);
  return `\n\n═══ Base de conhecimento (relevante para esta conversa) ═══\nInformação oficial da empresa — use para responder; não invente além disto.\n${items.join('\n')}`;
}
