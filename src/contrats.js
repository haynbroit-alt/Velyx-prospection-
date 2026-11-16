// Contrats partagés de VELYX v2 : énumérations figées et formes (JSDoc) des objets échangés entre modules.
// Ce fichier ne dépend de rien et n'a aucun effet. Il est gelé : tout changement passe par une PR relue par tous les
// modules, car chaque module compare ses valeurs à ces listes (une faute de frappe y casserait la boucle en silence).
// Graphe d'import, acyclique : contrats ← socle ← {registre, sources, garde, brouillons, monde, strategie, risque} ;
// garde ← controles ← {recettes, bilan} ; garde ← site ; cycle ← tous.

const fige = (liste) => Object.freeze([...liste]);

/** Les 15 étapes de la boucle quotidienne, dans l'ordre d'exécution. */
export const ETAPES = fige(['observer', 'comprendre', 'confronter', 'hypotheses', 'anticiper', 'prioriser', 'decider', 'simuler',
  'executer', 'revue', 'mesurer', 'apprendre', 'reviser', 'rever', 'retour']);

/** Types d'actes de la v1 : les 15 premières lignes du registre n'utilisent que ceux-ci (dont « mandat », ligne 14). */
export const TYPES_ACTE_V1 = fige(['mandat', 'observation', 'cible', 'pari', 'brouillon', 'envoi', 'reponse', 'encaissement',
  'depense', 'aveu', 'lecon']);
/** Types d'actes ajoutés par la v2. */
export const TYPES_ACTE_V2 = fige(['cycle', 'fait', 'contradiction', 'hypothese', 'prevision', 'resolution', 'decision', 'refus',
  'controle', 'revue', 'validation', 'cloture', 'regle', 'revision', 'audit', 'opposition', 'memoire', 'geste']);
/** Tous les types d'actes admis au registre (v1 puis v2). */
export const TYPES_ACTE = fige([...TYPES_ACTE_V1, ...TYPES_ACTE_V2]);
/** Actes que seul le propriétaire écrit (auteur 'proprietaire'). */
export const PROPRIETAIRE_SEUL = fige(['mandat', 'envoi', 'reponse', 'encaissement', 'depense', 'validation', 'geste']);
/** Auteurs possibles d'une ligne du registre. */
export const AUTEURS = fige(['velyx', 'proprietaire']);
/** Niveaux de vérification d'un acte du propriétaire : transcrit dans sa session, ou commentaire GitHub vérifiable. */
export const VERIFICATIONS = fige(['session', 'github']);

/** Issues d'un pari envoyé. Un refus ne compte jamais comme une réponse positive. */
export const ISSUES = fige(['sans_reponse', 'refus', 'question', 'devis_demande', 'echange', 'commande', 'paye']);
/** Issues qui gagnent un pari (« question » n'en fait pas partie). */
export const ISSUES_POSITIVES = fige(['devis_demande', 'echange', 'commande', 'paye']);
/** Issues qui montrent un engagement du client (KPI taux_engagement). */
export const ISSUES_ENGAGEMENT = fige([...ISSUES_POSITIVES, 'question']);
/** Niveaux de croyance, du plus faible au plus fort. Seul un pari gagné élève une croyance commerciale au sommet. */
export const NIVEAUX = fige(['refutee', 'contestee', 'hypothese', 'dite_par_client', 'observee', 'pari_gagne']);
/** Verdicts du Risk Agent, du plus permissif au plus restrictif. */
export const VERDICTS = fige(['autorise', 'revue_humaine', 'interdit']);
/** Familles d'annonces. */
export const FAMILLES = fige(['donnees', 'rdv_appels', 'dev', 'autre']);
/** Types d'éléments mis en revue humaine. */
export const TYPES_REVUE = fige(['proposition', 'prealable', 'kit_canal', 'publication_site', 'gmail_brouillon', 'tache_planifiee',
  'reseau', 'code']);
