// Source de demande réelle : les projets publiés sur codeur.com par des clients, avec budget et concurrence.
// Observation seulement (le mandat 0 € écarte l'abonnement payant qui permet de répondre). Lecture seule, quelques pages,
// par la porte réseau unique du socle (http injecté : liste blanche, débit poli, budget) : on lit un marché, on ne
// l'aspire pas. Lectures : flux RSS (pubDate absolue, guid stable), pages de liste 1 à 5, page détail d'un projet
// (statut, offres, vues, interactions, devis en moins de 2 h, montant moyen des devis), pages publiques /pages/<slug>.
// Un champ illisible vaut null, jamais 0 : un parseur cassé doit se voir (santeParseur), pas passer pour un
// marché vide.
import { creerHttp, creerBudget, creerHorloge } from '../socle.js';

export const BASE = 'https://www.codeur.com';
/** Statuts affichés par codeur.com ; tout autre texte est illisible (null). */
export const STATUTS = Object.freeze(['Ouvert', 'En cours', 'Fermé']);

/** Réponse HTTP hors 2xx d'une source (404 d'un projet retiré, 400…). Le texte de la réponse n'est jamais repris. */
export class StatutInattendu extends Error {
  constructor(url, status) { super(`${url} → HTTP ${status}`); this.name = 'StatutInattendu'; this.url = url; this.status = status; }
}

// --- v1, inchangé ----------------------------------------------------------------------------------------------------

const nettoie = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#39;|&rsquo;|’/g, '’')
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// Âge affiché (« Il y a 33 minutes ») → heures. null si illisible : jamais deviné.
export function ageHeures(txt) {
  const m = /Il y a (\d+|une?|un) (minute|heure|jour|semaine|mois|an)/i.exec(txt || '');
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : 1;
  return n * { minute: 1 / 60, heure: 1, jour: 24, semaine: 168, mois: 720, an: 8760 }[m[2].toLowerCase()];
}

// Budget affiché → bornes en euros. « Moins de 500 € » = [0, 500] ; « À définir » = null.
export function budget(txt) {
  const t = (txt || '').replace(/\s/g, '').replace(/ /g, '');
  const nums = [...t.matchAll(/(\d[\d.]*)€/g)].map((m) => Number(m[1].replace(/\./g, '')));
  if (/Moinsde/i.test(t) && nums.length) return { min: 0, max: nums[0], texte: txt.trim() };
  if (/Plusde/i.test(t) && nums.length) return { min: nums[0], max: null, texte: txt.trim() };
  if (nums.length >= 2) return { min: nums[0], max: nums[1], texte: txt.trim() };
  return { min: null, max: null, texte: (txt || '').trim() || '—' };
}

export function parseListe(html) {
  const out = [];
  const re = /<a class="block group[^>]*aria-label="([^"]*)" href="(\/projects\/(\d+)-[^"]*)">([\s\S]*?)<\/a>\s*(?=<a class="block group|<\/div>)/g;
  for (const m of html.matchAll(re)) {
    const corps = m[4];
    const span = (title) => { const r = new RegExp(`title="${title}">([\\s\\S]*?)</span>`).exec(corps); return r ? nettoie(r[1]) : null; };
    const ageTxt = (/whitespace-nowrap ml-2">\s*([^<]+)</.exec(corps) || [])[1]?.trim() ?? null;
    const statut = (/<span class="w-2 h-2 rounded-full[^"]*"><\/span>\s*([^<]+)</.exec(corps) || [])[1]?.trim() ?? null;
    const resume = nettoie((/line-clamp-3[^>]*>([\s\S]*?)<\/div>/.exec(corps) || [])[1] || '');
    const tags = [...corps.matchAll(/rounded text-xs font-medium[^>]*>\s*([^<]+?)\s*</g)].map((t) => nettoie(t[1]));
    const offres = Number((span('Offres') || '').match(/\d+/)?.[0] ?? NaN);
    out.push({
      source: 'codeur.com', id: m[3], url: BASE + m[2], titre: nettoie(m[1]), statut, age_txt: ageTxt, age_h: ageHeures(ageTxt),
      budget: budget(span('Budget')), offres: Number.isFinite(offres) ? offres : null,
      vues: Number((span('Vues') || '').match(/\d+/)?.[0] ?? NaN) || null, resume, tags,
    });
  }
  return out;
}

// --- texte et dates ----------------------------------------------------------------------------------------------------

const NOMMEES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  hellip: '…', laquo: '«', raquo: '»', ndash: '–', mdash: '—', euro: '€', eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à',
  acirc: 'â', ccedil: 'ç', ocirc: 'ô', ucirc: 'û', icirc: 'î', iuml: 'ï', euml: 'ë', Eacute: 'É' };

