// Source de cibles : le registre officiel des entreprises (SIRENE + RNE), via l'API publique « Recherche d'entreprises »
// (recherche-entreprises.api.gouv.fr, gratuite, sans clé, ~7 requêtes/s ; la porte réseau du socle reste sous 4 req/s).
// http injecté (socle.creerHttp) : liste blanche, budget, reprises. Trois lectures :
// - compter : 1 requête (per_page=1) ;
// - echantillonPages : k pages tirées sans remise par un PRNG à graine (même graine, mêmes pages) ; echantillonRecherches,
//   la même chose sur l'union de plusieurs recherches (recette par nom), chaque page lue dans sa propre recherche ;
// - chercher : lecture complète, coût estimé AVANT la première page (BudgetEpuise sinon), partition par département
//   seulement au plafond de 10 000 résultats de l'API (au-delà de la page 400, l'API répond HTTP 400), reprenable.
// Les fiches brutes nomment des personnes : elles ne quittent jamais prive/. resumer() n'en garde que le nécessaire.
import { creerHttp, creerBudget, creerHorloge, empreinte, sha256Texte, BudgetEpuise } from '../socle.js';

export const BASE = 'https://recherche-entreprises.api.gouv.fr/search';

export const TRANCHES = { NN: 'non renseigné', '00': '0 salarié', '01': '1-2', '02': '3-5', '03': '6-9', '11': '10-19',
  '12': '20-49', '21': '50-99', '22': '100-199', '31': '200-249', '32': '250-499', '41': '500-999', '42': '1000-1999' };

/**
 * Paramètres de recherche admis (les autres sont refusés avant tout appel). « q » (recherche plein texte sur le nom)
 * s'ajoute à la liste de la spécification : la recette courtiers-construction en a besoin (nom contenant btp,
 * construction, decennale…). page, per_page, minimal et include sont fixés par ce module.
 */
export const PARAMS_AUTORISES = Object.freeze(['activite_principale', 'section_activite_principale', 'departement', 'region',
  'tranche_effectif_salarie', 'etat_administratif', 'categorie_entreprise', 'est_rge', 'nature_juridique',
  'date_naissance_personne_min', 'date_naissance_personne_max', 'ca_min', 'ca_max', 'q']);
/** Plafond de l'API : total_results ne dépasse pas 10 000 et la page 401 renvoie HTTP 400. */
export const PLAFOND_RESULTATS = 10_000;
export const PAGES_MAX = 400;
export const PAR_PAGE = 25;
const INCLURE = 'siege,dirigeants,finances';

/** Départements par région (codes INSEE des régions), pour partitionner une requête régionale. */
export const REGIONS = Object.freeze({
  11: ['75', '77', '78', '91', '92', '93', '94', '95'], 24: ['18', '28', '36', '37', '41', '45'],
  27: ['21', '25', '39', '58', '70', '71', '89', '90'], 28: ['14', '27', '50', '61', '76'], 32: ['02', '59', '60', '62', '80'],
  44: ['08', '10', '51', '52', '54', '55', '57', '67', '68', '88'], 52: ['44', '49', '53', '72', '85'], 53: ['22', '29', '35', '56'],
  75: ['16', '17', '19', '23', '24', '33', '40', '47', '64', '79', '86', '87'],
  76: ['09', '11', '12', '30', '31', '32', '34', '46', '48', '65', '66', '81', '82'],
  84: ['01', '03', '07', '15', '26', '38', '42', '43', '63', '69', '73', '74'], 93: ['04', '05', '06', '13', '83', '84'], 94: ['2A', '2B'],
  '01': ['971'], '02': ['972'], '03': ['973'], '04': ['974'], '06': ['976'],
});
export const DEPARTEMENTS = Object.freeze([...new Set(Object.values(REGIONS).flat())].sort());

