// Tests du monde (M7) : croyances initiales, COMPRENDRE, CONFRONTER, HYPOTHÈSES, RÉVISER. Hors réseau ; toutes les
// annonces et tous les faits sont FICTIFS (aucun client, aucun nom).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NIVEAUX, FAMILLES } from '../src/contrats.js';
import { creerHorloge, creerMagasin, OPS } from '../src/socle.js';
import { Registre } from '../src/registre.js';
import * as M from '../src/monde.js';

const NATURES = ['marche', 'commerciale', 'canal', 'contrainte', 'proprietaire', 'instrument'];
const monde0 = () => M.chargerMonde(null);
const niveau = (m, id) => m.croyances.find((c) => c.id === id).niveau;
const F = (sujet, mesure, valeur, n, lu_le, extra = {}) => {
  const { suffixe = '', ...reste } = extra;
  return { id: `fait:${sujet}:${mesure}:${lu_le.slice(0, 10)}${suffixe}`, sujet, mesure, valeur, n, source: 'codeur:liste', lu_le, sain: true, ...reste };
};
// Une boucle CONFRONTER → HYPOTHÈSES → RÉVISER sur des faits donnés.
function etape(monde, faits, { iso, sante = { ok: true }, issues = [], gestes = [], citations = [], canaux = null } = {}) {
  const conf = M.confronter(faits, monde);
  const hyps = M.expliquer(conf.contradictions, { sante, faits });
  const res = M.testerHypotheses(hyps, { sante, faits });
  const hypotheses = hyps.map((h) => ({ ...h, ...res.find((r) => r.id === h.id) }));
  return { conf, hyps, hypotheses, ...M.reviser(monde, { confrontation: conf, hypotheses, issues, gestes, sante, horloge: creerHorloge(iso), citations, faits, canaux }) };
}
// Les actes renvoyés doivent être admis tels quels par le registre (champs exigés, aucune clé nominative).
const admettre = (actes) => { const r = new Registre(null, { horloge: creerHorloge('2026-11-16T12:00:00Z') }); for (const a of actes) r.ajouter(a); return r; };

test('croyances initiales : B01 à B20, niveaux et natures du contrat, tests déclaratifs, énoncés publics courts', () => {
  const C = M.CROYANCES_INITIALES;
  assert.deepEqual(C.map((c) => c.id), Array.from({ length: 20 }, (_, i) => `B${String(i + 1).padStart(2, '0')}`));
  for (const c of C) {
    assert.ok(NIVEAUX.includes(c.niveau), c.id);
    assert.ok(NATURES.includes(c.nature), c.id);
    assert.ok(c.enonce.length > 20 && [...c.enonce].length <= 400, `${c.id} : énoncé de ${c.enonce.length} caractères`);
    assert.ok(c.preuves.every((n) => Number.isInteger(n) && n > 0), c.id);
    for (const t of [c.test, c.infirmation].filter(Boolean)) assert.ok(OPS.includes(t.op) && typeof t.sujet === 'string' && Number.isInteger(t.min_n), c.id);
  }
  const b = (id) => C.find((c) => c.id === id);
  assert.equal(b('B08').etiquette, 'inconnu');
  assert.equal(b('B09').etiquette, 'inconnu');
  assert.equal(b('B02').etiquette, 'mandat');
  assert.deepEqual(b('B03').test, { sujet: 'segment:prospection', mesure: 'mediane_offres', op: '<=', seuil: 10, min_n: 5, jours_distincts: 2 });
  assert.equal(b('B01').source, 'codeur:/pages/tarifs-codeur-com');
  assert.ok(Object.isFrozen(C));
});

