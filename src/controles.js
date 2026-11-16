// Contrôles de VELYX v2 (M4). Les biais trouvés à la main le 15/11 deviennent des contrôles centralisés, appliqués à
// toute fiche, toute liste et tout texte : aucune recette ne peut les oublier. Fonctions pures (aucune lecture disque,
// aucun réseau), sauf chargerRegles qui lit etat/regles.json par le magasin.
//
// Trois portées :
// - fiche (G1 à G11, puis les règles apprises adoptées) : statut retenue | quarantaine | exclue, et drapeaux ;
// - liste (L1 à L5) : lecture partielle, partitions, revue d'échantillon, quarantaine, champs manquants ;
// - brouillon (B1 à B8, plus L1) : chaque nombre a une provenance, aucun prix, aucune promesse, aucune fuite.
// L'opposition à la prospection (G4) et la diffusion partielle (G11) sont obligatoires : elles ne se neutralisent pas.
import { creerHorloge, ageAns, heuresEntre, valider, empreinte, OPS, evaluerOp } from './socle.js';

const DEPUIS = '2026-11-15';
const def = (code, portee, gravite, motif) => Object.freeze({ code, portee, gravite, motif, depuis: DEPUIS });

/** Catalogue des contrôles. gravite 'bloquant' : exclut une fiche ou bloque une liste ou un texte. */
export const CONTROLES = Object.freeze([
  def('G1', 'fiche', 'alerte', 'holding probable : NAF 64.20Z ou 70.10Z, nom HOLDING ou PARTICIPATIONS, ou CA de plus de 2 M€ pour moins de 10 salariés dans une recette « micro » → quarantaine ; CA par salarié (borne haute de la tranche) de plus de 1 M€ → drapeau ca_par_salarie_eleve, jamais pour un NAF de recette.exceptions_ratio'),
  def('G2', 'fiche', 'alerte', 'comptes de plus de 3 ans (exercice < année − 3) : aucun signal financier, fiche non complète, libellé « CA ancien (AAAA) »'),
  def('G3', 'fiche', 'bloquant', 'filiale : catégorie ETI ou GE pour une cible micro ou pme → exclue ; dirigeant personne morale → drapeau filiale_probable, quarantaine si la recette vise le dirigeant'),
  def('G4', 'fiche', 'bloquant', 'opposition à la prospection (opposition_diffusion_commerciale ou demande reçue) → exclue, quelle que soit la recette ; non neutralisable'),
  def('G5', 'fiche', 'alerte', 'CA publié 0 et résultat non nul → CA « non publié » (jamais « 0 € », jamais « dormante ») ; CA 0 et résultat 0 → drapeau activite_nulle_declaree'),
  def('G6', 'fiche', 'alerte', 'effectif non daté → drapeau effectif_non_date ; effectif de plus de 3 ans → drapeau effectif_ancien'),
  def('G7', 'fiche', 'alerte', 'dirigeant de 90 ans ou plus → quarantaine (donnée probablement périmée)'),
  def('G8', 'fiche', 'alerte', 'entrepreneur individuel, ou nom qui contient un jeton de dirigeant → nom traité comme nominatif'),
  def('G9', 'fiche', 'bloquant', 'entreprise fermée (état C ou date de fermeture) → exclue'),
  def('G10', 'fiche', 'bloquant', 'doublon de SIREN → exclue'),
  def('G11', 'fiche', 'bloquant', 'diffusion partielle (statut_diffusion « P ») → exclue ; non neutralisable'),
  def('L1', 'liste', 'bloquant', 'lecture partielle (complet = false) → « au moins » obligatoire devant chaque compte'),
  def('L2', 'liste', 'bloquant', 'somme des partitions différente du total'),
  def('L3', 'liste', 'bloquant', 'échantillon de 10 (graine) revu : 2 fiches fausses ou plus → liste bloquée ; alias hors tirage → revue rejetée'),
  def('L4', 'liste', 'alerte', 'quarantaine de plus de 25 % des fiches contrôlées'),
  def('L5', 'liste', 'bloquant', 'champ attendu absent sur plus de 5 % des fiches'),
  def('B1', 'brouillon', 'bloquant', 'nombre sans provenance : ni chiffre rempli par le moteur, ni date, ni code NAF, ni article de loi permis, ni citation « … » présente mot pour mot dans l’annonce'),
  def('B2', 'brouillon', 'bloquant', 'placeholders prix et nom absents, ou montant hors citation'),
  def('B3', 'brouillon', 'bloquant', 'ligne d’échantillon qui n’est pas « retenue »'),
  def('B4', 'brouillon', 'bloquant', 'lecture du registre de plus de 7 jours'),
  def('B5', 'brouillon', 'bloquant', 'annonce liée non lue « Ouvert » depuis 24 h au plus'),
  def('B6', 'brouillon', 'bloquant', 'vocabulaire de promesse (garanti, assuré, 100 %, exhaustif, illimité, sans risque)'),
  def('B7', 'brouillon', 'bloquant', 'donnée nominative dans le texte (dictionnaire, SIREN, SIRET, téléphone, e-mail), ou dictionnaire absent'),
  def('B8', 'brouillon', 'bloquant', 'total brut de sonde hors d’une phrase qui contient « brut »'),
]);
const GRAVITE = Object.fromEntries(CONTROLES.map((c) => [c.code, c.gravite]));
const MOTIF = Object.fromEntries(CONTROLES.map((c) => [c.code, c.motif]));
/** Contrôles qu'aucun contexte ne peut neutraliser. */
export const NON_NEUTRALISABLES = Object.freeze(['G4', 'G11']);

