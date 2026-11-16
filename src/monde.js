// MONDE (M7) : COMPRENDRE, CONFRONTER, HYPOTHÈSES, RÉVISER. Fonctions pures : elles renvoient les actes à consigner,
// le cycle (M11/M12) les écrit. Chaque croyance a un niveau (contrats.NIVEAUX), des preuves (numéros de lignes du
// registre) et un test déclaratif évalué sans LLM (socle.evaluerOp). Règles :
// - un échantillon trop petit, un fait malsain ou une valeur illisible donnent « inconnu » (null), jamais une confirmation ;
// - une contradiction fait d'abord soupçonner l'instrument (artefact, lecture partielle, petit échantillon, définition)
//   avant le monde ; une contradiction expliquée par l'instrument est neutre ;
// - échelle asymétrique : → dite_par_client (3 citations de clients dans 2 annonces au moins) ; → observee (confirmations
//   sur test.jours_distincts jours distincts, parseur sain, aucune contradiction ouverte) ; → pari_gagne (croyance
//   commerciale seulement, sur une issue gagnante d'un pari qui la porte). Descente : 2 contradictions consécutives non
//   expliquées → contestee ; critère d'infirmation atteint → refutee ;
// - une croyance « contrainte » ne change que par un acte du propriétaire ou par une contradiction lue à la source
//   (croyance.source) ; aucune révision pendant une panne du parseur (R-29).
// Écarts au contrat Fait : un fait tiré d'une lecture de CGU porte une valeur texte ('autorise'|'interdit'|'ambigu') ;
// un fait peut porter `ligne` (numéro de son acte au registre), que les révisions reprennent comme preuve.
import { NIVEAUX, FAMILLES, TYPES_ACTION, ISSUES_POSITIVES } from './contrats.js';
import { OPS, evaluerOp, valider, creerHorloge, heuresEntre, sha256Texte } from './socle.js';
import { CLES } from './registre.js';

export const VERSION_MONDE = 1;
export const CHEMIN_MONDE = 'etat/monde.json';
export const TYPES_HYPOTHESE = Object.freeze(['artefact_mesure', 'lecture_partielle', 'petit_echantillon', 'changement_definition', 'changement_monde']);
/** Tags codeur.com de la demande ciblée (K16) et du segment prospection (B03). */
export const TAGS_CIBLE = Object.freeze(['Prospection commerciale', 'Télémarketing', 'Data entry']);
export const TAGS_PROSPECTION = Object.freeze(['Prospection commerciale', 'Télémarketing']);
/** Tags de développement relevés sur codeur.com le 15/11/2026. */
export const TAGS_DEV = Object.freeze(['Développement spécifique', 'Création de site internet', 'Application mobile', 'Site E-commerce',
  'WordPress', 'Full-stack', 'Migration ou refonte de site', 'Site clé en main', 'SaaS', 'Logiciel', 'Marketplace', 'iOS', 'Android',
  'Shopify', 'API', 'Système de paiement', 'React', 'No code', 'Modules et composants', 'WooCommerce', 'Chatbot', 'CMS',
  'Prestashop', 'Python', 'Laravel', 'PHP', 'Flutter', 'Flutterflow', 'Stripe', 'Back-end', 'Drupal', 'Wix', 'Maintenance', 'Migration',
  'Système embarqué', 'Gestion site web', 'Application Meta', 'Windev, Webdev', 'ERP', 'Développement web', 'Machine Learning', 'Big Data']);

const JOUR_H = 24, FENETRE_CIBLE_H = 14 * JOUR_H, FENETRE_DONNEES_H = 28 * JOUR_H;
const sansAccents = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '');
const jourDe = (iso) => creerHorloge(iso).jour();
const arrondi = (x, n = 3) => Math.round(x * 10 ** n) / 10 ** n;
const uniques = (xs) => [...new Set(xs)];
const nombres = (xs) => uniques(xs.filter((x) => Number.isInteger(x) && x > 0)).sort((a, b) => a - b);
const cloner = (x) => JSON.parse(JSON.stringify(x));
export function mediane(xs) {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : arrondi((v[m - 1] + v[m]) / 2);
}

// ---------------------------------------------------------------------------------------------------------------------
// Croyances initiales (spec : croyances_initiales). Un niveau hors NIVEAUX (« inconnu », « mandat », « par précaution »)
// est ramené au plus proche et gardé en etiquette. Énoncés ≤ 400 caractères (texte libre public, garde).

const T = (sujet, mesure, op, seuil, min_n, jours_distincts = 2, extra = {}) => ({ sujet, mesure, op, seuil, min_n, jours_distincts, ...extra });
const I = (sujet, mesure, op, seuil, min_n, consecutifs) => ({ sujet, mesure, op, seuil, min_n, consecutifs });
const C = (id, nature, niveau, preuves, enonce, test = null, infirmation = null, extra = {}) =>
  Object.freeze({ id, nature, enonce, niveau, preuves, test, infirmation, revisee_le: null, etiquette: null, source: null, ...extra });
const TARIFS = '/pages/tarifs-codeur-com', CGU_CODEUR = '/pages/termes-et-conditions-d-utilisation';

