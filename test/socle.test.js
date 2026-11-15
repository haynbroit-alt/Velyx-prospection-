// Tests du socle (M0) : contrats, horloge, empreintes, validateur, opérateurs, budget, porte réseau, verrou, magasin.
// Aucun accès réseau : chaque test HTTP passe un fetchImpl factice.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as C from '../src/contrats.js';
import {
  creerHorloge, ageAns, heuresEntre, canon, empreinte, sha256Texte, sha256Fichier, empreinteArbre, valider, defautChaine, OPS, evaluerOp,
  PLAFONDS, creerBudget, BudgetEpuise, HOTES, verifierUrl, creerHttp, verifierProxy, HoteInterdit, CheminInterdit, Bloque, EcritureABlanc,
  EchecReseau, HorsLigne, ZoneInterdite, PubliqueRefusee, VerrouOccupe, ecrireAtomique, avecVerrou, creerMagasin,
} from '../src/socle.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOCLE = pathToFileURL(path.join(RACINE, 'src', 'socle.js')).href;
const dossier = () => fs.mkdtempSync(path.join(os.tmpdir(), 'velyx-socle-'));

// --- contrats ---------------------------------------------------------------------------------------------------------

test('contrats : énumérations figées, cohérentes entre elles', () => {
  assert.equal(C.ETAPES.length, 15);
  assert.equal(C.ETAPES[0], 'observer');
  assert.equal(C.ETAPES.at(-1), 'retour');
  assert.equal(C.TYPES_ACTE.length, 29);
  assert.ok(C.TYPES_ACTE.includes('mandat'), 'le type de la ligne 14 reste admis');
  assert.ok(C.PROPRIETAIRE_SEUL.every((t) => C.TYPES_ACTE.includes(t)));
  assert.ok(C.ISSUES_POSITIVES.every((i) => C.ISSUES.includes(i)));
  assert.ok(!C.ISSUES_POSITIVES.includes('question') && C.ISSUES_ENGAGEMENT.includes('question'));
  assert.deepEqual(C.VERDICTS, ['autorise', 'revue_humaine', 'interdit']);
  for (const liste of [C.ETAPES, C.TYPES_ACTE, C.PROPRIETAIRE_SEUL, C.ISSUES, C.NIVEAUX, C.TYPES_ACTION, C.TYPES_REVUE]) {
    assert.ok(Object.isFrozen(liste));
    assert.equal(new Set(liste).size, liste.length, 'aucun doublon');
  }
  assert.throws(() => { C.ETAPES.push('x'); }, TypeError);
});

// --- horloge ----------------------------------------------------------------------------------------------------------

test('horloge : jour de Paris, pas d’UTC', () => {
  const h = creerHorloge('2026-12-31T23:30:00Z');
  assert.equal(h.jour(), '2027-01-01');
  assert.equal(h.annee(), 2027);
  assert.equal(h.semaine(), '2026-S53', 'le vendredi 1er janvier 2027 appartient à la semaine ISO 53 de 2026');
  assert.equal(h.iso(), '2026-12-31T23:30:00.000Z');
  assert.equal(creerHorloge('2026-07-01T22:30:00Z').jour(), '2026-07-02', 'heure d’été : UTC+2');
  assert.equal(creerHorloge('2026-07-01T21:30:00Z').jour(), '2026-07-01');
  assert.equal(creerHorloge('2026-11-15T12:00:00Z').jourSemaine(), 0, 'le 15 novembre 2026 est un dimanche');
  assert.equal(creerHorloge('2026-11-15T12:00:00Z').maintenant().getTime(), creerHorloge('2026-11-15T12:00:00Z').maintenant().getTime(), 'horloge factice figée');
  h.avancer(60_000);
  assert.equal(h.iso(), '2026-12-31T23:31:00.000Z');
  assert.throws(() => creerHorloge('pas une date'), TypeError);
  const reelle = creerHorloge();
  assert.equal(reelle.factice, false);
  assert.ok(Math.abs(reelle.maintenant().getTime() - Date.now()) < 1000);
});

test('ageAns et heuresEntre', () => {
  const h = creerHorloge('2026-11-15T12:00:00Z');
  assert.equal(ageAns('1925', h), 101);
  assert.equal(ageAns(1958, h), 68, 'année numérique : âge atteint dans l’année (convention v1)');
  assert.equal(ageAns('1985-06', h), 41);
  assert.equal(ageAns('1985-12', h), 40);
  assert.equal(ageAns('2024-11-15', h), 2);
  assert.equal(ageAns('2024-11-16', h), 1);
  assert.equal(ageAns('2026-11-16', h), null, 'date future');
  assert.equal(ageAns(null, h), null);
  assert.equal(ageAns('inconnue', h), null);
  assert.equal(heuresEntre('2026-11-15T00:00:00Z', '2026-11-15T06:30:00Z'), 6.5);
  assert.equal(heuresEntre('2026-11-15T06:00:00Z', '2026-11-15T00:00:00Z'), -6);
  assert.throws(() => heuresEntre(null, '2026-11-15'), TypeError);
});

