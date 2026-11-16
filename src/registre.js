// Registre en ajout seul, chaîné par empreinte (même discipline que l'espace commun de GALILÉE, CORTEX, LAVOISIER).
// Un seul compteur d'argent : les actes « encaissement », saisis par le propriétaire avec leur preuve. Tout le reste
// (budgets affichés, CA des cibles, valeur d'une mission) est un potentiel et ne s'additionne jamais aux gains.
//
// v2, compatible avec la v1 (API, empreintes et 15 premières lignes inchangées) :
// - types v2 (contrats.TYPES_ACTE) et champs exigés par type (EXIGE) ;
// - clé d'idempotence acte.cle : un acte dont la clé existe déjà n'est pas réécrit, la ligne existante est rendue ;
// - verrou exclusif <journal>.lock (ouvert en 'wx', périmé après 30 s, attente ≤ 5 s), relecture du disque sous verrou,
//   écriture atomique (fichier .tmp puis renommage) : plus de fenêtre entre la lecture et l'écriture ;
// - admission : actes du propriétaire (PROPRIETAIRE_SEUL) avec niveau de vérification, montants finis et > 0, pari
//   existant pour envoi, reponse, cloture et encaissement qui en cite un, issue ∈ ISSUES, clôture « caduc » seulement par velyx, aucune clé nominative.
// - antifuite (R-10) : chaque acte passe garde.verifierActe AVANT le verrou (aucune clé nominative, aucun SIREN, SIRET,
//   téléphone ni e-mail, aucun jeton du dictionnaire, y compris dans la clé) ; dictionnaire indisponible → texte libre
//   refusé. Le journal est public et en ajout seul : une fuite écrite ne se retire plus sans casser verifier.
// La fusion de deux copies du journal (Registre.fusionner) est reportée.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { TYPES_ACTE, TYPES_ACTE_V1, PROPRIETAIRE_SEUL, AUTEURS, VERIFICATIONS, ISSUES, ISSUES_POSITIVES } from './contrats.js';
import { avecVerrou, ecrireAtomique, sha256Texte, creerMagasin } from './socle.js';
import { dictionnaire, verifierActe } from './garde.js';

// Empreinte de la v1, inchangée : sha256 de JSON.stringify(corps), 16 caractères. La changer casserait la chaîne existante.
const h = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

/**
 * Champs obligatoires par type d'acte (v1 puis v2). Une valeur undefined, null ou '' compte comme absente.
 * Écart à la spécification : « n » et « empreinte » sont des champs de la ligne (numéro et empreinte de chaînage, fixés
 * par la v1). Comme type_hyp et type_revue pour « type », l'effectif d'un fait s'écrit n_fait et l'empreinte du contenu
 * d'une revue (dans revue et validation) s'écrit empreinte_revue.
 */
export const EXIGE = Object.freeze({
  mandat: ['texte', 'source', 'regle'],
  observation: ['source', 'mesure'],
  cible: ['recette', 'compte', 'fichier_prive'],
  pari: ['hypothese', 'geste_proprietaire', 'critere_succes', 'critere_arret', 'echeance'],
  brouillon: ['pari', 'fichier'],
  envoi: ['pari', 'canal'],
  reponse: ['pari', 'issue'],
  encaissement: ['montant_eur', 'preuve'],
  depense: ['montant_eur', 'objet', 'autorise_par'],
  aveu: ['motif'],
  lecon: ['texte', 'source'],
  cycle: ['jour', 'passage', 'etapes', 'requetes', 'duree_s'],
  fait: ['sujet', 'mesure', 'n_fait', 'source'],
  contradiction: ['croyance', 'fait', 'attendu', 'ecart'],
  hypothese: ['contradiction', 'type_hyp', 'test'],
  prevision: ['sujet', 'mesure', 'p', 'n_base', 'horizon_h'],
  resolution: ['prevision', 'issue', 'source'],
  decision: ['action', 'verdict', 'regle'],
  refus: ['action', 'regle', 'motif'],
  controle: ['objet', 'resultats'],
  revue: ['id', 'type_revue', 'empreinte_revue', 'geste', 'fichier_prive'],
  validation: ['revue', 'empreinte_revue', 'choix', 'verification'],
  cloture: ['pari', 'motif'],
  regle: ['code', 'definition', 'backtest'],
  revision: ['croyance', 'de', 'vers', 'preuves'],
  audit: ['semaine', 'constats'],
  opposition: ['n_total', 'origine'],
  memoire: ['sha256', 'octets', 'n_oppositions'],
  geste: ['sujet', 'valeur', 'verification'],
});

