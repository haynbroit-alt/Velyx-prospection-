#!/usr/bin/env node
// VELYX v2 — de la demande réelle publiée à un premier euro encaissé.
//   velyx cycle [--a-blanc] [--jusqua <étape>] [--hors-ligne] [--rever]   boucle du jour (15 étapes), idempotente
//   velyx juger <J-id> <fichier.json>     jugement validé par schéma (code 0 accepté, 1 refusé ; une correction permise)
//   velyx revue [<R-id>]                  file de revue humaine : liste, ou fiche d'une revue
//   velyx etat · verifier · bilan · notification · garde [--structurel] · site [--verifier] · migrer [--purger-brut]
//   velyx marche [--pages 5] · cibler <recette> [--departement 69] [--mois 12] · brouillon <recette>
//   propriétaire seulement : velyx valider <R-id>#<empreinte6> [choix] · geste « <phrase> » · envoye <R-id> [--canal email]
//     · reponse <P-id> <issue> · encaisse <eur> <P-id|libre>
// Réseau (cycle, marche, cibler) : NODE_USE_ENV_PROXY=1 derrière un proxy.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerHorloge, creerBudget, creerHttp, creerMagasin, PLAFONDS } from '../src/socle.js';
import { Registre, CLES } from '../src/registre.js';
import { collecter } from '../src/sources/codeur.js';
import { chercher, resumer } from '../src/sources/sirene.js';
import { chargerRecettes, compiler, appliquer } from '../src/recettes.js';
import { MODELES, pari as pariDeRevue } from '../src/brouillons.js';
import * as garde from '../src/garde.js';
import * as risque from '../src/risque.js';
import { mesurer } from '../src/bilan.js';
import { genererSite } from '../src/site.js';
import { creerContexte, executerCycle, juger, migrer, ecrireMemoire, CHEMIN_MEMOIRE } from '../src/cycle.js';

const ICI = fileURLToPath(import.meta.url);
const RACINE = path.resolve(process.env.VELYX_RACINE || path.join(path.dirname(ICI), '..'));
const [cmd, ...args] = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const drapeau = (k) => args.includes(`--${k}`);
const VALEURS = new Set(['--pages', '--max', '--departement', '--mois', '--jusqua', '--canal']);
const positionnels = () => args.filter((a, i) => !a.startsWith('--') && !VALEURS.has(args[i - 1]));
const horloge = creerHorloge();
const journal = () => new Registre(path.join(RACINE, 'registre', 'journal.jsonl'), { horloge });
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

async function marche() {
  const reg = journal(), jour = horloge.jour();
  const L = await collecter({ pages: Number(opt('pages', 5)) });
  creerMagasin(RACINE).ecrirePrive(`prive/codeur-${jour}.json`, L);
  const ouverts = L.filter((x) => x.statut === 'Ouvert' && x.age_h !== null && x.age_h <= 24 * 14);
  const cat = {};
  for (const x of ouverts) (cat[x.tags[0] || '—'] ??= []).push(x.offres ?? 0);
  const table = Object.entries(cat).map(([c, o]) => ({ categorie: c, projets: o.length, offres_mediane: med(o) }))
    .sort((a, b) => a.offres_mediane - b.offres_mediane || b.projets - a.projets);
  console.table(table.filter((t) => t.projets >= 2));
  reg.ajouter({ type: 'observation', cle: `observation:marche:${jour}`, source: 'codeur.com, pages publiques', mesure: { lus: L.length, ouverts_14j: ouverts.length, offres_mediane: med(ouverts.map((x) => x.offres ?? 0)), par_categorie: table } });
}

async function cibler() {
  const [id] = positionnels(), jour = horloge.jour();
  const specs = chargerRecettes(creerMagasin(RACINE));
  if (!specs[id]) return sortie(1, `recette inconnue. Disponibles : ${Object.keys(specs).join(', ')}`);
  const variables = { ...(opt('departement') ? { departement: opt('departement') } : {}), ...(opt('mois') ? { mois: Number(opt('mois')) } : {}) };
  const rec = compiler(specs[id], horloge, variables), reg = journal(), { dict, magasin } = magasinGarde();
  const oppositions = garde.chargerOppositions(magasin, reg);
  const budget = creerBudget({ codeur: 0, sirene: Number(opt('max', PLAFONDS.sirene)), duree_s: 3600 }, horloge), http = creerHttp({ budget, horloge });
  const repriseRel = `prive/cache/cibler-${id}-${jour}.json`, reprise = magasin.lireJson(repriseRel) ?? {};
  const lectures = [];
  try { for (const q of rec.recherches) lectures.push(await chercher(http, q, { maxRequetes: budget.reste('sirene'), reprise, journal: console.log })); } finally { magasin.ecrirePrive(repriseRel, reprise); }
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
  reg.ajouter({ type: 'cible', cle: CLES.cible(id, jour), recette: id, annonce: rec.annonce, compte: c, fichier_prive: fichier, v2: true });
}

