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
import { creerContexte, executerCycle, simuler, executer, juger, migrer, fermerCycleOrphelin, nettoyer, SCHEMAS_JUGEMENT, EXECUTANTS, retour } from '../src/cycle.js';
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

test('conteneur neuf le même jour (prive/cycles effacé) → mêmes faits, mêmes décisions, nouveau passage consigné, etat/cycles fusionné', async () => {
  const r = racine(), net = reseau();
  await executerCycle(contexte(r, net));
  const point = (k, nom) => JSON.parse(fs.readFileSync(path.join(r, 'prive', 'cycles', 'C-2026-11-16', `${String(k).padStart(2, '0')}-${nom}.json`), 'utf8')).sortie;
  const resume = (x) => ({ faits: x.faits.filter((f) => !f.sujet.startsWith('page:')).map((f) => `${f.id}=${JSON.stringify(f.valeur)}/${f.n}`).sort() });
  const faits1 = resume(point(2, 'comprendre')), decisions1 = point(7, 'decider').actions.map((a) => `${a.type}:${a.cle}:${a.verdict.verdict}`);
  const public1 = JSON.parse(fs.readFileSync(path.join(r, 'etat', 'cycles', 'C-2026-11-16.json'), 'utf8')).passages;
  fs.rmSync(path.join(r, 'prive', 'cycles'), { recursive: true });
  const avant = net.n('www.codeur.com'), n0 = lignes(r).length;
  const rap = await executerCycle(contexte(r, net));
  assert.equal(rap.etapes[0].statut, 'reutilise');
  assert.equal(net.n('www.codeur.com'), avant, '0 requête codeur');
  const cles = lignes(r).map((l) => l.cle).filter(Boolean);
  assert.equal(cles.length, new Set(cles).size, 'aucune clé en double');
  assert.equal(lignes(r).filter((l) => l.type === 'observation').length, 1);
  assert.deepEqual(resume(point(2, 'comprendre')), faits1, 'mêmes faits (âges et familles relus dans la série)');
  assert.deepEqual(point(7, 'decider').actions.map((a) => `${a.type}:${a.cle}:${a.verdict.verdict}`), decisions1, 'mêmes décisions, relues au registre');
  assert.equal(rap.passage, 2, 'un nouveau passage, jamais le numéro d’un passage consigné');
  assert.ok(lignes(r).slice(n0).some((l) => l.cle === CLES.cycle('2026-11-16', 2)), 'acte cycle du passage consigné (sa consommation compte)');
  const public2 = JSON.parse(fs.readFileSync(path.join(r, 'etat', 'cycles', 'C-2026-11-16.json'), 'utf8')).passages;
  assert.deepEqual(public2.map((p) => p.passage), [1, 2]);
  assert.deepEqual(public2[0], public1[0], 'le passage 1 public n’est pas réécrit');
  const etat = JSON.parse(fs.readFileSync(path.join(r, 'prive', 'cycles', 'C-2026-11-16', 'cycle.json'), 'utf8'));
  assert.notEqual(Object.values(etat.actions).find((a) => a.type === 'lire_cgu')?.statut, 'executee', 'page non relue : l’action n’est pas « executee »');
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

// À blanc : rien n'est écrit, donc rien ne doit être consommé du plafond du jour (R-43) : le réseau est limité au cache.
test('à blanc : un cycle complet n’écrit rien sur le disque et n’émet aucune requête (plafond du jour intact)', async () => {
  const r = racine(), net = reseau(), empreinte = arbre(r);
  for (let i = 0; i < 3; i++) {
    const ctx = contexte(r, net, { aBlanc: true });
    assert.equal(ctx.budget.reste('codeur'), 10);
    const rap = await executerCycle(ctx);
    assert.deepEqual(rap.requetes, { codeur: 0, sirene: 0 });
  }
  assert.equal(net.appels.length, 0, 'trois passes à blanc : aucune requête réelle');
  assert.equal(arbre(r), empreinte);
  // Après un passage réel du jour, la passe à blanc rejoue l'analyse (observation réhydratée) sans requête ni écriture.
  await executerCycle(contexte(r, net));
  fs.rmSync(path.join(r, 'prive', 'cycles'), { recursive: true });
  const n = net.appels.length, apres = arbre(r);
  const rap = await executerCycle(contexte(r, net, { aBlanc: true }));
  assert.ok(rap.etapes.every((e) => e.statut !== 'echec'), JSON.stringify(rap.etapes));
  assert.equal(net.appels.length, n);
  assert.equal(arbre(r), apres);
});

// R-12, R-13 : une opposition reçue après l'échantillonnage ne survit ni dans l'échantillon montré au tiers, ni dans une
// revue active. Fiches FICTIVES (test/fixtures/commun) ; la CLI est lancée dans un sous-processus sur la racine temporaire.
test('opposition reçue après l’échantillon → revue caduque, copie minimisée purgée, brouillon recalculé sans l’entreprise', async () => {
  const { spawnSync } = await import('node:child_process');
  const { appliquer } = await import('../src/recettes.js');
  const { echantillonMinimise, ligneEchantillon } = await import('../src/brouillons.js');
  const risque = await import('../src/risque.js');
  const { echantillonCourant } = await import('../src/cycle.js');
  const r = racine({ listes: false }), h = creerHorloge('2026-11-16T06:41:00Z');
  const F = JSON.parse(fx('commun/entreprises.json'));
  const g = appliquer({ garder: () => true, signaux: () => [] }, F, { horloge: h, oppositions: new Set(), lecture: { complet: false } });
  // Ancien format : la copie minimisée (sans SIREN) est encore écrite à côté des fiches.
  const minimise = echantillonMinimise(g.gardees, { horloge: h });
  const rel = 'prive/listes/echantillon-btp-creations-zone-2026-11-16.json', abs = path.join(r, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify({ recette: 'btp-creations-zone', graine: 'g', pages: [1], lu_le: h.iso(), total: 40, compte: { ...g.compte, par_signal: { rge: 0 } }, minimise, fiches: g.gardees }));
  const cible = g.gardees[0].siren, sansAlias = (l) => l.replace(/^S\d{2} · /, '');
  const ligne = sansAlias(ligneEchantillon(minimise[0]));
  const ctx = creerContexte({ racine: r, horloge: h, horsLigne: true, env: {} });
  const a = { type: 'rediger_brouillon', ref: '492531', params: { recette: 'btp-creations-zone', canal: 'email' } };
  const d = (await EXECUTANTS.rediger_brouillon(a, ctx)).revues[0];
  assert.ok(d.texte.includes(ligne), 'avant l’opposition, la fiche est dans l’échantillon');
  assert.ok(d.sirens.includes(cible));
  const { revue } = risque.mettreEnRevue(d, { registre: ctx.registre, horloge: h, magasin: ctx.magasin });
  assert.ok(fs.existsSync(path.join(r, risque.indexRevue(revue.id))), 'index privé de la revue écrit');
  // Le propriétaire enregistre l'opposition (chemin réel de la CLI).
  const x = spawnSync(process.execPath, [path.join(DEPOT, 'bin', 'velyx.js'), 'geste', `opposition ${cible}`], { encoding: 'utf8', env: { ...process.env, VELYX_RACINE: r } });
  assert.equal(x.status, 0, x.stdout + x.stderr);
  assert.match(x.stdout, new RegExp(`revues rendues caduques : ${revue.id}`));
  const reg = new Registre(path.join(r, 'registre', 'journal.jsonl'));
  assert.equal(risque.revuesDe(reg, h).find((v) => v.id === revue.id).statut, 'caduque');
  assert.ok(!fs.readFileSync(path.join(r, 'registre', 'journal.jsonl'), 'utf8').includes(cible), 'le SIREN ne va jamais au registre');
  const apres = JSON.parse(fs.readFileSync(abs, 'utf8'));
  assert.equal(apres.fiches.filter((e) => e.siren === cible).length, 0);
  assert.equal(apres.minimise, undefined, 'la copie minimisée qui montrait l’entreprise est supprimée');
  assert.equal(apres.compte.retenues, g.compte.retenues - 1);
  assert.ok(!JSON.parse(fs.readFileSync(path.join(r, risque.indexRevue(revue.id)), 'utf8')).sirens.includes(cible));
  // Le brouillon suivant recalcule l'échantillon depuis les fiches restantes : la ligne de l'entreprise opposée n'y est plus.
  const d2 = (await EXECUTANTS.rediger_brouillon(a, creerContexte({ racine: r, horloge: h, horsLigne: true, env: {} }))).revues[0];
  assert.ok(!d2.texte.includes(ligne));
  assert.ok(!d2.sirens.includes(cible));
  // Opposition connue mais pas encore purgée (mémoire seule) : l'échantillon courant l'écarte aussi, et le compte suit.
  const c = echantillonCourant({ fiches: g.gardees, compte: { retenues: g.gardees.length, exclues: 0 } }, { oppositions: new Set([cible]), horloge: h });
  assert.ok(!c.sirens.includes(cible));
  assert.equal(c.compte.retenues, g.gardees.length - 1);
  assert.throws(() => echantillonCourant({ minimise }, { horloge: h }), /sans fiches contrôlées/);
});

test('fiches de revue : le texte soumis (couvert par l’empreinte) est celui des contrôles ; notes et repères de prix hors du bloc', async () => {
  const risque = await import('../src/risque.js');
  const r = racine({ listes: false }), h = creerHorloge('2026-11-16T06:41:00Z');
  const ctx = creerContexte({ racine: r, horloge: h, horsLigne: true, env: {} });
  const kit = (await EXECUTANTS.preparer_kit_canal({ type: 'preparer_kit_canal', ref: 'donnees', params: { segment: 'donnees', canaux: ['comeup', 'malt'] } }, ctx)).revues[0];
  const pre = (await EXECUTANTS.preparer_prealable({ type: 'preparer_prealable', ref: 'statut', params: { sujet: 'statut' } }, ctx)).revues[0];
  for (const d of [kit, pre]) {
    assert.ok(!/€/.test(d.texte), `${d.type} : aucun montant dans le texte soumis`);
    assert.ok(!/NOTES POUR LE PROPRIÉTAIRE|Repères de prix/i.test(d.texte), `${d.type} : aucune note dans le texte soumis`);
    const { revue } = risque.mettreEnRevue(d, { registre: ctx.registre, horloge: h, magasin: ctx.magasin });
    const md = ctx.magasin.lire(revue.fichier_prive), soumis = risque.extraireTexte(md);
    assert.equal(soumis, d.texte, 'le bloc couvert par l’empreinte est exactement le texte contrôlé');
    if (d.notes) assert.ok(md.indexOf(d.notes.trim()) > md.indexOf('<!-- velyx:texte:fin -->'), 'les notes suivent le bloc');
  }
  assert.match(kit.notes, /€/, 'les repères de prix restent dans la fiche privée, pour le propriétaire');
});

// Recette par nom (courtiers-construction : une recherche par mot) : l'échantillon est tiré dans la population que la
// sonde a comptée (chaque page dans SA recherche, numéro calculé sur SON total), jamais dans les 66.22Z de France sans « q ».
test('echantillonner courtiers-construction : pages tirées dans les recherches comptées par la sonde ; compte.total = total de la sonde', async () => {
  const r = racine({ listes: false }), appels = [];
  const totaux = { btp: 15, construction: 26, batiment: 4479, decennale: 6 };
  const fetchImpl = async (u) => {
    appels.push(new URL(u));
    const url = new URL(u), q = url.searchParams.get('q'), t = totaux[q] ?? 99_999;
    const corps = url.searchParams.get('per_page') === '1' ? { results: [], total_results: t, total_pages: t }
      : { results: JSON.parse(fx('sirene/fiches-brutes.json')), total_results: t, total_pages: Math.ceil(t / 25) };
    return new Response(JSON.stringify(corps), { headers: { 'content-type': 'application/json' } });
  };
  const h = creerHorloge('2026-11-17T08:00:00Z');
  const ctx = creerContexte({ racine: r, horloge: h, fetchImpl, attendre: async (ms) => h.avancer(ms), env: {} });
  ctx.passage = 1; ctx.etatCycle = { passages: [], actions: {} }; ctx.S = {};
  const a = { type: 'sonder', ref: 'courtiers-construction', params: { recette: 'courtiers-construction' } };
  await EXECUTANTS.sonder(a, ctx);
  const sonde = ctx.registre.derniere('fait', (l) => l.sujet === 'sonde:courtiers-construction');
  assert.equal(sonde.valeur, 15 + 26 + 4479 + 6);
  assert.deepEqual(sonde.sous_totaux.map((x) => x.q), ['btp', 'construction', 'batiment', 'decennale']);
  const n0 = appels.length;
  const e = { type: 'echantillonner', ref: 'courtiers-construction', params: { recette: 'courtiers-construction', pages: 2 } };
  await EXECUTANTS.echantillonner(e, ctx);
  const lues = appels.slice(n0);
  assert.equal(lues.length, 2, 'sous_totaux de la sonde : aucun compte de plus, 2 pages');
  for (const u of lues) {
    const q = u.searchParams.get('q');
    assert.ok(Object.hasOwn(totaux, q), `page tirée hors des recherches comptées : ${u.search}`);
    assert.ok(Number(u.searchParams.get('page')) <= Math.ceil(totaux[q] / 25), `page ${u.searchParams.get('page')} au-delà du total de « ${q} »`);
  }
  const f = JSON.parse(fs.readFileSync(path.join(r, 'prive', 'listes', 'echantillon-courtiers-construction-2026-11-17.json'), 'utf8'));
  assert.equal(f.compte.total, sonde.valeur, 'le total de l’échantillon est celui de la population tirée');
  assert.equal(f.tirage.length, 2);
});

// R-11 et budget : une lecture SIRENE interrompue (construire_liste) se reprend au passage suivant sans repayer ses pages :
// RETOUR ne purge pas la reprise du jour tant que la liste n'est pas consignée.
test('construire_liste interrompue → reprise gardée après RETOUR ; le passage suivant ne relit pas les pages payées', async () => {
  const r = racine({ listes: false }), fiches = fx('sirene/fiches-brutes.json');
  let pages = 0, panne = true;
  const fetchImpl = async (u) => {
    const url = new URL(u), corps = url.searchParams.get('per_page') === '1' ? { results: [], total_results: 120, total_pages: 120 } : null;
    if (corps) return new Response(JSON.stringify(corps), { headers: { 'content-type': 'application/json' } });
    pages++;
    if (panne && pages >= 3) throw new TypeError('fetch failed');
    return new Response(JSON.stringify({ results: JSON.parse(fiches), total_results: 120, total_pages: 5 }), { headers: { 'content-type': 'application/json' } });
  };
  const ctxDe = () => {
    const h = creerHorloge('2026-11-17T08:00:00Z'), c = creerContexte({ racine: r, horloge: h, fetchImpl, attendre: async (ms) => h.avancer(ms), env: {} });
    c.passage = 1; c.etatCycle = { passages: [], actions: {} }; c.S = {};
    return c;
  };
  const a = { id: 'A-x', type: 'construire_liste', ref: 'btp-creations-zone', params: { recette: 'btp-creations-zone' }, cle: 'k' };
  const c1 = ctxDe();
  await assert.rejects(() => EXECUTANTS.construire_liste(a, c1), /échec réseau/);
  const rel = path.join(r, 'prive/cycles/C-2026-11-17/cache/reprise-btp-creations-zone.json');
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(rel, 'utf8'))).length, 2);
  retour({ a_juger: [] }, c1);
  assert.ok(fs.existsSync(rel), 'reprise gardée après RETOUR');
  panne = false; pages = 0;
  const c2 = ctxDe();
  await EXECUTANTS.construire_liste(a, c2);
  assert.equal(pages, 3, 'pages 3 à 5 seulement : les 2 pages payées viennent de la reprise');
  retour({ a_juger: [] }, c2);
  assert.ok(!fs.existsSync(rel), 'liste consignée : reprise purgée');
});