export const CROYANCES_INITIALES = Object.freeze([
  C('B01', 'contrainte', 'observee', [13], 'Envoyer une offre sur codeur.com exige un abonnement d’au moins 31,90 € HT par 30 jours, plus 4 % de commission (minimum 5 € HT) : page publique des tarifs lue le 15/11 (aveu ligne 13), qui réfute « inscription gratuite ». Test : relecture de la page chaque dimanche ; une page changée est une contradiction lue à la source.',
    T('page:tarifs-codeur-com', 'identique', '==', 1, 1, 1), null, { source: `codeur:${TARIFS}` }),
  C('B02', 'contrainte', 'observee', [14], '0 € avant le premier encaissement, puis toute dépense en revue humaine (mandat du propriétaire, ligne 14, et politique.json). Seul un nouvel acte mandat du propriétaire la modifie.',
    null, null, { etiquette: 'mandat' }),
  C('B03', 'marche', 'hypothese', [1, 11], 'La prospection commerciale et le télémarketing sont peu concurrencés sur codeur.com : médiane de 5 offres le 15/11 (169 annonces lues, une seule date) contre 100 à 190 en développement. Observée si la médiane reste ≤ 10 (n ≥ 5) à une seconde date, parseur sain ; contestée puis réfutée si elle dépasse 15 deux lectures de suite.',
    T('segment:prospection', 'mediane_offres', '<=', 10, 5), I('segment:prospection', 'mediane_offres', '>', 15, 5, 2)),
  C('B04', 'marche', 'hypothese', [], 'La concurrence arrive dans les premières heures : 3 offres sur 4 en moins de 2 h pour 492531, 15 sur 15 pour 492955 (2 pages détail lues le 15/11, hors registre). Observée si la médiane de devis_2h ÷ offres atteint 0,5 sur au moins 20 annonces suivies ; c’est la seule condition d’un second passage quotidien.',
    T('suivis', 'mediane_part_devis_2h', '>=', 0.5, 20)),
  C('B05', 'commerciale', 'dite_par_client', [11], 'Une partie des acheteurs de prospection achète d’abord « qui appeler » : au moins 3 formulations dans 31 annonces lues (« base de 150 entreprises du BTP », micro-entreprises IT d’Île-de-France, collecte et enrichissement de fiches). Observée si la famille données fait au moins 20 % des annonces de prospection sur 4 semaines ; pari gagné seulement sur une commande de liste.',
    T('segment:prospection', 'part_donnees_28j', '>=', 0.2, 10, 2, { elevation_seule: true }), null, { issues_gagnantes: ['commande', 'paye'] }),
  C('B06', 'commerciale', 'hypothese', [], 'Une réponse accompagnée d’un échantillon réel construit pour la demande obtient une issue positive (devis demandé, échange, commande) en 7 jours au plus. Aucune preuve (0 envoi). Pari gagné dès 1 issue positive ; réfutée après 0 issue positive sur 5 envois ; « question » compte pour l’engagement seulement.',
    null, I('paris', 'issues_positives', '==', 0, 5, 1)),
  C('B07', 'canal', 'hypothese', [15], 'Le propriétaire peut utiliser un canal à 0 € : ComeUp (publication gratuite, 20 % de commission), Malt (profil gratuit, environ 5 à 10 %) ou l’e-mail direct (ligne 15, sources secondaires). Observée quand le propriétaire déclare un canal ouvert et que ses CGU sont lues avec citation vérifiée.'),
  C('B08', 'contrainte', 'hypothese', [], 'Les CGU de codeur.com permettent de contacter un client hors de la plateforme. Aucune preuve : la page des conditions d’utilisation n’a pas été lue. Test : 1 lecture et un jugement lire_cgu aux citations vérifiées ; si elles l’interdisent, l’e-mail direct vers les clients codeur est exclu (R-23).',
    T('cgu:codeur', 'contact_hors_plateforme', '==', 'autorise', 1, 1), I('cgu:codeur', 'contact_hors_plateforme', '==', 'interdit', 1, 1),
    { etiquette: 'inconnu', source: `codeur:${CGU_CODEUR}` }),
  C('B09', 'proprietaire', 'hypothese', [], 'Le propriétaire a un statut pour facturer (micro-entreprise ou autre). Sans statut, un oui ne s’encaisse pas, mais la préparation n’est pas bloquée. Tranchée par un geste « statut … » ; une seule fiche de préalable.',
    null, null, { etiquette: 'inconnu' }),
  C('B10', 'proprietaire', 'observee', [4, 5, 6, 7], 'Le goulot est le geste du propriétaire, pas le moteur : 2 brouillons prêts le 15/11 et 0 envoi ; GALILÉE, CORTEX et LAVOISIER ont tout démontré en simulation et encaissé 0 €. Confirmée si la latence du propriétaire dépasse 48 h sur 3 éléments ; infirmée si sa médiane passe sous 24 h.',
    T('proprietaire', 'latence_mediane_h', '>', 48, 3), I('proprietaire', 'latence_mediane_h', '<', 24, 3, 1)),
  C('B11', 'instrument', 'hypothese', [16], 'opposition_diffusion_commerciale = vrai signale une opposition à la prospection (vrai sur 246 des 1 111 fiches IT lues) ; statut_diffusion vaut « O » partout et ne filtre rien. À confirmer par la documentation de l’API lue par un humain ; si elle donne un autre sens, réintégration seulement après validation du propriétaire.',
    null, null, { etiquette: 'precaution' }),
  C('B12', 'instrument', 'hypothese', [], 'Un CA publié égal à 0 avec un résultat non nul signifie un compte de résultat non publié, pas une activité nulle (123 retenues IT à CA 0, dont 109 à résultat non nul). Confirmée si le propriétaire vérifie 3 fiches ; la règle « dormante » est abandonnée.'),
  C('B13', 'instrument', 'observee', [3, 8], 'L’API SIRENE renvoie 25 résultats par page, sans filtre sur la date de création ; total_results est plafonné à 10 000 et la page 401 renvoie HTTP 400 ; les filtres categorie_entreprise=PME et est_rge fonctionnent (mesures du 15/11). Contredite par un total supérieur à 10 000.',
    T('sirene:sondes', 'total_max', '<=', 10000, 1), I('sirene:sondes', 'total_max', '>', 10000, 1, 1)),
  C('B14', 'instrument', 'observee', [1], 'Les lectures codeur sont saines : 169 annonces, 0 % de champs nuls ; RSS de 35 items sur environ 52 h, pubDate absolue, guid stable. Contredite par une page à 0 fiche ou plus de 20 % de champs nuls : aveu et suspension des faits agrégés, jamais « marché vide ».',
    T('parseur:codeur', 'sain', '==', 1, 0)),
  C('B15', 'instrument', 'observee', [], 'Le registre public ne contient aucune donnée nominative : chaîne intacte, 0 correspondance au scan structurel hors champs d’empreinte. Infirmée par une seule correspondance de l’antifuite, qui bloque le push.',
    T('garde', 'correspondances', '==', 0, 1), I('garde', 'correspondances', '>', 0, 1, 1)),
  C('B16', 'instrument', 'observee', [2, 3, 16], 'Les deux brouillons du 15/11 portaient des chiffres non contrôlés : IT 862 sociétés dont 168 opposées, soit 694 nettes ; BTP 1 119 fiches « complètes » dont 255 aux comptes de plus de 3 ans, soit 864, sur une lecture partielle. Brouillons bloqués, paris clos « caduc » à la migration.'),
  C('B17', 'marche', 'hypothese', [1], 'Une annonce de prospection reste ouverte au moins 7 jours (indices biaisés du 15/11 : 152 ouvertes, 15 en cours, 2 fermées sur 169). Mesurée par l’âge à la dernière lecture « Ouvert » avant fermeture, borne basse ; tranchée à partir de 10 fermetures observées.',
    T('fermetures', 'mediane_ouverture_min_h', '>=', 168, 10)),
  C('B18', 'commerciale', 'hypothese', [9], 'Un dirigeant de 62 ans ou plus est un indice de transmission, pas une intention de vendre. Aucune donnée de cession ; ce signal n’apparaît dans aucune des 31 annonces lues. Tranchée seulement par un retour client.'),
  C('B19', 'commerciale', 'dite_par_client', [3], 'Pour le courtier BTP, les entreprises récentes sont la priorité : c’est le critère écrit en premier dans l’annonce 492531. Confirmée si le client répond sur ce segment, infirmée s’il le rejette.'),
  C('B20', 'commerciale', 'hypothese', [], 'Leçon LAVOISIER : un site sans audience n’amène pas de visiteurs ciblés ; il ne vaut que comme pièce de preuve jointe à un canal. Infirmée si un client cite la page.'),
]);

