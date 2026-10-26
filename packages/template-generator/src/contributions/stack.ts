import { APPLICATION_TEMPLATES } from "../applications.generated";
import { readFrameworkCatalog } from "../apps/plan";
import type { VirtualFileSystem } from "../core/virtual-fs";
import {
  hasTemplatesWithPrefix,
  processSingleTemplate,
  processTemplatesFromPrefix,
  type TemplateData,
} from "../template-handlers/utils";
import { GeneratorError, type RenderConfig } from "../types";

/** Client applicability is a role contract, independent of application IDs and types. */
export const WEB_CLIENT_ROLES = ["web-frontend", "admin"] as const;

export type ClientContribution = { framework: string; family: string };

/** Legacy entry points read the same adapter declarations as explicit applications. */
export function stackClientContributions(config: RenderConfig): ClientContribution[] {
  if (config.application) {
    if (
      !config.application.clientContributions &&
      config.frontend.some((frontend) => frontend !== "none")
    ) {
      throw new GeneratorError({
        phase: "contributions",
        message: `Application ${config.application.id} has no declared auth/API client contribution`,
      });
    }
    return config.application.clientContributions ? [config.application.clientContributions] : [];
  }
  const adapters = [...readFrameworkCatalog(APPLICATION_TEMPLATES).values()].flatMap((framework) =>
    Object.values(framework.apps),
  );
  return config.frontend.flatMap((frontend) => {
    if (frontend === "none") return [];
    const adapter = adapters.find(
      (candidate) =>
        candidate.stack.frontend?.includes(frontend) &&
        (candidate.clientContributions?.family === "native" ||
          (config.backend === "self"
            ? candidate.stack.backend === "self"
            : candidate.stack.backend !== "self")),
    );
    if (!adapter?.clientContributions) {
      throw new GeneratorError({
        phase: "contributions",
        message: `Framework ${frontend} has no declared auth/API client contribution for this stack`,
      });
    }
    return [adapter.clientContributions];
  });
}

export interface StackContribution {
  source: string;
  target: string;
  required: boolean;
  owner: string;
  kind: "prefix" | "file";
  roles?: readonly string[];
  /** Required for an intentional legacy no-op, never inferred from missing files. */
  optionalReason?: string;
}

export function acceptsStackRoles(config: RenderConfig, roles: readonly string[]): boolean {
  return !config.application || roles.some((role) => config.application!.roles.includes(role));
}

/** Validate the entire selection before rendering; missing implementations cannot disappear. */
export function renderStackContributions(
  vfs: VirtualFileSystem,
  templates: TemplateData,
  config: RenderConfig,
  contributions: readonly StackContribution[],
): void {
  for (const contribution of contributions) {
    if (!vfs.ownsPath(contribution.target)) continue;
    if (!contribution.required && !contribution.optionalReason) {
      throw new GeneratorError({
        phase: "contributions",
        message: `Optional contribution ${contribution.source} must document why it is optional`,
      });
    }
    if (contribution.roles && !acceptsStackRoles(config, contribution.roles)) {
      throw new GeneratorError({
        phase: "contributions",
        message: `Contribution ${contribution.source} requires role ${contribution.roles.join(" or ")} on application ${config.application?.id}`,
      });
    }
    const present =
      contribution.kind === "file"
        ? templates.has(contribution.source)
        : hasTemplatesWithPrefix(templates, contribution.source);
    if (contribution.required && !present) {
      throw new GeneratorError({
        phase: "contributions",
        message: `Missing required contribution ${contribution.source} owned by ${contribution.owner} for ${contribution.target}`,
      });
    }
  }
  for (const contribution of contributions) {
    if (!vfs.ownsPath(contribution.target)) continue;
    if (contribution.kind === "file") {
      processSingleTemplate(vfs, templates, contribution.source, contribution.target, config);
    } else {
      processTemplatesFromPrefix(vfs, templates, contribution.source, contribution.target, config);
    }
  }
}
