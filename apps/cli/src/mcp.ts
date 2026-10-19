import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import z from "zod";

import { add, create, type SchemaName, SchemaNameSchema, getSchemaResult } from "./index";
import {
  AddInputSchema,
  AddonOptionsSchema,
  AddonsSchema,
  APISchema,
  BackendSchema,
  CreateInputSchema,
  DatabaseSchema,
  DatabaseSetupSchema,
  DbSetupOptionsSchema,
  DirectoryConflictSchema,
  FrontendSchema,
  ORMSchema,
  PackageManagerSchema,
  RuntimeSchema,
  ServerDeploySchema,
  WebDeploySchema,
} from "./types";
import { setProcessMode } from "./utils/context";
import { getLatestCLIVersion } from "./utils/get-latest-cli-version";

const ToolResponseSchema = z.object({
  ok: z.boolean(),
  data: z.any().optional(),
  error: z.string().optional(),
});

const SchemaToolInputSchema = z.object({
  name: SchemaNameSchema.optional().describe("Schema name to inspect. Defaults to all."),
});

const McpCreateProjectInputSchema = CreateInputSchema.safeExtend({
  projectName: z.string().describe("Project name or relative path"),
  frontend: z
    .array(FrontendSchema)
    .describe("Explicit frontend app surfaces. Do not use native frontends as styling options."),
  backend: BackendSchema.describe("Explicit backend framework"),
  runtime: RuntimeSchema.describe("Explicit runtime environment"),
  database: DatabaseSchema.describe("Explicit database choice"),
  orm: ORMSchema.describe("Explicit ORM choice"),
  api: APISchema.describe("Explicit API layer"),
  addons: z.array(AddonsSchema).describe("Explicit addon list. Use [] when no addons are needed."),
  git: z.boolean().describe("Whether to initialize a git repository"),
  packageManager: PackageManagerSchema.describe("Explicit package manager"),
  install: z.boolean().describe("Whether to install dependencies"),
  dbSetup: DatabaseSetupSchema.describe("Explicit database setup/provisioning choice"),
  webDeploy: WebDeploySchema.describe("Explicit web deployment choice"),
  serverDeploy: ServerDeploySchema.describe("Explicit server deployment choice"),
  addonOptions: AddonOptionsSchema.optional(),
  dbSetupOptions: DbSetupOptionsSchema.optional(),
  directoryConflict: DirectoryConflictSchema.optional(),
}).describe(
  "Explicit xstack project configuration for MCP use. Provide the full stack config instead of relying on inferred defaults.",
);

type SchemaToolInput = {
  name?: SchemaName;
};
type McpCreateProjectInput = z.infer<typeof McpCreateProjectInputSchema>;
type McpAddInput = z.infer<typeof AddInputSchema>;

function formatToolSuccess<T>(data: T) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
    structuredContent: {
      ok: true,
      data,
    },
  };
}

function formatToolError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);
  return {
    content: [
      {
        type: "text" as const,
        text: message,
      },
    ],
    structuredContent: {
      ok: false,
      error: message,
    },
    isError: true,
  };
}

function getProjectToolAnnotations() {
  return {
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  };
}

function getMcpInstallTimeoutMessage(packageManager: string) {
  return [
    "MCP project creation requires `install: false`.",
    "Dependency installation can exceed common MCP client request timeouts and cause the connection to close before the tool returns.",
    `Scaffold the project first, then run \`${packageManager} install\` in the generated project directory from a terminal.`,
  ].join(" ");
}

function getStackGuidance() {
  return {
    workflow: [
      "Call xstack_get_schema or xstack_get_stack_guidance before constructing a config if the request is ambiguous.",
      "For project creation, build a full explicit config before calling xstack_plan_project.",
      "Always call xstack_plan_project before xstack_create_project.",
      "Only call xstack_create_project after the plan succeeds and matches the user's intent.",
      "Use xstack_plan_addons before xstack_add_addons when adding addons or scaffolding a workspace package in an existing project.",
    ],
    createContract: {
      requiresExplicitFields: [
        "projectName",
        "frontend",
        "backend",
        "runtime",
        "database",
        "orm",
        "api",
        "addons",
        "git",
        "packageManager",
        "install",
        "dbSetup",
        "webDeploy",
        "serverDeploy",
      ],
      optionalFields: ["preset", "product", "addonOptions", "dbSetupOptions", "directoryConflict"],
      rule: "Do not call xstack_plan_project or xstack_create_project with a partial payload. MCP project creation requires the full explicit stack config.",
    },
    fieldNotes: {
      frontend:
        "frontend is for app surfaces only. Choose explicit app targets such as next, react-router, tanstack-router, native-bare, native-uniwind, or native-unistyles.",
      addons: "addons must be an explicit array. Use [] when no addons are requested.",
      product:
        "product selects feature modules such as auth and payment, with their providers and options. Omit it for a bare stack.",
      dbSetup:
        "dbSetup is always required. Use 'none' when no managed database provisioning is requested.",
      webDeploy:
        "webDeploy is always required. Use 'none' when no web deployment target is requested.",
      serverDeploy:
        "serverDeploy is always required. Use 'none' when no server deployment target is requested.",
      packageManager:
        "packageManager is always required because installation and reproducible commands depend on it.",
      install:
        "install is always required. For MCP project creation, prefer false because many clients enforce request timeouts around long-running dependency installs.",
      git: "git is always required. Set it to true or false explicitly instead of relying on defaults.",
    },
    ambiguityRules: [
      "If the user request leaves major stack choices unspecified, stop and resolve them before calling xstack_plan_project.",
      "Do not infer extra app surfaces, addons, feature modules, or provisioning choices from a template name or styling preference.",
      "If the user wants the smallest valid stack, still send the full config with explicit 'none', [] , true, or false values where appropriate.",
      "For MCP execution, scaffold with install=false and let the user or agent run dependency installation separately from a terminal session.",
    ],
  };
}

