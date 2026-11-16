// Brouillons « preuve d'abord » (M6). Les gabarits sont des textes à placeholders : le moteur remplit chaque nombre, et
// chaque nombre garde sa provenance (fichier ou acte). Le texte écrit par un humain ou par le LLM n'en contient aucun.
// « au moins » est inséré automatiquement quand la lecture est partielle. L'échantillon est minimisé : ni nom de
// dirigeant, ni âge exact, ni nom ni commune d'une EI. Le prix et la signature restent au propriétaire : les repères de
// prix (étude de marché) ne vont que dans les notes privées, à titre d'information, jamais dans le texte.
// Ce sont des BROUILLONS : rien ne part sans le propriétaire.
import { creerHorloge, empreinte, defautChaine } from './socle.js';
import { ISSUES_POSITIVES } from './contrats.js';
import { controlerBrouillon, minimiser, nombresDuTexte, promesses, PLACEHOLDERS, jetonsDe, jetonsNom, horsCitations, contientMontant } from './controles.js';
import { RECETTES, chiffresRecette, appliquer } from './recettes.js';

/** Placeholders que tout texte destiné à un tiers doit garder tels quels. */
export const PLACEHOLDERS_OBLIGATOIRES = PLACEHOLDERS;

const FIN = `
[PRIX À VALIDER PAR LE PROPRIÉTAIRE]

Bien cordialement,
[NOM DU PROPRIÉTAIRE]`;

