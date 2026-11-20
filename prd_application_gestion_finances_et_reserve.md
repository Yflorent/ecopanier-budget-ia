# Product Requirements Document (PRD) — Application Mobile de Gestion Financière, Réserve Domestique & Comparateur Géolocalisé (5 km)

**Version :** 3.1
**Architecture :** Mobile Serverless (Firebase BaaS & Coach IA Prédictif via Vertex AI / Gemini)
**Prérequis Design :** Prototypage UI/UX et Wireframes (X-Frames) obligatoires sous **Google Stitch** avant toute intégration

## 1. Vision et But du Projet

### 1.1 Problématique

Les applications de gestion budgétaire classiques se contentent de constater les dépenses une fois l'argent sorti du compte, tandis que les applications de liste de courses ne tiennent compte ni de l'état réel du garde-manger, ni des écarts de prix entre les supermarchés locaux. De plus, la ressaisie manuelle chaque mois des mêmes postes de dépenses décourage les utilisateurs sur le long terme.

### 1.2 Objectif du Produit

Offrir aux ménages un assistant mobile intelligent tout-en-un qui relie directement **la consommation domestique (réserve)** au **portefeuille (budget mensuel)** :

1. **Cycle Mensuel Automatisé & Navigation Temporelle :** Chaque 1er du mois, le système génère automatiquement une nouvelle page/instance de gestion budgétaire (`YYYY-MM`) à partir des modèles récurrents (zéro ressaisie). Toutes les dépenses, achats de réapprovisionnement, analyses IA et statistiques sont strictement rattachés au mois concerné, avec la possibilité de naviguer librement d'un mois à l'autre (historique et mois courant).

2. **Suivi de réserve en 1 clic ("1-Tap Use") & Import Automatisé (Scan & PDF) :** Décrémentation instantanée des produits utilisés à la maison avec alerte immédiate dès qu'un produit s'épuise (`Quantité = 1`), et réapprovisionnement sans effort par scan photo ou **import direct des factures PDF** des magasins (Drive, e-tickets de caisse).

3. **Optimisation locale quotidienne (Rayon 5 km) :** Chaque jour, une tâche automatisée analyse les produits dont il ne reste qu'une seule unité en stock et recommande le magasin le moins cher dans un rayon de 5 km.

4. **Visualisation Graphique & Analytique :** Une page dédiée aux graphiques permettant de visualiser l'évolution des dépenses, des achats de courses, des économies réalisées et de la répartition par poste d'un mois sur l'autre.

5. **Coach Financier IA (Prédictions & Optimisation) :** Analyse prédictive de fin de mois, détection des dérives budgétaires, optimisation des charges fixes, prédiction de rupture de stock et propositions d'économies ciblées.

## 2. Méthodologie Design First : Prérequis Google Stitch

> **RÈGLE D'INGÉNIERIE OBLIGATOIRE :** Aucune ligne de code d'interface mobile (UI) ne doit être intégrée avant la validation complète des wireframes (X-Frames) et des maquettes haute-fidélité sur la plateforme **Google Stitch**.

### 2.1 Workflow de Conception sous Google Stitch

1. **Étape 1 — X-Frames (Wireframes structurels) :** Conception dans Google Stitch des flux de navigation, du composant de **navigation inter-mois** (`< Octobre 2026 | Novembre 2026 >`), des graphiques d'évolution et des cartes d'action rapide (boutons `-1`, import PDF, jauges budgétaires, cartes de conseils IA).

2. **Étape 2 — Design System & Maquettes UI :** Définition de la palette de couleurs (états Vert/Orange/Rouge des budgets, courbes analytiques, mode clair/sombre), de la typographie et des composants réutilisables sous Google Stitch.

3. **Étape 3 — Validation des Parcours (User Flows) :** Vérification de l'ergonomie des **10 écrans cibles** (incluant la page de Graphiques d'évolution, le module d'import PDF/Scan et l'écran Coach Financier IA).

4. **Étape 4 — Export & Intégration Mobile :** Génération et export des spécifications/code UI depuis Google Stitch vers l'environnement de développement mobile.

## 3. Stack Technologique & Architecture Serverless (Firebase)

L'application repose sur une architecture **Serverless BaaS (Backend-as-a-Service)** via Firebase, éliminant le besoin de maintenir un serveur backend traditionnel tout en garantissant le mode hors-ligne natif (indispensable à l'intérieur des supermarchés).

### 3.1 Technologies Mobiles (Cross-Platform iOS & Android)

* **Framework Mobile :** Flutter (Dart) ou React Native / Angular-Ionic (Capacitor) avec gestion d'état réactive centrée sur le **Mois Actif Sélectionné (`selectedYearMonth`)**.

