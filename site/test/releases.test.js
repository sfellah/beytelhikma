import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildIndex,
  classifyAsset,
  formatSize,
  missingPlatforms,
  parseUpdaterManifest,
  toEntry,
  versionFromTag,
} from '../lib/releases.mjs';

test('les artefacts se reconnaissent par leur nom', () => {
  assert.deepEqual(classifyAsset('Beyt El Hikma Setup 0.3.0.exe'), {
    os: 'windows',
    kind: 'installer',
    arch: 'x64',
  });
  assert.equal(classifyAsset('Beyt El Hikma 0.3.0 portable.exe').kind, 'portable');
  assert.equal(classifyAsset('beyt-el-hikma-0.3.0.AppImage').os, 'linux');
  assert.equal(classifyAsset('beyt-el-hikma_0.3.0_amd64.deb').kind, 'deb');
});

test('les fichiers de mise à jour ne sont pas proposés au visiteur', () => {
  // `latest.yml` et les `.blockmap` sont lus par electron-updater. Les
  // afficher offrirait des liens que personne ne sait quoi faire.
  assert.equal(classifyAsset('latest.yml'), null);
  assert.equal(classifyAsset('latest-linux.yml'), null);
  assert.equal(classifyAsset('Beyt El Hikma Setup 0.3.0.exe.blockmap'), null);
});

test('les empreintes se lisent dans le manifeste d’electron-updater', () => {
  const manifest = `version: 0.3.0
files:
  - url: Beyt%20El%20Hikma%20Setup%200.3.0.exe
    sha512: AAAA==
    size: 98123456
  - url: beyt.AppImage
    sha512: BBBB==
    size: 101
path: Beyt%20El%20Hikma%20Setup%200.3.0.exe
sha512: AAAA==
releaseDate: '2026-08-01T10:00:00.000Z'
`;
  const digests = parseUpdaterManifest(manifest);
  assert.equal(digests.get('Beyt El Hikma Setup 0.3.0.exe').sha512, 'AAAA==');
  assert.equal(digests.get('beyt.AppImage').size, 101);
});

test('l’URL affichée est celle publiée, jamais une URL devinée', () => {
  const entry = toEntry({
    tag_name: 'v0.3.0',
    published_at: '2026-08-01T10:00:00Z',
    assets: [
      {
        name: 'Beyt El Hikma Setup 0.3.0.exe',
        browser_download_url: 'https://github.com/o/r/releases/download/v0.3.0/renamed.exe',
        size: 10,
      },
    ],
  });
  assert.equal(entry.assets[0].url, 'https://github.com/o/r/releases/download/v0.3.0/renamed.exe');
  assert.equal(entry.version, '0.3.0');
});

test('un brouillon n’entre pas dans l’index', () => {
  const index = buildIndex(
    [
      { tag_name: 'v0.4.0', draft: true, assets: [] },
      { tag_name: 'v0.3.0', draft: false, published_at: '2026-08-01T10:00:00Z', assets: [] },
    ],
    [],
  );
  assert.equal(index.latest.version, '0.3.0');
  assert.equal(index.history.length, 1);
});

test('une préversion ne devient pas la version mise en avant', () => {
  const index = buildIndex(
    [
      { tag_name: 'v0.4.0-rc.1', prerelease: true, published_at: '2026-08-02T10:00:00Z', assets: [] },
      { tag_name: 'v0.3.0', published_at: '2026-08-01T10:00:00Z', assets: [] },
    ],
    [],
  );
  assert.equal(index.latest.version, '0.3.0');
  assert.equal(index.history.length, 2);
});

test('une plateforme annoncée sans artefact est signalée', () => {
  const latest = { assets: [{ os: 'windows' }] };
  assert.deepEqual(missingPlatforms(latest), ['linux']);
  assert.deepEqual(missingPlatforms(null), []);
});

test('les notes se recousent par version, pas par tag', () => {
  const index = buildIndex(
    [{ tag_name: 'v0.3.0', published_at: '2026-08-01T10:00:00Z', assets: [] }],
    [{ version: '0.3.0', date: '2026-08-01', notes: { fr: [{ kind: 'added', items: ['x'] }] } }],
  );
  assert.deepEqual(index.latest.notes.fr[0].items, ['x']);
});

test('la taille est un nombre, pour que la conversion en chiffres arabes s’applique', () => {
  assert.equal(formatSize(98 * 1024 * 1024), 98);
  assert.equal(formatSize(1024), 1);
  assert.equal(formatSize(null), null);
  assert.equal(versionFromTag('v1.2.3'), '1.2.3');
});
