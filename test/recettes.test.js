// Tests de src/recettes.js et de etat/recettes/*.json (M5). Hors réseau ; fixtures fictives.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerHorloge, creerMagasin } from '../src/socle.js';
import {
  RECETTES, SIGNAUX, PARAMS_AUTORISES, validerRecette, compiler, appliquer, chargerRecettes, ecrireRecette, proposerRecette,
  activerRecette, chiffresRecette,
} from '../src/recettes.js';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const F = JSON.parse(fs.readFileSync(new URL('./fixtures/commun/entreprises.json', import.meta.url), 'utf8'));
const n = (i) => structuredClone(F[i - 1]);
const H = creerHorloge('2026-11-15T21:00:00Z');
const SPECS = chargerRecettes(creerMagasin(RACINE));
const spec = (id) => structuredClone(SPECS[id]);

// Recette rachat-it-idf de la v1 (bin/velyx.js avant la v2), recopiée comme référence.
const IDF = ['75', '77', '78', '91', '92', '93', '94', '95'];
const PRINCIPAUX = /président|gérant|directeur général|dirigeant|exploitant/i;
const gardeV1 = (AN) => (e) => IDF.includes(e.departement) && !['GE', 'ETI'].includes(e.categorie) && !(e.ca?.ca > 2e6)
  && e.dirigeants.some((d) => PRINCIPAUX.test(d.qualite) && d.annee_naissance && d.annee_naissance <= AN - 62);

test('les quatre recettes publiques sont valides, actives, nommées comme leur fichier, sans nom ni SIREN', () => {
  assert.deepEqual(Object.keys(SPECS).sort(), ['btp-creations-zone', 'courtier-btp-aura', 'courtiers-construction', 'rachat-it-idf']);
  for (const s of Object.values(SPECS)) {
    assert.equal(validerRecette(s).ok, true, s.id);
    const brut = fs.readFileSync(path.join(RACINE, 'etat', 'recettes', `${s.id}.json`), 'utf8');
    assert.doesNotMatch(brut, /(?<!\d)\d{9}(?!\d)|"(nom|siren|dirigeants|adresse)"\s*:/);
  }
});

