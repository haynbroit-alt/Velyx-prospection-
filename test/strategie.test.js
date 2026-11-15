// Tests de la stratégie (M8) : ANTICIPER, PRIORISER, DÉCIDER, canaux et plan d'observation. Hors réseau ; annonces,
// séries, paris et revues sont FICTIFS (aucun client, aucun nom).
import test from 'node:test';
import assert from 'node:assert/strict';
import { TYPES_ACTION } from '../src/contrats.js';
import { creerHorloge, empreinte } from '../src/socle.js';
import { Registre } from '../src/registre.js';
import { chargerMonde } from '../src/monde.js';
import * as S from '../src/strategie.js';

const NOW = '2026-11-18T07:00:00.000Z';
const horloge = () => creerHorloge(NOW);
const RECETTES = { 'courtier-fictif-btp': { annonce: null, besoin: 'Dirigeants du BTP pour un courtier fictif en assurance construction' } };
const ann = (id, extra = {}) => ({ id, statut: 'Ouvert', offres: 3, age_h: 10, tags: ['Prospection commerciale'], titre: `Constituer une liste fictive d’entreprises du BTP ${id}`,
  resume: '', budget: { min: 500, max: 1000, texte: '500 € à 1 000 €' }, famille: 'donnees', pertinente: true, client_identifiable: true, devis_2h: { n: 2, heures: 2 }, detail: true, ...extra });
const opp = (id, extra = {}) => ({ annonce_id: id, famille: 'donnees', age_h: 10, offres: 3, devis_2h_n: 2, budget_affiche: '500 € à 1 000 €', recette_proche: 'courtier-fictif-btp',
  preuve_legere: true, cout_requetes: 3, canaux_possibles: ['email_direct'], client_identifiable: true, vitesse_offres_h: null, ...extra });
const revue = (id, type, ref, extra = {}) => ({ id, type, ref, statut: 'ouverte', ouverte_le: '2026-11-17T07:00:00.000Z', expire_le: '2026-11-24T07:00:00.000Z', age_h: 24, ...extra });
const PRETES = { 'courtier-fictif-btp': { sonde: true, echantillon: true } };
// 25 annonces fictives relevées à t0, t0 + 20 h, t0 + 48 h et t0 + 80 h : 10 fermées à 48 h, 15 encore ouvertes à 80 h ;
// 5 dépassent 5 offres dès 20 h, les autres en ont 4 à 48 h.
const SERIES = Array.from({ length: 25 }, (_, i) => {
  const id = String(800001 + i), pub = '2026-11-01T06:00:00.000Z', tags = ['Prospection commerciale'];
  const at = (h) => new Date(Date.parse('2026-11-01T08:00:00.000Z') + h * 3.6e6).toISOString();
  return [{ id, t: at(0), statut: 'Ouvert', offres: 2, tags, publie_le: pub }, { id, t: at(20), statut: 'Ouvert', offres: i < 5 ? 9 : 3, tags, publie_le: pub },
    ...[48, 80].map((h) => ({ id, t: at(h), statut: i < 10 ? 'Fermé' : 'Ouvert', offres: i < 5 ? 9 : 4, tags, publie_le: pub }))];
}).flat();
const types = (actions) => actions.map((a) => a.type);
function cyclePur({ annonces = [ann('900101')], series = [], revues = [], paris = [], canaux = S.calculerCanaux(null), recettes = PRETES, encaisse_eur = 0, monde = chargerMonde(null),
  etat = {}, etat_registre = null } = {}) {
  const a = S.anticiper({ faits: [], monde, series, etat_registre: etat_registre ?? { paris, dernier_geste_proprietaire: '2026-11-17T20:00:00.000Z' }, revues, canaux, horloge: horloge(), annonces, recettes: RECETTES });
  const p = S.prioriser({ opportunites: a.opportunites, risques: a.risques, revues_ouvertes: revues, canaux, prealables: S.prealablesOuverts(monde, canaux), encaisse_eur });
  const d = S.decider(p.file, { monde, canaux, revues_ouvertes: revues, paris, encaisse_eur, cycles_sans_geste: 0, constats_bloquants: [], recettes, horloge: horloge(), ...etat });
  return { a, p, d };
}