/** Clés qui nommeraient une personne ou une entreprise : refusées à toute profondeur d'un acte (le registre est public). */
export const CLES_NOMINATIVES = Object.freeze(['nom', 'nom_complet', 'prenom', 'prenoms', 'dirigeants', 'adresse', 'siren', 'siret',
  'email', 'telephone', 'date_de_naissance', 'annee_naissance', 'nationalite']);
const RESERVEES = { n: 'n_fait (effectif d’un fait)', date: null, precedente: null, empreinte: 'empreinte_revue (empreinte du contenu d’une revue)' };
const MOTIFS_CLOTURE = ['caduc', 'perdu'];

/** Constructeurs des clés d'idempotence, au format de la spécification. */
export const CLES = Object.freeze({
  observation: (jour) => `observation:codeur:${jour}`,
  fait: (sujet, mesure, jour) => `fait:${sujet}:${mesure}:${jour}`,
  contradiction: (croyance, jour) => `contradiction:${croyance}:${jour}`,
  hypothese: (cleContradiction, type) => `hypothese:${cleContradiction}:${type}`,
  prevision: (sujet, horizon, jour) => `prevision:${sujet}:${horizon}:${jour}`,
  decision: (cleAction, jour) => `decision:${cleAction}:${jour}`,
  refus: (cleAction, jour) => `refus:${cleAction}:${jour}`,
  cible: (recette, jour) => `cible:${recette}:${jour}`,
  controle: (objet, emp) => `controle:${objet}:${emp}`,
  revue: (type, ref, emp) => `revue:${type}:${ref}:${emp}`,
  pari: (revue) => `pari:${revue}`,
  cloture: (pari) => `cloture:${pari}`,
  memoire: (sha) => `memoire:${sha}`,
  cycle: (jour, passage) => `cycle:${jour}:${passage}`,
  revision: (croyance, jour) => `revision:${croyance}:${jour}`,
  audit: (semaine) => `audit:${semaine}`,
  geste: (source, phrase) => `geste:${sha256Texte(`${source}${phrase}`)}`,
});

function cleNominative(x, profondeur = 0) {
  if (profondeur > 20 || x === null || typeof x !== 'object') return null;
  if (Array.isArray(x)) { for (const v of x) { const k = cleNominative(v, profondeur + 1); if (k) return k; } return null; }
  for (const [k, v] of Object.entries(x)) {
    if (CLES_NOMINATIVES.includes(k)) return k;
    const sous = cleNominative(v, profondeur + 1);
    if (sous) return sous;
  }
  return null;
}

