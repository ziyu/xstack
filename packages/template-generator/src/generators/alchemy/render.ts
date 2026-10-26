import type { VirtualFileSystem } from "../../core/virtual-fs";
import { getModulePlan } from "../../modules/pipeline";
import type { RenderConfig } from "../../types";
import { writeDatabaseResources } from "./database";
import { writeObservabilityResources } from "./observability";
import { createAlchemyDeploymentPlan, type AlchemyDeploymentPlan } from "./plan";
import { writeServerResource } from "./server";
import { writeExportedWebResource, writeStackWebResource } from "./web";
import { createAlchemyWriter, writeObject, type AlchemyWriter } from "./writer";

function databaseProvidersUseCommand(plan: AlchemyDeploymentPlan): boolean {
  return (
    plan.managedDatabase.kind === "prisma-postgres" ||
    (plan.managedDatabase.kind !== "none" && plan.managedDatabase.orm === "prisma")
  );
}

function usesCommand(plan: AlchemyDeploymentPlan): boolean {
  return (
    databaseProvidersUseCommand(plan) ||
    plan.needsStandaloneServerDev ||
    plan.needsStandaloneWebDev ||
    plan.hasAxiomVercelRuntime
  );
}

function usesOutput(plan: AlchemyDeploymentPlan): boolean {
  const database = plan.managedDatabase;
  return (
    database.kind === "neon" ||
    database.kind === "prisma-postgres" ||
    (database.kind === "planetscale-mysql" && database.orm === "prisma")
  );
}

function usesRedacted(plan: AlchemyDeploymentPlan): boolean {
  const database = plan.managedDatabase;
  return (
    plan.web.target === "prisma" ||
    database.kind === "neon" ||
    (database.kind === "planetscale-mysql" && database.orm === "prisma")
  );
}

function providerLayers(plan: AlchemyDeploymentPlan): string[] {
  const layers: string[] = [];
  if (plan.hasCloudflare) layers.push("Cloudflare.providers()");
  if (plan.hasAlchemyManagedDatabase || plan.hasPrismaDeploy) layers.push("databaseProviders");
  if (plan.hasAxiom) layers.push("Axiom.providers()");
  if (
    (plan.needsStandaloneServerDev || plan.needsStandaloneWebDev || plan.hasAxiomVercelRuntime) &&
    !databaseProvidersUseCommand(plan)
  ) {
    layers.push("Command.providers()");
  }
  return layers;
}

function usesLayer(plan: AlchemyDeploymentPlan): boolean {
  return plan.hasAlchemyManagedDatabase || providerLayers(plan).length > 1;
}

function writeImports(writer: AlchemyWriter, plan: AlchemyDeploymentPlan): void {
  writer.writeLine('import * as Alchemy from "alchemy";');
  if (plan.hasAxiom) writer.writeLine('import * as Axiom from "alchemy/Axiom";');
  if (usesCommand(plan)) writer.writeLine('import * as Command from "alchemy/Command";');
  if (plan.managedDatabase.kind === "neon") {
    writer.writeLine('import * as Neon from "alchemy/Neon";');
  }
  if (
    plan.managedDatabase.kind === "planetscale-postgres" ||
    plan.managedDatabase.kind === "planetscale-mysql"
  ) {
    writer.writeLine('import * as Planetscale from "alchemy/Planetscale";');
  }
  if (plan.hasPrismaDeploy || plan.managedDatabase.kind === "prisma-postgres") {
    writer.writeLine('import * as Prisma from "alchemy/Prisma";');
  }
  if (usesOutput(plan)) writer.writeLine('import * as Output from "alchemy/Output";');
  if (plan.hasCloudflare) writer.writeLine('import * as Cloudflare from "alchemy/Cloudflare";');
  writer.writeLine('import * as Config from "effect/Config";');
  writer.writeLine('import * as Effect from "effect/Effect";');
  if (usesLayer(plan)) writer.writeLine('import * as Layer from "effect/Layer";');
  if (usesRedacted(plan)) writer.writeLine('import * as Redacted from "effect/Redacted";');
  writer.writeLine('import "varlock/auto-load";');
}