/** Paramètre hors de PARAMS_AUTORISES, ou valeur qui n'est pas un texte simple. */
export class ParametreInterdit extends Error {
  constructor(cle, motif) { super(`paramètre SIRENE refusé : ${cle} (${motif})`); this.name = 'ParametreInterdit'; this.cle = cle; }
}
/** Réponse non 2xx de l'API (le corps n'est jamais repris : il peut citer la requête). */
export class ErreurSirene extends Error {
  constructor(status, page) { super(`SIRENE HTTP ${status}${page ? ` (page ${page})` : ''}`); this.name = 'ErreurSirene'; this.status = status; this.page = page; }
}

/** Paramètres vérifiés et convertis en textes ; lève ParametreInterdit. */
export function verifierParams(params) {
  if (params === null || typeof params !== 'object' || Array.isArray(params)) throw new ParametreInterdit('(racine)', 'objet attendu');
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (!PARAMS_AUTORISES.includes(k)) throw new ParametreInterdit(k, 'clé hors de la liste autorisée');
    if (!['string', 'number', 'boolean'].includes(typeof v)) throw new ParametreInterdit(k, 'texte, nombre ou booléen attendu');
    const s = String(v);
    if (!s || s.length > 2000 || /[\u0000-\u001f]/.test(s)) throw new ParametreInterdit(k, 'valeur vide, trop longue ou à caractère de contrôle');
    out[k] = s;
  }
  return out;
}

const urlDe = (params, page, parPage, inclure) => `${BASE}?${new URLSearchParams({ ...params, page: String(page), per_page: String(parPage),
  minimal: 'true', ...(inclure ? { include: INCLURE } : {}) })}`;

async function lirePage(http, params, page, parPage = PAR_PAGE, inclure = true) {
  const r = await http.get(urlDe(params, page, parPage, inclure), { source: 'sirene', format: 'json' });
  if (!(r.status >= 200 && r.status < 300)) throw new ErreurSirene(r.status, page);
  const c = r.corps ?? {};
  return { results: Array.isArray(c.results) ? c.results : [], total: Number(c.total_results) || 0, total_pages: Number(c.total_pages) || 0, lu_le: r.lu_le };
}

/** Nombre de résultats d'une requête : exactement 1 requête (per_page=1). total_pages est compté à 25 par page. */
export async function compter(http, params) {
  const p = verifierParams(params);
  const r = await lirePage(http, p, 1, 1, false);
  return { total: r.total, total_pages: Math.ceil(r.total / PAR_PAGE), plafond: r.total >= PLAFOND_RESULTATS, lu_le: r.lu_le };
}

