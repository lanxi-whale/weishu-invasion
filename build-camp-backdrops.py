"""Turn the user's building references into transparent, quiet holographic contour layers."""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('rhodes')
    parser.add_argument('kazdel')
    args = parser.parse_args()
    entries = {}
    for name, source, tint in [('rhodes', args.rhodes, (155, 255, 229)), ('kazdel', args.kazdel, (225, 147, 153))]:
        image = Image.open(source).convert('RGB')
        # Remove fine screen stripes/noise before detecting architectural edges.
        image.thumbnail((1200, 1100))
        gray = ImageOps.grayscale(image.filter(ImageFilter.GaussianBlur(1.1)))
        edge = gray.filter(ImageFilter.FIND_EDGES)
        edge = edge.point(lambda value: min(180, max(0, value - 10) * 4))
        edge = edge.filter(ImageFilter.MaxFilter(3))
        # Fade the rectangular source boundary so only the building silhouette remains.
        w, h = edge.size
        alpha = edge.load()
        for y in range(h):
            for x in range(w):
                fade = min(1, x / 30, (w - 1 - x) / 30, y / 30, (h - 1 - y) / 30)
                alpha[x, y] = round(alpha[x, y] * max(0, fade))
        out = Image.new('RGBA', edge.size, tint)
        out.putalpha(edge)
        rel = '/assets/local/ui/camps/' + name + '-hologram.webp'
        for camp in ('game', 'game_ops'):
            out.save(ROOT / camp / 'public' / rel.lstrip('/'), 'WEBP', lossless=True)
        entries[name + '-hologram'] = {'path': rel, 'w': w, 'h': h, 'kind': 'UserReferenceContour'}
    for camp in ('game', 'game_ops'):
        manifest = ROOT / camp / 'data/local-assets.json'
        doc = json.loads(manifest.read_text('utf-8'))
        doc['groups']['ui/camps'].update(entries)
        doc['count'] = sum(len(group) for group in doc['groups'].values())
        manifest.write_text(json.dumps(doc, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')


if __name__ == '__main__':
    main()
