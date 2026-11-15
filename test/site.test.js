// Tests de la page de preuve (M10, site.js) : générée depuis etat/ seulement, écrite dans prive/site/index.html
// seulement, sans script, formulaire, traceur ni URL externe ; chaque nombre sourcé et daté ; canari de l'antifuite.
// Données fictives (test/fixtures/commun/entreprises.json) ; l'adresse d'essai est fabriquée à l'exécution.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Registre } from '../src/registre.js';
import { creerHorloge, creerMagasin, sha256Texte } from '../src/socle.js';
import { dictionnaire, rgpdPublic } from '../src/garde.js';
import { mesurer } from '../src/bilan.js';
import { evaluer } from '../src/risque.js';
import {
  construireSite, verifierSite, texteVisible, empreinteSite, chargerEtatPublic, ecrireSite, genererSite, CHEMIN_SITE_PRIVE, SOURCES_ETAT, GARDE_FOUS,
} from '../src/site.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTREPRISES = JSON.parse(fs.readFileSync(path.join(RACINE, 'test', 'fixtures', 'commun', 'entreprises.json'), 'utf8'));
const CANARI = ENTREPRISES[0].dirigeants[0].nom;                         // « Zéphyrin CANARIX », fictif
const NOM_CANARI = CANARI.split(' ')[1];
const SOCIETE_CANARI = ENTREPRISES[0].nom;
const POLITIQUE_REELLE = JSON.parse(fs.readFileSync(path.join(RACINE, 'politique.json'), 'utf8'));
const JOUR = '2026-11-16';
const CONTACT = ['opposition', 'exemple.invalid'].join('@');
const MENTIONS = 'Éditeur : à compléter par le propriétaire (statut, identité, hébergeur).';
const PROPRIO = { auteur: 'proprietaire', verification: 'session', preuve_empreinte: sha256Texte('phrase fictive') };

/** Racine fictive : prive/listes/ (le canari y est), etat/ (objets publics seulement). */
function racine() {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'velyx-site-'));
  const ecrire = (rel, x) => { fs.mkdirSync(path.dirname(path.join(r, rel)), { recursive: true }); fs.writeFileSync(path.join(r, rel), typeof x === 'string' ? x : JSON.stringify(x, null, 1)); };
  ecrire('prive/listes/fictive-2026-11-15.json', { recette: 'fictive', cibles: ENTREPRISES });
  return { r, ecrire };
}
/** État public plausible : KPI mesurés sur un registre fictif, contrôles par liste, notice RGPD. */
function etatPublic() {
  const h = creerHorloge('2026-11-10T08:00:00Z'), reg = new Registre(null, { horloge: h });
  reg.ajouter({ type: 'pari', id: 'P-a', hypothese: 'h', geste_proprietaire: 'g', critere_succes: 's', critere_arret: 'a', echeance: 'envoi + 7 jours' });
  reg.ajouter({ type: 'pari', id: 'P-b', hypothese: 'h', geste_proprietaire: 'g', critere_succes: 's', critere_arret: 'a', echeance: 'envoi + 7 jours' });
  reg.ajouter({ type: 'envoi', ...PROPRIO, pari: 'P-a', canal: 'email' });
  reg.ajouter({ type: 'envoi', ...PROPRIO, pari: 'P-b', canal: 'comeup' });
  h.avancer(8 * 864e5);
  const { kpi } = mesurer({ registre: reg, horloge: h, scan: { ok: true, fuites: [], dictionnaire_vide: false, n_jetons: 40 } });
  return {
    kpi,
    controles: { source: 'registre, ligne 12', date: '2026-11-15', par_liste: { 'rachat-it-idf': { G4: 168, G2: 158, G1: 3, G3: 0, G9: 0 }, 'courtier-btp-aura': { G4: 9, G2: 255 } } },
    marche_hebdo: [{ semaine: '2026-S46', demandes: 26, offres_mediane: 5, n: 2, part_devis_2h: 0.75, source: 'etat/series/2026-11-15.jsonl', date: '2026-11-15' },
      { semaine: '2026-S47', demandes: 31, offres_mediane: 6, n: 24, part_devis_2h: 0.5, source: 'etat/series/2026-11-16.jsonl', date: '2026-11-16' }],
    paris: { source: 'registre/journal.jsonl', date: JOUR, par_issue: { sans_reponse: 2 }, aveux: 4 },
    rgpd: { ...rgpdPublic(null), sources: ['registre SIRENE/RNE via https://recherche-entreprises.api.gouv.fr (données publiques)', 'annonces publiques de www.codeur.com'] },
    notes: `contact pressenti : ${CANARI}`,                               // champ inconnu : jamais rendu
  };
}
const conditions = (html, extra = {}) => ({ mentions_legales: MENTIONS, contact_opposition: CONTACT, usage_reel: true, validation: { empreinte: empreinteSite(html) }, ...extra });

