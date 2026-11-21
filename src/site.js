// Page de preuve de VELYX (M10, restitution). Une page statique unique, générée depuis les seuls fichiers publics de
// etat/ : ni script, ni formulaire, ni traceur, ni ressource externe ; thème clair et sombre ; lisible sur téléphone.
// Chaque nombre porte data-source (acte ou fichier) et data-date ; un nombre sans source datée n'est pas affiché.
// Tant qu'elle n'est pas validée par le propriétaire (empreinte exacte du HTML, R-25), elle n'existe que dans
// prive/site/index.html : ce module n'écrit nulle part ailleurs. Ce n'est pas un canal d'acquisition, c'est une pièce
// de preuve ; elle ne promet ni rendez-vous, ni chiffre d'affaires, ni prix, ni exhaustivité.
import { sha256Texte } from './socle.js';
import { scannerTexte } from './garde.js';

/** Seul emplacement où la page est écrite avant validation. */
export const CHEMIN_SITE_PRIVE = 'prive/site/index.html';
/** Fichiers publics lus (tous sous etat/). */
export const SOURCES_ETAT = Object.freeze({ kpi: 'etat/kpi.json', monde: 'etat/monde.json', marche_hebdo: 'etat/marche-hebdo.json',
  controles: 'etat/controles.json', paris: 'etat/paris.json', rgpd: 'etat/rgpd.json', canaux: 'etat/canaux.json' });
/** Contrôles de fiche montrés sur la page, avec leur libellé. */
export const GARDE_FOUS = Object.freeze([['G4', 'opposées à la prospection'], ['G2', 'comptes de plus de trois ans'], ['G1', 'holdings probables'],
  ['G3', 'filiales de groupes'], ['G9', 'entreprises fermées']]);
const ISSUES_AFFICHEES = Object.freeze([['sans_reponse', 'sans réponse'], ['refus', 'refus'], ['question', 'question'], ['devis_demande', 'devis demandé'],
  ['echange', 'échange'], ['commande', 'commande'], ['paye', 'payé']]);
