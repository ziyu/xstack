import type { ProjectConfig } from "@xstack/types";

function normalizeMultiValues(values: string[] | undefined): string[] {
  if (!values || values.length === 0) return [];
  const filtered = values.filter((value) => value !== "none");
  return Array.from(new Set(filtered));
}

function formatMultiFlag(flag: string, values: string[]): string {
  if (values.length === 0) {
    return `${flag} none`;
  }
  return `${flag} ${values.join(" ")}`;
}

function getBaseCommand(packageManager: ProjectConfig["packageManager"]): string {
  if (packageManager === "bun") {
    return "bun create xstack@latest";
  }

  if (packageManager === "pnpm") {
    return "pnpm create xstack@latest";
  }

  return "npx xstack@latest";
}

function productFlags(product: NonNullable<ProjectConfig["product"]>): string[] {
  const flags = [formatMultiFlag("--features", normalizeMultiValues(product.features))];
  const providers = Object.entries(product.providers ?? {}).flatMap(([feature, ids]) =>
    ids.length ? ids.map((id) => `${feature}:${id}`) : [`${feature}:none`],
  );
  if (providers.length) flags.push(`--providers ${providers.join(" ")}`);
  const options = Object.entries(product.options ?? {}).flatMap(([module, values]) =>
    Object.entries(values).map(([key, value]) => `${module}.${key}=${value}`),
  );
  if (options.length) flags.push(`--module-options ${options.join(" ")}`);
  return flags;
}

export function generateReproducibleCommand(config: ProjectConfig): string {
  const baseCommand = getBaseCommand(config.packageManager);

  const flags: string[] = [];
  const frontend = normalizeMultiValues(config.frontend);
  const addons = normalizeMultiValues(config.addons);

  flags.push(formatMultiFlag("--frontend", frontend));

  flags.push(`--backend ${config.backend}`);
  flags.push(`--runtime ${config.runtime}`);
  flags.push(`--database ${config.database}`);
  flags.push(`--orm ${config.orm}`);
  flags.push(`--api ${config.api}`);

  flags.push(formatMultiFlag("--addons", addons));

  flags.push(`--db-setup ${config.dbSetup}`);
  if (config.dbSetupOptions?.mode === "manual") {
    flags.push("--manual-db");
  } else if (config.dbSetupOptions?.mode === "auto") {
    flags.push(`--db-setup-options '${JSON.stringify({ mode: "auto" })}'`);
  }
  flags.push(`--web-deploy ${config.webDeploy}`);
  flags.push(`--server-deploy ${config.serverDeploy}`);
  flags.push(config.git ? "--git" : "--no-git");
  flags.push(`--package-manager ${config.packageManager}`);
  flags.push(config.install ? "--install" : "--no-install");

  flags.push(...productFlags(config.product ?? { features: [] }));

  const projectPathArg = config.relativePath ? ` ${config.relativePath}` : "";

  return `${baseCommand}${projectPathArg} ${flags.join(" ")}`;
}
