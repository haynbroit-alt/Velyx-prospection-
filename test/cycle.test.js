// Tests du cycle (M11) : 15 étapes sur des fixtures FICTIVES, hors réseau (fetch factice routé par URL), dans un dossier
// temporaire. Rien n'est lu ni écrit dans le dépôt, hormis les fixtures et les recettes publiques copiées.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerHorloge, empreinteArbre } from '../src/socle.js';
import { Registre, CLES } from '../src/registre.js';
import { ETAPES } from '../src/contrats.js';
import { scannerTexte } from '../src/garde.js';
import { creerContexte, executerCycle, simuler, executer, juger, migrer, fermerCycleOrphelin, nettoyer, SCHEMAS_JUGEMENT, EXECUTANTS } from '../src/cycle.js';
import { TYPES_ACTION } from '../src/contrats.js';

const DEPOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fx = (rel) => fs.readFileSync(path.join(DEPOT, 'test', 'fixtures', rel), 'utf8');
const CLAUSE = 'Il est interdit de communiquer ses coordonnées en dehors de la plateforme avant l’acceptation d’un devis.';
const CGU = `<html><head><title>x</title></head><body><h1>Conditions fictives</h1><p>${CLAUSE}</p><p>Toute extraction automatisée du site est interdite.</p></body></html>`;

/** Racine fictive : politique, recettes publiques, registre (actes donnés), listes privées fictives (canari compris). */
function racine({ actes = [], listes = true } = {}) {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'velyx-cycle-'));
  fs.mkdirSync(path.join(r, 'etat', 'recettes'), { recursive: true });
  fs.mkdirSync(path.join(r, 'registre'));
  fs.copyFileSync(path.join(DEPOT, 'politique.json'), path.join(r, 'politique.json'));
  for (const f of fs.readdirSync(path.join(DEPOT, 'etat', 'recettes'))) fs.copyFileSync(path.join(DEPOT, 'etat', 'recettes', f), path.join(r, 'etat', 'recettes', f));
  if (listes) {
    fs.mkdirSync(path.join(r, 'prive', 'listes'), { recursive: true });
    fs.writeFileSync(path.join(r, 'prive', 'listes', 'fictive-2026-11-15.json'), JSON.stringify({ recette: 'fictive', cibles: JSON.parse(fx('commun/entreprises.json')) }));
  }
  const reg = new Registre(path.join(r, 'registre', 'journal.jsonl'), { horloge: creerHorloge('2026-11-15T20:00:00Z') });
  for (const a of actes) reg.ajouter(a);
  return r;
}

/** Réseau factice : RSS, liste et détails codeur (fixtures), CGU fictives, comptes SIRENE. */
function reseau() {
  const appels = [];
  const json = (o) => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (u) => {
    appels.push(u);
    const url = new URL(u);
    if (url.pathname === '/projects.rss') return new Response(fx('codeur/rss.xml'));
    if (url.pathname === '/projects') return new Response(fx('codeur/liste.html'));
    if (url.pathname.startsWith('/pages/')) return new Response(CGU);
    if (/^\/projects\/492531/.test(url.pathname)) return new Response(fx('codeur/projet-492531.html'));
    if (url.hostname === 'recherche-entreprises.api.gouv.fr') {
      return url.searchParams.get('per_page') === '1' ? json({ results: [], total_results: 1234, total_pages: 1234 })
        : json({ results: JSON.parse(fx('sirene/fiches-brutes.json')), total_results: 1234, total_pages: 50 });
    }
    return new Response('absent', { status: 404 });
  };
  const n = (hote) => appels.filter((u) => new URL(u).hostname === hote).length;
  return { fetchImpl, appels, n };
}

const lignes = (r) => new Registre(path.join(r, 'registre', 'journal.jsonl')).lignes;
const arbre = (r) => empreinteArbre(['etat', 'registre', 'prive'].map((d) => path.join(r, d)));
function contexte(r, net, { iso = '2026-11-16T06:41:00Z', ...o } = {}) {
  const horloge = creerHorloge(iso);
  return creerContexte({ racine: r, horloge, fetchImpl: net.fetchImpl, attendre: async (ms) => horloge.avancer(ms), env: {}, ...o });
}
const demandes = (r, id = 'C-2026-11-16') => JSON.parse(fs.readFileSync(path.join(r, 'prive', 'cycles', id, 'a-juger.json'), 'utf8'));

