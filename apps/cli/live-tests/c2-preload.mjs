// Harness-only process boundary: never install this file into generated projects.
import net from "node:net";
import { resolve, sep } from "node:path";

import { z } from "zod";

import "./captcha-preload.mjs";
if (!resolve(process.cwd()).includes(`${sep}.smoke${sep}`))
  throw new Error("C2 preload requires a disposable .smoke working directory");
// Framework CLIs do not all expose the same host switch. Constrain every Node
// listener, including framework child processes, without changing application code.
const listen = net.Server.prototype.listen;
const listenOptions = z.object({ port: z.union([z.number(), z.string()]) }).passthrough();
const listenPort = z.union([z.number(), z.string().regex(/^\d+$/)]);
net.Server.prototype.listen = function (...args) {
  const options = listenOptions.safeParse(args[0]);
  if (options.success) args[0] = { ...options.data, host: "127.0.0.1" };
  else if (listenPort.safeParse(args[0]).success) {
    if (z.string().safeParse(args[1]).success) args[1] = "127.0.0.1";
    else args.splice(1, 0, "127.0.0.1");
  }
  return listen.apply(this, args);
};
// OAuth credentials are fixture identifiers, not cloud secrets. Refuse exchange
// requests so a regression cannot send them to a real identity provider.
const fetchWithCaptcha = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (
    ["oauth2.googleapis.com", "github.com", "api.github.com", "api.weixin.qq.com"].includes(
      url.hostname,
    )
  )
    throw new Error(
      "C2 fixture forbids external OAuth exchange; cloud exchange remains unverified",
    );
  return fetchWithCaptcha(input, init);
};
