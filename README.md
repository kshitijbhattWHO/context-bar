# context-bar

A Claude Code mod that shows your context window as a stacked bar above the prompt, in Hangar 18 colours.

## Install

```
git clone https://github.com/kshitijbhattWHO/context-bar.git ~/.claude/mods/context-bar
```

Restart Claude Code.

## Use

Run `/context-bar` to toggle the bar on or off. Click a legend entry for that category's lines, or run `/context-lines [N] [all]` to rank everything in the window.

To make 100% mean less than the model's window (e.g. 150k on a 1M model), set `CONTEXT_BAR_MAX_TOKENS` in `~/.claude/settings.json`:

```json
{ "env": { "CONTEXT_BAR_MAX_TOKENS": "150000" } }
```

## Update

```
git -C ~/.claude/mods/context-bar pull
```
