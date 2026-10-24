import { z } from "zod";
export const postSchema = z.object({
  id: z.string(),
  locale: z.string(),
  slug: z.string(),
  title: z.string(),
  excerpt: z.string(),
  body: z.string(),
  translationKey: z.string(),
  status: z.enum(["draft", "published"]),
  revision: z.number(),
  authorName: z.string(),
  publishedAt: z.string().nullable(),
  updatedAt: z.string(),
});
export const postListSchema = z.object({
  posts: z.array(postSchema),
  page: z.number(),
  limit: z.number(),
  total: z.number(),
});
const blogSearchSchema = z.object({ page: z.coerce.number().int().min(1).max(100_000).default(1) });
export function blogSearch(search: z.input<typeof blogSearchSchema>) {
  const result = blogSearchSchema.safeParse(search);
  return { page: result.success ? result.data.page : null };
}
