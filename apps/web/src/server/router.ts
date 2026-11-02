import { ORPCError, os } from "@orpc/server";
import type { VirtualNode } from "@xstack/template-generator";

import { StackStateSchema } from "@/lib/stack-schema";
import { generateStackProject, prepareStack } from "@/server/stack-project";

function previewNode(node: VirtualNode): VirtualNode {
  if (node.type === "directory") {
    return { ...node, children: node.children.map(previewNode) };
  }
  const { sourcePath: _sourcePath, ...file } = node;
  return file;
}

export const router = {
  preview: os.input(StackStateSchema).handler(async ({ input }) => {
    const { stack, issues } = prepareStack(input);
    if (issues.length) throw new ORPCError("BAD_REQUEST", { message: issues.join("\n") });

    const result = await generateStackProject(stack);
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
