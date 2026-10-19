import { ORPCError, os } from "@orpc/server";
import { EMBEDDED_TEMPLATES, generate, type VirtualNode } from "@xstack/template-generator";

import { resolveStackCompatibility } from "@/lib/stack-compatibility";
import { productPlan } from "@/lib/stack-features";
import { StackStateSchema, stackStateToConfig } from "@/lib/stack-schema";
import { formatProjectName } from "@/lib/stack-utils";
import { validateProjectName } from "@/lib/stack-validation";

function previewNode(node: VirtualNode): VirtualNode {
  if (node.type === "directory") {
    return { ...node, children: node.children.map(previewNode) };
  }
  const { sourcePath: _sourcePath, ...file } = node;
  return file;
}

export const router = {
  preview: os.input(StackStateSchema).handler(async ({ input }) => {
    const stack = resolveStackCompatibility(input).stack;
    const nameError = validateProjectName(formatProjectName(stack.projectName));
    if (nameError) throw new ORPCError("BAD_REQUEST", { message: nameError });
    const issues = productPlan(stack).issues.filter((issue) => issue.level === "error");
    if (issues.length) {
      throw new ORPCError("BAD_REQUEST", {
        message: issues.map((issue) => issue.message).join("\n"),
      });
    }

    const config = stackStateToConfig(stack);
    const result = await generate({ config, templates: EMBEDDED_TEMPLATES });
    if (result.isErr()) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Unable to generate this preview. Please try again.",
        cause: result.error,
      });
    }
    return {
      root: { ...result.value.root, children: result.value.root.children.map(previewNode) },
      fileCount: result.value.fileCount,
      directoryCount: result.value.directoryCount,
    };
  }),
};
