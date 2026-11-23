"""Install the invasion emblems in both clients."""
import argparse
import hashlib
import json
from pathlib import Path

from invasion_emblems import emblem_svg

ROOT = Path(__file__).resolve().parent
COURT_BOND = 'mon_main_court'
COURT_PATH = (
    'M26.4 3 28.2 9.5 24.3 19.7 32 26.8 39.7 19.7 35.8 9.5 37.6 3 37.9 9.5 43.2 20.6 32 32.2 20.8 20.6 26.1 9.5Z '
    'M31.4 12.6 24.9 19.7 26.3 20.8Z M32.6 12.6 39.1 19.7 37.7 20.8Z '
    'M21.7 22.8 23.9 24.8 22.5 26.6 24.7 28.8 26.7 26.9 28.2 28.4 25.7 30.8 27.1 32 29 30.1 30.2 31.4 '
    '25.2 36.4 32 43.2 38.8 36.4 33.8 31.4 35 30.1 36.9 32 38.3 30.8 35.8 28.4 37.3 26.9 39.3 28.8 41.5 26.6 '
    '40.1 24.8 42.3 22.8 45.2 26 41.1 30.3 47.5 36.5 33.3 50 42.9 36.1 39.5 31.9 38.1 33.4 40.5 36.4 38.8 38.3 '
    '40 39.7 38.9 40.8 37.6 39.5 32 44.9 26.4 39.5 25.1 40.8 24 39.7 25.2 38.3 23.5 36.4 25.9 33.4 24.5 31.9 '
    '21.1 36.1 30.7 50 16.5 36.5 22.9 30.3 18.8 26Z M32 31.9 37.3 36.4 32 41.8 26.7 36.4Z '
    'M18.3 22.4 8.6 36.1 16.9 49.8 5 36.1Z M45.7 22.4 55.4 36.1 47.1 49.8 59 36.1Z '
    'M14.4 19.4 14.9 26.8 14.4 33.4 14.1 27Z M49.6 19.4 49.1 26.8 49.6 33.4 49.9 27Z '
    'M14.7 39.5 15.1 46.7 14.7 53.8 14.3 46.5Z M49.3 39.5 48.9 46.7 49.3 53.8 49.7 46.5Z '
    'M21.7 41.9 22.9 43.1 20.7 45 29.6 56.5 17.9 45.1Z M42.3 41.9 41.1 43.1 43.3 45 34.4 56.5 46.1 45.1Z '
    'M26.2 47.2 27.3 48.4 25.7 50.3 24.5 49.1Z M37.8 47.2 36.7 48.4 38.3 50.3 39.5 49.1Z '
    'M23.6 50.7 24.3 51.7 23.2 53.1 30.4 60.7 21.1 52.9Z M40.4 50.7 39.7 51.7 40.8 53.1 33.6 60.7 42.9 52.9Z'
)


def main():
    bonds = json.loads((ROOT / 'game/data/bonds.json').read_text('utf-8'))
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--only', choices=bonds)
    only = parser.parse_args().only
    entries = {}
    for key, bond in bonds.items():
        if only and key != only:
            continue
        if key == COURT_BOND:
            svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="#fff0ed" fill-rule="evenodd" d="{COURT_PATH}"/></svg>'
            kind = 'ReferenceVectorEmblem'
        else:
            svg = emblem_svg(key)
            kind = 'OriginalVectorEmblem'
        encoded = svg.encode('utf-8')
        digest = hashlib.sha256(encoded).hexdigest()[:12]
        rel = f'/assets/local/ui/invasion-bonds/{key}-{digest}.svg'
        for camp in ('game', 'game_ops'):
            dest = ROOT / camp / 'public' / rel.lstrip('/')
            dest.parent.mkdir(parents=True, exist_ok=True)
            if not dest.is_file() or dest.read_bytes() != encoded:
                dest.write_bytes(encoded)
        entries[key] = {'path': rel, 'w': 64, 'h': 64, 'kind': kind, 'name': bond['name']}
    for camp in ('game', 'game_ops'):
        path = ROOT / camp / 'data/local-assets.json'
        doc = json.loads(path.read_text('utf-8'))
        if only:
            doc['groups'].setdefault('ui/invasion-bonds', {}).update(entries)
        else:
            doc['groups']['ui/invasion-bonds'] = entries
        doc['count'] = sum(len(group) for group in doc['groups'].values())
        path.write_text(json.dumps(doc, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print('Installed', len(entries), 'invasion emblems on both clients')


if __name__ == '__main__':
    main()