/** Types d'actions que DÉCIDER peut proposer ; toute autre valeur est refusée par le Risk Agent. */
export const TYPES_ACTION = fige(['rien', 'suivre_annonce', 'lire_cgu', 'sonder', 'echantillonner', 'construire_liste',
  'ecrire_recette', 'rediger_brouillon', 'regenerer_brouillon', 'preparer_prealable', 'preparer_kit_canal', 'invalider_revue',
  'clore_pari_caduc', 'demander_issue', 'purger_opposition', 'ecrire_lecon', 'adopter_regle', 'reviser_croyance', 'sauver_memoire',
  'copier_drive', 'notifier', 'preparer_site', 'publier_site', 'creer_brouillon_gmail']);

// ---------------------------------------------------------------------------------------------------------------------
// Formes des objets échangés (documentation seulement ; la validation effective se fait par socle.valider).

/**
 * Contexte d'un cycle, construit par cycle.creerContexte.
 * @typedef {object} Ctx
 * @property {string} racine        racine du dépôt
 * @property {string} jour          'AAAA-MM-JJ', jour de Paris
 * @property {string} id            'C-AAAA-MM-JJ'
 * @property {1|2|3} passage
 * @property {object} horloge       socle.creerHorloge
 * @property {object} budget        socle.creerBudget
 * @property {object} http          socle.creerHttp
 * @property {object} magasin       socle.creerMagasin
 * @property {object} registre      registre.Registre
 * @property {{texte: string, empreinte: string}} politique
 * @property {Set<string>} oppositions
 * @property {object} dict          garde.dictionnaire
 * @property {boolean} aBlanc
 * @property {'normal'|'veille'} mode
 */

/**
 * Annonce publiée sur codeur.com. Un champ illisible vaut null, jamais 0.
 * @typedef {object} Annonce
 * @property {string} id
 * @property {string} url
 * @property {string} titre
 * @property {'Ouvert'|'En cours'|'Fermé'|null} statut
 * @property {string|null} publie_le    ISO UTC
 * @property {number|null} age_h
 * @property {{min: number|null, max: number|null, texte: string}} budget
 * @property {number|null} offres
 * @property {number|null} vues
 * @property {number|null} interactions
 * @property {{n: number, heures: number}|null} devis_2h
 * @property {number|null} montant_moyen_devis
 * @property {string[]} tags
 * @property {string} resume
 * @property {string|null} description
 * @property {string} lu_le
 */

/**
 * Point public d'une série d'annonces (etat/series/*.jsonl), sans aucun nom de client.
 * @typedef {{id: string, t: string, statut: string|null, offres: number|null, vues: number|null, interactions: number|null,
 *   devis_2h_n: number|null, bmin: number|null, bmax: number|null, tags: string[], publie_le: string|null,
 *   age_h: number|null (âge lu au relevé t, pubDate ou « il y a … » de la liste), famille: string|null (FAMILLES)}} PointSerie
 */

/**
 * Entreprise (PRIVÉE : nomme des personnes), sortie de sirene.resumer.
 * @typedef {object} Entreprise
 * @property {string} siren
 * @property {string} nom
 * @property {string|null} nature_juridique     '1000' = entrepreneur individuel
 * @property {string} naf
 * @property {string|null} creation             'AAAA-MM-JJ'
 * @property {string|null} etat_administratif   'A' actif, 'C' cessé
 * @property {boolean} fermee
 * @property {string|null} categorie            'PME'|'ETI'|'GE'|null
 * @property {string} effectif                  libellé de tranche ('1-2', '6-9'…)
 * @property {string|null} effectif_code        code INSEE ('01', '03'…, 'NN')
 * @property {number|null} effectif_annee
 * @property {string|null} departement
 * @property {string|null} commune
 * @property {{qualite: string, nom: string, annee_naissance: number|null}[]} dirigeants
 * @property {number} dirigeants_pm             dirigeants personnes morales
 * @property {{annee: number, ca: number|null, resultat_net: number|null}[]} finances   3 au plus, du plus récent
 * @property {{annee: number, ca: number|null, resultat_net: number|null}|null} ca      finances[0]
 * @property {boolean} rge
 * @property {string[]} idcc
 * @property {boolean|null} opposition          opposition_diffusion_commerciale ; null si l'API ne la donne pas (exclue, G4)
 * @property {string|null} statut_diffusion     'O' diffusible, 'P' partielle ; null si absent (exclue, G11)
 * @property {number|null} etablissements_ouverts
 * @property {string} fiche
 */

