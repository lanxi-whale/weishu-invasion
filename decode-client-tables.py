"""Read the public game FlatBuffers schemas; keep local extracted data separate from pinned game data."""
import json
import re
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent / 'local-client-data'
SCALARS = {'bool': '?', 'byte': 'b', 'ubyte': 'B', 'short': 'h', 'ushort': 'H',
           'int': 'i', 'uint': 'I', 'long': 'q', 'ulong': 'Q', 'float': 'f', 'double': 'd'}


class Reader:
    def __init__(self, schema, data):
        text = re.sub(r'//[^\n]*', '', schema)
        self.tables = {}
        self.enums = {}
        for kind, name, base, body in re.findall(r'(table|enum)\s+(\w+)\s*(?::\s*(\w+))?\s*\{([^}]*)\}', text):
            if kind == 'table':
                fields = re.findall(r'(\w+)\s*:\s*(\[\w+\]|\w+)\s*(?:=\s*([^;(]+))?\s*(?:\([^)]*\))?\s*;', body)
                assert len(fields) == body.count(';'), name
                self.tables[name] = fields
            else:
                values, n = {}, -1
                for key, value in re.findall(r'(\w+)\s*(?:=\s*(-?\d+))?\s*,?', body):
                    n = int(value) if value else n + 1
                    values[n] = key
                self.enums[name] = (base, values)
        self.root = re.search(r'root_type\s+(\w+)', text)[1]
        self.data = data[128:]

    def get(self, fmt, pos):
        return struct.unpack_from('<' + fmt, self.data, pos)[0]

    def value(self, typ, pos, default=''):
        if typ in self.enums:
            base, values = self.enums[typ]
            value = self.value(base, pos, default)
            return values.get(value, value)
        if typ in SCALARS:
            if pos is None:
                if default:
                    return default == 'true' if typ == 'bool' else float(default) if typ in ('float', 'double') else int(default)
                return False if typ == 'bool' else 0
            value = self.get(SCALARS[typ], pos)
            return float(format(value, '.7g')) if typ == 'float' else value
        if pos is None:
            return {} if typ.startswith('[dict__') else [] if typ.startswith('[') else None
        target = pos + self.get('I', pos)
        if typ == 'string':
            return self.data[target+4:target+4+self.get('I', target)].decode('utf-8')
        if typ.startswith('['):
            item = typ[1:-1]
            n = self.get('I', target)
            assert n < 1000000, (item, n, target)
            size = struct.calcsize(SCALARS.get(item, SCALARS.get(self.enums.get(item, ('',))[0], 'I')))
            values = [self.value(item, target+4+i*size) for i in range(n)]
            return {v['key']: v['value'] for v in values} if item.startswith('dict__') else values
        return self.table(typ, target)

    def table(self, typ, pos):
        vt = pos - self.get('i', pos)
        length = self.get('H', vt)
        fields = self.tables[typ]
        assert (length-4)//2 <= len(fields), (typ, length, len(fields))
        result = {}
        for i, (name, kind, default) in enumerate(fields):
            off = self.get('H', vt+4+i*2) if 4+i*2 < length else 0
            result[name] = self.value(kind, pos+off if off else None, default)
        return result

    def read(self):
        return self.table(self.root, self.get('I', 0))


manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
for src in sorted(ROOT / (asset['name'] + '.bytes') for asset in manifest['assets']):
    if src.name.startswith('level_') and not src.name.startswith('level_act3autochess_') and src.stem != 'level_autochess_enemy_data':
        continue
    schema = next((s.stem for s in ROOT.glob('*.fbs') if src.name.startswith(s.stem)), 'prts___levels')
    data = src.read_bytes()
    try:
        result = json.loads(data)
    except (ValueError, UnicodeError):
        if src.name.startswith('range_table'):
            from Cryptodome.Cipher import AES
            from Cryptodome.Util.Padding import unpad
            mask = b'UITpAi82pHAWwnzqHRMCwPonJLIB3WCl'
            payload = data[128:]
            iv = bytes(a ^ b for a, b in zip(payload[:16], mask[16:]))
            result = json.loads(unpad(AES.new(mask[:16], AES.MODE_CBC, iv).decrypt(payload[16:]), 16))
            schema = 'range_table'
        else:
            result = Reader((ROOT / (schema + '.fbs')).read_text(encoding='utf-8'), data).read()
    wrappers = {'character_table': 'characters', 'skill_table': 'skills', 'battle_equip_table': 'equips'}
    if schema in wrappers:
        result = result[wrappers[schema]]
    if src.stem.startswith('level_') and isinstance(result.get('mapData', {}).get('map'), dict):
        matrix = result['mapData']['map']
        rows, cols, values = matrix['row_size'], matrix['column_size'], matrix['matrix_data']
        assert rows * cols == len(values)
        result['mapData']['map'] = [values[r*cols:(r+1)*cols] for r in range(rows)]
    (src.with_suffix('.json')).write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':'), allow_nan=False), encoding='utf-8')
    table = re.sub(r'[0-9a-f]{6}$', '', src.stem) if not src.stem.startswith('level_') else src.stem
    if src.stem.startswith('level_'):
        stage = re.match(r'(level_act3autochess_m\d+)_sub_', table)
        rel = 'levels/activities/act3autochess/' + ((stage[1] + '/') if stage else '') + table + '.json'
    elif table == 'enemy_database':
        rel = 'levels/enemydata/enemy_database.json'
    else:
        rel = 'excel/' + table + '.json'
    dest = ROOT / 'gamedata' / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':'), allow_nan=False), encoding='utf-8')
    if schema == 'activity_table':
        print('seasons:', list(result['activity'].get('AUTOCHESS_SEASON', {})), flush=True)
        print('regulation:', list(result['activity'].get('AUTOCHESS', {})), flush=True)
    elif schema == 'enemy_database':
        print('enemies:', len(result['enemies']), flush=True)
    elif src.stem.startswith('level_'):
        print(src.stem, 'routes', len(result['routes']), 'waves', len(result['waves']), flush=True)
    else:
        print(table, len(result), flush=True)