// --- empreintes -------------------------------------------------------------------------------------------------------

test('canon et empreintes : stables d’une exécution à l’autre', () => {
  assert.equal(canon({ b: 2, a: 1 }), canon({ a: 1, b: 2 }));
  assert.equal(canon({ b: [1, 2, { d: 'é', c: null }], a: 1, u: undefined }), '{"a":1,"b":[1,2,{"c":null,"d":"é"}]}');
  assert.equal(canon([undefined, NaN]), '[null,null]');
  const x = { a: 1, b: [1, 2, { d: 'é', c: null }] };
  assert.equal(empreinte(x), 'c712e1560d1d94a1', 'valeur scellée : changer canon casserait toutes les clés');
  assert.equal(empreinte(x), crypto.createHash('sha256').update('{"a":1,"b":[1,2,{"c":null,"d":"é"}]}').digest('hex').slice(0, 16));
  assert.equal(empreinte(x, 6).length, 6);
  assert.equal(sha256Texte('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const d = dossier(), f = path.join(d, 'f.txt');
  fs.writeFileSync(f, 'abc');
  assert.equal(sha256Fichier(f), sha256Texte('abc'));
});

test('empreinteArbre : sensible au contenu, insensible à l’emplacement', () => {
  const a = dossier(), b = dossier();
  for (const r of [a, b]) { fs.mkdirSync(path.join(r, 'x', 'y'), { recursive: true }); fs.writeFileSync(path.join(r, 'x', 'y', 'f.json'), '{}'); }
  const e = empreinteArbre([path.join(a, 'x'), path.join(a, 'absent')]);
  assert.equal(e.length, 64);
  assert.equal(e, empreinteArbre([path.join(b, 'x'), path.join(b, 'absent')]));
  fs.writeFileSync(path.join(b, 'x', 'y', 'f.json'), '{ }');
  assert.notEqual(e, empreinteArbre([path.join(b, 'x'), path.join(b, 'absent')]));
  fs.mkdirSync(path.join(a, 'x', 'vide'));
  assert.notEqual(e, empreinteArbre([path.join(a, 'x'), path.join(a, 'absent')]), 'un dossier vide créé compte');
});

// --- validateur -------------------------------------------------------------------------------------------------------

const SCHEMA = {
  type: 'objet',
  champs: {
    texte: { type: 'texte', requis: true, max: 4000 },
    n: { type: 'entier', min: 0, max: 20 },
    p: { type: 'nombre', min: 0, max: 1 },
    choix: { type: 'enum', valeurs: ['a', 'b'] },
    tags: { type: 'liste', max: 3, items: { type: 'texte', motif: '^[a-z]+$' } },
    sous: { type: 'objet', champs: { ok: { type: 'bool', requis: true } } },
    prix_cite: { type: 'texte', requis: true, nul: true },
    valeur: { ou: [{ type: 'texte' }, { type: 'objet', champs: { expr: { type: 'texte', requis: true, motif: '^annee-\\d+$' } } }] },
  },
};
const BON = { texte: 'Réponse à https://www.codeur.com/projects/492531-prise-de-rdv : l’import des fiches est important.', n: 3, p: 0.5,
  choix: 'a', tags: ['btp'], sous: { ok: true }, prix_cite: null, valeur: { expr: 'annee-62' } };

test('valider : accepte une forme conforme', () => {
  assert.deepEqual(valider(SCHEMA, BON), { ok: true, erreurs: [] });
  assert.equal(valider(SCHEMA, { ...BON, valeur: 'texte libre', n: undefined, p: null }).ok, true, 'null sur un champ non requis vaut absence');
});

test('valider : refuse clé inconnue, longueur, code et URL hors de www.codeur.com', () => {
  const refuse = (o, motif) => { const r = valider(SCHEMA, o); assert.equal(r.ok, false); assert.ok(r.erreurs.some((e) => motif.test(e)), r.erreurs.join(' | ')); };
  refuse({ ...BON, inconnue: 1 }, /inconnue : clé inconnue/);
  refuse({ ...BON, sous: { ok: true, autre: 1 } }, /sous\.autre : clé inconnue/);
  refuse({ ...BON, texte: 'x'.repeat(4001) }, /longueur 4001/);
  assert.equal(valider(SCHEMA, { ...BON, texte: 'x'.repeat(4000) }).ok, true);
  refuse({ ...BON, texte: 'function(){ return 1 }' }, /code \(function\)/);
  refuse({ ...BON, texte: 'a => b' }, /code \(=>\)/);
  refuse({ ...BON, texte: 'require("fs")' }, /require/);
  refuse({ ...BON, texte: 'import fs from "node:fs"' }, /code \(import\)/);
  refuse({ ...BON, texte: 'eval(x)' }, /eval/);
  refuse({ ...BON, texte: '<script>alert(1)</script>' }, /script/);
  refuse({ ...BON, texte: 'voir https://exemple.org' }, /hors de www\.codeur\.com/);
  refuse({ ...BON, texte: 'voir www.exemple.org' }, /hors de www\.codeur\.com/);
  refuse({ ...BON, texte: 'https://www.codeur.com.exemple.org/x' }, /hors de www\.codeur\.com/);
  refuse({ ...BON, tags: ['voir https://exemple.org'] }, /tags\[0\]/);
  refuse({ ...BON, tags: ['a', 'b', 'c', 'd'] }, /longueur 4/);
  refuse({ ...BON, tags: ['BTP'] }, /motif/);
  refuse({ ...BON, n: 2.5 }, /entier attendu/);
  refuse({ ...BON, n: 21 }, /maximum 20/);
  refuse({ ...BON, p: Number.NaN }, /nombre fini/);
  refuse({ ...BON, choix: 'z' }, /hors de la liste/);
  refuse({ ...BON, sous: {} }, /sous\.ok : requis/);
  refuse({ texte: 'x', prix_cite: null, valeur: { expr: 'cinq' } }, /aucune des formes/);
  const { texte, ...sansTexte } = BON;
  refuse(sansTexte, /texte : requis/);
  assert.equal(valider(SCHEMA, null).ok, false);
  assert.throws(() => valider({ type: 'objet', champs: { x: { type: 'inconnu' } } }, { x: 1 }), /type de champ inconnu/);
  assert.equal(defautChaine('une citation « livraison sous 48 h » sans code'), null);
});

// --- opérateurs -------------------------------------------------------------------------------------------------------

test('evaluerOp : chaque opérateur, et un opérateur inconnu lève', () => {
  assert.equal(OPS.length, 10);
  assert.equal(evaluerOp('==', 'A', 'A'), true);
  assert.equal(evaluerOp('==', { a: [1] }, { a: [1] }), true);
  assert.equal(evaluerOp('!=', 1, '1'), true);
  assert.equal(evaluerOp('<', 3, 5), true);
  assert.equal(evaluerOp('>=', 5, 5), true);
  assert.equal(evaluerOp('<', '2025-01-01', '2026-01-01'), true, 'dates ISO comparées comme textes');
  assert.equal(evaluerOp('>', null, 0), false, 'une valeur absente ne passe aucune comparaison');
  assert.equal(evaluerOp('<', '3', 5), false, 'types mêlés : faux');
  assert.equal(evaluerOp('in', '69', ['69', '38']), true);
  assert.equal(evaluerOp('in', ['75', '13'], ['13']), true);
  assert.equal(evaluerOp('nin', 'GE', ['PME']), true);
  assert.equal(evaluerOp('existe', [], true), false);
  assert.equal(evaluerOp('existe', 0, true), true);
  assert.equal(evaluerOp('existe', null, false), true);
  assert.equal(evaluerOp('motif_i', 'SARL DÉCENNALE PLUS', 'decennale'), true, 'insensible à la casse et aux accents');
  assert.equal(evaluerOp('motif_i', ['ISOLATION', 'BTP'], '^btp$'), true);
  assert.equal(evaluerOp('motif_i', 42, 'x'), false);
  assert.throws(() => evaluerOp('motif_i', 'x', '(a+)+$'), /imbriqués/);
  assert.throws(() => evaluerOp('in', 'x', 'x'), TypeError);
  assert.throws(() => evaluerOp('~=', 1, 1), /opérateur inconnu/);
});

// --- budget -----------------------------------------------------------------------------------------------------------

test('budget : la 11e prise codeur lève BudgetEpuise, sans rien consommer', () => {
  assert.ok(Object.isFrozen(PLAFONDS));
  assert.deepEqual({ ...PLAFONDS }, { codeur: 10, sirene: 400, duree_s: 600, jugements: 5, nouvelles_opportunites: 1, passages_jour: 3 });
  const h = creerHorloge('2026-11-15T06:41:00Z'), b = creerBudget(PLAFONDS, h);
  for (let i = 0; i < 10; i++) b.prendre('codeur');
  assert.equal(b.reste('codeur'), 0);
  assert.throws(() => b.prendre('codeur'), (e) => e instanceof BudgetEpuise && e.source === 'codeur' && e.plafond === 10);
  assert.equal(b.bilan().consomme.codeur, 10);
  b.prendre('sirene', 400);
  assert.throws(() => b.prendre('sirene'), BudgetEpuise);
  assert.throws(() => b.prendre('inconnue'), /source inconnue/);
  for (let i = 0; i < 5; i++) b.prendre('jugements');
  assert.throws(() => b.prendre('jugements'), BudgetEpuise);
  h.avancer(601_000);
  assert.throws(() => b.verifierDuree(), (e) => e instanceof BudgetEpuise && e.source === 'duree_s');
  assert.equal(b.bilan().duree_s, 601);
});

// --- porte réseau -----------------------------------------------------------------------------------------------------

function faux(reponses) {
  const appels = [];
  const fetchImpl = async (url, options) => {
    appels.push({ url, options });
    const r = reponses.shift();
    if (r instanceof Error) throw r;
    return typeof r === 'function' ? r(url) : r;
  };
  return { fetchImpl, appels };
}
function contexte(reponses, depart = '2026-11-15T06:41:00Z') {
  const horloge = creerHorloge(depart), attentes = [], budget = creerBudget(PLAFONDS, horloge);
  const attendre = async (ms) => { attentes.push(ms); horloge.avancer(ms); };
  const { fetchImpl, appels } = faux(reponses);
  const vus = [];
  const espion = async (url, o) => { vus.push(horloge.maintenant().getTime()); return fetchImpl(url, o); };
  return { horloge, attentes, budget, appels, vus, http: creerHttp({ budget, horloge, fetchImpl: espion, attendre, env: {} }) };
}

test('http : liste blanche d’hôtes et de chemins, avant tout appel', async () => {
  const c = contexte([]);
  await assert.rejects(c.http.get('https://api.github.com/repos/x/y'), HoteInterdit);
  await assert.rejects(c.http.get('http://www.codeur.com/projects'), HoteInterdit, 'https seulement');
  for (const u of ['https://www.codeur.com/projects?sort=x', 'https://www.codeur.com/projects?page=6', 'https://www.codeur.com/projects?page=2&sort=x',
    'https://www.codeur.com/projects/492531?x=1', 'https://www.codeur.com/users/sign_in', 'https://recherche-entreprises.api.gouv.fr/autre?q=x',
    'https://recherche-entreprises.api.gouv.fr/search']) {
    await assert.rejects(c.http.get(u), CheminInterdit, u);
  }
  assert.equal(c.appels.length, 0, 'aucun appel de fetchImpl');
  assert.equal(c.budget.bilan().consomme.codeur, 0);
  for (const u of ['https://www.codeur.com/projects.rss', 'https://www.codeur.com/projects', 'https://www.codeur.com/projects?page=5',
    'https://www.codeur.com/projects/492531-prise-de-rdv-physiques', 'https://www.codeur.com/projects/492531', 'https://www.codeur.com/pages/tarifs-codeur-com',
    'https://recherche-entreprises.api.gouv.fr/search?q=btp&activite_principale=66.22Z&page=1&per_page=25']) {
    assert.doesNotThrow(() => verifierUrl(u), u);
  }
  assert.equal(HOTES['www.codeur.com'].intervalleMs, 1500);
  assert.equal(HOTES['recherche-entreprises.api.gouv.fr'].intervalleMs, 260);
  assert.ok(Object.isFrozen(HOTES['www.codeur.com'].chemins));
});

test('http : échec, échec, 200 → 3 requêtes budgétées, attentes de 1 000 puis 2 000 ms', async () => {
  const c = contexte([new Response('indisponible', { status: 503 }), new TypeError('fetch failed'), Response.json({ total_results: 3 })]);
  const r = await c.http.get('https://recherche-entreprises.api.gouv.fr/search?q=x&page=1', { source: 'sirene', format: 'json' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.corps, { total_results: 3 });
  assert.equal(r.depuis_cache, false);
  assert.equal(r.lu_le, c.horloge.iso());
  assert.equal(c.appels.length, 3);
  assert.equal(c.budget.reste('sirene'), 397, 'chaque essai est budgété');
  assert.deepEqual(c.attentes, [1000, 2000]);
  assert.match(c.appels[0].options.headers['user-agent'], /^Mozilla\/5\.0 \(compatible; lecture ponctuelle\)$/);
  assert.equal(c.appels[0].options.method, 'GET');
  const bilan = c.http.bilan()['recherche-entreprises.api.gouv.fr'];
  assert.deepEqual(bilan, { requetes: 3, echecs: 2, statuts: { 503: 1, reseau: 1, 200: 1 } });
});

test('http : quatre échecs → EchecReseau ; 403 → Bloque après un seul appel', async () => {
  const c = contexte([new Response('', { status: 429 }), new Response('', { status: 500 }), new Response('', { status: 502 }), new Response('', { status: 503 })]);
  await assert.rejects(c.http.get('https://recherche-entreprises.api.gouv.fr/search?q=x'), EchecReseau);
  assert.equal(c.appels.length, 4);
  assert.deepEqual(c.attentes, [1000, 2000, 4000]);
  const d = contexte([new Response('interdit', { status: 403 }), new Response('ok')]);
  await assert.rejects(d.http.get('https://www.codeur.com/projects.rss'), Bloque);
  assert.equal(d.appels.length, 1, 'aucun nouvel essai après un 403');
  assert.deepEqual(d.attentes, []);
});

test('http : deux GET au même hôte espacés d’au moins intervalleMs ; le cache ne consomme rien', async () => {
  const c = contexte([new Response('<rss/>'), new Response('<html>p2</html>')]);
  await c.http.get('https://www.codeur.com/projects.rss');
  await c.http.get('https://www.codeur.com/projects?page=2');
  assert.equal(c.vus.length, 2);
  assert.ok(c.vus[1] - c.vus[0] >= 1500, `écart ${c.vus[1] - c.vus[0]} ms`);
  assert.equal(c.budget.reste('codeur'), 8);
  const r = await c.http.get('https://www.codeur.com/projects.rss');
  assert.equal(r.depuis_cache, true);
  assert.equal(r.corps, '<rss/>');
  assert.equal(c.appels.length, 2, 'servi par le cache, sans appel');
  assert.equal(c.budget.reste('codeur'), 8, 'une réponse servie par le cache ne consomme rien');
  // Deux appels lancés en même temps sont sérialisés par hôte, et restent espacés.
  const e = contexte([new Response('a'), new Response('b')]);
  await Promise.all([e.http.get('https://www.codeur.com/projects'), e.http.get('https://www.codeur.com/projects?page=3')]);
  assert.ok(e.vus[1] - e.vus[0] >= 1500);
});

test('http : redirection suivie seulement vers une URL autorisée ; statut non 2xx rendu tel quel', async () => {
  const redir = (loc) => new Response(null, { status: 301, headers: { location: loc } });
  const c = contexte([redir('/projects/492531-prise-de-rdv'), new Response('<html>détail</html>')]);
  const r = await c.http.get('https://www.codeur.com/projects/492531');
  assert.equal(r.corps, '<html>détail</html>');
  assert.equal(r.url, 'https://www.codeur.com/projects/492531-prise-de-rdv');
  assert.equal(c.budget.reste('codeur'), 8, 'la redirection est une requête budgétée');
  const d = contexte([redir('https://exemple.org/x')]);
  await assert.rejects(d.http.get('https://www.codeur.com/projects/1'), HoteInterdit);
  const e = contexte([new Response('{"erreur": "page"}', { status: 400 })]);
  const r400 = await e.http.get('https://recherche-entreprises.api.gouv.fr/search?q=x&page=401', { format: 'json' });
  assert.equal(r400.status, 400);
  assert.equal(e.appels.length, 1, 'un 400 n’est pas réessayé');
  await assert.rejects(e.http.get('https://www.codeur.com/projects', { source: 'sirene' }), /incohérente/);
});

test('http : budget épuisé et mode hors ligne', async () => {
  const c = contexte(Array.from({ length: 12 }, () => new Response('x')));
  for (let p = 1; p <= 5; p++) await c.http.get(`https://www.codeur.com/projects?page=${p}`);
  for (const id of [1, 2, 3, 4, 5]) await c.http.get(`https://www.codeur.com/projects/${id}`);
  await assert.rejects(c.http.get('https://www.codeur.com/projects/6'), BudgetEpuise);
  assert.equal(c.appels.length, 10);
  const cache = new Map();
  const en = creerHttp({ budget: creerBudget(), fetchImpl: async () => new Response('rss'), attendre: async () => {}, cache, env: {} });
  await en.get('https://www.codeur.com/projects.rss');
  const hors = creerHttp({ budget: creerBudget(), fetchImpl: async () => { throw new Error('jamais appelé'); }, cache, env: {}, horsLigne: true });
  assert.equal((await hors.get('https://www.codeur.com/projects.rss')).corps, 'rss');
  await assert.rejects(hors.get('https://www.codeur.com/projects'), HorsLigne);
});

test('verifierProxy : HTTPS_PROXY sans NODE_USE_ENV_PROXY=1 → erreur lisible', async () => {
  assert.throws(() => verifierProxy({ HTTPS_PROXY: 'x' }), /NODE_USE_ENV_PROXY=1/);
  assert.throws(() => verifierProxy({ https_proxy: 'x', NODE_USE_ENV_PROXY: '0' }), /NODE_USE_ENV_PROXY=1/);
  assert.doesNotThrow(() => verifierProxy({ HTTPS_PROXY: 'x', NODE_USE_ENV_PROXY: '1' }));
  assert.doesNotThrow(() => verifierProxy({}));
  // Avec le fetch réel, le contrôle a lieu avant tout appel : aucune requête ne part.
  const http = creerHttp({ budget: creerBudget(), env: { HTTPS_PROXY: 'http://proxy.invalide:1' } });
  await assert.rejects(http.get('https://www.codeur.com/projects.rss'), /NODE_USE_ENV_PROXY=1/);
});

// --- écritures atomiques et verrou ------------------------------------------------------------------------------------

test('verrou : occupé → VerrouOccupe ; périmé → brisé ; libéré après usage', () => {
  const d = dossier(), v = path.join(d, 'j.lock');
  assert.equal(avecVerrou(v, () => 42), 42);
  assert.equal(fs.existsSync(v), false, 'verrou libéré');
  fs.writeFileSync(v, 'autre processus');
  const debut = Date.now();
  assert.throws(() => avecVerrou(v, () => 1, { attenteMs: 80 }), VerrouOccupe);
  assert.ok(Date.now() - debut >= 80);
  assert.equal(fs.readFileSync(v, 'utf8'), 'autre processus', 'un verrou vivant n’est pas touché');
  const vieux = (Date.now() - 60_000) / 1000;
  fs.utimesSync(v, vieux, vieux);
  assert.equal(avecVerrou(v, () => 'repris'), 'repris');
  assert.equal(fs.existsSync(v), false);
  assert.deepEqual(fs.readdirSync(d), [], 'aucun fichier laissé');
});

test('ecrireAtomique : remplace d’un bloc, ne laisse aucun .tmp', () => {
  const d = dossier(), f = path.join(d, 'a', 'b.json');
  ecrireAtomique(f, 'un');
  ecrireAtomique(f, { deux: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { deux: 2 });
  assert.deepEqual(fs.readdirSync(path.dirname(f)), ['b.json']);
  assert.throws(() => ecrireAtomique(f, 'trois', { avantRenommage: () => { throw new Error('coupure'); } }), /coupure/);
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { deux: 2 }, 'l’ancien contenu reste');
  assert.deepEqual(fs.readdirSync(path.dirname(f)), ['b.json'], 'le .tmp est nettoyé');
});

// --- magasin ----------------------------------------------------------------------------------------------------------

test('magasin : deux zones étanches', () => {
  const r = dossier(), m = creerMagasin(r);
  assert.throws(() => m.ecrirePublic('prive/x', 'a'), ZoneInterdite);
  assert.throws(() => m.ecrirePrive('etat/x', 'a'), ZoneInterdite);
  assert.throws(() => m.ecrirePublic('etat/../prive/x', 'a'), ZoneInterdite);
  assert.throws(() => m.ecrirePublic('../etat/x', 'a'), ZoneInterdite);
  assert.throws(() => m.ecrirePublic(path.join(r, 'etat', 'x'), 'a'), ZoneInterdite);
  assert.throws(() => m.ecrirePublic('etat', 'a'), ZoneInterdite);
  assert.throws(() => m.ecrirePublic('registre/journal.jsonl', 'a'), ZoneInterdite, 'le journal n’est écrit que par le registre');
  assert.throws(() => m.ecrirePublic('src/x.js', 'a'), ZoneInterdite);
  assert.throws(() => m.supprimerPrive('etat/x'), ZoneInterdite);
  assert.equal(fs.existsSync(path.join(r, 'prive')), false);
  assert.equal(fs.existsSync(path.join(r, 'etat')), false);

  assert.equal(m.ecrirePublic('etat/marche/2026-11-15.json', { n: 1 }), 'etat/marche/2026-11-15.json');
  assert.deepEqual(m.lireJson('etat/marche/2026-11-15.json'), { n: 1 });
  m.ecrirePublic('registre/LISEZMOI.txt', 'public');
  m.ajouterPublicJsonl('etat/series/codeur.jsonl', [{ id: '1' }, { id: '2' }]);
  m.ajouterPublicJsonl('etat/series/codeur.jsonl', { id: '3' });
  assert.deepEqual(m.lire('etat/series/codeur.jsonl').trim().split('\n').map((l) => JSON.parse(l).id), ['1', '2', '3']);
  m.ecrirePrive('prive/listes/a.json', '[]');
  m.ecrirePrive('prive/cache/x.html', '<html/>');
  assert.deepEqual(m.lister('prive/'), ['prive/cache/x.html', 'prive/listes/a.json']);
  assert.deepEqual(m.lister('etat/series/'), ['etat/series/codeur.jsonl']);
  assert.deepEqual(m.lister('etat/ma'), ['etat/marche/2026-11-15.json']);
  assert.equal(m.existe('prive/listes/a.json'), true);
  m.supprimerPrive('prive/cache');
  m.supprimerPrive('prive/inexistant.json');
  assert.equal(m.existe('prive/cache/x.html'), false);
  assert.equal(m.lire('prive/absent.json'), null);
  assert.equal(m.lireJson('prive/absent.json'), null);
  assert.deepEqual(m.plan(), { publiques: ['etat/marche/2026-11-15.json', 'etat/series/codeur.jsonl', 'registre/LISEZMOI.txt'],
    privees: ['prive/cache/x.html', 'prive/listes/a.json'], suppressions: ['prive/cache', 'prive/inexistant.json'] });
  assert.doesNotThrow(() => m.exigerReel('push'));
});

test('magasin : le contrôle antifuite refuse avant toute écriture publique', () => {
  const r = dossier(), vus = [];
  const m = creerMagasin(r, { verifierPublic: (rel, contenu) => { vus.push(rel); return /CANARIX/.test(contenu) ? { ok: false, motif: 'dictionnaire' } : { ok: true }; } });
  assert.throws(() => m.ecrirePublic('etat/a.json', { texte: 'Zéphyrin CANARIX' }), (e) => e instanceof PubliqueRefusee && e.motif === 'dictionnaire');
  assert.throws(() => m.ajouterPublicJsonl('etat/s.jsonl', [{ x: 'CANARIX' }]), PubliqueRefusee);
  assert.equal(fs.existsSync(path.join(r, 'etat')), false, 'rien n’est écrit');
  m.ecrirePrive('prive/b.json', { texte: 'Zéphyrin CANARIX' });
  assert.deepEqual(vus, ['etat/a.json', 'etat/s.jsonl'], 'le privé ne passe pas par le contrôle public');
  const refus = creerMagasin(r, { verifierPublic: () => undefined });
  assert.throws(() => refus.ecrirePublic('etat/c.json', '{}'), PubliqueRefusee, 'un contrôle muet vaut refus (échec fermé)');
});

test('magasin : processus tué entre le .tmp et le renommage → l’ancien fichier reste lisible', () => {
  const r = dossier(), m = creerMagasin(r);
  m.ecrirePublic('etat/f.json', '{"version":"ancienne"}');
  const script = `import { creerMagasin } from ${JSON.stringify(SOCLE)};
    const m = creerMagasin(process.argv[1], { avantRenommage: () => process.kill(process.pid, 'SIGKILL') });
    m.ecrirePublic('etat/f.json', '{"version":"nouvelle"}');`;
  const enfant = spawnSync(process.execPath, ['--input-type=module', '-e', script, r], { encoding: 'utf8' });
  assert.equal(enfant.signal, 'SIGKILL', enfant.stderr);
  assert.deepEqual(m.lireJson('etat/f.json'), { version: 'ancienne' });
  const restes = fs.readdirSync(path.join(r, 'etat'));
  assert.equal(restes.filter((f) => f.endsWith('.tmp')).length, 1, 'le .tmp orphelin est bien là');
  assert.deepEqual(m.lister('etat/'), ['etat/f.json'], 'le magasin ignore les .tmp');
});

test('magasin à blanc : rien n’est écrit, lire() relit le calque, plan() liste les écritures prévues', () => {
  const r = dossier();
  fs.mkdirSync(path.join(r, 'etat'), { recursive: true });
  fs.mkdirSync(path.join(r, 'registre'), { recursive: true });
  fs.mkdirSync(path.join(r, 'prive', 'listes'), { recursive: true });
  fs.writeFileSync(path.join(r, 'etat', 'monde.json'), '{"version":1}');
  fs.writeFileSync(path.join(r, 'registre', 'journal.jsonl'), '');
  fs.writeFileSync(path.join(r, 'prive', 'listes', 'a.json'), '[]');
  const arbre = () => empreinteArbre(['etat', 'registre', 'prive'].map((z) => path.join(r, z)));
  const avant = arbre();
  const m = creerMagasin(r, { aBlanc: true });
  m.ecrirePublic('etat/monde.json', '{"version":2}');
  m.ajouterPublicJsonl('etat/series/codeur.jsonl', [{ id: '1' }]);
  m.ecrirePrive('prive/cycles/C-2026-11-15/a-juger.json', []);
  m.supprimerPrive('prive/listes');
  assert.deepEqual(m.lireJson('etat/monde.json'), { version: 2 }, 'le calque est relu');
  assert.equal(m.existe('prive/listes/a.json'), false);
  assert.equal(m.lire('prive/listes/a.json'), null);
  assert.deepEqual(m.lister('etat/'), ['etat/monde.json', 'etat/series/codeur.jsonl']);
  assert.deepEqual(m.lister('prive/'), ['prive/cycles/C-2026-11-15/a-juger.json']);
  assert.equal(arbre(), avant, 'empreinteArbre(etat, registre, prive) inchangée');
  assert.deepEqual(m.plan(), { publiques: ['etat/monde.json', 'etat/series/codeur.jsonl'], privees: ['prive/cycles/C-2026-11-15/a-juger.json'], suppressions: ['prive/listes'] });
  assert.throws(() => m.exigerReel('git push'), EcritureABlanc);
  assert.throws(() => m.ecrirePublic('prive/x', 'a'), ZoneInterdite, 'les zones valent aussi à blanc');
  // Un calque posé sur un magasin réel voit ce qu'il voit, sans rien écrire.
  const reel = creerMagasin(r), calque = reel.enCalque();
  calque.ecrirePrive('prive/listes/b.json', '[1]');
  assert.equal(calque.lire('prive/listes/a.json'), '[]');
  assert.deepEqual(calque.lister('prive/listes/'), ['prive/listes/a.json', 'prive/listes/b.json']);
  assert.equal(reel.lire('prive/listes/b.json'), null);
  assert.equal(arbre(), avant);
});

// --- fixtures communes ------------------------------------------------------------------------------------------------

test('fixtures communes : 20 fiches fictives au format Entreprise, cas imposés présents', () => {
  const L = JSON.parse(fs.readFileSync(path.join(RACINE, 'test', 'fixtures', 'commun', 'entreprises.json'), 'utf8'));
  const CHAMPS = ['siren', 'nom', 'nature_juridique', 'naf', 'creation', 'etat_administratif', 'fermee', 'categorie', 'effectif', 'effectif_code',
    'effectif_annee', 'departement', 'commune', 'dirigeants', 'dirigeants_pm', 'finances', 'ca', 'rge', 'idcc', 'opposition', 'etablissements_ouverts', 'fiche'];
  assert.equal(L.length, 20);
  const luhn = (s) => [...s].reverse().reduce((a, c, i) => { let d = Number(c) * (i % 2 ? 2 : 1); if (d > 9) d -= 9; return a + d; }, 0) % 10 === 0;
  for (const e of L) {
    assert.deepEqual(Object.keys(e).sort(), [...CHAMPS].sort(), e.siren);
    assert.match(e.siren, /^\d{9}$/);
    assert.equal(luhn(e.siren), false, 'SIREN fictif : clé de Luhn fausse');
    assert.ok(e.finances.length <= 3);
    assert.deepEqual(e.ca, e.finances[0] ?? null);
  }
  assert.equal(new Set(L.map((e) => e.siren)).size, 20);
  const h = creerHorloge('2026-11-15T12:00:00Z'), tous = L.flatMap((e) => e.dirigeants);
  assert.ok(tous.some((d) => d.nom === 'Zéphyrin CANARIX'), 'canari');
  assert.ok(L.some((e) => e.ca?.ca === 50_000_000 && e.effectif_code === '01'), 'holding à 50 M€ déclarée 1-2 salariés');
  assert.ok(L.some((e) => e.ca?.annee === 2019), 'CA 2019');
  assert.equal(L.filter((e) => e.opposition).length, 1, 'une opposition');
  assert.ok(tous.some((d) => ageAns(d.annee_naissance, h) === 101), 'dirigeant de 101 ans');
  assert.ok(L.some((e) => e.nature_juridique === '1000'), 'EI');
  assert.ok(L.some((e) => e.naf === '41.10A' && e.ca?.ca === 15_000_000 && e.effectif === '6-9'), 'promoteur');
  assert.ok(L.some((e) => e.dirigeants.length > 1 && e.dirigeants.some((d) => /co-gérant/i.test(d.qualite) && ageAns(d.annee_naissance, h) === 41)), 'co-gérant de 41 ans');
});

test('canari : le dirigeant fictif n’apparaît dans aucun fichier public du dépôt', () => {
  const publics = [];
  const marcher = (rel) => {
    const abs = path.join(RACINE, rel);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) marcher(r); else publics.push(r);
    }
  };
  marcher('etat');
  marcher('registre');
  for (const f of publics) assert.ok(!/CANARIX/i.test(fs.readFileSync(path.join(RACINE, f), 'utf8')), f);
});