* **Gestion des Fichiers & Partage Natif (Import PDF) :** Sélecteur de fichiers système (`file_picker` / `expo-document-picker`) + récepteur d'intention de partage (`Share Extension` iOS / `Intent Filter` Android) permettant d'envoyer une facture PDF directement depuis sa boîte mail ou l'application d'un supermarché (Leclerc Drive, Carrefour, Auchan, Lidl Plus) vers l'application.

* **Moteur de Graphiques (Charts) :** `fl_chart` / `Syncfusion Charts` (Flutter) ou `Victory Native` / `Recharts` pour l'affichage fluide des courbes d'évolution multi-mois, camemberts de répartition et histogrammes comparatifs.

* **Internationalisation (i18n) :** Fichiers de traduction JSON/ARB (`fr`, `en`, `es`, etc.), formatage dynamique des devises (`EUR`, `XAF`, `USD`, `CAD`), des noms de mois et des unités de mesure (`km`, `m`, `kg`, `L`) via `Intl`.

* **Stockage Local & Cache Hors-Ligne :** Persistence native du SDK Cloud Firestore + stockage sécurisé des préférences (`SharedPreferences` / `SecureStorage`).

* **Géolocalisation & Cartographie :** Google Maps SDK / Geolocator + calculs spatiaux par **Geohash** (`geofire-common`) pour le filtrage précis dans un rayon de 5 km.

### 3.2 Architecture Base de Données Cloud Firestore (Cloisonnement Mensuel)

Chaque événement financier, achat, facture importée ou rapport analytique est rattaché à une période mensuelle (`yearMonth` au format `YYYY-MM`, ex: `"2026-11"`) pour permettre la navigation temporelle et les comparaisons graphiques :

* `users/{userId}` : Profil, langue (`locale`), devise (`currency`), position GPS (`lat`, `lng`, `geohash`), plafond budgétaire par défaut (`defaultMonthlyIncome`).

* `users/{userId}/categoryTemplates/{templateId}` : Modèles permanents de postes de dépenses (`name`, `defaultLimit`, `type`, `isRecurring`, `autoDebitOnFirstDay`).

* `users/{userId}/monthlyBudgets/{yearMonth}` : **Document maître d'un mois donné** (créé automatiquement chaque 1er du mois). Contient :

  * Les totaux consolidés du mois (`globalAllocated`, `totalFixedCharges`, `totalVariableSpent`, `totalSavedViaComparator`, `status: OPEN | CLOSED`).

  * Sous-collection `categories/{categoryId}` : Enveloppes budgétaires spécifiques à ce mois.

  * Sous-collection `transactions/{transactionId}` : Toutes les dépenses variables, charges fixes prélevées, et **achats de réapprovisionnement de la réserve** (avec lien `invoiceFileUrl` vers le PDF ou la photo du ticket dans Firebase Storage) effectués durant ce mois précis.

  * Sous-collection `aiInsights/{insightId}` : Analyses, prédictions de fin de mois et recommandations d'économies générées par l'IA pour ce mois.

* `users/{userId}/pantryItems/{itemId}` : État actuel de la réserve domestique (`name`, `eanBarcode`, `currentQuantity`, `alertThreshold`, `needsRestock`, `averageConsumptionDays`).

* `users/{userId}/pantryMovements/{movementId}` : Historique horodaté (`yearMonth`, `timestamp`, `type: CONSUMPTION | RESTOCK`, `source: MANUAL | BARCODE | PHOTO_OCR | PDF_INVOICE`, `quantity`, `pricePaid`, `storeId`) permettant de tracer sur les graphiques l'évolution de la consommation et des achats mois par mois.

* `stores/{storeId}` & `storePrices/{priceId}` : Référentiel des magasins locaux (indexés par `geohash`) et relevés de prix géolocalisés.

### 3.3 Services Serverless Firebase

* **Firebase Authentication :** Email/Mot de passe, Google Sign-In, Apple Sign-In.

* **Firebase Cloud Functions (Node.js / TypeScript) :**

  1. **Cron Mensuel (1er de chaque mois à 00h01) :** Crée automatiquement la nouvelle page/instance `monthlyBudgets/{YYYY-MM}` pour chaque utilisateur, clôture le mois `M-1` (fige les statistiques pour les graphiques), clone les modèles récurrents et débite les charges fixes.

  2. **Cron Quotidien (17h30) :** Scanne les articles en réserve où `currentQuantity <= 1`, cherche le magasin le moins cher dans les 5 km et envoie la notification push.

  3. **Parser Multimodal de Factures PDF & Tickets (Trigger Storage / Callable) :** Lorsqu'un fichier PDF ou une image de ticket est importé dans Firebase Storage, interroge **Vertex AI Gemini** pour extraire les lignes d'articles, quantités, prix unitaires, remises et enseigne.

  4. **Moteur Analytique & IA (Hebdomadaire & Temps réel) :** Interroge **Firebase Vertex AI (Gemini)** pour générer les prédictions budgétaires et les propositions d'optimisation.