/** Gabarits : id → texte à placeholders {{…}}. Aucun chiffre hors placeholders, codes NAF, articles de loi et dates. */
export const GABARITS = Object.freeze({
  'liste-sur-demande': `Bonjour,

Votre annonce ({{annonce.url}}) demande une liste d’entreprises. Avant de vous répondre, je l’ai construite à partir du registre officiel des entreprises (INSEE, base Sirene ; INPI, registre national des entreprises), lu le {{lu_le}}.

Selon vos critères, {{au_moins}}{{compte.retenues}} entreprises actives correspondent, après exclusion des entreprises fermées, de celles qui s’opposent à la prospection commerciale et de celles dont la diffusion est partielle.

Échantillon de {{echantillon.n}} lignes, sans nom de dirigeant :

{{echantillon.lignes}}

Ce que je propose : la liste complète, avec la fiche officielle de chaque entreprise, la mention de source et de date, et la liste des oppositions à respecter.

Limites à connaître :
{{limites}}
${FIN}`,

  'rachat-it-idf': `Bonjour,

Pour identifier des cibles de rachat de portefeuille, j’ai interrogé le registre officiel des entreprises (INSEE, base Sirene ; INPI, registre national des entreprises) avant de vous écrire, plutôt que de vous décrire une méthode. Lecture du {{lu_le}}.

En Île-de-France, {{au_moins}}{{compte.retenues}} sociétés de services informatiques (codes NAF 62.01Z à 62.09Z), micro-entreprises au sens de l’INSEE (de {{param.effectif_min}} à {{param.effectif_max}} salariés), ont un dirigeant de {{param.age_dirigeant_min}} ans ou plus : le moment où la question de la transmission se pose, sans repreneur interne possible dans une si petite structure. Parmi elles, {{compte.par_signal.portefeuille}} existent depuis {{param.portefeuille}} ans ou plus et {{compte.par_signal.rentable}} ont publié un résultat positif sur un exercice de moins de {{param.rentable}} ans. Les sociétés qui s’opposent à la prospection commerciale sont exclues.

Échantillon de {{echantillon.n}} sociétés, sans nom de dirigeant ni âge exact :

{{echantillon.lignes}}

Ce que je propose :
- la liste complète, classée par ces signaux, avec la fiche officielle de chaque société ;
- la qualification des premières cibles (activité réelle, type de clientèle, signes de départ).

Limites à connaître :
{{limites}}
${FIN}`,

  'courtier-btp-aura': `Bonjour,

Avant de vous écrire, j’ai regardé quelles entreprises viser en priorité, à partir de vos propres critères et du registre officiel des entreprises (INSEE, base Sirene ; INPI, registre national des entreprises), lu le {{lu_le}}.

Dans vos huit départements de Rhône-Alpes, {{au_moins}}{{compte.retenues}} PME actives de vos métiers comptent de {{param.effectif_min}} à {{param.effectif_max}} salariés. Parmi elles :
- {{compte.par_signal.recente}} ont été immatriculées il y a moins de {{param.recente}} ans (créations ou reprises, à vérifier) : votre premier cas prioritaire, « entreprise récente » ; la décennale doit être justifiée à l’ouverture de tout chantier (C. assurances, art. L241-1) ;
- {{compte.par_signal.rge}} sont qualifiées RGE, donc sur les activités que vous citez (photovoltaïque, isolation, pompes à chaleur) ;
- {{compte.par_signal.operation}} sont promoteurs ou constructeurs (dommages-ouvrage, tous risques chantier, garantie d’achèvement à chaque opération).
Pour {{compte.completes}} d’entre elles, le chiffre d’affaires d’un exercice récent et le nom du dirigeant sont déjà renseignés depuis les comptes publiés. Les entreprises qui s’opposent à la prospection commerciale sont exclues.

Échantillon de {{echantillon.n}} entreprises, sans nom de dirigeant :

{{echantillon.lignes}}

Ce que je propose : ce fichier classé, mis à jour chaque mois avec les nouvelles immatriculations, livré avec la liste des oppositions à respecter.

Limites à connaître :
{{limites}}
${FIN}`,

  'preuve-legere': `Bonjour,

Votre annonce ({{annonce.url}}) correspond à une requête que j’ai posée au registre officiel des entreprises (INSEE, base Sirene ; INPI, registre national des entreprises) le {{sonde.lu_le}}.

Total brut renvoyé par le registre, avant tout tri et tout contrôle : {{sonde.total_brut}} entreprises.
{{sonde.sous_totaux}}

Ces totaux bruts surestiment la liste utile. Pour le mesurer, j’ai lu {{echantillon.lues}} fiches sur des pages tirées au sort (pages {{echantillon.pages}}, graine {{echantillon.graine}}) : {{echantillon.ecartees}} ont été écartées par les contrôles (entreprises fermées, opposées à la prospection commerciale, en diffusion partielle ou hors de vos critères).

Échantillon de {{echantillon.n}} lignes retenues, sans nom de dirigeant :

{{echantillon.lignes}}

Ce que je propose : la liste complète, contrôlée de la même façon, avec la fiche officielle de chaque entreprise et la liste des oppositions à respecter.

Limites à connaître :
{{limites}}
${FIN}`,

  // E-mail B2B à un courtier en assurance construction (acheteur du fichier btp-creations-zone) : objet lié au métier,
  // identité de l'expéditeur, notice d'information (RGPD, art. 14), moyen simple de s'opposer, échantillon minimisé.
  'courtiers-construction': `Objet : nouvelles entreprises du bâtiment de votre département, à assurer en décennale — échantillon

Bonjour,

Je suis [NOM DU PROPRIÉTAIRE] ([STATUT ET COORDONNÉES DU PROPRIÉTAIRE]). Je vous écris parce que votre cabinet est inscrit au registre des entreprises comme courtier en assurance (code NAF 66.22Z) et que son nom évoque la construction.

Une entreprise du bâtiment doit justifier d’une assurance décennale à l’ouverture de tout chantier (C. assurances, art. L241-1) : celles qui viennent d’être immatriculées cherchent donc leur premier contrat.

Dans le département {{echantillon.departement}}, {{au_moins}}{{compte.retenues}} sociétés du bâtiment immatriculées depuis moins de {{param.creation_moins_de_mois}} mois peuvent être prospectées, d’après le registre officiel des entreprises (INSEE, base Sirene ; INPI, registre national des entreprises) lu le {{lu_le}}. {{exclusions}}

Voici un échantillon de {{echantillon.n}} lignes, sans nom de dirigeant :

{{echantillon.lignes}}

Ce que je propose : ce fichier pour votre zone, mis à jour chaque mois ou chaque semaine, avec la qualification RGE, la mention de source et de date, et la liste des oppositions à respecter. Il est vendu au forfait : aucune commission sur les contrats que vous placerez.

Limites à connaître :
{{limites}}

[PRIX À VALIDER PAR LE PROPRIÉTAIRE]

Si cela vous intéresse, une simple réponse à ce message suffit.

Bien cordialement,
[NOM DU PROPRIÉTAIRE]

—
Information sur vos données (art. 14 du RGPD) : ce message vous est adressé par [NOM DU PROPRIÉTAIRE], responsable du traitement, pour vous proposer un service lié à votre métier ; base légale : intérêt légitime (prospection entre professionnels). Données utilisées : le nom et l’adresse professionnelle de votre cabinet, issus du registre des entreprises et de [SOURCE DE L’ADRESSE, À COMPLÉTER PAR LE PROPRIÉTAIRE]. Elles sont conservées trois ans au plus sans réponse de votre part, puis supprimées. Vous pouvez y accéder, les faire rectifier ou effacer, et vous opposer à tout nouveau message : répondez « STOP » ou écrivez à [ADRESSE D’OPPOSITION DU PROPRIÉTAIRE].`,

  'kit-comeup': `Titre du service : fichier des nouvelles entreprises du bâtiment de votre département, prêt pour la prospection

Description :
Vous êtes courtier en assurance construction, fournisseur ou recruteur du bâtiment ? Je vous livre la liste des entreprises du bâtiment immatriculées récemment dans le département de votre choix, tirée du registre officiel des entreprises (INSEE, base Sirene ; INPI, registre national des entreprises).

Chaque ligne donne la raison sociale, la commune du siège, le code NAF, la date d’immatriculation, la tranche d’effectif, la qualification RGE et le lien vers la fiche officielle. Chaque livraison porte la mention de source et la date de lecture du registre.

Conformité : les entreprises qui s’opposent à la prospection commerciale et celles dont la diffusion est partielle sont exclues ; le fichier ne contient ni date de naissance ni adresse personnelle ; la liste des oppositions à respecter accompagne chaque livraison.

Avant toute commande, je vous envoie un échantillon gratuit sur votre département.

Prix : [PRIX À VALIDER PAR LE PROPRIÉTAIRE]
Vendeur : [NOM DU PROPRIÉTAIRE]`,

  'kit-malt': `Titre du profil : fichiers de prospection B2B tirés du registre officiel des entreprises, conformes au RGPD

Présentation :
Je construis des fichiers d’entreprises ciblés à partir du registre officiel (INSEE, base Sirene ; INPI, registre national des entreprises) : secteur, zone, date d’immatriculation, taille, qualification RGE. Chaque fichier est contrôlé avant livraison : entreprises fermées, opposées à la prospection commerciale ou en diffusion partielle exclues, comptes anciens signalés, aucune date de naissance ni adresse personnelle.

Spécialité : les entreprises du bâtiment nouvellement immatriculées, pour les courtiers en assurance construction.

Tarif : [PRIX À VALIDER PAR LE PROPRIÉTAIRE]
[NOM DU PROPRIÉTAIRE]`,

  'prealable-statut': `Préalable : un statut pour facturer

Pourquoi : sans statut immatriculé, un client qui dit oui ne peut pas être facturé.

Étapes, toutes faites par le propriétaire lui-même :
- choisir le statut (la micro-entreprise est la voie la plus simple pour démarrer) ;
- déclarer le début d’activité sur le guichet unique des formalités d’entreprises, opéré par l’INPI ; l’inscription est gratuite ;
- décrire une activité de vente de fichiers et de services de données, sans commission sur des contrats d’assurance ;
- garder le numéro reçu dans prive/ seulement, jamais dans le dépôt public ;
- consigner le geste « statut immatriculé ».

VELYX ne remplit et ne dépose rien au nom du propriétaire.`,

  'prealable-canal': `Préalable : choisir un canal gratuit

codeur.com sert à lire la demande seulement : y répondre est payant, donc exclu par le mandat tant que rien n’est encaissé.

Canaux possibles, au choix du propriétaire :
- e-mail direct depuis sa propre adresse, à des professionnels, sur un objet lié à leur métier, avec l’identité de l’expéditeur, une notice d’information et un moyen simple de s’opposer ;
- un service publié sur ComeUp (publication gratuite, commission sur les ventes seulement) ;
- un profil Malt (commission au paiement), surtout pour facturer un client trouvé ailleurs.

Geste attendu : déclarer le canal ouvert (« canal email ouvert », « canal comeup ouvert »…) après avoir lu ses conditions d’utilisation.`,

  'prealable-cgu': `Préalable : lire les conditions d’utilisation de codeur.com avant tout contact hors de la plateforme

Le nom d’un client peut figurer dans une annonce publique, mais le contacter hors de codeur.com peut être interdit par les conditions d’utilisation de la plateforme. Tant qu’elles ne sont pas lues et citées mot pour mot, ce contact reste interdit ; si elles l’interdisent, il l’est définitivement.

Geste attendu : lire la page des conditions d’utilisation (ou laisser VELYX la lire et en citer les passages), puis décider.`,
});

