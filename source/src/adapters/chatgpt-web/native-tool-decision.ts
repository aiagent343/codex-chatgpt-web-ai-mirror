import { randomUUID } from "node:crypto";
import {
  isAllowedToolChoice,
  namespacedToolName,
  resolveToolChoiceWireName,
  toolAllowedByChoice,
  type CodexParsedRequest,
  type CodexTool,
} from "../../types";

export interface NativeToolRelayRequest {
  callId: string;
  wireName: string;
  freeform: boolean;
  arguments?: Record<string, unknown>;
  input?: string;
}

export type NativeToolDecision =
  | { type: "final"; content: string }
  | { type: "tool_calls"; requests: NativeToolRelayRequest[] };

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pushUnique(target: string[], value: string): void {
  if (value && !target.includes(value)) target.push(value);
}

/**
 * Repair illegal backslash escapes inside JSON strings.
 *
 * Important distinctions:
 *
 * 1. Legal JSON escapes are preserved:
 *    \", \\, \/, \b, \f, \n, \r, \t, \uXXXX
 *
 * 2. Markdown punctuation escapes such as:
 *    \_, \*, \[, \]
 *    lose the stray Markdown slash.
 *
 * 3. A backslash before an ordinary alphanumeric character is treated as
 *    an intended literal backslash and is doubled. This allows malformed
 *    Windows paths such as C:\Users\PC to become valid JSON without
 *    deleting path separators.
 */
function repairMarkdownUnderscoreEscapes(input: string): string {
  /*
   * ChatGPT Markdown can escape underscores inside JSON strings:
   *
   *   tool\_call
   *   PARSER\_SMOKE\_SECRET.txt
   *
   * A single \_ is not valid JSON syntax.
   *
   * Remove only an ODD stray slash immediately before "_".
   *
   * This preserves valid JSON representations such as:
   *
   *   \\_hidden
   *
   * where the even slash count represents a real literal backslash.
   */
  return input.replace(/\\+_/g, match => {
    const slashCount = match.length - 1;

    if (slashCount % 2 === 0) {
      return match;
    }

    return "\\".repeat(slashCount - 1) + "_";
  });
}

function repairInvalidJsonStringEscapes(input: string): string {
  let output = "";
  let inString = false;
  let stringContent = "";
  let windowsPathMode = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;

    if (!inString) {
      if (char === '"') {
        inString = true;
        stringContent = "";
        windowsPathMode = false;
      }

      output += char;
      continue;
    }

    if (char === '"') {
      inString = false;
      stringContent = "";
      windowsPathMode = false;
      output += char;
      continue;
    }

    if (char !== "\\") {
      output += char;
      stringContent += char;
      continue;
    }

    const next = input[index + 1];

    if (next === undefined) {
      output += "\\\\";
      stringContent += "\\";
      continue;
    }

    /*
     * Detect likely Windows paths before deciding whether sequences such as
     * \n, \t, \b, \f and \r are JSON escapes.
     *
     * Examples:
     *
     *   C:\new\file.txt
     *   powershell C:\Users\PC\file.txt
     *   .\file.txt
     *   ..\file.txt
     *   \\server\share
     *
     * Once a Windows path starts, every path backslash is preserved as a
     * literal backslash, even when the following character happens to form
     * a legal JSON escape.
     */
    const startsDrivePath =
      /[A-Za-z]:$/.test(stringContent);

    const startsRelativePath =
      /(?:^|[\s"'=:(])\.{1,2}$/.test(stringContent);

    const startsUncPath =
      stringContent.length === 0 &&
      next === "\\";

    if (
      windowsPathMode ||
      startsDrivePath ||
      startsRelativePath ||
      startsUncPath
    ) {
      windowsPathMode = true;

      if (next === "\\") {
        output += "\\\\";
        stringContent += "\\";
        index += 1;
        continue;
      }

      output += "\\\\";
      stringContent += "\\";
      continue;
    }

    /*
     * Outside a detected Windows path, preserve legal JSON escapes.
     */
    if (
      next === '"' ||
      next === "\\" ||
      next === "/" ||
      next === "b" ||
      next === "f" ||
      next === "n" ||
      next === "r" ||
      next === "t"
    ) {
      output += `\\${next}`;

      if (next === '"') {
        stringContent += '"';
      }
      else if (next === "\\") {
        stringContent += "\\";
      }
      else if (next === "/") {
        stringContent += "/";
      }
      else {
        stringContent += `\\${next}`;
      }

      index += 1;
      continue;
    }

    if (next === "u") {
      const unicodeDigits =
        input.slice(index + 2, index + 6);

      if (/^[0-9a-fA-F]{4}$/.test(unicodeDigits)) {
        output += input.slice(index, index + 6);
        stringContent += input.slice(index, index + 6);
        index += 5;
        continue;
      }
    }

    /*
     * Unknown JSON escape:
     *
     * Preserve the slash literally instead of deleting it.
     *
     * Example:
     *
     *   \_
     *
     * becomes valid JSON representation of the literal characters:
     *
     *   \\_
     *
     * Identifier normalization is handled after JSON parsing, where it is
     * safe to distinguish tool/decision identifiers from command arguments.
     */
    output += "\\\\";
    stringContent += "\\";
  }

  return output;
}

/**
 * ChatGPT can occasionally return an object whose structural quotes were
 * escaped one extra level:
 *
 *   {\"decision\":\"final\",\"content\":\"OK\"}
 *
 * That is not JSON because the backslashes occur outside JSON strings.
 * This repair removes only quote escapes that behave like JSON structural
 * delimiters. Escaped quotes inside string content remain escaped.
 */
function repairEscapedStructuralQuotes(input: string): string {
  let output = "";
  let inString = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    const next = input[index + 1];

    if (char === "\\" && next === '"') {
      if (!inString) {
        output += '"';
        inString = true;
        index += 1;
        continue;
      }

      let lookahead = index + 2;
      while (
        lookahead < input.length &&
        /\s/.test(input[lookahead]!)
      ) {
        lookahead += 1;
      }

      const following = input[lookahead];

      if (
        following === ":" ||
        following === "," ||
        following === "}" ||
        following === "]" ||
        following === undefined
      ) {
        output += '"';
        inString = false;
        index += 1;
        continue;
      }

      // Likely an intentionally escaped quote inside string content.
      output += '\\"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      output += char;
      continue;
    }

    output += char;
  }

  return output;
}

