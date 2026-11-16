// Tests des sources (M2) : codeur.com (liste, RSS, page détail), SIRENE (résumé, compte, échantillon, lecture complète)
// et OBSERVER (ordre et plafond des lectures, trou, santé du parseur, réhydratation). Aucun accès réseau : la porte
// réseau du socle reçoit un fetch factice, et toutes les données sont fictives (test/fixtures/codeur, test/fixtures/sirene).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerHorloge, creerBudget, creerHttp, creerMagasin, PLAFONDS, BudgetEpuise, sha256Texte } from '../src/socle.js';
import { Registre, CLES } from '../src/registre.js';
import {
  parseListe, parseProjet, parseRss, parseDateFr, budget, ageHeures, lireRss, lireListe, lireProjet, lirePage, collecter, detailler,
  texteDePage, StatutInattendu, santeParseur as santeCodeur,
} from '../src/sources/codeur.js';
import {
  TRANCHES, PARAMS_AUTORISES, resumer, compter, echantillonPages, chercher, tirerPages, departementsDe, ParametreInterdit,
} from '../src/sources/sirene.js';
import { observer, santeParseur, rehydrater, cheminSerie, pointSerie, LIMITES } from '../src/sources/observer.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = (rel) => fs.readFileSync(path.join(RACINE, 'test', 'fixtures', rel), 'utf8');
const dossier = () => fs.mkdtempSync(path.join(os.tmpdir(), 'velyx-sources-'));

/** Porte réseau du socle sur un fetch factice routé par URL ; horloge factice avancée par les attentes polies. */
function reseau(routeur, { depart = '2026-11-15T06:41:00Z', plafonds = PLAFONDS } = {}) {
  const horloge = creerHorloge(depart), budget = creerBudget(plafonds, horloge), appels = [];
  const fetchImpl = async (url) => {
    appels.push(url);
    const r = await routeur(new URL(url));
    if (r instanceof Error) throw r;
    return r ?? new Response('absent', { status: 404 });
  };
  const http = creerHttp({ budget, horloge, fetchImpl, attendre: async (ms) => horloge.avancer(ms), env: {} });
  return { horloge, budget, http, appels, n: (hote) => appels.filter((u) => new URL(u).hostname === hote).length };
}
const html = (corps, status = 200) => new Response(corps, { status, headers: { 'content-type': 'text/html' } });
const json = (corps, status = 200) => new Response(JSON.stringify(corps), { status, headers: { 'content-type': 'application/json' } });

// Gabarits fictifs (même structure que les fixtures, relevée sur les pages publiques du 15/11/2026).
const carte = ({ id, age = 'Il y a 3 heures', statut = 'Ouvert', offres = 5, vues = 100, tags = ['Prospection commerciale'] }) => `
<a class="block group flex" rel="nofollow" aria-label="Annonce fictive ${id}" href="/projects/${id}-annonce-fictive">
  <h3>Annonce fictive ${id}</h3><span class="text-sm text-blue-dark/40 whitespace-nowrap ml-2">
      ${age}
    </span>
  <span class="w-2 h-2 rounded-full mr-1.5 bg-green-400"></span>
      ${statut}
    </span>
  <span title="Budget"><img src="x.svg" />
      500 € à 1 000 €
    </span><span title="Offres">
      ${offres === null ? '— Offres' : `${offres} Offres`}
    </span><span title="Vues">
      ${vues} Vues
    </span>
  <div class="text-blue-dark/70 text-sm line-clamp-3 mt-1">Résumé fictif ${id}</div>
${tags.map((t) => `  <span class="inline-flex gap-1 items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-50">
          ${t}
        </span>`).join('\n')}
</a>`;
const pageListe = (cartes) => `<div class="flex flex-col">${cartes.map(carte).join('\n')}\n</div>`;
const flux = (items) => `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>${items.map(({ id, pub }) => `<item>
  <title>Annonce fictive ${id}</title><link>https://www.codeur.com/projects/${id}-annonce-fictive</link><pubDate>${pub}</pubDate><guid>${id}</guid>
  <description type="html"><![CDATA[<p>Budget : 500 € à 1 000 € - Catégories : Prospection commerciale, Data entry</p> <p> Résumé fictif ${id} … </p>]]></description>
</item>`).join('\n')}</channel></rss>`;
const detail = ({ statut = 'Ouvert', offres = 6, vues = 300, interactions = 4, pub = '14 novembre 2026 à 09h15', devis = 3, montant = null }) => `
<h1 class="text-3xl">Annonce fictive</h1>
<p class="font-medium mb-0 flex flex-wrap">
  <span class="whitespace-nowrap"><svg class="x"><use xlink:href="#c" /></svg> ${statut}</span>
  <span data-controller="tooltip" title="Budget indicatif" class="whitespace-nowrap">500 € à 1 000 €</span>
  <span data-controller="tooltip" title="Nombre d'offres" class="whitespace-nowrap">${offres} offres</span>
  <span class="whitespace-nowrap">${vues} vues</span>
  <span class="whitespace-nowrap">${interactions} interactions</span>
</p>
<div class="project-description break-words"><div class="content"><p>Description fictive confidentielle</p></div></div>
<div class="project-details mt-6">
  <span class="pt-1">Publication : <span class="font-semibold">${pub}</span></span>
</div>
<p class="font-medium">
  ${devis} propositions de devis en moins de 2h
</p>
${montant === null ? '' : `<span class="pt-1">Montant moyen des devis proposés : <span class="font-semibold">${montant} €</span></span>`}`;