test('budget épuisé pendant EXÉCUTER (SIRENE en 429, plafond 1) → action en échec, les revues déjà produites sont mises en file', async () => {
  const r = racine(), base = reseau();
  const fetchImpl = async (u) => (new URL(u).hostname === 'recherche-entreprises.api.gouv.fr' ? new Response('trop', { status: 429 }) : base.fetchImpl(u));
  const rap = await executerCycle(contexte(r, { fetchImpl }, { plafonds: { codeur: 10, sirene: 1, duree_s: 600, jugements: 5, nouvelles_opportunites: 1, passages_jour: 3 } }));
  const etat = JSON.parse(fs.readFileSync(path.join(r, 'prive', 'cycles', 'C-2026-11-16', 'cycle.json'), 'utf8'));
  const actions = Object.values(etat.actions);
  assert.equal(actions.find((a) => a.type === 'sonder')?.statut, 'echec', JSON.stringify(actions));
  assert.equal(rap.statut, 'budget');
  assert.equal(rap.etapes.find((e) => e.nom === 'revue').statut, 'fait', 'REVUE n’est pas sautée');
  const produites = actions.filter((a) => a.statut === 'executee' && ['preparer_prealable', 'preparer_kit_canal'].includes(a.type)).length;
  assert.ok(produites >= 1, JSON.stringify(actions));
  assert.equal(lignes(r).filter((l) => l.type === 'revue').length, produites, 'chaque action exécutée qui produit une fiche a sa revue');
});

