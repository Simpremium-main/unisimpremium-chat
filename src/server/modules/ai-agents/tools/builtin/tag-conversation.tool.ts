import { Injectable, Logger } from '@nestjs/common';
import { AutomationTrigger, Prisma } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';
import { OutboxService } from '../../../automations/outbox/outbox.service';
import { AiTool, ToolContext, ToolResult } from '../tool.types';

/**
 * Tags a conversation with one or more of the org's EXISTING tags. The AI
 * never creates tags: names are matched against the tags registered in
 * Configurações > Tags (ignoring case, accents and space/hyphen/underscore),
 * and unknown names are skipped — the output lists the available tags so the
 * model can retry with a valid one.
 *
 * Each NEWLY applied (tag,conversation) pair emits a TAG_ADDED outbox
 * event so workspace automations can react to AI-driven tagging the same
 * way they react to manual tagging from the UI.
 */
@Injectable()
export class TagConversationTool implements AiTool {
  private readonly logger = new Logger(TagConversationTool.name);

  readonly name = 'tagConversation';
  readonly description =
    'Apply one or more of the EXISTING tags to the current conversation, to categorize it for filtering/reports. Only tags already registered by the team can be used — new names are NOT created. If a name is not found, the result lists the available tags; pick from that list or skip tagging.';
  readonly parameters = {
    type: 'object',
    additionalProperties: false,
    required: ['tags'],
    properties: {
      tags: {
        type: 'array',
        items: { type: 'string', minLength: 1, maxLength: 40 },
        minItems: 1,
        maxItems: 5,
        description:
          'Names of existing tags. Unknown names are ignored (never created).',
      },
    },
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const raw = Array.isArray(input.tags) ? (input.tags as unknown[]) : [];
    const requested = Array.from(
      new Set(
        raw
          .map((t) => String(t).trim())
          .filter((t) => t.length > 0 && t.length <= 40),
      ),
    );

    if (requested.length === 0) {
      return { output: { ok: false, error: 'no valid tag names' } };
    }

    // Só tags já cadastradas. Poucas por org — compara em memória com
    // normalização, pra "lead-quente" casar com a tag "Lead Quente".
    const orgTags = await this.prisma.tag.findMany({
      where: { organizationId: ctx.organizationId },
      select: { id: true, name: true },
    });
    const byKey = new Map(orgTags.map((t) => [normalizeTagName(t.name), t]));
    const allTags: { id: string; name: string }[] = [];
    const notFound: string[] = [];
    for (const name of requested) {
      const tag = byKey.get(normalizeTagName(name));
      if (!tag) notFound.push(name);
      else if (!allTags.some((t) => t.id === tag.id)) allTags.push(tag);
    }

    if (allTags.length === 0) {
      return {
        output: {
          ok: false,
          error: 'none of these tags exist — tags are not created automatically',
          notFound,
          availableTags: orgTags.map((t) => t.name),
        },
      };
    }

    // Apply each tag inside its own TX so the outbox emit is atomic with
    // the link creation. Use `create` + P2002 catch (instead of upsert)
    // so we know which tags were genuinely new — only those should fire
    // a TAG_ADDED event. Re-applying an existing tag is a no-op for the
    // automation engine.
    for (const tag of allTags) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.conversationTag.create({
            data: {
              conversationId: ctx.conversationId,
              tagId: tag.id,
            },
          });
          await this.outbox.enqueue(tx, AutomationTrigger.TAG_ADDED, {
            organizationId: ctx.organizationId,
            contactId: ctx.contactId,
            conversationId: ctx.conversationId,
            channelId: ctx.channelId,
            actorId: ctx.agentId, // attribution: AI agent that tagged
            tagId: tag.id,
            target: 'conversation',
          });
        });
      } catch (err) {
        // Tag already on this conversation — silent no-op. We don't want
        // to spam the run log with "duplicate" errors for re-applies.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          continue;
        }
        throw err;
      }
    }

    this.logger.log(
      `Agent ${ctx.agentId} tagged conv ${ctx.conversationId} with ${allTags.map((t) => t.name).join(', ')}` +
        (notFound.length ? ` (ignored unknown: ${notFound.join(', ')})` : ''),
    );

    return {
      output: {
        ok: true,
        applied: allTags.map((t) => t.name),
        ...(notFound.length
          ? { notFound, availableTags: orgTags.map((t) => t.name) }
          : {}),
      },
    };
  }
}

/** "Lead Quente", "lead-quente", "LEAD_quente" e "lead quênte" → "lead quente". */
function normalizeTagName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[-_\s]+/g, ' ')
    .trim();
}
