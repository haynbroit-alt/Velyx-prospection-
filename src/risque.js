// Risk Agent de VELYX v2 (M9). Il rend le verdict de chaque action du moteur, en monde fermé : une action absente de
// sa table va en revue humaine (R-00, règle écrite par le propriétaire dans politique.json). Le verdict final est le
// plus restrictif de la table et de politique.json, relu à chaque évaluation. Mandat 0 € : toute dépense est interdite
// tant que l'encaissé est nul ; envoi, contact, publication, prix et inscription vont en revue humaine.
//
// Le module tient aussi la file de revue humaine (prive/revues/<R-id>.md, actes « revue » au registre) et la validation
// liée à l'empreinte du contenu : le propriétaire valide « valide R-…#<6 premiers caractères de l'empreinte> », et la
// validation est refusée si le texte a changé depuis la mise en revue, ou si la revue est caduque, expirée ou close.
//
// Reportés (périmètre v2) : hook PreToolUse (evaluerOutil, crochetPreOutil), gestes par commentaires d'issue GitHub
// (filtrerCommentairesGithub, vérification 'github'), copie vers Drive (copier_drive tombe sous R-00).
import fs from 'node:fs';
import path from 'node:path';
import { VERDICTS, TYPES_ACTION, TYPES_REVUE, ISSUES, ISSUES_POSITIVES } from './contrats.js';
import { creerHorloge, empreinte, sha256Texte, heuresEntre, defautChaine } from './socle.js';
import { CLES } from './registre.js';

/** Dossier privé de la file de revue humaine. */
export const DOSSIER_REVUES = 'prive/revues';
/** Journal privé des phrases du propriétaire (seule leur empreinte va au registre). */
export const JOURNAL_GESTES = 'prive/gestes.jsonl';
/** Actions sensibles hors de TYPES_ACTION : elles ne sont jamais exécutées par l'agent sans le propriétaire. */
export const ACTIONS_SENSIBLES = Object.freeze(['depense', 'envoi', 'contact', 'publication', 'prix', 'inscription']);
/** Actions que le moteur peut exécuter lui-même après une validation liée à l'empreinte (les autres restent un geste du propriétaire). */
export const EXECUTABLES_APRES_VALIDATION = Object.freeze(['publication', 'publier_site', 'creer_brouillon_gmail']);
/** Limites : 2 propositions ouvertes, 5 cycles sans geste (gel D8), 7 jours de validité d'une revue, 300 caractères par notification. */
export const LIMITES = Object.freeze({ propositions_ouvertes: 2, cycles_gel: 5, revue_jours: 7, notification_car: 300, regeneration_requetes: 60 });

// ---------------------------------------------------------------------------------------------------------------------
// politique.json : le fichier du propriétaire, relu à chaque évaluation.

/**
 * Lit politique.json à la racine. → {politique: object|null, empreinte: hex16|null, texte: string|null, motif: string|null}.
 * Fichier absent ou illisible : politique = null, et toute action va au moins en revue humaine.
 */
export function chargerPolitique(racine) {
  const chemin = path.join(path.resolve(racine), 'politique.json');
  let texte;
  try { texte = fs.readFileSync(chemin, 'utf8'); } catch { return { politique: null, empreinte: null, texte: null, motif: 'politique.json absent' }; }
  const emp = sha256Texte(texte).slice(0, 16);
  try {
    const p = JSON.parse(texte);
    if (p === null || typeof p !== 'object' || Array.isArray(p)) return { politique: null, empreinte: emp, texte, motif: 'politique.json : objet attendu' };
    return { politique: p, empreinte: emp, texte, motif: null };
  } catch { return { politique: null, empreinte: emp, texte, motif: 'politique.json illisible' }; }
}

const rang = (v) => { const i = VERDICTS.indexOf(v); return i < 0 ? VERDICTS.length - 1 : i; };
/** Le plus restrictif de plusieurs verdicts (une valeur inconnue compte comme « interdit »). */
export const plusRestrictif = (...vs) => VERDICTS[Math.max(...vs.map(rang))];

const CATEGORIE_POLITIQUE = Object.freeze({ depense: 'depense', envoi: 'contacts', contact: 'contacts', creer_brouillon_gmail: 'contacts',
  publication: 'publication', publier_site: 'publication' });

const politiqueDe = (ctx) => {
  if (ctx?.politique === undefined && typeof ctx?.racine === 'string') return chargerPolitique(ctx.racine).politique;
  const p = ctx?.politique;
  if (p && typeof p === 'object' && Object.hasOwn(p, 'politique') && Object.hasOwn(p, 'empreinte')) return p.politique;   // résultat de chargerPolitique
  return p && typeof p === 'object' ? p : null;
};

/** Verdict de politique.json seul pour une action. → {verdict, regle, motif} */
export function verdictPolitique(action, ctx = {}) {
  const pol = politiqueDe(ctx);
  if (!pol) return { verdict: 'revue_humaine', regle: 'R-00', motif: 'politique.json absent ou illisible : toute action en revue humaine' };
  const cat = CATEGORIE_POLITIQUE[action?.type];
  if (cat === 'depense') {
    const d = pol.depense;
    if (!d || typeof d !== 'object') return { verdict: 'interdit', regle: 'R-18', motif: 'politique.json ne dit rien des dépenses : interdit (échec fermé)' };
    if (encaisse(ctx) <= 0) {
      const v = VERDICTS.includes(d.avant_premier_encaissement) ? d.avant_premier_encaissement : 'interdit';
      return { verdict: v, regle: 'R-18', motif: `politique.json : avant le premier encaissement, dépense « ${v} »` };
    }
    const plafond = typeof d.plafond_eur === 'number' && Number.isFinite(d.plafond_eur) ? d.plafond_eur : 0;
    if (!montantValide(action) || action.params.montant_eur > plafond) {
      return { verdict: 'interdit', regle: 'R-19', motif: `politique.json : plafond_eur ${plafond} €, que seul le propriétaire relève` };
    }
    const v = VERDICTS.includes(d.apres_premier_encaissement) ? d.apres_premier_encaissement : 'interdit';
    return { verdict: v, regle: 'R-19', motif: `politique.json : après le premier encaissement, dépense « ${v} »` };
  }
  if (cat === 'contacts') {
    const c = pol.contacts;
    const v = c === 'brouillons' ? 'revue_humaine' : VERDICTS.includes(c) ? c : 'revue_humaine';
    return { verdict: v, regle: 'R-20', motif: `politique.json : contacts = « ${c ?? 'absent'} » (l’agent n’écrit que des brouillons)` };
  }
  if (cat === 'publication') {
    const v = VERDICTS.includes(pol.publication) ? pol.publication : 'revue_humaine';
    return { verdict: v, regle: 'R-25', motif: `politique.json : publication = « ${pol.publication ?? 'absent'} »` };
  }
  return { verdict: 'autorise', regle: null, motif: 'politique.json ne restreint pas ce type d’action (la table décide)' };
}

