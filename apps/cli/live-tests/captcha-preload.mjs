// Local HTTP protocol fixture ONLY. Never copy this preload into generated projects.
import { resolve, sep } from "node:path";

const endpoint = process.env.CAPTCHA_FIXTURE_ORIGIN;
if (!endpoint) throw new Error("CAPTCHA_FIXTURE_ORIGIN is required for the captcha fixture preload");
const fixture = new URL(endpoint);
if (fixture.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(fixture.hostname)) {
  throw new Error("Captcha fixtures must use loopback HTTP");
}
if (!resolve(process.cwd()).includes(`${sep}.smoke${sep}`)) {
  throw new Error("Captcha fixture preload is only allowed in a disposable .smoke project");
}
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
    return realFetch(new URL("/siteverify", fixture), init);
  }
  return realFetch(input, init);
};
