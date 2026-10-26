"use client";

import { applicationOptions } from "@xstack/template-generator/apps";
import type { ApplicationSelection } from "@xstack/types";
import { Check, Terminal } from "lucide-react";

import { TechIcon } from "@/components/ui/tech-icon";
import { TECH_OPTIONS } from "@/lib/constant";
import {
  APPLICATION_FRAMEWORKS,
  APPLICATION_TYPES,
  applicationCapabilities,
} from "@/lib/stack-applications";
import type { StackState } from "@/lib/types";
import { cn } from "@/lib/utils";

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
  const frameworks = APPLICATION_FRAMEWORKS.filter((framework) =>
    Object.hasOwn(framework.apps, app.type),
  );
  const adapter = frameworks.find((framework) => framework.id === app.stack.framework)?.apps[
    app.type
  ];
  const manifest = APPLICATION_TYPES.find((type) => type.id === app.type);
  const update = (next: ApplicationSelection) =>
    onChange({ apps: apps.map((entry, index) => (index === selectedIndex ? next : entry)) });
  const options = adapter ? applicationOptions(adapter) : undefined;
  const roles = [...new Set([...(manifest?.requires ?? []), ...Object.keys(app.bindings ?? {})])];

  return (
    <section aria-label={`Technology stack for ${app.id}`} className="@container mb-6 space-y-3">
      <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
        <Terminal aria-hidden="true" className="h-3 w-3 text-primary" />
        <h2 className="uppercase tracking-wider">Application technology</h2>
        <span className="text-primary">apps/{app.id}</span>
        <span className="text-fd-muted-foreground">{manifest?.name ?? app.type}</span>
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-xs text-fd-muted-foreground">
          {manifest?.technologyLabel ?? `${manifest?.name ?? app.type} implementation`}
        </legend>
        <div className="grid grid-cols-1 gap-2 @md:grid-cols-2 @min-[864px]:grid-cols-3">
          {frameworks.map((framework) => {
            const selected = app.stack.framework === framework.id;
            return (
              <button
                key={framework.id}
                type="button"
                aria-pressed={selected}
                aria-label={`Use ${framework.name ?? framework.id} for ${app.id}`}
                onClick={() => {
                  if (!selected)
                    update({ ...app, stack: { ...app.stack, framework: framework.id } });
                }}
                className={cn(
                  "builder-focus-ring flex items-center justify-between gap-3 rounded border p-3 text-left text-sm",
                  selected
                    ? "border-primary bg-primary/5"
                    : "border-fd-border hover:border-primary/50",
                )}
              >
                <span className="flex items-center gap-2">
                  {framework.icon && (
                    <TechIcon icon={framework.icon} name={framework.name ?? framework.id} />
                  )}
                  <span>
                    <span className="block">{framework.name ?? framework.id}</span>
                    {framework.description && (
                      <span className="block text-xs text-fd-muted-foreground">
                        {framework.description}
                      </span>
                    )}
                  </span>
                </span>
                {selected && <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>
        {!adapter && (
          <p role="alert" className="text-xs text-destructive">
            {app.stack.framework
              ? `Selected framework ${app.stack.framework} is unavailable for ${app.type}.`
              : "No framework selected."}{" "}
            Choose an available implementation or restore its template declaration.
          </p>
        )}
      </fieldset>
      {adapter &&
        options &&
        (["runtime", "api"] as const).map((key) => {
          const control = options[key];
          const value = app.stack[key] ?? adapter.stack[key] ?? "none";
          const overridden = app.stack[key] !== undefined && app.stack[key] !== adapter.stack[key];
          if (control.visibility === "hidden" && !overridden) return null;
          const supported = control.values.some((candidate) => candidate === value);
          const label = key === "api" ? "API protocol" : "Runtime";
          const field = (
            <label className="block space-y-1 text-xs text-fd-muted-foreground">
              {label} for {app.id}
              <select
                className={fieldClass}
                aria-invalid={!supported}
                disabled={control.values.length === 1 && supported && !overridden}
                value={value}
                onChange={(event) => {
                  const next = control.values.find((candidate) => candidate === event.target.value);
                  if (next) update({ ...app, stack: { ...app.stack, [key]: next } });
                }}
              >
                {!supported && <option value={value}>{value} (unsupported)</option>}
                {control.values.map((id) => (
                  <option key={id} value={id}>
                    {TECH_OPTIONS[key].find((option) => option.id === id)?.name ?? id}
                  </option>
                ))}
              </select>
              {!supported && (
                <span role="alert" className="block text-destructive">
                  Select a declared {key} option or update this adapter's declaration.
                </span>
              )}
              {app.stack[key] !== undefined && (
                <button
                  type="button"
                  className="builder-focus-ring rounded underline"
                  onClick={() => {
                    const next = { ...app.stack };
                    delete next[key];
                    update({ ...app, stack: next });
                  }}
                >
                  Use adapter default ({adapter.stack[key] ?? "none"})
                </button>
              )}
            </label>
          );
          return control.visibility === "visible" ? (
            <div key={key}>{field}</div>
          ) : (
            <details
              key={key}
              open={!supported || undefined}
              className="rounded border border-fd-border p-3"
            >
              <summary className="builder-focus-ring cursor-pointer text-xs text-fd-muted-foreground">
                Advanced · {label}
              </summary>
              <div className="mt-3 max-w-sm">{field}</div>
            </details>
          );
        })}
      <div className="grid gap-3 @md:grid-cols-2">
        {roles.map((role) => {
          const required = manifest?.requires.includes(role);
          const targets = apps.filter((candidate) => {
            const owner = APPLICATION_TYPES.find((type) => type.id === candidate.type);
            return (
              owner?.scope === "product" &&
              (candidate.product ?? "main") === (app.product ?? "main") &&
              owner.roles.includes(role)
            );
          });
          const target = app.bindings?.[role];
          const connected = target
            ? targets.find((entry) => entry.id === target)
            : targets.length === 1
              ? targets[0]
              : undefined;
          const connectedAdapter = APPLICATION_FRAMEWORKS.find(
            (framework) => framework.id === connected?.stack.framework,
          )?.apps[connected?.type ?? ""];
          return (
            <label key={role} className="space-y-1 text-xs text-fd-muted-foreground">
              {role} connection for {app.id}
              {!required && " (not required by this application)"}
              <select
                className={fieldClass}
                value={target ?? ""}
                onChange={(event) => {
                  const bindings = { ...app.bindings };
                  if (event.target.value) bindings[role] = event.target.value;
                  else delete bindings[role];
                  update({ ...app, bindings: Object.keys(bindings).length ? bindings : undefined });
                }}
              >
                <option value="">
                  {!required
                    ? "Remove binding"
                    : targets.length === 1
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
              {role === "backend" && connected && (
                <span className="block">
                  API protocol: {connected.stack.api ?? connectedAdapter?.stack.api ?? "none"} ·
                  configured by {connected.id}
                </span>
              )}
            </label>
          );
        })}
      </div>
      {applicationCapabilities(stack)
        .notes.filter((note) => note.startsWith(`${app.id}:`))
        .map((note) => (
          <p
            key={note}
            className="rounded border border-amber-500/30 p-2 text-xs text-amber-700 dark:text-amber-300"
          >
            {note}
          </p>
        ))}
      <p className="text-xs text-fd-muted-foreground">
        Implementations and options come from template declarations. Changing implementations
        preserves explicit selections; incompatible values must be resolved before generating.
      </p>
    </section>
  );
}
