// Garde antifuite (RGPD) : aucune donnée nominative n'atteint git, etat/, registre/, le site, une notification ou la CI.
// Trois contrôles combinés : liste noire de clés ; motifs structurels (SIREN et SIRET à clé de Luhn valide, téléphone,
// e-mail) appliqués hors des champs d'empreinte ; dictionnaire construit depuis prive/ (noms et premiers prénoms des
// dirigeants, noms d'entreprise qui nomment une personne, SIREN des listes et de la mémoire).
// Échec fermé : un fichier nominatif sous prive/listes/ dont aucun jeton ne sort lève DictionnaireIncoherent, et un
// dictionnaire vide n'est jamais compté comme « 0 fuite » (dictionnaire_vide = true). Le module gère aussi les
// oppositions (échec fermé conditionnel), la minimisation des échantillons et les purges. Il ne renvoie, n'écrit et
// n'affiche jamais un jeton trouvé : seulement un fichier, une ligne et un nom de motif.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ageAns, empreinte, creerHorloge } from './socle.js';

/** Clés refusées dans tout objet public (etat/, registre/, site). */
export const CLES_INTERDITES_PUBLIC = Object.freeze(['nom', 'nom_complet', 'prenoms', 'dirigeants', 'adresse', 'commune', 'siren', 'siret',
  'date_de_naissance', 'annee_naissance', 'nationalite', 'email', 'telephone', 'titre', 'description', 'resume', 'preuve', 'phrase']);
/** Champs d'empreinte, jamais scannés (un hexadécimal y contient souvent 9 chiffres d'affilée). '*_sha256' : tout suffixe. */
export const CLES_IGNOREES_SCAN = Object.freeze(['empreinte', 'precedente', 'cle', 'sha256', '*_sha256', 'preuve_empreinte']);
export const TEXTE_LIBRE_MAX = 400;
export const N_MIN_GEOGRAPHIQUE = 5;
const ignoree = (k) => CLES_IGNOREES_SCAN.includes(k) || /_sha256$/.test(k);

const SEP = '[ .\\u00a0\\u202f]';
/**
 * Motifs structurels (drapeau g). siren : 9 chiffres, groupés par 3 ou non, sans caractère de mot ni chiffre autour ;
 * siret : 14 chiffres isolés (3-3-3-5) ; telephone : +33 ou 0, puis 9 chiffres par paires ; email. SIREN et SIRET ne
 * comptent que si leur clé de Luhn est valide (exception de La Poste comprise) : un numéro à clé fausse ne désigne
 * aucune entreprise, et c'est ce qui sépare un identifiant d'un montant ou d'un compteur.
 */
export const MOTIFS = Object.freeze({
  siret: new RegExp(`(?<![\\w]|\\d${SEP})(\\d{3})${SEP}?(\\d{3})${SEP}?(\\d{3})${SEP}?(\\d{5})(?!${SEP}?\\d)(?![\\w])`, 'g'),
  siren: new RegExp(`(?<![\\w]|\\d${SEP})(\\d{3})${SEP}?(\\d{3})${SEP}?(\\d{3})(?!${SEP}?\\d)(?![\\w])`, 'g'),
  telephone: new RegExp(`(?<![\\w+]|\\d${SEP})(?:\\+33${SEP}?(?:\\(0\\)${SEP}?)?|0)[1-9](?:[ .\\-\\u00a0\\u202f]?\\d{2}){4}(?![\\w])(?!${SEP}?\\d)`, 'g'),
  email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
});

/** Clé de Luhn (SIREN, SIRET). */
export function luhn(chiffres) {
  let s = 0;
  for (let i = 0; i < chiffres.length; i++) {
    let d = Number(chiffres[chiffres.length - 1 - i]) * (i % 2 ? 2 : 1);
    if (d > 9) d -= 9;
    s += d;
  }
  return s % 10 === 0;
}
const sirenValide = (c) => /^\d{9}$/.test(c) && luhn(c);
// La Poste (SIREN 356 suivi de six zéros) numérote ses établissements hors clé de Luhn : somme des chiffres multiple de 5.
const LA_POSTE = `356${'0'.repeat(6)}`;
const siretValide = (c) => /^\d{14}$/.test(c) && (luhn(c) || (c.startsWith(LA_POSTE) && [...c].reduce((a, x) => a + Number(x), 0) % 5 === 0));