// E-mail B2B aux courtiers en assurance construction (gabarit courtiers-construction) : destinataires tirés de la liste
// courtiers-construction, échantillon et comptes de btp-creations-zone du MÊME département. Fiches FICTIVES.
function listesCourtiers(r, h) {
  const communes = ['ANNECY', 'THONON-LES-BAINS', 'CLUSES', 'SALLANCHES', 'ANNEMASSE', 'RUMILLY', 'EVIAN-LES-BAINS', 'SEYNOD', 'PASSY', 'BONNEVILLE', 'FAVERGES', 'MEGEVE'];
  const noms = ['VERGLASSE', 'TOITURIN', 'MOELLONET', 'CHAUXELLE', 'FICTIFOR', 'ENDUIRAC', 'CHARPENTOT', 'CARRELINE', 'PLATRIER', 'ZINGUELLE', 'BETONNIC', 'ISOLETTE'];
  const btp = communes.map((commune, i) => ({ siren: `9990009${String(i + 10)}`, nom: `ENTREPRISE FICTIVE ${String.fromCharCode(65 + i)} BATIMENT`, nature_juridique: '5710',
    naf: ['43.22A', '43.99C', '43.29A', '41.20A', '43.21A', '43.32A'][i % 6], creation: `2026-0${(i % 9) + 1}-1${i % 9}`, etat_administratif: 'A', fermee: false, categorie: 'PME',
    effectif: '1-2', effectif_code: '01', effectif_annee: 2026, departement: '74', commune, dirigeants: [{ qualite: 'Président', nom: `Prénom ${noms[i]}`, annee_naissance: 1980 + i }],
    dirigeants_pm: 0, finances: [], ca: null, rge: i % 2 === 0, idcc: [], opposition: i === 2, statut_diffusion: 'O', etablissements_ouverts: 1, fiche: `https://annuaire-entreprises.data.gouv.fr/entreprise/9990009${String(i + 10)}` }));
  const courtiers = [['COURTAGE FICTIF BTP', '74', false], ['CABINET FICTIF CONSTRUCTION', '74', false], ['ASSURANCES FICTIVES DECENNALE', '69', false], ['COURTIER FICTIF BATIMENT OPPOSE', '74', true]]
    .map(([nom, departement, opposition], i) => ({ siren: `99900080${i}`, nom, nature_juridique: '5499', naf: '66.22Z', departement, commune: departement === '74' ? 'ANNECY' : 'LYON', opposition, statut_diffusion: 'O',
      etat_administratif: 'A', fermee: false, dirigeants: [{ qualite: 'Gérant', nom: `Prénom COURTIERIX${i}`, annee_naissance: 1975 }], fiche: `https://annuaire-entreprises.data.gouv.fr/entreprise/99900080${i}` }));
  return { btp, courtiers };
}
async function ecrireListesCourtiers(r, h) {
  const { appliquer, compiler } = await import('../src/recettes.js');
  const spec = (id) => JSON.parse(fs.readFileSync(path.join(DEPOT, 'etat', 'recettes', `${id}.json`), 'utf8'));
  const { btp, courtiers } = listesCourtiers(r, h), jour = h.jour();
  const rb = compiler(spec('btp-creations-zone'), h, { departement: '74' }), gb = appliquer(rb, btp, { horloge: h, oppositions: new Set(), lecture: { complet: false } });
  const rc = compiler(spec('courtiers-construction'), h), gc = appliquer(rc, courtiers, { horloge: h, oppositions: new Set(), lecture: { complet: true } });
  fs.mkdirSync(path.join(r, 'prive', 'listes'), { recursive: true });
  fs.writeFileSync(path.join(r, 'prive', 'listes', `btp-creations-zone-${jour}.json`), JSON.stringify({ recette: 'btp-creations-zone', lu_le: h.iso(), complet: false, variables: rb.variables, cibles: gb.gardees }));
  fs.writeFileSync(path.join(r, 'prive', 'listes', `courtiers-construction-${jour}.json`), JSON.stringify({ recette: 'courtiers-construction', lu_le: h.iso(), complet: true, cibles: gc.gardees }));
  return { btp: gb.gardees, courtiers: gc.gardees };
}