// ---------------------------------------------------------------------------------------------------------------------
// Table du Risk Agent. Ordre significatif : la première règle de l'action dont la condition est vraie donne le verdict.
// Toute modification change empreintePolitique(), scellée dans test/risque.test.js : elle passe par une PR.

const encaisse = (ctx) => { const v = ctx?.etat?.encaisse_eur; return typeof v === 'number' && Number.isFinite(v) ? v : 0; };
const montantValide = (a) => { const m = a?.params?.montant_eur; return typeof m === 'number' && Number.isFinite(m) && m > 0; };
const budgetRestant = (ctx, source) => {
  const b = ctx?.budget;
  if (!b || typeof b.reste !== 'function') return false;
  try { return b.reste(source) > 0; } catch { return false; }
};
const gele = (ctx) => (ctx?.etat?.cycles_sans_geste ?? 0) >= LIMITES.cycles_gel;
const CLES_PRIX = ['prix', 'prix_eur', 'tarif', 'remise', 'taux', 'montant_eur'];
const contientPrix = (a) => CLES_PRIX.some((k) => a?.params?.[k] !== undefined && a.params[k] !== null);
const cguCodeur = (ctx) => ctx?.etat?.cgu_codeur ?? ctx?.etat?.canaux?.codeur?.cgu ?? 'inconnue';
const horsPlateformeNonAutorise = (a, ctx) => a?.params?.client_codeur === true && cguCodeur(ctx) !== 'lue_compatible';
const cheminHorsSitePrive = (a) => a?.params?.chemin !== undefined && !/^prive\/site\/[\w.-]+$/.test(String(a.params.chemin));
const notificationPermise = (a, ctx) => {
  const t = a?.params?.texte;
  return typeof t === 'string' && t.length > 0 && [...t].length <= LIMITES.notification_car && (ctx?.etat?.notifications_cycle ?? 0) < 1;
};
const segmentGagne = (a, ctx) => {
  const g = ctx?.etat?.segments_gagnes, s = a?.params?.segment ?? a?.ref;
  return s !== undefined && s !== null && (g instanceof Set ? g.has(s) : Array.isArray(g) && g.includes(s));
};
const regenerationPermise = (a) => typeof a?.params?.pari === 'string' && /^P-/.test(a.params.pari)
  && Number.isFinite(a?.params?.estimation_requetes) && a.params.estimation_requetes <= LIMITES.regeneration_requetes;
const regleAdoptable = (a) => a?.params?.pari_gagne === true && a?.params?.backtest !== null && typeof a?.params?.backtest === 'object';

const R = (regle, action, verdict, motif, condition) => Object.freeze({ regle, action, verdict, motif, ...(condition ? { condition } : {}) });
const MOTIF_CODEUR = 'budget codeur absent ou épuisé pour ce cycle';
const MOTIF_SIRENE = 'budget SIRENE absent ou épuisé pour ce cycle';
const MOTIF_OPPOSITIONS = 'oppositions indisponibles : aucune liste ni aucun échantillon (échec fermé)';
const MOTIF_GEL = 'gel D8 : 5 cycles sans geste du propriétaire, veille seule';
const MOTIF_PRIX = 'aucun prix dans un brouillon : le propriétaire le fixe lui-même en revue';
const MOTIF_SITE = 'publication refusée : verifierSite n’est pas vert (mentions légales, contact d’opposition, antifuite, chiffres sourcés, usage réel)';
const MOTIF_CGU = 'contact d’un client codeur hors de la plateforme : interdit tant que les CGU ne sont pas lues et ne l’autorisent pas';

