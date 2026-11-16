// Tests de la garde antifuite (M3). Données fictives seulement (test/fixtures/commun/entreprises.json, canari
// « Zéphyrin CANARIX »). Les numéros, téléphones et e-mails d'essai sont fabriqués à l'exécution : ce fichier, suivi par
// git, doit lui-même passer le scan structurel de la CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerMagasin, creerHorloge, PubliqueRefusee } from '../src/socle.js';
import { Registre } from '../src/registre.js';
import {
  CLES_INTERDITES_PUBLIC, CLES_IGNOREES_SCAN, MOTIFS, luhn, dictionnaire, scannerTexte, verifierObjetPublic, verifierPublic, scannerDepot,
  structurel, chargerOppositions, estExclue, enregistrerOpposition, minimiser, purgerPrive, rgpdPublic, DictionnaireIncoherent,
  OppositionsIndisponibles, vocabulaire,
} from '../src/garde.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTREPRISES = JSON.parse(fs.readFileSync(path.join(RACINE, 'test', 'fixtures', 'commun', 'entreprises.json'), 'utf8'));
const CANARI = ENTREPRISES[0].dirigeants[0].nom;                 // « Zéphyrin CANARIX », fictif
const NOM_CANARI = CANARI.split(' ')[1];
const dossier = () => fs.mkdtempSync(path.join(os.tmpdir(), 'velyx-garde-'));
const ecrire = (r, rel, contenu) => { fs.mkdirSync(path.dirname(path.join(r, rel)), { recursive: true }); fs.writeFileSync(path.join(r, rel), contenu); };
/** Racine fictive dont prive/listes/ contient les 20 fiches communes. */
function racineAvecListe() {
  const r = dossier();
  ecrire(r, 'prive/listes/fictive-2026-11-15.json', JSON.stringify({ recette: 'fictive', cibles: ENTREPRISES }, null, 1));
  return r;
}
// Identifiants d'essai fabriqués : clé de Luhn calculée, jamais écrite en clair dans ce fichier.
const avecCle = (base) => { for (let d = 0; d < 10; d++) if (luhn(`${base}${d}`)) return `${base}${d}`; return null; };
const SIREN_VALIDE = avecCle('73282932');
const SIRET_VALIDE = avecCle(`${SIREN_VALIDE}0001`);
const TELEPHONE = ['06', '12', '34', '56', '78'].join(' ');
const EMAIL = ['prenom.nom', 'exemple.fr'].join('@');

test('constantes : clés interdites et champs d’empreinte de la spécification', () => {
  for (const k of ['nom', 'nom_complet', 'prenoms', 'dirigeants', 'adresse', 'commune', 'siren', 'siret', 'date_de_naissance', 'annee_naissance',
    'nationalite', 'email', 'telephone', 'titre', 'description', 'resume', 'preuve', 'phrase']) assert.ok(CLES_INTERDITES_PUBLIC.includes(k), k);
  assert.deepEqual([...CLES_IGNOREES_SCAN], ['empreinte', 'precedente', 'cle', 'sha256', '*_sha256', 'preuve_empreinte']);
  assert.ok(SIREN_VALIDE && luhn(SIREN_VALIDE) && SIRET_VALIDE && luhn(SIRET_VALIDE));
  for (const re of Object.values(MOTIFS)) assert.ok(re.global);
});

test('canari : recopié de prive/listes/ dans un README → scannerDepot.ok = false, et la sortie ne contient pas le nom', () => {
  const r = racineAvecListe();
  ecrire(r, 'README.md', `# Essai\n\nContact pressenti : ${CANARI}, gérant.\n`);
  ecrire(r, 'etat/kpi.json', JSON.stringify({ n: 3 }));
  const dict = dictionnaire(creerMagasin(r));
  assert.ok(dict.jetons.has(NOM_CANARI), 'nom du canari au dictionnaire');
  assert.equal(dict.nominatifs_presents, 1);
  assert.equal(dict.sirens.size, 20);
  const res = scannerDepot(r, dict);
  assert.equal(res.ok, false);
  assert.deepEqual(res.fuites, [{ fichier: 'README.md', ligne: 3, motif: 'dictionnaire' }]);
  assert.equal(res.dictionnaire_vide, false);
  assert.ok(res.n_jetons > 20);
  const sortie = JSON.stringify(res);
  assert.ok(!/CANARIX/i.test(sortie) && !/Zéphyrin/i.test(sortie), 'aucun jeton dans la sortie');
  assert.ok(!res.fuites.some((f) => f.fichier.startsWith('prive/')), 'prive/ exclu du scan');
  // D'autres formes de la même fuite.
  for (const t of [`M. ${NOM_CANARI[0]}${NOM_CANARI.slice(1).toLowerCase()} a répondu`, `${NOM_CANARI} seul`, 'canarix conseil informatique',
    `société ${ENTREPRISES[0].siren}`]) assert.equal(scannerTexte(t, dict).n, 1, t);
  assert.equal(scannerTexte('un canarix en minuscules, seul, ne nomme personne', dict).n, 0);
});

