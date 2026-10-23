import type { ProjectConfig } from "@xstack/types";
import { Node, Project, SyntaxKind } from "ts-morph";

import type { VirtualFileSystem } from "../core/virtual-fs";
import { GeneratorError } from "../types";
import { addPackageDependency } from "../utils/add-deps";
import type { EnvSpec, ServiceSpec } from "./types";

/**
 * The only places feature modules edit files the stack templates generated.
 * Each seam requires the stack output it edits, so a renamed or dropped stack file
 * fails generation instead of being skipped silently.
 */

const WEB = "apps/web";

export const SEAM_FILES = {
  appPackage: `${WEB}/package.json`,
  env: `${WEB}/.env`,
  envSchema: `${WEB}/.env.schema`,
  services: `${WEB}/src/services.ts`,
  dbSchemaIndex: "packages/db/src/schema/index.ts",
} as const;

function stackFile(vfs: VirtualFileSystem, path: string, seam: string): string {
  const content = vfs.readFile(path);
  if (content === undefined) {
    throw new GeneratorError({
      message: `Module seam "${seam}" expects ${path} from the stack templates`,
      phase: "modules",
    });
  }
  return content;
}

export function camel(value: string): string {
  return value.replace(/[-_.]([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** Deletes stack files a module supersedes (`dir/` entries: the whole directory) and returns them. */
export function replaceStackFiles(
  vfs: VirtualFileSystem,
  module: string,
  paths: string[],
): string[] {
  const files = vfs.getAllFiles();
  const deleted: string[] = [];
  for (const path of paths) {
    const targets = path.endsWith("/") ? files.filter((file) => file.startsWith(path)) : [path];
    if (!targets.length || !targets.every((file) => vfs.exists(file))) {
      throw new GeneratorError({
        message: `Module "${module}" replaces ${path}, which the stack templates no longer generate`,
        phase: "modules",
      });
    }
    for (const file of targets) vfs.deleteFile(file);
    deleted.push(...targets);
  }
  return deleted;
}

export function addAppDependencies(vfs: VirtualFileSystem, dependencies: Record<string, string>) {
  stackFile(vfs, SEAM_FILES.appPackage, "app dependencies");
  addPackageDependency({
    vfs,
    packagePath: SEAM_FILES.appPackage,
    customDependencies: dependencies,
  });
}

/** Preserve existing Next settings while keeping Node SDK dynamic imports outside the bundle. */
export function addServerExternalPackages(vfs: VirtualFileSystem, packages: string[]) {
  if (!packages.length) return;
  const path = `${WEB}/next.config.ts`;
  const project = new Project({ useInMemoryFileSystem: true });
  const source = project.createSourceFile(path, stackFile(vfs, path, "server external packages"));
  const config = source
    .getVariableDeclarationOrThrow("nextConfig")
    .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
  const property = config.getProperty("serverExternalPackages");
  if (!property) {
    config.addPropertyAssignment({
      name: "serverExternalPackages",
      initializer: JSON.stringify([...new Set(packages)]),
    });
  } else {
    if (!Node.isPropertyAssignment(property))
      throw new GeneratorError({
        message: "Expected a serverExternalPackages array",
        phase: "modules",
      });
    const values = property.getInitializerIfKindOrThrow(SyntaxKind.ArrayLiteralExpression);
    const existing = new Set(values.getElements().map((element) => element.getText()));
    for (const name of packages) {
      const quoted = JSON.stringify(name);
      if (!existing.has(quoted)) {
        values.addElement(quoted);
        existing.add(quoted);
      }
    }
  }
  vfs.writeFile(path, source.getFullText());
}

export type ModuleEnvEntry = { module: string; spec: EnvSpec };

/** Appends module variables to the server `.env`, grouped by module. */
export function appendEnv(vfs: VirtualFileSystem, entries: ModuleEnvEntry[]) {
  let content = stackFile(vfs, SEAM_FILES.env, "env");
  let lastModule = "";
  for (const { module, spec } of entries) {
    if (new RegExp(`^\\s*#?\\s*${spec.key}=`, "m").test(content)) continue;
    if (module !== lastModule) {
      content += `${content.endsWith("\n") || !content ? "" : "\n"}\n# ${module}\n`;
      lastModule = module;
    }
    if (spec.comment) content += `# ${spec.comment}\n`;
    const value = spec.example ?? "";
    content += spec.required === false && !value ? `# ${spec.key}=\n` : `${spec.key}=${value}\n`;
  }
  vfs.writeFile(SEAM_FILES.env, content);
}

function schemaType(spec: EnvSpec): string {
  switch (spec.type) {
    case "enum":
      return `enum(${(spec.values ?? []).join(", ")})`;
    case "url":
      return "url";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "secret":
      return "string(minLength=32)";
    default:
      return "string(minLength=1)";
  }
}

/** Declares module variables in `.env.schema`, replacing stack declarations of the same key. */
export function declareEnvSchema(vfs: VirtualFileSystem, entries: ModuleEnvEntry[]) {
  let schema = stackFile(vfs, SEAM_FILES.envSchema, "env schema");
  for (const { spec } of entries) {
    const decorators = [
      spec.public ? "@public" : "",
      spec.required === false ? "@required=false" : "",
      spec.sensitive === false && !spec.public ? "@sensitive=false" : "",
      `@type=${schemaType(spec)}`,
    ].filter(Boolean);
    const block = `# ${decorators.join(" ")}\n${spec.key}=${spec.default ?? ""}`;
    const pattern = new RegExp(`^# [^\\n]*\\n${spec.key}=[^\\n]*$`, "m");
    schema = pattern.test(schema)
      ? schema.replace(pattern, block)
      : `${schema.trimEnd()}\n\n${block}\n`;
  }
  vfs.writeFile(SEAM_FILES.envSchema, schema);
}

/**
 * Rewrites `services.ts`: keeps the stack's single-line named imports and bindings,
 * adds module services (replacing stack bindings of the same name) and registers
 * the files in `src/integrations/`.
 */
export function wireServices(
  vfs: VirtualFileSystem,
  config: ProjectConfig,
  services: ServiceSpec[],
) {
  const existing = stackFile(vfs, SEAM_FILES.services, "services");
  const scope = `@${config.projectName}/`;
  const replaced = new Set(services.map((service) => service.name));
  if (
    config.backend === "self" &&
    config.webDeploy === "cloudflare" &&
    config.frontend.includes("next")
  ) {
    wireCloudflareServices(vfs, config, services);
    return;
  }

  const imports = new Map<string, Set<string>>();
  const addImport = (from: string, names: string[]) => {
    const set = imports.get(from) ?? new Set<string>();
    for (const name of names) set.add(name);
    imports.set(from, set);
  };

  const body: string[] = [];
  for (const line of existing.split("\n")) {
    const named = /^import \{ ([^}]+) \} from "([^"]+)";$/.exec(line);
    if (named) {
      addImport(
        named[2]!,
        named[1]!.split(",").map((name) => name.trim()),
      );
      continue;
    }
    const binding = /^export const (\w+) = /.exec(line);
    if (binding && replaced.has(binding[1]!)) continue;
    body.push(line);
  }
  for (const service of services) {
    for (const i of service.imports) addImport(i.from.replace(/^@app\//, scope), i.names);
  }

  const existingNames = body.flatMap((line) => /^export const (\w+)/.exec(line)?.[1] ?? []);
  const names = [...existingNames, ...services.map((service) => service.name)];

  const integrations = vfs
    .listDir(`${WEB}/src/integrations`)
    .filter((file) => file.endsWith(".ts"))
    .map((file) => file.replace(/\.ts$/, ""));

  const importLine = ([from, names]: [string, Set<string>]) =>
    `import { ${[...names].join(", ")} } from "${from}";`;
  const entries = [...imports].sort(([a], [b]) => a.localeCompare(b));

  const lines = [
    ...entries.filter(([from]) => !from.startsWith(".")).map(importLine),
    "",
    ...entries.filter(([from]) => from.startsWith(".")).map(importLine),
    ...integrations.map(
      (name) => `import ${camel(`register-${name}`)} from "./integrations/${name}";`,
    ),
    "",
    body.join("\n").trim(),
    "",
    ...services.map((service) => `export const ${service.name} = ${service.init};`),
    "",
    `export const services = { ${names.join(", ")} };`,
    "",
    "export type Services = typeof services;",
    "",
    ...integrations.map((name) => `${camel(`register-${name}`)}(services);`),
  ];
  vfs.writeFile(
    SEAM_FILES.services,
    `${lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd()}\n`,
  );
}
/** Lazily builds one integrated graph per service property access; never captures request bindings at import time. */
function wireCloudflareServices(
  vfs: VirtualFileSystem,
  config: ProjectConfig,
  services: ServiceSpec[],
) {
  const scope = `@${config.projectName}/`;
  const imports = new Map<string, Set<string>>();
  const contracts = new Map<string, { package: string; type: string }>(
    Object.entries({
      events: { package: "events", type: "EventBus" },
      auth: { package: "auth", type: "Auth" },
      mailer: { package: "email", type: "Mailer" },
      sms: { package: "sms", type: "Sms" },
      payment: { package: "payment", type: "Payment" },
      credits: { package: "credits", type: "Credits" },
      storage: { package: "storage", type: "Storage" },
      ai: { package: "ai", type: "AI" },
      affiliate: { package: "affiliate", type: "Affiliate" },
      seo: { package: "seo", type: "Seo" },
      blog: { package: "blog", type: "Blog" },
    }),
  );
  for (const service of services) {
    for (const entry of service.imports) {
      const from = entry.from.replace(/^@app\//, scope);
      const names = imports.get(from) ?? new Set<string>();
      for (const name of entry.names) names.add(name);
      imports.set(from, names);
    }
  }
  const integrations = vfs
    .listDir(`${WEB}/src/integrations`)
    .filter((file) => file.endsWith(".ts"))
    .map((file) => file.slice(0, -3));
  const names = ["db", ...services.map((service) => service.name)];
  vfs.writeFile(
    SEAM_FILES.services,
    [
      `import { createDb, type Database } from "${scope}db";`,
      'import { ENV } from "./env.server";',
      ...[...imports].map(
        ([from, values]) => `import { ${[...values].join(", ")} } from "${from}";`,
      ),
      ...services.map((service) => {
        const contract = contracts.get(service.name);
        if (!contract)
          throw new GeneratorError({
            message: `Cloudflare service ${service.name} needs an exported contract`,
            phase: "modules",
          });
        return `import type { ${contract.type} } from "${scope}${contract.package}";`;
      }),
      ...integrations.map(
        (name) => `import ${camel(`register-${name}`)} from "./integrations/${name}";`,
      ),
      "",
      "function createServices(): Services {",
      "  const db = new Proxy({} as Database, {",
      "    get(_target, key) {",
      "      const database = createDb(ENV);",
      "      const value: unknown = Reflect.get(database, key);",
      '      return typeof value === "function" ? value.bind(database) : value;',
      "    },",
      "  });",
      ...services.map((service) => `  const ${service.name} = ${service.init};`),
      `  const services = { ${names.join(", ")} };`,
      ...integrations.map((name) => `  ${camel(`register-${name}`)}(services);`),
      "  return services;",
      "}",
      "",
      "export interface Services {",
      "  db: Database;",
      ...services.map((service) => `  ${service.name}: ${contracts.get(service.name)!.type};`),
      "}",
      "",
      "function service<K extends keyof Services>(name: K): Services[K] {",
      "  return new Proxy({} as Services[K], {",
      "    get(_target, key) {",
      "      const instance = createServices()[name];",
      "      const value: unknown = Reflect.get(instance, key);",
      '      return typeof value === "function" ? value.bind(instance) : value;',
      "    },",
      "    has(_target, key) { return Reflect.has(createServices()[name], key); },",
      "  });",
      "}",
      ...names.map((name) => `export const ${name} = service("${name}");`),
      `export const services = { ${names.join(", ")} };`,
      "",
    ].join("\n"),
  );
}

/** Re-exports every schema file, including those modules added, from the db package. */
export function indexDbSchema(vfs: VirtualFileSystem) {
  stackFile(vfs, SEAM_FILES.dbSchemaIndex, "db schema");
  const dir = "packages/db/src/schema";
  const files = vfs
    .listDir(dir)
    .filter((file) => file.endsWith(".ts") && file !== "index.ts")
    .map((file) => file.replace(/\.ts$/, ""));
  vfs.writeFile(
    SEAM_FILES.dbSchemaIndex,
    `${files.map((file) => `export * from "./${file}";`).join("\n")}\nexport {};\n`,
  );
}