/** Table du Risk Agent : {regle, action, verdict, motif, condition?(action, ctx)}. Gelée. */
export const POLITIQUE = Object.freeze([
  // Argent : le mandat 0 € (ligne 14 du registre) d'abord ; ensuite politique.json (plafond_eur, relevé par le propriétaire seul).
  R('R-18', 'depense', 'interdit', 'toute dépense est interdite tant que l’encaissé est nul (mandat du 15/11/2026, ligne 14 ; politique.json)', (a, ctx) => encaisse(ctx) <= 0),
  R('R-19', 'depense', 'interdit', 'montant de dépense illisible (nombre fini et positif attendu)', (a) => !montantValide(a)),
  R('R-19', 'depense', 'revue_humaine', 'après le premier encaissement, toute dépense va en revue humaine, dans la limite de plafond_eur'),
  // Gestes envers des tiers : toujours le propriétaire.
  R('R-23', 'envoi', 'interdit', MOTIF_CGU, horsPlateformeNonAutorise),
  R('R-20', 'envoi', 'revue_humaine', 'envoyer est un geste du propriétaire : le texte part en revue, il l’envoie lui-même'),
  R('R-23', 'contact', 'interdit', MOTIF_CGU, horsPlateformeNonAutorise),
  R('R-20', 'contact', 'revue_humaine', 'contacter une entreprise ou une personne est un geste du propriétaire (politique.json : contacts = brouillons)'),
  R('R-22', 'prix', 'revue_humaine', 'le prix est choisi par le propriétaire ; les repères cités ne sont jamais pré-remplis'),
  R('R-24', 'inscription', 'revue_humaine', 'inscription, compte, CGU ou statut : le kit est préparé, le geste est celui du propriétaire'),
  R('R-25', 'publication', 'interdit', MOTIF_SITE, (a) => a?.params?.site_ok !== true),
  R('R-25', 'publication', 'revue_humaine', 'publication liée à l’empreinte exacte du contenu, après validation du propriétaire'),
  R('R-25', 'publier_site', 'interdit', MOTIF_SITE, (a) => a?.params?.site_ok !== true),
  R('R-25', 'publier_site', 'revue_humaine', 'publication du site liée à l’empreinte exacte du HTML, après validation du propriétaire'),
  R('R-25', 'preparer_site', 'interdit', 'avant validation, la page ne s’écrit que dans prive/site/', cheminHorsSitePrive),
  R('R-25', 'preparer_site', 'autorise', 'page générée depuis etat/ et écrite dans prive/site/ seulement'),
  R('R-26', 'creer_brouillon_gmail', 'interdit', 'brouillon Gmail seulement pour une revue déjà validée', (a) => a?.params?.revue_validee !== true),
  R('R-26', 'creer_brouillon_gmail', 'revue_humaine', 'brouillon Gmail : destinataire désigné par le propriétaire, aucun envoi'),
  R('R-38', 'notifier', 'interdit', 'notification vide, de plus de 300 caractères, ou déjà émise dans ce cycle', (a, ctx) => !notificationPermise(a, ctx)),
  R('R-38', 'notifier', 'autorise', 'une notification par cycle au plus, 300 caractères au plus'),
  // Lectures réseau : porte unique de socle.js, budgets du cycle.
  R('R-06', 'suivre_annonce', 'interdit', MOTIF_CODEUR, (a, ctx) => !budgetRestant(ctx, 'codeur')),
  R('R-02', 'suivre_annonce', 'autorise', 'GET www.codeur.com par la porte réseau (liste blanche, débit poli)'),
  R('R-06', 'lire_cgu', 'interdit', MOTIF_CODEUR, (a, ctx) => !budgetRestant(ctx, 'codeur')),
  R('R-02', 'lire_cgu', 'autorise', 'GET d’une page publique /pages/<slug> de www.codeur.com, texte traité comme donnée'),
  R('R-06', 'sonder', 'interdit', MOTIF_SIRENE, (a, ctx) => !budgetRestant(ctx, 'sirene')),
  R('R-03', 'sonder', 'autorise', 'GET recherche-entreprises.api.gouv.fr/search, paramètres de la liste blanche'),
  R('R-14', 'echantillonner', 'interdit', MOTIF_OPPOSITIONS, (a, ctx) => ctx?.etat?.oppositions_dispo !== true),
  R('R-21', 'echantillonner', 'interdit', MOTIF_GEL, (a, ctx) => gele(ctx)),
  R('R-06', 'echantillonner', 'interdit', MOTIF_SIRENE, (a, ctx) => !budgetRestant(ctx, 'sirene')),
  R('R-03', 'echantillonner', 'autorise', 'preuve légère : k pages tirées du registre'),
  R('R-14', 'construire_liste', 'interdit', MOTIF_OPPOSITIONS, (a, ctx) => ctx?.etat?.oppositions_dispo !== true),
  R('R-21', 'construire_liste', 'interdit', MOTIF_GEL, (a, ctx) => gele(ctx)),
  R('R-31', 'construire_liste', 'interdit', 'liste complète avant une issue positive du segment : preuve légère d’abord (sauf régénération de 60 requêtes au plus pour un pari existant)',
    (a, ctx) => !segmentGagne(a, ctx) && !regenerationPermise(a)),
  R('R-06', 'construire_liste', 'interdit', MOTIF_SIRENE, (a, ctx) => !budgetRestant(ctx, 'sirene')),
  R('R-03', 'construire_liste', 'autorise', 'liste d’un segment gagné, ou régénération bornée d’un pari existant'),
  // Écritures privées et données validées par schéma.
  R('R-42', 'ecrire_recette', 'autorise', 'recette déclarative validée par schéma, essayée à blanc d’abord'),
  R('R-22', 'rediger_brouillon', 'interdit', MOTIF_PRIX, contientPrix),
  R('R-21', 'rediger_brouillon', 'interdit', MOTIF_GEL, (a, ctx) => gele(ctx)),
  R('R-21', 'rediger_brouillon', 'interdit', 'deux propositions déjà ouvertes : aucune nouvelle', (a, ctx) => (ctx?.etat?.revues_ouvertes_n ?? 0) >= LIMITES.propositions_ouvertes),
  R('R-09', 'rediger_brouillon', 'autorise', 'brouillon écrit dans prive/ ; il part ensuite en revue humaine'),
  R('R-22', 'regenerer_brouillon', 'interdit', MOTIF_PRIX, contientPrix),
  R('R-09', 'regenerer_brouillon', 'autorise', 'nouvelle version écrite dans prive/ ; l’ancienne revue devient caduque'),
  R('R-24', 'preparer_prealable', 'autorise', 'fiche de préalable (texte, étapes) écrite dans prive/ ; elle part en revue'),
  R('R-24', 'preparer_kit_canal', 'autorise', 'kit de canal écrit dans prive/ ; la publication reste un geste du propriétaire'),
  R('R-28', 'invalider_revue', 'autorise', 'revue caduque : jamais relancée'),
  R('R-28', 'clore_pari_caduc', 'autorise', 'clôture « caduc » avec acte cloture et leçon due'),
  R('R-28', 'demander_issue', 'autorise', 'demander l’issue au propriétaire ; un pari n’est perdu que sur son acte'),
  R('R-13', 'purger_opposition', 'autorise', 'purge d’un SIREN après une opposition, première action du cycle'),
  R('R-42', 'ecrire_lecon', 'autorise', 'leçon validée (acte source cité, objet modifié)'),
  R('R-29', 'adopter_regle', 'interdit', 'une règle n’est adoptée qu’après un pari gagné et un backtest chiffré', (a) => !regleAdoptable(a)),
  R('R-42', 'adopter_regle', 'autorise', 'règle déclarative adoptée après pari gagné, test vert et backtest'),
  R('R-29', 'reviser_croyance', 'interdit', 'aucune révision pendant une panne du parseur', (a, ctx) => ctx?.etat?.parseur_sain === false),
  R('R-29', 'reviser_croyance', 'interdit', 'pari_gagne seulement sur une issue positive (devis_demande, echange, commande, paye)',
    (a) => a?.params?.vers === 'pari_gagne' && !ISSUES_POSITIVES.includes(a?.params?.issue)),
  R('R-29', 'reviser_croyance', 'autorise', 'révision par seuils écrits d’avance'),
  R('R-09', 'sauver_memoire', 'autorise', 'mémoire écrite sous prive/'),
  R('R-09', 'rien', 'autorise', 'aucune action'),
]);

