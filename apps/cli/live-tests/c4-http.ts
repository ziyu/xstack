import assert from "node:assert/strict";

import { z } from "zod";

import type { C2Targets } from "./c2-applications";
import type { C2Database, C2Result } from "./c2-http";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

// HTMLRewriter exposes source attribute spelling, not browser-decoded values.
// Generated JSX/Vue escapes punctuation with these named or numeric references.
// Decode exactly once; script text (including JSON-LD) is never passed here.
const attributeEntities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function attributeValue(value: string | null): string {
  return (value ?? "").replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (reference: string, entity: string) => {
      if (!entity.startsWith("#"))
        return Object.hasOwn(attributeEntities, entity)
          ? attributeEntities[entity as keyof typeof attributeEntities]
          : reference;
      const hexadecimal = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "\ufffd";
      return String.fromCodePoint(code);
    },
  );
}

class Client {
  readonly cookies = new Map<string, string>();
  constructor(
    readonly origin: string,
    readonly signal: AbortSignal,
  ) {}
  async request(route: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("origin", headers.get("origin") ?? this.origin);
    headers.set("cookie", [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "));
    headers.set("user-agent", "Googlebot");
    const response = await fetch(new URL(route, this.origin), {
      ...init,
      headers,
      redirect: "manual",
      signal: AbortSignal.any([this.signal, AbortSignal.timeout(60_000)]),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0]!;
      const separator = pair.indexOf("=");
      this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    return response;
  }
  json(route: string, body: JsonValue, method = "POST", origin = this.origin) {
    return this.request(route, {
      method,
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  async page(route: string) {
    const response = await this.request(route);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const target = new URL(response.headers.get("location") ?? "", this.origin);
      const source = new URL(route, this.origin);
      if (target.origin === source.origin && target.pathname === source.pathname)
        return this.request(target.pathname + target.search);
    }
    return response;
  }
}
const postSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int(),
  translationKey: z.string().uuid(),
  authorName: z.string(),
  publishedAt: z.string().nullable(),
});
const jobSchema = z.object({
  job: z.object({
    id: z.string(),
    status: z.string(),
    text: z.string().nullable(),
    mediaUrl: z.string().nullable(),
  }),
});

export async function exerciseC4Http(input: {
  targets: C2Targets;
  database: C2Database;
  administrator: string;
  fixture: string;
  results: C2Result[];
  save: () => Promise<void>;
  signal: AbortSignal;
  provisionCredits: (userId: string) => Promise<void>;
  secrets: string[];
}) {
  const { targets, database, signal } = input;
  const member = new Client(targets.public.origin, signal);
  const other = new Client(targets.public.origin, signal);
  const admin = new Client(targets.admin.origin, signal);
  const anonymous = new Client(targets.public.origin, signal);
  const adminAnonymous = new Client(targets.admin.origin, signal);
  const check = async (name: string, work: () => Promise<void>) => {
    signal.throwIfAborted();
    try {
      await work();
      input.results.push({ name, status: "passed" });
    } catch (error) {
      input.results.push({ name, status: "failed", detail: String(error) });
      throw error;
    } finally {
      await input.save();
    }
  };
  const expect = async (response: Response, status = 200) => {
    const text = await response.clone().text();
    assert.equal(response.status, status, `${response.url}: ${text}`);
    for (const secret of input.secrets)
      assert.ok(!text.includes(secret), `Server secret exposed by ${response.url}`);
    return response;
  };
  const signup = async (client: Client, email: string) => {
    const password = `C4!${crypto.randomUUID()}aA1`;
    const created = await expect(
      await client.json("/api/auth/sign-up/email", { name: "C4 HTTP", email, password }),
    );
    const { user } = z.object({ user: z.object({ id: z.string() }) }).parse(await created.json());
    // Deliberately DB-seeded verified development accounts; no email-delivery claim.
    await database.query('UPDATE "user" SET email_verified = true WHERE id = ?', [user.id]);
    if (email === input.administrator)
      await database.query('UPDATE "user" SET role = ? WHERE id = ?', ["admin", user.id]);
    await expect(await client.json("/api/auth/sign-in/email", { email, password }));
    const session = z
      .object({ user: z.object({ id: z.string() }) })
      .parse(await (await expect(await client.request("/api/auth/get-session"))).json());
    assert.equal(session.user.id, user.id);
    return user.id;
  };
  let memberId = "";
  await check("c4-real-sessions-db-seeded-verification-and-admin", async () => {
    memberId = await signup(member, `c4-member-${crypto.randomUUID()}@example.test`);
    await signup(other, `c4-other-${crypto.randomUUID()}@example.test`);
    await signup(admin, input.administrator);
    await input.provisionCredits(memberId);
  });
  await check("c4-dashboard-public-admin-SSR-and-secret-isolation", async () => {
    for (const route of ["/en/dashboard/files", "/en/dashboard/ai"])
      assert.match(await (await expect(await member.page(route))).text(), /<(?:html|body|main)\b/i);
    for (const route of ["/en/blog", "/zh-CN/blog"])
      assert.match(
        await (await expect(await anonymous.page(route))).text(),
        /<(?:html|body|main)\b/i,
      );
    await expect(await admin.page("/en/admin/blog"));
    const foreignAdmin = new Client(targets.admin.origin, signal);
    for (const [key, value] of member.cookies) foreignAdmin.cookies.set(key, value);
    for (const client of [foreignAdmin, adminAnonymous]) {
      const response = await client.request("/en/admin/blog");
      assert.ok(
        [301, 302, 303, 307, 308, 401, 403, 404].includes(response.status) ||
          (response.status === 200 && /NEXT_REDIRECT/.test(await response.text())),
        "Admin SSR must deny non-admin users",
      );
    }
  });
  const form = (text = "C4 private bytes") => {
    const body = new FormData();
    body.set("file", new File([text], "c4-private.txt", { type: "text/html" }));
    return body;
  };
  await check("c4-private-storage-local-S3-upload-download-delete", async () => {
    await expect(await anonymous.request("/api/storage", { method: "POST", body: form() }), 401);
    await expect(
      await member.request("/api/storage", {
        method: "POST",
        headers: { origin: "https://attacker.example" },
        body: form(),
      }),
      403,
    );
    await expect(await member.request("/api/storage", { method: "POST", body: form("") }), 400);
    await expect(
      await member.request("/api/storage", {
        method: "POST",
        body: form("x".repeat(4 * 1024 * 1024 + 1)),
      }),
      413,
    );
    const { id } = z
      .object({ id: z.string() })
      .parse(
        await (
          await expect(await member.request("/api/storage", { method: "POST", body: form() }), 201)
        ).json(),
      );
    try {
      await expect(await anonymous.request(`/api/storage/${id}`), 401);
      await expect(await other.request(`/api/storage/${id}`), 404);
      assert.equal(
        (
          await database.query("SELECT id FROM storage_file WHERE id = ? AND user_id = ?", [
            id,
            memberId,
          ])
        ).length,
        1,
      );
      await expect(await other.request(`/api/storage/${id}`, { method: "DELETE" }), 404);
      const download = await expect(await member.request(`/api/storage/${id}`), 307);
      const url = new URL(download.headers.get("location")!);
      assert.equal(url.origin, "https://c4-protocol-bucket.s3.us-east-1.amazonaws.com");
      assert.ok(url.searchParams.get("X-Amz-Signature"));
      assert.equal(url.searchParams.get("response-content-type"), "application/octet-stream");
      assert.match(url.searchParams.get("response-content-disposition") ?? "", /^attachment;/);
      // Explicitly fetch through the local transport, never follow the public S3 URL.
      const object = await expect(
        await fetch(`${input.fixture}/transport${url.pathname}${url.search}`, {
          headers: { "x-c4-target": url.origin },
          signal,
        }),
      );
      assert.equal(await object.text(), "C4 private bytes");
      await expect(
        await member.request(`/api/storage/${id}`, {
          method: "DELETE",
          headers: { origin: "https://attacker.example" },
        }),
        403,
      );
      await expect(await member.request(`/api/storage/${id}`, { method: "DELETE" }), 204);
      await expect(await member.request(`/api/storage/${id}`), 404);
      assert.equal(
        (
          await fetch(`${input.fixture}/transport${url.pathname}${url.search}`, {
            headers: { "x-c4-target": url.origin },
            signal,
          })
        ).status,
        404,
      );
    } finally {
      const deleted = await member.request(`/api/storage/${id}`, { method: "DELETE" });
      assert.ok([204, 404].includes(deleted.status), "Owned storage cleanup failed");
    }
  });
  await check("c4-AI-local-provider-generation-ownership-media-and-replay", async () => {
    await expect(await anonymous.request("/api/ai"), 401);
    const generation = {
      requestId: crypto.randomUUID(),
      provider: "openai",
      kind: "chat",
      prompt: "C4 private conversation",
    };
    await expect(await anonymous.json("/api/ai", generation), 401);
    const hostileStatus = targets.backend === targets.public ? 400 : 403;
    const hostileGeneration = await expect(
      await member.json("/api/ai", generation, "POST", "https://attacker.example"),
      hostileStatus,
    );
    if (hostileStatus === 400)
      assert.equal(
        z.object({ error: z.string() }).parse(await hostileGeneration.json()).error,
        "invalid_request",
      );
    assert.equal(
      (
        await database.query("SELECT id FROM ai_job WHERE user_id = ? AND request_id = ?", [
          memberId,
          generation.requestId,
        ])
      ).length,
      0,
      "Rejected origins must not create AI jobs",
    );
    const first = jobSchema.parse(
      await (await expect(await member.json("/api/ai", generation))).json(),
    ).job;
    assert.equal(
      (
        await database.query("SELECT id FROM ai_job WHERE id = ? AND user_id = ?", [
          first.id,
          memberId,
        ])
      ).length,
      1,
    );
    assert.equal(first.status, "completed");
    assert.equal(first.text, `C4 local answer: ${generation.prompt}`);
    assert.equal(
      jobSchema.parse(await (await expect(await member.json("/api/ai", generation))).json()).job.id,
      first.id,
    );
    await expect(await member.json("/api/ai", { ...generation, prompt: "changed" }), 409);
    await expect(await anonymous.request(`/api/ai/${first.id}`, { method: "POST" }), 401);
    const hostilePoll = await expect(
      await member.request(`/api/ai/${first.id}`, {
        method: "POST",
        headers: { origin: "https://attacker.example" },
      }),
      hostileStatus,
    );
    if (hostileStatus === 400)
      assert.equal(
        z.object({ error: z.string() }).parse(await hostilePoll.json()).error,
        "invalid_request",
      );
    assert.equal(
      (
        await database.query("SELECT id FROM ai_job WHERE id = ? AND user_id = ? AND status = ?", [
          first.id,
          memberId,
          "completed",
        ])
      ).length,
      1,
      "Rejected polling must not alter the completed job",
    );
    await expect(await other.request(`/api/ai/${first.id}`, { method: "POST" }), 404);
    await expect(await other.request(`/api/ai/${first.id}`, { method: "DELETE" }), 404);
    await expect(
      await other.json("/api/ai", {
        ...generation,
        requestId: crypto.randomUUID(),
        parentId: first.id,
      }),
      404,
    );
    const history = z
      .object({ jobs: z.array(z.object({ id: z.string() })) })
      .parse(await (await expect(await other.request(`/api/ai?userId=${memberId}`))).json());
    assert.ok(!history.jobs.some((job) => job.id === first.id));
    for (const provider of ["google", "openai-compatible"]) {
      const result = jobSchema.parse(
        await (
          await expect(
            await member.json("/api/ai", {
              ...generation,
              requestId: crypto.randomUUID(),
              provider,
            }),
          )
        ).json(),
      ).job;
      assert.equal(result.status, "completed");
      assert.equal(result.text, `C4 local answer: ${generation.prompt}`);
    }
    for (const [provider, kind, contentType] of [
      ["openai", "image", "image/png"],
      ["google", "video", "video/mp4"],
    ] as const) {
      let job = jobSchema.parse(
        await (
          await expect(
            await member.json("/api/ai", {
              ...generation,
              requestId: crypto.randomUUID(),
              provider,
              kind,
            }),
          )
        ).json(),
      ).job;
      if (kind === "video") {
        assert.equal(job.status, "running");
        job = jobSchema.parse(
          await (
            await expect(await member.request(`/api/ai/${job.id}`, { method: "POST" }))
          ).json(),
        ).job;
      }
      assert.equal(job.status, "completed");
      assert.equal(job.mediaUrl, `/api/ai/${job.id}/media`);
      await expect(await anonymous.request(job.mediaUrl!), 401);
      await expect(await other.request(job.mediaUrl!), 404);
      const media = await expect(await member.request(job.mediaUrl!));
      assert.equal(media.headers.get("content-type"), contentType);
      assert.ok(
        (media.headers.get("cache-control") ?? "")
          .toLowerCase()
          .split(",")
          .some((directive) => directive.trim() === "no-store"),
        "AI media must prohibit response storage",
      );
      const bytes = new Uint8Array(await media.arrayBuffer());
      if (kind === "image")
        assert.deepEqual(bytes.subarray(0, 8), new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
      else assert.equal(new TextDecoder().decode(bytes), "C4 local protocol MP4 bytes");
    }
  });
  await check("c4-generated-media-private-files-cleanup", async () => {
    const files = await database.query("SELECT id FROM storage_file WHERE user_id = ?", [memberId]);
    assert.ok(files.length >= 2, "AI media must persist through selected storage service");
    for (const file of files) {
      assert.ok(file.id);
      await expect(await other.request(`/api/storage/${file.id}`), 404);
      await expect(await member.request(`/api/storage/${file.id}`, { method: "DELETE" }), 204);
    }
    assert.equal(
      (await database.query("SELECT id FROM storage_file WHERE user_id = ?", [memberId])).length,
      0,
    );
  });
  const posts = new Map<string, z.infer<typeof postSchema>>();
  const marker = `c4-${crypto.randomUUID()}`;
  const draft = {
    locale: "en",
    slug: marker,
    title: `C4 ${marker} </script><script>attack()</script>`,
    excerpt: "C4 persisted excerpt",
    body: "## C4 persisted content\n\n<script>attack()</script>\n\n[unsafe](javascript:alert(1))\n\nC4 safe paragraph.",
    status: "draft",
  };
  const savePost = async (response: Response, status = 200) => {
    const post = postSchema.parse(await (await expect(response, status)).json());
    posts.set(post.id, post);
    return post;
  };
  try {
    await check("c4-blog-admin-CRUD-drafts-publication-locales-revisions-and-SEO", async () => {
      const ordinaryAdmin = new Client(targets.admin.origin, signal);
      for (const [name, value] of member.cookies) ordinaryAdmin.cookies.set(name, value);
      await expect(await adminAnonymous.request("/api/blog"), 401);
      await expect(await ordinaryAdmin.request("/api/blog"), 403);
      await expect(await ordinaryAdmin.json("/api/blog", draft), 403);
      await expect(await admin.json("/api/blog", draft, "POST", "https://attacker.example"), 403);
      await expect(await admin.json("/api/blog", { ...draft, status: "published" }), 400);
      let post = await savePost(await admin.json("/api/blog", draft), 201);
      const publicPath = `/en/blog/${marker}`;
      await expect(await anonymous.page(publicPath), 404);
      await expect(await admin.page(`/en/admin/blog/${post.id}`));
      await expect(await admin.json("/api/blog", draft), 409);
      assert.ok(
        !(await (await expect(await anonymous.request("/sitemap.xml"))).text()).includes(marker),
      );
      const revision = post.revision;
      post = await savePost(
        await admin.json(
          `/api/blog/${post.id}`,
          { revision, post: { ...draft, status: "published" } },
          "PUT",
        ),
      );
      assert.ok(post.publishedAt);
      await expect(await admin.json(`/api/blog/${post.id}`, { revision, post: draft }, "PUT"), 409);
      await expect(await admin.json(`/api/blog/${post.id}`, { revision }, "DELETE"), 409);
      const translatedDraft = {
        ...draft,
        locale: "zh-CN",
        slug: `${marker}-translated`,
        translationKey: post.translationKey,
      };
      let translated = await savePost(await admin.json("/api/blog", translatedDraft), 201);
      assert.doesNotMatch(
        await (await expect(await anonymous.page(publicPath))).text(),
        /hreflang="zh-CN"/i,
      );
      translated = await savePost(
        await admin.json(
          `/api/blog/${translated.id}`,
          { revision: translated.revision, post: { ...translatedDraft, status: "published" } },
          "PUT",
        ),
      );
      await expect(
        await admin.json("/api/blog", { ...translatedDraft, slug: `${marker}-duplicate` }),
        409,
      );
      const html = await (await expect(await anonymous.page(publicPath))).text();
      assert.ok(html.includes("C4 safe paragraph."));
      const links: { rel: string | null; href: string | null; lang: string | null }[] = [];
      const meta: Record<string, string> = {};
      const scripts: { type: string | null; text: string }[] = [];
      const anchors: string[] = [];
      let script: { type: string | null; text: string } | undefined;
      await new HTMLRewriter()
        .on("link", {
          element(element) {
            links.push({
              rel: attributeValue(element.getAttribute("rel")),
              href: attributeValue(element.getAttribute("href")),
              lang: attributeValue(element.getAttribute("hreflang")),
            });
          },
        })
        .on("meta", {
          element(element) {
            meta[attributeValue(element.getAttribute("property") ?? element.getAttribute("name"))] =
              attributeValue(element.getAttribute("content"));
          },
        })
        .on("script", {
          element(element) {
            script = { type: element.getAttribute("type"), text: "" };
            scripts.push(script);
          },
          text(chunk) {
            if (script) script.text += chunk.text;
          },
        })
        .on("a", {
          element(element) {
            anchors.push(attributeValue(element.getAttribute("href")));
          },
        })
        .transform(new Response(html))
        .text();
      assert.equal(
        links.find((link) => link.rel === "canonical")?.href,
        targets.public.origin + publicPath,
      );
      assert.equal(
        links.find((link) => link.lang === "zh-CN")?.href,
        `${targets.public.origin}/zh-CN/blog/${translatedDraft.slug}`,
      );
      assert.equal(meta["og:url"], targets.public.origin + publicPath);
      assert.equal(meta["og:title"], draft.title);
      assert.equal(meta["og:description"], draft.excerpt);
      assert.equal(meta["og:type"], "article");
      assert.ok(["summary", "summary_large_image"].includes(meta["twitter:card"] ?? ""));
      assert.ok(!anchors.some((href) => /^javascript:/i.test(href)));
      assert.ok(
        !scripts.some(
          (entry) => entry.type !== "application/ld+json" && entry.text.trim() === "attack()",
        ),
      );
      const article = scripts
        .filter((entry) => entry.type === "application/ld+json")
        .map((entry) => JSON.parse(entry.text))
        .find((entry) => entry["@type"] === "BlogPosting");
      assert.ok(article);
      assert.equal(article.headline, draft.title);
      assert.equal(article.author.name, post.authorName);
      assert.equal(article.datePublished, post.publishedAt);
      await expect(await anonymous.page(`/zh-CN/blog/${translatedDraft.slug}`));
      assert.ok((await (await expect(await anonymous.page("/en/blog"))).text()).includes(marker));
      const sitemap = await (await expect(await anonymous.request("/sitemap.xml"))).text();
      assert.ok(sitemap.includes(targets.public.origin + publicPath));
      assert.ok(sitemap.includes(`/zh-CN/blog/${translatedDraft.slug}`));
      assert.doesNotMatch(sitemap, /<loc>[^<]*\/(?:admin|dashboard|api|login|signup)(?:[/<])/);
      const robotsResponse = await expect(await anonymous.request("/robots.txt"));
      assert.doesNotMatch(robotsResponse.headers.get("x-robots-tag") ?? "", /noindex/i);
      assert.ok((await robotsResponse.text()).includes(`${targets.public.origin}/sitemap.xml`));
      post = await savePost(
        await admin.json(
          `/api/blog/${post.id}`,
          {
            revision: post.revision,
            post: { ...draft, title: "C4 edited persisted title", status: "published" },
          },
          "PUT",
        ),
      );
      assert.ok(
        (await (await expect(await anonymous.page(publicPath))).text()).includes(
          "C4 edited persisted title",
        ),
      );
      post = await savePost(
        await admin.json(`/api/blog/${post.id}`, { revision: post.revision, post: draft }, "PUT"),
      );
      await expect(await anonymous.page(publicPath), 404);
      assert.ok(
        !(await (await expect(await anonymous.request("/sitemap.xml"))).text()).includes(
          `${publicPath}</loc>`,
        ),
      );
      await expect(
        await admin.json(`/api/blog/${post.id}`, { revision: post.revision }, "DELETE"),
        204,
      );
      posts.delete(post.id);
      await expect(await admin.request(`/api/blog/${post.id}`), 404);
    });
  } finally {
    for (const post of posts.values())
      await expect(
        await admin.json(`/api/blog/${post.id}`, { revision: post.revision }, "DELETE"),
        204,
      );
  }
  await check("c4-local-protocol-evidence-no-cloud-traffic", async () => {
    const evidence = z
      .object({
        counts: z.record(z.string(), z.number()),
        violations: z.array(z.string()),
        toolingBlockedUrls: z.array(z.string()),
        objects: z.number(),
      })
      .parse(await (await expect(await fetch(`${input.fixture}/evidence`, { signal }))).json());
    assert.deepEqual(evidence.violations, [], "Unhandled provider traffic must fail acceptance");
    assert.equal(evidence.objects, 0, "Fixture objects must be deleted by real application routes");
    assert.equal(
      evidence.counts["api.openai.com POST /v1/chat/completions"],
      1,
      "Idempotent HTTP replay must not repeat provider generation",
    );
    for (const host of [
      "api.openai.com",
      "api.deepseek.com",
      "generativelanguage.googleapis.com",
      "c4-protocol-bucket.s3.us-east-1.amazonaws.com",
    ])
      assert.ok(
        Object.entries(evidence.counts).some(
          ([key, count]) => key.startsWith(host + " ") && count > 0,
        ),
        `${host}: no protocol calls exercised`,
      );
    if (evidence.toolingBlockedUrls.length)
      input.results.push({
        name: "c4-development-security-advisory-check",
        status: "unverified",
        detail: `Offline fixture returned HTTP 503, not a clean audit: ${[...new Set(evidence.toolingBlockedUrls)].join(", ")}`,
      });
  });
  input.results.push({
    name: "c4-real-cloud-provider-acceptance",
    status: "unverified",
    detail:
      "S3, OpenAI, Google and compatible transports used explicit local protocols; no real cloud credentials, purchases or bucket operations.",
  });
  await input.save();
}
