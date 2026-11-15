// Source de cibles : le registre officiel des entreprises (SIRENE + RNE), via l'API publique « Recherche d'entreprises »
// (recherche-entreprises.api.gouv.fr, gratuite, sans clé, limite ~7 requêtes/s). On reste sous 4 req/s.
const BASE = 'https://recherche-entreprises.api.gouv.fr/search';

export const TRANCHES = { NN: 'non renseigné', '00': '0 salarié', '01': '1-2', '02': '3-5', '03': '6-9', '11': '10-19',
  '12': '20-49', '21': '50-99', '22': '100-199', '31': '200-249', '32': '250-499', '41': '500-999', '42': '1000-1999' };

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function page(params, n, essais = 4) {
  const q = new URLSearchParams({ ...params, page: String(n), per_page: '25', minimal: 'true', include: 'siege,dirigeants,finances' });
  for (let i = 0; i < essais; i++) {
    let r;
    try { r = await fetch(`${BASE}?${q}`); } catch (e) { if (i === essais - 1) throw e; await pause(1000 * 2 ** i); continue; }
    if (r.status === 429 || r.status >= 500) { await pause(1000 * 2 ** i); continue; }
    if (!r.ok) throw new Error(`SIRENE HTTP ${r.status} : ${(await r.text()).slice(0, 200)}`);
    return r.json();
  }
  throw new Error('SIRENE : limite de débit atteinte quatre fois de suite');
}

// Parcourt toutes les pages (plafonnées) d'une requête. Renvoie les fiches brutes et ce qui a été réellement lu.
export async function chercher(params, { maxPages = 250, delaiMs = 260, journal = () => {} } = {}) {
  const premiere = await page(params, 1);
  const total = premiere.total_results, pages = Math.min(premiere.total_pages, maxPages);
  const fiches = [...premiere.results];
  for (let n = 2; n <= pages; n++) {
    await pause(delaiMs);
    fiches.push(...(await page(params, n)).results);
    if (n % 25 === 0) journal(`  ${n}/${pages} pages`);
  }
  return { fiches, total, pages_lues: pages, complet: pages === premiere.total_pages, lu_le: new Date().toISOString() };
}

// Ce que l'on garde d'une fiche : rien d'autre que ce dont le client a besoin pour décider d'appeler.
export function resumer(f) {
  const s = f.siege || {};
  const fin = f.finances ? Object.entries(f.finances).sort(([a], [b]) => b.localeCompare(a))[0] : null;
  const dirigeants = (f.dirigeants || []).filter((d) => d.type_dirigeant === 'personne physique' && !/commissaire/i.test(d.qualite || ''));
  return {
    siren: f.siren, nom: f.nom_complet, naf: f.activite_principale, creation: f.date_creation,
    effectif: TRANCHES[f.tranche_effectif_salarie] ?? f.tranche_effectif_salarie ?? 'non renseigné',
    effectif_annee: s.annee_tranche_effectif_salarie ?? null, categorie: f.categorie_entreprise ?? null,
    adresse: s.adresse ?? null, departement: s.departement ?? null, commune: s.libelle_commune ?? null,
    dirigeants: dirigeants.map((d) => ({ qualite: d.qualite, nom: [d.prenoms?.split(' ')[0], d.nom].filter(Boolean).join(' '), annee_naissance: d.annee_de_naissance ? Number(d.annee_de_naissance) : null })),
    ca: fin ? { annee: Number(fin[0]), ca: fin[1].ca ?? null, resultat_net: fin[1].resultat_net ?? null } : null,
    rge: Boolean(s.liste_rge?.length), etablissements_ouverts: f.nombre_etablissements_ouverts ?? null,
    fiche: `https://annuaire-entreprises.data.gouv.fr/entreprise/${f.siren}`,
  };
}
