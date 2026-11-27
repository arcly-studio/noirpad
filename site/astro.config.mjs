// NoirPad website (GitHub Pages project site, https://arcly-studio.github.io/noirpad/).
// In CI the address comes from actions/configure-pages (SITE_URL + BASE_PATH) – same pattern as the
// Dirwise site, so it also fits a custom domain later. Locally the defaults below match production.
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

const site = process.env.SITE_URL || "https://arcly-studio.github.io";
const base = process.env.BASE_PATH || "/noirpad";

export default defineConfig({
  site,
  base,
  trailingSlash: "always",
  // The CSS is small – inlined into the HTML, no render-blocking request.
  build: { inlineStylesheets: "always" },
  integrations: [
    sitemap({
      i18n: { defaultLocale: "en", locales: { en: "en", cs: "cs" } },
    }),
  ],
});