test('journal réel (15 lignes) → structurel : 0 fuite ; le motif naïf « 9 chiffres » y voit 2 faux positifs (empreintes, lignes 8 et 9)', () => {
  const lignes = fs.readFileSync(path.join(RACINE, 'registre', 'journal.jsonl'), 'utf8').split('\n').slice(0, 15);
  const r = dossier();
  ecrire(r, 'registre/journal.jsonl', `${lignes.join('\n')}\n`);
  const s = structurel(r);
  assert.deepEqual([s.ok, s.fuites], [true, []]);
  assert.equal(s.fichiers, 1);
  const naif = lignes.map((l, i) => (/\d{9}/.test(l) ? i + 1 : null)).filter(Boolean);
  assert.deepEqual(naif, [8, 9]);
  assert.ok(lignes[7].includes('"empreinte":"f63f9dd690707872"') && lignes[8].includes('"precedente":"f63f9dd690707872"'));
});

test('motifs structurels : SIREN et SIRET à clé valide, téléphone, e-mail ; hors champs d’empreinte et hors URL banales', () => {
  const groupe = `${SIREN_VALIDE.slice(0, 3)} ${SIREN_VALIDE.slice(3, 6)} ${SIREN_VALIDE.slice(6)}`;
  const motif = (t) => scannerTexte(t, null).positions.map((p) => p.motif);
  assert.deepEqual(motif(`siren ${SIREN_VALIDE}`), ['siren']);
  assert.deepEqual(motif(`siren ${groupe}.`), ['siren'], 'groupé par 3');
  assert.deepEqual(motif(`siret ${SIRET_VALIDE}`), ['siret'], 'un SIRET n’est pas compté aussi comme SIREN');
  assert.deepEqual(motif(`appeler le ${TELEPHONE}`), ['telephone']);
  assert.deepEqual(motif(`appeler le +33 ${TELEPHONE.slice(1)}`), ['telephone']);
  assert.deepEqual(motif(`écrire à ${EMAIL}`), ['email']);
  assert.deepEqual(motif('9 chiffres à clé fausse : 999000012'), [], 'clé de Luhn fausse : aucune entreprise');
  assert.deepEqual(motif('ref a690707872b'), [], 'collé à des lettres');
  assert.deepEqual(motif(JSON.stringify({ empreinte: `ab${SIREN_VALIDE}`, sha256: SIREN_VALIDE, cle: SIREN_VALIDE, fichier_sha256: SIREN_VALIDE, n: 2 })), []);
  assert.deepEqual(motif(`  "precedente": "${SIREN_VALIDE}",`), [], 'ligne d’empreinte d’un JSON indenté');
  assert.deepEqual(motif(`https://help.exemple.com/articles/${SIRET_VALIDE}-faq`), [], 'identifiant technique d’URL');
  assert.deepEqual(motif(`https://annuaire-entreprises.data.gouv.fr/entreprise/${SIREN_VALIDE}`), ['siren'], 'fiche de registre');
  assert.deepEqual(motif('montant 1 500 € ; 6592 vues ; 2026-11-15T06:41:00Z'), []);
});

