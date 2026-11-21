// Tests du registre v2 (M1) : compatibilité v1, idempotence, verrou entre processus, admission, état.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Registre, EXIGE, CLES, CLES_NOMINATIVES } from '../src/registre.js';
import { TYPES_ACTE, PROPRIETAIRE_SEUL } from '../src/contrats.js';
import { creerHorloge, sha256Texte, sha256Fichier, VerrouOccupe } from '../src/socle.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JOURNAL_REEL = path.join(RACINE, 'registre', 'journal.jsonl');
const journal = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'velyx-reg-')), 'journal.jsonl');
const lignesDisque = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
// Phrase fictive : seule son empreinte va au registre (la phrase reste en mémoire privée).
const PREUVE = sha256Texte('phrase fictive du propriétaire, pour les tests');
const PROPRIO = { auteur: 'proprietaire', verification: 'session', preuve_empreinte: PREUVE };
const pari = (id) => ({ type: 'pari', id, hypothese: 'h', geste_proprietaire: 'g', critere_succes: 's', critere_arret: 'a', echeance: 'envoi + 7 jours' });

test('le journal réel passe verifier() après extension, mandat de la ligne 14 compris', () => {
  const reel = new Registre(JOURNAL_REEL);
  const v = reel.verifier();
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.ok(v.lignes >= 15);
  assert.equal(reel.lignes[13].type, 'mandat');
  assert.equal(reel.lignes[13].auteur, 'proprietaire');
  // Sur une copie : de nouveaux actes v2 s'enchaînent à la suite des lignes v1 sans rien casser.
  const f = journal();
  fs.copyFileSync(JOURNAL_REEL, f);
  const r = new Registre(f, { horloge: creerHorloge('2026-11-16T05:41:00Z') });
  const n = r.lignes.length;
  // Clé absente du journal réel, quel que soit le nombre de cycles déjà consignés (un acte de même clé serait rendu tel quel).
  const l = r.ajouter({ type: 'cycle', cle: CLES.cycle('2099-01-01', 1), jour: '2099-01-01', passage: 1, etapes: [], requetes: { codeur: 0, sirene: 0 }, duree_s: 0 });
  assert.equal(l.n, n + 1);
  assert.equal(l.precedente, r.lignes[n - 1].empreinte);
  assert.equal(l.date, '2026-11-16T05:41:00.000Z');
  assert.deepEqual(new Registre(f).verifier(), { ok: true, lignes: n + 1 });
  assert.equal(r.etat().dernier_geste_proprietaire, r.lignes.filter((x) => x.auteur === 'proprietaire').at(-1).date, 'dernier acte du propriétaire');
});

test('EXIGE couvre chaque type d’acte ; CLES suit le format de la spécification', () => {
  assert.deepEqual(Object.keys(EXIGE).sort(), [...TYPES_ACTE].sort());
  assert.equal(CLES.observation('2026-11-15'), 'observation:codeur:2026-11-15');
  assert.equal(CLES.fait('codeur', 'offres_mediane', '2026-11-15'), 'fait:codeur:offres_mediane:2026-11-15');
  assert.equal(CLES.cycle('2026-11-15', 2), 'cycle:2026-11-15:2');
  assert.equal(CLES.audit('2026-S46'), 'audit:2026-S46');
  assert.equal(CLES.geste('session', 'encaisse 300 P-x'), `geste:${sha256Texte('sessionencaisse 300 P-x')}`);
});

test('même cle ajoutée deux fois → une seule ligne', () => {
  const f = journal(), r = new Registre(f);
  const acte = { type: 'observation', cle: CLES.observation('2026-11-15'), source: 'codeur.com', mesure: { lus: 169 } };
  const a = r.ajouter(acte), b = r.ajouter({ ...acte, mesure: { lus: 170 } });
  assert.deepEqual(b, a, 'la ligne existante est rendue telle quelle');
  const c = new Registre(f).ajouter(acte);                // un autre processus, plus tard le même jour
  assert.deepEqual(c, a);
  assert.equal(lignesDisque(f).length, 1);
  assert.equal(r.trouver(acte.cle).n, 1);
  assert.equal(r.trouver('absente'), undefined);
  r.ajouter({ ...acte, cle: CLES.observation('2026-11-16') });
  assert.equal(lignesDisque(f).length, 2);
  assert.equal(r.de('observation').length, 2);
  assert.equal(r.derniere('observation').cle, 'observation:codeur:2026-11-16');
  assert.equal(r.derniere('observation', (l) => l.cle.endsWith('15')).n, 1);
  assert.throws(() => r.ajouter({ ...acte, cle: '' }), /cle/);
});

