# context-bar

A Claude Code mod that shows your context window as a stacked bar above the prompt, in Hangar 18 colours, with a band beside it for your rate limits and the session's busy time.

## Install

```
git clone https://github.com/kshitijbhattWHO/context-bar.git ~/.claude/mods/context-bar
```

Restart Claude Code.

## Use

Run `/context-bar` to toggle the bar and band on or off. In the detail view, click a category in the Context box to open its lines in a side pane, where each category has its own tab, or run `/context-lines [N] [all]` to rank everything in the window.

By default the bar, its percent, the band and a Details button share one line:

```
██████████░░░░░░░░░░ 34% of 200.0k  5h ▰▰▱▱▱ 38%  wk ▰▰▰▱▱ 62%  busy 52m 14s · 33 turns  cache 47m left  [Details]
```

- **5h** and **wk** are your 5-hour and weekly rate-limit windows. Each turns yellow at 70% and pink at 90%, and shows when it resets once it passes 70% (a countdown for 5h, a local day and time for weekly). On a Claude gateway the spend limit is left out; off a subscription the limits are hidden.
- **busy** is how long Claude has worked on your messages in the main conversation, and **turns** is how many messages it has answered. `/clear` resets both.
- **cache** is how long the prompt cache has left, counted from the end of Claude's last reply. It turns yellow in its last 10 minutes; once it lapses it reads `cache cold · idle 2h 13m` in pink, so a stale session is easy to spot. A compaction (`/compact` or auto) turns it cold at once, `cache cold · compacted`, until Claude's next reply caches the new conversation. A subscription's cache lasts 60 minutes; set `CONTEXT_BAR_CACHE_TTL_MIN` (for example `5` on the API) to change that. It's an estimate from timing: the engine doesn't report the cache's state directly.
- On a narrow terminal, turns go first, then busy time, then the weekly window, then the cache. The bar always keeps at least 20 cells.

Details switches to the full view: the bar, then a Context box (every category, largest first, in two rows), a Limits box, a Busy time box and a Cache box (when cold, it also estimates how many tokens your next message will re-cache). Compact switches back. The choice holds for the session.

To give messages a fixed budget, set `CONTEXT_BAR_MAX_TOKENS`; 100% then means whatever loads up front (system prompt, tools, memory, skills) plus that many message tokens. Set it in `~/.claude/settings.json`:

```json
{ "env": { "CONTEXT_BAR_MAX_TOKENS": "150000" } }
```

## Update

```
git -C ~/.claude/mods/context-bar pull
```