test('verifierObjetPublic : {par_signal: {rge: 3}} accepté ; {cibles: [{nom}]} refusé ; {departement: "69", n: 3} refusé', () => {
  assert.deepEqual(verifierObjetPublic({ par_signal: { rge: 3 } }, null), { ok: true, motifs: [] });
  const nom = verifierObjetPublic({ cibles: [{ nom: 'X' }] }, null);
  assert.equal(nom.ok, false);
  assert.deepEqual(nom.motifs, ['clé interdite « nom »']);
  assert.equal(verifierObjetPublic({ departement: '69', n: 3 }, null).ok, false);
  assert.equal(verifierObjetPublic({ par_departement: [{ departement: '69', n: 7 }] }, null).ok, true);
  assert.equal(verifierObjetPublic({ texte: 'x'.repeat(401) }, null).ok, false, 'texte libre > 400 caractères');
  assert.equal(verifierObjetPublic({ texte: 'x'.repeat(400) }, null).ok, true);
  assert.equal(verifierObjetPublic({ empreinte: 'f63f9dd690707872', precedente: SIREN_VALIDE }, null).ok, true);
  assert.deepEqual(verifierObjetPublic({ note: `voir ${SIREN_VALIDE}` }, null).motifs, ['motif siren']);
  assert.deepEqual(verifierObjetPublic({ liste: [{ contact: EMAIL }] }, null).motifs, ['motif email']);
  assert.deepEqual(verifierObjetPublic({ m: TELEPHONE }, null).motifs, ['motif telephone']);
  const dict = dictionnaire(creerMagasin(racineAvecListe()));
  const fuite = verifierObjetPublic({ lecon: `relancer ${CANARI}` }, dict);
  assert.deepEqual(fuite.motifs, ['jeton du dictionnaire']);
  assert.ok(!JSON.stringify(fuite).includes(NOM_CANARI));
});

test('verifierPublic branché sur le magasin : écriture publique refusée, privée libre', () => {
  const r = racineAvecListe(), dict = dictionnaire(creerMagasin(r));
  const m = creerMagasin(r, { verifierPublic: (rel, c) => verifierPublic(rel, c, dict) });
  assert.throws(() => m.ecrirePublic('etat/x.json', { cibles: [{ nom: 'X' }] }), PubliqueRefusee);
  assert.throws(() => m.ajouterPublicJsonl('etat/series/2026-11-15.jsonl', [{ id: '1', motif: `${CANARI}` }]), PubliqueRefusee);
  assert.throws(() => m.ecrirePublic('etat/notes.md', `Note : ${CANARI}\n`), PubliqueRefusee);
  m.ecrirePublic('etat/kpi.json', { par_signal: { rge: 3 } });
  m.ajouterPublicJsonl('etat/series/2026-11-15.jsonl', [{ id: '491001', t: '2026-11-15T06:41:00.000Z', offres: 4, tags: ['Télémarketing'] }]);
  m.ecrirePrive('prive/notes.md', `Note : ${CANARI}\n`);
  assert.equal(verifierPublic('etat/x.json', '{illisible', dict).ok, false);
  assert.deepEqual(verifierPublic('etat/ok.jsonl', '{"n":6,"departement":"69"}\n', dict), { ok: true });
});

test('fichier nominatif présent mais 0 jeton → DictionnaireIncoherent ; dictionnaire vide sans fichier nominatif → dictionnaire_vide = true', () => {
  const r = dossier();
  ecrire(r, 'prive/listes/format-inconnu-2026-11-15.json', JSON.stringify([{ siren: '999000012', responsable: CANARI }]));
  assert.throws(() => dictionnaire(creerMagasin(r)), DictionnaireIncoherent);
  try { dictionnaire(creerMagasin(r)); } catch (e) { assert.ok(!e.message.includes(NOM_CANARI), 'le message ne cite aucun jeton'); }
  const illisible = dossier();
  ecrire(illisible, 'prive/listes/x.json', '{pas du json');
  assert.throws(() => dictionnaire(creerMagasin(illisible)), DictionnaireIncoherent);
  const vide = dossier();
  ecrire(vide, 'prive/listes/vide-2026-11-15.json', JSON.stringify({ recette: 'x', cibles: [] }));
  ecrire(vide, 'prive/cycles/C-2026-11-15/annonces.json', JSON.stringify({ annonces: [{ id: '1', titre: 'Annonce' }] }));
  ecrire(vide, 'etat/kpi.json', '{"n": 1}');
  const d = dictionnaire(creerMagasin(vide));
  assert.deepEqual([d.jetons.size, d.sirens.size, d.nominatifs_presents], [0, 0, 0]);
  const s = scannerDepot(vide, d);
  assert.equal(s.dictionnaire_vide, true, 'jamais un « 0 fuite » silencieux');
  assert.equal(s.n_jetons, 0);
  assert.equal(scannerDepot(vide, null).dictionnaire_vide, true);
});