/** Monde depuis etat/monde.json ; absent → croyances initiales. Une croyance initiale manquante est ajoutée ; un fichier illisible lève. */
export function chargerMonde(magasin) {
  const brut = magasin?.lireJson?.(CHEMIN_MONDE) ?? null;
  if (!brut) return { version: VERSION_MONDE, croyances: cloner(CROYANCES_INITIALES), maj_le: null, references: {} };
  if (!Array.isArray(brut.croyances)) throw new Error(`${CHEMIN_MONDE} illisible : croyances absentes`);
  for (const c of brut.croyances) if (!NIVEAUX.includes(c?.niveau)) throw new Error(`${CHEMIN_MONDE} : niveau inconnu « ${c?.niveau} » (${c?.id})`);
  const ids = new Set(brut.croyances.map((c) => c.id));
  const croyances = [...brut.croyances, ...cloner(CROYANCES_INITIALES.filter((c) => !ids.has(c.id)))];
  return { version: brut.version ?? VERSION_MONDE, croyances, maj_le: brut.maj_le ?? null, references: brut.references ?? {} };
}

/** Contenu public de etat/monde.json (le magasin y applique l'antifuite ; aucune citation n'y est recopiée, seulement son empreinte). */
export function sauverMonde(monde) {
  const { version = VERSION_MONDE, croyances = [], maj_le = null, references = {} } = monde ?? {};
  return { chemin: CHEMIN_MONDE, contenu: `${JSON.stringify({ version, maj_le, croyances, references }, null, 1)}\n` };
}

// ---------------------------------------------------------------------------------------------------------------------
// COMPRENDRE.

// Motifs « données » précis : un mot seul (« collecte », « identifier », « dirigeants ») est ambigu dans une annonce
// commerciale (« syndicats de collecte », « identifier les besoins », « rendez-vous avec des dirigeants ») ; il ne compte
// que suivi de son objet (des données, des fiches, des entreprises…).
const OBJETS_DONNEES = '(?:donnees|informations|fiches?|coordonnees|contacts?|e-?mails?|adresses|leads?|numeros|entreprises?|societes?|prospects?|cibles?|decideurs|dirigeants)';
const ARTICLE = "(?:(?:de|des|du|les|la|le|d['’]|l['’])\\s*)?";
const MOTS_DONNEES = [
  ['base', /\bbases?\s+(?:de\s+(?:donnees|\d|contacts?|prospects?|clients?|leads?|entreprises?|societes?)|clients?|prospects?|contacts?|leads?|e-?mails?)/],
  ['fichier', /\bfichiers?\b/], ['liste', /\blistes?\b/],
  ['identifier', new RegExp(`\\bidentifi(?:er|cation)\\s+${ARTICLE}(?:[a-z]+\\s+)?${OBJETS_DONNEES}\\b`)],
  ['qualifier', new RegExp(`\\bqualif(?:ier|ication)\\s+${ARTICLE}(?:[a-z]+\\s+)?(?:fichiers?|bases?|donnees|listes?)\\b`)],
  ['collecte', new RegExp(`\\bcollect(?:e|er|es|ees?)\\s+(?:et\\s+[a-z]+\\s+)?${ARTICLE}${OBJETS_DONNEES}\\b`)], ['enrichissement', /\benrichi(?:r|ssement)\b/],
  ['dirigeants', /\b(?:noms?|coordonnees|contacts?|e-?mails?|listes?|fichiers?)\s+(?:des\s+|de\s+|du\s+)?dirigeants?\b/],
];
const MOTS_RDV = [['rendez-vous', /\brendez[\s-]?vous\b/], ['rdv', /\brdv\b/], ['appels', /\bappels?\b/], ['télé', /\btele(?!travail|charg|vis)\w+/]];
/** Tags qui disent le livrable : un appel (Télémarketing) ou une saisie de données (Data entry, Data mining). */
const TAG_RDV = 'Télémarketing', TAGS_DONNEES = Object.freeze(['Data entry', 'Data mining']);
const RE_DEV = /developpement (?:web|specifique|logiciel|mobile)|creation de site|application|logiciel|wordpress|shopify|full-stack|back-end|front-end|\bapi\b|\bphp\b|python|react|flutter|laravel|prestashop|woocommerce|drupal|\bwix\b|\bsaas\b|\bios\b|android|\berp\b|\bcms\b/;

/**
 * Famille d'une annonce, par tags puis règles lexicales (titre, résumé, description). Ordre : un tag de développement
 * sans tag de prospection → dev ; le tag Télémarketing sans tag de données → rdv_appels (le livrable est un appel, quel
 * que soit le mot du texte) ; « données » seulement si ses motifs l'emportent strictement sur ceux des appels (à
 * égalité, un tag de données sans Télémarketing départage ; sinon rdv_appels).
 */
export function classerAnnonce(a) {
  const tags = Array.isArray(a?.tags) ? a.tags : [];
  const texte = sansAccents(`${a?.titre ?? ''} ${a?.resume ?? ''} ${a?.description ?? ''}`).toLowerCase();
  const md = MOTS_DONNEES.filter(([, re]) => re.test(texte)).map(([m]) => m);
  const mr = MOTS_RDV.filter(([, re]) => re.test(texte)).map(([m]) => m);
  const dev = tags.filter((t) => TAGS_DEV.includes(t) || RE_DEV.test(sansAccents(t).toLowerCase()));
  const prospection = tags.some((t) => TAGS_CIBLE.includes(t));
  const tagRdv = tags.includes(TAG_RDV), tagDonnees = tags.some((t) => TAGS_DONNEES.includes(t));
  let famille = 'autre', motifs = [];
  if (dev.length && !prospection) { famille = 'dev'; motifs = dev.map((t) => `tag:${t}`); }
  else if (tagRdv && !tagDonnees) { famille = 'rdv_appels'; motifs = [`tag:${TAG_RDV}`, ...mr, ...md]; }
  else if (md.length && (md.length > mr.length || (md.length === mr.length && tagDonnees && !tagRdv))) { famille = 'donnees'; motifs = [...md, ...mr]; }
  else if (mr.length) { famille = 'rdv_appels'; motifs = [...mr, ...md]; }
  else if (dev.length) { famille = 'dev'; motifs = dev.map((t) => `tag:${t}`); }
  if (!FAMILLES.includes(famille)) throw new Error(`famille inconnue : ${famille}`);
  return { famille, motifs, pertinente: famille === 'donnees' || famille === 'rdv_appels' };
}