export class DictionnaireIncoherent extends Error {
  constructor(fichier, motif) { super(`dictionnaire incohérent : ${fichier} (${motif}) ; antifuite en échec fermé`); this.name = 'DictionnaireIncoherent'; this.fichier = fichier; }
}
export class OppositionsIndisponibles extends Error {
  constructor(attendu, trouve) {
    super(`oppositions indisponibles : le registre en déclare ${attendu}, la mémoire privée en contient ${trouve} ; aucune liste ni aucun envoi tant qu'elle n'est pas restaurée`);
    this.name = 'OppositionsIndisponibles'; this.attendu = attendu; this.trouve = trouve;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Dictionnaire.

const MEMOIRE = 'prive/memoire.json';
/** SIREN des oppositions de la mémoire (liste de textes ; ancienne forme [{siren}] acceptée). */
const sirensMemoire = (m) => (Array.isArray(m?.oppositions) ? m.oppositions.map((s) => (typeof s === 'string' ? s : s?.siren)).filter((s) => /^\d{9}$/.test(s ?? '')) : []);

const norm = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
const mots = (s) => norm(s).split(/[^A-Z0-9]+/).filter(Boolean);
const lettres = (m) => /^[A-Z]{4,}$/.test(m);

/**
 * Mots français courants qui sont aussi des noms ou des prénoms. Ils restent dans le dictionnaire, mais seuls, même
 * avec une majuscule (« Pages lues », « Petit rappel »), ils ne comptent pas : il faut un prénom ou un nom voisin, ou
 * une civilité devant le nom. Le scan du dépôt y ajoute tout mot que le dépôt emploie en minuscules.
 */
export const MOTS_COURANTS = Object.freeze(new Set(['SARL', 'SAS', 'GROS', 'JOUR', 'PARIS', 'LYON', 'PETIT', 'PETITE', 'GRAND', 'GRANDE', 'BLANC', 'BLANCHE', 'BRUN', 'BRUNE', 'ROUX',
  'NOIR', 'ROUGE', 'VERT', 'GRIS', 'JAUNE', 'BLEU', 'BEAU', 'BELLE', 'JOLI', 'BON', 'BONNE', 'BONNET', 'GENTIL', 'LEGER', 'FORT', 'GROS',
  'LONG', 'COURT', 'HAUT', 'JEUNE', 'VIEUX', 'NEUF', 'LIBRE', 'FRANC', 'FRANCE', 'FRANCAIS', 'PIERRE', 'ROSE', 'FLEUR', 'OLIVIER',
  'POIRIER', 'CHENE', 'BOIS', 'BUISSON', 'FONTAINE', 'RIVIERE', 'MONTAGNE', 'VALLEE', 'COTE', 'CHAMP', 'CHAMPS', 'PRAIRIE', 'JARDIN',
  'VIGNE', 'MOULIN', 'PONT', 'PORTE', 'TOUR', 'ROCHE', 'ROCHER', 'MARAIS', 'BARRE', 'CROIX', 'CHAPELLE', 'CHATEAU', 'PALAIS', 'MAISON',
  'GRANGE', 'FERME', 'LOUP', 'RENARD', 'LION', 'LAPIN', 'MOUTON', 'CHEVAL', 'MERLE', 'PIGEON', 'FAUCON', 'AIGLE', 'PINSON', 'CANARD',
  'POISSON', 'PRINCE', 'BARON', 'COMTE', 'MARQUIS', 'CHEVALIER', 'PAGE', 'MOINE', 'PAPE', 'ABBE', 'CURE', 'MAIRE', 'JUGE', 'NOTAIRE',
  'AVOCAT', 'DOCTEUR', 'MAITRE', 'BERGER', 'BOUCHER', 'BOULANGER', 'CHARPENTIER', 'MACON', 'COUVREUR', 'PEINTRE', 'PLOMBIER',
  'MENUISIER', 'SERRURIER', 'FORGERON', 'MEUNIER', 'MERCIER', 'MARCHAND', 'MARCHE', 'COURTIER', 'BRASSEUR', 'TAILLEUR', 'POTIER',
  'VERRIER', 'CHASSEUR', 'PECHEUR', 'PASTEUR', 'CAPITAINE', 'SOLDAT', 'CLEMENT', 'CONSTANT', 'PRUDENT', 'PATIENCE', 'VICTOIRE',
  'AURORE', 'MARINE', 'CELESTE', 'ESPERANCE', 'CONSTANCE', 'CLEMENCE', 'ANGE', 'NOEL', 'PAQUES', 'JANVIER', 'FEVRIER', 'MARS',
  'AVRIL', 'JUILLET', 'AOUT', 'NOVEMBRE', 'PRINTEMPS', 'HIVER', 'SOLEIL', 'ETOILE', 'JOUR', 'MATIN', 'SOIR', 'MIDI', 'PAIN', 'MIEL',
  'POIVRE', 'POMME', 'OLIVE', 'SABLE', 'ARGENT', 'CUIVRE', 'MARBRE', 'TUILE', 'BRIQUE', 'VERGER', 'LANDE', 'PARENT', 'COUSIN',
  'NEVEU', 'ENFANT', 'SAUVAGE', 'LEGRAND', 'BONHOMME', 'BIEN', 'MAIN', 'FAIT', 'SAGE', 'VRAI', 'LOYAL', 'AIME', 'PREVOST', 'GRAS',
  'DOUX', 'FIER', 'JOYEUX', 'HEUREUX', 'VAILLANT', 'BRAVE', 'LAMBERT', 'MORIN', 'PERRIN', 'ROBIN', 'MOREL', 'BAILLY', 'MARECHAL',
  'BOUCHE', 'TETE', 'COEUR', 'PIED', 'BRAS', 'MONDE', 'CIEL', 'TERRE', 'MER', 'LAC', 'ILE', 'PORT', 'CAMP', 'PLACE', 'RUE', 'CHEMIN',
  'ROUTE', 'BORD', 'FOND', 'COIN', 'CENTRE', 'NORD', 'SUD', 'EST', 'OUEST', 'PROVENCE', 'BRETON', 'NORMAND', 'PICARD', 'LORRAIN',
  'GASCON', 'BASQUE', 'SAVOYARD', 'ALLEMAND', 'ANGLAIS', 'LEPRINCE', 'LEROY', 'ROY', 'ROI', 'DUC', 'DUCHESNE', 'MARTEL', 'MARTEAU',
  'CLOU', 'FER', 'PLOMB', 'OR', 'CHAUX', 'PLATRE', 'TOIT', 'MUR', 'CLOS', 'BOSQUET', 'BOCAGE', 'BOISSON', 'BOUTEILLE', 'VIGNERON',
  'JARDINIER', 'FERMIER', 'PAYSAN', 'VACHER', 'BOUVIER', 'COLOMBE', 'CORBEAU', 'ROSSIGNOL', 'PERDRIX', 'CERISE', 'PRUNE', 'LILAS',
  'IRIS', 'JASMIN', 'VIOLETTE', 'MARGUERITE', 'CAPUCINE', 'AMBRE', 'GRENIER', 'CELLIER', 'CAVE', 'FOUR', 'FORGE', 'ATELIER', 'BUREAU',
  'COMMERCE', 'MARCHANDE', 'ASSURANCE', 'BATIMENT', 'CONSTRUCTION', 'ENTREPRISE', 'CONSEIL', 'SERVICE', 'SERVICES', 'GROUPE',
  'SOCIETE', 'HOLDING', 'GESTION', 'FINANCE', 'INVEST', 'PATRIMOINE', 'IMMOBILIER', 'HABITAT', 'RENOVATION', 'ISOLATION',
  'ENERGIE', 'SOLAIRE', 'TRAVAUX', 'RESEAU', 'SYSTEMES', 'SOLUTIONS', 'TECHNOLOGIES', 'INFORMATIQUE', 'LOGICIEL', 'DIGITAL',
  'NUMERIQUE', 'DATA', 'CLOUD', 'WEB', 'MEDIA', 'COMMUNICATION', 'MARKETING', 'PROSPECTION', 'PAGES', 'MOINS', 'PLUS', 'RANG',
  'GARDE', 'DOYEN', 'JUIN', 'COUVERT', 'MORALES', 'SOURCE', 'LISTE', 'LECTURE', 'TOTAL', 'CYCLE', 'SIGNAL', 'BUDGET', 'OFFRE', 'CHIFFRE',
  'LOUIS', 'MARTIN', 'SIMON', 'LAURENT', 'MICHEL', 'VINCENT', 'THOMAS', 'BERNARD', 'ROBERT', 'RICHARD', 'DENIS', 'GERMAIN', 'FLORENCE',
  'NANCY', 'PARIS', 'LYON', 'VALENCE', 'VIENNE', 'ORANGE', 'CLAUDE', 'ANTHROPIC', 'TERME', 'SENS', 'NOTE', 'NOTES', 'ETAT', 'TACHE',
  'TACHES', 'ACTION', 'ACTIONS', 'STATUT', 'TYPE', 'DATE', 'VALEUR', 'MESURE', 'PREUVE', 'REGLE', 'REGLES', 'LECON', 'ETAPE', 'PROJET',
  'CLIENT', 'CLIENTS', 'ANNONCE', 'ANNONCES', 'RECETTE', 'RECETTES', 'BROUILLON', 'REGISTRE', 'MEMOIRE', 'SITE', 'CANAL', 'PRIX']));
/** Civilités : « M. » ou « Mme » devant un jeton nomment une personne, même quand le nom est un mot courant. */
const CIVILITES = new Set(['M', 'MR', 'MME', 'MLLE', 'MONSIEUR', 'MADAME', 'MADEMOISELLE', 'ME', 'MAITRE', 'DR', 'DOCTEUR']);
/** Valeurs de remplacement du registre (« [NON-DIFFUSIBLE] », « ND ») : ce ne sont pas des noms. */
const PLACEHOLDER = /diffusible|^\[?\s*n\.?\s*d\.?\s*\]?$|^\[.*\]$/i;

function extraireJson(x, acc, prof = 0) {
  if (prof > 40 || x === null || typeof x !== 'object') return;
  if (Array.isArray(x)) { for (const v of x) extraireJson(v, acc, prof + 1); return; }
  const fiche = typeof x.siren === 'string' || typeof x.nom_complet === 'string' || Array.isArray(x.dirigeants);
  if (fiche) acc.enregistrements++;
  if (typeof x.siren === 'string' && /^\d{9}$/.test(x.siren)) acc.sirens.add(x.siren);
  const propres = new Set();
  if (Array.isArray(x.dirigeants)) {
    for (const d of x.dirigeants) {
      if (!d || typeof d !== 'object') continue;
      if (d.type_dirigeant === 'personne morale') { if (typeof d.siren === 'string' && /^\d{9}$/.test(d.siren)) acc.sirens.add(d.siren); continue; }
      ajouterPersonne(d.nom, d.prenoms, acc, propres);
    }
  }
  for (const k of ['commune', 'libelle_commune']) if (typeof x[k] === 'string') for (const m of mots(x[k])) acc.communes.add(m);
  // Nom de l'entreprise : nom_complet (fiche brute) ou nom (Entreprise) ; jamais le nom d'un dirigeant.
  const nomEntreprise = typeof x.nom_complet === 'string' ? x.nom_complet : fiche && typeof x.nom === 'string' ? x.nom : null;
  if (nomEntreprise) ajouterEntreprise(nomEntreprise, x.nature_juridique, propres, acc);
  for (const [k, v] of Object.entries(x)) if (k !== 'dirigeants' && v && typeof v === 'object') extraireJson(v, acc, prof + 1);
}

// Forme brute (nom = nom de famille, prenoms = prénoms) ou forme resumer (« Premier-prénom NOM »). Dans la seconde, les
// mots en capitales sont les noms et les autres les prénoms ; tout en capitales, le premier mot est le prénom.
function ajouterPersonne(nom, prenoms, acc, propres) {
  if (typeof nom !== 'string' || !nom.trim() || PLACEHOLDER.test(nom.trim())) return;
  if (typeof prenoms === 'string' && PLACEHOLDER.test(prenoms.trim())) prenoms = '';
  let noms = [], pre = [];
  if (typeof prenoms === 'string') { noms = mots(nom); pre = mots(prenoms).slice(0, 1); }
  else {
    const brut = nom.trim().split(/\s+/);
    const capitales = brut.filter((m) => m === m.toUpperCase() && /\p{L}/u.test(m)), autres = brut.filter((m) => !capitales.includes(m));
    if (capitales.length && autres.length) { noms = capitales.flatMap(mots); pre = mots(autres[0]); }
    else if (brut.length > 1) { pre = mots(brut[0]); noms = brut.slice(1).flatMap(mots); }
    else noms = mots(brut[0]);
  }
  for (const m of noms) if (lettres(m)) { acc.noms.add(m); propres.add(m); }
  for (const m of pre) if (lettres(m)) { acc.prenoms.add(m); propres.add(m); }
}

function ajouterEntreprise(nomEntreprise, nature, propres, acc) {
  const ms = mots(nomEntreprise);
  if (!ms.length) return;
  // Le nom entier devient un jeton (composé) ; ses mots isolés (« CONSEIL », « BATIMENT ») n'en deviennent pas.
  if (String(nature ?? '') === '1000' || ms.some((m) => propres.has(m))) {
    if (ms.length === 1) { if (lettres(ms[0])) acc.noms.add(ms[0]); } else acc.composes.add(ms.join(' '));
  }
}

/** Analyse d'un CSV « ; » ou « , » à guillemets : [en-têtes, ...lignes]. */
function lireCsv(texte) {
  const lignes = [], sep = (texte.split('\n')[0].match(/;/g) || []).length >= (texte.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  let champ = '', ligne = [], guil = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (guil) { if (c === '"') { if (texte[i + 1] === '"') { champ += '"'; i++; } else guil = false; } else champ += c; continue; }
    if (c === '"') guil = true;
    else if (c === sep) { ligne.push(champ); champ = ''; }
    else if (c === '\n') { ligne.push(champ.replace(/\r$/, '')); lignes.push(ligne); ligne = []; champ = ''; }
    else champ += c;
  }
  if (champ || ligne.length) { ligne.push(champ); lignes.push(ligne); }
  return lignes.filter((l) => l.some((x) => x.trim()));
}

function extraireCsv(texte, acc) {
  const [tete = [], ...rangs] = lireCsv(texte);
  const col = (re) => tete.findIndex((h) => re.test(h.trim()));
  const iSiren = col(/^siren$/i), iNom = col(/^(nom|nom_complet|raison_sociale|entreprise)$/i), iCommune = col(/^(commune|ville)$/i);
  const iDir = tete.map((h, i) => [h, i]).filter(([h]) => /dirigeant|prenom|pr[ée]nom/i.test(h)).map(([, i]) => i);
  for (const r of rangs) {
    acc.enregistrements++;
    if (iSiren >= 0 && /^\d{9}$/.test((r[iSiren] ?? '').trim())) acc.sirens.add(r[iSiren].trim());
    if (iCommune >= 0) for (const m of mots(r[iCommune])) acc.communes.add(m);
    const propres = new Set();
    for (const i of iDir) for (const p of String(r[i] ?? '').split(/[,|/]/)) ajouterPersonne(p.replace(/\([^)]*\)/g, ' ').trim(), undefined, acc, propres);
    if (iNom >= 0) ajouterEntreprise(r[iNom], null, propres, acc);
  }
}

/**
 * Dictionnaire de l'antifuite, construit depuis prive/ (listes, fiches brutes, cache, mémoire).
 * → {jetons: Set, sirens: Set, sources, nominatifs_presents, faibles: Set, composes: Set, communes: Set}
 * jetons : noms et premiers prénoms des dirigeants (4 lettres au moins, sans accents, en majuscules) et noms des
 * entreprises en nature 1000 ou dont le nom contient un jeton de l'un de leurs dirigeants (composes : nom entier).
 * faibles : prénoms qui ne sont le nom de personne et noms qui sont aussi un mot de commune ; un jeton faible ne compte
 * qu'à côté d'un autre jeton ou d'une civilité. communes : mots des communes des listes (« Saint-Denis » n'est pas une
 * personne). Lève DictionnaireIncoherent si un fichier non vide de prive/listes/ est illisible, ou contient des fiches
 * sans qu'aucun jeton n'en sorte. Lit tout prive/ (listes, fiches brutes, cache, cycles) en .json, .jsonl et .csv.
 */
export function dictionnaire(magasin) {
  const nouvel = () => ({ noms: new Set(), prenoms: new Set(), composes: new Set(), sirens: new Set(), communes: new Set(), enregistrements: 0 });
  const tout = nouvel();
  let sources = 0, nominatifs = 0;
  for (const rel of magasin.lister('prive/')) {
    const liste = rel.startsWith('prive/listes/'), ext = path.posix.extname(rel).toLowerCase();
    if (rel === MEMOIRE) {
      const m = lireJsonSur(magasin, rel);
      if (m && typeof m === 'object') {
        for (const s of sirensMemoire(m)) tout.sirens.add(s);
        for (const e of Object.values(m.echantillons ?? {})) for (const s of Array.isArray(e?.sirens) ? e.sirens : []) if (/^\d{9}$/.test(String(s))) tout.sirens.add(String(s));
        sources++;
      }
      continue;
    }
    if (!['.json', '.jsonl', '.csv'].includes(ext)) {
      if (liste && (magasin.lire(rel) ?? '').trim()) throw new DictionnaireIncoherent(rel, 'format non lu par l’antifuite');
      continue;
    }
    const texte = magasin.lire(rel) ?? '';
    if (!texte.trim()) continue;
    const acc = nouvel();
    if (ext === '.csv') extraireCsv(texte, acc);
    else {
      let objets;
      try { objets = ext === '.jsonl' ? texte.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : [JSON.parse(texte)]; } catch {
        if (liste) throw new DictionnaireIncoherent(rel, 'JSON illisible');
        continue;
      }
      for (const o of objets) extraireJson(o, acc);
    }
    const jetonsSortis = acc.noms.size + acc.prenoms.size + acc.composes.size;
    if (acc.enregistrements > 0) { nominatifs++; sources++; }
    if (liste && acc.enregistrements > 0 && jetonsSortis === 0) throw new DictionnaireIncoherent(rel, `${acc.enregistrements} fiches, aucun jeton`);
    for (const k of ['noms', 'prenoms', 'composes', 'sirens', 'communes']) for (const v of acc[k]) tout[k].add(v);
  }
  const jetons = new Set([...tout.noms, ...tout.prenoms, ...tout.composes]);
  const faibles = new Set([...tout.prenoms].filter((p) => !tout.noms.has(p)));
  for (const n of tout.noms) if (tout.communes.has(n)) faibles.add(n);
  return { jetons, sirens: tout.sirens, sources, nominatifs_presents: nominatifs, faibles, composes: tout.composes, communes: tout.communes };
}

function lireJsonSur(magasin, rel) { try { return magasin.lireJson(rel); } catch { return null; } }

const INDEX = new WeakMap();
function indexDe(dict) {
  if (!dict) return null;
  let ix = INDEX.get(dict);
  if (!ix) {
    const simples = new Set(), composes = new Map();
    for (const j of dict.jetons ?? []) {
      const ms = j.split(' ');
      if (ms.length === 1) simples.add(j);
      else { const k = ms[0]; if (!composes.has(k)) composes.set(k, []); composes.get(k).push(j); }
    }
    ix = { simples, composes, faibles: dict.faibles instanceof Set ? dict.faibles : new Set(), communes: dict.communes instanceof Set ? dict.communes : new Set(),
      sirens: dict.sirens instanceof Set ? dict.sirens : new Set(dict.sirens ?? []) };
    INDEX.set(dict, ix);
  }
  return ix;
}

/** Mots employés en minuscules dans un texte (vocabulaire courant du corpus scanné). */
export function vocabulaire(texte, vocab = new Set()) {
  for (const m of String(texte ?? '').match(/[\p{L}]{4,}/gu) ?? []) if (m === m.toLowerCase()) vocab.add(norm(m));
  return vocab;
}

const SEPARATEUR_NOM = /^[\s,'’-]{1,3}$/u, SEPARATEUR_CIVILITE = /^[\s.]{1,3}$/u;
const NEUF_CHIFFRES = new RegExp(`(?<![\\w])\\d{3}${SEP}?\\d{3}${SEP}?\\d{3}(?![\\w])`, 'g');
const capitale = (o) => /^\p{Lu}/u.test(o);

/**
 * Vrai si le texte nomme une entrée du dictionnaire. Règles (un jeton n'est jamais renvoyé) :
 * - deux jetons voisins écrits avec une majuscule (« Zéphyrin CANARIX », « CANARIX, Zéphyrin »), sauf s'ils forment un
 *   nom de commune des listes ; ou une civilité suivie d'un jeton (« M. Canarix ») ;
 * - un nom seul, écrit avec une majuscule, qui n'est ni faible, ni un mot courant (MOTS_COURANTS ou vocabulaire du
 *   corpus), ni collé à « _ » (identifiant de code) ;
 * - un nom d'entreprise composé du dictionnaire (insensible à la casse) ; un SIREN des listes ou de la mémoire.
 * Un jeton écrit tout en minuscules ne compte jamais seul.
 */
function contientJeton(texte, ix, vocab) {
  if (!ix || (!ix.simples.size && !ix.composes.size && !ix.sirens.size)) return false;
  const t = String(texte);
  const ws = [...t.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({ o: m[0], n: norm(m[0]), i: m.index, j: m.index + m[0].length }));
  const entre = (a, b) => t.slice(a.j, b.i);
  for (let k = 0; k < ws.length; k++) {
    const w = ws[k];
    if (!ix.simples.has(w.n) || !capitale(w.o)) continue;
    const voisin = (q, sep) => q && ix.simples.has(q.n) && capitale(q.o) && SEPARATEUR_NOM.test(sep) && !(ix.communes.has(q.n) && ix.communes.has(w.n));
    if (voisin(ws[k + 1], ws[k + 1] ? entre(w, ws[k + 1]) : '') || voisin(ws[k - 1], ws[k - 1] ? entre(ws[k - 1], w) : '')) return true;
    if (ws[k - 1] && CIVILITES.has(ws[k - 1].n) && capitale(ws[k - 1].o) && SEPARATEUR_CIVILITE.test(entre(ws[k - 1], w))) return true;
    if (ix.faibles.has(w.n) || MOTS_COURANTS.has(w.n) || vocab?.has(w.n)) continue;
    if (t[w.i - 1] === '_' || t[w.j] === '_') continue;
    return true;
  }
  if (ix.composes.size) {
    const ligne = ` ${ws.map((w) => w.n).join(' ')} `;
    for (const n of new Set(ws.map((w) => w.n))) for (const c of ix.composes.get(n) ?? []) if (ligne.includes(` ${c} `)) return true;
  }
  if (ix.sirens.size) {
    for (const x of t.matchAll(NEUF_CHIFFRES)) if (ix.sirens.has(x[0].replace(/\D/g, ''))) return true;
  }
  return false;
}

/**
 * Registres d'entreprises : dans leurs URL, un SIREN ou un SIRET est un identifiant (fiche d'une entreprise). Dans
 * toute autre URL, un long nombre est un identifiant technique (article, image) : les motifs SIREN et SIRET n'y portent
 * pas (le dictionnaire, lui, y cherche toujours les SIREN des listes).
 */
export const HOTES_REGISTRES = Object.freeze(['annuaire-entreprises.data.gouv.fr', 'entreprise.data.gouv.fr', 'recherche-entreprises.api.gouv.fr',
  'pappers.fr', 'societe.com', 'infogreffe.fr', 'sirene.fr', 'insee.fr', 'inpi.fr', 'verif.com', 'manageo.fr', 'corporama.com', 'kompass.com',
  'societeinfo.com', 'score3.fr', 'bodacc.fr', 'net-entreprises.fr']);
const RE_URL_SCAN = /\b(?:https?:\/\/|www\.)[^\s"'<>)\]]+/gi;
function horsUrlsBanales(t) {
  return t.replace(RE_URL_SCAN, (u) => {
    let hote = '';
    try { hote = new URL(/^www\./i.test(u) ? `https://${u}` : u).hostname.toLowerCase(); } catch { return u; }
    return HOTES_REGISTRES.some((h) => hote === h || hote.endsWith(`.${h}`)) ? u : u.replace(/\d/g, 'x');
  });
}

/** Noms des motifs structurels présents dans une chaîne. */
function motifsStructurels(s) {
  const out = new Set(), brut = String(s), t = horsUrlsBanales(brut);
  for (const m of t.matchAll(MOTIFS.siret)) if (siretValide(m.slice(1).join(''))) out.add('siret');
  for (const m of t.matchAll(MOTIFS.siren)) if (sirenValide(m.slice(1).join(''))) out.add('siren');
  if (t.match(MOTIFS.telephone)) out.add('telephone');
  if (brut.match(MOTIFS.email)) out.add('email');
  return out;
}

/** Valeurs (et clés) scannables d'un objet JSON, hors champs d'empreinte. */
function valeursScannables(x, out = [], prof = 0) {
  if (prof > 50) return out;
  if (Array.isArray(x)) { for (const v of x) valeursScannables(v, out, prof + 1); return out; }
  if (x !== null && typeof x === 'object') {
    for (const [k, v] of Object.entries(x)) { if (ignoree(k)) continue; out.push(k); valeursScannables(v, out, prof + 1); }
    return out;
  }
  if (typeof x === 'string' || typeof x === 'number') out.push(String(x));
  return out;
}

function contenuScannable(ligne) {
  const t = ligne.trim();
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try { return valeursScannables(JSON.parse(t)).join('\n'); } catch { /* pas du JSON : texte brut */ }
  }
  const cle = /^\s*"([^"\\]+)"\s*:/.exec(ligne);
  if (cle && ignoree(cle[1])) return '';
  return ligne;
}

