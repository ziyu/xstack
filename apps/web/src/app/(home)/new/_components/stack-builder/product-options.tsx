"use client";

import {
  MODULE_CATALOG,
  type OptionSpec,
  type OptionValue,
} from "@xstack/template-generator/modules";
import { Terminal } from "lucide-react";
import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import type { StackState } from "@/lib/constant";
import { productPlan } from "@/lib/stack-features";

const controlClass =
  "builder-focus-ring w-full rounded-[4px] border border-fd-border bg-fd-background px-2.5 py-2 font-mono text-xs text-fd-foreground";

function OptionControl({
  id,
  name,
  spec,
  value,
  onChange,
}: {
  id: string;
  name: string;
  spec: OptionSpec;
  value: OptionValue;
  onChange: (value: OptionValue) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? String(value);
  const invalid =
    spec.type === "number" &&
    (text.trim() === "" ||
      !Number.isFinite(Number(text)) ||
      (spec.min !== undefined && Number(text) < spec.min));
  const helpId = `${id}-help`;
  useEffect(() => setDraft(null), [value]);
  const errorId = `${id}-error`;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs text-fd-foreground">
        {name}
      </label>
      {spec.type === "enum" ? (
        <select
          id={id}
          className={controlClass}
          value={String(value)}
          aria-describedby={helpId}
          onChange={(event) => onChange(event.target.value)}
        >
          {!spec.values.includes(String(value)) && (
            <option value={String(value)}>{String(value)} (unsupported)</option>
          )}
          {spec.values.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      ) : spec.type === "boolean" ? (
        <input
          id={id}
          type="checkbox"
          className="builder-focus-ring size-4 accent-primary"
          checked={value === true}
          aria-describedby={helpId}
          onChange={(event) => onChange(event.target.checked)}
        />
      ) : (
        <Input
          id={id}
          className={controlClass}
          type={spec.type === "number" ? "number" : "text"}
          min={spec.type === "number" ? spec.min : undefined}
          step={spec.type === "number" ? "any" : undefined}
          value={text}
          aria-invalid={invalid || undefined}
          aria-describedby={`${helpId}${invalid ? ` ${errorId}` : ""}`}
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next);
            if (spec.type === "number") {
              const number = Number(next);
              if (
                next.trim() !== "" &&
                Number.isFinite(number) &&
                (spec.min === undefined || number >= spec.min)
              ) {
                onChange(number);
              }
            } else {
              onChange(next);
            }
          }}
        />
      )}
      <p id={helpId} className="text-[11px] leading-relaxed text-fd-muted-foreground">
        {spec.description ?? `Configure ${name}.`}
        {spec.type === "string" &&
          " An empty value is saved as an empty string; use reset to restore the default."}
      </p>
      {invalid && (
        <p id={errorId} role="alert" className="text-[11px] text-destructive">
          Enter a finite number
          {spec.type === "number" && spec.min !== undefined
            ? ` greater than or equal to ${spec.min}`
            : ""}
          . This edit has not been applied.
        </p>
      )}
    </div>
  );
}

