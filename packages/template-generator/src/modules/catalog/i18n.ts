import { defineModule } from "../define";
import { NEXT_SHELL } from "./stack";

export default defineModule({
  id: "i18n",
  name: { en: "Internationalization", "zh-CN": "国际化" },
  description: {
    en: "Locale-prefixed routing, typed messages and a language switcher",
    "zh-CN": "带语言前缀的路由、类型安全的文案和语言切换",
  },
  category: "foundation",
  hidden: true,
  supports: NEXT_SHELL,
  options: {
    locales: {
      type: "enum",
      values: ["en,zh-CN", "zh-CN,en", "en", "zh-CN"],
      default: "en,zh-CN",
      description: "Enabled locales; the first one is the default",
    },
  },
  packages: [{ dir: "i18n" }],
  proxy: [{ id: "locale", from: "./lib/i18n/proxy", name: "localeStep", order: 10 }],
});