// --- codeur.com : parseurs ---------------------------------------------------------------------------------------------

test('codeur v1 : parseListe lit chaque champ sans rien deviner (fixture fictive)', () => {
  const L = parseListe(fixture('codeur/liste.html'));
  assert.deepEqual(L.map((x) => x.id), ['491001', '491002', '491003']);
  const [a, b, c] = L;
  assert.equal(a.statut, 'Ouvert');
  assert.equal(a.age_h, 3);
  assert.deepEqual([a.budget.min, a.budget.max], [500, 1000]);
  assert.equal(a.offres, 5);
  assert.equal(a.vues, 120);
  assert.deepEqual(a.tags, ['Prospection commerciale', 'Data entry']);
  assert.equal(a.url, 'https://www.codeur.com/projects/491001-fichier-fictif-de-prospects-btp');
  assert.equal(b.statut, 'En cours');
  assert.deepEqual([b.budget.min, b.budget.max], [0, 500], '« Moins de 500 € »');
  assert.equal(c.statut, 'Fermé');
  assert.equal(c.age_h, 168);
  assert.equal(c.budget.min, null, '« À définir »');
  assert.equal(budget('À définir').min, null);
  assert.equal(ageHeures('hier'), null);
});

test('parseProjet sur l’extrait figé de 492531 : Ouvert, 4 offres, 6592 vues, 9 interactions, devis {3, 2 h}, pas de montant', () => {
  const p = parseProjet(fixture('codeur/projet-492531.html'));
  assert.equal(p.statut, 'Ouvert');
  assert.equal(p.offres, 4);
  assert.equal(p.vues, 6592);
  assert.equal(p.interactions, 9);
  assert.equal(p.publie_le, '2026-11-07T15:31:00.000Z');
  assert.deepEqual(p.devis_2h, { n: 3, heures: 2 });
  assert.equal(p.montant_moyen_devis, null, 'absent : null, jamais 0');
  assert.match(p.description, /^Texte inventé pour les tests/);
  assert.ok(!p.description.includes('>'), 'un attribut contenant « > » ne laisse pas de débris de balise');
  assert.deepEqual([p.budget.min, p.budget.max], [1000, 10000]);
});

test('parseProjet sur l’extrait figé de 492955 : 15 offres, 552 vues, 7 interactions, devis {15, 2 h}, montant moyen 1 500 €', () => {
  const p = parseProjet(fixture('codeur/projet-492955.html'));
  assert.equal(p.statut, 'Ouvert');
  assert.equal(p.offres, 15);
  assert.equal(p.vues, 552);
  assert.equal(p.interactions, 7);
  assert.deepEqual(p.devis_2h, { n: 15, heures: 2 });
  assert.equal(p.montant_moyen_devis, 1500);
  assert.equal(p.publie_le, '2026-11-15T20:06:00.000Z');
});

test('parseProjet : une page remaniée donne des null, jamais des 0', () => {
  const p = parseProjet('<html><body><div class="nouveau-gabarit">4 offres · 6592 vues</div></body></html>');
  for (const k of ['statut', 'offres', 'vues', 'interactions', 'publie_le', 'devis_2h', 'montant_moyen_devis', 'description', 'budget']) assert.equal(p[k], null, k);
  assert.equal(parseProjet(detail({ statut: 'Attribué' })).statut, null, 'statut inconnu : illisible');
  assert.equal(parseProjet(detail({ statut: 'Fermé' })).statut, 'Fermé');
  assert.deepEqual(parseProjet(detail({ devis: 1 }).replace('propositions', 'proposition')).devis_2h, { n: 1, heures: 2 }, 'singulier');
});

test('parseDateFr : heure de Paris (hiver et été) vers ISO UTC, null sinon', () => {
  assert.equal(parseDateFr('07 novembre 2026 à 16h31'), '2026-11-07T15:31:00.000Z');
  assert.equal(parseDateFr('15 juillet 2026 à 10h00'), '2026-07-15T08:00:00.000Z');
  assert.equal(parseDateFr('1er mars 2026 à 9h05'), '2026-03-01T08:05:00.000Z');
  assert.equal(parseDateFr('15 août 2026 à 12h'), '2026-08-15T10:00:00.000Z', 'accents et minutes absentes');
  assert.equal(parseDateFr('31 février 2026 à 10h00'), null, 'date inexistante');
  assert.equal(parseDateFr('07 novembre 2026'), null, 'heure absente : pas de fausse précision');
  assert.equal(parseDateFr('07 brumaire 2026 à 16h31'), null);
  assert.equal(parseDateFr(null), null);
});

