import { describe, expect, it } from "vitest";

import { markdownToAdf } from "../markdown-to-adf";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Shorthand: extract first content block from an ADF doc. */
function firstBlock(md: string) {
  return markdownToAdf(md).content[0];
}

// ── Document root ─────────────────────────────────────────────────────────────

describe("markdownToAdf — document root", () => {
  it("returns a valid ADF doc object", () => {
    const result = markdownToAdf("hello");

    expect(result.version).toBe(1);
    expect(result.type).toBe("doc");
    expect(Array.isArray(result.content)).toBe(true);
  });

  it("returns a doc with empty paragraph for empty string", () => {
    const result = markdownToAdf("");

    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe("paragraph");
  });
});

// ── Paragraphs ────────────────────────────────────────────────────────────────

describe("markdownToAdf — paragraphs", () => {
  it("wraps plain text in a paragraph", () => {
    const block = firstBlock("Hello world");

    expect(block?.type).toBe("paragraph");
    expect(block?.content?.[0]).toMatchObject({ type: "text", text: "Hello world" });
  });
});

// ── Headings ──────────────────────────────────────────────────────────────────

describe("markdownToAdf — headings", () => {
  it.each([
    ["# H1", 1, "H1"],
    ["## H2", 2, "H2"],
    ["### H3", 3, "H3"],
    ["#### H4", 4, "H4"],
    ["##### H5", 5, "H5"],
    ["###### H6", 6, "H6"],
  ])("converts %s to heading level %i", (md, level, title) => {
    const block = firstBlock(md);

    expect(block?.type).toBe("heading");
    expect(block?.attrs?.level).toBe(level);
    expect(block?.content?.[0]).toMatchObject({ type: "text", text: title });
  });
});

// ── Code blocks ───────────────────────────────────────────────────────────────

describe("markdownToAdf — code blocks", () => {
  it("converts fenced code block with language", () => {
    const md = "```typescript\nconst x = 1;\n```";
    const block = firstBlock(md);

    expect(block?.type).toBe("codeBlock");
    expect(block?.attrs?.language).toBe("typescript");
    expect(block?.content?.[0]).toMatchObject({ type: "text", text: "const x = 1;" });
  });

  it("converts fenced code block without language", () => {
    const md = "```\nplain code\n```";
    const block = firstBlock(md);

    expect(block?.type).toBe("codeBlock");
    expect(block?.attrs?.language).toBeUndefined();
  });
});

// ── Lists ─────────────────────────────────────────────────────────────────────

describe("markdownToAdf — bullet list", () => {
  it("converts a bullet list", () => {
    const block = firstBlock("- Alpha\n- Beta\n- Gamma");

    expect(block?.type).toBe("bulletList");
    expect(block?.content).toHaveLength(3);
    expect(block?.content?.[0]?.type).toBe("listItem");
  });
});

describe("markdownToAdf — ordered list", () => {
  it("converts an ordered list", () => {
    const block = firstBlock("1. First\n2. Second\n3. Third");

    expect(block?.type).toBe("orderedList");
    expect(block?.content).toHaveLength(3);
  });
});

describe("markdownToAdf — task list", () => {
  it("converts a task list with done/todo items", () => {
    const block = firstBlock("- [x] Done\n- [ ] Todo");

    expect(block?.type).toBe("taskList");

    const [done, todo] = block?.content ?? [];

    expect(done?.type).toBe("taskItem");
    expect(done?.attrs?.state).toBe("DONE");
    expect(todo?.attrs?.state).toBe("TODO");
  });
});

// ── Inline marks ──────────────────────────────────────────────────────────────

describe("markdownToAdf — inline marks", () => {
  it("converts **bold** to strong mark", () => {
    const block = firstBlock("**bold**");
    const textNode = block?.content?.[0];

    expect(textNode?.marks?.[0]?.type).toBe("strong");
    expect(textNode?.text).toBe("bold");
  });

  it("converts *italic* to em mark", () => {
    const block = firstBlock("*italic*");
    const textNode = block?.content?.[0];

    expect(textNode?.marks?.[0]?.type).toBe("em");
    expect(textNode?.text).toBe("italic");
  });

  it("converts `code` to code mark", () => {
    const block = firstBlock("`code`");
    const textNode = block?.content?.[0];

    expect(textNode?.marks?.[0]?.type).toBe("code");
    expect(textNode?.text).toBe("code");
  });

  it("converts ~~strike~~ to strike mark", () => {
    const block = firstBlock("~~strike~~");
    const textNode = block?.content?.[0];

    expect(textNode?.marks?.[0]?.type).toBe("strike");
    expect(textNode?.text).toBe("strike");
  });

  it("converts [link](url) to link mark", () => {
    const block = firstBlock("[click](https://example.com)");
    const textNode = block?.content?.[0];

    expect(textNode?.marks?.[0]?.type).toBe("link");
    expect(textNode?.marks?.[0]?.attrs?.href).toBe("https://example.com");
    expect(textNode?.text).toBe("click");
  });
});

// ── Horizontal rule ───────────────────────────────────────────────────────────

describe("markdownToAdf — rule", () => {
  it("converts --- to rule node", () => {
    expect(firstBlock("---")?.type).toBe("rule");
    expect(firstBlock("***")?.type).toBe("rule");
    expect(firstBlock("___")?.type).toBe("rule");
  });
});

// ── Blockquote ────────────────────────────────────────────────────────────────

describe("markdownToAdf — blockquote", () => {
  it("converts > prefix to blockquote", () => {
    const block = firstBlock("> Quoted text");

    expect(block?.type).toBe("blockquote");
    expect(block?.content?.[0]?.type).toBe("paragraph");
  });
});

// ── Table ─────────────────────────────────────────────────────────────────────

describe("markdownToAdf — table", () => {
  it("converts markdown table to ADF table node", () => {
    const md = "| Name | Value |\n| --- | --- |\n| foo | 42 |";
    const block = firstBlock(md);

    expect(block?.type).toBe("table");
    expect(block?.content).toHaveLength(2); // header row + data row

    const headerRow = block?.content?.[0];

    expect(headerRow?.content?.[0]?.type).toBe("tableHeader");
  });
});

// ── Bold-italic combination ───────────────────────────────────────────────────

describe("markdownToAdf — bold-italic", () => {
  it("converts ***text*** to strong + em marks", () => {
    const block = firstBlock("***bold-italic***");
    const textNode = block?.content?.[0];
    const markTypes = textNode?.marks?.map((m) => m.type) ?? [];

    expect(markTypes).toContain("strong");
    expect(markTypes).toContain("em");
  });
});
