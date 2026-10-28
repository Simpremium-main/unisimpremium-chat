'use client';

import { AnimatePresence } from 'framer-motion';
import { PendingActionBanner } from './pending-action-banner';
import { usePendingActions } from './use-pending-actions';

interface Props {
  conversationId: string;
}

/**
 * Renders one banner per pending action attached to the conversation.
 * Stays silent when there's nothing pending — we don't want to take
 * vertical space in the inbox unless the human actually needs to act.
 *
 * Loading and error states stay quiet on purpose: this component lives
 * above the message timeline and a 10s polling failure shouldn't push
 * a giant red box on top of the chat.
 */
export function PendingActionsList({ conversationId }: Props) {
  const { data, isLoading } = usePendingActions(conversationId);

  if (isLoading) return null;

  // Filter to actions that still need the human in the loop. Actions in
  // a terminal state are kept by the backend for audit but don't belong
  // in the action banner stack.
  const actionable = (data ?? []).filter((a) => a.status === 'PENDING');

  if (actionable.length === 0) return null;

  return (
    <div className="space-y-2 border-b border-zinc-200 bg-zinc-50/60 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/40">
      <AnimatePresence initial={false}>
        {actionable.map((action, idx) => (
          <PendingActionBanner key={action.id} action={action} index={idx} />
        ))}
      </AnimatePresence>
    </div>
  );
}
