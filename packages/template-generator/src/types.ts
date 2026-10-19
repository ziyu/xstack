import type { Auth, ProjectConfig } from "@xstack/types";
import { TaggedError } from "better-result";

/**
 * The config stack templates and processors render with: the project config plus the
 * auth engine derived from the module plan.
 */
export type RenderConfig = ProjectConfig & { auth: Auth };

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

export interface VirtualFileTree {
  root: VirtualDirectory;
  fileCount: number;
  directoryCount: number;
  config: ProjectConfig;
}

export interface GeneratorOptions {
  config: ProjectConfig;
  templateBasePath?: string;
  templates?: Map<string, string>;
  /** CLI version string for xstack.jsonc */
  version?: string;
}

/**
 * Error class for template generation failures
 */
export class GeneratorError extends TaggedError("GeneratorError")<{
  message: string;
  phase?: string;
  cause?: unknown;
}> {}
