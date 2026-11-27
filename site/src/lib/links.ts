// Links outside the website. The repository was renamed to lowercase "noirpad" (GitHub redirects the old
// "NoirPad" URLs, the website uses the new name).
export const REPO = "https://github.com/arcly-studio/noirpad";

export const links = {
  repo: REPO,
  latest: `${REPO}/releases/latest`,
  releases: `${REPO}/releases`,
  changelog: `${REPO}/blob/main/CHANGELOG.md`,
  issues: `${REPO}/issues`,
  // Issue forms in .github/ISSUE_TEMPLATE
  bugReport: `${REPO}/issues/new?template=bug_report.yml`,
  featureRequest: `${REPO}/issues/new?template=feature_request.yml`,
  security: `${REPO}/security/policy`,
  license: `${REPO}/blob/main/LICENSE`,
  email: "arclystudio.dev@gmail.com",
  // The host of this website (GitHub Pages) – its own privacy statement.
  githubPrivacy: "https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement",
  // Microsoft Privacy Statement (WebView2, Microsoft Store) – the same addresses as PRIVACY.md / PRIVACY.cs.md of the app.
  msPrivacy: { en: "https://privacy.microsoft.com/privacystatement", cs: "https://privacy.microsoft.com/cs-cz/privacystatement" },
  // Studio website (org Pages) – absolute, so the link keeps working with a custom domain later.
  studio: "https://arcly-studio.github.io/",
  // The other app of the studio, a project site on the same host.
  dirwise: "https://arcly-studio.github.io/dirwise/",
};

export const studioLink = (lang: string) => (lang === "cs" ? `${links.studio}cs/` : links.studio);
export const dirwiseLink = (lang: string) => (lang === "cs" ? `${links.dirwise}cs/` : links.dirwise);

// Pages of the site: "" = home, otherwise "privacy/" or "support/". Base path from configure-pages (/noirpad/).
export type PagePath = "" | "privacy/" | "support/";
export const BASE = import.meta.env.BASE_URL.replace(/\/?$/, "/");
export const pageHref = (lang: string, path: PagePath = "") => `${BASE}${lang === "cs" ? "cs/" : ""}${path}`;
