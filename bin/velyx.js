#!/usr/bin/env node
// VELYX v2 — de la demande réelle publiée à un premier euro encaissé.
//   velyx cycle [--a-blanc] [--jusqua <étape>] [--hors-ligne] [--rever]   boucle du jour (15 étapes), idempotente
//   velyx juger <J-id> <fichier.json>     jugement validé par schéma (code 0 accepté, 1 refusé ; une correction permise)
//   velyx revue [<R-id>]                  file de revue humaine : liste, ou fiche d'une revue
//   velyx etat · verifier (registre + antifuite) · bilan · notification · garde [--structurel] · site [--verifier] · migrer [--purger-brut]
//   velyx marche [--pages 5] · cibler <recette> [--departement 69] [--mois 12] · brouillon <recette> [--departement 69]
//   propriétaire seulement : velyx valider <R-id>#<empreinte6> [choix] · geste « <phrase> » · envoye <R-id> [--canal email]
//     · reponse <P-id> <issue> · encaisse <eur> <P-id|libre> [ref=<n° de facture>]
// Réseau (cycle, marche, cibler) : NODE_USE_ENV_PROXY=1 derrière un proxy.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerHorloge, creerBudget, creerHttp, creerMagasin, PLAFONDS } from '../src/socle.js';
import { Registre, CLES } from '../src/registre.js';
import { collecter } from '../src/sources/codeur.js';
import { chercher, resumer } from '../src/sources/sirene.js';
import { chargerRecettes, compiler, appliquer } from '../src/recettes.js';
import { MODELES, preparerV1, pari as pariDeRevue } from '../src/brouillons.js';
import * as garde from '../src/garde.js';
import * as risque from '../src/risque.js';
import { mesurer } from '../src/bilan.js';
import { genererSite } from '../src/site.js';
import { creerContexte, executerCycle, juger, migrer, ecrireMemoire, canauxDuRegistre, resteDuJour, brouillonCourtiers, etatCourtiers, CHEMIN_MEMOIRE } from '../src/cycle.js';

const ICI = fileURLToPath(import.meta.url);
const RACINE = path.resolve(process.env.VELYX_RACINE || path.join(path.dirname(ICI), '..'));
const [cmd, ...args] = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const drapeau = (k) => args.includes(`--${k}`);
const VALEURS = new Set(['--pages', '--max', '--departement', '--mois', '--jusqua', '--canal']);
const positionnels = () => args.filter((a, i) => !a.startsWith('--') && !VALEURS.has(args[i - 1]));
const horloge = creerHorloge();
// Le registre admet chaque acte par l'antifuite (R-10) : dictionnaire fourni, sinon construit depuis prive/ à la première écriture.
const journal = (dict) => new Registre(path.join(RACINE, 'registre', 'journal.jsonl'), { horloge, ...(dict !== undefined ? { dict } : {}) });
const med = (v) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const sortie = (code, ...lignes) => { for (const l of lignes) console.log(typeof l === 'string' ? l : JSON.stringify(l, null, 1)); process.exitCode = code; };