// ---------------------------------------------------------------------------------------------------------------------
// Lecture d'une Entreprise (tolère les fiches v1 sans les champs ajoutés par la v2).

export const sansAccents = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '');
const PRINCIPAUX = /president|gerant|directeur general|dirigeant|exploitant/i;
/** Qualité de dirigeant principal (président, gérant, directeur général, dirigeant, exploitant). */
export const estPrincipal = (d) => PRINCIPAUX.test(sansAccents(d?.qualite ?? ''));

// Tranches INSEE : libellé (celui de sirene.TRANCHES) et bornes.
const TRANCHES = {
  NN: ['non renseigné', null, null], '00': ['0 salarié', 0, 0], '01': ['1-2', 1, 2], '02': ['3-5', 3, 5], '03': ['6-9', 6, 9],
  11: ['10-19', 10, 19], 12: ['20-49', 20, 49], 21: ['50-99', 50, 99], 22: ['100-199', 100, 199], 31: ['200-249', 200, 249],
  32: ['250-499', 250, 499], 41: ['500-999', 500, 999], 42: ['1000-1999', 1000, 1999], 51: ['2000-4999', 2000, 4999],
  52: ['5000-9999', 5000, 9999], 53: ['10000 et plus', 10000, null],
};
/** Code de tranche d'effectif : celui de la fiche, sinon retrouvé depuis le libellé (fiches v1). */
export function codeEffectif(e) {
  if (typeof e?.effectif_code === 'string' && e.effectif_code) return e.effectif_code;
  return Object.keys(TRANCHES).find((k) => TRANCHES[k][0] === e?.effectif) ?? null;
}
/** Bornes {min, max} d'un code de tranche ({null, null} si inconnu). */
export function bornesEffectif(code) { const t = TRANCHES[code]; return { min: t?.[1] ?? null, max: t?.[2] ?? null }; }

/** Exercice publié le plus récent ({annee, ca, resultat_net}) ou null. */
export function dernierExercice(e) {
  const f = Array.isArray(e?.finances) && e.finances.length ? [...e.finances].sort((a, b) => b.annee - a.annee)[0] : e?.ca ?? null;
  return f && Number.isFinite(f.annee) ? f : null;
}

/** État du CA, d'après G2 et G5 : {statut: 'publie'|'non_publie'|'ancien', annee, montant, libelle}. */
export function etatCa(e, horloge = creerHorloge()) {
  const ex = dernierExercice(e), an = horloge.annee();
  if (!ex) return { statut: 'non_publie', annee: null, montant: null, libelle: 'CA non publié' };
  if (ex.annee < an - 3) return { statut: 'ancien', annee: ex.annee, montant: null, libelle: `CA ancien (${ex.annee})` };
  if (!Number.isFinite(ex.ca) || ex.ca === 0) return { statut: 'non_publie', annee: ex.annee, montant: null, libelle: 'CA non publié' };
  return { statut: 'publie', annee: ex.annee, montant: ex.ca, libelle: `CA ${ex.annee} publié` };
}

/** Jetons nominatifs (≥ 4 lettres, sans accents, en majuscules) d'un nom de personne. */
export const jetonsNom = (nom) => (sansAccents(nom).toUpperCase().match(/\p{L}+/gu) ?? []).filter((t) => t.length >= 4);

/**
 * Dictionnaire local {jetons, sirens} construit depuis des fiches (noms des dirigeants). Sert quand le dictionnaire de
 * garde.js (construit depuis prive/) n'est pas fourni ; il ne remplace pas ce dernier.
 */
export function jetonsDe(entreprises) {
  const jetons = new Set(), sirens = new Set();
  for (const e of entreprises ?? []) {
    if (e?.siren) sirens.add(String(e.siren));
    for (const d of e?.dirigeants ?? []) for (const t of jetonsNom(d.nom)) jetons.add(t);
  }
  return { jetons, sirens };
}

/** Le nom de l'entreprise est nominatif : EI (nature 1000), ou il contient un jeton de dirigeant (de la fiche ou du dictionnaire). */
export function nomNominatif(e, dict) {
  if (String(e?.nature_juridique ?? '') === '1000') return true;
  const propres = new Set((e?.dirigeants ?? []).flatMap((d) => jetonsNom(d.nom)));
  return jetonsNom(e?.nom).some((t) => propres.has(t) || dict?.jetons?.has?.(t));
}

/** G4 : opposition déclarée au registre ou reçue (garde.estExclue, recopiée ici : garde.js n'est pas encore livré). */
export const estExclue = (e, oppositions) => e?.opposition === true || Boolean(oppositions?.has?.(String(e?.siren)));

// ---------------------------------------------------------------------------------------------------------------------
// Contrôles de fiche.

const HOLDING_NAF = ['64.20Z', '70.10Z'];
const HOLDING_NOM = /(?<![\p{L}])(HOLDING|PARTICIPATIONS?)(?![\p{L}])/iu;
const MICRO = ['00', '01', '02', '03'];          // moins de 10 salariés (micro-entreprise INSEE, décret 2008-1354)
const RANG = { retenue: 0, quarantaine: 1, exclue: 2 };

