import { AuthSchema, type ProjectConfig } from "@xstack/types";

import { Handlebars, isBinaryFile, transformFilename } from "../core/template-processor";
import type { VirtualFileSystem } from "../core/virtual-fs";
import type { TemplateData } from "../template-handlers/utils";
import { GeneratorError, type RenderConfig } from "../types";
import { dependencyVersionMap } from "../utils/add-deps";
import { MODULE_CATALOG } from "./catalog";
import { hasErrors, resolveModules, toSelection } from "./resolver";
import {
  addAppDependencies,
  appendEnv,
  camel,
  declareEnvSchema,
  indexDbSchema,
  type ModuleEnvEntry,
  replaceStackFiles,
  wireServices,
} from "./seams";
import { processAuthTemplates } from "./stack/auth";
import type { NavArea, ResolvedModule, ResolvedPlan, WorkspacePackageSpec } from "./types";

const WEB = "apps/web";

type PackageJson = {
  name?: string;
  type?: string;
  exports?: Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const planCache = new WeakMap<ProjectConfig, ResolvedPlan>();

const AUTH_VALUES = AuthSchema.options;

function domainValue<T extends string>(values: readonly T[], value = "none"): T {
  const match = values.find((candidate) => candidate === value);
  if (!match) {
    throw new GeneratorError({ message: `Unknown domain value "${value}"`, phase: "modules" });
  }
  return match;
}

export function getModulePlan(config: ProjectConfig): ResolvedPlan {
  let plan = planCache.get(config);
  if (!plan) {
    plan = resolveModules(toSelection(config.product), config, MODULE_CATALOG);
    planCache.set(config, plan);
  }
  return plan;
}

/** The config the stack templates render with, carrying the auth engine the module plan picked. */
export function toRenderConfig(config: ProjectConfig): RenderConfig {
  const plan = getModulePlan(config);
  const render = {
    ...config,
    auth: domainValue(AUTH_VALUES, plan.domains.auth),
  };
  planCache.set(render, plan);
  return render;
}

/** Renders the stack templates of modules that use their stack implementation. */
export async function processStackModules(
  vfs: VirtualFileSystem,
  templates: TemplateData,
  config: RenderConfig,
): Promise<void> {
  for (const module of getModulePlan(config).modules) {
    if (module.variant === "stack") {
      const renderer = module.manifest.domain?.stack?.renderer;
      if (renderer !== "auth") {
        throw new GeneratorError({
          message: `No stack renderer registered for "${module.manifest.id}"`,
          phase: "modules",
        });
      }
      await processAuthTemplates(vfs, templates, config);
    }
  }
}

/** The plan restricted to natively rendered modules; `undefined` when there are none. */
function requirePlan(config: ProjectConfig): ResolvedPlan | undefined {
  const plan = getModulePlan(config);
  if (hasErrors(plan)) {
    throw new GeneratorError({
      message: plan.issues
        .filter((issue) => issue.level === "error")
        .map((issue) => issue.message)
        .join("; "),
      phase: "modules",
    });
  }
  const modules = plan.modules.filter((m) => m.variant === "native");
  return modules.length ? { ...plan, modules } : undefined;
}

function workspaceVersion(config: ProjectConfig): string {
  return config.packageManager === "npm" ? "*" : "workspace:*";
}

function templateContext(config: ProjectConfig, plan: ResolvedPlan, module: ResolvedModule) {
  return {
    ...config,
    product: {
      features: plan.modules.map((m) => m.manifest.id),
      providers: Object.fromEntries(plan.modules.map((m) => [m.manifest.id, m.providers])),
    },
    module: {
      id: module.manifest.id,
      providers: module.providers,
      options: module.options,
      integrations: module.integrations,
    },
  };
}

/** Stack files not yet replaced; module templates must not overwrite them. */
type StackFiles = Set<string>;

function renderPrefix(
  vfs: VirtualFileSystem,
  templates: TemplateData,
  prefix: string,
  context: ReturnType<typeof templateContext>,
  stackFiles: StackFiles,
) {
  const normalized = `${prefix}/`;
  for (const [templatePath, content] of templates) {
    if (!templatePath.startsWith(normalized)) continue;
    const destPath = transformFilename(templatePath.slice(normalized.length));
    if (stackFiles.has(destPath)) {
      throw new GeneratorError({
        message: `Module "${context.module.id}" overwrites ${destPath} from the stack templates; declare it in "replaces"`,
        phase: "modules",
      });
    }
    if (isBinaryFile(templatePath)) {
      vfs.writeFile(destPath, "[Binary file]", templatePath);
    } else if (templatePath.endsWith(".hbs")) {
      vfs.writeFile(destPath, Handlebars.compile(content)(context));
    } else {
      vfs.writeFile(destPath, content);
    }
  }
}

function ensureWorkspacePackage(
  vfs: VirtualFileSystem,
  config: ProjectConfig,
  spec: WorkspacePackageSpec,
) {
  const dir = `packages/${spec.dir}`;
  const scope = `@${config.projectName}`;
  const pkg: PackageJson = vfs.readJson<PackageJson>(`${dir}/package.json`) ?? {
    name: `${scope}/${spec.dir}`,
    type: "module",
    exports: { ".": "./src/index.ts", "./*": "./src/*.ts" },
    scripts: { "check-types": "tsc --noEmit" },
  };
  pkg.dependencies = { ...pkg.dependencies, ...spec.dependencies };
  for (const dep of spec.workspaceDependencies ?? []) {
    pkg.dependencies[`${scope}/${dep}`] = workspaceVersion(config);
  }
  pkg.devDependencies = {
    ...pkg.devDependencies,
    ...spec.devDependencies,
    [`${scope}/config`]: workspaceVersion(config),
    typescript: dependencyVersionMap.typescript,
  };
  vfs.writeJson(`${dir}/package.json`, pkg);

  if (!vfs.exists(`${dir}/tsconfig.json`)) {
    vfs.writeJson(`${dir}/tsconfig.json`, {
      extends: `${scope}/config/tsconfig.base.json`,
      compilerOptions: { noEmit: true, jsx: "react-jsx", lib: ["ESNext", "DOM"] },
    });
  }
}

/** Phase 1: render module templates on top of the generated stack. */
export function processModuleTemplates(
  vfs: VirtualFileSystem,
  templates: TemplateData,
  config: ProjectConfig,
): void {
  const plan = requirePlan(config);
  if (!plan) return;

  const stackFiles: StackFiles = new Set(vfs.getAllFiles());
  for (const module of plan.modules) {
    const { manifest } = module;
    const base = `modules/${manifest.id}`;
    const context = templateContext(config, plan, module);

    if (manifest.replaces) {
      for (const file of replaceStackFiles(vfs, manifest.id, manifest.replaces)) {
        stackFiles.delete(file);
      }
    }

    renderPrefix(vfs, templates, `${base}/files`, context, stackFiles);
    for (const framework of config.frontend) {
      renderPrefix(vfs, templates, `${base}/frameworks/${framework}`, context, stackFiles);
    }
    renderPrefix(vfs, templates, `${base}/dialects/${config.database}`, context, stackFiles);
    for (const provider of module.providers) {
      renderPrefix(vfs, templates, `${base}/providers/${provider}`, context, stackFiles);
    }
    for (const other of module.integrations) {
      renderPrefix(vfs, templates, `${base}/integrations/${other}`, context, stackFiles);
    }

    const [primary] = manifest.packages ?? [];
    const providerSpecs = module.providers.flatMap((p) => manifest.providers?.options[p] ?? []);
    for (const spec of manifest.packages ?? []) {
      const own = spec === primary ? providerSpecs : [];
      ensureWorkspacePackage(vfs, config, {
        ...spec,
        dependencies: Object.assign({}, spec.dependencies, ...own.map((p) => p.dependencies)),
        devDependencies: Object.assign(
          {},
          spec.devDependencies,
          ...own.map((p) => p.devDependencies),
        ),
      });
      addAppDependencies(vfs, { [`@${config.projectName}/${spec.dir}`]: workspaceVersion(config) });
    }

    if (manifest.appDependencies) addAppDependencies(vfs, manifest.appDependencies);
    for (const spec of providerSpecs) {
      if (spec.appDependencies) addAppDependencies(vfs, spec.appDependencies);
    }
  }

  aggregateMessages(vfs, plan);
  indexDbSchema(vfs);
  writeNavigation(vfs, config, plan);
  writeProxy(vfs, plan);
  writeModuleDocsIndex(vfs, plan);
}

function moduleEnv(plan: ResolvedPlan): ModuleEnvEntry[] {
  return plan.modules.flatMap((module) => [
    ...(module.manifest.env ?? []).map((spec) => ({ module: module.manifest.id, spec })),
    ...module.providers.flatMap((provider) =>
      (module.manifest.providers?.options[provider]?.env ?? []).map((spec) => ({
        module: `${module.manifest.id}.${provider}`,
        spec,
      })),
    ),
  ]);
}

/** Phase 2 (after stack env files exist): add module variables to the server `.env`. */
export function processModuleEnv(vfs: VirtualFileSystem, config: ProjectConfig): void {
  const plan = requirePlan(config);
  if (plan) appendEnv(vfs, moduleEnv(plan));
}

/** Phase 3 (after the stack wrote `.env.schema` and `services.ts`): module-aware wiring. */
export function finalizeModules(vfs: VirtualFileSystem, config: ProjectConfig): void {
  const plan = requirePlan(config);
  if (!plan) return;
  declareEnvSchema(vfs, moduleEnv(plan));
  wireServices(
    vfs,
    config,
    plan.modules.flatMap((m) => m.manifest.services ?? []),
  );
}

/** README section describing the feature modules and their first-run steps. */
export function moduleReadmeSection(config: ProjectConfig): string {
  const plan = requirePlan(config);
  if (!plan) return "";
  const ids = new Set(plan.modules.map((m) => m.manifest.id));
  const run = `${config.packageManager} run`;

  const modules = plan.modules.map(
    (m) =>
      `- **${m.manifest.name.en}** ([docs](docs/modules/${m.manifest.id}.md)): ${m.manifest.description.en}`,
  );
  const steps = [
    "Fill in `apps/web/.env`; `apps/web/.env.schema` documents every variable and which ones are optional.",
    ids.has("admin")
      ? "Add your email to `ADMIN_EMAILS` before signing up so your account gets the admin role."
      : "",
    `Create the tables with \`${run} db:push\`.`,
    `Start the app with \`${run} dev\`.`,
    ids.has("email")
      ? "Without an email provider key, development emails (verification, password reset) are printed to the server console."
      : "",
    ids.has("sms")
      ? "Configure the selected SMS provider in `apps/web/.env`. For local development only, explicitly set `SMS_DELIVERY_MODE=console` to print verification codes instead of sending SMS; production requires provider credentials."
      : "",
    plan.modules.some((m) => m.providers.includes("mock"))
      ? "Checkout falls back to the `mock` payment provider in development until real provider keys are set."
      : "",
  ].filter(Boolean);

  return `
## Feature Modules

${modules.join("\n")}

### First Run

${steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}
`;
}

function aggregateMessages(vfs: VirtualFileSystem, plan: ResolvedPlan) {
  const root = "packages/i18n/src/messages";
  if (!vfs.directoryExists(root)) return;

  const i18n = plan.modules.find((m) => m.manifest.id === "i18n");
  const enabled = String(i18n?.options.locales ?? "en").split(",");
  const present: string[] = [];

  for (const locale of vfs.listDir(root)) {
    const dir = `${root}/${locale}`;
    if (!vfs.directoryExists(dir)) continue;
    if (locale !== "en" && !enabled.includes(locale)) {
      for (const file of vfs.listDir(dir)) vfs.deleteFile(`${dir}/${file}`);
      vfs.deleteDirectory(dir);
      continue;
    }
    present.push(locale);
    const namespaces = vfs
      .listDir(dir)
      .filter((file) => file.endsWith(".ts") && file !== "index.ts")
      .map((file) => file.replace(/\.ts$/, ""));
    const lines = [
      ...(locale === "en" ? [] : ['import type { Messages } from "../../types";', ""]),
      ...namespaces.map((ns) => `import ${camel(ns)} from "./${ns}";`),
      "",
      `const messages = { ${namespaces.map((ns) => (camel(ns) === ns ? ns : `"${ns}": ${camel(ns)}`)).join(", ")} }${locale === "en" ? "" : " satisfies Messages"};`,
      "",
      "export default messages;",
      "",
    ];
    vfs.writeFile(`${dir}/index.ts`, lines.join("\n"));
  }

  const ident = (locale: string) => camel(locale.toLowerCase());
  vfs.writeFile(
    "packages/i18n/src/config.ts",
    [
      `export const locales = [${enabled.map((l) => JSON.stringify(l)).join(", ")}] as const;`,
      "",
      "export type Locale = (typeof locales)[number];",
      "",
      `export const defaultLocale: Locale = ${JSON.stringify(enabled[0])};`,
      "",
    ].join("\n"),
  );
  vfs.writeFile(
    `${root}/index.ts`,
    [
      'import type { Locale } from "../config";',
      'import type { Messages } from "../types";',
      ...present
        .filter((locale) => enabled.includes(locale))
        .map((locale) => `import ${ident(locale)} from "./${locale}";`),
      "",
      "export const catalog: Record<Locale, Messages> = {",
      ...enabled.map((locale) => `  ${JSON.stringify(locale)}: ${ident(locale)},`),
      "};",
      "",
    ].join("\n"),
  );
}

function writeNavigation(vfs: VirtualFileSystem, config: ProjectConfig, plan: ResolvedPlan) {
  const areas: NavArea[] = ["main", "dashboard", "admin", "footer"];
  const present = new Set(plan.modules.map((m) => m.manifest.id));
  const items = plan.modules.flatMap((m) =>
    (m.manifest.nav ?? [])
      .filter((item) => !item.when || present.has(item.when))
      .map((item) => ({
        ...item,
        labelKey: `${m.manifest.id}.${item.labelKey}`,
      })),
  );
  const render = (area: NavArea) =>
    items
      .filter((item) => item.area === area)
      .sort((a, b) => (a.order ?? 50) - (b.order ?? 50))
      .map(
        (item) =>
          `    { href: ${JSON.stringify(item.href)}, labelKey: ${JSON.stringify(item.labelKey)}${item.auth ? ", auth: true" : ""}${item.role ? `, role: ${JSON.stringify(item.role)}` : ""} },`,
      );

  const lines = [
    `import type { MessageKey } from "@${config.projectName}/i18n";`,
    "",
    "export type NavItem = {",
    "  /** Path without the locale prefix. */",
    "  href: `/${string}`;",
    "  labelKey: MessageKey;",
    "  auth?: boolean;",
    "  role?: string;",
    "};",
    "",
    `export type NavArea = ${areas.map((a) => JSON.stringify(a)).join(" | ")};`,
    "",
    "export type NavUser = { id: string; role?: string | null };",
    "",
    "export function canSee(item: NavItem, user: NavUser | null | undefined): boolean {",
    "  if (item.role) return user?.role === item.role;",
    "  return !item.auth || Boolean(user);",
    "}",
    "",
    "export const navigation: Record<NavArea, NavItem[]> = {",
    ...areas.flatMap((area) => {
      const entries = render(area);
      return entries.length ? [`  ${area}: [`, ...entries, "  ],"] : [`  ${area}: [],`];
    }),
    "};",
    "",
  ];
  vfs.writeFile(`${WEB}/src/config/navigation.ts`, lines.join("\n"));
}

function writeProxy(vfs: VirtualFileSystem, plan: ResolvedPlan) {
  const steps = plan.modules
    .flatMap((m) => m.manifest.proxy ?? [])
    .sort((a, b) => a.order - b.order);
  if (!steps.length) return;

  vfs.writeFile(
    `${WEB}/src/lib/proxy.ts`,
    [
      'import type { NextRequest, NextResponse } from "next/server";',
      "",
      "/** Returns a response to end the chain, or `undefined` to continue. */",
      "export type ProxyStep = (",
      "  request: NextRequest,",
      ") => NextResponse | undefined | Promise<NextResponse | undefined>;",
      "",
    ].join("\n"),
  );

  const lines = [
    'import { type NextRequest, NextResponse } from "next/server";',
    "",
    'import type { ProxyStep } from "./lib/proxy";',
    ...steps.map((step) => `import { ${step.name} } from "${step.from}";`),
    "",
    `const steps: ProxyStep[] = [${steps.map((step) => step.name).join(", ")}];`,
    "",
    "export async function proxy(request: NextRequest) {",
    "  for (const step of steps) {",
    "    const response = await step(request);",
    "    if (response) return response;",
    "  }",
    "  return NextResponse.next();",
    "}",
    "",
    "export const config = {",
    '  matcher: ["/((?!api|_next|.*\\\\..*).*)"],',
    "};",
    "",
  ];
  vfs.writeFile(`${WEB}/src/proxy.ts`, lines.join("\n"));
}

function writeModuleDocsIndex(vfs: VirtualFileSystem, plan: ResolvedPlan) {
  const docs = plan.modules.filter((m) => vfs.exists(`docs/modules/${m.manifest.id}.md`));
  if (!docs.length) return;
  const lines = [
    "# Modules",
    "",
    "| Module | Providers | Guide |",
    "| --- | --- | --- |",
    ...docs.map(
      (m) =>
        `| ${m.manifest.name.en} | ${m.providers.join(", ") || "-"} | [${m.manifest.id}](./modules/${m.manifest.id}.md) |`,
    ),
    "",
  ];
  vfs.writeFile("docs/README.md", lines.join("\n"));
}
