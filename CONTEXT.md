# context-bar

A Claude Code mod that shows the context window, and stats about the current session, above the prompt.

## Language

**Working project**:
The repository or folder Claude Code is working in for this session. Not the mod's own repo.
_Avoid_: the project (ambiguous with this repo)

**Band**:
The stats shown beside the context bar: rate limits and agent time. It does not track the working project's tests.

**Rate-limit window**:
One of the account's usage limits, such as the 5-hour window or the weekly window, shown as how full it is and when it resets.
_Avoid_: quota, spend

**Busy time**:
How long Claude has spent working on the user's messages in this session, added up. Time spent waiting for the user is not counted.
_Avoid_: agent time, session length, wall-clock time

**Turn**:
One user message and Claude's full response to it, in the main conversation. Subagent work inside it is part of the same turn.