test('dictionnaire : fiches brutes, CSV et mémoire ; prénoms faibles, mots courants et valeurs de remplacement', () => {
  const r = dossier();
  const brutes = JSON.parse(fs.readFileSync(path.join(RACINE, 'test', 'fixtures', 'sirene', 'fiches-brutes.json'), 'utf8'));
  brutes[1].dirigeants.push({ type_dirigeant: 'personne physique', qualite: 'Gérant', nom: '[NON-DIFFUSIBLE]', prenoms: '[NON-DIFFUSIBLE]' });
  ecrire(r, 'prive/listes/brutes-2026-11-15.brut.json', JSON.stringify({ fiches: brutes }));
  ecrire(r, 'prive/listes/fictive-2026-11-15.csv', 'siren;nom;commune;dirigeant\n"999000150";"ONIRIA STUDIO";"SAINT-DENIS";"Quirinus ONIRIA (Gérant)"\n');
  ecrire(r, 'prive/memoire.json', JSON.stringify({ version: 1, oppositions: ['999000168'], echantillons: { 'R-1': { sirens: ['999000176'] } } }));
  const d = dictionnaire(creerMagasin(r));
  for (const j of ['IMAGINOR', 'ANATOLE', 'CHIMEREX', 'ONIRIA', 'QUIRINUS']) assert.ok(d.jetons.has(j), j);
  assert.ok(!d.jetons.has('DIFFUSIBLE'), 'valeur de remplacement du registre écartée');
  assert.ok(d.jetons.has('AUDITORIX'), 'toute personne physique des fiches est protégée, commissaire aux comptes compris');
  assert.ok(d.jetons.has('CHIMEREX CONSEIL') && d.jetons.has('ONIRIA STUDIO'), 'nom d’entreprise qui contient celui du dirigeant');
  assert.ok(d.faibles.has('ANATOLE') && !d.faibles.has('IMAGINOR'));
  for (const s of ['999000101', '999000150', '999000168', '999000176', '999000127']) assert.ok(d.sirens.has(s), s);
  assert.equal(d.nominatifs_presents, 2);
  // Un prénom seul, ou un mot courant seul, ne compte pas ; à côté d'un nom, si.
  assert.equal(scannerTexte('Anatole a écrit', d).n, 0);
  assert.equal(scannerTexte('Anatole Imaginor a écrit', d).n, 1);
  assert.equal(scannerTexte('Saint-Denis et ses environs', d).n, 0, 'nom de commune');
  const avecMotCourant = dossier();
  ecrire(avecMotCourant, 'prive/listes/m-2026-11-15.json', JSON.stringify([{ siren: '999000184', nom: 'X', dirigeants: [{ qualite: 'Gérant', nom: 'Quirinus PETIT', annee_naissance: 1970 }] }]));
  const dm = dictionnaire(creerMagasin(avecMotCourant));
  assert.equal(scannerTexte('Petit rappel : un petit lot.', dm).n, 0);
  assert.equal(scannerTexte(`M. ${'Petit'} a rappelé`, dm).n, 1, 'civilité + nom courant');
  assert.ok(vocabulaire('des pages et des Pages').has('PAGES'));
});

test('chargerOppositions : n_total = 2 au registre et mémoire absente → OppositionsIndisponibles ; n_total = 0 → ensemble vide', () => {
  const r = dossier(), m = creerMagasin(r), reg = new Registre(null);
  assert.deepEqual(chargerOppositions(m, reg), new Set(), 'aucun acte, aucune mémoire : vide, sans erreur');
  reg.ajouter({ type: 'opposition', n_total: 0, origine: 'registre', cle: 'opposition:zero' });
  assert.deepEqual(chargerOppositions(m, reg), new Set());
  reg.ajouter({ type: 'opposition', n_total: 2, origine: 'demande', cle: 'opposition:deux' });
  assert.throws(() => chargerOppositions(m, reg), OppositionsIndisponibles);
  m.ecrirePrive('prive/memoire.json', { version: 1, oppositions: ['999000012'] });
  assert.throws(() => chargerOppositions(m, reg), OppositionsIndisponibles, 'la mémoire en contient moins');
  m.ecrirePrive('prive/memoire.json', { version: 1, oppositions: ['999000012', '999000046'] });
  const o = chargerOppositions(m, reg);
  assert.deepEqual([...o].sort(), ['999000012', '999000046']);
  assert.equal(estExclue(ENTREPRISES[0], o), true, 'opposition reçue');
  assert.equal(estExclue(ENTREPRISES[3], new Set()), true, 'opposition au registre (opposition_diffusion_commerciale)');
  assert.equal(estExclue(ENTREPRISES[1], o), false);
});

