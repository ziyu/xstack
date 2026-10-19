# Product shell

The shell every feature module plugs into.

## Layout

- `apps/web/src/app/[lang]/` holds all pages. The `[lang]` segment comes from the i18n module.
- `apps/web/src/config/site.ts` holds the product name.
- `apps/web/src/config/navigation.ts` is generated from the modules you picked. Edit it freely; it is plain data.
- `apps/web/src/services.ts` is the composition root: every package exports a factory, and this file wires them with environment variables and each other.

## Domain events

`packages/events` is a small in-process event bus. Modules never import each other's internals. Instead:

1. The emitting module declares its events by extending `EventMap`:

   ```ts
   declare module "@your-app/events" {
     interface EventMap {
       "order.paid": { orderId: string; userId: string };
     }
   }
   ```

2. It emits them: `await events.emit("order.paid", { orderId, userId })`.
3. Code that connects two modules lives in `apps/web/src/integrations/*.ts` and subscribes with `events.on(...)`.

Handlers run in order and an error rejects `emit`, so a failed side effect surfaces to the caller. Replace `createEventBus` with a queue-backed implementation if you need retries; the interface stays the same.

## Removing a module

Delete its package under `packages/`, its pages under `apps/web/src/app/[lang]/`, its entries in `config/navigation.ts` and `services.ts`, and its integration files. Nothing else references it.