* **Firebase Cloud Messaging (FCM) & Cloud Storage :** Notifications push multilingues et stockage sécurisé des factures PDF, photos de tickets de caisse et avatars.

## 4. Fonctionnalités d'Intelligence Artificielle (Coach Financier & Prédictions)

L'intégration de **Firebase Vertex AI (Gemini 2.5 Flash)** et **Google ML Kit** apporte deux niveaux d'intelligence : l'**IA Prédictive & Analytique (Coaching Financier)** et l'**IA Opérationnelle (Parsing PDF, Vision & Automatisation)**.

### 4.1 IA Prédictive, Analyse Budgétaire & Optimisation des Charges

1. **IA-01 — Prédiction d'Atterrissage de Fin de Mois (Budget Forecasting) :**

   * L'IA analyse la vélocité des dépenses quotidiennes du mois en cours par rapport aux habitudes des mois précédents (pondération jours ouvrés vs week-ends).

   * Elle prédit le solde final au 30 du mois et la date exacte de dépassement potentiel de chaque poste (ex. : *"Au rythme actuel de 85 €/semaine, votre poste Alimentation sera dépassé le 24 du mois d'environ 55 €"*).

2. **IA-02 — Analyse Budgétaire & Détection d'Anomalies ("Fuites de budget") :**

   * Comparaison automatique du mois `M` avec la moyenne glissante des 3 à 6 derniers mois.

   * Détection des dérives silencieuses (ex. : *"Vos dépenses Loisirs ont augmenté de +32 % ce mois-ci à cause de 7 micro-dépenses répétées entre 8 € et 15 €"*).

3. **IA-03 — Audit et Optimisation des Charges Fixes :**

   * Analyse du poids des charges fixes (`CHARGE_FIXE`) par rapport au budget global (alerte si le ratio dépasse la norme saine de 50 %).

   * Identification des hausses de tarifs d'abonnements d'un mois sur l'autre et proposition d'optimisations chiffrées (ex. : *"Réduire ou renégocier votre poste Télécom/Abonnements de 20 €/mois libérerait 240 €/an de reste à vivre"*).

4. **IA-04 — Proposition d'Économies Hybrides (Croisement Budget + Réserve + Prix 5 km) :**

   * **Arbitrage intelligent en fin de mois tendue :** Si une enveloppe budgétaire passe à l'orange ou au rouge avant la fin du mois, l'IA adapte les recommandations de courses dans les 5 km en proposant des produits de substitution (marques distributeurs ou formats économiques) pour les articles à `Quantité <= 1`, affichant l'économie immédiate sur le panier.

   * **Achat d'opportunité (Stockage préventif) :** Si le budget du mois présente un excédent et qu'un produit non périssable très consommé par le foyer (ex: huile, riz, lessive) est à un prix historiquement bas dans un magasin à moins de 5 km, l'IA suggère d'en acheter 2 ou 3 unités d'avance pour réduire les dépenses du mois suivant.

5. **IA-05 — Prédiction de Rupture de Stock (Smart Depletion) :**

   * En analysant l'écart temporel entre chaque clic sur `-1` dans la réserve (`pantryMovements`), l'IA calcule la durée de vie moyenne de chaque produit (ex: 1 pack de lait tous les 4 jours) et prédit la date de rupture, même si l'utilisateur a oublié de décrémenter manuellement son stock.

### 4.2 IA Opérationnelle (Extraction PDF, Vision & Sémantique)

6. **IA-06 — Extraction Intelligente de Factures PDF & Scan Ticket de Caisse (Gemini Multimodal) :**

   * Analyse native des **documents PDF** (factures de courses Drive, e-tickets dématérialisés multi-pages) ET des photos de tickets papier via `gemini-2.5-flash` (`application/pdf` & `image/*`).

   * Extrait en JSON structuré : le nom et l'adresse de l'enseigne, la date d'achat (pour rattacher la dépense au bon mois `YYYY-MM`), le montant total TTC, les éventuelles remises fidélité, ainsi que chaque ligne d'article (libellé normalisé, quantité achetée, poids/volume, prix unitaire, catégorie alimentaire vs non-alimentaire).

   * Rattache automatiquement la dépense au poste budgétaire correspondant du mois, réapprovisionne la réserve domestique et met à jour la base de prix du magasin local dans le rayon de 5 km.

