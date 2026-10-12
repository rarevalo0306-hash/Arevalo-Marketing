---
name: MATYA application
description: A clear marketing workspace with Figtree, quiet surfaces and purposeful turquoise actions.
colors:
  primary: "#14c4b4"
  primary-hover: "#0fb1a2"
  primary-ink: "#0a0a0a"
  link: "#0b6e66"
  brand-soft: "#e3faf7"
  ink: "#0a0a0a"
  ink-2: "#333333"
  muted: "#666666"
  faint: "#767676"
  line: "#e8e8e8"
  line-strong: "#d4d4d4"
  ground: "#ffffff"
  surface: "#ffffff"
  surface-2: "#f5f5f5"
  surface-hover: "#fafafa"
  field-bg: "#ffffff"
  btn-bg: "#f2f2f2"
  btn-hover: "#e8e8e8"
  neutral-bg: "#f2f2f2"
  neutral-text: "#5f5f5f"
  ok-bg: "#e5f6ea"
  ok-text: "#17702f"
  warn-bg: "#fff3e6"
  warn-text: "#a14b00"
  err-bg: "#fdeef0"
  err-text: "#c4001a"
  agent-accent: "#087f75"
  agent-tint: "#e8f7f4"
  agent-attention: "#b13c22"
  noche-primary: "#2dd4bf"
  noche-primary-hover: "#4fdcc9"
  noche-primary-ink: "#000000"
  noche-link: "#5eead4"
  noche-ground: "#000000"
  noche-surface: "#141414"
  noche-surface-2: "#1f1f1f"
  noche-ink: "#ffffff"
  noche-muted: "#a3a3a3"
  noche-line: "#262626"
  noche-line-strong: "#3a3a3a"
  noche-agent-accent: "#73d8cb"
  noche-agent-tint: "#153b35"
  noche-agent-attention: "#ffab94"
typography:
  display:
    fontFamily: "Figtree, ui-sans-serif, system-ui, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "44px"
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Figtree, ui-sans-serif, system-ui, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: "-0.03em"
  welcome:
    fontFamily: "Figtree, ui-sans-serif, system-ui, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "32px"
    fontWeight: 600
    lineHeight: 1.16
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Figtree, ui-sans-serif, system-ui, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "19px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Figtree, ui-sans-serif, system-ui, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.47
    letterSpacing: "-0.005em"
  conversation:
    fontFamily: "Figtree, ui-sans-serif, system-ui, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: "-0.005em"
  button:
    fontFamily: "Figtree, ui-sans-serif, system-ui, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    letterSpacing: "-0.01em"
  button-primary:
    fontFamily: "Figtree, ui-sans-serif, system-ui, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    letterSpacing: "-0.01em"
  field:
    fontFamily: "Figtree, ui-sans-serif, system-ui, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  label:
    fontFamily: "Figtree, ui-sans-serif, system-ui, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0"
  asset-montserrat:
    fontFamily: "Montserrat"
    fontWeight: 800
  asset-poppins:
    fontFamily: "Poppins"
    fontWeight: 800
  asset-inter:
    fontFamily: "Inter"
    fontWeight: 800
  asset-oswald:
    fontFamily: "Oswald"
    fontWeight: 700
  asset-playfair-display:
    fontFamily: "Playfair Display"
    fontWeight: 800
rounded:
  r-sm: "8px"
  r: "10px"
  r-md: "12px"
  r-lg: "16px"
  radius: "20px"
  pill: "980px"
spacing:
  xs: "4px"
  sm: "8px"
  control: "12px"
  md: "16px"
  field: "20px"
  lg: "24px"
  section: "28px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-ink}"
    typography: "{typography.button-primary}"
    rounded: "{rounded.pill}"
    padding: "0 18px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.primary-ink}"
  button-secondary:
    backgroundColor: "{colors.btn-bg}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0 18px"
  button-secondary-hover:
    backgroundColor: "{colors.btn-hover}"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.link}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0 18px"
  button-outline-hover:
    backgroundColor: "{colors.brand-soft}"
  field:
    backgroundColor: "{colors.field-bg}"
    textColor: "{colors.ink}"
    typography: "{typography.field}"
    rounded: "{rounded.r-md}"
    padding: "11px 14px"
    width: "100%"
  sidebar-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.r}"
    padding: "0 10px 0 12px"
    width: "100%"
  sidebar-item-active:
    backgroundColor: "{colors.brand-soft}"
    textColor: "{colors.link}"
  status-pill:
    backgroundColor: "{colors.neutral-bg}"
    textColor: "{colors.neutral-text}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "3px 10px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.radius}"
    padding: "28px"
  matya-tabs:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    padding: "13px 0"
  voice-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.r-sm}"
    padding: "8px 12px"
  voice-button-active:
    backgroundColor: "{colors.agent-tint}"
    textColor: "{colors.agent-accent}"
  task-disclosure:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    padding: "14px 0"