export function createXStackMcpServer() {
  setProcessMode("mcp");
  const server = new McpServer(
    {
      name: "xstack",
      version: getLatestCLIVersion(),
    },
    {
      cacheHints: {
        "tools/list": { ttlMs: 60 * 60 * 1000, cacheScope: "public" },
      },
    },
  );

  server.registerTool(
    "xstack_get_stack_guidance",
    {
      title: "Get xstack MCP Guidance",
      description:
        "Read MCP-specific guidance for choosing valid xstack configurations. Use this before planning when user intent is ambiguous. This explains the full explicit config required by MCP project creation, plus important field semantics and ambiguity rules.",
      outputSchema: ToolResponseSchema,
      annotations: {
        title: "Get xstack MCP Guidance",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        return formatToolSuccess(getStackGuidance());
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  server.registerTool(
    "xstack_get_schema",
    {
      title: "Get xstack Schemas",
      description:
        "Inspect xstack CLI and input schemas so agents can plan valid create/add requests. Use this together with xstack_get_stack_guidance before creating a project if any part of the request is ambiguous.",
      inputSchema: SchemaToolInputSchema,
      outputSchema: ToolResponseSchema,
      annotations: {
        title: "Get xstack Schemas",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ name }: SchemaToolInput) => {
      try {
        return formatToolSuccess(getSchemaResult((name ?? "all") as SchemaName));
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  server.registerTool(
    "xstack_plan_project",
    {
      title: "Plan xstack Project",
      description:
        "Validate and preview a xstack project creation without writing files or provisioning resources. Always use this before xstack_create_project. This tool requires an explicit full stack config rather than a partial payload with inferred defaults.",
      inputSchema: McpCreateProjectInputSchema,
      outputSchema: ToolResponseSchema,
      annotations: {
        title: "Plan xstack Project",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input: McpCreateProjectInput) => {
      try {
        const result = await create(input.projectName, {
          ...input,
          dryRun: true,
          disableAnalytics: true,
        });

        if (result.isErr()) {
          return formatToolError(result.error);
        }

        const planningData = input.install
          ? {
              ...result.value,
              warnings: [getMcpInstallTimeoutMessage(input.packageManager)],
              recommendedMcpExecution: {
                ...input,
                install: false,
              },
            }
          : result.value;

        return formatToolSuccess(planningData);
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  server.registerTool(
    "xstack_create_project",
    {
      title: "Create xstack Project",
      description:
        "Create a xstack project on disk using the same silent programmatic flow as the CLI JSON API. Call this only after xstack_plan_project succeeds and the plan clearly matches the user's intent. This tool requires an explicit full stack config.",
      inputSchema: McpCreateProjectInputSchema,
      outputSchema: ToolResponseSchema,
      annotations: {
        title: "Create xstack Project",
        ...getProjectToolAnnotations(),
      },
    },
    async (input: McpCreateProjectInput) => {
      try {
        if (input.install) {
          return formatToolError(getMcpInstallTimeoutMessage(input.packageManager));
        }

        const result = await create(input.projectName, {
          ...input,
          disableAnalytics: input.disableAnalytics ?? false,
        });

        if (result.isErr()) {
          return formatToolError(result.error);
        }

        return formatToolSuccess(result.value);
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  server.registerTool(
    "xstack_plan_addons",
    {
      title: "Plan xstack Project Additions",
      description:
        "Validate and preview addon installation or workspace package scaffolding for an existing xstack project without writing files. Always use this before xstack_add_addons.",
      inputSchema: AddInputSchema,
      outputSchema: ToolResponseSchema,
      annotations: {
        title: "Plan xstack Project Additions",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input: McpAddInput) => {
      try {
        const result = await add({
          ...input,
          dryRun: true,
        });

        if (!result?.success) {
          return formatToolError(result?.error ?? "Failed to plan project additions");
        }

        return formatToolSuccess(result);
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  server.registerTool(
    "xstack_add_addons",
    {
      title: "Apply xstack Project Additions",
      description:
        "Install addons or scaffold a workspace package in an existing xstack project using the same silent flow as add-json. Call this only after xstack_plan_addons succeeds and the planned changes match the user's intent.",
      inputSchema: AddInputSchema,
      outputSchema: ToolResponseSchema,
      annotations: {
        title: "Apply xstack Project Additions",
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input: McpAddInput) => {
      try {
        const result = await add(input);

        if (!result?.success) {
          return formatToolError(result?.error ?? "Failed to update project");
        }

        return formatToolSuccess(result);
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  return server;
}

export function startXStackMcpServer() {
  return serveStdio(() => createXStackMcpServer());
}
