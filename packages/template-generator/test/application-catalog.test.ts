import { expect, test } from "bun:test";

import type { ApplicationSelection } from "@xstack/types";

import { APPLICATION_TEMPLATES } from "../src/applications.generated";
import { readApplicationCatalog, resolveApplications } from "../src/apps/plan";
import { EMBEDDED_TEMPLATES } from "../src/templates.generated";

test("browser catalog enforces the same app ownership and adapter support as generation", () => {
  const web: ApplicationSelection = {
    id: "product",
    type: "fullstack-web",
    stack: { framework: "next" },
  };
  const cli: ApplicationSelection = { id: "tools", type: "cli", stack: { framework: "node" } };
  const admin: ApplicationSelection = {
    id: "console",
    type: "admin",
    stack: { framework: "react-router" },
  };
  for (const selection of [
    [web, cli],
    [web, admin],
    [admin],
    [{ ...web, stack: { framework: "hono" } }],
  ]) {
    const browser = resolveApplications(selection, APPLICATION_TEMPLATES);
    const generator = resolveApplications(selection, EMBEDDED_TEMPLATES);
    expect(browser.issues).toEqual(generator.issues);
    expect(
      browser.apps.map((app) => ({
        id: app.selection.id,
        roles: app.manifest.roles,
        stack: app.adapter.stack,
      })),
    ).toEqual(
      generator.apps.map((app) => ({
        id: app.selection.id,
        roles: app.manifest.roles,
        stack: app.adapter.stack,
      })),
    );
  }
});

test("catalog defaults are directory names, not stable type aliases", () => {
  const defaults = {
    "fullstack-web": "web",
    "web-frontend": "frontend",
    backend: "backend",
    admin: "admin",
    cli: "cli",
    native: "native",
  };
  for (const templates of [APPLICATION_TEMPLATES, EMBEDDED_TEMPLATES]) {
    const catalog = readApplicationCatalog(templates);
    expect(
      Object.fromEntries([...catalog].map(([id, app]) => [id, app.defaultDirectoryName])),
    ).toEqual(defaults);
    for (const type of ["web", "site"]) {
      expect(
        resolveApplications(
          [{ id: "custom-folder", type, stack: { framework: "next" } }],
          templates,
        ).issues.map((issue) => issue.code),
      ).toContain("unknown-type");
    }
    const plan = resolveApplications(
      [
        { id: "site", type: "web-frontend", stack: { framework: "react-router" } },
        { id: "api", type: "backend", stack: { framework: "hono" } },
      ],
      templates,
    );
    expect(plan.issues).toEqual([]);
    expect(plan.apps[0]?.selection.id).toBe("site");
    expect(plan.apps[0]?.manifest.defaultDirectoryName).toBe("frontend");
  }
});
