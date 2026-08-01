/**
 * La lecture des artefacts publiés, seule. Pure : on reçoit ce que l'API
 * GitHub a répondu, on rend le contrat que la page consomme.
 *
 * Règle centrale : **le site ne devine jamais une URL de téléchargement.** Il
 * n'utilise que celles que la Release porte réellement. Deviner
 * `…/releases/latest/download/Beyt El Hikma Setup ${version}.exe` marcherait
 * jusqu'au jour où `artifactName` change dans `package.json` — et ce jour-là le
 * bouton principal renverrait un 404 sans qu'aucun test n'échoue.
 */
import { PLATFORMS } from '../config.mjs';

/** Ce qui n'est pas un téléchargement pour un humain. */
const MACHINE_ONLY = /(\.blockmap$|^latest.*\.yml$|\.ya?ml$)/i;

/**
 * Reconnaît la plateforme et la nature d'un artefact d'après son nom.
 *
 * Rend `null` pour ce qui ne se propose pas : `latest.yml` et les `.blockmap`
 * sont les fichiers que lit `electron-updater`, pas des liens de page.
 */
export function classifyAsset(name) {
  if (MACHINE_ONLY.test(name)) return null;
  if (/\.exe$/i.test(name)) {
    return { os: 'windows', kind: /portable/i.test(name) ? 'portable' : 'installer', arch: 'x64' };
  }
  if (/\.appimage$/i.test(name)) return { os: 'linux', kind: 'appimage', arch: 'x64' };
  if (/\.deb$/i.test(name)) return { os: 'linux', kind: 'deb', arch: 'x64' };
  if (/\.rpm$/i.test(name)) return { os: 'linux', kind: 'rpm', arch: 'x64' };
  if (/\.dmg$/i.test(name)) return { os: 'macos', kind: 'installer', arch: /arm64/i.test(name) ? 'arm64' : 'x64' };
  if (/\.zip$/i.test(name)) return { os: 'macos', kind: 'archive', arch: /arm64/i.test(name) ? 'arm64' : 'x64' };
  return null;
}

/**
 * Extrait les empreintes des manifestes d'`electron-updater`.
 *
 * On ne prend pas de dépendance YAML pour trois clés. Le format est produit
 * par `electron-builder` et tient en une liste plate : `- url:` ouvre une
 * entrée, `sha512:` et `size:` la remplissent. Un format qui changerait rendrait
 * une table vide — les empreintes disparaîtraient de la page, sans casser le
 * lien de téléchargement, qui lui vient de l'API.
 */
export function parseUpdaterManifest(text) {
  const digests = new Map();
  let current = null;

  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trimEnd();
    const url = /^\s*-\s+url:\s*(.+?)\s*$/.exec(line);
    if (url) {
      current = decodeURIComponent(url[1].replace(/^['"]|['"]$/g, ''));
      digests.set(current, {});
      continue;
    }
    if (!current) continue;

    const sha512 = /^\s+sha512:\s*(.+?)\s*$/.exec(line);
    if (sha512) digests.get(current).sha512 = sha512[1].replace(/^['"]|['"]$/g, '');

    const size = /^\s+size:\s*(\d+)\s*$/.exec(line);
    if (size) digests.get(current).size = Number(size[1]);
  }

  return digests;
}

/** `v0.3.0` → `0.3.0`. Le tag porte le `v`, la version affichée non. */
export function versionFromTag(tag) {
  return String(tag).replace(/^v/, '');
}

/**
 * Recoud une Release de l'API et les notes du CHANGELOG en une entrée de page.
 *
 * `notes` peut manquer : une Release publiée sans note correspondante reste
 * téléchargeable, avec une section vide. L'inverse — des notes sans Release —
 * est traité plus haut, dans `buildIndex`.
 */
export function toEntry(release, { notes = null, digests = new Map() } = {}) {
  const assets = [];
  for (const asset of release.assets ?? []) {
    const shape = classifyAsset(asset.name);
    if (!shape) continue;
    const digest = digests.get(asset.name) ?? {};
    assets.push({
      ...shape,
      name: asset.name,
      url: asset.browser_download_url,
      size: asset.size ?? digest.size ?? null,
      sha512: digest.sha512 ?? null,
    });
  }

  return {
    version: versionFromTag(release.tag_name),
    tag: release.tag_name,
    published_at: release.published_at,
    prerelease: Boolean(release.prerelease),
    notes: notes?.notes ?? null,
    assets,
  };
}

/**
 * Le contrat complet écrit dans `releases.json`.
 *
 * Les brouillons sont écartés : ils n'ont pas d'artefact public, et une page
 * qui les annoncerait proposerait un téléchargement qui répond 404.
 */
export function buildIndex(apiReleases, changelog, digestsByTag = new Map()) {
  const published = (apiReleases ?? []).filter((release) => !release.draft);
  const notesByVersion = new Map((changelog ?? []).map((entry) => [entry.version, entry]));

  const entries = published.map((release) =>
    toEntry(release, {
      notes: notesByVersion.get(versionFromTag(release.tag_name)) ?? null,
      digests: digestsByTag.get(release.tag_name) ?? new Map(),
    }),
  );

  const stable = entries.filter((entry) => !entry.prerelease);
  return { latest: stable[0] ?? null, history: entries };
}

/**
 * Vérifie que la dernière version tient ce que la page promet.
 *
 * Rend la liste des manquements plutôt que de lever : l'appelant décide s'il
 * échoue (publication) ou s'il tolère (développement local sans réseau).
 */
export function missingPlatforms(latest) {
  if (!latest) return [];
  return PLATFORMS.filter(
    (platform) => platform.required && !latest.assets.some((asset) => asset.os === platform.key),
  ).map((platform) => platform.key);
}

/**
 * `98123456` → `94` (mégaoctets), en **nombre**.
 *
 * Arrondi à l'unité exprès : une décimale obligerait à porter un séparateur
 * décimal par langue, pour une précision dont personne n'a l'usage avant de
 * cliquer. Le nombre reste un nombre, donc `translate` le convertit en chiffres
 * arabes-indiens sur les pages arabes — une chaîne y échapperait.
 */
export function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return null;
  return Math.max(1, Math.round(bytes / (1024 * 1024)));
}
