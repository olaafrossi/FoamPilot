# Design System — FoamPilot

## Product Context
- **What this is:** Desktop CFD simulation launcher and GUI for OpenFOAM
- **Project type:** Electron + React desktop application
- **Design reference:** VS Code layout (Activity Bar + Sidebar + Editor) with warm amber + zinc industrial palette
- **Target users:** Engineering students, CFD hobbyists, aerodynamics researchers
- **Inspiration:** ClawKanban (warm amber accent, warm zinc neutrals, industrial/utilitarian mood)

## Design Philosophy
FoamPilot is an engineering instrument — a precision tool that feels alive when your simulation is running. The warm amber accent (the "pilot light") communicates active state and differentiates from the sea of blue dev tools. The interface prioritizes information density, keyboard accessibility, and visual quiet — letting the simulation data be the focus.

---

## Typography

### Font Stack
```css
--font-display: "Satoshi", "Segoe UI", system-ui, -apple-system, sans-serif;
--font-ui: "Segoe UI", system-ui, -apple-system, sans-serif;
--font-mono: "Cascadia Code", "Consolas", "Courier New", monospace;
```

### Scale
| Role | Font | Size | Weight | Line-height |
|------|------|------|--------|-------------|
| Page heading | `--font-display` | 24px | 700 | 1.3 |
| Section heading | `--font-display` | 16px | 700 | 1.4 |
| Body text | `--font-ui` | 13px | 400 | 1.4 |
| Label / caption | `--font-ui` | 11px | 600 | 1.4 |
| Status bar | `--font-ui` | 12px | 400 | 22px |
| Tab label | `--font-ui` | 13px | 400 | 35px |
| Code editor | `--font-mono` | 14px | 400 | 1.5 |
| Terminal/logs | `--font-mono` | 13px | 400 | 1.4 |
| Breadcrumb | `--font-ui` | 13px | 400 | 1.4 |

### Rules
- Display font (Satoshi Bold) for page headings only; body uses Segoe UI
- Headings use weight 700, never 600
- Body text minimum 13px, monospace minimum 12px
- No decorative fonts, no text-transform: uppercase on labels

---

## Color Tokens (Warm Amber + Zinc)

### Backgrounds
| Token | Hex | Usage |
|-------|-----|-------|
| `--bg-editor` | `#09090B` | Main content area (zinc-950) |
| `--bg-sidebar` | `#18181B` | Side bar, panels (zinc-900) |
| `--bg-activitybar` | `#09090B` | Activity bar (flush with editor) |
| `--bg-surface` | `#18181B` | Card/panel surfaces (zinc-900) |
| `--bg-elevated` | `#27272A` | Elevated panels, disabled buttons (zinc-800) |
| `--bg-input` | `#27272A` | Form inputs, dropdowns (zinc-800) |
| `--bg-hover` | `#27272A` | List/tree hover (zinc-800) |
| `--bg-selection` | `rgba(245, 158, 11, 0.12)` | Selected list item (amber tint) |
| `--bg-statusbar` | `#18181B` | Status bar (dark, not colored) |

### Borders
| Token | Hex | Usage |
|-------|-----|-------|
| `--border` | `#3F3F46` | Panel borders, input borders (zinc-700) |
| `--border-focus` | `#F59E0B` | Focus outlines (amber-500) |
| `--border-tab-active` | `#F59E0B` | Active tab indicator (amber-500) |

### Text
| Token | Hex | Usage |
|-------|-----|-------|
| `--fg` | `#FAFAFA` | Primary text (zinc-50) |
| `--fg-muted` | `#71717A` | Secondary/muted text (zinc-500) |
| `--fg-disabled` | `#52525B` | Disabled text (zinc-600) |
| `--fg-link` | `#F59E0B` | Links (amber-500) |

### Accent — Amber
| Token | Hex | Usage |
|-------|-----|-------|
| `--accent` | `#F59E0B` | Primary accent, CTAs, active indicators (amber-500) |
| `--accent-hover` | `#D97706` | Button hover (amber-600) |
| `--accent-bg` | `rgba(245, 158, 11, 0.1)` | Amber background tint |

### Semantic
| Token | Hex | Usage |
|-------|-----|-------|
| `--success` | `#22C55E` | Task complete, healthy (green-500) |
| `--warning` | `#EAB308` | Timeout approaching (yellow-500) |
| `--error` | `#EF4444` | Error state (red-500) |
| `--info` | `#3B82F6` | Informational (blue-500) |
| `--danger` | `#DC2626` | Destructive actions (red-600) |
| `--danger-hover` | `#EF4444` | Destructive hover (red-500) |

---

## Layout

