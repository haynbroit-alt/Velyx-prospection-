// Tests de MESURER, APPRENDRE et RÊVER (M10, bilan.js). Registres en mémoire, horloge factice, fiches fictives
// (test/fixtures/commun/entreprises.json, canari « Zéphyrin CANARIX ») ; aucun réseau.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Registre } from '../src/registre.js';
import { creerHorloge, creerMagasin, sha256Texte } from '../src/socle.js';
import { verifierObjetPublic } from '../src/garde.js';
import { evaluer, mettreEnRevue, appliquerGeste } from '../src/risque.js';
import {
  KPI_DEFINITIONS, SEUILS, mesurer, brier, resoudrePrevisions, validerLecon, apprendre, backtest, adopter, AUDITS, rever, acteAudit,
  estJourDeReve, REFUTATIONS_CONNUES, afficher,
} from '../src/bilan.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTREPRISES = JSON.parse(fs.readFileSync(path.join(RACINE, 'test', 'fixtures', 'commun', 'entreprises.json'), 'utf8'));
const NOM_CANARI = ENTREPRISES[0].dirigeants[0].nom.split(' ')[1];
const POLITIQUE_REELLE = JSON.parse(fs.readFileSync(path.join(RACINE, 'politique.json'), 'utf8'));
const PROPRIO = { auteur: 'proprietaire', verification: 'session', preuve_empreinte: sha256Texte('phrase fictive') };
const H = 3.6e6, J = 24 * H;
const pari = (id) => ({ type: 'pari', id, hypothese: 'h', geste_proprietaire: 'g', critere_succes: 's', critere_arret: 'a', echeance: 'envoi + 7 jours' });
const envoi = (p, canal = 'email') => ({ type: 'envoi', ...PROPRIO, pari: p, canal });
const reponse = (p, issue) => ({ type: 'reponse', ...PROPRIO, pari: p, issue });
// Un cycle par jour de Paris (le i-ème cycle tombe le 16 + i/11) : cyclesSansGeste compte des jours, pas des passages.
const cycle = (i) => ({ type: 'cycle', jour: `2026-11-${16 + i}`, passage: 1, etapes: ['observer'], requetes: { codeur: 3, sirene: 0 }, duree_s: 12, cle: `cycle:t:${i}` });
/** Registre en mémoire dont l'horloge avance à la main. */
function banc(iso = '2026-11-10T08:00:00Z') {
  const h = creerHorloge(iso);
  return { h, registre: new Registre(null, { horloge: h }) };
}
const nombres = (x, out = []) => {
  if (typeof x === 'number') out.push(x);
  else if (Array.isArray(x)) x.forEach((v) => nombres(v, out));
  else if (x && typeof x === 'object') Object.values(x).forEach((v) => nombres(v, out));
  return out;
};

// ---------------------------------------------------------------------------------------------------------------------
// MESURER.

test('encaisse_eur ne lit que les actes encaissement du propriétaire ; budget affiché (10 000 €) et devis moyen (1 500 €) n’entrent dans aucun total', () => {
  const { h, registre } = banc();
  registre.ajouter({ type: 'observation', source: 'codeur.com', mesure: { lus: 3, budget: { min: 10000, max: 10000 }, montant_moyen_devis: 1500 } });
  registre.ajouter({ type: 'cible', recette: 'fictive', compte: { retenues: 12, ca_cumule: 5e6 }, fichier_prive: 'prive/fictive.json' });
  registre.ajouter(pari('P-a'));
  registre.ajouter({ type: 'encaissement', ...PROPRIO, montant_eur: 200, preuve: 'virement déclaré', pari: 'P-a' });
  registre.ajouter({ type: 'encaissement', ...PROPRIO, verification: 'github', montant_eur: 50, preuve: 'commentaire vérifiable' });
  const { kpi } = mesurer({ registre, horloge: h });
  assert.equal(kpi.encaisse_eur.valeur, 250);
  assert.deepEqual(kpi.encaisse_eur.detail, { confirmee_eur: 50, declaree_eur: 200 });
  assert.equal(kpi.encaisse_eur.nature, 'valeur');
  assert.equal(kpi.encaisse_eur.affichage, afficher(250, 'eur'));
  for (const v of nombres(kpi)) for (const interdit of [10000, 1500, 10250, 1750, 5e6, 5000250]) assert.notEqual(v, interdit, `potentiel additionné : ${v}`);
  assert.equal(kpi.depense_eur.valeur, 0);
  // Toutes les clés de la spécification, chacune étiquetée et datée.
  for (const nom of Object.keys(KPI_DEFINITIONS)) {
    assert.ok(kpi[nom], nom);
    assert.ok(['valeur', 'goulot', 'instrument'].includes(kpi[nom].nature), nom);
    assert.equal(kpi[nom].date, h.iso());
    assert.equal(typeof kpi[nom].source, 'string');
  }
  // etat/kpi.json passe l'antifuite (aucune clé interdite, aucun texte libre trop long).
  assert.deepEqual(verifierObjetPublic(kpi, null), { ok: true, motifs: [] });
});