test('parseRss (2 items) : id = guid, pubDate +0100 en ISO UTC, catégories découpées hors parenthèses', () => {
  const [a, b] = parseRss(fixture('codeur/rss.xml'));
  assert.equal(a.id, '492955');
  assert.equal(a.publie_le, '2026-11-15T20:06:22.000Z');
  assert.deepEqual([a.budget.min, a.budget.max], [500, 1000]);
  assert.deepEqual(a.categories, ['Rédaction', 'Community management', 'Marketing']);
  assert.match(a.resume, /^Texte inventé/);
  assert.equal(b.id, '492954', 'guid avec attribut isPermaLink');
  assert.equal(b.publie_le, '2026-11-15T18:32:34.000Z');
  assert.deepEqual(b.categories, ['Charte graphique', 'Publicité', 'Print (flyer, plaquette, affiche...)']);
  assert.equal(b.titre, 'Flyer recto/verso fictif d\'une offre', 'entités décodées');
  assert.equal(b.url, 'https://www.codeur.com/projects/492954', 'un lien hors codeur.com est remplacé par l’URL canonique');
});

test('texteDePage : scripts et styles retirés, une ligne par bloc', () => {
  const t = texteDePage('<html><head><title>x</title><script>var a = 1;</script></head><body><style>p{}</style><h1>CGU</h1><p>Article 1 &amp; 2</p><p>Fin</p></body></html>');
  assert.equal(t, 'CGU\nArticle 1 & 2\nFin');
});

// --- codeur.com : lectures par la porte réseau ------------------------------------------------------------------------

test('lectures codeur : RSS, liste, détail, page publique ; 404 → StatutInattendu ; chemins hors liste refusés', async () => {
  const c = reseau((u) => {
    if (u.pathname === '/projects.rss') return html(fixture('codeur/rss.xml'));
    if (u.pathname === '/projects' && u.search === '?page=2') return html(fixture('codeur/liste.html'));
    if (u.pathname === '/projects/492955-x') return html(fixture('codeur/projet-492955.html'));
    if (u.pathname === '/pages/cgu') return html('<h1>Conditions</h1><p>Texte fictif</p>');
    return null;
  });
  const rss = await lireRss(c.http);
  assert.equal(rss.length, 2);
  assert.ok(rss.every((x) => x.lu_le === '2026-11-15T06:41:00.000Z'));
  const L = await lireListe(c.http, 2);
  assert.deepEqual([L.length, L[0].page], [3, 2]);
  await assert.rejects(lireListe(c.http, 6), RangeError, 'robots.txt : pages 1 à 5 seulement');
  const d = await lireProjet(c.http, 'https://www.codeur.com/projects/492955-x');
  assert.deepEqual([d.id, d.offres, d.montant_moyen_devis], ['492955', 15, 1500]);
  await assert.rejects(lireProjet(c.http, 'https://www.codeur.com/projects/1-absent'), StatutInattendu);
  await assert.rejects(lireProjet(c.http, 'https://exemple.invalid/projects/1'), TypeError);
  const p = await lirePage(c.http, '/pages/cgu');
  assert.equal(p.texte, 'Conditions\nTexte fictif');
  await assert.rejects(lirePage(c.http, '/users/sign_in'), TypeError);
  assert.equal(c.n('www.codeur.com'), 5, 'aucun appel pour les demandes refusées avant le réseau');
});

test('compatibilité v1 : collecter et detailler passent par la porte réseau injectée', async () => {
  const sansVues = detail({ offres: 9 }).replace(/<span class="whitespace-nowrap">\d+ vues<\/span>/, '');
  const c = reseau((u) => (u.pathname === '/projects' ? html(fixture('codeur/liste.html')) : u.pathname.startsWith('/projects/') ? html(sansVues) : null));
  const L = await collecter({ pages: 2, http: c.http });
  assert.equal(L.length, 3, 'annonces distinctes des deux pages');
  assert.equal(c.n('www.codeur.com'), 2);
  const d = await detailler(L[0], { http: c.http });
  assert.equal(d.offres, 9, 'le détail, plus récent, prime');
  assert.equal(d.interactions, 4);
  assert.equal(d.vues, 120, 'un champ illisible du détail n’efface pas celui de la liste');
  assert.equal(d.description, 'Description fictive confidentielle');
});

// --- SIRENE ------------------------------------------------------------------------------------------------------------

const BRUTES = JSON.parse(fixture('sirene/fiches-brutes.json'));
const cles = (x, out = new Set()) => {
  if (Array.isArray(x)) x.forEach((v) => cles(v, out));
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { out.add(k); cles(v, out); }
  return out;
};

