/**
 * Registre Architectural des 10 Écrans Google Stitch (Section 2 & Section 6 du PRD v3.1)
 *
 * RÈGLE D'INGÉNIERIE OBLIGATOIRE (Section 2) :
 * Chaque route mobile est liée à son identifiant de maquette Google Stitch (`STITCH-01` à `STITCH-10`)
 * dans le projet Stitch `3524352228818451830` (Design System `assets/4437186412263531233`)
 * et à ses services/repositories métier.
 */

export type StitchScreenCode =
  | 'STITCH-01'
  | 'STITCH-02'
  | 'STITCH-03'
  | 'STITCH-04'
  | 'STITCH-05'
  | 'STITCH-06'
  | 'STITCH-07'
  | 'STITCH-08'
  | 'STITCH-09'
  | 'STITCH-10';

export interface StitchScreenArchitecturalSpec {
  code: StitchScreenCode;
  stitchProjectId: string;
  stitchScreenId: string;
  routeName: string;
  titleFr: string;
  userStories: string[];
  requiresTemporalMonthSelector: boolean;
  boundRepositoriesAndServices: string[];
}

export const STITCH_SCREEN_ARCHITECTURAL_REGISTRY: Record<
  StitchScreenCode,
  StitchScreenArchitecturalSpec
> = {
  'STITCH-01': {
    code: 'STITCH-01',
    stitchProjectId: '3524352228818451830',
    stitchScreenId: 'aaaf2a85594e4b7fa0918439fbd05f66',
    routeName: 'AuthScreen',
    titleFr: 'Authentification (Login, Inscription, Google/Apple, Biométrie)',
    userStories: ['US 0.1', 'US 0.2'],
    requiresTemporalMonthSelector: false,
    boundRepositoriesAndServices: [
      'FirebaseAuthService',
      'BudgetRepository.ensureMonthPageExistsLazyInit',
    ],
  },
  'STITCH-02': {
    code: 'STITCH-02',
    stitchProjectId: '3524352228818451830',
    stitchScreenId: '42d928af814c4c14a7aa266e53203fb6',
    routeName: 'ProfileAndGeoSettingsScreen',
    titleFr: 'Profil, Internationalisation (FR/EN, Devises) & Carte Rayon 5 km',
    userStories: ['US 0.3', 'US 0.4', 'US 3.1'],
    requiresTemporalMonthSelector: false,
    boundRepositoriesAndServices: [
      'TemporalBudgetStore.setLocaleAndCurrency',
      'encodeGeohash',
      'filterStoresWithinRadiusKm',
    ],
  },
  'STITCH-03': {
    code: 'STITCH-03',
    stitchProjectId: '3524352228818451830',
    stitchScreenId: '3b5b56d739914368ac35186266b07333',
    routeName: 'MonthlyBudgetDashboardScreen',
    titleFr: 'Dashboard Budget Mensuel & Navigation Inter-Mois (< M-1 | M | M+1 >)',
    userStories: ['US 1.1', 'US 1.3', 'US 1.4', 'US 1.5', 'US 6.1'],
    requiresTemporalMonthSelector: true,
    boundRepositoriesAndServices: [
      'TemporalBudgetStore',
      'BudgetRepository',
      'predictEndOfMonthLanding',
    ],
  },
  'STITCH-04': {
    code: 'STITCH-04',
    stitchProjectId: '3524352228818451830',
    stitchScreenId: '4cfc0cfdf23845a48457e6ff4ba7f70c',
    routeName: 'RecurringCategoryTemplatesScreen',
    titleFr: 'Modèles de Postes Récurrents ("Zéro Ressaisie")',
    userStories: ['US 1.2', 'US 1.6'],
    requiresTemporalMonthSelector: false,
    boundRepositoriesAndServices: [
      'BudgetRepository.updateCategoryLimit',
      'buildInitialMonthlyBudgetRollover',
    ],
  },
  'STITCH-05': {
    code: 'STITCH-05',
    stitchProjectId: '3524352228818451830',
    stitchScreenId: '9e7e3d7313dd4d9f9cccade342d1ea14',
    routeName: 'QuickAddExpenseAndPdfModal',
    titleFr: 'Modale d’Ajout de Dépense & Import Direct Facture PDF',
    userStories: ['US 1.5', 'US 4.3'],
    requiresTemporalMonthSelector: true,
    boundRepositoriesAndServices: [
      'BudgetRepository.addExpenseToDateMonth',
      'PdfInvoiceShareService.pickAndExtractPdfInvoice',
    ],
  },
  'STITCH-06': {
    code: 'STITCH-06',
    stitchProjectId: '3524352228818451830',
    stitchScreenId: 'ceb1e6bcd00b450587b25d5a7a2b6ade',
    routeName: 'HouseholdPantryScreen',
    titleFr: 'Ma Réserve Domestique ("1-Tap Use" -1/+1 & Alertes Stock <= 1)',
    userStories: ['US 2.1', 'US 2.2', 'US 2.3', 'US 6.4'],
    requiresTemporalMonthSelector: true,
    boundRepositoriesAndServices: [
      'PantryRepository.decrementOrIncrementOneTap',
      'computeSmartDepletionPrediction',
    ],
  },
  'STITCH-07': {
    code: 'STITCH-07',
    stitchProjectId: '3524352228818451830',
    stitchScreenId: '89a2d877a9b34b939979dd20bd0a7924',
    routeName: 'Daily5kmPriceComparatorScreen',
    titleFr: 'Comparateur Quotidien 5 km (Par Article vs Panier Unique)',
    userStories: ['US 3.2', 'US 3.3', 'US 4.1', 'US 6.4'],
    requiresTemporalMonthSelector: true,
    boundRepositoriesAndServices: [
      'computeDaily5kmBasketComparison',
      'PantryRepository.validate5kmComparatorPurchaseAtomic',
    ],
  },
  'STITCH-08': {
    code: 'STITCH-08',
    stitchProjectId: '3524352228818451830',
    stitchScreenId: 'fefcbafa43854395ab27f54aa58df102',
    routeName: 'MultiMonthAnalyticsChartsScreen',
    titleFr: 'Page de Graphiques & Évolutions Multi-Mois (3M, 6M, 12M)',
    userStories: ['US 5.1', 'US 5.2'],
    requiresTemporalMonthSelector: true,
    boundRepositoriesAndServices: [
      'buildMultiMonthAnalyticsSeries',
      'getHistoricalYearMonthsRange',
    ],
  },
  'STITCH-09': {
    code: 'STITCH-09',
    stitchProjectId: '3524352228818451830',
    stitchScreenId: 'c816a4e350364806b5394e09db7279ad',
    routeName: 'FinancialCoachAiScreen',
    titleFr: 'Coach Financier IA & Optimisations (Atterrissage, Fuites, Charges Fixes)',
    userStories: ['US 6.1', 'US 6.2', 'US 6.3', 'US 6.4'],
    requiresTemporalMonthSelector: true,
    boundRepositoriesAndServices: [
      'generateMonthlyFinancialCoachInsights',
      'auditFixedChargesRatio',
      'detectCategorySpendingDrift',
    ],
  },
  'STITCH-10': {
    code: 'STITCH-10',
    stitchProjectId: '3524352228818451830',
    stitchScreenId: '941424569bae4fbaadc0275b6210754d',
    routeName: 'AiAcquisitionHubPdfAndScannerScreen',
    titleFr: 'Hub d’Acquisition IA : Import Facture PDF (Pré-validation) & Scanner Caméra',
    userStories: ['US 4.2', 'US 4.3', 'IA-06', 'IA-07'],
    requiresTemporalMonthSelector: true,
    boundRepositoriesAndServices: [
      'PdfInvoiceShareService',
      'commitPrevalidatedInvoice',
      'computeInvoiceFingerprint',
    ],
  },
};
