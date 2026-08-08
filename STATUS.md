# Current Project Status

Last updated: 2026-08-08 22:40:24

## Repository role

This repository is the canonical development working copy for the
Codex Web ChatGPT Responses integration project.

## Current architecture

Codex local harness
 Responses API-compatible local provider
 browser Web ChatGPT
 native Responses function_call
 Codex local tool execution
 function_call_output
 Web ChatGPT continuation
 final response

## Verified milestones

- Browser Web ChatGPT text path: working
- Native Responses function_call loop: working
- Codex local tool execution: working
- Windows workspace-write sandbox: working
- function_call_output continuation: working
- Native Relay retry idempotency: verified
- Same logical request is not resubmitted to browser ChatGPT on reconnect

## Current blocker

Provider v7 long task exposed a machine-JSON corruption path.

The browser DOM showed valid machine JSON, but Native Relay received
content after Markdown serialization.

Root cause direction:

machine control JSON must not pass through the Markdown presentation pipeline.

## Current planned fix

Add a browser response mode:

- markdown
- visible-text

Normal assistant content keeps Markdown behavior.

Native Responses machine decisions use DOM visible text directly.

## Provider v7

Implementation not complete yet.

Do not treat Provider v7 as production-ready.

## Safety

Do not commit:

- auth tokens
- cookies
- auth.json
- Codex databases
- browser profiles
- raw Authorization headers
- unsanitized browser diagnostics