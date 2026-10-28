import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { QuickRepliesRepository } from './quick-replies.repository';
import { CreateQuickReplyDto } from './dto/create-quick-reply.dto';
import { UpdateQuickReplyDto } from './dto/update-quick-reply.dto';

@Injectable()
export class QuickRepliesService {
  constructor(private readonly repository: QuickRepliesRepository) {}

  async create(orgId: string, userId: string, dto: CreateQuickReplyDto) {
    const shortcut = normalizeShortcut(dto.shortcut);
    const existing = await this.repository.findByShortcut(orgId, shortcut);
    if (existing) throw shortcutTaken(shortcut, existing, userId);
    await this.repository.purgeDeletedShortcut(orgId, shortcut);
    return this.repository.create({
      shortcut,
      title: dto.title.trim(),
      content: dto.content,
      isPrivate: dto.isPrivate ?? false,
      organization: { connect: { id: orgId } },
      createdBy: { connect: { id: userId } },
    });
  }

  async findAll(orgId: string, userId: string) {
    return this.repository.findVisible(orgId, userId);
  }

  /** Pessoal de outro usuário é tratada como inexistente. */
  async findOne(id: string, orgId: string, userId: string) {
    const row = await this.repository.findById(id);
    if (!row || row.organizationId !== orgId || (row.isPrivate && row.createdById !== userId)) {
      throw new NotFoundException('Quick reply not found');
    }
    return row;
  }

  async update(id: string, orgId: string, userId: string, dto: UpdateQuickReplyDto) {
    const current = await this.findOne(id, orgId, userId);
    // Só quem cadastrou muda a visibilidade (resposta antiga sem autor: qualquer um).
    if (dto.isPrivate !== undefined && dto.isPrivate !== current.isPrivate && current.createdById && current.createdById !== userId) {
      throw new ForbiddenException('Só quem cadastrou pode mudar para quem a resposta aparece');
    }
    const shortcut = dto.shortcut !== undefined ? normalizeShortcut(dto.shortcut) : undefined;
    if (shortcut !== undefined) {
      const clash = await this.repository.findByShortcut(orgId, shortcut);
      if (clash && clash.id !== id) throw shortcutTaken(shortcut, clash, userId);
      await this.repository.purgeDeletedShortcut(orgId, shortcut);
    }
    return this.repository.update(id, {
      ...(shortcut !== undefined && { shortcut }),
      ...(dto.title !== undefined && { title: dto.title.trim() }),
      ...(dto.content !== undefined && { content: dto.content }),
      ...(dto.isPrivate !== undefined && {
        isPrivate: dto.isPrivate,
        // Resposta antiga sem autor que vira pessoal fica com quem a tornou pessoal.
        ...(dto.isPrivate && !current.createdById && { createdBy: { connect: { id: userId } } }),
      }),
    });
  }

  async remove(id: string, orgId: string, userId: string) {
    await this.findOne(id, orgId, userId);
    return this.repository.softDelete(id);
  }
}

/** O atalho é único na organização, inclusive entre as pessoais. */
function shortcutTaken(
  shortcut: string,
  existing: { isPrivate: boolean; createdById: string | null },
  userId: string,
) {
  const ofSomeoneElse = existing.isPrivate && existing.createdById !== userId;
  return new ConflictException(
    ofSomeoneElse
      ? `O atalho /${shortcut} já é usado na resposta pessoal de outro atendente`
      : `O atalho /${shortcut} já existe`,
  );
}

/** "/Pix Loja" → "pix-loja": o que se digita depois da barra no compositor. */
export function normalizeShortcut(raw: string): string {
  const shortcut = raw
    .trim()
    .replace(/^\/+/, '')
    .toLowerCase()
    .replace(/\s+/g, '-');
  if (!shortcut) throw new BadRequestException('Informe o atalho');
  return shortcut;
}