test('2 envois → taux_reponse_positive_7j = null, affiché « inconnu (n=2) »', () => {
  const { h, registre } = banc();
  for (const p of ['P-a', 'P-b']) { registre.ajouter(pari(p)); registre.ajouter(envoi(p)); }
  h.avancer(8 * J);
  const { kpi } = mesurer({ registre, horloge: h });
  assert.equal(kpi.taux_reponse_positive_7j.valeur, null);
  assert.equal(kpi.taux_reponse_positive_7j.affichage, 'inconnu (n=2)');
  assert.equal(kpi.taux_reponse_positive_7j.n, 2);
  assert.equal(kpi.envois.valeur, 2);
  assert.deepEqual(kpi.envois.detail.par_canal, { email: 2 });
  // Avant l'échéance, les envois n'entrent pas au dénominateur.
  const b2 = banc();
  b2.registre.ajouter(pari('P-c')); b2.registre.ajouter(envoi('P-c'));
  b2.h.avancer(2 * J);
  assert.equal(mesurer({ registre: b2.registre, horloge: b2.h }).kpi.taux_reponse_positive_7j.affichage, 'inconnu (n=0)');
});

test('issue « question » → comptée dans taux_engagement, pas dans taux_reponse_positive ; « refus » → dans aucun des deux', () => {
  const { h, registre } = banc();
  const issues = { 'P-1': 'devis_demande', 'P-2': 'question', 'P-3': 'refus', 'P-4': null, 'P-5': null };
  for (const p of Object.keys(issues)) { registre.ajouter(pari(p)); registre.ajouter(envoi(p, p === 'P-1' ? 'comeup' : 'email')); }
  h.avancer(2 * J);
  for (const [p, i] of Object.entries(issues)) if (i) registre.ajouter(reponse(p, i));
  h.avancer(6 * J);
  const { kpi } = mesurer({ registre, horloge: h });
  assert.equal(kpi.taux_reponse_positive_7j.valeur, 0.2);
  assert.equal(kpi.taux_engagement.valeur, 0.4);
  assert.equal(kpi.taux_refus.valeur, 0.2);
  assert.equal(kpi.taux_reponse_positive_7j.affichage, afficher(0.2, 'taux'));
  assert.equal(kpi.commandes.valeur, 0);
  // Une issue arrivée après 7 jours ne compte pas comme une réponse à 7 jours.
  registre.ajouter(reponse('P-4', 'commande'));
  const apres = mesurer({ registre, horloge: h }).kpi;
  assert.equal(apres.taux_reponse_positive_7j.valeur, 0.2);
  assert.equal(apres.commandes.valeur, 1);
});

