# Design System — FoamPilot

## Product Context
- **What this is:** Desktop CFD simulation launcher and GUI for OpenFOAM
- **Project type:** Electron + React desktop application
- **Design reference:** Visual Studio Code (Dark+ theme)
- **Target users:** Engineering students, CFD hobbyists, aerodynamics researchers

## Design Philosophy
FoamPilot should feel like a natural extension of the VS Code ecosystem. Users who spend their day in VS Code should feel immediately at home. The interface prioritizes information density, keyboard accessibility, and visual quiet — letting the simulation data be the focus, not the chrome.

---

## Layout

### Zone Architecture
```
┌──────────────────────────────────────────────────────────┐
│ Title Bar (drag region, window controls)            30px │
├────┬───────────┬─────────────────────────────────────────┤
│ AB │ Side Bar  │ Editor Area                             │
│ 48 │ 250px     │ (breadcrumb + tabs + content + panel)   │
│ px │ collapse  │                                         │
│    │           ├─────────────────────────────────────────┤
│    │           │ Panel (terminal, logs, output)    200px │
├────┴───────────┴─────────────────────────────────────────┤
│ Status Bar                                          22px │
└──────────────────────────────────────────────────────────┘
```

### Activity Bar (48px)
- Icon-only, vertically stacked
- Items: Wizard (rocket), Simulations (folder), Dashboard (layout), Logs (terminal), Dict Editor (file-text), Settings (gear — bottom-aligned, separated)
- Active indicator: 2px left border in `--vscode-accent`
- Background: `--vscode-activitybar-bg`
- No border-radius on icons

### Side Bar (250px, collapsible)
- Opens contextually based on Activity Bar selection
- Section headers: 11px semibold, `--vscode-description-fg`
- Tree items: 22px row height, 8px left padding per indent level
- Background: `--vscode-sidebar-bg`

### Editor Area
- Breadcrumb trail at top: `Geometry › Mesh › Physics › Solver › Run › Results`
- Tab bar: flat tabs, 35px height
- Content: scrollable, padded 16px
- Background: `--vscode-editor-bg`

### Panel (collapsible, bottom)
- Terminal/log output during mesh generation and solver runs
- Tabs: Output, Terminal, Problems
- Monospace font, dark background
- Drag-resizable divider

### Status Bar (22px)
- Background: `--vscode-statusbar-bg` (`#007acc` idle, `#c27d00` during solver run)
- Left: case name, backend connection indicator
- Right: core count, mesh cell count, solver iteration
- Font: 12px, `--vscode-foreground`

---

## Color Tokens (Dark+ Theme)

### Backgrounds
| Token | Hex | Usage |
|-------|-----|-------|
| `--vscode-editor-bg` | `#1e1e1e` | Main content area, active tab |
| `--vscode-sidebar-bg` | `#252526` | Side bar, panels |
| `--vscode-activitybar-bg` | `#333333` | Activity bar |
| `--vscode-titlebar-bg` | `#3c3c3c` | Title bar |
| `--vscode-input-bg` | `#3c3c3c` | Form inputs, dropdowns |
| `--vscode-tab-inactive-bg` | `#2d2d2d` | Inactive tabs |
| `--vscode-statusbar-bg` | `#007acc` | Status bar (idle) |
| `--vscode-statusbar-debugging` | `#c27d00` | Status bar (solver running) |
| `--vscode-hover-bg` | `#2a2d2e` | List/tree hover |
| `--vscode-selection-bg` | `#04395e` | Selected list item |

### Borders
| Token | Hex | Usage |
|-------|-----|-------|
| `--vscode-border` | `#474747` | Panel borders, input borders |
| `--vscode-focus-border` | `#007fd4` | Focus outlines |
| `--vscode-tab-active-border-top` | `#0078d4` | Active tab indicator |
| `--vscode-activitybar-active-border` | `#ffffff` | Active activity bar item |

### Text
| Token | Hex | Usage |
|-------|-----|-------|
| `--vscode-foreground` | `#cccccc` | Primary text |
| `--vscode-description-fg` | `#858585` | Secondary/muted text |
| `--vscode-disabled-fg` | `#5a5a5a` | Disabled text |
| `--vscode-link-fg` | `#3794ff` | Links |