test('calculerCanaux : codeur exclu (lignes 13 et 14), email_direct à décider, ComeUp et Malt à ouvrir ; gestes et CGU lues', () => {
  const c = S.calculerCanaux(null, []);
  assert.deepEqual(Object.fromEntries(Object.entries(c).map(([k, v]) => [k, [v.role, v.statut, v.cgu]])), {
    codeur: ['observation', 'exclu', 'inconnue'], email_direct: ['envoi', 'a_decider', 'inconnue'], comeup: ['envoi', 'a_ouvrir', 'inconnue'], malt: ['envoi', 'a_ouvrir', 'inconnue'] });
  assert.deepEqual(c.codeur.preuves, [13, 14]);
  assert.equal(c.codeur.payant, true);
  const reg = new Registre(null, { horloge: horloge() });
  reg.ajouter({ type: 'aveu', motif: 'ligne fictive' });
  reg.ajouter({ type: 'geste', auteur: 'proprietaire', verification: 'session', preuve_empreinte: 'a'.repeat(64), sujet: 'canal', valeur: 'comeup ouvert' });
  const pages = [{ canal: 'codeur', chemin: S.CHEMINS.cgu_codeur, ligne: 33, clauses: [{ sujet: 'lecture_automatisee', verdict: 'autorise' }, { sujet: 'contact_hors_plateforme', verdict: 'interdit' }] }];
  const c2 = S.calculerCanaux(reg, pages);
  assert.deepEqual([c2.comeup.statut, c2.comeup.preuves], ['ouvert', [2, 15]]);
  assert.deepEqual([c2.codeur.cgu, c2.codeur.preuves], ['lue_interdite', [13, 14, 33]]);
  assert.equal(S.calculerCanaux(null, [{ canal: 'codeur', chemin: S.CHEMINS.cgu_codeur, clauses: [{ sujet: 'lecture_automatisee', verdict: 'interdit' }] }]).codeur.cgu, 'inconnue',
    'pour codeur, seule la clause de contact hors plateforme décide de l’e-mail direct');
  assert.equal(S.CANAUX_INITIAUX.codeur.statut, 'exclu', 'l’état initial n’est pas modifié');
});

test('test de forme : aucune sortie ne contient de champ en euros, ni « roi », « gain » ou « valeur_attendue »', () => {
  const { a, p, d } = cyclePur({ series: SERIES, revues: [revue('R-2026-11-17-1', 'proposition', '900555')] });
  const plan = S.planObservation(d, [], [], a.previsions, horloge());
  const notes = S.noterPrevisions(a.previsions, SERIES, creerHorloge('2026-11-30T07:00:00.000Z'));
  const interdit = /(^|_)(eur|euros?|roi|gains?|valeur_attendue)($|_)|€/i;
  const cles = [];
  const marcher = (x) => { if (Array.isArray(x)) x.forEach(marcher); else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { cles.push(k); marcher(v); } };
  marcher([a, p, d, plan, notes, S.calculerCanaux(null)]);
  assert.ok(cles.length > 50);
  assert.deepEqual(cles.filter((k) => interdit.test(k)), []);
  assert.equal(typeof a.opportunites[0].budget_affiche, 'string', 'le budget affiché est recopié en texte');
  assert.equal(a.opportunites[0].budget_affiche, '500 € à 1 000 €');
});

