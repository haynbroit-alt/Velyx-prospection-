#!/usr/bin/env node
// VELYX — de la demande réelle publiée à un premier euro encaissé.
//   velyx marche [--pages 5]            lit les projets publiés, mesure la concurrence par catégorie
//   velyx cibler <recette> [--max 250]   construit la liste à signaux pour une demande (fichier dans prive/)
//   velyx brouillon <recette>            proposition « preuve d'abord » + pari avec critère d'arrêt (dans prive/)
//   velyx etat                           argent réellement encaissé, paris ouverts, gestes attendus du propriétaire
//   velyx verifier                       intégrité du registre
//   propriétaire seulement : velyx envoye <pari> · velyx reponse <pari> <issue> · velyx encaisse <eur> <preuve>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Registre } from '../src/registre.js';
import { collecter } from '../src/sources/codeur.js';
import { chercher, resumer } from '../src/sources/sirene.js';
import { RECETTES, appliquer } from '../src/recettes.js';
import { MODELES } from '../src/brouillons.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRIVE = path.join(RACINE, 'prive');
const reg = new Registre(path.join(RACINE, 'registre', 'journal.jsonl'));
const [cmd, ...args] = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const jour = new Date().toISOString().slice(0, 10);
const med = (v) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
fs.mkdirSync(PRIVE, { recursive: true });

async function marche() {
  const L = await collecter({ pages: Number(opt('pages', 5)) });
  fs.writeFileSync(path.join(PRIVE, `codeur-${jour}.json`), JSON.stringify(L, null, 1));
  const ouverts = L.filter((x) => x.statut === 'Ouvert' && x.age_h !== null && x.age_h <= 24 * 14);
  const cat = {};
  for (const x of ouverts) (cat[x.tags[0] || '—'] ??= []).push(x.offres ?? 0);
  const table = Object.entries(cat).map(([c, o]) => ({ categorie: c, projets: o.length, offres_mediane: med(o) }))
    .sort((a, b) => a.offres_mediane - b.offres_mediane || b.projets - a.projets);
  console.table(table.filter((t) => t.projets >= 2));
  reg.ajouter({ type: 'observation', source: 'codeur.com, pages publiques', mesure: { lus: L.length, ouverts_14j: ouverts.length, offres_mediane: med(ouverts.map((x) => x.offres ?? 0)), par_categorie: table } });
}

async function cibler(id) {
  const r = RECETTES[id];
  if (!r) throw new Error(`recette inconnue. Disponibles : ${Object.keys(RECETTES).join(', ')}`);
  // --relire : réapplique la recette aux fiches brutes déjà lues aujourd'hui, sans réinterroger le registre.
  const brut = path.join(PRIVE, `${id}-${jour}.brut.json`);
  // À défaut des fiches brutes, repart de la liste du jour (déjà résumée) : seuls les signaux sont recalculés.
  const sortie = path.join(PRIVE, `${id}-${jour}.json`), relire = args.includes('--relire');
  let lu, entreprises;
  if (relire && fs.existsSync(brut)) lu = JSON.parse(fs.readFileSync(brut, 'utf8'));
  else if (relire && fs.existsSync(sortie)) { const s = JSON.parse(fs.readFileSync(sortie, 'utf8')); lu = { fiches: [], total: s.total_registre, complet: s.complet, lu_le: s.lu_le, lues: s.lues }; entreprises = s.cibles; }
  else lu = await chercher(r.params, { maxPages: Number(opt('max', 250)), journal: console.log });
  if (!entreprises) { fs.writeFileSync(brut, JSON.stringify(lu)); entreprises = lu.fiches.map(resumer); lu.lues = lu.fiches.length; }
  const { gardees, compte } = appliquer(r, entreprises);
  const fichier = sortie;
  fs.writeFileSync(fichier, JSON.stringify({ recette: id, annonce: r.annonce, besoin: r.besoin, source: 'SIRENE/RNE via recherche-entreprises.api.gouv.fr', lu_le: lu.lu_le, lues: lu.lues, total_registre: lu.total, complet: lu.complet, cibles: gardees }, null, 1));
  const csv = ['siren;nom;commune;departement;naf;effectif;creation;dirigeant;ca;annee_ca;signaux;fiche',
    ...gardees.map((e) => { const d = e.dirigeants[0]; return [e.siren, e.nom, e.commune, e.departement, e.naf, e.effectif, e.creation, d ? `${d.nom} (${d.qualite})` : '', e.ca?.ca ?? '', e.ca?.annee ?? '', e.signaux.map((s) => s.code).join('+'), e.fiche].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';'); })].join('\n');
  fs.writeFileSync(fichier.replace(/\.json$/, '.csv'), csv);
  console.log({ lues: lu.lues, total_registre: lu.total, complet: lu.complet, ...compte });
  reg.ajouter({ type: 'cible', recette: id, annonce: r.annonce, compte: { lues: lu.lues, total_registre: lu.total, complet: lu.complet, ...compte }, fichier_prive: path.relative(RACINE, fichier) });
}

