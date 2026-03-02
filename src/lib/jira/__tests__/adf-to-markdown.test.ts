import { describe, expect, it } from "vitest";

import { adfToMarkdown, type AdfDoc, type AdfNode } from "../adf-to-markdown";

// ── Helpers ──────────────────────────────────────────────────────────────────

function doc(...blocks: AdfNode[]): AdfDoc {
  return { version: 1, type: "doc", content: blocks };
}

function p(...content: AdfNode[]): AdfNode {
  return { type: "paragraph", content };
}

function text(t: string, marks?: AdfNode["marks"]): AdfNode {
  return marks ? { type: "text", text: t, marks } : { type: "text", text: t };
}

// ── Null / empty ──────────────────────────────────────────────────────────────

describe("adfToMarkdown — null/empty", () => {
  it("returns empty string for null", () => {
    expect(adfToMarkdown(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(adfToMarkdown(undefined)).toBe("");
  });

  it("returns empty string for non-object", () => {
    expect(adfToMarkdown("string")).toBe("");
    expect(adfToMarkdown(42)).toBe("");
  });

  it("returns empty string for object without content", () => {
    expect(adfToMarkdown({})).toBe("");
  });

  it("returns empty string for empty doc", () => {
    expect(adfToMarkdown(doc())).toBe("");
  });
});

// ── Paragraphs ────────────────────────────────────────────────────────────────

describe("adfToMarkdown — paragraphs", () => {
  it("renders a plain paragraph", () => {
    expect(adfToMarkdown(doc(p(text("Hello world"))))).toBe("Hello world");
  });

  it("separates two paragraphs with a blank line", () => {
    expect(adfToMarkdown(doc(p(text("First")), p(text("Second"))))).toBe("First\n\nSecond");
  });

  it("filters out empty blocks", () => {
    expect(adfToMarkdown(doc(p(), p(text("Non-empty"))))).toBe("Non-empty");
  });
});

// ── Inline marks ──────────────────────────────────────────────────────────────

describe("adfToMarkdown — inline marks", () => {
  it("renders bold", () => {
    expect(adfToMarkdown(doc(p(text("bold", [{ type: "strong" }]))))).toBe("**bold**");
  });

  it("renders italic", () => {
    expect(adfToMarkdown(doc(p(text("italic", [{ type: "em" }]))))).toBe("*italic*");
  });

  it("renders inline code", () => {
    expect(adfToMarkdown(doc(p(text("code", [{ type: "code" }]))))).toBe("`code`");
  });

  it("renders strikethrough", () => {
    expect(adfToMarkdown(doc(p(text("strike", [{ type: "strike" }]))))).toBe("~~strike~~");
  });

  it("renders link", () => {
    expect(
      adfToMarkdown(
        doc(p(text("click", [{ type: "link", attrs: { href: "https://example.com" } }])))
      )
    ).toBe("[click](https://example.com)");
  });

  it("renders bold + italic as ***text***", () => {
    // marks applied in sequence: strong → **t**, then em → ***t***
    expect(adfToMarkdown(doc(p(text("t", [{ type: "strong" }, { type: "em" }]))))).toBe("***t***");
  });

  it("ignores unknown marks (textColor, underline)", () => {
    expect(
      adfToMarkdown(doc(p(text("plain", [{ type: "textColor", attrs: { color: "#ff0000" } }]))))
    ).toBe("plain");
  });

  it("renders hardBreak as two-space newline", () => {
    expect(adfToMarkdown(doc(p(text("line1"), { type: "hardBreak" }, text("line2"))))).toBe(
      "line1  \nline2"
    );
  });

  it("renders mention with @ prefix", () => {
    expect(adfToMarkdown(doc(p({ type: "mention", attrs: { text: "@john.doe" } })))).toBe(
      "@john.doe"
    );
  });

  it("does not double-prefix @", () => {
    expect(adfToMarkdown(doc(p({ type: "mention", attrs: { text: "alice" } })))).toBe("@alice");
  });

  it("renders emoji shortName", () => {
    expect(adfToMarkdown(doc(p({ type: "emoji", attrs: { shortName: ":thumbsup:" } })))).toBe(
      ":thumbsup:"
    );
  });

  it("renders inlineCard as angle-bracket URL", () => {
    expect(
      adfToMarkdown(
        doc(p({ type: "inlineCard", attrs: { url: "https://jira.example.com/browse/FOO-1" } }))
      )
    ).toBe("<https://jira.example.com/browse/FOO-1>");
  });
});

// ── Headings ──────────────────────────────────────────────────────────────────

describe("adfToMarkdown — headings", () => {
  it.each([1, 2, 3, 4, 5, 6])("renders h%i", (level) => {
    const block: AdfNode = {
      type: "heading",
      attrs: { level },
      content: [text(`Heading ${level}`)],
    };

    expect(adfToMarkdown(doc(block))).toBe(`${"#".repeat(level)} Heading ${level}`);
  });

  it("clamps heading level to 6 when > 6", () => {
    const block: AdfNode = {
      type: "heading",
      attrs: { level: 7 },
      content: [text("Too deep")],
    };

    expect(adfToMarkdown(doc(block))).toBe("###### Too deep");
  });

  it("clamps heading level to 1 when < 1", () => {
    const block: AdfNode = {
      type: "heading",
      attrs: { level: 0 },
      content: [text("Too shallow")],
    };

    expect(adfToMarkdown(doc(block))).toBe("# Too shallow");
  });
});

// ── Code blocks ───────────────────────────────────────────────────────────────

describe("adfToMarkdown — code blocks", () => {
  it("renders fenced code block with language", () => {
    const block: AdfNode = {
      type: "codeBlock",
      attrs: { language: "typescript" },
      content: [{ type: "text", text: "const x = 1;" }],
    };

    expect(adfToMarkdown(doc(block))).toBe("```typescript\nconst x = 1;\n```");
  });

  it("renders fenced code block without language", () => {
    const block: AdfNode = {
      type: "codeBlock",
      attrs: {},
      content: [{ type: "text", text: "plain code" }],
    };

    expect(adfToMarkdown(doc(block))).toBe("```\nplain code\n```");
  });

  it("renders multiline code block", () => {
    const block: AdfNode = {
      type: "codeBlock",
      attrs: { language: "python" },
      content: [{ type: "text", text: "def foo():\n    return 1" }],
    };

    expect(adfToMarkdown(doc(block))).toBe("```python\ndef foo():\n    return 1\n```");
  });
});

// ── Lists ─────────────────────────────────────────────────────────────────────

describe("adfToMarkdown — bullet list", () => {
  it("renders a simple bullet list", () => {
    const list: AdfNode = {
      type: "bulletList",
      content: [
        { type: "listItem", content: [p(text("Alpha"))] },
        { type: "listItem", content: [p(text("Beta"))] },
      ],
    };

    expect(adfToMarkdown(doc(list))).toBe("- Alpha\n- Beta");
  });

  it("renders a nested bullet list with two-space indent", () => {
    const nested: AdfNode = {
      type: "bulletList",
      content: [{ type: "listItem", content: [p(text("Child"))] }],
    };
    const list: AdfNode = {
      type: "bulletList",
      content: [{ type: "listItem", content: [p(text("Parent")), nested] }],
    };

    expect(adfToMarkdown(doc(list))).toBe("- Parent\n  - Child");
  });
});

describe("adfToMarkdown — ordered list", () => {
  it("renders items numbered sequentially starting at 1", () => {
    const list: AdfNode = {
      type: "orderedList",
      content: [
        { type: "listItem", content: [p(text("First"))] },
        { type: "listItem", content: [p(text("Second"))] },
        { type: "listItem", content: [p(text("Third"))] },
      ],
    };

    expect(adfToMarkdown(doc(list))).toBe("1. First\n2. Second\n3. Third");
  });
});

describe("adfToMarkdown — task list", () => {
  it("renders DONE items as [x] and TODO as [ ]", () => {
    const list: AdfNode = {
      type: "taskList",
      content: [
        { type: "taskItem", attrs: { state: "DONE" }, content: [text("Done item")] },
        { type: "taskItem", attrs: { state: "TODO" }, content: [text("Pending item")] },
      ],
    };

    expect(adfToMarkdown(doc(list))).toBe("- [x] Done item\n- [ ] Pending item");
  });
});

// ── Blockquote / panel ────────────────────────────────────────────────────────

describe("adfToMarkdown — blockquote", () => {
  it("prefixes each line with >", () => {
    const quote: AdfNode = {
      type: "blockquote",
      content: [p(text("Quoted text"))],
    };

    expect(adfToMarkdown(doc(quote))).toBe("> Quoted text");
  });
});

describe("adfToMarkdown — panel", () => {
  it("renders panel as blockquote (same treatment)", () => {
    const panel: AdfNode = {
      type: "panel",
      attrs: { panelType: "info" },
      content: [p(text("Info message"))],
    };

    expect(adfToMarkdown(doc(panel))).toBe("> Info message");
  });
});

// ── Horizontal rule ───────────────────────────────────────────────────────────

describe("adfToMarkdown — rule", () => {
  it("renders ---", () => {
    expect(adfToMarkdown(doc({ type: "rule" }))).toBe("---");
  });
});

// ── Table ─────────────────────────────────────────────────────────────────────

describe("adfToMarkdown — table", () => {
  it("renders table with header row and separator", () => {
    const table: AdfNode = {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableHeader", content: [p(text("Name"))] },
            { type: "tableHeader", content: [p(text("Value"))] },
          ],
        },
        {
          type: "tableRow",
          content: [
            { type: "tableCell", content: [p(text("foo"))] },
            { type: "tableCell", content: [p(text("42"))] },
          ],
        },
      ],
    };

    expect(adfToMarkdown(doc(table))).toBe("| Name | Value |\n| --- | --- |\n| foo | 42 |");
  });

  it("renders table cell containing a non-paragraph block via blockToMd fallback", () => {
    // Covers the `blockToMd(b)` branch in the table cell mapper
    const table: AdfNode = {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableHeader",
              content: [
                {
                  type: "codeBlock",
                  attrs: { language: "ts" },
                  content: [{ type: "text", text: "x" }],
                },
              ],
            },
          ],
        },
      ],
    };

    const result = adfToMarkdown(doc(table));

    expect(result).toContain("```ts");
  });
});

