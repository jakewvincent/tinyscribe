# Styling Guide

This document describes the CSS design system used in `src/styles.css`.

## Design Philosophy

The UI is **information-dense but polished**. It's designed for technical users who want to see what the system is doing internally. This means:

- Dense layouts with compact spacing are acceptable
- Subtle visual polish (shadows, hover states) improves usability without sacrificing information density
- No dark mode (light theme only)
- Tabler Icons for consistent iconography

## Design Tokens

All styling should use CSS custom properties defined in `:root`. Never use hardcoded values for spacing, colors, borders, shadows, or radii.

### Spacing Scale

Based on 8px increments:

| Token | Value | Use Case |
|-------|-------|----------|
| `--space-xs` | 0.25rem (4px) | Tight gaps, icon margins |
| `--space-sm` | 0.5rem (8px) | Default padding, small gaps |
| `--space-md` | 1rem (16px) | Section padding, comfortable gaps |
| `--space-lg` | 1.5rem (24px) | Large section separation |
| `--space-xl` | 2rem (32px) | Major layout divisions |

```css
/* Examples */
padding: var(--space-sm);           /* Compact element */
padding: var(--space-md);           /* Standard container */
gap: var(--space-xs);               /* Tight button group */
margin-bottom: var(--space-lg);     /* Section separator */
```

### Border Radius Scale

| Token | Value | Use Case |
|-------|-------|----------|
| `--radius-sm` | 4px | Small elements, badges, tags |
| `--radius-md` | 6px | Buttons, inputs, small cards |
| `--radius-lg` | 8px | Panels, containers |
| `--radius-xl` | 12px | Modals, large overlays |

```css
/* Examples */
border-radius: var(--radius-sm);    /* Badge or tag */
border-radius: var(--radius-md);    /* Button or input */
border-radius: var(--radius-lg);    /* Sidebar panel */
border-radius: var(--radius-xl);    /* Modal dialog */
```

### Border Colors (Two-Tier System)

| Token | Value | Use Case |
|-------|-------|----------|
| `--border-light` | #f1f5f9 | Subtle internal separators |
| `--border-strong` | #cbd5e1 | Panel boundaries, form inputs |
| `--border-color` | #e2e8f0 | Legacy, prefer light/strong |

```css
/* Examples */
border: 1px solid var(--border-light);   /* Divider inside a panel */
border: 1px solid var(--border-strong);  /* Panel outline, input border */
```

**When to use which:**
- `--border-strong`: External boundaries (panels, inputs, buttons with borders)
- `--border-light`: Internal separators (list item dividers, section breaks within a panel)

### Shadow Scale

| Token | Value | Use Case |
|-------|-------|----------|
| `--shadow-sm` | 0 1px 2px rgba(0,0,0,0.05) | Subtle lift, hover states |
| `--shadow-md` | 0 1px 3px rgba(0,0,0,0.08) | Cards, panels |
| `--shadow-lg` | 0 4px 8px rgba(0,0,0,0.1) | Elevated elements, dropdowns |

```css
/* Examples */
box-shadow: var(--shadow-sm);       /* Hover state enhancement */
box-shadow: var(--shadow-md);       /* Sidebar panel */
box-shadow: var(--shadow-lg);       /* Dropdown menu, tooltip */
```

### Animation Easing

| Token | Value | Use Case |
|-------|-------|----------|
| `--ease-out-expo` | cubic-bezier(0.23, 1, 0.32, 1) | Premium feel for panel animations |

```css
/* Standard transitions use ease */
transition: all 0.15s ease;

/* Panel collapse/expand uses premium easing */
transition: max-height 0.25s var(--ease-out-expo);
```

### Base Colors

| Token | Value | Use Case |
|-------|-------|----------|
| `--bg-color` | #f8fafc | Page background |
| `--panel-bg` | #ffffff | Panel/card background |
| `--text-color` | #1e293b | Primary text |
| `--text-muted` | #64748b | Secondary/label text |

### Speaker Colors

Pre-defined colors for speaker identification (up to 6 speakers):

| Token | Color | Hex |
|-------|-------|-----|
| `--speaker-0` | Blue | #3b82f6 |
| `--speaker-1` | Green | #10b981 |
| `--speaker-2` | Amber | #f59e0b |
| `--speaker-3` | Red | #ef4444 |
| `--speaker-4` | Purple | #8b5cf6 |
| `--speaker-5` | Pink | #ec4899 |

## Common Patterns

### Interactive Elements

All interactive elements should have hover and active states:

```css
.interactive-element {
  transition: all 0.15s ease;
}

.interactive-element:hover {
  /* Subtle background or shadow change */
}

.interactive-element:active {
  /* Pressed state - often revert transform */
}
```

### Buttons with Shadows

Primary and default buttons have colored shadows matching their background:

```css
.btn.primary {
  background: #3b82f6;
  box-shadow: 0 2px 4px rgba(59, 130, 246, 0.3);
}

.btn.primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(59, 130, 246, 0.35);
}
```

### Focus States

Form inputs use a blue glow ring on focus:

```css
input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}
```

### Status Indicators

Status dots have halo effects matching their color:

```css
.status-dot.ready {
  background: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
}
```

### Panel Headers

Panel headers have subtle blue-tinted hover states:

```css
.panel-header:hover {
  background: rgba(59, 130, 246, 0.05);
}

.panel-header:active {
  background: rgba(59, 130, 246, 0.08);
}
```

### Hover Slide Effect

Some list items slide slightly on hover for tactile feedback:

```css
.list-item {
  transition: all 0.15s ease;
}

.list-item:hover {
  transform: translateX(2px);
  box-shadow: var(--shadow-sm);
}
```

## Icons

The project uses [Tabler Icons](https://tabler.io/icons) via CDN webfont.

```html
<i class="ti ti-microphone"></i>
<i class="ti ti-upload"></i>
<i class="ti ti-chevron-down"></i>
```

Icon alignment in buttons:
```css
.btn i.ti {
  vertical-align: middle;
  margin-right: 0.3em;
  font-size: 1.1em;
}
```

## Layout Dimensions

| Token | Value | Use Case |
|-------|-------|----------|
| `--topbar-height` | 60px | Fixed topbar |
| `--statusbar-height` | 40px | Fixed status bar |
| `--sidebar-width` | 320px | Default sidebar width (resizable) |

## Adding New Styles

1. **Check if a token exists** before adding any value
2. **Use semantic tokens** - `--radius-md` not `6px`
3. **Add transitions** to interactive elements (0.15s ease is standard)
4. **Include hover/active states** for clickable elements
5. **Test at different viewport sizes** - sidebar collapses on mobile

## Don'ts

- Don't use hardcoded pixel values for spacing, radius, or shadows
- Don't add new colors without good reason - use existing palette
- Don't skip hover states on interactive elements
- Don't use `!important` unless absolutely necessary
- Don't add dark mode styles (not supported)