/** Nature de chaque gabarit : les contrôles B appliqués en dépendent. */
export const TYPES_GABARIT = Object.freeze({
  'liste-sur-demande': 'proposition', 'rachat-it-idf': 'proposition', 'courtier-btp-aura': 'proposition', 'preuve-legere': 'proposition',
  'courtiers-construction': 'proposition', 'kit-comeup': 'kit_canal', 'kit-malt': 'kit_canal',
  'prealable-statut': 'prealable', 'prealable-canal': 'prealable', 'prealable-cgu': 'prealable',
});
const CODES_PAR_TYPE = { proposition: null, kit_canal: ['B1', 'B2', 'B6', 'B7'], prealable: ['B1', 'B6', 'B7'] };

// ---------------------------------------------------------------------------------------------------------------------
// Notes privées du propriétaire (jamais envoyées) : repères de prix cités, obligations, ce que le texte n'affirme pas.

const SOURCE_ETUDE = 'reports/Marché fichiers prospection à signaux.md, section « Ce que cela implique pour VELYX » (recommandations déduites de constats cités, pas des faits sourcés)';
/** Repères de prix de l'étude de marché, laissés au choix du propriétaire ; jamais pré-remplis dans un texte. */
export const REPERES_PRIX = Object.freeze([
  { repere: 'Ligne générique (ComeUp, Zeliq 2026)', prix_cite: '0,15 à 0,85 € la ligne', usage: 'plancher à ne pas suivre' },
  { repere: 'Ligne « avec signal d’achat » (ComeUp 542881)', prix_cite: '199 € les 100 lignes, soit environ 2 € la ligne', usage: 'plafond observé pour une liste froide à signal' },
  { repere: 'Ticket d’entrée de la catégorie ComeUp (services 169467 et 523768)', prix_cite: 'environ 100 $ US pour 120 à 200 contacts', usage: 'prix d’un premier service sans avis' },
  { repere: 'Alertes de créations en libre-service (Societe.com)', prix_cite: '16,90 à 49,90 € HT par mois', usage: 'un abonnement doit apporter davantage : tri, conformité, livraison' },
  { repere: 'Lead décennale entrant (Leadshop, Inovlead)', prix_cite: '9 à 15 € HT, jusqu’à 110 € en exclusif', usage: 'hors de portée d’une liste froide ; accessible seulement en livrant un lead' },
].map(Object.freeze));
const tableReperes = () => ['| Repère | Prix cité | Usage |', '|---|---|---|', ...REPERES_PRIX.map((r) => `| ${r.repere} | ${r.prix_cite} | ${r.usage} |`), '', `Source : ${SOURCE_ETUDE}.`].join('\n');