test('20 processus enfants × 5 ajouts en parallèle → 100 lignes et verifier().ok', async () => {
  const f = journal();
  const script = `import { Registre } from ${JSON.stringify(pathToFileURL(path.join(RACINE, 'src', 'registre.js')).href)};
    const r = new Registre(process.argv[1]);
    for (let i = 0; i < 5; i++) r.ajouter({ type: 'aveu', motif: 'enfant ' + process.argv[2] + ', acte ' + i });`;
  const codes = await Promise.all(Array.from({ length: 20 }, (_, k) => new Promise((ok) => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', script, f, String(k)], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => ok({ code, err }));
  })));
  for (const c of codes) assert.equal(c.code, 0, c.err);
  const r = new Registre(f);
  assert.deepEqual(r.verifier(), { ok: true, lignes: 100 });
  assert.deepEqual(r.lignes.map((l) => l.n), Array.from({ length: 100 }, (_, i) => i + 1));
  assert.equal(new Set(r.lignes.map((l) => l.motif)).size, 100, 'aucun acte perdu ni doublé');
  assert.deepEqual(fs.readdirSync(path.dirname(f)), ['journal.jsonl'], 'ni verrou ni .tmp laissés');
});

test('montants validés : fini et strictement positif', () => {
  const r = new Registre(journal());
  for (const m of ['abc', Number('abc'), 0, -5, Infinity, '120']) {
    assert.throws(() => r.ajouter({ type: 'encaissement', ...PROPRIO, montant_eur: m, preuve: 'virement' }), /montant_eur/, String(m));
  }
  assert.throws(() => r.ajouter({ type: 'depense', ...PROPRIO, montant_eur: Number.NaN, objet: 'x', autorise_par: 'proprietaire' }), /montant_eur/);
  assert.throws(() => r.ajouter({ type: 'depense', ...PROPRIO, montant_eur: 5, objet: 'x', autorise_par: 'velyx' }), /seul le propriétaire autorise/);
  assert.equal(r.lignes.length, 0);
  r.ajouter({ type: 'encaissement', ...PROPRIO, montant_eur: 120.5, preuve: 'virement' });
  assert.equal(r.etat().encaisse_eur, 120.5);
});

test('envoi, reponse et cloture exigent un pari existant ; issue ∈ ISSUES', () => {
  const r = new Registre(journal());
  assert.throws(() => r.ajouter({ type: 'envoi', ...PROPRIO, pari: 'P-inconnu', canal: 'email' }), /pari inconnu/);
  assert.throws(() => r.ajouter({ type: 'reponse', ...PROPRIO, pari: 'P-inconnu', issue: 'question' }), /pari inconnu/);
  assert.throws(() => r.ajouter({ type: 'cloture', pari: 'P-inconnu', motif: 'caduc' }), /pari inconnu/);
  r.ajouter(pari('P-1'));
  assert.throws(() => r.ajouter(pari('P-1')), /existe déjà/, 'un id de pari est unique');
  r.ajouter({ type: 'envoi', ...PROPRIO, pari: 'P-1', canal: 'email' });
  assert.throws(() => r.ajouter({ type: 'reponse', ...PROPRIO, pari: 'P-1', issue: 'gagne' }), /issue inconnue/);
  r.ajouter({ type: 'reponse', ...PROPRIO, pari: 'P-1', issue: 'devis_demande' });
  assert.equal(r.etat().paris[0].statut, 'gagne');
});

