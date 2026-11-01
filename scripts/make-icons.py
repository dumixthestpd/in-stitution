"""Optional icon authoring tool: Python + Pillow. Builds need only the committed PNGs."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
output = root / "extension" / "icons"
output.mkdir(exist_ok=True)
svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <title>in-stitution: in and an outward arrow</title>
  <rect x="4" y="4" width="120" height="120" rx="28" fill="#eaf0e8" stroke="#346d53" stroke-width="3"/>
  <circle cx="29" cy="44" r="5.5" fill="#183c31"/>
  <path d="M29 63v33M52 96V63m0 14a15 15 0 0 1 30 0v19" fill="none" stroke="#183c31" stroke-width="9" stroke-linecap="round"/>
  <path d="M77 48l24-24M81 24h20v20" fill="none" stroke="#176748" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
'''
(output / "icon.svg").write_text(svg, encoding="utf-8")
scale = 8
icon = Image.new("RGBA", (128 * scale, 128 * scale))
draw = ImageDraw.Draw(icon)
def coordinates(values):
    return tuple(int(value * scale) for value in values)
draw.rounded_rectangle(coordinates((2.5, 2.5, 125.5, 125.5)), radius=29.5 * scale, fill="#346d53")
draw.rounded_rectangle(coordinates((5.5, 5.5, 122.5, 122.5)), radius=26.5 * scale, fill="#eaf0e8")
def line(points, color, width=9):
    draw.line([(x * scale, y * scale) for x, y in points], fill=color, width=width * scale, joint="curve")
    for x, y in points:
        half = width / 2
        draw.ellipse(coordinates((x - half, y - half, x + half, y + half)), fill=color)
ink = "#183c31"
draw.ellipse(coordinates((23.5, 38.5, 34.5, 49.5)), fill=ink)
line([(29, 63), (29, 96)], ink)
line([(52, 63), (52, 96)], ink)
# Pillow strokes inward, so expand the ellipse to center on the SVG curve.
draw.arc(coordinates((47.5, 57.5, 86.5, 96.5)), 180, 360, fill=ink, width=9 * scale)
line([(82, 77), (82, 96)], ink)
line([(77, 48), (101, 24)], "#176748", 7)
line([(81, 24), (101, 24), (101, 44)], "#176748", 7)
for size in [16, 32, 48, 128]:
    icon.resize((size, size), Image.Resampling.LANCZOS).save(output / f"icon-{size}.png", optimize=True)
preview = Image.new("RGB", (600, 220), "#f6f7f2")
labels = ImageDraw.Draw(preview)
labels.text((24, 18), "in-stitution / browser icon", fill="#153e3b")
for size, x in [(128, 24), (48, 200), (32, 310), (16, 410)]:
    sample = icon.resize((size, size), Image.Resampling.LANCZOS)
    preview.paste(sample, (x, 66), sample)
    labels.text((x, 46), f"{size}px", fill="#153e3b")
preview.save(root / "docs" / "icon-preview.png")
print("Created vector source, four PNG sizes and icon preview.")