test('chargerMonde : sans fichier, croyances initiales ; fichier partiel complété ; niveau inconnu → lève ; sauverMonde', () => {
  const m = monde0();
  assert.equal(m.croyances.length, 20);
  assert.equal(m.maj_le, null);
  m.croyances[0].niveau = 'contestee';
  assert.equal(M.CROYANCES_INITIALES[0].niveau, 'observee', 'le monde chargé est une copie');
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'velyx-monde-'));
  fs.mkdirSync(path.join(racine, 'etat'));
  const partiel = { version: 1, maj_le: '2026-11-16T06:00:00.000Z', croyances: monde0().croyances.slice(0, 3).map((c) => ({ ...c, niveau: 'contestee' })) };
  fs.writeFileSync(path.join(racine, 'etat', 'monde.json'), JSON.stringify(partiel));
  const lu = M.chargerMonde(creerMagasin(racine));
  assert.equal(lu.croyances.length, 20);
  assert.equal(niveau(lu, 'B01'), 'contestee');
  assert.equal(niveau(lu, 'B20'), 'hypothese');
  assert.equal(lu.maj_le, partiel.maj_le);
  fs.writeFileSync(path.join(racine, 'etat', 'monde.json'), JSON.stringify({ croyances: [{ id: 'B01', niveau: 'certaine' }] }));
  assert.throws(() => M.chargerMonde(creerMagasin(racine)), /niveau inconnu/);
  const { chemin, contenu } = M.sauverMonde(lu);
  assert.equal(chemin, 'etat/monde.json');
  assert.deepEqual(JSON.parse(contenu).croyances.map((c) => c.niveau), lu.croyances.map((c) => c.niveau));
});

test('classerAnnonce : « constituer une base de 150 entreprises du BTP » → donnees ; RDV, tags de développement, faux amis', () => {
  const c = (titre, tags = [], resume = '') => M.classerAnnonce({ titre, tags, resume });
  const d = c('Constituer une base de 150 entreprises du BTP');
  assert.equal(d.famille, 'donnees');
  assert.equal(d.pertinente, true);
  assert.ok(d.motifs.includes('base'));
  assert.equal(c('Collecte et enrichissement de fiches', ['Data entry']).famille, 'donnees');
  assert.equal(c('Prise de RDV physiques pour un cabinet fictif', ['Télémarketing']).famille, 'rdv_appels');
  assert.equal(c('Campagne d’appels sortants', []).famille, 'rdv_appels');
  assert.equal(c('Application de réservation fictive', ['Application mobile']).famille, 'dev');
  assert.equal(c('Liste de courses connectée', ['Développement spécifique']).famille, 'dev', 'un tag de développement sans tag de prospection l’emporte');
  const faux = c('Community manager (basé en France), poste en télétravail', ['Community management']);
  assert.equal(faux.famille, 'autre', '« basé » et « télétravail » ne sont ni une base ni des appels');
  assert.equal(faux.pertinente, false);
  for (const x of [d, faux]) assert.ok(FAMILLES.includes(x.famille));
});

test('parseur en panne (sante.ok = false) : aucun fait agrégé ; la contradiction ne donne que artefact_mesure, sans révision', () => {
  const obs = { lu_le: '2026-11-16T07:00:00.000Z', jour: '2026-11-16', sante: { ok: false, n: 0, rss_n: 12 },
    annonces: [{ id: '900001', statut: 'Ouvert', offres: 3, tags: ['Prospection commerciale'], titre: 'Liste fictive', age_h: 5 }], suivis: [], pages: [], sondes: [] };
  const m = monde0();
  const { faits, actes, annonces } = M.comprendre(obs, { monde: m });
  assert.deepEqual(faits.map((f) => f.sujet), ['parseur:codeur'], 'seule la santé du parseur est un fait');
  assert.equal(faits[0].valeur, 0);
  assert.equal(annonces[0].famille, 'donnees');
  assert.ok(actes.some((a) => a.type === 'aveu' && /pas un marché vide/.test(a.motif)));
  const conf = M.confronter(faits, m);
  assert.deepEqual(conf.contradictions.map((c) => c.croyance), ['B14']);
  const hyps = M.expliquer(conf.contradictions, { sante: obs.sante, faits });
  assert.deepEqual(hyps.map((h) => h.type), ['artefact_mesure']);
  assert.deepEqual(M.testerHypotheses(hyps, { sante: obs.sante, faits }).map((r) => r.resultat), ['confirmee']);
  const r = M.reviser(m, { confrontation: conf, hypotheses: hyps.map((h) => ({ ...h, resultat: 'confirmee' })), sante: obs.sante, horloge: creerHorloge(obs.lu_le) });
  assert.deepEqual(r.revisions, []);
  assert.deepEqual(r.monde.croyances.map((c) => c.niveau), m.croyances.map((c) => c.niveau));
  assert.ok(r.actes.every((a) => a.type === 'aveu'));
  admettre([...actes, ...conf.actes, ...M.actesHypotheses(hyps), ...r.actes]);
});

