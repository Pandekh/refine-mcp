/**
 * Atlassian Document Format (ADF) → Markdown converter.
 *
 * Handles all block and inline node types returned by the Jira Cloud REST API v3:
 *   Blocks:   paragraph, heading (h1–h6), bulletList, orderedList, taskList,
 *             codeBlock, blockquote, panel, table, rule, expand,
 *             mediaSingle / mediaGroup / media
 *   Inline:   text (with marks: strong, em, code, strike, link),
 *             hardBreak, mention, emoji, inlineCard
 */

export type AdfMark = {
  type:
    | "code"
    | "em"
    | "link"
    | "strike"
    | "strong"
    | "textColor"
    | "underline"
    | "backgroundColor";
  attrs?: Record<string, unknown>;
};

export type AdfNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  marks?: AdfMark[];
};

export type AdfDoc = {
  version: 1;
  type: "doc";
  content: AdfNode[];
};

// ── Inline renderer ──────────────────────────────────────────────────────────

export function inlineToMd(nodes: AdfNode[]): string {
  return (
    nodes
      // eslint-disable-next-line complexity
      .map((node) => {
        if (node.type === "hardBreak") {
          return "  \n";
        }

        if (node.type === "mention") {
          return `@${((node.attrs?.text as string | undefined) ?? "").replace(/^@/, "")}`;
        }

        if (node.type === "emoji") {
          return (node.attrs?.shortName as string | undefined) ?? "";
        }

        if (node.type === "inlineCard") {
          return `<${(node.attrs?.url as string | undefined) ?? ""}>`;
        }

        let text = node.text ?? (node.content ? inlineToMd(node.content) : "");

        for (const mark of node.marks ?? []) {
          switch (mark.type) {
            case "code":
              text = `\`${text}\``;
              break;
            case "strong":
              text = `**${text}**`;
              break;
            case "em":
              text = `*${text}*`;
              break;
            case "strike":
              text = `~~${text}~~`;
              break;
            case "link":
              text = `[${text}](${(mark.attrs?.href as string | undefined) ?? ""})`;
              break;
            // textColor, underline, backgroundColor: no Markdown equivalent, render plain
          }
        }

        return text;
      })
      .join("")
  );
}

// ── Block renderer ───────────────────────────────────────────────────────────

// eslint-disable-next-line complexity
export function blockToMd(node: AdfNode, depth = 0): string {
  const pad = "  ".repeat(depth);

  switch (node.type) {
    case "paragraph":
      return inlineToMd(node.content ?? []);

    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6);

      return `${"#".repeat(level)} ${inlineToMd(node.content ?? [])}`;
    }

    case "codeBlock": {
      const lang = (node.attrs?.language as string | undefined) ?? "";
      const code = (node.content ?? []).map((n) => n.text ?? "").join("");

      return `\`\`\`${lang}\n${code}\n\`\`\``;
    }

    case "bulletList":
    case "orderedList":
      return (node.content ?? [])
        .map((item, i) => {
          const [para, ...rest] = item.content ?? [];
          const text = para?.type === "paragraph" ? inlineToMd(para.content ?? []) : "";
          const bullet = node.type === "orderedList" ? `${i + 1}.` : "-";
          const nested = rest
            .map((child) => blockToMd(child, depth + 1))
            .filter(Boolean)
            .join("\n");

          return [`${pad}${bullet} ${text}`, nested].filter(Boolean).join("\n");
        })
        .join("\n");

    case "taskList":
      return (node.content ?? [])
        .map((item) => {
          const checked = item.attrs?.state === "DONE" ? "x" : " ";
          const text = inlineToMd(item.content ?? []);

          return `${pad}- [${checked}] ${text}`;
        })
        .join("\n");

    case "blockquote":
    case "panel": {
      const inner = (node.content ?? []).map((n) => blockToMd(n)).join("\n");

      return inner
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n");
    }

    case "rule":
      return "---";

    case "table": {
      const rows = node.content ?? [];
      const lines: string[] = [];

      rows.forEach((row, rowIdx) => {
        const cells = (row.content ?? []).map((cell) =>
          (cell.content ?? [])
            .map((b) => (b.type === "paragraph" ? inlineToMd(b.content ?? []) : blockToMd(b)))
            .join(" ")
            .trim()
        );

        lines.push(`| ${cells.join(" | ")} |`);

        if (rowIdx === 0) {
          lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
        }
      });

      return lines.join("\n");
    }

    case "expand": {
      const title = (node.attrs?.title as string | undefined) ?? "";
      const inner = (node.content ?? []).map((n) => blockToMd(n)).join("\n\n");

      return title ? `**${title}**\n${inner}` : inner;
    }

    case "mediaSingle":
    case "mediaGroup":
    case "media":
      return "*[attachment]*";

    default:
      if (node.content) {
        return node.content.map((n) => blockToMd(n)).join("\n");
      }

      return node.text ?? "";
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function adfToMarkdown(adf: unknown): string {
  if (!adf || typeof adf !== "object") {
    return "";
  }

  const doc = adf as { content?: AdfNode[] };

  if (!doc.content) {
    return "";
  }

  return doc.content
    .map((block) => blockToMd(block))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}
