import type { Auth, ProjectConfig } from "@xstack/types";
import { TaggedError } from "better-result";

import type { ProductContribution } from "./modules/types";

/**
 * The config stack templates and processors render with: the project config plus the
 * auth engine derived from the module plan.
 */
export type ApplicationRenderContext = {
  id: string;
  type: string;
  roles: string[];
  contribution?: ProductContribution;
  directory: string;
  origin: string;
  devArgs: string[];
  port: number;
  clientOrigins: string[];
  paths: Record<string, string>;
  /** Bound backend owner, or this app's root when it owns the backend role. */
  backendRoot?: string;
  nativeSplit?: boolean;
  backendOrigin?: string;
  workspaceRuntime: ProjectConfig["runtime"];
  ownsPath: (path: string) => boolean;
  inheritedFiles?: ReadonlyMap<string, string>;
};
export type RenderConfig = ProjectConfig & { auth: Auth; application?: ApplicationRenderContext };

export interface VirtualFile {
  type: "file";
  path: string;
  name: string;
  content: string;
  extension: string;
  sourcePath?: string; // Original template path for binary files
}

export interface VirtualDirectory {
  type: "directory";
  path: string;
  name: string;
  children: VirtualNode[];
}

export type VirtualNode = VirtualFile | VirtualDirectory;

/** Origin metadata only; traces never include generated content or secrets. */
export interface GenerationSource {
  kind: "template" | "processor";
  name: string;
  app?: string;
  owner?: string;
}

export interface GenerationWrite {
  path: string;
  operation: "create" | "update" | "delete";
  source: GenerationSource;
  previousSource?: GenerationSource;
}

export interface VirtualFileTree {
  root: VirtualDirectory;
  fileCount: number;
  directoryCount: number;
  config: ProjectConfig;
  /** Ordered file operations, present only when tracing was requested. */
  provenance?: GenerationWrite[];
}

export interface GeneratorOptions {
  config: ProjectConfig;
  templateBasePath?: string;
  templates?: Map<string, string>;
  /** CLI version string for xstack.jsonc */
  version?: string;
  /** Capture file origins and replacements without recording generated contents. */
  trace?: boolean;
}

/**
 * Error class for template generation failures
 */
export class GeneratorError extends TaggedError("GeneratorError")<{
  message: string;
  phase?: string;
  cause?: unknown;
  source?: GenerationSource;
}> {}