// ── Expand ────────────────────────────────────────────────────────────────────

describe("adfToMarkdown — expand", () => {
  it("renders title in bold followed by content", () => {
    const expand: AdfNode = {
      type: "expand",
      attrs: { title: "Details" },
      content: [p(text("Hidden content"))],
    };

    expect(adfToMarkdown(doc(expand))).toBe("**Details**\nHidden content");
  });

  it("renders expand without title as plain content", () => {
    const expand: AdfNode = {
      type: "expand",
      attrs: { title: "" },
      content: [p(text("Content"))],
    };

    expect(adfToMarkdown(doc(expand))).toBe("Content");
  });

  it("renders expand with no attrs as plain content", () => {
    // Covers `node.attrs?.title ?? ""` when attrs is undefined
    const expand: AdfNode = {
      type: "expand",
      content: [p(text("No attrs"))],
    };

    expect(adfToMarkdown(doc(expand))).toBe("No attrs");
  });
});

// ── Media ─────────────────────────────────────────────────────────────────────

describe("adfToMarkdown — media", () => {
  it.each(["mediaSingle", "mediaGroup", "media"])("renders %s as placeholder", (type) => {
    expect(adfToMarkdown(doc({ type }))).toBe("*[attachment]*");
  });
});

// ── Unknown node types ────────────────────────────────────────────────────────

