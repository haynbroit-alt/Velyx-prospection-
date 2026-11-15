// Socle de VELYX v2 : utilitaires sans état, partagés par tous les modules. Ne dépend que de Node (zéro dépendance) et
// de contrats.js. Contenu : horloge injectable au jour de Paris ; JSON canonique et empreintes ; validateur de schémas
// maison ; opérateurs déclaratifs ; budgets ; porte réseau unique (GET seulement, liste blanche d'hôtes et de chemins
// conforme à robots.txt, débit poli, reprises) ; écritures atomiques et verrou exclusif ; magasin à deux zones
// (etat/ public, prive/ privé) avec mode à blanc.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------------------------------------------------
// Erreurs nommées : chaque module les reconnaît par leur classe, jamais par le texte du message.

class ErreurVelyx extends Error {
  constructor(message, champs = {}) {
    super(message);
    this.name = new.target.name;
    Object.assign(this, champs);
  }
}
/** Hôte hors de la liste blanche (ou schéma autre que https) : levée avant tout appel réseau. */
export class HoteInterdit extends ErreurVelyx {
  constructor(hote) { super(`hôte interdit : ${hote} (seuls ${Object.keys(HOTES).join(' et ')} sont autorisés, en https)`, { hote }); }
}
/** Chemin ou requête hors des chemins autorisés de l'hôte (robots.txt de codeur.com : Disallow /*?*, Allow /*?page=*). */
export class CheminInterdit extends ErreurVelyx {
  constructor(url) { super(`chemin interdit : ${url}`, { url }); }
}
/** Réponse 403 : la source s'arrête pour le cycle, sans nouvel essai. */
export class Bloque extends ErreurVelyx {
  constructor(url) { super(`accès refusé (HTTP 403) : ${url} ; aucun nouvel essai`, { url, status: 403 }); }
}
/** Une écriture réelle a été demandée alors que le magasin travaille à blanc. */
export class EcritureABlanc extends ErreurVelyx {
  constructor(motif) { super(`écriture réelle refusée en mode à blanc : ${motif}`, { motif }); }
}
/** Plafond de budget atteint (requêtes, jugements ou durée). Rien n'est consommé par la prise refusée. */
export class BudgetEpuise extends ErreurVelyx {
  constructor(source, plafond) { super(`budget épuisé : ${source} (plafond ${plafond})`, { source, plafond }); }
}
/** Échec réseau après tous les essais (erreur réseau, 429 ou 5xx), ou redirection en boucle. */
export class EchecReseau extends ErreurVelyx {
  constructor(url, statut, cause) { super(`échec réseau : ${url} (${statut}) après tous les essais`, { url, statut, cause }); }
}
/** Mode hors ligne : la réponse n'est pas dans le cache, aucun appel n'est fait. */
export class HorsLigne extends ErreurVelyx {
  constructor(url) { super(`hors ligne : ${url} absent du cache`, { url }); }
}
/** Écriture hors de sa zone (public sous etat/ ou registre/, privé sous prive/), ou chemin qui sort de la racine. */
export class ZoneInterdite extends ErreurVelyx {
  constructor(rel, motif) { super(`écriture refusée : ${rel} (${motif})`, { rel, motif }); }
}
/** Le contrôle antifuite branché sur le magasin (garde.verifierPublic) a refusé un contenu public. */
export class PubliqueRefusee extends ErreurVelyx {
  constructor(rel, motif) { super(`contenu public refusé : ${rel} (${motif ?? 'motif non donné'})`, { rel, motif }); }
}
/** Le verrou est tenu par un autre processus au-delà du délai d'attente. */
export class VerrouOccupe extends ErreurVelyx {
  constructor(chemin, attenteMs) { super(`verrou occupé depuis plus de ${attenteMs} ms : ${chemin}`, { chemin }); }
}

// ---------------------------------------------------------------------------------------------------------------------
// Horloge. Le jour de VELYX est celui de Paris : à 23 h 30 UTC le 31 décembre, on est déjà le 1er janvier.

const PARIS = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
const deux = (n) => String(n).padStart(2, '0');

function partiesParis(ms) {
  const p = Object.fromEntries(PARIS.formatToParts(new Date(ms)).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  return { annee: Number(p.year), mois: Number(p.month), jour: Number(p.day) };
}

function semaineIso({ annee, mois, jour }) {
  const d = new Date(Date.UTC(annee, mois - 1, jour));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));            // jeudi de la même semaine ISO
  const an = d.getUTCFullYear();
  const s = Math.ceil(((d - Date.UTC(an, 0, 1)) / 864e5 + 1) / 7);
  return `${an}-S${deux(s)}`;
}

/**
 * Horloge injectable. Sans argument : l'heure réelle. Avec un instant ISO : une horloge factice figée à cet instant,
 * que seul avancer(ms) déplace (les tests et l'exécution à blanc s'en servent).
 * @returns {{factice: boolean, maintenant(): Date, iso(): string, jour(): string, annee(): number, jourSemaine(): number,
 *   semaine(): string, avancer(ms: number): void}}
 */
