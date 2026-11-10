import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./Markdown";

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe("Markdown", () => {
  it("makes paragraphs, and keeps the line breaks inside them", () => {
    expect(html("Sent.\nI also filed the bill.\n\nAnything else?")).toBe("<p>Sent.\nI also filed the bill.</p><p>Anything else?</p>");
  });

  it("marks bold, italic and inline code, also inside one another", () => {
    expect(html("**March**, *really* and __both *ways*__")).toBe("<p><strong>March</strong>, <em>really</em> and <strong>both <em>ways</em></strong></p>");
    expect(html("Run `npm test` in _the_ folder")).toBe("<p>Run <code>npm test</code> in <em>the</em> folder</p>");
  });

  it("leaves alone what only looks like emphasis", () => {
    expect(html("my_file_name.txt and 2 * 3 * 4")).toBe("<p>my_file_name.txt and 2 * 3 * 4</p>");
    expect(html("a `*literal*` and an escaped \\*star\\*")).toBe("<p>a <code>*literal*</code> and an escaped *star*</p>");
    expect(html("**never closed")).toBe("<p>**never closed</p>");
  });

  it("builds bulleted and numbered lists", () => {
    expect(html("Albums:\n- **Lisbon**\n- Brittany\n  in July")).toBe("<p>Albums:</p><ul><li><strong>Lisbon</strong></li><li>Brittany\nin July</li></ul>");
    expect(html("3. third\n4. fourth")).toBe('<ol start="3"><li>third</li><li>fourth</li></ol>');
  });

  it("shows code blocks as written, even one that is not closed yet", () => {
    expect(html("Here:\n```sh\nnpm run *build*\n```\nDone.")).toBe("<p>Here:</p><pre><code>npm run *build*</code></pre><p>Done.</p>");
    expect(html("```\nstill typ")).toBe("<pre><code>still typ</code></pre>");
  });

  it("turns a heading into a bold line", () => {
    expect(html("## What I did\nNothing yet.")).toBe("<p><strong>What I did</strong></p><p>Nothing yet.</p>");
  });

  it("links what is safe to follow, in a new tab", () => {
    const attributes = 'target="_blank" rel="noopener noreferrer"';
    expect(html("It's live at [the site](https://example.com/a?b=1).")).toBe(`<p>It&#x27;s live at <a href="https://example.com/a?b=1" ${attributes}>the site</a>.</p>`);
    expect(html("See https://example.com/page, then reply.")).toBe(`<p>See <a href="https://example.com/page" ${attributes}>https://example.com/page</a>, then reply.</p>`);
    expect(html("[write](mailto:claire@example.com)")).toContain('href="mailto:claire@example.com"');
  });

  it("never lets the agent's words become markup or a script", () => {
    expect(html("[click](javascript:alert(1)) [x](data:text/html,hi)")).not.toContain("<a");
    expect(html('<img src=x onerror="alert(1)"> & <b>bold</b>')).toBe("<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &lt;b&gt;bold&lt;/b&gt;</p>");
  });
});