describe("adfToMarkdown — unknown nodes", () => {
  it("falls back to child content for unknown block types", () => {
    const unknown: AdfNode = {
      type: "unknownBlock",
      content: [text("fallback text")],
    };

    expect(adfToMarkdown(doc(unknown))).toBe("fallback text");
  });

  it("falls back to .text for leaf unknown nodes", () => {
    const leaf: AdfNode = { type: "unknownLeaf", text: "raw" };

    expect(adfToMarkdown(doc(leaf))).toBe("raw");
  });

  it("returns empty string for a leaf node with no text and no content", () => {
    // Covers the `node.text ?? ""` fallback when text is undefined
    const leaf: AdfNode = { type: "unknownLeaf" };

    expect(adfToMarkdown(doc(leaf))).toBe("");
  });
});

// ── Real-world document ───────────────────────────────────────────────────────

describe("adfToMarkdown — real-world document", () => {
  it("converts a rich ticket description", () => {
    const input = doc(
      { type: "heading", attrs: { level: 2 }, content: [text("Overview")] },
      p(text("This feature implements "), text("QES validation", [{ type: "strong" }]), text(".")),
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [p(text("Validate signature"))] },
          { type: "listItem", content: [p(text("Store result"))] },
        ],
      },
      {
        type: "codeBlock",
        attrs: { language: "ts" },
        content: [{ type: "text", text: "// TODO" }],
      }
    );

    expect(adfToMarkdown(input)).toBe(
      [
        "## Overview",
        "",
        "This feature implements **QES validation**.",
        "",
        "- Validate signature\n- Store result",
        "",
        "```ts\n// TODO\n```",
      ].join("\n")
    );
  });
});