function writeStackOptions(writer: AlchemyWriter, plan: AlchemyDeploymentPlan): void {
  const layers = providerLayers(plan);
  writeObject(
    writer,
    "{",
    () => {
      if (layers.length === 1) {
        writer.writeLine(`providers: ${layers[0]},`);
      } else {
        writer.writeLine(`providers: Layer.mergeAll(${layers.join(", ")}),`);
      }
      writer.writeLine(
        plan.hasCloudflare ? "state: Cloudflare.state()," : "state: Alchemy.localState(),",
      );
    },
    "},",
  );
}

function writeStandaloneDevResources(writer: AlchemyWriter, plan: AlchemyDeploymentPlan): void {
  if (!plan.needsStandaloneServerDev && !plan.needsStandaloneWebDev) return;

  if (plan.needsStandaloneServerDev) {
    writeObject(
      writer,
      `const serverDev = yield* Command.Dev(${JSON.stringify(`${plan.config.application?.id ?? "server"}-dev`)}, {`,
      () => {
        writer.writeLine(`command: "${plan.config.packageManager} run dev:bare",`);
        writer.writeLine(`cwd: "../../${plan.serverRoot}",`);
        writer.writeLine("env: observabilityResources.runtimeEnv,");
      },
      "});",
    );
  }
  if (plan.needsStandaloneWebDev) {
    writeObject(
      writer,
      `const webDev = yield* Command.Dev(${JSON.stringify(`${plan.resourceId}-dev`)}, {`,
      () => {
        writer.writeLine(`command: "${plan.config.packageManager} run dev:bare",`);
        writer.writeLine(`cwd: "../../${plan.webRoot}",`);
        writer.writeLine("env: observabilityResources.runtimeEnv,");
      },
      "});",
    );
  }
}

function writeVercelEnvSync(writer: AlchemyWriter, plan: AlchemyDeploymentPlan): void {
  if (!plan.hasAxiomVercelRuntime) return;

  writer.writeLine("const isDev = yield* Alchemy.ALCHEMY_DEV;");
  writer.writeLine("const { stage } = yield* Alchemy.Stack;");
  writer.writeLine('if (!isDev && (stage === "preview" || stage === "production")) {');
  writer.indent(() => {
    writeObject(
      writer,
      `yield* Command.Exec(${JSON.stringify(`axiom-vercel-env${plan.config.application ? `-${plan.config.application.id}` : ""}`)}, {`,
      () => {
        writer.writeLine(
          `command: \`${plan.config.packageManager} run env:${plan.config.application ? `${plan.config.application.id}:` : ""}\${stage}\`,`,
        );
        writer.writeLine('cwd: "../..",');
        writer.writeLine("env: observabilityResources.runtimeEnv,");
        writer.writeLine('memo: { include: ["scripts/sync-vercel-env.ts", "vercel.json"] },');
      },
      "});",
    );
  });
  writer.writeLine("}");
}

function writeStack(writer: AlchemyWriter, plan: AlchemyDeploymentPlan): void {
  writer.writeLine("export default Alchemy.Stack(");
  writer.indent(() => {
    writer.writeLine(`${JSON.stringify(plan.config.projectName)},`);
    writeStackOptions(writer, plan);
    writer.writeLine("Effect.gen(function* () {");
    writer.indent(() => {
      if (plan.hasAxiom) {
        writer.writeLine("const observabilityResources = yield* observability;");
      }
      if (plan.server.target !== "none") {
        writer.writeLine("const serverWorker = yield* server;");
      }
      writeStackWebResource(writer, plan);
      writeStandaloneDevResources(writer, plan);
      writeVercelEnvSync(writer, plan);
      writer.blankLine();
      writeObject(
        writer,
        "return {",
        () => {
          if (plan.web.target !== "none") writer.writeLine("web: webWorker.url,");
          else if (plan.needsStandaloneWebDev) writer.writeLine("web: webDev.url,");
          if (plan.server.target !== "none") writer.writeLine("server: serverWorker.url,");
          else if (plan.needsStandaloneServerDev) writer.writeLine("server: serverDev.url,");
          if (plan.hasAxiom) writer.writeLine("axiomDataset: observabilityResources.dataset.name,");
        },
        "};",
      );
    });
    writer.writeLine("}),");
  });
  writer.writeLine(");");
}