---

# Design System: MATYA application

## Overview

**Creative North Star: "The Clear Workspace"**

MATYA's application puts legible work, familiar controls and clear status ahead of decoration. Figtree unifies titles, navigation and body text. White space and fine neutral rules establish hierarchy; turquoise identifies actions and the current context. The north star is a descriptive name for the implemented system, not a newly selected identity.

The incumbent application is the visual authority. Centro MATYA extends it with compact conversation, task and settings patterns. The public website and its 3D agent are separate visual surfaces; this document does not redefine them. Spanish and English use the same flexible layouts and control hierarchy.

**Key Characteristics:**

- One Figtree family with weight and size carrying hierarchy.
- Flat surfaces, fine rules and rounded functional containers.
- Turquoise action fills paired with dark text; deeper teal for links and small accents.
- Clear labels, visible focus and status communicated in words as well as color.
- Responsive controls that retain business context and readable work output.

Extracted from `src/app/globals.css`, `src/app/layout.tsx`, `src/components/nav/Nav.module.css` and `src/components/agent/AgentCenter.module.css`, with component behavior checked against `AgentCenter.tsx` and `AgentSettings.tsx`. The current Claro implementation is visible in `.impeccable/review/desktop-result.png`, `mobile.png` and `mobile-settings-saved.png`. These are review captures, not shipping artwork. Theme variants below are source-derived; the captures do not verify every theme.

## Colors

The core palette is white and near-black with a restrained turquoise action color, deeper teal links and soft semantic backgrounds. Frontmatter values are the extracted primitives; runtime CSS custom properties remain the source of truth for theme switching. The sidecar's tonal ramps are synthesized swatch previews, not additional application tokens.

### Primary

- **Action Turquoise** (`primary`, `primary-hover`): filled primary buttons and selected controls, always paired with `primary-ink`.
- **Deep Teal** (`link`): readable links and selected app navigation on a pale background. The incumbent `brand` alias shares this value; `brand-2` shares `primary`.
- **Soft Teal** (`brand-soft`): active navigation and light information surfaces.
- **MATYA Teal** (`agent-accent`, `agent-tint`): the center's orbit, selected tab underline, voice state, task status and focus treatment. These are scoped extension colors, not replacements for the global action palette.

### Neutral

- **Paper** (`ground`, `surface`, `field-bg`): the page, ordinary containers and fields in Claro. The separate role names allow themes to change them independently.
- **Near Black** (`ink`, `primary-ink`) and **Secondary Ink** (`ink-2`): primary copy, headings and navigation.
- **Reading Gray** (`muted`, `faint`): supporting text and placeholders; never a substitute for the main action label.
- **Quiet Gray** (`surface-2`, `surface-hover`, `btn-bg`, `btn-hover`): message backgrounds, hover feedback and secondary controls.
- **Fine Rule** (`line`) and **Field Rule** (`line-strong`): separation and field boundaries.

### Semantic states and themes

Success, warning and error pairs use the established `ok-*`, `warn-*` and `err-*` variables. Neutral status pills use `neutral-*`. The center's attention text uses `agent-attention`; its running and completed labels use the scoped accent. Every status retains an explicit label.

`html[data-theme="noche"]` swaps surfaces, text, rules, actions and semantic colors in the existing stylesheet. The `noche-*` frontmatter entries record the core replacements; they are documentation names for those overrides, not new CSS variables. The center separately overrides its accent and tint. Do not implement a dark theme by inverting the rendered page.

The incumbent Vidrio theme uses the same roles with translucent surfaces and an existing pale background. Its declarations stay in `globals.css`; new components should inherit the shared variables. Vidrio is an optional existing style, not the default treatment for the center.

**The Readable Accent Rule.** Use dark text on the bright turquoise action fill; use the deeper link or scoped accent color for text on light surfaces.

## Typography

**Display and Body Font:** Figtree, served through `next/font` and exposed as `--font-figtree`; `--display` and `--body` share the same sans-serif fallback stack. Loaded weights are 400, 500, 600, 700 and 800.

The type system is compact and conversational. Sentence case, short headings and weight changes do most of the work. There is no separate display typeface in this application.

### Hierarchy

