import type { StackState } from "./constant";
import {
  NPM_PACKAGE_URL,
  REPOSITORY_URL,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
  SUPPORT_EMAIL,
} from "./site";
import {
  generateStackCommand,
  generateStackSharingUrl,
  generateStackSummary,
  generateStackUrlFromState,
  getSelectedTechs,
} from "./stack-utils";
import type { SelectedTech } from "./stack-utils";

export const MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8";

export const agentPageSlugByPath = {
  "/about": "about",
  "/analytics": "analytics",
  "/contact": "contact",
  "/new": "builder",
  "/privacy": "privacy",
  "/showcase": "showcase",
  "/sponsors": "sponsors",
  "/stack": "stack",
} as const;

export type AgentPageSlug = (typeof agentPageSlugByPath)[keyof typeof agentPageSlugByPath];

type DocumentationPage = {
  data: {
    description?: string;
    title: string;
  };
  url: string;
};

const agentPageMarkdown = {
  about: `# About ${SITE_NAME}

${SITE_DESCRIPTION}

xstack is a free, MIT-licensed open-source project maintained in public. It generates source code under the developer's control and does not add a required hosted xstack runtime.

- [Documentation](${SITE_URL}/docs)
- [Source code](${REPOSITORY_URL})
- [npm package](${NPM_PACKAGE_URL})
- [Contact](${SITE_URL}/contact)`,
  analytics: `# xstack analytics

The analytics page publishes aggregate usage trends from successful CLI project creation events. The payload covers selected stack options plus CLI, Node.js, and platform versions; it intentionally omits project names, paths, file contents, secrets, and environment variables.

- [Analytics dashboard](${SITE_URL}/analytics)
- [Analytics and telemetry documentation](${SITE_URL}/docs/analytics.mdx)
- Disable CLI telemetry with \`XSTACK_TELEMETRY_DISABLED=1\`, \`DO_NOT_TRACK=1\`, or \`--disable-analytics\`.`,
  builder: `# xstack browser builder

Use the stack builder to choose a frontend, backend, runtime, database, ORM, API layer, authentication, deployment targets, and addons. It produces a reproducible \`xstack\` command.

- [Open the builder](${SITE_URL}/new)
- [CLI options](${SITE_URL}/docs/cli/options.mdx)
- [Compatibility rules](${SITE_URL}/docs/cli/compatibility.mdx)

For agent automation, prefer the JSON commands or local MCP server documented in the agent workflow guide.`,
  contact: `# Contact xstack

Use GitHub issues for reproducible bugs and feature requests. Include the CLI version, command, selected stack, operating system, and a minimal reproduction when possible. General project questions can be sent to ${SUPPORT_EMAIL}.

- [Open a GitHub issue](${REPOSITORY_URL}/issues/new/choose)
- [Project repository](${REPOSITORY_URL})
- [Documentation](${SITE_URL}/docs)`,
  privacy: `# xstack privacy

The website uses self-hosted Umami analytics. The CLI sends one telemetry event after successful project creation (including how it was driven: prompts, flags, JSON, API, or MCP) plus one anonymous failure event when a scaffold breaks, unless telemetry is disabled. The CLI payloads do not include project names, paths, file contents, secrets, environment variables, or persistent user identifiers.

- [Full privacy notice](${SITE_URL}/privacy)
- [Analytics and telemetry details](${SITE_URL}/docs/analytics.mdx)
- Disable CLI telemetry with \`XSTACK_TELEMETRY_DISABLED=1\`, \`DO_NOT_TRACK=1\`, or \`--disable-analytics\`.`,
  showcase: `# xstack showcase

Community projects generated with xstack are listed on the showcase page. Each entry links to the submitted project and identifies its technologies.

- [View the showcase](${SITE_URL}/showcase)
- [Submit a project](${REPOSITORY_URL}/issues/new/choose)`,
  sponsors: `# xstack sponsors

The sponsors page recognizes the companies and developers funding xstack development and infrastructure.

- [View sponsors](${SITE_URL}/sponsors)
- [Sponsor the project](https://github.com/sponsors/AmanVarshney01)`,
  stack: `# Shared xstack configuration

The stack page renders a configuration encoded in its query string. Open the linked page to inspect the selected technologies, copy the generated CLI command, or continue editing in the browser builder.

- [Open the default stack](${SITE_URL}/stack)
- [Open the builder](${SITE_URL}/new)
- [CLI documentation](${SITE_URL}/docs/cli)`,
} satisfies Record<AgentPageSlug, string>;

