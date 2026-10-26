import type { ProjectConfig } from "@xstack/types";
import { parse, stringify } from "yaml";

import { appOutputPath } from "../contributions/context";
import { processTemplateString } from "../core/template-processor";
import type { VirtualFileSystem } from "../core/virtual-fs";
import { generateWorkspaceAlchemyRun } from "../generators/alchemy/render";
import { processAlchemyRun } from "../generators/alchemy/render";
import { processWorkspaceVercelConfig } from "../post-process/vercel-config";
import { processDeployDeps } from "../processors/deploy-deps";
import { processInfraDeps } from "../processors/infra-deps";
import { processAlchemySchema } from "../processors/varlock";
import type { RenderConfig } from "../types";
import { addPackageDependency } from "../utils/add-deps";
import { isDatabaseConsumedByDocker } from "../utils/docker-database";
import { type TemplateData, processTemplatesFromPrefix } from "./utils";

function hasOwnKey<T extends object>(object: T, key: PropertyKey): key is keyof T {
  return Object.hasOwn(object, key);
}

export async function processDeployTemplates(
  vfs: VirtualFileSystem,
  templates: TemplateData,
  config: RenderConfig,
): Promise<void> {
  const isBackendSelf = config.backend === "self";

  if (
    !config.application &&
    (["cloudflare", "prisma"].includes(config.webDeploy) ||
      ["cloudflare", "prisma"].includes(config.serverDeploy) ||
      config.addons.includes("axiom"))
  ) {
    processTemplatesFromPrefix(vfs, templates, "packages/infra", "packages/infra", config);
    processAlchemyRun(vfs, config);
  }

  if (!config.application && (config.webDeploy === "docker" || config.serverDeploy === "docker")) {
    processTemplatesFromPrefix(vfs, templates, "deploy/docker/compose", "", config);
    if (
      config.database === "sqlite" &&
      config.dbSetup === "none" &&
      isDatabaseConsumedByDocker(config)
    ) {
      vfs.writeFile(".data/.gitignore", "*\n!.gitignore\n");
    }
  }

  if (!config.application && (config.webDeploy === "vercel" || config.serverDeploy === "vercel")) {
    processTemplatesFromPrefix(vfs, templates, "deploy/vercel", "", config);
  }

  if (config.webDeploy === "prisma") {
    const templateMap = {
      "react-router": "react/react-router",
    } satisfies Partial<Record<ProjectConfig["frontend"][number], string>>;

    for (const frontend of config.frontend) {
      if (hasOwnKey(templateMap, frontend)) {
        const templatePath = templateMap[frontend];
        processTemplatesFromPrefix(
          vfs,
          templates,
          `deploy/prisma/web/${templatePath}`,
          appOutputPath(config, "web"),
          config,
        );
      }
    }
  }

  if (
    config.webDeploy !== "none" &&
    config.webDeploy !== "cloudflare" &&
    config.webDeploy !== "prisma" &&
    config.webDeploy !== "vercel"
  ) {
    const templateMap = {
      "tanstack-router": "react/tanstack-router",
      "tanstack-start": "react/tanstack-start",
      "react-router": "react/react-router",
      solid: "solid",
      next: "react/next",
      nuxt: "nuxt",
      svelte: "svelte",
      astro: "astro",
    } satisfies Record<string, string>;

    for (const f of config.frontend) {
      if (hasOwnKey(templateMap, f)) {
        processTemplatesFromPrefix(
          vfs,
          templates,
          `deploy/${config.webDeploy}/web/${templateMap[f]}`,
          appOutputPath(config, "web"),
          config,
        );
      }
    }
  }

  if (
    config.serverDeploy !== "none" &&
    config.serverDeploy !== "cloudflare" &&
    config.serverDeploy !== "prisma" &&
    config.serverDeploy !== "vercel" &&
    !isBackendSelf
  ) {
    processTemplatesFromPrefix(
      vfs,
      templates,
      `deploy/${config.serverDeploy}/server`,
      appOutputPath(config, "server"),
      config,
    );
  }
}

type ComposeService = {
  build?: {
    dockerfile?: string;
    args?: Record<string, string>;
    secrets?: (string | { source: string; target: string })[];
  };
  ports?: string[];
  env_file?: { path: string; required: boolean }[];
  environment?: Record<string, string>;
  depends_on?: Record<string, { condition: string }>;
};
type ComposeConfig = {
  name: string;
  services: Record<string, ComposeService>;
  secrets?: Record<string, { file: string }>;
  volumes?: Record<string, null>;
};