function recetteDe(r) {
  return { cible_taille: r?.cible_taille ?? 'toutes', vise_dirigeant: Boolean(r?.vise_dirigeant), exceptions_ratio: r?.exceptions_ratio ?? [] };
}
function neutralises(ctx) {
  const n = new Set(ctx?.neutraliser ?? []);
  for (const c of NON_NEUTRALISABLES) if (n.has(c)) throw new Error(`contrôle ${c} non neutralisable (obligation légale)`);
  return n;
}

/**
 * Contrôle d'une fiche (G1 à G11, sans G10 qui demande la liste, puis règles apprises).
 * ctx : {horloge, oppositions: Set<siren>, dict, regles: RegleDeclarative[] | fonctions compilées, neutraliser: string[]}.
 * @returns {{statut: 'retenue'|'quarantaine'|'exclue', drapeaux: string[], codes: string[], motifs: {code, effet, motif}[],
 *   ca: {statut, annee, montant, libelle}, nom_nominatif: boolean}}
 */
export function controlerFiche(e, recette, ctx = {}) {
  const horloge = ctx.horloge ?? creerHorloge(), an = horloge.annee(), r = recetteDe(recette), off = ctx._neutres ?? neutralises(ctx);
  const motifs = [], drapeaux = [];
  const touche = (code, effet, motif, drapeau) => {
    if (off.has(code)) return;
    motifs.push({ code, effet, motif });
    if (drapeau && !drapeaux.includes(drapeau)) drapeaux.push(drapeau);
  };
  const naf = e?.naf ?? null, code = codeEffectif(e), ex = dernierExercice(e), ca = etatCa(e, horloge);
  const nominatif = nomNominatif(e, ctx.dict);

  // G1 holding.
  if (HOLDING_NAF.includes(naf) || HOLDING_NOM.test(e?.nom ?? '')) touche('G1', 'quarantaine', 'NAF ou nom de holding', 'holding_probable');
  if (r.cible_taille === 'micro' && ex?.ca > 2e6 && MICRO.includes(code)) touche('G1', 'quarantaine', 'CA de plus de 2 M€ pour moins de 10 salariés', 'holding_probable');
  const borne = bornesEffectif(code).max;
  if (borne !== null && ex?.ca > 0 && ex.ca / Math.max(1, borne) > 1e6 && !r.exceptions_ratio.includes(naf)) {
    touche('G1', 'drapeau', 'CA par salarié de plus de 1 M€ (borne haute de la tranche)', 'ca_par_salarie_eleve');
  }
  // G2 comptes périmés.
  if (ca.statut === 'ancien') touche('G2', 'drapeau', ca.libelle, 'comptes_perimes');
  // G3 filiale.
  if (['ETI', 'GE'].includes(e?.categorie) && ['micro', 'pme'].includes(r.cible_taille)) touche('G3', 'exclue', `catégorie ${e.categorie} hors cible ${r.cible_taille}`, 'filiale_groupe');
  if (Number(e?.dirigeants_pm) > 0) touche('G3', r.vise_dirigeant ? 'quarantaine' : 'drapeau', 'dirigeant personne morale', 'filiale_probable');
  // G4 opposition (obligatoire).
  if (estExclue(e, ctx.oppositions)) touche('G4', 'exclue', 'opposition à la prospection commerciale', 'opposition');
  // G5 CA publié nul.
  if (ex && ex.annee >= an - 3 && ex.ca === 0) {
    if (Number.isFinite(ex.resultat_net) && ex.resultat_net !== 0) touche('G5', 'drapeau', 'CA publié 0 avec un résultat non nul : compte de résultat non publié', 'ca_non_publie');
    else if (ex.resultat_net === 0) touche('G5', 'drapeau', 'CA 0 et résultat 0 déclarés', 'activite_nulle_declaree');
  }
  // G6 effectif.
  if (e?.effectif_annee === null || e?.effectif_annee === undefined) touche('G6', 'drapeau', 'effectif non daté', 'effectif_non_date');
  else if (Number(e.effectif_annee) < an - 3) touche('G6', 'drapeau', `effectif de ${e.effectif_annee}`, 'effectif_ancien');
  // G7 dirigeant de 90 ans ou plus.
  if ((e?.dirigeants ?? []).some((d) => Number.isFinite(d.annee_naissance) && (ageAns(String(d.annee_naissance), horloge) ?? 0) >= 90)) {
    touche('G7', 'quarantaine', 'dirigeant de 90 ans ou plus', 'dirigeant_tres_age');
  }
  // G8 nom nominatif.
  if (nominatif) touche('G8', 'drapeau', 'nom traité comme nominatif', 'nom_nominatif');
  // G9 fermée.
  if (e?.fermee === true || e?.etat_administratif === 'C') touche('G9', 'exclue', 'entreprise fermée', 'fermee');
  // G11 diffusion partielle (obligatoire).
  if (e?.statut_diffusion === 'P') touche('G11', 'exclue', 'diffusion partielle (P)', 'diffusion_partielle');
  // Règles apprises, après G1 à G11.
  for (const regle of ctx.regles ?? []) {
    const f = typeof regle === 'function' ? regle : compilerRegle(regle);
    const v = f(e);
    if (v.touche) touche(v.code, v.effet, v.motif, v.effet === 'drapeau' ? `regle_${v.code}` : null);
  }

  let statut = 'retenue';
  for (const m of motifs) if (m.effet !== 'drapeau' && RANG[m.effet] > RANG[statut]) statut = m.effet;
  return { statut, drapeaux, codes: [...new Set(motifs.map((m) => m.code))], motifs, ca, nom_nominatif: nominatif };
}