/**
 * Scanne un texte ligne par ligne. Une ligne JSON (JSONL) est scannée valeur par valeur, champs d'empreinte exclus ;
 * une ligne « "empreinte": … » d'un JSON indenté est ignorée. → {n, positions: [{ligne, motif}]} ; motif ∈
 * dictionnaire | siren | siret | telephone | email. Ne renvoie jamais le jeton trouvé. options.vocab : vocabulaire
 * courant (par défaut, les mots que ce texte emploie en minuscules).
 */
export function scannerTexte(texte, dict, { vocab } = {}) {
  const ix = indexDe(dict), positions = [], v = vocab ?? (ix ? vocabulaire(texte) : null);
  String(texte ?? '').split('\n').forEach((brut, i) => {
    const c = contenuScannable(brut);
    if (!c) return;
    const vus = new Set();
    if (contientJeton(c, ix, v)) vus.add('dictionnaire');
    for (const m of motifsStructurels(c)) vus.add(m);
    for (const motif of ['dictionnaire', 'siren', 'siret', 'telephone', 'email']) if (vus.has(motif)) positions.push({ ligne: i + 1, motif });
  });
  return { n: positions.length, positions };
}

/**
 * Contrôle d'un objet destiné à etat/, registre/ ou au site. Refuse : clé interdite ; motif structurel dans une valeur
 * hors CLES_IGNOREES_SCAN ; jeton du dictionnaire ; texte libre de plus de 400 caractères ; objet {departement|commune}
 * avec n < 5. → {ok, motifs: string[]} (noms de motifs seulement, jamais la valeur fautive).
 */
