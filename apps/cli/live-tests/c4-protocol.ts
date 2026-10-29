import assert from "node:assert/strict";

import { z } from "zod";

// Local wire-protocol evidence only. No cloud credentials, paid generations or buckets.
const objects = new Map<string, { bytes: ArrayBuffer; type: string }>();
const interactions = new Map<string, { cancelled: boolean }>();
const counts: Record<string, number> = {};
const assetMetadataCounts: Record<string, number> = {};
const toolingBlockedUrls: string[] = [];
const violations: string[] = [];
export const c4Png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR2UAAAAASUVORK5CYII=";
const completion = (id: string, content: unknown[]) =>
  Response.json({ id, status: "completed", steps: [{ type: "model_output", content }] });
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 4399,
  async fetch(request) {
    const local = new URL(request.url);
    if (local.pathname === "/health") return Response.json({ fixture: "c4-local-only" });
    if (local.pathname === "/evidence")
      return Response.json({
        counts,
        assetMetadataCounts,
        toolingBlockedUrls,
        violations,
        objects: objects.size,
      });
    if (local.pathname === "/violation") {
      violations.push(await request.text());
      return new Response(null, { status: 204 });
    }
    try {
      assert.ok(local.pathname.startsWith("/transport/"), "Unknown fixture route");
      const target = new URL(request.headers.get("x-c4-target") ?? "");
      assert.equal(target.protocol, "https:");
      assert.equal(target.port, "");
      const pathname = local.pathname.slice("/transport".length);
      if (target.hostname === "registry.npmjs.org") {
        assert.equal(request.method, "POST");
        assert.equal(pathname + local.search, "/-/npm/v1/security/advisories/bulk");
        toolingBlockedUrls.push(target.origin + pathname);
        // An offline advisory request is unavailable, never a clean security scan.
        return Response.json({ error: "offline_advisory_check_unavailable" }, { status: 503 });
      }
      // Nuxt/unifont discovers these catalogues during development. This offline
      // fixture intentionally supplies no remote fonts/icons; it fetches no assets.
      if (target.hostname === "fonts.google.com") {
        assert.equal(request.method, "GET");
        const route = pathname + local.search;
        assert.ok(
          route === "/metadata/fonts" ||
            route === "/metadata/icons?key=material_symbols&incomplete=true",
          "Unknown font metadata URL",
        );
        assetMetadataCounts[route] = (assetMetadataCounts[route] ?? 0) + 1;
        if (route === "/metadata/fonts") return Response.json({ familyMetadataList: [] });
        return new Response(")]}'\n" + JSON.stringify({ families: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      const key = `${target.hostname} ${request.method} ${pathname}`;
      counts[key] = (counts[key] ?? 0) + 1;
      if (target.hostname === "c4-protocol-bucket.s3.us-east-1.amazonaws.com") {
        assert.match(pathname, /^\/[a-f0-9]{64}\/[a-f0-9-]{36}$/);
        if (!local.searchParams.has("X-Amz-Signature"))
          assert.match(request.headers.get("authorization") ?? "", /^AWS4-HMAC-SHA256 /);
        if (request.method === "PUT") {
          const bytes = await request.arrayBuffer();
          assert.ok(bytes.byteLength > 0);
          objects.set(pathname, {
            bytes,
            type: request.headers.get("content-type") ?? "application/octet-stream",
          });
          return new Response(null, { headers: { etag: '"c4-local-object"' } });
        }
        if (request.method === "GET") {
          const object = objects.get(pathname);
          return object
            ? new Response(object.bytes, { headers: { "content-type": object.type } })
            : new Response("NoSuchKey", { status: 404 });
        }
        if (request.method === "DELETE") {
          objects.delete(pathname);
          return new Response(null, { status: 204 });
        }
        throw new Error("Unsupported S3 operation");
      }
      if (target.hostname === "api.openai.com" || target.hostname === "api.deepseek.com") {
        assert.equal(request.method, "POST");
        assert.match(request.headers.get("authorization") ?? "", /^Bearer c4-local-/);
        const body = z
          .object({
            prompt: z.string().optional(),
            messages: z.array(z.object({ content: z.string() })).optional(),
          })
          .parse(await request.json());
        if (pathname === "/v1/images/generations" && target.hostname === "api.openai.com") {
          assert.ok(body.prompt);
          return Response.json({ data: [{ b64_json: c4Png }] });
        }
        assert.ok(["/v1/chat/completions", "/chat/completions"].includes(pathname));
        assert.ok(body.messages?.length);
        return Response.json({
          choices: [{ message: { content: `C4 local answer: ${body.messages.at(-1)!.content}` } }],
        });
      }
      if (target.hostname === "generativelanguage.googleapis.com") {
        assert.match(request.headers.get("x-goog-api-key") ?? "", /^c4-local-/);
        if (pathname === "/v1beta/interactions" && request.method === "POST") {
          const body = z
            .object({ input: z.string(), background: z.boolean(), model: z.string() })
            .parse(await request.json());
          const id = crypto.randomUUID();
          if (body.background) {
            interactions.set(id, { cancelled: false });
            return Response.json({ id, status: "in_progress" });
          }
          return completion(id, [{ type: "text", text: `C4 local answer: ${body.input}` }]);
        }
        const match = /^\/v1beta\/interactions\/([a-f0-9-]{36})(\/cancel)?$/.exec(pathname);
        assert.ok(match);
        const remote = interactions.get(match[1]!);
        assert.ok(remote, "Unknown Google interaction");
        if (match[2] && request.method === "POST") {
          remote.cancelled = true;
          return Response.json({});
        }
        assert.equal(request.method, "GET");
        if (remote.cancelled) return Response.json({ id: match[1], status: "cancelled" });
        return completion(match[1]!, [
          { type: "video", mime_type: "video/mp4", data: btoa("C4 local protocol MP4 bytes") },
        ]);
      }
      throw new Error("Unknown provider host");
    } catch (error) {
      violations.push(String(error));
      return Response.json(
        { error: "unhandled_local_protocol", detail: String(error) },
        { status: 502 },
      );
    }
  },
});
console.log(`C4 local protocol fixture listening at ${server.url}`);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    server.stop(true);
    process.exit(0);
  });