test('EXECUTANTS couvre les 24 types d’action ; SCHEMAS_JUGEMENT les 7 jugements ; nettoyer retire HTML et URL', () => {
  assert.deepEqual(Object.keys(EXECUTANTS).sort(), [...TYPES_ACTION].sort());
  assert.deepEqual(Object.keys(SCHEMAS_JUGEMENT).sort(), ['classer_annonce', 'ecrire_gabarit', 'ecrire_lecon', 'ecrire_recette', 'expliquer_contradiction', 'lire_cgu', 'revoir_echantillon']);
  const t = nettoyer('<p>Voir https://exemple.org/x et www.autre.fr</p>\n<b>ok</b>');
  assert.ok(!/https?:|www\.|<p>/.test(t), t);
});

test('cycle complet hors ligne sur fixtures, puis relancé → 0 ligne ajoutée, 0 requête, toutes les étapes « reutilise »', async () => {
  const r = racine(), net = reseau();
  const rap = await executerCycle(contexte(r, net));
  assert.equal(rap.passage, 1);
  assert.deepEqual(rap.etapes.map((e) => e.nom), [...ETAPES]);
  assert.ok(rap.etapes.every((e) => e.statut !== 'echec'), JSON.stringify(rap.etapes));
  assert.equal(rap.statut, 'en_attente_jugement', 'CGU codeur lues : un jugement lire_cgu attend');
  assert.ok(rap.requetes.codeur >= 3 && rap.requetes.codeur <= 10, `budget codeur : ${rap.requetes.codeur}`);
  const L = lignes(r);
  assert.ok(L.some((l) => l.cle === CLES.observation('2026-11-16')) && L.some((l) => l.cle === CLES.cycle('2026-11-16', 1)));
  assert.ok(L.some((l) => l.type === 'decision') && L.some((l) => l.type === 'revue'));
  for (const f of ['etat/series/2026-11-16.jsonl', 'etat/kpi.json', 'etat/monde.json', 'etat/plan-observation.json', 'etat/canaux.json', 'etat/cycles/C-2026-11-16.json',
    'prive/cycles/C-2026-11-16/a-juger.json', 'prive/memoire.json', 'prive/notification.txt']) assert.ok(fs.existsSync(path.join(r, f)), f);
  const avant = L.length, appels = net.appels.length, empreinte = arbre(r);
  const bis = await executerCycle(contexte(r, net));
  assert.equal(bis.rejeu, true);
  assert.equal(lignes(r).length, avant, '0 ligne ajoutée');
  assert.equal(net.appels.length, appels, '0 requête');
  assert.ok(bis.etapes.every((e) => e.statut === 'reutilise'));
  assert.equal(arbre(r), empreinte, 'rien n’est réécrit');
});

test('conteneur neuf le même jour (prive/cycles effacé) → observation réhydratée, 0 requête codeur, aucune ligne dupliquée', async () => {
  const r = racine(), net = reseau();
  await executerCycle(contexte(r, net));
  fs.rmSync(path.join(r, 'prive', 'cycles'), { recursive: true });
  const avant = net.n('www.codeur.com');
  const rap = await executerCycle(contexte(r, net));
  assert.equal(rap.etapes[0].statut, 'reutilise');
  assert.equal(net.n('www.codeur.com'), avant, '0 requête codeur');
  const cles = lignes(r).map((l) => l.cle).filter(Boolean);
  assert.equal(cles.length, new Set(cles).size, 'aucune clé en double');
  assert.equal(lignes(r).filter((l) => l.type === 'observation').length, 1);
});

test('executer avec un verdict revue_humaine → lève, aucune écriture ; simulation non réussie → lève aussi', async () => {
  const r = racine(), ctx = contexte(r, reseau()), empreinte = arbre(r);
  const a = { id: 'A-1', type: 'preparer_prealable', ref: 'statut', params: { sujet: 'statut' }, cle: 'x' };
  await assert.rejects(() => executer(a, { verdict: 'revue_humaine', regle: 'R-00' }, { ok: true }, ctx), /verdict « revue_humaine »/);
  await assert.rejects(() => executer(a, { verdict: 'autorise', regle: 'R-24' }, { ok: false, motif: 'm' }, ctx), /simulation non réussie/);
  assert.equal(arbre(r), empreinte);
});

