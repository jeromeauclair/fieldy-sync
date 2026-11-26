"""Build the Fieldy Sync logo kit (SVG masters, PNG exports, preview sheet). Run: python3 graphics/build_kit.py (needs cairosvg).

Same grammar as the Data Bridge kit: 32 x 32 viewBox, round-capped strokes, no fill,
one accent stroke, ink deck, faint secondary line at 55% opacity.
"""
import os
import cairosvg

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = HERE
os.makedirs(f"{OUT}/svg", exist_ok=True)
os.makedirs(f"{OUT}/png", exist_ok=True)

# ---------------------------------------------------------------- geometry (32-grid)
CORD = "M14.9 6 C14 3.5 13 2 11.8 0.6 M17.1 6 C18 3.5 19 2 20.2 0.6"
RING = "M16 5.4 A2.6 2.6 0 1 1 15.99 5.4"
BODY = "M16 10.6 A6 6 0 1 1 15.99 10.6"
NOTE = "M13.8 13.6 H16.4 L18.3 15.5 V19.6 H13.8 Z"
DECK = "M4 26.5 H28"
LINE = "M4 30 H18"

# ---------------------------------------------------------------- palette
ACCENT = "#8b5cf6"      # note + deck on light (listing violet)
DEEP = "#6d28d9"        # tile gradient end, emphasis
ACC_DARK = "#a78bfa"    # note + deck on dark
INK = "#1c2f45"         # deck, line, wordmark (shared with Data Bridge)
PAPER = "#eaf3fc"       # deck, line, wordmark on dark (shared with Data Bridge)
TILE_A, TILE_B, TILE_BARS = "#9b72f8", "#6d28d9", "#ede5ff"
MIST, FRAME = "#f4f0ff", "#ddd2fd"
FONT = "'Segoe UI', system-ui, -apple-system, sans-serif"


def path(d, color, w=2.6, op=None):
    o = f' opacity="{op}"' if op is not None else ""
    return f'  <path d="{d}" fill="none" stroke="{color}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"{o}/>\n'


def strokes(acc, ink, fav=False, with_line=True):
    """Pendant (cord, ring, body) in ink; note and deck in accent; cord and line faint."""
    if fav:   # 16 px: no cord, no faint line, heavier strokes
        return path(RING, ink, 2.2) + path(BODY, ink, 2.8) + path(NOTE, acc, 1.8) + path(DECK, acc, 3)
    s = path(CORD, ink, 1.6, 0.55) + path(RING, ink, 1.9) + path(BODY, ink, 2.4) + path(NOTE, acc, 1.4) + path(DECK, acc, 2.6)
    if with_line:
        s += path(LINE, ink, 1.8, 0.55)
    return s


