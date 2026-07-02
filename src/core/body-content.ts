/** True when content uses HTML tags (vs plain text with newlines). */
export function looksLikeHtml(body: string): boolean {
  return /<\s*(p|br|div|span|h[1-6]|ul|ol|li|a|strong|em|blockquote|pre|code|table|section|article|img|video|audio|picture|figure|source|iframe)\b/i.test(
    body
  );
}