export function verifierObjetPublic(obj, dict, { clesAdmises = [] } = {}) {
  const ix = indexDe(dict), motifs = new Set(), vocab = ix ? vocabulaire(valeursScannables(obj).join('\n')) : null;
  const scan = (s) => {
    for (const m of motifsStructurels(s)) motifs.add(`motif ${m}`);
    if (contientJeton(s, ix, vocab)) motifs.add('jeton du dictionnaire');
  };
  const marcher = (x, prof) => {
    if (prof > 50) { motifs.add('objet trop profond'); return; }
    if (Array.isArray(x)) { for (const v of x) marcher(v, prof + 1); return; }
    if (x !== null && typeof x === 'object') {
      if ((Object.hasOwn(x, 'departement') || Object.hasOwn(x, 'commune')) && typeof x.n === 'number' && x.n < N_MIN_GEOGRAPHIQUE) {
        motifs.add(`agrégat géographique de moins de ${N_MIN_GEOGRAPHIQUE}`);
      }
      for (const [k, v] of Object.entries(x)) {
        if (CLES_INTERDITES_PUBLIC.includes(k) && !clesAdmises.includes(k)) motifs.add(`clé interdite « ${k} »`);
        if (ignoree(k)) continue;
        scan(k);
        marcher(v, prof + 1);
      }
      return;
    }
    if (typeof x === 'string') {
      if ([...x].length > TEXTE_LIBRE_MAX) motifs.add(`texte libre de plus de ${TEXTE_LIBRE_MAX} caractères`);
      scan(x);
    } else if (typeof x === 'number') scan(String(x));
  };
  marcher(obj, 0);
  return { ok: motifs.size === 0, motifs: [...motifs] };
}