test('enregistrerOpposition : acte sans SIREN, clé salée et idempotente, admis par le registre', () => {
  const a = enregistrerOpposition('999000012', 'demande', { memoire: null, horloge: creerHorloge('2026-11-15T12:00:00Z') });
  assert.deepEqual(Object.keys(a.acte).sort(), ['cle', 'n_total', 'origine', 'type']);
  assert.equal(a.acte.n_total, 1);
  assert.ok(!JSON.stringify(a.acte).includes('999000012'));
  assert.match(a.memoire.nonce, /^[0-9a-f]{16}$/);
  assert.equal(a.memoire.maj_le, '2026-11-15T12:00:00.000Z');
  const b = enregistrerOpposition('999000012', 'demande', { memoire: a.memoire });
  assert.deepEqual([b.acte.cle, b.acte.n_total], [a.acte.cle, 1], 'même SIREN : même clé, pas de doublon');
  const c = enregistrerOpposition('999000046', 'registre', { memoire: b.memoire });
  assert.deepEqual(c.memoire.oppositions, ['999000012', '999000046']);
  assert.equal(c.acte.n_total, 2);
  assert.notEqual(enregistrerOpposition('999000012', 'demande', { memoire: { nonce: '0123456789abcdef' } }).acte.cle, a.acte.cle, 'clé salée par le nonce privé');
  const reg = new Registre(null);
  const l1 = reg.ajouter(a.acte), l2 = reg.ajouter(b.acte);
  assert.equal(l1.n, l2.n, 'le registre ne duplique pas');
  assert.throws(() => enregistrerOpposition('12', 'demande'), TypeError);
  assert.throws(() => enregistrerOpposition('999000012', 'autre'), TypeError);
  assert.equal(rgpdPublic(reg).n_oppositions, 1);
  assert.deepEqual(Object.keys(rgpdPublic(reg)).sort(), ['base_legale', 'conservation_jours', 'contact', 'finalite', 'n_oppositions', 'sources']);
  assert.equal(verifierObjetPublic(rgpdPublic(reg), null).ok, true, 'la notice RGPD passe la garde publique');
});

test('minimiser : EI → nom_affichable null ; dirigeant né en 1958, horloge 2026 → « 62 ans ou plus » ; aucun nom ni année', () => {
  const h = creerHorloge('2026-11-15T12:00:00Z'), dict = dictionnaire(creerMagasin(racineAvecListe()));
  const ei = minimiser(ENTREPRISES[5], h, dict, { rang: 6 });
  assert.equal(ENTREPRISES[5].nature_juridique, '1000');
  assert.equal(ei.nom_affichable, null);
  assert.equal(ei.alias, 'S06');
  const canari = minimiser(ENTREPRISES[0], h, dict);
  assert.equal(canari.nom_affichable, null, 'le nom contient celui du dirigeant');
  assert.equal(canari.dirigeant.tranche_age, '62 ans ou plus');
  assert.equal(minimiser(ENTREPRISES[0], h, null).nom_affichable, null, 'même sans dictionnaire : ses propres dirigeants');
  const pme = minimiser(ENTREPRISES[1], h, dict);
  assert.equal(pme.nom_affichable, ENTREPRISES[1].nom);
  assert.deepEqual(pme.ca, { annee: 2025, statut: 'publie', montant: 50_000_000 });
  assert.deepEqual(minimiser(ENTREPRISES[2], h, dict).ca, { annee: 2019, statut: 'ancien', montant: 410_000 });
  assert.deepEqual(minimiser(ENTREPRISES[5], h, dict).ca, { annee: null, statut: 'non_publie', montant: null });
  const jeune = minimiser({ ...ENTREPRISES[7], dirigeants: [ENTREPRISES[7].dirigeants[1]] }, h, dict);
  assert.equal(jeune.dirigeant.tranche_age, 'moins de 62 ans');
  assert.equal(minimiser({ ...ENTREPRISES[1], dirigeants: [{ qualite: 'Gérant', nom: 'X', annee_naissance: null }] }, h).dirigeant.tranche_age, 'inconnu');
  assert.deepEqual(minimiser({ ...ENTREPRISES[1], signaux: [{ code: 'transmission', court: 'dirigeant 68 ans' }] }, h).signaux, ['transmission'], 'pas d’âge exact');
  for (const e of ENTREPRISES) {
    const t = JSON.stringify(minimiser(e, h, dict));
    assert.ok(!t.includes('annee_naissance') && !t.includes('dirigeants'), e.siren);
    for (const d of e.dirigeants) assert.ok(!t.includes(d.nom), 'aucun nom de dirigeant');
    assert.ok(!/\b(19|20)\d{2}\b/.test(JSON.stringify(minimiser(e, h, dict).dirigeant)), 'aucune année de naissance');
  }
});