// ---------------------------------------------------------------------------------------------------------------------
// Règles déclaratives apprises (etat/regles.json). Aucun code : un champ d'une liste fermée, un opérateur de socle.OPS.

const CHAMPS_REGLE = Object.freeze(['naf', 'nature_juridique', 'categorie', 'effectif_code', 'effectif_annee', 'departement',
  'commune', 'creation', 'rge', 'idcc', 'etablissements_ouverts', 'dirigeants_pm', 'nom', 'fermee', 'opposition',
  'statut_diffusion', 'ca.ca', 'ca.annee', 'ca.resultat_net']);
const SCHEMA_REGLE = {
  type: 'objet', champs: {
    code: { type: 'texte', requis: true, motif: '^[A-Z][A-Z0-9-]{1,19}$' },
    champ: { type: 'enum', requis: true, valeurs: CHAMPS_REGLE },
    op: { type: 'enum', requis: true, valeurs: OPS },
    valeur: { ou: [{ type: 'texte', max: 200 }, { type: 'nombre' }, { type: 'bool' }, { type: 'liste', max: 100, items: { ou: [{ type: 'texte', max: 60 }, { type: 'nombre' }] } }] },
    effet: { type: 'enum', requis: true, valeurs: ['quarantaine', 'exclue', 'drapeau'] },
    motif: { type: 'texte', requis: true, min: 5, max: 200 },
    statut: { type: 'enum', valeurs: ['candidate', 'adoptee', 'retiree'] },
    adoptee_le: { type: 'texte', motif: '^\\d{4}-\\d{2}-\\d{2}$' },
    preuves: { type: 'liste', max: 50, items: { type: 'entier', min: 1 } },
  },
};
const G_CODES = new Set(CONTROLES.map((c) => c.code));
const lireChamp = (e, champ) => champ.split('.').reduce((o, k) => (o !== null && typeof o === 'object' && Object.hasOwn(o, k) ? o[k] : undefined), e);

/** Compile une règle déclarative ; lève sur une règle invalide (champ hors liste, opérateur inconnu, code, URL). */
export function compilerRegle(regle) {
  const v = valider(SCHEMA_REGLE, regle);
  if (!v.ok) throw new Error(`règle refusée : ${v.erreurs.join(' ; ')}`);
  if (G_CODES.has(regle.code)) throw new Error(`règle refusée : le code ${regle.code} est réservé`);
  const { code, champ, op, valeur, effet, motif } = regle;
  if (['in', 'nin'].includes(op) && !Array.isArray(valeur)) throw new Error(`règle refusée : « ${op} » attend une liste`);
  evaluerOp(op, null, op === 'existe' ? valeur ?? true : valeur);   // opérateur et motif vérifiés dès la compilation
  return (e) => ({ touche: Boolean(evaluerOp(op, lireChamp(e, champ), op === 'existe' ? valeur ?? true : valeur)), effet, code, motif });
}

/** Règles adoptées de etat/regles.json (liste, ou {regles: [...]}) ; [] si le fichier est absent. */
export function chargerRegles(magasin) {
  const j = magasin.lireJson('etat/regles.json');
  const liste = Array.isArray(j) ? j : Array.isArray(j?.regles) ? j.regles : [];
  return liste.filter((r) => r && (r.statut === undefined || r.statut === 'adoptee'));
}

// ---------------------------------------------------------------------------------------------------------------------
// Contrôles de liste.

const CHAMPS_ATTENDUS = Object.freeze(['siren', 'naf', 'departement', 'opposition', 'fermee', 'nature_juridique', 'dirigeants_pm']);
const resultat = (code, ok, n, motif) => ({ code, gravite: GRAVITE[code], ok, n_concernes: n, motif: motif ?? MOTIF[code] });

/**
 * Contrôle d'une liste. lecture : {complet, total, totaux_partition, lues}. ctx : comme controlerFiche, plus
 * revue_echantillon et tires (L3, si la revue a eu lieu).
 * Chaque fiche ressort copiée avec .controle = {statut, drapeaux, codes, ca}.
 */