/**
 * Clés de CLES_INTERDITES_PUBLIC admises dans un acte du registre : « preuve » est un champ exigé de l'encaissement
 * depuis la v1 (registre.EXIGE). Sa valeur reste scannée comme toute autre (motifs structurels et dictionnaire).
 */
export const CLES_ADMISES_REGISTRE = Object.freeze(['preuve']);
/** Champs de premier niveau d'un acte qui portent du texte libre (phrase du propriétaire, jugement, message d'erreur). */
export const TEXTES_LIBRES_REGISTRE = Object.freeze(['motif', 'pourquoi', 'choix', 'objet', 'texte', 'raison', 'definition', 'citation']);
/**
 * Types d'acte dont le texte libre est écrit par le moteur lui-même (motifs de la table du Risk Agent, raisons des règles
 * D0 à D10, résultats de contrôle) : sans dictionnaire, ils restent admis, sinon le cycle ne pourrait plus consigner ses
 * décisions, ses refus ni le compte de ses passages (plafonds du jour). Tout autre acte à texte libre est refusé.
 */
export const TYPES_TEXTE_MOTEUR = Object.freeze(['decision', 'refus', 'cycle', 'controle']);
/** Valeurs littérales posées par le moteur dans un champ de texte libre (choix par défaut d'une validation). */
const LITTERAUX_REGISTRE = new Set(['valide']);

/**
 * R-10 pour le registre public (registre/journal.jsonl, en ajout seul : une fuite ne s'en retire plus). Même contrôle que
 * verifierObjetPublic (clés interdites hors CLES_ADMISES_REGISTRE, motifs structurels, jetons du dictionnaire, texte de
 * plus de 400 caractères, agrégat géographique de moins de 5), plus : la clé d'idempotence (cle), ignorée par le scan
 * structurel parce qu'elle porte des empreintes, est scannée par le dictionnaire. dict === null : dictionnaire
 * indisponible (DictionnaireIncoherent) ; échec fermé, tout texte libre (TEXTES_LIBRES_REGISTRE) d'un acte hors
 * TYPES_TEXTE_MOTEUR est refusé. → {ok, motifs: string[]} (noms de motifs seulement, jamais la valeur fautive).
 */
