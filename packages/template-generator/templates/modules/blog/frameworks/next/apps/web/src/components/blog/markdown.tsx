import ReactMarkdown from "react-markdown";

/** Raw HTML is never interpreted. react-markdown also rejects unsafe URL schemes. */
export default function Markdown({ children }: { children: string }) {
  return <div className="space-y-5 text-base leading-8 [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-5 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:font-serif [&_h1]:text-3xl [&_h2]:mt-10 [&_h2]:font-serif [&_h2]:text-2xl [&_h3]:text-xl [&_li]:ml-6 [&_ol]:list-decimal [&_pre]:overflow-x-auto [&_pre]:bg-muted [&_pre]:p-5 [&_ul]:list-disc"><ReactMarkdown skipHtml components={{ img: ({ alt }) => <span className="text-muted-foreground">{alt}</span> }}>{children}</ReactMarkdown></div>;
}
