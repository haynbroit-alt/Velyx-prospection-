// Tests du Risk Agent (M9) : table fermée sur politique.json, mandat 0 €, file de revue humaine, validation liée à
// l'empreinte, gestes du propriétaire. Hors réseau ; registres et racines temporaires ; aucune donnée réelle.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Registre } from '../src/registre.js';
import { TYPES_ACTION, TYPES_REVUE } from '../src/contrats.js';
import { creerHorloge, creerBudget, creerMagasin, empreinte, sha256Texte, verifierUrl, HoteInterdit, CheminInterdit } from '../src/socle.js';
import { verifierObjetPublic } from '../src/garde.js';
import {
  POLITIQUE, REGLES_AILLEURS, ACTIONS_SENSIBLES, DOSSIER_REVUES, JOURNAL_GESTES, chargerPolitique, evaluer, verdictTable, verdictPolitique,
  plusRestrictif, empreintePolitique, verdictApresValidation, mettreEnRevue, fileOuverte, revuesDe, estValidee, expirer, etatRevuePublic,
  rendreRevue, extraireTexte, appliquerGeste, GRAMMAIRE_GESTES, contexte, cyclesSansGeste,
} from '../src/risque.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POLITIQUE_REELLE = JSON.parse(fs.readFileSync(path.join(RACINE, 'politique.json'), 'utf8'));
/** Empreinte scellée de la table : toute modification de POLITIQUE (ou de ses conditions) casse ce test et passe par une PR. */
const EMPREINTE_SCELLEE = '19b532627bd08b0d';

const dossier = () => fs.mkdtempSync(path.join(os.tmpdir(), 'velyx-risque-'));
const H0 = '2026-11-16T09:00:00Z';
const horloge = (iso = H0) => creerHorloge(iso);
const budget = (h) => creerBudget(undefined, h);
const budgetVide = (h) => creerBudget({ codeur: 0, sirene: 0, duree_s: 600, jugements: 5, nouvelles_opportunites: 1, passages_jour: 3 }, h);
const PREUVE = sha256Texte('phrase fictive du propriétaire');
const PROPRIO = { auteur: 'proprietaire', verification: 'session', preuve_empreinte: PREUVE };
/** Contexte « normal » : politique réelle, encaissé nul, oppositions disponibles, budget plein. */
const ctx = (etat = {}, extra = {}) => ({ politique: POLITIQUE_REELLE, etat: { encaisse_eur: 0, revues_ouvertes_n: 0, cycles_sans_geste: 0, oppositions_dispo: true, ...etat },
  budget: budget(horloge()), ...extra });
