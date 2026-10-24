"use client";

import {
  allowedApisForFrontends,
  supportsRuntimeBackend,
  type ApplicationSelection,
} from "@xstack/types";
import { Check, Terminal } from "lucide-react";

import { TechIcon } from "@/components/ui/tech-icon";
import { TECH_OPTIONS } from "@/lib/constant";
import { APPLICATION_FRAMEWORKS, APPLICATION_TYPES } from "@/lib/stack-applications";
import type { StackState } from "@/lib/types";
import { cn } from "@/lib/utils";

const labels = [
  ...TECH_OPTIONS.webFrontend,
  ...TECH_OPTIONS.nativeFrontend,
  ...TECH_OPTIONS.backend,
  ...TECH_OPTIONS.runtime,
];
const fieldClass =
  "builder-focus-ring w-full rounded border border-fd-border bg-fd-background px-2 py-2 text-sm";

export function ApplicationTechnology({
  stack,
  selectedIndex,
  onChange,
}: {
  stack: StackState;
  selectedIndex: number;
  onChange: (update: Partial<StackState>) => void;
}) {
  const apps = stack.apps;
  const app = apps?.[selectedIndex];
  if (!apps || !app) return null;
  // Only adapters backed by real apps/<type> contributions are present in this catalog.
  const frameworks = APPLICATION_FRAMEWORKS.filter((framework) =>
    Object.hasOwn(framework.apps, app.type),
  );
  const adapter = frameworks.find((framework) => framework.id === app.stack.framework)?.apps[
    app.type
  ];
  const manifest = APPLICATION_TYPES.find((type) => type.id === app.type);
  const update = (next: ApplicationSelection) =>
    onChange({ apps: apps.map((entry, index) => (index === selectedIndex ? next : entry)) });
  const runtimeOptions = TECH_OPTIONS.runtime.filter((option) =>
    adapter?.stack.backend && adapter.stack.backend !== "none"
      ? supportsRuntimeBackend(option.id, adapter.stack.backend)
      : option.id === (adapter?.stack.runtime ?? "none"),
  );
  const apiOptions = TECH_OPTIONS.api.filter(
    (option) =>
      (option.id === "none" ||
        (adapter?.stack.backend && !["none", "convex"].includes(adapter.stack.backend))) &&
      allowedApisForFrontends(adapter?.stack.frontend).includes(option.id),
  );
  const backend = apps.find((candidate) =>
    app.bindings?.backend
      ? candidate.id === app.bindings.backend
      : (candidate.product ?? "main") === (app.product ?? "main") &&
        APPLICATION_TYPES.find((type) => type.id === candidate.type)?.roles.includes("backend"),
  );
  const backendAdapter = APPLICATION_FRAMEWORKS.find(
    (framework) => framework.id === backend?.stack.framework,
  )?.apps[backend?.type ?? ""];
  const protocol = backend?.stack.api ?? backendAdapter?.stack.api ?? "none";
  const title =
    app.type === "fullstack-web"
      ? "Fullstack framework"
      : app.type === "backend"
        ? "Backend framework"
        : app.type === "cli"
          ? "CLI implementation"
          : app.type === "native"
            ? "Native framework"
            : "Frontend framework";

  return (
    <section aria-label={`Technology stack for ${app.id}`} className="@container mb-6 space-y-3">
      <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
        <Terminal aria-hidden="true" className="h-3 w-3 text-primary" />
        <h2 className="uppercase tracking-wider">Application technology</h2>
        <span className="text-primary">apps/{app.id}</span>
        <span className="text-fd-muted-foreground">{manifest?.name ?? app.type}</span>
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-xs text-fd-muted-foreground">{title}</legend>
        <div className="grid grid-cols-1 gap-2 @md:grid-cols-2 @min-[864px]:grid-cols-3">
          {frameworks.map((framework) => {
            const label = labels.find((option) => option.id === framework.id);
            const selected = app.stack.framework === framework.id;
            return (
              <button
                key={framework.id}
                type="button"
                aria-pressed={selected}
                aria-label={`Use ${label?.name ?? framework.id} for ${app.id}`}
                onClick={() => {
                  if (!selected) update({ ...app, stack: { framework: framework.id } });
                }}
                className={cn(
                  "builder-focus-ring flex items-center justify-between gap-3 rounded border p-3 text-left text-sm",
                  selected
                    ? "border-primary bg-primary/5"
                    : "border-fd-border hover:border-primary/50",
                )}
              >
                <span className="flex items-center gap-2">
                  {label?.icon && <TechIcon icon={label.icon} name={label.name} />}
                  <span>{label?.name ?? framework.id}</span>
                </span>
                {selected && <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>
        {!adapter && (
          <p role="alert" className="text-xs text-destructive">
            Select an implemented framework for this application type.
          </p>
        )}
      </fieldset>
      <div className="grid gap-3 @md:grid-cols-2">
        {adapter &&
          (runtimeOptions.length > 1 ||
            (app.stack.runtime ?? adapter.stack.runtime ?? "none") !== "none") && (
            <label className="space-y-1 text-xs text-fd-muted-foreground">
              Runtime for {app.id}
              <select
                className={fieldClass}
                disabled={runtimeOptions.length === 1}
                value={app.stack.runtime ?? adapter.stack.runtime ?? "none"}
                onChange={(event) => {
                  const runtime = runtimeOptions.find(
                    (option) => option.id === event.target.value,
                  )?.id;
                  if (runtime) update({ ...app, stack: { ...app.stack, runtime } });
                }}
              >
                {app.stack.runtime &&
                  !runtimeOptions.some((option) => option.id === app.stack.runtime) && (
                    <option value={app.stack.runtime}>{app.stack.runtime} (unsupported)</option>
                  )}
                {runtimeOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        {manifest?.requires.map((role) => {
          const targets = apps.filter(
            (candidate) =>
              (candidate.product ?? "main") === (app.product ?? "main") &&
              APPLICATION_TYPES.find((type) => type.id === candidate.type)?.roles.includes(role),
          );
          const target = app.bindings?.[role];
          return (
            <label key={role} className="space-y-1 text-xs text-fd-muted-foreground">
              {role} connection for {app.id}
              <select
                className={fieldClass}
                value={target ?? ""}
                onChange={(event) => {
                  const bindings = { ...app.bindings };
                  if (event.target.value) bindings[role] = event.target.value;
                  else delete bindings[role];
                  update({ ...app, bindings });
                }}
              >
                <option value="">
                  {targets.length === 1
                    ? `Automatic · ${targets[0].id}`
                    : "Select a matching application"}
                </option>
                {target && !targets.some((entry) => entry.id === target) && (
                  <option value={target}>{target} (missing or incompatible)</option>
                )}
                {targets.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.id}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
      {manifest?.requires.includes("backend") && backend && (
        <p className="text-xs text-fd-muted-foreground">
          API protocol: {protocol === "none" ? "Framework HTTP routes" : protocol} · configured by{" "}
          {backend.id}
        </p>
      )}
      {adapter &&
        (app.type === "backend" ||
          (app.stack.api !== undefined && app.stack.api !== adapter.stack.api)) && (
          <details className="rounded border border-fd-border p-3">
            <summary className="builder-focus-ring cursor-pointer text-xs text-fd-muted-foreground">
              Advanced · API protocol
            </summary>
            <label className="mt-3 block max-w-sm space-y-1 text-xs text-fd-muted-foreground">
              API protocol for {app.id}
              <select
                className={fieldClass}
                value={app.stack.api ?? adapter.stack.api ?? "none"}
                onChange={(event) => {
                  const api = apiOptions.find((option) => option.id === event.target.value)?.id;
                  if (api) update({ ...app, stack: { ...app.stack, api } });
                }}
              >
                {app.stack.api && !apiOptions.some((option) => option.id === app.stack.api) && (
                  <option value={app.stack.api}>{app.stack.api} (unsupported)</option>
                )}
                {apiOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.id === "none" ? "Framework HTTP routes" : option.name}
                  </option>
                ))}
              </select>
            </label>
          </details>
        )}
      <p className="text-xs text-fd-muted-foreground">
        Only implementations available for this application type are shown. Other applications keep
        their own selections.
      </p>
    </section>
  );
}