test('comprendre (parseur sain) : demande ciblée 14 j, médianes par tag avec n, parts devis_2h, transitions, fermetures', () => {
  const lu_le = '2026-11-16T07:00:00.000Z';
  const A = (id, statut, offres, tags, age_h, extra = {}) => ({ id, statut, offres, tags, age_h, titre: `Annonce fictive ${id}`, resume: '', ...extra });
  const obs = { lu_le, jour: '2026-11-16', sante: { ok: true, n: 5, rss_n: 30 }, pages: [], sondes: [{ recette: 'r-fictive', total: 812 }],
    annonces: [A('900001', 'Ouvert', 3, ['Prospection commerciale'], 10), A('900002', 'Ouvert', 7, ['Télémarketing'], 30),
      A('900003', 'Fermé', 5, ['Prospection commerciale', 'Data entry'], 400), A('900004', 'Ouvert', 120, ['Développement spécifique'], 2),
      A('900005', 'Ouvert', 1, [], 20, { titre: 'Constituer une liste de prospects fictive' })],
    suivis: [{ id: '900001', statut: 'Ouvert', offres: 4, devis_2h: { n: 3, heures: 2 } }] };
  const series = [
    { id: '900003', t: '2026-11-08T07:00:00.000Z', statut: 'Ouvert', offres: 2, tags: [], publie_le: '2026-10-31T07:00:00.000Z' },
    { id: '900003', t: '2026-11-15T07:00:00.000Z', statut: 'Ouvert', offres: 5, tags: [], publie_le: '2026-10-31T07:00:00.000Z' },
    { id: '900002', t: '2026-11-15T07:00:00.000Z', statut: 'Ouvert', offres: 6, tags: [], publie_le: null, detail: true, devis_2h_n: 6 },
  ];
  const { faits, actes } = M.comprendre(obs, { monde: monde0(), series });
  const f = (s, m) => faits.find((x) => x.sujet === s && x.mesure === m);
  assert.deepEqual([f('demande_cible_14j', 'annonces').valeur, f('demande_cible_14j', 'mediane_offres').valeur], [3, 3], '900001, 900002, 900005 (famille données) ; 900003 a plus de 14 j');
  assert.deepEqual([f('segment:prospection', 'mediane_offres').valeur, f('segment:prospection', 'mediane_offres').n], [5, 3]);
  assert.deepEqual([f('tag:Développement spécifique', 'mediane_offres').valeur, f('tag:Développement spécifique', 'mediane_offres').n], [120, 1]);
  assert.equal(f('suivi:900001', 'part_devis_2h').valeur, 0.75);
  assert.deepEqual([f('suivis', 'mediane_part_devis_2h').valeur, f('suivis', 'mediane_part_devis_2h').n], [0.875, 2], 'cumul : 0,75 et 1');
  assert.equal(f('statuts', 'transition:Ouvert>Fermé').valeur, 1);
  assert.deepEqual([f('fermetures', 'mediane_ouverture_min_h').valeur, f('fermetures', 'mediane_ouverture_min_h').n], [360, 1], 'ouverte au moins jusqu’au relevé du 15/11');
  assert.equal(f('sirene:sondes', 'total_max').valeur, 812);
  assert.ok(faits.every((x) => x.id === `fait:${x.sujet}:${x.mesure}:2026-11-16` && x.lu_le === lu_le));
  const cles = actes.map((a) => `${a.sujet}|${a.mesure}`);
  assert.ok(cles.includes('segment:prospection|mediane_offres') && cles.includes('parseur:codeur|sain') && cles.includes('suivis|mediane_part_devis_2h'));
  assert.ok(!cles.includes('tag:Développement spécifique|mediane_offres'), 'un fait qu’aucune croyance ne teste reste hors du registre');
  admettre(actes);
});

