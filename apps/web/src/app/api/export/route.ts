import { StackStateSchema } from "@/lib/stack-schema";
import { projectFolderName } from "@/lib/stack-utils";
import { createProjectArchive } from "@/server/project-archive";
import { generateStackProject, prepareStack } from "@/server/stack-project";

/** ZIP building uses node:zlib and Buffer; keep this route off the edge runtime. */
export const runtime = "nodejs";

function errorResponse(message: string, status: number) {
  return Response.json({ message }, { status });
}

/** Download the generated project as a ZIP archive, mirroring `xstack create` output. */
export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const parsed = StackStateSchema.safeParse(payload);
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0]?.message ?? "Invalid stack configuration.", 400);
  }

  const { stack, issues } = prepareStack(parsed.data);
  if (issues.length) return errorResponse(issues.join("\n"), 400);

  const result = await generateStackProject(stack);
  if (result.isErr()) {
    console.error("Project export failed", result.error);
    return errorResponse("Unable to generate this project. Please try again.", 500);
  }

  const folder = projectFolderName(stack.projectName);
  const archive = createProjectArchive(result.value.root, folder);
  return new Response(archive, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${folder}.zip"`,
      "content-length": String(archive.byteLength),
      "x-file-count": String(result.value.fileCount),
      "cache-control": "no-store",
    },
  });
}
