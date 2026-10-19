import { defineModule } from "../define";
import { NEXT_SHELL_DB } from "./stack";

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
  supports: NEXT_SHELL_DB,
  packages: [{ dir: "events" }],
  services: [
    {
      name: "events",
      imports: [{ from: "@app/events", names: ["createEventBus"] }],
      init: "createEventBus()",
    },
  ],
  nav: [{ area: "main", href: "/", labelKey: "nav.home", order: 0 }],
  replaces: [
    "apps/web/src/app/layout.tsx",
    "apps/web/src/app/page.tsx",
    "apps/web/src/components/header.tsx",
  ],
});
