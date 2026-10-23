import assert from "node:assert/strict";
import { resolve, sep } from "node:path";

import { z } from "zod";

// Real generated HTTP + database verification. Requires real authenticated sessions.
const project = resolve(process.argv[2] ?? "");
const origin = process.argv[3] ?? "";
if (!project.startsWith(resolve(import.meta.dir, "../.smoke") + sep))
  throw new Error("Expected a disposable generated fixture inside apps/cli/.smoke");
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw new Error("Expected loopback app origin");
const admin = z.string().min(1).parse(process.env.CONTENT_ADMIN_COOKIE);
const ordinary = z.string().min(1).parse(process.env.CONTENT_USER_COOKIE);
const locale = process.env.CONTENT_LOCALE ?? "en";
const alternate = process.env.CONTENT_ALTERNATE_LOCALE ?? "zh-CN";
const postSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int(),
  translationKey: z.string().uuid(),
  authorName: z.string(),
  publishedAt: z.string().nullable(),
});
type Saved = z.infer<typeof postSchema>;
const cleanup = new Map<string, Saved>();
const marker = `content-${crypto.randomUUID()}`;
const input = {
  locale,
  slug: marker,
  title: `Fixture ${marker} </script><script>attack()</script>`,
  excerpt: "Disposable verification article",
  body: "## Verified persisted content\n\n<script>attack()</script>\n\n[unsafe](javascript:alert(1))\n\nA safe paragraph.",
  status: "draft",
};
type ContentPost = typeof input & { translationKey?: string };
type ContentRequest = ContentPost | { revision: number; post: ContentPost } | { revision: number };
async function request(
  path: string,
  cookie = admin,
  method = "GET",
  body?: ContentRequest,
  requestOrigin = origin,
) {
  const headers = new Headers({ origin: requestOrigin, "user-agent": "Googlebot" });
  if (cookie) headers.set("cookie", cookie);
  const init: RequestInit = { method, redirect: "manual", headers };
  if (body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(body);
  }
  return fetch(`${origin}${path}`, init);
}
async function save(response: Response, status: number) {
  assert.equal(response.status, status, await response.clone().text());
  const post = postSchema.parse(await response.json());
  cleanup.set(post.id, post);
  return post;
}
async function page(path: string) {
  return fetch(`${origin}${path}`, { headers: { "user-agent": "Googlebot" } });
}
try {
  assert.equal((await request("/api/blog", "")).status, 401);
  assert.equal((await request("/api/blog", ordinary)).status, 403);
  assert.equal((await request("/api/blog", ordinary, "POST", input)).status, 403);
  assert.equal(
    (await request("/api/blog", admin, "POST", input, "https://attacker.example")).status,
    403,
  );
  assert.equal(
    (await request("/api/blog", admin, "POST", { ...input, status: "published" })).status,
    400,
  );
  let post = await save(await request("/api/blog", admin, "POST", input), 201);
  const publicPath = `/${locale}/blog/${marker}`;
  assert.equal((await page(publicPath)).status, 404);
  assert.equal((await request(`/api/blog/${post.id}`, ordinary)).status, 403);
  assert.equal((await request(`/api/blog/${post.id}`, "")).status, 401);
  assert.equal((await request("/api/blog", admin, "POST", input)).status, 409);
  const privatePage = await request(`/${locale}/admin/blog/${post.id}`, ordinary);
  assert.ok(
    [403, 404].includes(privatePage.status),
    `ordinary-user admin detail status ${privatePage.status}`,
  );
  const sitemapResponse = await page("/sitemap.xml");
  const hasSeo = sitemapResponse.status === 200;
  if (hasSeo) assert.ok(!(await sitemapResponse.text()).includes(marker));
  const draftRevision = post.revision;
  post = await save(
    await request(`/api/blog/${post.id}`, admin, "PUT", {
      revision: post.revision,
      post: { ...input, status: "published" },
    }),
    200,
  );
  assert.ok(post.publishedAt);
  assert.equal(
    (await request(`/api/blog/${post.id}`, admin, "PUT", { revision: draftRevision, post: input }))
      .status,
    409,
  );
  assert.equal(
    (await request(`/api/blog/${post.id}`, admin, "DELETE", { revision: draftRevision })).status,
    409,
  );
  const publicResponse = await page(publicPath);
  assert.equal(publicResponse.status, 200);
  const html = await publicResponse.text();
  assert.ok(html.includes("A safe paragraph."));
  assert.ok(!/<script>attack\(\)<\/script>/.test(html));
  assert.ok(!/href="javascript:/i.test(html));
  const jsonText = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
  assert.ok(jsonText, "Article contains JSON-LD");
  const json = z
    .object({
      "@type": z.literal("BlogPosting"),
      headline: z.string(),
      author: z.object({ name: z.string() }),
      datePublished: z.string(),
    })
    .parse(JSON.parse(jsonText));
  assert.equal(json.headline, input.title);
  assert.equal(json.author.name, post.authorName);
  assert.equal(json.datePublished, post.publishedAt);
  assert.match(html, /rel="canonical"/);
  assert.ok((await (await page(`/${locale}/blog`)).text()).includes(marker));
  assert.equal((await page(`/${locale}/blog?page=100000`)).status, 404);
  assert.equal((await page(`/${locale}/blog?page=invalid`)).status, 404);
  if (hasSeo) {
    const sitemap = await (await page("/sitemap.xml")).text();
    assert.ok(sitemap.includes(publicPath));
    assert.ok(!/<loc>[^<]*\/(?:admin|dashboard|api|login|signup)(?:[/<])/.test(sitemap));
  }
  // Translation checks are exercised only when the fixture enables the alternate locale.
  if ((await page(`/${alternate}/blog`)).status === 200) {
    let translated = await save(
      await request("/api/blog", admin, "POST", {
        ...input,
        locale: alternate,
        slug: `${marker}-translated`,
        translationKey: post.translationKey,
      }),
      201,
    );
    assert.ok(
      !new RegExp(`hreflang="${alternate}"`, "i").test(await (await page(publicPath)).text()),
    );
    translated = await save(
      await request(`/api/blog/${translated.id}`, admin, "PUT", {
        revision: translated.revision,
        post: {
          ...input,
          locale: alternate,
          slug: `${marker}-translated`,
          translationKey: post.translationKey,
          status: "published",
        },
      }),
      200,
    );
    assert.ok(
      new RegExp(`hreflang="${alternate}"`, "i").test(await (await page(publicPath)).text()),
    );
    assert.equal(
      (
        await request("/api/blog", admin, "POST", {
          ...input,
          locale: alternate,
          slug: `${marker}-other`,
          translationKey: post.translationKey,
        })
      ).status,
      409,
    );
  }
  post = await save(
    await request(`/api/blog/${post.id}`, admin, "PUT", {
      revision: post.revision,
      post: { ...input, title: "Edited persisted title", status: "published" },
    }),
    200,
  );
  assert.ok((await (await page(publicPath)).text()).includes("Edited persisted title"));
  for (let index = 0; index < 12; index++) {
    const siblingInput = {
      ...input,
      slug: `${marker}-${index}`,
      title: `Pagination ${marker} ${index}`,
    };
    const sibling = await save(await request("/api/blog", admin, "POST", siblingInput), 201);
    await save(
      await request(`/api/blog/${sibling.id}`, admin, "PUT", {
        revision: sibling.revision,
        post: { ...siblingInput, status: "published" },
      }),
      200,
    );
  }
  const secondPage = await page(`/${locale}/blog?page=2`);
  assert.equal(secondPage.status, 200);
  assert.ok((await secondPage.text()).includes(marker));
  post = await save(
    await request(`/api/blog/${post.id}`, admin, "PUT", { revision: post.revision, post: input }),
    200,
  );
  assert.equal((await page(publicPath)).status, 404);
  if (hasSeo)
    assert.ok(!(await (await page("/sitemap.xml")).text()).includes(`${publicPath}</loc>`));
  assert.equal(
    (await request(`/api/blog/${post.id}`, admin, "DELETE", { revision: post.revision })).status,
    204,
  );
  cleanup.delete(post.id);
  assert.equal((await request(`/api/blog/${post.id}`)).status, 404);
  console.log(
    `PASS content HTTP: real admin CRUD, ordinary-user isolation, CSRF, persisted draft/publish/edit/unpublish/delete, uniqueness, optimistic revisions, Markdown/JSON-LD safety, metadata${hasSeo ? ", live sitemap" : " (standalone blog)"}.`,
  );
} finally {
  for (const post of cleanup.values())
    await request(`/api/blog/${post.id}`, admin, "DELETE", { revision: post.revision });
}
