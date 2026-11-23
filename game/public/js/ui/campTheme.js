/** UI-only local-manifest view. Never mutate source data or colour the battlefield/characters. */
const cache = new WeakMap();

export function invasionManifest(manifest) {
  const variants = manifest?.groups?.['ui/invasion'];
  if (!variants) return manifest;
  if (cache.has(manifest)) return cache.get(manifest);
  const groups = { ...manifest.groups };
  for (const group of ['ui/battle', 'ui/common', 'ui/outer']) {
    groups[group] = { ...groups[group] };
    for (const name of Object.keys(groups[group])) {
      const variant = variants[`${group}/${name}`];
      if (variant?.path) groups[group][name] = variant;
    }
  }
  const themed = { ...manifest, groups };
  cache.set(manifest, themed);
  return themed;
}
