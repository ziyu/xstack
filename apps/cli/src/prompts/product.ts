import {
  hasErrors,
  MODULE_CATALOG,
  resolveModules,
  toSelection,
  type ModuleManifest,
  type ResolvedPlan,
  type StackContext,
} from "@xstack/template-generator";
import { isCancel, multiselect, select } from "@clack/prompts";

import type { Auth, ProductConfig } from "../types";
import { isSilent, markPromptShown } from "../utils/context";
import { UserCancelledError } from "../utils/errors";
import { getAvailableAuthProviders } from "./auth";
import { navigableMultiselect } from "./navigable";

type ProviderSelection = NonNullable<ProductConfig["providers"]>;

function answer<T>(value: T | symbol): T {
  if (isCancel(value)) throw new UserCancelledError({ message: "Operation cancelled" });
  return value as T;
}

function planFor(product: ProductConfig, stack: StackContext): ResolvedPlan {
  return resolveModules(toSelection(product), stack, MODULE_CATALOG);
}

/** Feature modules that resolve on this stack when selected alone. */
export function availableFeatures(stack: StackContext): ModuleManifest[] {
  return [...MODULE_CATALOG.values()].filter(
    (module) => !module.hidden && !hasErrors(planFor({ features: [module.id] }, stack)),
  );
}

/** The `auth` stack field the features imply, for prompts that still read it. */
export function impliedAuth(product: ProductConfig, stack: StackContext): Auth {
  const auth = planFor(product, stack).domains.auth;
  return auth === "better-auth" || auth === "clerk" ? auth : "none";
}

export async function getFeaturesChoice(
  decided: string[] | undefined,
  stack: StackContext,
  previousValue?: string[],
): Promise<string[]> {
  if (decided !== undefined) return decided;
  const available = availableFeatures(stack);
  if (!available.length) return [];

  const response = await navigableMultiselect<string>({
    message: "Which features do you need?",
    options: available.map((module) => ({
      value: module.id,
      label: module.name.en,
      hint: module.description.en,
    })),
    required: false,
    initialValues: previousValue?.filter((id) => available.some((m) => m.id === id)),
  });
  return answer(response);
}

/** Providers the module keeps its current implementation with. */
function providerChoices(module: ModuleManifest, native: boolean): string[] {
  const all = Object.keys(module.providers?.options ?? {});
  const domain = module.domain;
  if (!domain) return all;
  if (!native) return all.filter((id) => domain.stack?.providers?.includes(id));
  return all.filter((id) => domain.native?.({ providers: [id], options: {} }) ?? true);
}

async function getProvidersChoice(module: ModuleManifest, choices: string[]): Promise<string[]> {
  markPromptShown();
  const spec = module.providers!;
  const options = choices.map((value) => {
    const provider = spec.options[value]!;
    return {
      value,
      label: provider.name,
      hint: provider.market === "cn" ? "China" : provider.market === "global" ? "Global" : "",
    };
  });
  if (spec.max === 1) {
    return [answer(await select<string>({ message: `Provider for ${module.name.en}`, options }))];
  }
  return answer(
    await multiselect<string>({
      message: `Providers for ${module.name.en}`,
      options,
      initialValues: spec.default?.global.filter((id) => choices.includes(id)),
      required: (spec.min ?? 0) > 0,
    }),
  );
}

/** Asks the module-level questions (auth engine, providers, languages) the flags left open. */
export async function completeProduct(
  initial: ProductConfig,
  stack: StackContext,
): Promise<ProductConfig> {
  if (isSilent()) return initial;
  const features = initial.features;
  const providers: ProviderSelection = { ...initial.providers };
  const options = { ...initial.options };

  if (features.includes("auth") && options.auth?.engine === undefined) {
    const auth = planFor({ features: ["auth"] }, stack).modules.find(
      (m) => m.manifest.id === "auth",
    );
    if (auth?.variant === "stack") {
      const engines = getAvailableAuthProviders(stack.backend, stack.frontend).filter(
        (engine) => engine !== "none",
      );
      if (engines.length > 1) {
        markPromptShown();
        const engine = answer(
          await select<string>({
            message: "Authentication engine",
            options: engines.map((value) => ({ value, label: value })),
          }),
        );
        options.auth = { ...options.auth, engine };
      }
    }
  }

  for (const id of features) {
    const module = MODULE_CATALOG.get(id);
    if (!module?.providers || providers[id]) continue;
    const resolved = planFor({ features, providers, options }, stack).modules.find(
      (m) => m.manifest.id === id,
    );
    const choices = providerChoices(module, resolved?.variant !== "stack");
    if (choices.length) providers[id] = await getProvidersChoice(module, choices);
  }

  const plan = planFor({ features, providers, options }, stack);
  const hasI18n = plan.modules.some((m) => m.manifest.id === "i18n" && m.variant === "native");
  if (hasI18n && options.i18n?.locales === undefined) {
    markPromptShown();
    const locales = answer(
      await select<string>({
        message: "Languages",
        options: [
          { value: "en,zh-CN", label: "English + 简体中文", hint: "English by default" },
          { value: "zh-CN,en", label: "简体中文 + English", hint: "Chinese by default" },
          { value: "en", label: "English only" },
          { value: "zh-CN", label: "简体中文 only" },
        ],
        initialValue: "en,zh-CN",
      }),
    );
    options.i18n = { ...options.i18n, locales };
  }

  return { features, providers, options };
}