export function controlerListe(fiches, lecture = {}, recette = {}, ctx = {}) {
  const c = { ...ctx, _neutres: neutralises(ctx) }, vus = new Set();
  const retenues = [], quarantaine = [], exclues = [], resultats = [];
  const parControle = {}, parDrapeau = {}, parSignal = {};
  for (const e of fiches) {
    const v = controlerFiche(e, recette, c);
    let statut = v.statut;
    const codes = [...v.codes];
    if (!c._neutres.has('G10') && e?.siren && vus.has(String(e.siren))) { statut = 'exclue'; codes.push('G10'); v.drapeaux.push('doublon'); }
    if (e?.siren) vus.add(String(e.siren));
    for (const k of new Set(codes)) parControle[k] = (parControle[k] ?? 0) + 1;
    for (const d of v.drapeaux) parDrapeau[d] = (parDrapeau[d] ?? 0) + 1;
    const copie = { ...e, controle: { statut, drapeaux: v.drapeaux, codes: [...new Set(codes)], ca: v.ca, nom_nominatif: v.nom_nominatif } };
    (statut === 'retenue' ? retenues : statut === 'quarantaine' ? quarantaine : exclues).push(copie);
    if (statut === 'retenue') for (const s of e?.signaux ?? []) parSignal[s.code] = (parSignal[s.code] ?? 0) + 1;
  }
  const n = fiches.length;
  for (const code of ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'G11']) {
    if (parControle[code]) resultats.push(resultat(code, true, parControle[code]));
  }
  if (!(ctx.oppositions instanceof Set)) resultats.push({ code: 'G4', gravite: 'alerte', ok: true, n_concernes: 0, motif: 'liste des oppositions reçues non fournie : seules celles du registre sont appliquées' });
  // L1 : la lecture partielle impose « au moins » (vérifié sur le texte par controlerBrouillon).
  if (lecture.complet === false) resultats.push(resultat('L1', true, 0, `lecture partielle${Number.isFinite(lecture.lues) && Number.isFinite(lecture.total) ? ` (${lecture.lues} fiches lues sur ${lecture.total})` : ''} : « au moins » obligatoire devant chaque compte`));
  // L2 : partitions.
  if (lecture.totaux_partition && typeof lecture.totaux_partition === 'object') {
    const somme = Object.values(lecture.totaux_partition).reduce((s, x) => s + (Number(x) || 0), 0);
    resultats.push(resultat('L2', somme === lecture.total, somme === lecture.total ? 0 : 1, somme === lecture.total ? 'somme des partitions = total' : `somme des partitions ${somme} ≠ total ${lecture.total}`));
  }
  // L3 : revue d'échantillon, si elle a eu lieu.
  if (ctx.revue_echantillon) resultats.push(evaluerRevueEchantillon(ctx.revue_echantillon, ctx.tires ?? []));
  // L4 : quarantaine.
  const tauxQ = n ? quarantaine.length / n : 0;
  resultats.push(resultat('L4', tauxQ <= 0.25, quarantaine.length, `quarantaine : ${quarantaine.length} sur ${n}`));
  // L5 : champs attendus.
  const manquants = CHAMPS_ATTENDUS.filter((k) => n && fiches.filter((e) => e?.[k] === undefined).length / n > 0.05);
  resultats.push(resultat('L5', manquants.length === 0, manquants.length, manquants.length ? `champs absents sur plus de 5 % des fiches : ${manquants.join(', ')}` : 'champs attendus présents'));
  return {
    retenues, quarantaine, exclues,
    compte: {
      lues: n, retenues: retenues.length, quarantaine: quarantaine.length, exclues: exclues.length,
      par_controle: parControle, par_drapeau: parDrapeau, par_signal: parSignal,
      completes: retenues.filter((e) => e.complet === true).length,
    },
    resultats,
  };
}

/** Une liste est bloquée si l'un de ses résultats bloquants a échoué. */
export const listeBloquee = (resultats) => resultats.some((r) => r.gravite === 'bloquant' && !r.ok);