### Zone Architecture
```
┌──────────────────────────────────────────────────────────┐
│ (no title bar — Electron frameless or system chrome)     │
├────┬───────────┬─────────────────────────────────────────┤
│ AB │ Side Bar  │ Editor Area                             │
│ 48 │ 250px     │ (breadcrumb + content)                  │
│ px │ collapse  │                                         │
│    │           ├─────────────────────────────────────────┤
│ FP │           │ Panel (terminal, logs, output)    200px │
│logo│           │                                         │
├────┴───────────┴─────────────────────────────────────────┤
│ Status Bar (dark zinc, amber indicators)           22px  │
└──────────────────────────────────────────────────────────┘
```

### Activity Bar (48px)
- FP logo monogram at top (amber #F59E0B, Satoshi Black, click → Wizard)
- Icon-only nav items, vertically stacked
- Active indicator: 2px left border in `--accent` (amber)
- Active icon: `--fg`, inactive icon: `--fg-muted`
- Background: `--bg-activitybar` (flush with editor)

### Status Bar (22px)
- Background: `--bg-statusbar` (dark zinc, NOT solid colored)
- Border-top: 1px `--border`
- Amber dot indicator (●) for connection status
- Text: `--fg-muted`
- Running state: amber pulse animation on indicator

---

## Spacing

### Base Unit: 4px
| Token | Value | Usage |
|-------|-------|-------|
| `--space-1` | 2px | Tight gaps |
| `--space-2` | 4px | Micro padding |
| `--space-3` | 8px | Small padding |
| `--space-4` | 10px | Standard padding |
| `--space-5` | 16px | Content padding |
| `--space-6` | 20px | Section gaps |
| `--space-7` | 24px | Major separators |

---

## Border Radius
| Element | Radius |
|---------|--------|
| Tabs, activity bar, sidebar items | `0` |
| Input fields, buttons | `2px` |
| Dropdowns, tooltips | `3px` |
| Notifications, toasts | `4px` |
| Modals | `6px` |

---

## Components

### Buttons
```
Primary:   bg var(--accent) → hover var(--accent-hover), text #09090B, 2px radius
Secondary: bg transparent, border 1px var(--border), text var(--fg)
Ghost:     bg transparent, no border, text var(--fg) → hover bg var(--bg-hover)
Danger:    bg var(--danger) → hover var(--danger-hover), text #fff
Disabled:  bg var(--bg-elevated), text var(--fg-disabled), cursor not-allowed
```

### Cards (Geometry Chooser)
```
Surface: bg var(--bg-surface), border 1px var(--border)
Hover: border-color var(--accent), box-shadow amber glow
Selected: border var(--accent), box-shadow 0 0 0 1px rgba(245,158,11,0.2)
Icon: Lucide icon in accent color, left of title
```

### Wizard Stepper (Breadcrumb)
```
Current step: text var(--accent), font-weight 600
Completed: text var(--success), check icon prefix
Future: text var(--fg-muted)
Separator: › in var(--fg-muted)
```

---

## Motion

| Transition | Duration | Easing |
|------------|----------|--------|
| Hover background | 100ms | ease |
| Sidebar collapse | 200ms | ease-out |
| Card hover glow | 200ms | ease |
| Amber pulse | 3s | ease-in-out, infinite |
| Amber dot pulse | 2s | ease-in-out, infinite |
| Notification enter | 200ms | ease-out |
| Status bar color | 300ms | ease |

### Rules
- Only animate `opacity`, `transform`, `background-color`, `border-color`, `box-shadow`
- Respect `prefers-reduced-motion: reduce`
- No page transition animations

---

## Tailwind Theme Integration

All design tokens are available as Tailwind utilities via `@theme` block in `index.css`:
```
bg-bg-surface, bg-bg-hover, bg-bg-elevated
text-fg, text-fg-muted, text-fg-disabled
border-border-default, border-border-focus
bg-accent, bg-accent-hover, bg-accent-bg
text-error, text-success, text-warning, text-info
```

---

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-27 | VS Code layout as structural reference | Familiar to target audience (engineers who code) |
| 2026-03-27 | Warm amber accent (#F59E0B) replacing MS blue | Industrial "pilot light" — differentiates from blue dev tools, maps to engineering status lights |
| 2026-03-27 | Warm zinc neutrals replacing cool grays | Warmer, more approachable; pairs with amber better than cool grays |
| 2026-03-27 | Satoshi for display headings | Geometric sans with squared terminals — industrial personality without being decorative |
| 2026-03-27 | FP monogram logo in activity bar | Simple brand anchor, amber colored, navigates to Wizard on click |
| 2026-03-27 | Dark status bar with amber indicators | More sophisticated than solid colored bar; amber dot indicates connection state |
| 2026-03-27 | Amber pulse animation for running state | "Your simulation is alive" — the emotional core of the interface |
| 2026-03-27 | ClawKanban DESIGN.md as palette inspiration | Warm amber + zinc proven in another project; adapted for desktop CFD context |
