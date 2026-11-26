# Fieldy Sync: logo and graphic rules

This folder holds every version of the Fieldy Sync logo. It follows the same
grammar as the Data Bridge kit (32-grid, round-capped strokes, no fill, one
accent colour, ink, a faint secondary line at 55%) so the two plugins read as
a family.

- Plugin name: **Fieldy Sync** (id `fieldy-sync`)
- Visual signature: **a worn pendant that holds a note**, over a deck line
  and a shorter faint line: a recorded conversation becoming a note
- Original artwork: it uses no Fieldy or Obsidian artwork

## The mark

32 × 32 viewBox, all paths round-capped and round-joined, no fill:

| Part     | Path data                                                          | Stroke           | Colour in app  |
|----------|--------------------------------------------------------------------|------------------|----------------|
| Cord     | `M14.9 6 C14 3.5 13 2 11.8 0.6 M17.1 6 C18 3.5 19 2 20.2 0.6`      | 1.6, 55% opacity | `currentColor` |
| Ring     | circle, centre (16, 8), r 2.6                                      | 1.9              | `currentColor` |
| Pendant  | circle, centre (16, 16.6), r 6                                     | 2.4              | `currentColor` |
| Note     | `M13.8 13.6 H16.4 L18.3 15.5 V19.6 H13.8 Z`                        | 1.4              | theme accent   |
| Deck     | `M4 26.5 H28`                                                      | 2.6              | theme accent   |
| Line     | `M4 30 H18`                                                        | 1.8, 55% opacity | `currentColor` |

The ring sits exactly on top of the pendant, and the cord rises from the ring
with a gentle outward curve. Keep those three in that relation.

## Palette

| Role | Hex | Notes |
|------|-----|-------|
| Accent (violet) | `#8b5cf6` | note and deck on light; same violet as the directory listing tile |
| Deep violet | `#6d28d9` | tile gradient end, emphasis |
| Accent on dark | `#a78bfa` | note and deck on dark backgrounds |
| Ink | `#1c2f45` | pendant, cord, line, wordmark (shared with Data Bridge) |
| Paper on dark | `#eaf3fc` | same roles on dark (shared with Data Bridge) |
| Tile gradient | `#9b72f8 → #6d28d9` | app icon background |
| Tile note | `#ede5ff` | note and deck on the app icon |
| Mist / Frame | `#f4f0ff` / `#ddd2fd` | light backgrounds, borders |

## File inventory

### `svg/`: masters (edit these, never the PNGs)

| File | What it is | Use for |
|------|-----------|---------|
| `mark.svg` | app-faithful mark: accent + `currentColor` | embedding where Obsidian CSS variables exist |
| `mark-accent.svg` | canonical mark on light | docs, README, light UI |
| `mark-on-dark.svg` | mark for dark backgrounds | dark README, dark themes |
| `mark-mono.svg` | single colour (`currentColor`) | one-colour print, stamps |
| `favicon.svg` | no cord, no faint line, heavier strokes | favicons, 16 px contexts |
| `icon.svg` | square tile, violet gradient, 22% radius | app icon, social, listings |
| `lockup-horizontal.svg` | mark + "Fieldy Sync", light | headers, docs |
| `lockup-horizontal-on-dark.svg` | same, dark | dark headers |
| `lockup-stacked.svg` | mark above wordmark | avatars, splash, about |
| `palette.svg` | swatch sheet | reference |

### `png/`: exports rendered from the SVGs (cairosvg)

- `mark-{16,32,64,128,256,512}.png`, `mark-on-dark-{32,64,128,256}.png`,
  `mark-mono-{32,128,512}.png` (in ink)
- `icon-{128,256,512,1024}.png`, `favicon-32.png`
- `lockup-horizontal-{440,880}.png`, `lockup-horizontal-on-dark-880.png`,
  `lockup-stacked-384.png`, `palette-760.png`

Lockup PNGs were rendered with a fallback font; re-export on Windows if you
want Segoe UI baked in. `python3 graphics/build_kit.py` regenerates the PNGs and
`preview.png` (needs `cairosvg`).

## In the plugin

`src/ui/brandIcon.ts` holds the same geometry:

- `registerFieldyIcon()` adds the mark to Obsidian's icon set as `fieldy-sync`
  (monochrome `currentColor`, like Lucide). It is used for the panel ribbon
  button, the panel's view tab and the settings tab.
- `createBrandMark()` draws the coloured mark (note and deck in the theme
  accent). In the panel header it is a button that runs a sync; on hover the
  pendant swings on its cord and the note redraws, unless the system asks for
  reduced motion. Styles: `.fieldy-brand` in `styles.css`.

`refresh-cw` stays the sync ribbon icon, since that one describes a verb.

## Rules

- **Clear space:** at least 2 grid units on every side.
- **Minimum size:** 16 px (use `favicon.svg` below 24 px), 120 px wide for the
  horizontal lockup, 96 px wide for the stacked lockup.
- **Never** stretch, rotate, outline, fill the pendant, add shadows to strokes,
  or swap the note for another symbol.
- **Colour:** only the note and the deck take the accent (or the theme accent
  in app); everything else is ink, paper or `currentColor`.
- **Wordmark:** "Fieldy Sync", `'Segoe UI', system-ui, -apple-system,
  sans-serif`, weight 600, letter-spacing 0.5, ink or paper.
