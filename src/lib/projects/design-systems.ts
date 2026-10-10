export interface DesignPreset {
  id: string;
  name: string;
  /** One line shown in the picker. */
  description: string;
  /** Swatches shown in the picker: background, surface, text, accent. */
  swatches: [string, string, string, string];
  /** The design system itself, as the Markdown the AI follows. */
  content: string;
}

/** Largest design system text accepted, in characters. */
export const MAX_DESIGN_SYSTEM_CHARS = 40_000;

export const DESIGN_PRESETS: DesignPreset[] = [
  {
    id: "clean-product",
    name: "Clean product",
    description: "Bright, precise and calm. Suits software and dashboards.",
    swatches: ["#ffffff", "#f4f5f7", "#0f172a", "#4f46e5"],
    content: `# Clean product

## Character
Bright, precise, calm. Generous whitespace, thin borders, one confident accent colour. Nothing decorative that does not help the reader.

## Colour
- Background #ffffff, raised surfaces #f4f5f7, hairline borders #e3e5ea.
- Text #0f172a, secondary text #475569, muted labels #64748b.
- Accent #4f46e5 for primary actions and links; hover #4338ca. Use it sparingly: one primary action per view.
- Success #15803d, warning #b45309, danger #b91c1c. Tinted backgrounds for these use the colour at about 8% opacity.

## Typography
- Family: Inter, then system-ui. Numbers in tables use tabular figures.
- Page title 44–56px, weight 650, line height 1.05, letter spacing -0.02em.
- Section heading 28–32px, weight 600. Body 16px, line height 1.6. Small text 14px.
- Sentence case everywhere, including buttons.

## Shape and depth
- Radius 10px for cards and inputs, 8px for buttons, 999px for pills.
- Borders before shadows. One soft shadow for floating layers only: 0 8px 30px -12px rgba(15, 23, 42, 0.25).

## Layout
- Content width 1120px, 24px side padding on phones, 96px between sections.
- 12-column grid on desktop; cards in threes at most.

## Components
- Primary button: accent background, white text, 40px tall, medium weight.
- Secondary button: white background, 1px border, dark text.
- Inputs: 40px tall, 1px border, accent ring on focus.
- Cards: white, 1px border, 24px padding.
`,
  },
  {
    id: "editorial",
    name: "Editorial",
    description: "Serif headlines, warm paper tones, strong reading rhythm.",
    swatches: ["#faf7f2", "#f1ebe1", "#1c1917", "#b4441c"],
    content: `# Editorial

## Character
A well-made magazine. Serif headlines with real presence, warm paper background, quiet interface. Content leads; chrome recedes.

## Colour
- Background #faf7f2, panels #f1ebe1, rules #d9d0c1.
- Text #1c1917, secondary #57534e.
- Accent #b4441c (burnt orange) for links, key figures and one call to action. Hover #933614.
- Never pure white or pure black.

## Typography
- Headlines: "Fraunces", then Georgia, serif. Weight 500–600, tight line height (1.02–1.1), slight negative tracking.
- Body: "Source Sans 3", then system-ui. 18px, line height 1.7, measure 60–70 characters.
- Display size 56–84px on desktop, 40px on phones. Standfirst 22px in the serif, italic allowed.
- Small caps style labels: 12px, uppercase, letter spacing 0.12em, sans-serif.

## Shape and depth
- Square or nearly square corners (2–4px). No shadows. Separate with thin rules and whitespace.

## Layout
- Asymmetric grids: a wide column beside a narrow one. Let images and pull quotes break the grid.
- Section spacing 112px; rules between sections.

## Components
- Buttons: solid dark text colour background with paper-coloured text, or a text link with an arrow.
- Cards have no border or background; a top rule and a headline are enough.
- Pull quotes in the serif at 32px with a 3px accent rule on the left.
`,
  },
  {
    id: "midnight",
    name: "Midnight",
    description: "Dark, technical, luminous accents. Suits developer and AI tools.",
    swatches: ["#0b0d12", "#151922", "#e6e9ef", "#7c9cff"],
    content: `# Midnight

## Character
Dark and technical with a little glow. Feels like a well-lit instrument panel: deep background, crisp type, luminous accent used with restraint.

## Colour
- Background #0b0d12, surfaces #151922, raised #1c2230, borders rgba(255, 255, 255, 0.08).
- Text #e6e9ef, secondary #a2a9b8, muted #6f7787.
- Accent #7c9cff; second accent #5eead4 for highlights and data. Gradients only between these two, and only on one focal element per view.
- Soft glow for focal elements: 0 0 0 1px rgba(124, 156, 255, 0.35), 0 12px 40px -12px rgba(124, 156, 255, 0.45).

## Typography
- Family: "Geist", Inter, then system-ui. Code and figures in "Geist Mono" or ui-monospace.
- Headline 48–64px, weight 600, tracking -0.025em. Body 16px, line height 1.65.
- Eyebrow labels in monospace, 12px, uppercase, accent colour.

## Shape and depth
- Radius 12px for cards, 10px for buttons, 6px for inputs.
- Depth through lighter surfaces and 1px borders, not heavy shadows.

## Layout
- Content width 1160px. Sections 104px apart. Subtle grid or dot pattern allowed behind the hero only.

## Components
- Primary button: accent background, #0b0d12 text. Secondary: transparent with a 1px border.
- Cards: surface colour, 1px border, 24–28px padding; hover lifts the border to rgba(255, 255, 255, 0.16).
- Code blocks: #0f131b background, monospace 14px, 16px padding.
`,
  },
  {
    id: "friendly",
    name: "Friendly",
    description: "Rounded, colourful and warm. Suits consumer apps and communities.",
    swatches: ["#fffaf3", "#ffe9c7", "#2b2118", "#ff6b4a"],
    content: `# Friendly

## Character
Warm, rounded and upbeat without being childish. Big friendly type, soft shapes, colour blocks that give each section its own mood.

## Colour
- Background #fffaf3. Section blocks rotate through #ffe9c7 (butter), #dff3e4 (mint), #e3ecff (sky).
- Text #2b2118, secondary #6b5d51.
- Accent #ff6b4a (coral) for primary actions; hover #f0532f. Secondary accent #1f7a5c (green) for confirmations.

## Typography
- Headlines: "Bricolage Grotesque", then system-ui, weight 700, line height 1.0–1.1.
- Body: "DM Sans", then system-ui, 17px, line height 1.6.
- Headline 52–72px desktop, 38px phones. Friendly, direct wording; contractions are fine.

## Shape and depth
- Radius 24px for cards and images, 999px for buttons and tags.
- Chunky shadow for interactive cards: 0 6px 0 rgba(43, 33, 24, 0.12). Pressed state moves down 2px.

## Layout
- Content width 1080px, sections 88px apart, each section may sit on its own colour block with 32px radius.
- Illustrations and photos sit in rounded frames, slightly rotated (1–3 degrees) at most.

## Components
- Primary button: coral, white text, 48px tall, bold.
- Tags: pill shape, tinted background, 13px bold text.
- Inputs: 48px tall, 2px border #2b2118 at 15% opacity, 16px radius.
`,
  },
  {
    id: "mono-brutal",
    name: "Mono brutal",
    description: "Black and white, heavy borders, big type. Suits portfolios and bold brands.",
    swatches: ["#ffffff", "#f2f2f2", "#000000", "#ff3b00"],
    content: `# Mono brutal

## Character
Direct and loud. Black on white, thick borders, oversized type, one alarm-coloured accent. No gradients, no soft shadows, no rounded corners.

## Colour
- Background #ffffff, alternate blocks #f2f2f2 and #000000 (with white text).
- Text #000000. Borders #000000 at 2px.
- Accent #ff3b00 for one element per view: a button, a highlight, or a marker.

## Typography
- Headlines: "Archivo", then Arial, sans-serif, weight 800–900, uppercase allowed, line height 0.95, tracking -0.03em.
- Body and labels: "IBM Plex Mono", then ui-monospace, 15px, line height 1.6.
- Display 72–128px on desktop, 44px on phones. Let headlines wrap aggressively.

## Shape and depth
- Radius 0. Hard offset shadow for interactive blocks: 6px 6px 0 #000000; hover shifts the block by -2px, -2px.

## Layout
- Full-bleed bands separated by 2px rules. Grid lines visible. Numbers and labels ("01", "02") mark sections.

## Components
- Primary button: black background, white text, 2px border; hover swaps to accent background.
- Cards: white, 2px black border, hard shadow.
- Links: underlined, 2px thick, accent on hover.
`,
  },
];

export function findPreset(id: string): DesignPreset | null {
  return DESIGN_PRESETS.find((preset) => preset.id === id) ?? null;
}