export function creerHorloge(iso) {
  let base = null, decalage = 0;
  if (iso !== undefined && iso !== null) {
    base = Date.parse(iso);
    if (!Number.isFinite(base)) throw new TypeError(`horloge : instant illisible « ${iso} »`);
  }
  const ms = () => (base === null ? Date.now() : base) + decalage;
  return Object.freeze({
    factice: base !== null,
    maintenant: () => new Date(ms()),
    iso: () => new Date(ms()).toISOString(),
    /** 'AAAA-MM-JJ' au jour de Paris. */
    jour: () => { const p = partiesParis(ms()); return `${p.annee}-${deux(p.mois)}-${deux(p.jour)}`; },
    annee: () => partiesParis(ms()).annee,
    /** 0 = dimanche … 6 = samedi, au jour de Paris. */
    jourSemaine: () => { const p = partiesParis(ms()); return new Date(Date.UTC(p.annee, p.mois - 1, p.jour)).getUTCDay(); },
    /** Semaine ISO au jour de Paris, 'AAAA-Sss' (clé des actes audit). */
    semaine: () => semaineIso(partiesParis(ms())),
    avancer: (n) => { if (!Number.isFinite(n)) throw new TypeError('avancer : durée illisible'); decalage += n; },
  });
}

/**
 * Âge en années révolues au jour de Paris. Accepte 'AAAA', 'AAAA-MM', 'AAAA-MM-JJ' (ou un ISO complet) et une année
 * numérique. Avec l'année seule, c'est l'âge atteint dans l'année en cours (convention de la v1). null si illisible ou
 * dans le futur.
 */
export function ageAns(dateIso, horloge) {
  if (dateIso === null || dateIso === undefined || dateIso === '') return null;
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/.exec(String(dateIso).trim());
  if (!m) return null;
  const a = Number(m[1]), mo = m[2] ? Number(m[2]) : null, j = m[3] ? Number(m[3]) : null;
  if ((mo !== null && (mo < 1 || mo > 12)) || (j !== null && (j < 1 || j > 31))) return null;
  const [ca, cm, cj] = (horloge ?? creerHorloge()).jour().split('-').map(Number);
  let age = ca - a;
  if (mo !== null && (cm < mo || (cm === mo && j !== null && cj < j))) age -= 1;
  return age >= 0 ? age : null;
}

/** Heures écoulées de isoA à isoB (négatif si B précède A). Lève sur une date illisible. */
export function heuresEntre(isoA, isoB) {
  const a = Date.parse(isoA), b = Date.parse(isoB);
  if (!Number.isFinite(a) || !Number.isFinite(b)) throw new TypeError(`heuresEntre : date illisible (${isoA}, ${isoB})`);
  return (b - a) / 3.6e6;
}

// ---------------------------------------------------------------------------------------------------------------------
// JSON canonique et empreintes.

/** JSON canonique : clés triées à tous les niveaux, mêmes conventions que JSON.stringify pour le reste. */
export function canon(x) {
  if (x !== null && typeof x === 'object' && typeof x.toJSON === 'function') x = x.toJSON();
  if (Array.isArray(x)) return `[${x.map((v) => (v === undefined || typeof v === 'function' || typeof v === 'symbol' ? 'null' : canon(v))).join(',')}]`;
  if (x !== null && typeof x === 'object') {
    const cles = Object.keys(x).filter((k) => x[k] !== undefined && typeof x[k] !== 'function' && typeof x[k] !== 'symbol').sort();
    return `{${cles.map((k) => `${JSON.stringify(k)}:${canon(x[k])}`).join(',')}}`;
  }
  const s = JSON.stringify(x);
  return s === undefined ? 'null' : s;
}
/** Empreinte hexadécimale (sha256 du JSON canonique), tronquée à n caractères. */
export const empreinte = (x, n = 16) => sha256Texte(canon(x)).slice(0, n);
/** sha256 d'un texte UTF-8, 64 caractères hexadécimaux. */
export const sha256Texte = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
/** sha256 du contenu d'un fichier. */
export const sha256Fichier = (chemin) => crypto.createHash('sha256').update(fs.readFileSync(chemin)).digest('hex');

/**
 * Empreinte d'un ensemble d'arbres (fichiers et dossiers), indépendante de leur emplacement : chemin relatif, nature et
 * contenu de chaque entrée. Un chemin absent compte comme « absent ». Sert à prouver qu'une exécution à blanc n'a rien écrit.
 */
export function empreinteArbre(chemins) {
  const entrees = [];
  chemins.forEach((c, i) => parcourir(path.resolve(c), `${i}:`, entrees));
  entrees.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return sha256Texte(canon(entrees));
}
function parcourir(abs, etiquette, out) {
  let st;
  try { st = fs.lstatSync(abs); } catch (e) { if (e.code === 'ENOENT') { out.push([etiquette, 'absent']); return; } throw e; }
  if (st.isSymbolicLink()) out.push([etiquette, 'lien', fs.readlinkSync(abs)]);
  else if (st.isDirectory()) {
    out.push([`${etiquette}/`, 'dossier']);
    for (const nom of fs.readdirSync(abs).sort()) parcourir(path.join(abs, nom), `${etiquette}/${nom}`, out);
  } else if (st.isFile()) out.push([etiquette, sha256Fichier(abs)]);
  else out.push([etiquette, 'autre']);
}

