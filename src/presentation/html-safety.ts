export function formatExternalLink(title: string, url: string): string {
  const href = safeHttpHref(url);
  return href === null
    ? `<span class="link-unavailable">${escapeHtml(title)} (link unavailable)</span>`
    : `<a href="${href}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>`;
}

export function safeHttpHref(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? escapeHtml(value)
      : null;
  } catch {
    return null;
  }
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );
}