test('resumer garde opposition, nature juridique, état, diffusion et 3 exercices ; ni date de naissance, ni nationalité, ni adresse', () => {
  const [a, b, c] = BRUTES.map(resumer);
  assert.equal(a.opposition, true);
  assert.equal(a.nature_juridique, '5710');
  assert.equal(a.etat_administratif, 'A');
  assert.equal(a.fermee, false);
  assert.equal(a.statut_diffusion, 'O');
  assert.deepEqual(a.dirigeants, [{ qualite: 'Président de SAS', nom: 'Anatole IMAGINOR', annee_naissance: 1958 }], 'commissaires aux comptes écartés');
  assert.equal(a.dirigeants_pm, 1, 'dirigeant personne morale compté, commissaire aux comptes personne morale écarté');
  assert.deepEqual(a.finances.map((f) => f.annee), [2025, 2024, 2023], '3 exercices au plus, du plus récent');
  assert.deepEqual(a.ca, a.finances[0]);
  assert.deepEqual([a.effectif, a.effectif_code, a.effectif_annee], ['6-9', '03', 2023]);
  assert.deepEqual(a.idcc, ['1597']);
  assert.equal(a.rge, true);
  assert.equal(b.fermee, true, 'cessée (état C, date de fermeture)');
  assert.equal(b.statut_diffusion, 'P');
  assert.deepEqual([b.finances, b.ca, b.idcc], [[], null, []]);
  assert.equal(c.nature_juridique, '1000');
  assert.equal(c.ca.resultat_net, null, 'champ absent : null');
  for (const e of [a, b, c]) {
    const k = cles(e);
    for (const interdit of ['date_de_naissance', 'nationalite', 'adresse', 'prenoms', 'nom_complet']) assert.ok(!k.has(interdit), interdit);
  }
  assert.equal(resumer({ siren: '1', nom_complet: 'X' }).fermee, false, 'état inconnu : pas « fermée »');
  assert.equal(TRANCHES['03'], '6-9');
  assert.ok(PARAMS_AUTORISES.includes('q') && PARAMS_AUTORISES.includes('est_rge'));
});

/** Faux SIRENE : total par requête (selon le département), 25 fiches fictives par page. */
function faussesirene(totalDe) {
  return (u) => {
    if (u.hostname !== 'recherche-entreprises.api.gouv.fr') return null;
    const q = Object.fromEntries(u.searchParams), total = totalDe(q), parPage = Number(q.per_page), page = Number(q.page);
    if (page > 400) return json({ erreur: 'page' }, 400);
    const n = Math.max(0, Math.min(parPage, total - (page - 1) * parPage));
    const results = Array.from({ length: n }, (_, i) => ({ siren: `${q.departement ?? 'xx'}-${page}-${i}`, nom_complet: 'FICTIVE' }));
    return json({ results, total_results: total, page, per_page: parPage, total_pages: Math.ceil(total / parPage) });
  };
}

test('compter : exactement 1 requête (per_page=1) ; plafond à 10 000', async () => {
  const c = reseau(faussesirene(() => 9999));
  assert.deepEqual(await compter(c.http, { activite_principale: '62.02A' }).then((r) => [r.total, r.total_pages, r.plafond]), [9999, 400, false]);
  assert.equal(c.n('recherche-entreprises.api.gouv.fr'), 1);
  assert.equal(new URL(c.appels[0]).searchParams.get('per_page'), '1');
  const d = reseau(faussesirene(() => 10_000));
  assert.equal((await compter(d.http, { departement: '69' })).plafond, true);
  await assert.rejects(compter(d.http, { siret: '1' }), ParametreInterdit, 'paramètre hors liste refusé avant tout appel');
  assert.equal(d.n('recherche-entreprises.api.gouv.fr'), 1);
});

test('echantillonPages : même graine, mêmes pages ; k = 2 → 2 requêtes ; tirage parmi 400 pages au plus', async () => {
  const c = reseau(faussesirene(() => 6800));
  const a = await echantillonPages(c.http, { departement: '69' }, { k: 2, graine: 'R-2026-11-15-1', total_pages: 272 });
  assert.equal(c.n('recherche-entreprises.api.gouv.fr'), 2);
  assert.equal(a.pages.length, 2);
  assert.equal(a.fiches.length, 50);
  assert.equal(a.total, 6800);
  assert.deepEqual(tirerPages(272, 2, 'R-2026-11-15-1'), a.pages, 'reproductible');
  assert.deepEqual(tirerPages(272, 2, 'R-2026-11-15-1'), tirerPages(272, 2, 'R-2026-11-15-1'));
  assert.notDeepEqual(tirerPages(272, 5, 'graine-a'), tirerPages(272, 5, 'graine-b'));
  const grand = tirerPages(10_000, 50, 'g');
  assert.ok(grand.every((p) => p >= 1 && p <= 400) && new Set(grand).size === 50, 'sans remise, ≤ 400');
  assert.deepEqual(tirerPages(3, 10, 'g'), [1, 2, 3]);
  assert.throws(() => tirerPages(10, 2), TypeError, 'graine requise');
});

test('chercher : 272 pages pour maxRequetes = 200 → BudgetEpuise avant la première page', async () => {
  const c = reseau(faussesirene(() => 6800));
  await assert.rejects(chercher(c.http, { departement: '69' }, { maxRequetes: 200 }), BudgetEpuise);
  assert.equal(c.n('recherche-entreprises.api.gouv.fr'), 1, 'seul le compte a été lu');
  assert.equal(new URL(c.appels[0]).searchParams.get('per_page'), '1');
});

