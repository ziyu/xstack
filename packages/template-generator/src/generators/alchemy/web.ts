import {
  prismaWebEnvEntries,
  selfCloudflareWebEnvEntries,
  splitCloudflareWebEnvEntries,
} from "./env";
import {
  getPrismaWebsiteFramework,
  assertNever,
  type AlchemyDeploymentPlan,
  type DeployedWebFramework,
} from "./plan";
import { writeLines, writeObject, type AlchemyWriter } from "./writer";

function writeEnv(writer: AlchemyWriter, entries: readonly string[]): void {
  writeObject(writer, "env: {", () => writeLines(writer, entries), "},");
}

function writeStaticSite(
  writer: AlchemyWriter,
  plan: AlchemyDeploymentPlan,
  framework: "next" | "svelte",
  declaration: string,
  entries: readonly string[],
): void {
  if (framework === "svelte") {
    writer.writeLine(
      "// _worker.js is a shim importing outside its directory, so it must be bundled",
    );
  }
  writeObject(
    writer,
    `${declaration} Cloudflare.Website.StaticSite(${JSON.stringify(plan.resourceId)}, {`,
    () => {
      writer.writeLine(`cwd: "../../${plan.webRoot}",`);
      writer.writeLine(
        `command: "${plan.config.packageManager} run ${framework === "next" ? "build:cloudflare" : "build"}",`,
      );
      writer.writeLine(
        "// Rebuild shared workspace dependencies until Alchemy has a workspace-aware default memo.",
      );
      writer.writeLine("memo: false,");
      if (framework === "next") {
        writer.writeLine('outdir: ".open-next/assets",');
        writer.writeLine(`main: "../../${plan.webRoot}/.open-next/worker.js",`);
        writer.writeLine("bundle: true,");
        writeObject(
          writer,
          "compatibility: {",
          () => {
            writer.writeLine('flags: ["nodejs_compat", "global_fetch_strictly_public"],');
          },
          "},",
        );
      } else {
        writer.writeLine('outdir: ".svelte-kit/cloudflare",');
        writer.writeLine(`main: "../../${plan.webRoot}/.svelte-kit/cloudflare/_worker.js",`);
        writeObject(
          writer,
          "compatibility: {",
          () => {
            writer.writeLine('flags: ["nodejs_compat"],');
          },
          "},",
        );
      }
      writeEnv(writer, entries);
      writeObject(
        writer,
        "dev: {",
        () => {
          writer.writeLine(`command: "${plan.config.packageManager} run dev:bare",`);
          writer.writeLine(`url: "http://localhost:${plan.webPort}",`);
        },
        "},",
      );
    },
    "});",
  );
}

function writeNuxt(
  writer: AlchemyWriter,
  plan: AlchemyDeploymentPlan,
  declaration: string,
  entries: readonly string[],
): void {
  writeObject(
    writer,
    `${declaration} Cloudflare.Website.Nuxt(${JSON.stringify(plan.resourceId)}, {`,
    () => {
      writer.writeLine(`rootDir: "../../${plan.webRoot}",`);
      writeEnv(writer, entries);
      writeObject(writer, "dev: {", () => writer.writeLine(`port: ${plan.webPort},`), "},");
    },
    "});",
  );
}

function writeAstro(
  writer: AlchemyWriter,
  plan: AlchemyDeploymentPlan,
  declaration: string,
  entries: readonly string[],
): void {
  writeObject(
    writer,
    `${declaration} Cloudflare.Website.Astro(${JSON.stringify(plan.resourceId)}, {`,
    () => {
      writer.writeLine(`rootDir: "../../${plan.webRoot}",`);
      writeEnv(writer, entries);
      writeObject(writer, "dev: {", () => writer.writeLine(`port: ${plan.webPort},`), "},");
    },
    "});",
  );
}

function writeVite(
  writer: AlchemyWriter,
  plan: AlchemyDeploymentPlan,
  declaration: string,
  framework: "tanstack-router" | "react-router" | "tanstack-start" | "solid",
  entries: readonly string[],
): void {
  writeObject(
    writer,
    `${declaration} Cloudflare.Website.Vite(${JSON.stringify(plan.resourceId)}, {`,
    () => {
      writer.writeLine(`rootDir: "../../${plan.webRoot}",`);
      if (framework !== "tanstack-router") {
        writeObject(
          writer,
          "compatibility: {",
          () => {
            writer.writeLine('flags: ["nodejs_compat"],');
          },
          "},",
        );
      }
      if (framework === "tanstack-router") {
        writeObject(
          writer,
          "assets: {",
          () => {
            writer.writeLine('htmlHandling: "auto-trailing-slash",');
            writer.writeLine('notFoundHandling: "single-page-application",');
          },
          "},",
        );
      }
      writeEnv(writer, entries);
      writeObject(writer, "dev: {", () => writer.writeLine(`port: ${plan.webPort},`), "},");
    },
    "});",
  );
}

function writeCloudflareWeb(
  writer: AlchemyWriter,
  plan: AlchemyDeploymentPlan,
  framework: DeployedWebFramework,
  topology: "self" | "split",
): void {
  const declaration = topology === "self" ? "export const web =" : "const webWorker = yield*";
  const entries =
    topology === "self"
      ? selfCloudflareWebEnvEntries(plan, framework)
      : splitCloudflareWebEnvEntries(plan, framework);

  switch (framework) {
    case "next":
    case "svelte":
      writeStaticSite(writer, plan, framework, declaration, entries);
      break;
    case "nuxt":
      writeNuxt(writer, plan, declaration, entries);
      break;
    case "astro":
      writeAstro(writer, plan, declaration, entries);
      break;
    case "tanstack-router":
    case "react-router":
    case "tanstack-start":
    case "solid":
      writeVite(writer, plan, declaration, framework, entries);
      break;
    default:
      assertNever(framework);
  }
}

