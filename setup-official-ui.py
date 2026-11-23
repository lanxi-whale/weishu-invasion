"""Install the active official client's UI sprites and default prefab pack in both 4v4 camps."""
import argparse
import gc
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'game/tools/local-extract'))
import extract  # noqa: E402
from bundles import client_bundles  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--game', default='G:/Arknights bilibili/games/Arknights/Arknights_Data/StreamingAssets/AB/Windows')
    args = parser.parse_args()
    source = Path(args.game).resolve()
    if not source.is_dir():
        parser.error('official client bundle root does not exist')
    target = ROOT / 'game'
    manifest = target / 'data/local-assets.json'
    opts = argparse.Namespace(
        only=['ui', 'theme/ac_n_initial'], themes=[], out=str(target / 'public/assets/local'),
        manifest=str(manifest), plugin_root=str(target), plugin_art=False, scenes=[],
        fx_set='sample', fx_keys='', fx_jobs=0, fx_texture_format='webp', fx_add_only=False,
        client_data=str(ROOT / 'local-client-data/gamedata'),
    )
    with client_bundles(source) as active:
        opts.themes = [str(active)]
        if extract.extract(opts, active) != 0:
            raise RuntimeError('UI extraction failed; existing resources have been retained')
        gc.collect()  # UnityPy reference cycles otherwise keep Windows bundle handles open during temporary-tree cleanup.
    doc = json.loads(manifest.read_text(encoding='utf-8'))
    selected = {key: value for key, value in doc['groups'].items()
                if key.startswith('ui/') or key == 'themes/ac_n_initial'}
    for group in ('ui/common', 'ui/battle', 'ui/outer', 'themes/ac_n_initial'):
        if not selected.get(group):
            raise RuntimeError(f'official UI group missing: {group}')
    other = ROOT / 'game_ops'
    for group, entries in selected.items():
        for entry in entries.values():
            rel = entry.get('path', '')
            if not rel.startswith('/assets/local/') or '..' in Path(rel).parts:
                raise ValueError(f'unsafe UI asset path: {rel}')
            src = target / 'public' / rel.lstrip('/')
            dst = other / 'public' / rel.lstrip('/')
            if not src.is_file():
                raise FileNotFoundError(src)
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
    other_manifest = other / 'data/local-assets.json'
    old = json.loads(other_manifest.read_text(encoding='utf-8'))
    old.setdefault('groups', {}).update(selected)
    old['count'] = sum(len(entries) for entries in old['groups'].values())
    other_manifest.write_text(json.dumps(old, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'Installed official UI in both camps: {sum(map(len, selected.values()))} entries', flush=True)


if __name__ == '__main__':
    main()
