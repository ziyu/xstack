// Harness-only preload. Never copied into generated application sources.
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";

import { z } from "zod";

import "./c2-preload.mjs";

const fixture = new URL(process.env.C4_FIXTURE_ORIGIN ?? "http://127.0.0.1:4399");
if (fixture.origin !== "http://127.0.0.1:4399") throw new Error("Unexpected C4 fixture origin");
const hosts = {
  "api.openai.com": true,
  "api.deepseek.com": true,
  "generativelanguage.googleapis.com": true,
  "c4-protocol-bucket.s3.us-east-1.amazonaws.com": true,
};
const assetMetadata = {
  "https://fonts.google.com/metadata/fonts": true,
  "https://fonts.google.com/metadata/icons?key=material_symbols&incomplete=true": true,
};
const blockedTooling = {
  "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk": true,
};
const local = (url) => ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
const allowed = (url) =>
  (url.protocol === "https:" && !url.port && Object.hasOwn(hosts, url.hostname)) ||
  Object.hasOwn(assetMetadata, url.href) ||
  Object.hasOwn(blockedTooling, url.href);
const nativeFetch = globalThis.fetch;
const nativeRequest = http.request;
const requestUrl = z.union([z.string(), z.instanceof(URL)]);
const requestOptions = z
  .object({
    protocol: z.string().optional(),
    hostname: z.string().optional(),
    host: z.string().optional(),
    port: z.union([z.string(), z.number()]).optional(),
    path: z.string().optional(),
  })
  .passthrough();
function rejected(url) {
  const request = nativeRequest(new URL("/violation", fixture), { method: "POST" });
  request.on("error", () => {});
  request.end(url.href);
  throw new Error(`C4 forbids unhandled external transport: ${url.origin}${url.pathname}`);
}
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (local(url)) return nativeFetch(request);
  if (!allowed(url)) return rejected(url);
  const headers = new Headers(request.headers);
  headers.set("x-c4-target", url.origin);
  return nativeFetch(new URL(`/transport${url.pathname}${url.search}`, fixture), {
    method: request.method,
    headers,
    body: request.body,
    duplex: "half",
    signal: request.signal,
    redirect: "manual",
  });
};
function transport(defaultProtocol) {
  return function (...args) {
    const parsedUrl = requestUrl.safeParse(args[0]);
    const options = parsedUrl.success
      ? requestOptions.parse(args[1] === undefined || args[1] instanceof Function ? {} : args[1])
      : requestOptions.parse(args[0]);
    const url = parsedUrl.success
      ? new URL(parsedUrl.data)
      : new URL(
          `${options.protocol ?? defaultProtocol}//${options.hostname ?? options.host ?? "localhost"}${options.port ? `:${options.port}` : ""}${options.path ?? "/"}`,
        );
    const callback = args.find((argument) => argument instanceof Function);
    if (local(url)) {
      if (url.protocol !== "http:") return rejected(url);
      return nativeRequest.apply(http, args);
    }
    if (!allowed(url)) return rejected(url);
    return nativeRequest(
      {
        ...options,
        protocol: "http:",
        hostname: fixture.hostname,
        host: fixture.hostname,
        port: fixture.port,
        path: `/transport${url.pathname}${url.search}`,
        agent: undefined,
        headers: { ...options.headers, "x-c4-target": url.origin },
      },
      callback,
    );
  };
}
http.request = transport("http:");
https.request = transport("https:");
http.get = (...args) => {
  const request = http.request(...args);
  request.end();
  return request;
};
https.get = (...args) => {
  const request = https.request(...args);
  request.end();
  return request;
};
syncBuiltinESMExports();
