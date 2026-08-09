import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const workerSource = readFileSync(
  new URL("../src/adapters/chatgpt-web/browser-worker.ts", import.meta.url),
  "utf8",
);

const adapterSource = readFileSync(
  new URL("../src/adapters/chatgpt-web/index.ts", import.meta.url),
  "utf8",
);

test("native Responses machine decisions use DOM visible text instead of Markdown serialization", () => {
  expect(workerSource).toContain('responseTextMode?: "markdown" | "visible-text";');
  expect(workerSource).toContain(
    'const serializeAsMarkdown = turn.responseTextMode !== "visible-text";',
  );
  expect(workerSource).toContain(
    '? markdownBuffer.observe(snapshot.markdownSegments)',
  );
  expect(workerSource).toContain(
    'if (turn.responseTextMode === "visible-text") {',
  );
  expect(workerSource).toContain("finalText = snapshot.visibleText;");
  expect(adapterSource).toContain('responseTextMode: "visible-text",');
});

test("ordinary browser turns retain Markdown as the default response path", () => {
  expect(workerSource).toContain(
    'const serializeAsMarkdown = turn.responseTextMode !== "visible-text";',
  );
  expect(workerSource).toContain("const final = markdownBuffer.finish();");
  expect(workerSource).toContain("finalText = final.markdown;");
});