test('dictionnaire vide → fuites « non mesuré par dictionnaire » (jamais 0) ; brier avec n < 10 → null', () => {
  const { h, registre } = banc();
  const vide = mesurer({ registre, horloge: h, scan: { ok: true, fuites: [], dictionnaire_vide: true, n_jetons: 0 } }).kpi.fuites;
  assert.equal(vide.valeur, null);
  assert.notEqual(vide.valeur, 0);
  assert.equal(vide.affichage, 'non mesuré par dictionnaire');
  assert.equal(mesurer({ registre, horloge: h }).kpi.fuites.affichage, 'non mesuré');
  const plein = mesurer({ registre, horloge: h, scan: { ok: true, fuites: [], dictionnaire_vide: false, n_jetons: 41 } }).kpi.fuites;
  assert.deepEqual([plein.valeur, plein.n], [0, 41]);
  assert.equal(brier([]), null);
  assert.equal(brier(Array.from({ length: 9 }, () => ({ p: 0.8, issue: 1 }))), null);
  assert.equal(brier(Array.from({ length: 10 }, () => ({ p: 0.8, issue: 1 }))), 0.04);
  assert.equal(SEUILS.brier, 10);
  const k = mesurer({ registre, horloge: h }).kpi.brier_previsions;
  assert.deepEqual([k.valeur, k.affichage, k.nature], [null, 'inconnu (n=0)', 'instrument']);
});

test('prévisions : résolues seulement par une lecture réelle postérieure à l’horizon, jamais devinées', () => {
  const { h, registre } = banc();
  const emise = h.iso();
  registre.ajouter({ type: 'prevision', id: 'PR-1', sujet: '700001', mesure: 'statut', op: '!=', seuil: 'Ouvert', p: 0.7, n_base: 25, horizon_h: 48 });
  const avant = [{ id: '700001', t: new Date(Date.parse(emise) + 10 * H).toISOString(), statut: 'Ouvert', offres: 3, tags: [] }];
  h.avancer(50 * H);
  const r1 = resoudrePrevisions(registre, avant, h);
  assert.deepEqual([r1.nouvelles.length, r1.echues_sans_lecture], [0, 1]);
  const lecture = { id: '700001', t: new Date(Date.parse(emise) + 49 * H).toISOString(), statut: 'Fermé', offres: 6, tags: [] };
  const { resolutions, kpi } = mesurer({ registre, horloge: h, series: [...avant, lecture] });
  assert.equal(resolutions.length, 1);
  assert.deepEqual([resolutions[0].prevision, resolutions[0].issue, resolutions[0].p], ['PR-1', 1, 0.7]);
  assert.match(resolutions[0].source, /etat\/series, lecture du /);
  assert.equal(kpi.brier_previsions.n, 1);
  // Consignée, elle n'est plus « nouvelle ».
  registre.ajouter({ type: 'resolution', ...resolutions[0] });
  assert.equal(mesurer({ registre, horloge: h, series: [...avant, lecture] }).resolutions.length, 0);
});

test('goulots : revues ouvertes, latence médiane (3 éléments au moins), cycles sans geste, opportunités perdues par cause', () => {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'velyx-bilan-'));
  const { h, registre } = banc('2026-11-16T08:00:00Z');
  const magasin = creerMagasin(r);
  const revue = (ref, texte, type = 'prealable') => mettreEnRevue({ type, ref, texte, geste: 'g' }, { registre, horloge: h, magasin }).revue;
  const a = revue('a', 'Texte a.'), b = revue('b', 'Texte b.'), c = revue('c', 'Texte c.'), d = revue('d', 'Texte d.', 'kit_canal');
  h.avancer(10 * H); appliquerGeste(`valide ${a.id}#${a.empreinte.slice(0, 6)}`, { registre, horloge: h, magasin });
  h.avancer(10 * H); appliquerGeste(`rejette ${b.id} pas maintenant`, { registre, horloge: h });
  assert.equal(mesurer({ registre, horloge: h }).kpi.latence_proprietaire_h.affichage, 'inconnu (n=2)');
  h.avancer(10 * H); appliquerGeste(`valide ${c.id}#${c.empreinte.slice(0, 6)}`, { registre, horloge: h, magasin });
  registre.ajouter({ type: 'decision', action: 'invalider_revue', verdict: 'autorise', regle: 'R-28', revue: d.id, motif: 'annonce_fermee', cle: `caduque:${d.id}` });
  for (let i = 0; i < 2; i++) registre.ajouter(cycle(i));
  const { kpi } = mesurer({ registre, horloge: h });
  assert.equal(kpi.latence_proprietaire_h.valeur, 20);
  assert.equal(kpi.latence_proprietaire_h.n, 3);
  assert.equal(kpi.gestes_en_attente.valeur, 0);
  assert.deepEqual(kpi.opportunites_perdues.detail.par_cause, { annonce_fermee: 1 });
  assert.equal(kpi.cycles_sans_geste.valeur, 2);
  assert.equal(kpi.cout_cycle.valeur, 12);
  assert.equal(verifierObjetPublic(kpi, null).ok, true);
});

