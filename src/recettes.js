// Recettes de ciblage déclaratives (M5). Une recette est une donnée publique validée (etat/recettes/<id>.json) : le LLM
// peut en proposer sans écrire de code. Les signaux forment une bibliothèque fermée de primitives, chacune avec sa
// justification publique ; tout nouveau signal est du code, donc passe par une PR. appliquer() fait passer chaque fiche
// par controles.controlerListe avant les signaux. L'année vient de l'horloge injectée (plus de new Date() figé).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerHorloge, ageAns, valider, creerMagasin } from './socle.js';
import { controlerListe, dernierExercice, estPrincipal, bornesEffectif, sansAccents } from './controles.js';

/**
 * Paramètres SIRENE qu'une recette peut poser (liste de la spécification). « q » (texte libre) n'y est pas : une
 * recherche par nom passe par garder.nom_contient, liste fermée de mots, qui produit Recette.recherches.
 */
export const PARAMS_AUTORISES = Object.freeze(['activite_principale', 'section_activite_principale', 'departement', 'region',
  'tranche_effectif_salarie', 'etat_administratif', 'categorie_entreprise', 'est_rge', 'nature_juridique',
  'date_naissance_personne_min', 'date_naissance_personne_max', 'ca_min', 'ca_max']);

// ---------------------------------------------------------------------------------------------------------------------
// Bibliothèque fermée de signaux. Chaque primitive : (args, horloge) -> (e) -> {code, court, texte, justification}|null.
// court est montré dans un échantillon minimisé : jamais d'âge exact ni d'année de naissance.

const anDe = (horloge) => horloge.annee();
const principaux = (e) => (e?.dirigeants ?? []).filter(estPrincipal);

export const SIGNAUX = Object.freeze({
  dirigeant_age_min: ([n], horloge) => (e) => {
    const nes = principaux(e).map((d) => d.annee_naissance).filter(Number.isFinite);
    if (!nes.length || anDe(horloge) - Math.min(...nes) < n) return null;
    return { code: 'dirigeant_age_min', court: `dirigeant ${n} ans ou plus`, texte: `dirigeant principal de ${n} ans ou plus (tranche ; l’âge exact n’est pas diffusé)`, justification: 'âge du dirigeant tiré du registre national des entreprises, en tranche seulement' };
  },
  sans_codirigeant_moins_de: ([n], horloge) => (e) => {
    const ages = (e?.dirigeants ?? []).map((d) => d.annee_naissance).filter(Number.isFinite).map((a) => anDe(horloge) - a);
    if (!ages.length || ages.some((a) => a < n)) return null;
    return { code: 'sans_codirigeant_moins_de', court: `aucun codirigeant de moins de ${n} ans`, texte: `aucun dirigeant inscrit de moins de ${n} ans`, justification: 'dirigeants inscrits au registre national des entreprises' };
  },
  creation_moins_de_ans: ([n], horloge) => (e) => {
    const a = ageAns(e?.creation, horloge);
    if (a === null || a >= n) return null;
    return { code: 'creation_moins_de_ans', court: `créée depuis moins de ${n} ans`, texte: `immatriculée ${a < 1 ? 'il y a moins d’un an' : `il y a ${a} an(s)`} (création ou reprise, à vérifier)`, justification: 'date de création au répertoire SIRENE' };
  },
  creation_plus_de_ans: ([n], horloge) => (e) => {
    const a = ageAns(e?.creation, horloge);
    if (a === null || a < n) return null;
    return { code: 'creation_plus_de_ans', court: `plus de ${n} ans d’existence`, texte: `société créée il y a ${a} ans`, justification: 'date de création au répertoire SIRENE' };
  },
  rge: () => (e) => (e?.rge ? { code: 'rge', court: 'RGE', texte: 'qualifiée RGE (reconnu garant de l’environnement)', justification: 'qualification RGE publiée par l’ADEME, reprise par l’API' } : null),
  naf_prefixe: ([prefixes]) => (e) => {
    const naf = e?.naf ?? '';
    return prefixes.some((p) => naf.startsWith(p)) ? { code: 'naf_prefixe', court: `NAF ${naf}`, texte: `code NAF ${naf}`, justification: 'code d’activité principale au répertoire SIRENE' } : null;
  },
  resultat_positif_recent: ([ans = 3] = [], horloge) => (e) => {
    const ex = dernierExercice(e);
    if (!ex || !(ex.resultat_net > 0) || ex.annee < anDe(horloge) - ans) return null;
    return { code: 'resultat_positif_recent', court: `bénéficiaire ${ex.annee}`, texte: `résultat net publié positif (exercice ${ex.annee})`, justification: 'comptes annuels publiés (INPI), exercice récent seulement', financier: true };
  },
  categorie_dans: ([liste]) => (e) => (liste.includes(e?.categorie) ? { code: 'categorie_dans', court: `catégorie ${e.categorie}`, texte: `catégorie INSEE ${e.categorie}`, justification: 'catégorie d’entreprise calculée par l’INSEE' } : null),
  employeur_idcc: () => (e) => (e?.idcc?.length ? { code: 'employeur_idcc', court: 'employeur', texte: 'déclare une convention collective (structure employeuse)', justification: 'convention collective (IDCC) déclarée au répertoire' } : null),
});
// Forme des arguments de chaque primitive : 'entier', 'liste' (de textes), suivis de '?' si facultatif.
const ARGS = { dirigeant_age_min: ['entier'], sans_codirigeant_moins_de: ['entier'], creation_moins_de_ans: ['entier'], creation_plus_de_ans: ['entier'],
  rge: [], naf_prefixe: ['liste'], resultat_positif_recent: ['entier?'], categorie_dans: ['liste'], employeur_idcc: [] };