test('rachat-it-idf, horloge 2026, G2 à G10 neutralisés (G4 ne se neutralise pas) → mêmes gardées que la v1, oppositions en moins', () => {
  const r = compiler(spec('rachat-it-idf'), H);
  const neutres = ['G2', 'G3', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10'];
  const { gardees } = appliquer(r, F, { horloge: H, oppositions: new Set(), neutraliser: neutres });
  const v1 = F.filter(gardeV1(2026));
  assert.ok(v1.some((e) => e.opposition), 'la référence v1 garde une société opposée');
  assert.deepEqual(gardees.map((e) => e.siren).sort(), v1.filter((e) => !e.opposition).map((e) => e.siren).sort());
  assert.throws(() => appliquer(r, F, { horloge: H, neutraliser: [...neutres, 'G4'] }), /non neutralisable/);
});

test('l’année vient de l’horloge : en 2027 (heure de Paris), le seuil de naissance passe à 1965', () => {
  const nouvelAn = creerHorloge('2026-12-31T23:30:00Z');             // déjà le 1er janvier 2027 à Paris
  const r27 = compiler(spec('rachat-it-idf'), nouvelAn), r26 = compiler(spec('rachat-it-idf'), H);
  assert.equal(r27.params.date_naissance_personne_max, '1965-12-31');
  assert.equal(r26.params.date_naissance_personne_max, '1964-12-31');
  const ne65 = { ...n(14), dirigeants: [{ qualite: 'Gérant', nom: 'Fictif TESTEUR', annee_naissance: 1965 }] };
  assert.equal(r27.garder(ne65), true);
  assert.equal(r26.garder(ne65), false);
});

test('v1 conservé : micro-entreprise INSEE seulement, comptes récents seulement', () => {
  const r = RECETTES['rachat-it-idf'];
  const base = { ...n(14), opposition: false };
  const fiches = [base, { ...base, siren: '999000901', finances: [{ annee: 2025, ca: 9e8, resultat_net: 1e7 }], ca: { annee: 2025, ca: 9e8, resultat_net: 1e7 } },
    { ...base, siren: '999000902', finances: [{ annee: 2017, ca: 400000, resultat_net: 9000 }], ca: { annee: 2017, ca: 400000, resultat_net: 9000 } },
    { ...base, siren: '999000903', departement: '13' }];
  const { gardees } = appliquer(r, fiches, { horloge: H, oppositions: new Set() });
  assert.deepEqual(gardees.map((e) => e.siren), [base.siren, '999000902']);
  assert.ok(gardees[0].signaux.some((s) => s.code === 'rentable'));
  assert.ok(!gardees[1].signaux.some((s) => s.code === 'rentable'), 'un bénéfice de 2017 n’est pas un signal');
  assert.equal(gardees[1].complet, false, 'G2 : une fiche à comptes périmés n’est pas complète');
});

test('G2 dans une recette : comptes de 2019 → aucun signal financier, fiche non complète', () => {
  const r = compiler(spec('rachat-it-idf'), H);
  const e = { ...n(3), finances: [{ annee: 2019, ca: 410000, resultat_net: 28000 }], ca: { annee: 2019, ca: 410000, resultat_net: 28000 } };
  const { gardees } = appliquer(r, [e], { horloge: H, oppositions: new Set() });
  assert.equal(gardees.length, 1);
  assert.ok(!gardees[0].signaux.some((s) => s.code === 'rentable'));
  assert.equal(gardees[0].complet, false);
  assert.equal(gardees[0].controle.ca.libelle, 'CA ancien (2019)');
});

test('refus : param « q », clé « code », chaîne « function », signal sans justification, annonce hors codeur.com, primitive inconnue', () => {
  const ok = spec('rachat-it-idf');
  assert.equal(validerRecette(ok).ok, true);
  const refus = (muter, motif) => { const s = spec('rachat-it-idf'); muter(s); const v = validerRecette(s); assert.equal(v.ok, false, motif); assert.throws(() => compiler(s, H), /refusée/); };
  refus((s) => { s.params.q = 'btp'; }, 'param q');
  refus((s) => { s.code = 'e => true'; }, 'clé code');
  refus((s) => { s.besoin = 'function () { return true }'; }, 'chaîne function');
  refus((s) => { delete s.signaux[0].justification; }, 'sans justification');
  refus((s) => { s.signaux[0].justification = 'court'; }, 'justification trop courte');
  refus((s) => { s.annonce = 'https://www.malt.fr/projects/1'; }, 'annonce hors codeur');
  refus((s) => { s.signaux[0].primitive = 'eval'; }, 'primitive inconnue');
  refus((s) => { s.signaux[0].args = [['62']]; }, 'argument de mauvaise forme');
  refus((s) => { s.params.activite_principale = { expr: 'process.exit()' }; }, 'expression libre');
  refus((s) => { s.prioritaire = 'inexistant'; }, 'prioritaire sans signal');
  refus((s) => { s.garder.departements = [{ var: 'departement' }]; }, 'variable non déclarée');
  assert.ok(!PARAMS_AUTORISES.includes('q'));
});

test('sans_codirigeant_moins_de(50) est faux s’il existe un co-gérant de 41 ans', () => {
  const f = SIGNAUX.sans_codirigeant_moins_de([50], H);
  assert.equal(f(n(8)), null, 'co-gérante née en 1985');
  assert.equal(f(n(1)).code, 'sans_codirigeant_moins_de');
  assert.equal(f({ ...n(1), dirigeants: [] }), null, 'aucun âge connu : pas de signal');
});

test('primitives : aucun libellé court ne donne un âge exact ou une année de naissance', () => {
  const tous = Object.entries(SIGNAUX).map(([k, p]) => p(k === 'naf_prefixe' || k === 'categorie_dans' ? [['62', 'PME']] : [k.includes('creation') ? 5 : 62], H));
  for (const e of F) {
    for (const f of tous) {
      const s = f(e);
      if (!s) continue;
      assert.doesNotMatch(s.court, /\b19\d{2}\b/, s.court);
      if (/dirigeant/.test(s.court) && /\d+ ans/.test(s.court)) assert.match(s.court, /ou plus|moins de/, `seuil, jamais âge exact : ${s.court}`);
    }
  }
});

test('courtier-btp-aura : categorie_entreprise = PME côté serveur, exceptions_ratio des promoteurs, signal prioritaire « récente »', () => {
  const s = spec('courtier-btp-aura');
  assert.equal(s.params.categorie_entreprise, 'PME');
  assert.deepEqual(s.exceptions_ratio, ['41.10A', '41.20A', '41.20B']);
  const r = compiler(s, H);
  const { gardees } = appliquer(r, F, { horloge: H, oppositions: new Set() });
  assert.ok(!gardees.some((e) => e.categorie === 'ETI'), 'filiale d’ETI écartée');
  const promoteur = gardees.find((e) => e.naf === '41.10A');
  assert.ok(promoteur.signaux.some((x) => x.code === 'operation'));
  assert.ok(!promoteur.controle.drapeaux.includes('ca_par_salarie_eleve'));
  assert.equal(r.rang({ signaux: [{ code: 'recente' }] }), 11);
  assert.deepEqual(chiffresRecette(r), { effectif_min: 6, effectif_max: 99, recente: 3 });
});

test('btp-creations-zone : département et ancienneté en variables, filtre de date côté client, oppositions et diffusion P exclues, RGE en colonne', () => {
  const s = spec('btp-creations-zone');
  const r42 = compiler(s, H, { departement: '42', mois: 18 });
  assert.equal(r42.params.departement, '42');
  assert.equal(r42.params.etat_administratif, 'A');
  assert.equal(r42.garder(n(11)), true, 'créée le 2025-09-12, dans les 18 mois');
  assert.equal(compiler(s, H, { departement: '42', mois: 12 }).garder(n(11)), false, 'hors des 12 mois');
  assert.equal(r42.garder(n(12)), false, 'autre département');
  const r74 = compiler(s, H, { departement: '74' });
  assert.equal(r74.variables.mois, 12, 'défaut');
  const creees = [n(12), { ...n(12), siren: '999000911', opposition: true }, { ...n(12), siren: '999000922', statut_diffusion: 'P' },
    { ...n(12), siren: '999000913', creation: '2024-01-10' }];
  const { gardees, exclues, compte } = appliquer(r74, creees, { horloge: H, oppositions: new Set() });
  assert.deepEqual(gardees.map((e) => e.siren), [n(12).siren]);
  assert.deepEqual(exclues.map((e) => e.siren).sort(), ['999000911', '999000922']);
  assert.equal(compte.hors_recette, 1, 'créée en 2024 : hors des 12 mois');
  assert.ok(gardees[0].signaux.some((x) => x.code === 'rge'));
  assert.deepEqual(compte.par_signal, { rge: 1, operation: 0, employeur: 0 });
  assert.equal(chiffresRecette(r74).creation_moins_de_mois, 12);
  assert.throws(() => compiler(s, H, { departement: '6A' }), /illisible/);
  assert.throws(() => compiler(s, H, { region: '84' }), /inconnue/);
});

test('courtiers-construction : nom contenant btp, construction, batiment ou decennale (accents ignorés), sociétés seulement, une recherche par mot', () => {
  const r = compiler(spec('courtiers-construction'), H);
  assert.equal(r.garder(n(16)), true, 'FICTICOURT CONSTRUCTION ASSURANCES');
  assert.equal(r.garder(n(17)), true, 'BTP GARANTIES COURTAGE FICTIF');
  assert.equal(r.garder({ ...n(16), nom: 'CABINET BÂTIMENTS ET RISQUES' }), true);
  assert.equal(r.garder({ ...n(16), nom: 'ASSURANCES DÉCENNALE PLUS' }), true);
  assert.equal(r.garder({ ...n(16), nom: 'DEBTPX COURTAGE' }), false, 'mot entier seulement');
  assert.equal(r.garder({ ...n(16), nom: 'RECONSTRUCTIONS FICTIVES' }), false);
  assert.equal(r.garder({ ...n(16), nature_juridique: '1000' }), false, 'entrepreneur individuel écarté');
  assert.equal(r.params.q, undefined);
  assert.deepEqual(r.recherches.map((x) => x.q), ['btp', 'construction', 'batiment', 'decennale']);
  assert.ok(r.recherches.every((x) => x.activite_principale === '66.22Z'));
  const { gardees } = appliquer(r, F, { horloge: H, oppositions: new Set() });
  assert.deepEqual(gardees.map((e) => e.siren).sort(), [n(16).siren, n(17).siren].sort());
});

test('magasin : une recette proposée par le LLM entre « candidate » ; active seulement après exécution à blanc et sonde de 1 à 50 000', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'velyx-recettes-'));
  const m = creerMagasin(dir);
  const s = { ...spec('rachat-it-idf'), id: 'essai-llm' };
  proposerRecette(m, s);
  assert.deepEqual(chargerRecettes(m), {}, 'aucune active');
  const c = chargerRecettes(m, { statut: 'candidate' })['essai-llm'];
  assert.equal(c.statut, 'candidate');
  assert.equal(c.auteur, 'llm');
  assert.throws(() => activerRecette(m, 'essai-llm', { a_blanc: { ok: true }, sonde: { total: 0 } }), /sonde/);
  assert.throws(() => activerRecette(m, 'essai-llm', { a_blanc: { ok: false }, sonde: { total: 12 } }), /à blanc/);
  activerRecette(m, 'essai-llm', { a_blanc: { ok: true }, sonde: { total: 1111 } });
  assert.equal(chargerRecettes(m)['essai-llm'].statut, 'active');
  assert.throws(() => proposerRecette(m, s), /déjà active/);
  assert.throws(() => ecrireRecette(m, { ...s, params: { q: 'x' } }), /refusée/);
  fs.writeFileSync(path.join(dir, 'etat', 'recettes', 'mal-nommee.json'), JSON.stringify({ ...s, id: 'autre-id' }));
  assert.throws(() => chargerRecettes(m), /ne correspond pas/);
});

test('compatibilité bin/velyx.js : RECETTES compilées au chargement, appliquer à deux arguments, objet v1 accepté', () => {
  for (const id of ['rachat-it-idf', 'courtier-btp-aura']) {
    assert.match(RECETTES[id].annonce, /^https:\/\/www\.codeur\.com\/projects\//);
    assert.ok(RECETTES[id].besoin && RECETTES[id].params.activite_principale);
  }
  const { gardees, compte } = appliquer({ garder: () => true, signaux: (e) => e.signaux ?? [], complet: () => true }, [n(14), n(4)]);
  assert.deepEqual(gardees.map((e) => e.siren), [n(14).siren], 'même un objet v1 passe par les contrôles (G4)');
  assert.equal(compte.exclues, 1);
  assert.equal(typeof compte.par_signal, 'object');
});