export function verifierActe(acte, dict) {
  const motifs = new Set(verifierObjetPublic(acte, dict, { clesAdmises: CLES_ADMISES_REGISTRE }).motifs);
  const ix = indexDe(dict);
  if (typeof acte?.cle === 'string' && contientJeton(acte.cle, ix, null)) motifs.add('jeton du dictionnaire (cle)');
  if (dict === null && acte && typeof acte === 'object' && !TYPES_TEXTE_MOTEUR.includes(acte.type)) {
    const libres = TEXTES_LIBRES_REGISTRE.filter((k) => typeof acte[k] === 'string' && acte[k].trim() && !LITTERAUX_REGISTRE.has(acte[k].trim()));
    if (libres.length) motifs.add(`texte libre (${libres.join(', ')}) sans dictionnaire de l’antifuite (indisponible : échec fermé)`);
  }
  return { ok: motifs.size === 0, motifs: [...motifs] };
}

/**
 * Contrôle branché sur le magasin (socle.creerMagasin({verifierPublic: (rel, c) => verifierPublic(rel, c, dict)})).
 * .json : objet entier ; .jsonl : chaque ligne ; autre : scannerTexte. → {ok, motif}
 */
export function verifierPublic(rel, contenu, dict) {
  const texte = typeof contenu === 'string' ? contenu : Buffer.isBuffer(contenu) || contenu instanceof Uint8Array ? Buffer.from(contenu).toString('utf8') : JSON.stringify(contenu);
  const motifs = new Set();
  if (/\.json$/i.test(rel)) {
    let o;
    try { o = JSON.parse(texte); } catch { return { ok: false, motif: 'JSON illisible' }; }
    for (const m of verifierObjetPublic(o, dict).motifs) motifs.add(m);
  } else if (/\.jsonl$/i.test(rel)) {
    for (const l of texte.split('\n')) {
      if (!l.trim()) continue;
      let o;
      try { o = JSON.parse(l); } catch { return { ok: false, motif: 'ligne JSON illisible' }; }
      for (const m of verifierObjetPublic(o, dict).motifs) motifs.add(m);
    }
  } else for (const p of scannerTexte(texte, dict).positions) motifs.add(`motif ${p.motif}`);
  return motifs.size ? { ok: false, motif: [...motifs].join(' ; ') } : { ok: true };
}

// ---------------------------------------------------------------------------------------------------------------------
// Scan du dépôt.

const EXCLUS = /^(prive|\.git|node_modules)(\/|$)/;
function marcherArbre(racine, rel, out) {
  let entrees;
  try { entrees = fs.readdirSync(path.join(racine, rel), { withFileTypes: true }); } catch { return; }
  for (const e of entrees) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (EXCLUS.test(r)) continue;
    if (e.isDirectory()) marcherArbre(racine, r, out);
    else if (e.isFile()) out.add(r);
  }
}

// Tout ce qui serait commité : fichiers suivis, plus fichiers non suivis et non ignorés (git ls-files --others
// --exclude-standard). Un nouveau fichier (fixture, note, workflow) est donc scanné avant même son « git add ».
function fichiersDuDepot(racine) {
  const out = new Set();
  let suivis = null;
  try {
    if (fs.existsSync(path.join(racine, '.git'))) {
      const git = (...a) => execFileSync('git', ['-C', racine, 'ls-files', '-z', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 })
        .split('\0').filter(Boolean);
      suivis = [...git(), ...git('--others', '--exclude-standard')];
    }
  } catch { suivis = null; }
  if (suivis) for (const f of suivis) { if (!EXCLUS.test(f)) out.add(f); }
  else marcherArbre(racine, '', out);
  for (const d of ['etat', 'site', 'registre']) marcherArbre(racine, d, out);
  return [...out].sort();
}

/**
 * Scan du dépôt : fichiers suivis par git et fichiers non suivis non ignorés (tout ce qu'un commit pourrait emporter ;
 * tout l'arbre hors .git, node_modules et prive/ si ce n'est pas un dépôt),
 * plus etat/**, site/** et registre/** ; prive/ toujours exclu. Un fichier texte trop gros pour être lu compte comme
 * une fuite (motif « non_lu », ligne 0). → {ok, fuites: [{fichier, ligne, motif}],
 * dictionnaire_vide, n_jetons, fichiers}. Un dictionnaire vide est signalé (dictionnaire_vide), jamais compté comme
 * « 0 fuite » par dictionnaire : seul le scan structurel a alors porté.
 */
export function scannerDepot(racine, dict) {
  const abs = path.resolve(racine), fuites = [], fichiers = fichiersDuDepot(abs), textes = [];
  for (const f of fichiers) {
    let buf;
    try { buf = fs.readFileSync(path.join(abs, f)); } catch { continue; }
    if (buf.subarray(0, 8000).includes(0)) continue;                                   // binaire (image, archive)
    if (buf.length > 32 * 1024 * 1024) { fuites.push({ fichier: f, ligne: 0, motif: 'non_lu' }); continue; }   // échec fermé
    textes.push([f, buf.toString('utf8')]);
  }
  // Vocabulaire courant du dépôt : un mot qu'il emploie en minuscules n'est pas, seul, le nom d'une personne.
  const vocab = new Set();
  if (dict) for (const [, t] of textes) vocabulaire(t, vocab);
  for (const [f, t] of textes) for (const p of scannerTexte(t, dict, { vocab }).positions) fuites.push({ fichier: f, ligne: p.ligne, motif: p.motif });
  const n_jetons = dict?.jetons?.size ?? 0, vide = !dict || (n_jetons === 0 && (dict.sirens?.size ?? 0) === 0);
  return { ok: fuites.length === 0, fuites, dictionnaire_vide: vide, n_jetons, fichiers: fichiers.length };
}

/** Scan sans dictionnaire, pour la CI publique (aucun accès à prive/). → {ok, fuites, fichiers} */
export function structurel(racine) {
  const r = scannerDepot(racine, null);
  return { ok: r.ok, fuites: r.fuites, fichiers: r.fichiers };
}

// ---------------------------------------------------------------------------------------------------------------------
// Oppositions.


/**
 * Oppositions connues (SIREN), lues dans prive/memoire.json. Lève OppositionsIndisponibles si le dernier acte
 * « opposition » du registre déclare n_total > 0 et que la mémoire est absente ou en contient moins.
 */
export function chargerOppositions(magasin, registre) {
  let memoire = null;
  try { memoire = magasin.lireJson(MEMOIRE); } catch { memoire = null; }
  const ensemble = new Set(sirensMemoire(memoire));
  const dernier = registre?.derniere?.('opposition') ?? null;
  const attendu = Number(dernier?.n_total) || 0;
  if (attendu > 0 && ensemble.size < attendu) throw new OppositionsIndisponibles(attendu, ensemble.size);
  return ensemble;
}

