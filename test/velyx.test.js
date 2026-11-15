import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseListe, budget, ageHeures } from '../src/sources/codeur.js';
import { resumer } from '../src/sources/sirene.js';
import { RECETTES, appliquer } from '../src/recettes.js';
import { Registre } from '../src/registre.js';

const FICHE_CODEUR = `<a class="block group flex" rel="nofollow" aria-label="Prise de RDV BTP" href="/projects/492531-prise-de-rdv">
  <h3>Prise de RDV BTP</h3><span class="text-sm text-blue-dark/40 whitespace-nowrap ml-2">
      Il y a 8 jours
    </span>
  <span class="w-2 h-2 rounded-full mr-1.5 bg-green-400"></span>
      Ouvert
    </span>
  <span title="Budget"><img src="x.svg" />
      1 000 € à 10 000 €
    </span><span title="Offres">
      4 Offres
    </span><span title="Vues">
      6579 Vues
    </span>
  <div class="text-blue-dark/70 text-sm line-clamp-3 mt-1">Cabinet de courtage</div>
  <span class="inline-flex gap-1 items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-50">
          Télémarketing
        </span>
</a>
</div>`;

test('codeur : une annonce est lue champ par champ, sans rien deviner', () => {
  const [x] = parseListe(FICHE_CODEUR);
  assert.equal(x.id, '492531');
  assert.equal(x.statut, 'Ouvert');
  assert.equal(x.age_h, 192);
  assert.deepEqual([x.budget.min, x.budget.max], [1000, 10000]);
  assert.equal(x.offres, 4);
  assert.deepEqual(x.tags, ['Télémarketing']);
  assert.equal(budget('À définir').min, null);
  assert.equal(ageHeures('hier'), null);
});

const fiche = (o) => ({ siren: '1', nom_complet: 'X', activite_principale: '62.02A', date_creation: '1995-01-01', tranche_effectif_salarie: '01',
  categorie_entreprise: 'PME', siege: { departement: '75', libelle_commune: 'PARIS' },
  dirigeants: [{ type_dirigeant: 'personne physique', qualite: 'Gérant', nom: 'A', prenoms: 'B', annee_de_naissance: '1958' }],
  finances: { 2025: { ca: 500000, resultat_net: 20000 }, 2019: { ca: 1, resultat_net: -1 } }, ...o });

test('rachat IT : micro-entreprise INSEE seulement, comptes récents seulement', () => {
  const r = RECETTES['rachat-it-idf'];
  const { gardees } = appliquer(r, [fiche(), fiche({ siren: '2', finances: { 2025: { ca: 9e8, resultat_net: 1e7 } } }),
    fiche({ siren: '3', finances: { 2017: { ca: 400000, resultat_net: 9000 } } }), fiche({ siren: '4', siege: { departement: '13' } })].map(resumer));
  assert.deepEqual(gardees.map((e) => e.siren), ['1', '3']);
  assert.ok(gardees[0].signaux.some((s) => s.code === 'rentable'));
  assert.ok(!gardees[1].signaux.some((s) => s.code === 'rentable'), 'un bénéfice de 2017 n’est pas un signal');
});

test('les commissaires aux comptes ne sont pas des dirigeants', () => {
  const e = resumer(fiche({ dirigeants: [{ type_dirigeant: 'personne physique', qualite: 'Commissaire aux comptes titulaire', nom: 'Z' }] }));
  assert.equal(e.dirigeants.length, 0);
});

test('registre : chaîné, et seuls les actes du propriétaire comptent comme argent', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'velyx-')), 'j.jsonl');
  const reg = new Registre(f);
  assert.throws(() => reg.ajouter({ type: 'encaissement', montant_eur: 500, preuve: 'x' }), /propriétaire/);
  assert.throws(() => reg.ajouter({ type: 'pari', hypothese: 'h' }), /il manque/);
  reg.ajouter({ type: 'encaissement', auteur: 'proprietaire', montant_eur: 120, preuve: 'virement du 20/11' });
  assert.equal(new Registre(f).etat().encaisse_eur, 120);
  assert.equal(new Registre(f).verifier().ok, true);
  const a = new Registre(f), b = new Registre(f);   // deux processus ouverts en même temps
  a.ajouter({ type: 'aveu', motif: 'a' });
  b.ajouter({ type: 'aveu', motif: 'b' });
  assert.equal(new Registre(f).verifier().ok, true, 'des écritures concurrentes gardent la chaîne intacte');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('120', '1200'));
  assert.equal(new Registre(f).verifier().ok, false, 'un montant retouché est détecté');
});