/**
 * Règles R-00 à R-44 de la spécification qui ne sont pas des lignes de la table : module qui les applique, ou « reporté ».
 * Avec POLITIQUE, elles couvrent toute la numérotation (vérifié par test/risque.test.js).
 */
export const REGLES_AILLEURS = Object.freeze({
  'R-00': 'défaut de verdictTable : action absente de la table → revue_humaine ; politique.json absent → revue_humaine',
  'R-01': 'reporté (hook PreToolUse) ; l’empreinte de la table est scellée dans test/risque.test.js',
  'R-04': 'socle.verifierUrl : HoteInterdit ou CheminInterdit avant tout appel',
  'R-05': 'socle.creerHttp : 403 → Bloque, aucun nouvel essai',
  'R-07': 'reporté (hook PreToolUse : réseau, environnement, identifiants)',
  'R-08': 'reporté (hook PreToolUse : WebFetch)',
  'R-10': 'garde.verifierPublic branché sur socle.creerMagasin',
  'R-11': 'garde.purgerPrive(fin_cycle)',
  'R-12': 'controles G4, non neutralisable',
  'R-15': 'garde.purgerPrive(retention_90j)',
  'R-16': 'garde (antifuite) et registre (clés nominatives refusées)',
  'R-17': 'garde.minimiser et controles.minimiser',
  'R-27': 'registre (PROPRIETAIRE_SEUL, verification, preuve_empreinte) et appliquerGeste (session seulement)',
  'R-30': 'site.construireSite (nombre sans source datée non affiché) et bilan.mesurer (aucun potentiel additionné)',
  'R-32': 'reporté (copie Drive)',
  'R-33': 'reporté (hook PreToolUse : Drive)',
  'R-34': 'reporté (branche velyx/etat, hook pre-push)',
  'R-35': 'reporté (hook PreToolUse : Write et Edit hors de prive/)',
  'R-36': 'reporté (hook PreToolUse : git)',
  'R-37': 'reporté (gestes par commentaires GitHub)',
  'R-39': 'reporté (hook PreToolUse : artifacts)',
  'R-40': 'reporté (hook PreToolUse : tâches planifiées, environnement)',
  'R-41': 'reporté (hook PreToolUse : connecteurs)',
  'R-43': 'socle.PLAFONDS.passages_jour et cycle (M11)',
  'R-44': 'package.json sans dépendance (vérifié par test/risque.test.js)',
});

// Fonctions dont dépendent les conditions : leur texte entre aussi dans l'empreinte scellée.
const AIDES = [encaisse, montantValide, budgetRestant, gele, contientPrix, cguCodeur, horsPlateformeNonAutorise, cheminHorsSitePrive,
  notificationPermise, segmentGagne, regenerationPermise, regleAdoptable];

/** Empreinte (hex16) de la table sérialisée, conditions et fonctions d'aide comprises, ainsi que des limites. */
export function empreintePolitique() {
  return empreinte({
    table: POLITIQUE.map((r) => ({ regle: r.regle, action: r.action, verdict: r.verdict, motif: r.motif, condition: r.condition ? String(r.condition) : null })),
    aides: AIDES.map(String), limites: LIMITES, categories: CATEGORIE_POLITIQUE, sensibles: ACTIONS_SENSIBLES,
  });
}

/** Verdict de la table seule. Une action absente → R-00 revue_humaine ; une condition qui lève → interdit (échec fermé). */
export function verdictTable(action, ctx = {}) {
  const type = typeof action?.type === 'string' ? action.type : null;
  if (!type || (!TYPES_ACTION.includes(type) && !ACTIONS_SENSIBLES.includes(type))) {
    return { verdict: 'revue_humaine', regle: 'R-00', motif: `action inconnue${type ? ` « ${type} »` : ''} : revue humaine (politique.json : une action absente va en revue humaine)` };
  }
  for (const r of POLITIQUE) {
    if (r.action !== type) continue;
    let vrai;
    try { vrai = r.condition ? Boolean(r.condition(action, ctx)) : true; } catch (e) {
      return { verdict: 'interdit', regle: r.regle, motif: `contexte illisible pour ${r.regle} (${e?.message ?? 'erreur'}) : interdit` };
    }
    if (vrai) return { verdict: r.verdict, regle: r.regle, motif: r.motif };
  }
  return { verdict: 'revue_humaine', regle: 'R-00', motif: `action « ${type} » absente de la table : revue humaine` };
}

/**
 * Verdict d'une action. ctx : {politique (objet ou résultat de chargerPolitique ; sinon ctx.racine pour le relire),
 * etat: {encaisse_eur, revues_ouvertes_n, cycles_sans_geste, oppositions_dispo, statut_proprietaire, canaux,
 * notifications_cycle?, parseur_sain?, cgu_codeur?, segments_gagnes?}, budget}.
 * → {verdict, regle, motif, source: 'table'|'politique.json', table, politique}. Le verdict est le plus restrictif des deux.
 */
