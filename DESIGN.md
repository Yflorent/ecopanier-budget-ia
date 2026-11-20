# Design System — EcoPanier & Budget IA (Google Stitch — UX v3.2)

**Projet Google Stitch ID :** `3524352228818451830`  
**Design System Stitch :** `assets/4437186412263531233` (*EcoPanier & Budget IA Design System*)  
**Version UX / PRD :** **v4.1 — Responsive Web SaaS Desktop + Mobile APK / PWA**  
**Plateforme cible :** Web Desktop (`>= 1024px`), Tablette, Mobile iOS/Android PWA & APK (`com.ecopanier.budgetia`)  
**Captures locales :** [`design/stitch/screens/`](file:///d:/Projets/Depense/design/stitch/screens) (`STITCH-01.png` à `STITCH-10.png`, `STITCH-WEB-01.png`, `STITCH-WEB-02.png`)

---

## 1. Principes Directeurs UX v3.2 ("High-Density & Zero-Clutter")

Suite aux retours d'expérience sur les grands volumes de données (30+ articles en réserve domestique, 15+ enveloppes récurrentes, 50+ transactions mensuelles), l'architecture d'interface applique **5 règles d'or d'ergonomie** :

1. **Zéro Formulaire Permanent dans les Écrans de Consultation :**
   - Aucun formulaire d'ajout ou d'édition ne doit encombrer le bas ou le haut des listes (`Réserve`, `Budget`, `Modèles Récurrents`).
   - Toute création passe exclusivement par un **Bouton d'Action Flottant (`+` FAB)** ouvrant une **Modale / Bottom Sheet** dédiée à la demande.
2. **Divulgation Progressive par Sous-Onglets Segmentés (Anti-Empilement) :**
   - Sur le **Dashboard Budget (`STITCH-03`)**, les **Jauges d'Enveloppes (`📊 Enveloppes (8)`)** et l'**Historique des Transactions (`🧾 Transactions (42)`)** ne sont **jamais** empilés verticalement sur le même écran. Un sélecteur segmenté permet de basculer instantanément de l'un à l'autre.
3. **Haute Capacité d'Affichage (30+ entrées sans fatigue de défilement) :**
   - Sur **Ma Réserve Domestique (`STITCH-06`)**, les grosses cartes saturées sont remplacées par :
     - Un **commutateur de vue** : `Vue Liste Compacte` (lignes de `52px` permettant de voir **8 à 10 produits simultanément**) ou `Vue Grille 2 colonnes`.
     - Un **regroupement par rayon pliable en accordéon** (`🔴 À racheter en priorité (4)`, `🥛 Crèmerie & Frais (8)`, `🍝 Épicerie sèche (14)`, `🧼 Entretien (6)`, `🥤 Boissons (6)`).
     - Une **barre de recherche instantanée** (`🔍 Rechercher parmi 38 produits...`) combinée à des **pilules de filtres horizontaux défilables**.
4. **Action Immédiate "1-Tap Use" Discrète & Ergonomique :**
   - Steppers compacts `[- 1 +]` alignés à droite sur chaque ligne d'article de réserve, garantissant une zone tactile confortable sans saturer visuellement la ligne.
   - **Sticky Bottom Action Bar** sur le **Comparateur 5 km (`STITCH-07`)** maintenant le total du panier, l'économie calculée et le bouton `Valider & Imputer` toujours accessibles pendant le défilement de 15+ articles.
5. **Navigation Temporelle Omniprésente & Épurée (`selectedYearMonth`) :**
   - Barre supérieure compacte `< Oct 2026 | Novembre 2026 (En cours) | Déc 2026 >` avec beaucoup d'espace blanc (`#F8FAFC`) autour de la carte Héro **Reste à vivre réel**.

---

## 2. Palette de Couleurs (Tokens Sémantiques)

### 2.1 Couleurs de Marque & Surfaces (Mode Clair & Sombre)

| Token | Mode Clair (Light) | Mode Sombre (Dark) | Usage |
| :--- | :--- | :--- | :--- |
| `primary` | `#0F766E` (Teal Émeraude Profond) | `#14B8A6` (Teal Lumineux) | Actions principales, navigation active, économies réalisées, FAB `+` |
| `secondary` | `#4F46E5` (Indigo IA) | `#818CF8` (Indigo Clair) | Coach Financier IA, prédictions Gemini, badges intelligents |
| `tertiary` | `#0284C7` (Bleu Géoloc) | `#38BDF8` (Bleu Ciel) | Comparateur 5 km, carte interactive, magasins locaux |
| `background` | `#F8FAFC` (Slate 50) | `#0F172A` (Slate 900) | Fond global aéré des écrans (Whitespace généreux) |
| `surface` | `#FFFFFF` (Blanc pur) | `#1E293B` (Slate 800) | Lignes compactes groupées, cartes Héro, Bottom Sheets |
| `surfaceVariant` | `#F1F5F9` (Slate 100) | `#334155` (Slate 700) | Barres de progression fines (`6px`), pilules de filtres, steppers |
| `textPrimary` | `#0F172A` (Slate 900) | `#F8FAFC` (Slate 50) | Montants principaux, titres, libellés d'articles |
| `textSecondary` | `#475569` (Slate 600) | `#94A3B8` (Slate 400) | Sous-titres discrets, dates, unités, prix au kg/L |

### 2.2 États Budgétaires & Alertes de Réserve

| État Sémantique | Hex | Seuil Budgétaire (US 1.5) | Ratio Charges Fixes (US 6.3) | Réserve Domestique (US 2.3) |
| :--- | :--- | :--- | :--- | :--- |
| **Sain / Confort (Vert)** | `#10B981` | `< 75 %` du plafond | `< 50 %` du revenu | `Quantité > seuil (1)` |
| **Attention / Tendu (Orange)** | `#F59E0B` | `75 % à 99 %` du plafond | `50 % à 60 %` du revenu | Approche de la date de rupture IA (`<= 3j`) |
| **Critique / Dépassé (Rouge)** | `#EF4444` | `>= 100 %` du plafond | `> 60 %` du revenu | `Quantité <= 1` (Section prioritaire *À racheter*) |

---

## 3. Typographie, Densité & Échelle Visuelle

* **Police de Titres & Montants (`headlineFont`) :** `Plus Jakarta Sans` (SemiBold 600 / Bold 700) avec `font-variant-numeric: tabular-nums` pour un alignement vertical irréprochable des colonnes de montants (`€`, `FCFA`, `$`, `CAD`).
* **Police de Corps (`bodyFont`) :** `Inter` (Regular 400 / Medium 500) — optimisée pour les lignes compactes de `52px` de hauteur.
* **Police d'Étiquettes & Badges (`labelFont`) :** `Space Grotesk` / `Inter` (Medium 500 / SemiBold 600).
* **Gabarits de Densité UX v3.2 :**
  * **Hauteur de ligne compacte (`CompactRow`) :** `52px` à `56px` (contre `110px+` en v3.1), permettant d'afficher **8 à 10 entrées par écran**.
  * **Jauges de progression :** Fines barres de `6px` intégrées à la ligne du poste budgétaire.
  * **Rayon de bordure (`roundness`) :** `12px` pour les conteneurs de groupes et boutons, `16px` pour la carte Héro, `9999px` pour les pilules de filtre.

---

## 4. Composants Réutilisables Clés (UX v3.2)

1. **`MonthSelectorBar` :** Sélecteur horizontal compact `< Oct. 2026 | Novembre 2026 (En cours) | Déc. 2026 >`.
2. **`DisposableIncomeHeroCard` :** Carte maîtresse épurée affichant le **Reste à vivre réel** (`1 140,00 €`), la pilule prédictive Gemini (`Atterrissage 30 Nov : +165 €`) et 3 mini-indicateurs en ligne (`Budget 2 500 € • Fixes 980 € • Variables 380 €`).
3. **`SegmentedSubTabs` :** Commutateur de vue local (`📊 Enveloppes (8)` | `🧾 Transactions (42)` sur le Budget ; `Tous (12)` | `Charges Fixes (5)` | `Variables (7)` sur les Modèles Récurrents).
4. **`CompactPantryAccordion` & `ViewModeToggle` :** Composant de réserve haute capacité supportant 30 à 100+ références avec recherche instantanée, pilules de rayons horizontales, sections accordéon pliables, bascule `Liste Compacte / Grille 2 col`, et stepper `[- 1 +]`.
5. **`StickyComparisonFooter` :** Barre d'action collante en bas du comparateur 5 km affichant le total du panier, l'économie totale et le CTA `Valider & Imputer` sans masquer la liste tabulaire des produits.
6. **`OnDemandBottomSheetModal` + `FloatingActionButton` (`+` FAB) :** Modale déclenchée à la demande pour ajouter un article en réserve, un modèle récurrent ou une dépense, libérant 100 % de l'écran de consultation.

---

## 5. Spécifications des 10 Écrans Google Stitch (`STITCH-01` à `STITCH-10`)

| Code | Titre de l'Écran | Screen ID Stitch (Actif) | Capture Locale | Points Clés UX v3.2 |
| :--- | :--- | :--- | :--- | :--- |
| **STITCH-01** | **Écran d'Authentification** | `aaaf2a85594e4b7fa0918439fbd05f66` | [`STITCH-01.png`](file:///d:/Projets/Depense/design/stitch/screens/STITCH-01.png) | Connexion Email/Mot de passe, OAuth Google/Apple, biométrie FaceID, proposition de valeur claire. |
| **STITCH-02** | **Profil & Internationalisation** | `42d928af814c4c14a7aa266e53203fb6` | [`STITCH-02.png`](file:///d:/Projets/Depense/design/stitch/screens/STITCH-02.png) | Sélecteur Langue (`FR`/`EN`) & Devise (`€`/`FCFA`/`$`/`CAD`), heure batch `17:30`, carte rayon 5 km. |
| **STITCH-03** | **Dashboard Budget Mensuel (UX v3.2 Aéré & Progressif)** | `3b601652acef44389fe01028ddb990cd` | [`STITCH-03.png`](file:///d:/Projets/Depense/design/stitch/screens/STITCH-03.png) | Whitespace généreux, Carte Héro épurée, sous-onglets `Enveloppes (8)` vs `Transactions (42)` (zéro empilement), jauges fines triées par priorité, FAB `+`. |
| **STITCH-04** | **Modèles de Postes Récurrents (UX v3.2 Haute Densité)** | `16fda7264d4c493995ad86aa5da95ea2` | [`STITCH-04.png`](file:///d:/Projets/Depense/design/stitch/screens/STITCH-04.png) | Synthèse plafond, onglets `Tous / Charges Fixes / Variables`, lignes compactes avec switches `Reconduire 1er` & `Auto-débit`, zéro formulaire permanent, FAB `+`. |
| **STITCH-05** | **Modale d'Ajout de Dépense & Import Facture PDF** | `9e7e3d7313dd4d9f9cccade342d1ea14` | [`STITCH-05.png`](file:///d:/Projets/Depense/design/stitch/screens/STITCH-05.png) | Pavé numérique rapide, sélecteur horizontal de poste, import direct PDF Drive/e-Ticket et dictée vocale IA. |
| **STITCH-06** | **Ma Réserve Domestique (UX v3.2 Haute Capacité 30+ art.)** | `6246a45de7014870823241c3722fb072` | [`STITCH-06.png`](file:///d:/Projets/Depense/design/stitch/screens/STITCH-06.png) | Recherche sur 38+ produits, pilules de rayons défilables, accordéons pliables, lignes compactes (`52px`, 8-10 visibles d'un coup), steppers `[- 1 +]`, FAB `+`. |
| **STITCH-07** | **Comparateur Quotidien 5 km (UX v3.2 Compact & Sticky Bar)** | `13ebebda467e4317a8002e893be75a2c` | [`STITCH-07.png`](file:///d:/Projets/Depense/design/stitch/screens/STITCH-07.png) | Switch `Panier Unique` vs `Multi-Enseignes`, bandeau IA substitutions MDD repliable, table compacte d'articles et **Sticky Bottom Bar** de validation. |
| **STITCH-08** | **Page de Graphiques & Évolutions Multi-Mois** | `fefcbafa43854395ab27f54aa58df102` | [`STITCH-08.png`](file:///d:/Projets/Depense/design/stitch/screens/STITCH-08.png) | Sélecteur `3M / 6M / 12M`, Histogramme Budget vs Dépensé, Donut par poste, Économies 5 km, Inflation produit. |
| **STITCH-09** | **Coach Financier IA & Chef Réserve Zéro-Dépense (UX v3.3)** | `e07dc86b4ea540dd9f9066efaa4b7ad4` | [`STITCH-09_coach_ai.png`](file:///d:/Projets/Depense/design/stitch/screens/STITCH-09_coach_ai.png) | Sous-onglets `Diagnostic Budget (4)` vs `Chef Réserve IA (8)`, CTA `✨ Repenser les recettes avec l'IA (selon mon stock)`, pilules multi-gastronomie (`🌍 Toutes (8)`, `🇫🇷 Française (2)`, `🇨🇲 Camerounaise (2)`, `🇲🇦 Maghrébine (2)`, `🥢 Asiatique (2)`), cartes recettes compactes avec bouton `🍽️ Cuisiner (-1 stock)`. |
| **STITCH-10** | **Hub d'Acquisition IA : Import PDF & Scanner Caméra** | `941424569bae4fbaadc0275b6210754d` | [`STITCH-10.png`](file:///d:/Projets/Depense/design/stitch/screens/STITCH-10.png) | Onglets `Import Facture PDF` & `Scanner Caméra`, pré-validation Gemini 2.5 Flash avec cases à cocher pour la réserve et ventilation automatique. |

---

## 6. Architecture Responsive Web Desktop (`STITCH-WEB-01` & `STITCH-WEB-02`)

Pour corriger l'effet « couloir mobile de 430 px » sur navigateur Desktop, l'interface bascule automatiquement vers une architecture **Web SaaS pleine largeur** dès `768px` (Split-Screen Auth) et `1024px` (App Shell avec Sidebar fixe + Grille Bento multi-colonnes) :

| Code | Titre de l'Écran | Screen ID Stitch | Captures & Code HTML | Points Clés Architecture Web Desktop |
| :--- | :--- | :--- | :--- | :--- |
| **STITCH-WEB-01** | **Portail Web SaaS & Authentification Split-Screen** | `f042c69edbb84f968ac7e57272fedfd8` | [`STITCH-WEB-01.png`](file:///d:/Projets/Depense/design/stitch/screens/STITCH-WEB-01.png) / [`STITCH-WEB-01.html`](file:///d:/Projets/Depense/design/stitch/screens/STITCH-WEB-01.html) | Topbar épurée, Split-Screen `58% / 42%` : vitrine Héro 4 piliers + bandeau APK Android à gauche, carte Connexion/Inscription + Démo 1-clic + Code PIN Invité + RGPD à droite. |
| **STITCH-WEB-02** | **Dashboard Web SaaS Multi-Colonnes** | `b314d61ed42344a5aa3fb18c4a8158fb` | [`STITCH-WEB-02.png`](file:///d:/Projets/Depense/design/stitch/screens/STITCH-WEB-02.png) / [`STITCH-WEB-02.html`](file:///d:/Projets/Depense/design/stitch/screens/STITCH-WEB-02.html) | Sidebar fixe `272px` à gauche, Topbar sticky avec sélecteur de mois et CTA rapides, Grille KPI 4 colonnes, Enveloppes (grille 2 col.) et Transactions affichées simultanément côte à côte sans onglet caché, modales centrées. |
