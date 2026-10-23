import { defineModule } from "../define";
import { NEXT_SHELL } from "./stack";

export default defineModule({
  id: "seo",
  name: { en: "Search metadata", "zh-CN": "搜索引擎优化" },
  description: {
    en: "Localized canonical metadata, social cards, robots and a live public sitemap",
    "zh-CN": "本地化规范链接、社交卡片、robots 与动态站点地图",
  },
  category: "content",
  requires: ["core", "i18n"],
  enhances: ["core", "payment"],
  supports: NEXT_SHELL,
  env: [
    {
      key: "SITE_URL",
      type: "url",
      example: "http://localhost:3001",
      sensitive: false,
      comment: "Public canonical origin; set your HTTPS production URL before launch",
    },
  ],
  packages: [{ dir: "seo" }],
  services: [
    {
      name: "seo",
      imports: [
        { from: "@app/seo", names: ["createSeo"] },
        { from: "@app/i18n", names: ["locales", "defaultLocale"] },
      ],
      init: "createSeo({ origin: ENV.SITE_URL, locales, defaultLocale })",
    },
  ],
});