test('séries de moins de 20 cas → aucune prévision, mention « inconnu » ; 25 cas → prévision émise, puis notée à l’échéance', () => {
  const peu = S.anticiper({ series: SERIES.slice(0, 30), annonces: [ann('900101')], canaux: S.calculerCanaux(null), horloge: horloge(), recettes: RECETTES });
  assert.deepEqual(peu.previsions, []);
  assert.ok(peu.previsions_inconnues.length > 0 && peu.previsions_inconnues.every((x) => /^inconnu \(n=\d+\)$/.test(x.mention)));
  assert.equal(S.frequenceEmpirique(SERIES.slice(0, 30), { evenement: 'ferme', horizon_h: 72 }), null);
  assert.throws(() => S.frequenceEmpirique(SERIES, { evenement: 'gagne', horizon_h: 72 }), /événement inconnu/);
  assert.deepEqual(S.frequenceEmpirique(SERIES, { evenement: 'ferme', horizon_h: 72 }), { p: 0.4, n: 25 }, '10 fermées à 48 h, 15 ouvertes à 80 h');
  assert.deepEqual(S.frequenceEmpirique(SERIES, { evenement: 'offres_gt', seuil: 5, horizon_h: 24 }), { p: 0.2, n: 25 });
  assert.equal(S.frequenceEmpirique(SERIES, { evenement: 'ferme', horizon_h: 96 }), null, 'à 96 h, aucune annonce ouverte n’est relue après l’échéance : 10 cas tranchés');
  const plein = S.anticiper({ series: SERIES, annonces: [ann('900101')], canaux: S.calculerCanaux(null), horloge: horloge(), recettes: RECETTES });
  const pv = plein.previsions.find((x) => x.mesure === 'ferme');
  assert.deepEqual([pv.sujet, pv.op, pv.seuil, pv.p, pv.n_base, pv.horizon_h, pv.emise_le], ['annonce:900101', '==', 1, 0.4, 25, 72, NOW]);
  assert.equal(pv.id, 'prevision:annonce:900101:ferme:72:2026-11-18');
  // Notée seulement par une lecture réelle, après l'échéance.
  const avant = S.noterPrevisions([pv], [], creerHorloge('2026-11-19T07:00:00.000Z'));
  assert.deepEqual([avant.resolutions, avant.en_attente], [[], [pv.id]]);
  const fermee = [{ id: '900101', t: '2026-11-20T07:00:00.000Z', statut: 'En cours', offres: 6, tags: [] }];
  const r1 = S.noterPrevisions([pv], fermee, creerHorloge('2026-11-22T07:00:00.000Z'));
  assert.deepEqual(r1.resolutions.map((r) => [r.prevision, r.issue]), [[pv.id, 1]]);
  assert.match(r1.resolutions[0].source, /^etat\/series\/2026-11-20\.jsonl#900101@/);
  const ouverte = [{ id: '900101', t: '2026-11-21T08:00:00.000Z', statut: 'Ouvert', offres: 6, tags: [] }];
  assert.equal(S.noterPrevisions([pv], ouverte, creerHorloge('2026-11-22T07:00:00.000Z')).resolutions[0].issue, 0);
  assert.deepEqual(S.noterPrevisions([pv], [], creerHorloge('2026-11-22T07:00:00.000Z')).en_attente, [pv.id], 'sans lecture après l’échéance : pas de note');
  const reg = new Registre(null, { horloge: horloge() });
  for (const x of [...plein.actes, ...r1.actes]) reg.ajouter(x);
  assert.equal(reg.de('prevision').length, plein.previsions.length);
});

test('prioriser : deux opportunités égales sauf l’âge → la plus récente d’abord ; ordre lexicographique ; budget jamais trié', () => {
  const canaux = S.calculerCanaux(null);
  const vieille = opp('900201', { age_h: 30 }), recente = opp('900200', { age_h: 4 });
  const p = S.prioriser({ opportunites: [vieille, recente], canaux }, { nouvelles_max: 2 });
  assert.deepEqual(p.file.map((x) => x.ref), ['annonce:900200', 'annonce:900201']);
  assert.deepEqual(p.file.map((x) => x.rang), [1, 2]);
  assert.ok(p.file.every((x) => x.cles.length === 9 && x.cles.every(Number.isFinite) && x.raisons.length));
  const riches = S.prioriser({ opportunites: [opp('900301', { budget_affiche: '10 000 € et plus' }), opp('900302', { budget_affiche: 'Moins de 500 €' })], canaux }, { nouvelles_max: 2 });
  assert.deepEqual(riches.file.map((x) => x.ref), ['annonce:900302', 'annonce:900301'], 'à égalité, id décroissant ; le budget n’entre pas dans les clés');
  const mixte = S.prioriser({ opportunites: [recente, opp('900202', { offres: 12 })],
    risques: [{ type: 'canal_absent', objet: 'canaux', echeance: null, dans_h: null }, { type: 'pari_echu', objet: 'P-fictif-1', echeance: NOW, dans_h: 2 }],
    prealables: [{ ref: 'statut', sujet: 'statut', motif: 'statut inconnu' }], canaux }, { nouvelles_max: 1 });
  assert.deepEqual(mixte.file.map((x) => x.ref), ['pari_echu:P-fictif-1', 'prealable:statut', 'annonce:900200', 'canal_absent:canaux']);
  assert.deepEqual(mixte.ecartees.map((x) => x.ref), ['annonce:900202'], 'une nouvelle opportunité au plus');
  const gel = S.prioriser({ opportunites: [recente], canaux, revues_ouvertes: [revue('R-1', 'proposition', '900001'), revue('R-2', 'proposition', '900002')] });
  assert.equal(gel.gel, true);
  assert.match(gel.motif, /D3/);
  assert.equal(gel.file.filter((x) => x.genre === 'opportunite').length, 0);
});

test('mêmes entrées → mêmes actions et mêmes clés ; chaque action est au contrat', () => {
  const x = cyclePur(), y = cyclePur();
  assert.deepEqual(x.d, y.d);
  for (const a of x.d) {
    assert.ok(TYPES_ACTION.includes(a.type));
    assert.match(a.id, /^A-C-2026-11-18-\d+$/);
    assert.equal(a.cle, empreinte({ type: a.type, ref: a.ref, params: a.params }));
    assert.ok(a.raison.length > 0 && [...a.raison].length <= 200);
    assert.ok(a.jugement === null || (typeof a.jugement.type === 'string' && a.jugement.statut === 'demande'));
  }
  assert.ok(types(x.d).includes('rediger_brouillon'), 'client identifiable, CGU non lues mais pas interdites : e-mail direct utilisable (D2)');
  assert.equal(x.d.find((a) => a.type === 'rediger_brouillon').params.canal, 'email_direct');
  assert.ok(types(x.d).includes('lire_cgu'), 'B08 : CGU codeur à lire');
});

test('2 propositions ouvertes → aucune rediger_brouillon, relance par la notification', () => {
  const revues = [revue('R-2026-11-16-1', 'proposition', '900001'), revue('R-2026-11-16-2', 'proposition', '900002')];
  const { d } = cyclePur({ revues });
  assert.ok(!types(d).includes('rediger_brouillon'));
  assert.ok(!types(d).some((t) => ['sonder', 'echantillonner', 'preparer_kit_canal', 'ecrire_recette'].includes(t)));
  assert.ok(d.some((a) => a.type === 'notifier' && /D3/.test(a.raison)));
});

test('annonce d’une revue passée « En cours » → invalider_revue, leçon due ; lecture de plus de 7 j aussi', () => {
  const series = [{ id: '900401', t: '2026-11-18T06:00:00.000Z', statut: 'En cours', offres: 7, tags: [] }, { id: '900402', t: '2026-11-09T06:00:00.000Z', statut: 'Ouvert', offres: 2, tags: [] }];
  const revues = [revue('R-2026-11-17-3', 'proposition', '900401'), revue('R-2026-11-17-4', 'proposition', '900402')];
  const { a, d } = cyclePur({ series, revues });
  assert.deepEqual(a.risques.filter((r) => ['annonce_fermee', 'revue_rassise'].includes(r.type)).map((r) => [r.type, r.objet]),
    [['annonce_fermee', 'R-2026-11-17-3'], ['revue_rassise', 'R-2026-11-17-4']]);
  const inv = d.filter((x) => x.type === 'invalider_revue');
  assert.deepEqual(inv.map((x) => x.ref), ['R-2026-11-17-3', 'R-2026-11-17-4']);
  assert.ok(inv.every((x) => x.params.lecon_due === true));
  assert.match(inv[0].params.motif, /En cours/);
});

test('pari envoyé depuis 7 j sans issue → demander_issue, jamais une clôture « perdu »', () => {
  const paris = [{ id: 'P-courtier-fictif-btp-2026-11-10', statut: 'envoye', envoye: true, issues: [], echeance_le: '2026-11-17T09:00:00.000Z' },
    { id: 'P-fictif-pas-echu', statut: 'envoye', envoye: true, issues: [], echeance_le: '2026-11-25T09:00:00.000Z' }];
  const { a, d } = cyclePur({ paris });
  assert.deepEqual(a.risques.filter((r) => r.type === 'pari_echu').map((r) => r.objet), ['P-courtier-fictif-btp-2026-11-10']);
  assert.deepEqual(d.filter((x) => x.type === 'demander_issue').map((x) => x.ref), ['P-courtier-fictif-btp-2026-11-10']);
  assert.ok(!types(d).includes('clore_pari_caduc'));
  assert.ok(!d.some((x) => Object.values(x.params).includes('perdu')), 'aucune action ne clôt un pari « perdu »');
});

test('CGU codeur lues interdisant le contact hors plateforme, aucun canal ouvert → preparer_kit_canal au lieu de rediger_brouillon', () => {
  const canaux = S.calculerCanaux(null, [{ canal: 'codeur', chemin: S.CHEMINS.cgu_codeur, clauses: [{ sujet: 'contact_hors_plateforme', verdict: 'interdit' }] }]);
  const { a, d } = cyclePur({ canaux });
  assert.deepEqual(a.opportunites[0].canaux_possibles, [], 'e-mail direct exclu pour un client codeur (R-23)');
  assert.ok(!types(d).includes('rediger_brouillon'));
  const kit = d.find((x) => x.type === 'preparer_kit_canal');
  assert.deepEqual([kit.ref, kit.params.canaux], ['courtier-fictif-btp', ['comeup', 'malt']]);
  assert.ok(!types(d).includes('lire_cgu'), 'CGU déjà lues');
  // Un kit déjà en revue pour ce segment n'est pas dupliqué.
  const encore = cyclePur({ canaux, revues: [revue('R-2026-11-17-5', 'kit_canal', 'courtier-fictif-btp')] });
  assert.ok(!types(encore.d).includes('preparer_kit_canal'));
});

test('encaissé nul → aucune action de dépense, même si une opportunité semblerait l’exiger', () => {
  const reg = new Registre(null, { horloge: horloge() });
  reg.ajouter({ type: 'geste', auteur: 'proprietaire', verification: 'session', preuve_empreinte: 'b'.repeat(64), sujet: 'canal', valeur: 'codeur ouvert' });
  const canaux = S.calculerCanaux(reg, [{ canal: 'codeur', chemin: S.CHEMINS.cgu_codeur, clauses: [{ sujet: 'contact_hors_plateforme', verdict: 'interdit' }] }]);
  assert.equal(canaux.codeur.statut, 'ouvert');
  const propositions = [{ type: 'notifier', ref: 'abonnement', params: { montant_eur: 31.9 } }, { type: 'rediger_brouillon', ref: '900101', params: { canal: 'codeur' } }];
  const { a, d } = cyclePur({ canaux, etat: { propositions } });
  assert.deepEqual(a.opportunites[0].canaux_possibles, ['codeur'], 'le seul canal qui atteint ce client est payant');
  assert.ok(!types(d).includes('rediger_brouillon'));
  assert.ok(types(d).includes('preparer_kit_canal'));
  assert.ok(!d.some((x) => (x.type === 'rediger_brouillon' && x.params.canal === 'codeur') || x.params.montant_eur), JSON.stringify(d));
  // Le même cas après un premier encaissement : codeur redevient utilisable (la dépense elle-même reste au Risk Agent).
  const apres = cyclePur({ canaux, encaisse_eur: 300 });
  assert.equal(apres.d.find((x) => x.type === 'rediger_brouillon')?.params.canal, 'codeur');
});

test('construire_liste refusée sans issue positive, sauf régénération estimée à 60 requêtes au plus (IT : 45)', () => {
  const base = { id: 'P-rachat-fictif-2026-11-15', statut: 'envoye', envoye: true, issues: [], echeance_le: '2026-11-30T09:00:00.000Z' };
  const liste = (params) => ({ type: 'construire_liste', ref: 'rachat-fictif', params: { recette: 'rachat-fictif', ...params } });
  const decide = (paris, propositions) => S.decider([], { monde: chargerMonde(null), canaux: S.calculerCanaux(null), paris, propositions, horloge: horloge(), recettes: {} });
  assert.ok(!types(decide([base], [liste({})])).includes('construire_liste'), 'ni issue positive ni régénération');
  const ok = decide([base], [liste({ regeneration: true, estimation_requetes: 45, pari: base.id })]).find((a) => a.type === 'construire_liste');
  assert.equal(ok.params.estimation_requetes, 45);
  assert.ok(!types(decide([base], [liste({ regeneration: true, estimation_requetes: 61, pari: base.id })])).includes('construire_liste'));
  assert.ok(!types(decide([], [liste({ regeneration: true, estimation_requetes: 45, pari: 'P-inconnu' })])).includes('construire_liste'), 'régénération sans pari existant');
  const gagne = decide([{ ...base, statut: 'gagne', issues: ['devis_demande'] }], []).find((a) => a.type === 'construire_liste');
  assert.deepEqual(gagne.params, { recette: 'rachat-fictif', pari: base.id });
});

test('preuve légère d’abord : sonder, puis echantillonner, puis rédiger ; budget SIRENE respecté', () => {
  const sans = cyclePur({ recettes: {} });
  assert.ok(types(sans.d).includes('sonder') && !types(sans.d).includes('rediger_brouillon'));
  const sonde = cyclePur({ recettes: { 'courtier-fictif-btp': { sonde: true } } });
  assert.ok(types(sonde.d).includes('echantillonner') && !types(sonde.d).includes('sonder'));
  assert.ok(types(cyclePur({ recettes: PRETES }).d).includes('rediger_brouillon'));
  const vide = cyclePur({ recettes: {}, etat: { budget_reste: { codeur: 5, sirene: 0 } } });
  assert.ok(!types(vide.d).includes('sonder'));
});

test('D0, D1, D8, D10 : constat bloquant, préalables uniques, gel après 5 cycles sans geste, une recette candidate par semaine', () => {
  const d0 = cyclePur({ etat: { constats_bloquants: [{ code: 'depense_sans_encaissement', gravite: 'bloquant' }] } }).d;
  assert.deepEqual(types(d0), ['notifier']);
  assert.match(d0[0].raison, /D0/);
  const d1 = cyclePur().d.filter((a) => a.type === 'preparer_prealable');
  assert.deepEqual(d1.map((a) => a.ref).sort(), ['canal', 'statut']);
  const deja = cyclePur({ revues: [revue('R-2026-11-17-6', 'prealable', 'statut')] }).d.filter((a) => a.type === 'preparer_prealable');
  assert.deepEqual(deja.map((a) => a.ref), ['canal'], 'une fiche par sujet, jamais dupliquée');
  const gel = cyclePur({ etat: { cycles_sans_geste: 5 } }).d;
  assert.ok(!types(gel).some((t) => ['sonder', 'echantillonner', 'rediger_brouillon', 'preparer_kit_canal', 'ecrire_recette'].includes(t)));
  const sansRecette = { annonces: [ann('900501', { titre: 'Collecte fictive de fiches de prospects' })], recettes: {} };
  assert.ok(types(cyclePur(sansRecette).d).includes('ecrire_recette'));
  const semaine = cyclePur({ ...sansRecette, recettes: { autre: { candidate_le: '2026-11-17T07:00:00.000Z' } } });
  assert.ok(!types(semaine.d).includes('ecrire_recette'));
  const rien = S.decider([], { monde: { croyances: [{ id: 'B09', niveau: 'observee' }] }, canaux: { comeup: { statut: 'ouvert', payant: false }, codeur: { cgu: 'lue_compatible' } }, horloge: horloge() });
  assert.deepEqual(types(rien), ['rien'], '« ne rien faire » est une décision consignée');
});

test('vitesse d’offres entre deux relevés réels ; plan d’observation du cycle suivant', () => {
  assert.equal(S.vitesseOffres([{ t: '2026-11-17T07:00:00.000Z', offres: 2 }, { t: '2026-11-17T17:00:00.000Z', offres: 7 }]), 0.5);
  assert.equal(S.vitesseOffres([{ t: '2026-11-17T07:00:00.000Z', offres: 2 }]), null, 'un seul relevé : pas de vitesse');
  const series = [{ id: '900101', t: '2026-11-17T07:00:00.000Z', statut: 'Ouvert', offres: 1, tags: [] }, { id: '900101', t: '2026-11-17T17:00:00.000Z', statut: 'Ouvert', offres: 3, tags: [] }];
  assert.equal(cyclePur({ series }).a.opportunites[0].vitesse_offres_h, 0.2);
  const actions = [{ type: 'suivre_annonce', ref: '900701', params: {} }, { type: 'lire_cgu', ref: 'codeur', params: { canal: 'codeur', chemin: S.CHEMINS.cgu_codeur } },
    { type: 'sonder', ref: 'courtier-fictif-btp', params: { recette: 'courtier-fictif-btp', requete: { activite_principale: '43.99C' } } }];
  const previsions = [{ id: 'p1', sujet: 'annonce:900702', emise_le: NOW, horizon_h: 24, echeance: '2026-11-19T07:00:00.000Z' },
    { id: 'p2', sujet: 'annonce:900705', emise_le: NOW, horizon_h: 300, echeance: '2026-11-30T19:00:00.000Z' }];
  const paris = [{ id: 'P-fictif-9', statut: 'envoye', annonce: 'https://www.codeur.com/projects/900703-slug-fictif' }];
  const samedi = creerHorloge('2026-11-21T07:00:00.000Z');
  const plan = S.planObservation(actions, [revue('R-x', 'proposition', '900704')], paris, previsions, samedi);
  assert.equal(plan.jour, '2026-11-22');
  assert.deepEqual(plan.suivis, [{ id: '900704', motif: 'revue' }, { id: '900703', motif: 'pari' }, { id: '900702', motif: 'prevision' }, { id: '900701', motif: 'donnees' }],
    'une prévision échue et non notée est relue ; celle dont l’échéance est lointaine attend ; ids sans slug');
  assert.deepEqual(plan.pages.map((p) => p.chemin), [S.CHEMINS.cgu_codeur, S.CHEMINS.tarifs_codeur], 'CGU d’abord ; tarifs le dimanche');
  assert.deepEqual(plan.sondes, [{ recette: 'courtier-fictif-btp', params: { activite_principale: '43.99C' } }]);
  const vendredi = S.planObservation(actions, [], [], [{ ...previsions[0], echeance: '2026-11-21T09:00:00.000Z' }], creerHorloge('2026-11-20T07:00:00.000Z'));
  assert.equal(vendredi.jour, '2026-11-21');
  assert.deepEqual(vendredi.pages.map((p) => p.chemin), [S.CHEMINS.cgu_codeur]);
  assert.ok(vendredi.suivis.some((s) => s.id === '900702' && s.motif === 'prevision'));
});
