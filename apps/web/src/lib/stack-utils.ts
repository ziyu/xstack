import { type StackState, TECH_OPTIONS } from "@/lib/constant";
import { SITE_URL } from "@/lib/site";
import { stackUrlKeys } from "@/lib/stack-url-keys";

import { productPlan } from "./stack-features";
import { getStackBackend, getStackFrontends, isSelfHostedFullstackBackend } from "./stack-model";

const CATEGORY_ORDER: Array<keyof typeof TECH_OPTIONS> = [
  "features",
  "webFrontend",
  "nativeFrontend",
  "backend",
  "runtime",
  "api",
  "database",
  "orm",
  "dbSetup",
  "webDeploy",
  "serverDeploy",
  "packageManager",
  "addons",
  "git",
  "install",
];

const desktopAddonNames = {
  tauri: "Tauri",
  electrobun: "Electrobun",
} as const;

const staticDesktopFrontendNames = {
  "tanstack-start": "TanStack Start",
  next: "Next.js",
  nuxt: "Nuxt",
  svelte: "SvelteKit",
  astro: "Astro",
} as const;

export function formatProjectName(name: string | null | undefined) {
  return (name || "my-xstack-app").replace(/\s+/g, "-");
}

function quoteShellArgument(value: string) {
  if (/^[a-zA-Z0-9_./-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export type SelectedTech = {
  category: keyof typeof TECH_OPTIONS;
  id: string;
  name: string;
  icon: string;
};

export function getSelectedTechs(stack: StackState): SelectedTech[] {
  const selected: SelectedTech[] = [];
  for (const category of CATEGORY_ORDER) {
    const options = TECH_OPTIONS[category];
    const value = stack[category];
    if (!options || value === undefined) continue;

    const ids = Array.isArray(value) ? value : [value];
    for (const id of ids) {
      if (
        id === "none" ||
        id === "false" ||
        (["git", "install"].includes(category) && id === "true")
      ) {
        continue;
      }
      const tech = options.find((opt) => opt.id === id);
      if (tech) {
        selected.push({ category, id: tech.id, name: tech.name, icon: tech.icon });
      }
    }
  }
  return selected;
}

export function generateStackSummary(stack: StackState) {
  const selectedTechs = CATEGORY_ORDER.flatMap((category) => {
    const options = TECH_OPTIONS[category];
    const selectedValue = stack[category];

    if (!options) return [];

    const getTechNames = (value: string | string[]) => {
      const values = Array.isArray(value) ? value : [value];
      return values
        .filter(
          (id) =>
            id !== "none" &&
            id !== "false" &&
            !(["git", "install"].includes(category) && id === "true"),
        )
        .map((id) => options.find((opt) => opt.id === id)?.name)
        .filter(Boolean) as string[];
    };

    return selectedValue ? getTechNames(selectedValue) : [];
  });

  return selectedTechs.length > 0 ? selectedTechs.join(" • ") : "Custom stack";
}

export function getDesktopBuildNote(stack: Pick<StackState, "addons" | "backend" | "webFrontend">) {
  const selectedDesktopAddons = stack.addons.filter(
    (addon): addon is keyof typeof desktopAddonNames => addon in desktopAddonNames,
  );

  if (selectedDesktopAddons.length === 0) {
    return null;
  }

  const staticFrontend = stack.webFrontend.find(
    (frontend): frontend is keyof typeof staticDesktopFrontendNames =>
      frontend in staticDesktopFrontendNames,
  );

  if (!staticFrontend) {
    return null;
  }

  const addonLabel =
    selectedDesktopAddons.length === 2
      ? "Tauri and Electrobun desktop builds"
      : `${desktopAddonNames[selectedDesktopAddons[0]]} desktop builds`;

  if (isSelfHostedFullstackBackend(stack.backend)) {
    return `${addonLabel} package static web assets and require a separate backend or no backend. Fullstack self backends emit server routes inside the web app, so they cannot be bundled for desktop packaging.`;
  }

  return `${addonLabel} package static web assets. ${staticDesktopFrontendNames[staticFrontend]} needs a static/export build configuration before desktop packaging will work.`;
}

export function generateStackCommand(stack: StackState) {
  const packageManagerCommands = {
    npm: "npx xstack@latest",
    pnpm: "pnpm create xstack@latest",
    default: "bun create xstack@latest",
  };

  const base =
    packageManagerCommands[stack.packageManager as keyof typeof packageManagerCommands] ||
    packageManagerCommands.default;
  const projectName = quoteShellArgument(stack.projectName || "my-xstack-app");
  const plan = productPlan(stack);
  const providers = {
    ...Object.fromEntries(
      plan.modules
        .filter((module) => module.manifest.providers)
        .map((module) => [module.manifest.id, module.providers]),
    ),
    ...stack.providers,
  };
  const moduleOptions = { ...stack.moduleOptions };
  for (const module of plan.modules) {
    moduleOptions[module.manifest.id] = {
      ...module.options,
      ...moduleOptions[module.manifest.id],
    };
  }

  const flags = [
    `--frontend ${getStackFrontends(stack).join(" ")}`,
    `--backend ${getStackBackend(stack.backend)}`,
    `--runtime ${stack.runtime}`,
    `--api ${stack.api}`,
    `--database ${stack.database}`,
    `--orm ${stack.orm}`,
    `--db-setup ${stack.dbSetup}`,
    `--package-manager ${stack.packageManager}`,
    stack.git === "false" ? "--no-git" : "--git",
    `--web-deploy ${stack.webDeploy}`,
    `--server-deploy ${stack.serverDeploy}`,
    stack.install === "false" ? "--no-install" : "--install",
    `--addons ${
      stack.addons.length > 0
        ? stack.addons
            .filter(
              (addon) =>
                addon !== "none" && TECH_OPTIONS.addons.some((option) => option.id === addon),
            )
            .join(" ") || "none"
        : "none"
    }`,
    `--features ${
      stack.features
        .filter((id) => id !== "none")
        .map(quoteShellArgument)
        .join(" ") || "none"
    }`,
  ];

  const providerFlags = Object.entries(providers).flatMap(([module, ids]) =>
    (ids.length ? ids : ["none"]).map((id) => quoteShellArgument(`${module}:${id}`)),
  );
  if (providerFlags.length) flags.push(`--providers ${providerFlags.join(" ")}`);
  const optionFlags = Object.entries(moduleOptions).flatMap(([module, options]) =>
    Object.entries(options).map(([key, value]) => quoteShellArgument(`${module}.${key}=${value}`)),
  );
  if (optionFlags.length) flags.push(`--module-options ${optionFlags.join(" ")}`);

  if (stack.yolo === "true") {
    flags.push("--yolo");
  }

  return `${base} ${projectName} ${flags.join(" ")}`;
}

export function formatStackCommandForDisplay(command: string) {
  return command.replaceAll(" --", ` ${"\\"}\n  --`);
}

export function generateStackUrlFromState(stack: StackState, baseUrl?: string) {
  const origin = baseUrl || SITE_URL;
  const searchString = serializeStackToSearchString(stack);
  return `${origin}/new${searchString ? `?${searchString}` : ""}`;
}

function serializeStackToSearchString(stack: StackState) {
  const stackParams = new URLSearchParams();
  Object.entries(stackUrlKeys).forEach(([stackKey, urlKey]) => {
    const value = stack[stackKey as keyof StackState];
    if (value !== undefined) {
      stackParams.set(
        urlKey as string,
        Array.isArray(value)
          ? value.join(",")
          : value !== null && typeof value === "object"
            ? JSON.stringify(value)
            : String(value),
      );
    }
  });
  return stackParams.toString();
}

export function generateStackSharingUrl(stack: StackState, baseUrl?: string) {
  const origin = baseUrl || SITE_URL;
  const searchString = serializeStackToSearchString(stack);
  return `${origin}/stack${searchString ? `?${searchString}` : ""}`;
}

export function generateStackOgImageUrl(stack: StackState, baseUrl = "") {
  const searchString = serializeStackToSearchString(stack);
  return `${baseUrl}/og/stack${searchString ? `?${searchString}` : ""}`;
}

export { CATEGORY_ORDER };
