/** Turn chat text (markdown, links, code, emoji) into something pleasant to hear. */

/** Default cap on spoken characters: long replies stay on screen, the voice reads the start. */
export const MAX_SPEECH_CHARS = 700;

export function cleanForSpeech(input: string, maxChars = MAX_SPEECH_CHARS): string {
  let t = String(input ?? "");
  t = t.replace(/```[\s\S]*?```/g, " "); // code blocks: not speakable
  t = t.replace(/`([^`]*)`/g, "$1"); // inline code
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1"); // images → alt text
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"); // links → label
  t = t.replace(/<(https?:\/\/[^>\s]+)>/g, " "); // autolinks
  t = t.replace(/https?:\/\/\S+/g, "the link"); // bare URLs
  t = t.replace(/<\/?[a-z][^>]*>/gi, " "); // stray HTML
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, ""); // headings
  t = t.replace(/^\s{0,3}>\s?/gm, ""); // blockquotes
  t = t.replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gm, ""); // list markers
  t = t.replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, " "); // rules
  t = t.replace(/\|/g, ", "); // table pipes
  t = t.replace(/(\*\*|__)(.+?)\1/g, "$2"); // bold
  t = t.replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?:;]|$)/g, "$1$2"); // italics
  t = t.replace(/~~(.+?)~~/g, "$1");
  t = t.replace(/[*_~#>]+/g, " ");
  t = t.replace(/\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/gu, ""); // emoji
  t = t.replace(/\s*→\s*/g, " to ");
  t = t.replace(/&/g, " and ");
  // Paragraphs and list items become sentences.
  t = t
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((line) => (/[.!?:;,]$/.test(line) ? line : `${line}.`))
    .join(" ");
  t = t.replace(/\s+([.,!?;:])/g, "$1").replace(/([.,!?;:])\1+/g, "$1").replace(/\s+/g, " ").trim();
  return capAtSentence(t, maxChars);
}

function capAtSentence(t: string, max: number): string {
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (end >= max * 0.4) return head.slice(0, end + 1);
  const space = head.lastIndexOf(" ");
  return `${head.slice(0, space > max * 0.5 ? space : max).replace(/[,;:]$/, "")}…`;
}