test('séries publiques : demande cible sur 14 jours avec médiane des offres ; ratio moteur ; cycles manqués', () => {
  const { h, registre } = banc('2026-11-15T10:00:00Z');
  registre.ajouter({ type: 'aveu', motif: 'première ligne' });
  h.avancer(J); registre.ajouter(cycle(1));
  h.avancer(2 * J);
  const pub = (j) => new Date(Date.parse(h.iso()) - j * J).toISOString();
  const series = [
    { id: '1', t: pub(1), publie_le: pub(3), offres: 3, tags: ['Prospection commerciale'] },
    { id: '1', t: pub(0), publie_le: pub(3), offres: 5, tags: ['Prospection commerciale'] },
    { id: '2', t: pub(0), publie_le: pub(5), offres: 9, tags: ['Télémarketing'] },
    { id: '3', t: pub(0), publie_le: pub(20), offres: 1, tags: ['Data entry'] },
    { id: '4', t: pub(0), publie_le: pub(2), offres: 80, tags: ['WordPress'] },
  ];
  const { kpi } = mesurer({ registre, horloge: h, series, git: { commits_src_14j: 12 } });
  assert.equal(kpi.demande_cible_14j.valeur, 2);
  assert.equal(kpi.demande_cible_14j.detail.offres_mediane, 7);
  assert.equal(kpi.ratio_moteur.valeur, 12);
  assert.equal(kpi.ratio_moteur.detail.constat, true);
  assert.deepEqual([kpi.cycles_manques.valeur, kpi.cycles_manques.n], [3, 4]);
  assert.equal(mesurer({ registre, horloge: h }).kpi.ratio_moteur.affichage, 'non mesuré');
});

// ---------------------------------------------------------------------------------------------------------------------
// APPRENDRE.

function registreAvecPariGagne() {
  const b = banc();
  b.registre.ajouter({ type: 'aveu', motif: 'ligne citée' });
  b.registre.ajouter(pari('P-gagne')); b.registre.ajouter(envoi('P-gagne')); b.registre.ajouter(reponse('P-gagne', 'devis_demande'));
  b.registre.ajouter(pari('P-caduc')); b.registre.ajouter({ type: 'cloture', pari: 'P-caduc', motif: 'caduc' });
  return b;
}
const LECON = { texte: 'Les holdings par NAF faussent les comptes : exclure 70.10Z.', actes: [1], modifie: { objet: 'recette', id: 'rachat-it-idf', champ: 'naf_exclus', de: [], vers: ['70.10Z'] } };
const REGLE = { code: 'R-HOLD', champ: 'naf', op: 'in', valeur: ['70.10Z', '64.20Z'], effet: 'exclue', motif: 'holding repérée par son code NAF' };

