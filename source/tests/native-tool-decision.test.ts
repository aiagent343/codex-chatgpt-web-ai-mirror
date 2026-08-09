import { expect, test } from "bun:test";
import { parseNativeToolDecision } from "../src/adapters/chatgpt-web/native-tool-decision";
import type { CodexParsedRequest } from "../src/types";

const parsed = {
  context: {
    tools: [],
  },
  options: {
    toolChoice: "auto",
    parallelToolCalls: true,
  },
} as unknown as CodexParsedRequest;

function finalContent(text: string): string {
  const result =
    parseNativeToolDecision(
      text,
      parsed,
    );

  expect(result.type).toBe("final");

  if (result.type !== "final") {
    throw new Error(
      "Expected final decision",
    );
  }

  return result.content;
}

test("parses ordinary JSON", () => {
  expect(
    finalContent(
      '{"decision":"final","content":"OK"}',
    ),
  ).toBe("OK");
});

test("repairs Markdown underscore escape", () => {
  expect(
    finalContent(
      String.raw`{"decision":"final","content":"tool\_call"}`,
    ),
  ).toBe("tool_call");
});

test("preserves unknown Markdown-style escape in ordinary content", () => {
  expect(
    finalContent(
      String.raw`{"decision":"final","content":"a\*b"}`,
    ),
  ).toBe(
    String.raw`a\*b`,
  );
});

test("repairs raw Windows path backslashes", () => {
  expect(
    finalContent(
      String.raw`{"decision":"final","content":"C:\Users\PC\file.txt"}`,
    ),
  ).toBe(
    String.raw`C:\Users\PC\file.txt`,
  );
});

test("preserves already-valid escaped Windows paths", () => {
  expect(
    finalContent(
      String.raw`{"decision":"final","content":"C:\\Users\\PC\\file.txt"}`,
    ),
  ).toBe(
    String.raw`C:\Users\PC\file.txt`,
  );
});

test("preserves legal JSON newline escape", () => {
  expect(
    finalContent(
      String.raw`{"decision":"final","content":"a\nb"}`,
    ),
  ).toBe("a\nb");
});

test("preserves legal unicode escape", () => {
  expect(
    finalContent(
      String.raw`{"decision":"final","content":"\u0041"}`,
    ),
  ).toBe("A");
});

test("repairs an object with structural quotes escaped one level", () => {
  expect(
    finalContent(
      String.raw`{\"decision\":\"final\",\"content\":\"OK\"}`,
    ),
  ).toBe("OK");
});

test("repairs escaped structural quotes plus Windows path", () => {
  expect(
    finalContent(
      String.raw`{\"decision\":\"final\",\"content\":\"C:\\Users\\PC\\file.txt\"}`,
    ),
  ).toBe(
    String.raw`C:\Users\PC\file.txt`,
  );
});

test("parses JSON returned as one JSON string", () => {
  const nested =
    JSON.stringify(
      '{"decision":"final","content":"WRAPPED"}',
    );

  expect(
    finalContent(nested),
  ).toBe("WRAPPED");
});

test("extracts JSON object from surrounding prose", () => {
  expect(
    finalContent(
      'result follows: {"decision":"final","content":"PROSE"} done',
    ),
  ).toBe("PROSE");
});


test("repairs raw Windows path containing JSON escape letters", () => {
  expect(
    finalContent(
      String.raw`{"decision":"final","content":"C:\new\temp\bin\file.txt"}`,
    ),
  ).toBe(
    String.raw`C:\new\temp\bin\file.txt`,
  );
});

test("repairs raw Windows path inside command text", () => {
  expect(
    finalContent(
      String.raw`{"decision":"final","content":"Get-Content C:\Users\PC\file.txt"}`,
    ),
  ).toBe(
    String.raw`Get-Content C:\Users\PC\file.txt`,
  );
});

test("repairs raw relative Windows path", () => {
  expect(
    finalContent(
      String.raw`{"decision":"final","content":".\file.txt"}`,
    ),
  ).toBe(
    String.raw`.\file.txt`,
  );
});

test("repairs the exact smoke filename Markdown escapes", () => {
  expect(
    finalContent(
      String.raw`{"decision":"final","content":".\PARSER\_SMOKE\_SECRET.txt"}`,
    ),
  ).toBe(
    String.raw`.\PARSER_SMOKE_SECRET.txt`,
  );
});

test("preserves an even escaped backslash before underscore", () => {
  expect(
    finalContent(
      String.raw`{"decision":"final","content":"C:\\_hidden.txt"}`,
    ),
  ).toBe(
    String.raw`C:\_hidden.txt`,
  );
});
test("parses fenced JSON", () => {
  expect(
    finalContent(
      '```json\n{"decision":"final","content":"FENCED"}\n```',
    ),
  ).toBe("FENCED");
});