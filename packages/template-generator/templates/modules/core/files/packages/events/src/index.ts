/**
 * Domain events shared between feature modules.
 *
 * Modules add their events through declaration merging:
 *
 *   declare module "@app/events" {
 *     interface EventMap {
 *       "order.paid": { orderId: string; userId: string };
 *     }
 *   }
 */
// oxlint-disable-next-line no-empty-interface
export interface EventMap {}

export type EventName = keyof EventMap;

export type EventHandler<K extends EventName> = (payload: EventMap[K]) => void | Promise<void>;

export type EventBus = {
  on<K extends EventName>(event: K, handler: EventHandler<K>): () => void;
  /** Runs handlers in registration order; a failing handler rejects the emit. */
  emit<K extends EventName>(event: K, payload: EventMap[K]): Promise<void>;
};

export function createEventBus(): EventBus {
  const handlers = new Map<EventName, Set<EventHandler<never>>>();

  return {
    on(event, handler) {
      const set = handlers.get(event) ?? new Set();
      set.add(handler as EventHandler<never>);
      handlers.set(event, set);
      return () => {
        set.delete(handler as EventHandler<never>);
      };
    },
    async emit(event, payload) {
      for (const handler of handlers.get(event) ?? []) {
        await (handler as EventHandler<typeof event>)(payload);
      }
    },
  };
}
