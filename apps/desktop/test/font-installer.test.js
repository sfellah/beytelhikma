import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  cssFor,
  FontInstallError,
  installFont,
  LIMITS,
  parseSheet,
  resolveUserFontPath,
} from '../src/main/font-installer.js';

const SHEET = `
/* arabic */
@font-face {
  font-family: 'Vibes';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/vibes/v1/abc.woff2) format('woff2');
  unicode-range: U+0600-06FF, U+0750-077F;
}
/* latin */
@font-face {
  font-family: 'Vibes';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/vibes/v1/def.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131;
}
`;

const URL_OK = 'https://fonts.googleapis.com/css2?family=Vibes&display=swap';

function harness({ sheet = SHEET, file = Buffer.alloc(2048, 7) } = {}) {
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    if (url.startsWith('https://fonts.googleapis.com')) return Buffer.from(sheet, 'utf8');
    return Buffer.isBuffer(file) ? file : Buffer.from(file);
  };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'beyt-fonts-'));
  return { asked, fetchImpl, root, clean: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('parseSheet lit la famille, les poids et les sous-ensembles', () => {
  const parsed = parseSheet(SHEET);
  assert.equal(parsed.family, 'Vibes');
  assert.deepEqual(
    parsed.faces.map((face) => face.subset),
    ['arabic', 'latin'],
  );
  assert.deepEqual(parsed.scripts, ['arab', 'latn']);
});

test('installFont dépose les woff2 et rend la police inscrite', async () => {
  const { fetchImpl, root, clean } = harness();
  try {
    const font = await installFont({ url: URL_OK, fontsRoot: root, fetchImpl });
    assert.equal(font.family, 'Vibes');
    assert.equal(font.key, 'user-vibes');
    assert.equal(font.faces.length, 2);
    for (const face of font.faces) {
      assert.ok(fs.existsSync(path.join(root, font.key, face.file)), `manque ${face.file}`);
    }
  } finally {
    clean();
  }
});

/* ------------------------------------------------------- bornes de sécurité */

test('une origine autre que fonts.googleapis.com est refusée avant toute requête', async () => {
  const { asked, fetchImpl, root, clean } = harness();
  try {
    for (const url of [
      'https://evil.example/css2?family=Vibes',
      'http://fonts.googleapis.com/css2?family=Vibes',
      'https://fonts.googleapis.com.evil.example/css2',
      'file:///C:/windows/win.ini',
      'javascript:alert(1)',
    ]) {
      await assert.rejects(
        () => installFont({ url, fontsRoot: root, fetchImpl }),
        FontInstallError,
        url,
      );
    }
    assert.deepEqual(asked, [], 'aucune requête ne doit partir pour une URL refusée');
  } finally {
    clean();
  }
});

test('un src pointant ailleurs que fonts.gstatic.com est refusé, et rien n’est écrit', async () => {
  const sheet = SHEET.replace('https://fonts.gstatic.com', 'https://evil.example');
  const { fetchImpl, root, clean } = harness({ sheet });
  try {
    await assert.rejects(() => installFont({ url: URL_OK, fontsRoot: root, fetchImpl }), FontInstallError);
    assert.deepEqual(fs.readdirSync(root), [], 'aucun fichier ne doit rester');
  } finally {
    clean();
  }
});

test('une feuille au-delà du plafond est refusée', async () => {
  const { fetchImpl, root, clean } = harness({ sheet: 'x'.repeat(LIMITS.sheet + 1) });
  try {
    await assert.rejects(() => installFont({ url: URL_OK, fontsRoot: root, fetchImpl }), FontInstallError);
  } finally {
    clean();
  }
});

test('un fichier au-delà du plafond est refusé', async () => {
  const { fetchImpl, root, clean } = harness({ file: Buffer.alloc(LIMITS.file + 1) });
  try {
    await assert.rejects(() => installFont({ url: URL_OK, fontsRoot: root, fetchImpl }), FontInstallError);
    assert.deepEqual(fs.readdirSync(root), []);
  } finally {
    clean();
  }
});

/**
 * Le nom de famille vient d'un tiers : il est traité comme hostile. On le cite
 * et on l'échappe, faute de quoi il refermerait la règle et en écrirait une
 * autre.
 */
test('un nom de famille hostile ressort inoffensif dans la règle produite', () => {
  const css = cssFor({
    key: 'user-x',
    family: `Evil'; } body { display: none } @font-face { font-family: 'x`,
    faces: [{ weight: 400, subset: 'latin', file: 'a.woff2', range: 'U+0000-00FF' }],
  });
  assert.equal(css.includes('display: none'), false);
  assert.equal((css.match(/@font-face/g) ?? []).length, 1);
});

test('le nom de fichier est construit, jamais repris de l’URL distante', async () => {
  const sheet = SHEET.replace(
    'https://fonts.gstatic.com/s/vibes/v1/abc.woff2',
    'https://fonts.gstatic.com/s/vibes/v1/..%2F..%2Fevil.woff2',
  );
  const { fetchImpl, root, clean } = harness({ sheet });
  try {
    const font = await installFont({ url: URL_OK, fontsRoot: root, fetchImpl });
    for (const face of font.faces) {
      assert.match(face.file, /^[a-z0-9-]+\.woff2$/, face.file);
    }
    assert.equal(fs.existsSync(path.join(root, 'evil.woff2')), false);
  } finally {
    clean();
  }
});

test('resolveUserFontPath refuse tout chemin qui sort de la racine', () => {
  const root = path.join(os.tmpdir(), 'beyt-fonts-root');
  assert.ok(resolveUserFontPath(root, 'user-vibes/a.woff2'));
  for (const suspect of [
    '../secret.txt',
    'user-vibes/../../secret.txt',
    '/etc/passwd',
    'C:/windows/win.ini',
    '..\\..\\secret',
  ]) {
    assert.equal(resolveUserFontPath(root, suspect), null, suspect);
  }
});

test('seul le woff2 est écrit sur disque', async () => {
  const sheet = SHEET.replace(".woff2) format('woff2')", ".ttf) format('truetype')");
  const { fetchImpl, root, clean } = harness({ sheet });
  try {
    const font = await installFont({ url: URL_OK, fontsRoot: root, fetchImpl });
    for (const face of font.faces) assert.match(face.file, /\.woff2$/);
    assert.equal(font.faces.length, 1, 'la face non-woff2 est ignorée');
  } finally {
    clean();
  }
});
