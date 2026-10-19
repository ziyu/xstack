import { defineModule } from "../define";
import { NEXT_SHELL } from "./stack";

export default defineModule({
  id: "admin",
  name: { en: "Admin console", "zh-CN": "管理后台" },
  description: {
    en: "Role-based admin area with user management; other modules add their pages",
    "zh-CN": "基于角色的管理后台与用户管理，其他模块可挂载页面",
  },
  category: "operations",
  requires: ["auth"],
  supports: NEXT_SHELL,
  packages: [{ dir: "permissions", dependencies: { "@casl/ability": "^7.0.1" } }],
  nav: [
    { area: "main", href: "/admin", labelKey: "nav.admin", order: 95, role: "admin" },
    { area: "admin", href: "/admin", labelKey: "nav.overview", order: 0 },
    { area: "admin", href: "/admin/users", labelKey: "nav.users", order: 10 },
  ],
});