/**
 * Exclue de toute liste : opposition au registre (opposition_diffusion_commerciale), opposition reçue, ou champ
 * opposition absent ou illisible (seul false, lu tel quel, permet de retenir une fiche : échec fermé, comme controles G4).
 */
export const estExclue = (e, oppositions) => e?.opposition !== false || Boolean(oppositions?.has?.(String(e?.siren)));

/**
 * Enregistre une opposition dans la mémoire privée. → {acte, memoire}. L'acte public ne porte ni le SIREN ni son
 * empreinte nue : sa clé est l'empreinte du SIREN salée par le nonce privé de la mémoire (idempotente).
 */
export function enregistrerOpposition(siren, origine, { memoire = null, horloge = null } = {}) {
  if (typeof siren !== 'string' || !/^\d{9}$/.test(siren)) throw new TypeError('enregistrerOpposition : SIREN de 9 chiffres attendu');
  if (!['demande', 'registre'].includes(origine)) throw new TypeError("enregistrerOpposition : origine 'demande' ou 'registre' attendue");
  const base = memoire && typeof memoire === 'object' ? memoire : {};
  const nonce = typeof base.nonce === 'string' && /^[0-9a-f]{16}$/.test(base.nonce) ? base.nonce : crypto.randomBytes(8).toString('hex');
  const oppositions = [...new Set([...sirensMemoire(base), siren])].sort();
  const nouvelle = { version: 1, ...base, nonce, oppositions, ...(horloge ? { maj_le: horloge.iso() } : {}) };
  return { acte: { type: 'opposition', n_total: oppositions.length, origine, cle: `opposition:${empreinte({ siren, nonce })}` }, memoire: nouvelle };
}

// ---------------------------------------------------------------------------------------------------------------------
// Minimisation des échantillons.

const PRINCIPAUX = /président|gérant|directeur général|dirigeant|exploitant/i;

/**
 * Entreprise → EntrepriseMinimisee, seule forme montrée à un tiers : aucun nom de dirigeant, âge en tranche seulement.
 * nom_affichable vaut null pour une EI (nature 1000), une nature inconnue, ou un nom qui contient un jeton de dirigeant
 * (les siens, ou un jeton fort du dictionnaire). options : {alias} ou {rang} (alias 'S01'…).
 */
