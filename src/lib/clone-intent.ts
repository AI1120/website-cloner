const ADDRESS = /\bhttps?:\/\/[^\s<>"']+|\bwww\.[^\s<>"'/]+\.[a-z]{2,}[^\s<>"']*/i;
const COPY_WORDS = /\b(clone|cloning|copy|copying|duplicate|replicate|mirror|recreate)\b/i;

/**
 * The web address in a request that asks to copy a site, such as "clone
 * https://example.com", or null for other requests. Used to suggest the Clone
 * Website mode to someone who typed such a request as a prompt.
 */
export function cloneIntent(text: string): string | null {
  const address = ADDRESS.exec(text)?.[0];
  if (!address || !COPY_WORDS.test(text)) return null;
  return address.replace(/[).,;:!?]+$/, "");
}

/** The address shown to a person: no protocol, no trailing slash. */
export function displayAddress(address: string): string {
  return address.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}