const ageDe = (a, luLe) => (typeof a?.publie_le === 'string' && Number.isFinite(Date.parse(a.publie_le)) ? Math.max(0, heuresEntre(a.publie_le, luLe))
  : typeof a?.age_h === 'number' ? a.age_h : null);

/**
 * Demande ciblée (fait demande_cible_14j de COMPRENDRE, KPI demande_cible_14j de MESURER : une seule définition) : une
 * annonce d'un tag cible (Prospection commerciale, Télémarketing, Data entry) ou de famille « données », publiée depuis
 * 14 j au plus. Âge : depuis publie_le s'il est connu, sinon l'âge lu au relevé (age_h) plus le temps écoulé depuis
 * (point de série relevé à t). x : Annonce ou PointSerie ; famille : famille calculée (sinon x.famille).
 */
export function estDemandeCible(x, maintenant, famille = x?.famille) {
  if (!((x?.tags ?? []).some((t) => TAGS_CIBLE.includes(t)) || famille === 'donnees')) return false;
  const h = ageDe(x, maintenant) ?? null;
  const vieillit = typeof x?.publie_le !== 'string' && typeof x?.age_h === 'number' && typeof x?.t === 'string' && Number.isFinite(Date.parse(x.t))
    ? Math.max(0, heuresEntre(x.t, maintenant)) : 0;
  return h !== null && h + vieillit <= FENETRE_CIBLE_H;
}

function pointsParId(series) {
  const m = new Map();
  for (const p of Array.isArray(series) ? series : []) {
    if (!p || typeof p.id !== 'string' || typeof p.t !== 'string' || !Number.isFinite(Date.parse(p.t))) continue;
    if (!m.has(p.id)) m.set(p.id, new Map());
    m.get(p.id).set(p.t, p);
  }
  return new Map([...m].map(([id, pts]) => [id, [...pts.values()].sort((x, y) => Date.parse(x.t) - Date.parse(y.t))]));
}

/**
 * Faits du jour. opts : {monde, horloge, series?: PointSerie[] des relevés précédents (cumuls : parts devis_2h, transitions,
 * fermetures)}. Aucun fait agrégé du marché si obs.sante.ok ≠ true ; restent la santé du parseur, les pages relues et les
 * sondes SIRENE. Actes : un acte fait pour chaque fait qu'une croyance teste (et la santé du parseur), un aveu si panne.
 */
export function comprendre(obs, { monde = null, horloge = null, series = [] } = {}) {
  const lu_le = obs?.lu_le ?? (horloge ?? creerHorloge()).iso();
  const jour = obs?.jour ?? jourDe(lu_le);
  const sante = obs?.sante ?? { ok: false, n: 0, rss_n: 0 };
  const annoncesObs = Array.isArray(obs?.annonces) ? obs.annonces : [];
  // Annonce réhydratée d'une série (conteneur neuf : ni titre ni résumé) : la famille classée au relevé est reprise.
  const sansTexte = (a) => ![a.titre, a.resume, a.description].some((x) => typeof x === 'string' && x.trim());
  const annonces = annoncesObs.map((a) => ({ id: a.id, ...(sansTexte(a) && FAMILLES.includes(a.famille)
    ? { famille: a.famille, motifs: ['serie'], pertinente: a.famille === 'donnees' || a.famille === 'rdv_appels' } : classerAnnonce(a)) }));
  const familleDe = new Map(annonces.map((a) => [a.id, a.famille]));
  const faits = [];
  const fait = (sujet, mesure, valeur, n, source, extra = {}) => {
    faits.push({ id: CLES.fait(sujet, mesure, jour), sujet, mesure, valeur: valeur ?? null, n, source, lu_le, sain: true, ...extra });
  };

  fait('parseur:codeur', 'sain', sante.ok === true ? 1 : 0, Number.isInteger(sante.n) ? sante.n : 0, 'codeur:liste+rss');
  for (const p of Array.isArray(obs?.pages) ? obs.pages : []) {
    if (typeof p?.chemin !== 'string' || !p.chemin.startsWith('/pages/')) continue;
    const ref = monde?.references?.[p.chemin]?.sha256 ?? null;
    fait(`page:${p.chemin.slice(7)}`, 'identique', ref ? (p.sha256 === ref ? 1 : 0) : null, ref ? 1 : 0, `codeur:${p.chemin}`, { chemin: p.chemin, sha256: p.sha256 ?? null });
  }
  const sondes = (Array.isArray(obs?.sondes) ? obs.sondes : []).filter((s) => typeof s?.total === 'number');
  if (sondes.length) fait('sirene:sondes', 'total_max', Math.max(...sondes.map((s) => s.total)), sondes.length, 'sirene:compte');
  for (const s of sondes) fait(`sonde:${s.recette}`, 'total', s.total, 1, 'sirene:compte');

  if (sante.ok === true) {
    const offres = (L) => L.map((a) => a.offres).filter((o) => typeof o === 'number');
    const cible = annoncesObs.filter((a) => estDemandeCible(a, lu_le, familleDe.get(a.id)));
    fait('demande_cible_14j', 'annonces', cible.length, cible.length, 'codeur:liste');
    fait('demande_cible_14j', 'mediane_offres', mediane(offres(cible)), offres(cible).length, 'codeur:liste');
    const prosp = annoncesObs.filter((a) => (a.tags ?? []).some((t) => TAGS_PROSPECTION.includes(t)));
    fait('segment:prospection', 'mediane_offres', mediane(offres(prosp)), offres(prosp).length, 'codeur:liste');
    const recentes = prosp.filter((a) => { const h = ageDe(a, lu_le); return h !== null && h <= FENETRE_DONNEES_H; });
    fait('segment:prospection', 'part_donnees_28j', recentes.length ? arrondi(recentes.filter((a) => familleDe.get(a.id) === 'donnees').length / recentes.length) : null,
      recentes.length, 'codeur:liste');
    const parTag = new Map();
    for (const a of annoncesObs) for (const t of new Set(a.tags ?? [])) { if (!parTag.has(t)) parTag.set(t, []); parTag.get(t).push(a); }
    for (const t of [...parTag.keys()].sort()) fait(`tag:${t}`, 'mediane_offres', mediane(offres(parTag.get(t))), offres(parTag.get(t)).length, 'codeur:liste');

    // Parts de devis en moins de 2 h : les suivis du jour, puis la médiane cumulée sur les annonces suivies (dernier relevé par id).
    const part = (n, o) => (typeof n === 'number' && typeof o === 'number' && o > 0 ? arrondi(Math.min(1, n / o)) : null);
    const parts = new Map();
    for (const [id, pts] of pointsParId(series)) {
      const d = pts.filter((p) => p.detail && part(p.devis_2h_n, p.offres) !== null).at(-1);
      if (d) parts.set(id, part(d.devis_2h_n, d.offres));
    }
    for (const s of Array.isArray(obs?.suivis) ? obs.suivis : []) {
      const v = part(s?.devis_2h?.n, s?.offres);
      if (v === null) continue;
      fait(`suivi:${s.id}`, 'part_devis_2h', v, s.offres, 'codeur:detail');
      parts.set(String(s.id), v);
    }
    fait('suivis', 'mediane_part_devis_2h', mediane([...parts.values()]), parts.size, 'codeur:detail');

    // Transitions de statut depuis le dernier relevé antérieur, et fermetures cumulées (âge à la dernière lecture « Ouvert »).
    const avant = pointsParId(series), parIdAuj = new Map();
    for (const a of [...annoncesObs, ...(Array.isArray(obs?.suivis) ? obs.suivis : [])]) {
      const id = String(a.id), prec = parIdAuj.get(id);
      parIdAuj.set(id, { id, statut: a.statut ?? prec?.statut ?? null, publie_le: a.publie_le ?? prec?.publie_le ?? null });
    }
    const auj = [...parIdAuj.values()], transitions = new Map();
    for (const a of auj) {
      const prec = (avant.get(String(a.id)) ?? []).filter((p) => p.t < lu_le).at(-1);
      if (prec?.statut && a.statut && prec.statut !== a.statut) { const k = `${prec.statut}>${a.statut}`; transitions.set(k, (transitions.get(k) ?? 0) + 1); }
    }
    for (const k of [...transitions.keys()].sort()) fait('statuts', `transition:${k}`, transitions.get(k), transitions.get(k), 'codeur:series');
    const tous = pointsParId([...(Array.isArray(series) ? series : []),
      ...auj.filter((a) => a.statut).map((a) => ({ id: String(a.id), t: lu_le, statut: a.statut, publie_le: a.publie_le ?? null }))]);
    const ages = [];
    for (const pts of tous.values()) {
      const i = pts.findIndex((p, k) => k > 0 && p.statut && p.statut !== 'Ouvert' && pts[k - 1].statut === 'Ouvert');
      const pub = pts.find((p) => typeof p.publie_le === 'string')?.publie_le;
      if (i > 0 && pub) ages.push(arrondi(Math.max(0, heuresEntre(pub, pts[i - 1].t)), 1));
    }
    fait('fermetures', 'mediane_ouverture_min_h', mediane(ages), ages.length, 'codeur:series');
  }

  const testes = new Set((monde?.croyances ?? CROYANCES_INITIALES).flatMap((c) => [c.test, c.infirmation].filter(Boolean).map((t) => `${t.sujet}|${t.mesure}`)));
  const actes = faits.filter((f) => f.sujet === 'parseur:codeur' || testes.has(`${f.sujet}|${f.mesure}`))
    .map((f) => ({ type: 'fait', cle: f.id, sujet: f.sujet, mesure: f.mesure, valeur: f.valeur, n_fait: f.n, source: f.source, sain: f.sain }));
  if (sante.ok !== true) {
    actes.push({ type: 'aveu', cle: `aveu:parseur:${jour}`, motif: `parseur codeur en défaut (n = ${sante.n ?? 0}, rss = ${sante.rss_n ?? 0}) : aucun fait agrégé du marché ce jour ; ce n’est pas un marché vide` });
  }
  return { faits, annonces, actes };
}

