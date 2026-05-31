const urlPattern = /https?:\/\/[^\s<>\]]+/g;
const trailingPunctuation = /[.,;:!?]+$/;
const pastedFootnotePattern =
  /^(\s*)(\d+|[A-Za-z][\w-]*)\s+(https?:\/\/\S+)(?:\s+["“]([^"”]+)["”])?\s*$/;

export function markdownLinkForUrl(url: string): string {
  const label = url.replace(/^https?:\/\//, "").replaceAll("]", "\\]");
  return `[${label}](${url})`;
}

export function transformPastedUrlsToMarkdownLinks(text: string): string {
  return text.replace(urlPattern, (match) => {
    const trailing = trailingPunctuation.exec(match)?.[0] ?? "";
    const url = trailing ? match.slice(0, -trailing.length) : match;

    if (!url) return match;

    return `${markdownLinkForUrl(url)}${trailing}`;
  });
}

export function transformPastedMarkdownText(text: string): string {
  return text
    .split(/(\r?\n)/)
    .map((part) => {
      if (part === "\n" || part === "\r\n") return part;
      return transformPastedFootnoteLine(part);
    })
    .join("");
}

function transformPastedFootnoteLine(line: string): string {
  const footnote = pastedFootnotePattern.exec(line);
  if (footnote) {
    const [, indent, id, rawUrl, rawTitle] = footnote;
    const url = trimUrlTrailingPunctuation(rawUrl);
    const link = markdownLinkForUrl(url);
    const title = rawTitle?.trim();

    return `${indent}[^${id}]: ${link}${title ? ` "${title}"` : ""}`;
  }

  return transformPastedUrlsToMarkdownLinks(line);
}

function trimUrlTrailingPunctuation(url: string): string {
  const trailing = trailingPunctuation.exec(url)?.[0] ?? "";
  return trailing ? url.slice(0, -trailing.length) : url;
}