// brouillon <recette> : régénère la proposition depuis la dernière liste v2 contrôlée, la met en revue et crée son pari.
function brouillon() {
  const [id] = positionnels(), { magasin } = magasinGarde(), reg = journal();
  if (!MODELES[id]) return sortie(1, `aucun modèle pour « ${id} » (${Object.keys(MODELES).join(', ')})`);
  const src = magasin.lister('prive/listes/').filter((f) => f.startsWith(`prive/listes/${id}-`) && f.endsWith('.json')).sort().at(-1);
  if (!src) return sortie(1, `aucune liste contrôlée pour ${id} : lancer d’abord « velyx cibler ${id} »`);
  const d = magasin.lireJson(src);
  let texte;
  try { texte = MODELES[id](d, { lues: d.lues, total_registre: d.total_registre, retenues: d.cibles.length }); } catch (e) { return sortie(1, e.message); }
  const annonce = /\/projects\/(\d+)/.exec(String(d.annonce ?? ''))?.[1] ?? null;
  const r = risque.mettreEnRevue({ type: 'proposition', ref: annonce ?? id, texte, annonce, geste: 'relire la fiche, compléter les champs entre crochets et fixer le prix, envoyer soi-même, puis « envoye <R-id> canal=email »' },
    { registre: reg, horloge, magasin });
  const p = pariDeRevue({ id: r.revue.id, canal: 'email', annonce });
  reg.ajouter({ type: 'pari', ...p, revue: r.revue.id, recette: id, cle: CLES.pari(r.revue.id) });
  sortie(0, `revue : ${r.revue.id} (${r.revue.fichier_prive})`, `pari : ${p.id}`, `valider : velyx valider ${r.revue.id}#${r.revue.empreinte.slice(0, 6)}`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Gestes du propriétaire : la phrase reste privée (prive/gestes.jsonl), seule son empreinte va au registre.

function geste(phrase) {
  const reg = journal(), magasin = creerMagasin(RACINE);
  let r;
  try { r = risque.appliquerGeste(phrase, { registre: reg, horloge, magasin }); } catch (e) { return sortie(1, e.message); }
  if (r.opposition) {
    let memoire = null;
    try { memoire = magasin.lireJson(CHEMIN_MEMOIRE); } catch { memoire = null; }
    const o = garde.enregistrerOpposition(r.opposition, 'demande', { memoire, horloge });
    magasin.ecrirePrive(CHEMIN_MEMOIRE, `${JSON.stringify(o.memoire, null, 1)}\n`);
    reg.ajouter(o.acte);
    const p = garde.purgerPrive(magasin, { motif: 'opposition', siren: r.opposition, horloge });
    const ctx = creerContexte({ racine: RACINE, horloge, horsLigne: true });
    const m = ecrireMemoire(ctx);
    reg.ajouter({ type: 'memoire', sha256: m.sha256, octets: m.octets, n_oppositions: o.memoire.oppositions.length, cle: CLES.memoire(m.sha256) });
    return sortie(0, `opposition enregistrée (${o.memoire.oppositions.length} au total) ; fichiers purgés : ${p.supprimes.length} ; à revoir à la main : ${p.a_revoir.length}`);
  }
  sortie(0, ...r.actes.map((l) => `acte ${l.n} : ${l.type}${l.cle ? ` (${l.cle})` : ''}`));
}

const revueDe = (x) => String(x ?? '').replace(/^P-(R-\d{4}-\d{2}-\d{2}-\d+)$/, '$1');
const proprio = {
  geste: () => geste(args.join(' ')),
  valider: () => geste(`valide ${args.join(' ')}`),
  envoye: () => geste(`envoye ${revueDe(positionnels()[0])} canal=${opt('canal', 'email')}`),
  reponse: () => geste(`reponse ${positionnels()[0]} ${positionnels()[1]}`),
  encaisse: () => geste(`encaisse ${positionnels()[0]} ${positionnels()[1] ?? 'libre'}`),
};

const cmds = {
  cycle, juger: jugerCmd, revue, etat, bilan, garde: gardeCmd, site, notification, migrer: migrerCmd, marche, cibler, brouillon, ...proprio,
  verifier: () => { const v = journal().verifier(); sortie(v.ok ? 0 : 1, v); },
};
if (!cmds[cmd]) {
  console.log(fs.readFileSync(ICI, 'utf8').split('\n').slice(1, 10).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(cmd ? 1 : 0);
}
await cmds[cmd]();
