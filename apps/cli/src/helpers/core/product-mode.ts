import { log } from "@clack/prompts";
import {
  getModulePlan,
  hasErrors,
  PRODUCT_PRESETS,
  type RenderConfig,
  toRenderConfig,
} from "@xstack/template-generator";
import { Result } from "better-result";
import pc from "picocolors";

import { getDefaultConfig } from "../../constants";
import type { CLIInput, ProductConfig, ProjectConfig } from "../../types";
import { isSilent } from "../../utils/context";
import { CLIError } from "../../utils/errors";

export type ProductFlags = {
  features?: string[];
  providers?: string[];
  moduleOptions?: string[];
};

function splitValues(values: string[] | undefined): string[] {
  return (values ?? []).flatMap((value) => value.split(",")).filter(Boolean);
}

function parseOptionValue(raw: string): string | boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw;
}

/** Turns `--features`, `--providers feature:a,b,other:c` and `--module-options module.key=value` into a product config. */
export function productFromFlags(flags: ProductFlags): Result<ProductConfig | undefined, CLIError> {
  const features = splitValues(flags.features).filter((feature) => feature !== "none");
  const providerPairs = splitValues(flags.providers);
  const optionPairs = flags.moduleOptions ?? [];
  if (!flags.features && !providerPairs.length && !optionPairs.length) {
    return Result.ok(undefined);
  }

  const providers: Record<string, string[]> = {};
  let feature: string | undefined;
  const disabledProviders = new Set<string>();
  for (const pair of providerPairs) {
    const [head, tail] = pair.includes(":") ? pair.split(":") : [feature, pair];
    if (!head || !tail) {
      return Result.err(
        new CLIError({ message: `Invalid --providers value "${pair}", expected feature:provider` }),
      );
    }
    feature = head;
    if (tail === "none") {
      if (providers[feature]?.length) {
        return Result.err(
          new CLIError({ message: `Cannot combine ${feature}:none with providers` }),
        );
      }
      disabledProviders.add(feature);
      providers[feature] = [];
    } else {
      if (disabledProviders.has(feature)) {
        return Result.err(
          new CLIError({ message: `Cannot combine ${feature}:none with providers` }),
        );
      }
      providers[feature] = [...(providers[feature] ?? []), tail];
    }
  }

  const options: Record<string, Record<string, string | boolean>> = {};
  for (const pair of optionPairs) {
    const match = /^([\w-]+)\.([\w-]+)=(.*)$/.exec(pair);
    if (!match) {
      return Result.err(
        new CLIError({
          message: `Invalid --module-options value "${pair}", expected module.key=value`,
        }),
      );
    }
    const [, module = "", key = "", value = ""] = match;
    options[module] = { ...options[module], [key]: parseOptionValue(value) };
  }

  return Result.ok({ features, providers, options });
}

function mergeProduct(base: ProductConfig | undefined, extra: ProductConfig | undefined) {
  if (!base) return extra;
  if (!extra) return base;
  return {
    features: [...new Set([...base.features, ...extra.features])],
    providers: { ...base.providers, ...extra.providers },
    options: { ...base.options, ...extra.options },
  };
}

/** The feature selection fixed by presets and `--features`/`--providers`/`--module-options`; `undefined` when the user has not decided. */
export function decidedProduct(input: CLIInput): ProductConfig | undefined {
  const preset = input.preset ? PRODUCT_PRESETS[input.preset] : undefined;
  return mergeProduct(preset, input.product);
}

/** The auth engine the product layer hands to the stack templates. */
export function stackDomains(
  config: Partial<ProjectConfig>,
  input?: CLIInput,
): Pick<RenderConfig, "auth"> {
  const product = config.product ?? (input && decidedProduct(input));
  const { auth } = toRenderConfig({ ...getDefaultConfig(), ...config, product });
  return { auth };
}

export function withProduct(
  config: ProjectConfig,
  product: ProductConfig | undefined,
): ProjectConfig {
  return { ...config, product: product ?? { features: [] } };
}

/** Reports automatic additions and problems of the module plan. */
export function validateProductPlan(config: ProjectConfig): Result<void, CLIError> {
  const plan = getModulePlan(config);
  if (!isSilent()) {
    for (const note of plan.notes) log.info(pc.dim(note));
    for (const issue of plan.issues) {
      if (issue.level === "warning") log.warn(pc.yellow(issue.message));
    }
  }
  if (hasErrors(plan)) {
    return Result.err(
      new CLIError({
        message: plan.issues
          .filter((issue) => issue.level === "error")
          .map((issue) => issue.message)
          .join("\n"),
      }),
    );
  }
  return Result.ok(undefined);
}