export const NOTES_PROPRIETAIRE = Object.freeze({
  'courtiers-construction': `## Repères de prix (information seulement, à choisir par le propriétaire)\n\n${tableReperes()}\n\n## Avant d'envoyer\n- Remplacer chaque champ entre crochets (nom, statut et coordonnées, source de l'adresse, adresse d'opposition, prix).\n- Envoyer depuis sa propre adresse, à l'adresse professionnelle du cabinet ; un message par cabinet.\n- Obligations relevées par l'étude : notice d'information en français (art. 14 RGPD) ; canal d'opposition ouvert ; liste des oppositions transmise au client ; conservation de trois ans au plus sans contact ; vente au forfait, aucune commission sur les contrats (ORIAS, art. R511-3 C. assur., inférence) ; statut immatriculé avant la première facture.\n\n## Ce que le texte n'affirme pas\n- Qu'une entreprise récente n'est pas encore assurée.\n- Que la liste est complète quand la lecture est partielle (« au moins »).`,
  'courtier-btp-aura': `## Repères de prix (information seulement)\n\n${tableReperes()}\n\nLe client a écrit dans son annonce un prix par rendez-vous honoré ; le mandat du 15/11/2026 (ligne 17 du registre) exclut les rendez-vous et la téléprospection : seul le fichier est proposé.`,
  'rachat-it-idf': `## Repères de prix (information seulement)\n\nAucun prix de référence n'a été trouvé pour le signal de transmission (étude de marché). Repères généraux :\n\n${tableReperes()}`,
  'liste-sur-demande': `## Repères de prix (information seulement)\n\n${tableReperes()}`,
  'preuve-legere': `## Repères de prix (information seulement)\n\n${tableReperes()}`,
  'kit-comeup': `ComeUp (étude de marché) : publication gratuite, 20 % prélevés sur les ventes seulement ; jusqu'à 6 services sur un compte gratuit ; les concurrents installés affichent de 50 à 105 avis. Conditions de vente à relire avant publication.\n\n${tableReperes()}`,
  'kit-malt': 'Malt (étude de marché) : inscription gratuite, frais prélevés au paiement ; sert surtout à facturer un client trouvé ailleurs.',
  'prealable-statut': 'Étude de marché : immatriculation gratuite (formalites.entreprises.gouv.fr, INPI) ; déclaration au plus tôt un mois avant le début de l\'activité et au plus tard dans les 15 jours qui suivent (Service-public.fr F36746) ; sans immatriculation avant la première facture, amende jusqu\'à 7 500 € (justice.fr).',
  'prealable-canal': 'Registre, lignes 13 à 15 : répondre sur codeur.com coûte au moins 31,90 € HT par 30 jours ; mandat 0 € (ligne 14) ; canaux gratuits identifiés : ComeUp, Malt, e-mail direct.',
  'prealable-cgu': 'Croyance B08 : CGU de codeur.com non lues ; contact hors plateforme interdit tant qu\'elles ne sont pas lues et citées.',
});

// ---------------------------------------------------------------------------------------------------------------------
// Remplissage.

const RE_PH = /\{\{\s*([a-z_]+(?:\.[a-z0-9_]+)*)\s*\}\}/g;
const nombreFr = (v) => (Number.isInteger(v) ? v.toLocaleString('fr-FR') : v.toLocaleString('fr-FR', { maximumFractionDigits: 1 }));
const dateFr = (iso) => creerHorloge(iso).jour().split('-').reverse().join('/');
const lire = (o, chemin) => chemin.split('.').reduce((x, k) => (x !== null && typeof x === 'object' && Object.hasOwn(x, k) ? x[k] : undefined), o);
const titre = (s) => String(s).toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
  .replace(/(?<=[\s-])(De|Du|Des|La|Le|Les|Sur|Sous|En|Et|Lès|Aux?)(?=[\s-])/g, (m) => m.toLowerCase());