- **Display:** the global page title role. At the intermediate app breakpoint it steps to 40px, then 32px at widths up to 900px.
- **Headline:** the compact MATYA page identity; it steps to 25px at widths up to 560px.
- **Welcome:** the initial conversation prompt; it steps to 28px on narrow screens and is limited to 15ch on desktop.
- **Title:** the shared card heading role. The center deliberately uses smaller 16px/600 conversation and work headings. Settings section headings are 26px, stepping to 23px on narrow screens.
- **Body:** the app base. Long explanatory passages in the center generally use 15px with 1.6–1.7 leading and a 70–75ch maximum.
- **Conversation:** user and assistant messages, with preserved line breaks and wrapping for long output.
- **Labels and metadata:** 12–14px, usually sentence case. Status text stays readable rather than competing with task titles. Existing uppercase eyebrow labels are a separate, limited global pattern.

**The One Family Rule.** Keep Figtree for interface text; establish hierarchy through the existing size, weight and spacing roles.

### Creative-editor fonts

The `asset-*` roles are existing headline choices for the business's generated artwork: Montserrat, Poppins, Inter, Oswald and Playfair Display. They belong to the creative output, not interface navigation, forms or conversation. Their recorded weights match the editor stylesheet in `src/components/DesignFonts.tsx`; the full creative font catalog remains in `src/lib/design-shapes.ts`. These choices existed before the MATYA workspace; this change only moved their loading out of the global layout and into creative editors. Preserve the font choices in existing saved designs.

## Layout

The desktop shell has a sticky sidebar (268px) and a flexible main region. The shared content container has a maximum outer width of 1228px, centered margins and desktop padding of 56px 64px 72px. At 901–1180px its padding reduces to 44px 36px 64px. At widths up to 900px the shell becomes a top business bar plus fixed bottom navigation, with 16px side padding; the 600–900px range uses 28px. Main content retains 104px of bottom padding for the mobile navigation.

Spacing comes from repeated 4, 8, 12, 16, 20, 24, 28 and 32px values rather than a global spacing-variable library. The frontmatter names these observed steps for reuse; it does not claim corresponding CSS custom properties exist. Small 6px and 10px gaps remain legitimate for icon/label and compact-control groups.

The center's root has its own 1400px maximum and remains constrained by the app shell. Its conversation layout uses `minmax(0, 1fr)` plus a 310px task column with a 32px gap. At 1200px the task column becomes 270px and the gap 22px; at 950px it moves below the conversation. This is a surface pattern, not a required layout for every app page.

The conversation's messages scroll within their panel: desktop minimum height 360px and maximum 530px, reducing to 300px and 440px after the single-column breakpoint. The composer follows inside the same container. Settings use a 950px maximum and two-column field groups; field groups, source groups and tool links become one column at 560px. Long values wrap, and flex/grid children use `min-width: 0` where needed.

At narrow phone widths, the center header stacks and keeps the industry beneath the title; the selected business remains in the shell switcher. Its five-section navigation scrolls horizontally instead of shrinking the labels. Specialist rows become three compact columns beneath the conversation.

## Elevation & Depth

Claro and Noche are flat by default. Ordinary cards and the conversation use fine borders without ambient shadows. Tonal changes distinguish messages, hover targets and semantic notes. Existing overlays and selected segmented controls may use shadows; this is functional elevation rather than a decorative effect on every section.

### Shadow Vocabulary

- **Resting surface:** `--shadow` and `--shadow-sm` are `none` in Claro and Noche.
- **Medium overlay:** `--shadow-md` is `0 4px 18px rgba(0, 0, 0, 0.06)` in Claro, with the existing darker Noche override.
- **Large overlay:** `--shadow-lg` is `0 12px 40px rgba(0, 0, 0, 0.14)` in Claro, with the existing darker Noche override.
- **Mobile sheet:** `0 -8px 40px rgba(0, 0, 0, 0.18)` separates the existing bottom sheet from the page.
- **Field focus:** the global field gets `0 0 0 4px var(--brand-ring)` alongside its primary-colored border.

**The Flat Surface Rule.** Use the existing border and surface roles for resting containers; reserve stronger depth for overlays and explicit interactive state.

## Shapes

Corners follow the actual component roles: compact voice/settings controls use `r-sm`; navigation uses `r`; general fields and message blocks use `r-md`; the conversation and previews use `r-lg`; shared cards use `radius`. Shared card corners reduce to 18px below 640px. Primary, secondary and outlined action buttons use the fully rounded `pill` value.

Borders are generally one pixel. Selected center tabs use a two-pixel underline and square corners. Status dots are small circles. Icons are simple inline SVG strokes, normally 20px in the center. The center's orbit is vector artwork (68px desktop, 52px on phones), not a raster asset or replacement for the public website's 3D agent.