test('chercher : partition par département au plafond ; somme des partitions ≠ total → complet = false', async () => {
  const deps = { 69: 30, 38: 20 };
  // Au plafond (10 000) : partition automatique ; 50 < 10 000 → incomplet.
  const c = reseau(faussesirene((q) => (q.departement && !q.departement.includes(',') ? deps[q.departement] : 10_000)));
  const r = await chercher(c.http, { departement: '69,38' }, { maxRequetes: 20 });
  assert.deepEqual(r.totaux_partition, { 69: 30, 38: 20 });
  assert.equal(r.total, 10_000);
  assert.equal(r.complet, false);
  assert.equal(r.fiches.length, 50);
  assert.equal(r.requetes, 1 + 2 + 2 + 1, 'compte, 2 comptes de partition, pages 2 + 1');
  // Sous le plafond, pas de partition automatique.
  const d = reseau(faussesirene(() => 60));
  const s = await chercher(d.http, { departement: '69,38' });
  assert.equal(s.totaux_partition, null);
  assert.equal(s.complet, true);
  assert.equal(s.fiches.length, 60);
  // Partition forcée : 30 + 20 ≠ 60 → incomplet ; 40 + 20 = 60 → complet.
  const e = reseau(faussesirene((q) => (q.departement === '69' ? 30 : q.departement === '38' ? 20 : 60)));
  assert.equal((await chercher(e.http, { departement: '69,38' }, { partition: 'departement' })).complet, false);
  const f = reseau(faussesirene((q) => (q.departement === '69' ? 40 : q.departement === '38' ? 20 : 60)));
  assert.equal((await chercher(f.http, { departement: '69,38' }, { partition: 'departement' })).complet, true);
  assert.deepEqual(departementsDe({ region: '11' }), ['75', '77', '78', '91', '92', '93', '94', '95']);
});

test('chercher : reprise sans nouvelle requête de page ; v1 chercher(params, {maxPages}) conservé', async () => {
  const c = reseau(faussesirene(() => 60)), reprise = {};
  await chercher(c.http, { departement: '69' }, { reprise });
  const avant = c.n('recherche-entreprises.api.gouv.fr');
  assert.equal(avant, 4, '1 compte + 3 pages');
  assert.equal(Object.keys(reprise).length, 3, 'chaque page lue est gardée pour la reprise');
  const d = reseau(faussesirene(() => 60)), rep = {};
  await chercher(d.http, { departement: '69' }, { reprise: rep });
  const e = reseau(faussesirene(() => 60));
  const s = await chercher(e.http, { departement: '69' }, { reprise: rep });
  assert.equal(e.n('recherche-entreprises.api.gouv.fr'), 1, 'pages relues depuis la reprise : seul le compte est refait');
  assert.equal(s.pages_lues, 3);
  const v = reseau(faussesirene(() => 60));
  const v1 = await chercher({ departement: '69' }, { maxPages: 2, http: v.http });
  assert.deepEqual([v1.fiches.length, v1.total, v1.pages_lues, v1.complet], [50, 60, 2, false]);
  assert.equal(v.n('recherche-entreprises.api.gouv.fr'), 2);
});

// --- OBSERVER ----------------------------------------------------------------------------------------------------------

/** Monde fictif : RSS, 5 pages de liste, détails, une page publique et l'API SIRENE. */
function monde({ rssItems, pages, rss403 = false }) {
  return (u) => {
    if (u.hostname === 'recherche-entreprises.api.gouv.fr') return faussesirene(() => 42)(u);
    if (u.pathname === '/projects.rss') return rss403 ? html('interdit', 403) : html(flux(rssItems));
    if (u.pathname === '/projects') { const p = Number(new URLSearchParams(u.search).get('page') ?? 1); return html(pages[p] ?? pageListe([])); }
    const m = /^\/projects\/(\d+)/.exec(u.pathname);
    if (m?.[1] === '480009') return html('retiré', 404);
    if (m) return html(detail({ offres: Number(m[1]) % 50, interactions: 3, montant: m[1] === '491001' ? '1 500' : null }));
    if (u.pathname === '/pages/cgu-codeur') return html('<h1>CGU fictives</h1><p>Article premier fictif</p>');
    return null;
  };
}
const ids = (debut, n) => Array.from({ length: n }, (_, i) => String(debut + i));

