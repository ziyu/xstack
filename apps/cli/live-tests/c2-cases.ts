import type { CreateInput } from "../src";

export const c2Cases = [
  { id: "next-sqlite", framework: "next", database: "sqlite", email: "resend", sms: "twilio" },
  {
    id: "start-sqlite",
    framework: "tanstack-start",
    database: "sqlite",
    email: "smtp",
    sms: "aliyun",
  },
  { id: "nuxt-sqlite", framework: "nuxt", database: "sqlite", email: "resend", sms: "tencent" },
  {
    id: "split-sqlite",
    framework: "react-router",
    database: "sqlite",
    email: "smtp",
    sms: "twilio",
  },
  {
    id: "split-postgres",
    framework: "react-router",
    database: "postgres",
    email: "resend",
    sms: "tencent",
  },
  {
    id: "split-renamed-cli",
    framework: "react-router",
    database: "sqlite",
    email: "smtp",
    sms: "twilio",
    appIds: {
      backend: "gateway-c2",
      admin: "staff-c2",
      public: "website-c2",
      fullstack: "suite-c2",
    },
    independentCli: "operations-c2",
  },
] as const;
export type C2Case = (typeof c2Cases)[number];

export function c2Input(test: C2Case, projectName: string): CreateInput {
  const ids =
    "appIds" in test
      ? test.appIds
      : { backend: "api", admin: "console", public: "portal", fullstack: "product" };
  const apps: NonNullable<CreateInput["apps"]> =
    test.framework === "react-router"
      ? [
          {
            id: ids.backend,
            type: "backend",
            stack: { framework: "hono", runtime: "node", api: "none" },
          },
          {
            id: ids.admin,
            type: "admin",
            stack: { framework: "react-router" },
            bindings: { backend: ids.backend },
          },
          {
            id: ids.public,
            type: "web-frontend",
            stack: { framework: "react-router" },
            bindings: { backend: ids.backend },
          },
        ]
      : [{ id: ids.fullstack, type: "fullstack-web", stack: { framework: test.framework } }];
  if ("independentCli" in test)
    apps.push({ id: test.independentCli, type: "cli", stack: { framework: "node" } });
  return {
    projectName,
    database: test.database,
    orm: "drizzle",
    dbSetup: "none",
    api: "none",
    addons: ["none"],
    webDeploy: "none",
    serverDeploy: "none",
    packageManager: "bun",
    git: false,
    install: false,
    directoryConflict: "error",
    disableAnalytics: true,
    product: {
      features: ["core", "i18n", "auth", "admin", "email", "sms", "captcha"],
      providers: {
        auth: ["google", "github", "wechat"],
        email: [test.email],
        sms: [test.sms],
        captcha: ["turnstile"],
      },
    },
    apps,
  };
}