// ---------------------------------------------------------------------------------------------------------------------
// Schéma d'une recette (socle.valider : clé inconnue, code ou URL hors de www.codeur.com refusés à toute profondeur).

const DEP = '^(?:\\d{2}|2A|2B|97\\d)$';
const NAF = '^\\d{2}\\.\\d{2}[A-Z]$';
const VAR = (nom) => ({ type: 'objet', champs: { var: { type: 'enum', requis: true, valeurs: nom ? [nom] : ['departement', 'mois'] } } });
const VALEUR_PARAM = { ou: [
  { type: 'texte', min: 1, max: 400, motif: '^[A-Za-z0-9.,_-]+$' },
  { type: 'objet', champs: { expr: { type: 'texte', requis: true, motif: '^annee-\\d{1,3}(?:-\\d{2}-\\d{2})?$' } } },
  VAR('departement'),
] };
export const SCHEMA_RECETTE = Object.freeze({
  type: 'objet', champs: {
    id: { type: 'texte', requis: true, motif: '^[a-z0-9-]{3,40}$' },
    annonce: { type: 'texte', requis: true, nul: true, motif: '^https://www\\.codeur\\.com/projects/\\d+(?:-[a-z0-9-]+)?$' },
    besoin: { type: 'texte', requis: true, min: 10, max: 400 },
    variables: { type: 'objet', champs: {
      departement: { type: 'objet', champs: { defaut: { type: 'texte', requis: true, motif: DEP } } },
      mois: { type: 'objet', champs: { defaut: { type: 'entier', requis: true, min: 1, max: 120 } } },
    } },
    params: { type: 'objet', requis: true, champs: Object.fromEntries(PARAMS_AUTORISES.map((k) => [k, VALEUR_PARAM])) },
    garder: { type: 'objet', requis: true, champs: {
      departements: { type: 'liste', min: 1, max: 120, items: { ou: [{ type: 'texte', motif: DEP }, VAR('departement')] } },
      categories: { type: 'liste', min: 1, items: { type: 'enum', valeurs: ['PME', 'ETI', 'GE'] } },
      exclure_categories: { type: 'liste', min: 1, items: { type: 'enum', valeurs: ['PME', 'ETI', 'GE'] } },
      ca_max: { type: 'nombre', min: 0 },
      age_dirigeant_min: { type: 'entier', min: 18, max: 110 },
      creation_moins_de_mois: { ou: [{ type: 'entier', min: 1, max: 120 }, VAR('mois')] },
      nom_contient: { type: 'liste', min: 1, max: 8, items: { type: 'texte', motif: '^[a-z]{3,20}$' } },
      exclure_natures: { type: 'liste', min: 1, max: 20, items: { type: 'texte', motif: '^\\d{4}$' } },
    } },
    cible_taille: { type: 'enum', requis: true, valeurs: ['micro', 'pme', 'toutes'] },
    vise_dirigeant: { type: 'bool', requis: true },
    exceptions_ratio: { type: 'liste', requis: true, max: 50, items: { type: 'texte', motif: NAF } },
    signaux: { type: 'liste', requis: true, max: 12, items: { type: 'objet', champs: {
      primitive: { type: 'enum', requis: true, valeurs: Object.keys(SIGNAUX) },
      args: { type: 'liste', requis: true, max: 3, items: { ou: [{ type: 'entier', min: 0, max: 200 }, { type: 'liste', min: 1, max: 40, items: { type: 'texte', min: 1, max: 20, motif: '^[A-Za-z0-9.]+$' } }] } },
      signal: { type: 'texte', motif: '^[a-z_]{2,30}$' },
      court: { type: 'texte', min: 2, max: 40 },
      justification: { type: 'texte', requis: true, min: 10, max: 300 },
    } } },
    prioritaire: { type: 'texte', motif: '^[a-z_]{2,30}$' },
    complet: { type: 'objet', requis: true, champs: { ca_recent: { type: 'bool', requis: true }, dirigeant_principal: { type: 'bool', requis: true } } },
    gabarit: { type: 'texte', requis: true, motif: '^[a-z0-9-]{3,40}$' },
    limites: { type: 'liste', max: 6, items: { type: 'texte', min: 5, max: 300 } },
    auteur: { type: 'enum', requis: true, valeurs: ['humain', 'llm'] },
    statut: { type: 'enum', requis: true, valeurs: ['candidate', 'active'] },
  },
});

