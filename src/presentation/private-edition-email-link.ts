import { escapeHtml } from "./html-safety.js";

export function addPrivateEditionLink(
  html: string,
  privateUrl: string,
): string {
  const bodyMarker = "<body>";
  if (!html.includes(bodyMarker)) {
    throw new Error("Could not add the private edition link to invalid HTML.");
  }
  const escapedUrl = escapeHtml(privateUrl);
  const link = `<div style="padding:16px;text-align:center;background:#fff8ec;border-bottom:1px solid #d9c9af"><a href="${escapedUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#8c491a;color:#fff8ec;font:600 14px/1.2 Arial,sans-serif;text-decoration:none">Open the full private edition · 打开完整版本</a></div>`;
  return html.replace(bodyMarker, `${bodyMarker}\n  ${link}`);
}
