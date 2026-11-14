# context-bar

A Claude Code mod that shows your context window as a stacked bar above the prompt, in Hangar 18 colours, with a band beside it for your rate limits and the session's busy time.

## Install

```
git clone https://github.com/kshitijbhattWHO/context-bar.git ~/.claude/mods/context-bar
```

Restart Claude Code.

## Use

Run `/context-bar` to toggle the bar and band on or off. Click a legend entry for that category's lines, or run `/context-lines [N] [all]` to rank everything in the window.

By default the bar, its percent, the band and a Details button share one line:

```
██████████░░░░░░░░░░ 34% of 200.0k  5h ▰▰▱▱▱ 38%  wk ▰▰▰▱▱ 62%  busy 52m 14s · 33 turns  [Details]
```

- **5h** and **wk** are your 5-hour and weekly rate-limit windows. Each turns yellow at 70% and pink at 90%, and shows when it resets once it passes 70% (a countdown for 5h, a local day and time for weekly). On a Claude gateway the spend limit is left out; off a subscription the limits are hidden.
- **busy** is how long Claude has worked on your messages in the main conversation, and **turns** is how many messages it has answered. `/clear` resets both.
- On a narrow terminal, turns go first, then busy time, then the weekly window. The bar always keeps at least 20 cells.

Details switches to the full view: the bar and legend, a Limits box and a Busy time box. Compact switches back. The choice holds for the session.

To give messages a fixed budget, set `CONTEXT_BAR_MAX_TOKENS`; 100% then means whatever loads up front (system prompt, tools, memory, skills) plus that many message tokens. Set it in `~/.claude/settings.json`:

```json
{ "env": { "CONTEXT_BAR_MAX_TOKENS": "150000" } }
```

## Update

```
git -C ~/.claude/mods/context-bar pull
```
