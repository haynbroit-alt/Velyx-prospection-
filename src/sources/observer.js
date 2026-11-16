// OBSERVER : relevé daté et borné du monde réel, une fois par jour de Paris.
// Ordre et plafond des lectures codeur.com (10 au plus, budget du cycle) : RSS (1) ; liste p1-p2 (2) ; en cas de trou
// (le plus vieux pubDate du RSS est postérieur à la dernière annonce vue au relevé précédent), p3 à p5 dans le budget
// restant, sans entamer ce qu'il faut aux annonces suivies ; jusqu'à 4 détails, d'abord les suivis (revue, pari,
// prévision, données), puis les candidats ; 1 page publique au plus. Sondes SIRENE : 1 requête de compte chacune.
// La santé du parseur est mesurée avant toute interprétation : un parseur cassé produit un aveu, jamais un « marché vide ».
// Écritures : série publique etat/series/<jour>.jsonl (PointSerie : ni titre, ni résumé, ni description, ni client),
// fichiers privés prive/cycles/<id>/annonces.json et prive/cycles/<id>/pages/<slug>.txt. Aucun acte : M12 consigne
// observation:codeur:<jour> avec {fichier, sha256, sante, requetes, trou} et l'effectif dans mesure (la clé « n » est
// réservée par le registre) ; voir Observation.serie.
import { creerBudget, heuresEntre, sha256Texte, BudgetEpuise, Bloque, PubliqueRefusee } from '../socle.js';
import { CLES } from '../registre.js';
import { BASE, lireRss, lireListe, lireProjet, lirePage, santeParseur, SEUIL_NULL } from './codeur.js';
import { compter } from './sirene.js';

export const LIMITES = Object.freeze({ details: 4, pages: 1, liste: Object.freeze([1, 2]), trou: Object.freeze([3, 4, 5]), taux_null_max: SEUIL_NULL });
export { santeParseur };
/** Série publique d'un jour (périmètre v2 : etat/series/*.jsonl ; la spec écrivait etat/marche/<jour>.jsonl, relu aussi). */
export const cheminSerie = (jour) => `etat/series/${jour}.jsonl`;
const ANCIEN_CHEMIN = (jour) => `etat/marche/${jour}.jsonl`;
const ORDRE_MOTIFS = ['revue', 'pari', 'prevision', 'donnees'];
const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const arrondi = (x, n = 2) => Math.round(x * 10 ** n) / 10 ** n;
// Le slug d'une URL de projet reprend le titre de l'annonce, qui peut nommer le client : un aveu n'en garde que l'id.
const sansSlug = (t) => String(t).replace(/(\/projects\/\d+)-[a-z0-9-]+/gi, '$1');

/** Point public d'une annonce : aucun texte libre (titre, résumé, description), aucun nom. */
export function pointSerie(a, t) {
  const p = { id: a.id, t, statut: a.statut ?? null, offres: a.offres ?? null, vues: a.vues ?? null, interactions: a.interactions ?? null,
    devis_2h_n: a.devis_2h?.n ?? null, bmin: a.budget?.min ?? null, bmax: a.budget?.max ?? null, tags: Array.isArray(a.tags) ? a.tags : [],
    publie_le: a.publie_le ?? null };
  // Extensions : page détail lue (montant moyen des devis, fenêtre des devis), annonce suivie hors des pages lues.
  if (a.detail) Object.assign(p, { detail: true, devis_2h_h: a.devis_2h?.heures ?? null, montant_moyen_devis: a.montant_moyen_devis ?? null });
  if (a.hors_pages) p.hors_pages = true;
  return p;
}

function lirePoints(texte) {
  const out = [];
  for (const l of String(texte ?? '').split('\n')) {
    if (!l.trim()) continue;
    try { const p = JSON.parse(l); if (p && typeof p === 'object' && typeof p.id === 'string') out.push(p); } catch { /* ligne illisible ignorée */ }
  }
  return out;
}

/**
 * Publication la plus récente vue au dernier relevé antérieur à `avant` (séries publiques, du jour le plus récent au
 * plus ancien ; seuls comptent les points relevés avant `avant`), ou null.
 */
