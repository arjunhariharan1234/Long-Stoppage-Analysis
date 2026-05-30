import React from "react";

/** Minimal markdown renderer covering what Claude returns in chat:
 *  **bold**, *italic*, `code`, line breaks, bullet/numbered lists, headings.
 *  Avoids the ~200KB react-markdown dependency.
 */
export function renderMarkdown(input: string): React.ReactNode {
  if (!input) return null;
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let listBuf: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let paraBuf: string[] = [];

  function flushList() {
    if (!listType || listBuf.length === 0) return;
    const items = listBuf.map((t, idx) => <li key={idx} style={{ marginBottom: 2 }}>{renderInline(t)}</li>);
    if (listType === "ul") {
      blocks.push(<ul key={blocks.length} style={{ margin: "8px 0 8px 22px", padding: 0 }}>{items}</ul>);
    } else {
      blocks.push(<ol key={blocks.length} style={{ margin: "8px 0 8px 22px", padding: 0 }}>{items}</ol>);
    }
    listBuf = [];
    listType = null;
  }
  function flushPara() {
    if (paraBuf.length === 0) return;
    const text = paraBuf.join(" ");
    blocks.push(<p key={blocks.length} style={{ margin: "0 0 10px" }}>{renderInline(text)}</p>);
    paraBuf = [];
  }

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();

    // Blank line → close paragraph / list
    if (line.trim() === "") {
      flushList();
      flushPara();
      i += 1;
      continue;
    }

    // Heading: # h1 / ## h2 / ### h3
    const headMatch = /^(#{1,3})\s+(.*)$/.exec(line);
    if (headMatch) {
      flushList();
      flushPara();
      const level = headMatch[1].length;
      const text = headMatch[2];
      const sizes = { 1: 18, 2: 16, 3: 14 } as Record<number, number>;
      blocks.push(
        <div
          key={blocks.length}
          style={{
            fontSize: sizes[level],
            fontWeight: 600,
            color: "#1a2330",
            margin: "12px 0 6px",
            letterSpacing: "-0.005em",
          }}
        >
          {renderInline(text)}
        </div>
      );
      i += 1;
      continue;
    }

    // Bullet list
    const ulMatch = /^\s*[-*]\s+(.*)$/.exec(line);
    if (ulMatch) {
      flushPara();
      if (listType !== "ul") {
        flushList();
        listType = "ul";
      }
      listBuf.push(ulMatch[1]);
      i += 1;
      continue;
    }

    // Numbered list
    const olMatch = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (olMatch) {
      flushPara();
      if (listType !== "ol") {
        flushList();
        listType = "ol";
      }
      listBuf.push(olMatch[1]);
      i += 1;
      continue;
    }

    // Continuation of a list item? Lines indented under a previous item.
    if (listType && /^\s{2,}/.test(raw)) {
      if (listBuf.length > 0) {
        listBuf[listBuf.length - 1] = listBuf[listBuf.length - 1] + " " + line.trim();
      }
      i += 1;
      continue;
    }

    // Otherwise paragraph
    flushList();
    paraBuf.push(line.trim());
    i += 1;
  }
  flushList();
  flushPara();

  return <>{blocks}</>;
}

/** Inline formatting: bold, italic, inline code. Order matters — code first. */
function renderInline(text: string): React.ReactNode {
  // Tokenize on `code`, **bold**, *italic*
  const out: React.ReactNode[] = [];
  let rest = text;
  let key = 0;

  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/;

  while (rest.length > 0) {
    const m = re.exec(rest);
    if (!m) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const token = m[0];
    if (token.startsWith("`") && token.endsWith("`")) {
      out.push(
        <code
          key={key++}
          style={{
            background: "#f5f7fa",
            border: "1px solid #e4e7ec",
            borderRadius: 3,
            padding: "1px 5px",
            fontSize: "0.92em",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            color: "#434f64",
          }}
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("**") && token.endsWith("**")) {
      out.push(<strong key={key++} style={{ fontWeight: 600, color: "#1a2330" }}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*") && token.endsWith("*")) {
      out.push(<em key={key++}>{token.slice(1, -1)}</em>);
    } else {
      out.push(token);
    }
    rest = rest.slice(m.index + token.length);
  }
  return <>{out}</>;
}
