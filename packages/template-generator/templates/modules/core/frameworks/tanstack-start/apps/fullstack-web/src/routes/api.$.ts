import { createFileRoute } from "@tanstack/react-router";

import { handleProductRequest } from "@/lib/product-api";

const handler = ({ request }: { request: Request }) => handleProductRequest(request);
export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: handler,
      POST: handler,
      PUT: handler,
      PATCH: handler,
      DELETE: handler,
      OPTIONS: handler,
    },
  },
});
