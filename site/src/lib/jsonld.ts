// Structured data (schema.org JSON-LD). Home pages: SoftwareApplication + WebSite; Privacy/Support: WebPage
// pointing to both by @id. The studio (Organization) is defined on https://arcly-studio.github.io/ – here it is
// only referenced by its @id, with name and url. No ratings or reviews (there are none to show).
// The download URL is the latest GitHub release (no Store link on this site yet, see src/lib/store.ts).
import type { Lang } from "../i18n/texts";
import { links } from "./links";

const ORG = { "@type": "Organization", "@id": `${links.studio}#organization`, name: "Arcly Studio", url: links.studio };

interface Input {
  lang: Lang;
  /** Absolute URL of this page and of the home page in each language. */
  url: string;
  home: { en: string; cs: string };
  title: string;
  description: string;
  ogImage: string;
  isHome: boolean;
}

export function jsonLd({ lang, url, home, title, description, ogImage, isHome }: Input) {
  const appId = `${home.en}#app`;
  const siteId = `${home.en}#website`;
  const graph: Record<string, unknown>[] = isHome
    ? [
        {
          "@type": "SoftwareApplication",
          "@id": appId,
          name: "NoirPad",
          description,
          url: home[lang],
          image: ogImage,
          operatingSystem: "Windows 10, Windows 11",
          applicationCategory: "UtilitiesApplication",
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          isAccessibleForFree: true,
          license: links.license,
          downloadUrl: links.latest,
          inLanguage: ["en", "cs"],
          author: ORG,
          publisher: ORG,
        },
        { "@type": "WebSite", "@id": siteId, name: "NoirPad", url: home.en, inLanguage: ["en", "cs"], publisher: ORG },
      ]
    : [
        {
          "@type": "WebPage",
          "@id": `${url}#webpage`,
          url,
          name: title,
          description,
          inLanguage: lang,
          isPartOf: { "@id": siteId },
          about: { "@id": appId },
          publisher: ORG,
        },
      ];
  // "<" escaped so the JSON can never close the <script> element.
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replaceAll("<", "\\u003c");
}