test('observer : au plus 10 lectures codeur ; trou → p3 ; suivi hors pages relu en détail ; 5e détail refusé et consigné', async () => {
  const r = dossier(), magasin = creerMagasin(r);
  magasin.ajouterPublicJsonl('etat/series/2026-11-14.jsonl', [{ id: '490001', t: '2026-11-14T06:41:00.000Z', statut: 'Ouvert', offres: 3, vues: 10,
    interactions: null, devis_2h_n: null, bmin: 500, bmax: 1000, tags: [], publie_le: '2026-11-13T09:00:00.000Z' }]);
  const rssItems = ids(491001, 6).map((id, i) => ({ id, pub: `Sat, 14 Nov 2026 ${String(12 + i).padStart(2, '0')}:00:00 +0100` }));
  const pages = {
    1: pageListe(ids(491001, 3).map((id) => ({ id }))),
    2: pageListe(ids(491004, 3).map((id) => ({ id, age: 'Il y a 20 heures' }))),
    3: pageListe(ids(491101, 2).map((id) => ({ id, age: 'Il y a 1 jour' }))),
    4: pageListe(ids(491201, 2).map((id) => ({ id, age: 'Il y a 3 jours' }))),
    5: pageListe(ids(491301, 2).map((id) => ({ id, age: 'Il y a 5 jours' }))),
  };
  const c = reseau(monde({ rssItems, pages }));
  const ctx = { jour: '2026-11-15', id: 'C-2026-11-15', horloge: c.horloge, budget: c.budget, http: c.http, magasin };
  const plan = {
    jour: '2026-11-15',
    suivis: [{ id: '491002', motif: 'donnees' }, { id: '480001', motif: 'pari', url: 'https://www.codeur.com/projects/480001-ancienne' },
      { id: '491001', motif: 'revue' }, { id: '491003', motif: 'prevision' }, { id: '491005', motif: 'donnees' }],
    candidats: [{ id: '491006' }],
    pages: [{ canal: 'codeur', chemin: '/pages/cgu-codeur' }, { canal: 'codeur', chemin: '/pages/tarifs-codeur-com' }],
    sondes: [{ recette: 'btp-creations-zone', params: { activite_principale: '43.99C', departement: '69' } }],
  };
  const obs = await observer(ctx, plan);
  const codeur = c.appels.filter((u) => u.includes('www.codeur.com'));
  assert.ok(codeur.length <= 10, `au plus 10 lectures codeur (${codeur.length})`);
  assert.equal(obs.requetes.codeur, codeur.length);
  assert.equal(obs.requetes.sirene, 1, 'une sonde = un compte');
  assert.equal(obs.trou, true, 'le plus vieil item RSS est postérieur à la dernière annonce vue');
  assert.ok(codeur.includes('https://www.codeur.com/projects?page=3'), 'le trou déclenche p3');
  assert.ok(codeur.includes('https://www.codeur.com/projects?page=4'));
  assert.ok(!codeur.includes('https://www.codeur.com/projects?page=5'), 'trou comblé dès que l’âge affiché atteint la dernière vue');
  // Suivis triés par motif (revue, pari, prévision, données) ; 4 détails au plus.
  assert.deepEqual(obs.suivis.map((s) => s.id), ['491001', '480001', '491003', '491002', '491005']);
  const hors = obs.suivis.find((s) => s.id === '480001');
  assert.equal(hors.hors_pages, true);
  assert.ok(codeur.includes('https://www.codeur.com/projects/480001-ancienne'), 'suivi absent des pages relu en détail');
  assert.deepEqual([hors.statut, hors.offres, hors.interactions], ['Ouvert', 480001 % 50, 3]);
  const cinquieme = obs.suivis.find((s) => s.id === '491005');
  assert.equal(cinquieme.vu_le, null);
  assert.ok(obs.aveux.some((a) => a.quoi === 'detail' && a.ref === '491005' && /budget épuisé : details/.test(a.motif)), 'refus consigné');
  assert.ok(obs.aveux.some((a) => a.quoi === 'detail' && a.ref === '491006'), 'candidat refusé et consigné');
  assert.ok(!codeur.some((u) => u.includes('491005')));
  assert.equal(obs.suivis.find((s) => s.id === '491001').montant_moyen_devis, 1500);
  // Page publique : 1 au plus ; la seconde est consignée.
  assert.equal(obs.pages.length, 1);
  assert.equal(obs.pages[0].fichier_prive, 'prive/cycles/C-2026-11-15/pages/cgu-codeur.txt');
  assert.equal(obs.pages[0].sha256, sha256Texte(magasin.lire(obs.pages[0].fichier_prive)));
  assert.ok(obs.aveux.some((a) => a.quoi === 'page' && a.ref === '/pages/tarifs-codeur-com'));
  assert.deepEqual(obs.sondes.map((s) => [s.recette, s.total, s.plafond]), [['btp-creations-zone', 42, false]]);
  // Union RSS ∪ pages par id ; âge exact depuis pubDate.
  const a = obs.annonces.find((x) => x.id === '491001');
  assert.equal(a.publie_le, '2026-11-14T11:00:00.000Z');
  assert.equal(a.age_h, 19.68);
  assert.deepEqual(a.sources, ['rss', 'liste', 'detail']);
  assert.equal(obs.sante.ok, true);
  assert.equal(obs.sante.n, 10);
  // Série publique sans texte libre ; textes dans prive/.
  const serie = magasin.lire(cheminSerie('2026-11-15'));
  assert.equal(obs.serie.fichier, 'etat/series/2026-11-15.jsonl');
  assert.equal(obs.serie.sha256, sha256Texte(serie));
  assert.ok(!/Annonce fictive|Résumé fictif|Description fictive/.test(serie), 'ni titre, ni résumé, ni description en public');
  assert.ok(serie.includes('"id":"480001"') && serie.includes('"hors_pages":true'), 'le suivi hors pages entre dans la série');
  const prive = JSON.parse(magasin.lire(obs.fichier_prive));
  assert.ok(prive.annonces.some((x) => x.titre === 'Annonce fictive 491001'));
  assert.ok(prive.details.some((x) => x.description === 'Description fictive confidentielle'));
});