test('simuler : sonde de 6 778 fiches avec 200 requêtes SIRENE restantes → ok = false, 0 requête émise ; arbre inchangé', async () => {
  const r = racine({ actes: [{ type: 'fait', cle: 'fait:sonde:btp-creations-zone:total:2026-11-15', sujet: 'sonde:btp-creations-zone', mesure: 'total', valeur: 6778, n_fait: 1, source: 'sirene:compte' }] });
  const net = reseau(), ctx = contexte(r, net, { plafonds: { codeur: 10, sirene: 200, duree_s: 600, jugements: 5, nouvelles_opportunites: 1, passages_jour: 3 } });
  const empreinte = arbre(r);
  const s = await simuler({ id: 'A-1', type: 'construire_liste', ref: 'btp-creations-zone', params: { recette: 'btp-creations-zone' }, cle: 'c' }, { verdict: 'autorise', regle: 'R-03' }, ctx);
  assert.equal(s.ok, false);
  assert.equal(s.plan.requetes.sirene, Math.ceil(6778 / 25) + 1);
  assert.match(s.motif, /budget restant/);
  assert.equal(net.appels.length, 0);
  assert.equal(arbre(r), empreinte);
  const p = await simuler({ id: 'A-2', type: 'preparer_prealable', ref: 'statut', params: { sujet: 'statut' }, cle: 'p' }, { verdict: 'autorise', regle: 'R-24' }, ctx);
  assert.equal(p.ok, true, 'une action sans réseau s’exécute à blanc');
  assert.equal(arbre(r), empreinte, 'à blanc : rien sur le disque');
});

test('jugement absent → action en attente ; jugement invalide deux fois → action abandonnée (aveu), le cycle continue', async () => {
  const r = racine(), net = reseau();
  const p1 = await executerCycle(contexte(r, net));
  const d = demandes(r).find((x) => x.type === 'lire_cgu');
  assert.ok(d && d.essais_restants === 2 && d.entree.donnee_non_fiable.includes(CLAUSE) && !/<p>/.test(d.entree.donnee_non_fiable));
  assert.ok(p1.a_juger.some((x) => x.id === d.id));
  const sans = await executerCycle(contexte(r, net));
  assert.equal(sans.rejeu, true, 'sans réponse : rien de nouveau, l’action attend toujours');
  const faux = JSON.stringify({ canal: 'codeur', clauses: [{ citation: 'clause qui ne figure nulle part', sujet: 'autre', verdict: 'ambigu' }] });
  const ctx = contexte(r, net);
  assert.deepEqual([juger(ctx, d.id, faux).ok, juger(ctx, d.id, faux.replace('nulle part', 'nulle part ailleurs')).statut], [false, 'abandonne']);
  const p2 = await executerCycle(contexte(r, net));
  assert.equal(p2.passage, 2);
  assert.ok(p2.etapes.every((e) => e.statut !== 'echec'));
  assert.ok(lignes(r).some((l) => l.type === 'aveu' && l.cle === `aveu:jugement:${d.id}`), 'aveu de l’abandon');
  assert.ok(!p2.a_juger.some((x) => x.id === d.id));
});

test('lire_cgu : citation absente du texte lu → rejet ; citation exacte → acceptée et consommée au passage 2 (fait, canaux, B08)', async () => {
  const r = racine(), net = reseau();
  await executerCycle(contexte(r, net));
  const d = demandes(r).find((x) => x.type === 'lire_cgu'), ctx = contexte(r, net);
  const r1 = juger(ctx, d.id, JSON.stringify({ canal: 'codeur', clauses: [{ citation: 'Le contact direct avec les clients est libre.', sujet: 'contact_hors_plateforme', verdict: 'autorise' }] }));
  assert.equal(r1.ok, false);
  assert.match(r1.erreurs.join(' '), /citation 1 absente du texte lu/);
  const r2 = juger(ctx, d.id, JSON.stringify({ canal: 'codeur', clauses: [{ citation: CLAUSE, sujet: 'contact_hors_plateforme', verdict: 'interdit' }] }));
  assert.equal(r2.ok, true, r2.erreurs.join(' '));
  const avant = net.n('www.codeur.com');
  const p2 = await executerCycle(contexte(r, net));
  assert.equal(p2.passage, 2);
  assert.ok(p2.etapes.slice(0, 7).every((e) => e.statut === 'reutilise'), 'analyse du jour réutilisée');
  assert.equal(net.n('www.codeur.com'), avant, 'passage 2 : 0 requête d’observation');
  assert.ok(lignes(r).some((l) => l.cle === 'fait:cgu:codeur:contact_hors_plateforme:2026-11-16' && l.valeur === 'interdit'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(r, 'etat', 'canaux.json'), 'utf8')).codeur.cgu, 'lue_interdite');
  assert.equal(JSON.parse(fs.readFileSync(path.join(r, 'etat', 'monde.json'), 'utf8')).croyances.find((c) => c.id === 'B08').niveau, 'refutee');
});

