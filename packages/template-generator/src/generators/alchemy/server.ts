import { cloudflareServerEnvEntries, prismaServerEnvEntries } from "./env";
import type { AlchemyDeploymentPlan } from "./plan";
import { writeLines, writeObject, type AlchemyWriter } from "./writer";

function writeCloudflareServer(writer: AlchemyWriter, plan: AlchemyDeploymentPlan): void {
  writeObject(
    writer,
    `export const server = Cloudflare.Worker(${JSON.stringify(plan.config.application?.id ?? "server")}, {`,
    () => {
      writer.writeLine(`main: "../../${plan.serverRoot}/src/index.ts",`);
      writeObject(
        writer,
        "compatibility: {",
        () => {
          writer.writeLine('flags: ["nodejs_compat"],');
        },
        "},",
      );
      writeObject(
        writer,
        "env: {",
        () => {
          writeLines(writer, cloudflareServerEnvEntries(plan));
        },
        "},",
      );
      writeObject(
        writer,
        "dev: {",
        () => {
          writer.writeLine(`port: ${plan.serverPort},`);
        },
        "},",
      );
    },
    "});",
  );
  writer.blankLine();
  writer.writeLine("export type ServerEnv = Cloudflare.InferEnv<typeof server>;");
}

function writePrismaServer(writer: AlchemyWriter, plan: AlchemyDeploymentPlan): void {
  writer.writeLine(
    `export const server = Prisma.Compute(${JSON.stringify(plan.config.application?.id ?? "server")}, Effect.gen(function* () {`,
  );
  writer.indent(() => {
    writer.writeLine("const project = yield* prismaProject;");
    writer.writeLine("const resolvedDatabaseEnv = yield* databaseEnv;");
    if (plan.hasAxiomServerRuntime) {
      writer.writeLine("const resolvedObservabilityEnv = yield* observabilityEnv;");
    }
    writer.blankLine();
    writer.writeLine("return {");
    writer.indent(() => {
      writer.writeLine("project,");
      writer.writeLine(`path: "../../${plan.serverRoot}",`);
      writeObject(
        writer,
        "build: {",
        () => {
          writer.writeLine('type: "auto",');
          writer.writeLine('framework: "bun",');
        },
        "},",
      );
      writer.writeLine('entrypoint: "src/index.ts",');
      writer.writeLine(`port: ${plan.serverPort},`);
      writeObject(
        writer,
        "env: {",
        () => {
          writeLines(writer, prismaServerEnvEntries(plan));
        },
        "},",
      );
      writer.writeLine('healthCheck: { path: "/" },');
      writer.writeLine("destroyOldDeployment: true,");
      writeObject(
        writer,
        "dev: {",
        () => {
          writer.writeLine(`command: "${plan.config.packageManager} run dev:bare",`);
          writer.writeLine(`port: ${plan.serverPort},`);
        },
        "},",
      );
    });
    writer.writeLine("};");
  });
  writer.writeLine("}));");
}

export function writeServerResource(writer: AlchemyWriter, plan: AlchemyDeploymentPlan): void {
  if (plan.server.target === "none") return;
  if (plan.server.target === "cloudflare") writeCloudflareServer(writer, plan);
  else writePrismaServer(writer, plan);
}