test('leçon sans acte source, ou qui ne modifie rien → refusée ; règle avec op inconnu → refusée', () => {
  const { registre } = registreAvecPariGagne();
  assert.match(validerLecon({ ...LECON, actes: [] }, registre).motif, /au moins un acte/);
  assert.match(validerLecon({ ...LECON, actes: [999] }, registre).motif, /absent du registre/);
  assert.match(validerLecon({ ...LECON, modifie: undefined }, registre).motif, /modifie au moins un objet/);
  assert.match(validerLecon({ ...LECON, modifie: { ...LECON.modifie, vers: [] } }, registre).motif, /ne modifie rien/);
  assert.match(validerLecon({ ...LECON, modifie: { ...LECON.modifie, objet: 'moteur' } }, registre).motif, /hors de/);
  assert.match(validerLecon({ ...LECON, texte: 'voir https://exemple.invalid/x pour la suite' }, registre).motif, /URL/);
  assert.equal(validerLecon(LECON, registre).ok, true);
  const r = apprendre({ registre, propositions: [
    LECON,
    { ...LECON, actes: [] },
    { ...LECON, modifie: { objet: 'regle', id: 'R-HOLD', champ: 'statut', de: null, vers: 'candidate' }, regle: { ...REGLE, op: 'ressemble' }, pari: 'P-gagne' },
    { ...LECON, modifie: { objet: 'regle', id: 'R-HOLD', champ: 'statut', de: null, vers: 'candidate' }, regle: REGLE, pari: 'P-caduc' },
    { ...LECON, modifie: { objet: 'regle', id: 'R-HOLD', champ: 'statut', de: null, vers: 'candidate' }, regle: REGLE, pari: 'P-gagne' },
  ] });
  assert.deepEqual(r.refusees.map((x) => x.index), [1, 2, 3]);
  assert.match(r.refusees[1].motif, /règle refusée/);
  assert.match(r.refusees[2].motif, /après un pari gagné/);
  assert.equal(r.regles_candidates.length, 1);
  assert.equal(r.regles_candidates[0].statut, 'candidate');
  assert.equal(r.lecons.length, 2);
  // La leçon est un acte admis par le registre, sans donnée nominative.
  for (const l of r.lecons) registre.ajouter(l);
  assert.ok(registre.verifier().ok);
  // Paris clos sans leçon : dus (le pari gagné a désormais la sienne).
  assert.deepEqual(r.dues, ['P-caduc']);
});

test('backtest chiffré sur les listes privées ; adopter exige test vert, backtest et pari gagné', () => {
  const { registre, h } = registreAvecPariGagne();
  const bt = backtest(REGLE, { fictive: ENTREPRISES });
  const attendu = ENTREPRISES.filter((e) => REGLE.valeur.includes(e.naf)).length;
  assert.ok(attendu > 0);
  assert.deepEqual(bt, { exclues: attendu, effet: 'exclue', par_liste: { fictive: { lues: ENTREPRISES.length, touchees: attendu } } });
  assert.ok(!JSON.stringify(bt).includes(NOM_CANARI), 'le backtest ne rend que des comptes');
  assert.throws(() => backtest({ ...REGLE, op: 'ressemble' }, {}), /règle refusée/);
  assert.throws(() => adopter(REGLE, { exclues: 1, par_liste: {} }, { registre, pari: 'P-gagne', horloge: h }), /backtest chiffré/);
  assert.throws(() => adopter(REGLE, bt, { registre, pari: 'P-caduc', horloge: h }), /pari gagné/);
  assert.throws(() => adopter({ ...REGLE, champ: 'dirigeants' }, bt, { registre, pari: 'P-gagne', horloge: h }), /règle refusée/);
  const { regles, acte } = adopter(REGLE, bt, { registre, pari: 'P-gagne', horloge: h, regles_actuelles: [{ ...REGLE, motif: 'ancienne version' }, { code: 'R-AUTRE' }] });
  assert.deepEqual(regles.map((r) => [r.code, r.statut ?? null]), [['R-AUTRE', null], ['R-HOLD', 'adoptee']]);
  assert.equal(regles[1].adoptee_le, h.jour());
  assert.equal(registre.ajouter(acte).type, 'regle');
  assert.equal(verifierObjetPublic({ regles }, null).ok, true);
});

// ---------------------------------------------------------------------------------------------------------------------
// RÊVER.

