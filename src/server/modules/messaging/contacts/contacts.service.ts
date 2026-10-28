import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ContactsRepository } from './contacts.repository';
import { UpdateContactDto } from './dto/update-contact.dto';
import { ConversationsRepository } from '../conversations/conversations.repository';
import type { ChannelAccess } from '../../iam/channel-access/channel-access.service';

@Injectable()
export class ContactsService {
  constructor(
    private readonly repository: ContactsRepository,
    private readonly conversations: ConversationsRepository,
  ) {}

  async findAll(organizationId: string, search: string | undefined, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const { contacts, total } = await this.repository.findByOrg(organizationId, search, skip, limit);
    return {
      contacts,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string, organizationId: string) {
    const contact = await this.repository.findById(id);
    if (!contact) throw new NotFoundException('Contact not found');
    if (contact.organizationId !== organizationId) throw new ForbiddenException();
    return contact;
  }

  /**
   * Histórico do contato: todos os atendimentos (em todos os canais que o
   * usuário enxerga), com os atendentes que responderam em cada um.
   */
  async findConversations(id: string, organizationId: string, access: ChannelAccess) {
    await this.findOne(id, organizationId);
    const rows = await this.repository.findConversations(
      id,
      organizationId,
      access === 'ALL' ? null : Array.from(access),
    );
    return this.conversations.attachResponders(rows);
  }

  async update(id: string, organizationId: string, dto: UpdateContactDto) {
    await this.findOne(id, organizationId);
    return this.repository.update(id, dto);
  }

  async remove(id: string, organizationId: string) {
    await this.findOne(id, organizationId);
    return this.repository.softDelete(id);
  }
}
