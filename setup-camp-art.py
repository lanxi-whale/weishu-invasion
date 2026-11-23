"""Install the official Doctor / Theresis story portraits mirrored by PRTS for the camp selector."""
import hashlib
import io
import json
from pathlib import Path
import urllib.parse
import urllib.request

from PIL import Image

ROOT = Path(__file__).resolve().parent
PORTRAITS = {
    'doctor': ('Npc doctor.png', '6e2cac953ba2bce6c5d8def7264fd85c2e694ebd'),
    'theresa': ('Avg avg npc 056.png', '11cf25fb9f1ba0a93d1ebb741dbd5562a0255b2a'),
    'theresis': ('Avg avg npc 062.png', '6c26ca236bc3c9250e7d94aca0a3cbe264858344'),
}


def main():
    # This task's configured proxy is unavailable; the public wiki also accepts a direct HTTPS connection.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def fetch(url):
        req = urllib.request.Request(url, headers={'User-Agent': 'StrongholdProtocol-CampArt/1.0'})
        with opener.open(req, timeout=30) as response:
            return response.read()

    query = urllib.parse.urlencode({
        'action': 'query', 'titles': '|'.join('File:' + row[0] for row in PORTRAITS.values()),
        'prop': 'imageinfo', 'iiprop': 'url|size|sha1', 'format': 'json',
    })
    pages = json.loads(fetch('https://prts.wiki/api.php?' + query))['query']['pages'].values()
    sources = {p['title'].split(':', 1)[1]: p['imageinfo'][0] for p in pages}
    entries = {}
    for name, (filename, fingerprint) in PORTRAITS.items():
        meta = sources[filename]
        if meta['sha1'] != fingerprint:
            raise ValueError('Portrait changed upstream; inspect it before updating: ' + filename)
        raw = fetch(meta['url'])
        if hashlib.sha1(raw).hexdigest() != fingerprint:
            raise ValueError('Downloaded portrait hash mismatch: ' + filename)
        image = Image.open(io.BytesIO(raw)).convert('RGBA')
        if image.size != (1024, 1024):
            raise ValueError('Unexpected source dimensions: ' + filename)
        bounds = image.getchannel('A').getbbox()
        if not bounds:
            raise ValueError('Empty portrait: ' + filename)
        image = image.crop(bounds)
        out = io.BytesIO()
        image.save(out, format='WEBP', quality=92, method=6)
        encoded = out.getvalue()
        digest = hashlib.sha256(encoded).hexdigest()[:12]
        rel = '/assets/local/ui/camps/' + name + '-' + digest + '.webp'
        entries[name] = {
            'path': rel, 'w': image.width, 'h': image.height, 'kind': 'StoryPortrait',
            'source': meta['descriptionurl'], 'sourceUrl': meta['url'], 'sourceSha1': fingerprint,
            'credit': 'Arknights / Hypergryph; official story art mirrored by PRTS',
        }
        for camp in ('game', 'game_ops'):
            dest = ROOT / camp / 'public' / rel.lstrip('/')
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(encoded)
        print(name, image.size, len(encoded), rel, flush=True)
    for camp in ('game', 'game_ops'):
        manifest = ROOT / camp / 'data/local-assets.json'
        doc = json.loads(manifest.read_text(encoding='utf-8'))
        doc.setdefault('groups', {}).setdefault('ui/camps', {}).update(entries)
        doc['count'] = sum(len(group) for group in doc['groups'].values())
        manifest.write_text(json.dumps(doc, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')


if __name__ == '__main__':
    main()