7. **IA-07 — Matching Sémantique des Produits entre Enseignes :**

   * Associe intelligemment des libellés différents issus des factures PDF ou tickets désignant le même produit (*"Huile Tournesol 1L"* vs *"HUILE TOURN. 100CL"*) pour comparer les prix dans les 5 km même sans code-barres EAN.

## 5. Product Backlog Global — User Stories Détaillées

### Epic 0 : Authentification, Gestion de Profil & Internationalisation (i18n)

#### US 0.1 — Création de compte et inscription rapide

* **En tant que** nouvel utilisateur, **je veux** créer un compte via Email/Mot de passe ou Google/Apple Sign-In **afin de** sauvegarder et synchroniser mes données dans Firebase.

* **Critères d'acceptation :**

  1. Inscription via **Firebase Auth** et création automatique du profil `users/{uid}` dans Firestore (devise locale, langue du téléphone, rayon de `5.0 km`).

  2. Initialisation automatique de la page de budget du mois courant (`monthlyBudgets/{YYYY-MM}`).

#### US 0.2 — Connexion, session persistante et récupération de mot de passe

* **En tant qu'** utilisateur inscrit, **je veux** me connecter, rester connecté et pouvoir réinitialiser mon mot de passe **afin d'** accéder rapidement à mon espace sécurisé.

* **Critères d'acceptation :**

  1. Maintien de la session Firebase Auth, lien de réinitialisation par email et déverrouillage biométrique optionnel (FaceID / Empreinte).

#### US 0.3 — Mise à jour du profil et des préférences

* **En tant qu'** utilisateur connecté, **je veux** modifier mes informations personnelles (nom, photo, position GPS domicile, heure de notification quotidienne) **afin de** personnaliser l'application.

* **Critères d'acceptation :**

  1. Édition du profil, upload d'avatar sur Firebase Storage, réglage de l'heure du batch quotidien (ex: `17:30`) et suppression complète du compte (RGPD).

#### US 0.4 — Internationalisation (Multi-langues & Multi-devises)

* **En tant qu'** utilisateur, **je veux** choisir ma langue (`FR`, `EN`, etc.) et ma devise (`€`, `FCFA`, `$`, `CAD`) **afin que** toute l'application, les graphiques et les conseils de l'IA s'adaptent à mon pays.

* **Critères d'acceptation :**

  1. Changement de langue à chaud traduisant l'interface, les notifications push FCM et la langue de réponse du Coach IA Gemini.

  2. Formatage localisé des montants, dates et unités de distance/poids.

### Epic 1 : Cycle Mensuel Automatisé, Navigation Inter-Mois & Gestion du Budget

#### US 1.1 — Définition du budget mensuel global de référence

* **En tant qu'** utilisateur, **je veux** définir mon budget mensuel global par défaut **afin qu'** il serve de plafond de référence à chaque nouveau mois.

* **Critères d'acceptation :**

  1. Saisie d'un montant positif (`defaultMonthlyIncome`) utilisé lors de la génération automatique de chaque nouvelle page mensuelle.

#### US 1.2 — Définition des modèles de postes permanents (Zéro ressaisie)

* **En tant qu'** utilisateur, **je veux** configurer mes postes de dépenses (Alimentation, Loyer, Transport, Loisirs, etc.) une seule fois comme modèles récurrents **afin de** ne plus avoir à les ressaisir chaque mois.

* **Critères d'acceptation :**

  1. Création dans `categoryTemplates` : Nom, Icône, Couleur, Plafond, Type (`VARIABLE` ou `CHARGE_FIXE`), `isRecurring` (`true` par défaut) et `autoDebitOnFirstDay`.

  2. Alerte visuelle si la somme des plafonds récurrents dépasse le budget mensuel global.

#### US 1.3 — Création automatique d'une nouvelle page de budget chaque 1er du mois

* **En tant que** système, **je veux** créer automatiquement chaque 1er du mois une nouvelle instance/page de gestion de budget (`YYYY-MM`) et y rattacher tous les événements du mois **afin que** chaque mois soit géré de manière isolée et prête à l'emploi.