function registreDuReve() {
  const { h, registre } = banc('2026-11-01T08:00:00Z');
  registre.ajouter({ type: 'mandat', ...PROPRIO, texte: 'mandat 0 €', source: 'message', regle: 'dépense interdite avant encaissement' });
  registre.ajouter({ type: 'cible', recette: 'courtier-btp-aura', compte: { lues: 6250, retenues: 5037, completes: 1119 }, fichier_prive: 'prive/l.json' });
  registre.ajouter({ type: 'cible', recette: 'fictive', compte: { lues: 20, retenues: 999 }, fichier_prive: 'prive/fictive.json' });
  registre.ajouter({ type: 'depense', ...PROPRIO, montant_eur: 31.9, objet: 'abonnement', autorise_par: 'proprietaire' });
  h.avancer(J);
  registre.ajouter({ type: 'fait', sujet: 'courtier-btp-aura', mesure: 'completes', n_fait: 1119, valeur: 864, source: 'contrôle G2 (comptes de plus de 3 ans)' });
  registre.ajouter({ type: 'prevision', id: 'PR-9', sujet: '700009', mesure: 'statut', op: '!=', seuil: 'Ouvert', p: 0.5, n_base: 30, horizon_h: 24 });
  for (let i = 0; i < 5; i++) { h.avancer(J); registre.ajouter(cycle(i)); }
  h.avancer(4 * J);
  return { h, registre };
}

test('rever sur des fixtures : chiffre public obsolète, affirmation réfutée, goulot, dépense sans encaissement, moteur sans client', () => {
  const { h, registre } = registreDuReve();
  const textes_publics = {
    'README.md': '| `courtier-btp-aura` | … | CA et dirigeant déjà connus pour 1 119 |\nSur codeur.com, inscription gratuite, limite de réponses inconnue.\nMicro-entreprise : inscription gratuite.\n',
    'TASKS.md': '- la prospection est peu concurrencée partout\n',
  };
  const monde = { croyances: [{ id: 'B03', niveau: 'refutee', enonce: 'la prospection est peu concurrencée', preuves: [1], revisee_le: h.iso() },
    { id: 'B09', niveau: 'hypothese', enonce: 'statut', preuves: [], revisee_le: null }] };
  const { constats, propositions } = rever({ registre, horloge: h, textes_publics, monde, listes: { fictive: ENTREPRISES }, recettes: { fictive: {} } });
  const par = (code) => constats.filter((c) => c.code === code);
  const [obsolete] = par('chiffre_public_obsolete');
  assert.ok(obsolete, JSON.stringify(constats.map((c) => c.code)));
  assert.match(obsolete.texte, /README\.md affiche 1119 pour courtier-btp-aura\.completes, la dernière valeur consignée est 864/);
  assert.equal(obsolete.gravite, 'alerte');
  const refutees = par('affirmation_refutee');
  assert.equal(refutees.length, 2, 'la ligne sans « codeur » n’est pas signalée');
  assert.match(refutees[0].texte, /README\.md, ligne 2 : « inscription gratuite » est contredit par B01/);
  assert.deepEqual(refutees[0].preuves, [...REFUTATIONS_CONNUES[0].preuves]);
  assert.match(refutees[1].texte, /TASKS\.md, ligne 1 .* B03/);
  assert.equal(par('goulot').length, 1);
  assert.match(par('goulot')[0].texte, /5 cycles sans geste/);
  const [dep] = par('depense_sans_encaissement');
  assert.equal(dep.gravite, 'bloquant');
  assert.ok(dep.preuves.includes(1) && dep.preuves.includes(4), 'cite la dépense et le mandat');
  assert.equal(par('moteur_sans_client').length, 1);
  assert.match(par('moteur_sans_client')[0].texte, /10 jours sans geste du propriétaire/);
  assert.equal(par('croyances_rassises').length, 1);
  assert.match(par('croyances_rassises')[0].texte, /B09/);
  assert.equal(par('previsions_non_notees').length, 1);
  assert.equal(par('fuites_non_mesurees').length, 1);
  assert.equal(par('chaine')[0].gravite, 'info');
  // Constats triés, bornés, sans donnée nominative.
  assert.equal(constats[0].gravite, 'bloquant');
  for (const c of constats) {
    assert.ok([...c.texte].length <= 300, c.code);
    assert.ok(!c.texte.includes(NOM_CANARI), c.code);
  }
  assert.equal(verifierObjetPublic(acteAudit(constats, h).contenu, null).ok, true);
  // Une seule proposition : une notification ≤ 300 caractères, que le Risk Agent autorise.
  assert.equal(propositions.length, 1);
  const [n] = propositions;
  assert.equal(n.type, 'notifier');
  assert.ok([...n.params.texte].length <= 300);
  assert.equal(evaluer(n, { politique: POLITIQUE_REELLE, etat: { encaisse_eur: 0 } }).verdict, 'autorise');
});

