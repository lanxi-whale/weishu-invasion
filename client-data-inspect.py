"""Inspect local client tables and fetch their public FlatBuffers schemas."""
import base64
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'local-client-data'
OUT.mkdir(exist_ok=True)
op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
api = 'https://api.github.com/repos/isHarryh/Ark-FBS-Py'
SCHEMA_REVISION = '77b8ff0c459565a1310419afdd6a9f6ac0cd2f08'
tree = json.load(op.open(api + '/git/trees/' + SCHEMA_REVISION + '?recursive=1', timeout=20))
print('schema revision', tree['sha'], flush=True)
TABLES = ('activity_table', 'enemy_database', 'character_table', 'skill_table', 'range_table',
          'uniequip_table', 'battle_equip_table', 'enemy_handbook_table', 'char_patch_table')
for name in (*TABLES, 'prts___levels'):
    item = next((x for x in tree['tree'] if x['path'] == 'FBS/' + name + '.fbs'), None)
    if item is None:  # Some client tables remain plain JSON.
        continue
    dest = OUT / (name + '.fbs')
    if not dest.exists():
        doc = json.load(op.open(item['url'], timeout=20))
        dest.write_bytes(base64.b64decode(doc['content']))
    print(name, dest.stat().st_size, flush=True)

sys.path.insert(0, str(ROOT / 'game_ops/tools/local-extract'))
import aklz4  # noqa: E402,F401
import UnityPy  # noqa: E402
from bundles import resource_index  # noqa: E402

data = Path(sys.argv[1] if len(sys.argv) > 1 else 'G:/Arknights bilibili/games/Arknights/Arknights_Data')
base = data / 'StreamingAssets/AB/Windows'
hot = data / 'PersistentData/Bundles'
current, active = resource_index(hot / 'hot_update_list.json')
packaged, original = resource_index(base / 'hot_update_list.json')
downloaded, installed = resource_index(hot / 'persistent_res_list.json')
print('client versions', packaged['versionId'], current['versionId'], flush=True)
assert (downloaded.get('manifestName'), downloaded.get('manifestVersion')) == (current.get('manifestName'), current.get('manifestVersion'))
names = []
for name, rec in active.items():
    if not name.startswith('anon/'):
        continue
    src = None
    if installed.get(name, {}).get('hash') == rec['hash'] and (hot / name).is_file():
        src = hot / name
    elif original.get(name, {}).get('hash') == rec['hash'] and (base / name).is_file():
        src = base / name
    if src is None:
        continue
    for obj in UnityPy.load(str(src)).objects:
        if obj.type.name != 'TextAsset':
            continue
        asset = obj.read()
        key = asset.m_Name
        if key.startswith(TABLES) or key.startswith('level_act3autochess_') or key == 'level_autochess_enemy_data':
            raw = asset.m_Script.encode('utf-8', 'surrogateescape')
            (OUT / (key + '.bytes')).write_bytes(raw)
            names.append({'name': key, 'bundle': name, 'bytes': len(raw)})
print('extracted', len(names), 'tables/levels', flush=True)
(OUT / 'manifest.json').write_text(json.dumps({'version': current['versionId'], 'schemaRevision': tree['sha'], 'assets': names}, indent=2), encoding='utf-8')
# The current season still references three legacy tutorial levels no longer shipped
# with this client. Use the project's original official snapshot for those alone.
legacy_sha = '6f63c14e27b847ef74b53b00fe51fc322b3cd7ff'
for n in (1, 2, 4):
    rel = f'levels/activities/act1autochess/level_act1autochess_tr{n:02}.json'
    dest = OUT / 'gamedata' / rel
    if not dest.exists():
        url = f'https://api.github.com/repos/Kengxxiao/ArknightsGameData/contents/zh_CN/gamedata/{rel}?ref={legacy_sha}'
        doc = json.load(op.open(url, timeout=20))
        raw = base64.b64decode(doc['content'])
        json.loads(raw)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(raw)