test('observer : sans trou, ni p3 ni plus ; 403 → codeur arrêté pour le cycle, lectures suivantes consignées', async () => {
  const r = dossier(), magasin = creerMagasin(r);
  const rssItems = ids(491001, 3).map((id) => ({ id, pub: 'Sun, 15 Nov 2026 06:00:00 +0100' }));
  const pages = { 1: pageListe(ids(491001, 3).map((id) => ({ id }))), 2: pageListe([]) };
  const c = reseau(monde({ rssItems, pages }));
  const obs = await observer({ jour: '2026-11-15', horloge: c.horloge, budget: c.budget, http: c.http, magasin },
    { derniere_vue: '2026-11-15T05:30:00.000Z', suivis: [{ id: '480009', motif: 'pari', url: 'https://www.codeur.com/projects/480009-titre-qui-nomme-le-client' }] });
  assert.equal(obs.trou, false);
  assert.equal(c.n('www.codeur.com'), 4, 'RSS + p1 + p2 + le détail suivi');
  const retire = obs.aveux.find((a) => a.ref === '480009');
  assert.match(retire.motif, /projects\/480009 → HTTP 404/);
  assert.ok(!retire.motif.includes('client'), 'un aveu ne garde pas le slug (titre de l’annonce)');
  assert.deepEqual(obs.suivis.map((x) => [x.id, x.vu_le]), [['480009', null]]);
  const d = reseau(monde({ rssItems, pages, rss403: true }));
  const bloque = await observer({ jour: '2026-11-15', horloge: d.horloge, budget: d.budget, http: d.http }, { suivis: [{ id: '491001', motif: 'pari' }] });
  assert.equal(d.n('www.codeur.com'), 1, 'aucune lecture après un 403');
  assert.equal(bloque.requetes.codeur, 1);
  assert.ok(bloque.aveux.filter((a) => /non lu : codeur a répondu HTTP 403/.test(a.motif)).length >= 3);
  assert.equal(bloque.sante.ok, false, 'rien lu : aveu, pas « marché vide »');
  assert.ok(bloque.aveux.some((a) => a.quoi === 'sante'));
});

test('observer : panne réseau sur codeur → source coupée après la 1re URL en échec ; le budget du jour reste au passage suivant', async () => {
  const rssItems = ids(491001, 3).map((id) => ({ id, pub: 'Sun, 15 Nov 2026 06:00:00 +0100' }));
  const pages = { 1: pageListe(ids(491001, 3).map((id) => ({ id }))), 2: pageListe([]) };
  const panne = (u) => (u.hostname === 'www.codeur.com' ? new TypeError('fetch failed') : monde({ rssItems, pages })(u));
  const c = reseau(panne);
  const obs = await observer({ jour: '2026-11-15', horloge: c.horloge, budget: c.budget, http: c.http }, { suivis: [{ id: '491001', motif: 'pari' }], pages: [{ canal: 'codeur', chemin: '/pages/cgu-codeur' }] });
  assert.equal(obs.requetes.codeur, 4, 'les 4 essais de la première URL seulement (RSS), pas 10');
  assert.equal(c.budget.reste('codeur'), PLAFONDS.codeur - 4);
  assert.ok(obs.aveux.filter((a) => /non lu : codeur en panne/.test(a.motif)).length >= 3, 'liste, détail et page : non lus, consignés');
  assert.equal(obs.sante.ok, false);
});

test('santé : HTML remanié (0 annonce) → ok = false ; 30 % d’offres illisibles → false ; 10 % → true', async () => {
  const c = reseau(monde({ rssItems: ids(491001, 3).map((id) => ({ id, pub: 'Sun, 15 Nov 2026 06:00:00 +0100' })), pages: { 1: '<main class="refonte">annonces</main>', 2: '<main></main>' } }));
  const obs = await observer({ jour: '2026-11-15', horloge: c.horloge, budget: c.budget, http: c.http }, {});
  assert.equal(obs.sante.ok, false);
  assert.deepEqual([obs.sante.n, obs.sante.rss_n], [0, 3]);
  assert.equal(obs.annonces.length, 3, 'les items RSS restent, sans être pris pour un marché vide');
  assert.ok(obs.aveux.some((a) => a.quoi === 'sante' && /pas un marché vide/.test(a.motif)));
  const annonces = (nuls) => Array.from({ length: 10 }, (_, i) => ({ id: String(i), statut: 'Ouvert', age_h: 1, offres: i < nuls ? null : 4 }));
  assert.equal(santeParseur(annonces(3), [{}]).ok, false);
  assert.equal(santeParseur(annonces(3), [{}]).taux_null.offres, 0.3);
  assert.equal(santeParseur(annonces(1), [{}]).ok, true);
  assert.equal(santeParseur(annonces(0), []).ok, false, 'RSS vide');
  assert.deepEqual(santeParseur([], [{}]).taux_null, { offres: null, statut: null, age_h: null });
  assert.deepEqual(Object.keys(pointSerie({ id: '1', budget: { min: 1, max: 2 }, tags: ['x'], titre: 'non', resume: 'non' }, 't')).sort(),
    ['age_h', 'bmax', 'bmin', 'devis_2h_n', 'famille', 'id', 'interactions', 'offres', 'publie_le', 'statut', 't', 'tags', 'vues']);
  const pt = pointSerie({ id: '2', age_h: 72, tags: ['Prospection commerciale'], titre: 'Constituer une liste fictive', resume: 'non' }, 't');
  assert.deepEqual([pt.age_h, pt.famille, pt.titre, pt.resume], [72, 'donnees', undefined, undefined], 'âge lu en liste et famille gardés ; aucun texte');
  assert.equal(LIMITES.details, 4);
  assert.equal(santeParseur, santeCodeur, 'une seule définition, réexportée par observer.js');
});