const URL_ANNONCE = /^https:\/\/www\.codeur\.com\/projects\/\d+(?:-[a-z0-9-]+)?$/;

/**
 * Ligne d'échantillon minimisée, ex. « S03 · Lyon (69) · NAF 43.22A · 10-19 sal. · créée en 2024 · CA 2025 publié · RGE ».
 * Ni nom (sauf avec_nom pour un nom non nominatif), ni dirigeant, ni montant.
 */
export function ligneEchantillon(m, { avec_nom = false } = {}) {
  const p = [m.alias ?? '—'];
  if (avec_nom && m.nom_affichable) p.push(m.nom_affichable);
  p.push(m.commune ? `${titre(m.commune)} (${m.departement ?? '?'})` : `département ${m.departement ?? 'inconnu'}`);
  if (m.naf) p.push(`NAF ${m.naf}`);
  p.push(m.effectif && m.effectif !== 'non renseigné' ? `${String(m.effectif).replace(/\s*salariés?$/, '')} sal.` : 'effectif inconnu');
  p.push(m.annee_creation ? `créée en ${m.annee_creation}` : 'création inconnue');
  p.push(m.ca?.statut === 'publie' ? `CA ${m.ca.annee} publié` : m.ca?.statut === 'ancien' ? `CA ancien (${m.ca.annee})` : 'CA non publié');
  p.push(...(m.signaux ?? []));
  return p.join(' · ');
}

/**
 * Remplit un gabarit. d : {compte, sonde, echantillon: {lignes: EntrepriseMinimisee[], lues, ecartees, pages, graine,
 * departement}, lecture: {complet, lu_le}, limites: string[], annonce: {url}, params: {[cle]: number},
 * sources: {compte, sonde, param, echantillon, limites}}. Chaque nombre rendu entre dans chiffres, et sa provenance
 * (d.sources) dans provenance : un bloc compte, sonde ou param utilisé sans source lève.
 * Lève sur un placeholder inconnu ou non résolu.
 * @returns {{texte: string, empreinte: string, chiffres: Object<string, number>, provenance: Object<string, string>}}
 */
