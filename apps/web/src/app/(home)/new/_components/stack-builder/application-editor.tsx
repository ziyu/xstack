"use client";

import { ApplicationIdSchema, type ApplicationSelection } from "@xstack/types";
import { Plus, X } from "lucide-react";
import { useId, useState } from "react";

import {
  APPLICATION_FRAMEWORKS,
  APPLICATION_TYPES,
  legacyApplications,
} from "@/lib/stack-applications";
import type { StackState } from "@/lib/types";
import { cn } from "@/lib/utils";

const fieldClass =
  "builder-focus-ring min-w-0 w-full rounded border border-fd-border bg-fd-background px-2 py-1.5 font-mono text-xs text-fd-foreground disabled:opacity-60";
const labelClass = "flex min-w-0 flex-col gap-1 text-xs text-fd-muted-foreground";

function frameworksFor(type: string) {
  return APPLICATION_FRAMEWORKS.filter((framework) => framework.apps[type]);
}

function occupiedReason(type: string, apps: ApplicationSelection[], product = "main") {
  const manifest = APPLICATION_TYPES.find((entry) => entry.id === type);
  if (!manifest || frameworksFor(type).length === 0) return "No framework available";
  if (manifest.scope === "independent") return undefined;
  const owners = apps.filter((app) => {
    const other = APPLICATION_TYPES.find((entry) => entry.id === app.type);
    return (
      other?.scope === "product" &&
      (app.product ?? "main") === product &&
      manifest.roles.some((role) => other.roles.includes(role))
    );
  });
  return owners.length ? `Roles occupied by ${owners.map((app) => app.id).join(", ")}` : undefined;
}

function ApplicationName({
  app,
  apps,
  onRename,
}: {
  app: ApplicationSelection;
  apps: ApplicationSelection[];
  onRename: (name: string) => void;
}) {
  const [name, setName] = useState(app.id);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  function commit() {
    const parsed = ApplicationIdSchema.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Use a lowercase kebab-case name.");
      return;
    }
    if (name !== app.id && apps.some((other) => other.id === name)) {
      setError("An application already uses this name.");
      return;
    }
    setError(null);
    if (name !== app.id) onRename(name);
  }
  return (
    <label className={labelClass}>
      Name / directory
      <input
        className={fieldClass}
        value={name}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => {
          setName(event.target.value);
          setError(null);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") {
            setName(app.id);
            setError(null);
          }
        }}
      />
      {error && (
        <span id={errorId} role="alert" className="text-destructive">
          {error}
        </span>
      )}
    </label>
  );
}

