import type { ReactNode } from "react";

/**
 * A small, safe subset of Markdown for what the agent says: paragraphs,
 * bold, italic, inline code, code blocks, lists and links (a heading
 * becomes a bold line). It builds React nodes, never HTML, so nothing the
 * agent writes can become markup; what it does not know stays as written.
 */

type Block =
  | { type: "paragraph"; text: string; strong: boolean }
  | { type: "code"; text: string }
  | { type: "list"; start: number | null; items: string[] };

const FENCE = /^\s{0,3}(```|~~~)/;
const HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*#*$/;
/** A list item: a bullet, or a number (captured) and a dot. */
const ITEM = /^\s{0,3}(?:[-*+]|(\d{1,9})[.)])\s+(.*)$/;

/** Splits text into blocks. A code fence left open runs to the end: the reply may still be on its way. */
function blocksOf(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split("\n");
  const line = (index: number) => lines[index] ?? "";
  let i = 0;
  while (i < lines.length) {
    const fence = FENCE.exec(line(i))?.[1];
    const heading = HEADING.exec(line(i))?.[1];
    const first = ITEM.exec(line(i));
    if (fence) {
      const from = ++i;
      while (i < lines.length && !line(i).trimStart().startsWith(fence)) i++;
      blocks.push({ type: "code", text: lines.slice(from, i++).join("\n") });
    } else if (heading) {
      blocks.push({ type: "paragraph", text: heading, strong: true });
      i++;
    } else if (first) {
      const ordered = first[1] !== undefined;
      const items: string[] = [];
      for (; i < lines.length; i++) {
        const item = ITEM.exec(line(i));
        if (item && (item[1] !== undefined) === ordered) items.push(item[2] ?? "");
        // An indented line that is not an item continues the one above.
        else if (!item && /^\s+\S/.test(line(i))) items[items.length - 1] += `\n${line(i).trim()}`;
        else break;
      }
      blocks.push({ type: "list", start: ordered ? Number(first[1]) : null, items });
    } else if (line(i).trim() === "") {
      i++;
    } else {
      const from = i;
      while (i < lines.length && line(i).trim() !== "" && !FENCE.test(line(i)) && !HEADING.test(line(i)) && !ITEM.test(line(i))) i++;
      blocks.push({ type: "paragraph", text: lines.slice(from, i).join("\n"), strong: false });
    }
  }
  return blocks;
}

// Sticky patterns: each is tried at one position only.
const CODE = /`([^`\n]+)`/y;
const BOLD = /(\*\*|__)(?=\S)([\s\S]*?\S)\1/y;
const ITALIC = /([*_])(?!\1)(?=\S)([\s\S]*?\S)\1/y;
const LINK = /\[([^\]\n]+)\]\(([^()\s]+)\)/y;
const ADDRESS = /https?:\/\/[^\s<>]*[^\s<>.,;:!?'")\]]/y;
/** Where a link may lead. Anything else (`javascript:`…) stays text. */
const SAFE = /^(https?:\/\/|mailto:)/i;
const ESCAPABLE = /[\\`*_[\]()#+\-.!~>]/;
const WORD = /[\p{L}\p{N}]/u;

function link(href: string, children: ReactNode, key: number): ReactNode {
  return (
    <a key={key} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

/** Turns the inline marks of one block into nodes. */
function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let plain = "";
  const push = (node: ReactNode) => {
    if (plain) nodes.push(plain);
    plain = "";
    nodes.push(node);
  };
  for (let i = 0; i < text.length; ) {
    const char = text.charAt(i);
    const inWord = WORD.test(text.charAt(i - 1));
    const at = (pattern: RegExp) => {
      pattern.lastIndex = i;
      const match = pattern.exec(text);
      // `snake_case` is not emphasis: an underscore only counts at the edge of a word.
      const glued = match && char === "_" && (inWord || WORD.test(text.charAt(i + match[0].length)));
      return glued ? null : match;
    };
    let match: RegExpExecArray | null = null;
    if (char === "\\" && ESCAPABLE.test(text.charAt(i + 1))) {
      plain += text.charAt(i + 1);
      i += 2;
      continue;
    }
    if (char === "`" && (match = at(CODE))) push(<code key={i}>{match[1]}</code>);
    else if ((char === "*" || char === "_") && (match = at(BOLD))) push(<strong key={i}>{inline(match[2] ?? "")}</strong>);
    else if ((char === "*" || char === "_") && (match = at(ITALIC))) push(<em key={i}>{inline(match[2] ?? "")}</em>);
    else if (char === "[" && (match = at(LINK)) && SAFE.test(match[2] ?? "")) push(link(match[2] ?? "", inline(match[1] ?? ""), i));
    else if (char === "h" && !inWord && (match = at(ADDRESS))) push(link(match[0], match[0], i));
    else match = null;

    if (match) i += match[0].length;
    else {
      plain += char;
      i++;
    }
  }
  if (plain) nodes.push(plain);
  return nodes;
}

/** What the agent said, with its light formatting. */
export function Markdown({ text }: { text: string }) {
  return blocksOf(text).map((block, index) => {
    if (block.type === "code") {
      return (
        <pre key={index}>
          <code>{block.text}</code>
        </pre>
      );
    }
    if (block.type === "list") {
      const List = block.start === null ? "ul" : "ol";
      return (
        <List key={index} start={block.start ?? undefined}>
          {block.items.map((item, at) => (
            <li key={at}>{inline(item)}</li>
          ))}
        </List>
      );
    }
    return <p key={index}>{block.strong ? <strong>{inline(block.text)}</strong> : inline(block.text)}</p>;
  });
}