const NATURES = Object.freeze({ valeur: 'valeur', goulot: 'goulot', instrument: 'instrument' });

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
// Mention d'un domaine sans lien : schéma et « www. » retirés (aucune URL dans la page).
const sansUrl = (s) => String(s ?? '').replace(/\b[a-z][a-z0-9+.-]*:\/\//gi, '').replace(/\bwww\./gi, '');
const nombreFr = (v, max = 1) => v.toLocaleString('fr-FR', { maximumFractionDigits: max });

function format(valeur, unite) {
  switch (unite) {
    case 'eur': return `${nombreFr(valeur, 2)} €`;
    case 'taux': return `${nombreFr(valeur * 100, 1)} %`;
    case 'h': return `${nombreFr(valeur, 1)} h`;
    case 'jours': return `${nombreFr(valeur, 0)} jours`;
    case 'brier': return nombreFr(valeur, 3);
    default: return nombreFr(valeur, 1);
  }
}

/**
 * Construit la page. etatPublic : {kpi, monde, marche_hebdo, controles, paris, rgpd, canaux} (objets de etat/).
 * options : {jour (date de génération, obligatoire), mentions_legales, contact_opposition} (fournis par le propriétaire ;
 * absents, la page dit qu'ils manquent : condition bloquante de mise en ligne).
 * → {html, empreinte (hex16 du HTML), chiffres: [{id, valeur, source, date}], ecartes: ids des nombres sans source datée}
 */
export function construireSite(etatPublic = {}, { jour, mentions_legales = null, contact_opposition = null } = {}) {
  if (typeof jour !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(jour)) throw new Error('construireSite : jour AAAA-MM-JJ requis (la page est datée, jamais l’horloge implicite)');
  const chiffres = [], ecartes = [];
  const n = (id, valeur, source, date, unite) => {
    if (typeof valeur !== 'number' || !Number.isFinite(valeur) || typeof source !== 'string' || !source || typeof date !== 'string' || !date) {
      ecartes.push(id);
      return '<span class="nd">non sourcé</span>';
    }
    chiffres.push({ id, valeur, source, date });
    return `<data value="${esc(valeur)}" data-id="${esc(id)}" data-source="${esc(source)}" data-date="${esc(date)}">${esc(format(valeur, unite))}</data>`;
  };
  // Un texte de etat/ qui contient un chiffre est daté et sourcé comme un nombre.
  const txt = (s, source, date) => {
    const v = esc(sansUrl(s));
    return /\d/.test(v) ? `<span data-source="${esc(source ?? 'etat/')}" data-date="${esc(date ?? jour)}">${v}</span>` : v;
  };
  const kpi = etatPublic.kpi && typeof etatPublic.kpi === 'object' ? etatPublic.kpi : {};
  const k = (nom, unite, id = nom) => {
    const x = kpi[nom];
    if (!x) return '<span class="nd">non mesuré</span>';
    if (x.valeur === null || x.valeur === undefined) {
      const base = /par dictionnaire/.test(x.affichage ?? '') ? 'non mesuré par dictionnaire' : /^non mesur/.test(x.affichage ?? '') ? 'non mesuré' : 'inconnu';
      return Number.isFinite(x.n) && base === 'inconnu' ? `inconnu (n=${n(`${id}.n`, x.n, x.source, x.date, 'n')})` : base;
    }
    return n(id, x.valeur, x.source, x.date, unite);
  };
  const nature = (nom) => (kpi[nom]?.nature ? ` <span class="nat">${esc(NATURES[kpi[nom].nature] ?? kpi[nom].nature)}</span>` : '');
  const date = `<time datetime="${esc(jour)}" data-source="génération de la page" data-date="${esc(jour)}">${esc(jour.split('-').reverse().join('/'))}</time>`;
  const sections = [];

  // 1. Méthode.
  sections.push(`<section><h2>La méthode</h2><p>Construire, avant de répondre, la preuve qu’on sait répondre, à partir du registre officiel des entreprises.</p></section>`);

  // 2. Baromètre de la demande lue sur codeur.com.
  const hebdo = Array.isArray(etatPublic.marche_hebdo) ? etatPublic.marche_hebdo : Array.isArray(etatPublic.marche_hebdo?.semaines) ? etatPublic.marche_hebdo.semaines : [];
  let barometre;
  if (hebdo.length) {
    const lignes = hebdo.map((s, i) => {
      const part = Number.isFinite(s.n) && s.n >= 20 && Number.isFinite(s.part_devis_2h) ? n(`marche.${i}.part_devis_2h`, s.part_devis_2h, s.source, s.date, 'taux') : 'inconnu (moins de vingt annonces suivies)';
      return `<tr><td>${txt(s.semaine, s.source, s.date)}</td><td>${n(`marche.${i}.demandes`, s.demandes, s.source, s.date, 'n')}</td><td>${n(`marche.${i}.offres_mediane`, s.offres_mediane, s.source, s.date, 'n')}</td><td>${part}</td></tr>`;
    }).join('');
    barometre = `<table><thead><tr><th>Semaine</th><th>Demandes de prospection et de données</th><th>Médiane des offres</th><th>Part des devis en moins de deux heures</th></tr></thead><tbody>${lignes}</tbody></table>`;
  } else {
    const d = kpi.demande_cible_14j;
    barometre = `<p>Demandes de prospection, de télémarketing et de saisie de données publiées depuis quatorze jours : ${k('demande_cible_14j', 'n')}${d?.detail?.offres_mediane !== undefined && d?.detail?.offres_mediane !== null
      ? ` ; médiane des offres : ${n('demande_cible_14j.offres_mediane', d.detail.offres_mediane, d.source, d.date, 'n')}` : ''}.${nature('demande_cible_14j')}</p>`;
  }
  sections.push(`<section><h2>Le baromètre de la demande</h2><p>Annonces publiques lues sur codeur.com, sans aucun nom de client.</p>${barometre}</section>`);

  // 3. Garde-fous : ce qu'ils ont écarté, en comptes par liste.
  const parListe = etatPublic.controles?.par_liste ?? kpi.exclusions_par_controle?.detail?.par_liste ?? null;
  let garde;
  if (parListe && typeof parListe === 'object' && Object.keys(parListe).length) {
    const src = etatPublic.controles?.source ?? kpi.exclusions_par_controle?.source, dt = etatPublic.controles?.date ?? kpi.exclusions_par_controle?.date;
    const lignes = Object.entries(parListe).sort(([a], [b]) => a.localeCompare(b)).map(([liste, c]) => {
      const codes = c?.par_controle ?? c ?? {};
      return `<tr><td>${txt(liste, src, dt)}</td>${GARDE_FOUS.map(([code]) => `<td>${n(`controles.${liste}.${code}`, Number(codes[code] ?? 0), c?.source ?? src, c?.date ?? dt, 'n')}</td>`).join('')}</tr>`;
    }).join('');
    garde = `<table><thead><tr><th>Liste</th>${GARDE_FOUS.map(([, l]) => `<th>${esc(l)}</th>`).join('')}</tr></thead><tbody>${lignes}</tbody></table>`;
  } else garde = '<p>Aucun contrôle de liste publié.</p>';
  sections.push(`<section><h2>Les garde-fous et ce qu’ils ont écarté</h2><p>Plus d’exclusions ne veut pas dire plus de qualité : ce sont des comptes, pas un score.</p>${garde}</section>`);

  // 4. Le registre public : propositions par canal, issues, aveux, euros encaissés tels quels.
  const p = etatPublic.paris ?? {};
  const pSrc = p.source ?? kpi.envois?.source, pDate = p.date ?? kpi.envois?.date;
  const parCanal = p.par_canal ?? kpi.envois?.detail?.par_canal ?? {};
  const canaux = Object.entries(parCanal).sort(([a], [b]) => a.localeCompare(b))
    .map(([c, v]) => `<li>${txt(c.replace(/^canal_/, ''), pSrc, pDate)} : ${n(`envois.${c}`, typeof v === 'number' ? v : v?.envoyes, pSrc, pDate, 'n')}</li>`).join('');
  const issues = p.par_issue ? `<ul>${ISSUES_AFFICHEES.map(([cle, l]) => `<li>${esc(l)} : ${n(`issues.${cle}`, Number(p.par_issue[cle] ?? 0), pSrc, pDate, 'n')}</li>`).join('')}</ul>` : '';
  const aveux = Number.isFinite(p.aveux) ? `<p>Échecs et aveux consignés : ${n('aveux', p.aveux, pSrc, pDate, 'n')}.</p>` : '';
  sections.push(`<section><h2>Le registre public</h2>
<p>Argent encaissé, tel quel : ${k('encaisse_eur', 'eur')}${nature('encaisse_eur')}. Dépensé : ${k('depense_eur', 'eur')}.</p>
<p>Propositions envoyées par le propriétaire : ${k('envois', 'n')}.</p>${canaux ? `<ul>${canaux}</ul>` : ''}${issues}${aveux}
<p>Taux de réponse positive à sept jours : ${k('taux_reponse_positive_7j', 'taux')}${nature('taux_reponse_positive_7j')}. Un refus ne compte jamais comme une réponse.</p>
<p>La chaîne du registre se vérifie avec <code>node bin/velyx.js verifier</code>.</p></section>`);

  // 5. Calibration des prévisions.
  sections.push(`<section><h2>La calibration des prévisions</h2><p>Score de Brier : ${k('brier_previsions', 'brier')}${nature('brier_previsions') || ' <span class="nat">instrument</span>'}. Publié à partir de dix prévisions résolues par une lecture réelle ; être bien calibré n’est pas un succès commercial.</p></section>`);

  // 6. Politique de données.
  const rgpd = etatPublic.rgpd && typeof etatPublic.rgpd === 'object' ? etatPublic.rgpd : {};
  const rSrc = SOURCES_ETAT.rgpd, rDate = rgpd.date ?? jour;
  const sources = Array.isArray(rgpd.sources) ? rgpd.sources.map((s) => `<li>${txt(s, rSrc, rDate)}</li>`).join('') : '';
  const contact = contact_opposition ? `<p>Pour exercer le droit d’opposition : <span class="contact">${esc(contact_opposition)}</span>.</p>`
    : '<p class="manque">Adresse d’opposition à désigner par le propriétaire (condition de mise en ligne).</p>';
  sections.push(`<section><h2>La politique de données</h2><ul>
<li>Finalité : ${txt(rgpd.finalite ?? 'prospection entre entreprises sur demande publiée', rSrc, rDate)}.</li>
<li>Base légale : ${txt(rgpd.base_legale ?? 'à documenter par le propriétaire', rSrc, rDate)}.</li>
<li>Minimisation : aucun nom de dirigeant ni numéro d’entreprise individuelle dans ce qui est montré ; âge en tranche seulement ; agrégats géographiques au département, masqués sous cinq.</li>
<li>Conservation : ${Number.isFinite(rgpd.conservation_jours) ? n('rgpd.conservation_jours', rgpd.conservation_jours, rSrc, rDate, 'jours') : '<span class="nd">non publiée</span>'} sans pari ouvert.</li>
<li>Oppositions reçues et appliquées : ${Number.isFinite(rgpd.n_oppositions) ? n('rgpd.n_oppositions', rgpd.n_oppositions, rSrc, rDate, 'n') : '<span class="nd">non publié</span>'}.</li>
</ul>${sources ? `<p>Sources :</p><ul>${sources}</ul>` : ''}${contact}</section>`);

  // Ce que la page ne promet pas.
  sections.push(`<section><h2>Ce que cette page ne promet pas</h2><ul>
<li>Aucun rendez-vous, chiffre d’affaires, taux de conversion ni délai.</li>
<li>Aucune exhaustivité : « au moins » quand la lecture est partielle ; Bruxelles n’est pas couvert.</li>
<li>Aucun prix : le propriétaire le fixe au cas par cas.</li>
<li>Aucun témoignage, logo ni référence tant qu’il n’y en a pas de réel.</li>
<li>Ni téléphones ni adresses électroniques que le registre ne fournit pas ; aucun nom de dirigeant, aucun budget d’annonce additionné.</li>
</ul></section>`);

  // Mentions légales (fournies par le propriétaire ; condition bloquante tant qu'elles manquent).
  sections.push(mentions_legales ? `<section><h2>Mentions légales</h2><p class="mentions">${esc(mentions_legales)}</p></section>`
    : '<section><h2>Mentions légales</h2><p class="manque">À fournir par le propriétaire : identité, statut, numéro d’immatriculation s’il en a un, hébergeur. Condition bloquante de mise en ligne.</p></section>');

  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>VELYX — registre de preuves</title>
<style>
:root{--fond:#fbfaf7;--texte:#1d1d1b;--doux:#5d5b55;--trait:#dedbd2;--accent:#2f5d50;--manque:#8a3b12}
@media (prefers-color-scheme:dark){:root{--fond:#161614;--texte:#ecebe6;--doux:#a9a69c;--trait:#34332e;--accent:#8cc5b2;--manque:#f0a37a}}
*{box-sizing:border-box}body{margin:0;background:var(--fond);color:var(--texte);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:46rem;margin:0 auto;padding:1.25rem 1rem 3rem}h1{font-size:1.5rem;margin:.5rem 0}h2{font-size:1.1rem;margin:2rem 0 .5rem;color:var(--accent)}
p,li{color:var(--texte)}.sous{color:var(--doux)}table{width:100%;border-collapse:collapse;font-size:.92rem;display:block;overflow-x:auto}
th,td{border-bottom:1px solid var(--trait);padding:.4rem .5rem;text-align:left;vertical-align:top}data{font-variant-numeric:tabular-nums;font-weight:600}
.nat{font-size:.75rem;border:1px solid var(--trait);border-radius:.6rem;padding:0 .4rem;color:var(--doux)}.nd{color:var(--doux)}.manque{color:var(--manque)}
code{font-size:.9em}
</style>
</head>
<body>
<main>
<h1>VELYX — registre de preuves</h1>
<p class="sous">Page générée le ${date} depuis les seuls fichiers publics du dépôt. Chaque nombre indique sa source et sa date.</p>
${sections.join('\n')}
</main>
</body>
</html>
`;
  return { html, empreinte: empreinteSite(html), chiffres, ecartes };
}

/** Empreinte (hex16) du HTML exact : c'est elle que le propriétaire valide (R-25). */
export const empreinteSite = (html) => sha256Texte(String(html)).slice(0, 16);

const decoder = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
/** Texte visible du HTML (style retiré, balises remplacées par des espaces, entités décodées), lignes conservées. */
export function texteVisible(html) {
  return decoder(String(html).replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]*>/g, ' '));
}

const ATTR = (attrs, nom) => new RegExp(`\\b${nom}="([^"]*)"`).exec(attrs)?.[1] ?? '';
/** Texte visible hors des éléments qui portent data-source et data-date non vides. */
function horsChiffresSources(html) {
  let s = String(html).replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<head\b[\s\S]*?<\/head>/gi, ' ');
  s = s.replace(/<(data|time|span)\b([^>]*)>([\s\S]*?)<\/\1>/gi, (m, tag, attrs) => (ATTR(attrs, 'data-source').trim() && ATTR(attrs, 'data-date').trim() ? ' ' : m));
  return texteVisible(s);
}

/**
 * Vérifie la page avant toute mise en ligne. conditions : {mentions_legales, contact_opposition (fournis par le
 * propriétaire et présents dans la page), usage_reel (canal ouvert dont les CGU permettent un lien, ou proposition
 * validée qui cite la page), validation: {empreinte} (validation du propriétaire liée à l'empreinte exacte du HTML)}.
 * → {ok, manques: string[], pret_pour_revue (tout sauf la validation), empreinte}
 */
export function verifierSite(html, { dict = null, conditions = {} } = {}) {
  const h = String(html ?? ''), manques = [];
  const ajouter = (m) => { if (!manques.includes(m)) manques.push(m); };
  if (/<script\b/i.test(h) || /\son[a-z]+\s*=/i.test(h) || /javascript:/i.test(h)) ajouter('script');
  if (/<(form|input|button|textarea|select)\b/i.test(h)) ajouter('formulaire');
  if (/cookie/i.test(h)) ajouter('cookie');
  if (/<(iframe|object|embed|link|img|audio|video|source|base|picture|svg)\b/i.test(h) || /url\s*\(/i.test(h) || /@import/i.test(h)
    || /http-equiv\s*=\s*["']?refresh/i.test(h)) ajouter('ressource_externe');
  if (/:\/\//.test(h) || /\bwww\./i.test(h) || /\b(href|src|srcset|action|poster|data)\s*=\s*(?!["']?#)/i.test(h.replace(/<data\b[^>]*>/gi, ''))) ajouter('url_externe');
  if (/\d/.test(horsChiffresSources(h))) ajouter('chiffres_non_sources');
  if (/<(data|time|span)\b[^>]*data-source="\s*"/i.test(h) || /<(data|time|span)\b[^>]*data-date="\s*"/i.test(h)) ajouter('chiffres_non_sources');
  // Antifuite et canari : le texte visible, hors les coordonnées que le propriétaire fournit lui-même pour publication.
  let visible = texteVisible(h);
  for (const c of [conditions.mentions_legales, conditions.contact_opposition]) if (typeof c === 'string' && c) visible = visible.split(c).join(' ');
  if (!dict || ((dict.jetons?.size ?? 0) === 0 && (dict.sirens?.size ?? 0) === 0)) ajouter('antifuite_non_mesuree');
  if (scannerTexte(visible, dict).n > 0) ajouter('antifuite');
  const present = (c) => typeof c === 'string' && c.trim() && h.includes(c.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
  if (!present(conditions.mentions_legales)) ajouter('mentions_legales');
  if (!present(conditions.contact_opposition)) ajouter('contact_opposition');
  if (conditions.usage_reel !== true) ajouter('usage_reel');
  const emp = empreinteSite(h);
  const validee = conditions.validation && conditions.validation.empreinte === emp;
  if (!validee) manques.push('validation');
  return { ok: manques.length === 0, manques, pret_pour_revue: manques.every((m) => m === 'validation'), empreinte: emp };
}

/** Lit l'état public sous etat/ seulement (fichier absent : clé absente). */
export function chargerEtatPublic(magasin) {
  const out = {};
  for (const [cle, rel] of Object.entries(SOURCES_ETAT)) {
    if (!rel.startsWith('etat/')) continue;
    try { const v = magasin.lireJson(rel); if (v !== null) out[cle] = v; } catch { /* JSON illisible : clé absente, la page le dit */ }
  }
  return out;
}

/** Écrit la page dans prive/site/index.html, et nulle part ailleurs. → chemin relatif écrit */
export const ecrireSite = (magasin, html) => magasin.ecrirePrive(CHEMIN_SITE_PRIVE, html);

/**
 * Génère, vérifie et écrit la page privée : etat/ → construireSite → verifierSite → prive/site/index.html.
 * → {chemin, empreinte, chiffres, ecartes, verification}
 */
export function genererSite(magasin, { jour, dict = null, mentions_legales = null, contact_opposition = null, usage_reel = false, validation = null } = {}) {
  const s = construireSite(chargerEtatPublic(magasin), { jour, mentions_legales, contact_opposition });
  const verification = verifierSite(s.html, { dict, conditions: { mentions_legales, contact_opposition, usage_reel, validation } });
  return { chemin: ecrireSite(magasin, s.html), empreinte: s.empreinte, chiffres: s.chiffres, ecartes: s.ecartes, verification };
}