const action = (type, params = {}, ref = null) => ({ id: 'A-test-1', type, ref, params, raison: 'test', cle: empreinte({ type, ref, params }), jugement: null });
const pari = (id, extra = {}) => ({ type: 'pari', id, hypothese: 'h', geste_proprietaire: 'g', critere_succes: 's', critere_arret: 'a', echeance: 'envoi + 7 jours', ...extra });
/** Racine temporaire : registre en mémoire, magasin sur disque, horloge factice. */
function banc(iso = H0) {
  const r = dossier(), h = horloge(iso);
  return { racine: r, h, registre: new Registre(null, { horloge: h }), magasin: creerMagasin(r) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Table : une ligne de test par règle.

/** [action, contexte, verdict attendu, règle attendue]. Chaque ligne de POLITIQUE doit être atteinte par au moins un cas. */
const CAS = [
  ['depense', action('depense', { montant_eur: 31.9 }), ctx(), 'interdit', 'R-18'],
  ['depense montant illisible', action('depense', { montant_eur: -3 }), ctx({ encaisse_eur: 200 }), 'interdit', 'R-19'],
  ['depense après encaissement, plafond relevé', action('depense', { montant_eur: 31.9 }),
    ctx({ encaisse_eur: 200 }, { politique: { ...POLITIQUE_REELLE, depense: { ...POLITIQUE_REELLE.depense, plafond_eur: 100 } } }), 'revue_humaine', 'R-19'],
  ['envoi client codeur, CGU non lues', action('envoi', { client_codeur: true }), ctx(), 'interdit', 'R-23'],
  ['envoi', action('envoi', { canal: 'email' }), ctx(), 'revue_humaine', 'R-20'],
  ['contact client codeur', action('contact', { client_codeur: true }), ctx({ cgu_codeur: 'lue_interdite' }), 'interdit', 'R-23'],
  ['contact', action('contact'), ctx(), 'revue_humaine', 'R-20'],
  ['prix', action('prix'), ctx(), 'revue_humaine', 'R-22'],
  ['inscription', action('inscription', { canal: 'comeup' }), ctx(), 'revue_humaine', 'R-24'],
  ['publication non vérifiée', action('publication'), ctx(), 'interdit', 'R-25'],
  ['publication', action('publication', { site_ok: true }), ctx(), 'revue_humaine', 'R-25'],
  ['publier_site non vérifié', action('publier_site', { site_ok: false }), ctx(), 'interdit', 'R-25'],
  ['publier_site', action('publier_site', { site_ok: true }), ctx(), 'revue_humaine', 'R-25'],
  ['preparer_site hors prive/site', action('preparer_site', { chemin: 'site/index.html' }), ctx(), 'interdit', 'R-25'],
  ['preparer_site', action('preparer_site', { chemin: 'prive/site/index.html' }), ctx(), 'autorise', 'R-25'],
  ['gmail sans validation', action('creer_brouillon_gmail'), ctx(), 'interdit', 'R-26'],
  ['gmail après validation', action('creer_brouillon_gmail', { revue_validee: true }), ctx(), 'revue_humaine', 'R-26'],
  ['notification trop longue', action('notifier', { texte: 'x'.repeat(301) }), ctx(), 'interdit', 'R-38'],
  ['notifier', action('notifier', { texte: 'Deux gestes attendus.' }), ctx(), 'autorise', 'R-38'],
  ['suivre_annonce sans budget', action('suivre_annonce'), ctx({}, { budget: budgetVide(horloge()) }), 'interdit', 'R-06'],
  ['suivre_annonce', action('suivre_annonce'), ctx(), 'autorise', 'R-02'],
  ['lire_cgu sans budget', action('lire_cgu'), ctx({}, { budget: null }), 'interdit', 'R-06'],
  ['lire_cgu', action('lire_cgu'), ctx(), 'autorise', 'R-02'],
  ['sonder sans budget', action('sonder'), ctx({}, { budget: budgetVide(horloge()) }), 'interdit', 'R-06'],
  ['sonder', action('sonder'), ctx(), 'autorise', 'R-03'],
  ['echantillonner sans oppositions', action('echantillonner'), ctx({ oppositions_dispo: false }), 'interdit', 'R-14'],
  ['echantillonner gelé', action('echantillonner'), ctx({ cycles_sans_geste: 5 }), 'interdit', 'R-21'],
  ['echantillonner sans budget', action('echantillonner'), ctx({}, { budget: budgetVide(horloge()) }), 'interdit', 'R-06'],
  ['echantillonner', action('echantillonner'), ctx(), 'autorise', 'R-03'],
  ['construire_liste sans oppositions', action('construire_liste', { pari: 'P-x', estimation_requetes: 45 }), ctx({ oppositions_dispo: undefined }), 'interdit', 'R-14'],
  ['construire_liste gelé', action('construire_liste', { pari: 'P-x', estimation_requetes: 45 }), ctx({ cycles_sans_geste: 6 }), 'interdit', 'R-21'],
  ['construire_liste avant issue positive', action('construire_liste', { segment: 'btp' }), ctx(), 'interdit', 'R-31'],
  ['construire_liste régénération trop chère', action('construire_liste', { pari: 'P-x', estimation_requetes: 61 }), ctx(), 'interdit', 'R-31'],
  ['construire_liste sans budget', action('construire_liste', { segment: 'btp' }), ctx({ segments_gagnes: ['btp'] }, { budget: budgetVide(horloge()) }), 'interdit', 'R-06'],
  ['construire_liste segment gagné', action('construire_liste', { segment: 'btp' }), ctx({ segments_gagnes: new Set(['btp']) }), 'autorise', 'R-03'],
  ['construire_liste régénération', action('construire_liste', { pari: 'P-x', estimation_requetes: 45 }), ctx(), 'autorise', 'R-03'],
  ['ecrire_recette', action('ecrire_recette'), ctx(), 'autorise', 'R-42'],
  ['brouillon avec prix', action('rediger_brouillon', { prix: 199 }), ctx(), 'interdit', 'R-22'],
  ['brouillon gelé', action('rediger_brouillon'), ctx({ cycles_sans_geste: 5 }), 'interdit', 'R-21'],
  ['brouillon : deux propositions ouvertes', action('rediger_brouillon'), ctx({ revues_ouvertes_n: 2 }), 'interdit', 'R-21'],
  ['rediger_brouillon', action('rediger_brouillon'), ctx(), 'autorise', 'R-09'],
  ['régénérer avec remise', action('regenerer_brouillon', { remise: 0.1 }), ctx(), 'interdit', 'R-22'],
  ['regenerer_brouillon', action('regenerer_brouillon'), ctx({ revues_ouvertes_n: 2 }), 'autorise', 'R-09'],
  ['preparer_prealable', action('preparer_prealable'), ctx(), 'autorise', 'R-24'],
  ['preparer_kit_canal', action('preparer_kit_canal'), ctx(), 'autorise', 'R-24'],
  ['invalider_revue', action('invalider_revue'), ctx(), 'autorise', 'R-28'],
  ['clore_pari_caduc', action('clore_pari_caduc'), ctx(), 'autorise', 'R-28'],
  ['demander_issue', action('demander_issue'), ctx(), 'autorise', 'R-28'],
  ['purger_opposition', action('purger_opposition'), ctx(), 'autorise', 'R-13'],
  ['ecrire_lecon', action('ecrire_lecon'), ctx(), 'autorise', 'R-42'],
  ['adopter_regle sans pari gagné', action('adopter_regle', { backtest: { exclues: 3 } }), ctx(), 'interdit', 'R-29'],
  ['adopter_regle', action('adopter_regle', { pari_gagne: true, backtest: { exclues: 3 } }), ctx(), 'autorise', 'R-42'],
  ['réviser pendant une panne', action('reviser_croyance', { vers: 'observee' }), ctx({ parseur_sain: false }), 'interdit', 'R-29'],
  ['pari_gagne sur une question', action('reviser_croyance', { vers: 'pari_gagne', issue: 'question' }), ctx(), 'interdit', 'R-29'],
  ['reviser_croyance', action('reviser_croyance', { vers: 'pari_gagne', issue: 'commande' }), ctx(), 'autorise', 'R-29'],
  ['sauver_memoire', action('sauver_memoire'), ctx(), 'autorise', 'R-09'],
  ['rien', action('rien'), ctx(), 'autorise', 'R-09'],
];

test('table : une ligne de test par règle, et chaque ligne de POLITIQUE est atteinte', () => {
  const atteintes = new Set();
  for (const [nom, a, c, verdict, regle] of CAS) {
    const v = evaluer(a, c);
    assert.equal(v.verdict, verdict, `${nom} : ${JSON.stringify(v)}`);
    assert.equal(v.regle, regle, `${nom} : ${JSON.stringify(v)}`);
    const t = verdictTable(a, c);
    atteintes.add(`${a.type}|${t.regle}|${t.verdict}|${t.motif}`);
  }
  for (const r of POLITIQUE) assert.ok(atteintes.has(`${r.action}|${r.regle}|${r.verdict}|${r.motif}`), `ligne non testée : ${r.regle} ${r.action} ${r.verdict}`);
});

test('R-00 à R-44 : chaque règle est une ligne de la table ou est appliquée ailleurs (module nommé, ou reporté)', () => {
  const table = new Set(POLITIQUE.map((r) => r.regle));
  for (let i = 0; i <= 44; i++) {
    const r = `R-${String(i).padStart(2, '0')}`;
    assert.ok(table.has(r) || typeof REGLES_AILLEURS[r] === 'string', `${r} n’est appliquée nulle part`);
  }
  // R-04 : la porte réseau refuse tout autre hôte et toute requête codeur autre que ?page= (robots.txt), avant l'appel.
  assert.throws(() => verifierUrl('https://exemple.invalid/'), HoteInterdit);
  assert.throws(() => verifierUrl('http://www.codeur.com/projects'), HoteInterdit);
  assert.throws(() => verifierUrl('https://www.codeur.com/projects?q=btp'), CheminInterdit);
  // R-44 : aucune dépendance.
  const pkg = JSON.parse(fs.readFileSync(path.join(RACINE, 'package.json'), 'utf8'));
  assert.equal(Object.keys(pkg.dependencies ?? {}).length + Object.keys(pkg.devDependencies ?? {}).length, 0);
});

test('cadrage : envoi, publication, prix, inscription et contact vont en revue humaine ; jamais exécutés par l’agent', () => {
  for (const [type, params] of [['envoi', {}], ['publication', { site_ok: true }], ['publier_site', { site_ok: true }], ['prix', {}], ['inscription', {}], ['contact', {}]]) {
    assert.equal(evaluer(action(type, params), ctx({ encaisse_eur: 500 })).verdict, 'revue_humaine', type);
  }
});

test('action inconnue → revue_humaine (R-00) ; dépense de 31,90 € avec un encaissé nul → interdit (R-18)', () => {
  for (const a of [action('acheter_fichier'), action('copier_drive'), { type: 42 }, null, {}]) {
    const v = evaluer(a, ctx());
    assert.equal(v.verdict, 'revue_humaine', JSON.stringify(a));
    assert.equal(v.regle, 'R-00');
  }
  const v = evaluer(action('depense', { montant_eur: 31.9, objet: 'abonnement codeur' }), ctx());
  assert.deepEqual([v.verdict, v.regle], ['interdit', 'R-18']);
  // Encaissé inconnu (absent du contexte) : compté comme nul.
  assert.equal(evaluer(action('depense', { montant_eur: 0.01 }), { politique: POLITIQUE_REELLE }).verdict, 'interdit');
});

test('verdict final = le plus restrictif : après un encaissement, la table dit revue_humaine, politique.json (plafond 0 €) dit interdit', () => {
  const a = action('depense', { montant_eur: 31.9 }), c = ctx({ encaisse_eur: 120 });
  assert.equal(verdictTable(a, c).verdict, 'revue_humaine');
  assert.equal(verdictPolitique(a, c).verdict, 'interdit');
  const v = evaluer(a, c);
  assert.deepEqual([v.verdict, v.source, v.regle], ['interdit', 'politique.json', 'R-19']);
  // Le propriétaire relève lui-même le plafond : la dépense revient en revue humaine, jamais en « autorise ».
  const releve = { ...POLITIQUE_REELLE, depense: { ...POLITIQUE_REELLE.depense, plafond_eur: 50 } };
  assert.equal(evaluer(a, { ...c, politique: releve }).verdict, 'revue_humaine');
  assert.equal(evaluer(action('depense', { montant_eur: 80 }), { ...c, politique: releve }).verdict, 'interdit');
  // Une valeur inconnue dans politique.json ne relâche rien.
  assert.equal(evaluer(a, { ...c, politique: { ...releve, depense: { ...releve.depense, apres_premier_encaissement: 'oui' } } }).verdict, 'interdit');
  assert.equal(plusRestrictif('autorise', 'revue_humaine'), 'revue_humaine');
  assert.equal(plusRestrictif('autorise', 'nimporte'), 'interdit');
});

test('politique.json absent → toute action au moins en revue humaine ; relu à chaque évaluation', () => {
  const r = dossier();
  const absent = chargerPolitique(r);
  assert.equal(absent.politique, null);
  for (const type of [...TYPES_ACTION, ...ACTIONS_SENSIBLES]) {
    const v = evaluer(action(type, { site_ok: true, revue_validee: true, texte: 'ok', pari_gagne: true, backtest: {}, pari: 'P-x', estimation_requetes: 1 }), ctx({}, { politique: absent }));
    assert.notEqual(v.verdict, 'autorise', type);
  }
  assert.deepEqual([evaluer(action('sonder'), { ...ctx(), politique: undefined, racine: r }).verdict, evaluer(action('sonder'), { ...ctx(), politique: undefined, racine: r }).regle], ['revue_humaine', 'R-00']);
  // Le fichier du propriétaire est relu à chaque évaluation : une modification prend effet aussitôt.
  fs.writeFileSync(path.join(r, 'politique.json'), JSON.stringify(POLITIQUE_REELLE));
  const c = { ...ctx(), politique: undefined, racine: r };
  assert.equal(evaluer(action('sonder'), c).verdict, 'autorise');
  assert.equal(evaluer(action('publier_site', { site_ok: true }), c).verdict, 'revue_humaine');
  fs.writeFileSync(path.join(r, 'politique.json'), JSON.stringify({ ...POLITIQUE_REELLE, publication: 'interdit' }));
  assert.equal(evaluer(action('publier_site', { site_ok: true }), c).verdict, 'interdit');
  fs.writeFileSync(path.join(r, 'politique.json'), '{ illisible');
  const ill = chargerPolitique(r);
  assert.equal(ill.politique, null);
  assert.match(ill.motif, /illisible/);
  assert.equal(evaluer(action('sonder'), c).verdict, 'revue_humaine');
  // L'empreinte du fichier réel est rendue (consignable par le cycle).
  assert.match(chargerPolitique(RACINE).empreinte, /^[0-9a-f]{16}$/);
});

test('empreintePolitique() === valeur scellée : toute modification de la table casse ce test et exige une PR', () => {
  assert.equal(empreintePolitique(), EMPREINTE_SCELLEE);
  assert.ok(Object.isFrozen(POLITIQUE) && POLITIQUE.every(Object.isFrozen));
  assert.throws(() => { POLITIQUE.push({}); }, TypeError);
});

// ---------------------------------------------------------------------------------------------------------------------
// File de revue.

const TEXTE_A = 'Bonjour,\n\nVoici un échantillon fictif de dix lignes.\n\n[PRIX À VALIDER PAR LE PROPRIÉTAIRE]\n';
const TEXTE_B = `${TEXTE_A}Version corrigée.\n`;
const entree = (extra = {}) => ({ type: 'proposition', ref: 'courtiers-construction:69', texte: TEXTE_A, geste: 'relire, fixer le prix, envoyer depuis sa propre adresse',
  canal: 'email', annonce: '700001', ...extra });

test('mettreEnRevue : id R-AAAA-MM-JJ-k, fiche sous prive/revues/, empreinte du texte, idempotence, version remplacée caduque', () => {
  const { registre, magasin, h } = banc();
  const { revue, acte } = mettreEnRevue(entree(), { registre, horloge: h, magasin });
  assert.match(revue.id, /^R-2026-11-16-1$/);
  assert.equal(revue.fichier_prive, `${DOSSIER_REVUES}/${revue.id}.md`);
  assert.equal(revue.empreinte, empreinte(TEXTE_A));
  assert.equal(acte.type, 'revue');
  assert.equal(acte.empreinte_revue, empreinte(TEXTE_A));
  assert.ok(!JSON.stringify(registre.lignes).includes('échantillon fictif'), 'le texte reste privé');
  const fiche = magasin.lire(revue.fichier_prive);
  assert.equal(extraireTexte(fiche), TEXTE_A);
  assert.match(fiche, new RegExp(`valide ${revue.id}#${revue.empreinte.slice(0, 6)}`));
  // Même texte : même revue, aucune ligne de plus.
  const n = registre.lignes.length;
  assert.equal(mettreEnRevue(entree(), { registre, horloge: h, magasin }).revue.id, revue.id);
  assert.equal(registre.lignes.length, n);
  // Nouvelle version : nouvel id, l'ancienne devient caduque (remplacée), jamais relancée.
  const v2 = mettreEnRevue(entree({ texte: TEXTE_B }), { registre, horloge: h, magasin });
  assert.equal(v2.revue.id, 'R-2026-11-16-2');
  assert.deepEqual(v2.remplacees, [revue.id]);
  const statuts = Object.fromEntries(revuesDe(registre, h).map((r) => [r.id, [r.statut, r.motif_caduque]]));
  assert.deepEqual(statuts[revue.id], ['caduque', 'remplacee']);
  assert.deepEqual(fileOuverte(registre, h).map((r) => r.id), [v2.revue.id]);
  assert.throws(() => mettreEnRevue(entree({ type: 'inconnu' }), { registre, horloge: h, magasin }), /hors de/);
  assert.throws(() => mettreEnRevue(entree({ texte: '<!-- velyx:texte:fin -->' }), { registre, horloge: h, magasin }), /marqueur/);
  for (const t of TYPES_REVUE) assert.equal(typeof t, 'string');
});

test('R-21 : deux propositions ouvertes au plus ; préalables et kits hors limite', () => {
  const { registre, magasin, h } = banc();
  mettreEnRevue(entree({ ref: 'a' }), { registre, horloge: h, magasin });
  mettreEnRevue(entree({ ref: 'b' }), { registre, horloge: h, magasin });
  assert.throws(() => mettreEnRevue(entree({ ref: 'c' }), { registre, horloge: h, magasin }), /2 propositions déjà ouvertes/);
  assert.doesNotThrow(() => mettreEnRevue(entree({ ref: 'a', texte: TEXTE_B }), { registre, horloge: h, magasin }), 'une nouvelle version remplace');
  assert.doesNotThrow(() => mettreEnRevue(entree({ type: 'prealable', ref: 'statut', texte: 'Fiche de statut.' }), { registre, horloge: h, magasin }));
  assert.doesNotThrow(() => mettreEnRevue(entree({ type: 'kit_canal', ref: 'comeup', texte: 'Kit ComeUp.' }), { registre, horloge: h, magasin }));
  assert.equal(contexte(registre, { horloge: h }).etat.revues_ouvertes_n, 2);
});

test('appliquerGeste « valide » : liée à l’empreinte ; version précédente, texte modifié, revue caduque ou déjà validée → refus', () => {
  const { registre, magasin, h } = banc();
  const v1 = mettreEnRevue(entree(), { registre, horloge: h, magasin }).revue;
  const v2 = mettreEnRevue(entree({ texte: TEXTE_B }), { registre, horloge: h, magasin }).revue;
  // Empreinte d'une version précédente, sur la nouvelle revue : refus.
  assert.throws(() => appliquerGeste(`valide ${v2.id}#${v1.empreinte.slice(0, 6)}`, { registre, horloge: h, magasin }), /empreinte .* différente/);
  // Revue caduque (remplacée) : refus, même avec sa propre empreinte.
  assert.throws(() => appliquerGeste(`valide ${v1.id}#${v1.empreinte.slice(0, 6)}`, { registre, horloge: h, magasin }), /caduque/);
  assert.throws(() => appliquerGeste('valide R-2026-11-16-9#abcdef', { registre, horloge: h, magasin }), /revue inconnue/);
  // Texte modifié dans la fiche privée depuis la mise en revue : refus.
  const fiche = magasin.lire(v2.fichier_prive);
  magasin.ecrirePrive(v2.fichier_prive, fiche.replace('Version corrigée.', 'Version retouchée à la main.'));
  assert.throws(() => appliquerGeste(`valide ${v2.id}#${v2.empreinte.slice(0, 6)}`, { registre, horloge: h, magasin }), /a changé/);
  magasin.ecrirePrive(v2.fichier_prive, fiche);
  // Bonne empreinte : acte validation du propriétaire, vérifié « session », la phrase reste privée.
  const phrase = `valide ${v2.id}#${v2.empreinte.slice(0, 6)} option A`;
  const r = appliquerGeste(phrase, { registre, horloge: h, magasin, source_id: 'message-1' });
  assert.equal(r.actes.length, 1);
  const [val] = r.actes;
  assert.deepEqual([val.type, val.auteur, val.verification, val.revue, val.empreinte_revue, val.choix], ['validation', 'proprietaire', 'session', v2.id, v2.empreinte, 'option A']);
  assert.equal(val.preuve_empreinte, sha256Texte(phrase));
  assert.ok(!JSON.stringify(registre.lignes).includes(phrase), 'la phrase n’est pas au registre');
  assert.equal(JSON.parse(magasin.lire(JOURNAL_GESTES).trim()).phrase, phrase);
  assert.ok(estValidee(registre, v2.id, v2.empreinte, h));
  assert.ok(!estValidee(registre, v2.id, v1.empreinte, h));
  assert.throws(() => appliquerGeste(phrase, { registre, horloge: h, magasin }), /déjà validée/);
  assert.throws(() => appliquerGeste(`valide ${v2.id}#${v2.empreinte.slice(0, 6)}`, { registre, horloge: h }), /déjà validée/);
});

test('appliquerGeste : reponse, envoye, encaisse, rejette, statut, canal ; hors grammaire et vérification GitHub refusées', () => {
  const { registre, magasin, h } = banc();
  registre.ajouter(pari('P-x'));
  const rep = appliquerGeste('reponse P-x devis_demande', { registre, horloge: h, magasin });
  assert.deepEqual([rep.actes[0].type, rep.actes[0].auteur, rep.actes[0].verification, rep.actes[0].issue], ['reponse', 'proprietaire', 'session', 'devis_demande']);
  assert.throws(() => appliquerGeste('reponse P-x enthousiaste', { registre, horloge: h }), /issue/);
  assert.throws(() => appliquerGeste('reponse P-inconnu question', { registre, horloge: h }), /pari inconnu/);
  // envoye : lié à la revue et à son pari ; empreinte_source = version dont il est parti.
  const rv = mettreEnRevue(entree(), { registre, horloge: h, magasin }).revue;
  assert.throws(() => appliquerGeste(`envoye ${rv.id} canal=email`, { registre, horloge: h }), /aucun pari/);
  registre.ajouter(pari(`P-${rv.id}`, { revue: rv.id }));
  assert.throws(() => appliquerGeste(`envoye ${rv.id} canal=pigeon`, { registre, horloge: h }), /canal/);
  const env = appliquerGeste(`envoye ${rv.id} canal=email`, { registre, horloge: h }).actes[0];
  assert.deepEqual([env.type, env.pari, env.canal, env.revue, env.empreinte_source], ['envoi', `P-${rv.id}`, 'email', rv.id, rv.empreinte]);
  assert.equal(revuesDe(registre, h).find((r) => r.id === rv.id).statut, 'envoyee');
  assert.throws(() => appliquerGeste(`rejette ${rv.id} trop tard`, { registre, horloge: h }), /déjà envoyee/);
  // encaisse : seul compteur d'argent.
  const enc = appliquerGeste('encaisse 150,50 P-x', { registre, horloge: h }).actes[0];
  assert.deepEqual([enc.type, enc.montant_eur, enc.pari, enc.auteur], ['encaissement', 150.5, 'P-x', 'proprietaire']);
  assert.equal(registre.etat().encaisse_eur, 150.5);
  assert.throws(() => appliquerGeste('encaisse 0 libre', { registre, horloge: h }), /positif/);
  // rejette, statut, canal.
  const autre = mettreEnRevue(entree({ type: 'prealable', ref: 'statut', texte: 'Fiche statut.' }), { registre, horloge: h, magasin }).revue;
  const rej = appliquerGeste(`rejette ${autre.id} hors sujet pour le moment`, { registre, horloge: h }).actes[0];
  assert.deepEqual([rej.type, rej.sujet, rej.valeur], ['geste', 'rejet', autre.id]);
  assert.equal(revuesDe(registre, h).find((r) => r.id === autre.id).statut, 'rejetee');
  assert.throws(() => appliquerGeste(`rejette ${autre.id} écrire à ${['qui', 'exemple.fr'].join('@')}`, { registre, horloge: h }), /refusé/);
  appliquerGeste('statut micro', { registre, horloge: h });
  appliquerGeste('canal comeup ouvert', { registre, horloge: h });
  const c = contexte(registre, { horloge: h });
  assert.equal(c.etat.statut_proprietaire, 'micro');
  assert.deepEqual(c.etat.canaux, { comeup: 'ouvert' });
  assert.throws(() => appliquerGeste('envoie tout à tout le monde', { registre, horloge: h }), /hors grammaire/);
  assert.throws(() => appliquerGeste('statut micro', { registre, horloge: h, verification: 'github' }), /reportés/);
  assert.equal(GRAMMAIRE_GESTES.length, 9);
});

test('opposition : le SIREN est rendu à M4, aucun SIREN dans l’acte public ni au registre', () => {
  const { registre, magasin, h } = banc();
  const siren = '999000012';                                   // SIREN fictif (clé de Luhn fausse)
  const n = registre.lignes.length;
  const r = appliquerGeste(`opposition ${siren.slice(0, 3)} ${siren.slice(3, 6)} ${siren.slice(6)}`, { registre, horloge: h, magasin });
  assert.equal(r.opposition, siren);
  assert.deepEqual(r.actes, []);
  assert.equal(registre.lignes.length, n);
  assert.ok(!JSON.stringify(registre.lignes).includes(siren));
});

test('dépense déclarée par le propriétaire : consignée (son geste), et la table interdit toujours à l’agent de dépenser', () => {
  const { registre, h } = banc();
  const d = appliquerGeste('depense 31,90 abonnement mensuel', { registre, horloge: h }).actes[0];
  assert.deepEqual([d.type, d.montant_eur, d.autorise_par], ['depense', 31.9, 'proprietaire']);
  const c = contexte(registre, { horloge: h, racine: RACINE, budget: budget(h), oppositions_dispo: true });
  assert.equal(evaluer(action('depense', { montant_eur: 5 }), c).verdict, 'interdit');
});

test('expirer : annonce passée « En cours » → revue caduque, jamais relancée ; expiration à 7 jours', () => {
  const { registre, magasin, h } = banc();
  const a = mettreEnRevue(entree({ ref: 'a', annonce: '700001' }), { registre, horloge: h, magasin }).revue;
  const b = mettreEnRevue(entree({ ref: 'b', annonce: '700002' }), { registre, horloge: h, magasin }).revue;
  const actes = expirer(registre, { statuts_annonces: { 700001: 'En cours', 700002: 'Ouvert' }, horloge: h });
  assert.equal(actes.length, 1);
  assert.deepEqual([actes[0].action, actes[0].revue, actes[0].motif], ['invalider_revue', a.id, 'annonce_en_cours']);
  assert.deepEqual(fileOuverte(registre, h).map((r) => r.id), [b.id]);
  assert.equal(expirer(registre, { statuts_annonces: { 700001: 'En cours' }, horloge: h }).length, 0, 'aucune relance');
  assert.throws(() => appliquerGeste(`valide ${a.id}#${a.empreinte.slice(0, 6)}`, { registre, horloge: h, magasin }), /caduque/);
  // Huit jours plus tard : la seconde a expiré (lecture de plus de 7 jours).
  const plusTard = horloge('2026-11-24T09:00:01Z');
  assert.deepEqual(fileOuverte(registre, plusTard), []);
  const e = expirer(registre, { horloge: plusTard });
  assert.deepEqual(e.map((x) => [x.revue, x.motif]), [[b.id, 'expiree']]);
});

test('etatRevuePublic : comptes et âge maximal, ni nom ni chemin privé ; passe l’antifuite', () => {
  const { registre, magasin, h } = banc();
  mettreEnRevue(entree({ ref: 'a' }), { registre, horloge: h, magasin });
  mettreEnRevue(entree({ type: 'prealable', ref: 'statut', texte: 'Fiche statut.' }), { registre, horloge: h, magasin });
  const plusTard = horloge('2026-11-16T21:00:00Z');
  const pub = etatRevuePublic(fileOuverte(registre, plusTard));
  assert.deepEqual(pub, { n_ouvertes: 2, par_type: { proposition: 1, prealable: 1 }, age_max_h: 12 });
  const s = JSON.stringify(pub);
  assert.ok(!s.includes('prive/') && !s.includes('R-'), s);
  assert.equal(verifierObjetPublic(pub, null).ok, true);
});

test('rendreRevue : repères de prix en information, jamais pré-remplis dans le texte soumis', () => {
  const revue = { id: 'R-2026-11-16-1', type: 'proposition', ref: 'x', empreinte: empreinte(TEXTE_A), geste: 'g', canal: 'email', ouverte_le: H0, expire_le: H0 };
  const md = rendreRevue(revue, { texte: TEXTE_A, controles: [{ code: 'B2', gravite: 'bloquant', ok: true, motif: 'placeholders présents' }], affirme: ['a'], ne_promet_pas: ['b'],
    ancres_prix: ['Ligne « avec signal d’achat » : 199 € les 100 lignes (repère cité)'] });
  assert.equal(extraireTexte(md), TEXTE_A);
  assert.ok(!extraireTexte(md).includes('199'));
  assert.match(md, /Repères de prix \(information seulement, jamais pré-remplis/);
  assert.match(md, /\| B2 \| bloquant \| oui \|/);
});

test('validation liée à l’empreinte : publier_site exécutable après validation de cette empreinte seulement ; un envoi reste un geste', () => {
  const { registre, magasin, h } = banc();
  const html = '<!doctype html><title>page</title>';
  const rv = mettreEnRevue({ type: 'publication_site', ref: 'site', texte: html, geste: 'valider la page' }, { registre, horloge: h, magasin }).revue;
  const a = action('publier_site', { site_ok: true });
  const v = evaluer(a, ctx());
  assert.equal(v.verdict, 'revue_humaine');
  assert.equal(verdictApresValidation(a, v, { registre, revue: rv.id, empreinte: rv.empreinte, horloge: h }).verdict, 'revue_humaine', 'pas encore validée');
  appliquerGeste(`valide ${rv.id}#${rv.empreinte.slice(0, 6)}`, { registre, horloge: h, magasin });
  assert.equal(verdictApresValidation(a, v, { registre, revue: rv.id, empreinte: rv.empreinte, horloge: h }).verdict, 'autorise');
  assert.equal(verdictApresValidation(a, v, { registre, revue: rv.id, empreinte: empreinte(`${html} `), horloge: h }).verdict, 'revue_humaine', 'autre HTML');
  const envoi = action('envoi');
  assert.equal(verdictApresValidation(envoi, evaluer(envoi, ctx()), { registre, revue: rv.id, empreinte: rv.empreinte, horloge: h }).verdict, 'revue_humaine');
  const interdit = evaluer(action('publier_site', { site_ok: false }), ctx());
  assert.equal(verdictApresValidation(a, interdit, { registre, revue: rv.id, empreinte: rv.empreinte, horloge: h }).verdict, 'interdit');
});

test('contexte : lu dans le registre réel (encaissé nul, aucun cycle) ; cyclesSansGeste compte depuis le dernier acte du propriétaire', () => {
  const reel = new Registre(path.join(RACINE, 'registre', 'journal.jsonl'));
  const c = contexte(reel, { racine: RACINE, horloge: horloge(), oppositions_dispo: true, budget: budget(horloge()) });
  assert.equal(c.etat.encaisse_eur, 0);
  assert.equal(evaluer(action('depense', { montant_eur: 31.9 }), c).verdict, 'interdit');
  const { registre, h } = banc();
  registre.ajouter({ type: 'mandat', ...PROPRIO, texte: 't', source: 's', regle: 'r' });
  for (let i = 1; i <= 3; i++) registre.ajouter({ type: 'cycle', jour: '2026-11-16', passage: i, etapes: [], requetes: { codeur: 0, sirene: 0 }, duree_s: 1, cle: `cycle:${i}` });
  assert.equal(cyclesSansGeste(registre).n, 3);
  assert.equal(contexte(registre, { horloge: h }).etat.cycles_sans_geste, 3);
});