## Components

### Buttons

Compact and direct. The shared pill button is at least 40px high, with 18px horizontal padding, a 14px label and an 8px icon gap. Primary buttons use the bright action fill, dark text and 600 weight. Secondary buttons use quiet gray; outlined buttons use the deeper teal border and text on a transparent background. Hover changes the appropriate background over 0.15s. The existing larger primary CTA is 48px high with 26px horizontal padding and 17px text; use it only where that established prominence is needed.

Text actions in the center use the scoped accent, a 13px label and at least 40px height. Voice controls have a fine border and compact rounded rectangle shape. Listening is explicit in the label and `aria-pressed`; the pressed background uses the scoped tint. Sending, listening, muting and task cancellation remain distinct actions. Disabled center buttons use reduced opacity and a waiting cursor.

### Inputs / Fields

Shared fields use a strong neutral border, a paper background, 11px 14px padding, 16px body text and `r-md` corners. Their focus state combines an action-colored border with the existing four-pixel ring. The center's settings and verification fields use a denser variant: `r-sm`, 12px padding, 14px text and a minimum height of 44px. Settings textareas have a 95px minimum; the conversation composer is a borderless, vertically resizable textarea with a 78px minimum inside its enclosing panel.

Keep labels associated with their controls. The center uses a two-pixel scoped accent outline with four-pixel offset for keyboard focus on buttons, links, inputs, selects, textareas and disclosures. Success feedback is next to the settings save action with `role="status"`; failure feedback uses `role="alert"`. A saved notice represents the result of saving, not a button press alone.

### Navigation

The shared sidebar groups tools in 38px rows with rounded corners; nested links use 34px rows and an inset. The active destination has a soft teal background, deeper teal text and 600 weight. The business switcher has a fine border, an ellipsized name and a minimum 46px height. Mobile uses a fixed bottom bar with five destinations and a separate More sheet; safe-area spacing, an explicit close control and the current destination remain visible.

Centro MATYA's section navigation is a distinct underlined pattern: 14px/600 labels, minimum 44px height, 24px desktop gaps and a two-pixel active underline. The phone treatment uses 13px labels and 22px gaps. `aria-current` identifies the displayed section; the underline supplements the text contrast.

### Chips and status pills

The shared status pill uses a compact 12px/600 label, fully rounded corners, 3px 10px padding and an optional six-pixel dot. Apply the semantic background/text pair for the real state. The separate selectable chip pattern has a fine outline, generous label space and a primary border/ring when selected. Neither pattern substitutes color alone for a status or selection label.

### Cards / Containers

Shared cards have a surface background, one-pixel card rule, 28px padding, 16px internal gap and no default shadow. On small screens padding reduces to 20px. The conversation is a tighter 16px-corner container with separately ruled header, message area and composer. Task, news and source lists usually use open rows with separators instead of repeating an outer card around every item.

### Task disclosure and output

A task is a native `details`/`summary` disclosure. Its title is 14px/500, followed by a 12px textual status; a one-pixel top rule and 14px vertical padding separate neighboring tasks. Expanded output keeps readable line breaks, wraps URLs and exposes ordered specialist steps. Review, refresh and cancel actions appear with the task they affect. Budget amounts use tabular numerals. Empty lists describe the next useful action without invented activity.

### Motion and state

Shared buttons and navigation use short 0.15s color/background transitions. The mobile sheet enters over 0.18s with a 24px upward translation. Both the sheet and center honor `prefers-reduced-motion`. The center orbit rotates over 12s only while a run is reported as running. Listening and speaking controls reflect browser voice state; animation does not imply progress by itself.

## Do's and Don'ts

### Do:

- **Do** use the shared CSS variables so new components inherit Claro, Noche and Vidrio.
- **Do** keep Figtree and the existing compact control hierarchy across new app screens.
- **Do** pair bright action fills with dark text and use deeper teal for readable links.
- **Do** retain explicit labels, visible keyboard focus and nearby save/error feedback.
- **Do** let long content wrap and collapse field groups at the observed mobile breakpoints.
- **Do** connect task status and motion to actual reported state.

### Don't:

- **Don't** replace the incumbent application identity with the public website's visual treatment.
- **Don't** use bright turquoise as small body text on white.
- **Don't** add ambient shadows to ordinary Claro or Noche cards.
- **Don't** make status depend on color, an icon or animation alone.
- **Don't** make every task or source row a new outer card when the implemented list pattern applies.
- **Don't** present a simulated result, empty history or pending action as completed work.
