# Context box: replace the legend chips in the detail view

## Why

In the detail view the legend renders as a row of chips that wraps onto two lines. On desktop each chip is a
native button with its colour swatch outside it. The bar itself is fine. The legend is the clutter.

## Goals

- Replace the legend row with a bordered **Context** box that sits beside Limits and Busy time.
- The Context box is no taller than the Limits box: a title and two rows, with the categories in columns.
- Clicking a category still opens the side pane on that category.
- In the side pane, categories become tabs, so you can switch without going back to the band.

## Non-goals

- The bar, the `N% of M` label, the Limits box, the Busy time box and the compact view do not change.
- No grouping or merging of categories.

## Approaches considered

- **Context box, 3 columns × 2 rows (picked).** It matches the boxes already there, stays as tall as Limits, and keeps every category.
- Category list, one per row: easy to read but too tall (rejected by owner).
- Top three inline with `[+3]`: most compact, but hides the smaller categories.
- Three merged groups (System / Setup / Messages): fewer cells, but loses detail on the band.

## Design

**Detail view**

```
███▌█░░░░░░░░░░░░░░░░░░░░░░░░ 7% of 1000.0k
╭──────────────────────────────────────────────╮╭─────────────────╮╭─────────╮
│ Context                                      ││ Limits          ││ Busy    │
│ █ Messages 36.6k  █ Skills 5.1k  █ MCP  1.0k ││ 5-hour ▱▱▱▱▱ 6% ││ 1m 1s   │
│ █ Tools    21.7k  █ Prompt 3.5k  █ Memory 144││ Weekly ▰▱▱▱▱ 18%││ 2 turns │
╰──────────────────────────────────────────────╯╰─────────────────╯╰─────────╯
[Compact]
```

- **Context box:** the same `borderStyle="round" borderDimColor paddingX={1}` as Limits, with a bold `Context` title.
- **Cells:** used categories, largest first, filled down each column first (2 rows, `ceil(n/2)` columns). Each cell is a
  plain `Button` whose children are the swatch `Text` (category colour) plus the name and token count, so the swatch
  sits inside the press target. Pressing a cell calls the existing `show($, name)`.
- **Colours:** unchanged. Each category keeps its index in bar order, so cell and bar colours match.
- **Short names:** System prompt → Prompt, System tools → Tools, MCP server instructions → MCP, Memory files → Memory.
  Other names are kept as they are (a pure helper in `stats.ts`, so unknown names are easy to add later).
- **Alignment:** within a column, names are padded to the longest name and token counts are right-aligned.
- **Order:** Context box, then Limits, then Busy, in the existing `flexWrap="wrap"` row, so narrow terminals wrap them.

**Side pane**

```
System prompt  10 lines, 1.5k total                          [Close]
█ Messages 36.6k  █ Tools 21.7k  █ Skills 5.1k  ▶█ Prompt 3.5k  █ MCP 1.0k  █ Memory 144
  516  lean_body          shared
  ...
```

- A wrapping row of plain Buttons under the header, one per used category, using the same short names and colours.
  The open category is marked `▶` and drawn bold. Pressing a tab calls `show($, name)`.
- The tab row takes one or two rows, so the room for line items shrinks by that much.

## Testing

- Update `band.test.tsx`: the detail view shows a Context box with every used category. Pressing a cell opens
  that category. Cell colours match the bar segments.
- Pane test: the tabs list every category, the open one is marked, and pressing another switches the pane.
- Table test for the short-name helper.
- `claude plugin test .`, `tsc`, `claude plugin validate .` green. Owner checks by eye on desktop and in the terminal.

## Left to the builder

- How exactly to fit the tab row into the pane's `room` calculation.
- Where the Context box goes when the terminal is too narrow even for one box (let it wrap).