test('canari absent du HTML ; un nom de société du dictionnaire glissé dans etat/ est arrêté par verifierSite (antifuite)', () => {
  const { r } = racine();
  const dict = dictionnaire(creerMagasin(r));
  assert.ok(dict.jetons.has(NOM_CANARI), 'canari au dictionnaire');
  const { html } = construireSite(etatPublic(), { jour: JOUR, mentions_legales: MENTIONS, contact_opposition: CONTACT });
  assert.ok(!html.toUpperCase().includes(NOM_CANARI), 'canari absent');
  assert.ok(!html.includes('pressenti'), 'champ inconnu non rendu');
  const v = verifierSite(html, { dict, conditions: conditions(html) });
  assert.deepEqual(v.manques, []);
  assert.equal(v.ok, true);
  // Un état public fautif (nom de société nominatif comme nom de liste) : la page le recopierait, la vérification refuse.
  const fautif = etatPublic();
  fautif.controles.par_liste[SOCIETE_CANARI] = { G4: 1 };
  const h2 = construireSite(fautif, { jour: JOUR, mentions_legales: MENTIONS, contact_opposition: CONTACT }).html;
  const v2 = verifierSite(h2, { dict, conditions: conditions(h2) });
  assert.equal(v2.ok, false);
  assert.ok(v2.manques.includes('antifuite'));
  assert.ok(!JSON.stringify(v2).includes(NOM_CANARI), 'le motif ne cite pas le jeton');
  // Sans dictionnaire : jamais « vert » par défaut.
  assert.ok(verifierSite(html, { conditions: conditions(html) }).manques.includes('antifuite_non_mesuree'));
});