test('actes du propriétaire : auteur et vérification exigés', () => {
  const r = new Registre(journal());
  const revue = { type: 'revue', id: 'R-2026-11-15-1', type_revue: 'proposition', geste: 'valide R-2026-11-15-1#a3f9c2', fichier_prive: 'prive/revue/R-2026-11-15-1.md' };
  assert.throws(() => r.ajouter({ ...revue, empreinte: 'a3f9c2d41b7e8f60' }), /réservée au registre ; utiliser empreinte_revue/);
  const l = r.ajouter({ ...revue, empreinte_revue: 'a3f9c2d41b7e8f60' });
  assert.equal(l.empreinte_revue, 'a3f9c2d41b7e8f60');
  assert.notEqual(l.empreinte, l.empreinte_revue, 'l’empreinte de chaînage ne remplace pas celle du contenu');
  const validation = { type: 'validation', revue: 'R-2026-11-15-1', empreinte_revue: 'a3f9c2d41b7e8f60', choix: 'A' };
  assert.throws(() => r.ajouter({ ...validation, auteur: 'proprietaire' }), /il manque : verification/, 'validation sans verification');
  assert.throws(() => r.ajouter({ ...validation, auteur: 'proprietaire', verification: 'parole' }), /verification doit valoir/);
  assert.throws(() => r.ajouter({ ...validation, auteur: 'proprietaire', verification: 'session' }), /preuve_empreinte/);
  assert.throws(() => r.ajouter({ ...validation, auteur: 'proprietaire', verification: 'session', preuve_empreinte: 'abc123' }), /preuve_empreinte/);
  assert.throws(() => r.ajouter({ ...validation, verification: 'session', preuve_empreinte: PREUVE }), /seul le propriétaire/, 'validation écrite par velyx');
  r.ajouter({ ...validation, ...PROPRIO });
  const geste = { type: 'geste', sujet: 'statut', valeur: 'micro', verification: 'session', preuve_empreinte: PREUVE };
  assert.throws(() => r.ajouter(geste), /seul le propriétaire/, 'geste écrit avec auteur velyx');
  assert.throws(() => r.ajouter({ ...geste, auteur: 'velyx' }), /seul le propriétaire/);
  assert.throws(() => r.ajouter({ ...geste, auteur: 'quelquun' }), /auteur inconnu/);
  r.ajouter({ ...geste, auteur: 'proprietaire', cle: CLES.geste('session', 'statut micro') });
  for (const t of PROPRIETAIRE_SEUL) {
    assert.throws(() => r.ajouter({ type: t, auteur: 'velyx' }), /seul le propriétaire|il manque/, t);
  }
  // Compatibilité v1 : un acte v1 du propriétaire sans vérification reste admis (compté comme déclaré).
  r.ajouter({ type: 'encaissement', auteur: 'proprietaire', montant_eur: 10, preuve: 'v1' });
  assert.equal(r.verifier().ok, true);
});

test('cloture : velyx ne clôt que « caduc » ; « perdu » est un acte du propriétaire', () => {
  const r = new Registre(journal());
  r.ajouter(pari('P-a'));
  r.ajouter(pari('P-b'));
  assert.throws(() => r.ajouter({ type: 'cloture', pari: 'P-a', motif: 'perdu' }), /seul le propriétaire le déclare perdu/);
  assert.throws(() => r.ajouter({ type: 'cloture', pari: 'P-a', motif: 'abandon' }), /motif/);
  assert.throws(() => r.ajouter({ type: 'cloture', pari: 'P-a', motif: 'perdu', auteur: 'proprietaire' }), /verification/, 'acte v2 du propriétaire non vérifié');
  r.ajouter({ type: 'cloture', pari: 'P-a', motif: 'caduc', cle: CLES.cloture('P-a') });
  r.ajouter({ type: 'cloture', pari: 'P-b', motif: 'perdu', ...PROPRIO });
  assert.deepEqual(r.etat().paris.map((p) => p.statut), ['caduc', 'perdu']);
});