// Le brouillon et son pari naissent ensemble : pas de proposition sans critère d'arrêt écrit avant l'envoi.
function brouillon(id) {
  const src = fs.readdirSync(PRIVE).filter((f) => f.startsWith(`${id}-`) && f.endsWith('.json') && !f.includes('.brut')).sort().at(-1);
  if (!src) throw new Error(`aucune liste pour ${id} : lancer d'abord « velyx cibler ${id} »`);
  const d = JSON.parse(fs.readFileSync(path.join(PRIVE, src), 'utf8'));
  const { compte } = appliquer({ garder: () => true, signaux: (e) => e.signaux, complet: (e) => e.complet }, d.cibles);
  const fichier = path.join(PRIVE, `brouillon-${id}-${jour}.md`);
  fs.writeFileSync(fichier, `<!-- Réponse à : ${d.annonce} -->\n\n${MODELES[id](d, compte)}\n`);
  const pid = `P-${id}-${jour}`;
  const pari = reg.lignes.find((l) => l.type === 'pari' && l.id === pid) ?? reg.ajouter({ type: 'pari', id: pid, annonce: d.annonce,
    hypothese: 'Une réponse accompagnée d’un échantillon réel, construit pour la demande, obtient une réponse du client sur une annonce à faible concurrence.',
    geste_proprietaire: `relire ${path.relative(RACINE, fichier)}, fixer le prix, l’envoyer depuis son compte codeur.com, puis consigner l’envoi`,
    critere_succes: 'le client répond (question, demande de devis ou d’échange) dans les 7 jours suivant l’envoi',
    critere_arret: 'aucune réponse 7 jours après l’envoi : pari perdu, consigné, et la leçon change la recette ou le canal',
    echeance: 'envoi + 7 jours', cout: { eur: 0 } });
  reg.ajouter({ type: 'brouillon', pari: pari.id, fichier: path.relative(RACINE, fichier) });
  console.log(`brouillon : ${path.relative(RACINE, fichier)}\npari : ${pari.id}`);
}

function etat() {
  const e = reg.etat();
  console.log(`Argent encaissé : ${e.encaisse_eur} €   ·   dépensé : ${e.depense_eur} €`);
  for (const p of e.paris) console.log(`\n[${p.id}] ${p.hypothese}\n  échéance ${p.echeance} · envoyé : ${p.envoye ? 'oui' : 'NON'} · issues : ${p.issues.join(', ') || 'aucune'}\n  geste attendu : ${p.geste}`);
}

// Actes du propriétaire : lui seul envoie, constate une réponse, encaisse.
const proprio = {
  envoye: () => reg.ajouter({ type: 'envoi', auteur: 'proprietaire', pari: args[0], canal: opt('canal', 'codeur.com') }),
  reponse: () => reg.ajouter({ type: 'reponse', auteur: 'proprietaire', pari: args[0], issue: args[1] }),
  encaisse: () => reg.ajouter({ type: 'encaissement', auteur: 'proprietaire', montant_eur: Number(args[0]), preuve: args[1] }),
};
const cmds = { marche, cibler: () => cibler(args[0]), brouillon: () => brouillon(args[0]), etat, ...Object.fromEntries(Object.entries(proprio).map(([k, f]) => [k, () => console.log(f())])), verifier: () => console.log(reg.verifier()) };
if (!cmds[cmd]) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 10).join('\n')); process.exit(cmd ? 1 : 0); }
await cmds[cmd]();
