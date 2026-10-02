import type { ChangeEvent } from '@commute/api-client';

import { useEffect, useState } from 'react';
import { zChangeEvent } from '@commute/api-client';
import { useQueryClient } from '@tanstack/react-query';

const EVENTS_KEPT_MAX = 200;
const RECONNECT_ATTEMPTS_MAX = 20;
const RECONNECT_DELAY_MS = 1_000;

// Listens to an event stream of the coordinator: the project's or one change's. The stream replays recent events,
// then sends each new one. Every event invalidates the project's queries, so the pages refetch only what changed.
export function useEvents(path: string, projectId: string): ChangeEvent[] {
  const queryClient = useQueryClient();
  const [events, setEvents] = useState<ChangeEvent[]>([]);
  useEffect(() => {
    let socket: WebSocket | null = null;
    let lastSeq = 0;
    let attempts = 0;
    let isClosed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = (): void => {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${location.host}${path}`);
      socket.addEventListener('open', () => {
        attempts = 0;
        socket?.send(JSON.stringify({ after: lastSeq }));
      });
      socket.addEventListener('message', (message) => {
        const parsed = zChangeEvent.safeParse(JSON.parse(String(message.data)));
        if (!parsed.success) {
          return;
        }
        lastSeq = Math.max(lastSeq, parsed.data.seq);
        setEvents((current) => [...current, parsed.data].slice(-EVENTS_KEPT_MAX));
        queryClient.invalidateQueries({ queryKey: [projectId] }).catch(reportError);
      });
      socket.addEventListener('close', () => {
        if (!isClosed && attempts < RECONNECT_ATTEMPTS_MAX) {
          attempts += 1;
          retry = setTimeout(connect, RECONNECT_DELAY_MS * attempts);
        }
      });
    };
    connect();
    return () => {
      isClosed = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, [path, projectId, queryClient]);
  return events;
}
