export const dynamic = "force-static";

import type { Metadata } from "next";

import InitPane from "./_components/rail/panes/init-pane";

export const metadata: Metadata = {
  alternates: {
    canonical: "/",
    types: {
      "text/markdown": "/llms.txt",
    },
  },
};

export default function HomePage() {
  return (
    <section
      id="pane-init"
      aria-labelledby="home-title"
      className="mx-auto min-h-[calc(100svh-3.5rem)] w-full max-w-[720px]"
    >
      <h1 id="home-title" className="sr-only">
        xstack: roll your own stack
      </h1>
      <div className="flex flex-col gap-4 px-6 py-6 max-md:px-5">
        <InitPane />
      </div>
    </section>
  );
}