/**
 * Entreprise minimisée, seule forme admise dans un échantillon montré à un tiers : aucun nom de dirigeant.
 * @typedef {object} EntrepriseMinimisee
 * @property {string} alias                     'S01'…
 * @property {string|null} nom_affichable       null pour une EI ou un nom qui contient celui d'un dirigeant
 * @property {string|null} departement
 * @property {string|null} commune
 * @property {string} naf
 * @property {string} effectif
 * @property {number|null} annee_creation
 * @property {{annee: number|null, statut: 'publie'|'non_publie'|'ancien', montant: number|null}} ca
 * @property {string[]} signaux
 * @property {{tranche_age: '62 ans ou plus'|'moins de 62 ans'|'inconnu', qualite: string}|null} dirigeant
 */

/**
 * @typedef {{id: string, sujet: string, mesure: string, valeur: number|null, n: number, source: string, lu_le: string,
 *   sain: boolean}} Fait
 */

/**
 * @typedef {object} Croyance
 * @property {string} id
 * @property {'marche'|'commerciale'|'canal'|'contrainte'|'proprietaire'|'instrument'} nature
 * @property {string} enonce
 * @property {string} niveau                    ∈ NIVEAUX
 * @property {number[]} preuves                 numéros de lignes du registre
 * @property {{sujet: string, mesure: string, op: string, seuil: *, min_n: number, jours_distincts: number}|null} test
 * @property {{sujet: string, mesure: string, op: string, seuil: *, min_n: number, consecutifs: number}|null} infirmation
 * @property {string|null} revisee_le
 */

/**
 * @typedef {object} Action
 * @property {string} id                        'A-<cycle>-<k>'
 * @property {string} type                      ∈ TYPES_ACTION
 * @property {string|null} ref
 * @property {object} params
 * @property {string} raison                    200 caractères au plus
 * @property {string} cle                       socle.empreinte({type, ref, params})
 * @property {null|{type: string, statut: 'demande'|'accepte'|'rejete'}} jugement
 */

/** @typedef {{verdict: string, regle: string, motif: string}} Verdict   verdict ∈ VERDICTS, regle 'R-xx' */

/**
 * @typedef {{code: string, gravite: 'bloquant'|'alerte', ok: boolean, n_concernes: number, motif: string}} ResultatControle
 */

/**
 * @typedef {{ok: boolean, plan: {requetes: {codeur: number, sirene: number}, ecritures_publiques: string[],
 *   ecritures_privees: string[], actes: string[]}, controles: ResultatControle[]}} Simulation
 */

/**
 * @typedef {object} Revue
 * @property {string} id                        'R-AAAA-MM-JJ-k'
 * @property {string} type                      ∈ TYPES_REVUE
 * @property {string|null} ref
 * @property {string} empreinte                 hex16
 * @property {string} fichier_prive
 * @property {string} geste
 * @property {string|null} canal
 * @property {string} ouverte_le
 * @property {string} expire_le
 * @property {'ouverte'|'validee'|'rejetee'|'envoyee'|'caduque'} statut
 * @property {number} age_h
 */

/**
 * @typedef {Object<string, {valeur: number|string|null, n: number, nature: 'valeur'|'goulot'|'instrument',
 *   definition: string, source: string, date: string}>} Kpi
 */

/** @typedef {{code: string, gravite: 'info'|'alerte'|'bloquant', texte: string, preuves: number[]}} Constat   texte ≤ 300 */

/**
 * @typedef {{id: string, outil: 'drive.create_file'|'drive.renommer'|'notifier', fichier_local: string, sha256: string,
 *   titre: string, cle: string}} TacheMcp
 */

/**
 * Ligne du registre (registre/journal.jsonl).
 * @typedef {{n: number, date: string, auteur: 'velyx'|'proprietaire', type: string, cle?: string, precedente: string,
 *   empreinte: string}} Ligne
 */
