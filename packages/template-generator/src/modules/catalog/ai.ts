import { dependencyVersionMap } from "../../utils/add-deps";
import { defineModule } from "../define";
import { NEXT_SHELL_DB } from "./stack";

export default defineModule({
  id: "ai",
  name: { en: "AI studio", "zh-CN": "AI 工作室" },
  description: {
    en: "Private chat, image and video generation with persisted jobs",
    "zh-CN": "私有对话、图片与视频生成及持久化任务",
  },
  category: "ai",
  requires: ["auth"],
  enhances: ["credits", "storage"],
  supports: NEXT_SHELL_DB,
  providers: {
    min: 1,
    default: { global: ["openai"], cn: ["openai-compatible"] },
    options: {
      openai: {
        name: "OpenAI",
        market: "global",
        env: [
          { key: "OPENAI_API_KEY", required: false },
          { key: "OPENAI_CHAT_MODEL", required: false, sensitive: false, default: "gpt-4.1-mini" },
          {
            key: "OPENAI_IMAGE_MODEL",
            required: false,
            sensitive: false,
            default: "gpt-image-2.5-flare",
          },
        ],
      },
      google: {
        name: "Google Gemini",
        market: "global",
        env: [
          { key: "GEMINI_API_KEY", required: false },
          {
            key: "GEMINI_CHAT_MODEL",
            required: false,
            sensitive: false,
            default: "gemini-4-argon",
          },
          {
            key: "GEMINI_IMAGE_MODEL",
            required: false,
            sensitive: false,
            default: "gemini-nano-banana-2.1",
          },
          {
            key: "GEMINI_VIDEO_MODEL",
            required: false,
            sensitive: false,
            default: "gemini-omni-1.1-flash",
          },
        ],
      },
      "openai-compatible": {
        name: "OpenAI-compatible / DeepSeek",
        market: "global",
        env: [
          { key: "AI_COMPATIBLE_API_KEY", required: false },
          {
            key: "AI_COMPATIBLE_BASE_URL",
            required: false,
            sensitive: false,
            default: "https://api.deepseek.com",
          },
          {
            key: "AI_COMPATIBLE_CHAT_MODEL",
            required: false,
            sensitive: false,
            default: "deepseek-flash",
          },
        ],
      },
    },
  },
  options: {
    chatCost: {
      type: "number",
      default: 1,
      min: 1,
      integer: true,
      max: 2_147_483_647,
      description: "Credits per chat request",
    },
    imageCost: {
      type: "number",
      default: 10,
      min: 1,
      integer: true,
      max: 2_147_483_647,
      description: "Credits per image",
    },
    videoCost: {
      type: "number",
      default: 50,
      min: 1,
      integer: true,
      max: 2_147_483_647,
      description: "Credits per video",
    },
  },
  packages: [
    {
      dir: "ai",
      dependencies: {
        "drizzle-orm": dependencyVersionMap["drizzle-orm"],
        zod: dependencyVersionMap.zod,
      },
      workspaceDependencies: ["db"],
    },
  ],
  appDependencies: { zod: dependencyVersionMap.zod },
  services: [
    {
      name: "ai",
      imports: [{ from: "@app/ai", names: ["createAI"] }],
      init: "createAI({ db, env: ENV })",
    },
  ],
  nav: [{ area: "dashboard", href: "/dashboard/ai", labelKey: "nav.ai", order: 70 }],
});