test('aucune clé nominative ni réservée dans un acte', () => {
  const r = new Registre(journal());
  assert.throws(() => r.ajouter({ type: 'aveu', motif: 'x', dirigeants: [] }), /clé nominative « dirigeants »/);
  assert.throws(() => r.ajouter({ type: 'observation', source: 's', mesure: { echantillon: [{ nom: 'X' }] } }), /clé nominative « nom »/, 'à toute profondeur');
  assert.throws(() => r.ajouter({ type: 'opposition', n_total: 1, origine: 'demande', siren: '999000012' }), /siren/);
  for (const k of CLES_NOMINATIVES) assert.throws(() => r.ajouter({ type: 'aveu', motif: 'x', detail: { [k]: 'x' } }), /nominative/, k);
  assert.throws(() => r.ajouter({ type: 'aveu', motif: 'x', n: 1 }), /réservée/);
  assert.throws(() => r.ajouter({ type: 'fait', sujet: 'codeur', mesure: 'offres_mediane', n: 31, source: 's' }), /utiliser n_fait/);
  const f = r.ajouter({ type: 'fait', sujet: 'codeur', mesure: 'offres_mediane', valeur: 5, n_fait: 31, source: 'codeur.com', cle: CLES.fait('codeur', 'offres_mediane', '2026-11-15') });
  assert.equal(f.n, 1);
  assert.equal(f.n_fait, 31);
  assert.throws(() => r.ajouter({ type: 'aveu', motif: 'x', date: '2020-01-01' }), /réservée/);
  assert.throws(() => r.ajouter({ type: 'inconnu' }), /type inconnu/);
  assert.throws(() => r.ajouter({ type: 'pari', hypothese: 'h' }), /il manque/);
  assert.equal(r.lignes.length, 1, 'seul le fait correct est écrit');
});

test('etat() : encaissé vérifié (github) séparé du déclaré ; statut et échéance des paris', () => {
  const f = journal(), r = new Registre(f, { horloge: creerHorloge('2026-11-20T10:00:00Z') });
  r.ajouter({ type: 'encaissement', ...PROPRIO, montant_eur: 300, preuve: 'virement' });
  r.ajouter({ type: 'encaissement', ...PROPRIO, verification: 'github', montant_eur: 200, preuve: 'commentaire #12' });
  r.ajouter({ type: 'encaissement', auteur: 'proprietaire', montant_eur: 50, preuve: 'v1, sans vérification' });
  for (const id of ['P-ouvert', 'P-envoye', 'P-question', 'P-refus']) r.ajouter(pari(id));
  r.ajouter({ type: 'envoi', ...PROPRIO, pari: 'P-envoye', canal: 'comeup' });
  r.ajouter({ type: 'envoi', ...PROPRIO, pari: 'P-question', canal: 'email' });
  r.ajouter({ type: 'reponse', ...PROPRIO, pari: 'P-question', issue: 'question' });
  r.ajouter({ type: 'envoi', ...PROPRIO, pari: 'P-refus', canal: 'malt' });
  r.ajouter({ type: 'reponse', ...PROPRIO, pari: 'P-refus', issue: 'refus' });
  r.ajouter({ type: 'aveu', motif: 'dernier acte, écrit par velyx' });
  const e = new Registre(f).etat();
  assert.equal(e.encaisse_eur, 550);
  assert.equal(e.encaisse_verifie_eur, 200, 'seuls les encaissements vérifiés par GitHub');
  assert.equal(e.depense_eur, 0);
  assert.equal(e.dernier_geste_proprietaire, '2026-11-20T10:00:00.000Z');
  const p = Object.fromEntries(e.paris.map((x) => [x.id, x]));
  assert.equal(p['P-ouvert'].statut, 'ouvert');
  assert.equal(p['P-ouvert'].echeance_le, null);
  assert.equal(p['P-envoye'].statut, 'envoye');
  assert.equal(p['P-envoye'].canal, 'comeup');
  assert.equal(p['P-envoye'].echeance_le, '2026-11-27T10:00:00.000Z');
  assert.equal(p['P-question'].statut, 'envoye', '« question » ne gagne pas un pari');
  assert.deepEqual(p['P-question'].issues, ['question']);
  assert.equal(p['P-refus'].statut, 'perdu', 'un refus n’est jamais une réponse positive');
  for (const x of e.paris) for (const k of ['id', 'hypothese', 'echeance', 'envoye', 'issues', 'geste', 'canal', 'statut']) assert.ok(k in x, k);
  assert.equal(new Registre(journal()).etat().dernier_geste_proprietaire, null);
});

