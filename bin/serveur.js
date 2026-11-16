#!/usr/bin/env node
// Serveur web de VELYX pour un hébergeur (Render, etc.) : Node seul, aucune dépendance, LECTURE SEULE.
// - GET /sante : état public (chaîne du registre, dernier cycle, argent encaissé) au format JSON, pour la sonde de santé.
// - GET /      : page de statut minimale, sans offre commerciale, sans aucune donnée nominative.
// Aucune route ne lance le cycle, n'écrit un fichier ni n'appelle le réseau : l'agent tourne ailleurs (tâche planifiée).
// Port : variable PORT (fournie par Render), sinon 10000. Hôte : 0.0.0.0.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Registre } from '../src/registre.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JOURNAL = path.join(RACINE, 'registre', 'journal.jsonl');

/** État public, recalculé à chaque requête depuis le registre versionné (aucune écriture). */
export function etatPublic(journal = JOURNAL) {
  const reg = new Registre(journal);
  const v = reg.verifier();
  const e = reg.etat();
  const cycle = reg.lignes.filter((l) => l.type === 'cycle').at(-1) ?? null;
  return {
    ok: v.ok === true,
    service: 'velyx',
    registre: { chaine_intacte: v.ok === true, lignes: reg.lignes.length },
    dernier_cycle: cycle ? { jour: cycle.jour ?? null, passage: cycle.passage ?? null, statut: cycle.statut ?? null } : null,
    encaisse_eur: e.encaisse_eur,
    depense_eur: e.depense_eur,
  };
}

const echapper = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page(etat) {
  const c = etat.dernier_cycle;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>VELYX</title><style>
:root{--bg:#f6f7f5;--fg:#17263a;--doux:#4a5868;--trait:#c9d0d3}
@media (prefers-color-scheme:dark){:root{--bg:#10161e;--fg:#e6ebef;--doux:#a9b4be;--trait:#2c3846}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:640px;margin:0 auto;padding:48px 16px;display:grid;gap:16px}
h1{margin:0;font-size:32px}p{margin:0;color:var(--doux)}dl{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:0;border-top:1px solid var(--trait);padding-top:16px}
dt{color:var(--doux)}dd{margin:0;font-variant-numeric:tabular-nums}</style></head><body><main>
<h1>VELYX</h1><p>Agent en service. Page publique en préparation.</p>
<dl><dt>Registre</dt><dd>${etat.registre.chaine_intacte ? 'chaîne intacte' : 'chaîne à vérifier'} · ${echapper(etat.registre.lignes)} actes</dd>
<dt>Dernier cycle</dt><dd>${c ? `${echapper(c.jour)} · passage ${echapper(c.passage)} · ${echapper(c.statut)}` : 'aucun'}</dd>
<dt>Encaissé</dt><dd>${echapper(etat.encaisse_eur)} €</dd></dl>
</main></body></html>`;
}

export function creerServeur({ journal = JOURNAL } = {}) {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    const entetes = { 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...entetes, allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' });
      return res.end('méthode non permise : ce serveur est en lecture seule\n');
    }
    let etat;
    try { etat = etatPublic(journal); } catch {
      etat = { ok: false, service: 'velyx', registre: { chaine_intacte: false, lignes: 0 }, dernier_cycle: null, encaisse_eur: 0, depense_eur: 0 };
    }
    if (url.pathname === '/sante') {
      res.writeHead(etat.ok ? 200 : 503, { ...entetes, 'content-type': 'application/json; charset=utf-8' });
      return res.end(req.method === 'HEAD' ? undefined : JSON.stringify(etat));
    }
    if (url.pathname === '/') {
      res.writeHead(200, { ...entetes, 'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
      return res.end(req.method === 'HEAD' ? undefined : page(etat));
    }
    res.writeHead(404, { ...entetes, 'content-type': 'text/plain; charset=utf-8' });
    return res.end('introuvable\n');
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 10000;
  creerServeur().listen(port, '0.0.0.0', () => console.log(`VELYX : serveur en lecture seule sur le port ${port}`));
}
