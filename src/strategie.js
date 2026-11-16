// STRATÉGIE (M8) : ANTICIPER, PRIORISER, DÉCIDER (CEO). Fonctions pures, déterministes et expliquées, sans argent
// inventé : aucun champ en euros, aucun score pondéré, aucun ROI. L'attention du propriétaire est la ressource la plus
// rare et « ne rien faire » est une décision consignée. Les prévisions viennent seulement de fréquences empiriques
// mesurées sur des relevés réels (20 cas au moins), sont consignées puis notées à l'échéance par une lecture réelle.
// État des canaux : avec le mandat 0 €, codeur.com (payant) ne sert qu'à observer ; chaque canal porte son coût (texte
// sourcé), l'état de ses CGU et le geste attendu du propriétaire.
import { TYPES_ACTION } from './contrats.js';
import { creerHorloge, empreinte, heuresEntre, evaluerOp } from './socle.js';
import { CLES } from './registre.js';
import { classerAnnonce } from './monde.js';

const HEURE = 3.6e6, GRAND = 1e9;
/** Seuils écrits d'avance (spec M8). */
export const SEUILS = Object.freeze({ offres: 5, devis_2h: 3, fraicheur_h: 336, n_min: 20, horizon_ferme_h: 72, horizon_offres_h: 24,
  regeneration_max: 60, cycles_gel: 5, lecture_rassise_h: 168, urgence_h: 24, wip_max: 2, nouvelles_max: 1, recettes_semaine: 1 });
export const CHEMINS = Object.freeze({ cgu_codeur: '/pages/termes-et-conditions-d-utilisation', tarifs_codeur: '/pages/tarifs-codeur-com' });

/** État initial des canaux (lignes 13, 14 et 15 du registre). `payant` : un envoi coûte avant tout encaissement (D9). */
export const CANAUX_INITIAUX = Object.freeze({
  codeur: Object.freeze({ role: 'observation', cout_envoi: 'payant : abonnement d’au moins 31,90 € HT par 30 jours et 4 % de commission (page tarifs lue le 15/11, ligne 13)',
    statut: 'exclu', cgu: 'inconnue', preuves: Object.freeze([13, 14]), payant: true, geste: 'aucun : exclu par le mandat 0 € (ligne 14)' }),
  email_direct: Object.freeze({ role: 'envoi', cout_envoi: '0 € (messagerie du propriétaire)', statut: 'a_decider', cgu: 'inconnue', preuves: Object.freeze([15]),
    payant: false, geste: 'canal email ouvert' }),
  comeup: Object.freeze({ role: 'envoi', cout_envoi: 'publication gratuite, 20 % de commission sur les ventes (source secondaire, ligne 15)', statut: 'a_ouvrir',
    cgu: 'inconnue', preuves: Object.freeze([15]), payant: false, geste: 'canal comeup ouvert' }),
  malt: Object.freeze({ role: 'envoi', cout_envoi: 'profil gratuit, commission d’environ 5 à 10 % (source secondaire, ligne 15)', statut: 'a_ouvrir',
    cgu: 'inconnue', preuves: Object.freeze([15]), payant: false, geste: 'canal malt ouvert' }),
});

const cloner = (x) => JSON.parse(JSON.stringify(x));
const arrondi = (x, n = 3) => Math.round(x * 10 ** n) / 10 ** n;
const sansAccents = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '');
const ms = (iso) => Date.parse(iso);
const isoPlus = (iso, h) => new Date(ms(iso) + h * HEURE).toISOString();
const idAnnonce = (x) => { const m = /^(?:annonce:)?(\d{1,9})$/.exec(String(x ?? '')) ?? /\/projects\/(\d{1,9})/.exec(String(x ?? '')); return m ? m[1] : null; };

function grouper(series) {
  const m = new Map();
  for (const p of Array.isArray(series) ? series : []) {
    if (!p || typeof p.id !== 'string' || !Number.isFinite(ms(p.t))) continue;
    if (!m.has(p.id)) m.set(p.id, new Map());
    m.get(p.id).set(p.t, p);
  }
  return new Map([...m].map(([id, pts]) => [id, [...pts.values()].sort((a, b) => ms(a.t) - ms(b.t))]));
}

