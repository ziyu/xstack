import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

import {
  ApplicationIdSchema,
  ApplicationRoleSchema,
  ApplicationSelectionStackSchema,
} from "@xstack/types";
import { z } from "zod";

const applicationsSchema = z
  .array(
    z.object({
      id: ApplicationIdSchema,
      type: ApplicationIdSchema,
      stack: ApplicationSelectionStackSchema,
      roles: z.array(ApplicationRoleSchema),
      product: ApplicationIdSchema.nullable(),
      bindings: z.record(ApplicationRoleSchema, ApplicationIdSchema),
      directory: z.string().min(1),
      port: z.number().int().min(1).max(65535),
      origin: z.string().url(),
      devArgs: z.array(z.string()),
    }),
  )
  .min(1);
export type C2Application = z.infer<typeof applicationsSchema>[number];
export type C2Targets = {
  public: C2Application;
  admin: C2Application;
  backend: C2Application;
};
export type C2Applications = {
  applications: C2Application[];
  targets: C2Targets;
  runtime: C2Application[];
};

export async function readC2Applications(project: string): Promise<C2Applications> {
  const applications = applicationsSchema.parse(
    JSON.parse(await readFile(path.join(project, "applications.json"), "utf8")),
  );
  const workspace = await realpath(project);
  const ids = new Map<string, C2Application>();
  const directories = new Set<string>();
  const ports = new Set<number>();
  for (const app of applications) {
    assert.ok(!ids.has(app.id), `Duplicate application ID: ${app.id}`);
    ids.set(app.id, app);
    assert.equal(new Set(app.roles).size, app.roles.length, `Duplicate roles: ${app.id}`);
    assert.ok(!path.isAbsolute(app.directory), `Application directory must be relative: ${app.id}`);
    const resolved = path.resolve(project, app.directory);
    assert.ok(
      resolved.startsWith(path.resolve(project) + path.sep),
      `Application directory escapes workspace: ${app.id}`,
    );
    const physical = await realpath(resolved);
    assert.ok(
      physical.startsWith(workspace + path.sep),
      `Application directory symlink escapes workspace: ${app.id}`,
    );
    assert.ok(!directories.has(physical), `Duplicate application directory: ${app.id}`);
    directories.add(physical);
    assert.ok(!ports.has(app.port), `Duplicate application port: ${app.port}`);
    ports.add(app.port);
    const origin = new URL(app.origin);
    assert.ok(
      ["localhost", "127.0.0.1"].includes(origin.hostname),
      `Non-loopback application origin: ${app.id}`,
    );
    assert.equal(origin.protocol, "http:", `Unsupported application protocol: ${app.id}`);
    assert.equal(origin.origin, app.origin, `Expected bare application origin: ${app.id}`);
    assert.equal(
      Number(origin.port || 80),
      app.port,
      `Application origin/port mismatch: ${app.id}`,
    );
    if (app.product === null) {
      assert.equal(app.roles.length, 0, `Independent application owns product roles: ${app.id}`);
      assert.equal(
        Object.keys(app.bindings).length,
        0,
        `Independent application has bindings: ${app.id}`,
      );
    }
  }
  for (const app of applications) {
    for (const [role, id] of Object.entries(app.bindings)) {
      const target = ids.get(id);
      assert.ok(target, `Missing ${role} binding target ${id} for ${app.id}`);
      assert.ok(target.roles.includes(role), `Binding target ${id} does not own ${role}`);
      assert.equal(target.product, app.product, `Cross-product binding from ${app.id} to ${id}`);
    }
  }
  const owner = (role: string) => {
    const owners = applications.filter((app) => app.roles.includes(role));
    assert.equal(owners.length, 1, `C2 requires exactly one ${role} owner`);
    return owners[0]!;
  };
  const targets: C2Targets = {
    public: owner("web-frontend"),
    admin: owner("admin"),
    backend: owner("backend"),
  };
  for (const client of [targets.public, targets.admin]) {
    assert.equal(client.product, targets.backend.product, "C2 targets must belong to one product");
    if (client !== targets.backend)
      assert.equal(
        client.bindings.backend,
        targets.backend.id,
        `Missing resolved backend binding: ${client.id}`,
      );
  }
  if (process.env.C2_BACKEND_PORT !== undefined) {
    const port = z.coerce.number().int().min(1024).max(65535).parse(process.env.C2_BACKEND_PORT);
    assert.ok(
      targets.backend !== targets.public && targets.backend !== targets.admin,
      "C2_BACKEND_PORT only supports a separate backend; public/admin origins stay declared",
    );
    assert.ok(
      !applications.some((app) => app !== targets.backend && app.port === port),
      "C2_BACKEND_PORT conflicts with another declared application",
    );
    assert.notEqual(port, 4399, "C2_BACKEND_PORT conflicts with the protocol fixture");
    const origin = new URL(targets.backend.origin);
    origin.port = String(port);
    targets.backend.port = port;
    targets.backend.origin = origin.origin;
  }
  // Only role owners participate in HTTP acceptance; independent apps still install/check/build.
  const runtime = [...new Set([targets.backend, targets.public, targets.admin])];
  return { applications, targets, runtime };
}

export interface ApplicationEnvironment {
  [key: string]: string;
}

export function c2ApplicationEnvironment(
  app: C2Application,
  targets: C2Targets,
  environment: ApplicationEnvironment,
): ApplicationEnvironment {
  if (app === targets.backend) {
    const backend: ApplicationEnvironment = {
      ...environment,
      BETTER_AUTH_URL: targets.backend.origin,
    };
    if (targets.public !== targets.backend) backend.CORS_ORIGIN = targets.public.origin;
    else delete backend.CORS_ORIGIN;
    return backend;
  }
  if (app.bindings.backend === targets.backend.id)
    return { VITE_SERVER_URL: targets.backend.origin };
  return {};
}