export function generateAlchemyRun(config: RenderConfig): string {
  const plan = createAlchemyDeploymentPlan(config);
  const writer = createAlchemyWriter();

  writeImports(writer, plan);
  writer.blankLine();
  if (getModulePlan(config).modules.some((module) => module.variant === "native")) {
    writer.writeLine('import * as Redacted from "effect/Redacted";');
  }
  writer.blankLine();
  writeDatabaseResources(writer, plan);
  if (plan.hasAlchemyManagedDatabase || plan.hasPrismaDeploy || plan.hasD1Resource) {
    writer.blankLine();
  }
  writeObservabilityResources(writer, plan);
  if (plan.hasAxiom) writer.blankLine();
  writeServerResource(writer, plan);
  if (plan.server.target !== "none") writer.blankLine();
  writeExportedWebResource(writer, plan);
  if (plan.web.target !== "none") writer.blankLine();
  writeStack(writer, plan);

  const source = writer.toString();
  return source.includes("Config.")
    ? source
    : source.replace('import * as Config from "effect/Config";\n', "");
}

export function processAlchemyRun(vfs: VirtualFileSystem, config: RenderConfig): void {
  vfs.writeFile("packages/infra/alchemy.run.ts", generateAlchemyRun(config));
}

/** One stack owns infrastructure; application resources retain their own roots and bindings. */
export function generateWorkspaceAlchemyRun(configs: RenderConfig[]): string {
  const plans = configs.map(createAlchemyDeploymentPlan);
  const owners = plans.filter((plan) => plan.config.application?.roles.includes("backend"));
  if (owners.length > 1) throw new Error("Infrastructure requires one backend owner");
  const owner = owners[0];
  const base = owner ?? plans[0];
  if (!base) throw new Error("Infrastructure requires an application");
  const shared: AlchemyDeploymentPlan = {
    ...base,
    hasCloudflare: plans.some((plan) => plan.hasCloudflare),
    hasPrismaDeploy: plans.some((plan) => plan.hasPrismaDeploy),
    hasAxiom: plans.some((plan) => plan.hasAxiom),
    hasAxiomVercelRuntime: plans.some((plan) => plan.hasAxiomVercelRuntime),
    needsStandaloneServerDev: plans.some((plan) => plan.needsStandaloneServerDev),
    needsStandaloneWebDev: plans.some((plan) => plan.needsStandaloneWebDev),
  };
  const writer = createAlchemyWriter();
  const imports = createAlchemyWriter();
  for (const plan of [...plans, shared]) writeImports(imports, plan);
  for (const line of new Set(imports.toString().trim().split("\n"))) writer.writeLine(line);
  if (!imports.toString().includes("import * as Redacted"))
    writer.writeLine('import * as Redacted from "effect/Redacted";');
  writer.blankLine();
  writeDatabaseResources(writer, shared);
  writeObservabilityResources(writer, shared);
  writer.blankLine();
  const ordered = owner ? [owner, ...plans.filter((plan) => plan !== owner)] : plans;
  const backendResource =
    owner?.server.target !== "none" && owner?.server.target
      ? "backendResources.server"
      : owner?.web.target !== "none" && owner?.web.target
        ? "backendResources.web"
        : undefined;
  const resources: { name: string; id: string; key: string }[] = [];
  for (const [index, original] of ordered.entries()) {
    if (
      original.web.target === "none" &&
      original.server.target === "none" &&
      !original.needsStandaloneServerDev &&
      !original.needsStandaloneWebDev
    )
      continue;
    const name = original === owner ? "backendResources" : `application${index}`;
    const plan = { ...original };
    const bound =
      original !== owner &&
      original.config.application?.backendRoot === owner?.config.application?.directory &&
      backendResource;
    if (bound && owner)
      plan.server =
        owner.server.target !== "none"
          ? owner.server
          : { target: owner.web.target as "cloudflare" | "prisma" };
    writer.writeLine(`const ${name} = (() => {`);
    writer.indent(() => {
      if (bound) writer.writeLine(`const server = ${backendResource};`);
      if (original === owner) writeServerResource(writer, original);
      writeExportedWebResource(writer, plan);
      writer.writeLine("const application = Effect.gen(function* () {");
      writer.indent(() => {
        if (plan.server.target !== "none" && (bound || original === owner))
          writer.writeLine("const serverWorker = yield* server;");
        writeStackWebResource(writer, plan);
        if (plan.hasAxiom) writer.writeLine("const observabilityResources = yield* observability;");
        writeStandaloneDevResources(writer, original);
        writer.writeLine("return {");
        writer.indent(() => {
          if (original.web.target !== "none") writer.writeLine("url: webWorker.url,");
          else if (original.server.target !== "none") writer.writeLine("url: serverWorker.url,");
          else if (original.needsStandaloneWebDev) writer.writeLine("url: webDev.url,");
          else if (original.needsStandaloneServerDev) writer.writeLine("url: serverDev.url,");
        });
        writer.writeLine("};");
      });
      writer.writeLine("});");
      const keys = ["application"];
      if (original === owner && original.server.target !== "none") keys.push("server");
      if (original.web.target !== "none") keys.push("web");
      writer.writeLine(`return { ${keys.join(", ")} };`);
    });
    writer.writeLine("})();");
    if (original.web.target === "cloudflare")
      writer.writeLine(
        `export type AppEnv_${Array.from(original.config.application!.id, (character) => character.charCodeAt(0).toString(16)).join("_")} = Cloudflare.InferEnv<typeof ${name}.web>;`,
      );
    resources.push({ name, id: original.config.application!.id, key: "application" });
  }
  if (owner?.server.target === "cloudflare")
    writer.writeLine(
      "export type ServerEnv = Cloudflare.InferEnv<typeof backendResources.server>;",
    );
  if (owner?.web.target === "cloudflare")
    writer.writeLine("export type WebEnv = Cloudflare.InferEnv<typeof backendResources.web>;");
  writer.writeLine("export default Alchemy.Stack(");
  writer.indent(() => {
    writer.writeLine(`${JSON.stringify(base.config.projectName)},`);
    writeStackOptions(writer, shared);
    writer.writeLine("Effect.gen(function* () {");
    writer.indent(() => {
      if (shared.hasAxiom) writer.writeLine("const observabilityResources = yield* observability;");
      for (const plan of plans.filter((candidate) => candidate.hasAxiomVercelRuntime)) {
        writer.writeLine("{");
        writer.indent(() => writeVercelEnvSync(writer, plan));
        writer.writeLine("}");
      }
      writer.writeLine("return {");
      writer.indent(() => {
        for (const resource of resources)
          writer.writeLine(
            `${JSON.stringify(resource.id)}: (yield* ${resource.name}.${resource.key}).url,`,
          );
      });
      writer.writeLine("};");
    });
    writer.writeLine("}),");
  });
  writer.writeLine(");");
  // Resource declarations are enclosed to keep their implementation-local names isolated.
  return writer.toString().replace(/^  export /gm, "  ");
}