export function evaluer(action, ctx = {}) {
  const table = verdictTable(action, ctx), pol = verdictPolitique(action, ctx);
  const verdict = plusRestrictif(table.verdict, pol.verdict);
  const parPolitique = rang(pol.verdict) > rang(table.verdict);
  return {
    verdict,
    regle: parPolitique ? pol.regle ?? table.regle : table.regle,
    motif: parPolitique ? pol.motif : table.motif,
    source: parPolitique ? 'politique.json' : 'table',
    table: { verdict: table.verdict, regle: table.regle },
    politique: { verdict: pol.verdict, motif: pol.motif },
  };
}

/**
 * Après une validation du propriétaire liée à l'empreinte : une action en revue_humaine des EXECUTABLES_APRES_VALIDATION
 * devient exécutable si la revue est validée avec exactement cette empreinte. Un interdit le reste ; un envoi, un contact,
 * un prix ou une dépense restent des gestes du propriétaire.
 */
export function verdictApresValidation(action, verdict, { registre, revue, empreinte: emp, horloge = creerHorloge() } = {}) {
  if (verdict?.verdict !== 'revue_humaine' || !EXECUTABLES_APRES_VALIDATION.includes(action?.type)) return verdict;
  if (!registre || !estValidee(registre, revue, emp, horloge)) return verdict;
  return { ...verdict, verdict: 'autorise', motif: `validé par le propriétaire (revue ${revue}, empreinte ${String(emp).slice(0, 6)})` };
}

// ---------------------------------------------------------------------------------------------------------------------
// File de revue humaine.

const DEBUT_TEXTE = '<!-- velyx:texte:debut -->', FIN_TEXTE = '<!-- velyx:texte:fin -->';
const RE_RID = /^R-\d{4}-\d{2}-\d{2}-\d+$/;
const RE_PID = /^P-[\w-]{1,120}$/;

/** Dernier acte du propriétaire (ligne) et nombre de cycles écrits depuis. */
export function cyclesSansGeste(registre) {
  const L = registre.lignes;
  let i = L.length - 1;
  while (i >= 0 && L[i].auteur !== 'proprietaire') i--;
  return { n: L.slice(i + 1).filter((l) => l.type === 'cycle').length, dernier_geste: i >= 0 ? L[i].date : null, ligne: i >= 0 ? L[i].n : null };
}

/**
 * Toutes les revues du registre avec leur statut : envoyee > rejetee > caduque (acte) > validee > caduque (expirée) > ouverte.
 * → Revue[] (+ annonce, n, decision_le, motif_caduque)
 */
export function revuesDe(registre, horloge = creerHorloge()) {
  const L = registre.lignes, maintenant = horloge.iso(), par = new Map();
  for (const l of L) {
    if (l.type !== 'revue' || typeof l.id !== 'string' || par.has(l.id)) continue;
    par.set(l.id, { id: l.id, type: l.type_revue, ref: l.ref ?? null, annonce: l.annonce ?? null, empreinte: l.empreinte_revue,
      fichier_prive: l.fichier_prive, geste: l.geste, canal: l.canal ?? null, ouverte_le: l.date, expire_le: l.expire_le ?? null,
      n: l.n, drapeaux: { envoyee: null, rejetee: null, caduque: null, validee: null }, motif_caduque: null });
  }
  const marquer = (id, quoi, l, motif) => {
    const r = par.get(id);
    if (!r || r.drapeaux[quoi]) return;
    r.drapeaux[quoi] = l.date;
    if (quoi === 'caduque') r.motif_caduque = motif ?? null;
  };
  for (const l of L) {
    if (l.type === 'validation' && l.auteur === 'proprietaire' && par.get(l.revue)?.empreinte === l.empreinte_revue) marquer(l.revue, 'validee', l);
    else if (l.type === 'geste' && l.auteur === 'proprietaire' && l.sujet === 'rejet') marquer(l.valeur, 'rejetee', l);
    else if (l.type === 'envoi' && l.auteur === 'proprietaire' && typeof l.revue === 'string') marquer(l.revue, 'envoyee', l);
    else if (l.type === 'decision' && l.action === 'invalider_revue' && typeof l.revue === 'string') marquer(l.revue, 'caduque', l, l.motif);
  }
  return [...par.values()].map((r) => {
    const d = r.drapeaux, expiree = r.expire_le !== null && Date.parse(r.expire_le) <= Date.parse(maintenant);
    const statut = d.envoyee ? 'envoyee' : d.rejetee ? 'rejetee' : d.caduque ? 'caduque' : d.validee ? 'validee' : expiree ? 'caduque' : 'ouverte';
    const decision_le = [d.envoyee, d.rejetee, d.validee].filter(Boolean).sort()[0] ?? null;
    const { drapeaux, ...reste } = r;
    return { ...reste, statut, motif_caduque: statut === 'caduque' ? r.motif_caduque ?? 'expiree' : null, decision_le,
      age_h: Math.round(heuresEntre(r.ouverte_le, maintenant) * 10) / 10 };
  });
}

/** Revues ouvertes (ni validées, ni rejetées, ni envoyées, ni caduques, ni expirées). */
export const fileOuverte = (registre, horloge = creerHorloge()) => revuesDe(registre, horloge).filter((r) => r.statut === 'ouverte');

/** Vrai si la revue est validée par le propriétaire avec exactement cette empreinte (et n'est pas devenue caduque). */
export function estValidee(registre, revueId, emp, horloge = creerHorloge()) {
  const r = revuesDe(registre, horloge).find((x) => x.id === revueId);
  return Boolean(r && r.statut === 'validee' && typeof emp === 'string' && r.empreinte === emp);
}

/** Texte soumis, extrait d'une fiche de revue (seul ce bloc est couvert par l'empreinte). null s'il est introuvable. */
export function extraireTexte(markdown) {
  const s = String(markdown ?? ''), i = s.indexOf(`${DEBUT_TEXTE}\n`), j = s.lastIndexOf(`\n${FIN_TEXTE}`);
  return i < 0 || j < i ? null : s.slice(i + DEBUT_TEXTE.length + 1, j);
}

