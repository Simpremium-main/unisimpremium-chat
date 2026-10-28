/**
 * Mirrors the backend Pending Actions contract. Tools flagged as
 * destructive (grantAccess, resetPassword, transferToHuman) don't run
 * directly — the agent stages a PendingAction here and a human approves
 * or rejects it from the inbox before execution.
 *
 * Keep these types in sync with the NestJS backend module:
 *   src/server/modules/ai-agents/confirmations/*
 */

export type PendingActionImpact = 'low' | 'medium' | 'high' | 'critical';

export type PendingActionStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'EXECUTED';

export interface PendingActionAffectedEntity {
  type: string;
  id: string;
  label?: string;
}

export interface PendingActionPreview {
  /** Human-readable summary, e.g. "Liberar acesso ao curso X para fulano". */
  action: string;
  impact: PendingActionImpact;
  /** Optional rollback instructions, displayed as a hint to the approver. */
  rollback?: string;
  affectedEntity?: PendingActionAffectedEntity;
}

export interface PendingAction {
  id: string;
  agentRunId: string;
  conversationId: string;
  agentId: string;
  /** Backend-known tool names — keep loose to support new tools without UI churn. */
  toolName: string;
  args: Record<string, unknown>;
  preview: PendingActionPreview;
  status: PendingActionStatus;
  /** ISO timestamps. */
  createdAt: string;
  expiresAt: string;
}
