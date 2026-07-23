# Extension UI design tokens

Sidebar webview for Rappi Cursor. Product/tool UI (not a marketing landing page).

## Brand

| Token | Value | Source |
|-------|-------|--------|
| `--rappi-accent` | `#FF441F` | Official Rappi orange (logo fill from Rappi assets) |
| `--rappi-accent-hover` | `#E03A1A` | Darken ~8% |
| Wordmark / mark | `media/rappi-wordmark.svg`, `media/rappi.svg`, `media/icon.png` | Color wordmark (sidebar); **monochrome** activity-bar SVG (`#C5C5C5` mask); marketplace PNG |

Stay on VS Code theme tokens for surfaces/text so light and dark IDE themes work.

## Spacing (8pt)

| Token | px |
|-------|-----|
| `--space-1` | 4 |
| `--space-2` | 8 |
| `--space-3` | 12 |
| `--space-4` | 16 |
| `--space-5` | 24 |

## Controls

| Control | Height | Radius |
|---------|--------|--------|
| Button / input | 28px | 6px |
| Tab | 28px | 6px |
| Focus ring | 2px `var(--vscode-focusBorder)` | - |

## Components

- **Tabs:** segmented control, single row scroll if needed, `role="tablist"`.
- **Lists:** hairline dividers only (no cards/shadows).
- **Primary CTA:** Rappi accent + white text (Place order, Add, Setup).
- **Secondary:** ghost border using `--vscode-button-secondary*`.
- **Danger/order:** accent, never competing blue VS Code primary for order actions.