/** Validation complète : schéma, puis cohérence (arguments des primitives, codes de signal, variables utilisées). */
export function validerRecette(spec) {
  const v = valider(SCHEMA_RECETTE, spec);
  const erreurs = [...v.erreurs];
  if (!v.ok) return { ok: false, erreurs };
  const codes = new Set();
  spec.signaux.forEach((s, i) => {
    const forme = ARGS[s.primitive], min = forme.filter((f) => !f.endsWith('?')).length;
    if (s.args.length < min || s.args.length > forme.length) erreurs.push(`signaux[${i}].args : ${forme.length} argument(s) attendu(s) pour ${s.primitive}`);
    s.args.forEach((a, j) => { const f = forme[j]?.replace('?', ''); if (f && (f === 'liste') !== Array.isArray(a)) erreurs.push(`signaux[${i}].args[${j}] : ${f} attendu`); });
    const code = s.signal ?? s.primitive;
    if (codes.has(code)) erreurs.push(`signaux[${i}] : code de signal « ${code} » en double`);
    codes.add(code);
  });
  if (spec.prioritaire && !codes.has(spec.prioritaire)) erreurs.push(`prioritaire : aucun signal « ${spec.prioritaire} »`);
  const usages = JSON.stringify([spec.params, spec.garder]).match(/"var":"([a-z_]+)"/g) ?? [];
  for (const u of usages) { const nom = u.slice(7, -1); if (!spec.variables?.[nom]) erreurs.push(`variable « ${nom} » utilisée sans être déclarée`); }
  return { ok: erreurs.length === 0, erreurs };
}

// ---------------------------------------------------------------------------------------------------------------------
// Compilation.

const RE_EXPR = /^annee-(\d{1,3})(-\d{2}-\d{2})?$/;
const DEP_RE = new RegExp(DEP);