### Semantic
| Token | Hex | Usage |
|-------|-----|-------|
| `--vscode-accent` | `#0078d4` | Primary accent (buttons, focus, indicators) |
| `--vscode-accent-hover` | `#1177bb` | Button hover |
| `--vscode-error` | `#f48771` | Error messages, error squiggles |
| `--vscode-warning` | `#cca700` | Warning messages |
| `--vscode-success` | `#89d185` | Success states, completed steps |
| `--vscode-info` | `#75beff` | Info badges |

### Editor Syntax (for Monaco)
| Token | Hex | Usage |
|-------|-----|-------|
| `--syntax-keyword` | `#569cd6` | Keywords (FoamFile, class, object) |
| `--syntax-string` | `#ce9178` | String values |
| `--syntax-number` | `#b5cea8` | Numeric values |
| `--syntax-comment` | `#6a9955` | Comments |
| `--syntax-type` | `#4ec9b0` | Type names |

---

## Typography

### Font Stack
```css
--font-ui: "Segoe UI", system-ui, -apple-system, sans-serif;
--font-mono: "Cascadia Code", "Consolas", "Courier New", monospace;
```

### Scale
| Role | Font | Size | Weight | Line-height |
|------|------|------|--------|-------------|
| Page heading | `--font-ui` | 20px | 600 | 1.3 |
| Section heading | `--font-ui` | 14px | 600 | 1.4 |
| Body text | `--font-ui` | 13px | 400 | 1.4 |
| Label / caption | `--font-ui` | 11px | 600 | 1.4 |
| Status bar | `--font-ui` | 12px | 400 | 22px (line-height = bar height) |
| Tab label | `--font-ui` | 13px | 400 | 35px (line-height = tab height) |
| Code editor | `--font-mono` | 14px | 400 | 1.5 |
| Terminal/logs | `--font-mono` | 13px | 400 | 1.4 |
| Breadcrumb | `--font-ui` | 13px | 400 | 1.4 |

### Rules
- Never use `text-transform: uppercase` or `letter-spacing` on labels
- Headings use weight 600 (semibold), never 700 (bold)
- Body text minimum 13px
- Monospace minimum 12px
- No decorative fonts

---

## Spacing

### Base Unit: 4px
| Token | Value | Usage |
|-------|-------|-------|
| `--space-1` | 2px | Tight gaps (inline icon spacing) |
| `--space-2` | 4px | Micro padding (between inline elements) |
| `--space-3` | 8px | Small padding (list items, compact controls) |
| `--space-4` | 10px | Standard padding (sidebar sections) |
| `--space-5` | 16px | Content padding (editor area margins) |
| `--space-6` | 20px | Section gaps |
| `--space-7` | 24px | Major section separators |

### Rules
- Sidebar items: 8px vertical padding, 10px horizontal
- Activity bar icons: centered in 48px cells, 24px icon size
- Tab bar: 0 gap between tabs, 8px horizontal padding per tab
- Content area: 16px padding all sides
- Between form fields: 8px gap
- Between sections: 20px gap

---

## Border Radius

| Element | Radius |
|---------|--------|
| Tabs | `0` |
| Activity bar items | `0` |
| Sidebar list items | `0` |
| Status bar | `0` |
| Input fields | `2px` |
| Buttons | `2px` |
| Dropdowns | `3px` |
| Tooltips | `3px` |
| Notifications / toasts | `4px` |
| Command palette / modals | `6px` |
| Scrollbar thumb | `4px` |

### Rule
Default is `0`. Only floating/overlay elements get radius. Never use `8px+` radius.

---

## Components

### Buttons
```
Primary:   bg #0e639c → hover #1177bb, text #fff, 2px radius, 13px, padding 4px 14px
Secondary: bg transparent, border 1px #474747, text #ccc, 2px radius, 13px, padding 4px 14px
Ghost:     bg transparent, no border, text #ccc → hover bg #2a2d2e
Danger:    bg #c72e42 → hover #d73b52, text #fff
Disabled:  opacity 0.5, cursor not-allowed
```

### Tabs (Editor-style)
```
Height: 35px
Inactive: bg #2d2d2d, text #858585, border-top 2px transparent
Active:   bg #1e1e1e, text #fff, border-top 2px #0078d4
Hover:    bg #2d2d2d, text #cccccc
Close (x): appears on hover, 16px, text #858585 → hover #fff
Modified:  dot indicator before label
```

