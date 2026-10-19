export type EmailContent = {
  brand: string;
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  footer?: string;
};

export type RenderedEmail = { html: string; text: string };

function escape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Renders a simple, client-safe transactional layout as HTML and plain text. */
export function renderEmail(content: EmailContent): RenderedEmail {
  const paragraphs = content.paragraphs
    .map((p) => `<p style="margin:0 0 16px;line-height:1.6">${escape(p)}</p>`)
    .join("");
  const action = content.action
    ? `<p style="margin:24px 0"><a href="${escape(content.action.url)}" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;text-decoration:none;font-weight:600">${escape(content.action.label)}</a></p>`
    : "";
  const footer = content.footer
    ? `<p style="margin:24px 0 0;color:#666;font-size:12px">${escape(content.footer)}</p>`
    : "";

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table role="presentation" width="100%" style="max-width:520px;background:#fff;padding:32px" cellpadding="0" cellspacing="0"><tr><td><p style="margin:0 0 24px;font-weight:700">${escape(content.brand)}</p><h1 style="margin:0 0 16px;font-size:20px">${escape(content.heading)}</h1>${paragraphs}${action}${footer}</td></tr></table></td></tr></table></body></html>`;

  const text = [
    content.heading,
    "",
    ...content.paragraphs,
    ...(content.action ? ["", `${content.action.label}: ${content.action.url}`] : []),
    ...(content.footer ? ["", content.footer] : []),
  ].join("\n");

  return { html, text };
}