const tableau = (lignes) => lignes.map((l) => `| ${l.map((c) => String(c ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`).join('\n');
const puces = (xs, vide) => (Array.isArray(xs) && xs.length ? xs.map((x) => `- ${x}`).join('\n') : `- ${vide}`);

/**
 * Fiche privée d'une revue (markdown). Les ancres de prix sont données à titre d'information, jamais pré-remplies.
 * Le texte soumis est recopié tel quel entre deux marqueurs : c'est lui que couvre l'empreinte.
 */
export function rendreRevue(revue, { texte, controles = [], affirme = [], ne_promet_pas = [], ancres_prix = [] } = {}) {
  const emp = String(revue.empreinte ?? '');
  return [
    `# Revue ${revue.id} (${revue.type})`, '',
    `- Référence : ${revue.ref ?? '—'}`,
    `- Canal : ${revue.canal ?? '—'}`,
    `- Ouverte le ${revue.ouverte_le ?? '—'} ; expire le ${revue.expire_le ?? '—'} (une revue caduque n'est jamais relancée)`,
    `- Empreinte du texte : ${emp}`, '',
    '## Geste attendu du propriétaire', '', revue.geste ?? '—', '',
    `Pour valider exactement cette version : \`valide ${revue.id}#${emp.slice(0, 6)}\` ; pour la refuser : \`rejette ${revue.id} <motif>\`.`, '',
    '## Texte soumis (seul ce bloc est couvert par l’empreinte)', '', DEBUT_TEXTE, texte, FIN_TEXTE, '',
    '## Contrôles passés', '',
    controles.length ? tableau([['code', 'gravité', 'ok', 'motif'], ['---', '---', '---', '---'], ...controles.map((c) => [c.code, c.gravite, c.ok ? 'oui' : 'NON', c.motif])]) : '- aucun contrôle fourni',
    '', '## Ce que le texte affirme', '', puces(affirme, 'non précisé'),
    '', '## Ce qu’il ne promet pas', '', puces(ne_promet_pas, 'non précisé'),
    '', '## Repères de prix (information seulement, jamais pré-remplis ; le propriétaire choisit)', '', puces(ancres_prix, 'aucun repère cité'), '',
  ].join('\n');
}

/**
 * Met un élément en revue humaine : fiche privée prive/revues/<R-id>.md et acte « revue » (empreinte = empreinte(texte)).
 * Idempotent : le même texte pour le même (type, ref) rend la revue existante. Une nouvelle version pour le même
 * (type, ref) rend les revues ouvertes précédentes caduques (motif « remplacee »). 2 propositions ouvertes au plus.
 * → {revue, acte, remplacees: string[]}
 */
export function mettreEnRevue({ type, ref = null, texte, geste, canal = null, expire_le, annonce = null, controles, affirme, ne_promet_pas, ancres_prix } = {},
  { registre, horloge = creerHorloge(), magasin } = {}) {
  if (!registre || !magasin) throw new Error('mettreEnRevue : registre et magasin requis');
  if (!TYPES_REVUE.includes(type)) throw new Error(`mettreEnRevue : type « ${type} » hors de ${TYPES_REVUE.join(', ')}`);
  if (typeof texte !== 'string' || !texte.trim()) throw new Error('mettreEnRevue : texte non vide attendu');
  if (texte.includes(DEBUT_TEXTE) || texte.includes(FIN_TEXTE)) throw new Error('mettreEnRevue : le texte contient un marqueur réservé');
  if (typeof geste !== 'string' || !geste.trim()) throw new Error('mettreEnRevue : geste exact du propriétaire attendu');
  if (ref !== null && (typeof ref !== 'string' || !ref || ref.length > 120)) throw new Error('mettreEnRevue : ref texte de 1 à 120 caractères');
  const expire = expire_le ?? new Date(horloge.maintenant().getTime() + LIMITES.revue_jours * 864e5).toISOString();
  if (!Number.isFinite(Date.parse(expire))) throw new Error('mettreEnRevue : expire_le illisible');
  const emp = empreinte(texte), cle = CLES.revue(type, ref ?? '-', emp);
  const existante = registre.trouver(cle);
  if (existante) {
    const revue = revuesDe(registre, horloge).find((r) => r.id === existante.id);
    if (!magasin.existe(existante.fichier_prive)) magasin.ecrirePrive(existante.fichier_prive, rendreRevue(revue, { texte, controles, affirme, ne_promet_pas, ancres_prix }));
    return { revue, acte: existante, remplacees: [] };
  }
  const ouvertes = fileOuverte(registre, horloge);
  const anciennes = ouvertes.filter((r) => r.type === type && (r.ref ?? null) === ref && r.empreinte !== emp);
  if (type === 'proposition' && ouvertes.filter((r) => r.type === 'proposition' && !anciennes.includes(r)).length >= LIMITES.propositions_ouvertes) {
    throw new Error(`mettreEnRevue : ${LIMITES.propositions_ouvertes} propositions déjà ouvertes (R-21) ; aucune nouvelle`);
  }
  for (const a of anciennes) {
    registre.ajouter({ type: 'decision', action: 'invalider_revue', verdict: 'autorise', regle: 'R-28', revue: a.id, motif: 'remplacee', cle: `caduque:${a.id}` });
  }
  const jour = horloge.jour(), k = registre.de('revue', (l) => typeof l.id === 'string' && l.id.startsWith(`R-${jour}-`)).length + 1;
  const id = `R-${jour}-${k}`, fichier_prive = `${DOSSIER_REVUES}/${id}.md`;
  const acte = registre.ajouter({ type: 'revue', id, type_revue: type, ref, empreinte_revue: emp, geste, fichier_prive, canal, expire_le: expire,
    ...(annonce ? { annonce: String(annonce) } : {}), cle });
  const revue = revuesDe(registre, horloge).find((r) => r.id === id);
  magasin.ecrirePrive(fichier_prive, rendreRevue(revue, { texte, controles, affirme, ne_promet_pas, ancres_prix }));
  return { revue, acte, remplacees: anciennes.map((a) => a.id) };
}

