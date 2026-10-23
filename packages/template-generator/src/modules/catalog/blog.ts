import { dependencyVersionMap } from "../../utils/add-deps";
import { defineModule } from "../define";
import { NEXT_SHELL_DB } from "./stack";

export default defineModule({
  id: "blog",
  name: { en: "Blog", "zh-CN": "博客" },
  description: {
    en: "Database-backed multilingual publishing with admin authoring and safe Markdown",
    "zh-CN": "数据库驱动的多语言发布、后台编辑与安全 Markdown",
  },
  category: "content",
  requires: ["admin"],
  enhances: ["seo"],
  supports: NEXT_SHELL_DB,
  packages: [
    {
      dir: "blog",
      dependencies: {
        "drizzle-orm": dependencyVersionMap["drizzle-orm"],
        zod: dependencyVersionMap.zod,
      },
      workspaceDependencies: ["db", "i18n", "permissions"],
    },
  ],
  appDependencies: { "react-markdown": "^10.1.0" },
  services: [
    {
      name: "blog",
      imports: [{ from: "@app/blog", names: ["createBlog"] }],
      init: "createBlog(db)",
    },
  ],
  nav: [
    { area: "main", href: "/blog", labelKey: "nav.blog", order: 30 },
    { area: "admin", href: "/admin/blog", labelKey: "nav.blog", order: 40 },
  ],
});