export function remplir(gabarit, d = {}) {
  if (typeof gabarit !== 'string') throw new TypeError('remplir : gabarit texte attendu');
  const chiffres = {}, provenance = {}, sources = d.sources ?? {};
  let out = '', dernier = 0;
  const source = (racine) => {
    const s = sources[racine];
    if (typeof s === 'string' && s) return s;
    if (racine === 'echantillon') return `échantillon${d.echantillon?.graine ? ` (graine ${d.echantillon.graine})` : ''}`;
    if (racine === 'limites') return 'limites de la recette et aveux';
    throw new Error(`remplir : provenance manquante pour « ${racine} » (d.sources.${racine})`);
  };
  const noter = (cle, v, racine) => { chiffres[cle] = v; provenance[cle] = source(racine); };
  const noterTexte = (prefixe, texte, racine) => nombresDuTexte(texte).forEach((n, i) => noter(`${prefixe}[${i}]`, n.valeur, racine));
  const exigerLecture = (ph) => { if (!d.lecture || typeof d.lecture !== 'object') throw new Error(`remplir : {{${ph}}} exige d.lecture`); return d.lecture; };
  const nonResolu = (ph) => { throw new Error(`remplir : placeholder non résolu {{${ph}}}`); };
  const inconnu = (ph) => { throw new Error(`remplir : placeholder inconnu {{${ph}}}`); };
  const nombre = (ph, v, racine) => { if (typeof v !== 'number' || !Number.isFinite(v)) nonResolu(ph); noter(ph, v, racine); return nombreFr(v); };

  const rendre = (ph) => {
    const [racine, ...reste] = ph.split('.'), sous = reste.join('.');
    switch (racine) {
      case 'au_moins': if (sous) inconnu(ph); return exigerLecture(ph).complet === false && !/au moins\s*$/i.test(out) ? 'au moins ' : '';
      case 'lu_le': if (sous) inconnu(ph); { const l = exigerLecture(ph); if (!l.lu_le) nonResolu(ph); return dateFr(l.lu_le); }
      case 'limites': {
        if (sous) inconnu(ph);
        const l = d.limites;
        if (!Array.isArray(l)) nonResolu(ph);
        if (!l.length) return '- aucune limite consignée.';
        l.forEach((x, i) => noterTexte(`limites[${i}]`, String(x), 'limites'));
        return l.map((x) => `- ${x}`).join('\n');
      }
      case 'annonce': {
        if (sous !== 'url') inconnu(ph);
        const u = d.annonce?.url;
        if (typeof u !== 'string' || !URL_ANNONCE.test(u) || defautChaine(u)) nonResolu(ph);
        return u;
      }
      case 'compte': {
        if (!sous) inconnu(ph);
        const lecture = exigerLecture(ph), v = nombre(ph, lire(d.compte, sous), 'compte');
        return lecture.complet === false && !/au moins\s*$/i.test(out) ? `au moins ${v}` : v;
      }
      case 'exclusions': {
        // Nombre d'écartées par les contrôles, seulement s'il est connu pour cette liste (acte cible du registre).
        if (sous) inconnu(ph);
        const n = d.compte?.exclues;
        if (typeof n === 'number' && Number.isFinite(n) && n > 0) return `Les contrôles en ont écarté ${nombre('compte.exclues', n, 'compte')} autres, surtout parce qu’elles s’opposent à la prospection commerciale : les contacter vous exposerait. Aucune ne figure dans ce fichier.`;
        return 'Les entreprises qui s’opposent à la prospection commerciale et celles dont la diffusion est partielle sont exclues.';
      }
      case 'param': if (!sous) inconnu(ph); return nombre(ph, lire(d.params, sous), 'param');
      case 'sonde': {
        if (!sous) inconnu(ph);
        if (sous === 'lu_le') { const l = d.sonde?.lu_le; if (!l) nonResolu(ph); source('sonde'); return dateFr(l); }
        if (sous === 'sous_totaux') {
          const cles = Object.keys(d.sonde ?? {}).filter((k) => !['total_brut', 'lu_le', 'libelles'].includes(k));
          if (!cles.length) return '';
          return cles.map((k) => `- dont un total brut de ${nombre(`sonde.${k}`, d.sonde[k], 'sonde')} ${d.sonde.libelles?.[k] ?? `(« ${k} »)`}.`).join('\n');
        }
        return nombre(ph, lire(d.sonde, sous), 'sonde');
      }
      case 'echantillon': {
        const e = d.echantillon;
        if (!e) nonResolu(ph);
        switch (sous) {
          case 'lignes': {
            if (!Array.isArray(e.lignes) || !e.lignes.length) nonResolu(ph);
            const lignes = e.lignes.map((m) => ligneEchantillon(m));
            lignes.forEach((l, i) => noterTexte(`echantillon.lignes[${i}]`, l, 'echantillon'));
            return lignes.map((l) => `- ${l}`).join('\n');
          }
          case 'n': if (!Array.isArray(e.lignes)) nonResolu(ph); return nombre(ph, e.lignes.length, 'echantillon');
          case 'lues': case 'ecartees': return nombre(ph, e[sous], 'echantillon');
          case 'pages': {
            if (!Array.isArray(e.pages) || !e.pages.length || !e.pages.every(Number.isInteger)) nonResolu(ph);
            e.pages.forEach((p, i) => noter(`echantillon.pages[${i}]`, p, 'echantillon'));
            return e.pages.map(nombreFr).join(', ');
          }
          case 'graine': {
            if (typeof e.graine !== 'string' || !e.graine || defautChaine(e.graine)) nonResolu(ph);
            noterTexte('echantillon.graine', e.graine, 'echantillon');
            return e.graine;
          }
          case 'departement': {
            if (typeof e.departement !== 'string' || !/^(?:\d{2}|2A|2B|97\d)$/.test(e.departement)) nonResolu(ph);
            if (/^\d+$/.test(e.departement)) noter(ph, Number(e.departement), 'echantillon');
            return e.departement;
          }
          default: return inconnu(ph);
        }
      }
      default: return inconnu(ph);
    }
  };
  for (const m of gabarit.matchAll(RE_PH)) {
    out += gabarit.slice(dernier, m.index);
    out += rendre(m[1]);
    dernier = m.index + m[0].length;
  }
  out += gabarit.slice(dernier);
  const reste = gabarit.replace(RE_PH, '');
  if (/\{\{|\}\}/.test(reste)) throw new Error('remplir : placeholder mal formé (accolades orphelines)');
  return { texte: out, empreinte: empreinte(out), chiffres, provenance };
}

const RACINES = new Set(['compte', 'sonde', 'echantillon', 'au_moins', 'lu_le', 'limites', 'annonce', 'param']);

/**
 * Gabarit écrit par le LLM (prive/cycles/<id>/juge/<J-id>.json) : aucun chiffre hors placeholders, sauf dans une
 * citation « … » présente mot pour mot dans la description de l'annonce ; placeholders obligatoires présents ;
 * placeholders connus ; ni code ni URL hors www.codeur.com ; ni montant ni promesse ; 4 000 caractères au plus.
 */