test('courtiers-construction : brouillon de bout en bout (exécutant, cycle, CLI) → revue proposition et pari ; destinataires et échantillon du même département', async () => {
  const { spawnSync } = await import('node:child_process');
  const risque = await import('../src/risque.js');
  const h = creerHorloge('2026-11-16T06:41:00Z');
  // (1) L'exécutant : texte du gabarit rempli depuis btp-creations-zone du 74, destinataires du 74 seulement, opposés exclus.
  const r = racine({ listes: false }), L = await ecrireListesCourtiers(r, h);
  assert.deepEqual(L.courtiers.map((c) => c.departement).sort(), ['69', '74', '74'], 'le cabinet opposé est exclu de la liste');
  const ctx = creerContexte({ racine: r, horloge: h, horsLigne: true, env: {} });
  const sortie = await EXECUTANTS.rediger_brouillon({ type: 'rediger_brouillon', ref: 'courtiers-construction:74', params: { recette: 'courtiers-construction', canal: 'email_direct', departement: '74' } }, ctx);
  const d = sortie.revues[0];
  assert.ok(d.controles.every((c) => c.gravite !== 'bloquant' || c.ok), JSON.stringify(d.controles.filter((c) => !c.ok)));
  assert.match(d.texte.split('\n')[0], /^Objet : .*bâtiment.*décennale/);
  for (const attendu of ['département 74', 'au moins ', '[NOM DU PROPRIÉTAIRE]', 'art. 14 du RGPD', '« STOP »']) assert.ok(d.texte.includes(attendu), attendu);
  assert.equal(d.texte.split('\n').filter((l) => /^- S\d{2} · /.test(l)).length, 10, 'échantillon minimisé de 10 lignes');
  assert.ok(!/Prénom|VERGLASSE|TOITURIN|COURTIERIX/.test(d.texte), 'aucun nom de dirigeant');
  assert.ok(d.notes.includes('COURTAGE FICTIF BTP') && d.notes.includes('CABINET FICTIF CONSTRUCTION'), 'destinataires du 74 dans la fiche privée');
  assert.ok(!d.notes.includes('ASSURANCES FICTIVES DECENNALE') && !d.notes.includes('OPPOSE'), 'ni un cabinet d’un autre département, ni un opposé');
  assert.ok(d.sirens.includes('999000800') && d.sirens.includes(L.btp[0].siren), 'index privé : échantillon et destinataires');
  assert.ok(!d.texte.includes('COURTAGE FICTIF BTP'), 'le texte soumis ne nomme pas le destinataire');
  await assert.rejects(() => EXECUTANTS.rediger_brouillon({ type: 'rediger_brouillon', ref: 'x', params: { recette: 'courtiers-construction', departement: '13' } }, ctx), /aucun cabinet de courtage du département 13/);
  // (2) Le cycle : statut déclaré et e-mail ouvert → DÉCIDER prépare l'e-mail, REVUE le met en file avec son pari.
  const PREUVE = { auteur: 'proprietaire', verification: 'session', preuve_empreinte: 'a'.repeat(64) };
  const r2 = racine({ listes: false, actes: [{ type: 'geste', ...PREUVE, sujet: 'statut', valeur: 'micro', cle: 'g1' }, { type: 'geste', ...PREUVE, sujet: 'canal', valeur: 'email:ouvert', cle: 'g2' }] });
  await ecrireListesCourtiers(r2, h);
  await executerCycle(contexte(r2, reseau()));
  const L2 = lignes(r2);
  const dec = L2.find((l) => l.type === 'decision' && l.action === 'rediger_brouillon' && l.ref === 'courtiers-construction:74');
  assert.ok(dec && dec.verdict === 'autorise', JSON.stringify(L2.filter((l) => l.type === 'decision').map((l) => `${l.action} ${l.ref} ${l.verdict}`)));
  const rv = L2.find((l) => l.type === 'revue' && l.ref === 'courtiers-construction:74');
  assert.ok(rv && rv.type_revue === 'proposition');
  assert.ok(L2.some((l) => l.type === 'pari' && l.revue === rv.id && l.recette === 'courtiers-construction'), 'le pari naît avec la revue');
  assert.ok(!fs.readFileSync(path.join(r2, 'registre', 'journal.jsonl'), 'utf8').includes('COURTAGE FICTIF'), 'aucun nom de cabinet au registre');
  // Le lendemain, le département déjà proposé ne l'est plus.
  await executerCycle(contexte(r2, reseau(), { iso: '2026-11-17T06:41:00Z' }));
  assert.equal(lignes(r2).filter((l) => l.type === 'decision' && l.action === 'rediger_brouillon' && l.ref === 'courtiers-construction:74').length, 1);
  // (3) La CLI : velyx brouillon courtiers-construction → revue et pari (avant la correction : code 1, « se prépare par preparer »).
  const r3 = racine({ listes: false });
  const hr = creerHorloge();
  await ecrireListesCourtiers(r3, hr);
  const x = spawnSync(process.execPath, [path.join(DEPOT, 'bin', 'velyx.js'), 'brouillon', 'courtiers-construction', '--departement', '74'], { encoding: 'utf8', env: { ...process.env, VELYX_RACINE: r3 } });
  assert.equal(x.status, 0, x.stdout + x.stderr);
  const rid = /revue : (R-[\d-]+)/.exec(x.stdout)[1];
  const md = fs.readFileSync(path.join(r3, 'prive', 'revues', `${rid}.md`), 'utf8');
  assert.match(risque.extraireTexte(md), /^Objet : /);
  assert.ok(lignes(r3).some((l) => l.type === 'pari' && l.revue === rid));
});

test('plan d’observation : aucune sonde sans « q » pour une recette à plusieurs recherches (courtiers-construction)', async () => {
  const { etatRecettes } = await import('../src/cycle.js');
  const r = racine({ listes: false });
  const e = etatRecettes(creerContexte({ racine: r, horloge: creerHorloge('2026-11-16T06:41:00Z'), horsLigne: true, env: {} }));
  assert.equal(e['courtiers-construction'].params, null, 'rec.params sans « q » compterait tous les 66.22Z de France');
  assert.equal(e['btp-creations-zone'].params.activite_principale.includes('43.99C'), true, 'une recette à une recherche garde sa requête');
});