/** Magasin réel branché sur l'antifuite (dictionnaire construit depuis prive/). */
function magasinGarde() {
  let dict = null;
  try { dict = garde.dictionnaire(creerMagasin(RACINE)); } catch (e) { console.error(`antifuite : ${e.message}`); }
  return { dict, magasin: creerMagasin(RACINE, { verifierPublic: (rel, c) => garde.verifierPublic(rel, c, dict) }) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Boucle.

async function cycle() {
  const ctx = creerContexte({ racine: RACINE, horloge, aBlanc: drapeau('a-blanc'), horsLigne: drapeau('hors-ligne') });
  const r = await executerCycle(ctx, { jusqua: opt('jusqua', null), ...(drapeau('rever') ? { rever: true } : {}) });
  const resume = { id: r.id, passage: r.passage, statut: r.statut, ...(r.rejeu ? { rejeu: true } : {}), ...(r.motif ? { motif: r.motif } : {}), mode: r.mode ?? ctx.mode,
    a_blanc: ctx.aBlanc, requetes: r.requetes, duree_s: r.duree_s, verdicts: r.verdicts, revues_ouvertes: r.revues, a_juger: r.a_juger.map((d) => `${d.id} (${d.type}) → ${d.sortie}`),
    notification: r.notification ?? '', incidents: r.incidents };
  console.table(r.etapes.map((e) => ({ etape: e.nom, statut: e.statut, duree_ms: e.duree_ms, requetes: e.requetes, ...(e.motif ? { motif: e.motif } : {}) })));
  sortie(0, resume);
}

function jugerCmd() {
  const [jid, fichier] = positionnels();
  if (!jid || !fichier) return sortie(1, 'usage : velyx juger <J-id> <fichier.json>');
  let texte;
  try { texte = fs.readFileSync(path.resolve(fichier), 'utf8'); } catch (e) { return sortie(1, `fichier illisible : ${e.message}`); }
  const ctx = creerContexte({ racine: RACINE, horloge, horsLigne: true });
  const r = juger(ctx, jid, texte);
  sortie(r.ok ? 0 : 1, r.ok ? `accepté : ${jid}` : `refusé : ${jid} (essais restants : ${r.essais_restants ?? 0})`, ...(r.erreurs ?? []).map((e) => `  - ${e}`));
}

function revue() {
  const reg = journal(), [id] = positionnels();
  if (id) {
    const r = risque.revuesDe(reg, horloge).find((x) => x.id === id);
    if (!r) return sortie(1, `revue inconnue : ${id}`);
    const fiche = creerMagasin(RACINE).lire(r.fichier_prive);
    return sortie(0, `[${r.id}] ${r.type} · ${r.statut} · empreinte ${r.empreinte} · ouverte depuis ${r.age_h} h`, fiche ?? `(fiche ${r.fichier_prive} absente de ce conteneur)`);
  }
  const toutes = risque.revuesDe(reg, horloge);
  const ouvertes = toutes.filter((r) => r.statut === 'ouverte');
  console.log(`${ouvertes.length} revue(s) ouverte(s) sur ${toutes.length}`);
  for (const r of ouvertes) console.log(`\n[${r.id}] ${r.type} ${r.ref ?? ''} · depuis ${r.age_h} h · empreinte ${r.empreinte.slice(0, 6)}\n  geste : ${r.geste}\n  valider : velyx valider ${r.id}#${r.empreinte.slice(0, 6)}`);
}

function etat() {
  const reg = journal(), e = reg.etat(), ouvertes = risque.fileOuverte(reg, horloge);
  console.log(`Argent encaissé : ${e.encaisse_eur} € (dont vérifié : ${e.encaisse_verifie_eur} €)   ·   dépensé : ${e.depense_eur} €`);
  for (const p of e.paris) console.log(`\n[${p.id}] ${p.statut} · ${p.hypothese}\n  échéance ${p.echeance} · envoyé : ${p.envoye ? 'oui' : 'NON'} · issues : ${p.issues.join(', ') || 'aucune'}\n  geste attendu : ${p.geste}`);
  console.log(`\n${ouvertes.length} geste(s) attendu(s) du propriétaire :`);
  for (const r of ouvertes) console.log(`  [${r.id}] ${r.type} ${r.ref ?? ''} (depuis ${r.age_h} h) : ${r.geste}`);
  const dernier = reg.derniere('cycle');
  console.log(`\nDernier cycle : ${dernier ? `${dernier.jour}, passage ${dernier.passage}, ${dernier.statut}, ${dernier.requetes.codeur} GET codeur, ${dernier.requetes.sirene} SIRENE, ${dernier.duree_s} s` : 'aucun'}`);
  console.log(`Registre : ${JSON.stringify(reg.verifier())}`);
}

function bilan() {
  const { dict, magasin } = magasinGarde(), reg = journal();
  const series = [];
  for (const f of magasin.lister('etat/series/')) for (const l of (magasin.lire(f) ?? '').split('\n')) { try { if (l.trim()) series.push(JSON.parse(l)); } catch { /* ligne illisible */ } }
  const m = mesurer({ registre: reg, series, horloge, scan: garde.scannerDepot(RACINE, dict) });
  magasin.ecrirePublic('etat/kpi.json', m.kpi);
  console.table(Object.entries(m.kpi).map(([k, v]) => ({ kpi: k, valeur: v.affichage, n: v.n, nature: v.nature })));
}

function gardeCmd() {
  if (drapeau('structurel')) {
    const r = garde.structurel(RACINE);
    return sortie(r.ok ? 0 : 1, { ok: r.ok, fuites: r.fuites.length, fichiers: r.fichiers }, ...r.fuites.map((f) => `  ${f.fichier}:${f.ligne} ${f.motif}`));
  }
  let dict;
  try { dict = garde.dictionnaire(creerMagasin(RACINE)); } catch (e) { return sortie(1, `antifuite en échec fermé : ${e.message}`); }
  const r = garde.scannerDepot(RACINE, dict);
  sortie(r.ok ? 0 : 1, { ok: r.ok, fuites: r.fuites.length, dictionnaire_vide: r.dictionnaire_vide, n_jetons: r.n_jetons, fichiers: r.fichiers }, ...r.fuites.map((f) => `  ${f.fichier}:${f.ligne} ${f.motif}`));
}

// verifier (avant tout commit, CLAUDE.md) : chaîne du registre ET antifuite du dépôt avec dictionnaire (suivis et non
// suivis non ignorés : tout ce qu'un commit emporterait). Dictionnaire incohérent → échec fermé.
function verifier() {
  const v = journal().verifier();
  let a;
  try {
    const dict = garde.dictionnaire(creerMagasin(RACINE)), r = garde.scannerDepot(RACINE, dict);
    a = { ok: r.ok, fuites: r.fuites.length, dictionnaire_vide: r.dictionnaire_vide, fichiers: r.fichiers, lignes: r.fuites.map((f) => `${f.fichier}:${f.ligne} ${f.motif}`) };
  } catch (e) { a = { ok: false, motif: `antifuite en échec fermé : ${e.message}`, lignes: [] }; }
  const { lignes, ...antifuite } = a;
  sortie(v.ok && a.ok ? 0 : 1, { ...v, ok: v.ok && a.ok, registre: v.ok, antifuite }, ...lignes.map((l) => `  ${l}`));
}

function site() {
  const { dict, magasin } = magasinGarde();
  const r = genererSite(magasin, { jour: horloge.jour(), dict });
  sortie(drapeau('verifier') && !r.verification.ok ? 1 : 0, { chemin: r.chemin, empreinte: r.empreinte, verification: r.verification, ecartes: r.ecartes });
}

function notification() {
  const t = creerMagasin(RACINE).lire('prive/notification.txt');
  if (t) console.log(t);
}

function migrerCmd() {
  const ctx = creerContexte({ racine: RACINE, horloge, horsLigne: true });
  const r = migrer(ctx, { purger_brut: drapeau('purger-brut') });
  sortie(0, { actes: r.actes.map((l) => `${l.n} ${l.type} ${l.cle}`), purges: r.purges });
}

// ---------------------------------------------------------------------------------------------------------------------
// Commandes v1 conservées (passent désormais par la porte réseau, le budget et les contrôles).

// marche et cibler passent par le même plafond quotidien que le cycle (R-43) : leur budget est ce qui reste au jour, et
// ce qu'ils consomment est consigné (requetes_hors_cycle) pour que le cycle et les commandes suivantes le décomptent.
const consommation = (budget) => { const c = budget.bilan().consomme; return { codeur: c.codeur ?? 0, sirene: c.sirene ?? 0 }; };
function consignerInterruption(reg, quoi, budget, e) {
  const c = consommation(budget);
  if (c.codeur || c.sirene) reg.ajouter({ type: 'aveu', cle: `aveu:${quoi}:${horloge.iso()}`, motif: `velyx ${quoi} interrompu : ${String(e?.message ?? e).slice(0, 200)}`, requetes_hors_cycle: c });
}

async function marche() {
  const reg = journal(), jour = horloge.jour(), deja = reg.trouver(`observation:marche:${jour}`);
  if (deja) return sortie(1, `marché déjà relevé ce jour (ligne ${deja.n}) : une fois par jour au plus (CLAUDE.md)`);
  const reste = resteDuJour(reg, creerMagasin(RACINE), horloge);
  const budget = creerBudget({ codeur: reste.codeur, sirene: 0, duree_s: 600 }, horloge), http = creerHttp({ budget, horloge });
  let L;
  try { L = await collecter({ pages: Number(opt('pages', 5)), http }); } catch (e) {
    consignerInterruption(reg, 'marche', budget, e);
    return sortie(1, `marché non relevé : ${e.message} (plafond restant du jour : ${reste.codeur} GET codeur)`);
  }
  creerMagasin(RACINE).ecrirePrive(`prive/codeur-${jour}.json`, L);
  const ouverts = L.filter((x) => x.statut === 'Ouvert' && x.age_h !== null && x.age_h <= 24 * 14);
  const cat = {};
  for (const x of ouverts) (cat[x.tags[0] || '—'] ??= []).push(x.offres ?? 0);
  const table = Object.entries(cat).map(([c, o]) => ({ categorie: c, projets: o.length, offres_mediane: med(o) }))
    .sort((a, b) => a.offres_mediane - b.offres_mediane || b.projets - a.projets);
  console.table(table.filter((t) => t.projets >= 2));
  reg.ajouter({ type: 'observation', cle: `observation:marche:${jour}`, source: 'codeur.com, pages publiques', mesure: { lus: L.length, ouverts_14j: ouverts.length, offres_mediane: med(ouverts.map((x) => x.offres ?? 0)), par_categorie: table },
    requetes_hors_cycle: consommation(budget) });
}

async function cibler() {
  const [id] = positionnels(), jour = horloge.jour();
  const specs = chargerRecettes(creerMagasin(RACINE));
  if (!specs[id]) return sortie(1, `recette inconnue. Disponibles : ${Object.keys(specs).join(', ')}`);
  const variables = { ...(opt('departement') ? { departement: opt('departement') } : {}), ...(opt('mois') ? { mois: Number(opt('mois')) } : {}) };
  const rec = compiler(specs[id], horloge, variables), { dict, magasin } = magasinGarde(), reg = journal(dict);
  const oppositions = garde.chargerOppositions(magasin, reg);
  const reste = resteDuJour(reg, magasin, horloge);
  const budget = creerBudget({ codeur: 0, sirene: Math.min(Number(opt('max', PLAFONDS.sirene)), reste.sirene), duree_s: 3600 }, horloge), http = creerHttp({ budget, horloge });
  const repriseRel = `prive/cache/cibler-${id}-${jour}.json`, reprise = magasin.lireJson(repriseRel) ?? {};
  const lectures = [];
  try { for (const q of rec.recherches) lectures.push(await chercher(http, q, { maxRequetes: budget.reste('sirene'), reprise, journal: console.log })); } catch (e) {
    consignerInterruption(reg, 'cibler', budget, e);
    return sortie(1, `liste non construite : ${e.message} (plafond restant du jour : ${reste.sirene} requêtes SIRENE ; reprise gardée dans ${repriseRel})`);
  } finally { magasin.ecrirePrive(repriseRel, reprise); }
  const vus = new Set(), fiches = lectures.flatMap((l) => l.fiches).filter((f) => (f?.siren && !vus.has(f.siren) ? vus.add(f.siren) : false));
  const complet = lectures.every((l) => l.complet), total = lectures.reduce((s, l) => s + l.total, 0);
  const { gardees, compte } = appliquer(rec, fiches.map(resumer), { horloge, oppositions, dict, lecture: { complet } });
  const fichier = `prive/listes/${id}-${jour}.json`;
  magasin.ecrirePrive(fichier, { recette: id, annonce: rec.annonce, besoin: rec.besoin, source: 'SIRENE/RNE via recherche-entreprises.api.gouv.fr', lu_le: lectures[0]?.lu_le, lues: fiches.length, total_registre: total, complet, variables: rec.variables, cibles: gardees });
  const csv = ['siren;nom;commune;departement;naf;effectif;creation;dirigeant;ca;annee_ca;signaux;fiche',
    ...gardees.map((e) => { const d = e.dirigeants[0]; return [e.siren, e.nom, e.commune, e.departement, e.naf, e.effectif, e.creation, d ? `${d.nom} (${d.qualite})` : '', e.ca?.ca ?? '', e.ca?.annee ?? '', e.signaux.map((s) => s.code).join('+'), e.fiche].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';'); })].join('\n');
  magasin.ecrirePrive(fichier.replace(/\.json$/, '.csv'), csv);
  const c = { lues: compte.lues, total_registre: total, complet, retenues: compte.retenues, exclues: compte.exclues, completes: compte.completes, avec_signal: compte.avec_signal, par_signal: compte.par_signal };
  console.log(c);
  const cle = CLES.cible(id, jour), dejaCible = reg.trouver(cle);
  reg.ajouter({ type: 'cible', cle, recette: id, annonce: rec.annonce, compte: c, fichier_prive: fichier, v2: true, requetes_hors_cycle: consommation(budget) });
  // Liste déjà consignée ce jour (cycle ou cibler précédent) : l'acte cible n'est pas réécrit, la consommation l'est.
  if (dejaCible) reg.ajouter({ type: 'observation', cle: `requetes:cibler:${id}:${horloge.iso()}`, source: 'recherche-entreprises.api.gouv.fr (velyx cibler)', mesure: { recette: id, lues: compte.lues }, requetes_hors_cycle: consommation(budget) });
}

// brouillon <recette> : régénère la proposition depuis la dernière liste v2 contrôlée, la met en revue et crée son pari.
// Comme dans le cycle : le Risk Agent d'abord (R-14 oppositions, R-21 gel et limite, R-22 prix, R-23 client codeur hors de la
// plateforme), puis les contrôles ; un contrôle bloquant en échec ne produit ni revue ni pari. Le texte soumis est
// exactement celui qu'ont vu les contrôles ; les notes du propriétaire vont dans la fiche privée, hors du bloc couvert.
// brouillon courtiers-construction [--departement <dep>] : l'e-mail B2B aux courtiers en assurance construction croise deux
// listes (destinataires : courtiers-construction ; échantillon et comptes : btp-creations-zone du même département).
// Même chemin que le cycle (cycle.brouillonCourtiers) : Risk Agent, contrôles, revue, pari.
function brouillonCourtiersCmd() {
  const ctx = creerContexte({ racine: RACINE, horloge, horsLigne: true });
  const dep = opt('departement', null) ?? etatCourtiers(ctx, { fraiches: false })[0]?.departement ?? null;
  const action = { type: 'rediger_brouillon', ref: `courtiers-construction:${dep ?? '?'}`, params: { recette: 'courtiers-construction', canal: 'email', ...(dep ? { departement: dep } : {}) } };
  const v = risque.evaluer(action, risque.contexte(ctx.registre, { racine: RACINE, horloge, oppositions_dispo: ctx.mode !== 'veille', cgu_codeur: canauxDuRegistre(ctx.registre).codeur?.cgu ?? 'inconnue' }));
  if (v.verdict !== 'autorise') return sortie(1, `brouillon refusé par le Risk Agent : ${v.verdict} (${v.regle}) : ${v.motif}`);
  let d;
  try { d = brouillonCourtiers(ctx, { departement: dep }); } catch (e) { return sortie(1, e.message); }
  if (!d.ok) return sortie(1, 'brouillon refusé : contrôle bloquant en échec, ni revue ni pari', ...d.bloquants.map((c) => `  ${c.code} : ${c.motif}`));
  const r = risque.mettreEnRevue(d.revue, { registre: ctx.registre, horloge, magasin: ctx.magasin });
  const pari = pariDeRevue({ id: r.revue.id, canal: 'email', annonce: null });
  ctx.registre.ajouter({ type: 'pari', ...pari, revue: r.revue.id, recette: 'courtiers-construction', cle: CLES.pari(r.revue.id) });
  sortie(0, `revue : ${r.revue.id} (${r.revue.fichier_prive}) · département ${d.departement}`, `pari : ${pari.id}`, `valider : velyx valider ${r.revue.id}#${r.revue.empreinte.slice(0, 6)}`);
}

function brouillon() {
  const [id] = positionnels();
  if (id === 'courtiers-construction' || id === 'btp-creations-zone') return brouillonCourtiersCmd();
  const { dict, magasin } = magasinGarde(), reg = journal(dict);
  if (!MODELES[id]) return sortie(1, `aucun modèle pour « ${id} » (${Object.keys(MODELES).join(', ')})`);
  const src = magasin.lister('prive/listes/').filter((f) => f.startsWith(`prive/listes/${id}-`) && f.endsWith('.json')).sort().at(-1);
  if (!src) return sortie(1, `aucune liste contrôlée pour ${id} : lancer d’abord « velyx cibler ${id} »`);
  const d = magasin.lireJson(src);
  const annonce = /\/projects\/(\d+)/.exec(String(d.annonce ?? ''))?.[1] ?? null;
  let oppositions = new Set(), oppositions_dispo = true;
  try { oppositions = garde.chargerOppositions(magasin, reg); } catch (e) { if (!(e instanceof garde.OppositionsIndisponibles)) throw e; oppositions_dispo = false; }
  const action = { type: 'rediger_brouillon', ref: annonce ?? id, params: { recette: id, canal: 'email', ...(annonce ? { client_codeur: true } : {}) } };
  const v = risque.evaluer(action, risque.contexte(reg, { racine: RACINE, horloge, oppositions_dispo, cgu_codeur: canauxDuRegistre(reg).codeur?.cgu ?? 'inconnue' }));
  if (v.verdict !== 'autorise') return sortie(1, `brouillon refusé par le Risk Agent : ${v.verdict} (${v.regle}) : ${v.motif}`);
  let p;
  try { p = preparerV1(id, d, { lues: d.lues, total_registre: d.total_registre, retenues: d.cibles.length }, { horloge, oppositions }); } catch (e) { return sortie(1, e.message); }
  if (!p.ok) return sortie(1, `brouillon refusé : contrôle bloquant en échec, ni revue ni pari`, ...p.bloquants.map((c) => `  ${c.code} : ${c.motif}`));
  const r = risque.mettreEnRevue({ type: 'proposition', ref: annonce ?? id, texte: p.texte, notes: p.notes, controles: p.controles, sirens: p.sirens, annonce, canal: 'email',
    geste: 'relire la fiche, compléter les champs entre crochets et fixer le prix, envoyer soi-même, puis « envoye <R-id> canal=email »' },
    { registre: reg, horloge, magasin });
  const pari = pariDeRevue({ id: r.revue.id, canal: 'email', annonce });
  reg.ajouter({ type: 'pari', ...pari, revue: r.revue.id, recette: id, cle: CLES.pari(r.revue.id) });
  sortie(0, `revue : ${r.revue.id} (${r.revue.fichier_prive})`, `pari : ${pari.id}`, `valider : velyx valider ${r.revue.id}#${r.revue.empreinte.slice(0, 6)}`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Gestes du propriétaire : la phrase reste privée (prive/gestes.jsonl), seule son empreinte va au registre.

function geste(phrase) {
  const { dict } = magasinGarde(), reg = journal(dict), magasin = creerMagasin(RACINE);
  let r;
  try { r = risque.appliquerGeste(phrase, { registre: reg, horloge, magasin }); } catch (e) { return sortie(1, e.message); }
  if (r.opposition) {
    let memoire = null;
    try { memoire = magasin.lireJson(CHEMIN_MEMOIRE); } catch { memoire = null; }
    const o = garde.enregistrerOpposition(r.opposition, 'demande', { memoire, horloge });
    magasin.ecrirePrive(CHEMIN_MEMOIRE, `${JSON.stringify(o.memoire, null, 1)}\n`);
    reg.ajouter(o.acte);
    // R-13 : revues actives qui montrent l'entreprise rendues caduques, avant la purge (qui efface leur index privé).
    const caduques = risque.invaliderRevuesOpposees(r.opposition, { registre: reg, magasin, horloge });
    const p = garde.purgerPrive(magasin, { motif: 'opposition', siren: r.opposition, horloge });
    const ctx = creerContexte({ racine: RACINE, horloge, horsLigne: true });
    const m = ecrireMemoire(ctx);
    reg.ajouter({ type: 'memoire', sha256: m.sha256, octets: m.octets, n_oppositions: o.memoire.oppositions.length, cle: CLES.memoire(m.sha256) });
    return sortie(0, `opposition enregistrée (${o.memoire.oppositions.length} au total) ; revues rendues caduques : ${caduques.length ? caduques.map((l) => l.revue).join(', ') : 'aucune'} ; fichiers purgés : ${p.supprimes.length} ; à revoir à la main : ${p.a_revoir.length}`);
  }
  sortie(0, ...r.actes.map((l) => `acte ${l.n} : ${l.type}${l.cle ? ` (${l.cle})` : ''}`));
}

const revueDe = (x) => String(x ?? '').replace(/^P-(R-\d{4}-\d{2}-\d{2}-\d+)$/, '$1');
const proprio = {
  geste: () => geste(args.join(' ')),
  valider: () => geste(`valide ${args.join(' ')}`),
  envoye: () => geste(`envoye ${revueDe(positionnels()[0])} canal=${opt('canal', 'email')}`),
  reponse: () => geste(`reponse ${positionnels()[0]} ${positionnels()[1]}`),
  encaisse: () => geste(['encaisse', positionnels()[0], positionnels()[1] ?? 'libre', ...positionnels().slice(2, 3).filter((x) => /^ref=/.test(x))].join(' ')),
};

const cmds = {
  cycle, juger: jugerCmd, revue, etat, bilan, garde: gardeCmd, site, notification, migrer: migrerCmd, marche, cibler, brouillon, ...proprio,
  verifier,
};
if (!cmds[cmd]) {
  console.log(fs.readFileSync(ICI, 'utf8').split('\n').slice(1, 10).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(cmd ? 1 : 0);
}
await cmds[cmd]();