test('B03 (médiane ≤ 10, min_n 5) : médiane 5 avec n = 15 → confirmation ; n = 2 → null, ni confirmation ni contradiction', () => {
  const m = monde0(), B03 = m.croyances.find((c) => c.id === 'B03');
  const grand = F('segment:prospection', 'mediane_offres', 5, 15, '2026-11-16T07:00:00.000Z');
  const petit = { ...grand, n: 2 };
  assert.equal(M.evaluerPredicat(B03.test, grand), true);
  assert.equal(M.evaluerPredicat(B03.test, petit), null);
  assert.equal(M.evaluerPredicat(B03.test, { ...grand, sain: false }), null);
  assert.equal(M.evaluerPredicat(B03.test, { ...grand, valeur: null }), null);
  assert.throws(() => M.evaluerPredicat({ ...B03.test, op: '≈' }, petit), /opérateur inconnu/, 'un opérateur inconnu lève même sur un petit échantillon');
  const c1 = M.confronter([grand], m);
  assert.deepEqual(c1.confirmations.map((c) => c.croyance), ['B03']);
  assert.equal(c1.contradictions.length, 0);
  const c2 = M.confronter([petit], m);
  assert.equal(c2.confirmations.length + c2.contradictions.length, 0);
  assert.ok(c2.non_testees.includes('B03'));
  assert.deepEqual(M.confronter([F('tag:Traduction', 'mediane_offres', 2, 1, '2026-11-16T07:00:00.000Z')], m).hors_modele.map((x) => x.sujet), ['tag:Traduction']);
});

test('2 confirmations le même jour → reste hypothese ; sur 2 jours distincts → observee ; parseur non déclaré sain → rien', () => {
  const j1 = '2026-11-16T07:00:00.000Z', j2 = '2026-11-17T07:00:00.000Z';
  const memeJour = [F('segment:prospection', 'mediane_offres', 5, 15, j1, { ligne: 30 }), F('segment:prospection', 'mediane_offres', 6, 14, j1, { suffixe: ':bis', ligne: 31 })];
  const r1 = etape(monde0(), memeJour, { iso: j1 });
  assert.equal(r1.conf.confirmations.length, 2);
  assert.equal(niveau(r1.monde, 'B03'), 'hypothese');
  assert.deepEqual(r1.revisions, []);
  const r2 = etape(r1.monde, [F('segment:prospection', 'mediane_offres', 4, 16, j2, { ligne: 40 })], { iso: j2 });
  assert.equal(niveau(r2.monde, 'B03'), 'observee');
  assert.deepEqual(r2.revisions.map((r) => [r.croyance, r.de, r.vers]), [['B03', 'hypothese', 'observee']]);
  assert.deepEqual(r2.revisions[0].preuves, [30, 31, 40]);
  const sansSante = etape(monde0(), [F('segment:prospection', 'mediane_offres', 5, 15, j1), F('segment:prospection', 'mediane_offres', 5, 15, j2)], { iso: j2, sante: null });
  assert.equal(niveau(sansSante.monde, 'B03'), 'hypothese', 'parseur sain exigé pour monter');
  // Une contradiction ouverte (même jour, autre fait) empêche aussi la montée.
  const ouverte = etape(monde0(), [F('segment:prospection', 'mediane_offres', 5, 15, j1), F('segment:prospection', 'mediane_offres', 5, 15, j2),
    F('segment:prospection', 'mediane_offres', 12, 15, j2, { suffixe: ':ter' })], { iso: j2 });
  assert.equal(niveau(ouverte.monde, 'B03'), 'hypothese');
});

test('B06 → pari_gagne : issue « question » → refus ; « devis_demande » → accepté ; B05 n’est gagnée que par une commande', () => {
  const iso = '2026-11-20T09:00:00.000Z';
  const q = etape(monde0(), [], { iso, issues: [{ pari: 'P-fictif-1', issue: 'question', croyances: ['B06'], ligne: 50 }] });
  assert.equal(niveau(q.monde, 'B06'), 'hypothese');
  assert.deepEqual(q.revisions, []);
  assert.throws(() => M.appliquerRevision(monde0(), { croyance: 'B06', de: 'hypothese', vers: 'pari_gagne', issue: 'question', preuves: [50] }), /R-29/);
  const d = etape(monde0(), [], { iso, issues: [{ pari: 'P-fictif-1', issue: 'devis_demande', croyances: ['B06'], ligne: 51 }] });
  assert.equal(niveau(d.monde, 'B06'), 'pari_gagne');
  assert.deepEqual(d.revisions[0].preuves, [51]);
  assert.equal(d.actes[0].issue, 'devis_demande');
  assert.throws(() => M.appliquerRevision(monde0(), { croyance: 'B03', de: 'hypothese', vers: 'pari_gagne', issue: 'commande' }), /commerciales/);
  const b5 = etape(monde0(), [], { iso, issues: [{ pari: 'P-fictif-2', issue: 'devis_demande', croyances: ['B05'] }] });
  assert.equal(niveau(b5.monde, 'B05'), 'dite_par_client');
  const b5c = etape(monde0(), [], { iso, issues: [{ pari: 'P-fictif-2', issue: 'commande', croyances: ['B05'], ligne: 52 }] });
  assert.equal(niveau(b5c.monde, 'B05'), 'pari_gagne');
  // 0 issue positive sur 5 paris → réfutée ; sur 4 → inchangée.
  const issues = ['sans_reponse', 'refus', 'question', 'sans_reponse', 'refus'].map((issue, i) => ({ pari: `P-fictif-${10 + i}`, issue, croyances: ['B06'], ligne: 60 + i }));
  assert.equal(niveau(etape(monde0(), [], { iso, issues: issues.slice(0, 4) }).monde, 'B06'), 'hypothese');
  const ref = etape(monde0(), [], { iso, issues });
  assert.equal(niveau(ref.monde, 'B06'), 'refutee');
  assert.deepEqual(ref.revisions[0].preuves, [60, 61, 62, 63, 64]);
});