export function validerGabaritLLM(texte, { annonce_description = null } = {}) {
  const erreurs = [];
  if (typeof texte !== 'string' || !texte.trim()) return { ok: false, erreurs: ['gabarit vide'] };
  if ([...texte].length > 4000) erreurs.push(`gabarit de ${[...texte].length} caractères (4 000 au plus)`);
  const d = defautChaine(texte); if (d) erreurs.push(`gabarit ${d}`);
  for (const m of texte.matchAll(RE_PH)) if (!RACINES.has(m[1].split('.')[0])) erreurs.push(`placeholder inconnu {{${m[1]}}}`);
  const sans = texte.replace(RE_PH, ' ');
  if (/\{\{|\}\}/.test(sans)) erreurs.push('placeholder mal formé');
  for (const p of PLACEHOLDERS_OBLIGATOIRES) if (!texte.includes(p)) erreurs.push(`placeholder obligatoire absent : ${p}`);
  const libre = horsCitations(sans, annonce_description);
  if (/\d/.test(libre)) erreurs.push('chiffre hors placeholder et hors citation vérifiée');
  if (contientMontant(libre)) erreurs.push('montant ou devise hors citation vérifiée');
  const p = promesses(sans); if (p.length) erreurs.push(`vocabulaire de promesse : ${p.join(', ')}`);
  return { ok: erreurs.length === 0, erreurs };
}

/**
 * Remplit un gabarit et le contrôle (B1 à B8 et L1 pour une proposition ; B1, B2, B6, B7 pour un kit ; B1, B6, B7 pour un
 * préalable). Les jetons du gabarit statique sont ignorés par l'antifuite (texte écrit et relu par un humain).
 * ctx : {horloge, dict, annonce: {description, statut, lu_le}|null}.
 * @returns {{id, type, texte, empreinte, chiffres, provenance, controles: ResultatControle[], ok: boolean, notes: string}}
 */
export function preparer(id, d = {}, { horloge = creerHorloge(), dict = null, annonce = null } = {}) {
  const g = GABARITS[id];
  if (!g) throw new Error(`gabarit inconnu : ${id}`);
  const r = remplir(g, d), type = TYPES_GABARIT[id];
  // L'antifuite ignore les mots des textes publics et relus (gabarit statique, limites de la recette) et ceux des champs
  // que minimiser a déjà vérifiés (commune du siège d'une société, masquée pour une EI ou un nom nominatif ; libellés
  // de signaux, écrits par les primitives) : une commune homonyme d'un dirigeant n'est pas une fuite de son nom.
  const lignes = Array.isArray(d.echantillon?.lignes) ? d.echantillon.lignes : [];
  const publics = [g.replace(RE_PH, ' '), ...(d.limites ?? []), ...lignes.flatMap((m) => [m.commune ?? '', ...(m.signaux ?? [])])];
  const controles = controlerBrouillon(r.texte, {
    chiffres: r.chiffres, annonce, lecture: d.lecture ?? {}, horloge, dict, echantillon: d.echantillon?.lignes ?? null,
    codes: CODES_PAR_TYPE[type], ignorer: new Set(publics.flatMap(jetonsNom)), sans_donnees: type !== 'proposition',
  });
  return { id, type, ...r, controles, ok: !controles.some((c) => c.gravite === 'bloquant' && !c.ok), notes: NOTES_PROPRIETAIRE[id] ?? '' };
}