export function ProductOptions({
  stack,
  onChange,
  idPrefix,
}: {
  stack: StackState;
  onChange: (update: Partial<StackState>) => void;
  idPrefix: string;
}) {
  const plan = productPlan(stack);

  function setProviders(moduleId: string, providers: string[]) {
    onChange({
      features: stack.features,
      providers: { ...stack.providers, [moduleId]: providers },
      moduleOptions: stack.moduleOptions,
    });
  }

  function setOption(moduleId: string, key: string, value: OptionValue | undefined) {
    const options = { ...stack.moduleOptions[moduleId] };
    if (value === undefined) delete options[key];
    else options[key] = value;
    const moduleOptions = { ...stack.moduleOptions };
    if (Object.keys(options).length) moduleOptions[moduleId] = options;
    else delete moduleOptions[moduleId];
    onChange({ features: stack.features, providers: stack.providers, moduleOptions });
  }

  return (
    <section aria-labelledby={`${idPrefix}-title`} className="mb-6 space-y-3 font-mono">
      <div className="flex items-center gap-2">
        <Terminal aria-hidden="true" className="size-3 shrink-0 text-primary" />
        <h2
          id={`${idPrefix}-title`}
          className="text-[11px] uppercase tracking-[0.08em] text-fd-muted-foreground"
        >
          Product configuration
        </h2>
        <span aria-hidden="true" className="h-px flex-1 bg-fd-border" />
      </div>
      <p className="text-xs leading-relaxed text-fd-muted-foreground">
        Configure the generated product, including its automatic dependencies. Defaults and
        compatibility come from the generator catalog.
      </p>
      {plan.issues.length > 0 && (
        <div
          role={plan.issues.some((issue) => issue.level === "error") ? "alert" : "status"}
          className="space-y-2 rounded-[4px] border border-amber-500/40 p-3"
        >
          <h3 className="text-xs font-medium">Generator diagnostics</h3>
          <ul className="space-y-2 text-[11px] leading-relaxed">
            {plan.issues.map((issue, index) => (
              <li key={`${issue.module}-${index}`}>
                <span
                  className={
                    issue.level === "error"
                      ? "text-destructive"
                      : "text-amber-700 dark:text-amber-300"
                  }
                >
                  {issue.level.toUpperCase()}
                </span>
                {" · "}
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {plan.modules.length === 0 && (
        <p className="rounded-[4px] border border-dashed border-fd-border p-3 text-xs text-fd-muted-foreground">
          No product modules resolve for this stack. Select a feature to see its configuration and
          requirements.
        </p>
      )}
      {plan.modules.map((module) => {
        const { manifest, reason } = module;
        const moduleId = `${idPrefix}-${manifest.id}`;
        const providerSpec = manifest.providers;
        const providers = stack.providers[manifest.id] ?? module.providers;
        const environment =
          module.variant === "native"
            ? [
                ...(manifest.env ?? []),
                ...module.providers.flatMap(
                  (provider) => manifest.providers?.options[provider]?.env ?? [],
                ),
              ]
            : [];
        const uniqueEnvironment = [...new Map(environment.map((env) => [env.key, env])).values()];

        return (
          <article
            key={manifest.id}
            aria-labelledby={`${moduleId}-title`}
            className="space-y-4 rounded-[4px] border border-fd-border p-3"
          >
            <header className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id={`${moduleId}-title`} className="text-[13px] text-fd-foreground">
                  {manifest.name.en}
                </h3>
                <span className="text-[10px] uppercase tracking-wide text-fd-muted-foreground">
                  {module.variant === "stack" ? "Stack templates" : manifest.category}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-fd-muted-foreground">
                {manifest.description.en}
              </p>
              <p className="text-[11px] text-primary">
                {reason.kind === "selected"
                  ? "Selected feature"
                  : reason.kind === "foundation"
                    ? "Automatically included foundation"
                    : `Automatically added · required by ${MODULE_CATALOG.get(reason.by)?.name.en ?? reason.by}`}
              </p>
              {module.integrations.length > 0 && (
                <p className="text-[11px] text-fd-muted-foreground">
                  Integrations ·{" "}
                  {module.integrations
                    .map((id) => MODULE_CATALOG.get(id)?.name.en ?? id)
                    .join(", ")}
                </p>
              )}
            </header>
            {providerSpec && (
              <fieldset className="space-y-2" aria-describedby={`${moduleId}-providers-help`}>
                <legend className="mb-1 text-xs">Providers</legend>
                <p
                  id={`${moduleId}-providers-help`}
                  className="text-[11px] text-fd-muted-foreground"
                >
                  {providerSpec.max === 1
                    ? "Choose one provider."
                    : `Choose at least ${providerSpec.min ?? 0}${providerSpec.max === undefined ? "" : ` and at most ${providerSpec.max}`} providers.`}
                  {manifest.id === "auth" &&
                    " Uncheck all providers to disable OAuth; email/password authentication remains available with the native engine."}
                  {manifest.id === "auth" &&
                    providers.includes("wechat") &&
                    " WeChat requires an approved Open Platform website application and a public callback domain. Set its AppID/AppSecret only in the generated server environment."}
                </p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(providerSpec.options).map(([providerId, provider]) => {
                    const checked = providers.includes(providerId);
                    const disabled =
                      providerSpec.max !== 1 &&
                      ((checked && providers.length <= (providerSpec.min ?? 0)) ||
                        (!checked &&
                          providerSpec.max !== undefined &&
                          providers.length >= providerSpec.max));
                    const id = `${moduleId}-provider-${providerId}`;
                    return (
                      <label
                        key={providerId}
                        htmlFor={id}
                        className={`flex min-h-9 items-center gap-2 rounded-[4px] border px-2.5 py-2 text-xs ${checked ? "border-primary text-primary" : "border-fd-border"}`}
                      >
                        <input
                          id={id}
                          name={`${moduleId}-providers`}
                          type={providerSpec.max === 1 ? "radio" : "checkbox"}
                          className="builder-focus-ring size-3.5 accent-primary disabled:cursor-not-allowed"
                          checked={checked}
                          disabled={disabled}
                          onChange={() =>
                            setProviders(
                              manifest.id,
                              providerSpec.max === 1
                                ? [providerId]
                                : checked
                                  ? providers.filter((id) => id !== providerId)
                                  : [...providers, providerId],
                            )
                          }
                        />
                        {provider.name}
                      </label>
                    );
                  })}
                </div>
                {module.variant === "stack" && (
                  <p className="text-[11px] leading-relaxed text-fd-muted-foreground">
                    This module currently uses stack templates, not its native product
                    implementation. Unsupported provider choices are reported above.
                  </p>
                )}
              </fieldset>
            )}
            {Object.entries(manifest.options ?? {}).map(([key, spec]) => (
              <div key={key} className="space-y-1.5">
                <OptionControl
                  id={`${moduleId}-option-${key}`}
                  name={key}
                  spec={spec}
                  value={module.options[key] ?? spec.default}
                  onChange={(value) => setOption(manifest.id, key, value)}
                />
                {Object.hasOwn(stack.moduleOptions[manifest.id] ?? {}, key) && (
                  <button
                    type="button"
                    className="builder-focus-ring text-[11px] text-fd-muted-foreground underline underline-offset-4 hover:text-fd-foreground"
                    onClick={() => setOption(manifest.id, key, undefined)}
                  >
                    Reset {key} to catalog default
                  </button>
                )}
              </div>
            ))}
            {(manifest.id === "email" || manifest.id === "payment") && (
              <p className="border-l-2 border-amber-500/50 pl-2 text-[11px] leading-relaxed text-fd-muted-foreground">
                {manifest.id === "email"
                  ? "Production email delivery requires configured provider credentials and a valid sender. Configure them in the generated environment, never here."
                  : "Mock payments are development-only. Production payments require a real provider, its credentials, webhook configuration and product/price setup. Polar defaults to sandbox; switch its environment to production before launch."}
              </p>
            )}
            {manifest.id === "sms" && (
              <p className="border-l-2 border-amber-500/50 pl-2 text-[11px] leading-relaxed text-fd-muted-foreground">
                Select Authentication as well to enable phone-number signup and login. Real SMS
                delivery needs provider credentials and approved sender/template settings. Console
                delivery is explicitly development-only; never enter credentials here.
              </p>
            )}
            {uniqueEnvironment.length > 0 && (
              <details className="border-t border-fd-border pt-3">
                <summary className="builder-focus-ring cursor-pointer text-xs text-fd-muted-foreground">
                  Environment setup · {uniqueEnvironment.length} keys
                </summary>
                <p className="mt-2 text-[11px] leading-relaxed text-fd-muted-foreground">
                  Set values locally or in your deployment environment. No secrets are collected or
                  stored by this builder. Optional at startup does not mean optional to use a
                  provider.
                </p>
                <dl className="mt-3 space-y-3">
                  {uniqueEnvironment.map((env) => (
                    <div key={env.key}>
                      <dt className="break-all text-[11px] text-fd-foreground">{env.key}</dt>
                      <dd className="mt-0.5 text-[11px] leading-relaxed text-fd-muted-foreground">
                        {env.required ? "Required at startup." : "Validated when configured."}
                        {env.comment && ` ${env.comment}`}
                        {env.values && ` Allowed values: ${env.values.join(", ")}.`}
                        {env.default !== undefined && ` Default: ${env.default}.`}
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
          </article>
        );
      })}
      {plan.notes.length > 0 && (
        <details className="rounded-[4px] border border-fd-border p-3">
          <summary className="builder-focus-ring cursor-pointer text-xs text-fd-muted-foreground">
            Resolution notes · {plan.notes.length}
          </summary>
          <ul className="mt-3 space-y-2 text-[11px] leading-relaxed text-fd-muted-foreground">
            {plan.notes.map((note, index) => (
              <li key={`${index}-${note}`}>{note}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