test('rejeu des contrôles : jamais présenté comme un résultat ; opposition dans une liste privée → bloquant ; écart au compte consigné → alerte', () => {
  const { h, registre } = registreDuReve();
  const out = AUDITS.rejeu_controles({ registre, horloge: h, listes: { fictive: ENTREPRISES, vide: [] }, recettes: {}, regles: [] });
  const [opp] = out.filter((c) => c.code === 'opposition_dans_liste');
  assert.equal(opp.gravite, 'bloquant');
  assert.match(opp.texte, /fictive : 1 fiche\(s\) opposée\(s\)/);
  const [ecart] = out.filter((c) => c.code === 'rejeu_ecart');
  assert.match(ecart.texte, /^rejeu \(pas un résultat\) sur fictive : \d+ retenues aujourd’hui contre 999 consignées ligne 3/);
  assert.deepEqual(ecart.preuves, [3]);
  const [vide] = out.filter((c) => c.code === 'rejeu_controles');
  assert.match(vide.texte, /^rejeu \(pas un résultat\) sur vide : 0 retenues sur 0, aucun compte consigné/);
  for (const c of out) assert.ok(!c.texte.includes(NOM_CANARI));
  // Les oppositions reçues comptent aussi.
  const sansDrapeau = ENTREPRISES.map((e) => ({ ...e, opposition: false }));
  const recue = AUDITS.rejeu_controles({ registre, horloge: h, listes: { fictive: sansDrapeau }, oppositions: new Set([sansDrapeau[2].siren]) });
  assert.equal(recue.filter((c) => c.code === 'opposition_dans_liste').length, 1);
});

test('audits : chaîne cassée et fuite → bloquants ; mémoire des oppositions absente → bloquant ; canal ouvert sans CGU → alerte', () => {
  const { h, registre } = banc();
  registre.ajouter({ type: 'aveu', motif: 'x' });
  registre.lignes[0].motif = 'falsifié';
  assert.equal(AUDITS.chaine({ registre })[0].code, 'chaine_cassee');
  assert.equal(AUDITS.fuites({ scan: { ok: false, fuites: [{ fichier: 'README.md', ligne: 3, motif: 'dictionnaire' }] } })[0].gravite, 'bloquant');
  assert.equal(AUDITS.fuites({ scan: { ok: true, fuites: [], dictionnaire_vide: true } })[0].code, 'fuites_non_mesurees');
  assert.equal(AUDITS.memoire({ oppositions_dispo: false })[0].gravite, 'bloquant');
  assert.deepEqual(AUDITS.memoire({ oppositions_dispo: true }), []);
  const canaux = AUDITS.canal({ canaux: { comeup: { statut: 'ouvert', cgu: 'inconnue' }, codeur: { statut: 'exclu', cgu: 'inconnue' } } });
  assert.deepEqual(canaux.map((c) => c.code), ['canal_cgu']);
  assert.equal(AUDITS.canal({ canaux: { malt: { statut: 'a_ouvrir' } } })[0].code, 'aucun_canal_ouvert');
  const r = rever({ registre, horloge: h, scan: { ok: false, fuites: [{}] } });
  assert.ok(r.constats.slice(0, 2).every((c) => c.gravite === 'bloquant'));
  assert.match(r.propositions[0].params.texte, /2 bloquant/);
});

