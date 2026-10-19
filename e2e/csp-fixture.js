// Applies the production Content-Security-Policy from vercel.json in Playwright.
//
// The local test server (python3 -m http.server) sends no headers, so without
// this a CSP violation would only show up in production. This fixture reads the
// one copy of the policy from vercel.json and adds it as a response header to
// every same-origin HTML document, so a violation fails the run instead.
//
// Usage in a spec (instead of requiring @playwright/test directly):
//   const { test, expect } = require("./csp-fixture");
//
// Self-contained: depends only on @playwright/test and vercel.json at the repo
// root, so other vanilla apps can copy it unchanged.

const fs = require("node:fs");
const path = require("node:path");
const base = require("@playwright/test");

const VERCEL_JSON = path.join(__dirname, "..", "vercel.json");

function readCsp(file = VERCEL_JSON) {
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const rule of config.headers ?? []) {
    for (const { key, value } of rule.headers ?? []) {
      if (key.toLowerCase() === "content-security-policy") return value;
    }
  }
  throw new Error(`No Content-Security-Policy header found in ${file}`);
}

const CSP = readCsp();

const test = base.test.extend({
  page: async ({ page, baseURL }, use) => {
    const origin = new URL(baseURL).origin;

    await page.route("**/*", async (route) => {
      const request = route.request();
      if (
        request.resourceType() !== "document" ||
        new URL(request.url()).origin !== origin
      ) {
        await route.continue();
        return;
      }

      const response = await route.fetch();
      const headers = response.headers();
      if (!(headers["content-type"] ?? "").startsWith("text/html")) {
        await route.fulfill({ response });
        return;
      }

      await route.fulfill({
        response,
        headers: { ...headers, "content-security-policy": CSP },
      });
    });

    await use(page);
  },
});

module.exports = { test, expect: base.expect, CSP, readCsp };
