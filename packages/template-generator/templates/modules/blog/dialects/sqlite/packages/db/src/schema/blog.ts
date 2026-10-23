import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const blogPost = sqliteTable("blog_post", {
  id: text("id").primaryKey(),
  translationKey: text("translation_key").notNull(),
  locale: text("locale").notNull(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  excerpt: text("excerpt").notNull(),
  body: text("body").notNull(),
  status: text("status", { enum: ["draft", "published"] }).notNull().default("draft"),
  authorId: text("author_id").notNull(),
  authorName: text("author_name").notNull(),
  revision: integer("revision").notNull().default(1),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  publishedAt: integer("published_at", { mode: "timestamp_ms" }),
}, (table) => [
  uniqueIndex("blog_locale_slug_unique").on(table.locale, table.slug),
  uniqueIndex("blog_translation_locale_unique").on(table.translationKey, table.locale),
  index("blog_publication_idx").on(table.locale, table.status, table.publishedAt),
]);
