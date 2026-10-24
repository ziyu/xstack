import type { VirtualFileSystem } from "../core/virtual-fs";
import {
  hasTemplatesWithPrefix,
  processSingleTemplate,
  processTemplatesFromPrefix,
  type TemplateData,
} from "../template-handlers/utils";
import { GeneratorError, type RenderConfig } from "../types";

/** Shared clients are reusable by these application types, not arbitrary apps. */
export const WEB_CLIENT_APP_TYPES = ["fullstack-web", "web-frontend", "admin"] as const;

export interface StackContribution {
  source: string;
  target: string;
  required: boolean;
  owner: string;
  kind: "prefix" | "file";
  appTypes?: readonly string[];
  /** Required for an intentional legacy no-op, never inferred from missing files. */
  optionalReason?: string;
}

export function acceptsStackApplication(
  config: RenderConfig,
  appTypes: readonly string[],
): boolean {
  return !config.application || appTypes.includes(config.application.type);
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
    if (contribution.appTypes && !acceptsStackApplication(config, contribution.appTypes)) {
      throw new GeneratorError({
        phase: "contributions",
        message: `Contribution ${contribution.source} does not apply to application type ${config.application?.type}`,
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