/**
 * Rend caduques les revues ouvertes dont l'annonce n'est plus « Ouvert » ou qui ont expiré (lecture de plus de 7 j).
 * Une revue caduque n'est jamais relancée. → lignes écrites (actes decision invalider_revue).
 */
export function expirer(registre, { statuts_annonces = {}, horloge = creerHorloge() } = {}) {
  const actes = [], maintenant = Date.parse(horloge.iso());
  const toutes = revuesDe(registre, horloge);
  for (const r of toutes) {
    if (!['ouverte', 'caduque'].includes(r.statut) || registre.trouver(`caduque:${r.id}`)) continue;
    const statut = statuts_annonces[r.annonce] ?? statuts_annonces[r.ref];
    let motif = null;
    if (statut !== undefined && statut !== null && statut !== 'Ouvert') motif = `annonce_${String(statut).toLowerCase().replace(/[^a-zé]+/g, '_')}`;
    else if (r.expire_le && Date.parse(r.expire_le) <= maintenant) motif = 'expiree';
    if (!motif) continue;
    actes.push(registre.ajouter({ type: 'decision', action: 'invalider_revue', verdict: 'autorise', regle: 'R-28', revue: r.id, motif, cle: `caduque:${r.id}` }));
  }
  return actes;
}

/** État public de la file (etat/revue.json) : comptes et âge maximal, sans nom ni chemin privé. */
export function etatRevuePublic(revues) {
  const ouvertes = (revues ?? []).filter((r) => r.statut === undefined || r.statut === 'ouverte');
  const par_type = {};
  for (const r of ouvertes) par_type[r.type] = (par_type[r.type] ?? 0) + 1;
  const ages = ouvertes.map((r) => r.age_h).filter((x) => Number.isFinite(x));
  return { n_ouvertes: ouvertes.length, par_type, age_max_h: ages.length ? Math.max(...ages) : null };
}

// ---------------------------------------------------------------------------------------------------------------------
// Gestes du propriétaire (vérification 'session' seulement ; la vérification 'github' est reportée).

/** Grammaire des gestes admis dans la session. */
export const GRAMMAIRE_GESTES = Object.freeze(['valide <R-id>#<empreinte6> [choix]', 'rejette <R-id> <motif>', 'envoye <R-id> canal=<email|comeup|malt|autre>',
  'reponse <P-id> <issue ∈ ISSUES>', 'encaisse <eur> <P-id|libre>', 'depense <eur> <objet>', 'statut <micro|societe|aucun>', 'canal <id> <ouvert|ferme>',
  'opposition <siren>']);
const CANAUX_ENVOI = ['email', 'comeup', 'malt', 'autre'];

const refus = (motif) => { const e = new Error(`geste refusé : ${motif}`); e.name = 'GesteRefuse'; return e; };
const montantFr = (s) => Number(String(s).replace(',', '.'));
function texteLibre(s, quoi) {
  const t = String(s ?? '').trim();
  if (t.length < 3 || t.length > 200) throw refus(`${quoi} de 3 à 200 caractères attendu`);
  if (/@/.test(t) || /\d[\d .]{7,}\d/.test(t)) throw refus(`${quoi} : ni adresse, ni numéro (le registre est public)`);
  const d = defautChaine(t);
  if (d) throw refus(`${quoi} ${d}`);
  return t;
}

function revueGeste(registre, horloge, id) {
  if (!RE_RID.test(id)) throw refus(`identifiant de revue illisible « ${id} »`);
  const r = revuesDe(registre, horloge).find((x) => x.id === id);
  if (!r) throw refus(`revue inconnue ${id}`);
  if (r.statut === 'caduque') throw refus(`revue ${id} caduque (${r.motif_caduque}) : jamais relancée`);
  if (r.statut !== 'ouverte' && r.statut !== 'validee') throw refus(`revue ${id} déjà ${r.statut}`);
  return r;
}

/**
 * Applique une phrase du propriétaire, saisie dans sa session. La phrase reste privée (prive/gestes.jsonl) ; seule son
 * empreinte (sha256) va au registre (verification 'session'). Refuse : phrase hors grammaire, R-id inconnu, caduc,
 * expiré ou déjà clos, empreinte différente, texte modifié depuis la mise en revue. Une opposition ne produit aucun acte :
 * le SIREN est rendu à l'appelant (M4, garde.enregistrerOpposition), jamais écrit au registre.
 * → {actes: Ligne[], prive: {phrase, preuve_empreinte, source_id, date}, opposition?: siren}
 */
