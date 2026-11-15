# Vendeurs de listes d'entreprises / données B2B en France et prix affichés (relevé du 15/11/2026)

> **Méthode et limites (à lire d'abord).** Recherche faite le **15/11/2026**. La récupération directe des pages a été **bloquée par la politique réseau** de cet environnement : `www.pappers.fr` et `www.societe.com` ne se résolvent pas (« host outside the session's allowed network domains »). Comme deux domaines ont échoué, je n'ai pas tenté d'autres récupérations. **Tous les faits ci-dessous viennent donc des extraits et résumés renvoyés par WebSearch**, pas d'une lecture complète des pages. Chaque URL citée est celle que la recherche a renvoyée. Sauf mention contraire, la date de publication de la page est inconnue : « vu le 15/11/2026 » veut dire « visible dans les résultats de recherche ce jour-là ». Les prix issus de sites tiers (comparatifs, blogs) sont marqués **[secondaire]**. Ceux que rien ne recoupe sont marqués **non vérifié**. Pour lever ces réserves, il faut autoriser `pappers.fr`, `societe.com`, `societeinfo.com`, `infogreffe.fr`, `data.gouv.fr` et `recherche-entreprises.api.gouv.fr` dans les réglages réseau de la session, puis relire les pages tarifs.

## Q1 — Qui vend des listes d'entreprises filtrables par signaux publics en France ?

### Takeaway
Le marché se répartit en quatre familles :
1. **Plateformes de données légales en libre-service** (Pappers, Societe.com, Societeinfo, Infogreffe, Datapult) : elles vendent des exports ou des crédits à partir de SIRENE, du RNE et du BODACC.
2. **Éditeurs « risque / marketing » sur devis** (Ellisphere, Altares/D&B, Manageo, Corporama, Nomination).
3. **Outils d'enrichissement de contacts** (Kaspr, Lusha, Pharow) : ils vendent l'email et le téléphone, pas le signal juridique.
4. **Vendeurs de fichiers à la ligne** (agences, CCI, freelances).

