// MESURER, APPRENDRE et RÊVER (M10). Les KPI sont calculés depuis le registre et les séries publiques, chacun étiqueté
// « valeur », « goulot » ou « instrument » : être bien calibré avec 0 € n'est pas un succès. Sous le seuil d'effectif,
// un KPI vaut null et s'affiche « inconnu (n=k) », jamais 0. Une prévision n'est résolue que par une lecture réelle
// postérieure à son horizon. Une leçon cite au moins un acte et modifie au moins un objet, sinon elle est refusée ; une
// règle n'est candidate, puis adoptée, qu'après un pari gagné, un test vert (compilation) et un backtest chiffré.
// Le rêve hebdomadaire (dimanche) est un auto-audit sur des données déjà consignées ; un rejeu n'est jamais un résultat.
// Fonctions pures : le cycle (M11) et bin/velyx.js (M12) écrivent etat/kpi.json, etat/audit/<AAAA-Sss>.json,
// etat/regles.json et les actes renvoyés.
import { ISSUES_POSITIVES, ISSUES_ENGAGEMENT } from './contrats.js';
import { creerHorloge, heuresEntre, empreinte, canon, evaluerOp, defautChaine, PLAFONDS } from './socle.js';
import { CLES } from './registre.js';
import { compilerRegle, controlerListe } from './controles.js';
import { verifierObjetPublic } from './garde.js';
import { revuesDe, cyclesSansGeste } from './risque.js';
import { estDemandeCible } from './monde.js';

/** Seuils d'effectif sous lesquels un KPI vaut null (« inconnu (n=k) »). */
export const SEUILS = Object.freeze({ taux: 5, latence: 3, brier: 10, devis_2h: 20 });
/** Tags codeur de la demande cible (K16). */
export const TAGS_CIBLE = Object.freeze(['Prospection commerciale', 'Télémarketing', 'Data entry']);
const JOUR_MS = 864e5;

const K = (nature, unite, source, definition) => Object.freeze({ nature, unite, source, definition });
/** Définitions des KPI (spécification « kpi », K1 à K19 ; K4 publie à part taux_engagement et taux_refus). */
export const KPI_DEFINITIONS = Object.freeze({
  encaisse_eur: K('valeur', 'eur', 'registre/journal.jsonl', 'Somme des actes encaissement du propriétaire : confirmée (github) et déclarée (session). Seul compteur d’argent, jamais additionné à un potentiel.'),
  depense_eur: K('valeur', 'eur', 'registre/journal.jsonl', 'Somme des actes depense. Doit rester à 0 tant que l’encaissé est nul (mandat, ligne 14).'),
  envois: K('valeur', 'n', 'registre/journal.jsonl', 'Nombre d’actes envoi du propriétaire, par canal.'),
  taux_reponse_positive_7j: K('valeur', 'taux', 'registre/journal.jsonl', 'Paris envoyés ayant reçu au plus 7 j après l’envoi une issue devis_demande, echange, commande ou paye, sur les paris envoyés dont l’échéance est passée. Inconnu sous 5.'),
  taux_engagement: K('valeur', 'taux', 'registre/journal.jsonl', 'Comme le taux de réponse positive, « question » comprise. Inconnu sous 5.'),
  taux_refus: K('valeur', 'taux', 'registre/journal.jsonl', 'Paris échus ayant reçu un refus au plus 7 j après l’envoi. Un refus ne compte jamais comme une réponse positive. Inconnu sous 5.'),
  commandes: K('valeur', 'n', 'registre/journal.jsonl', 'Paris ayant reçu une issue commande ou paye.'),
  gestes_en_attente: K('goulot', 'n', 'registre/journal.jsonl', 'Revues ouvertes (préalables, kits, propositions) et âge maximal en heures.'),
  latence_proprietaire_h: K('goulot', 'h', 'registre/journal.jsonl', 'Médiane des heures entre la mise en revue et la validation, le rejet, l’envoi ou le geste qui satisfait un préalable. Inconnue sous 3 éléments.'),
  cycles_sans_geste: K('goulot', 'n', 'registre/journal.jsonl', 'Cycles (jours de Paris ayant au moins un passage) écrits depuis le dernier acte du propriétaire. À 5, nouvelles opportunités gelées (D8).'),
  opportunites_perdues: K('goulot', 'n', 'registre/journal.jsonl', 'Revues devenues caduques avant l’envoi, par cause ; jamais en euros.'),
  exclusions_par_controle: K('instrument', 'n', 'registre/journal.jsonl', 'Fiches exclues ou en quarantaine par code de contrôle et par liste (dernier acte controle). Plus d’exclusions ne veut pas dire plus de qualité.'),
  taux_erreur_echantillon: K('instrument', 'taux', 'registre/journal.jsonl', 'Fiches jugées fausses sur fiches revues (contrôle L3, tirage à graine fixe).'),
  fuites: K('instrument', 'n', 'velyx garde', 'Correspondances de l’antifuite dans le dépôt et etat/. « non mesuré par dictionnaire » si le dictionnaire est vide, jamais 0.'),
  sante_sources: K('instrument', 'taux', 'registre/journal.jsonl', 'Taux de champs nuls du parseur codeur au dernier relevé, avec le nombre d’annonces lues.'),
  cout_cycle: K('instrument', 's', 'registre/journal.jsonl', 'Durée du dernier cycle et requêtes émises, face aux plafonds.'),
  concurrence_a_l_envoi: K('instrument', 'n', 'etat/series', 'Offres de l’annonce liée à la dernière lecture avant l’envoi, puis à envoi + 7 j.'),
  demande_cible_14j: K('instrument', 'n', 'etat/series', 'Annonces publiées depuis 14 j au plus, tag Prospection commerciale, Télémarketing ou Data entry, ou famille « données » (même définition que COMPRENDRE), avec la médiane de leurs offres.'),
  brier_previsions: K('instrument', 'brier', 'registre/journal.jsonl', 'Moyenne de (p − issue)² sur les prévisions résolues par une lecture réelle. Publiée dès 10 ; on peut être bien calibré avec 0 €.'),
  ratio_moteur: K('goulot', 'ratio', 'git log et registre', 'Commits touchant src/ sur 14 j divisés par max(envois sur 14 j, 1). Au-dessus de 5 sans envoi : constat.'),
  cycles_manques: K('instrument', 'n', 'registre/journal.jsonl', 'Jours sans acte cycle sur les 30 derniers jours (depuis la première ligne du registre).'),
});