function resoudreVariables(spec, variables) {
  const out = {};
  for (const [nom, d] of Object.entries(spec.variables ?? {})) {
    const v = variables[nom] ?? d.defaut;
    if (nom === 'departement' && !DEP_RE.test(String(v))) throw new Error(`recette ${spec.id} : département « ${v} » illisible`);
    if (nom === 'mois' && !(Number.isInteger(v) && v >= 1 && v <= 120)) throw new Error(`recette ${spec.id} : mois « ${v} » hors de 1 à 120`);
    out[nom] = nom === 'departement' ? String(v) : v;
  }
  for (const k of Object.keys(variables)) if (!Object.hasOwn(out, k)) throw new Error(`recette ${spec.id} : variable « ${k} » inconnue`);
  return out;
}
const valeur = (x, vars, an) => {
  if (x && typeof x === 'object' && 'var' in x) return vars[x.var];
  if (x && typeof x === 'object' && 'expr' in x) { const m = RE_EXPR.exec(x.expr); return `${an - Number(m[1])}${m[2] ?? ''}`; }
  return x;
};
/** Date 'AAAA-MM-JJ' située n mois avant le jour donné (jour ramené au dernier du mois si besoin). */
function moisAvant(jour, n) {
  const [a, m, j] = jour.split('-').map(Number);
  const total = a * 12 + (m - 1) - n, an = Math.floor(total / 12), mo = total % 12;
  const dernier = new Date(Date.UTC(an, mo + 1, 0)).getUTCDate();
  return `${an}-${String(mo + 1).padStart(2, '0')}-${String(Math.min(j, dernier)).padStart(2, '0')}`;
}
const motsDuNom = (nom) => ` ${sansAccents(nom).toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;

/**
 * Recette compilée : {id, annonce, besoin, params (expressions et variables résolues), recherches, garder(e), signaux(e),
 * complet(e), rang(e), cible_taille, vise_dirigeant, exceptions_ratio, gabarit, limites, codes_signaux, variables,
 * horloge, spec}. variables : valeurs des variables déclarées (département, mois), sinon leurs défauts.
 */
export function compiler(spec, horloge = creerHorloge(), variables = {}) {
  const v = validerRecette(spec);
  if (!v.ok) throw new Error(`recette « ${spec?.id ?? '?'} » refusée : ${v.erreurs.join(' ; ')}`);
  const an = horloge.annee(), vars = resoudreVariables(spec, variables);
  const params = Object.fromEntries(Object.entries(spec.params).map(([k, x]) => [k, valeur(x, vars, an)]));
  const g = spec.garder;
  const deps = g.departements ? g.departements.map((d) => valeur(d, vars, an)) : null;
  const mois = g.creation_moins_de_mois !== undefined ? valeur(g.creation_moins_de_mois, vars, an) : null;
  const depuis = mois ? moisAvant(horloge.jour(), mois) : null, aujourdhui = horloge.jour();
  const mots = g.nom_contient ?? null;

  const garder = (e) => {
    if (deps && !deps.includes(e?.departement)) return false;
    if (g.categories && !g.categories.includes(e?.categorie)) return false;
    if (g.exclure_categories && g.exclure_categories.includes(e?.categorie)) return false;
    if (g.ca_max !== undefined && dernierExercice(e)?.ca > g.ca_max) return false;
    if (g.age_dirigeant_min !== undefined && !principaux(e).some((d) => Number.isFinite(d.annee_naissance) && d.annee_naissance <= an - g.age_dirigeant_min)) return false;
    if (depuis && !(typeof e?.creation === 'string' && e.creation.slice(0, 10) >= depuis && e.creation.slice(0, 10) <= aujourdhui)) return false;
    if (mots && !mots.some((m) => motsDuNom(e?.nom).includes(` ${m}`))) return false;
    if (g.exclure_natures && g.exclure_natures.includes(String(e?.nature_juridique ?? ''))) return false;
    return true;
  };
  const fonctions = spec.signaux.map((s) => ({ s, f: SIGNAUX[s.primitive](s.args, horloge) }));
  const signaux = (e) => fonctions.map(({ s, f }) => {
    const r = f(e);
    return r && { ...r, code: s.signal ?? s.primitive, primitive: s.primitive, court: s.court ?? r.court, justification: s.justification };
  }).filter(Boolean);
  const complet = (e) => {
    const ex = dernierExercice(e);
    if (spec.complet.ca_recent && !(ex?.ca > 0 && ex.annee >= an - 3)) return false;
    if (spec.complet.dirigeant_principal && !principaux(e).length) return false;
    return true;
  };
  const rang = (e) => 10 * Number(Boolean(spec.prioritaire && e.signaux?.some((s) => s.code === spec.prioritaire))) + (e.signaux?.length ?? 0);
  // Recherche par nom : une requête par mot (« q » ne vient que de cette liste fermée), le filtre garder() reste appliqué.
  const recherches = mots ? mots.map((m) => ({ ...params, q: m })) : [params];
  return {
    id: spec.id, annonce: spec.annonce, besoin: spec.besoin, params, recherches, garder, signaux, complet, rang,
    cible_taille: spec.cible_taille, vise_dirigeant: spec.vise_dirigeant, exceptions_ratio: [...spec.exceptions_ratio],
    gabarit: spec.gabarit, limites: [...(spec.limites ?? [])], codes_signaux: spec.signaux.map((s) => s.signal ?? s.primitive),
    variables: vars, horloge, spec,
  };
}

/**
 * Nombres d'une recette compilée que les gabarits peuvent citer ({{param.<cle>}}) : seuils de garder, bornes d'effectif
 * des tranches demandées, premier argument numérique de chaque signal (sous son code).
 */
export function chiffresRecette(recette) {
  const g = recette.spec.garder, out = {};
  if (g.age_dirigeant_min !== undefined) out.age_dirigeant_min = g.age_dirigeant_min;
  if (g.creation_moins_de_mois !== undefined) out.creation_moins_de_mois = typeof g.creation_moins_de_mois === 'number' ? g.creation_moins_de_mois : recette.variables.mois;
  const tranches = String(recette.params.tranche_effectif_salarie ?? '').split(',').filter(Boolean).map(bornesEffectif);
  const mins = tranches.map((t) => t.min).filter(Number.isFinite), maxs = tranches.map((t) => t.max).filter(Number.isFinite);
  if (mins.length) out.effectif_min = Math.min(...mins);
  if (maxs.length && maxs.length === tranches.filter((t) => t.min !== null).length) out.effectif_max = Math.max(...maxs);
  for (const s of recette.spec.signaux) { const n = s.args.find(Number.isInteger); if (n !== undefined) out[s.signal ?? s.primitive] = n; }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Application.

const FINANCIERS = new Set(['rentable', 'resultat_positif_recent']);
const caDe = (e) => dernierExercice(e)?.ca ?? 0;

/**
 * Applique une recette (compilée, ou objet v1 {garder, signaux, complet, rang}) : garder() délimite le périmètre, puis
 * controles.controlerListe, puis les signaux et le rang. ctx : {horloge, oppositions, dict, lecture, regles, neutraliser,
 * revue_echantillon, tires}. Les fiches à comptes périmés (G2) perdent leurs signaux financiers et ne sont pas complètes.
 * @returns {{gardees, quarantaine, exclues, compte, resultats}}
 */
export function appliquer(recette, entreprises, ctx = {}) {
  const horloge = ctx.horloge ?? recette.horloge ?? creerHorloge();
  const dans = entreprises.filter((e) => (recette.garder ? recette.garder(e) : true));
  const L = controlerListe(dans, ctx.lecture ?? { complet: true }, recette, { ...ctx, horloge });
  const enrichir = (e) => {
    const perime = e.controle.drapeaux.includes('comptes_perimes');
    let signaux = recette.signaux ? recette.signaux(e) : e.signaux ?? [];
    if (perime) signaux = signaux.filter((s) => !s.financier && !FINANCIERS.has(s.code) && s.primitive !== 'resultat_positif_recent');
    const complet = !perime && Boolean(recette.complet ? recette.complet({ ...e, signaux }) : e.complet);
    return { ...e, signaux, complet };
  };
  const rang = recette.rang ?? ((e) => e.signaux.length);
  const trier = (l) => l.sort((a, b) => rang(b) - rang(a) || Number(b.complet) - Number(a.complet) || caDe(b) - caDe(a) || String(a.siren).localeCompare(String(b.siren)));
  const gardees = trier(L.retenues.map(enrichir)), quarantaine = trier(L.quarantaine.map(enrichir));
  const parSignal = Object.fromEntries((recette.codes_signaux ?? []).map((c) => [c, 0]));
  for (const e of gardees) for (const s of e.signaux) parSignal[s.code] = (parSignal[s.code] ?? 0) + 1;
  return {
    gardees, quarantaine, exclues: L.exclues,
    compte: {
      lues: entreprises.length, hors_recette: entreprises.length - dans.length, controlees: dans.length,
      retenues: gardees.length, quarantaine: quarantaine.length, exclues: L.exclues.length,
      avec_signal: gardees.filter((e) => e.signaux.length).length, completes: gardees.filter((e) => e.complet).length,
      par_signal: parSignal, par_controle: L.compte.par_controle, par_drapeau: L.compte.par_drapeau,
    },
    resultats: L.resultats,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Chargement et écriture (etat/recettes/<id>.json, public : ni nom ni SIREN).

const DOSSIER = 'etat/recettes/';

/** Recettes du statut demandé, validées : {[id]: spec}. Lève sur une recette invalide ou mal nommée. */
export function chargerRecettes(magasin, { statut = 'active' } = {}) {
  const out = {};
  for (const rel of magasin.lister(DOSSIER).filter((r) => r.endsWith('.json'))) {
    const spec = magasin.lireJson(rel);
    if (statut && spec?.statut !== statut) continue;
    const v = validerRecette(spec);
    if (!v.ok) throw new Error(`${rel} : recette invalide : ${v.erreurs.join(' ; ')}`);
    if (`${DOSSIER}${spec.id}.json` !== rel) throw new Error(`${rel} : l’id « ${spec.id} » ne correspond pas au nom du fichier`);
    out[spec.id] = spec;
  }
  return out;
}

/** Écrit une recette validée sous etat/recettes/ (par le magasin, donc après le contrôle antifuite). */
export function ecrireRecette(magasin, spec) {
  const v = validerRecette(spec);
  if (!v.ok) throw new Error(`recette « ${spec?.id ?? '?'} » refusée : ${v.erreurs.join(' ; ')}`);
  return magasin.ecrirePublic(`${DOSSIER}${spec.id}.json`, spec);
}

/** Une recette proposée par le LLM entre toujours en statut « candidate ». Une recette active ne se remplace pas ainsi. */
export function proposerRecette(magasin, spec) {
  const existante = magasin.lireJson(`${DOSSIER}${spec?.id}.json`);
  if (existante?.statut === 'active') throw new Error(`recette « ${spec.id} » déjà active : une modification passe par une PR`);
  return ecrireRecette(magasin, { ...spec, auteur: 'llm', statut: 'candidate' });
}

/** Passe une candidate en « active » après une exécution à blanc réussie et une sonde dont le total est entre 1 et 50 000. */
export function activerRecette(magasin, id, { a_blanc, sonde } = {}) {
  const spec = magasin.lireJson(`${DOSSIER}${id}.json`);
  if (!spec) throw new Error(`recette « ${id} » introuvable`);
  if (a_blanc?.ok !== true) throw new Error(`recette « ${id} » : exécution à blanc non réussie`);
  if (!(Number.isFinite(sonde?.total) && sonde.total >= 1 && sonde.total <= 50_000)) throw new Error(`recette « ${id} » : sonde hors de 1 à 50 000 (${sonde?.total})`);
  return ecrireRecette(magasin, { ...spec, statut: 'active' });
}

// ---------------------------------------------------------------------------------------------------------------------
// Compatibilité v1 : bin/velyx.js importe RECETTES (recettes actives compilées au démarrage, horloge réelle).

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RECETTES = Object.fromEntries(Object.entries(chargerRecettes(creerMagasin(RACINE))).map(([id, s]) => [id, compiler(s, creerHorloge())]));