function prismaFramework(framework: DeployedWebFramework): string | undefined {
  switch (framework) {
    case "next":
      return "nextjs";
    case "nuxt":
      return "nuxt";
    case "astro":
      return "astro";
    case "tanstack-start":
      return "tanstack-start";
    case "tanstack-router":
      return "vite";
    case "react-router":
    case "svelte":
    case "solid":
      return undefined;
    default:
      return assertNever(framework);
  }
}

interface PrismaCustomBuild {
  script: "build";
  outdir: ".output" | "build";
  entrypoint: "server/index.mjs" | "server/index.js" | "index.js";
}

function prismaCustomBuild(framework: DeployedWebFramework): PrismaCustomBuild {
  switch (framework) {
    case "solid":
      return {
        script: "build",
        outdir: ".output",
        entrypoint: "server/index.mjs",
      };
    case "react-router":
      return {
        script: "build",
        outdir: "build",
        entrypoint: "server/index.js",
      };
    case "svelte":
      return {
        script: "build",
        outdir: "build",
        entrypoint: "index.js",
      };
    case "tanstack-router":
    case "next":
    case "nuxt":
    case "astro":
    case "tanstack-start":
      throw new Error(`${framework} uses Prisma Compute's automatic framework build`);
    default:
      return assertNever(framework);
  }
}

function writePrismaWeb(writer: AlchemyWriter, plan: AlchemyDeploymentPlan): void {
  if (plan.web.target !== "prisma") return;
  const { framework, topology } = plan.web;
  const websiteFramework = getPrismaWebsiteFramework(plan.config);

  writer.writeLine(
    websiteFramework
      ? "export const web = Effect.gen(function* () {"
      : `export const web = Prisma.Compute(${JSON.stringify(plan.resourceId)}, Effect.gen(function* () {`,
  );
  writer.indent(() => {
    writer.writeLine(
      websiteFramework ? "const project = prismaProject;" : "const project = yield* prismaProject;",
    );
    if (topology === "self") {
      writer.writeLine("const resolvedDatabaseEnv = yield* databaseEnv;");
    } else if (plan.server.target !== "none") {
      writer.writeLine("const deployedServer = yield* server;");
    }
    if (plan.hasAxiomWebRuntime) {
      writer.writeLine("const resolvedObservabilityEnv = yield* observabilityEnv;");
    }
    writer.blankLine();
    writeObject(
      writer,
      "const webEnv = {",
      () => {
        writeLines(writer, prismaWebEnvEntries(plan, framework));
      },
      "};",
    );

    writer.blankLine();
    if (websiteFramework) {
      writer.writeLine(
        `return yield* Prisma.Website.${websiteFramework}(${JSON.stringify(plan.resourceId)}, {`,
      );
      writer.indent(() => {
        writer.writeLine("project,");
        writer.writeLine(`rootDir: "../../${plan.webRoot}",`);
        writer.writeLine("env: webEnv,");
        writer.writeLine('compute: { healthCheck: { path: "/" }, destroyOldDeployment: true },');
        writer.writeLine(`dev: { port: ${plan.webPort} },`);
      });
      writer.writeLine("});");
    } else {
      writer.writeLine("return {");
      writer.indent(() => {
        writer.writeLine("project,");
        writer.writeLine(`path: "../../${plan.webRoot}",`);
        const frameworkName = prismaFramework(framework);
        if (frameworkName) {
          writer.writeLine(`build: { type: "auto", framework: "${frameworkName}", env: webEnv },`);
        } else {
          const customBuild = prismaCustomBuild(framework);
          writeObject(
            writer,
            "build: {",
            () => {
              writer.writeLine(
                `command: "${plan.config.packageManager} run ${customBuild.script}",`,
              );
              writer.writeLine(`outdir: "${customBuild.outdir}",`);
              writer.writeLine(`entrypoint: "${customBuild.entrypoint}",`);
              writer.writeLine("env: webEnv,");
            },
            "},",
          );
          writer.writeLine("port: 3000,");
        }
        writer.writeLine("env: webEnv,");
        writer.writeLine('healthCheck: { path: "/" },');
        writer.writeLine("destroyOldDeployment: true,");
        writeObject(
          writer,
          "dev: {",
          () => {
            writer.writeLine(`command: "${plan.config.packageManager} run dev:bare",`);
            writer.writeLine(`port: ${plan.webPort},`);
            writer.writeLine("env: webEnv,");
          },
          "},",
        );
      });
      writer.writeLine("};");
    }
  });
  writer.writeLine(websiteFramework ? "});" : "}));");
}

export function writeExportedWebResource(writer: AlchemyWriter, plan: AlchemyDeploymentPlan): void {
  if (plan.web.target === "prisma") {
    writePrismaWeb(writer, plan);
    return;
  }
  if (plan.web.target === "cloudflare") {
    const framework = plan.web.framework;
    if (plan.web.topology === "self") {
      writeCloudflareWeb(writer, plan, plan.web.framework, "self");
    } else {
      writer.writeLine("export const web = Effect.gen(function* () {");
      writer.indent(() => {
        if (plan.server.target !== "none") writer.writeLine("const serverWorker = yield* server;");
        writeCloudflareWeb(writer, plan, framework, "split");
        writer.writeLine("return webWorker;");
      });
      writer.writeLine("});");
    }
    writer.blankLine();
    writer.writeLine("export type WebEnv = Cloudflare.InferEnv<typeof web>;");
  }
}

export function writeStackWebResource(writer: AlchemyWriter, plan: AlchemyDeploymentPlan): void {
  if (plan.web.target === "none") return;
  writer.writeLine("const webWorker = yield* web;");
}
