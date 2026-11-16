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
