import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { creerServeur } from '../bin/serveur.js';
import { Registre } from '../src/registre.js';

async function demarrer(journal) {
  const s = creerServeur({ journal });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { s, base: `http://127.0.0.1:${s.address().port}` };
}

test('serveur : /sante en JSON, / en HTML, lecture seule, 404 ailleurs', async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'velyx-srv-')), 'j.jsonl');
  new Registre(f).ajouter({ type: 'aveu', motif: 'acte de test' });
  const { s, base } = await demarrer(f);
  try {
    const sante = await fetch(`${base}/sante`);
    assert.equal(sante.status, 200);
    const j = await sante.json();
    assert.equal(j.ok, true);
    assert.equal(j.registre.lignes, 1);
    assert.equal(j.encaisse_eur, 0);
    const accueil = await fetch(`${base}/`);
    assert.equal(accueil.status, 200);
    assert.match(accueil.headers.get('content-type'), /text\/html/);
    assert.match(await accueil.text(), /Agent en service/);
    const ecriture = await fetch(`${base}/`, { method: 'POST', body: 'x' });
    assert.equal(ecriture.status, 405, 'aucune écriture possible');
    for (const p of ['/cycle', '/registre/journal.jsonl', '/../prive/']) assert.equal((await fetch(`${base}${p}`)).status, 404, p);
  } finally { s.close(); }
});

test('serveur : registre absent ou cassé → /sante en 503, pas de plantage', async () => {
  const { s, base } = await demarrer(path.join(os.tmpdir(), 'velyx-inexistant', 'j.jsonl'));
  try {
    const r = await fetch(`${base}/sante`);
    assert.ok([200, 503].includes(r.status));
    const j = await r.json();
    assert.equal(j.registre.lignes, 0);
  } finally { s.close(); }
});
