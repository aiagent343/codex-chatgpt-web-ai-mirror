# Current Issues

## ACTIVE

### Native machine JSON must bypass Markdown serialization

Observed behavior:

1. Web ChatGPT completed normally.
2. Browser DOM displayed valid JSON.
3. Native Relay parser later reported an invalid JSON escape.
4. Reconnect idempotency worked correctly:
   one browser execution, multiple cached replays.

Planned solution:

Introduce a dedicated visible-text response path for Native Responses
machine decisions while retaining Markdown for normal text responses.

---

## RESOLVED

### Duplicate browser submissions during Codex reconnect

Resolved with Native Relay execution-key idempotency.

Expected behavior:

start trace=<same-trace>

followed by:

replay trace=<same-trace>

without reopening another browser conversation.