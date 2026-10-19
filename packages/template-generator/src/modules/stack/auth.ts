import type { VirtualFileSystem } from "../../core/virtual-fs";
import {
  type TemplateData,
  processSingleTemplate,
  processTemplatesFromPrefix,
} from "../../template-handlers/utils";
import type { RenderConfig } from "../../types";

const STACK = "modules/auth/stack";

export async function processAuthTemplates(
  vfs: VirtualFileSystem,
  templates: TemplateData,
  config: RenderConfig,
): Promise<void> {
  if (!config.auth || config.auth === "none") return;

  const hasReactWeb = config.frontend.some((f) =>
    ["tanstack-router", "react-router", "tanstack-start", "next"].includes(f),
  );
  const hasNuxtWeb = config.frontend.includes("nuxt");
  const hasSvelteWeb = config.frontend.includes("svelte");
  const hasSolidWeb = config.frontend.includes("solid");
  const hasAstroWeb = config.frontend.includes("astro");
  const hasNativeBare = config.frontend.includes("native-bare");
  const hasUniwind = config.frontend.includes("native-uniwind");
  const hasUnistyles = config.frontend.includes("native-unistyles");
  const hasNative = hasNativeBare || hasUniwind || hasUnistyles;

  const authProvider = config.auth;

  if (config.backend === "convex" && authProvider === "clerk") {
    processTemplatesFromPrefix(
      vfs,
      templates,
      `${STACK}/clerk/convex/backend`,
      "packages/backend",
      config,
    );

    if (hasReactWeb) {
      const reactFramework = config.frontend.find((f) =>
        ["tanstack-router", "react-router", "tanstack-start", "next"].includes(f),
      );
      if (reactFramework) {
        processTemplatesFromPrefix(
          vfs,
          templates,
          `${STACK}/clerk/convex/web/react/${reactFramework}`,
          "apps/web",
          config,
        );
      }
    }

    if (hasNative) {
      processTemplatesFromPrefix(
        vfs,
        templates,
        `${STACK}/clerk/convex/native/base`,
        "apps/native",
        config,
      );

      let nativeFramework = "";
      if (hasNativeBare) nativeFramework = "bare";
      else if (hasUniwind) nativeFramework = "uniwind";
      else if (hasUnistyles) nativeFramework = "unistyles";

      if (nativeFramework) {
        processTemplatesFromPrefix(
          vfs,
          templates,
          `${STACK}/clerk/convex/native/${nativeFramework}`,
          "apps/native",
          config,
        );
      }
    }
    return;
  }

  if (config.backend === "convex" && authProvider === "better-auth") {
    processTemplatesFromPrefix(
      vfs,
      templates,
      `${STACK}/better-auth/convex/backend`,
      "packages/backend",
      config,
    );

    if (hasReactWeb) {
      processTemplatesFromPrefix(
        vfs,
        templates,
        `${STACK}/better-auth/convex/web/react/base`,
        "apps/web",
        config,
      );

      const reactFramework = config.frontend.find((f) =>
        ["tanstack-router", "react-router", "tanstack-start", "next"].includes(f),
      );
      if (reactFramework) {
        processTemplatesFromPrefix(
          vfs,
          templates,
          `${STACK}/better-auth/convex/web/react/${reactFramework}`,
          "apps/web",
          config,
        );
      }
    }

    if (hasNative) {
      processTemplatesFromPrefix(
        vfs,
        templates,
        `${STACK}/better-auth/convex/native/base`,
        "apps/native",
        config,
      );

      let nativeFramework = "";
      if (hasNativeBare) nativeFramework = "bare";
      else if (hasUniwind) nativeFramework = "uniwind";
      else if (hasUnistyles) nativeFramework = "unistyles";

      if (nativeFramework) {
        processTemplatesFromPrefix(
          vfs,
          templates,
          `${STACK}/better-auth/convex/native/${nativeFramework}`,
          "apps/native",
          config,
        );
      }
    }
    return;
  }

  if (config.backend !== "convex" && config.backend !== "none") {
    processTemplatesFromPrefix(
      vfs,
      templates,
      `${STACK}/${authProvider}/server/base`,
      "packages/auth",
      config,
    );

    if (config.orm !== "none" && config.database !== "none") {
      processTemplatesFromPrefix(
        vfs,
        templates,
        `${STACK}/${authProvider}/server/db/${config.orm}/${config.database}`,
        "packages/db",
        config,
      );
    }

    if (hasSolidWeb && authProvider === "better-auth") {
      processTemplatesFromPrefix(
        vfs,
        templates,
        `${STACK}/better-auth/client/solid`,
        "packages/auth",
        config,
      );
      processSingleTemplate(
        vfs,
        templates,
        `${STACK}/better-auth/client/auth-client.ts`,
        "apps/web/src/client.ts",
        config,
      );
    }
  }

  if (hasReactWeb) {
    processTemplatesFromPrefix(
      vfs,
      templates,
      `${STACK}/${authProvider}/web/react/base`,
      "apps/web",
      config,
    );

    const reactFramework = config.frontend.find((f) =>
      ["tanstack-router", "react-router", "tanstack-start", "next"].includes(f),
    );
    if (reactFramework) {
      processTemplatesFromPrefix(
        vfs,
        templates,
        `${STACK}/${authProvider}/web/react/${reactFramework}`,
        "apps/web",
        config,
      );

      if (
        config.backend === "self" &&
        (reactFramework === "next" || reactFramework === "tanstack-start")
      ) {
        processTemplatesFromPrefix(
          vfs,
          templates,
          `${STACK}/${authProvider}/fullstack/${reactFramework}`,
          "apps/web",
          config,
        );
      }
    }
  } else if (hasNuxtWeb) {
    if (config.backend === "self") {
      processTemplatesFromPrefix(
        vfs,
        templates,
        `${STACK}/${authProvider}/fullstack/nuxt`,
        "apps/web",
        config,
      );
    }
    processTemplatesFromPrefix(
      vfs,
      templates,
      `${STACK}/${authProvider}/web/nuxt`,
      "apps/web",
      config,
    );
  } else if (hasSvelteWeb) {
    if (config.backend === "self" && authProvider === "better-auth") {
      processTemplatesFromPrefix(
        vfs,
        templates,
        `${STACK}/${authProvider}/fullstack/svelte`,
        "apps/web",
        config,
      );
    }
    processTemplatesFromPrefix(
      vfs,
      templates,
      `${STACK}/${authProvider}/web/svelte`,
      "apps/web",
      config,
    );
    if (authProvider === "better-auth") {
      const serverLoader =
        config.backend === "self" ||
        (config.webDeploy === config.serverDeploy &&
          ["vercel", "docker"].includes(config.webDeploy));
      processSingleTemplate(
        vfs,
        templates,
        `${STACK}/better-auth/loaders/svelte/dashboard.ts`,
        `apps/web/src/routes/dashboard/+page${serverLoader ? ".server" : ""}.ts`,
        config,
      );
    }
  } else if (hasSolidWeb) {
    if (config.backend === "self" && authProvider === "better-auth") {
      processTemplatesFromPrefix(
        vfs,
        templates,
        `${STACK}/${authProvider}/fullstack/solid`,
        "apps/web",
        config,
      );
    }
    processTemplatesFromPrefix(
      vfs,
      templates,
      `${STACK}/${authProvider}/web/solid`,
      "apps/web",
      config,
    );
  } else if (hasAstroWeb) {
    if (config.backend === "self" && authProvider === "better-auth") {
      processTemplatesFromPrefix(
        vfs,
        templates,
        `${STACK}/${authProvider}/fullstack/astro`,
        "apps/web",
        config,
      );
    }
    processTemplatesFromPrefix(
      vfs,
      templates,
      `${STACK}/${authProvider}/web/astro`,
      "apps/web",
      config,
    );
  }

  if (hasNative) {
    processTemplatesFromPrefix(
      vfs,
      templates,
      `${STACK}/${authProvider}/native/base`,
      "apps/native",
      config,
    );

    let nativeFramework = "";
    if (hasNativeBare) nativeFramework = "bare";
    else if (hasUniwind) nativeFramework = "uniwind";
    else if (hasUnistyles) nativeFramework = "unistyles";

    if (nativeFramework) {
      processTemplatesFromPrefix(
        vfs,
        templates,
        `${STACK}/${authProvider}/native/${nativeFramework}`,
        "apps/native",
        config,
      );
    }
  }
}
