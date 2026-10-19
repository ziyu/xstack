# Admin console

The admin area lives at `/admin` and is visible only to users with the `admin` role. Everyone else gets a 404.

## Becoming an admin

Set `ADMIN_EMAILS` before signing up:

```bash
ADMIN_EMAILS=you@example.com
```

Existing admins can promote other users from `/admin/users`.

## Permissions

`packages/permissions` defines abilities with [CASL](https://casl.js.org):

```ts
import { defineAbilityFor } from "@app/permissions";

const ability = defineAbilityFor(user);
ability.can("access", "Admin");
```

Admins `manage` everything. Add roles or finer rules in `defineAbilityFor`, and register new subjects through declaration merging on `SubjectMap`.

Pages call `requireAdmin(locale)` from `apps/web/src/lib/admin.ts`.

## Adding pages

Create `apps/web/src/app/[lang]/admin/<page>/page.tsx` and add an entry to `navigation.admin` in `apps/web/src/config/navigation.ts`. Modules such as payment and credits add their pages this way.