/** Aggregate once after all applications and their shared packages have been emitted. */
export function processWorkspaceDeployTemplates(
  vfs: VirtualFileSystem,
  templates: TemplateData,
  entries: { config: RenderConfig }[],
): void {
  const selected = entries.map((entry) => entry.config).filter((config) => config.application);
  const infra = selected.filter(
    (config) =>
      [config.webDeploy, config.serverDeploy].some(
        (target) => target === "cloudflare" || target === "prisma",
      ) || config.addons.includes("axiom"),
  );
  if (infra.length) {
    const owner =
      selected.find((config) => config.application!.roles.includes("backend")) ?? infra[0]!;
    processTemplatesFromPrefix(vfs, templates, "packages/infra", "packages/infra", owner);
    for (const config of infra) {
      processInfraDeps(vfs, config);
      addPackageDependency({
        vfs,
        packagePath: `${config.application!.directory}/package.json`,
        customDevDependencies: {
          [`@${config.projectName}/infra`]: config.packageManager === "npm" ? "*" : "workspace:*",
        },
      });
    }
    vfs.writeFile(
      "packages/infra/alchemy.run.ts",
      generateWorkspaceAlchemyRun(
        selected.filter((config) => infra.includes(config) || config === owner),
      ),
    );
    processAlchemySchema(vfs);
  }
  for (const config of selected) processDeployDeps(vfs, config);
  const docker = selected.filter(
    (config) => config.webDeploy === "docker" || config.serverDeploy === "docker",
  );
  if (docker.length) {
    const source = templates.get("deploy/docker/compose/docker-compose.yml.hbs");
    if (!source) throw new Error("Docker Compose template contribution is missing");
    const compose: ComposeConfig = {
      name: docker[0]!.projectName,
      services: {},
      secrets: {},
      volumes: {},
    };
    for (const config of docker) {
      const app = config.application!;
      const web = config.webDeploy === "docker";
      const kind = web ? "web" : "server";
      const scoped = {
        ...config,
        serverDeploy: web ? ("none" as const) : config.serverDeploy,
        webDeploy: web ? config.webDeploy : ("none" as const),
      };
      const fragment = parse(processTemplateString(source, scoped)) as ComposeConfig;
      const service = fragment.services[kind];
      if (!service) throw new Error(`Docker service contribution for ${app.id} is missing`);
      service.build!.dockerfile = `${app.directory}/Dockerfile`;
      service.env_file = [{ path: `${app.directory}/.env`, required: false }];
      service.ports = [
        `${app.port}:${web ? (config.frontend.includes("tanstack-router") ? 80 : 3001) : 3000}`,
      ];
      const env = (service.environment ??= {});
      env.PORT = web ? "3001" : "3000";
      if (app.roles.includes("backend")) {
        env.CORS_ORIGIN = app.clientOrigins.join(",");
        if (config.auth === "better-auth") env.BETTER_AUTH_URL = app.origin!;
      }
      const backend = selected.find(
        (candidate) => candidate.application!.directory === app.backendRoot,
      );
      if (web && backend && backend !== config) {
        const publicKey = config.frontend.includes("next")
          ? "NEXT_PUBLIC_SERVER_URL"
          : config.frontend.includes("nuxt")
            ? "NUXT_PUBLIC_SERVER_URL"
            : config.frontend.some((framework) => framework === "svelte" || framework === "astro")
              ? "PUBLIC_SERVER_URL"
              : "VITE_SERVER_URL";
        (service.build!.args ??= {})[publicKey] = app.backendOrigin!;
        if (backend.webDeploy === "docker" || backend.serverDeploy === "docker") {
          env.SERVER_URL = `http://${backend.application!.id}:${backend.webDeploy === "docker" ? 3001 : 3000}`;
          if (config.frontend.includes("nuxt")) env.NUXT_SERVER_URL = env.SERVER_URL;
          service.depends_on = {
            ...service.depends_on,
            [backend.application!.id]: { condition: "service_healthy" },
          };
        }
      }
      service.build!.secrets = [];
      for (const [target, directory] of [
        ["web_env", web ? app.directory : undefined],
        ["server_env", app.backendRoot],
      ] as const) {
        if (!directory || !vfs.exists(`${directory}/.env`)) continue;
        const name = `${directory.split("/").pop()}_env`;
        compose.secrets![name] = { file: `${directory}/.env` };
        service.build!.secrets.push({ source: name, target });
      }
      compose.services[app.id] = service;
      for (const [id, sharedService] of Object.entries(fragment.services))
        if (id !== "web" && id !== "server") compose.services[id] = sharedService;
      Object.assign(compose.volumes!, fragment.volumes);
      if (
        config.database === "sqlite" &&
        config.dbSetup === "none" &&
        app.roles.includes("backend")
      )
        vfs.writeFile(".data/.gitignore", "*\n!.gitignore\n");
    }
    if (!Object.keys(compose.volumes!).length) delete compose.volumes;
    vfs.writeFile("docker-compose.yml", stringify(compose));
    const ignore = templates.get("deploy/docker/compose/_dockerignore");
    if (ignore !== undefined) vfs.writeFile(".dockerignore", ignore);
  }
  const vercel = selected.filter(
    (config) => config.webDeploy === "vercel" || config.serverDeploy === "vercel",
  );
  if (vercel.length) {
    processTemplatesFromPrefix(vfs, templates, "deploy/vercel", "", {
      ...vercel[0]!,
      deploymentApplications: vercel.map((config) => ({
        id: config.application!.id,
        directory: config.application!.directory,
      })),
    } as RenderConfig);
    processWorkspaceVercelConfig(vfs, vercel);
  }
  const pkg = vfs.readJson<{ scripts?: Record<string, string> }>("package.json");
  if (!pkg) throw new Error("Workspace package.json is missing");
  pkg.scripts ??= {};
  for (const key of [
    "deploy:setup",
    "deploy:check",
    "deploy:production",
    "env:preview",
    "env:production",
    "dev:vercel",
  ])
    delete pkg.scripts[key];
  for (const role of ["web", "server"])
    if (!selected.some((config) => config.application!.id === role))
      delete pkg.scripts[`deploy:${role}`];
  const desktop = selected.filter(
    (config) =>
      config.addons.includes("electrobun") && config.application!.roles.includes("web-frontend"),
  );
  if (desktop.length > 1) throw new Error("Electrobun requires one web-frontend target");
  if (desktop.length) {
    const target = desktop[0]!;
    processTemplatesFromPrefix(
      vfs,
      templates,
      "addons/electrobun/apps/desktop",
      "packages/desktop",
      target,
    );
    const desktopPkg = vfs.readJson<{ name: string; scripts: Record<string, string> }>(
      "packages/desktop/package.json",
    );
    if (!desktopPkg) throw new Error("Electrobun package contribution is missing");
    const build = `cd ../../${target.application!.directory} && ${target.packageManager} run build && cd ../../packages/desktop`;
    desktopPkg.name = `@${target.projectName}/desktop`;
    desktopPkg.scripts = {
      start: `${build} && electrobun dev`,
      "dev:hmr": `${build} && concurrently "${target.packageManager} run hmr" "electrobun dev --watch"`,
      hmr: `cd ../.. && ${target.packageManager} run dev:${target.application!.id}`,
      build: `${build} && electrobun build`,
      "build:stable": `${build} && electrobun build --env=stable`,
      "build:canary": `${build} && electrobun build --env=canary`,
      "check-types": "electrobun prepare && tsc --noEmit",
    };
    vfs.writeJson("packages/desktop/package.json", desktopPkg);
    pkg.scripts["dev:desktop"] = `cd packages/desktop && ${target.packageManager} run dev:hmr`;
    pkg.scripts["build:desktop"] = `cd packages/desktop && ${target.packageManager} run build`;
    const workspaceBuilds = vfs
      .getAllFiles()
      .filter((path) => path.endsWith("/package.json") && path !== "packages/desktop/package.json")
      .flatMap((path) => {
        const workspace = vfs.readJson<{ scripts?: Record<string, string> }>(path);
        return workspace?.scripts?.build
          ? [`(cd ${path.slice(0, -"/package.json".length)} && ${target.packageManager} run build)`]
          : [];
      });
    pkg.scripts.build = [
      ...workspaceBuilds,
      `(cd packages/desktop && ${target.packageManager} run build)`,
    ].join(" && ");
  }
  if (infra.length) {
    const pm = infra[0]!.packageManager;
    for (const command of ["deploy", "destroy"])
      pkg.scripts[command] = `cd packages/infra && ${pm} run ${command}`;
  }
  for (const config of docker)
    pkg.scripts[`deploy:${config.application!.id}`] =
      `docker compose up --build -d ${config.application!.id}`;
  if (docker.length) {
    pkg.scripts["docker:build"] = "docker compose build";
    pkg.scripts["docker:up"] = "docker compose up -d";
    pkg.scripts["docker:down"] = "docker compose down";
  }
  vfs.writeJson("package.json", pkg);
}
