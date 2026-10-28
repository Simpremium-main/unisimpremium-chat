import { Prisma } from '@prisma/client';

/** Formato de nota devolvido pela API e pelos eventos realtime `note:*`. */
export const INTERNAL_NOTE_SELECT = {
  id: true,
  conversationId: true,
  authorType: true,
  messageId: true,
  content: true,
  createdAt: true,
  updatedAt: true,
  author: { select: { id: true, name: true, avatarUrl: true } },
  agent: { select: { id: true, name: true } },
} satisfies Prisma.InternalNoteSelect;

export const MAX_NOTE_LENGTH = 4000;
