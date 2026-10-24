import { defineModule } from "../define";
import { NATIVE_SHELL_DB } from "./stack";

export default defineModule({
  id: "core",
  name: { en: "Product shell", "zh-CN": "产品外壳" },
  description: {
    en: "Landing page, site layout, dashboard shell, navigation and the domain event bus",
    "zh-CN": "落地页、站点布局、仪表盘外壳、导航和领域事件总线",
  },
  category: "foundation",
  hidden: true,
  requires: ["i18n"],
  supports: NATIVE_SHELL_DB,
  packages: [{ dir: "events" }],
  services: [
    {
      name: "events",
      imports: [{ from: "@app/events", names: ["createEventBus"] }],
      init: "createEventBus()",
    },
  ],
  nav: [{ area: "main", href: "/", labelKey: "nav.home", order: 0 }],
  frameworkReplaces: {
    next: [
      "apps/web/src/app/layout.tsx",
      "apps/web/src/app/page.tsx",
      "apps/web/src/components/header.tsx",
    ],
    "tanstack-start": [
      "apps/web/src/routes/__root.tsx",
      "apps/web/src/routes/index.tsx",
      "apps/web/src/components/header.tsx",
    ],
    nuxt: [
      "apps/web/app/app.vue",
      "apps/web/app/pages/index.vue",
      "apps/web/app/layouts/default.vue",
      "apps/web/app/components/Header.vue",
    ],
  },
});