/** PRNG déterministe (mulberry32) initialisé par l'empreinte de la graine. */
function prng(graine) {
  let a = parseInt(sha256Texte(String(graine)).slice(0, 8), 16) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** k rangs tirés sans remise parmi 1..n, triés (mélange partiel à graine, sans remise). */
function tirer(n, k, graine) {
  if (graine === undefined || graine === null || graine === '') throw new TypeError('tirerPages : graine requise (tirage reproductible)');
  const pool = Array.from({ length: n }, (_, i) => i + 1), alea = prng(graine), m = Math.min(Math.max(0, Math.trunc(k) || 0), n);
  for (let i = 0; i < m; i++) { const j = i + Math.floor(alea() * (n - i)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, m).sort((x, y) => x - y);
}

/** k numéros de page tirés sans remise parmi 1..min(totalPages, 400), triés ; même graine, mêmes pages. */
export function tirerPages(totalPages, k, graine) {
  return tirer(Math.min(Math.max(0, Math.trunc(totalPages) || 0), PAGES_MAX), k, graine);
}

/**
 * Échantillon : k pages tirées au sort (k requêtes). total_pages vient d'un compter() antérieur ; s'il manque, un
 * compter() est fait d'abord (1 requête de plus).
 */
export async function echantillonPages(http, params, { k = 2, graine, total_pages } = {}) {
  const p = verifierParams(params);
  if (graine === undefined || graine === null || graine === '') throw new TypeError('echantillonPages : graine requise (tirage reproductible)');
  let tp = total_pages, total = null, lu_le = null;
  if (tp === undefined || tp === null) { const c = await compter(http, p); tp = c.total_pages; total = c.total; lu_le = c.lu_le; }
  const pages = tirerPages(tp, k, graine), fiches = [];
  for (const n of pages) {
    const r = await lirePage(http, p, n);
    fiches.push(...r.results);
    total = r.total; lu_le ??= r.lu_le;
  }
  return { fiches, pages, total: total ?? 0, lu_le };
}

/**
 * Échantillon d'une recette à plusieurs recherches (recherche par nom : une requête par mot) : la population tirée est
 * celle que la sonde a comptée, l'union des recherches. k pages sont tirées sans remise parmi toutes leurs pages, chacune
 * lue dans SA recherche avec un numéro calculé sur SON total (jamais les paramètres communs sans « q »). totaux : total de
 * chaque recherche, dans l'ordre (sonde) ; s'il en manque un, un compter() par recherche est fait d'abord. Fiches
 * dédoublonnées par SIREN (une société peut répondre à deux mots).
 * → {fiches, pages: rangs tirés dans la population, tirage: [{q, page}], total: somme des totaux, totaux, lu_le}
 */
export async function echantillonRecherches(http, recherches, { k = 2, graine, totaux } = {}) {
  const ps = (Array.isArray(recherches) ? recherches : []).map(verifierParams);
  if (!ps.length) throw new TypeError('echantillonRecherches : au moins une recherche attendue');
  if (graine === undefined || graine === null || graine === '') throw new TypeError('echantillonRecherches : graine requise (tirage reproductible)');
  let tot = Array.isArray(totaux) && totaux.length === ps.length && totaux.every((x) => Number.isFinite(x) && x >= 0) ? [...totaux] : null, lu_le = null;
  if (!tot) { tot = []; for (const p of ps) { const c = await compter(http, p); tot.push(c.total); lu_le ??= c.lu_le; } }
  const pagesDe = tot.map((t) => Math.min(Math.ceil(t / PAR_PAGE), PAGES_MAX));
  const rangs = tirer(pagesDe.reduce((a, b) => a + b, 0), k, graine);
  const tirage = rangs.map((r) => { let i = 0, n = r; while (n > pagesDe[i]) { n -= pagesDe[i]; i++; } return { i, page: n }; });
  const vus = new Set(), fiches = [];
  for (const t of tirage) {
    const r = await lirePage(http, ps[t.i], t.page);
    for (const f of r.results) { if (f?.siren && vus.has(f.siren)) continue; if (f?.siren) vus.add(f.siren); fiches.push(f); }
    lu_le ??= r.lu_le;
  }
  return { fiches, pages: rangs, tirage: tirage.map((t) => ({ q: ps[t.i].q ?? null, page: t.page })), total: tot.reduce((a, b) => a + b, 0), totaux: tot, lu_le };
}

/** Départements d'une requête : ceux qu'elle nomme, sinon ceux de sa région, sinon tous. */
export function departementsDe(params) {
  if (params.departement) return [...new Set(String(params.departement).split(',').map((d) => d.trim()).filter(Boolean))];
  if (params.region) return [...new Set(String(params.region).split(',').flatMap((r) => REGIONS[r.trim()] ?? []))];
  return [...DEPARTEMENTS];
}

/**
 * Lecture complète.
 * v2 : chercher(http, params, {maxRequetes = 400, partition = 'auto', reprise, journal})
 *   → {fiches, total, totaux_partition: {[dep]: total}|null, total_partitions, pages_lues, complet, lu_le, requetes}.
 *   1 requête de compte d'abord ; partition par département si total ≥ 10 000 (partition 'auto'), toujours
 *   ('departement') ou jamais ('non'). Le coût (comptes + pages) est estimé avant la première page : s'il dépasse
 *   maxRequetes, BudgetEpuise est levée sans lire de page. complet = toutes les pages lues, aucun lot au plafond, et
 *   la somme des partitions égale au total (au moins égale quand le total est lui-même au plafond). Les fiches sont
 *   dédoublonnées par SIREN. reprise : objet {clé de page → résultats} rempli au fil de la lecture ; une page déjà
 *   présente ne coûte aucune requête (à garder sous prive/cache/, purgé en fin de cycle).
 * v1 (compatibilité bin/velyx.js) : chercher(params, {maxPages = 250, journal}) → {fiches, total, pages_lues, complet, lu_le}.
 */
export async function chercher(a, b, c) {
  if (a && typeof a.get === 'function') return chercherV2(a, b, c ?? {});
  return chercherV1(a, b ?? {});
}

async function chercherV2(http, params, { maxRequetes = PAGES_MAX, partition = 'auto', reprise = null, journal = () => {} } = {}) {
  const p = verifierParams(params);
  if (!['auto', 'departement', 'non'].includes(partition)) throw new TypeError(`chercher : partition « ${partition} » inconnue (auto, departement, non)`);
  if (!(Number(maxRequetes) >= 1)) throw new BudgetEpuise('sirene (maxRequetes)', maxRequetes);
  let requetes = 0;
  const cleDe = (q, n) => `${empreinte(q)}#${n}`;
  const compte = await compter(http, p); requetes++;
  const partitionner = partition === 'departement' || (partition === 'auto' && compte.plafond);
  let lots;
  if (!partitionner) lots = [{ dep: null, params: p, total: compte.total, total_pages: compte.total_pages, plafond: compte.plafond }];
  else {
    const deps = departementsDe(p);
    if (requetes + deps.length > maxRequetes) throw new BudgetEpuise(`sirene : ${deps.length} comptes de partition avant toute page`, maxRequetes);
    lots = [];
    for (const dep of deps) {
      const q = { ...p, departement: dep }, k = await compter(http, q); requetes++;
      lots.push({ dep, params: q, total: k.total, total_pages: k.total_pages, plafond: k.plafond });
    }
  }
  const aLire = lots.flatMap((l) => Array.from({ length: Math.min(l.total_pages, PAGES_MAX) }, (_, i) => ({ lot: l, n: i + 1 })));
  const neuves = aLire.filter(({ lot, n }) => !(reprise && Object.hasOwn(reprise, cleDe(lot.params, n)))).length;
  if (requetes + neuves > maxRequetes) throw new BudgetEpuise(`sirene : ${requetes + neuves} requêtes nécessaires (${neuves} pages)`, maxRequetes);
  const parSiren = new Map(), sansSiren = [];
  let pagesLues = 0;
  for (const { lot, n } of aLire) {
    const cle = cleDe(lot.params, n);
    let res;
    if (reprise && Object.hasOwn(reprise, cle)) res = reprise[cle];
    else { res = (await lirePage(http, lot.params, n)).results; requetes++; if (reprise) reprise[cle] = res; }
    pagesLues++;
    for (const f of res) { if (f?.siren) { if (!parSiren.has(f.siren)) parSiren.set(f.siren, f); } else sansSiren.push(f); }
    if (pagesLues % 25 === 0) journal(`  ${pagesLues}/${aLire.length} pages`);
  }
  const somme = lots.reduce((s, l) => s + l.total, 0);
  const tout = pagesLues === aLire.length && lots.every((l) => !l.plafond);
  const coherent = !partitionner || (compte.plafond ? somme >= compte.total : somme === compte.total);
  return {
    fiches: [...parSiren.values(), ...sansSiren], total: compte.total,
    totaux_partition: partitionner ? Object.fromEntries(lots.map((l) => [l.dep, l.total])) : null,
    total_partitions: partitionner ? somme : null,
    pages_lues: pagesLues, complet: tout && coherent, lu_le: compte.lu_le, requetes,
  };
}

async function chercherV1(params, { maxPages = 250, journal = () => {}, http } = {}) {
  const p = verifierParams(params);
  const max = Math.min(Math.max(1, Math.trunc(Number(maxPages)) || 1), PAGES_MAX);
  const horloge = creerHorloge();
  const h = http ?? creerHttp({ budget: creerBudget({ codeur: 0, sirene: max * 4 + 4, duree_s: 7200 }, horloge), horloge });
  const premiere = await lirePage(h, p, 1);
  const totalPages = premiere.total_pages || Math.ceil(premiere.total / PAR_PAGE);
  const pages = Math.min(totalPages, max);
  const fiches = [...premiere.results];
  for (let n = 2; n <= pages; n++) {
    fiches.push(...(await lirePage(h, p, n)).results);
    if (n % 25 === 0) journal(`  ${n}/${pages} pages`);
  }
  return { fiches, total: premiere.total, pages_lues: Math.max(1, pages), complet: pages === totalPages && premiere.total < PLAFOND_RESULTATS, lu_le: premiere.lu_le };
}

// --- résumé d'une fiche ------------------------------------------------------------------------------------------------

const CAC = /commissaire/i;
const nombre = (x) => (x === null || x === undefined || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));

/**
 * Fiche brute → Entreprise (contrats.js), plus statut_diffusion ('O' diffusible, 'P' partiellement diffusible ; null si
 * l'API ne le donne pas). Garde opposition (= opposition_diffusion_commerciale si c'est un booléen, sinon null), nature juridique, état administratif, fermeture, dirigeants
 * personnes physiques (premier prénom, nom, année de naissance), nombre de dirigeants personnes morales, 3 exercices au
 * plus (du plus récent), IDCC, code de tranche d'effectif. Ne garde jamais date_de_naissance ni nationalite, ni
 * l'adresse ; écarte toujours les commissaires aux comptes (personnes physiques ou morales).
 */
export function resumer(f) {
  const s = f.siege || {};
  const finances = f.finances && typeof f.finances === 'object' ? Object.entries(f.finances)
    .filter(([a]) => /^\d{4}$/.test(a)).sort(([a], [b]) => b.localeCompare(a)).slice(0, 3)
    .map(([a, v]) => ({ annee: Number(a), ca: nombre(v?.ca), resultat_net: nombre(v?.resultat_net) })) : [];
  const tous = (f.dirigeants || []).filter((d) => !CAC.test(d?.qualite || ''));
  const physiques = tous.filter((d) => d.type_dirigeant === 'personne physique');
  const etat = f.etat_administratif ?? null;
  const annee = (d) => nombre(d.annee_de_naissance) ?? nombre(/^(\d{4})/.exec(d.date_de_naissance ?? '')?.[1]);
  return {
    siren: f.siren, nom: f.nom_complet, nature_juridique: f.nature_juridique ?? null, naf: f.activite_principale,
    creation: f.date_creation ?? null, etat_administratif: etat,
    // Un état inconnu (fiche incomplète) ne vaut pas fermeture ; « C » (cessée) ou une date de fermeture, si.
    fermee: Boolean(f.date_fermeture) || (etat !== null && etat !== 'A'),
    categorie: f.categorie_entreprise ?? null,
    effectif: TRANCHES[f.tranche_effectif_salarie] ?? f.tranche_effectif_salarie ?? 'non renseigné',
    effectif_code: f.tranche_effectif_salarie ?? null,
    effectif_annee: nombre(f.annee_tranche_effectif_salarie ?? s.annee_tranche_effectif_salarie),
    departement: s.departement ?? null, commune: s.libelle_commune ?? null,
    dirigeants: physiques.map((d) => ({ qualite: d.qualite, nom: [d.prenoms?.split(' ')[0], d.nom].filter(Boolean).join(' '), annee_naissance: annee(d) })),
    dirigeants_pm: tous.filter((d) => d.type_dirigeant === 'personne morale').length,
    finances, ca: finances[0] ?? null,
    rge: Boolean(s.liste_rge?.length), idcc: Array.isArray(s.liste_idcc) ? s.liste_idcc : [],
    // Valeurs brutes, jamais converties : un champ absent ou renommé par l'API vaut null, et null n'est jamais une absence
    // d'opposition (G4 et G11 l'excluent, L5 le compte comme manquant : échec fermé).
    opposition: typeof f.opposition_diffusion_commerciale === 'boolean' ? f.opposition_diffusion_commerciale : null,
    statut_diffusion: typeof f.statut_diffusion === 'string' && f.statut_diffusion ? f.statut_diffusion : null,
    etablissements_ouverts: f.nombre_etablissements_ouverts ?? null,
    fiche: `https://annuaire-entreprises.data.gouv.fr/entreprise/${f.siren}`,
  };
}
