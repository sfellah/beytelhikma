/**
 * La lecture des `CHANGELOG.<langue>.md`, seule. Aucun accès disque : on reçoit
 * du texte, on rend une structure. C'est ce qui la rend testable sur fixtures.
 *
 * Les notes de version sont écrites à la main, dans les trois langues, et ce
 * sont **elles** la source de vérité — le corps de la Release GitHub en est
 * dérivé, jamais l'inverse. Des notes tirées des commits diraient
 * « feat(i18n): le lecteur passe par t() » à un lecteur qui veut savoir ce qui
 * change pour lui, en français seulement.
 *
 * Les titres de rubrique sont des **clés canoniques** (`added`, `changed`,
 * `fixed`, `removed`, `security`), pas des mots traduits : c'est ce qui permet
 * à la même rubrique de porter la même icône et la même couleur dans les trois
 * langues sans table de correspondance par langue. Le mot affiché vient des
 * fichiers de locale du site.
 */

/** Les rubriques admises, dans l'ordre d'affichage. */
export const KINDS = ['added', 'changed', 'fixed', 'removed', 'security'];

const VERSION_LINE = /^##\s+\[(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]\s*[—–-]\s*(\d{4}-\d{2}-\d{2})\s*$/;
const KIND_LINE = /^###\s+([a-z]+)\s*$/;
const ITEM_LINE = /^[-*]\s+(.+?)\s*$/;

/**
 * Rend `[{ version, date, sections: [{ kind, items }] }]`, du plus récent au
 * plus ancien — l'ordre du fichier, qu'on ne retrie pas : un tri sémantique
 * des versions se tromperait sur les préversions, et l'auteur du fichier sait
 * mieux.
 *
 * Lève sur tout ce qui n'est pas reconnu. Une ligne avalée en silence, c'est
 * une note de version qui disparaît de la page sans que rien n'échoue.
 */
export function parseChangelog(text, { source = 'CHANGELOG' } = {}) {
  const releases = [];
  let release = null;
  let section = null;

  const lines = String(text).split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const where = `${source}:${index + 1}`;

    if (!line.trim() || line.startsWith('# ') || line.startsWith('> ')) continue;

    const version = VERSION_LINE.exec(line);
    if (version) {
      release = { version: version[1], date: version[2], sections: [] };
      section = null;
      releases.push(release);
      continue;
    }

    const kind = KIND_LINE.exec(line);
    if (kind) {
      if (!release) throw new Error(`${where} : rubrique « ${kind[1]} » hors de toute version.`);
      if (!KINDS.includes(kind[1])) {
        throw new Error(
          `${where} : rubrique « ${kind[1]} » inconnue. Attendu : ${KINDS.join(', ')}.`,
        );
      }
      section = { kind: kind[1], items: [] };
      release.sections.push(section);
      continue;
    }

    const item = ITEM_LINE.exec(line);
    if (item) {
      if (!section) throw new Error(`${where} : entrée hors de toute rubrique.`);
      section.items.push(item[1]);
      continue;
    }

    throw new Error(`${where} : ligne non reconnue — « ${line.trim()} ».`);
  }

  return releases;
}

/**
 * Recoud les trois langues en un index unique par version.
 *
 * Toute divergence est une erreur, pas un repli. Une version présente en
 * français et absente en arabe donnerait une page arabe qui affiche du
 * français : exactement la dérive silencieuse que le projet interdit partout
 * ailleurs. Le build doit tomber pendant qu'on écrit les notes, pas après
 * publication.
 */
export function mergeChangelogs(byLocale) {
  const locales = Object.keys(byLocale);
  if (locales.length === 0) throw new Error('Aucun CHANGELOG fourni.');

  const [reference, ...others] = locales;
  const versions = byLocale[reference].map((entry) => entry.version);

  for (const locale of others) {
    const theirs = byLocale[locale].map((entry) => entry.version);
    const missing = versions.filter((version) => !theirs.includes(version));
    const extra = theirs.filter((version) => !versions.includes(version));
    if (missing.length || extra.length) {
      throw new Error(
        `CHANGELOG.${locale}.md ne couvre pas les mêmes versions que CHANGELOG.${reference}.md` +
          `${missing.length ? ` — manquantes : ${missing.join(', ')}` : ''}` +
          `${extra.length ? ` — en trop : ${extra.join(', ')}` : ''}.`,
      );
    }
  }

  return versions.map((version) => {
    const entry = { version, date: null, notes: {} };
    for (const locale of locales) {
      const found = byLocale[locale].find((candidate) => candidate.version === version);
      if (entry.date && entry.date !== found.date) {
        throw new Error(
          `La version ${version} est datée du ${entry.date} dans un CHANGELOG et du ` +
            `${found.date} dans CHANGELOG.${locale}.md.`,
        );
      }
      entry.date = found.date;
      entry.notes[locale] = found.sections;
    }
    return entry;
  });
}

/**
 * Le corps d'une Release GitHub : les trois langues à la suite, l'arabe
 * d'abord. GitHub n'offre qu'un seul champ de texte ; l'y écrire depuis les
 * mêmes fichiers est ce qui garantit que la page et la Release ne se
 * contredisent jamais.
 */
export function releaseBody(entry, { labels, localeLabels }) {
  const blocks = [];
  for (const [locale, sections] of Object.entries(entry.notes)) {
    blocks.push(`## ${localeLabels[locale]}`);
    for (const section of sections) {
      blocks.push(`### ${labels[locale][section.kind]}`);
      blocks.push(section.items.map((item) => `- ${item}`).join('\n'));
    }
  }
  return blocks.join('\n\n');
}
