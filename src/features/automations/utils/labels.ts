import {
  ActionType,
  AutomationTrigger,
  ConditionOperator,
} from '../services/automations.service';

// Labels in pt-BR. Centralized so the UI doesn't sprinkle string literals
// everywhere — adding a new trigger/action/operator should only require
// editing this file plus the registry in the backend.

export const TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  TAG_ADDED: 'Tag adicionada',
  TAG_REMOVED: 'Tag removida',
  MESSAGE_RECEIVED: 'Mensagem recebida',
  CONVERSATION_STATUS_CHANGED: 'Status da conversa mudou',
  CONVERSATION_ASSIGNED: 'Conversa atribuída',
};

export const TRIGGER_DESCRIPTIONS: Record<AutomationTrigger, string> = {
  TAG_ADDED: 'Quando uma tag for aplicada a uma conversa ou contato',
  TAG_REMOVED: 'Quando uma tag for removida de uma conversa ou contato',
  MESSAGE_RECEIVED: 'Quando uma mensagem for recebida de um cliente',
  CONVERSATION_STATUS_CHANGED:
    'Quando o status de uma conversa mudar (ex: PENDING → OPEN)',
  CONVERSATION_ASSIGNED:
    'Quando uma conversa for atribuída a um agente',
};

export const ACTION_LABELS: Record<ActionType, string> = {
  add_tag: 'Adicionar tag',
  remove_tag: 'Remover tag',
  add_to_pipeline: 'Adicionar a um pipeline',
  move_pipeline_stage: 'Mover entre estágios do pipeline',
  assign_user: 'Atribuir a um usuário',
  send_message: 'Enviar mensagem',
};

export const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  equals: 'igual a',
  not_equals: 'diferente de',
  contains: 'contém',
  not_contains: 'não contém',
  in: 'está em',
  not_in: 'não está em',
  is_set: 'está preenchido',
  is_not_set: 'não está preenchido',
};

export const FIELD_LABELS: Record<string, string> = {
  tagId: 'Tag',
  target: 'Aplicado em',
  contactId: 'Contato',
  conversationId: 'Conversa',
  channelId: 'Canal',
  body: 'Texto da mensagem',
  type: 'Tipo de mensagem',
  hasAttachment: 'Tem anexo',
  fromStatus: 'Status anterior',
  toStatus: 'Novo status',
  fromAssigneeId: 'Atribuído anterior',
  toAssigneeId: 'Novo atribuído',
};

export function operatorsForField(field: string): ConditionOperator[] {
  // Boolean-like fields skip the value-comparison operators.
  if (field === 'hasAttachment' || field === 'target') {
    return ['equals', 'not_equals'];
  }
  if (field === 'body') {
    return ['contains', 'not_contains', 'equals', 'is_set', 'is_not_set'];
  }
  return [
    'equals',
    'not_equals',
    'in',
    'not_in',
    'is_set',
    'is_not_set',
  ];
}