/** Vitesse d'offres par heure entre les deux derniers relevés réels distincts d'une annonce ; null s'il en manque un. */
export function vitesseOffres(points) {
  const v = (Array.isArray(points) ? points : []).filter((p) => typeof p?.offres === 'number' && Number.isFinite(ms(p.t))).sort((a, b) => ms(a.t) - ms(b.t));
  for (let i = v.length - 1; i > 0; i--) {
    const h = heuresEntre(v[i - 1].t, v[i].t);
    if (h > 0) return arrondi((v[i].offres - v[i - 1].offres) / h);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// ANTICIPER.

// Un cas par annonce : son premier relevé « Ouvert » (et, pour offres_gt, à seuil d'offres ou moins). Les deux mesures sont
// monotones (une annonce ne rouvre pas, les offres s'ajoutent) : événement vu avant l'échéance → 1 ; non vu à un relevé
// postérieur à l'échéance → 0 ; sinon le cas n'est pas tranché et ne compte pas.
const valeurPoint = (evenement, seuil) => (p) => (evenement === 'ferme' ? (p.statut ? (p.statut !== 'Ouvert' ? 1 : 0) : null)
  : typeof p.offres === 'number' ? (p.offres > seuil ? 1 : 0) : null);
function compterCas(series, { tag, famille, horizon_h, evenement, seuil } = {}) {
  if (!['ferme', 'offres_gt'].includes(evenement)) throw new Error(`frequenceEmpirique : événement inconnu « ${evenement} »`);
  if (!(typeof horizon_h === 'number' && horizon_h > 0)) throw new Error('frequenceEmpirique : horizon_h > 0 requis');
  if (evenement === 'offres_gt' && typeof seuil !== 'number') throw new Error('frequenceEmpirique : seuil requis pour offres_gt');
  const val = valeurPoint(evenement, seuil);
  let n = 0, k = 0;
  for (const pts of grouper(series).values()) {
    if (tag && !pts.some((p) => (p.tags ?? []).includes(tag))) continue;
    if (famille && !pts.some((p) => p.famille === famille)) continue;
    const t0 = pts.find((p) => p.statut === 'Ouvert' && (evenement === 'ferme' || (typeof p.offres === 'number' && p.offres <= seuil)));
    if (!t0) continue;
    const fin = ms(t0.t) + horizon_h * HEURE, apres = pts.filter((p) => ms(p.t) > ms(t0.t));
    if (apres.some((p) => ms(p.t) <= fin && val(p) === 1)) { n += 1; k += 1; } else if (apres.some((p) => ms(p.t) >= fin && val(p) === 0)) n += 1;
  }
  return { p: n ? arrondi(k / n) : null, n };
}
/** Fréquence empirique d'un événement à l'horizon donné, sur les annonces des séries ; null si moins de 20 cas tranchés. */
export function frequenceEmpirique(series, condition) {
  const r = compterCas(series, condition);
  return r.n < SEUILS.n_min ? null : r;
}

const STOP = new Set(['les', 'des', 'une', 'pour', 'avec', 'dans', 'aux', 'sur', 'par', 'est', 'que', 'qui', 'son', 'ses', 'leur', 'leurs', 'nos', 'vos', 'notre',
  'votre', 'nous', 'vous', 'tout', 'tous', 'toute', 'entreprise', 'entreprises', 'societe', 'societes', 'client', 'clients', 'prospection', 'prospect', 'prospects',
  'fichier', 'fichiers', 'liste', 'listes', 'base', 'donnees', 'moins', 'plus', 'mois', 'ans', 'salaries', 'recherche', 'besoin', 'cherche', 'fiche', 'fiches',
  'projet', 'mission', 'etre', 'avoir', 'faire', 'chaque', 'tout', 'ainsi']);
const jetons = (s) => new Set((sansAccents(s).toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length >= 3 && !STOP.has(t)));
/** Recette existante la plus proche d'une annonce : même annonce, sinon un mot de son identifiant ou 2 mots de son besoin. */
export function recetteProche(a, recettes = {}) {
  const ids = Object.keys(recettes ?? {}).sort();
  const direct = ids.find((id) => idAnnonce(recettes[id]?.annonce) === String(a?.id));
  if (direct) return direct;
  const mots = jetons(`${a?.titre ?? ''} ${a?.resume ?? ''} ${a?.description ?? ''}`);
  let meilleur = null, score = 0;
  for (const id of ids) {
    const parId = [...jetons(id.replace(/-/g, ' '))].filter((t) => mots.has(t)).length;
    const parBesoin = [...jetons(recettes[id]?.besoin ?? '')].filter((t) => mots.has(t)).length;
    const s = parId + parBesoin;
    if ((parId >= 1 || parBesoin >= 2) && s > score) { meilleur = id; score = s; }
  }
  return meilleur;
}

/** Canaux qui pourraient atteindre l'auteur d'une annonce codeur : codeur lui-même s'il n'est pas exclu, l'e-mail direct si les CGU codeur ne l'interdisent pas. */
export function canauxPour(canaux) {
  const out = [];
  for (const id of ['codeur', 'email_direct']) {
    const c = canaux?.[id];
    if (!c || c.statut === 'exclu' || c.statut === 'ferme') continue;
    if (id === 'email_direct' && canaux.codeur?.cgu === 'lue_interdite') continue;
    out.push(id);
  }
  return out;
}

/** Canal utilisable pour une opportunité (D2, D9) : canal ouvert et non payant tant que rien n'est encaissé, ou e-mail direct vers un client identifiable. */
export function canalUtilisable(o, canaux, encaisse_eur = 0) {
  for (const id of o?.canaux_possibles ?? []) {
    const c = canaux?.[id];
    if (!c || c.statut === 'exclu' || c.statut === 'ferme' || (c.payant && !(encaisse_eur > 0))) continue;
    if (c.statut === 'ouvert') return id;
    if (id === 'email_direct' && canaux.codeur?.cgu !== 'lue_interdite' && o.client_identifiable === true) return id;
  }
  return null;
}

const budgetTexte = (b) => (typeof b?.texte === 'string' && b.texte.trim() ? b.texte.trim() : 'non lu');
const PREVISIONS = [
  { mesure: 'ferme', op: '==', seuil: 1, horizon_h: SEUILS.horizon_ferme_h, condition: { evenement: 'ferme' } },
  { mesure: 'offres', op: '>', seuil: SEUILS.offres, horizon_h: SEUILS.horizon_offres_h, condition: { evenement: 'offres_gt', seuil: SEUILS.offres } },
];

/**
 * Prévisions, opportunités et risques. Entrées : {faits, monde, series, etat_registre (Registre.etat()), revues, canaux,
 * horloge} et, en extension, annonces (Annonce + famille/client_identifiable du jour), recettes ({[id]: spec}),
 * budget_reste ({codeur, sirene}) et memoire ({ok}). Aucune annonce fournie → derniers points des séries.
 * Rend aussi les prévisions restées « inconnu » (moins de 20 cas) et les actes prevision.
 */
export function anticiper({ faits = [], monde = null, series = [], etat_registre = null, revues = [], canaux = null, horloge = null, annonces = null,
  recettes = {}, budget_reste = null, memoire = null } = {}) {
  const h = horloge ?? creerHorloge(), now = h.iso(), jour = h.jour(), parId = grouper(series);
  const source = Array.isArray(annonces) ? annonces : [...parId.values()].map((pts) => pts.at(-1));
  const opportunites = [], previsions = [], previsions_inconnues = [], risques = [];
  for (const a of source) {
    if (!a || typeof a.id !== 'string') continue;
    const classe = a.famille ? { famille: a.famille, pertinente: a.pertinente ?? ['donnees', 'rdv_appels'].includes(a.famille) }
      : a.titre ? classerAnnonce(a) : { famille: 'autre', pertinente: false };
    const age = typeof a.publie_le === 'string' && Number.isFinite(ms(a.publie_le)) ? arrondi(Math.max(0, heuresEntre(a.publie_le, now)), 1) : typeof a.age_h === 'number' ? a.age_h : null;
    if (!classe.pertinente || a.statut !== 'Ouvert' || age === null || age > SEUILS.fraicheur_h) continue;
    const recette_proche = recetteProche(a, recettes), preuve_legere = Boolean(recette_proche) || classe.famille === 'donnees';
    const devis = a.devis_2h?.n ?? a.devis_2h_n ?? null;
    opportunites.push({ annonce_id: a.id, famille: classe.famille, age_h: age, offres: typeof a.offres === 'number' ? a.offres : null,
      devis_2h_n: typeof devis === 'number' ? devis : null, budget_affiche: budgetTexte(a.budget), recette_proche, preuve_legere,
      cout_requetes: (a.detail ? 0 : 1) + (preuve_legere ? 3 : 0), canaux_possibles: canauxPour(canaux), client_identifiable: a.client_identifiable === true,
      vitesse_offres_h: vitesseOffres(parId.get(a.id) ?? []) });
    const tag = (a.tags ?? [])[0];
    for (const pv of PREVISIONS) {
      if (pv.mesure === 'offres' && !(typeof a.offres === 'number' && a.offres <= pv.seuil)) continue;
      const cond = { ...pv.condition, horizon_h: pv.horizon_h };
      const parTag = tag ? compterCas(series, { ...cond, tag }) : { n: 0 }, tous = compterCas(series, cond);
      const f = parTag.n >= SEUILS.n_min ? parTag : tous.n >= SEUILS.n_min ? tous : null;
      const sujet = `annonce:${a.id}`;
      if (!f) { previsions_inconnues.push({ sujet, mesure: pv.mesure, horizon_h: pv.horizon_h, n: tous.n, mention: `inconnu (n=${tous.n})` }); continue; }
      const id = CLES.prevision(`${sujet}:${pv.mesure}`, pv.horizon_h, jour);
      previsions.push({ id, sujet, mesure: pv.mesure, op: pv.op, seuil: pv.seuil, p: f.p, n_base: f.n, horizon_h: pv.horizon_h, emise_le: now,
        echeance: isoPlus(now, pv.horizon_h), base: f === parTag ? `tag:${tag}` : 'toutes' });
    }
  }

  const risque = (type, objet, echeance, extra = {}) => risques.push({ type, objet, echeance, dans_h: echeance ? arrondi(heuresEntre(now, echeance), 1) : null, ...extra });
  for (const p of etat_registre?.paris ?? []) {
    if (p.statut === 'envoye' && typeof p.echeance_le === 'string' && heuresEntre(now, p.echeance_le) <= SEUILS.urgence_h) risque('pari_echu', p.id, p.echeance_le);
  }
  for (const r of (Array.isArray(revues) ? revues : []).filter((x) => x.statut === 'ouverte')) {
    const ann = idAnnonce(r.ref), dernier = ann ? (parId.get(ann) ?? []).at(-1) : null;
    if (dernier?.statut && dernier.statut !== 'Ouvert') risque('annonce_fermee', r.id, now, { annonce: ann, statut: dernier.statut });
    else if (ann && (!dernier || heuresEntre(dernier.t, now) > SEUILS.lecture_rassise_h)) risque('revue_rassise', r.id, now, { annonce: ann, motif: 'lecture de plus de 7 j' });
    else if (typeof r.expire_le === 'string' && heuresEntre(now, r.expire_le) <= SEUILS.urgence_h) risque('revue_rassise', r.id, r.expire_le, { motif: 'expiration' });
  }
  if (faits.some((f) => f.sujet === 'parseur:codeur' && f.mesure === 'sain' && f.valeur === 0)) risque('parseur', 'codeur', now);
  if (budget_reste && (budget_reste.codeur ?? 1) < 1) risque('budget', 'codeur', now);
  if (budget_reste && (budget_reste.sirene ?? 1) < 1) risque('budget', 'sirene', now);
  const geste = etat_registre?.dernier_geste_proprietaire;
  if (typeof geste === 'string' && heuresEntre(geste, now) > 48) risque('goulot', 'proprietaire', isoPlus(geste, SEUILS.cycles_gel * 24));
  if (memoire && memoire.ok === false) risque('memoire', 'prive/memoire.json', now);
  if (canaux && !Object.values(canaux).some((c) => c.statut === 'ouvert' && !c.payant)) risque('canal_absent', 'canaux', null);
  if ((monde?.croyances ?? []).find((c) => c.id === 'B09')?.niveau !== 'observee') risque('statut_absent', 'B09', null);

  const actes = previsions.map((p) => ({ type: 'prevision', cle: p.id, sujet: p.sujet, mesure: p.mesure, op: p.op, seuil: p.seuil, p: p.p, n_base: p.n_base,
    horizon_h: p.horizon_h, echeance: p.echeance }));
  return { previsions, opportunites, risques, previsions_inconnues, actes };
}

/**
 * Note les prévisions échues par une lecture réelle des séries (jamais par un rejeu) : issue 1 si l'événement est lu avant
 * l'échéance, 0 s'il ne l'est pas à un relevé postérieur ; sinon la prévision reste en attente. Rend les actes resolution.
 */
export function noterPrevisions(previsions, series, horloge = null) {
  const now = (horloge ?? creerHorloge()).iso(), parId = grouper(series), resolutions = [], en_attente = [];
  for (const pv of Array.isArray(previsions) ? previsions : []) {
    const echeance = pv.echeance ?? isoPlus(pv.emise_le, pv.horizon_h), ann = idAnnonce(pv.sujet);
    if (!ann || ms(now) < ms(echeance)) { en_attente.push(pv.id); continue; }
    const val = (p) => (pv.mesure === 'ferme' ? (p.statut ? (p.statut !== 'Ouvert' ? 1 : 0) : null) : typeof p.offres === 'number' ? p.offres : null);
    const vrai = (p) => val(p) !== null && evaluerOp(pv.op, val(p), pv.seuil);
    const pts = (parId.get(ann) ?? []).filter((p) => ms(p.t) > ms(pv.emise_le));
    const oui = pts.find((p) => ms(p.t) <= ms(echeance) && vrai(p));
    const non = oui ? null : pts.find((p) => ms(p.t) >= ms(echeance) && val(p) !== null && !vrai(p));
    const p = oui ?? non;
    if (!p) { en_attente.push(pv.id); continue; }
    resolutions.push({ prevision: pv.id, issue: oui ? 1 : 0, source: `etat/series/${creerHorloge(p.t).jour()}.jsonl#${ann}@${p.t}` });
  }
  const actes = resolutions.map((r) => ({ type: 'resolution', cle: `resolution:${r.prevision}`, prevision: r.prevision, issue: r.issue, source: r.source }));
  return { resolutions, en_attente, actes };
}

// ---------------------------------------------------------------------------------------------------------------------
// Canaux et préalables.

function lireCanal(valeur) {
  if (valeur && typeof valeur === 'object') return { id: valeur.id ?? valeur.canal, etat: valeur.etat ?? valeur.statut };
  const m = /^\s*([a-z_]+)\s*[:= ]\s*(ouvert|ferme)\s*$/i.exec(String(valeur ?? ''));
  return m ? { id: m[1].toLowerCase() === 'email' ? 'email_direct' : m[1].toLowerCase(), etat: m[2].toLowerCase() } : null;
}
const cguDe = (clauses) => (!clauses.length ? 'inconnue' : clauses.some((c) => c.verdict === 'interdit') ? 'lue_interdite'
  : clauses.some((c) => c.verdict === 'ambigu') ? 'ambigue' : 'lue_compatible');

/**
 * État des canaux depuis le registre (gestes « canal <id> ouvert|ferme » du propriétaire) et les CGU lues
 * (pages_lues : [{canal, chemin, clauses?: [{sujet, verdict}], cgu?, ligne?}]). Pour codeur, seule la clause
 * contact_hors_plateforme compte : c'est elle qui ouvre ou ferme l'e-mail direct vers ses clients (R-23).
 */
export function calculerCanaux(registre, pages_lues = []) {
  const canaux = cloner(CANAUX_INITIAUX);
  const lignes = Array.isArray(registre) ? registre : registre?.lignes ?? [];
  for (const l of lignes) {
    if (l?.type !== 'geste' || l.auteur !== 'proprietaire' || l.sujet !== 'canal') continue;
    const c = lireCanal(l.valeur);
    if (!c || !canaux[c.id] || !['ouvert', 'ferme'].includes(c.etat)) continue;
    canaux[c.id].statut = c.etat;
    if (Number.isInteger(l.n)) canaux[c.id].preuves.push(l.n);
  }
  for (const p of Array.isArray(pages_lues) ? pages_lues : []) {
    const id = p?.canal ?? (p?.chemin === CHEMINS.cgu_codeur ? 'codeur' : null);
    if (!canaux[id]) continue;
    const clauses = (Array.isArray(p.clauses) ? p.clauses : []).filter((c) => id !== 'codeur' || c.sujet === 'contact_hors_plateforme');
    const cgu = ['inconnue', 'lue_compatible', 'lue_interdite', 'ambigue'].includes(p.cgu) ? p.cgu : cguDe(clauses);
    if (cgu === 'inconnue') continue;
    canaux[id].cgu = cgu;
    if (Number.isInteger(p.ligne)) canaux[id].preuves.push(p.ligne);
  }
  for (const c of Object.values(canaux)) c.preuves = [...new Set(c.preuves)].sort((a, b) => a - b);
  return canaux;
}

/** Préalables ouverts : statut pour facturer (B09), canal gratuit ouvert, CGU codeur (lues par l'agent, pas par le propriétaire). */
export function prealablesOuverts(monde, canaux) {
  const out = [];
  if ((monde?.croyances ?? []).find((c) => c.id === 'B09')?.niveau !== 'observee') out.push({ ref: 'statut', sujet: 'statut', motif: 'statut pour facturer inconnu (B09)' });
  if (!Object.values(canaux ?? {}).some((c) => c.statut === 'ouvert' && !c.payant)) out.push({ ref: 'canal', sujet: 'canal', motif: 'aucun canal gratuit ouvert (B07)' });
  if ((canaux?.codeur?.cgu ?? 'inconnue') === 'inconnue') out.push({ ref: 'cgu:codeur', sujet: 'cgu', motif: 'CGU codeur non lues (B08)' });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// PRIORISER : ordre lexicographique, sans score pondéré ni ROI ; le budget affiché n'entre dans aucune clé.

const comparer = (a, b) => {
  for (let i = 0; i < a.cles.length; i++) if (a.cles[i] !== b.cles[i]) return a.cles[i] - b.cles[i];
  return a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0;
};

/**
 * File de travail. Clés : 1) risque à échéance ≤ 24 h ; 2) préalable ouvert ; 3) canal utilisable ; 4) recette existante
 * ou famille données ; 5) offres ≤ 5 ; 6) devis_2h ≤ 3 ; 7) âge croissant ; 8) coût en requêtes croissant ; 9) id
 * décroissant. Une inconnue (offres, devis_2h ou âge nuls) ne satisfait pas son critère. Gel des nouvelles opportunités
 * dès wip_max propositions ouvertes (D3) ; nouvelles_max opportunités au plus dans la file (D4) ; les autres sont écartées.
 * Extensions : chaque Item porte `type` et `objet` (l'élément d'origine) ; encaisse_eur sert au critère 3 (D9).
 */
export function prioriser({ opportunites = [], risques = [], revues_ouvertes = [], canaux = {}, prealables = [], encaisse_eur = 0 } = {},
  { wip_max = SEUILS.wip_max, nouvelles_max = SEUILS.nouvelles_max } = {}) {
  const items = [], ecartees = [];
  for (const r of risques) {
    const urgent = typeof r.dans_h === 'number' && r.dans_h <= SEUILS.urgence_h;
    items.push({ ref: `${r.type}:${r.objet}`, genre: 'risque', type: r.type, objet: r, cles: [urgent ? 0 : 1, 1, 1, 1, 1, 1, GRAND, 0, 0],
      raisons: [urgent ? `risque à échéance de 24 h au plus (${r.type})` : `risque sans échéance proche (${r.type})`] });
  }
  for (const p of prealables) {
    items.push({ ref: `prealable:${p.ref ?? p.sujet}`, genre: 'prealable', type: p.sujet, objet: p, cles: [1, 0, 1, 1, 1, 1, GRAND, 0, 0], raisons: [`préalable ouvert : ${p.motif ?? p.sujet}`] });
  }
  const ouvertes = revues_ouvertes.filter((r) => (r.statut ?? 'ouverte') === 'ouverte');
  const nProps = ouvertes.filter((r) => r.type === 'proposition').length, enRevue = new Set(ouvertes.map((r) => idAnnonce(r.ref)).filter(Boolean));
  const gel = nProps >= wip_max;
  const opps = [];
  for (const o of opportunites) {
    if (enRevue.has(String(o.annonce_id))) { ecartees.push({ ref: `annonce:${o.annonce_id}`, motif: 'déjà en revue' }); continue; }
    const canal = canalUtilisable(o, canaux, encaisse_eur), raisons = [];
    const c3 = canal ? 0 : 1, c4 = o.preuve_legere ? 0 : 1;
    const c5 = typeof o.offres === 'number' && o.offres <= SEUILS.offres ? 0 : 1, c6 = typeof o.devis_2h_n === 'number' && o.devis_2h_n <= SEUILS.devis_2h ? 0 : 1;
    if (!c3) raisons.push(`canal utilisable : ${canal}`);
    if (!c4) raisons.push(o.recette_proche ? `recette existante : ${o.recette_proche}` : 'famille données : preuve légère possible');
    if (!c5) raisons.push(`${o.offres} offre(s), 5 au plus`);
    if (!c6) raisons.push(`${o.devis_2h_n} devis en moins de 2 h, 3 au plus`);
    raisons.push(`âge ${o.age_h ?? 'inconnu'} h, coût ${o.cout_requetes} requête(s), budget affiché recopié : ${o.budget_affiche}`);
    opps.push({ ref: `annonce:${o.annonce_id}`, genre: 'opportunite', type: o.famille, objet: o,
      cles: [1, 1, c3, c4, c5, c6, typeof o.age_h === 'number' ? o.age_h : GRAND, typeof o.cout_requetes === 'number' ? o.cout_requetes : GRAND, -(Number(o.annonce_id) || 0)], raisons });
  }
  opps.sort(comparer);
  const garder = gel ? 0 : Math.max(0, nouvelles_max);
  for (const o of opps.slice(garder)) ecartees.push({ ref: o.ref, motif: gel ? 'gel : propositions ouvertes au maximum (D3)' : 'une nouvelle opportunité par cycle au plus (D4)' });
  const file = [...items, ...opps.slice(0, garder)].sort(comparer).map((x, i) => ({ ...x, rang: i + 1 }));
  return { file, gel, motif: gel ? `D3 : ${nProps} propositions ouvertes (${wip_max} au plus), aucune nouvelle ; relance par la notification` : null, ecartees };
}

// ---------------------------------------------------------------------------------------------------------------------
// DÉCIDER : règles du CEO, D0 à D10.

export const REGLES_CEO = Object.freeze({
  D0: 'un constat bloquant ne laisse que réparation et aveu',
  D1: 'statut inconnu ou aucun canal ouvert : preparer_prealable, une fiche par sujet, jamais dupliquée',
  D2: 'rediger_brouillon seulement si un canal est utilisable pour la cible, sinon preparer_kit_canal pour le segment',
  D3: '2 propositions ouvertes ou plus : aucune nouvelle, relance par la notification',
  D4: 'une nouvelle opportunité par jour au plus',
  D5: 'preuve légère d’abord (sonder puis echantillonner) ; construire_liste après une issue positive, sauf régénération de 60 requêtes au plus',
  D6: 'annonce d’une revue qui n’est plus Ouvert, ou lecture de plus de 7 j : invalider_revue, leçon due',
  D7: 'pari envoyé depuis 7 j sans issue : demander_issue, jamais une clôture perdu',
  D8: '5 cycles sans geste du propriétaire : gel des nouvelles opportunités (veille seule)',
  D9: 'encaissé nul : aucune action de dépense',
  D10: 'une recette candidate du LLM par semaine au plus',
});
const PROPOSABLES = new Set(['ecrire_lecon', 'adopter_regle', 'reviser_croyance', 'purger_opposition', 'sauver_memoire', 'notifier', 'invalider_revue',
  'demander_issue', 'construire_liste']);
const recetteDuPari = (p) => p?.recette ?? /^P-(.+)-\d{4}-\d{2}-\d{2}$/.exec(String(p?.id ?? ''))?.[1] ?? null;
const RE_ARGENT = /(^|_)(eur|euros?|montant)($|_)/i;
// Actions qui passent par un canal d'envoi : un canal payant y engagerait une dépense (lire ou observer codeur, non).
const PAR_CANAL = new Set(['rediger_brouillon', 'regenerer_brouillon', 'creer_brouillon_gmail']);
function depense(type, params, canaux, encaisse_eur) {
  if (encaisse_eur > 0) return false;
  if (PAR_CANAL.has(type) && params?.canal && canaux?.[params.canal]?.payant) return true;
  const marcher = (x) => x && typeof x === 'object' && Object.entries(x).some(([k, v]) => (RE_ARGENT.test(k) && typeof v === 'number' && v > 0) || marcher(v));
  return marcher(params);
}

/**
 * Actions du cycle. etat : {monde, canaux, revues_ouvertes, paris (Registre.etat().paris, avec recette éventuelle),
 * encaisse_eur, cycles_sans_geste, constats_bloquants, budget_reste, recettes ({[id]: {sonde, echantillon, liste,
 * estimation_requetes, candidate_le, params}}), horloge} et, en extension, cycle, propositions (actions proposées par
 * le rêve), nouvelles_aujourdhui. Rend toujours au moins une action (« rien » est consigné). Mêmes entrées → mêmes clés.
 */
export function decider(file, etat = {}) {
  const { monde = null, canaux = {}, revues_ouvertes = [], paris = [], encaisse_eur = 0, cycles_sans_geste = 0, constats_bloquants = [], budget_reste = null,
    recettes = {}, horloge = null, propositions = [], nouvelles_aujourdhui = 0 } = etat;
  const h = horloge ?? creerHorloge(), now = h.iso(), jour = h.jour(), cycle = etat.cycle ?? `C-${jour}`;
  const brutes = [], vues = new Set(), motifs = [];
  const pousser = (type, ref, params, raison, jugement = null) => {
    if (!TYPES_ACTION.includes(type)) throw new Error(`decider : type d’action inconnu « ${type} »`);
    const cle = empreinte({ type, ref: ref ?? null, params: params ?? {} });
    if (vues.has(cle)) return;
    vues.add(cle); brutes.push({ type, ref: ref ?? null, params: params ?? {}, raison, jugement, cle });
  };
  const peutSirene = (n) => !budget_reste || (budget_reste.sirene ?? Infinity) >= n;
  const ouvertes = revues_ouvertes.filter((r) => (r.statut ?? 'ouverte') === 'ouverte');
  const revueOuverte = (type, ref) => ouvertes.some((r) => r.type === type && String(r.ref) === String(ref));

  // D0 : un constat bloquant ne laisse que réparation et aveu.
  if (constats_bloquants.length) {
    pousser('notifier', 'constats', { codes: [...new Set(constats_bloquants.map((c) => c.code ?? String(c)))].sort() },
      `D0 : constat bloquant (${constats_bloquants.map((c) => c.code ?? c).join(', ')}) ; seuls la réparation et l’aveu sont permis`);
    return finaliser(brutes, cycle);
  }

  // D6 et D7 : revues caduques, paris échus.
  for (const it of file ?? []) {
    const r = it.genre === 'risque' ? it.objet : null;
    if (!r) continue;
    if (r.type === 'annonce_fermee' || r.type === 'revue_rassise') {
      pousser('invalider_revue', r.objet, { motif: r.type === 'annonce_fermee' ? `annonce passée « ${r.statut} »` : r.motif ?? 'lecture de plus de 7 j', lecon_due: true },
        `D6 : ${r.type === 'annonce_fermee' ? `l’annonce ${r.annonce} n’est plus ouverte` : 'revue rassise'} ; leçon due`);
    }
  }
  for (const p of paris) {
    if (p.statut === 'envoye' && !(p.issues ?? []).length && typeof p.echeance_le === 'string' && ms(p.echeance_le) <= ms(now)) {
      pousser('demander_issue', p.id, { echeance_le: p.echeance_le }, `D7 : pari envoyé, échéance du ${p.echeance_le.slice(0, 10)} passée sans issue ; jamais une clôture « perdu »`);
    }
  }

  // D1 : préalables, une fiche par sujet ; CGU codeur lues par l'agent (B08).
  for (const p of prealablesOuverts(monde, canaux)) {
    if (p.sujet === 'cgu') pousser('lire_cgu', 'codeur', { canal: 'codeur', chemin: CHEMINS.cgu_codeur }, 'B08 : CGU codeur non lues (1 lecture, citations vérifiées)', { type: 'lire_cgu', statut: 'demande' });
    else if (!revueOuverte('prealable', p.ref)) pousser('preparer_prealable', p.ref, { sujet: p.sujet }, `D1 : ${p.motif} ; une seule fiche`);
  }

  // D5 : listes complètes après une issue positive, ou régénération bornée d'un pari existant.
  const gagnes = paris.filter((p) => p.statut === 'gagne');
  for (const p of gagnes) {
    const rec = recetteDuPari(p);
    if (rec && !recettes[rec]?.liste && peutSirene(recettes[rec]?.estimation_requetes ?? 0)) {
      pousser('construire_liste', rec, { recette: rec, pari: p.id }, `D5 : issue positive sur ${p.id}`);
    }
  }
  for (const a of propositions) {
    if (!PROPOSABLES.has(a?.type)) { motifs.push(`proposition ${a?.type} non admise`); continue; }
    if (a.type === 'construire_liste') {
      const rec = a.params?.recette ?? a.ref, pari = paris.find((p) => p.id === a.params?.pari);
      const gagne = gagnes.some((p) => recetteDuPari(p) === rec);
      const regen = a.params?.regeneration === true && pari && !['perdu', 'caduc'].includes(pari.statut) && typeof a.params?.estimation_requetes === 'number'
        && a.params.estimation_requetes <= SEUILS.regeneration_max && peutSirene(a.params.estimation_requetes);
      if (!gagne && !regen) { motifs.push(`construire_liste ${rec} refusée (D5 : ni issue positive, ni régénération de 60 requêtes au plus)`); continue; }
      pousser('construire_liste', rec, { ...a.params, recette: rec }, gagne ? `D5 : issue positive pour ${rec}` : `D5 : régénération de ${a.params.estimation_requetes} requêtes (60 au plus)`);
      continue;
    }
    pousser(a.type, a.ref ?? null, a.params ?? {}, a.raison ?? 'proposition du rêve', a.jugement ?? null);
  }

  // D8, D3, D4 : gel, propositions en cours, une nouvelle opportunité par jour.
  const nProps = ouvertes.filter((r) => r.type === 'proposition').length;
  const propsDuJour = ouvertes.filter((r) => r.type === 'proposition' && typeof r.ouverte_le === 'string' && creerHorloge(r.ouverte_le).jour() === jour).length;
  let restant = SEUILS.nouvelles_max - propsDuJour - nouvelles_aujourdhui;
  if (cycles_sans_geste >= SEUILS.cycles_gel) { motifs.push(`D8 : ${cycles_sans_geste} cycles sans geste du propriétaire, veille seule`); restant = 0; }
  if (nProps >= SEUILS.wip_max) {
    pousser('notifier', 'relance', { motif: 'propositions en attente', propositions: nProps }, `D3 : ${nProps} propositions ouvertes, aucune nouvelle ; relance par la notification`);
    restant = 0;
  }
  if (restant <= 0 && !motifs.length && nProps < SEUILS.wip_max) motifs.push('D4 : une nouvelle opportunité par jour au plus');
  const semaine = h.semaine();
  let recettesSemaine = Object.values(recettes).filter((r) => typeof r?.candidate_le === 'string' && creerHorloge(r.candidate_le).semaine() === semaine).length;

  for (const it of (file ?? []).filter((x) => x.genre === 'opportunite')) {
    if (restant <= 0) break;
    const o = it.objet, segment = o.recette_proche ?? o.famille, canal = canalUtilisable(o, canaux, encaisse_eur);
    let prise = false;
    if (!canal && !revueOuverte('kit_canal', segment)) {
      pousser('preparer_kit_canal', segment, { segment, canaux: ['comeup', 'malt'].filter((c) => canaux?.[c] && !['exclu', 'ferme'].includes(canaux[c].statut)) },
        `D2 : aucun canal utilisable pour l’annonce ${o.annonce_id} ; kit pour le segment ${segment}`);
      prise = true;
    }
    if (o.recette_proche) {
      const r = recettes[o.recette_proche] ?? {};
      if (!r.sonde) {
        if (peutSirene(1)) { pousser('sonder', o.recette_proche, { recette: o.recette_proche, requete: r.params ?? null }, `D5 : preuve légère, sonde de ${o.recette_proche} (1 requête)`); prise = true; }
      } else if (!r.echantillon) {
        if (peutSirene(2)) { pousser('echantillonner', o.recette_proche, { recette: o.recette_proche, pages: 2, annonce: o.annonce_id }, `D5 : preuve légère, échantillon de 2 pages tirées pour ${o.recette_proche}`); prise = true; }
      } else if (canal) {
        pousser('rediger_brouillon', o.annonce_id, { recette: o.recette_proche, canal }, `D2 : canal ${canal} utilisable, échantillon prêt (${o.recette_proche})`);
        prise = true;
      }
    } else if (o.famille === 'donnees' && recettesSemaine < SEUILS.recettes_semaine) {
      pousser('ecrire_recette', o.annonce_id, { annonce: o.annonce_id }, 'D10 : famille données sans recette existante ; une recette candidate par semaine au plus', { type: 'ecrire_recette', statut: 'demande' });
      recettesSemaine += 1; prise = true;
    }
    if (o.devis_2h_n === null) pousser('suivre_annonce', o.annonce_id, { motif: 'devis_2h inconnu' }, `mesurer la concurrence précoce de l’annonce ${o.annonce_id} (1 lecture)`);
    if (prise) restant -= 1;
  }

  // D9 : encaissé nul → aucune action de dépense, quelle qu'en soit l'origine.
  const gardees = brutes.filter((a) => {
    if (!depense(a.type, a.params, canaux, encaisse_eur)) return true;
    motifs.push(`D9 : ${a.type} écartée, elle engagerait une dépense avec un encaissé nul`);
    return false;
  });
  if (!gardees.length) {
    const p = { motifs: motifs.length ? motifs : ['aucune règle ne demande d’action'] };
    gardees.push({ type: 'rien', ref: null, params: p, raison: `rien : ${p.motifs.join(' ; ')}`, jugement: null });
  }
  return finaliser(gardees, cycle);
}

function finaliser(brutes, cycle) {
  return brutes.map((a, k) => {
    const params = a.params ?? {}, ref = a.ref ?? null;
    return { id: `A-${cycle}-${k + 1}`, type: a.type, ref, params, raison: [...String(a.raison ?? '')].slice(0, 200).join(''),
      cle: empreinte({ type: a.type, ref, params }), jugement: a.jugement ?? null };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Plan d'observation du cycle suivant (etat/plan-observation.json : ids d'annonces publiques sans slug, pages, sondes).

const ORDRE = ['revue', 'pari', 'prevision', 'donnees'];
export function planObservation(actions, revues, paris, previsions, horloge = null) {
  const h = horloge ?? creerHorloge(), demain = creerHorloge(isoPlus(h.iso(), 24)), borne = ms(isoPlus(h.iso(), 48));
  const suivis = [], pages = [], sondes = [];
  const suivre = (id, motif) => { if (id && !suivis.some((s) => s.id === id)) suivis.push({ id, motif }); };
  for (const r of (revues ?? []).filter((x) => (x.statut ?? 'ouverte') === 'ouverte')) suivre(idAnnonce(r.ref), 'revue');
  for (const p of (paris ?? []).filter((x) => ['envoye', 'ouvert'].includes(x.statut))) suivre(idAnnonce(p.annonce_id ?? p.annonce), 'pari');
  for (const pv of previsions ?? []) if (ms(pv.echeance ?? isoPlus(pv.emise_le, pv.horizon_h)) <= borne) suivre(idAnnonce(pv.sujet), 'prevision');
  for (const a of actions ?? []) {
    if (['suivre_annonce', 'rediger_brouillon', 'echantillonner'].includes(a.type)) suivre(idAnnonce(a.type === 'echantillonner' ? a.params?.annonce : a.ref), 'donnees');
    if (a.type === 'lire_cgu' && a.params?.chemin && !pages.some((p) => p.chemin === a.params.chemin)) pages.push({ canal: a.params.canal ?? 'codeur', chemin: a.params.chemin });
    if (a.type === 'sonder' && a.params?.requete && typeof a.params.requete === 'object') sondes.push({ recette: a.params.recette ?? a.ref, params: a.params.requete });
  }
  if (demain.jourSemaine() === 0 && !pages.some((p) => p.chemin === CHEMINS.tarifs_codeur)) pages.push({ canal: 'codeur', chemin: CHEMINS.tarifs_codeur });
  suivis.sort((a, b) => ORDRE.indexOf(a.motif) - ORDRE.indexOf(b.motif));
  return { jour: demain.jour(), suivis, candidats: [], pages, sondes };
}