// ---------------------------------------------------------------------------------------------------------------------
// Utilitaires.

const nombreFr = (v, max = 1) => v.toLocaleString('fr-FR', { maximumFractionDigits: max });
const mediane = (xs) => {
  const s = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const arrondi = (x, n = 4) => (x === null ? null : Math.round(x * 10 ** n) / 10 ** n);
const inconnu = (n) => `inconnu (n=${n})`;
const t = (iso) => Date.parse(iso);
/** Format d'affichage d'une valeur selon son unité. */
export function afficher(valeur, unite) {
  if (valeur === null || valeur === undefined) return 'inconnu';
  if (typeof valeur !== 'number') return String(valeur);
  switch (unite) {
    case 'eur': return `${nombreFr(valeur, 2)} €`;
    case 'taux': return `${nombreFr(valeur * 100, 1)} %`;
    case 'h': return `${nombreFr(valeur, 1)} h`;
    case 's': return `${nombreFr(valeur, 1)} s`;
    case 'brier': return nombreFr(valeur, 3);
    case 'ratio': return nombreFr(valeur, 2);
    default: return nombreFr(valeur, 1);
  }
}
const tronquer = (s, n = 300) => { const c = [...String(s)]; return c.length <= n ? c.join('') : `${c.slice(0, n - 1).join('')}…`; };

// ---------------------------------------------------------------------------------------------------------------------
// Prévisions et score de Brier.

/** Score de Brier (4 décimales) des résolutions {p, issue ∈ {0,1}} ; null si moins de 10. */
export function brier(resolutions) {
  const ok = (resolutions ?? []).filter((r) => typeof r?.p === 'number' && r.p >= 0 && r.p <= 1 && (r.issue === 0 || r.issue === 1));
  if (ok.length < SEUILS.brier) return null;
  return arrondi(ok.reduce((s, r) => s + (r.p - r.issue) ** 2, 0) / ok.length);
}

// Une prévision de strategie.anticiper n'a pas d'id : sa clé (CLES.prevision) l'identifie, comme dans noterPrevisions.
const idPrevision = (l) => (typeof l.id === 'string' && l.id ? l.id : typeof l.cle === 'string' && l.cle ? l.cle : `L${l.n}`);

/**
 * Prévisions du registre et leur résolution. Une prévision {sujet (id d'annonce), mesure, op, seuil, p, horizon_h} n'est
 * résolue que par un point de série réel lu après emise_le + horizon_h. → {resolues: [{prevision, p, issue, source}],
 * nouvelles: idem (pas encore consignées), en_attente: n, echues_sans_lecture: n}
 */
export function resoudrePrevisions(registre, series = [], horloge = creerHorloge()) {
  const maintenant = t(horloge.iso());
  const existantes = new Map(registre.de('resolution').map((l) => [l.prevision, l]));
  const resolues = [], nouvelles = [];
  let en_attente = 0, echues_sans_lecture = 0;
  for (const l of registre.de('prevision')) {
    const id = idPrevision(l), p = l.p;
    if (existantes.has(id)) { resolues.push({ prevision: id, p, issue: existantes.get(id).issue, source: existantes.get(id).source }); continue; }
    const echeance = t(l.emise_le ?? l.date) + Number(l.horizon_h) * 3.6e6;
    if (!Number.isFinite(echeance) || maintenant < echeance) { en_attente++; continue; }
    const sujet = String(l.sujet).replace(/^annonce:/, '');
    const point = (series ?? []).filter((s) => String(s?.id) === sujet && t(s.t) >= echeance).sort((a, b) => t(a.t) - t(b.t))[0];
    if (!point || !Object.hasOwn(point, l.mesure)) { echues_sans_lecture++; continue; }
    let vrai;
    try { vrai = evaluerOp(l.op ?? '==', point[l.mesure], l.seuil); } catch { echues_sans_lecture++; continue; }
    const r = { prevision: id, p, issue: vrai ? 1 : 0, source: `etat/series, lecture du ${point.t}` };
    nouvelles.push(r); resolues.push(r);
  }
  return { resolues, nouvelles, en_attente, echues_sans_lecture };
}

// ---------------------------------------------------------------------------------------------------------------------
// MESURER.

/**
 * KPI réels. entrées : {registre, series: PointSerie[], horloge, git: {commits_src_14j}|null, scan: {ok, fuites?,
 * dictionnaire_vide, n_jetons}|null}. Chaque KPI : {valeur, n, nature, definition, source, date, affichage, detail?}.
 * → {kpi, resolutions: [{prevision, issue, source, p}]} (resolutions : prévisions nouvellement résolues, à consigner).
 */
export function mesurer({ registre, series = [], horloge = creerHorloge(), git = null, scan = null } = {}) {
  if (!registre) throw new Error('mesurer : registre requis');
  const L = registre.lignes, date = horloge.iso(), maintenant = t(date), kpi = {};
  const poser = (nom, valeur, n, { affichage, detail, source } = {}) => {
    const d = KPI_DEFINITIONS[nom];
    kpi[nom] = { valeur, n, nature: d.nature, definition: d.definition, source: source ?? d.source, date,
      affichage: affichage ?? afficher(valeur, d.unite), ...(detail !== undefined ? { detail } : {}) };
  };
  const somme = (ls) => arrondi(ls.reduce((s, l) => s + l.montant_eur, 0), 2);
  const montantOk = (l) => typeof l.montant_eur === 'number' && Number.isFinite(l.montant_eur) && l.montant_eur > 0;

  // K1, K2 : argent. Seuls les actes encaissement du propriétaire comptent ; aucun potentiel (budget affiché, devis, CA).
  const enc = L.filter((l) => l.type === 'encaissement' && l.auteur === 'proprietaire' && montantOk(l));
  const confirme = enc.filter((l) => l.verification === 'github');
  poser('encaisse_eur', somme(enc), enc.length, { detail: { confirmee_eur: somme(confirme), declaree_eur: somme(enc.filter((l) => l.verification !== 'github')) } });
  const dep = L.filter((l) => l.type === 'depense' && montantOk(l)), depense = somme(dep);
  poser('depense_eur', depense, dep.length, { detail: { bloquant: depense > 0 && somme(enc) === 0 } });

  // K3 à K5 : envois et issues.
  const envois = L.filter((l) => l.type === 'envoi' && l.auteur === 'proprietaire');
  const parCanal = {};
  for (const e of envois) parCanal[e.canal ?? 'inconnu'] = (parCanal[e.canal ?? 'inconnu'] ?? 0) + 1;
  poser('envois', envois.length, envois.length, { detail: { par_canal: parCanal } });
  const premier = new Map();
  for (const e of envois) if (!premier.has(e.pari)) premier.set(e.pari, e);
  const reponses = L.filter((l) => l.type === 'reponse');
  let eligibles = 0, positives = 0, engagements = 0, refus = 0;
  for (const [pari, e] of premier) {
    const fin = t(e.date) + 7 * JOUR_MS;
    if (maintenant < fin) continue;                                    // échéance non passée : hors du dénominateur
    eligibles++;
    const issues = reponses.filter((r) => r.pari === pari && t(r.recue_le ?? r.date) <= fin).map((r) => r.issue);
    if (issues.some((i) => ISSUES_POSITIVES.includes(i))) positives++;
    if (issues.some((i) => ISSUES_ENGAGEMENT.includes(i))) engagements++;
    if (issues.includes('refus')) refus++;
  }
  const taux = (nom, x) => (eligibles < SEUILS.taux ? poser(nom, null, eligibles, { affichage: inconnu(eligibles) }) : poser(nom, arrondi(x / eligibles), eligibles));
  taux('taux_reponse_positive_7j', positives);
  taux('taux_engagement', engagements);
  taux('taux_refus', refus);
  const commandes = new Set(reponses.filter((r) => r.issue === 'commande' || r.issue === 'paye').map((r) => r.pari));
  poser('commandes', commandes.size, commandes.size);

  // K6 à K9 : goulots du propriétaire.
  const revues = revuesDe(registre, horloge), ouvertes = revues.filter((r) => r.statut === 'ouverte');
  const genre = (r) => (r.type === 'prealable' ? 'prealables' : r.type === 'kit_canal' ? 'kits' : r.type === 'proposition' ? 'propositions' : 'autres');
  const parGenre = { prealables: 0, kits: 0, propositions: 0, autres: 0 };
  for (const r of ouvertes) parGenre[genre(r)]++;
  const ages = ouvertes.map((r) => r.age_h);
  poser('gestes_en_attente', ouvertes.length, ouvertes.length, { detail: { age_max_h: ages.length ? Math.max(...ages) : null, par_genre: parGenre } });
  const latences = revues.filter((r) => r.decision_le).map((r) => heuresEntre(r.ouverte_le, r.decision_le));
  const enAttente = ouvertes.map((r) => ({ id: r.id, age_h: r.age_h }));
  if (latences.length < SEUILS.latence) poser('latence_proprietaire_h', null, latences.length, { affichage: inconnu(latences.length), detail: { en_attente: enAttente } });
  else poser('latence_proprietaire_h', arrondi(mediane(latences), 1), latences.length, { detail: { en_attente: enAttente } });
  const csg = cyclesSansGeste(registre);
  poser('cycles_sans_geste', csg.n, csg.n, { detail: { dernier_geste: csg.dernier_geste, passages: csg.passages, gel: csg.n >= 5 } });
  // Un préalable satisfait par le geste du propriétaire n'est pas une opportunité perdue : il compte dans la latence.
  const perdues = revues.filter((r) => r.statut === 'caduque' && r.motif_caduque !== 'satisfait'), parCause = {};
  for (const r of perdues) parCause[r.motif_caduque] = (parCause[r.motif_caduque] ?? 0) + 1;
  poser('opportunites_perdues', perdues.length, perdues.length, { detail: { par_cause: parCause } });

  // K10, K11 : contrôles (dernier acte controle par objet ; à défaut, compte.par_controle des actes cible).
  const parListe = {};
  for (const l of L) {
    if (l.type === 'controle' && Array.isArray(l.resultats)) {
      const codes = {};
      for (const r of l.resultats) if (/^G\d+$/.test(r?.code ?? '') && Number.isFinite(r.n_concernes)) codes[r.code] = (codes[r.code] ?? 0) + r.n_concernes;
      if (Object.keys(codes).length) parListe[l.objet] = codes;
    } else if (l.type === 'cible' && l.compte?.par_controle && typeof l.compte.par_controle === 'object' && !parListe[l.recette]) {
      parListe[l.recette] = { ...l.compte.par_controle };
    }
  }
  const totalExclusions = Object.values(parListe).reduce((s, c) => s + Object.values(c).reduce((a, b) => a + (Number(b) || 0), 0), 0);
  poser('exclusions_par_controle', Object.keys(parListe).length ? totalExclusions : null, Object.keys(parListe).length,
    { affichage: Object.keys(parListe).length ? undefined : 'non mesuré', detail: { par_liste: parListe } });
  let fausses = 0, revuesL3 = 0;
  for (const l of L) {
    if (l.type !== 'controle' || !Array.isArray(l.resultats)) continue;
    for (const r of l.resultats) {
      if (r?.code !== 'L3' || !Number.isFinite(r.n_concernes) || /rejet/i.test(r.motif ?? '')) continue;
      fausses += r.n_concernes; revuesL3 += Number.isFinite(r.n_revues) ? r.n_revues : 10;
    }
  }
  poser('taux_erreur_echantillon', revuesL3 ? arrondi(fausses / revuesL3) : null, revuesL3, { affichage: revuesL3 ? undefined : 'non mesuré' });

  // K12 : fuites. Un dictionnaire vide n'est jamais compté comme « 0 fuite ».
  if (!scan) poser('fuites', null, 0, { affichage: 'non mesuré' });
  else {
    const nf = Array.isArray(scan.fuites) ? scan.fuites.length : Number.isFinite(scan.n) ? scan.n : scan.ok ? 0 : null;
    if (scan.dictionnaire_vide) poser('fuites', null, 0, { affichage: 'non mesuré par dictionnaire', detail: { structurel: nf, dictionnaire_vide: true } });
    else poser('fuites', nf, scan.n_jetons ?? 0, { detail: { n_jetons: scan.n_jetons ?? 0 } });
  }

  // K13, K14 : sources et coût (derniers actes).
  const obs = registre.derniere('observation');
  const m = obs?.mesure ?? {};
  const tauxNul = Number.isFinite(m.taux_null) ? m.taux_null : Number.isFinite(m.sante?.taux_null) ? m.sante.taux_null : null;
  poser('sante_sources', tauxNul, Number.isFinite(m.lus) ? m.lus : 0, { affichage: tauxNul === null ? 'non mesuré' : undefined,
    detail: { dernier_releve: obs?.date ?? null, rss_items: m.rss_items ?? m.sante?.rss_items ?? null } });
  const cyc = registre.derniere('cycle');
  poser('cout_cycle', Number.isFinite(cyc?.duree_s) ? cyc.duree_s : null, cyc ? 1 : 0,
    { affichage: cyc ? undefined : 'aucun cycle', detail: { requetes: cyc?.requetes ?? null, jugements: cyc?.jugements ?? null, plafonds: { ...PLAFONDS } } });

  // K15, K16 : séries publiques.
  const pts = Array.isArray(series) ? series.filter((p) => p && p.id !== undefined && Number.isFinite(t(p.t))) : [];
  const annonceDe = (e) => revues.find((r) => r.id === e.revue)?.annonce ?? null;
  const suivis = [];
  for (const e of envois) {
    const a = annonceDe(e);
    if (!a) continue;
    const de = pts.filter((p) => String(p.id) === String(a)).sort((x, y) => t(x.t) - t(y.t));
    const avant = de.filter((p) => t(p.t) <= t(e.date)).at(-1), apres = de.find((p) => t(p.t) >= t(e.date) + 7 * JOUR_MS);
    suivis.push({ pari: e.pari, offres_avant: avant?.offres ?? null, devis_2h_avant: avant?.devis_2h_n ?? null, offres_7j: apres?.offres ?? null });
  }
  poser('concurrence_a_l_envoi', suivis.length ? suivis.filter((s) => s.offres_avant !== null).length : null, suivis.length,
    { affichage: suivis.length ? undefined : 'aucun envoi suivi', detail: { suivis } });
  const derniers = new Map();
  for (const p of pts) if (!derniers.has(p.id) || t(p.t) > t(derniers.get(p.id).t)) derniers.set(p.id, p);
  // Même définition que le fait demande_cible_14j de COMPRENDRE (monde.estDemandeCible) ; un point sans publie_le compte
  // par l'âge lu au relevé (age_h) ; un point ancien sans aucun des deux a un âge inconnu, dit dans detail.
  const iso = new Date(maintenant).toISOString();
  const cibles = [...derniers.values()].filter((p) => estDemandeCible(p, iso));
  const ageInconnu = [...derniers.values()].filter((p) => !Number.isFinite(t(p.publie_le)) && typeof p.age_h !== 'number').length;
  const medOffres = mediane(cibles.map((p) => p.offres));
  poser('demande_cible_14j', pts.length ? cibles.length : null, cibles.length,
    { affichage: pts.length ? undefined : 'non mesuré', source: 'etat/series', detail: { offres_mediane: medOffres, n_offres: cibles.filter((p) => Number.isFinite(p.offres)).length, age_inconnu: ageInconnu } });

  // K17 : Brier sur les seules prévisions résolues par une lecture réelle.
  const prev = resoudrePrevisions(registre, pts, horloge), b = brier(prev.resolues);
  poser('brier_previsions', b, prev.resolues.length, { affichage: b === null ? inconnu(prev.resolues.length) : undefined,
    detail: { non_resolues: prev.en_attente + prev.echues_sans_lecture, echues_sans_lecture: prev.echues_sans_lecture } });

  // K18, K19.
  const envois14 = envois.filter((e) => maintenant - t(e.date) <= 14 * JOUR_MS).length;
  if (!git || !Number.isFinite(git.commits_src_14j)) poser('ratio_moteur', null, 0, { affichage: 'non mesuré', detail: { envois_14j: envois14 } });
  else {
    const r = arrondi(git.commits_src_14j / Math.max(envois14, 1), 2);
    poser('ratio_moteur', r, git.commits_src_14j, { detail: { commits_src_14j: git.commits_src_14j, envois_14j: envois14, constat: r > 5 && envois14 === 0 } });
  }
  const jours = new Set(registre.de('cycle').map((l) => creerHorloge(l.date).jour()));
  const debut = L.length ? t(`${creerHorloge(L[0].date).jour()}T12:00:00Z`) : maintenant;
  let consideres = 0, manques = 0;
  for (let i = 0; i < 30; i++) {
    const j = creerHorloge(new Date(maintenant - i * JOUR_MS).toISOString()).jour();
    if (t(`${j}T12:00:00Z`) < debut) break;
    consideres++;
    if (!jours.has(j)) manques++;
  }
  poser('cycles_manques', manques, consideres);

  return { kpi, resolutions: prev.nouvelles };
}

// ---------------------------------------------------------------------------------------------------------------------
// APPRENDRE.

/** Objets qu'une leçon peut modifier. */
export const OBJETS_LECON = Object.freeze(['regle', 'recette', 'croyance', 'canal']);

/**
 * Une leçon proposée : {texte, actes: number[] (lignes du registre citées), modifie: {objet ∈ OBJETS_LECON, id, champ, de, vers},
 * pari?, regle?}. Refusée sans acte source existant, ou si elle ne modifie rien (de = vers), ou si son texte contient du
 * code, une URL ou (avec dict) une donnée nominative. → {ok, motif}
 */
export function validerLecon(lecon, registre, { dict = null } = {}) {
  const ko = (motif) => ({ ok: false, motif });
  if (!lecon || typeof lecon !== 'object') return ko('leçon : objet attendu');
  if (typeof lecon.texte !== 'string' || lecon.texte.trim().length < 10 || [...lecon.texte].length > 400) return ko('texte de 10 à 400 caractères attendu');
  const d = defautChaine(lecon.texte);
  if (d) return ko(`texte refusé : ${d}`);
  const n = registre.lignes.length;
  if (!Array.isArray(lecon.actes) || !lecon.actes.length) return ko('une leçon cite au moins un acte du registre');
  if (lecon.actes.some((x) => !Number.isInteger(x) || x < 1 || x > n)) return ko('acte cité absent du registre');
  const mo = lecon.modifie;
  if (!mo || typeof mo !== 'object') return ko('une leçon modifie au moins un objet (règle, recette, croyance ou canal)');
  if (!OBJETS_LECON.includes(mo.objet)) return ko(`objet modifié « ${mo.objet} » hors de ${OBJETS_LECON.join(', ')}`);
  if (typeof mo.id !== 'string' || !mo.id || mo.id.length > 60) return ko('identifiant de l’objet modifié attendu');
  if (typeof mo.champ !== 'string' || !mo.champ || mo.champ.length > 60) return ko('champ modifié attendu');
  if (canon(mo.de ?? null) === canon(mo.vers ?? null)) return ko('la leçon ne modifie rien (de = vers)');
  if (dict) {
    const v = verifierObjetPublic({ texte: lecon.texte, modifie: mo }, dict);
    if (!v.ok) return ko(`antifuite : ${v.motifs.join(', ')}`);
  }
  return { ok: true, motif: null };
}

const pariGagne = (registre, id) => typeof id === 'string' && registre.etat().paris.some((p) => p.id === id && p.statut === 'gagne');

/**
 * Leçons et règles candidates. entrées : {registre, propositions: leçons proposées (jugement LLM ou moteur), paris_clos,
 * kpi, controles, confrontation, dict}. Une règle (proposition.regle, objet 'regle') n'est candidate qu'après un pari gagné
 * (proposition.pari) et si elle compile (opérateur connu, champ de la liste fermée).
 * → {lecons: actes « lecon » à consigner, regles_candidates, refusees: [{index, motif}], dues: ids de paris clos sans leçon}
 */
export function apprendre({ registre, propositions = [], paris_clos = null, dict = null } = {}) {
  if (!registre) throw new Error('apprendre : registre requis');
  const lecons = [], regles_candidates = [], refusees = [];
  propositions.forEach((p, index) => {
    const v = validerLecon(p, registre, { dict });
    if (!v.ok) { refusees.push({ index, motif: v.motif }); return; }
    if (p.modifie.objet === 'regle' || p.regle !== undefined) {
      if (!pariGagne(registre, p.pari)) { refusees.push({ index, motif: 'une règle n’est candidate qu’après un pari gagné' }); return; }
      try { compilerRegle(p.regle); } catch (e) { refusees.push({ index, motif: e.message }); return; }
      regles_candidates.push({ ...p.regle, statut: 'candidate', preuves: [...p.actes] });
    }
    const corps = { texte: p.texte.trim(), actes: [...p.actes], modifie: p.modifie, ...(p.pari ? { pari: p.pari } : {}) };
    lecons.push({ type: 'lecon', ...corps, source: `registre, lignes ${p.actes.join(', ')}`, cle: `lecon:${empreinte(corps)}` });
  });
  const clos = paris_clos ?? registre.etat().paris.filter((x) => ['gagne', 'perdu', 'caduc'].includes(x.statut)).map((x) => x.id);
  const avecLecon = new Set(registre.de('lecon').map((l) => l.pari).filter(Boolean));
  for (const l of lecons) if (l.pari) avecLecon.add(l.pari);
  return { lecons, regles_candidates, refusees, dues: clos.filter((id) => !avecLecon.has(id)) };
}

/**
 * Backtest chiffré d'une règle déclarative sur les listes privées ({[id]: Entreprise[]}). Ne rend que des comptes.
 * → {exclues (fiches touchées), effet, par_liste: {[id]: {lues, touchees}}}
 */
export function backtest(regle, listes) {
  const f = compilerRegle(regle), par_liste = {};
  let exclues = 0;
  for (const [id, fiches] of Object.entries(listes ?? {})) {
    const fs = Array.isArray(fiches) ? fiches : [];
    const touchees = fs.filter((e) => f(e).touche).length;
    par_liste[id] = { lues: fs.length, touchees };
    exclues += touchees;
  }
  return { exclues, effet: regle.effet, par_liste };
}

/**
 * Adopte une règle : test vert (elle compile), backtest chiffré (au moins une liste), pari gagné cité. Lève sinon.
 * → {regles: RegleDeclarative[] (contenu de etat/regles.json), acte: acte « regle » à consigner}
 */
export function adopter(regle, bt, { regles_actuelles = [], registre, pari, horloge = creerHorloge() } = {}) {
  compilerRegle(regle);
  if (!bt || !Number.isFinite(bt.exclues) || !bt.par_liste || !Object.keys(bt.par_liste).length) throw new Error('adopter : backtest chiffré requis (au moins une liste)');
  if (!registre || !pariGagne(registre, pari)) throw new Error('adopter : une règle n’est adoptée qu’après un pari gagné, cité par son id');
  const adoptee = { ...regle, statut: 'adoptee', adoptee_le: horloge.jour() };
  const regles = [...(regles_actuelles ?? []).filter((r) => r?.code !== regle.code), adoptee];
  const par_liste = Object.fromEntries(Object.entries(bt.par_liste).map(([k, v]) => [k, { lues: v.lues, touchees: v.touchees }]));
  const acte = { type: 'regle', code: regle.code, definition: `${regle.champ} ${regle.op} ${JSON.stringify(regle.valeur ?? null)} → ${regle.effet}`,
    backtest: { exclues: bt.exclues, par_liste }, pari, cle: `regle:${regle.code}:${empreinte(regle)}` };
  return { regles, acte };
}

// ---------------------------------------------------------------------------------------------------------------------
// RÊVER : auto-audit hebdomadaire sur des données déjà consignées.

/** Affirmations publiques déjà réfutées au registre (une ligne doit contenir l'énoncé et, s'il est donné, le contexte). */
export const REFUTATIONS_CONNUES = Object.freeze([
  Object.freeze({ croyance: 'B01', enonce: 'inscription gratuite', contexte: 'codeur', preuves: Object.freeze([13]),
    motif: 'répondre sur codeur.com exige un abonnement d’au moins 31,90 € HT par 30 jours (page tarifs lue le 15/11/2026)' }),
]);

const plat = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const constat = (code, gravite, texte, preuves = []) => ({ code, gravite, texte: tronquer(texte), preuves: [...new Set(preuves)].filter(Number.isInteger) });
const formes = (v) => {
  const s = String(v);
  if (!/^\d+$/.test(s)) return [s];
  const g = s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return [...new Set([s, g, g.replace(/ /g, ' '), g.replace(/ /g, ' '), g.replace(/ /g, '.')])];
};
// Nombre isolé : ni chiffre collé, ni « chiffre + séparateur » avant ou après (« 21 119 » ne contient pas « 1 119 »).
const contientNombre = (texte, v) => formes(v).some((f) => new RegExp(`(?<!\\d)(?<!\\d[.,\\u00a0\\u202f ])${f.replace(/[.]/g, '\\.')}(?!\\d)(?![.,\\u00a0\\u202f ]\\d)`).test(texte));
const CHAMPS_COMPTE = ['lues', 'retenues', 'completes', 'avec_signal', 'total_registre'];

/** Audits du rêve : chacun (entree) → Constat[]. Un rejeu n'est jamais présenté comme un résultat. */
export const AUDITS = Object.freeze({
  chaine({ registre }) {
    const v = registre.verifier();
    return v.ok ? [constat('chaine', 'info', `registre : chaîne intacte sur ${v.lignes} lignes (velyx verifier)`)]
      : [constat('chaine_cassee', 'bloquant', `registre : chaîne cassée à la ligne ${v.ligne} (${v.motif}) ; réparer avant tout acte`, [v.ligne])];
  },
  fuites({ scan }) {
    if (!scan) return [constat('fuites_non_mesurees', 'alerte', 'antifuite non lancée cette semaine (velyx garde) : fuites non mesurées')];
    const n = Array.isArray(scan.fuites) ? scan.fuites.length : scan.ok ? 0 : 1;
    if (!scan.ok) return [constat('fuite', 'bloquant', `antifuite : ${n} correspondance(s) dans le dépôt ou etat/ ; push bloqué jusqu’à correction`)];
    if (scan.dictionnaire_vide) return [constat('fuites_non_mesurees', 'alerte', 'antifuite : dictionnaire vide, seul le scan structurel a porté (non mesuré par dictionnaire, jamais « 0 fuite »)')];
    return [constat('fuites', 'info', `antifuite : 0 correspondance, dictionnaire de ${scan.n_jetons ?? 0} jetons`)];
  },
  chiffres_publics({ registre, faits = [], textes_publics = {} }) {
    // Séries de valeurs par (sujet, mesure) : comptes des actes cible, puis faits datés. La dernière fait foi.
    const series = new Map();
    const pousser = (cle, valeur, date, n) => { if (!Number.isFinite(valeur)) return; if (!series.has(cle)) series.set(cle, []); series.get(cle).push({ valeur, date, n }); };
    for (const l of registre.lignes) {
      if (l.type === 'cible' && l.compte) for (const c of CHAMPS_COMPTE) pousser(`${l.recette}.${c}`, l.compte[c], l.date, l.n);
      if (l.type === 'controle' && l.compte && typeof l.objet === 'string') for (const c of CHAMPS_COMPTE) pousser(`${l.objet}.${c}`, l.compte[c], l.date, l.n);
      if (l.type === 'fait') pousser(`${l.sujet}.${l.mesure}`, l.valeur, l.date, l.n);
    }
    for (const f of faits ?? []) pousser(`${f.sujet}.${f.mesure}`, f.valeur, f.lu_le ?? f.date, f.n_ligne);
    const out = [];
    for (const [cle, vs] of series) {
      const tri = [...vs].sort((a, b) => t(a.date) - t(b.date)), actuel = tri.at(-1);
      for (const ancien of new Set(tri.slice(0, -1).map((x) => x.valeur).filter((v) => v !== actuel.valeur && v >= 100))) {
        for (const [chemin, texte] of Object.entries(textes_publics ?? {})) {
          if (!contientNombre(String(texte), ancien) || contientNombre(String(texte), actuel.valeur)) continue;
          out.push(constat('chiffre_public_obsolete', 'alerte',
            `${chemin} affiche ${ancien} pour ${cle}, la dernière valeur consignée est ${actuel.valeur} (${String(actuel.date).slice(0, 10)}) : corriger par PR`,
            [...tri.filter((x) => x.valeur === ancien).map((x) => x.n), actuel.n]));
        }
      }
    }
    return out;
  },
  affirmations_refutees({ monde = null, textes_publics = {} }) {
    const enonces = [...REFUTATIONS_CONNUES];
    for (const c of monde?.croyances ?? []) {
      for (const e of Array.isArray(c?.refute) ? c.refute : []) if (typeof e === 'string' && e.length >= 6) enonces.push({ croyance: c.id, enonce: e, contexte: null, preuves: c.preuves ?? [] });
      if (c?.niveau === 'refutee' && typeof c.enonce === 'string' && c.enonce.length >= 6 && c.enonce.length <= 120) enonces.push({ croyance: c.id, enonce: c.enonce, contexte: null, preuves: c.preuves ?? [] });
    }
    const out = [];
    for (const [chemin, texte] of Object.entries(textes_publics ?? {})) {
      String(texte).split('\n').forEach((ligne, i) => {
        const p = plat(ligne);
        for (const r of enonces) {
          if (!p.includes(plat(r.enonce)) || (r.contexte && !p.includes(plat(r.contexte)))) continue;
          out.push(constat('affirmation_refutee', 'alerte', `${chemin}, ligne ${i + 1} : « ${r.enonce} » est contredit par ${r.croyance}${r.motif ? ` (${r.motif})` : ''}`, r.preuves));
        }
      });
    }
    return out;
  },
  croyances_rassises({ monde = null, horloge }) {
    const maintenant = t(horloge.iso());
    const rassises = (monde?.croyances ?? []).filter((c) => c && typeof c.id === 'string' && c.niveau !== 'refutee'
      && (!c.revisee_le || maintenant - t(c.revisee_le) > 14 * JOUR_MS));
    return rassises.length ? [constat('croyances_rassises', 'info', `${rassises.length} croyance(s) non révisée(s) depuis 14 j : ${rassises.map((c) => c.id).join(', ')}`)] : [];
  },
  goulot({ registre }) {
    const c = cyclesSansGeste(registre);
    return c.n >= 5 ? [constat('goulot', 'alerte', `${c.n} cycles sans geste du propriétaire : nouvelles opportunités gelées (D8), veille seule`, c.ligne ? [c.ligne] : [])] : [];
  },
  moteur({ registre, kpi = null, horloge }) {
    const out = [], c = cyclesSansGeste(registre);
    const jours = c.dernier_geste ? (t(horloge.iso()) - t(c.dernier_geste)) / JOUR_MS : null;
    if (jours === null || jours >= 7) {
      out.push(constat('moteur_sans_client', 'alerte', jours === null ? 'moteur sans client : aucun geste du propriétaire au registre'
        : `moteur sans client : ${Math.floor(jours)} jours sans geste du propriétaire (dernier acte ligne ${c.ligne})`, c.ligne ? [c.ligne] : []));
    }
    const r = kpi?.ratio_moteur;
    if (r?.detail?.constat) out.push(constat('moteur', 'alerte', `ratio moteur ${r.valeur} : ${r.detail.commits_src_14j} commits sur src/ en 14 j pour 0 envoi`));
    return out;
  },
  rejeu_controles({ registre, listes = {}, recettes = {}, regles = [], oppositions = null, horloge }) {
    const out = [];
    for (const [id, fiches] of Object.entries(listes ?? {})) {
      const fs = Array.isArray(fiches) ? fiches : [];
      const opposees = fs.filter((e) => e?.opposition === true || oppositions?.has?.(String(e?.siren)));
      if (opposees.length) out.push(constat('opposition_dans_liste', 'bloquant', `liste privée ${id} : ${opposees.length} fiche(s) opposée(s) à la prospection encore présentes (R-12) ; purger avant tout usage`));
      let r;
      try { r = controlerListe(fs, {}, recettes?.[id] ?? {}, { horloge, oppositions: oppositions ?? undefined, regles }); } catch (e) {
        out.push(constat('rejeu_impossible', 'alerte', `rejeu des contrôles impossible sur ${id} : ${e.message}`));
        continue;
      }
      const ref = registre.derniere('controle', (l) => l.objet === id && Number.isFinite(l.compte?.retenues)) ?? registre.derniere('cible', (l) => l.recette === id && Number.isFinite(l.compte?.retenues));
      if (!ref) { out.push(constat('rejeu_controles', 'info', `rejeu (pas un résultat) sur ${id} : ${r.compte.retenues} retenues sur ${r.compte.lues}, aucun compte consigné à comparer`)); continue; }
      if (ref.compte.retenues !== r.compte.retenues) {
        out.push(constat('rejeu_ecart', 'alerte', `rejeu (pas un résultat) sur ${id} : ${r.compte.retenues} retenues aujourd’hui contre ${ref.compte.retenues} consignées ligne ${ref.n} ; tout chiffre public issu de cette ligne est à revoir`, [ref.n]));
      } else out.push(constat('rejeu_controles', 'info', `rejeu (pas un résultat) sur ${id} : conforme à la ligne ${ref.n} (${r.compte.retenues} retenues)`, [ref.n]));
    }
    return out;
  },
  previsions({ registre, series = [], horloge }) {
    const p = resoudrePrevisions(registre, series, horloge), out = [];
    if (p.echues_sans_lecture) out.push(constat('previsions_non_notees', 'alerte', `${p.echues_sans_lecture} prévision(s) échue(s) sans lecture réelle après l’horizon : non notées, jamais devinées`));
    const b = brier(p.resolues);
    out.push(constat('previsions', 'info', b === null ? `calibration : ${p.resolues.length} prévision(s) notée(s), Brier publié dès 10` : `calibration : Brier ${b} sur ${p.resolues.length} prévisions notées (instrument)`));
    return out;
  },
  budget({ registre, horloge }) {
    const e = registre.etat(), out = [];
    if (e.depense_eur > 0 && e.encaisse_eur <= 0) {
      out.push(constat('depense_sans_encaissement', 'bloquant', `${e.depense_eur} € dépensés pour 0 € encaissé : contraire au mandat du 15/11/2026 (ligne 14)`,
        [...registre.de('depense').map((l) => l.n), registre.derniere('mandat')?.n]));
    }
    const depuis = t(horloge.iso()) - 7 * JOUR_MS;
    const depasses = registre.de('cycle', (l) => t(l.date) >= depuis && l.requetes && ((l.requetes.codeur ?? 0) > PLAFONDS.codeur || (l.requetes.sirene ?? 0) > PLAFONDS.sirene || (l.duree_s ?? 0) > PLAFONDS.duree_s));
    if (depasses.length) out.push(constat('budget_depasse', 'alerte', `${depasses.length} cycle(s) au-delà des plafonds en 7 j`, depasses.map((l) => l.n)));
    return out;
  },
  canal({ canaux = null }) {
    const liste = Object.entries(canaux ?? {}).filter(([, c]) => c && typeof c === 'object');
    if (!liste.length) return [];
    const out = [];
    for (const [id, c] of liste) if (c.statut === 'ouvert' && c.cgu !== 'lue_compatible') out.push(constat('canal_cgu', 'alerte', `canal ${id} ouvert sans CGU lues et compatibles (cgu : ${c.cgu ?? 'inconnue'})`, c.preuves ?? []));
    if (!liste.some(([, c]) => c.statut === 'ouvert')) out.push(constat('aucun_canal_ouvert', 'alerte', 'aucun canal d’envoi ouvert : aucune proposition ne peut partir (geste « canal <id> ouvert » attendu)'));
    return out;
  },
  memoire({ oppositions_dispo }) {
    return oppositions_dispo === false ? [constat('oppositions_indisponibles', 'bloquant', 'mémoire des oppositions indisponible : aucune liste ni aucun échantillon tant qu’elle n’est pas restaurée (R-14)')] : [];
  },
});

/** Vrai le dimanche (jour de Paris) : le rêve est hebdomadaire. */
export const estJourDeReve = (horloge = creerHorloge()) => horloge.jourSemaine() === 0;

/**
 * Rêve hebdomadaire : tous les AUDITS sur des données réelles déjà consignées. entrées : {registre, monde, kpi,
 * textes_publics: {[chemin]: texte}, faits, listes: {[id]: Entreprise[]}, recettes, regles, canaux, series, horloge, scan,
 * oppositions, oppositions_dispo}. → {constats: Constat[], propositions: Action[]} ; les propositions entrent dans
 * decider au cycle suivant (une notification au plus).
 */
export function rever(entree = {}) {
  if (!entree.registre) throw new Error('rever : registre requis');
  const e = { ...entree, horloge: entree.horloge ?? creerHorloge() };
  const constats = [];
  for (const [nom, audit] of Object.entries(AUDITS)) {
    try { constats.push(...audit(e)); } catch (err) { constats.push(constat('audit_impossible', 'alerte', `audit ${nom} impossible : ${err.message}`)); }
  }
  const ordre = { bloquant: 0, alerte: 1, info: 2 };
  constats.sort((a, b) => ordre[a.gravite] - ordre[b.gravite]);
  const semaine = e.horloge.semaine(), propositions = [];
  const graves = constats.filter((c) => c.gravite !== 'info');
  if (graves.length) {
    const codes = [...new Set(graves.map((c) => c.code))];
    const texte = tronquer(`Audit ${semaine} : ${graves.filter((c) => c.gravite === 'bloquant').length} bloquant(s), ${graves.filter((c) => c.gravite === 'alerte').length} alerte(s) — ${codes.join(', ')}.`, 300);
    const corps = { type: 'notifier', ref: `audit:${semaine}`, params: { texte } };
    propositions.push({ id: `A-${semaine}-rever-1`, ...corps, raison: tronquer(`constats du rêve : ${codes.join(', ')}`, 200), cle: empreinte(corps), jugement: null });
  }
  return { constats, propositions };
}

/** Acte « audit » de la semaine (codes et gravités seulement) et contenu public de etat/audit/<AAAA-Sss>.json. */
export function acteAudit(constats, horloge = creerHorloge()) {
  const semaine = horloge.semaine();
  const resume = constats.map((c) => ({ code: c.code, gravite: c.gravite }));
  return {
    acte: { type: 'audit', semaine, constats: resume, cle: CLES.audit(semaine) },
    chemin: `etat/audit/${semaine}.json`,
    contenu: { semaine, date: horloge.iso(), constats: constats.map((c) => ({ code: c.code, gravite: c.gravite, texte: c.texte, preuves: c.preuves })) },
  };
}