test('2 contradictions consécutives sans artefact → contestee ; une seule → inchangée ; expliquées par l’instrument → neutres', () => {
  const j1 = '2026-11-16T07:00:00.000Z', j2 = '2026-11-17T07:00:00.000Z';
  const r1 = etape(monde0(), [F('segment:prospection', 'mediane_offres', 12, 15, j1, { ligne: 70 })], { iso: j1 });
  assert.equal(r1.conf.contradictions.length, 1);
  assert.deepEqual(r1.hyps.map((h) => h.type), ['artefact_mesure', 'changement_definition', 'changement_monde'], 'l’instrument avant le monde');
  assert.equal(niveau(r1.monde, 'B03'), 'hypothese');
  const r2 = etape(r1.monde, [F('segment:prospection', 'mediane_offres', 13, 15, j2, { ligne: 71 })], { iso: j2 });
  assert.equal(niveau(r2.monde, 'B03'), 'contestee');
  assert.deepEqual(r2.revisions[0].preuves, [70, 71]);
  // Petit échantillon (n = 6 < 2 × min_n) : l'hypothèse instrumentale est confirmée, les contradictions ne comptent pas.
  const p1 = etape(monde0(), [F('segment:prospection', 'mediane_offres', 12, 6, j1)], { iso: j1 });
  assert.ok(p1.hypotheses.some((h) => h.type === 'petit_echantillon' && h.resultat === 'confirmee'));
  const p2 = etape(p1.monde, [F('segment:prospection', 'mediane_offres', 13, 6, j2)], { iso: j2 });
  assert.equal(niveau(p2.monde, 'B03'), 'hypothese');
  // Critère d'infirmation (> 15 deux lectures de suite) : réfutée.
  const i1 = etape(monde0(), [F('segment:prospection', 'mediane_offres', 20, 15, j1)], { iso: j1 });
  assert.equal(niveau(i1.monde, 'B03'), 'hypothese');
  const i2 = etape(i1.monde, [F('segment:prospection', 'mediane_offres', 22, 15, j2)], { iso: j2 });
  assert.equal(niveau(i2.monde, 'B03'), 'refutee');
  // Rejouer la même confrontation ne compte rien deux fois.
  const rejeu = M.reviser(r1.monde, { confrontation: r1.conf, hypotheses: r1.hypotheses, sante: { ok: true }, horloge: creerHorloge(j1) });
  assert.equal(rejeu.monde.croyances.find((c) => c.id === 'B03').trace.consecutives, 1);
  assert.deepEqual(rejeu.revisions, []);
});