* **Critères d'acceptation :**

  1. **Bascule automatique du 1er du mois :** Le 1er de chaque mois à 00h01 (via Cloud Function planifiée ET vérification Lazy Init à l'ouverture de l'app), le système clôture le mois `M-1` et crée une nouvelle page de gestion `monthlyBudgets/{YYYY-MM}` (ex: `2026-11`).

  2. Tous les modèles de postes avec `isRecurring == true` sont automatiquement instanciés dans ce nouveau mois avec un solde dépensé remis à `0.00`.

  3. Les charges fixes (`autoDebitOnFirstDay == true`) génèrent immédiatement leur transaction datée du 1er du mois, affichant le **"Reste à vivre réel"** du nouveau mois.

  4. **Liaison stricte au mois :** Toute dépense, toute facture PDF importée, tout achat de réapprovisionnement issu de la réserve et toute analyse IA créés pendant le mois sont obligatoirement liés à l'identifiant `yearMonth` de ce mois.

#### US 1.4 — Navigation temporelle d'un mois à un autre (Historique & Mois courant)

* **En tant qu'** utilisateur, **je veux** naviguer librement d'un mois à un autre via un sélecteur de période **afin de** consulter les pages de budget, les dépenses, les factures PDF archivées, les achats et les bilans des mois précédents ou de revenir au mois actuel.

* **Critères d'acceptation :**

  1. Un sélecteur horizontal en haut de l'écran (`< Septembre 2026 | Octobre 2026 | Novembre 2026 >` ou calendrier mensuel) permet de basculer d'un mois à l'autre en un clic.

  2. Lors du changement de mois sélectionné, **tous les composants de la page** (jauges des postes, liste des dépenses, factures PDF associées, achats de réserve imputés, économies réalisées et bilan IA) se mettent à jour instantanément pour afficher les données exclusives de ce mois.

  3. Les mois passés sont affichés avec un badge `"Clôturé"` (lecture seule par défaut, avec option de correction rétroactive qui recalcule les graphiques).

#### US 1.5 — Ajout des dépenses quotidiennes rattachées au mois et suivi par jauges

* **En tant qu'** utilisateur, **je veux** ajouter chaque dépense supplémentaire dans son poste **afin de** suivre l'évolution de mon budget mensuel en temps réel.

* **Critères d'acceptation :**

  1. Saisie d'une dépense (Montant, Poste, Date, Note) rattachée automatiquement à la page de budget du mois correspondant à la date saisie (`YYYY-MM`).

  2. Recalcul immédiat des soldes et mise à jour des jauges : Vert (`< 75%`), Orange (`75% à 99%`), Rouge (`>= 100%`).

#### US 1.6 — Ajustement ou archivage d'un poste sans altérer les mois passés

* **En tant qu'** utilisateur, **je veux** modifier le plafond d'un poste ou l'archiver **afin de** faire évoluer mon budget tout en gardant intactes les pages de budget des mois précédents.

* **Critères d'acceptation :**

  1. Choix de la portée : *"Appliquer uniquement au mois affiché"* ou *"Appliquer à ce mois et aux modèles des mois futurs"*.

### Epic 2 : Gestion de la Réserve Domestique & Alertes d'Épuisement

#### US 2.1 — Référencement des articles en réserve

* **En tant qu'** utilisateur, **je veux** définir les articles que j'ai en réserve à la maison **afin de** connaître l'état exact de mon stock.

* **Critères d'acceptation :**

  1. Création d'un article (`pantryItems`) avec Nom, Code EAN, Catégorie, Quantité actuelle (`>= 0`), Unité et Seuil d'alerte (`1` par défaut). Gestion anti-doublon par incrémentation.

#### US 2.2 — Décrémentation rapide ("1-Tap Use") et journalisation mensuelle

* **En tant qu'** utilisateur, **je veux** noter chaque article utilisé en un clic (`-1`) **afin de** maintenir ma réserve à jour et alimenter mes statistiques mensuelles de consommation.

* **Critères d'acceptation :**

  1. Bouton `-1` sur chaque article décrémentant `currentQuantity` (bloqué à `0`).

  2. Chaque clic `-1` ou `+1` enregistre un mouvement horodaté dans `pantryMovements` rattaché au mois en cours (`yearMonth`), permettant de suivre le volume de produits consommés par mois.

#### US 2.3 — Notification immédiate lorsqu'un produit s'épuise

* **En tant qu'** utilisateur, **je veux** recevoir une notification dès qu'un produit passe à `Quantité = 1` (ou `0`) **afin d'** être averti immédiatement qu'il s'épuise.

* **Critères d'acceptation :**

  1. Passage automatique de `needsRestock` à `true` et envoi immédiat d'une notification : *"Attention, il ne vous reste plus que 1 [Produit] en réserve."*

### Epic 3 : Recherche Quotidienne & Comparateur de Prix (Rayon 5 km)

#### US 3.1 — Configuration GPS et détection des magasins dans les 5 km

