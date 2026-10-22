import type { ProjectConfig } from "@xstack/types";

export type Localized = { en: string; "zh-CN": string };

export type Market = "global" | "cn" | "any";

export type Framework = ProjectConfig["frontend"][number];

export type Dialect = "sqlite" | "postgres";

export type DeployTarget = "vercel" | "docker" | "cloudflare" | "node" | "none";

export type ModuleCategory =
  | "foundation"
  | "identity"
  | "monetization"
  | "communication"
  | "content"
  | "ai"
  | "operations";

export type EnvSpec = {
  key: string;
  /** Required at startup. Optional keys are validated only when present. */
  required?: boolean;
  public?: boolean;
  sensitive?: boolean;
  type?: "string" | "url" | "number" | "boolean" | "secret" | "enum";
  /** Allowed values when `type` is `"enum"`. */
  values?: string[];
  /** Value written to the generated `.env`. */
  example?: string;
  /** Default written to `.env.schema`, used when the variable is unset. */
  default?: string;
  comment?: string;
};

export type Support = {
  frameworks?: Framework[];
  backends?: ProjectConfig["backend"][];
  orms?: ProjectConfig["orm"][];
  apis?: ProjectConfig["api"][];
  dialects?: Dialect[];
  targets?: DeployTarget[];
};

/** Stack fields owned by domain modules: derived from the plan, never chosen directly. */
export type DomainField = "auth";

export type DomainInput = { providers: string[]; options: ModuleOptionValues };

export type ModuleDomain = {
  field: DomainField;
  /** Field value while the module is present. */
  value: (module: DomainInput) => string;
  /** Extra condition for the native implementation, beyond `supports`. */
  native?: (module: DomainInput) => boolean;
  /**
   * Implementation by the stack templates, used where the native one is unavailable.
   * Module templates, providers' env and integrations do not apply to it.
   */
  stack?: {
    supports?: Support;
    /** Providers it accepts; defaults are dropped and explicit other providers are errors. */
    providers?: string[];
    /** Modules it needs, which must use their stack implementation too. */
    requires?: string[];
    /** Renderer key resolved by the generation pipeline, never a browser-imported function. */
    renderer: "auth";
  };
};

export type Variant = "native" | "stack";

export type ProviderSpec = {
  name: string;
  market: Market;
  env?: EnvSpec[];
  /** Dependencies added to the module's workspace package. */
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  supports?: Support;
};

export type ProvidersSpec = {
  /** Minimum number of providers that must be selected. */
  min?: number;
  /** Maximum number of providers (1 = single choice). */
  max?: number;
  default?: { global: string[]; cn: string[] };
  options: Record<string, ProviderSpec>;
};

export type OptionSpec =
  | { type: "enum"; values: string[]; default: string; description?: string }
  | { type: "boolean"; default: boolean; description?: string }
  | { type: "number"; default: number; min?: number; description?: string }
  | { type: "string"; default: string; description?: string };

export type WorkspacePackageSpec = {
  /** Directory under `packages/`, also the workspace package suffix (`@app/<dir>`). */
  dir: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  /** Other workspace packages this one imports, by directory name. */
  workspaceDependencies?: string[];
};

export type ServiceSpec = {
  /** Exported binding name in `services.ts`; replaces a stack-generated binding of the same name. */
  name: string;
  imports: { from: string; names: string[] }[];
  /** Initializer expression; may reference `ENV` and previously declared services. */
  init: string;
};

export type NavArea = "main" | "dashboard" | "admin" | "footer";

export type NavItem = {
  area: NavArea;
  href: string;
  /** i18n key under the module's message namespace, e.g. `nav.pricing`. */
  labelKey: string;
  order?: number;
  /** Only show to signed-in users. */
  auth?: boolean;
  /** Only show to users with this role. */
  role?: string;
  /** Only include when this module is also present. */
  when?: string;
};

export type ProxyStep = {
  id: string;
  /** Import path relative to `apps/web/src`. */
  from: string;
  /** Named export of type `ProxyStep`. */
  name: string;
  order: number;
};

export type ModuleManifest = {
  id: string;
  name: Localized;
  description: Localized;
  category: ModuleCategory;
  /** Foundation modules are added automatically and not shown in the feature picker. */
  hidden?: boolean;
  requires?: string[];
  /** Soft dependencies: when both modules are present, `integrations/<other>` templates render. */
  enhances?: string[];
  conflicts?: string[];
  /** Where the native implementation (the module's own templates) works. */
  supports?: Support;
  domain?: ModuleDomain;
  providers?: ProvidersSpec;
  options?: Record<string, OptionSpec>;
  packages?: WorkspacePackageSpec[];
  /** Dependencies added to `apps/web`. */
  appDependencies?: Record<string, string>;
  env?: EnvSpec[];
  services?: ServiceSpec[];
  nav?: NavItem[];
  proxy?: ProxyStep[];
  /** Stack-generated files this module supersedes (exact paths or `dir/` prefixes); each must exist. */
  replaces?: string[];
};

export type OptionValue = string | number | boolean;

export type ModuleOptionValues = Record<string, OptionValue>;

export type ModuleSelection = {
  features: string[];
  providers: Record<string, string[]>;
  options: Record<string, ModuleOptionValues>;
};

export type ResolvedModule = {
  manifest: ModuleManifest;
  variant: Variant;
  providers: string[];
  options: ModuleOptionValues;
  /** Why the module is present. */
  reason: { kind: "selected" } | { kind: "required-by"; by: string } | { kind: "foundation" };
  /** Enhanced modules that are also present. */
  integrations: string[];
};

export type ResolveIssue = {
  level: "error" | "warning";
  module?: string;
  message: string;
};

export type ResolvedPlan = {
  /** Modules in dependency order. */
  modules: ResolvedModule[];
  issues: ResolveIssue[];
  /** Human-readable notes about automatic changes. */
  notes: string[];
  /** Domain fields implied by the modules; absent fields are `"none"`. */
  domains: Partial<Record<DomainField, string>>;
};

export type StackContext = Pick<
  ProjectConfig,
  "frontend" | "backend" | "database" | "orm" | "api" | "webDeploy" | "projectName"
>;