// Contrôles qui ne dépendent que de l'acte lui-même (faits avant de prendre le verrou).
function admettre(acte) {
  if (acte === null || typeof acte !== 'object' || Array.isArray(acte)) throw new TypeError('acte refusé : objet attendu');
  const t = acte.type;
  if (!TYPES_ACTE.includes(t)) throw new Error(`type inconnu : ${t}`);
  for (const [k, autre] of Object.entries(RESERVEES)) {
    if (Object.hasOwn(acte, k)) throw new Error(`acte « ${t} » refusé : la clé « ${k} » est réservée au registre${autre ? ` ; utiliser ${autre}` : ''}`);
  }
  const auteur = acte.auteur ?? 'velyx';
  if (!AUTEURS.includes(auteur)) throw new Error(`acte « ${t} » refusé : auteur inconnu « ${auteur} »`);
  const nominative = cleNominative(acte);
  if (nominative) throw new Error(`acte « ${t} » refusé : clé nominative « ${nominative} » (registre public ; tout ce qui nomme va dans prive/)`);
  const manque = EXIGE[t].filter((k) => acte[k] === undefined || acte[k] === null || acte[k] === '');
  if (manque.length) throw new Error(`acte « ${t} » refusé, il manque : ${manque.join(', ')}`);
  if (acte.cle !== undefined && (typeof acte.cle !== 'string' || !acte.cle || acte.cle.length > 300)) throw new Error(`acte « ${t} » refusé : cle doit être un texte de 1 à 300 caractères`);
  if (PROPRIETAIRE_SEUL.includes(t) && auteur !== 'proprietaire') throw new Error(`« ${t} » refusé : seul le propriétaire écrit cet acte (auteur 'proprietaire')`);
  if (auteur === 'proprietaire') {
    // Compatibilité v1 : les actes v1 du propriétaire (velyx envoye, reponse, encaisse) peuvent encore arriver sans
    // vérification ; ils comptent alors comme simplement déclarés. Tout acte v2 du propriétaire doit être vérifié.
    if (acte.verification === undefined) {
      if (!TYPES_ACTE_V1.includes(t)) throw new Error(`« ${t} » refusé : un acte du propriétaire exige verification ('session' ou 'github') et preuve_empreinte`);
    } else {
      if (!VERIFICATIONS.includes(acte.verification)) throw new Error(`« ${t} » refusé : verification doit valoir ${VERIFICATIONS.map((v) => `'${v}'`).join(' ou ')}`);
      if (typeof acte.preuve_empreinte !== 'string' || !/^[0-9a-f]{64}$/.test(acte.preuve_empreinte)) {
        throw new Error(`« ${t} » refusé : preuve_empreinte (sha256 hexadécimal de la phrase du propriétaire, 64 caractères) requise`);
      }
    }
  }
  if (t === 'encaissement' || t === 'depense') {
    const m = acte.montant_eur;
    if (typeof m !== 'number' || !Number.isFinite(m) || m <= 0) throw new Error(`« ${t} » refusé : montant_eur doit être un nombre fini strictement positif`);
  }
  if (t === 'depense' && acte.autorise_par !== 'proprietaire') throw new Error('dépense refusée : seul le propriétaire autorise une dépense');
  if (t === 'reponse' && !ISSUES.includes(acte.issue)) throw new Error(`« reponse » refusée : issue inconnue « ${acte.issue} » (attendu : ${ISSUES.join(', ')})`);
  if (t === 'cloture') {
    if (!MOTIFS_CLOTURE.includes(acte.motif)) throw new Error(`« cloture » refusée : motif « ${acte.motif} » inconnu (caduc ou perdu)`);
    if (acte.motif === 'perdu' && auteur !== 'proprietaire') throw new Error('« cloture » refusée : velyx ne clôt un pari que « caduc » ; seul le propriétaire le déclare perdu');
  }
  return { ...acte, auteur };
}