test('verrou : un verrou périmé est brisé ; un verrou vivant bloque, sans rien écrire', () => {
  const f = journal(), r = new Registre(f, { verrou: { attenteMs: 100 } });
  r.ajouter({ type: 'aveu', motif: 'premier' });
  fs.writeFileSync(r.verrou, 'processus vivant');
  assert.throws(() => r.ajouter({ type: 'aveu', motif: 'bloqué' }), VerrouOccupe);
  assert.equal(lignesDisque(f).length, 1);
  const vieux = (Date.now() - 31_000) / 1000;
  fs.utimesSync(r.verrou, vieux, vieux);
  r.ajouter({ type: 'aveu', motif: 'après un verrou périmé' });
  assert.equal(lignesDisque(f).length, 2);
  assert.equal(fs.existsSync(r.verrou), false);
  assert.equal(r.verrou, `${f}.lock`);
});

test('copie en mémoire : les ajouts n’atteignent jamais le disque', () => {
  const f = journal(), r = new Registre(f);
  r.ajouter(pari('P-1'));
  const avant = sha256Fichier(f), c = r.copie();
  c.ajouter({ type: 'cloture', pari: 'P-1', motif: 'caduc' });
  assert.equal(c.lignes.length, 2);
  assert.equal(c.verifier().ok, true);
  assert.equal(sha256Fichier(f), avant);
  assert.equal(new Registre(f).lignes.length, 1);
  assert.equal(r.lignes.length, 1);
});

test('journal abîmé : verifier() le signale, ajouter() refuse ; écriture atomique sans reste', () => {
  const f = journal(), r = new Registre(f);
  r.ajouter({ type: 'aveu', motif: 'a' });
  r.ajouter({ type: 'aveu', motif: 'b' });
  assert.ok(fs.readFileSync(f, 'utf8').endsWith('\n'));
  assert.deepEqual(fs.readdirSync(path.dirname(f)), ['journal.jsonl']);
  fs.appendFileSync(f, '{"n":3,"tronq');
  assert.deepEqual(new Registre(f).verifier(), { ok: false, ligne: 3, motif: 'illisible' });
  assert.throws(() => new Registre(f).ajouter({ type: 'aveu', motif: 'c' }), /illisible/);
  const g = journal();
  fs.copyFileSync(JOURNAL_REEL, g);
  const lignes = lignesDisque(g);
  fs.writeFileSync(g, `${[...lignes.slice(0, 5), ...lignes.slice(6)].join('\n')}\n`);
  assert.equal(new Registre(g).verifier().ok, false, 'une ligne retirée au milieu est détectée');
});

test('fusionner : reporté', () => {
  assert.throws(() => Registre.fusionner([], []), /reporté/);
});

// ---------------------------------------------------------------------------------------------------------------------
// R-10 : antifuite à l'écriture du registre public (en ajout seul : une fuite écrite ne se retire plus).
// Données FICTIVES : test/fixtures/commun/entreprises.json, canari « Zéphyrin CANARIX ».

import * as garde from '../src/garde.js';
import { appliquerGeste, mettreEnRevue } from '../src/risque.js';
import { creerMagasin } from '../src/socle.js';

const ENTREPRISES = JSON.parse(fs.readFileSync(path.join(RACINE, 'test', 'fixtures', 'commun', 'entreprises.json'), 'utf8'));
function racineAvecListe() {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'velyx-reg-r10-'));
  fs.mkdirSync(path.join(r, 'prive', 'listes'), { recursive: true });
  fs.mkdirSync(path.join(r, 'registre'));
  fs.writeFileSync(path.join(r, 'prive', 'listes', 'fictive-2026-11-16.json'), JSON.stringify({ cibles: ENTREPRISES }));
  return r;
}
const EI = ENTREPRISES.find((e) => e.nature_juridique === '1000') ?? ENTREPRISES[0];
// Motifs assemblés à l'exécution : le scan du dépôt (velyx garde) ne doit pas les voir dans ce fichier.
const TEL = ['06 12', '34 56 78'].join(' '), MEL = ['z.contact', 'exemple.fr'].join('@');