### Inputs
```
Background: #3c3c3c
Border: 1px solid #474747
Focus: border 1px solid #007fd4
Text: #cccccc
Placeholder: #858585
Height: 26px
Padding: 4px 8px
Font: 13px
Radius: 2px
```

### Tree / List Items
```
Row height: 22px
Padding: 0 8px, indent 8px per level
Hover: bg #2a2d2e
Selected: bg #04395e
Active: bg #04395e + left border 2px #0078d4
Text: 13px, #cccccc
Icon: 16px, 6px right margin
```

### Wizard Stepper (as Breadcrumb)
```
Style: text breadcrumb trail, not circles
Format: Geometry › Mesh › Physics › Solver › Run › Results
Active: text #fff, font-weight 600
Completed: text #89d185
Future: text #858585
Separator: › in #858585
Position: top of editor area, below tab bar
Height: 22px
Padding: 0 10px
Background: #1e1e1e
```

### Scrollbars
```
Width: 10px (vertical), 10px (horizontal)
Thumb: #424242, no border, 4px radius
Thumb hover: #555555
Track: transparent
Behavior: fade when idle, appear on hover/scroll
```

### Notifications / Toasts
```
Background: #252526
Border: 1px solid #474747
Border-left: 3px solid (accent for info, #f48771 for error, #cca700 for warning)
Radius: 4px
Shadow: 0 4px 8px rgba(0,0,0,0.3)
Position: bottom-right, stacked
Auto-dismiss: 5s for info, sticky for errors
```

---

## Interaction States

| State | Style |
|-------|-------|
| Hover | `background: #2a2d2e` (subtle, no color shift) |
| Active/Selected | `background: #04395e` + `border-left: 2px solid #0078d4` |
| Focus-visible | `outline: 1px solid #007fd4; outline-offset: -1px` |
| Disabled | `opacity: 0.5; cursor: not-allowed` |
| Loading | Skeleton shapes matching content layout, shimmer animation |
| Drag-over | `border: 2px dashed #007fd4; background: rgba(0,120,212,0.1)` |

### Global Focus Rule
```css
*:focus-visible {
  outline: 1px solid var(--vscode-focus-border);
  outline-offset: -1px;
}
```

---

## Motion

| Transition | Duration | Easing |
|------------|----------|--------|
| Hover background | 100ms | ease |
| Sidebar collapse/expand | 200ms | ease-out |
| Panel resize | 0ms (instant, drag-driven) |
| Tab switch | 0ms (instant) |
| Notification enter | 200ms | ease-out |
| Notification exit | 150ms | ease-in |
| Status bar color change | 300ms | ease |
| Skeleton shimmer | 1.5s | linear, infinite |

### Rules
- Only animate `opacity`, `transform`, `background-color`, `border-color`
- Never animate layout properties (`width`, `height`, `top`, `left`)
- Respect `prefers-reduced-motion: reduce`
- No transition on tab content changes (instant swap)
- No page transition animations

---

## Iconography

- **Library:** Lucide React (already in use — good match for VS Code's Codicon style)
- **Size:** 16px in sidebars/lists, 24px in Activity Bar, 14px inline with text
- **Color:** inherits text color (`currentColor`)
- **Style:** stroke-based, 1.5px stroke width
- **Rule:** Icons are functional, never decorative. No colored icon backgrounds or circles.

---

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-27 | VS Code Dark+ as design reference | User request — familiar to target audience (engineers who code) |
| 2026-03-27 | Activity Bar + Side Bar layout | Core VS Code pattern; replaces generic sidebar nav |
| 2026-03-27 | Neutral grays over Tailwind slate | Slate has blue undertone that reads SaaS; VS Code uses warm neutrals |
| 2026-03-27 | Segoe UI + Cascadia Code font pairing | VS Code's native fonts; familiar on Windows |
| 2026-03-27 | Zero border-radius on tabs/sidebar | VS Code's defining visual characteristic; bubbly radius reads generic |
| 2026-03-27 | Status bar with accent color | Iconic VS Code element; communicates system state |
| 2026-03-27 | Breadcrumb stepper over circle stepper | Fits VS Code paradigm; circles are a SaaS pattern |
| 2026-03-27 | Baseline captured from live code + VS Code reference | Inferred by /plan-design-review |
