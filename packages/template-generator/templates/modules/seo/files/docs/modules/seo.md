# Search metadata

Set `SITE_URL` to the public HTTPS origin before deployment. Do not use preview URLs as canonical production URLs. `pageMetadata` supplies homepage and payment pricing page canonical, configured-locale hreflang, Open Graph and Twitter metadata; use it on additional translated public pages. For content that is not available in every configured locale, pass only actual translations to `seo.metadata` instead of accepting its same-path defaults. Optional `image` must identify a real public image; absolute HTTP(S) URLs and relative public paths are supported, while unsafe schemes and credential-bearing URLs are rejected. Metadata helpers do not fetch image URLs.

`/robots.txt` excludes authentication, dashboard, admin and API paths. `/sitemap.xml` is computed per request and initially includes only localized homepages. Modules register live contributors through `seo.registerSitemap`; the payment integration adds localized pricing URLs, and the blog integration includes published posts and populated blog indexes, never drafts. Sitemap/robots are discovery controls, not authorization. All private routes must retain their session/permission guards.

The module does not invent review claims, organization facts, social images or sample articles. BlogPosting data comes from the blog's persisted publication record. No external SEO service or paid data is required.