test('R-10 : un acte dont une valeur nomme un dirigeant, porte un téléphone, un e-mail ou un SIREN est refusé avant le verrou', () => {
  const r = racineAvecListe(), f = path.join(r, 'registre', 'journal.jsonl');
  const reg = new Registre(f, { horloge: creerHorloge('2026-11-16T08:00:00Z') });   // dictionnaire construit depuis prive/
  reg.ajouter({ type: 'aveu', motif: 'registre fictif de test' });
  const avant = fs.readFileSync(f, 'utf8');
  const refuse = (acte, re) => assert.throws(() => reg.ajouter(acte), re);
  refuse({ type: 'aveu', motif: 'le gérant M. Canarix a déjà un fournisseur' }, /antifuite.*jeton du dictionnaire/);
  refuse({ type: 'aveu', motif: 'contact : Zéphyrin CANARIX' }, /jeton du dictionnaire/);
  refuse({ type: 'aveu', motif: `rappeler au ${TEL}` }, /motif telephone/);
  refuse({ type: 'aveu', motif: `écrire à ${MEL}` }, /motif email/);
  refuse({ type: 'aveu', motif: `entreprise individuelle ${EI.siren}` }, /siren|jeton du dictionnaire/);
  refuse({ type: 'hypothese', contradiction: 'K-1', type_hyp: 'instrument', test: { action: 'relire', cout_requetes: 1 }, pourquoi: `le gérant M. Canarix (${TEL})` }, /antifuite/);
  refuse({ type: 'aveu', motif: 'clé nominative', cle: 'aveu:Zéphyrin CANARIX' }, /jeton du dictionnaire \(cle\)/);
  assert.equal(fs.readFileSync(f, 'utf8'), avant, 'rien n’est écrit');
  // Un acte sans donnée nominative passe ; l'encaissement garde son champ « preuve » (exigé depuis la v1), scanné.
  assert.equal(reg.ajouter({ type: 'aveu', motif: 'lecture partielle, au moins 12 fiches' }).n, 2);
  assert.equal(reg.ajouter({ type: 'encaissement', ...PROPRIO, montant_eur: 10, preuve: 'déclaration du propriétaire en session' }).n, 3);
  refuse({ type: 'encaissement', ...PROPRIO, montant_eur: 10, preuve: 'virement de M. Canarix' }, /jeton du dictionnaire/);
  assert.equal(reg.verifier().ok, true);
});

test('R-10 : un geste « rejette » ou « valide … <choix> » qui nomme une personne est refusé, et sa phrase n’est pas gardée', () => {
  const r = racineAvecListe(), f = path.join(r, 'registre', 'journal.jsonl'), h = creerHorloge('2026-11-16T08:00:00Z');
  const reg = new Registre(f, { horloge: h }), magasin = creerMagasin(r);
  reg.ajouter({ type: 'revue', id: 'R-2026-11-16-1', type_revue: 'proposition', empreinte_revue: 'a'.repeat(16), geste: 'relire', fichier_prive: 'prive/revues/R-2026-11-16-1.md', expire_le: '2026-11-23T08:00:00Z' });
  const avant = fs.readFileSync(f, 'utf8');
  assert.throws(() => appliquerGeste('rejette R-2026-11-16-1 Zéphyrin Canarix a déjà un fournisseur', { registre: reg, horloge: h, magasin }), /antifuite/);
  assert.equal(fs.readFileSync(f, 'utf8'), avant);
  assert.equal(magasin.lire('prive/gestes.jsonl'), null, 'la phrase refusée n’est pas consignée');
  assert.equal(appliquerGeste('rejette R-2026-11-16-1 a déjà un fournisseur', { registre: reg, horloge: h, magasin }).actes.length, 1);
  // « valide R-…#empreinte <choix> » : le choix libre (80 caractères) suit le même chemin.
  const { revue } = mettreEnRevue({ type: 'prealable', ref: 'statut', texte: 'Fiche de préalable fictive.', geste: 'lire la fiche' }, { registre: reg, horloge: h, magasin });
  const n = reg.lignes.length;
  assert.throws(() => appliquerGeste(`valide ${revue.id}#${revue.empreinte.slice(0, 6)} pour Zéphyrin Canarix`, { registre: reg, horloge: h, magasin }), /antifuite/);
  assert.equal(reg.lignes.length, n);
  assert.equal(appliquerGeste(`valide ${revue.id}#${revue.empreinte.slice(0, 6)} micro`, { registre: reg, horloge: h, magasin }).actes[0].choix, 'micro');
});