function echeanceLe(echeance, dateEnvoi) {
  if (typeof echeance !== 'string') return null;
  const m = /^envoi\s*\+\s*(\d+)\s*jours?$/i.exec(echeance.trim());
  if (m) return dateEnvoi ? new Date(Date.parse(dateEnvoi) + Number(m[1]) * 864e5).toISOString() : null;
  const t = Date.parse(echeance);
  return /^\d{4}-\d{2}-\d{2}/.test(echeance) && Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Racine du dépôt d'un journal : <racine>/registre/journal.jsonl → <racine> ; sinon le dossier du journal. */
const racineDuJournal = (fichier) => {
  const dossier = path.dirname(path.resolve(fichier));
  return path.basename(dossier) === 'registre' ? path.dirname(dossier) : dossier;
};
const DICT_VIDE = Object.freeze({ jetons: new Set(), sirens: new Set(), faibles: new Set(), composes: new Set(), communes: new Set() });

export class Registre {
  #index = new Map();
  #dict;
  #dictConstruit = undefined;

  /**
   * @param {string|null} fichier  journal JSONL ; null : registre en mémoire seulement (voir copie()).
   * @param {{horloge?: {iso(): string}, verrou?: {perimeMs?: number, attenteMs?: number}, dict?: object|null|(() => object|null)}} options
   *   dict : dictionnaire de l'antifuite (garde.dictionnaire), ou fonction qui le rend ; null : indisponible (tout texte
   *   libre refusé). Absent : construit à la première écriture depuis le prive/ voisin du journal ; s'il ne se construit
   *   pas (DictionnaireIncoherent), il est indisponible. Un registre en mémoire sans dict ni parent n'a aucune fiche à
   *   protéger : dictionnaire vide, motifs structurels seulement.
   */
  constructor(fichier, { horloge = null, verrou = {}, dict } = {}) {
    this.fichier = fichier ?? null;
    this.horloge = horloge;
    this.verrou = this.fichier === null ? null : `${this.fichier}.lock`;
    this.optionsVerrou = verrou;
    this.#dict = dict;
    this.lignes = [];
    this.illisible = null;
    this.relire();
  }

  /** Dictionnaire de l'antifuite utilisé pour admettre un acte (null : indisponible). */
  dictionnaire() {
    if (this.#dict !== undefined) return typeof this.#dict === 'function' ? this.#dict() ?? null : this.#dict;
    if (this.fichier === null) return DICT_VIDE;
    if (this.#dictConstruit === undefined) {
      try { this.#dictConstruit = dictionnaire(creerMagasin(racineDuJournal(this.fichier))); } catch { this.#dictConstruit = null; }
    }
    return this.#dictConstruit;
  }

  /** Recharge le journal depuis le disque (sans effet pour un registre en mémoire). */
  relire() {
    if (this.fichier === null) return this;
    const texte = fs.existsSync(this.fichier) ? fs.readFileSync(this.fichier, 'utf8') : '';
    this.#charger(texte);
    return this;
  }

  #charger(texte) {
    const lignes = [];
    this.illisible = null;
    for (const brut of texte.split('\n')) {
      if (!brut.trim()) continue;
      try { lignes.push(JSON.parse(brut)); } catch { this.illisible = lignes.length + 1; break; }
    }
    this.lignes = lignes;
    this.#index = new Map(lignes.filter((l) => typeof l.cle === 'string').map((l) => [l.cle, l]));
  }

  #construire(a) {
    const { auteur, type, cle, ...champs } = a;
    const corps = { n: this.lignes.length + 1, date: this.horloge ? this.horloge.iso() : new Date().toISOString(), auteur, type,
      ...(cle !== undefined ? { cle } : {}), ...champs, precedente: this.lignes.at(-1)?.empreinte ?? 'origine' };
    // Ce qui est gardé en mémoire est exactement ce qui est relu du disque (valeurs non JSON écartées).
    return JSON.parse(JSON.stringify({ ...corps, empreinte: h(JSON.stringify(corps)) }));
  }

  #verifierReferences(a) {
    // Un encaissement peut être « libre » (sans pari) ; s'il cite un pari, celui-ci doit exister (seul compteur d'argent).
    const citePari = ['envoi', 'reponse', 'cloture'].includes(a.type) || (a.type === 'encaissement' && a.pari !== undefined && a.pari !== null);
    if (citePari && !this.lignes.some((l) => l.type === 'pari' && l.id === a.pari)) {
      throw new Error(`« ${a.type} » refusé : pari inconnu « ${a.pari} »`);
    }
    if (a.type === 'pari' && a.id !== undefined && this.lignes.some((l) => l.type === 'pari' && l.id === a.id)) {
      throw new Error(`« pari » refusé : l’id « ${a.id} » existe déjà`);
    }
  }

  #inscrire(ligne) {
    this.lignes.push(ligne);
    if (typeof ligne.cle === 'string') this.#index.set(ligne.cle, ligne);
    return ligne;
  }

  /**
   * Ajoute un acte et rend sa ligne. Si acte.cle existe déjà, rend la ligne existante sans rien écrire.
   * Sous verrou : relecture du disque, contrôle des références, écriture atomique du journal complet.
   */
  ajouter(acte) {
    const a = admettre(acte);
    // R-10 : le registre est public ; l'antifuite passe avant le verrou, en échec fermé.
    const v = verifierActe(a, this.dictionnaire());
    if (!v.ok) throw new Error(`acte « ${a.type} » refusé par l’antifuite (registre public, tout ce qui nomme va dans prive/) : ${v.motifs.join(' ; ')}`);
    const faire = (texte) => {
      if (this.illisible !== null) throw new Error(`registre illisible à la ligne ${this.illisible} : réparer avant tout ajout`);
      if (a.cle !== undefined && this.#index.has(a.cle)) return { ligne: this.#index.get(a.cle), nouvelle: false };
      this.#verifierReferences(a);
      const ligne = this.#construire(a);
      if (texte !== null) ecrireAtomique(this.fichier, `${texte}${texte && !texte.endsWith('\n') ? '\n' : ''}${JSON.stringify(ligne)}\n`);
      return { ligne: this.#inscrire(ligne), nouvelle: true };
    };
    if (this.fichier === null) return faire(null).ligne;
    return avecVerrou(this.verrou, () => {
      const texte = fs.existsSync(this.fichier) ? fs.readFileSync(this.fichier, 'utf8') : '';
      this.#charger(texte);
      return faire(texte).ligne;
    }, this.optionsVerrou);
  }

  /** Ligne portant cette clé d'idempotence. */
  trouver(cle) { return this.#index.get(cle); }
  /** Lignes d'un type, filtrées. */
  de(type, filtre = () => true) { return this.lignes.filter((l) => l.type === type && filtre(l)); }
  /** Dernière ligne d'un type qui passe le filtre. */
  derniere(type, filtre = () => true) { return this.de(type, filtre).at(-1); }

  /** Intégrité : numérotation continue, chaînage et empreinte de chaque ligne (relit le disque d'abord). */
  verifier() {
    this.relire();
    if (this.illisible !== null) return { ok: false, ligne: this.illisible, motif: 'illisible' };
    let prec = 'origine';
    for (const [i, l] of this.lignes.entries()) {
      const { empreinte, ...corps } = l;
      if (l.n !== i + 1) return { ok: false, ligne: i + 1, motif: 'numerotation' };
      if (corps.precedente !== prec) return { ok: false, ligne: l.n, motif: 'chainage' };
      if (h(JSON.stringify(corps)) !== empreinte) return { ok: false, ligne: l.n, motif: 'empreinte' };
      prec = empreinte;
    }
    return { ok: true, lignes: this.lignes.length };
  }

  /**
   * Argent et paris. encaisse_eur : tous les encaissements du propriétaire (déclarés ou vérifiés) ;
   * encaisse_verifie_eur : seulement ceux dont verification = 'github'. Les champs v1 sont conservés.
   */
  etat() {
    const de = (t) => this.lignes.filter((l) => l.type === t);
    const somme = (ls) => ls.reduce((s, l) => s + (typeof l.montant_eur === 'number' && Number.isFinite(l.montant_eur) ? l.montant_eur : 0), 0);
    const encaissements = de('encaissement').filter((l) => l.auteur === 'proprietaire');
    const paris = de('pari').map((p) => {
      const envois = de('envoi').filter((e) => e.pari === p.id);
      const issues = de('reponse').filter((r) => r.pari === p.id).map((r) => r.issue);
      const clotures = de('cloture').filter((c) => c.pari === p.id);
      const statut = issues.some((i) => ISSUES_POSITIVES.includes(i)) ? 'gagne'
        : issues.some((i) => i === 'refus' || i === 'sans_reponse') || clotures.some((c) => c.motif === 'perdu') ? 'perdu'
          : clotures.some((c) => c.motif === 'caduc') ? 'caduc'
            : envois.length ? 'envoye' : 'ouvert';
      return {
        id: p.id, hypothese: p.hypothese, echeance: p.echeance, envoye: envois.length > 0, issues, geste: p.geste_proprietaire,
        canal: envois.at(-1)?.canal ?? p.canal ?? null, statut, echeance_le: echeanceLe(p.echeance, envois[0]?.date ?? null),
      };
    });
    return {
      encaisse_eur: somme(encaissements),
      encaisse_verifie_eur: somme(encaissements.filter((l) => l.verification === 'github')),
      depense_eur: somme(de('depense')),
      paris,
      dernier_geste_proprietaire: this.lignes.filter((l) => l.auteur === 'proprietaire').at(-1)?.date ?? null,
    };
  }

  /** Copie en mémoire (exécution à blanc) : mêmes lignes, ajouts jamais écrits sur le disque. */
  copie() {
    const c = new Registre(null, { horloge: this.horloge, dict: () => this.dictionnaire() });
    c.#charger(this.lignes.map((l) => JSON.stringify(l)).join('\n'));
    return c;
  }

  /** Fusion de deux copies du journal : reportée (voir le périmètre v2). */
  static fusionner() {
    throw new Error('Registre.fusionner : reporté (fusion de copies du journal hors du périmètre v2)');
  }
}
