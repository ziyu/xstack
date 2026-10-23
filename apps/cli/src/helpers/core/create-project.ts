import { log } from "@clack/prompts";
import {
  generate,
  EMBEDDED_TEMPLATES,
  type RenderConfig,
  toRenderConfig,
} from "@xstack/template-generator";
import { writeTree } from "@xstack/template-generator/fs-writer";
import { Result } from "better-result";
import fs from "fs-extra";
import pc from "picocolors";

import type { DbSetupOptions, ProjectConfig } from "../../types";
import { isSilent } from "../../utils/context";
import { ProjectCreationError } from "../../utils/errors";
import { formatProject } from "../../utils/file-formatter";
import { getLatestCLIVersion } from "../../utils/get-latest-cli-version";
import {
  beginInterruptibleScope,
  endInterruptibleScope,
  getInterruptSignal,
  startInterruptibleStep,
  wasAnyStepInterrupted,
  wasInterrupted,
} from "../../utils/interrupt";
import { runOptionalStep } from "../../utils/optional-step";
import { cliLog } from "../../utils/terminal-output";
import { setupAddons } from "../addons/addons-setup";
import { setupDatabase } from "../core/db-setup";
import { initializeGit } from "./git";
import { installDependencies } from "./install-dependencies";
import { prepareGeneratedTree, saveCreationBaseline } from "./module-baseline";
import { displayPostInstallInstructions } from "./post-installation";

export interface CreateProjectOptions {
  manualDb?: boolean;
  dbSetupOptions?: DbSetupOptions;
  packageManagerVersion: string;
}

export interface CreateProjectOutcome {
  projectDir: string;
  install: "installed" | "skipped" | "cancelled" | "failed";
  installError: ProjectCreationError | null;
  interrupted: boolean;
}

/**
 * Creates a new project with the given configuration.
 * A failed dependency install is returned in the outcome instead of failing, since the project
 * is already on disk by then.
 */
export async function createProject(
  options: ProjectConfig,
  cliInput: CreateProjectOptions,
): Promise<Result<CreateProjectOutcome, ProjectCreationError>> {
  return Result.gen(async function* () {
    const projectDir = options.projectDir;
    const isConvex = options.backend === "convex";

    yield* Result.await(
      Result.tryPromise({
        try: () => fs.ensureDir(projectDir),
        catch: (e) =>
          new ProjectCreationError({
            phase: "directory-setup",
            message: `Failed to create project directory: ${e instanceof Error ? e.message : String(e)}`,
            cause: e,
          }),
      }),
    );

    const tree = yield* Result.await(
      generate({
        config: options,
        templates: EMBEDDED_TEMPLATES,
        version: getLatestCLIVersion(),
      }).then((result) =>
        result.mapError(
          (e) =>
            new ProjectCreationError({
              phase: e.phase || "template-generation",
              message: e.message,
              cause: e,
            }),
        ),
      ),
    );
    yield* Result.await(
      Result.tryPromise({
        try: () => prepareGeneratedTree(tree, cliInput.packageManagerVersion),
        catch: (cause) =>
          new ProjectCreationError({
            phase: "formatting",
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      }),
    );

    yield* Result.await(
      writeTree(tree, projectDir).then((result) =>
        result.mapError(
          (e) =>
            new ProjectCreationError({
              phase: "file-writing",
              message: e.message,
              cause: e,
            }),
        ),
      ),
    );

    yield* Result.await(
      Result.tryPromise({
        try: () => saveCreationBaseline(tree, getLatestCLIVersion()),
        catch: (cause) =>
          new ProjectCreationError({
            phase: "baseline",
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      }),
    );

    // Files are on disk from here: Ctrl-C only stops the current step
    beginInterruptibleScope();
    try {
      return yield* runPostScaffoldSteps(toRenderConfig(options), cliInput, projectDir, isConvex);
    } finally {
      endInterruptibleScope();
    }
  });
}

async function* runPostScaffoldSteps(
  options: RenderConfig,
  cliInput: CreateProjectOptions,
  projectDir: string,
  isConvex: boolean,
) {
  if (!isConvex && options.database !== "none") {
    yield* Result.await(
      Result.tryPromise({
        try: () => setupDatabase(options, cliInput),
        catch: (e) =>
          new ProjectCreationError({
            phase: "database-setup",
            message: `Failed to setup database: ${e instanceof Error ? e.message : String(e)}`,
            cause: e,
          }),
      }),
    );
  }

  if (options.addons.length > 0 && options.addons[0] !== "none") {
    yield* Result.await(
      Result.tryPromise({
        try: () => setupAddons(options),
        catch: (e) =>
          new ProjectCreationError({
            phase: "addons-setup",
            message: `Failed to setup addons: ${e instanceof Error ? e.message : String(e)}`,
            cause: e,
          }),
      }),
    );
  }

  startInterruptibleStep();
  yield* Result.await(formatProject(projectDir, getInterruptSignal()));
  if (wasInterrupted()) cliLog.warn(pc.yellow("Formatting cancelled."));

  if (!isSilent()) log.success("Project scaffolded");

  let install: CreateProjectOutcome["install"] = "skipped";
  let installError: ProjectCreationError | null = null;
  if (options.install) {
    const installResult = await installDependencies({
      projectDir,
      packageManager: options.packageManager,
    });
    if (installResult.isErr()) {
      install = "failed";
      installError = installResult.error;
    } else {
      install = installResult.value;
    }
  }

  await runOptionalStep(
    () => initializeGit(projectDir, options.git, getInterruptSignal()),
    "Git initialization cancelled.",
  );

  if (!isSilent()) {
    await displayPostInstallInstructions({
      ...options,
      depsInstalled: install === "installed",
    });
  }

  return Result.ok({ projectDir, install, installError, interrupted: wasAnyStepInterrupted() });
}