* **En tant qu'** utilisateur, **je veux** définir ma position géographique **afin que** les recherches ciblent uniquement les magasins situés dans un rayon de 5 km.

* **Critères d'acceptation :**

  1. Enregistrement de la position (`lat`, `lng`, `geohash`) et filtrage des magasins dont la distance Haversine est `<= 5.0 km`.

#### US 3.2 — Batch quotidien de recherche sur les produits à `Quantité = 1`

* **En tant que** système (Cloud Function), **je veux** rechercher chaque jour les produits de la réserve où il n'en reste plus qu'un seul (`Quantité <= 1`) et comparer leurs prix dans les magasins à moins de 5 km **afin de** trouver l'offre la moins chère.

* **Critères d'acceptation :**

  1. Exécution quotidienne planifiée sélectionnant tous les articles avec `currentQuantity <= 1` et identifiant le magasin le moins cher dans les 5 km (par code EAN ou matching sémantique IA).

#### US 3.3 — Notification quotidienne et vue comparative (Par article vs Panier unique)

* **En tant qu'** utilisateur, **je veux** recevoir chaque jour la recommandation du magasin le moins cher à moins de 5 km pour mes produits presque épuisés **afin d'** optimiser mes achats.

* **Critères d'acceptation :**

  1. Notification push FCM quotidienne ouvrant l'écran comparatif avec double vue : **"Meilleur prix par article"** et **"Meilleur magasin unique pour tout le panier"**.

### Epic 4 : Passerelle d'Achat Mensuelle, Scan Caméra & Import PDF de Factures

#### US 4.1 — Validation d'achat rattachée au budget du mois en cours

* **En tant qu'** utilisateur, **je veux** valider l'achat des produits recommandés en un clic **afin de** réapprovisionner ma réserve et d'imputer automatiquement la dépense sur la page de budget du mois actif.

* **Critères d'acceptation :**

  1. Transaction Firestore atomique (`WriteBatch`) qui incrémente les quantités dans `pantryItems`, enregistre l'achat dans `pantryMovements` (avec l'économie réalisée) ET crée la dépense dans `monthlyBudgets/{currentYearMonth}/transactions` sur le poste *"Alimentation"*.

#### US 4.2 — Scan Code-Barres EAN-13 et Photo de Ticket de Caisse par Caméra

* **En tant qu'** utilisateur, **je veux** scanner un code-barres ou photographier un ticket de caisse papier **afin de** mettre à jour en quelques secondes ma réserve, les dépenses de mon mois en cours et les prix locaux.

* **Critères d'acceptation :**

  1. Scan EAN-13 pour faire `-1` / `+1` rapidement ; OCR via Gemini Vision sur les photos de tickets de caisse pour ventiler automatiquement la dépense dans le mois en cours et incrémenter les articles achetés en réserve.

#### US 4.3 — Import en PDF des factures et tickets dématérialisés des magasins (Hors Scan)

* **En tant qu'** utilisateur qui reçoit ses factures de courses ou tickets de caisse au format électronique (Drive, e-ticket reçu par email ou téléchargé depuis l'app du magasin), **je veux** importer directement un fichier PDF dans l'application (en dehors du scan caméra) **afin de** mettre à jour automatiquement mes dépenses du mois, mon stock en réserve et le référentiel des prix locaux sans aucune saisie manuelle.

* **Critères d'acceptation :**

  1. **Import multi-source :** L'utilisateur peut importer un fichier `.pdf` soit via un bouton `"Importer une facture PDF"` dans l'application (sélecteur de fichiers du téléphone), soit via le menu natif `"Partager vers..."` d'iOS/Android depuis son application Mail ou son navigateur.

  2. **Extraction IA Multimodale (Gemini PDF Parser) :** Le document PDF (même multi-pages) est analysé par Vertex AI Gemini qui extrait : le nom et la localisation du magasin, la date de la facture, le montant total payé, et la liste détaillée des articles (nom normalisé, quantité, prix unitaire, remises déduites).

  3. **Écran de pré-validation avant enregistrement :** Avant de valider, l'application affiche un récapitulatif clair permettant à l'utilisateur de vérifier ou décocher les articles à ajouter dans la réserve domestique et de confirmer le poste budgétaire à débiter (ou de ventiler une même facture entre deux postes, ex: `85,00 €` en *Alimentation* et `20,00 €` en *Entretien/Hygiène*).

  4. **Rattachement automatique au mois de la facture & Archivage :** La dépense est rattachée à la page de budget `monthlyBudgets/{YYYY-MM}` correspondant à la date de la facture PDF (avec archivage du PDF dans Firebase Storage consultable depuis la transaction). Les quantités en réserve (`pantryItems`) sont incrémentées et les prix unitaires mettent à jour la base des magasins dans les 5 km.

  5. **Détection anti-doublon :** Si la même facture PDF (même enseigne, même date/heure, même montant total ou même numéro de facture) a déjà été importée ou scannée, l'application bloque le doublon et avertit l'utilisateur.

