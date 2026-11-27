import { sendJson, setSecurityHeaders, splitUrl } from '../game/server/http/common.js';
import { GameData } from '../game/server/match/gamedata.js';
import { versionSlug } from '../game/shared/versions.js';

export function invasionReportOf(raw) {
  const data = new GameData(raw, 'mode_multi_normal');
  const bonds = new Map(data.bondIds.filter(id => id.startsWith('mon_')).map(id => {
    const { bondId, name, identifier, activeCount, thresholds, desc } = data.bond(id);
    const kind = id.split('_', 3)[1];
    return [id, { bondId, name, identifier, activeCount, thresholds, desc, kind, monsters: [] }];
  }));
  for (const id of data.visibleChess) {
    if (!id.startsWith('chess_mon_')) continue;
    const { chessId, name, tier, shopSortId, assets, bonds: membership } = data.chess(id);
    const monster = { chessId, name, tier, shopSortId, iconKey: assets?.avatar };
    for (const bondId of new Set(membership)) bonds.get(bondId)?.monsters.push(monster);
  }
  return [...bonds.values()];
}

export function createInvasionReportHandler(versions) {
  const versionIds = new Map(versions.ids.map(id => [versionSlug(versions.entry(id)), id]));
  const reports = new Map();
  return (req, res) => {
    const path = splitUrl(req.url)?.rawPath ?? '';
    const slug = /^\/data\/invasion-report-([A-Za-z0-9_-]+)\.json$/.exec(path)?.[1];
    if (!slug) return false;
    const version = versionIds.get(slug);
    setSecurityHeaders(res);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      sendJson(req, res, 405, { error: 'Method not allowed' });
    } else {
      if (version && !reports.has(version)) {
        const raw = versions.data(version);
        if (raw) reports.set(version, invasionReportOf(raw));
      }
      const report = reports.get(version);
      if (report?.length) sendJson(req, res, 200, report);
      else sendJson(req, res, 404, { error: 'Invasion report unavailable' });
    }
    return true;
  };
}