export function appliquerGeste(phrase, { registre, horloge = creerHorloge(), magasin = null, verification = 'session', source_id = null } = {}) {
  if (!registre) throw new Error('appliquerGeste : registre requis');
  if (verification !== 'session') throw refus('seule la vérification « session » est disponible (commentaires GitHub : reportés)');
  const p = String(phrase ?? '').trim().replace(/\s+/g, ' ');
  if (!p || p.length > 400) throw refus('phrase vide ou trop longue');
  const preuve = sha256Texte(p), source = source_id ?? horloge.iso();
  const proprio = { auteur: 'proprietaire', verification: 'session', preuve_empreinte: preuve };
  const actes = [];
  let opposition;
  let m;
  if ((m = /^valide (R-[\d-]+)#([0-9a-fA-F]{6,16})(?: (.{1,80}))?$/.exec(p))) {
    const r = revueGeste(registre, horloge, m[1]);
    if (r.statut === 'validee') throw refus(`revue ${r.id} déjà validée`);
    const emp = m[2].toLowerCase();
    if (!r.empreinte.startsWith(emp)) throw refus(`empreinte ${emp} différente de celle de la revue ${r.id} (version précédente ou autre texte)`);
    if (!magasin) throw refus('magasin requis pour relire le texte mis en revue');
    const texte = extraireTexte(magasin.lire(r.fichier_prive));
    if (texte === null || empreinte(texte) !== r.empreinte) throw refus(`le texte de ${r.fichier_prive} a changé depuis la mise en revue`);
    const choix = m[3] === undefined ? 'valide' : m[3].trim();
    if (!/^[\p{L}\p{N} ,.'’€%+-]{1,80}$/u.test(choix)) throw refus('choix illisible');
    actes.push(registre.ajouter({ type: 'validation', ...proprio, revue: r.id, empreinte_revue: r.empreinte, choix, cle: `validation:${r.id}` }));
  } else if ((m = /^rejette (R-[\d-]+) (.+)$/.exec(p))) {
    const r = revueGeste(registre, horloge, m[1]);
    actes.push(registre.ajouter({ type: 'geste', ...proprio, sujet: 'rejet', valeur: r.id, motif: texteLibre(m[2], 'motif'), cle: `rejet:${r.id}` }));
  } else if ((m = /^envoye (R-[\d-]+) canal=([a-z]+)$/.exec(p))) {
    const r = revueGeste(registre, horloge, m[1]);
    if (!CANAUX_ENVOI.includes(m[2])) throw refus(`canal « ${m[2]} » hors de ${CANAUX_ENVOI.join(', ')}`);
    const pari = registre.derniere('pari', (l) => l.revue === r.id || l.id === `P-${r.id}`);
    if (!pari) throw refus(`aucun pari lié à la revue ${r.id} : le pari naît avec la revue`);
    // « Version dont il est parti » : le texte réellement envoyé n'est pas vérifié.
    actes.push(registre.ajouter({ type: 'envoi', ...proprio, pari: pari.id, canal: m[2], revue: r.id, empreinte_source: r.empreinte, cle: `envoi:${r.id}` }));
  } else if ((m = /^reponse (P-[\w-]+) ([a-z_]+)$/.exec(p))) {
    if (!RE_PID.test(m[1])) throw refus('identifiant de pari illisible');
    if (!ISSUES.includes(m[2])) throw refus(`issue « ${m[2]} » hors de ${ISSUES.join(', ')}`);
    actes.push(registre.ajouter({ type: 'reponse', ...proprio, pari: m[1], issue: m[2], cle: CLES.geste(source, p) }));
  } else if ((m = /^encaisse (\d+(?:[.,]\d{1,2})?) ?(?:€|eur)? (P-[\w-]+|libre)$/i.exec(p))) {
    const montant = montantFr(m[1]);
    if (!(montant > 0)) throw refus('montant strictement positif attendu');
    actes.push(registre.ajouter({ type: 'encaissement', ...proprio, montant_eur: montant, preuve: 'déclaration du propriétaire en session (phrase gardée en mémoire privée)',
      ...(m[2] === 'libre' ? {} : { pari: m[2] }), cle: CLES.geste(source, p) }));
  } else if ((m = /^depense (\d+(?:[.,]\d{1,2})?) ?(?:€|eur)? (.+)$/i.exec(p))) {
    const montant = montantFr(m[1]);
    if (!(montant > 0)) throw refus('montant strictement positif attendu');
    actes.push(registre.ajouter({ type: 'depense', ...proprio, montant_eur: montant, objet: texteLibre(m[2], 'objet'), autorise_par: 'proprietaire', cle: CLES.geste(source, p) }));
  } else if ((m = /^statut (micro|societe|aucun)$/.exec(p))) {
    actes.push(registre.ajouter({ type: 'geste', ...proprio, sujet: 'statut', valeur: m[1], cle: CLES.geste(source, p) }));
  } else if ((m = /^canal ([a-z_]{2,30}) (ouvert|ferme)$/.exec(p))) {
    actes.push(registre.ajouter({ type: 'geste', ...proprio, sujet: 'canal', valeur: `${m[1]}:${m[2]}`, cle: CLES.geste(source, p) }));
  } else if ((m = /^opposition (\d{3} ?\d{3} ?\d{3})$/.exec(p))) {
    opposition = m[1].replace(/ /g, '');
  } else {
    throw refus(`phrase hors grammaire ; formes admises : ${GRAMMAIRE_GESTES.join(' · ')}`);
  }
  const prive = { phrase: p, preuve_empreinte: preuve, source_id: source, date: horloge.iso() };
  if (magasin) {
    const avant = magasin.lire(JOURNAL_GESTES) ?? '';
    magasin.ecrirePrive(JOURNAL_GESTES, `${avant}${avant && !avant.endsWith('\n') ? '\n' : ''}${JSON.stringify(prive)}\n`);
  }
  return { actes, prive, ...(opposition ? { opposition } : {}) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Contexte d'évaluation construit depuis le registre.

/**
 * ctx pour evaluer(), lu dans le registre et politique.json. options : {racine, budget, horloge, oppositions_dispo,
 * notifications_cycle, parseur_sain, cgu_codeur, segments_gagnes}.
 */
export function contexte(registre, { racine, budget = null, horloge = creerHorloge(), oppositions_dispo = false, notifications_cycle = 0,
  parseur_sain, cgu_codeur, segments_gagnes } = {}) {
  const e = registre.etat(), ouvertes = fileOuverte(registre, horloge);
  const gestes = registre.de('geste', (l) => l.auteur === 'proprietaire');
  const canaux = {};
  for (const g of gestes.filter((l) => l.sujet === 'canal')) { const [id, et] = String(g.valeur).split(':'); canaux[id] = et; }
  return {
    politique: racine ? chargerPolitique(racine) : undefined,
    budget,
    etat: {
      encaisse_eur: e.encaisse_eur, depense_eur: e.depense_eur,
      revues_ouvertes_n: ouvertes.filter((r) => r.type === 'proposition').length,
      cycles_sans_geste: cyclesSansGeste(registre).n,
      oppositions_dispo,
      statut_proprietaire: gestes.filter((l) => l.sujet === 'statut').at(-1)?.valeur ?? null,
      canaux, notifications_cycle,
      ...(parseur_sain !== undefined ? { parseur_sain } : {}), ...(cgu_codeur !== undefined ? { cgu_codeur } : {}),
      ...(segments_gagnes !== undefined ? { segments_gagnes } : {}),
    },
  };
}