/** Décode les entités HTML (nommées courantes et numériques). */
export function decoder(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (tout, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : tout;
    }
    return Object.hasOwn(NOMMEES, e) ? NOMMEES[e] : tout;
  });
}
// Une balise dont un attribut entre guillemets contient « > » (class="[&>p:last-child]:mb-0", relevé sur codeur.com)
// reste une seule balise.
const BALISE = /<(?:[^>"']|"[^"]*"|'[^']*')*>/g;
/** HTML → texte d'une ligne : balises retirées, entités décodées, espaces fusionnés. */
const texte = (html) => decoder(String(html ?? '').replace(BALISE, ' ')).replace(/[\s\u00a0\u202f]+/g, ' ').trim();
const sansAccents = (s) => s.normalize('NFD').replace(/\p{M}/gu, '');
/** Premier entier d'un texte (séparateurs de milliers acceptés) ; null s'il n'y en a pas. */
function entier(txt) {
  const m = /\d[\d\u00a0\u202f .]*/.exec(texte(txt));
  if (!m) return null;
  const n = Number(m[0].replace(/\D/g, ''));
  return Number.isSafeInteger(n) ? n : null;
}

const MOIS = { janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12 };
const PARIS_HEURE = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', hourCycle: 'h23', year: 'numeric', month: '2-digit',
  day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
/** Décalage de Paris sur UTC (ms) à l'instant ms. */
function decalageParis(ms) {
  const p = Object.fromEntries(PARIS_HEURE.formatToParts(new Date(ms)).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - (ms - (((ms % 1000) + 1000) % 1000));
}

/**
 * Date affichée par codeur.com, à l'heure de Paris (« 07 novembre 2026 à 16h31 ») → ISO UTC. L'heure d'été est celle
 * d'Intl (Europe/Paris). null si le texte n'a pas cette forme, si l'heure manque ou si la date n'existe pas.
 */
export function parseDateFr(txt) {
  const t = sansAccents(String(txt ?? '')).toLowerCase().replace(/[\s\u00a0\u202f]+/g, ' ').trim();
  const m = /^(\d{1,2})(?:er)? ([a-z]+) (\d{4}) a (\d{1,2}) ?h ?(\d{2})?$/.exec(t);
  if (!m || !Object.hasOwn(MOIS, m[2])) return null;
  const [j, mo, a, h, mi] = [Number(m[1]), MOIS[m[2]], Number(m[3]), Number(m[4]), m[5] === undefined ? 0 : Number(m[5])];
  if (h > 23 || mi > 59) return null;
  const local = Date.UTC(a, mo - 1, j, h, mi);
  const d = new Date(local);
  if (d.getUTCFullYear() !== a || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== j) return null;
  const utc = local - decalageParis(local - decalageParis(local));
  return new Date(utc).toISOString();
}

// --- flux RSS ---------------------------------------------------------------------------------------------------------

const cdata = (s) => { const m = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(s ?? ''); return m ? m[1] : decoder(s ?? ''); };
/** Découpe « A, B (c, d), E » aux virgules hors parenthèses. */
function decouper(liste) {
  const out = [];
  let prof = 0, cur = '';
  for (const c of liste) {
    if (c === '(') prof++;
    if (c === ')') prof = Math.max(0, prof - 1);
    if (c === ',' && prof === 0) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}
const urlProjet = (id, lien) => (typeof lien === 'string' && /^https:\/\/www\.codeur\.com\/projects\/\d+(?:-[a-z0-9-]+)?$/i.test(lien.trim()) ? lien.trim() : `${BASE}/projects/${id}`);

/**
 * Flux https://www.codeur.com/projects.rss → [{id (guid), url, titre, publie_le (ISO UTC), budget, categories, resume}].
 * Un lien qui ne pointe pas vers un projet codeur.com est remplacé par l'URL canonique du projet (donnée non fiable).
 */
export function parseRss(xml) {
  const out = [];
  for (const m of String(xml ?? '').matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
    const corps = m[1];
    const champ = (nom) => { const r = new RegExp(`<${nom}\\b[^>]*>([\\s\\S]*?)<\\/${nom}>`).exec(corps); return r ? cdata(r[1]) : null; };
    const guid = texte(champ('guid') ?? ''), lien = texte(champ('link') ?? '');
    const id = /^\d+$/.test(guid) ? guid : (/\/projects\/(\d+)/.exec(lien || guid)?.[1] ?? null);
    if (!id) continue;
    const pub = Date.parse(texte(champ('pubDate') ?? ''));
    const paragraphes = [...(champ('description') ?? '').matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map((p) => texte(p[1]));
    const tete = paragraphes.find((p) => /^Budget\s*:/i.test(p)) ?? '';
    const b = /^Budget\s*:\s*(.*?)\s*(?:-\s*Cat[ée]gories\s*:|$)/i.exec(tete);
    const c = /Cat[ée]gories\s*:\s*(.*)$/i.exec(tete);
    out.push({
      id, url: urlProjet(id, lien), titre: texte(champ('title') ?? ''), publie_le: Number.isFinite(pub) ? new Date(pub).toISOString() : null,
      budget: budget(b ? b[1] : ''), categories: c ? decouper(c[1]) : [],
      resume: paragraphes.find((p) => p && p !== tete && !/^Voir ce projet/i.test(p)) ?? '',
    });
  }
  return out;
}

// --- page détail d'un projet ------------------------------------------------------------------------------------------

/**
 * Page détail → {statut, publie_le, offres, vues, interactions, devis_2h, montant_moyen_devis, description, titre, budget}.
 * Repères relevés le 15/11/2026 : bloc d'en-tête <p class="font-medium mb-0 flex flex-wrap"> (statut dans son premier
 * span, title="Nombre d'offres", « N vues », « N interactions ») ; « Publication : » suivi d'un font-semibold ;
 * « N propositions de devis en moins de 2h » ; « Montant moyen des devis proposés : » suivi d'un font-semibold.
 * Un champ absent donne null, jamais 0.
 */
export function parseProjet(html) {
  const h = String(html ?? '');
  const i = h.indexOf('font-medium mb-0 flex flex-wrap');
  const fin = i >= 0 ? h.indexOf('</p>', i) : -1;
  const tete = i >= 0 ? h.slice(i, fin >= 0 ? fin : i + 4000) : '';
  const st = texte(/<span\b[^>]*>([\s\S]*?)<\/span>/.exec(tete)?.[1] ?? '');
  const statut = STATUTS.find((s) => sansAccents(s).toLowerCase() === sansAccents(st).toLowerCase()) ?? null;
  const offresTxt = /title="Nombre d(?:'|&#39;|&#x27;|’|&rsquo;)offres"[^>]*>([\s\S]*?)<\/span>/.exec(tete)?.[1];
  const compte = (mot) => { const r = new RegExp(`>\\s*(\\d[\\d\\u00a0\\u202f ]*)\\s*${mot}s?\\s*<`, 'i').exec(tete); return r ? entier(r[1]) : null; };
  const pub = /Publication\s*:\s*<span\b[^>]*class="[^"]*font-semibold[^"]*"[^>]*>([\s\S]*?)<\/span>/.exec(h)?.[1];
  const devis = />\s*(\d+)\s+propositions?\s+de\s+devis\s+en\s+moins\s+de\s+(\d+)\s*h\s*</i.exec(h);
  const montant = /Montant moyen des devis propos(?:é|&eacute;|&#233;|e)s\s*:\s*<span\b[^>]*font-semibold[^>]*>([\s\S]*?)<\/span>/i.exec(h)?.[1];
  const iDesc = h.indexOf('project-description');
  let description = null;
  if (iDesc >= 0) {
    const debut = h.indexOf('>', iDesc) + 1, finDesc = h.indexOf('project-details', iDesc);
    description = texte(h.slice(debut, finDesc > debut ? finDesc : debut + 20000).replace(/<div[^>]*class="[^"]*$/, '')) || null;
  }
  if (description === null) {
    const meta = /<meta name="description" content="([^"]*)"/.exec(h)?.[1];
    description = meta ? texte(meta) || null : null;
  }
  const titre = texte(/<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(h)?.[1] ?? '') || null;
  const budgetTxt = /title="Budget indicatif"[^>]*>([\s\S]*?)<\/span>/.exec(tete)?.[1];
  return {
    statut,
    publie_le: pub ? parseDateFr(texte(pub)) : null,
    offres: offresTxt === undefined ? null : entier(offresTxt),
    vues: compte('vue'),
    interactions: compte('interaction'),
    devis_2h: devis ? { n: Number(devis[1]), heures: Number(devis[2]) } : null,
    montant_moyen_devis: montant === undefined ? null : entier(montant),
    description,
    titre,
    budget: budgetTxt === undefined ? null : budget(texte(budgetTxt)),
  };
}

/** Texte lisible d'une page publique (CGU, tarifs) : scripts, styles et en-tête retirés, une ligne par bloc. */
export function texteDePage(html) {
  const corps = String(html ?? '').replace(/<head\b[\s\S]*?<\/head>/gi, ' ')
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|ul|ol|table)>|<br\s*\/?>/gi, '\n');
  return corps.split('\n').map((l) => texte(l)).filter(Boolean).join('\n');
}

// --- santé du parseur --------------------------------------------------------------------------------------------------

/** Part maximale de champs illisibles (offres, statut, age_h) admise sur les pages de liste. */
export const SEUIL_NULL = 0.2;

/**
 * Santé du parseur, vérifiée avant toute interprétation, sur les annonces des pages de liste et les items du RSS.
 * ok = n > 0, rss_n > 0 et chaque taux de champs nuls (offres, statut, age_h) ≤ 0,2 ; un taux vaut null sans annonce.
 * Référence du 15/11/2026 : 169 annonces, 0 % de champs nuls, 35 items RSS sur environ 52 h. Un parseur cassé produit
 * un aveu, jamais un « marché vide ». (Réexportée par observer.js.)
 */
export function santeParseur(annonces, rss) {
  const L = Array.isArray(annonces) ? annonces : [], n = L.length, rss_n = Array.isArray(rss) ? rss.length : 0;
  const taux = (k) => (n ? Math.round((L.filter((a) => a?.[k] === null || a?.[k] === undefined).length / n) * 1000) / 1000 : null);
  const taux_null = { offres: taux('offres'), statut: taux('statut'), age_h: taux('age_h') };
  const ok = n > 0 && rss_n > 0 && Object.values(taux_null).every((t) => t !== null && t <= SEUIL_NULL);
  return { ok, n, rss_n, taux_null };
}

// --- lectures (http injecté : socle.creerHttp) ------------------------------------------------------------------------

async function lireTexte(http, url) {
  const r = await http.get(url, { source: 'codeur', format: 'texte' });
  if (!(r.status >= 200 && r.status < 300)) throw new StatutInattendu(url, r.status);
  return r;
}

/** Flux RSS des projets (1 requête). */
export async function lireRss(http) {
  const r = await lireTexte(http, `${BASE}/projects.rss`);
  return parseRss(r.corps).map((x) => ({ ...x, lu_le: r.lu_le }));
}

/** Page de liste 1 à 5 (robots.txt : seul ?page= est permis) ; chaque annonce porte lu_le et sa page. */
export async function lireListe(http, page = 1) {
  if (!Number.isInteger(page) || page < 1 || page > 5) throw new RangeError(`lireListe : page 1 à 5 attendue (reçu ${page})`);
  const r = await lireTexte(http, page === 1 ? `${BASE}/projects` : `${BASE}/projects?page=${page}`);
  return parseListe(r.corps).map((x) => ({ ...x, lu_le: r.lu_le, page }));
}

/** Page détail d'un projet → Partial<Annonce> (id, url, champs de parseProjet, lu_le). */
export async function lireProjet(http, url) {
  const id = /^https:\/\/www\.codeur\.com\/projects\/(\d+)(?:-[a-z0-9-]+)?$/i.exec(String(url ?? ''))?.[1];
  if (!id) throw new TypeError(`lireProjet : URL de projet codeur.com attendue (${url})`);
  const r = await lireTexte(http, url);
  return { id, url, ...parseProjet(r.corps), lu_le: r.lu_le };
}

/** Page publique '/pages/<slug>' (CGU, tarifs) → {chemin, url, texte, lu_le}. */
export async function lirePage(http, chemin) {
  if (typeof chemin !== 'string' || !/^\/pages\/[a-z0-9-]+$/i.test(chemin)) throw new TypeError(`lirePage : chemin '/pages/<slug>' attendu (${chemin})`);
  const url = `${BASE}${chemin}`;
  const r = await lireTexte(http, url);
  return { chemin, url, texte: texteDePage(r.corps), lu_le: r.lu_le };
}

// --- compatibilité v1 (bin/velyx.js) ----------------------------------------------------------------------------------

/** Porte réseau par défaut des appels v1 (sans http injecté) : socle, budget propre à l'appel. */
function httpV1(requetes) {
  const horloge = creerHorloge();
  return creerHttp({ budget: creerBudget({ codeur: requetes, sirene: 0, duree_s: 3600 }, horloge), horloge });
}

/** v1 : lit les pages 1 à `pages` (5 au plus) et rend les annonces distinctes. Passe désormais par le socle. */
export async function collecter({ pages = 3, http } = {}) {
  const n = Math.min(Math.max(1, Math.trunc(Number(pages)) || 1), 5);
  const h = http ?? httpV1(n * 4);
  const vus = new Map();
  for (let p = 1; p <= n; p++) for (const x of await lireListe(h, p)) if (!vus.has(x.id)) vus.set(x.id, x);
  return [...vus.values()];
}

/** v1 : complète une annonce par sa page détail ; un champ illisible du détail n'efface pas celui de la liste. */
export async function detailler(projet, { http } = {}) {
  const d = await lireProjet(http ?? httpV1(4), projet.url);
  const out = { ...projet };
  for (const [k, v] of Object.entries(d)) if (v !== null || !(k in out)) out[k] = v;
  return out;
}