test('4e passage le même jour → refus R-43 ; cycle d’hier inachevé → clos « interrompu », jamais repris', async () => {
  const r = racine(), net = reseau();
  for (let i = 1; i <= 3; i++) assert.equal((await executerCycle(contexte(r, net), { jusqua: 'observer' })).passage, i);
  const q = await executerCycle(contexte(r, net), { jusqua: 'observer' });
  assert.equal(q.statut, 'interrompu');
  assert.equal(q.motif, 'R-43');
  assert.ok(lignes(r).some((l) => l.type === 'refus' && l.regle === 'R-43'));
  const demain = contexte(r, net, { iso: '2026-11-17T06:41:00Z' });
  const l = fermerCycleOrphelin(demain);
  assert.equal(l.cle, 'aveu:cycle-orphelin:C-2026-11-16');
  assert.equal(fermerCycleOrphelin(demain).n, l.n, 'idempotent');
  const rap = await executerCycle(contexte(r, net, { iso: '2026-11-17T06:41:00Z' }), { jusqua: 'observer' });
  assert.equal(rap.passage, 1, 'le cycle du jour repart au passage 1');
  assert.ok(lignes(r).some((x) => x.cle === CLES.observation('2026-11-17')), 'nouvelle observation du jour');
});

const pariV1 = (id) => ({ type: 'pari', id, annonce: 'https://www.codeur.com/projects/900001', hypothese: 'hypothèse fictive', geste_proprietaire: 'geste fictif',
  critere_succes: 'succès fictif', critere_arret: 'arrêt fictif', echeance: 'envoi + 7 jours' });

test('migrer lancé deux fois → actes écrits une seule fois ; les 2 paris v1 clos « caduc »', () => {
  const r = racine({ actes: [pariV1('P-rachat-it-idf-2026-11-15'), pariV1('P-courtier-btp-aura-2026-11-15')] });
  const m1 = migrer(contexte(r, reseau())), n = lignes(r).length;
  assert.equal(m1.actes.length, 5);
  const m2 = migrer(contexte(r, reseau()));
  assert.equal(lignes(r).length, n, 'rien de plus');
  assert.deepEqual(m2.actes.map((l) => l.n), m1.actes.map((l) => l.n));
  const etat = new Registre(path.join(r, 'registre', 'journal.jsonl')).etat();
  assert.deepEqual(etat.paris.map((p) => p.statut), ['caduc', 'caduc']);
  assert.deepEqual(m1.purges, [], 'le fichier brut ne se purge que sur demande explicite');
});

test('notification : 300 caractères au plus, sans jeton canari ; vide s’il n’y a rien à faire', async () => {
  const r = racine(), net = reseau();
  const rap = await executerCycle(contexte(r, net));
  const t = fs.readFileSync(path.join(r, 'prive', 'notification.txt'), 'utf8');
  assert.equal(t, rap.notification);
  assert.ok(t.length > 0 && [...t].length <= 300, t);
  assert.ok(!/canarix/i.test(t));
  assert.equal(scannerTexte(t, contexte(r, net).dict).n, 0);
  // Sans observation (hors ligne) ni revue ouverte : rien à faire, notification vide.
  const vide = racine(), rv = await executerCycle(contexte(vide, reseau(), { horsLigne: true }));
  assert.equal(rv.statut, 'interrompu');
  assert.equal(rv.notification, '');
});

test('mode veille : oppositions déclarées mais mémoire absente → aucune construire_liste ni echantillonner (R-14)', async () => {
  const r = racine({ actes: [{ type: 'opposition', n_total: 3, origine: 'demande', cle: 'opposition:fictive' },
    { type: 'fait', cle: 'fait:sonde:btp-creations-zone:total:2026-11-15', sujet: 'sonde:btp-creations-zone', mesure: 'total', valeur: 1234, n_fait: 1, source: 'sirene:compte' }] });
  const ctx = contexte(r, reseau());
  assert.equal(ctx.mode, 'veille');
  const rap = await executerCycle(ctx);
  assert.equal(rap.mode, 'veille');
  const executees = lignes(r).filter((l) => l.type === 'decision' && l.verdict === 'autorise').map((l) => l.action);
  assert.ok(!executees.includes('echantillonner') && !executees.includes('construire_liste'));
  assert.ok(lignes(r).some((l) => l.type === 'refus' && l.action === 'echantillonner' && l.regle === 'R-14'), 'échantillon proposé puis refusé (R-14)');
  assert.ok(!fs.existsSync(path.join(r, 'prive', 'listes', 'echantillon-btp-creations-zone-2026-11-16.json')));
});

test('à blanc : un cycle complet n’écrit rien sur le disque (magasin en calque, registre en copie)', async () => {
  const r = racine(), empreinte = arbre(r);
  const rap = await executerCycle(contexte(r, reseau(), { aBlanc: true }));
  assert.ok(rap.etapes.every((e) => e.statut !== 'echec'), JSON.stringify(rap.etapes));
  assert.equal(arbre(r), empreinte);
});
