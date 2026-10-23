import { dependencyVersionMap } from "../../utils/add-deps";
import { defineModule } from "../define";
import { NEXT_SHELL_DB } from "./stack";

export default defineModule({
  id: "storage",
  name: { en: "Private files", "zh-CN": "私有文件" },
  description: {
    en: "Private S3, R2, OSS or COS uploads and owned downloads",
    "zh-CN": "S3、R2、OSS 或 COS 私有上传与个人文件下载",
  },
  category: "content",
  requires: ["auth"],
  supports: NEXT_SHELL_DB,
  providers: {
    min: 1,
    max: 1,
    default: { global: ["s3"], cn: ["oss"] },
    targetDefaults: { cloudflare: ["r2-binding"] },
    options: {
      s3: {
        name: "Amazon S3",
        market: "global",
        supports: { targets: ["none", "node", "vercel", "docker"] },
        dependencies: {
          "@aws-sdk/client-s3": "^3.1000.0",
          "@aws-sdk/s3-request-presigner": "^3.1000.0",
        },
        env: [
          { key: "S3_REGION", required: false, sensitive: false },
          { key: "S3_BUCKET", required: false, sensitive: false },
          { key: "S3_ACCESS_KEY_ID", required: false },
          { key: "S3_SECRET_ACCESS_KEY", required: false },
          { key: "S3_SESSION_TOKEN", required: false },
        ],
      },
      r2: {
        name: "Cloudflare R2 (S3 API)",
        market: "global",
        supports: { targets: ["none", "node", "vercel", "docker"] },
        dependencies: {
          "@aws-sdk/client-s3": "^3.1000.0",
          "@aws-sdk/s3-request-presigner": "^3.1000.0",
        },
        env: [
          { key: "R2_ACCOUNT_ID", required: false, sensitive: false },
          { key: "R2_BUCKET", required: false, sensitive: false },
          { key: "R2_ACCESS_KEY_ID", required: false },
          { key: "R2_SECRET_ACCESS_KEY", required: false },
        ],
      },
      "r2-binding": {
        name: "Cloudflare R2 (Workers binding)",
        market: "global",
        supports: { targets: ["cloudflare"] },
        dependencies: { "@opennextjs/cloudflare": dependencyVersionMap["@opennextjs/cloudflare"] },
        devDependencies: {
          "@cloudflare/workers-types": dependencyVersionMap["@cloudflare/workers-types"],
        },
      },
      oss: {
        name: "Alibaba Cloud OSS",
        market: "cn",
        supports: { targets: ["none", "node", "vercel", "docker"] },
        dependencies: { "ali-oss": "^6.23.0" },
        devDependencies: { "@types/ali-oss": "^6.23.3" },
        appDependencies: { "ali-oss": "^6.23.0" },
        serverExternalPackages: ["ali-oss"],
        env: [
          { key: "OSS_REGION", required: false, sensitive: false },
          { key: "OSS_BUCKET", required: false, sensitive: false },
          { key: "OSS_ACCESS_KEY_ID", required: false },
          { key: "OSS_ACCESS_KEY_SECRET", required: false },
          { key: "OSS_SECURITY_TOKEN", required: false },
        ],
      },
      cos: {
        name: "Tencent Cloud COS",
        market: "cn",
        supports: { targets: ["none", "node", "vercel", "docker"] },
        dependencies: { "cos-nodejs-sdk-v5": "^3.0.0" },
        env: [
          { key: "COS_REGION", required: false, sensitive: false },
          { key: "COS_BUCKET", required: false, sensitive: false },
          { key: "COS_SECRET_ID", required: false },
          { key: "COS_SECRET_KEY", required: false },
          { key: "COS_SECURITY_TOKEN", required: false },
        ],
      },
    },
  },
  packages: [
    {
      dir: "storage",
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
      name: "storage",
      imports: [{ from: "@app/storage", names: ["createStorage"] }],
      init: "createStorage({ env: ENV, db })",
    },
  ],
  nav: [{ area: "dashboard", href: "/dashboard/files", labelKey: "nav.files", order: 60 }],
});
