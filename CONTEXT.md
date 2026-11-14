# context-bar

A Claude Code mod that shows the context window, and stats about the current session, above the prompt.

## Language

**Working project**:
The repository or folder Claude Code is working in for this session. Not the mod's own repo.
_Avoid_: the project (ambiguous with this repo)

**Band**:
The whole row above the prompt: the context bar and its percent, then the stats beside it (rate limits, busy time, the cache countdown). In compact view it is one line; Details opens it into boxes. It does not track the working project's tests.

**Message budget**:
How many message tokens count as 100% of the context, on top of what loads up front (system prompt, tools, memory, skills). Set by `CONTEXT_BAR_MAX_TOKENS`; without it, 100% is the model's context window.
_Avoid_: cap, max tokens, window (taken by **Rate-limit window**)

**Rate-limit window**:
One of the account's usage limits, such as the 5-hour window or the weekly window, shown as how full it is and when it resets.
_Avoid_: quota, spend

**Busy time**:
How long Claude has spent working on the user's messages in this session, added up. Time spent waiting for the user is not counted.
_Avoid_: agent time, session length, wall-clock time

**Cache countdown**:
How long the prompt cache is likely to stay warm, counted from the end of the last main turn against the cache's lifetime (60 minutes on a subscription). Once it runs out the session is **cold**, and the next message pays to cache the whole conversation again.
_Avoid_: cache hit rate (the mod doesn't measure hits)

**Turn**:
One user message and Claude's full response to it, in the main conversation. Subagent work inside it is part of the same turn.
