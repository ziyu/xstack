---
description: Add addons/features (PWA, Tauri, docs, linters, task runners, MCP, …) to an existing xstack project via the xstack MCP server.
argument-hint: "<addons to add, e.g. pwa biome turborepo>"
---

# Add addons to a xstack project

User request: $ARGUMENTS

Add tooling/features to the current xstack project using the xstack MCP server instead of wiring it by hand.

## Steps

1. **Confirm** the working directory is a xstack project (look for `xstack.jsonc`).
2. **Determine the addon set** from the arguments above. Use `xstack_get_schema` for nested addon options when needed.
3. **Plan with `xstack_plan_addons`** (dry run) and review the changes. Surface any conflicts (e.g. `nx`/`turborepo`/`vite-plus` are mutually exclusive).
4. **Apply with `xstack_add_addons`** once confirmed.
5. **Report** what changed and any follow-up commands.

Always plan before applying. Don't add addons the user didn't ask for.