export function ApplicationEditor({
  stack,
  onChange,
  selectedIndex,
  onSelect,
}: {
  stack: StackState;
  onChange: (update: Partial<StackState>) => void;
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  const apps = stack.apps;
  if (apps === undefined) {
    const converted = legacyApplications(stack);
    const unsupported = converted.issues.length > 0;
    return (
      <section
        aria-label="Applications"
        className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded border border-dashed p-3"
      >
        <div>
          <h2 className="font-mono text-xs uppercase tracking-wider">Legacy layout</h2>
          <p className="mt-1 text-xs text-fd-muted-foreground">
            This shared stack uses project-wide technology controls.
          </p>
          {converted.issues.map((issue) => (
            <p
              key={`${issue.code}:${issue.app ?? ""}`}
              role="alert"
              className="mt-1 text-xs text-destructive"
            >
              {issue.message}
            </p>
          ))}
        </div>
        <button
          type="button"
          className="builder-focus-ring rounded border px-3 py-1.5 text-xs disabled:opacity-50"
          disabled={unsupported}
          onClick={() => onChange({ apps: converted.apps })}
        >
          Use application layout
        </button>
      </section>
    );
  }
  const index = Math.min(selectedIndex, Math.max(0, apps.length - 1));
  const app = apps[index];
  const manifest = APPLICATION_TYPES.find((entry) => entry.id === app?.type);
  const update = (next: ApplicationSelection) =>
    onChange({ apps: apps.map((entry, position) => (position === index ? next : entry)) });
  const rename = (name: string) => {
    const renamed = apps.map((entry, position) => {
      const next = { ...entry };
      if (position === index) next.id = name;
      if (entry.bindings) {
        next.bindings = Object.fromEntries(
          Object.entries(entry.bindings).map(([role, target]) => [
            role,
            target === app.id ? name : target,
          ]),
        );
      }
      return next;
    });
    onChange({ apps: renamed });
  };
  const add = (type: string) => {
    if (occupiedReason(type, apps)) return;
    const framework = frameworksFor(type)[0];
    const nextManifest = APPLICATION_TYPES.find((entry) => entry.id === type);
    if (!framework || !nextManifest) return;
    let id = nextManifest.defaultDirectoryName;
    let suffix = 2;
    while (apps.some((entry) => entry.id === id))
      id = `${nextManifest.defaultDirectoryName}-${suffix++}`;
    onChange({ apps: [...apps, { id, type, stack: { framework: framework.id } }] });
    onSelect(apps.length);
  };
  return (
    <section aria-label="Applications" className="@container mb-6 rounded border border-fd-border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.08em]">
          Applications <span className="ml-1 text-fd-muted-foreground">/ {apps.length}</span>
        </h2>
        <label className="flex items-center gap-1.5 text-xs">
          <Plus aria-hidden="true" className="h-3 w-3 text-primary" />
          <select
            aria-label="Add application"
            value=""
            className={cn(fieldClass, "w-auto max-w-64")}
            onChange={(event) => add(event.target.value)}
          >
            <option value="" disabled>
              Add application
            </option>
            {APPLICATION_TYPES.map((type) => {
              const reason = occupiedReason(type.id, apps);
              return (
                <option key={type.id} value={type.id} disabled={!!reason}>
                  {type.name}
                  {reason ? ` — ${reason}` : ""}
                </option>
              );
            })}
          </select>
        </label>
      </div>
      {apps.length > 0 ? (
        <>
          <div
            aria-label="Select application"
            className="flex flex-wrap gap-1 border-b bg-fd-muted/20 px-2 py-2"
          >
            {apps.map((entry, position) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={index === position}
                onClick={() => onSelect(position)}
                className={cn(
                  "builder-focus-ring flex items-center gap-2 rounded border px-2.5 py-1.5 font-mono text-xs",
                  index === position
                    ? "border-primary bg-fd-background text-primary"
                    : "border-transparent text-fd-muted-foreground hover:text-fd-foreground",
                )}
              >
                {entry.id}
                <span className="text-[10px] text-fd-muted-foreground">{entry.type}</span>
              </button>
            ))}
          </div>
          {app && (
            <div className="space-y-3 p-3">
              <div className="grid grid-cols-1 gap-3 @sm:grid-cols-2">
                <ApplicationName key={app.id} app={app} apps={apps} onRename={rename} />
                <label className={labelClass}>
                  Type
                  <select
                    className={fieldClass}
                    value={app.type}
                    onChange={(event) => {
                      const type = event.target.value;
                      const nextManifest = APPLICATION_TYPES.find((entry) => entry.id === type);
                      const available = frameworksFor(type);
                      if (!nextManifest) return;
                      const framework = app.stack.framework ?? available[0]?.id;
                      update({ ...app, type, stack: { ...app.stack, framework } });
                    }}
                  >
                    {!manifest && (
                      <option value={app.type}>
                        {app.type} (unknown type; restore its manifest or choose another)
                      </option>
                    )}
                    {APPLICATION_TYPES.map((type) => {
                      const reason = occupiedReason(
                        type.id,
                        apps.filter((_, position) => position !== index),
                        app.product ?? "main",
                      );
                      return (
                        <option key={type.id} value={type.id} disabled={!!reason}>
                          {type.name}
                          {reason ? ` — ${reason}` : ""}
                        </option>
                      );
                    })}
                  </select>
                </label>
              </div>
              {manifest?.description && (
                <p className="text-xs text-fd-muted-foreground">{manifest.description}</p>
              )}
              {manifest?.scope === "independent" &&
                (app.product !== undefined || app.bindings !== undefined) && (
                  <p role="alert" className="text-xs text-destructive">
                    Independent applications cannot have product assignments or bindings. Your
                    selections have been retained.{" "}
                    <button
                      type="button"
                      className="builder-focus-ring rounded underline"
                      onClick={() => {
                        const { product: _product, bindings: _bindings, ...independent } = app;
                        update(independent);
                      }}
                    >
                      Remove product assignment and bindings
                    </button>
                  </p>
                )}
              <div className="flex items-center justify-between gap-3 border-t pt-2">
                <p className="min-w-0 break-all font-mono text-[10px] text-fd-muted-foreground">
                  apps/{app.id}
                  {manifest?.scope === "independent"
                    ? " · independent"
                    : ` · ${app.product ?? "main"} product`}
                </p>
                <button
                  type="button"
                  aria-label={`Remove ${app.id} application`}
                  className="builder-focus-ring flex shrink-0 items-center gap-1 rounded px-1 py-1 text-xs text-fd-muted-foreground hover:text-destructive"
                  onClick={() =>
                    onChange({ apps: apps.filter((_, position) => position !== index) })
                  }
                >
                  <X aria-hidden="true" className="h-3 w-3" /> Remove
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="p-3 text-xs text-fd-muted-foreground">
          No applications. Add an application or choose a complete preset before previewing.
        </p>
      )}
      <p className="border-t px-3 py-2 text-[11px] text-fd-muted-foreground">
        Application roles and connections are defined by templates. Applications in the same product
        must have unique role owners; independent applications can coexist.
      </p>
    </section>
  );
}
