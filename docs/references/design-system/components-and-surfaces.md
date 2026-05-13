# Components And Surfaces

## Shared Class Constants

Small class constants are allowed when they keep repeated Tailwind strings
readable inside the owning component. Do not create a broad global selector
system.

Examples:

- `buttonBase` in `AppShell`.
- `navItemBase` in `AppShell`.
- `themeToggleButton` in `AppShell`.
- `pageFrame`, `pageHeader`, and row constants in route components.

Keep constants component-local unless two or more files genuinely share the
same component contract.

## Buttons

Button shape follows the job:

- Primary command: full pill for shell-level action.
- Compact control: rounded full or rounded-lg with visible border.
- Filter chip/control: full-width rounded control with `aria-pressed`.
- Icon-only affordance: circular icon button with accessible label on the
  button, not the SVG.

Use icons inside buttons when an icon exists. Do not replace familiar icon
actions with verbose text-only controls.

## Form Inputs

Inputs use semantic surfaces:

- Base input: `bg-trauma-bg-surface` or transparent inside an elevated wrapper.
- Border: `border-trauma-border-strong` for standalone fields.
- Placeholder: `text-trauma-text-placeholder`.
- Minimum height: at least `42px`.

Search inputs:

- The browse route owns the memory search field.
- The right rail does not contain a search field.

## Memory Browse Rows

Memory rows are the primary archive scanning surface.

Current row contract:

- Whole row is the link.
- No trailing `Open` button.
- Border-bottom separation.
- Hover uses `bg-trauma-bg-tint`.
- Avatar/host initial uses an elevated circular token surface.
- Title uses `text-xl font-bold leading-tight`.
- Metadata uses compact muted text.
- URL is shown with an open/link icon and wrap-safe text.

Grid mode reuses the same content and adds:

- Two columns on desktop.
- One column on mobile.
- Minimum card height on desktop.
- Right border between grid cards where applicable.

## Highlight Excerpts

`HighlightExcerpt` is the shared excerpt component for browse cards and the
canonical `/highlights` view.

Contract:

- Rounded quote block.
- Left border uses `border-trauma-quote-bar`.
- Background uses `bg-trauma-quote-bg`.
- Text uses `text-trauma-quote-ink`.
- Highlight text uses `mark` with `bg-trauma-highlight-bg`.
- Optional link wraps the whole excerpt.

Do not hand-roll separate highlight quote treatments for each route.

## Right Rail Sections

Right rail sections are independent islands.

Use them for lightweight filter and shortcut groups:

- Categories.
- Tags.
- Recent highlights.

They should not become dense forms, search panels, settings pages, or route
content containers.

## Add Memory Composer

The global composer uses the existing `AddMemoryForm` and existing
`POST /api/memories` flow.

Rules:

- The shell opens the drawer.
- The form accepts only URL input.
- Successful creation navigates to the created memory.
- On backup-failsafe errors, revalidate the backup alert.
- Do not add edit fields for title/body/tags in this composer.

## Backup Failsafe Banner

The backup failsafe banner is a route-global status surface rendered above
route content. It is an operational warning, not normal decoration.

Rules:

- Keep it visible above route content.
- Use state/severity tokens rather than route-specific styling.
- Keep recovery actions concrete and aligned with server behaviour.

## Empty, Loading, And Error States

State surfaces should be plain and content-oriented:

- Use route frame padding.
- Use `text-trauma-text-secondary` for explanatory text.
- Use `text-trauma-text-primary` for state headings.
- Avoid decorative cards unless the state is part of a framed tool.

Examples:

- Browse empty state: "No matching memories".
- Highlights empty state: "No highlights yet".
- Reader fallback state: status message with route frame padding.