test('B01 (contrainte) : une contradiction issue d’une autre lecture que la page tarifs ne la change pas ; lue à la source → contestee', () => {
  const j1 = '2026-11-22T07:00:00.000Z', j2 = '2026-11-29T07:00:00.000Z';
  const autre = (iso) => F('page:tarifs-codeur-com', 'identique', 0, 1, iso, { source: 'llm:jugement' });
  const a1 = etape(monde0(), [autre(j1)], { iso: j1 });
  assert.equal(a1.conf.contradictions[0].source_lue, false);
  const a2 = etape(a1.monde, [autre(j2)], { iso: j2 });
  assert.equal(niveau(a2.monde, 'B01'), 'observee');
  assert.throws(() => M.appliquerRevision(monde0(), { croyance: 'B01', de: 'observee', vers: 'contestee' }), /contrainte/);
  // Lecture réelle de la page : la première pose la référence, la suivante compare.
  const page = (iso, sha) => ({ lu_le: iso, sante: { ok: true, n: 3, rss_n: 3 }, annonces: [], suivis: [], sondes: [], pages: [{ canal: 'codeur', chemin: '/pages/tarifs-codeur-com', sha256: sha }] });
  const c1 = M.comprendre(page(j1, 'a'.repeat(64)), { monde: monde0() });
  const f1 = c1.faits.find((f) => f.sujet === 'page:tarifs-codeur-com');
  assert.deepEqual([f1.valeur, f1.n], [null, 0], 'sans référence : inconnu');
  const r1 = etape(monde0(), c1.faits, { iso: j1 });
  assert.equal(r1.monde.references['/pages/tarifs-codeur-com'].sha256, 'a'.repeat(64));
  const c2 = M.comprendre(page(j2, 'b'.repeat(64)), { monde: r1.monde });
  const r2 = etape(r1.monde, c2.faits.map((f) => ({ ...f, ligne: 90 })), { iso: j2 });
  assert.equal(r2.conf.contradictions.find((c) => c.croyance === 'B01').source_lue, true);
  assert.equal(niveau(r2.monde, 'B01'), 'contestee');
  assert.equal(r2.monde.references['/pages/tarifs-codeur-com'].sha256, 'a'.repeat(64), 'la référence ne suit pas une page changée');
  assert.deepEqual(r2.revisions.find((r) => r.croyance === 'B01').preuves, [90]);
});

test('B08 : CGU lues qui interdisent le contact hors plateforme → réfutée ; qui l’autorisent → observée ; B09 et B07 par geste', () => {
  const iso = '2026-11-16T08:00:00.000Z', lu = { chemin: '/pages/termes-et-conditions-d-utilisation', lu_le: iso };
  const interdit = M.faitsCgu({ canal: 'codeur', clauses: [{ citation: 'clause fictive', sujet: 'contact_hors_plateforme', verdict: 'interdit' }] }, lu);
  assert.equal(interdit[0].source, 'codeur:/pages/termes-et-conditions-d-utilisation');
  assert.equal(niveau(etape(monde0(), interdit, { iso }).monde, 'B08'), 'refutee');
  const permis = M.faitsCgu({ canal: 'codeur', clauses: [{ citation: 'clause fictive', sujet: 'contact_hors_plateforme', verdict: 'autorise' },
    { citation: 'autre clause fictive', sujet: 'lecture_automatisee', verdict: 'ambigu' }] }, lu);
  assert.deepEqual(permis.map((f) => [f.mesure, f.valeur]), [['contact_hors_plateforme', 'autorise'], ['lecture_automatisee', 'ambigu']]);
  assert.equal(niveau(etape(monde0(), permis, { iso }).monde, 'B08'), 'observee');
  const geste = { n: 41, type: 'geste', auteur: 'proprietaire', sujet: 'statut', valeur: 'micro', verification: 'session' };
  const s = etape(monde0(), [], { iso, gestes: [geste] });
  assert.equal(niveau(s.monde, 'B09'), 'observee');
  assert.deepEqual([s.revisions[0].par, s.revisions[0].preuves], ['proprietaire', [41]]);
  const canal = { n: 42, type: 'geste', auteur: 'proprietaire', sujet: 'canal', valeur: 'comeup ouvert', verification: 'session' };
  assert.equal(niveau(etape(monde0(), [], { iso, gestes: [canal] }).monde, 'B07'), 'hypothese', 'CGU du canal non lues');
  const ok = etape(monde0(), [], { iso, gestes: [canal], canaux: { comeup: { cgu: 'lue_compatible', preuves: [43] } } });
  assert.equal(niveau(ok.monde, 'B07'), 'observee');
  assert.deepEqual(ok.revisions[0].preuves, [42, 43]);
  assert.throws(() => M.appliquerRevision(monde0(), { croyance: 'B06', de: 'hypothese', vers: 'observee', par: 'proprietaire' }), /commerciale/);
});