### Epic 5 : Page de Graphiques & Visualisation des Évolutions Multi-Mois

#### US 5.1 — Graphique d'évolution des dépenses et du respect du budget (Multi-Mois)

* **En tant qu'** utilisateur, **je veux** consulter une page de graphiques montrant l'évolution de mes dépenses totales et par poste sur plusieurs mois (3, 6, 12 mois) **afin de** visualiser mes tendances financières dans le temps.

* **Critères d'acceptation :**

  1. **Courbe / Histogramme mensuel comparatif :** Affiche pour chaque mois (`Mai`, `Juin`, `Juillet`, `Août`, `Sept`, `Oct`) le Budget Alloué vs le Montant Réellement Dépensé.

  2. **Graphique de répartition par poste (Donut / Camembert) :** Montre la part en `%` et en valeur de chaque poste (Alimentation, Loyer, Transport, Loisirs) pour le mois sélectionné, avec possibilité de glisser d'un mois à l'autre.

  3. **Courbe de vélocité intra-mensuelle :** Compare la courbe cumulée des dépenses du jour `J1` au jour `J31` du mois en cours avec la courbe du mois précédent.

#### US 5.2 — Graphique d'évolution des achats de réserve, de l'inflation personnelle et des économies 5 km

* **En tant qu'** utilisateur, **je veux** visualiser sous forme de graphiques l'évolution de mes achats de courses, des articles les plus consommés et des économies réalisées grâce au comparateur 5 km **afin de** mesurer l'impact concret sur mon pouvoir d'achat.

* **Critères d'acceptation :**

  1. **Histogramme des économies mensuelles :** Affiche mois par mois le montant total économisé grâce aux recommandations de magasins dans les 5 km (différence entre le prix moyen local et le prix payé dans le magasin recommandé).

  2. **Top des articles consommés & Budget Courses :** Graphique croisant le volume d'articles sortis de la réserve (`-1`) et le coût des réapprovisionnements mois par mois.

  3. **Courbe d'évolution du prix des produits récurrents (Suivi d'inflation) :** En cliquant sur un article de la réserve (ex: *Huile 1L* ou *Lait*), affiche la courbe d'évolution de son prix d'achat sur les 6 derniers mois (alimentée par les achats validés, les tickets scannés et les factures PDF importées).

### Epic 6 : Coach Financier IA (Prédictions, Analyse, Économies & Optimisation des Charges)

#### US 6.1 — Prédiction IA d'atterrissage de fin de mois et alerte de dépassement

* **En tant qu'** utilisateur, **je veux** que l'IA prédise le solde final de mon budget et de chaque poste à la fin du mois selon mon rythme actuel de dépense **afin d'** agir avant d'être à découvert.

* **Critères d'acceptation :**

  1. Affichage sur le Dashboard du mois en cours d'un indicateur prédictif IA : *"Projection au 30 du mois : +115 € d'épargne"* ou *"Risque de dépassement de -65 € sur le poste Alimentation dès le 24 du mois"*.

  2. Explication claire par l'IA du calcul (rythme quotidien constaté vs budget restant par jour).

#### US 6.2 — Analyse budgétaire IA et détection des dérives ("Fuites de budget")

* **En tant qu'** utilisateur, **je veux** recevoir une analyse automatique comparant mes dépenses du mois en cours avec mes mois précédents **afin d'** identifier immédiatement où mon argent part anormalement.

* **Critères d'acceptation :**

  1. Génération de cartes d'analyse par poste mettant en évidence les écarts significatifs (`> 15%`) par rapport à la moyenne des 3 derniers mois, en pointant la cause (ex: multiplication de petites dépenses ou hausse du panier moyen).

#### US 6.3 — Audit IA et optimisation des charges fixes récurrentes

* **En tant qu'** utilisateur, **je veux** que l'IA analyse le poids de mes charges fixes récurrentes et me propose des pistes d'optimisation **afin de** réduire mes frais fixes et augmenter mon reste à vivre chaque mois.

* **Critères d'acceptation :**

  1. Calcul automatique du ratio `Charges Fixes / Budget Global` avec diagnostic IA (Sain `< 50%`, Tendu `50-60%`, Critique `> 60%`).

  2. Détection des charges fixes ayant augmenté ou dépassant les standards habituels, avec estimation de l'économie annuelle potentielle en cas de renégociation ou de changement d'offre.