def svg(w, h, body, comment, vb=None):
    vb = vb or f"0 0 {w} {h}"
    return (f"<!-- {comment} -->\n"
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="{vb}">\n{body}</svg>\n')


def group(tx, ty, sc, body):
    return f'  <g transform="translate({tx} {ty}) scale({sc})">\n' + "".join("  " + l + "\n" for l in body.strip("\n").split("\n")) + "  </g>\n"


FILES = {}
FILES["mark.svg"] = svg(32, 32, strokes("var(--interactive-accent, #8b5cf6)", "currentColor"),
    "Fieldy Sync brand mark, app-faithful version.\n     Note and deck take the theme accent; pendant, cord and line take currentColor, so it follows any Obsidian theme.")
FILES["mark-accent.svg"] = svg(32, 32, strokes(ACCENT, INK),
    "Fieldy Sync brand mark, canonical standalone on a light background.\n     Ink pendant on a cord, violet note inside, violet deck line.")
FILES["mark-on-dark.svg"] = svg(32, 32, strokes(ACC_DARK, PAPER),
    "Fieldy Sync brand mark, variant for dark backgrounds.")
FILES["mark-mono.svg"] = svg(32, 32, strokes("currentColor", "currentColor"),
    "Fieldy Sync brand mark, single color. Set the color via CSS `color` on use.")
FILES["favicon.svg"] = svg(32, 32, strokes(ACCENT, INK, fav=True),
    "Fieldy Sync favicon, simplified mark for 16px contexts.\n     Cord and faint line dropped; ring, pendant, note and deck with heavier strokes.")
FILES["icon.svg"] = svg(512, 512,
    '  <defs>\n    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">\n'
    f'      <stop offset="0" stop-color="{TILE_A}"/>\n      <stop offset="1" stop-color="{TILE_B}"/>\n'
    '    </linearGradient>\n  </defs>\n'
    '  <rect x="0" y="0" width="512" height="512" rx="112" fill="url(#tile)"/>\n'
    + group(106, 96, 9.375, strokes(TILE_BARS, "#ffffff")),
    "Fieldy Sync app icon, square tile with the mark centred.\n     Corner radius 22% of the tile; mark occupies ~62% of the tile width (same as Data Bridge).")


def lockup(bars, ink, comment):
    return svg(220, 56, group(4, 8, 1.25, strokes(bars, ink)) +
               f'  <text x="52" y="37" font-family="{FONT}" font-size="26" font-weight="600" letter-spacing="0.5" fill="{ink}">Fieldy Sync</text>\n',
               comment)


FILES["lockup-horizontal.svg"] = lockup(ACCENT, INK, "Fieldy Sync horizontal lockup, mark + wordmark, for headers and docs. Minimum width 120px.")
FILES["lockup-horizontal-on-dark.svg"] = lockup(ACC_DARK, PAPER, "Fieldy Sync horizontal lockup, for dark backgrounds.")
FILES["lockup-stacked.svg"] = svg(192, 140, group(64, 8, 2, strokes(ACCENT, INK)) +
    f'  <text x="96" y="118" text-anchor="middle" font-family="{FONT}" font-size="24" font-weight="600" letter-spacing="0.5" fill="{INK}">Fieldy Sync</text>\n',
    "Fieldy Sync stacked lockup, mark above wordmark. Minimum width 96px.")

SW = [("Accent (violet)", ACCENT, "#ffffff"), ("Deep violet", DEEP, "#ffffff"), ("Ink", INK, PAPER), ("Frame", FRAME, INK),
      ("Accent on dark", ACC_DARK, "#1e1033"), ("Paper on dark", PAPER, INK), ("Mist", MIST, INK), ("Tile note", TILE_BARS, INK)]
sw = f'  <rect width="760" height="300" fill="#ffffff"/>\n  <g font-family="{FONT}" font-size="13">\n'
for k, (name, hexv, _) in enumerate(SW):
    x, y = 20 + (k % 4) * 180, 20 + (k // 4) * 140
    sw += (f'    <rect x="{x}" y="{y}" width="160" height="80" rx="10" fill="{hexv}" stroke="#d8dee6"/>\n'
           f'    <text x="{x}" y="{y+100}" font-weight="600" fill="{INK}">{name}</text>\n'
           f'    <text x="{x}" y="{y+118}" fill="#5a6b7d">{hexv}</text>\n')
FILES["palette.svg"] = svg(760, 300, sw + "  </g>\n", "Fieldy Sync palette swatch sheet.")

for name, s in FILES.items():
    open(f"{OUT}/svg/{name}", "w").write(s)

# ---------------------------------------------------------------- PNG exports
EXPORTS = [("mark-accent", "mark", [16, 32, 64, 128, 256, 512]),
           ("mark-on-dark", "mark-on-dark", [32, 64, 128, 256]),
           ("icon", "icon", [128, 256, 512, 1024]),
           ("favicon", "favicon", [32]),
           ("lockup-horizontal", "lockup-horizontal", [440, 880]),
           ("lockup-horizontal-on-dark", "lockup-horizontal-on-dark", [880]),
           ("lockup-stacked", "lockup-stacked", [384]),
           ("palette", "palette", [760])]
for src, stem, sizes in EXPORTS:
    for w in sizes:
        cairosvg.svg2png(url=f"{OUT}/svg/{src}.svg", write_to=f"{OUT}/png/{stem}-{w}.png", output_width=w)
mono = FILES["mark-mono.svg"].replace("currentColor", INK)
for w in [32, 128, 512]:
    cairosvg.svg2png(bytestring=mono.encode(), write_to=f"{OUT}/png/mark-mono-{w}.png", output_width=w)

# ---------------------------------------------------------------- Obsidian icon (100-unit grid for addIcon)
k = 100 / 32
ribbon = (f'<g transform="scale({k})" fill="none" stroke="currentColor" stroke-linecap="round">'
          f'<path d="{CORD}" stroke-width="1.6" opacity="0.55"/><path d="{RING}" stroke-width="1.9"/>'
          f'<path d="{BODY}" stroke-width="2.4"/><path d="{NOTE}" stroke-width="1.4" stroke-linejoin="round"/>'
          f'<path d="{DECK}" stroke-width="2.6"/><path d="{LINE}" stroke-width="1.8" opacity="0.55"/></g>')
ts = f"""// Fieldy Sync brand icon for Obsidian. Generated from graphics/svg/mark-mono.svg.
// addIcon() expects inner SVG content on a 0 0 100 100 viewBox; the 32-grid mark is scaled by 100/32.
// Monochrome on purpose: ribbon and menu icons in Obsidian are currentColor, like Lucide.
import {{ addIcon }} from 'obsidian';

export const FIELDY_ICON_ID = 'fieldy-sync';

export const FIELDY_ICON_SVG =
\t'{ribbon}';

/** Call once in onload(), before addRibbonIcon / setIcon use FIELDY_ICON_ID. */
export function registerFieldyIcon(): void {{
\taddIcon(FIELDY_ICON_ID, FIELDY_ICON_SVG);
}}
"""
# The plugin-side icon lives in src/ui/brandIcon.ts; keep its path data in sync with the geometry above.

# ---------------------------------------------------------------- preview sheet
import re
def inner(name):
    return re.search(r"<svg[^>]*>(.*)</svg>", FILES[name], re.S).group(1)

def tile_at(x, y, size):
    return f'<g transform="translate({x} {y}) scale({size / 512})">' + inner("icon.svg") + "</g>"

def mk(x, y, sc, bars, ink, fav=False):
    body = strokes(bars, ink, fav=fav)
    return f'<g transform="translate({x} {y}) scale({sc})">{body}</g>'

W, H = 900, 640
pv = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="{FONT}">',
      f'<rect width="{W}" height="{H}" fill="#ffffff"/>',
      f'<text x="30" y="44" font-size="22" font-weight="600" fill="{INK}">Fieldy Sync, logo kit preview</text>',
      f'<text x="30" y="68" font-size="13" fill="#5a6b7d">A worn pendant holding a note, over a deck line and a faint line. Same 32-grid grammar as Data Bridge.</text>',
      mk(30, 95, 5, ACCENT, INK),
      f'<rect x="210" y="95" width="160" height="160" rx="16" fill="#1e1e1e"/>', mk(210, 95, 5, ACC_DARK, PAPER),
      tile_at(390, 95, 160),
      f'<text x="30" y="280" font-size="12" fill="#5a6b7d">mark-accent</text>',
      f'<text x="210" y="280" font-size="12" fill="#5a6b7d">mark-on-dark</text>',
      f'<text x="390" y="280" font-size="12" fill="#5a6b7d">icon (app tile)</text>',
      mk(580, 120, 1, ACCENT, INK), mk(625, 124, 0.75, ACCENT, INK), mk(660, 128, 0.5, ACCENT, INK, fav=True),
      f'<text x="580" y="180" font-size="12" fill="#5a6b7d">32 / 24 / 16 px (favicon)</text>',
      f'<rect x="580" y="200" width="290" height="44" rx="8" fill="#f3f4f6"/>',
      mk(592, 210, 0.75, "#6b7280", "#6b7280"), mk(632, 210, 0.75, ACC_DARK, "#dadada").replace('<g ', '<rect x="628" y="204" width="32" height="32" rx="6" fill="#262626"/><g ', 1),
      f'<text x="680" y="227" font-size="12" fill="#5a6b7d">ribbon, monochrome</text>',
      f'<g transform="translate(30 310)">' + inner("lockup-horizontal.svg") + '</g>',
      f'<rect x="300" y="300" width="250" height="76" rx="12" fill="#1e1e1e"/>',
      f'<g transform="translate(315 310)">' + inner("lockup-horizontal-on-dark.svg") + '</g>',
      f'<g transform="translate(600 300)">' + inner("lockup-stacked.svg") + '</g>',
      f'<text x="30" y="470" font-size="15" font-weight="600" fill="{INK}">Plugin family</text>',
      # Data Bridge sibling for comparison (its own geometry and palette)
      '<g transform="translate(30 485) scale(1.25)"><path d="M5 20 Q16 4 27 20" fill="none" stroke="#4a90d9" stroke-width="2.6" stroke-linecap="round"/>'
      '<path d="M3 20 H29" fill="none" stroke="#1c2f45" stroke-width="2.6" stroke-linecap="round"/>'
      '<path d="M5 26 q3 -2.4 6 0 t6 0 t6 0 t6 0" fill="none" stroke="#1c2f45" stroke-width="1.8" stroke-linecap="round" opacity="0.55"/></g>',
      f'<text x="82" y="514" font-family="{FONT}" font-size="26" font-weight="600" letter-spacing="0.5" fill="{INK}">Data Bridge</text>',
      f'<g transform="translate(300 485) scale(1.25)">{strokes(ACCENT, INK)}</g>',
      f'<text x="352" y="514" font-family="{FONT}" font-size="26" font-weight="600" letter-spacing="0.5" fill="{INK}">Fieldy Sync</text>',
      f'<text x="30" y="590" font-size="12" fill="#5a6b7d">Shared: grid, stroke weights, round caps, ink #1c2f45, faint 55% line, 22% tile radius. Distinct: violet accent and the pendant motif.</text>',
      "</svg>"]
pv_s = "".join(pv)
cairosvg.svg2png(bytestring=pv_s.encode(), write_to=os.path.join(OUT, "preview.png"), output_width=1800)
print("built", len(FILES), "svg masters")
