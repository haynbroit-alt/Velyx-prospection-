// Source de demande réelle : les projets publiés sur codeur.com par des clients, avec budget et concurrence.
// Lecture seule, quelques pages, une pause entre chaque : on lit un marché, on ne l'aspire pas.
const BASE = 'https://www.codeur.com';
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
  const t = (txt || '').replace(/\s/g, '').replace(/ /g, '');
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

export function parseProjet(html) {
  const desc = /<div[^>]*class="[^"]*project-description[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(html)
    || /<meta name="description" content="([^"]*)"/.exec(html);
  return { description: desc ? nettoie(desc[1]) : null };
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function lire(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; lecture ponctuelle)' } });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.text();
}

export async function collecter({ pages = 3, delaiMs = 1200 } = {}) {
  const vus = new Map();
  for (let p = 1; p <= pages; p++) {
    const html = await lire(`${BASE}/projects${p > 1 ? `?page=${p}` : ''}`);
    for (const x of parseListe(html)) if (!vus.has(x.id)) vus.set(x.id, x);
    if (p < pages) await pause(delaiMs);
  }
  return [...vus.values()];
}

export async function detailler(projet) {
  return { ...projet, ...parseProjet(await lire(projet.url)) };
}