// ---------------------------------------------------------------------------------------------------------------------
// Validateur de schémas maison. Sert à toute donnée écrite par le LLM (recettes, jugements) : une clé inconnue, du code
// ou une URL hors de www.codeur.com y sont toujours refusés.

const TYPES_CHAMP = ['texte', 'entier', 'nombre', 'bool', 'enum', 'liste', 'objet'];
const MOTIFS_CODE = [
  ['function', /\bfunction\b/i], ['=>', /=>/], ['require(', /\brequire\s*\(/], ['import', /\bimport\s*\(|\bimport\s+[\w${*][^\n;]*?\bfrom\b|\bimport\s+['"]/],
  ['eval(', /\beval\s*\(/], ['<script', /<\s*script/i], ['javascript:', /\bjavascript\s*:/i], ['data:', /\bdata:[\w.+-]+\/[\w.+-]+[;,]/i],
];
const RE_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>()]+/gi;
const RE_WWW = /(?<![\w.-])www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
const HOTE_URL_PERMIS = 'www.codeur.com';

/** Motif de refus d'une chaîne (code, URL hors de www.codeur.com), ou null si elle est acceptable. */
export function defautChaine(s) {
  for (const [nom, re] of MOTIFS_CODE) if (re.test(s)) return `contient du code (${nom})`;
  for (const m of s.matchAll(RE_URL)) {
    let u;
    try { u = new URL(m[0]); } catch { return 'contient une URL illisible'; }
    if (!['http:', 'https:'].includes(u.protocol) || u.hostname !== HOTE_URL_PERMIS || u.username || u.password) {
      return `contient une URL hors de ${HOTE_URL_PERMIS} (${u.protocol}//${u.hostname})`;
    }
  }
  for (const m of s.matchAll(RE_WWW)) if (m[0].toLowerCase() !== HOTE_URL_PERMIS) return `contient une URL hors de ${HOTE_URL_PERMIS} (${m[0]})`;
  return null;
}

/**
 * Valide un objet contre un schéma {type: 'objet', champs: {[k]: spec}}. Une spec de champ accepte : type ∈
 * texte|entier|nombre|bool|enum|liste|objet, requis, min, max (longueur pour texte et liste, valeur pour les nombres),
 * valeurs (enum), motif (texte), items (liste), champs (objet). Extensions : nul (null accepté même si requis) et
 * ou (liste de specs, une seule doit passer). Une valeur null sur un champ non requis vaut absence.
 * Toute clé inconnue est refusée (un objet sans champs n'accepte aucune clé), ainsi que toute chaîne, à toute
 * profondeur, qui contient du code ou une URL hors de www.codeur.com.
 * @returns {{ok: boolean, erreurs: string[]}}
 */
export function valider(schema, objet) {
  const erreurs = [];
  if (objet === undefined || objet === null) erreurs.push('(racine) : objet attendu');
  else verifierValeur(schema, objet, '', erreurs);
  return { ok: erreurs.length === 0, erreurs };
}

function verifierValeur(spec, v, chemin, erreurs) {
  const ici = chemin || '(racine)';
  if (spec.ou) {
    for (const branche of spec.ou) { const e = []; verifierValeur(branche, v, chemin, e); if (!e.length) return; }
    erreurs.push(`${ici} : ne correspond à aucune des formes permises`);
    return;
  }
  if (!TYPES_CHAMP.includes(spec.type)) throw new Error(`schéma : type de champ inconnu « ${spec.type} » (${ici})`);
  const bornes = (x, quoi) => {
    if (spec.min !== undefined && x < spec.min) erreurs.push(`${ici} : ${quoi} ${x} inférieure au minimum ${spec.min}`);
    if (spec.max !== undefined && x > spec.max) erreurs.push(`${ici} : ${quoi} ${x} supérieure au maximum ${spec.max}`);
  };
  switch (spec.type) {
    case 'texte': {
      if (typeof v !== 'string') { erreurs.push(`${ici} : texte attendu`); return; }
      bornes([...v].length, 'longueur');
      if (spec.motif !== undefined && !(spec.motif instanceof RegExp ? spec.motif : new RegExp(spec.motif)).test(v)) erreurs.push(`${ici} : ne suit pas le motif attendu`);
      const d = defautChaine(v); if (d) erreurs.push(`${ici} : ${d}`);
      return;
    }
    case 'entier': if (!Number.isInteger(v)) erreurs.push(`${ici} : entier attendu`); else bornes(v, 'valeur'); return;
    case 'nombre': if (typeof v !== 'number' || !Number.isFinite(v)) erreurs.push(`${ici} : nombre fini attendu`); else bornes(v, 'valeur'); return;
    case 'bool': if (typeof v !== 'boolean') erreurs.push(`${ici} : booléen attendu`); return;
    case 'enum': {
      if (!Array.isArray(spec.valeurs)) throw new Error(`schéma : enum sans valeurs (${ici})`);
      if (!spec.valeurs.includes(v)) erreurs.push(`${ici} : valeur hors de la liste permise`);
      else if (typeof v === 'string') { const d = defautChaine(v); if (d) erreurs.push(`${ici} : ${d}`); }
      return;
    }
    case 'liste': {
      if (!Array.isArray(v)) { erreurs.push(`${ici} : liste attendue`); return; }
      bornes(v.length, 'longueur');
      v.forEach((x, i) => {
        const c = `${chemin}[${i}]`;
        if (x === undefined || x === null) { if (!spec.items?.nul) erreurs.push(`${c} : valeur nulle`); return; }
        if (spec.items) verifierValeur(spec.items, x, c, erreurs); else scannerChaines(x, c, erreurs);
      });
      return;
    }
    case 'objet': {
      if (typeof v !== 'object' || Array.isArray(v)) { erreurs.push(`${ici} : objet attendu`); return; }
      const champs = spec.champs ?? {};
      for (const k of Object.keys(v)) if (!Object.hasOwn(champs, k)) erreurs.push(`${chemin ? `${chemin}.` : ''}${k} : clé inconnue`);
      for (const [k, sous] of Object.entries(champs)) {
        const c = chemin ? `${chemin}.${k}` : k, x = Object.hasOwn(v, k) ? v[k] : undefined;
        if (x === undefined || x === null) {
          if (x === null && sous.nul) continue;
          if (sous.requis) erreurs.push(`${c} : requis`);
          continue;
        }
        verifierValeur(sous, x, c, erreurs);
      }
    }
  }
}

function scannerChaines(x, chemin, erreurs) {
  if (typeof x === 'string') { const d = defautChaine(x); if (d) erreurs.push(`${chemin} : ${d}`); }
  else if (Array.isArray(x)) x.forEach((y, i) => scannerChaines(y, `${chemin}[${i}]`, erreurs));
  else if (x !== null && typeof x === 'object') for (const [k, y] of Object.entries(x)) scannerChaines(y, `${chemin}.${k}`, erreurs);
}

// ---------------------------------------------------------------------------------------------------------------------
// Opérateurs des règles déclaratives (recettes, croyances, contrôles). Un opérateur inconnu lève : jamais de « vrai » par défaut.

export const OPS = Object.freeze(['==', '!=', '<', '<=', '>', '>=', 'in', 'nin', 'existe', 'motif_i']);
const sansAccents = (s) => s.normalize('NFD').replace(/\p{M}/gu, '');
const egal = (a, b) => (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' ? canon(a) === canon(b) : a === b);
const REGEX = new Map();

function regexSure(motif) {
  if (typeof motif !== 'string' || !motif || motif.length > 200) throw new TypeError('motif_i : motif texte de 1 à 200 caractères attendu');
  if (/\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)\s*[+*{]/.test(motif)) throw new TypeError('motif_i : quantificateurs imbriqués refusés');
  if (!REGEX.has(motif)) REGEX.set(motif, new RegExp(sansAccents(motif), 'i'));
  return REGEX.get(motif);
}

/**
 * Évalue « gauche op droite ». Comparaisons d'ordre seulement entre deux nombres finis ou deux textes (sinon faux) ;
 * in/nin : droite est une liste (gauche liste : au moins un élément) ; existe : droite vaut true (défaut) ou false,
 * null, '' et [] n'existent pas ; motif_i : expression régulière insensible à la casse et aux accents.
 */
export function evaluerOp(op, gauche, droite) {
  switch (op) {
    case '==': return egal(gauche, droite);
    case '!=': return !egal(gauche, droite);
    case '<': case '<=': case '>': case '>=': {
      const ok = (typeof gauche === 'number' && typeof droite === 'number' && Number.isFinite(gauche) && Number.isFinite(droite))
        || (typeof gauche === 'string' && typeof droite === 'string');
      if (!ok) return false;
      return op === '<' ? gauche < droite : op === '<=' ? gauche <= droite : op === '>' ? gauche > droite : gauche >= droite;
    }
    case 'in': case 'nin': {
      if (!Array.isArray(droite)) throw new TypeError(`« ${op} » attend une liste à droite`);
      const dedans = Array.isArray(gauche) ? gauche.some((g) => droite.some((d) => egal(g, d))) : droite.some((d) => egal(gauche, d));
      return op === 'in' ? dedans : !dedans;
    }
    case 'existe': {
      const present = !(gauche === undefined || gauche === null || gauche === '' || (Array.isArray(gauche) && gauche.length === 0));
      return droite === false ? !present : present;
    }
    case 'motif_i': {
      const re = regexSure(droite), teste = (x) => typeof x === 'string' && re.test(sansAccents(x));
      return Array.isArray(gauche) ? gauche.some(teste) : teste(gauche);
    }
    default: throw new Error(`opérateur inconnu : ${op}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Budgets d'un cycle.

export const PLAFONDS = Object.freeze({ codeur: 10, sirene: 400, duree_s: 600, jugements: 5, nouvelles_opportunites: 1, passages_jour: 3 });

/**
 * Budget d'un cycle. prendre() lève BudgetEpuise sans rien consommer si le plafond serait dépassé, ou si la durée l'est.
 * Les compteurs sont toutes les clés des plafonds sauf duree_s.
 */
export function creerBudget(plafonds = PLAFONDS, horloge = creerHorloge()) {
  const t = () => horloge.maintenant().getTime(), debut = t();
  const compteurs = Object.keys(plafonds).filter((k) => k !== 'duree_s');
  const consomme = Object.fromEntries(compteurs.map((k) => [k, 0]));
  const duree = () => (t() - debut) / 1000;
  const connu = (source) => { if (!compteurs.includes(source)) throw new Error(`budget : source inconnue « ${source} »`); };
  const budget = {
    prendre(source, n = 1) {
      connu(source);
      if (!Number.isInteger(n) || n < 0) throw new TypeError('budget : quantité entière positive attendue');
      budget.verifierDuree();
      if (consomme[source] + n > plafonds[source]) throw new BudgetEpuise(source, plafonds[source]);
      consomme[source] += n;
    },
    reste(source) { connu(source); return plafonds[source] - consomme[source]; },
    verifierDuree() { if (plafonds.duree_s !== undefined && duree() > plafonds.duree_s) throw new BudgetEpuise('duree_s', plafonds.duree_s); },
    bilan: () => ({ consomme: { ...consomme }, plafonds: { ...plafonds }, duree_s: Math.round(duree() * 10) / 10 }),
  };
  return budget;
}

// ---------------------------------------------------------------------------------------------------------------------
// Porte réseau unique : GET seulement, deux hôtes, chemins conformes à robots.txt, débit poli, reprises budgétées.

const figer = (o) => { for (const v of Object.values(o)) if (v && typeof v === 'object') figer(v); return Object.freeze(o); };

/** Hôtes autorisés. requete s'applique à la chaîne de requête (« ?… », vide si absente). */
export const HOTES = figer({
  'www.codeur.com': {
    intervalleMs: 1500, source: 'codeur',
    chemins: [
      { motif: '/projects.rss', chemin: /^\/projects\.rss$/, requete: /^$/ },
      { motif: '/projects, /projects?page=1..5', chemin: /^\/projects$/, requete: /^(?:\?page=[1-5])?$/ },
      { motif: '/projects/<id>[-slug]', chemin: /^\/projects\/\d+(?:-[a-z0-9-]+)?$/i, requete: /^$/ },
      { motif: '/pages/<slug>', chemin: /^\/pages\/[a-z0-9-]+$/i, requete: /^$/ },
    ],
  },
  'recherche-entreprises.api.gouv.fr': {
    intervalleMs: 260, source: 'sirene',
    chemins: [{ motif: '/search?…', chemin: /^\/search$/, requete: /^\?.+/ }],
  },
});

/** Vérifie une URL contre la liste blanche. Lève HoteInterdit ou CheminInterdit ; renvoie {url, hote, regle}. */
export function verifierUrl(url) {
  let u;
  try { u = new URL(String(url)); } catch { throw new HoteInterdit(String(url)); }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) throw new HoteInterdit(`${u.protocol}//${u.host}`);
  const regle = HOTES[u.hostname];
  if (!regle) throw new HoteInterdit(u.hostname);
  if (!regle.chemins.some((c) => c.chemin.test(u.pathname) && c.requete.test(u.search))) throw new CheminInterdit(`${u.hostname}${u.pathname}${u.search}`);
  return { url: u, hote: u.hostname, regle };
}

/** Le fetch de Node n'emprunte le proxy que si NODE_USE_ENV_PROXY=1 : sans lui, chaque requête échoue en silence. */
export function verifierProxy(env = process.env) {
  if ((env.HTTPS_PROXY || env.https_proxy) && env.NODE_USE_ENV_PROXY !== '1') {
    const e = new Error('HTTPS_PROXY est défini mais NODE_USE_ENV_PROXY=1 manque : le fetch de Node ignorerait le proxy et '
      + 'chaque requête échouerait. Relancer avec NODE_USE_ENV_PROXY=1 (par exemple : NODE_USE_ENV_PROXY=1 node bin/velyx.js cycle).');
    e.name = 'ProxyIgnore';
    throw e;
  }
}

const AGENT = 'Mozilla/5.0 (compatible; lecture ponctuelle)';
const ACCEPTE = { texte: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', json: 'application/json' };

/**
 * Client HTTP unique. get(url, {source, format, essais}) : liste blanche avant tout appel ; réponse du cache sans
 * budget ; sur 429, 5xx ou erreur réseau, attente de 1 s × 2^i puis nouvel essai, chaque essai étant budgété ; 403 →
 * Bloque sans nouvel essai ; redirections suivies seulement vers des URL autorisées (3 au plus) ; deux appels au même
 * hôte espacés d'au moins intervalleMs (doublé après plus de 3 réponses 429). Les réponses 2xx sont mises en cache ;
 * les autres statuts sont rendus tels quels. horsLigne : seul le cache répond (HorsLigne sinon).
 */
export function creerHttp({ budget, horloge = creerHorloge(), fetchImpl = globalThis.fetch, attendre = (ms) => new Promise((r) => setTimeout(r, ms)),
  cache = new Map(), env = process.env, horsLigne = false } = {}) {
  if (!budget) throw new Error('creerHttp : budget requis');
  const stats = {}, derniers = {}, n429 = {}, files = {};
  let proxyVerifie = false;
  const t = () => horloge.maintenant().getTime();

  const depuisCache = (cle, format) => {
    const c = cache.get(cle);
    return { status: c.status, corps: format === 'json' ? JSON.parse(c.texte) : c.texte, lu_le: c.lu_le, depuis_cache: true, url: c.url };
  };
  const politesse = async (hote, regle) => {
    if (derniers[hote] === undefined) return;
    const intervalle = regle.intervalleMs * ((n429[hote] ?? 0) > 3 ? 2 : 1), ecoule = t() - derniers[hote];
    if (ecoule < intervalle) await attendre(intervalle - ecoule);
  };
  const abandonner = (r) => { try { r?.body?.cancel?.(); } catch { /* corps déjà lu ou absent */ } };

  async function executer(cle, u0, hote, regle, format, essais) {
    if (cache.has(cle)) return depuisCache(cle, format);
    const s = (stats[hote] ??= { requetes: 0, echecs: 0, statuts: {} });
    let u = u0, redirections = 0;
    for (let i = 0; ;) {
      await politesse(hote, regle);
      budget.prendre(regle.source);
      s.requetes++;
      derniers[hote] = t();
      let r = null, erreur = null;
      try {
        r = await fetchImpl(u.href, { method: 'GET', redirect: 'manual', headers: { 'user-agent': AGENT, accept: ACCEPTE[format] },
          signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(30_000) : undefined });
      } catch (e) { erreur = e; }
      const statut = erreur ? 'reseau' : r.status;
      s.statuts[statut] = (s.statuts[statut] ?? 0) + 1;
      if (!erreur && r.status === 403) { s.echecs++; abandonner(r); throw new Bloque(u.href); }
      if (!erreur && r.status >= 300 && r.status < 400 && r.headers?.get?.('location')) {
        abandonner(r);
        if (++redirections > 3) throw new EchecReseau(u.href, 'redirections');
        const suite = verifierUrl(new URL(r.headers.get('location'), u).href);
        if (suite.hote !== hote) throw new HoteInterdit(`${suite.hote} (redirection depuis ${hote})`);
        u = suite.url;
        continue;
      }
      if (erreur || r.status === 429 || r.status >= 500) {
        s.echecs++;
        if (r?.status === 429) n429[hote] = (n429[hote] ?? 0) + 1;
        abandonner(r);
        if (i >= essais - 1) throw new EchecReseau(u.href, statut, erreur ?? undefined);
        await attendre(1000 * 2 ** i);
        i++;
        continue;
      }
      const texte = await r.text(), lu_le = horloge.iso(), ok = r.status >= 200 && r.status < 300;
      if (ok) cache.set(cle, { status: r.status, texte, lu_le, url: u.href });
      let corps = texte;
      if (ok && format === 'json') {
        try { corps = JSON.parse(texte); } catch { throw new EchecReseau(u.href, 'json_illisible'); }
      }
      return { status: r.status, corps, lu_le, depuis_cache: false, url: u.href };
    }
  }

  return {
    async get(url, { source, format = 'texte', essais = 4 } = {}) {
      const { url: u, hote, regle } = verifierUrl(url);
      if (source !== undefined && source !== regle.source) throw new Error(`http : source « ${source} » incohérente avec l’hôte ${hote}`);
      if (!Object.hasOwn(ACCEPTE, format)) throw new Error(`http : format inconnu « ${format} »`);
      if (!Number.isInteger(essais) || essais < 1) throw new TypeError('http : essais entier ≥ 1 attendu');
      const cle = u.href;
      if (cache.has(cle)) return depuisCache(cle, format);
      if (horsLigne) throw new HorsLigne(cle);
      if (!proxyVerifie && fetchImpl === globalThis.fetch) { verifierProxy(env); proxyVerifie = true; }
      const p = (files[hote] ?? Promise.resolve()).then(() => executer(cle, u, hote, regle, format, essais));
      files[hote] = p.catch(() => {});
      return p;
    },
    bilan: () => JSON.parse(JSON.stringify(stats)),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Écritures atomiques et verrou exclusif entre processus.

const ATTENTE = new Int32Array(new SharedArrayBuffer(4));
/** Attente synchrone (sans boucle active). */
export const dormir = (ms) => { if (ms > 0) Atomics.wait(ATTENTE, 0, 0, ms); };
const octets = (contenu) => (typeof contenu === 'string' ? Buffer.from(contenu, 'utf8') : Buffer.isBuffer(contenu) ? contenu
  : contenu instanceof Uint8Array ? Buffer.from(contenu) : Buffer.from(`${JSON.stringify(contenu, null, 1)}\n`, 'utf8'));

/**
 * Écrit un fichier de façon atomique : fichier .tmp voisin, fsync, puis renommage. Un processus tué avant le renommage
 * laisse l'ancien fichier intact (et un .tmp orphelin, ignoré par le magasin). avantRenommage(tmp, final) : crochet de test.
 */
export function ecrireAtomique(chemin, contenu, { avantRenommage } = {}) {
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  const tmp = `${chemin}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    const fd = fs.openSync(tmp, 'wx');
    try { fs.writeFileSync(fd, octets(contenu)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    avantRenommage?.(tmp, chemin);
    fs.renameSync(tmp, chemin);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* déjà renommé ou jamais créé */ }
    throw e;
  }
}

/**
 * Exécute fn() (synchrone) sous un verrou exclusif : fichier ouvert en 'wx' (O_CREAT | O_EXCL) contenant un jeton
 * unique. Un verrou plus vieux que perimeMs est brisé (celui d'un processus mort) ; au-delà de attenteMs, VerrouOccupe.
 */
export function avecVerrou(chemin, fn, { perimeMs = 30_000, attenteMs = 5_000 } = {}) {
  const jeton = `${process.pid}:${crypto.randomBytes(8).toString('hex')}`, debut = Date.now();
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  for (;;) {
    try {
      const fd = fs.openSync(chemin, 'wx');
      try { fs.writeSync(fd, jeton); } finally { fs.closeSync(fd); }
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let st;
      try { st = fs.statSync(chemin); } catch { continue; }                     // libéré entre-temps : on réessaie
      if (Date.now() - st.mtimeMs > perimeMs) { briserVerrou(chemin, perimeMs); continue; }
      if (Date.now() - debut > attenteMs) throw new VerrouOccupe(chemin, attenteMs);
      dormir(3 + Math.floor(Math.random() * 12));
    }
  }
  try { return fn(); } finally {
    try { if (fs.readFileSync(chemin, 'utf8') === jeton) fs.unlinkSync(chemin); } catch { /* brisé comme périmé par un autre */ }
  }
}

// Le verrou périmé est d'abord mis de côté par un renommage (atomique) ; si ce qui a été mis de côté n'était pas
// périmé (un autre processus venait de le reprendre), il est remis en place par un lien, qui échoue si un verrou existe.
function briserVerrou(chemin, perimeMs) {
  const cote = `${chemin}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.perime`;
  try { fs.renameSync(chemin, cote); } catch { return; }
  try {
    if (Date.now() - fs.statSync(cote).mtimeMs <= perimeMs) { try { fs.linkSync(cote, chemin); } catch { /* un verrou neuf existe déjà */ } }
  } finally { try { fs.unlinkSync(cote); } catch { /* rien à nettoyer */ } }
}

// ---------------------------------------------------------------------------------------------------------------------
// Magasin à deux zones. C'est le seul code qui écrit sous etat/ (public, poussé dans git) et prive/ (jamais poussé).

const SUPPRIME = Symbol('supprimé');
const IGNORES = /\.(tmp|lock|perime)$/;

/**
 * @param {string} racine
 * @param {{aBlanc?: boolean, verifierPublic?: (rel: string, contenu: string) => {ok: boolean, motif?: string},
 *   avantRenommage?: Function}} options
 * En mode à blanc, rien n'est écrit sur le disque : les écritures vont dans un calque en mémoire que lire() relit,
 * et plan() liste ce qui aurait été écrit. verifierPublic s'applique dans les deux modes.
 */
export function creerMagasin(racine, { aBlanc = false, verifierPublic = () => ({ ok: true }), avantRenommage, base = null } = {}) {
  const abs = path.resolve(racine);
  const calque = new Map(), publiques = new Set(), privees = new Set(), suppressions = new Set();

  const normaliser = (rel) => {
    if (typeof rel !== 'string' || !rel || rel.includes('\0') || rel.includes('\\') || path.isAbsolute(rel)) throw new ZoneInterdite(String(rel), 'chemin relatif attendu');
    const n = path.posix.normalize(rel).replace(/\/+$/, '');
    if (!n || n === '.' || n === '..' || n.startsWith('../')) throw new ZoneInterdite(rel, 'sort de la racine');
    return n;
  };
  const zone = (r) => (/^(etat|registre)\//.test(r) ? 'public' : r.startsWith('prive/') ? 'prive' : null);
  const exigerZone = (r, attendue) => {
    if (zone(r) !== attendue) throw new ZoneInterdite(r, attendue === 'public' ? 'public sous etat/ ou registre/ seulement' : 'privé sous prive/ seulement');
    if (IGNORES.test(r)) throw new ZoneInterdite(r, 'extension réservée');
    if (r === 'registre/journal.jsonl') throw new ZoneInterdite(r, 'le registre écrit lui-même son journal');
  };
  const ecrire = (r, contenu) => { if (aBlanc) calque.set(r, octets(contenu)); else ecrireAtomique(path.join(abs, r), contenu, { avantRenommage }); };
  const controler = (r, texte) => {
    const v = verifierPublic(r, texte);
    if (!v || v.ok !== true) throw new PubliqueRefusee(r, v?.motif);
  };
  const texteDe = (contenu) => (typeof contenu === 'string' ? contenu : octets(contenu).toString('utf8'));

  const lireBase = (r) => {
    if (base) return base.lire(r);
    try { return fs.readFileSync(path.join(abs, r), 'utf8'); } catch (e) { if (['ENOENT', 'EISDIR', 'ENOTDIR'].includes(e.code)) return null; throw e; }
  };
  const listerBase = (prefixe) => {
    if (base) return base.lister(prefixe);
    const dossier = prefixe.endsWith('/') ? prefixe.slice(0, -1) : path.posix.dirname(prefixe), out = [];
    const marcher = (rel) => {
      let entrees;
      try { entrees = fs.readdirSync(path.join(abs, rel), { withFileTypes: true }); } catch { return; }
      for (const e of entrees) {
        const r = rel === '.' ? e.name : `${rel}/${e.name}`;
        if (e.isDirectory()) { if (e.name !== '.git' && e.name !== 'node_modules') marcher(r); } else if (e.isFile()) out.push(r);
      }
    };
    marcher(dossier || '.');
    return out.filter((r) => r.startsWith(prefixe) && !IGNORES.test(r));
  };

  const magasin = {
    racine: abs,
    aBlanc,
    /** Écrit un fichier public (etat/ ou registre/) après le contrôle antifuite. */
    ecrirePublic(rel, contenu) {
      const r = normaliser(rel); exigerZone(r, 'public');
      controler(r, texteDe(contenu));
      ecrire(r, contenu); publiques.add(r);
      return r;
    },
    /** Ajoute une ou plusieurs lignes JSON à un fichier public .jsonl (le contrôle antifuite porte sur les lignes ajoutées). */
    ajouterPublicJsonl(rel, objets) {
      const r = normaliser(rel); exigerZone(r, 'public');
      const liste = Array.isArray(objets) ? objets : [objets];
      if (!liste.length) return 0;
      const ajout = `${liste.map((o) => JSON.stringify(o)).join('\n')}\n`;
      controler(r, ajout);
      const avant = magasin.lire(r) ?? '';
      ecrire(r, `${avant}${avant && !avant.endsWith('\n') ? '\n' : ''}${ajout}`); publiques.add(r);
      return liste.length;
    },
    /** Écrit un fichier privé (prive/). */
    ecrirePrive(rel, contenu) {
      const r = normaliser(rel); exigerZone(r, 'prive');
      ecrire(r, contenu); privees.add(r);
      return r;
    },
    /** Lit un fichier sous la racine (calque d'abord en mode à blanc) ; null s'il est absent. */
    lire(rel) {
      const r = normaliser(rel);
      if (calque.has(r)) { const v = calque.get(r); return v === SUPPRIME ? null : v.toString('utf8'); }
      return lireBase(r);
    },
    lireJson(rel) { const t = magasin.lire(rel); return t === null ? null : JSON.parse(t); },
    existe(rel) {
      const r = normaliser(rel);
      if (calque.has(r)) return calque.get(r) !== SUPPRIME;
      if (base) return base.existe(r);
      return fs.existsSync(path.join(abs, r));
    },
    /** Fichiers dont le chemin relatif commence par prefixe (récursif, trié), calque compris. */
    lister(prefixe) {
      if (typeof prefixe !== 'string' || !prefixe || prefixe.includes('..') || path.isAbsolute(prefixe)) throw new ZoneInterdite(String(prefixe), 'préfixe relatif attendu');
      const tous = new Set(listerBase(prefixe));
      for (const [r, v] of calque) { if (!r.startsWith(prefixe)) continue; if (v === SUPPRIME) tous.delete(r); else tous.add(r); }
      return [...tous].sort();
    },
    /** Supprime un fichier ou un dossier privé (idempotent). */
    supprimerPrive(rel) {
      const r = normaliser(rel); exigerZone(r, 'prive');
      if (aBlanc) { for (const f of magasin.lister(`${r}/`)) calque.set(f, SUPPRIME); calque.set(r, SUPPRIME); }
      else fs.rmSync(path.join(abs, r), { recursive: true, force: true });
      suppressions.add(r);
    },
    /** Écritures faites (ou prévues, à blanc) par ce magasin. */
    plan: () => ({ publiques: [...publiques].sort(), privees: [...privees].sort(), suppressions: [...suppressions].sort() }),
    /** Pour le code qui ferait un effet réel hors du magasin : lève EcritureABlanc en mode à blanc. */
    exigerReel(motif) { if (aBlanc) throw new EcritureABlanc(motif); },
    /** Magasin à blanc posé sur celui-ci : il lit tout ce que celui-ci voit et n'écrit rien. */
    enCalque: () => creerMagasin(abs, { aBlanc: true, verifierPublic, base: magasin }),
  };
  return magasin;
}
