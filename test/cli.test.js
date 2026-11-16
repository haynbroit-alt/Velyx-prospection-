// Tests de l'interface (M12) : bin/velyx.js lancé dans un sous-processus sur une racine temporaire (VELYX_RACINE),
// hors réseau ; formes de la CI et de la skill du cycle. Données FICTIVES seulement.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { empreinteArbre } from '../src/socle.js';
import { Registre } from '../src/registre.js';

const DEPOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(DEPOT, 'bin', 'velyx.js');

function racine() {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'velyx-cli-'));
  fs.mkdirSync(path.join(r, 'etat', 'recettes'), { recursive: true });
  fs.mkdirSync(path.join(r, 'registre'));
  fs.copyFileSync(path.join(DEPOT, 'politique.json'), path.join(r, 'politique.json'));
  for (const f of fs.readdirSync(path.join(DEPOT, 'etat', 'recettes'))) fs.copyFileSync(path.join(DEPOT, 'etat', 'recettes', f), path.join(r, 'etat', 'recettes', f));
  new Registre(path.join(r, 'registre', 'journal.jsonl')).ajouter({ type: 'aveu', motif: 'registre fictif de test' });
  return r;
}
const velyx = (r, ...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: { ...process.env, VELYX_RACINE: r, HTTPS_PROXY: '', https_proxy: '' } });
const arbre = (r) => empreinteArbre(['etat', 'registre', 'prive'].map((d) => path.join(r, d)));

test('velyx sans argument → aide, code 0 ; commande inconnue → aide, code 1', () => {
  const r = racine();
  const a = velyx(r);
  assert.equal(a.status, 0);
  assert.match(a.stdout, /velyx cycle/);
  const b = velyx(r, 'inconnue');
  assert.equal(b.status, 1);
  assert.match(b.stdout, /velyx cycle/);
});

test('velyx cycle --a-blanc --hors-ligne → code 0 et empreinteArbre(etat, registre, prive) inchangée', () => {
  const r = racine(), avant = arbre(r);
  const x = velyx(r, 'cycle', '--a-blanc', '--hors-ligne');
  assert.equal(x.status, 0, x.stderr);
  assert.match(x.stdout, /"a_blanc": true/);
  assert.equal(arbre(r), avant);
});

test('velyx verifier → code 0 ; gestes refusés → code 1, rien d’écrit', () => {
  const r = racine();
  assert.equal(velyx(r, 'verifier').status, 0);
  const avant = arbre(r);
  const g = velyx(r, 'geste', 'valide R-x#mauvaise');
  assert.equal(g.status, 1);
  assert.match(g.stdout, /geste refusé/);
  const e = velyx(r, 'envoye', 'R-2026-11-16-1', '--canal', 'email');
  assert.equal(e.status, 1);
  assert.match(e.stdout, /revue inconnue/);
  assert.equal(velyx(r, 'juger', 'J-C-2026-11-16-0123456789abcdef', path.join(r, 'politique.json')).status, 1);
  assert.equal(arbre(r), avant);
});