En dessous de tout cela, les sources publiques gratuites (SIRENE, API Recherche d'entreprises, BODACC, Annuaire des Entreprises) fournissent déjà la donnée brute.

### Cited Findings

**Plateformes en libre-service (données légales)**
- **Pappers** : exports Excel/CSV des résultats de recherche « en un clic », plus des **exports sur-mesure** construits par l'équipe de data analysts. Les **10 premiers résultats sont gratuits** pour valider le format. Des filtres absents de la recherche avancée peuvent être ajoutés, et plusieurs codes NAF ou départements combinés — [pappers.fr/exports](https://www.pappers.fr/exports) ; [pappers.fr/faq](https://www.pappers.fr/faq) (extraits de recherche)
- Pappers annonce **plus de 68 données par ligne** exportée (SIREN, adresse, chiffre d'affaires, etc.), dont la **date de création**, la **présence d'une procédure collective**, ainsi que le **nom et la date de naissance du dirigeant** — [pappers.fr/exports](https://www.pappers.fr/exports) (extrait)
- Pappers peut enrichir une liste de SIREN (dénomination, forme juridique, « Nom / Prénom et âge des dirigeants ») et fournir « sur demande » **téléphones et e-mails** — [pappers.fr/exports](https://www.pappers.fr/exports) (extrait de recherche)
- Pappers vend aussi une **API** ([pappers.fr/api](https://www.pappers.fr/api)), une offre de **surveillance/alertes** ([pappers.fr/surveillance](https://www.pappers.fr/surveillance)) et un **serveur MCP** « Connectez votre IA aux données légales françaises » ([pappers.fr/mcp](https://www.pappers.fr/mcp)) (extraits)
- **Societe.com** : page « export » qui annonce l'identité de **5,8 M de dirigeants** en France « avec leurs emails et téléphones », des **listes sur mesure** et des intégrations no-code (Zapier, Make.com, Salesforce, HubSpot). Un **devis sur-mesure** est proposé pour un secteur de plus de 2 000 sociétés — [societe.com/solutions/export](https://www.societe.com/solutions/export) ; [societe.com/solutions/prospection](https://www.societe.com/solutions/prospection) (extraits)
- **Societeinfo** (société distincte de Societe.com) : moteur de recherche B2B vendu par abonnement ou en pay-as-you-go à crédits, avec API et export — [societeinfo.com/tarifs](https://societeinfo.com/tarifs) (extrait). Un comparatif lui prête **plus de 10 M d'entreprises françaises** [secondaire] — [salesdorado.com](https://salesdorado.com/?p=65993)
- **Infogreffe** : vend des **« listes multicritères » d'entreprises**, dont les immatriculations au RCS et les procédures collectives (RJ/LJ), à l'unité dans le cadre d'un abonnement — [infogreffe.fr/tarifs-abonnement](https://www.infogreffe.fr/tarifs-abonnement) (extrait)
- **Datapult** : base B2B française d'environ **4,7 M d'entreprises** (micro-entrepreneurs et artisans compris), vendue en **pay-as-you-go sans engagement** et « mise à jour quotidiennement ». Elle est décrite comme une base de données, pas comme un outil de prospection [secondaire] — [salesdorado.com](https://salesdorado.com/?p=65993) ; [foxeet.fr](https://foxeet.fr/contenu/datapult-prospection-b2b-enrichissement-france) ; [siecledigital.fr (07/2025)](https://siecledigital.fr/2025/07/18/comment-datapult-transforme-la-data-b2b-francaise-avec-son-algorithme-intelligent/)

**Éditeurs « risque / marketing » (sur devis)**
- **Ellisphere** : offre de génération de leads **TARGET**, bâtie sur une base enrichie issue de la fusion des bases Ellisphere et **Sparklane**. Le ciblage Orbis passe par des webservices « sur devis ». Le connecteur CRM (Sellsy) demande une offre TARGET, PREDICT ou SHARE — [ellisphere.com (fiche Orbis)](https://www.ellisphere.com/uploads/landing_pages/TutosEllipro/fiches/Fiche%20pratique%20-%20Orbis.pdf) ; [go.sellsy.com](https://go.sellsy.com/applications/ellisphere) ; [ellisphere.com/en/ciblage-b2b…](https://www.ellisphere.com/en/ciblage-b2b-ameliorez-votre-generation-de-leads-en-2025/)
- **Altares (D&B)** : sa page Sales & Marketing propose de « créer, enrichir, cibler et exporter vos fichiers BtoB », et renvoie vers un conseiller commercial, sans prix — [altares.com/en/sales-marketing](https://www.altares.com/en/sales-marketing/)
- **Manageo** : outil **mList** pour créer des fichiers de prospection ciblés (TPE, PME, grands comptes) [secondaire]. Un concurrent (Zeliq) affirme que Manageo vend des fichiers « statiques » ; c'est un argument marketing de concurrent — [lafabriquedunet.fr](https://www.lafabriquedunet.fr/achat-de-fichier-de-prospection-email-comparatif-mises-en-garde/) ; [zeliq.com](https://www.zeliq.com/fr/alternatives/zeliq-vs-manageo)
- **Nomination** : base de **décideurs** (par fonction, secteur, entreprise, zone) couvrant « les décideurs clés des 100 000 premières entreprises françaises ». Accès par abonnement à crédits (consultation, export, **location d'adresses**). Selon les CGV, 20 % du prix couvre forfaitairement des « prestations d'aide à la prise de contact » — [nomination.fr CGV](https://nomination.fr/nomination-conditions-generales) ; [appvizer.fr](https://www.appvizer.fr/marketing/generation-de-leads/nomination) ; [lafabriquedunet.fr](https://www.lafabriquedunet.fr/logiciel/nomination)
- **Corporama** : logiciel de génération de leads par abonnement, avec essai gratuit d'environ 2 semaines [secondaire] — [logiciels.pro](https://www.logiciels.pro/corporama/)

**Outils d'enrichissement de contacts (email et téléphone, pas de signal juridique)**
- **Kaspr** et **Lusha** : tarification par crédits ou par utilisateur pour révéler emails et téléphones [secondaire] — [emelia.io/fr/hub/kaspr-prix](https://emelia.io/fr/hub/kaspr-prix) ; [emelia.io/fr/hub/lusha-prix](https://emelia.io/fr/hub/lusha-prix) ; [overloop.com](https://overloop.com/blog/kaspr-vs-lusha)
- **Pharow** : outil français qui fournit « des données et des signaux d'affaires » pour la prospection, avec essai gratuit de 15 jours [secondaire] — [bouncewatch.com](https://bouncewatch.com/company/pharow) ; [derrick-app.com](https://derrick-app.com/fr/tools/pharow-pricing)

**Vendeurs de fichiers à la ligne (agences, CCI, freelances)**
- **CCI Paris Île-de-France** vend des fichiers d'entreprises. Les prix « varient en fonction des modes de tarification (coût au fichier, coût au contact ou abonnement) » — [entreprises.cci-paris-idf.fr/web/fichiers](https://entreprises.cci-paris-idf.fr/web/fichiers)
- Le réseau CCI publie aussi une page « Produits et tarifs » pour l'Annuaire des Entreprises de France (AEF). Contenu non lu — [aef.cci.fr/statiques/produits-tarifs](https://www.aef.cci.fr/statiques/produits-tarifs)
- Des freelances (Comeup) vendent des fichiers B2B sur mesure ou en volume, par exemple « 50 000 contacts d'entreprises françaises » — [comeup.com](https://comeup.com/fr/service/518088/vous-fournir-50-000-contacts-d-entreprises-francaises-pour-votre-prospection-b2b) ; [comeup.com](https://comeup.com/fr/service/535846/creer-un-fichier-de-prospects-complet-b2b-pour-votre-entreprise)
- Il existe de nombreux **scrapers Apify** de SIRENE, Pappers, BODACC et Annuaire des Entreprises : France Company Search, BODACC Alerts « New Companies & Insolvency », etc. — [apify.com/gazidev/france-bodacc-alerts](https://apify.com/gazidev/france-bodacc-alerts.md) ; [apify.com/dltik/bodacc-fr-scraper](https://apify.com/dltik/bodacc-fr-scraper?fpr=ewv9tm) ; [apify.com/parseforge/france-annuaire-entreprises-scraper](https://apify.com/parseforge/france-annuaire-entreprises-scraper)

### Inferences
- Les acteurs qui vendent vraiment des **listes déclenchées par un événement légal** (création, procédure collective, changement de dirigeant) sont surtout Pappers, Societe.com, Infogreffe et Societeinfo. Ellisphere, Altares et Manageo le font sur devis. Kaspr et Lusha vendent la couche contact (email, téléphone), pas le déclencheur. Pharow se présente comme un outil « à signaux », mais je n'ai pas pu vérifier la liste de ses signaux.
- Les scrapers Apify montrent que la donnée brute est déjà marchandisée à bas coût par des développeurs. La différenciation ne peut donc pas tenir à l'accès à la donnée.

### Gaps
- **Datapult** : aucune grille tarifaire officielle trouvée.
- **Manageo, Corporama, Nomination** : aucune grille officielle lue.
- **Kompass, Verif.com, Bilansgratuits, Doctrine/Legalstart Pro, D&B Hoovers** : non couverts, faute de budget de recherche.
- Les agences françaises qui vendent un **fichier mensuel des créations d'entreprises** au prix par ligne n'ont pas été identifiées. Les résultats ne remontaient que des acteurs suisses (Moneyhouse, Business-monitor) ou des freelances.

## Q2 — Prix publiés (abonnement, prix au contact ou à l'export, limites gratuites) et date

### Takeaway
Les seuls prix officiels lisibles dans les extraits sont ceux de **Societe.com** (16,90 à 49,90 € HT/mois), d'**Infogreffe** (abonnement de 85 € HT/an, puis environ 0,26 € HT par entrée de liste RCS et 1,30 € HT par entrée de liste RJ/LJ, unité à confirmer) et de **Societeinfo** (1 crédit par ligne exportée, plans d'environ 39 à 99 €/mois, grille ambiguë). **La grille de Pappers n'est pas lisible** : la page affiche des variables de gabarit non rendues. Les autres acteurs sont sur devis ou n'ont que des prix tiers.

### Cited Findings

**Tableau récapitulatif (vu le 15/11/2026 via extraits de recherche)**

| Acteur | Prix affiché | Ce qui est inclus | Gratuit | Statut / source |
|---|---|---|---|---|
| **Societe.com Plus** | 19,90 € HT/mois sans engagement ; 16,90 € HT/mois avec 12 mois | 500 crédits API/mois. Surveillance : 2 000 entreprises selon un extrait, chiffre en conflit (voir ci-dessous) | — | Officiel (extrait) — [solutions/surveillance](https://www.societe.com/solutions/surveillance) ; [solutions/api](https://www.societe.com/solutions/api) ; [solutions/enrichissement](https://www.societe.com/solutions/enrichissement) |
| **Societe.com Pro** | **49,90 € HT/mois** sans engagement ; **39,90 € HT/mois** avec 12 mois | **2 000 entreprises ou dirigeants surveillés** avec alertes personnalisables ; **2 500 crédits API/mois** | — | Officiel (extrait) — [solutions/prospection](https://www.societe.com/solutions/prospection) ; [offres.html](https://www.societe.com/offres.html) ; [solutions/api](https://www.societe.com/solutions/api) |
| **Infogreffe** | Abonnement **85 € HT/an (102 € TTC)** pour le 1er utilisateur, **+42,50 € HT (51 € TTC)** par utilisateur supplémentaire (5 maximum). Consommations mensuelles facturées en plus | Listes multicritères : immatriculations RCS **≈0,26 € HT (0,31 € TTC)** ; listes procédures collectives RJ/LJ **1,30 € HT (1,56 € TTC)**. Unité (par entrée ou par liste) **non vérifiée** | Entreprises et fonds de commerce **à céder** consultables gratuitement | Officiel (extrait). Tarifs réglementés fixés par l'arrêté du 26/02/2026, page mise à jour au 01/03/2026 — [infogreffe.fr/tarifs-abonnement](https://www.infogreffe.fr/tarifs-abonnement) ; [infogreffe.fr/tarifs](https://infogreffe.fr/tarifs) |
| **Pappers (exports)** | Grille existante mais **illisible** (« prix \| number_format » non rendu) | Plus de 68 colonnes par ligne ; exports sur-mesure | 10 premières lignes gratuites | Officiel, sans prix — [pappers.fr/exports](https://www.pappers.fr/exports). Prix tiers : « 200 € pour 1 000 lignes » **non vérifié** [secondaire] — [skillco.fr](https://skillco.fr/app/pappers) |
| **Pappers (API)** | Abonnement mensuel, annuel (-20 %) ou pay-as-you-go ; **montants illisibles** | Consommation : fiche entreprise 1 crédit ; recherche 0,1 crédit par résultat ; document PDF/XLSX 3 crédits ; comptes JSON 2 crédits ; scoring 30 crédits | **100 crédits offerts** à la création d'un compte API avec un email professionnel | Officiel (extrait) — [pappers.fr/api](https://www.pappers.fr/api). Prix tiers **non vérifiés** [secondaire] : 1 000 crédits = 10 €, 5 000 = 45 €, 10 000 = 80 € (comparatif sans date fiable) ; « à partir de 30 €/mois pour 500 crédits » ([hayot-expertise.fr](https://hayot-expertise.fr/en/blog/pappers-company-data-tool-review)) ; « 29–199 €/mois » ([saveursdupaysdesaintmalo.fr](https://www.saveursdupaysdesaintmalo.fr/decouvrir-comment-pappers-facilite-lacces-aux-informations-officielles-des-entreprises/)) ; « 20 €/mois pour 500 fiches » (article de plus de 2 ans, probablement périmé) |
| **Pappers (surveillance)** | Montant non trouvé sur la page officielle | Alertes email : changement de dirigeant, nouveau dépôt de comptes, procédure collective, modification de capital ; webhooks Zapier/Make | Surveillance gratuite jusqu'à **10 entreprises** [secondaire, récent] ; une source plus ancienne cite **20 €/mois pour 300 entreprises** (conflit) | [pappers.fr/surveillance](https://www.pappers.fr/surveillance) ; [dixmilleheures.fr](https://www.dixmilleheures.fr/avis/pappers) ; [opal-net.fr](https://opal-net.fr/pappers/) ; [nexiagence.fr](https://nexiagence.fr/academy/apis/pappers) |
| **Societeinfo** | Selon un extrait : Starter **39 €/mois**, Pro **99 €/mois** (base 12 000 crédits/an). Selon un autre : prix barré 99 € puis **79 €/mois** ; plans « Starter » de 3 600 crédits/an et « 6K » de 72 000 crédits/an | **Export d'une ligne entreprise ou d'un contact = 1 crédit** ; document officiel = 5 crédits ; recherche par mot-clé gratuite ; enrichissement = 1 crédit par ligne ; quota de surveillance par palier (palier 3K = 3 000 entreprises) | Recherche par mot-clé gratuite | Officiel mais **grille contradictoire** : un comparatif note lui aussi « deux grilles de prix contradictoires » — [societeinfo.com/tarifs](https://societeinfo.com/tarifs) ; [salesdorado.com](https://salesdorado.com/fichiers-prospection/comparatif-bases-de-donnees-b2b/) |
| **Kaspr** | **45 €/utilisateur/mois** en annuel, **59 €** sans engagement ; Business **79 €** (annuel) / **99 €** (mensuel). Autre source : **65 $** Starter, **99 $** Business | Crédits email et téléphone | Gratuit : 15 crédits email B2B, 5 crédits téléphone, 5 emails directs par mois | [secondaire], sources datées de juin à octobre 2026, divergentes — [emelia.io](https://emelia.io/fr/hub/kaspr-prix) ; [joinsecret.com](https://www.joinsecret.com/fr/kaspr/pricing) |
| **Lusha** | Starter **49,90 $/mois** (400 crédits, 1 siège) ; Pro à partir de **69,90 $** (600 crédits, 2 sièges), environ 227,40 $ pour 2 000 crédits ; Premium **399,90 $** (3 400 crédits) | Email = 1 crédit ; téléphone = 5 crédits | **40 crédits/mois** (une autre source dit 70, conflit) | [secondaire] — [emelia.io](https://emelia.io/fr/hub/lusha-prix) ; [overloop.com](https://overloop.com/blog/lusha-pricing) ; [derrick-app.com](https://derrick-app.com/fr/tools/lusha-pricing) |
| **Pharow** | Montants non trouvés. Refonte 2026 : Starter → Essential, Pro → Advanced, palier Business supprimé. Un comparatif plus ancien indiquait « à partir de 49 €/mois » | Crédits | Essai **100 crédits + 15 jours** (contre 25 crédits et 14 jours auparavant) | [secondaire] — [derrick-app.com](https://derrick-app.com/fr/tools/pharow-pricing) ; [salesdorado.com](https://salesdorado.com/fichiers-prospection/comparatif-bases-de-donnees-b2b/) |
| **Corporama** | « à partir de **996 €/mois/utilisateur** » (« 1 Compte Sales ») ; remises en engagement annuel | — | Essai d'environ 2 semaines | [secondaire], **non vérifié**, chiffre atypique (peut-être un prix annuel mal libellé) — [logiciels.pro](https://www.logiciels.pro/corporama/) |
| **Nomination** | Pas de grille publique ; « prix élevé, pas de version gratuite » | Crédits de consultation, d'export et de location d'adresses | Aucun | [nomination.fr CGV](https://nomination.fr/nomination-conditions-generales) ; [lafabriquedunet.fr](https://www.lafabriquedunet.fr/logiciel/nomination) |
| **Ellisphere / Altares / Manageo** | **Sur devis** | — | — | [ellisphere.com](https://www.ellisphere.com/uploads/landing_pages/TutosEllipro/fiches/Fiche%20pratique%20-%20Orbis.pdf) ; [altares.com](https://www.altares.com/en/sales-marketing/) |
| **Datapult** | Pay-as-you-go. « Sur les ciblages larges, les fichiers peuvent coûter plusieurs milliers d'euros » | — | — | [secondaire] — [salesdorado.com](https://salesdorado.com/?p=65993) |

**Conflits et précisions sur Societe.com**
- Un extrait attribue au plan Pro « **500 entreprises surveillées et 500 crédits API/mois** ». D'autres extraits des pages officielles (prospection, API) indiquent **2 000 surveillés et 2 500 crédits API**, et la page API précise « offres PLUS ou PRO : 500 et 2500 crédits d'API par mois ». Le chiffre 500 semble donc correspondre au plan **Plus**, mais c'est **non vérifié** — [societe.com/solutions/api](https://www.societe.com/solutions/api) ; [societe.com/solutions/prospection](https://www.societe.com/solutions/prospection)
- Le plan à 19,90 € HT est appelé « Plus » sur la page surveillance et décrit comme « plan d'entrée » sur la page enrichissement — [societe.com/solutions/surveillance](https://www.societe.com/solutions/surveillance) ; [societe.com/solutions/enrichissement](https://www.societe.com/solutions/enrichissement)
- Un article de dotmarket d'environ 818 jours (donc de 2024) donnait « 0 à 49,91 € HT/mois ». Il est périmé — [dotmarket.eu](https://www.dotmarket.eu/blog/utiliser-societe-com-pour-rechercher-analyser-entreprise-a-racheter)

**Repères du marché « fichier à la ligne » [secondaire]**
- Fichier B2B sur mesure : environ **0,30 à 0,45 € par contact qualifié**. Fichiers packagés : **139 à 499 €** pour 100 000 à 1,5 M d'adresses — [salesdorado.com](https://salesdorado.com/fichiers-prospection/achat-location-fichier-cout/) ; [lafabriquedunet.fr](https://www.lafabriquedunet.fr/achat-base-donnees/)
- Contact acheté avec téléphone et email : **0,09 à 0,15 € par contact** — [lafabriquedunet.fr](https://www.lafabriquedunet.fr/achat-de-fichier-de-prospection-email-comparatif-mises-en-garde/)
- Fichiers achetés : environ **0,15 à 0,30 € par lead** — [salesdorado.com](https://salesdorado.com/fichiers-prospection/comparatif-bases-de-donnees-b2b/)
- Les fournisseurs sont « généralement assez opaques sur les prix », et « plus les critères de ciblage sont fins, plus le coût est élevé » — [salesdorado.com](https://salesdorado.com/fichiers-prospection/achat-location-fichier-cout/)
- Freelances : à partir de **17,06 $US pour 50 prospects** (Comeup) — [comeup.com](https://comeup.com/fr/service/535846/creer-un-fichier-de-prospects-complet-b2b-pour-votre-entreprise)
- Repère hors France, pour comparaison seulement : Business-monitor (Suisse) vend **0,90 CHF par entreprise** pour les 500 premières, puis un prix dégressif — [business-monitor.ch](https://business-monitor.ch/de/fichier-prospection)

### Inferences
- **Ancrage de prix pour un acheteur TPE/PME** : un abonnement « veille + export » coûte de 16,90 à 49,90 € HT/mois (Societe.com). La donnée légale à l'unité coûte environ 0,26 € HT par entrée chez Infogreffe, si l'unité est bien la ligne, ou 1 crédit par ligne chez Societeinfo. Le contact enrichi coûte de 0,09 à 0,45 € par contact sur le marché du fichier, et de 45 à 99 € par utilisateur et par mois chez Kaspr.
- Une offre qui vend une **liste « brute » de signaux** (créations, BODACC) entre en concurrence avec ces prix bas et avec le gratuit (voir Q4). Un prix plus élevé ne se justifie que par une **couche de qualification** : contact vérifié, scoring combiné de signaux, livraison récurrente et prête à l'emploi.
- Pappers est l'acteur le plus proche d'une offre « liste à signaux », mais sa grille n'a pas pu être lue. C'est le premier point à vérifier en direct.

### Gaps
- **Pappers** : prix des exports standard par tranche de lignes, prix des abonnements API, prix de la surveillance payante. Les pages affichent des variables de gabarit non rendues dans les extraits, et la récupération directe est bloquée.
- **Infogreffe** : l'unité de facturation des « listes multicritères » (par entrée ou par liste) reste à confirmer.
- **Societeinfo** : correspondance exacte prix ↔ plan ↔ crédits.
- **Kaspr et Lusha** : pages officielles non lues, prix venant uniquement de comparatifs tiers et divergents.
- **Pharow, Datapult, Manageo, Nomination, Ellisphere, Altares** : aucun montant officiel trouvé.

## Q3 — Quels acteurs filtrent ou alertent sur : créations récentes, âge du dirigeant, changement de dirigeant, RGE, événements BODACC ? Lesquels ne le font pas ?

### Takeaway
- **Créations récentes** : signal le mieux couvert (Societe.com avec alertes quotidiennes, Infogreffe avec listes d'immatriculations, Pappers avec filtre par date de création, outil gratuit Export Sirene).
- **Événements BODACC / procédures collectives** : couverts par Pappers (alertes), Infogreffe (listes RJ/LJ) et l'API BODACC gratuite.
- **Âge du dirigeant** : je n'ai trouvé **aucun filtre payant documenté**. Pappers exporte la date de naissance, et le filtre `date_naissance_personne_min/max` existe gratuitement dans l'API Recherche d'entreprises.
- **RGE** : filtre gratuit (`est_rge`) dans l'API publique ; aucun vendeur payant trouvé qui l'affiche.
- **Succession / transmission** : aucun vendeur trouvé qui le vende comme signal.

### Cited Findings
- **Societe.com, créations** : la page prospection promet « chaque jour des alertes sur les nouvelles entreprises créées dans sa zone géographique ou son secteur d'activité ». Le plan qui inclut cette fonction n'est pas précisé dans l'extrait — [societe.com/solutions/prospection](https://www.societe.com/solutions/prospection)
- **Societe.com, surveillance** : suivi d'entreprises ou de **dirigeants** avec alertes personnalisables (2 000 pour le plan Pro) — [societe.com/solutions/surveillance](https://www.societe.com/solutions/surveillance) ; [societe.com/solutions/prospection](https://www.societe.com/solutions/prospection)
- **Pappers, alertes** : alertes email sur **changement de dirigeant**, nouveau dépôt de comptes, **procédure collective** et modification de capital ; webhooks Zapier/Make. Ce sont des alertes sur des entreprises **déjà suivies**. Je n'ai pas trouvé d'alerte « nouvelles créations correspondant à mes critères » — [pappers.fr/surveillance](https://www.pappers.fr/surveillance) ; [nexiagence.fr](https://nexiagence.fr/academy/apis/pappers)
- **Pappers, filtres de recherche avancée** : NAF, région, département, chiffre d'affaires, effectif, forme juridique, **date de création** [secondaire]. **Aucune confirmation** d'un filtre « âge du dirigeant » ou « procédure collective » dans l'interface. En revanche, l'export contient la date de naissance du dirigeant et la présence d'une procédure collective, et des filtres sur mesure sont possibles sur demande — [lancetavie.fr](https://lancetavie.fr/pappers-vs-infogreffe-vs-societe-com-lequel-choisir/) ; [pappers.fr/exports](https://www.pappers.fr/exports) ; [pappers.fr/faq](https://www.pappers.fr/faq)
- **Pappers, données dirigeant** : les fiches dirigeants affichent le **mois et l'année de naissance**, par exemple `pappers.fr/dirigeant/serge_godard_1963-04` — [pappers.fr](https://www.pappers.fr/dirigeant/serge_godard_1963-04)
- **Infogreffe** : listes d'**immatriculations RCS** et listes de **procédures collectives (RJ/LJ)** payantes ; entreprises et fonds de commerce **à céder** en consultation gratuite — [infogreffe.fr/tarifs-abonnement](https://www.infogreffe.fr/tarifs-abonnement)
- **Societeinfo** : paliers de surveillance, par exemple 3 000 entreprises pour le palier 3K. **Aucun palier explicite** d'alerte sur les nouvelles créations dans les extraits — [societeinfo.com/tarifs](https://societeinfo.com/tarifs)
- **Kaspr et Lusha** : tarifs exclusivement en crédits email et téléphone. Rien dans les extraits n'indique de filtres sur des événements légaux français (création, BODACC, RGE) — [emelia.io](https://emelia.io/fr/hub/kaspr-prix) ; [overloop.com](https://overloop.com/blog/kaspr-vs-lusha)
- **Pharow** : se présente comme fournisseur de « signaux d'affaires » ; liste des signaux non vérifiée — [bouncewatch.com](https://bouncewatch.com/company/pharow)
- **Scrapers tiers** : des scrapers Apify proposent des flux « France New Companies & Insolvency Alerts » à partir du BODACC, et des filtres par label (RGE, Qualiopi, Bio, ESS) à partir des données publiques — [apify.com/gazidev/france-bodacc-alerts](https://apify.com/gazidev/france-bodacc-alerts.md) ; [apify.com/spherical_distinction/french-company-leads](https://apify.com/spherical_distinction/french-company-leads)

**Matrice de synthèse.** Légende : ✔ confirmé par extrait ; ~ partiel ou indirect ; ✖ rien trouvé.

| Signal | Societe.com | Pappers | Infogreffe | Societeinfo | Kaspr / Lusha | Gratuit public |
|---|---|---|---|---|---|---|
| Nouvelles créations (filtre) | ✔ | ✔ (date de création) | ✔ (immatriculations) | ✖ | ✖ | ✔ (Export Sirene, stock SIRENE, API) |
| Alerte sur nouvelles créations | ✔ (quotidienne) | ✖ | ~ | ✖ | ✖ | ~ (fichiers et API à interroger soi-même) |
| Âge du dirigeant | ✖ | ~ (date de naissance exportée, pas de filtre) | ✖ | ✖ | ✖ | ✔ (`date_naissance_personne_min/max`) |
| Changement de dirigeant | ~ (surveillance des dirigeants) | ✔ (alerte sur entreprises suivies) | ✖ | ✖ | ✖ | ~ (BODACC modifications, à vérifier) |
| RGE | ✖ | ✖ | ✖ | ✖ | ✖ | ✔ (`est_rge`, API Professionnels RGE) |
| BODACC : procédure collective | ✖ (non vu) | ✔ (alerte et champ exporté) | ✔ (listes RJ/LJ) | ✖ | ✖ | ✔ (API BODACC) |
| BODACC : cession / vente | ✖ | ✖ | ✔ (à céder, gratuit) | ✖ | ✖ | ✔ (API BODACC) |
| Succession / transmission | ✖ | ✖ | ~ (fonds à céder) | ✖ | ✖ | ✖ (à dériver : âge + BODACC) |

Toutes les cases ✖ veulent dire « non trouvé dans les extraits », **pas** « absence prouvée ».

### Inferences
- La combinaison « **dirigeant de 60 ans ou plus** + secteur NAF + taille + région » est **un trou dans l'offre payante grand public** : aucun vendeur ne l'affiche comme filtre, alors qu'elle se calcule gratuitement via l'API Recherche d'entreprises.
- Même constat pour **RGE × autre signal** (par exemple RGE + création récente, ou RGE + dirigeant âgé). Une offre construite sur ces croisements ne vendrait pas une donnée introuvable : elle vendrait **l'assemblage, la récurrence et la qualification**.
- « Succession / transmission » n'existe nulle part comme produit. C'est un signal composite à construire (âge du dirigeant, absence d'associé jeune, annonces BODACC de cession, fonds à céder Infogreffe). Point de différenciation possible, mais l'appellation doit rester prudente : c'est une inférence, pas un fait public.

### Gaps
- Filtres réels de l'interface Pappers (âge, procédure collective) et d'une éventuelle alerte Pappers sur de nouvelles entreprises selon des critères : à vérifier en direct.
- Plan Societe.com qui inclut les alertes quotidiennes de créations : non précisé.
- Signaux exacts de Pharow (changement de dirigeant, levée de fonds, recrutement ?) : non vérifiés.
- Filtres d'Ellisphere TARGET, Altares et Manageo sur les événements légaux : non documentés publiquement dans les extraits.

## Q4 — Ce que les sources officielles gratuites donnent déjà (pour ne jamais vendre ce qui est gratuit)

### Takeaway
Gratuitement et sous licence ouverte, on dispose déjà :
- du **répertoire SIRENE complet** (stock mensuel, historique depuis 1973, mises à jour par API) ;
- d'une **API de recherche** avec des filtres sur l'activité, la localisation, la date de création, le CA, **RGE** et la **date de naissance du dirigeant** ;
- de l'**API BODACC** (créations, radiations, procédures collectives, ventes et cessions) ;
- d'un **export CSV** sur l'Annuaire des Entreprises.

Ce qui manque au gratuit : les **contacts** (email, téléphone, noms des dirigeants dans l'export CSV), les **alertes poussées** et le **croisement prêt à l'emploi** des signaux.

### Cited Findings
- **API Recherche d'entreprises** (DINUM, celle qui alimente annuaire-entreprises.data.gouv.fr) : couvre les unités légales **diffusibles** issues de SIRENE (INSEE) et du RNE (INPI). Elle propose des filtres sur l'activité, la **date de création**, le chiffre d'affaires et la localisation, avec pagination — [data.gouv.fr/dataservices/api-recherche-dentreprises](https://www.data.gouv.fr/dataservices/api-recherche-dentreprises)
- Paramètres documentés de cette API :
  - **`est_rge`** (booléen, entreprises RGE uniquement) ;
  - **`date_naissance_personne_min` / `date_naissance_personne_max`** (format aaaa-mm ou aaaa-mm-jj, précision **au mois**, le jour est ignoré) ;
  - **`type_personne`** (« dirigeant » ou « élu ») ;
  - limite de **7 appels par seconde**.
  — [recherche-entreprises.api.gouv.fr/docs](https://recherche-entreprises.api.gouv.fr/docs/) ; ticket [GitHub #791](https://github.com/annuaire-entreprises-data-gouv-fr/search-api/issues/791)
- Limite : selon une réponse publiée sur data.gouv en **avril 2026**, les entreprises **non diffusibles** ne sont pas incluses dans les filtres. Une discussion signale aussi une page de documentation restée blanche à un moment donné — [data.gouv.fr (discussions)](https://www.data.gouv.fr/dataservices/api-recherche-dentreprises/discussions)
- **Export Sirene** de l'Annuaire des Entreprises (`annuaire-entreprises.data.gouv.fr/export-sirene`) : **CSV gratuit d'établissements**, filtrable par département ou commune, NAF, catégorie juridique, effectif, ESS, état administratif et **date de création** [secondaire, page officielle non lue] — [growth-prospect.com (2026)](https://growth-prospect.com/blog/prospecter-entreprises-paris-ile-de-france/) ; [pharow.com/blog](https://www.pharow.com/blog/comment-acceder-a-la-base-sirene-des-entreprises)
- Limites de l'Export Sirene :
  - **pas de noms de dirigeants, d'emails, de sites web ni de téléphones** ;
  - tranche d'effectif **absente pour environ la moitié des établissements**, surtout pour les entreprises de moins de 3 ans [secondaire].
  — [growth-prospect.com](https://growth-prospect.com/blog/prospecter-entreprises-paris-ile-de-france/)
- **Base SIRENE en open data** :
  - gratuite depuis le **1er janvier 2017**, sous **Licence Ouverte / Open Licence 2.0** (Etalab) ;
  - **six fichiers stock mensuels** (ZIP et Parquet), dont le stock des unités légales et celui des établissements, qui reflètent le répertoire au dernier jour du mois précédent ;
  - format **Parquet depuis juin 2025**, fin de la diffusion **CSV prévue au second semestre 2027** ;
  - **historique complet depuis 1973** ;
  - mises à jour quotidiennes via l'**API Sirene** de l'INSEE.
  — [data.gouv.fr/datasets/5b7ffc618b4c4169d30727e0](https://www.data.gouv.fr/datasets/5b7ffc618b4c4169d30727e0) ; [data.gouv.fr/datasets/sirene/informations](https://www.data.gouv.fr/datasets/sirene/informations) ; [insee.fr/fr/information/3625808](https://www.insee.fr/fr/information/3625808)
- Point de vigilance : une page data.gouv signale l'**arrêt, depuis fin février, des mises à jour quotidiennes du jeu SIRENE v3 sur Opendatasoft**. Ne pas dépendre de ce miroir — [data.gouv.fr (extrait)](https://www.data.gouv.fr/datasets/62bc4b958cdb4ce3c2d86064)
- Il existe aussi un **jeu « Données des entreprises utilisées dans l'Annuaire des Entreprises »** sur data.gouv (contenu non lu) — [data.gouv.fr/datasets/667ebdd4547ab9bd6e4682d3](https://www.data.gouv.fr/datasets/667ebdd4547ab9bd6e4682d3)
- **API BODACC** (DILA) :
  - gratuite, jeux de données sous **Licence Ouverte** ;
  - téléchargement en masse sur `echanges.dila.gouv.fr/OPENDATA/` (HTTPS) et en FTPS ;
  - contenu : **créations, radiations, procédures collectives, ventes et cessions** ;
  - environ **5 parutions par semaine** ;
  - identifiant **SIREN** (le SIRET n'est pas reconnu) ;
  - les avis de rétablissement personnel ne sont pas inclus.
  — [data.gouv.fr/dataservices/672cf66ea47b8d4c15d13d5b](https://www.data.gouv.fr/dataservices/672cf66ea47b8d4c15d13d5b) ; [data.gouv.fr/datasets/bodacc](https://www.data.gouv.fr/datasets/bodacc) ; [data.gouv.fr (discussions)](https://www.data.gouv.fr/datasets/bodacc/discussions) ; [apify.com/gazidev/france-bodacc-alerts](https://apify.com/gazidev/france-bodacc-alerts.md)
- **Conflit sur l'authentification BODACC** : une fiche data.gouv indique qu'il faut un compte **PISTE** ; un scraper tiers affirme « no login, no API key » via le flux open data DILA. À vérifier — [data.gouv.fr](https://www.data.gouv.fr/fr/dataservices/672cf66ea47b8d4c15d13d5b) ; [apify.com/gazidev/france-bodacc-alerts](https://apify.com/gazidev/france-bodacc-alerts.md)
- **API Professionnels RGE** référencée sur api.gouv.fr (contenu et modalités non lus) — [api.gouv.fr/les-api/api_professionnels_rge](https://api.gouv.fr/les-api/api_professionnels_rge)
- **API Sirene incluant les unités à diffusion partielle** référencée sur data.gouv (conditions d'accès non lues) — [data.gouv.fr/dataservices/api-sirene-dont-unites-a-diffusion-partielle](https://www.data.gouv.fr/dataservices/api-sirene-dont-unites-a-diffusion-partielle)
- **Infogreffe** : entreprises et fonds de commerce **à céder** consultables gratuitement — [infogreffe.fr/tarifs-abonnement](https://www.infogreffe.fr/tarifs-abonnement)
- **Pappers** (privé, mais avec un niveau gratuit) : 10 premières lignes d'export gratuites et 100 crédits API offerts — [pappers.fr/exports](https://www.pappers.fr/exports) ; [pappers.fr/api](https://www.pappers.fr/api)

**Ce qu'il ne faut PAS vendre comme une valeur en soi (gratuit)**
- Une liste d'entreprises filtrée par NAF, région ou département, effectif ou date de création (Export Sirene, stock SIRENE).
- Une liste d'entreprises RGE (`est_rge`, API RGE).
- Une liste de dirigeants nés avant une date donnée (`date_naissance_personne_max`).
- Les annonces BODACC brutes : créations, procédures collectives, cessions (API BODACC).

**Ce que le gratuit ne fournit pas (valeur potentielle)**
- Emails et téléphones des dirigeants : absents de l'Export Sirene ; ils sont vendus par Societe.com, Pappers sur demande, Kaspr et Lusha.
- Des **alertes poussées** sur des critères croisés : il faut interroger soi-même les fichiers et les API.
- Le **nettoyage** : effectif manquant pour environ la moitié des jeunes établissements ; entreprises non diffusibles exclues des filtres.
- Le **croisement** de plusieurs signaux (âge × RGE × BODACC × NAF) dans un seul livrable, avec un score.

### Inferences
- Pour un acheteur averti, **le prix plancher de la donnée brute est zéro**. Tout prix doit donc se justifier par le temps gagné, la récurrence, l'ajout de contacts conformes au RGPD et la qualité du croisement. Il ne peut pas se justifier par l'accès.
- Les filtres « âge du dirigeant » et « RGE », qui semblaient différenciants, sont **déjà exposés gratuitement par l'API de l'État**. Ils ne différencient que pour un public non technique, qui ne sait pas appeler une API.
- L'arrêt prévu du CSV SIRENE au profit du Parquet (S2 2027) et l'exclusion des non-diffusibles sont des points techniques à intégrer dans toute chaîne de production.

### Gaps
- Je n'ai pas lu la page officielle de l'**Export Sirene** (filtres exacts, plafond de lignes, présence d'un filtre RGE ou label). Les informations viennent de guides tiers.
- **API Professionnels RGE** (ADEME/data.gouv) : fréquence de mise à jour et conditions d'accès non vérifiées.
- Authentification de l'API BODACC (PISTE ou accès libre) : conflit non résolu.
- Je ne sais pas si l'Annuaire des Entreprises (interface web) propose une recherche par nom ou âge de dirigeant. Je n'ai trouvé de confirmation que pour l'API.

> Note du coordinateur (vérification de première main, 15/11/2026) : la spécification officielle de l'API Recherche
> d'entreprises (https://recherche-entreprises.api.gouv.fr/openapi.json, lue directement) ne contient AUCUN paramètre de
> filtre par date de création. Les filtres disponibles incluent activite_principale, section_activite_principale,
> departement, region, code_postal, code_commune, epci, tranche_effectif_salarie, categorie_entreprise, etat_administratif,
> nature_juridique, est_rge, est_qualiopi, est_ess, est_entrepreneur_individuel, ca_min/ca_max,
> resultat_net_min/resultat_net_max, date_naissance_personne_min/max, type_personne, nom_personne, prenoms_personne,
> lat/long/radius. L'affirmation « filtre sur la date de création » ci-dessus est donc fausse pour cette API ; la date de
> création n'est filtrable qu'après coup, côté client (ce que fait VELYX), ou via les fichiers stock SIRENE.
