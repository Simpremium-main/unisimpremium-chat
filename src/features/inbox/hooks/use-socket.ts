'use client';

import { useEffect, useRef, useCallback } from 'react';
import { getSocket } from '@/lib/socket';
import type { Socket } from '@/lib/socket';

/**
 * Singleton socket handle. We track:
 * - the currently-joined conversation room (module scope) so we can rejoin
 *   it across reconnects;
 * - whether the backend has acknowledged auth (`ready` event). join:conversation
 *   emitted before `ready` is wasted — backend has no role/channelIds yet
 *   and silently rejects. We queue the join until `ready` fires.
 * - whether we've ever been ready before — a second `ready` event means
 *   we just reconnected (network blip, laptop wake) and consumers may
 *   want to refetch any data that could have changed while we were
 *   offline (messages, conversation list, …).
 */
let activeConversationId: string | null = null;
let authReady = false;
let everReady = false;

// Module-scope reconnect listeners. We call these whenever `ready` fires
// AFTER the first one — i.e. the user came back online. Each consumer
// hook subscribes once via `onReconnect`.
const reconnectListeners = new Set<() => void>();

function setActiveConversation(id: string | null) {
  activeConversationId = id;
}

function getActiveConversation(): string | null {
  return activeConversationId;
}

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

    // On each new connect cycle, auth has not been acknowledged yet.
    const onConnect = () => {
      authReady = false;
    };

    // Backend emits `ready` at the end of handleConnection — at that point
    // role/channelIds are populated and join:conversation will pass.
    const onReady = () => {
      const isReconnect = everReady;
      authReady = true;
      everReady = true;
      const convId = getActiveConversation();
      if (convId) socket.emit('join:conversation', { conversationId: convId });
      if (isReconnect) {
        // Fire all reconnect listeners. A try/catch around each one prevents
        // a buggy subscriber from breaking the others.
        for (const fn of reconnectListeners) {
          try { fn(); } catch { /* swallow */ }
        }
      }
    };

    socket.on('connect', onConnect);
    socket.on('ready', onReady);
    if (socket.connected && authReady) {
      const convId = getActiveConversation();
      if (convId) socket.emit('join:conversation', { conversationId: convId });
    }

    return () => {
      socket.off('connect', onConnect);
      socket.off('ready', onReady);
    };
  }, []);

  const on = useCallback((event: string, handler: (...args: any[]) => void) => {
    socketRef.current?.on(event, handler);
    return () => {
      socketRef.current?.off(event, handler);
    };
  }, []);

  const emit = useCallback((event: string, data: any) => {
    const socket = socketRef.current;
    if (!socket) return;
    // Track join/leave to support auto-rejoin across reconnects.
    if (event === 'join:conversation') {
      setActiveConversation(data?.conversationId ?? null);
      // Defer the actual emit until backend signals `ready`. Without this,
      // a fresh tab opens the inbox, mounts ChatPanel, fires this emit
      // BEFORE handleConnection finishes the DB lookup, and the join is
      // silently dropped — leaving the user with stale chat panel.
      if (!authReady) return;
    }
    if (event === 'leave:conversation') {
      if (getActiveConversation() === data?.conversationId) {
        setActiveConversation(null);
      }
    }
    socket.emit(event, data);
  }, []);

  /**
   * Subscribe to "we just came back from a disconnect" — fires after
   * every `ready` except the very first one. Use it to refetch any data
   * that could have changed while we were offline (messages, conversation
   * list). Returns an unsubscribe function for cleanup in useEffect.
   */
  const onReconnect = useCallback((handler: () => void) => {
    reconnectListeners.add(handler);
    return () => {
      reconnectListeners.delete(handler);
    };
  }, []);

  return { on, emit, onReconnect, socket: socketRef };
}