/**
 * Faits tirés d'un jugement lire_cgu accepté (citations déjà vérifiées par sous-chaîne) : un fait par sujet de clause,
 * valeur 'interdit' si une clause interdit, sinon 'ambigu' si une clause l'est, sinon 'autorise'.
 */
export function faitsCgu(jugement, { chemin, lu_le, jour = null } = {}) {
  const canal = jugement?.canal, clauses = Array.isArray(jugement?.clauses) ? jugement.clauses : [];
  if (typeof canal !== 'string' || !canal || typeof chemin !== 'string' || typeof lu_le !== 'string') throw new TypeError('faitsCgu : canal, chemin et lu_le requis');
  const j = jour ?? jourDe(lu_le), sujets = uniques(clauses.map((c) => c.sujet)).sort();
  return sujets.map((s) => {
    const v = clauses.filter((c) => c.sujet === s).map((c) => c.verdict);
    const valeur = v.includes('interdit') ? 'interdit' : v.includes('ambigu') ? 'ambigu' : 'autorise';
    return { id: CLES.fait(`cgu:${canal}`, s, j), sujet: `cgu:${canal}`, mesure: s, valeur, n: v.length, source: `${canal}:${chemin}`, lu_le, sain: true };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// CONFRONTER.

/** true|false|null : null si le fait est malsain, trop petit (n < min_n) ou illisible ; un opérateur inconnu lève. */
export function evaluerPredicat(test, fait) {
  if (!test || !OPS.includes(test.op)) throw new Error(`opérateur inconnu : ${test?.op}`);
  if (!fait || fait.sain === false) return null;
  if (typeof fait.n !== 'number' || fait.n < (test.min_n ?? 0)) return null;
  if (fait.valeur === null || fait.valeur === undefined) return null;
  return evaluerOp(test.op, fait.valeur, test.seuil);
}

const vise = (t, f) => t && f.sujet === t.sujet && f.mesure === t.mesure;
const ecartDe = (f, t) => (typeof f.valeur === 'number' && typeof t.seuil === 'number' ? arrondi(f.valeur - t.seuil)
  : `« ${f.valeur} » au lieu de ${t.op} « ${t.seuil} »`);

/** Confronte les faits au monde. Une contradiction au plus par croyance et par jour (clé contradiction:<croyance>:<jour>). */
export function confronter(faits, monde) {
  const F = Array.isArray(faits) ? faits : [], confirmations = [], contradictions = [], non_testees = [], utilises = new Set();
  for (const b of monde?.croyances ?? []) {
    let evaluee = false;
    const candidats = new Map();
    const contredire = (f, t, infirme) => {
      const jour = jourDe(f.lu_le), prec = candidats.get(jour);
      if (prec && (prec.infirme || !infirme)) return;
      candidats.set(jour, { id: `X-${b.id}-${jour}`, cle: CLES.contradiction(b.id, jour), croyance: b.id, fait: f, attendu: `${t.op} ${t.seuil}`,
        ecart: ecartDe(f, t), infirme, min_n: t.min_n ?? 0, source_lue: Boolean(b.source) && f.source === b.source, jour });
    };
    for (const f of F) {
      if (vise(b.test, f)) {
        utilises.add(f);
        const r = evaluerPredicat(b.test, f);
        if (r === null) continue;
        evaluee = true;
        const inf = vise(b.infirmation, f) ? evaluerPredicat(b.infirmation, f) === true : false;
        if (r) confirmations.push({ croyance: b.id, fait: f, jour: jourDe(f.lu_le), source_lue: Boolean(b.source) && f.source === b.source });
        else if (!b.test.elevation_seule || inf) contredire(f, b.test, inf);
      } else if (vise(b.infirmation, f)) {
        utilises.add(f);
        const r = evaluerPredicat(b.infirmation, f);
        if (r === null) continue;
        evaluee = true;
        if (r) contredire(f, b.infirmation, true);
      }
    }
    contradictions.push(...[...candidats.values()].sort((x, y) => x.jour.localeCompare(y.jour)));
    if (!evaluee) non_testees.push(b.id);
  }
  const actes = contradictions.map((c) => ({ type: 'contradiction', cle: c.cle, croyance: c.croyance, fait: c.fait.id, attendu: c.attendu, ecart: c.ecart,
    valeur: c.fait.valeur, n_fait: c.fait.n, source: c.fait.source, infirme: c.infirme }));
  return { confirmations, contradictions, hors_modele: F.filter((f) => !utilises.has(f)), non_testees, actes };
}

// ---------------------------------------------------------------------------------------------------------------------
// HYPOTHÈSES : l'instrument d'abord, le monde en dernier.

const testInstrument = (source) => (String(source).startsWith('sirene') ? { action: 'sonder', cout_requetes: 1 }
  : /:\/pages\//.test(String(source)) ? { action: 'lire_cgu', cout_requetes: 1 } : { action: 'suivre_annonce', cout_requetes: 1 });

/** Hypothèses rangées pour chaque contradiction. Parseur en panne → artefact_mesure seulement. */
export function expliquer(contradictions, { sante = null, lectures = {}, faits = [] } = {}) {
  const out = [];
  for (const c of Array.isArray(contradictions) ? contradictions : []) {
    const f = c.fait && typeof c.fait === 'object' ? c.fait : faits.find((x) => x.id === c.fait) ?? {};
    const complet = lectures?.complet === false || f.complet === false ? false : lectures?.complet === true || f.complet === true ? true : null;
    const types = [['artefact_mesure', { action: 'rien', cout_requetes: 0 }]];
    if (sante?.ok !== false) {
      if (complet === false) types.push(['lecture_partielle', { action: 'sonder', cout_requetes: 1 }]);
      // Un échantillon n'existe que pour une mesure tirée (min_n ≥ 2) ; une lecture unique (page, CGU) n'est pas « petite ».
      if (typeof f.n === 'number' && c.min_n >= 2 && f.n < 2 * c.min_n) types.push(['petit_echantillon', { action: 'rien', cout_requetes: 0 }]);
      types.push(['changement_definition', testInstrument(f.source)], ['changement_monde', { action: 'rien', cout_requetes: 0 }]);
    }
    types.forEach(([type, test], i) => {
      if (!TYPES_ACTION.includes(test.action)) throw new Error(`action de test inconnue : ${test.action}`);
      out.push({ id: `H-${c.croyance}-${c.jour ?? jourDe(f.lu_le)}-${type}`, cle: CLES.hypothese(c.cle ?? c.id, type), contradiction: c.id, croyance: c.croyance,
        fait: f.id ?? null, type, test, rang: i + 1, n: typeof f.n === 'number' ? f.n : null, min_n: c.min_n ?? null, complet });
    });
  }
  return out;
}

/** Résultat mécanique de chaque hypothèse : artefact si sante.ok = false ; lecture partielle si complet = false ; petit échantillon si n < 2 × min_n. */
export function testerHypotheses(hyps, { sante = null, faits = [], observation = null } = {}) {
  return (Array.isArray(hyps) ? hyps : []).map((h) => {
    const f = faits.find((x) => x.id === h.fait) ?? null;
    const n = typeof f?.n === 'number' ? f.n : h.n;
    const complet = observation?.lectures?.complet === false || f?.complet === false ? false : h.complet;
    let resultat = 'ouverte';
    if (h.type === 'artefact_mesure') resultat = sante?.ok === false ? 'confirmee' : sante?.ok === true ? 'rejetee' : 'ouverte';
    else if (h.type === 'lecture_partielle') resultat = complet === false ? 'confirmee' : complet === true ? 'rejetee' : 'ouverte';
    else if (h.type === 'petit_echantillon') resultat = typeof n === 'number' && typeof h.min_n === 'number' ? (n < 2 * h.min_n ? 'confirmee' : 'rejetee') : 'ouverte';
    return { id: h.id, resultat };
  });
}

/** Actes hypothese (avec leur résultat quand il est connu). */
export function actesHypotheses(hyps, resultats = []) {
  const r = new Map(resultats.map((x) => [x.id, x.resultat]));
  return hyps.map((h) => ({ type: 'hypothese', cle: h.cle, contradiction: h.contradiction, croyance: h.croyance, type_hyp: h.type, test: h.test, rang: h.rang,
    resultat: r.get(h.id) ?? h.resultat ?? 'ouverte' }));
}

/** Actions qu'un test d'hypothèse peut demander : observer seulement, jamais rédiger, envoyer ou publier. */
export const ACTIONS_TEST = Object.freeze(['rien', 'suivre_annonce', 'lire_cgu', 'sonder', 'echantillonner']);
export const SCHEMA_EXPLIQUER = Object.freeze({ type: 'objet', champs: {
  contradiction: { type: 'texte', requis: true, min: 1, max: 120 },
  type: { type: 'enum', requis: true, valeurs: TYPES_HYPOTHESE },
  pourquoi: { type: 'texte', requis: true, min: 1, max: 300 },
  test: { type: 'objet', requis: true, champs: {
    action: { type: 'enum', requis: true, valeurs: ACTIONS_TEST },
    cout_requetes: { type: 'entier', requis: true, min: 0, max: 20 },
  } },
  echeance_jours: { type: 'entier', requis: true, min: 1, max: 14 },
} });

/** Jugement expliquer_contradiction du LLM : test chiffré (action d'observation et coût en requêtes) et échéance de 14 j au plus. */
export function accepterHypotheseLLM(json) {
  return valider(SCHEMA_EXPLIQUER, json);
}

// ---------------------------------------------------------------------------------------------------------------------
// RÉVISER.

const TRANSITIONS = Object.freeze({
  hypothese: ['dite_par_client', 'observee', 'pari_gagne', 'contestee', 'refutee'],
  dite_par_client: ['observee', 'pari_gagne', 'contestee', 'refutee'],
  observee: ['pari_gagne', 'contestee', 'refutee'],
  pari_gagne: ['contestee', 'refutee'],
  contestee: ['hypothese', 'pari_gagne', 'refutee'],
  refutee: [],
});
const gagnantes = (b) => b.issues_gagnantes ?? ISSUES_POSITIVES;

/**
 * Applique une révision {croyance, de, vers, preuves, motif, par: 'velyx'|'proprietaire', le, issue?, source_lue?}.
 * Lève : croyance inconnue, « de » périmé, niveau inconnu, transition hors table (sauf acte du propriétaire),
 * pari_gagne hors croyance commerciale ou sans issue gagnante, contrainte changée ni par le propriétaire ni à la source,
 * croyance commerciale changée par un geste du propriétaire.
 */
export function appliquerRevision(monde, revision) {
  const r = revision ?? {}, i = (monde?.croyances ?? []).findIndex((c) => c.id === r.croyance);
  if (i < 0) throw new Error(`révision refusée : croyance inconnue « ${r.croyance} »`);
  const b = monde.croyances[i];
  if (!NIVEAUX.includes(r.vers)) throw new Error(`révision refusée : niveau inconnu « ${r.vers} »`);
  if (r.de !== b.niveau) throw new Error(`révision refusée : ${b.id} est « ${b.niveau} », pas « ${r.de} »`);
  if (r.de === r.vers) throw new Error(`révision refusée : ${b.id} reste « ${r.vers} »`);
  if (r.vers === 'pari_gagne') {
    if (b.nature !== 'commerciale') throw new Error(`révision refusée : pari_gagne réservé aux croyances commerciales (${b.id} : ${b.nature})`);
    if (!gagnantes(b).includes(r.issue)) throw new Error(`révision refusée : l’issue « ${r.issue} » ne gagne pas un pari pour ${b.id} (R-29)`);
  }
  if (r.par === 'proprietaire') {
    if (b.nature === 'commerciale') throw new Error(`révision refusée : ${b.id} est commerciale, seule une issue de pari la change`);
  } else {
    if (!TRANSITIONS[r.de].includes(r.vers)) throw new Error(`révision refusée : transition illégale ${r.de} → ${r.vers} (${b.id})`);
    if (b.nature === 'contrainte' && r.source_lue !== true) throw new Error(`révision refusée : ${b.id} est une contrainte (acte du propriétaire ou lecture à la source seulement)`);
  }
  const croyances = monde.croyances.slice();
  croyances[i] = { ...b, niveau: r.vers, preuves: nombres([...(b.preuves ?? []), ...(r.preuves ?? [])]), revisee_le: r.le ?? monde.maj_le ?? null };
  return { ...monde, croyances, maj_le: r.le ?? monde.maj_le ?? null };
}

const ligneDe = (x) => (Number.isInteger(x?.ligne) ? x.ligne : Number.isInteger(x?.n) && typeof x?.type === 'string' ? x.n : null);
const borner = (xs, n = 50) => xs.slice(-n);
const traceVide = () => ({ confirmations: [], contradictions: [], consecutives: 0, infirmations: 0, citations: [], issues: [] });

function lireCanal(valeur) {
  if (valeur && typeof valeur === 'object') return { id: valeur.id ?? valeur.canal, etat: valeur.etat ?? valeur.statut };
  const m = /^\s*([a-z_]+)\s*[:= ]\s*(ouvert|ferme)\s*$/i.exec(String(valeur ?? ''));
  return m ? { id: m[1].toLowerCase() === 'email' ? 'email_direct' : m[1].toLowerCase(), etat: m[2].toLowerCase() } : null;
}

/**
 * Révise le monde. opts : {confrontation, hypotheses (avec resultat, ou fusionnées avec testerHypotheses), issues:
 * [{pari, issue, croyances, ligne?}], gestes (actes geste ou mandat du propriétaire), sante, horloge, citations?:
 * [{croyance, annonce_id, citation, ligne?}], faits? (références des pages relues), canaux? (CGU lues, pour B07)}.
 * Seuils écrits d'avance dans chaque croyance ; une révision au plus par croyance et par appel.
 */
export function reviser(monde, { confrontation = {}, hypotheses = [], issues = [], gestes = [], sante = null, horloge = null, citations = [], faits = [],
  canaux = null } = {}) {
  const h = horloge ?? creerHorloge(), le = h.iso(), jour = h.jour();
  let m = { ...cloner(monde), references: { ...(monde?.references ?? {}) } };
  for (const f of Array.isArray(faits) ? faits : []) {
    if (typeof f?.chemin === 'string' && typeof f.sha256 === 'string' && !m.references[f.chemin]) m.references[f.chemin] = { sha256: f.sha256, lu_le: f.lu_le ?? le };
  }
  if (sante?.ok === false) {
    return { monde: m, revisions: [], actes: [{ type: 'aveu', cle: `aveu:revision:${jour}`, motif: 'révision suspendue : parseur codeur en panne, aucune croyance ne change (R-29)' }] };
  }
  const expliquees = new Set((Array.isArray(hypotheses) ? hypotheses : []).filter((x) => x.type !== 'changement_monde' && x.resultat === 'confirmee').map((x) => x.contradiction));
  const revisions = [], actes = [], deja = new Set();
  const reviserB = (b, vers, motif, preuves, extra = {}) => {
    if (deja.has(b.id) || b.niveau === vers) return;
    const rev = { croyance: b.id, de: b.niveau, vers, preuves: nombres(preuves), motif, par: 'velyx', le, ...extra };
    m = appliquerRevision(m, rev);
    deja.add(b.id); revisions.push(rev);
    actes.push({ type: 'revision', cle: `${CLES.revision(b.id, jour)}:${rev.de}>${vers}`, croyance: b.id, de: rev.de, vers, preuves: rev.preuves, motif, par: rev.par,
      ...(extra.issue ? { issue: extra.issue } : {}), ...(extra.faits?.length ? { faits: extra.faits } : {}) });
  };
  const courante = (id) => m.croyances.find((c) => c.id === id);

  // 1. Gestes du propriétaire (statut, canal, mandat).
  for (const g of Array.isArray(gestes) ? gestes : []) {
    const n = ligneDe(g), preuves = n ? [n] : [];
    if (g?.type === 'mandat') { const b = courante('B02'); if (b && n) m = { ...m, croyances: m.croyances.map((c) => (c.id === 'B02' ? { ...c, preuves: nombres([...c.preuves, n]) } : c)) }; continue; }
    if (g?.sujet === 'statut') {
      const b = courante('B09'), v = String(g.valeur ?? '').toLowerCase();
      const vers = /^(micro|societe|société|micro-entreprise)/.test(v) ? 'observee' : v === 'aucun' ? 'refutee' : null;
      if (b && vers) reviserB(b, vers, `geste du propriétaire : statut ${v}`, preuves, { par: 'proprietaire' });
    } else if (g?.sujet === 'canal') {
      const c = lireCanal(g.valeur), b = courante('B07');
      if (b && c?.etat === 'ouvert' && canaux?.[c.id]?.cgu === 'lue_compatible') {
        reviserB(b, 'observee', `canal ${c.id} ouvert par le propriétaire, CGU lues compatibles`, [...preuves, ...(canaux[c.id].preuves ?? [])], { par: 'proprietaire' });
      }
    }
  }

  // 2. Traces : confirmations, contradictions non expliquées, issues et citations (idempotent par identifiant).
  const conf = Array.isArray(confrontation?.confirmations) ? confrontation.confirmations : [];
  const contra = (Array.isArray(confrontation?.contradictions) ? confrontation.contradictions : []).filter((c) => !expliquees.has(c.id));
  m = { ...m, croyances: m.croyances.map((b0) => {
    const b = { ...b0, trace: cloner(b0.trace ?? traceVide()) }, t = b.trace;
    const compte = (x) => b.nature !== 'contrainte' || x.source_lue === true;
    const evts = [
      ...conf.filter((c) => c.croyance === b.id && compte(c) && !t.confirmations.some((y) => y.fait === c.fait.id)).map((c) => ({ k: 0, jour: c.jour ?? jourDe(c.fait.lu_le), c })),
      ...contra.filter((c) => c.croyance === b.id && compte(c) && !t.contradictions.some((y) => y.id === c.id)).map((c) => ({ k: 1, jour: c.jour, c })),
    ].sort((x, y) => x.jour.localeCompare(y.jour) || x.k - y.k);
    for (const e of evts) {
      if (e.k === 0) { t.confirmations.push({ fait: e.c.fait.id, jour: e.jour, ligne: ligneDe(e.c.fait) }); t.consecutives = 0; t.infirmations = 0; }
      else { t.contradictions.push({ id: e.c.id, fait: e.c.fait.id, jour: e.jour, infirme: e.c.infirme, ligne: ligneDe(e.c.fait) }); t.consecutives += 1; t.infirmations = e.c.infirme ? t.infirmations + 1 : 0; }
    }
    for (const i of (Array.isArray(issues) ? issues : []).filter((x) => (x.croyances ?? []).includes(b.id))) {
      if (!t.issues.some((y) => y.pari === i.pari && y.issue === i.issue)) t.issues.push({ pari: i.pari, issue: i.issue, ligne: ligneDe(i) });
    }
    for (const c of (Array.isArray(citations) ? citations : []).filter((x) => x.croyance === b.id && x.annonce_id && x.citation)) {
      const e = sha256Texte(c.citation).slice(0, 16);
      if (!t.citations.some((y) => y.empreinte === e)) t.citations.push({ annonce_id: String(c.annonce_id), empreinte: e, ligne: ligneDe(c) });
    }
    for (const k of ['confirmations', 'contradictions', 'citations', 'issues']) t[k] = borner(t[k]);
    return b;
  }) };

  // 3. Règles écrites d'avance, dans l'ordre : infirmation, pari gagné, contestation, réhabilitation, observation, client.
  for (const b of m.croyances) {
    const t = b.trace, lignes = (xs) => xs.map((x) => x.ligne).filter(Boolean);
    const recents = t.confirmations.filter((x) => !b.revisee_le || x.jour > jourDe(b.revisee_le));
    const derniers = t.contradictions.slice(-Math.max(1, t.consecutives));
    const sourceLue = b.nature === 'contrainte' ? { source_lue: true } : {};
    const parPari = new Map();
    for (const i of t.issues) parPari.set(i.pari, (parPari.get(i.pari) ?? false) || ISSUES_POSITIVES.includes(i.issue));
    const gagne = t.issues.find((i) => b.nature === 'commerciale' && gagnantes(b).includes(i.issue));
    if (b.infirmation?.sujet === 'paris') {
      const synth = { n: parPari.size, valeur: [...parPari.values()].filter(Boolean).length, sain: true };
      if (b.niveau !== 'refutee' && !gagne && evaluerPredicat(b.infirmation, synth) === true) {
        reviserB(b, 'refutee', `infirmation : ${synth.valeur} issue positive sur ${synth.n} paris`, lignes(t.issues));
        continue;
      }
    } else if (b.infirmation && b.niveau !== 'refutee' && t.infirmations >= (b.infirmation.consecutifs ?? 1)) {
      reviserB(b, 'refutee', `critère d’infirmation atteint (${b.infirmation.op} ${b.infirmation.seuil}, ${t.infirmations} lecture(s) de suite)`, lignes(derniers),
        { faits: derniers.map((x) => x.fait), ...sourceLue });
      continue;
    }
    if (gagne && !['refutee', 'pari_gagne'].includes(b.niveau)) { reviserB(b, 'pari_gagne', `pari ${gagne.pari} : issue ${gagne.issue}`, [gagne.ligne], { issue: gagne.issue }); continue; }
    const seuilContest = b.nature === 'contrainte' ? 1 : 2;
    if (t.consecutives >= seuilContest && ['hypothese', 'dite_par_client', 'observee', 'pari_gagne'].includes(b.niveau)) {
      reviserB(b, 'contestee', `${t.consecutives} contradiction(s) consécutive(s) non expliquée(s) par l’instrument`, lignes(derniers), { faits: derniers.map((x) => x.fait), ...sourceLue });
      continue;
    }
    const jd = Math.max(1, b.test?.jours_distincts ?? 2), jours = uniques(recents.map((x) => x.jour));
    const assez = b.test && t.consecutives === 0 && recents.length >= jd && jours.length >= jd && sante?.ok === true;
    if (assez && b.niveau === 'contestee') { reviserB(b, 'hypothese', `réhabilitée : confirmée sur ${jours.length} jour(s) distinct(s)`, lignes(recents), { faits: recents.map((x) => x.fait), ...sourceLue }); continue; }
    if (assez && ['hypothese', 'dite_par_client'].includes(b.niveau)) {
      reviserB(b, 'observee', `confirmée sur ${jours.length} jour(s) distinct(s), parseur sain, aucune contradiction ouverte`, lignes(recents), { faits: recents.map((x) => x.fait), ...sourceLue });
      continue;
    }
    if (b.niveau === 'hypothese' && b.nature !== 'contrainte' && t.citations.length >= 3 && uniques(t.citations.map((c) => c.annonce_id)).length >= 2) {
      reviserB(b, 'dite_par_client', `${t.citations.length} citations de clients dans ${uniques(t.citations.map((c) => c.annonce_id)).length} annonces`, lignes(t.citations));
    }
  }
  return { monde: { ...m, maj_le: revisions.length ? le : m.maj_le ?? null }, revisions, actes };
}