export function derniereVue(magasin, avant) {
  if (!magasin) return null;
  const fichiers = [...magasin.lister('etat/series/'), ...magasin.lister('etat/marche/')]
    .filter((f) => /\/\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
    .sort((a, b) => a.slice(-16).localeCompare(b.slice(-16)));
  for (const f of fichiers.reverse()) {
    const pts = lirePoints(magasin.lire(f)).filter((p) => typeof p.t === 'string' && p.t < avant && typeof p.publie_le === 'string');
    if (pts.length) return pts.reduce((m, p) => (p.publie_le > m ? p.publie_le : m), pts[0].publie_le);
  }
  return null;
}

function normaliserPlan(plan, aveux) {
  const P = plan && typeof plan === 'object' ? plan : {};
  const entrees = (liste, quoi) => (Array.isArray(liste) ? liste : []).filter((x) => {
    const ok = x && typeof x === 'object' && /^\d{1,9}$/.test(String(x.id ?? ''));
    if (!ok) aveux.push({ quoi, ref: null, motif: 'entrée du plan illisible, ignorée' });
    return ok;
  }).map((x) => ({ ...x, id: String(x.id) }));
  const suivis = entrees(P.suivis, 'suivi').sort((a, b) => {
    const r = (m) => { const i = ORDRE_MOTIFS.indexOf(m); return i < 0 ? ORDRE_MOTIFS.length : i; };
    return r(a.motif) - r(b.motif);
  });
  const pages = (Array.isArray(P.pages) ? P.pages : []).filter((p) => {
    const ok = p && typeof p.chemin === 'string' && /^\/pages\/[a-z0-9-]+$/i.test(p.chemin);
    if (!ok) aveux.push({ quoi: 'page', ref: null, motif: 'page du plan hors /pages/<slug>, ignorée' });
    return ok;
  });
  const sondes = (Array.isArray(P.sondes) ? P.sondes : []).filter((s) => s && typeof s.recette === 'string' && s.params && typeof s.params === 'object');
  return { suivis, candidats: entrees(P.candidats, 'candidat'), pages, sondes, derniere_vue: typeof P.derniere_vue === 'string' ? P.derniere_vue : undefined };
}

/** URL d'un projet du plan : celle du plan si elle désigne bien ce projet sur codeur.com, sinon l'URL canonique. */
const urlDe = (x) => (typeof x.url === 'string' && /^https:\/\/www\.codeur\.com\/projects\/(\d+)(?:-[a-z0-9-]+)?$/i.exec(x.url)?.[1] === x.id ? x.url : `${BASE}/projects/${x.id}`);

/** Union RSS ∪ pages de liste, par id, enrichie des détails lus ; l'âge vient de pubDate quand il est connu. */
function unir(rss, liste, details, luLe) {
  const m = new Map();
  const neuve = (id, url) => ({ id, url, titre: '', statut: null, publie_le: null, age_h: null, budget: null, offres: null, vues: null,
    interactions: null, devis_2h: null, montant_moyen_devis: null, tags: [], resume: '', description: null, lu_le: luLe, sources: [], age_liste: null });
  for (const r of rss) {
    const x = neuve(r.id, r.url);
    Object.assign(x, { titre: r.titre, publie_le: r.publie_le, budget: r.budget, tags: r.categories ?? [], resume: r.resume ?? '' });
    x.sources.push('rss'); m.set(r.id, x);
  }
  for (const a of liste.values()) {
    const x = m.get(a.id) ?? neuve(a.id, a.url);
    x.titre ||= a.titre; x.statut = a.statut; x.offres = a.offres; x.vues = a.vues; x.age_liste = a.age_h;
    if (a.tags?.length) x.tags = a.tags;
    if (a.resume) x.resume = a.resume;
    if (!x.budget || a.budget?.min !== null || a.budget?.max !== null) x.budget = a.budget;
    x.page = a.page; x.sources.push('liste'); m.set(a.id, x);
  }
  for (const [id, d] of details) {
    const x = m.get(id);
    if (!x) continue;
    for (const k of ['statut', 'offres', 'vues', 'interactions', 'devis_2h', 'montant_moyen_devis', 'description']) if (d[k] !== null && d[k] !== undefined) x[k] = d[k];
    if (!x.publie_le && d.publie_le) x.publie_le = d.publie_le;
    if (!x.titre && d.titre) x.titre = d.titre;
    x.detail = true; x.sources.push('detail');
  }
  for (const x of m.values()) {
    x.age_h = x.publie_le ? arrondi(Math.max(0, heuresEntre(x.publie_le, luLe))) : x.age_liste;
    delete x.age_liste;
  }
  return [...m.values()];
}

/**
 * Relevé du jour. ctx : {jour, id, horloge, budget, http, magasin?} (contrats.Ctx). plan : PlanObservation
 * {jour, suivis: [{id, url, motif}], candidats: [{id, url}], pages: [{canal, chemin}], sondes: [{recette, params}],
 * derniere_vue?}. Rend une Observation {lu_le, jour, annonces, suivis, pages, sondes, trou, sante, requetes, aveux,
 * serie: {fichier, n, sha256}|null, fichier_prive}. Toute lecture refusée (budget, plafond, 403, erreur réseau) est
 * consignée dans aveux, sans jamais citer un nom ; un 403 arrête codeur.com pour le cycle.
 */
export async function observer(ctx, plan) {
  const { http, budget, horloge, magasin = null } = ctx;
  if (!http || !budget || !horloge) throw new TypeError('observer : ctx.http, ctx.budget et ctx.horloge requis');
  const jour = ctx.jour ?? horloge.jour();
  if (!JOUR.test(jour)) throw new TypeError(`observer : jour illisible « ${jour} »`);
  const id = ctx.id ?? `C-${jour}`;
  if (!/^[A-Za-z0-9-]+$/.test(id)) throw new TypeError(`observer : identifiant de cycle illisible « ${id} »`);
  const aveux = [], P = normaliserPlan(plan, aveux), lu_le = horloge.iso();
  const avant = { codeur: budget.reste('codeur'), sirene: budget.reste('sirene') };
  const arret = { codeur: null, sirene: null };

  const lire = async (source, quoi, ref, f) => {
    if (arret[source]) { aveux.push({ quoi, ref, motif: `non lu : ${arret[source]}` }); return null; }
    try { return await f(); } catch (e) {
      if (e instanceof Bloque) arret[source] = `${source} a répondu HTTP 403 : source arrêtée pour le cycle`;
      else if (e instanceof BudgetEpuise && (e.source === source || e.source === 'duree_s')) arret[source] = e.message;
      if (e instanceof BudgetEpuise && e.source === 'duree_s') { arret.codeur ??= e.message; arret.sirene ??= e.message; }
      aveux.push({ quoi, ref, motif: sansSlug(e?.message ?? String(e)) });
      return null;
    }
  };

  // 1-2. RSS puis pages 1 et 2.
  const rss = (await lire('codeur', 'rss', '/projects.rss', () => lireRss(http))) ?? [];
  const liste = new Map();
  const ajouter = (L) => { for (const a of L ?? []) if (!liste.has(a.id)) liste.set(a.id, a); };
  for (const p of LIMITES.liste) ajouter(await lire('codeur', 'liste', `p${p}`, () => lireListe(http, p)));

  // 3. Trou : des annonces ont pu paraître entre le dernier relevé et le plus vieil item du RSS.
  const vue = P.derniere_vue ?? derniereVue(magasin, lu_le);
  const plusVieux = rss.map((r) => r.publie_le).filter(Boolean).sort()[0] ?? null;
  const trou = Boolean(vue && plusVieux && plusVieux > vue);
  if (trou) {
    const reserve = Math.min(LIMITES.details, P.suivis.length);
    for (const p of LIMITES.trou) {
      if (arret.codeur) break;
      if (budget.reste('codeur') - reserve <= 0) { aveux.push({ quoi: 'liste', ref: `p${p}`, motif: 'trou non comblé : le budget restant revient aux annonces suivies' }); break; }
      const L = await lire('codeur', 'liste', `p${p}`, () => lireListe(http, p));
      if (!L) break;
      ajouter(L);
      // L'âge affiché est arrondi par défaut : lu_le − age_h est postérieur à la vraie publication. Si même cette borne
      // atteint la dernière annonce vue, le trou est comblé.
      const borne = L.filter((a) => a.age_h !== null).map((a) => new Date(Date.parse(lu_le) - a.age_h * 3.6e6).toISOString()).sort()[0];
      if (!L.length || (borne && borne <= vue)) break;
    }
  }

  // 4. Détails : suivis d'abord (revue, pari, prévision, données), puis candidats ; 4 au plus.
  const local = creerBudget({ details: LIMITES.details }, horloge);
  const vus = new Set(), demandes = [];
  for (const [d, suivi] of [...P.suivis.map((s) => [s, true]), ...P.candidats.map((c) => [c, false])]) {
    if (vus.has(d.id)) continue;
    vus.add(d.id); demandes.push({ ...d, suivi });
  }
  const details = new Map(), suivis = [];
  for (const d of demandes) {
    let r = null, refus = null;
    try { local.prendre('details'); } catch (e) { refus = e.message; aveux.push({ quoi: 'detail', ref: d.id, motif: e.message }); }
    if (!refus) {
      r = await lire('codeur', 'detail', d.id, () => lireProjet(http, urlDe(d)));
      if (r) details.set(d.id, r);
    }
    if (d.suivi) {
      suivis.push({ id: d.id, motif: d.motif ?? null, statut: r?.statut ?? null, offres: r?.offres ?? null, devis_2h: r?.devis_2h ?? null,
        interactions: r?.interactions ?? null, montant_moyen_devis: r?.montant_moyen_devis ?? null, vu_le: r?.lu_le ?? null,
        ...(liste.has(d.id) || rss.some((x) => x.id === d.id) ? {} : { hors_pages: true }) });
    }
  }

  // 5. Une page publique au plus (CGU au premier cycle, tarifs le dimanche : choix du plan).
  const pages = [];
  P.pages.slice(LIMITES.pages).forEach((pg) => aveux.push({ quoi: 'page', ref: pg.chemin, motif: `${LIMITES.pages} page publique au plus par cycle` }));
  for (const pg of P.pages.slice(0, LIMITES.pages)) {
    const r = await lire('codeur', 'page', pg.chemin, () => lirePage(http, pg.chemin));
    if (!r) continue;
    const fichier = `prive/cycles/${id}/pages/${pg.chemin.slice('/pages/'.length).toLowerCase()}.txt`;
    if (magasin) magasin.ecrirePrive(fichier, r.texte);
    pages.push({ canal: pg.canal ?? null, chemin: pg.chemin, sha256: sha256Texte(r.texte), fichier_prive: magasin ? fichier : null, lu_le: r.lu_le });
  }

  // 6. Sondes SIRENE : un compte chacune.
  const sondes = [];
  for (const s of P.sondes) {
    const r = await lire('sirene', 'sonde', s.recette, () => compter(http, s.params));
    if (r) sondes.push({ recette: s.recette, total: r.total, plafond: r.plafond, lu_le: r.lu_le });
  }

  // 7. Union, santé, série.
  const annonces = unir(rss, liste, details, lu_le);
  const sante = santeParseur([...liste.values()], rss);
  if (!sante.ok) {
    aveux.push({ quoi: 'sante', ref: 'parseur codeur', motif: `parseur en défaut (n = ${sante.n}, rss_n = ${sante.rss_n}, champs nuls ${JSON.stringify(sante.taux_null)}) : relevé non interprétable, ce n'est pas un marché vide` });
  }
  const horsPages = [...details.values()].filter((d) => !annonces.some((a) => a.id === d.id))
    .map((d) => ({ ...d, tags: [], detail: true, hors_pages: true }));
  const points = [...annonces, ...horsPages].map((a) => pointSerie(a, lu_le));
  let serie = null;
  if (magasin && points.length) {
    const fichier = cheminSerie(jour);
    try {
      magasin.ajouterPublicJsonl(fichier, points);
      serie = { fichier, n: points.length, sha256: sha256Texte(magasin.lire(fichier) ?? '') };
    } catch (e) {
      if (!(e instanceof PubliqueRefusee)) throw e;
      aveux.push({ quoi: 'serie', ref: fichier, motif: e.message });
    }
  }
  const requetes = { codeur: avant.codeur - budget.reste('codeur'), sirene: avant.sirene - budget.reste('sirene') };
  let fichier_prive = null;
  if (magasin) {
    fichier_prive = `prive/cycles/${id}/annonces.json`;
    magasin.ecrirePrive(fichier_prive, { lu_le, jour, annonces, rss, details: [...details.values()], suivis, aveux });
  }
  return { lu_le, jour, annonces, suivis, pages, sondes, trou, sante, requetes, aveux, serie, fichier_prive };
}

/**
 * Second passage du même jour (conteneur neuf compris) : si l'acte observation:codeur:<jour> existe, l'observation est
 * relue depuis la série publique, sans aucune requête. Titres, résumés et descriptions sont absents (null). Les champs
 * sante, trou et requetes viennent de l'acte quand il les porte. null si l'acte ou la série manque.
 */
export function rehydrater(magasin, registre, jour) {
  if (!JOUR.test(String(jour))) throw new TypeError(`rehydrater : jour illisible « ${jour} »`);
  const acte = registre?.trouver?.(CLES.observation(jour));
  if (!acte) return null;
  const fichier = typeof acte.fichier === 'string' && /^etat\/(series|marche)\/\d{4}-\d{2}-\d{2}\.jsonl$/.test(acte.fichier) ? acte.fichier : cheminSerie(jour);
  let chemin = fichier, texte = magasin.lire(fichier);
  if (texte === null && fichier === cheminSerie(jour)) { chemin = ANCIEN_CHEMIN(jour); texte = magasin.lire(chemin); }
  if (texte === null) return null;
  const points = lirePoints(texte);
  if (!points.length) return null;
  const t = points.reduce((m, p) => (typeof p.t === 'string' && p.t > m ? p.t : m), '');
  const derniers = points.filter((p) => p.t === t);
  const versAnnonce = (p) => ({
    id: p.id, url: `${BASE}/projects/${p.id}`, titre: null, statut: p.statut ?? null, publie_le: p.publie_le ?? null,
    age_h: p.publie_le ? arrondi(Math.max(0, heuresEntre(p.publie_le, t))) : null,
    budget: { min: p.bmin ?? null, max: p.bmax ?? null, texte: null }, offres: p.offres ?? null, vues: p.vues ?? null,
    interactions: p.interactions ?? null, devis_2h: p.devis_2h_n === null || p.devis_2h_n === undefined ? null : { n: p.devis_2h_n, heures: p.devis_2h_h ?? 2 },
    montant_moyen_devis: p.montant_moyen_devis ?? null, tags: Array.isArray(p.tags) ? p.tags : [], resume: null, description: null, lu_le: t,
  });
  const annonces = derniers.filter((p) => !p.hors_pages).map(versAnnonce);
  const suivis = derniers.filter((p) => p.detail).map((p) => ({ id: p.id, motif: null, statut: p.statut ?? null, offres: p.offres ?? null,
    devis_2h: versAnnonce(p).devis_2h, interactions: p.interactions ?? null, montant_moyen_devis: p.montant_moyen_devis ?? null, vu_le: t,
    ...(p.hors_pages ? { hors_pages: true } : {}) }));
  const sha = sha256Texte(texte);
  return {
    lu_le: t, jour, annonces, suivis, pages: [], sondes: [], trou: typeof acte.trou === 'boolean' ? acte.trou : false,
    sante: acte.sante && typeof acte.sante === 'object' ? acte.sante : santeParseur(annonces, []),
    requetes: { codeur: 0, sirene: 0 }, aveux: [], serie: { fichier: chemin, n: points.length, sha256: sha },
    fichier_prive: null, rehydratee: true, integre: typeof acte.sha256 === 'string' ? acte.sha256 === sha : null,
  };
}