test('chaque révision renvoie un acte revision qui porte les numéros de preuve ; tous les actes sont admis par le registre', () => {
  const j1 = '2026-11-16T07:00:00.000Z', j2 = '2026-11-17T07:00:00.000Z';
  const r1 = etape(monde0(), [F('segment:prospection', 'mediane_offres', 12, 15, j1, { ligne: 80 })], { iso: j1 });
  const r2 = etape(r1.monde, [F('segment:prospection', 'mediane_offres', 14, 15, j2, { ligne: 81 })], { iso: j2,
    issues: [{ pari: 'P-fictif-3', issue: 'echange', croyances: ['B06'], ligne: 82 }] });
  assert.equal(r2.revisions.length, 2);
  const revs = r2.actes.filter((a) => a.type === 'revision');
  assert.equal(revs.length, r2.revisions.length);
  for (const a of revs) {
    assert.ok(a.preuves.length > 0 && a.preuves.every(Number.isInteger), JSON.stringify(a));
    assert.match(a.cle, /^revision:B0\d:2026-11-17:/);
  }
  assert.deepEqual(revs.map((a) => [a.croyance, a.vers, a.preuves]), [['B03', 'contestee', [80, 81]], ['B06', 'pari_gagne', [82]]]);
  const reg = admettre([...r1.conf.actes, ...M.actesHypotheses(r1.hyps), ...r2.conf.actes, ...r2.actes]);
  assert.equal(reg.de('revision').length, 2);
  assert.ok(M.appliquerRevision(r2.monde, { croyance: 'B03', de: 'contestee', vers: 'hypothese', preuves: [83] }).croyances.find((c) => c.id === 'B03').preuves.includes(83));
});

test('appliquerRevision lève sur une transition illégale ; dite_par_client par citations, sans recopier la citation', () => {
  const m = monde0();
  assert.throws(() => M.appliquerRevision(m, { croyance: 'B99', de: 'hypothese', vers: 'observee' }), /inconnue/);
  assert.throws(() => M.appliquerRevision(m, { croyance: 'B03', de: 'observee', vers: 'contestee' }), /pas « observee »/);
  assert.throws(() => M.appliquerRevision(m, { croyance: 'B03', de: 'hypothese', vers: 'certaine' }), /niveau inconnu/);
  const ref = M.appliquerRevision(m, { croyance: 'B03', de: 'hypothese', vers: 'refutee', preuves: [1] });
  assert.throws(() => M.appliquerRevision(ref, { croyance: 'B03', de: 'refutee', vers: 'observee' }), /illégale/);
  const iso = '2026-11-18T08:00:00.000Z';
  const citations = [['900010', 'citation fictive une'], ['900010', 'citation fictive deux'], ['900011', 'citation fictive trois']]
    .map(([annonce_id, citation], i) => ({ croyance: 'B20', annonce_id, citation, ligne: 100 + i }));
  const r = etape(m, [], { iso, citations: citations.slice(0, 2) });
  assert.equal(niveau(r.monde, 'B20'), 'hypothese', '2 citations dans 1 annonce ne suffisent pas');
  const r2 = etape(r.monde, [], { iso, citations });
  assert.equal(niveau(r2.monde, 'B20'), 'dite_par_client');
  assert.deepEqual(r2.revisions[0].preuves, [100, 101, 102]);
  assert.ok(!M.sauverMonde(r2.monde).contenu.includes('citation fictive'), 'seule l’empreinte d’une citation est publique');
});

test('accepterHypotheseLLM : test chiffré, coût ≤ 20 requêtes et échéance ≤ 14 j obligatoires ; action d’observation seulement', () => {
  const ok = { contradiction: 'X-B03-2026-11-17', type: 'petit_echantillon', pourquoi: 'Deux lectures seulement.', test: { action: 'suivre_annonce', cout_requetes: 2 }, echeance_jours: 7 };
  assert.deepEqual(M.accepterHypotheseLLM(ok), { ok: true, erreurs: [] });
  for (const [mal, motif] of [[{ ...ok, echeance_jours: 15 }, /maximum/], [{ ...ok, test: { action: 'sonder', cout_requetes: 21 } }, /maximum/],
    [{ ...ok, test: { action: 'rediger_brouillon', cout_requetes: 1 } }, /hors de la liste/], [{ ...ok, test: undefined }, /requis/],
    [{ ...ok, type: 'intuition' }, /hors de la liste/], [{ ...ok, cause: 'x' }, /clé inconnue/], [{ ...ok, pourquoi: 'voir https://exemple.org' }, /URL/],
    [{ ...ok, test: { action: 'rien' } }, /requis/]]) {
    const r = M.accepterHypotheseLLM(mal);
    assert.equal(r.ok, false, JSON.stringify(mal));
    assert.match(r.erreurs.join(' ; '), motif);
  }
});