test('acte audit admis par le registre ; rêve le dimanche (jour de Paris)', () => {
  const { h, registre } = registreDuReve();
  const { constats } = rever({ registre, horloge: h });
  const a = acteAudit(constats, h);
  assert.equal(a.chemin, `etat/audit/${h.semaine()}.json`);
  const l = registre.ajouter(a.acte);
  assert.deepEqual([l.type, l.semaine, l.cle], ['audit', h.semaine(), `audit:${h.semaine()}`]);
  assert.ok(l.constats.every((c) => Object.keys(c).join() === 'code,gravite'));
  assert.equal(estJourDeReve(creerHorloge('2026-11-15T12:00:00Z')), true);
  assert.equal(estJourDeReve(creerHorloge('2026-11-15T23:30:00Z')), false, 'déjà lundi à Paris');
});

test('registre réel : KPI mesurables sans rien inventer (0 €, aucun envoi, inconnu sous les seuils)', () => {
  const reel = new Registre(path.join(RACINE, 'registre', 'journal.jsonl'));
  const { kpi } = mesurer({ registre: reel, horloge: creerHorloge('2026-11-16T10:00:00Z') });
  assert.equal(kpi.encaisse_eur.valeur, 0);
  assert.equal(kpi.depense_eur.valeur, 0);
  assert.equal(kpi.envois.valeur, 0);
  assert.equal(kpi.taux_reponse_positive_7j.affichage, 'inconnu (n=0)');
  assert.equal(verifierObjetPublic(kpi, null).ok, true);
});

// K16 : une annonce vue seulement en liste n'a pas de pubDate ; son âge lu au relevé (age_h) la fait compter, comme dans
// le fait demande_cible_14j de COMPRENDRE (une seule définition). Annonces FICTIVES.
test('demande_cible_14j : points sans publie_le comptés par age_h ; MESURER = COMPRENDRE sur le même relevé', async () => {
  const { comprendre } = await import('../src/monde.js');
  const { pointSerie } = await import('../src/sources/observer.js');
  const lu_le = '2026-11-16T07:00:00.000Z', { h, registre } = banc(lu_le);
  const A = (id, tags, extra) => ({ id, statut: 'Ouvert', offres: Number(id.slice(-1)), tags, titre: `Annonce fictive ${id}`, resume: '', ...extra });
  const annonces = [A('900001', ['Prospection commerciale'], { publie_le: '2026-11-15T07:00:00.000Z', age_h: 24 }),
    A('900002', ['Télémarketing'], { publie_le: null, age_h: 72 }), A('900003', ['Data entry'], { publie_le: null, age_h: 96 }),
    A('900004', [], { publie_le: null, age_h: 5, titre: 'Constituer un fichier fictif d’entreprises' }), A('900005', ['Prospection commerciale'], { publie_le: null, age_h: 400 }),
    A('900006', ['WordPress'], { publie_le: null, age_h: 3 })];
  const { faits } = comprendre({ lu_le, jour: '2026-11-16', sante: { ok: true, n: 6, rss_n: 1 }, annonces, suivis: [], pages: [], sondes: [] }, {});
  const fait = faits.find((f) => f.sujet === 'demande_cible_14j' && f.mesure === 'annonces').valeur;
  assert.equal(fait, 4, '900001 à 900004 ; 900005 a plus de 14 j ; 900006 hors cible');
  const series = annonces.map((a) => pointSerie(a, lu_le));
  assert.equal(series.filter((p) => !p.publie_le).length, 5);
  h.avancer(H);
  const { kpi } = mesurer({ registre, horloge: h, series });
  assert.equal(kpi.demande_cible_14j.valeur, fait, 'MESURER publie le même nombre que COMPRENDRE');
  assert.equal(kpi.demande_cible_14j.detail.offres_mediane, 2.5);
});
