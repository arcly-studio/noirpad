// Microsoft Store button – the one switch for the main call to action.
//   status "soon": label "Coming soon to Microsoft Store" (no link) – until the Store approves NoirPad.
//   status "live": the official Store badge linking to the product page (set productId, e.g. "9XXXXXXXXXXX").
export const STORE: { status: "soon" | "live"; productId: string } = {
  status: "soon",
  productId: "",
};

export const storeUrl = (lang: string) =>
  STORE.productId
    ? `https://apps.microsoft.com/detail/${STORE.productId}?${lang === "cs" ? "hl=cs-cz&gl=CZ&" : ""}mode=direct`
    : null;