test('chaque nombre porte data-source et data-date ; aucun chiffre hors d’un élément sourcé', () => {
  const { html, chiffres, ecartes } = construireSite(etatPublic(), { jour: JOUR });
  const datas = [...html.matchAll(/<data\b([^>]*)>([^<]*)<\/data>/g)];
  assert.ok(datas.length >= 15, `${datas.length} nombres`);
  assert.equal(datas.length, chiffres.length);
  for (const [, attrs] of datas) {
    assert.match(attrs, /data-source="[^"]+"/);
    assert.match(attrs, /data-date="[^"]+"/);
  }
  for (const c of chiffres) assert.ok(c.source && c.date && Number.isFinite(c.valeur), JSON.stringify(c));
  assert.deepEqual(ecartes, []);
  assert.ok(!verifierSite(html).manques.includes('chiffres_non_sources'));
  // 0 € tant que c'est 0 ; « inconnu (n=2) » avec n sourcé ; part des devis en 2 h seulement à partir de 20 annonces suivies.
  assert.match(html, /data-id="encaisse_eur"[^>]*>0 €<\/data>/);
  assert.match(html, /Taux de réponse positive à sept jours : inconnu \(n=<data value="2" data-id="taux_reponse_positive_7j\.n"/);
  assert.ok(!html.includes('data-id="marche.0.part_devis_2h"'));
  assert.ok(html.includes('data-id="marche.1.part_devis_2h"'));
  for (const [code] of GARDE_FOUS) assert.ok(html.includes(`data-id="controles.rachat-it-idf.${code}"`), code);
  // Un chiffre glissé hors d'un élément sourcé est détecté ; un nombre sans source n'est pas affiché.
  assert.ok(verifierSite(html.replace('</main>', '<p>Plus de 3000 clients satisfaits.</p></main>')).manques.includes('chiffres_non_sources'));
  const sansSource = etatPublic();
  sansSource.marche_hebdo[1].source = undefined;
  const s = construireSite(sansSource, { jour: JOUR });
  assert.deepEqual([...s.ecartes].sort(), ['marche.1.demandes', 'marche.1.offres_mediane', 'marche.1.part_devis_2h']);
  assert.ok(!verifierSite(s.html).manques.includes('chiffres_non_sources'));
});

test('aucun <script>, <form>, cookie ni URL externe ; chacun est détecté s’il est injecté', () => {
  const { html } = construireSite(etatPublic(), { jour: JOUR });
  assert.ok(!/<script|<form|cookie|:\/\/|www\.|href=|src=/i.test(html), 'page sans script, formulaire, traceur ni lien');
  assert.match(texteVisible(html), /recherche-entreprises\.api\.gouv\.fr/, 'la source est nommée, sans lien');
  const base = verifierSite(html).manques;
  for (const m of ['script', 'formulaire', 'cookie', 'url_externe', 'ressource_externe']) assert.ok(!base.includes(m), m);
  const injecter = (x) => verifierSite(html.replace('</main>', `${x}</main>`)).manques;
  assert.ok(injecter('<script>alert(1)</script>').includes('script'));
  assert.ok(injecter('<p onclick="x()">a</p>').includes('script'));
  assert.ok(injecter('<form><input name="q"></form>').includes('formulaire'));
  assert.ok(injecter('<p>Ce site dépose un cookie.</p>').includes('cookie'));
  assert.ok(injecter('<a href="https://exemple.invalid/">lien</a>').includes('url_externe'));
  assert.ok(injecter('<a href="//exemple.invalid/">lien</a>').includes('url_externe'));
  assert.ok(injecter('<img src="x.png" alt="">').includes('ressource_externe'));
  assert.ok(injecter('<style>@import "x.css";</style>').includes('ressource_externe'));
  assert.ok(!injecter('<a href="#methode">méthode</a>').includes('url_externe'), 'une ancre interne est permise');
  // Thème clair et sombre, lisible sur téléphone, en français.
  assert.match(html, /prefers-color-scheme:dark/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /<html lang="fr">/);
});

test('mentions légales absentes → verifierSite.ok = false ; conditions de mise en ligne toutes requises', () => {
  const sans = construireSite(etatPublic(), { jour: JOUR, contact_opposition: CONTACT }).html;
  const { r } = racine();
  const dict = dictionnaire(creerMagasin(r));
  const v = verifierSite(sans, { dict, conditions: conditions(sans, { mentions_legales: null }) });
  assert.equal(v.ok, false);
  assert.deepEqual(v.manques, ['mentions_legales']);
  assert.match(sans, /À fournir par le propriétaire/);
  const complet = construireSite(etatPublic(), { jour: JOUR, mentions_legales: MENTIONS, contact_opposition: CONTACT }).html;
  assert.equal(verifierSite(complet, { dict, conditions: conditions(complet) }).ok, true);
  // Contact d'opposition, usage réel et validation de l'empreinte exacte : chacun manque à son tour.
  assert.ok(verifierSite(complet, { dict, conditions: conditions(complet, { contact_opposition: null }) }).manques.includes('contact_opposition'));
  assert.ok(verifierSite(complet, { dict, conditions: conditions(complet, { usage_reel: false }) }).manques.includes('usage_reel'));
  const autre = verifierSite(complet, { dict, conditions: conditions(complet, { validation: { empreinte: empreinteSite(`${complet} `) } }) });
  assert.deepEqual(autre.manques, ['validation']);
  assert.equal(autre.pret_pour_revue, true, 'prête pour la revue humaine, pas pour la publication');
  // Le contact fourni par le propriétaire n'est pas compté comme une fuite (adresse publiée exprès) ; une autre adresse l'est.
  const intrus = complet.replace('</main>', `<p>${['autre', 'exemple.invalid'].join('@')}</p></main>`);
  assert.ok(verifierSite(intrus, { dict, conditions: conditions(intrus) }).manques.includes('antifuite'));
  // R-25 : la publication n'est proposée au propriétaire que si la page est verte.
  assert.equal(evaluer({ type: 'publier_site', params: { site_ok: autre.pret_pour_revue } }, { politique: POLITIQUE_REELLE, etat: { encaisse_eur: 0 } }).verdict, 'revue_humaine');
  assert.equal(evaluer({ type: 'publier_site', params: { site_ok: v.pret_pour_revue } }, { politique: POLITIQUE_REELLE, etat: { encaisse_eur: 0 } }).verdict, 'interdit');
});

test('générée depuis etat/ seulement, écrite dans prive/site/index.html seulement ; empreinte déterministe', () => {
  const { r, ecrire } = racine();
  const e = etatPublic();
  for (const [cle, rel] of Object.entries(SOURCES_ETAT)) if (e[cle] !== undefined) ecrire(rel, e[cle]);
  ecrire('prive/kpi.json', { encaisse_eur: { valeur: 999999, source: 'prive', date: JOUR } });   // jamais lu
  ecrire('registre/journal.jsonl', '');
  const magasin = creerMagasin(r);
  const lu = chargerEtatPublic(magasin);
  assert.deepEqual(Object.keys(lu).sort(), ['controles', 'kpi', 'marche_hebdo', 'paris', 'rgpd']);
  const avant = new Set(lister(r));
  const g = genererSite(magasin, { jour: JOUR, dict: dictionnaire(magasin), mentions_legales: MENTIONS, contact_opposition: CONTACT, usage_reel: true });
  assert.equal(g.chemin, CHEMIN_SITE_PRIVE);
  assert.deepEqual(magasin.plan(), { publiques: [], privees: [CHEMIN_SITE_PRIVE], suppressions: [] });
  assert.deepEqual(lister(r).filter((f) => !avant.has(f)), [CHEMIN_SITE_PRIVE]);
  assert.ok(!fs.existsSync(path.join(r, 'site')), 'rien sous site/ avant validation');
  const html = fs.readFileSync(path.join(r, CHEMIN_SITE_PRIVE), 'utf8');
  assert.ok(!html.includes('999999'), 'prive/ n’est pas lu');
  assert.equal(empreinteSite(html), g.empreinte);
  assert.deepEqual(g.verification.manques, ['validation']);
  // Même état, même jour : même empreinte (rien de l'horloge implicite).
  assert.equal(construireSite(lu, { jour: JOUR, mentions_legales: MENTIONS, contact_opposition: CONTACT }).empreinte, g.empreinte);
  assert.notEqual(construireSite(lu, { jour: '2026-11-17', mentions_legales: MENTIONS, contact_opposition: CONTACT }).empreinte, g.empreinte);
  assert.throws(() => construireSite(lu, {}), /jour AAAA-MM-JJ requis/);
  // Validée sur cette empreinte exacte : toutes les conditions sont réunies.
  const ok = genererSite(magasin, { jour: JOUR, dict: dictionnaire(magasin), mentions_legales: MENTIONS, contact_opposition: CONTACT, usage_reel: true, validation: { empreinte: g.empreinte } });
  assert.equal(ok.verification.ok, true);
  assert.equal(ecrireSite(magasin, html), CHEMIN_SITE_PRIVE);
  assert.throws(() => magasin.ecrirePrive('site/index.html', html), /privé sous prive\//);
});

test('état public vide : la page dit ce qui manque, sans rien inventer', () => {
  const { html, chiffres } = construireSite({}, { jour: JOUR });
  assert.deepEqual(chiffres, []);
  assert.match(html, /non mesuré/);
  assert.match(html, /Aucun contrôle de liste publié/);
  assert.match(html, /Adresse d’opposition à désigner par le propriétaire/);
  assert.ok(!verifierSite(html).manques.includes('chiffres_non_sources'));
});

function lister(r, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(r, rel), { withFileTypes: true })) {
    const x = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...lister(r, x)); else out.push(x);
  }
  return out.sort();
}