test('R-10 : dictionnaire indisponible (null) → texte libre refusé hors des actes du moteur ; dictionnaire injecté et copie héritée', () => {
  const f = journal(), h = creerHorloge('2026-11-16T08:00:00Z');
  const sans = new Registre(f, { horloge: h, dict: null });
  assert.throws(() => sans.ajouter({ type: 'aveu', motif: 'texte quelconque' }), /sans dictionnaire.*échec fermé/);
  assert.throws(() => sans.ajouter({ type: 'geste', ...PROPRIO, sujet: 'rejet', valeur: 'R-2026-11-16-1', motif: 'déjà équipé' }), /sans dictionnaire/);
  // Les actes du moteur (décision, cycle) et ceux sans texte libre restent admis : plafonds et traces du cycle tiennent.
  assert.ok(sans.ajouter({ type: 'decision', action: 'rien', verdict: 'autorise', regle: 'R-09', motif: 'aucune action' }));
  assert.ok(sans.ajouter({ type: 'cycle', jour: '2026-11-16', passage: 1, etapes: [], requetes: { codeur: 0, sirene: 0 }, duree_s: 0 }));
  assert.ok(sans.ajouter({ type: 'encaissement', ...PROPRIO, montant_eur: 1, preuve: 'déclaration' }));
  assert.throws(() => sans.ajouter({ type: 'aveu', motif: `appeler le ${TEL}` }), /motif telephone/);
  // Dictionnaire injecté (garde.dictionnaire) ; la copie à blanc applique le même.
  const r = racineAvecListe(), dict = garde.dictionnaire(creerMagasin(r));
  const avec = new Registre(journal(), { horloge: h, dict });
  assert.throws(() => avec.ajouter({ type: 'aveu', motif: 'M. Canarix' }), /jeton du dictionnaire/);
  assert.throws(() => avec.copie().ajouter({ type: 'aveu', motif: 'M. Canarix' }), /jeton du dictionnaire/);
  assert.throws(() => sans.copie().ajouter({ type: 'aveu', motif: 'texte' }), /sans dictionnaire/);
});

test('un pari dont la revue a été remplacée n’est plus « ouvert » (pas d’envoi d’une version périmée)', async () => {
  const { default: os } = await import('node:os');
  const { default: fs } = await import('node:fs');
  const { default: path } = await import('node:path');
  const { Registre } = await import('../src/registre.js');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'velyx-caduc-')), 'j.jsonl');
  const reg = new Registre(f);
  const pari = (id) => ({ type: 'pari', id, hypothese: 'h', geste_proprietaire: 'g', critere_succes: 's', critere_arret: 'a', echeance: 'envoi + 7 jours' });
  reg.ajouter(pari('P-R-2026-11-16-4'));
  reg.ajouter(pari('P-R-2026-11-16-5'));
  reg.ajouter({ type: 'decision', action: 'invalider_revue', verdict: 'autorise', regle: 'R-28', revue: 'R-2026-11-16-4', motif: 'remplacee', cle: 'caduque:R-2026-11-16-4' });
  const st = Object.fromEntries(new Registre(f).etat().paris.map((p) => [p.id, p.statut]));
  assert.equal(st['P-R-2026-11-16-4'], 'caduc');
  assert.equal(st['P-R-2026-11-16-5'], 'ouvert');
});
