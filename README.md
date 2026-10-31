# context-bar

A Claude Code mod that shows your context window as a stacked bar above the prompt, in Hangar 18 colours.

## Install

```
git clone https://github.com/kshitijbhattWHO/context-bar.git ~/.claude/mods/context-bar
```

Restart Claude Code.

## Use

Run `/context-bar` to toggle the bar on or off. Click a legend entry for that category's lines, or run `/context-lines [N] [all]` to rank everything in the window.

To give messages a fixed budget, set `CONTEXT_BAR_MAX_TOKENS`; 100% then means whatever loads up front (system prompt, tools, memory, skills) plus that many message tokens. Set it in `~/.claude/settings.json`:

```json
{ "env": { "CONTEXT_BAR_MAX_TOKENS": "150000" } }
```

## Update

```
git -C ~/.claude/mods/context-bar pull
```