const stackCategoryLabels = {
  addons: "Addon",
  api: "API",
  backend: "Backend",
  database: "Database",
  dbSetup: "Database setup",
  features: "Feature",
  git: "Git",
  install: "Dependency installation",
  nativeFrontend: "Native frontend",
  orm: "ORM",
  packageManager: "Package manager",
  runtime: "Runtime",
  serverDeploy: "Server deployment",
  webDeploy: "Web deployment",
  webFrontend: "Web frontend",
} satisfies Record<SelectedTech["category"], string>;

export const MARKDOWN_NOT_FOUND = `# 404: Page not found

The requested resource does not exist. Use one of these indexes to recover:

- [Agent instructions](${SITE_URL}/llms.txt)
- [Documentation](${SITE_URL}/docs)
- [Sitemap](${SITE_URL}/sitemap.xml)
- [Homepage](${SITE_URL}/)
`;

export function getAgentPageMarkdown(slug: string) {
  return agentPageMarkdown[slug as AgentPageSlug] ?? null;
}

export function buildStackMarkdown(stack: StackState) {
  const projectName = (stack.projectName || "my-better-t-app").replaceAll(/\s+/g, " ").trim();
  const escapedProjectName = projectName.replaceAll("`", "\\`");
  const selectedTechnologies = getSelectedTechs(stack)
    .map(({ category, name }) => `- ${stackCategoryLabels[category]}: ${name}`)
    .join("\n");
  const command = generateStackCommand(stack);
  const backtickRuns = command.match(/`+/g)?.map((run) => run.length) ?? [];
  const codeFence = "`".repeat(Math.max(3, ...backtickRuns.map((length) => length + 1)));

  return `# Shared xstack configuration

- Project name: \`${escapedProjectName}\`
- Summary: ${generateStackSummary(stack)}

## Selected technologies

${selectedTechnologies || "No technologies selected."}

## Generated CLI command

${codeFence}bash
${command}
${codeFence}

## Links

- [Open this exact configuration](${generateStackSharingUrl(stack)})
- [Edit this configuration](${generateStackUrlFromState(stack)})
- [CLI documentation](${SITE_URL}/docs/cli)
`;
}

export function getDocumentationMarkdownUrl(pageUrl: string) {
  return pageUrl === "/docs" ? "/docs/index.mdx" : `${pageUrl}.mdx`;
}

export function buildLlmsIndex(pages: DocumentationPage[]) {
  const documentationLinks = [...pages]
    .sort((a, b) => {
      if (a.url === "/docs") return -1;
      if (b.url === "/docs") return 1;
      return a.url.localeCompare(b.url);
    })
    .map((page) => {
      const description = page.data.description ? ` — ${page.data.description}` : "";
      return `- [${page.data.title}](${SITE_URL}${getDocumentationMarkdownUrl(page.url)})${description}`;
    })
    .join("\n");

  return `# ${SITE_NAME}

> ${SITE_DESCRIPTION}

## When to use xstack

Use xstack when a developer or coding agent needs to scaffold a new TypeScript application, reproduce a selected stack from a command, add supported features to an existing xstack project, inspect compatibility rules, or generate a project through a structured interface.

xstack does not expose a public hosted application API. The supported automation interfaces are the CLI, its JSON commands, the programmatic npm API, and the local stdio MCP server.

## Quick start

\`\`\`bash
npx xstack@latest my-app
\`\`\`

Non-interactive default project:

\`\`\`bash
npx xstack@latest my-app --yes
\`\`\`

## Agent interfaces

- JSON project creation: \`xstack create-json --input '{...}'\`
- JSON project updates: \`xstack add-json --input '{...}'\`
- JSON schemas: \`xstack schema --name all\`
- Local MCP server: \`npx xstack@latest mcp\`
- [Agent workflow guide](${SITE_URL}/docs/cli/agent-workflows.mdx)
- [Programmatic API](${SITE_URL}/docs/cli/programmatic-api.mdx)

## Documentation

${documentationLinks}

## Project resources

- [Complete documentation in one Markdown file](${SITE_URL}/llms-full.txt)
- [Browser stack builder](${SITE_URL}/new)
- [npm package](${NPM_PACKAGE_URL})
- [GitHub repository](${REPOSITORY_URL})
- [Sitemap](${SITE_URL}/sitemap.xml)
- [Privacy notice](${SITE_URL}/privacy)
- [Contact](${SITE_URL}/contact)
`;
}