// ---------------------------------------------------------------------------------------------------------------------
// Échantillon de contrôle (L3) et minimisation.

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * n fiches tirées par mélange sans remise sur mulberry32(empreinte(graine)). Reproductible : même liste (quel que soit son
 * ordre, elle est d'abord triée par SIREN) et même graine, même tirage.
 */
export function echantillonControle(liste, graine, n = 10) {
  if (graine === undefined || graine === null || graine === '') throw new TypeError('echantillonControle : graine requise');
  const alea = mulberry32(parseInt(empreinte(String(graine)).slice(0, 8), 16) >>> 0);
  const pool = [...liste].sort((a, b) => String(a.siren).localeCompare(String(b.siren)));
  const m = Math.min(Math.max(0, Math.trunc(n)), pool.length);
  for (let i = 0; i < m; i++) { const j = i + Math.floor(alea() * (pool.length - i)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, m);
}

/** Erreurs admises dans une revue d'échantillon (schéma revoir_echantillon). */
export const ERREURS_REVUE = Object.freeze(['naf_hors_cible', 'holding', 'filiale', 'fermee', 'doublon', 'signal_faux', 'autre']);

/**
 * L3. La revue doit porter exactement sur les alias tirés, chacun une fois, avec des erreurs de ERREURS_REVUE.
 * Deux fiches fausses ou plus bloquent la liste ; une revue mal formée est rejetée (bloquant aussi).
 */
export function evaluerRevueEchantillon(revue, tires) {
  const attendus = new Set((tires ?? []).map((t) => t.alias)), vus = new Set();
  const rejet = (motif, n = 1) => ({ code: 'L3', gravite: 'bloquant', ok: false, n_concernes: n, motif: `revue rejetée : ${motif}` });
  const fiches = Array.isArray(revue?.fiches) ? revue.fiches : null;
  if (!fiches) return rejet('aucune fiche');
  const hors = fiches.filter((f) => !attendus.has(f?.alias));
  if (hors.length) return rejet('alias hors du tirage', hors.length);
  for (const f of fiches) { if (vus.has(f.alias)) return rejet('alias revu deux fois'); vus.add(f.alias); }
  if (vus.size !== attendus.size) return rejet(`revue incomplète (${vus.size} sur ${attendus.size})`, attendus.size - vus.size);
  if (fiches.some((f) => !Array.isArray(f.erreurs) || f.erreurs.some((x) => !ERREURS_REVUE.includes(x)))) return rejet('erreur hors de la liste permise');
  const fausses = fiches.filter((f) => f.erreurs.length > 0).length;
  return { code: 'L3', gravite: 'bloquant', ok: fausses < 2, n_concernes: fausses, motif: fausses < 2 ? `${fausses} fiche fausse sur ${fiches.length}` : `liste bloquée : ${fausses} fiches fausses sur ${fiches.length}` };
}

// Un libellé de signal qui donnerait l'âge exact ou l'année de naissance d'un dirigeant (listes v1) n'est jamais montré.
const AGE_EXACT = (s) => /n[ée]e?\s+en\s+\d{4}/i.test(s) || (/dirigeant/i.test(s) && /\b\d{2,3}\s*ans\b/.test(s) && !/ou plus|moins de/i.test(s));

/**
 * Entreprise → EntrepriseMinimisee, seule forme montrée à un tiers : aucun nom de dirigeant, aucun âge exact, ni nom ni
 * commune pour une EI ou un nom nominatif (le siège d'une EI est souvent le domicile). Âge en tranche seulement.
 * options : {alias, seuil_age = 62}. statut reprend le contrôle de la fiche (B3).
 */
export function minimiser(e, horloge = creerHorloge(), dict = null, { alias = null, seuil_age = 62 } = {}) {
  const nominatif = nomNominatif(e, dict);
  const principal = (e?.dirigeants ?? []).filter(estPrincipal);
  const naissances = principal.map((d) => d.annee_naissance).filter(Number.isFinite);
  const age = naissances.length ? ageAns(String(Math.min(...naissances)), horloge) : null;
  const ca = etatCa(e, horloge);
  const creation = /^(\d{4})/.exec(e?.creation ?? '')?.[1];
  return {
    alias,
    nom_affichable: nominatif ? null : e?.nom ?? null,
    departement: e?.departement ?? null,
    commune: nominatif ? null : e?.commune ?? null,
    naf: e?.naf ?? null,
    effectif: e?.effectif ?? 'non renseigné',
    annee_creation: creation ? Number(creation) : null,
    ca: { annee: ca.annee, statut: ca.statut, montant: nominatif ? null : ca.montant },
    signaux: (e?.signaux ?? []).map((s) => s.court).filter((s) => typeof s === 'string' && !AGE_EXACT(s)),
    dirigeant: principal.length ? { tranche_age: age === null ? 'inconnu' : age >= seuil_age ? `${seuil_age} ans ou plus` : `moins de ${seuil_age} ans`, qualite: principal[0].qualite } : null,
    statut: e?.controle?.statut ?? null,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Contrôle des textes (brouillons). Les nombres sont repérés après masquage de ce qui a une provenance hors chiffres :
// citations vérifiées, URL, codes NAF, articles de loi permis, dates.

/** Articles de loi qu'un texte peut citer sans autre provenance. */
export const ARTICLES_AUTORISES = Object.freeze(['L241-1', 'L242-1', 'L243-3', 'A123-96', 'L34-5', 'L223-1', 'R511-3']);
const ARTICLES_RGPD = new Set(['6', '13', '14', '21']);
const MOIS = 'janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre';
const NE = '(?<![\\p{L}\\p{N}_])', FIN = '(?![\\p{L}\\p{N}_])';
const RE_NOMBRE = new RegExp(`${NE}(?:\\d{1,3}(?:[ \\u00a0\\u202f]\\d{3})+|\\d+)(?:,\\d+)?${FIN}`, 'gu');
const espaces = (s) => String(s ?? '').replace(/[\s\u00a0\u202f]+/g, ' ').trim();

/** Citations « … » du texte, avec leur présence mot pour mot dans la description de l'annonce. */
function citations(texte, description) {
  const d = espaces(description);
  return [...texte.matchAll(/«\s*([^«»]{1,500}?)\s*»/g)].map((m) => ({ debut: m.index, fin: m.index + m[0].length, verifiee: Boolean(d) && d.includes(espaces(m[1])) }));
}

/** Le texte, citations vérifiées (présentes mot pour mot dans la description) remplacées par des blancs. */
export function horsCitations(texte, description) {
  let t = String(texte);
  for (const c of citations(t, description)) if (c.verifiee) t = t.slice(0, c.debut) + ' '.repeat(c.fin - c.debut) + t.slice(c.fin);
  return t;
}

function masquer(texte, description) {
  let t = texte;
  const blanc = (re, garder = () => true) => { t = t.replace(re, (...a) => (garder(...a) ? ' '.repeat(a[0].length) : a[0])); };
  for (const c of citations(texte, description)) if (c.verifiee) t = t.slice(0, c.debut) + ' '.repeat(c.fin - c.debut) + t.slice(c.fin);
  blanc(/\bhttps?:\/\/[^\s<>)»]+/gi);
  blanc(/\b\d{2}\.\d{2}[A-Z]\b/g);                                                     // codes NAF
  blanc(/\b([LRAD])\.?\s?(\d{1,4}(?:-\d+){1,2})\b/g, (_, l, n) => ARTICLES_AUTORISES.includes(`${l}${n}`));
  blanc(/\b(?:art\.?|article)\s*(\d{1,2})\s+(?:du\s+)?RGPD\b/giu, (_, n) => ARTICLES_RGPD.has(n));
  blanc(/\bRGPD,?\s*(?:art\.?|article)\s*(\d{1,2})\b/giu, (_, n) => ARTICLES_RGPD.has(n));
  blanc(/\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?\b/g);                                      // dates ISO
  blanc(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g);                                               // JJ/MM/AAAA
  blanc(new RegExp(`(?<![\\p{L}\\p{N}])\\d{1,2}(?:er)?\\s+(?:${MOIS})\\s+\\d{4}${FIN}`, 'giu'));
  blanc(new RegExp(`(?<![\\p{L}])(?:${MOIS})\\s+\\d{4}${FIN}`, 'giu'));
  return t;
}

const valeurDe = (brut) => Number(brut.replace(/[ \u00a0\u202f]/g, '').replace(',', '.'));
const CONTEXTE_ANNEE = /(?:\ben|\bdepuis|\bde|\bdu|\bau|\bannée|\bexercice|\ble|\bCA|\bancien \(|\bfin|\bdébut|\bavant|\baprès|\bjusqu'en|\bdès)\s*$/iu;

/** Nombres d'un texte après masquage : [{valeur, brut, debut, fin, annee_en_contexte}]. */
export function nombresDuTexte(texte, description = null) {
  const m = masquer(texte, description);
  return [...m.matchAll(RE_NOMBRE)].map((x) => {
    const valeur = valeurDe(x[0]), debut = x.index;
    const annee = /^\d{4}$/.test(x[0]) && valeur >= 1900 && valeur <= 2100 && CONTEXTE_ANNEE.test(texte.slice(Math.max(0, debut - 14), debut));
    return { valeur, brut: x[0], debut, fin: debut + x[0].length, annee_en_contexte: annee };
  });
}

const mot = (corps) => new RegExp(`(?<![\\p{L}\\p{N}_])(?:${corps})(?![\\p{L}\\p{N}_])`, 'iu');
const PROMESSES = [
  ['garanti', mot('garantie?s?')], ['assuré', mot('assurée?s?')], ['100 %', /(?<![\p{N}])100[ \u00a0\u202f]?%/u],
  ['exhaustif', mot('exhausti(?:f|ve|fs|ves)')], ['illimité', mot('illimitée?s?')], ['sans risque', mot('sans\\s+risques?')],
];
// Expressions du métier qui ne sont pas des promesses (assurance construction).
const EXPRESSIONS_METIER = /garanties?\s+(?:décennales?|decennales?|biennales?|financières?\s+d['’]achèvement|d['’]achèvement|de\s+parfait\s+achèvement|de\s+bon\s+fonctionnement|dommages)|(?:vos|leurs|les|des|nos|ses|aux)\s+assurée?s/giu;
/** Mots de promesse trouvés dans un texte (hors expressions du métier). */
export function promesses(texte) {
  const t = String(texte).replace(EXPRESSIONS_METIER, (x) => ' '.repeat(x.length));
  return PROMESSES.filter(([, re]) => re.test(t)).map(([m]) => m);
}

const RE_MONTANT = /€|\bEUR\b|\beuros?\b|\$|\bUSD\b|\bdollars?\b|\b(?:HT|TTC)\b|k€|M€/iu;
/** Montant ou devise dans un texte (€, euros, $, HT, TTC…). */
export const contientMontant = (texte) => RE_MONTANT.test(String(texte));
const RE_SIREN = /(?<![\p{L}\p{N}])\d{3}[ \u00a0\u202f]?\d{3}[ \u00a0\u202f]?\d{3}(?![\p{L}\p{N}])/u;
const RE_SIRET = /(?<![\p{L}\p{N}])\d{14}(?![\p{L}\p{N}])/u;
const RE_TEL = /(?<![\p{N}])(?:\+33[\s.-]?|0)[1-9](?:[\s.-]?\d{2}){4}(?![\p{N}])/u;
const RE_EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/u;

/**
 * Scan antifuite d'un texte (garde.scannerTexte recopié localement : garde.js n'est pas encore livré). Ne renvoie
 * jamais le jeton trouvé, seulement la ligne et le motif.
 */
export function scannerTexte(texte, dict, { ignorer = null } = {}) {
  const positions = [];
  String(texte).split('\n').forEach((l, i) => {
    for (const t of sansAccents(l).toUpperCase().match(/\p{L}+/gu) ?? []) if (t.length >= 4 && dict?.jetons?.has?.(t) && !ignorer?.has?.(t)) positions.push({ ligne: i + 1, motif: 'dictionnaire' });
    if (RE_SIRET.test(l)) positions.push({ ligne: i + 1, motif: 'siret' });
    else if (RE_SIREN.test(l)) positions.push({ ligne: i + 1, motif: 'siren' });
    if (RE_TEL.test(l)) positions.push({ ligne: i + 1, motif: 'telephone' });
    if (RE_EMAIL.test(l)) positions.push({ ligne: i + 1, motif: 'email' });
  });
  return { n: positions.length, positions };
}

/** Phrase qui contient la position i (limites : fin de ligne, ou . ! ? suivis d'un blanc). */
function phrase(texte, i) {
  let d = i, f = i;
  while (d > 0 && !(texte[d - 1] === '\n' || (/[.!?]/.test(texte[d - 2] ?? '') && /\s/.test(texte[d - 1])))) d--;
  while (f < texte.length && !(texte[f] === '\n' || (/[.!?]/.test(texte[f]) && /\s|$/.test(texte[f + 1] ?? '')))) f++;
  return texte.slice(d, f + 1);
}

/**
 * Contrôles d'un texte destiné à un tiers. opts : {chiffres: {[cle]: number}, annonce: {description, statut, lu_le}|null,
 * lecture: {complet, lu_le}, horloge, dict, echantillon: [{alias, statut}] (B3), codes: sous-ensemble de codes à
 * appliquer (les préalables n'ont ni prix ni signature), ignorer: jetons du gabarit statique (écrit et relu par un humain,
 * il ne peut pas fuir une donnée de liste), sans_donnees: texte sans aucune donnée de liste (kit, préalable) — B7 n'y
 * exige pas de dictionnaire et ne cherche que les motifs}.
 * @returns {ResultatControle[]}
 */
export function controlerBrouillon(texte, { chiffres = {}, annonce = null, lecture = {}, horloge = creerHorloge(), dict, echantillon = null, codes = null,
  ignorer = null, sans_donnees = false } = {}) {
  const t = String(texte ?? ''), out = [], veut = (c) => !codes || codes.includes(c);
  const description = annonce?.description ?? null;
  const valeurs = Object.entries(chiffres).filter(([, v]) => Number.isFinite(v));
  const permis = new Set(valeurs.map(([, v]) => v));
  const nombres = nombresDuTexte(t, description);
  const montrer = (n) => (n.brut.replace(/\D/g, '').length >= 9 ? '[9 chiffres ou plus]' : n.brut);

  if (veut('B1')) {
    const sans = nombres.filter((n) => !permis.has(n.valeur) && !n.annee_en_contexte);
    out.push(resultat('B1', sans.length === 0, sans.length, sans.length ? `nombres sans provenance : ${sans.slice(0, 5).map(montrer).join(', ')}` : 'chaque nombre a une provenance'));
  }
  if (veut('B2')) {
    const manquants = PLACEHOLDERS.filter((p) => !t.includes(p));
    const montant = contientMontant(horsCitations(t, description));
    out.push(resultat('B2', !manquants.length && !montant, manquants.length + Number(montant),
      [manquants.length ? `placeholders absents : ${manquants.join(' ; ')}` : null, montant ? 'montant ou devise hors citation' : null].filter(Boolean).join(' ; ') || 'placeholders présents, aucun montant'));
  }
  if (veut('B3') && Array.isArray(echantillon)) {
    const non = echantillon.filter((l) => l?.statut !== 'retenue');
    out.push(resultat('B3', non.length === 0, non.length, non.length ? `${non.length} ligne(s) d’échantillon non retenue(s)` : 'lignes d’échantillon toutes retenues'));
  }
  if (veut('B4')) {
    let ok = false, motif = 'date de lecture absente';
    if (lecture?.lu_le) { try { const h = heuresEntre(lecture.lu_le, horloge.iso()); ok = h >= -1 && h <= 24 * 7; motif = `lecture de ${Math.round(h)} h`; } catch { motif = 'date de lecture illisible'; } }
    out.push(resultat('B4', ok, ok ? 0 : 1, motif));
  }
  if (veut('B5')) {
    const lie = /www\.codeur\.com\/projects\//.test(t);
    if (!annonce && !lie) out.push(resultat('B5', true, 0, 'aucune annonce liée'));
    else {
      let ok = false, motif = 'annonce liée non relue';
      if (annonce?.lu_le) { try { const h = heuresEntre(annonce.lu_le, horloge.iso()); ok = annonce.statut === 'Ouvert' && h >= -1 && h <= 24; motif = `annonce lue « ${annonce.statut} » il y a ${Math.round(h)} h`; } catch { motif = 'date de lecture de l’annonce illisible'; } }
      out.push(resultat('B5', ok, ok ? 0 : 1, motif));
    }
  }
  if (veut('B6')) {
    const p = promesses(t);
    out.push(resultat('B6', p.length === 0, p.length, p.length ? `vocabulaire de promesse : ${p.join(', ')}` : 'aucune promesse'));
  }
  if (veut('B7')) {
    if ((!dict?.jetons || dict.jetons.size === 0) && !sans_donnees) out.push(resultat('B7', false, 1, 'dictionnaire absent ou vide : contrôle antifuite impossible (échec fermé)'));
    else { const s = scannerTexte(t, dict, { ignorer }); out.push(resultat('B7', s.n === 0, s.n, s.n ? `donnée nominative possible : lignes ${[...new Set(s.positions.map((x) => x.ligne))].join(', ')} (${[...new Set(s.positions.map((x) => x.motif))].join(', ')})` : 'aucune donnée nominative')); }
  }
  if (veut('B8')) {
    const sonde = new Set(valeurs.filter(([k]) => k.startsWith('sonde.')).map(([, v]) => v));
    const hors = nombres.filter((n) => sonde.has(n.valeur) && !/brut/i.test(phrase(t, n.debut)));
    out.push(resultat('B8', hors.length === 0, hors.length, hors.length ? 'total brut de sonde dans une phrase sans « brut »' : 'totaux bruts étiquetés'));
  }
  if (veut('L1') && lecture?.complet === false) {
    const autres = new Set(valeurs.filter(([k]) => !k.startsWith('compte.')).map(([, v]) => v));
    const comptes = new Set(valeurs.filter(([k]) => k.startsWith('compte.')).map(([, v]) => v));
    const nus = nombres.filter((n) => comptes.has(n.valeur) && !autres.has(n.valeur) && !/au moins\s*$/i.test(t.slice(Math.max(0, n.debut - 12), n.debut)));
    out.push(resultat('L1', nus.length === 0, nus.length, nus.length ? `lecture partielle : ${nus.length} compte(s) sans « au moins »` : 'lecture partielle : chaque compte porte « au moins »'));
  }
  return out;
}

/** Placeholders qu'un texte destiné à un tiers doit garder (prix et nom laissés au propriétaire). */
export const PLACEHOLDERS = Object.freeze(['[PRIX À VALIDER PAR LE PROPRIÉTAIRE', '[NOM DU PROPRIÉTAIRE]']);