#### US 6.4 — Propositions d'économies intelligentes et prédiction de rupture de stock

* **En tant qu'** utilisateur, **je veux** que l'IA combine l'état de mon budget, ma vitesse de consommation en réserve et les prix à moins de 5 km pour me proposer des économies concrètes **afin de** réduire ma facture de courses.

* **Critères d'acceptation :**

  1. **Prédiction de rupture :** L'IA calcule la fréquence moyenne entre deux clics `-1` sur chaque produit et prévient l'utilisateur quand un produit approche de sa rupture théorique.

  2. **Substitutions économiques :** Si le budget *Alimentation* du mois est sous tension, l'IA propose dans le comparateur 5 km des alternatives moins chères (marques distributeurs) pour les produits à `Quantité <= 1` et chiffre l'économie réalisable sur le mois.

  3. **Bouton d'action directe :** L'utilisateur peut appliquer une recommandation d'ajustement budgétaire de l'IA en un seul clic.

## 6. Liste des 10 Écrans à Maquetter dans Google Stitch (Livrables Design)

Avant toute intégration dans le code mobile, les **10 écrans** suivants doivent être conçus sous forme de **X-Frames (Wireframes)** puis de **maquettes UI validées dans Google Stitch** :

| Code | Écran Google Stitch | Fonctionnalités & Composants Clés à Maquetter | User Stories | 
| ----- | ----- | ----- | ----- | 
| **STITCH-01** | **Authentification** | Login, Inscription, Mot de passe oublié, Boutons Google/Apple Sign-In. | US 0.1, US 0.2 | 
| **STITCH-02** | **Profil & Internationalisation** | Infos profil, Sélecteur Langue (`FR`/`EN`) & Devise (`€`/`FCFA`/`$`), Heure notification, Carte interactive du rayon de 5 km autour du domicile. | US 0.3, US 0.4, US 3.1 | 
| **STITCH-03** | **Dashboard Budget Mensuel & Navigation Inter-Mois** | **Barre de navigation temporelle (`< Mois M-1 \| Mois M \| Mois M+1 >`)**, Carte "Reste à vivre" + Bandeau de prédiction fin de mois IA, Liste des postes avec jauges Vert/Orange/Rouge, Historique des dépenses et factures du mois sélectionné. | US 1.1, US 1.3, US 1.4, US 1.5, US 6.1 | 
| **STITCH-04** | **Modèles de Postes Récurrents ("Zéro Ressaisie")** | Liste des modèles permanents, Switch `Reconduire chaque mois`, Switch `Charge fixe auto-débitée le 1er du mois`. | US 1.2, US 1.6 | 
| **STITCH-05** | **Modale d'Ajout de Dépense & Import Facture PDF** | Pavé numérique rapide, Sélecteur de poste du mois actif, DatePicker, **Bouton d'import direct de facture PDF** et bouton dictée vocale IA. | US 1.5, US 4.3 | 
| **STITCH-06** | **Ma Réserve Domestique** | Filtres (Tous / Stock Critique `<= 1`), Cartes articles avec badge de prédiction de rupture IA et boutons rapides `-1` / `+1`. | US 2.1, US 2.2, US 2.3, US 6.4 | 
| **STITCH-07** | **Comparateur Quotidien 5 km** | Switch **"Prix min par article"** vs **"Meilleur magasin Panier Unique"**, Alternatives économiques IA, Bouton `Valider l'achat` (imputé au mois actif). | US 3.2, US 3.3, US 4.1, US 6.4 | 
| **STITCH-08** | **Page de Graphiques & Évolutions** | Sélecteur de plage (`3M`, `6M`, `12M`), **Courbe Budget vs Dépenses multi-mois**, **Donut de répartition par poste**, **Histogramme des achats & économies 5 km**, **Courbe d'inflation par produit**. | US 5.1, US 5.2 | 
| **STITCH-09** | **Coach Financier IA & Optimisations** | Jauge d'atterrissage fin de mois, Cartes d'anomalies budgétaires, Audit du ratio des charges fixes, Liste des propositions d'économies chiffrées avec bouton d'action 1-clic. | US 6.1, US 6.2, US 6.3, US 6.4 | 
| **STITCH-10** | **Hub d'Acquisition IA : Import PDF & Scanner Caméra** | Onglet **Import Facture PDF** (Glisser-déposer / Sélection fichier `.pdf` + Écran de pré-validation des articles extraits et ventilation budgétaire) & Onglet **Caméra** (Code-Barres EAN-13 + Photo Ticket OCR). | US 4.2, US 4.3, IA-06 | 