export function minimiser(e, horloge = creerHorloge(), dict = null, { alias, rang = 1 } = {}) {
  const dirigeants = Array.isArray(e?.dirigeants) ? e.dirigeants : [];
  const propres = new Set(dirigeants.flatMap((d) => mots(d?.nom)).filter(lettres));
  const forts = dict?.jetons ? new Set([...dict.jetons].filter((j) => !dict.faibles?.has?.(j) && !j.includes(' '))) : new Set();
  const motsNom = mots(e?.nom).filter(lettres);
  const nature = e?.nature_juridique === undefined || e?.nature_juridique === null ? null : String(e.nature_juridique);
  const nomme = motsNom.some((m) => propres.has(m) || forts.has(m)) || (dict?.composes && dict.composes.has(mots(e?.nom).join(' ')));
  const nom_affichable = nature === null || nature === '1000' || nomme || typeof e?.nom !== 'string' ? null : e.nom;
  const d = dirigeants.find((x) => PRINCIPAUX.test(x?.qualite ?? '')) ?? dirigeants[0] ?? null;
  const age = d ? ageAns(d.annee_naissance, horloge) : null;
  const fin = e?.ca ?? e?.finances?.[0] ?? null;
  const ca = !fin || fin.ca === null || fin.ca === undefined ? { annee: fin?.annee ?? null, statut: 'non_publie', montant: null }
    : { annee: fin.annee ?? null, statut: Number.isFinite(fin.annee) && fin.annee < horloge.annee() - 3 ? 'ancien' : 'publie', montant: fin.ca };
  const an = /^(\d{4})/.exec(String(e?.creation ?? ''))?.[1];
  return {
    alias: alias ?? `S${String(rang).padStart(2, '0')}`,
    nom_affichable,
    departement: e?.departement ?? null,
    commune: e?.commune ?? null,
    naf: e?.naf ?? null,
    effectif: e?.effectif ?? 'non renseigné',
    annee_creation: an ? Number(an) : null,
    ca,
    signaux: (Array.isArray(e?.signaux) ? e.signaux : []).map((s) => (typeof s === 'string' ? s : s?.code)).filter((s) => typeof s === 'string' && s),
    dirigeant: d ? { tranche_age: age === null ? 'inconnu' : age >= 62 ? '62 ans ou plus' : 'moins de 62 ans', qualite: d.qualite ?? null } : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Purges.

const LISTE_V1 = /^prive\/([a-z0-9-]+?)-(\d{4}-\d{2}-\d{2})(?:\.brut)?\.(json|csv)$/;
const LISTE_V2 = /^prive\/listes\/(?:.*\/)?([a-z0-9-]+?)-(\d{4}-\d{2}-\d{2})\.(json|jsonl|csv)$/;

function sansSiren(x, siren) {
  if (Array.isArray(x)) {
    let retires = 0;
    const garde = [];
    for (const v of x) {
      if (v === siren || (v && typeof v === 'object' && v.siren === siren)) { retires++; continue; }
      const r = sansSiren(v, siren); retires += r.retires; garde.push(r.valeur);
    }
    return { valeur: garde, retires };
  }
  if (x !== null && typeof x === 'object') {
    let retires = 0;
    const o = {};
    for (const [k, v] of Object.entries(x)) { const r = sansSiren(v, siren); retires += r.retires; o[k] = r.valeur; }
    return { valeur: o, retires };
  }
  return { valeur: x, retires: 0 };
}

/**
 * Échantillon privé ({fiches, minimise?, compte?}) dont une fiche vient d'être purgée : la copie minimisée (sans SIREN,
 * donc que sansSiren ne peut pas retirer ligne à ligne) est supprimée en entier, et le compte des retenues diminue
 * d'autant. Le brouillon recalcule l'échantillon depuis les fiches restantes (cycle.echantillonCourant).
 */
function sansCopieMinimisee(avant, apres, horloge) {
  if (!apres || typeof apres !== 'object' || Array.isArray(apres) || !Array.isArray(avant?.fiches) || !Array.isArray(apres.fiches)) return apres;
  const n = avant.fiches.length - apres.fiches.length;
  if (n <= 0) return apres;
  const { minimise, ...reste } = apres;
  const c = reste.compte && typeof reste.compte === 'object' && Number.isFinite(reste.compte.retenues)
    ? { ...reste.compte, retenues: Math.max(0, reste.compte.retenues - n), exclues: (Number(reste.compte.exclues) || 0) + n } : reste.compte;
  return { ...reste, ...(c !== undefined ? { compte: c } : {}), ...(minimise !== undefined ? { minimise_retire_le: horloge.iso() } : {}) };
}

// Fichiers de reprise d'une lecture SIRENE : prive/cycles/C-<jour>/cache/reprise-<recette>.json (construire_liste) et
// prive/cache/cibler-<recette>-<jour>.json (velyx cibler).
const REPRISE_CYCLE = /^prive\/cycles\/C-(?<jour>\d{4}-\d{2}-\d{2})\/cache\/reprise-(?<recette>[a-z0-9-]+)\.json$/;
const REPRISE_CIBLER = /^prive\/cache\/cibler-(?<recette>[a-z0-9-]+?)-(?<jour>\d{4}-\d{2}-\d{2})\.json$/;

/**
 * Purges de prive/. motif :
 * - 'fin_cycle' : fiches brutes (*.brut.json) et dossiers cache/, sauf le fichier de reprise du jour d'une recette dont
 *   la liste n'est pas encore consignée (registre : acte cible du jour) ; memoire.json est gardée ;
 * - 'retention_90j' : listes (prive/listes/** et listes v1 datées) de plus de 90 jours sans pari ouvert qui les cite ;
 * - 'opposition' : le SIREN est retiré des listes, des fiches et des échantillons de la mémoire (il reste dans
 *   memoire.oppositions) ; la copie minimisée d'un échantillon qui contenait la fiche est supprimée (sansCopieMinimisee).
 *   Un fichier qu'on ne sait pas réécrire et qui le cite est rendu dans a_revoir. Les revues actives qui la montraient
 *   sont rendues caduques AVANT la purge par l'appelant (risque.invaliderRevuesOpposees).
 * → {supprimes: string[] (fichiers supprimés, ou réécrits pour une opposition), a_revoir: string[]}
 */
export function purgerPrive(magasin, { horloge = creerHorloge(), motif, registre = null, siren } = {}) {
  const fichiers = magasin.lister('prive/'), supprimes = [], a_revoir = [];
  if (motif === 'fin_cycle') {
    // Une lecture SIRENE interrompue se reprend sans repayer ses pages : le fichier de reprise du jour (construire_liste,
    // velyx cibler) est gardé tant que la liste de cette recette n'est pas consignée ce jour (acte cible) ; ensuite, ou dès
    // le lendemain (il n'est jamais relu un autre jour), il part avec son cache.
    const jour = horloge.jour();
    const garder = (f) => {
      const g = (REPRISE_CYCLE.exec(f) ?? REPRISE_CIBLER.exec(f))?.groups;
      if (!g || g.jour !== jour) return false;
      return !(registre?.de?.('cible', (l) => l.recette === g.recette && typeof l.date === 'string' && creerHorloge(l.date).jour() === jour) ?? []).length;
    };
    const caches = new Map();
    for (const f of fichiers) {
      const i = f.split('/').indexOf('cache');
      if (i > 0) { const c = f.split('/').slice(0, i + 1).join('/'); if (!caches.has(c)) caches.set(c, []); caches.get(c).push(f); }
      else if (/\.brut\.json$/.test(f)) { magasin.supprimerPrive(f); supprimes.push(f); }
    }
    for (const [c, fs] of [...caches].sort(([a], [b]) => a.localeCompare(b))) {
      if (!fs.some(garder)) { magasin.supprimerPrive(c); supprimes.push(`${c}/`); continue; }
      for (const f of fs.filter((x) => !garder(x)).sort()) { magasin.supprimerPrive(f); supprimes.push(f); }
    }
    return { supprimes, a_revoir };
  }
  if (motif === 'retention_90j') {
    const etat = registre?.etat?.() ?? { paris: [] };
    const ouverts = new Set(etat.paris.filter((p) => ['ouvert', 'envoye'].includes(p.statut)).map((p) => p.id));
    const lignesOuvertes = (registre?.de?.('pari') ?? []).filter((l) => ouverts.has(l.id)).map((l) => JSON.stringify(l));
    const aujourdhui = Date.parse(`${horloge.jour()}T00:00:00Z`);
    for (const f of fichiers) {
      const m = LISTE_V2.exec(f) ?? LISTE_V1.exec(f);
      if (!m) continue;
      const age = (aujourdhui - Date.parse(`${m[2]}T00:00:00Z`)) / 864e5;
      if (!(age > 90)) continue;
      const cite = lignesOuvertes.some((l) => l.includes(m[1]) || l.includes(f));
      if (!cite) { magasin.supprimerPrive(f); supprimes.push(f); }
    }
    return { supprimes, a_revoir };
  }
  if (motif === 'opposition') {
    if (typeof siren !== 'string' || !/^\d{9}$/.test(siren)) throw new TypeError('purgerPrive(opposition) : SIREN de 9 chiffres attendu');
    for (const f of fichiers) {
      const texte = magasin.lire(f) ?? '';
      if (!texte.includes(siren)) continue;
      const ext = path.posix.extname(f).toLowerCase();
      if (f === MEMOIRE) {
        let m;
        try { m = JSON.parse(texte); } catch { a_revoir.push(f); continue; }
        let retires = 0;
        for (const e of Object.values(m.echantillons ?? {})) {
          if (Array.isArray(e?.sirens)) { const n = e.sirens.length; e.sirens = e.sirens.filter((s) => String(s) !== siren); retires += n - e.sirens.length; }
        }
        if (retires) { magasin.ecrirePrive(f, `${JSON.stringify(m, null, 1)}\n`); supprimes.push(f); }
        continue;
      }
      if (ext === '.json') {
        let o;
        try { o = JSON.parse(texte); } catch { a_revoir.push(f); continue; }
        const r = sansSiren(o, siren);
        if (r.retires) { magasin.ecrirePrive(f, `${JSON.stringify(sansCopieMinimisee(o, r.valeur, horloge), null, 1)}\n`); supprimes.push(f); } else a_revoir.push(f);
      } else if (ext === '.jsonl') {
        const lignes = texte.split('\n').filter((l) => {
          if (!l.trim()) return false;
          try { const o = JSON.parse(l); return !(o && o.siren === siren); } catch { return true; }
        });
        magasin.ecrirePrive(f, `${lignes.join('\n')}\n`); supprimes.push(f);
      } else if (ext === '.csv') {
        const brut = texte.split('\n'), tete = lireCsv(brut[0] ?? '')[0] ?? [], i = tete.findIndex((h) => /^siren$/i.test(h.trim()));
        if (i < 0) { a_revoir.push(f); continue; }
        const gardees = brut.filter((l, k) => k === 0 || !l.trim() || (lireCsv(l)[0]?.[i] ?? '').trim() !== siren);
        magasin.ecrirePrive(f, gardees.join('\n')); supprimes.push(f);
      } else a_revoir.push(f);
    }
    return { supprimes, a_revoir };
  }
  throw new TypeError(`purgerPrive : motif inconnu « ${motif} » (fin_cycle, retention_90j, opposition)`);
}

/** Notice RGPD publique (etat/rgpd.json, écrite par le magasin) : aucune donnée nominative. */
export function rgpdPublic(registre) {
  return {
    finalite: 'prospection B2B sur demande publiée',
    base_legale: 'intérêt légitime (à documenter par le propriétaire)',
    sources: ['registre SIRENE/RNE via recherche-entreprises.api.gouv.fr (données publiques)', 'annonces publiques de www.codeur.com'],
    conservation_jours: 90,
    n_oppositions: Number(registre?.derniere?.('opposition')?.n_total) || 0,
    contact: null,
  };
}
