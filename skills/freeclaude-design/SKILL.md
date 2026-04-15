# FreeClaude Design Skill

**Name:** freeclaude-design
**Version:** 1.0.0
**Category:** design
**Triggers:** `/freeclaude-design`, "нарисуй UI", "design component", "freeclaude style"

---

## Design System

FreeClaude uses a clean, professional dark theme inspired by Apple HIG and modern SaaS dashboards.

### Color Palette

```
Background:
  --bg-primary: #0F172A      (Deep Navy — main background)
  --bg-secondary: #1E293B    (Slate 800 — cards, panels)
  --bg-tertiary: #334155     (Slate 700 — hover states)
  --bg-elevated: #1E293B     (Slate 800 — modals, popovers)

Text:
  --text-primary: #F8FAFC    (Slate 50 — headings)
  --text-secondary: #94A3B8  (Slate 400 — body)
  --text-muted: #64748B      (Slate 500 — captions)
  --text-accent: #60A5FA     (Blue 400 — links, highlights)

Accent:
  --accent-primary: #3B82F6  (Blue 500 — buttons, active states)
  --accent-hover: #2563EB    (Blue 600 — hover)
  --accent-light: #DBEAFE    (Blue 100 — badges, tags)
  --accent-glow: rgba(59, 130, 246, 0.15)  (subtle glow)

Semantic:
  --success: #22C55E         (Green 500)
  --warning: #F59E0B         (Amber 500)
  --error: #EF4444           (Red 500)
  --info: #3B82F6            (Blue 500)

Borders:
  --border-default: #1E293B  (Slate 800)
  --border-subtle: #334155   (Slate 700)
  --border-focus: #3B82F6    (Blue 500)
```

### Typography

```
Font Family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
Monospace: JetBrains Mono, 'Fira Code', monospace

Scale (desktop):
  Display:    48px / 56px / -0.025em  (hero text)
  H1:         32px / 40px / -0.025em
  H2:         24px / 32px / -0.025em
  H3:         20px / 28px / -0.02em
  Body:       16px / 24px / normal
  Body SM:    14px / 20px / normal
  Caption:    12px / 16px / normal
  Code:       14px / 20px / normal (JetBrains Mono)

Scale (mobile):
  Display:    32px / 40px
  H1:         24px / 32px
  H2:         20px / 28px
  Body:       16px / 24px
```

### Spacing

```
Unit: 4px base

xs:  4px
sm:  8px
md:  16px
lg:  24px
xl:  32px
2xl: 48px
3xl: 64px

Border Radius:
  sm:  6px   (buttons, inputs)
  md:  8px   (cards)
  lg:  12px  (modals)
  xl:  16px  (large cards)
  full: 9999px (pills, avatars)
```

### Shadows

```
sm:   0 1px 2px rgba(0, 0, 0, 0.3)
md:   0 4px 6px rgba(0, 0, 0, 0.3)
lg:   0 10px 15px rgba(0, 0, 0, 0.4)
glow: 0 0 20px rgba(59, 130, 246, 0.15)
```

### Animation

```
Duration:
  fast:   150ms   (hover, focus)
  normal: 250ms   (expand, collapse)
  slow:   350ms   (page transitions)

Easing:
  default: cubic-bezier(0.4, 0, 0.2, 1)
  enter:   cubic-bezier(0, 0, 0.2, 1)
  exit:    cubic-bezier(0.4, 0, 1, 1)
```

---

## Component Patterns

### Button
```html
<!-- Primary -->
<button style="background: #3B82F6; color: white; padding: 10px 20px; border-radius: 6px; font-weight: 500; font-size: 14px; border: none; cursor: pointer;">
  Action
</button>

<!-- Secondary -->
<button style="background: transparent; color: #F8FAFC; padding: 10px 20px; border-radius: 6px; font-weight: 500; font-size: 14px; border: 1px solid #334155; cursor: pointer;">
  Cancel
</button>

<!-- Ghost -->
<button style="background: transparent; color: #60A5FA; padding: 10px 20px; border-radius: 6px; font-weight: 500; font-size: 14px; border: none; cursor: pointer;">
  Learn more →
</button>
```

### Card
```html
<div style="background: #1E293B; border-radius: 8px; border: 1px solid #334155; padding: 24px;">
  <h3 style="color: #F8FAFC; font-size: 18px; margin-bottom: 8px;">Card Title</h3>
  <p style="color: #94A3B8; font-size: 14px; line-height: 1.5;">Card description text.</p>
</div>
```

### Badge
```html
<span style="display: inline-block; padding: 2px 10px; border-radius: 9999px; font-size: 12px; font-weight: 500; background: #DBEAFE; color: #1E40AF;">Badge</span>
<span style="display: inline-block; padding: 2px 10px; border-radius: 9999px; font-size: 12px; font-weight: 500; background: rgba(34, 197, 94, 0.15); color: #22C55E;">Active</span>
```

### Input
```html
<input style="width: 100%; padding: 10px 14px; background: #0F172A; border: 1px solid #334155; border-radius: 6px; color: #F8FAFC; font-size: 14px; outline: none;" placeholder="Enter value..." />
```

---

## Design Principles

1. **Dark-first** — OLED-friendly, high contrast
2. **Blue accent** — one accent color, used sparingly
3. **Clean hierarchy** — clear visual levels (primary → secondary → muted)
4. **Compact density** — information-rich, not spacious
5. **Sharp corners** — 6-8px radius, never pill-shaped for cards
6. **Subtle glow** — blue glow on focus/active, never neon
7. **System fonts** — Inter, fallback to system stack
8. **Responsive** — mobile-first, 4px grid

---

## When to Use

Invoke this skill when the user asks to:
- Design a UI component
- Create a landing page
- Build a dashboard
- Generate HTML/CSS for a project
- "Draw" or "design" something

Always use the design system above. Never use default Tailwind colors — always map to the FreeClaude palette.