/** Échantillon minimisé : n premières fiches retenues (déjà classées), alias S01, S02… */
export function echantillonMinimise(fiches, { horloge = creerHorloge(), dict = null, n = 10 } = {}) {
  return fiches.slice(0, n).map((e, i) => minimiser(e, horloge, dict, { alias: `S${String(i + 1).padStart(2, '0')}` }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Pari : il naît avec la revue, critère de succès et critère d'arrêt écrits avant l'envoi.

/** Pari lié à une revue {id: 'R-…', canal, annonce?}. */
export function pari(revue) {
  if (!revue || typeof revue.id !== 'string' || !/^R-[\w-]+$/.test(revue.id)) throw new Error('pari : revue {id: « R-… »} attendue');
  const canal = revue.canal ?? 'email';
  return {
    id: `P-${revue.id}`,
    hypothese: revue.annonce
      ? 'Une réponse accompagnée d’un échantillon réel construit pour la demande obtient une issue positive en 7 jours au plus.'
      : 'Un message accompagné d’un échantillon réel construit pour le destinataire obtient une issue positive en 7 jours au plus.',
    croyances: ['B06'],
    critere_succes: `issue ∈ {${ISSUES_POSITIVES.join(', ')}} au plus 7 j après l’envoi`,
    critere_arret: 'après 7 j sans issue positive, demander l’issue au propriétaire ; le pari n’est perdu que sur son acte',
    echeance: 'envoi + 7 jours',
    geste_proprietaire: `relire prive/revues/${revue.id}.md, compléter les champs entre crochets (prix, nom, adresse d’opposition), envoyer depuis son propre compte (${canal}), puis consigner l’envoi : velyx envoye P-${revue.id} --canal ${canal}`,
    canal, annonce: revue.annonce ?? null,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Compatibilité v1 : bin/velyx.js appelle MODELES[id](liste, compte) et écrit le texte dans prive/.
// Échec fermé : une liste sans champ opposition (liste v1) ne produit aucun brouillon. Un texte qui échoue à un
// contrôle bloquant est marqué « BLOQUÉ » en tête, avec les motifs.

/**
 * Brouillon v1 (une liste contrôlée) sous forme structurée, pour `velyx brouillon` : texte soumis (exactement celui que
 * les contrôles ont vu), notes du propriétaire à part, contrôles, SIREN de l'échantillon (index privé de la revue).
 * options : {horloge, oppositions: Set<siren>} (oppositions reçues, exclues par G4 en plus de celles du registre).
 * @returns {{texte, notes, controles, ok, empreinte, sirens: string[], bloquants: ResultatControle[]}}
 */
export function preparerV1(id, liste, compteV1, { horloge = creerHorloge(), oppositions } = {}) {
  if (!IDS_V1.includes(id)) parPreparer(id)();
  const cibles = liste?.cibles ?? [];
  const sansOpposition = cibles.filter((e) => typeof e?.opposition !== 'boolean').length;
  if (sansOpposition) throw new Error(`brouillon « ${id} » refusé : ${sansOpposition} fiche(s) sans champ opposition (liste v1, oppositions non exclues) ; relancer « velyx cibler ${id} »`);
  const recette = RECETTES[id];
  const { gardees } = appliquer({ garder: () => true, signaux: (e) => e.signaux ?? [], complet: (e) => e.complet }, cibles,
    { horloge, ...(oppositions instanceof Set ? { oppositions } : {}) });
  const dict = jetonsDe(cibles);
  const zeros = Object.fromEntries((recette?.codes_signaux ?? []).map((c) => [c, 0]));
  const lignes = echantillonMinimise(gardees, { horloge, dict });
  const p = preparer(recette?.gabarit ?? id, {
    compte: { ...compteV1, par_signal: { ...zeros, ...(compteV1?.par_signal ?? {}) } },
    params: recette ? chiffresRecette(recette) : {},
    lecture: { complet: liste.complet !== false, lu_le: liste.lu_le },
    echantillon: { lignes },
    limites: recette?.limites ?? [],
    sources: { compte: `liste privée ${id} du ${String(liste.lu_le).slice(0, 10)} (appliquer, contrôles M4)`, param: `etat/recettes/${id}.json`, echantillon: 'tête de la liste classée' },
  }, { horloge, dict });
  const bloquants = p.controles.filter((c) => c.gravite === 'bloquant' && !c.ok);
  return { texte: p.texte, notes: p.notes, controles: p.controles, ok: bloquants.length === 0, empreinte: p.empreinte, bloquants,
    sirens: gardees.slice(0, lignes.length).map((e) => String(e.siren)).filter((x) => /^\d{9}$/.test(x)) };
}

// Forme texte de la v1 (MODELES), gardée pour la compatibilité : `velyx brouillon` passe par preparerV1, ne met rien en
// revue quand un contrôle bloquant échoue et ne mêle jamais les notes au texte soumis.
function modeleV1(id) {
  return (liste, compteV1) => {
    const p = preparerV1(id, liste, compteV1);
    const entete = p.bloquants.length ? `<!-- BLOQUÉ, ne pas envoyer en l’état : ${p.bloquants.map((c) => `${c.code} (${c.motif})`).join(' ; ')} -->\n\n` : '';
    return `${entete}${p.texte}\n\n<!-- Empreinte ${p.empreinte}. NOTES POUR LE PROPRIÉTAIRE (ne pas envoyer)\n\n${p.notes}\n-->`;
  };
}

// Le brouillon des courtiers croise deux listes (destinataires : courtiers-construction ; échantillon et comptes :
// btp-creations-zone du département du courtier) : il ne passe pas par le chemin v1 à une seule liste.
const IDS_V1 = Object.freeze(['rachat-it-idf', 'courtier-btp-aura']);
function parPreparer(id) { return () => {
  throw new Error(`brouillon « ${id} » : deux listes croisées, pas le chemin v1 à une liste ; « velyx brouillon courtiers-construction [--departement <dep>] » ou l'action rediger_brouillon du cycle (cycle.brouillonCourtiers)`);
}; }

/** Compatibilité v1 : id de recette → (liste, compte) → texte. */
export const MODELES = Object.freeze({
  'rachat-it-idf': modeleV1('rachat-it-idf'), 'courtier-btp-aura': modeleV1('courtier-btp-aura'),
  'btp-creations-zone': parPreparer('btp-creations-zone'), 'courtiers-construction': parPreparer('courtiers-construction'),
});