test('purgerPrive(fin_cycle) supprime *.brut.json et cache/, garde memoire.json ; opposition sur un SIREN de 2 listes → retiré des 2', () => {
  const r = racineAvecListe(), m = creerMagasin(r);
  ecrire(r, 'prive/rachat-it-idf-2026-11-15.brut.json', '{"fiches": []}');
  ecrire(r, 'prive/cache/sirene/p1.json', '[]');
  ecrire(r, 'prive/memoire.json', JSON.stringify({ version: 1, oppositions: ['999000046'], echantillons: { 'R-1': { sirens: ['999000012', '999000020'] } } }));
  const fin = purgerPrive(m, { motif: 'fin_cycle' });
  assert.deepEqual(fin.supprimes.sort(), ['prive/cache/', 'prive/rachat-it-idf-2026-11-15.brut.json']);
  assert.ok(fs.existsSync(path.join(r, 'prive/memoire.json')) && fs.existsSync(path.join(r, 'prive/listes/fictive-2026-11-15.json')));
  assert.ok(!fs.existsSync(path.join(r, 'prive/cache')));
  // Le canari dans une seconde liste (CSV v1).
  ecrire(r, 'prive/listes/autre-2026-11-15.csv', `siren;nom;dirigeant\n"${ENTREPRISES[0].siren}";"${ENTREPRISES[0].nom}";"x"\n"${ENTREPRISES[1].siren}";"Y";"z"\n`);
  const opp = purgerPrive(m, { motif: 'opposition', siren: ENTREPRISES[0].siren });
  assert.deepEqual(opp.supprimes.sort(), ['prive/listes/autre-2026-11-15.csv', 'prive/listes/fictive-2026-11-15.json', 'prive/memoire.json']);
  assert.ok(!m.lire('prive/listes/fictive-2026-11-15.json').includes(ENTREPRISES[0].siren));
  assert.equal(JSON.parse(m.lire('prive/listes/fictive-2026-11-15.json')).cibles.length, 19);
  assert.ok(!m.lire('prive/listes/autre-2026-11-15.csv').includes(ENTREPRISES[0].siren));
  assert.ok(m.lire('prive/listes/autre-2026-11-15.csv').includes(ENTREPRISES[1].siren));
  const mem = JSON.parse(m.lire('prive/memoire.json'));
  assert.deepEqual(mem.echantillons['R-1'].sirens, ['999000020']);
  assert.deepEqual(mem.oppositions, ['999000046'], 'les oppositions restent');
  assert.throws(() => purgerPrive(m, { motif: 'opposition' }), TypeError);
  assert.throws(() => purgerPrive(m, { motif: 'inconnu' }), TypeError);
});

test('purgerPrive(fin_cycle) : la reprise SIRENE du jour est gardée tant que sa liste n’est pas consignée ; sinon, ou le lendemain, purgée', () => {
  const r = dossier(), m = creerMagasin(r), h = creerHorloge('2026-11-17T10:00:00Z');
  const fichiers = ['prive/cycles/C-2026-11-17/cache/reprise-btp-creations-zone.json', 'prive/cycles/C-2026-11-17/cache/autre.json',
    'prive/cycles/C-2026-11-16/cache/reprise-btp-creations-zone.json', 'prive/cache/cibler-courtiers-construction-2026-11-17.json', 'prive/cache/sirene-p1.json'];
  for (const f of fichiers) ecrire(r, f, '{}');
  const reg = new Registre(null, { horloge: h });
  const a = purgerPrive(m, { motif: 'fin_cycle', horloge: h, registre: reg });
  assert.ok(m.existe('prive/cycles/C-2026-11-17/cache/reprise-btp-creations-zone.json'), 'lecture du jour interrompue : reprise gardée');
  assert.ok(m.existe('prive/cache/cibler-courtiers-construction-2026-11-17.json'));
  assert.deepEqual(a.supprimes.sort(), ['prive/cache/sirene-p1.json', 'prive/cycles/C-2026-11-16/cache/', 'prive/cycles/C-2026-11-17/cache/autre.json']);
  reg.ajouter({ type: 'cible', recette: 'btp-creations-zone', compte: { retenues: 3 }, fichier_prive: 'prive/listes/btp-creations-zone-2026-11-17.json', v2: true });
  purgerPrive(m, { motif: 'fin_cycle', horloge: h, registre: reg });
  assert.ok(!m.existe('prive/cycles/C-2026-11-17/cache/reprise-btp-creations-zone.json'), 'liste consignée : reprise purgée');
  assert.ok(m.existe('prive/cache/cibler-courtiers-construction-2026-11-17.json'), 'autre recette : encore gardée');
  purgerPrive(m, { motif: 'fin_cycle', horloge: creerHorloge('2026-11-18T10:00:00Z'), registre: reg });
  assert.ok(!m.existe('prive/cache/cibler-courtiers-construction-2026-11-17.json'), 'le lendemain : jamais relue, purgée');
});