test('ci.yml : npm test et garde --structurel, ni prive/ ni secrets ; package.json sans dépendance', () => {
  const ci = fs.readFileSync(path.join(DEPOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.ok(!ci.includes('prive/') && !ci.includes('secrets.'));
  assert.match(ci, /npm test/);
  assert.match(ci, /velyx\.js garde --structurel/);
  assert.ok(!/velyx\.js cycle/.test(ci), 'la CI n’exécute jamais le cycle');
  const pkg = JSON.parse(fs.readFileSync(path.join(DEPOT, 'package.json'), 'utf8'));
  assert.ok(!pkg.dependencies && !pkg.devDependencies);
});

test('skill velyx-cycle : six pas, aucune commande ni aucun outil d’envoi, de partage ou de paiement', () => {
  const s = fs.readFileSync(path.join(DEPOT, '.claude', 'skills', 'velyx-cycle', 'SKILL.md'), 'utf8');
  for (const c of ['npm test', 'velyx.js verifier', 'velyx.js cycle', 'velyx.js juger', 'velyx.js notification']) assert.ok(s.includes(c), c);
  assert.ok(!/mcp__|share|send|gmail|stripe|paypal|checkout|paiement|git push/i.test(s));
  assert.ok(!/velyx\.js (valider|geste|envoye|reponse|encaisse)\b/.test(s), 'aucune commande du propriétaire');
});

// velyx brouillon : Risk Agent d'abord (R-23 client codeur, R-14), contrôles ensuite ; un contrôle bloquant en échec ne
// produit ni revue ni pari ; le bloc soumis ne contient ni notes ni repères de prix. Fiches FICTIVES (test/fixtures/commun).
test('velyx brouillon : contrôle bloquant en échec ou client codeur sans CGU lues → code 1, ni revue ni pari ; sinon texte contrôlé seul', async () => {
  const { RECETTES, appliquer } = await import('../src/recettes.js');
  const { creerHorloge } = await import('../src/socle.js');
  const { extraireTexte } = await import('../src/risque.js');
  const F = JSON.parse(fs.readFileSync(path.join(DEPOT, 'test', 'fixtures', 'commun', 'entreprises.json'), 'utf8'));
  const jour = creerHorloge().jour(), h = creerHorloge();
  const { gardees } = appliquer(RECETTES['rachat-it-idf'], F, { horloge: h, oppositions: new Set() });
  const ecrireListe = (r, extra) => {
    fs.mkdirSync(path.join(r, 'prive', 'listes'), { recursive: true });
    fs.writeFileSync(path.join(r, 'prive', 'listes', `rachat-it-idf-${jour}.json`), JSON.stringify({ recette: 'rachat-it-idf', lu_le: h.iso(), lues: 20, total_registre: 20, complet: true, cibles: gardees, ...extra }));
  };
  // (1) Lecture du registre de plus de 7 jours (B4 bloquant) : refus, rien d'écrit.
  const r1 = racine();
  ecrireListe(r1, { lu_le: new Date(Date.now() - 10 * 864e5).toISOString() });
  const avant = arbre(r1), x1 = velyx(r1, 'brouillon', 'rachat-it-idf');
  assert.equal(x1.status, 1, x1.stdout + x1.stderr);
  assert.match(x1.stdout, /contrôle bloquant en échec, ni revue ni pari/);
  assert.match(x1.stdout, /B4/);
  assert.equal(arbre(r1), avant, 'ni revue, ni pari, ni fiche privée');
  // (2) Liste liée à une annonce codeur, CGU codeur non lues : R-23, refus avant toute préparation.
  const r2 = racine();
  ecrireListe(r2, { annonce: 'https://www.codeur.com/projects/700001-fictive' });
  const avant2 = arbre(r2), x2 = velyx(r2, 'brouillon', 'rachat-it-idf');
  assert.equal(x2.status, 1);
  assert.match(x2.stdout, /Risk Agent : interdit \(R-23\)/);
  assert.equal(arbre(r2), avant2);
  // (3) Liste récente, sans client codeur : revue créée ; le bloc couvert par l'empreinte est le texte contrôlé seul.
  const r3 = racine();
  ecrireListe(r3, {});
  const x3 = velyx(r3, 'brouillon', 'rachat-it-idf');
  assert.equal(x3.status, 0, x3.stdout + x3.stderr);
  const rid = /revue : (R-[\d-]+)/.exec(x3.stdout)[1], md = fs.readFileSync(path.join(r3, 'prive', 'revues', `${rid}.md`), 'utf8');
  const texte = extraireTexte(md);
  assert.ok(!/BLOQUÉ|NOTES POUR LE PROPRIÉTAIRE|€/.test(texte), 'ni en-tête BLOQUÉ, ni notes, ni montant dans le texte soumis');
  assert.ok(!/aucun contrôle fourni/.test(md), 'les contrôles sont transmis à la fiche');
  assert.match(md, /\| B1 \| bloquant \| oui \|/);
  assert.ok(fs.existsSync(path.join(r3, 'prive', 'revues', `${rid}.sirens.json`)), 'index privé de l’échantillon');
});

test('velyx verifier : registre intact mais nom du canari recopié hors de prive/ → code 1 (antifuite avant tout commit), sans le nom', () => {
  const r = racine();
  const F = JSON.parse(fs.readFileSync(path.join(DEPOT, 'test', 'fixtures', 'commun', 'entreprises.json'), 'utf8'));
  fs.mkdirSync(path.join(r, 'prive', 'listes'), { recursive: true });
  fs.writeFileSync(path.join(r, 'prive', 'listes', 'fictive-2026-11-16.json'), JSON.stringify({ cibles: F }));
  assert.equal(velyx(r, 'verifier').status, 0);
  fs.writeFileSync(path.join(r, 'notes.md'), `À rappeler : ${F[0].dirigeants[0].nom}\n`);
  const v = velyx(r, 'verifier');
  assert.equal(v.status, 1, v.stdout);
  assert.match(v.stdout, /notes\.md:1 dictionnaire/);
  assert.match(v.stdout, /"registre": true/);
  assert.ok(!v.stdout.includes(F[0].dirigeants[0].nom.split(' ')[1]), 'la sortie ne recopie pas le nom');
});

// R-04 : la clé d'un geste vient de la phrase et du jour, pas de l'heure. Le seul compteur d'argent ne compte jamais deux
// fois la même déclaration ; un encaissement qui cite un pari inexistant est refusé.
test('velyx encaisse : la même phrase deux fois le même jour → un seul acte ; ref= distingue ; pari inexistant → refus', () => {
  const r = racine();
  const lignes = () => new Registre(path.join(r, 'registre', 'journal.jsonl')).lignes;
  const a = velyx(r, 'encaisse', '50', 'libre');
  assert.equal(a.status, 0, a.stdout + a.stderr);
  const n = lignes().length;
  const b = velyx(r, 'encaisse', '50', 'libre');
  assert.equal(b.status, 1);
  assert.match(b.stdout, /déjà consigné ce jour/);
  assert.equal(lignes().length, n, 'aucun second acte');
  assert.match(velyx(r, 'etat').stdout, /Argent encaissé : 50 €/);
  const c = velyx(r, 'encaisse', '50', 'libre', 'ref=F-2026-002');
  assert.equal(c.status, 0, c.stdout + c.stderr);
  assert.equal(lignes().at(-1).reference, 'F-2026-002');
  const d = velyx(r, 'encaisse', '30', 'P-typo-inexistant');
  assert.equal(d.status, 1);
  assert.match(d.stdout, /pari inconnu/);
  assert.match(velyx(r, 'etat').stdout, /Argent encaissé : 100 €/);
});

// R-43 : velyx marche et velyx cibler passent par le plafond quotidien du cycle (10 GET codeur, 400 SIRENE).
test('velyx marche : plafond du jour déjà consommé par le cycle → aucune requête, code 1 ; consommation hors cycle décomptée', async () => {
  const { creerHorloge } = await import('../src/socle.js');
  const { creerContexte } = await import('../src/cycle.js');
  const r = racine(), jour = creerHorloge().jour(), reg = new Registre(path.join(r, 'registre', 'journal.jsonl'));
  reg.ajouter({ type: 'cycle', cle: `cycle:${jour}:1`, jour, passage: 1, statut: 'complet', etapes: [], requetes: { codeur: 10, sirene: 0 }, duree_s: 1 });
  const m = velyx(r, 'marche', '--pages', '2');
  assert.equal(m.status, 1, m.stdout + m.stderr);
  assert.match(m.stdout, /plafond restant du jour : 0 GET codeur/);
  // Une commande hors cycle qui a consommé est décomptée par le cycle suivant du même jour.
  reg.ajouter({ type: 'observation', cle: `requetes:cibler:x:${jour}`, source: 'recherche-entreprises.api.gouv.fr (velyx cibler)', mesure: { recette: 'x', lues: 25 }, requetes_hors_cycle: { codeur: 0, sirene: 30 } });
  const ctx = creerContexte({ racine: r, horloge: creerHorloge(), horsLigne: true, env: {} });
  assert.deepEqual([ctx.budget.reste('codeur'), ctx.budget.reste('sirene')], [0, 370]);
});