test('rehydrater : second cycle du même jour dans un conteneur neuf → 0 requête codeur', async () => {
  const r = dossier(), magasin = creerMagasin(r);
  const rssItems = ids(491001, 3).map((id) => ({ id, pub: 'Sun, 15 Nov 2026 06:00:00 +0100' }));
  const c = reseau(monde({ rssItems, pages: { 1: pageListe(ids(491001, 3).map((id) => ({ id }))) } }));
  const obs = await observer({ jour: '2026-11-15', id: 'C-2026-11-15', horloge: c.horloge, budget: c.budget, http: c.http, magasin },
    { suivis: [{ id: '491002', motif: 'pari' }] });
  const journal = path.join(r, 'registre', 'journal.jsonl');
  assert.equal(rehydrater(magasin, new Registre(journal), '2026-11-15'), null, 'sans acte d’observation : rien à réhydrater');
  // Ce que M12 consigne.
  new Registre(journal).ajouter({ type: 'observation', cle: CLES.observation('2026-11-15'), source: 'codeur.com, pages publiques', mesure: { n: obs.serie.n },
    fichier: obs.serie.fichier, sha256: obs.serie.sha256, sante: obs.sante, requetes: obs.requetes, trou: obs.trou });
  // Conteneur neuf : prive/ a disparu, etat/ et registre/ (git) restent ; aucune porte réseau n'est fournie.
  fs.rmSync(path.join(r, 'prive'), { recursive: true, force: true });
  const neuf = creerMagasin(r), budget = creerBudget(PLAFONDS, creerHorloge('2026-11-15T12:00:00Z'));
  const re = rehydrater(neuf, new Registre(journal), '2026-11-15');
  assert.ok(re);
  assert.deepEqual(re.requetes, { codeur: 0, sirene: 0 });
  assert.equal(budget.reste('codeur'), 10);
  assert.equal(re.rehydratee, true);
  assert.equal(re.integre, true, 'série identique à celle consignée');
  assert.deepEqual(re.annonces.map((a) => a.id).sort(), obs.annonces.map((a) => a.id).sort());
  assert.ok(re.annonces.every((a) => a.titre === null && a.resume === null && a.description === null), 'descriptions absentes');
  assert.deepEqual(re.sante, obs.sante);
  const suivi = re.suivis.find((s) => s.id === '491002');
  assert.deepEqual([suivi.offres, suivi.interactions, suivi.devis_2h], [491002 % 50, 3, { n: 3, heures: 2 }]);
  assert.equal(re.annonces.find((a) => a.id === '491002').offres, 491002 % 50, 'le détail lu prime sur la liste');
});

// Échec fermé : si l'API cesse de renvoyer opposition_diffusion_commerciale ou statut_diffusion (champ retiré ou renommé),
// la fiche n'est jamais lue « sans opposition » : null, exclue par G4 et G11, et L5 signale le champ manquant.
test('resumer : opposition et statut_diffusion absents → null (jamais false) ; G4 exclut, L5 bloque la liste', async () => {
  const { resumer: resumerFiche } = await import('../src/sources/sirene.js');
  const { controlerListe, listeBloquee } = await import('../src/controles.js');
  const brutes = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'sirene', 'fiches-brutes.json'), 'utf8'));
  const opposee = brutes.find((f) => f.opposition_diffusion_commerciale === true);
  assert.ok(opposee, 'la fixture contient une fiche opposée');
  const sans = brutes.map(({ opposition_diffusion_commerciale, statut_diffusion, ...reste }) => reste).map(resumerFiche);
  assert.ok(sans.every((e) => e.opposition === null && e.statut_diffusion === null));
  const r = controlerListe(sans, { complet: true }, { cible_taille: 'toutes' }, { oppositions: new Set() });
  assert.equal(r.retenues.length, 0, 'aucune fiche retenue sans le champ opposition');
  assert.ok(!r.retenues.some((e) => e.siren === opposee.siren));
  assert.equal(r.compte.par_controle.G4, sans.length);
  const l5 = r.resultats.find((x) => x.code === 'L5');
  assert.equal(l5.ok, false);
  assert.match(l5.motif, /opposition/);
  assert.match(l5.motif, /statut_diffusion/);
  assert.equal(listeBloquee(r.resultats), true);
  // Champ non booléen (renommé en texte, par exemple) : null aussi, pas Boolean('non') === true ni false.
  assert.equal(resumerFiche({ ...brutes[0], opposition_diffusion_commerciale: 'non' }).opposition, null);
  // Témoin : champs présents → la fiche opposée est exclue, les autres sont lues telles quelles.
  const avec = controlerListe(brutes.map(resumerFiche), { complet: true }, { cible_taille: 'toutes' }, { oppositions: new Set() });
  assert.equal(avec.retenues.some((e) => e.siren === opposee.siren), false);
  assert.equal(avec.resultats.find((x) => x.code === 'L5').ok, true);
});
