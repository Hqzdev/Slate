# Design System

Slate should feel like a precise premium developer workspace with Vercel-level polish. The product should communicate control, speed, clarity, and trust.

## Direction

Use a restrained developer-tool style:

- Monochrome-first surfaces.
- Crisp borders.
- Strong typography.
- Dense but readable layouts.
- Fast interactions.
- Minimal decoration.
- Product UI before marketing UI.

The interface should look like something a serious engineering team would keep open for hours.

## References

Use these as quality references, not as visual templates to copy:

- Vercel for polish, spacing, typography, restraint, and product credibility.
- Linear for dense operational UI and keyboard-driven product feel.
- Raycast for command surfaces and compact interaction quality.

## Palette

Base:

- Background: near-white.
- Text: near-black.
- Secondary text: cool gray.
- Borders: light neutral gray.
- Panels: white and subtle off-white layers.

Accent:

- Use one primary accent only.
- Prefer electric blue or restrained violet.
- Keep accent usage rare and functional.

Avoid:

- Decorative gradients.
- Gradient orbs.
- Heavy purple-blue themes.
- Beige startup palettes.
- Oversaturated dashboards.

## Typography

Use:

- Geist or Inter for UI.
- Geist Mono or JetBrains Mono for code and terminal output.

Rules:

- No negative letter spacing.
- No viewport-based font scaling.
- Large type only for real marketing or onboarding moments.
- Compact panels need compact headings.

## Layout

The primary screen is the workspace, not a landing page.

Expected first product surface:

- Left sidebar for rooms, files, or workspace navigation.
- Center split between editor and canvas.
- Right panel for output, presence, and later AI.
- Top toolbar for room actions and run controls.

Use stable dimensions for toolbars, sidebars, tabs, output panels, and editor regions. Interaction should not shift layout.

## Components

Use:

- Small-radius panels.
- Thin borders.
- Icon buttons for common tools.
- Tooltips for icon-only controls.
- Segmented controls for modes.
- Tabs for editor, canvas, output, and activity surfaces when needed.

Avoid:

- Cards inside cards.
- Oversized rounded cards.
- Marketing-style feature grids inside the actual product.
- Explanatory text inside the app when controls can be self-evident.

## Motion

Motion should be quiet and functional:

- Hover states.
- Focus states.
- Panel transitions.
- Presence cursor movement.
- Streaming output updates.

Avoid theatrical motion. The product should feel responsive, not animated for decoration.

## Workspace Standard

The first implementation should prove the workspace style:

- Monaco editor visible.
- Canvas visible.
- Presence visible.
- Run/output visible.
- No fake landing screen blocking the product.

If the UI does not immediately show what the product does, it is failing the project strategy.