function hasLikelyRawWindowsPath(input: string): boolean {
  /*
   * JSON can silently accept raw Windows path components such as:
   *
   *   C:\new\temp\bin\file.txt
   *
   * because \n, \t, \b and \f are legal JSON escapes.
   *
   * Therefore JSON.parse() succeeding is not sufficient evidence that the
   * original payload is semantically correct.
   *
   * Detect a likely raw Windows path only when the path separator is a
   * single backslash. Correctly JSON-escaped paths use two backslashes and
   * must not trigger this heuristic.
   */
  return /(?:[A-Za-z]:|(?:^|[\s"'=:(])\.{1,2})\\(?!\\)/m.test(input);
}

function buildJsonAttempts(text: string): string[] {
  let candidate = text.trim();

  const fenced =
    candidate.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);

  if (fenced) {
    candidate = fenced[1]!.trim();
  }

  const bases: string[] = [];

  pushUnique(bases, candidate);

  const first =
    candidate.indexOf("{");

  const last =
    candidate.lastIndexOf("}");

  if (first >= 0 && last > first) {
    pushUnique(
      bases,
      candidate.slice(first, last + 1),
    );
  }

  const attempts: string[] = [];

  for (const base of bases) {
    /*
     * Structural quote repair is independent from string-escape repair.
     */
    const structural =
      repairEscapedStructuralQuotes(base);

    const variants: string[] = [];

    pushUnique(variants, base);
    pushUnique(variants, structural);

    for (const variant of variants) {
      /*
       * First undo ChatGPT Markdown underscore escaping.
       *
       * This must happen BEFORE generic Windows-path repair.
       *
       * Example:
       *
       *   .\PARSER\_SMOKE\_SECRET.txt
       *
       * becomes:
       *
       *   .\PARSER_SMOKE_SECRET.txt
       *
       * Then the remaining real Windows path separators are repaired as JSON.
       */
      const markdownRepaired =
        repairMarkdownUnderscoreEscapes(variant);

      const repaired =
        repairInvalidJsonStringEscapes(markdownRepaired);

      /*
       * A raw Windows path can contain JSON escape-looking sequences such as
       * \n, \t, \b and \f, so the repaired candidate must be attempted first
       * when a likely raw Windows path is present.
       */
      if (hasLikelyRawWindowsPath(markdownRepaired)) {
        pushUnique(attempts, repaired);
        pushUnique(attempts, markdownRepaired);
        pushUnique(attempts, variant);
      }
      else {
        pushUnique(attempts, markdownRepaired);
        pushUnique(attempts, repaired);
        pushUnique(attempts, variant);
      }
    }
  }

  return attempts;
}

function parseJsonObjectInternal(
  text: string,
  depth: number,
): Record<string, unknown> {
  const attempts =
    buildJsonAttempts(text);

  let lastError: unknown;

  for (const attempt of attempts) {
    try {
      const parsed: unknown =
        JSON.parse(attempt);

      if (isObject(parsed)) {
        return parsed;
      }

      // Sometimes the entire JSON object is returned as one JSON string:
      //
      // "{\"decision\":\"final\",\"content\":\"OK\"}"
      //
      // Decode one additional layer, with a strict recursion limit.
      if (
        typeof parsed === "string" &&
        depth < 2
      ) {
        try {
          return parseJsonObjectInternal(
            parsed,
            depth + 1,
          );
        } catch (nestedError) {
          lastError = nestedError;
          continue;
        }
      }

      lastError =
        new Error(
          "relay decision must be a JSON object",
        );
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `ChatGPT native tool relay returned invalid JSON: ${
      lastError instanceof Error
        ? lastError.message
        : String(lastError)
    }`,
  );
}

function parseJsonObject(
  text: string,
): Record<string, unknown> {
  return parseJsonObjectInternal(
    text,
    0,
  );
}

function relayToolMap(
  parsed: CodexParsedRequest,
): Map<string, CodexTool> {
  const map =
    new Map<string, CodexTool>();

  for (
    const tool of
    parsed.context.tools ?? []
  ) {
    map.set(
      namespacedToolName(
        tool.namespace,
        tool.name,
      ),
      tool,
    );
  }

  return map;
}

function ensureToolChoiceAllows(
  parsed: CodexParsedRequest,
  wireName: string,
  tool: CodexTool,
): void {
  const choice =
    parsed.options.toolChoice;

  if (choice === "none") {
    throw new Error(
      `ChatGPT requested ${wireName}, but the active Codex tool_choice is none`,
    );
  }

  if (
    choice &&
    typeof choice === "object" &&
    "name" in choice
  ) {
    const required =
      resolveToolChoiceWireName(
        parsed.context.tools,
        choice.name,
      );

    if (required !== wireName) {
      throw new Error(
        `ChatGPT requested ${wireName}, but Codex requires tool ${required}`,
      );
    }
  }

  if (isAllowedToolChoice(choice)) {
    const allowed =
      new Set(choice.allowedTools);

    if (
      !toolAllowedByChoice(
        tool,
        allowed,
      )
    ) {
      throw new Error(
        `ChatGPT requested ${wireName}, but it is outside Codex allowed_tools`,
      );
    }
  }
}

function toolChoiceRequiresCall(
  parsed: CodexParsedRequest,
): boolean {
  const choice =
    parsed.options.toolChoice;

  return (
    choice === "required" ||
    (
      typeof choice === "object" &&
      choice !== null &&
      "name" in choice
    ) ||
    (
      isAllowedToolChoice(choice) &&
      choice.mode === "required"
    )
  );
}

function normalizeCall(
  parsed: CodexParsedRequest,
  available: Map<string, CodexTool>,
  value: unknown,
  index: number,
): NativeToolRelayRequest {
  if (!isObject(value)) {
    throw new Error(
      `tool_calls[${index}] must be an object`,
    );
  }

  const name =
    value.name;

  if (
    typeof name !== "string" ||
    !name.trim()
  ) {
    throw new Error(
      `tool_calls[${index}].name must be a non-empty string`,
    );
  }

  const wireName =
    name.trim().replace(/\\_/g, "_");

  const tool =
    available.get(wireName);

  if (!tool) {
    throw new Error(
      `ChatGPT requested a tool that the active Codex round did not advertise: ${wireName}`,
    );
  }

  ensureToolChoiceAllows(
    parsed,
    wireName,
    tool,
  );

  const rawArguments =
    value.arguments ?? {};

  if (!isObject(rawArguments)) {
    throw new Error(
      `tool_calls[${index}].arguments must be a JSON object`,
    );
  }

  const callId =
    `call_web_${randomUUID().replaceAll("-", "")}`;

  if (tool.freeform) {
    const input =
      rawArguments.input;

    if (typeof input !== "string") {
      throw new Error(
        `Freeform tool ${wireName} requires arguments.input to be a string`,
      );
    }

    return {
      callId,
      wireName,
      freeform: true,
      input,
    };
  }

  return {
    callId,
    wireName,
    freeform: false,
    arguments: rawArguments,
  };
}

export function parseNativeToolDecision(
  text: string,
  parsed: CodexParsedRequest,
): NativeToolDecision {
  const value =
    parseJsonObject(text);

  const rawDecision =
    value.decision;

  const decision =
    typeof rawDecision === "string"
      ? rawDecision.replace(/\\_/g, "_")
      : rawDecision;

  if (decision === "final") {
    if (
      toolChoiceRequiresCall(parsed)
    ) {
      throw new Error(
        "ChatGPT returned a final answer, but the active Codex tool_choice requires a tool call",
      );
    }

    if (
      typeof value.content !== "string"
    ) {
      throw new Error(
        "A final relay decision requires string field content",
      );
    }

    return {
      type: "final",
      content: value.content,
    };
  }

  if (
    decision !== "tool_call" &&
    decision !== "tool_calls"
  ) {
    throw new Error(
      `Unknown ChatGPT native tool relay decision: ${String(decision)}`,
    );
  }

  const rawCalls =
    decision === "tool_call"
      ? [
          {
            name: value.name,
            arguments: value.arguments,
          },
        ]
      : value.calls;

  if (
    !Array.isArray(rawCalls) ||
    rawCalls.length === 0
  ) {
    throw new Error(
      "A tool relay decision requires at least one tool call",
    );
  }

  if (
    parsed.options.parallelToolCalls === false &&
    rawCalls.length > 1
  ) {
    throw new Error(
      "ChatGPT returned parallel tool calls while Codex parallel_tool_calls is false",
    );
  }

  const available =
    relayToolMap(parsed);

  const requests =
    rawCalls.map(
      (call, index) =>
        normalizeCall(
          parsed,
          available,
          call,
          index,
        ),
    );

  return {
    type: "tool_calls",
    requests,
  };
}