test('purgerPrive(retention_90j) : listes de plus de 90 jours sans pari ouvert supprimées', () => {
  const r = dossier(), m = creerMagasin(r), h = creerHorloge('2026-11-15T12:00:00Z');
  for (const f of ['prive/listes/vieille-2026-07-01.json', 'prive/listes/suivie-2026-07-01.json', 'prive/listes/recente-2026-11-01.json', 'prive/memoire.json']) ecrire(r, f, '[]');
  const reg = new Registre(null);
  reg.ajouter({ type: 'pari', id: 'P-suivie-2026-07-01', hypothese: 'h', geste_proprietaire: 'g', critere_succes: 's', critere_arret: 'a', echeance: 'envoi + 7 jours' });
  const res = purgerPrive(m, { motif: 'retention_90j', horloge: h, registre: reg });
  assert.deepEqual(res.supprimes, ['prive/listes/vieille-2026-07-01.json']);
  assert.ok(m.existe('prive/listes/suivie-2026-07-01.json') && m.existe('prive/listes/recente-2026-11-01.json') && m.existe('prive/memoire.json'));
});

test('à blanc : la purge ne touche pas le disque', () => {
  const r = racineAvecListe();
  ecrire(r, 'prive/a.brut.json', '{}');
  const calque = creerMagasin(r).enCalque();
  assert.deepEqual(purgerPrive(calque, { motif: 'fin_cycle' }).supprimes, ['prive/a.brut.json']);
  assert.ok(fs.existsSync(path.join(r, 'prive/a.brut.json')));
  assert.equal(calque.existe('prive/a.brut.json'), false);
});

// Le scan du dépôt voit tout ce qu'un commit pourrait emporter : suivis, et non suivis non ignorés (avant « git add »).
test('scannerDepot dans un dépôt git : un fichier non suivi (fixture nouvelle) qui nomme le canari est signalé ; prive/ et les ignorés non', async () => {
  const { execFileSync } = await import('node:child_process');
  const r = dossier();
  try { execFileSync('git', ['init', '-q', r], { stdio: 'ignore' }); } catch { return; }   // git absent : rien à vérifier ici
  ecrire(r, '.gitignore', 'prive/\n*.tmp\n');
  ecrire(r, 'prive/listes/fictive-2026-11-16.json', JSON.stringify({ cibles: ENTREPRISES }));
  ecrire(r, 'README.md', 'Dépôt fictif.\n');
  execFileSync('git', ['-C', r, 'add', 'README.md', '.gitignore'], { stdio: 'ignore' });
  ecrire(r, 'test/fixtures/nouvelle.json', JSON.stringify({ contact: CANARI }));          // non suivi, non ignoré
  ecrire(r, 'brouillon.tmp', `contact : ${CANARI}\n`);                                   // ignoré : jamais commité
  const dict = dictionnaire(creerMagasin(r));
  const s = scannerDepot(r, dict);
  assert.equal(s.ok, false);
  assert.ok(s.fuites.some((f) => f.fichier === 'test/fixtures/nouvelle.json' && f.motif === 'dictionnaire'), JSON.stringify(s.fuites));
  assert.ok(!s.fuites.some((f) => f.fichier.startsWith('prive/') || f.fichier === 'brouillon.tmp'));
  assert.ok(!JSON.stringify(s).includes(NOM_CANARI), 'la sortie ne contient pas le nom');
});
