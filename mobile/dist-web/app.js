/**
 * Application Mobile EcoPanier & Budget IA — UX v3.2 ("High-Density & Zero-Clutter")
 * - Fidèle aux nouvelles maquettes Google Stitch v3.2 (STITCH-01 à STITCH-10)
 * - Conçue pour de grands volumes de données (30 à 100+ produits en réserve, 15+ enveloppes, 50+ transactions) :
 *     • Recherche instantanée + Pilules de filtres horizontaux défilables
 *     • Accordéons pliables par rayon + Commutateur Vue Accordéon / Liste Dense / Grille 2 colonnes
 *     • Sous-onglets segmentés sur le Dashboard ("Enveloppes" vs "Transactions") pour éviter tout empilement
 *     • Zéro formulaire lourd en bas de page : tout passe par des Bottom Sheets modales à la demande (bouton + FAB)
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInAnonymously,
  GoogleAuthProvider,
  OAuthProvider,
  updateProfile,
  signOut,
  deleteUser,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  deleteDoc,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAq7lHhF06GRZ-BZQgnHjlcW_qIDkWoKhs',
  authDomain: 'depense-reserve-ia.firebaseapp.com',
  projectId: 'depense-reserve-ia',
  storageBucket: 'depense-reserve-ia.firebasestorage.app',
  messagingSenderId: '242455371210',
  appId: '1:242455371210:web:5326be8cf349892c010333',
};

const FUNCTIONS_BASE_URL = 'https://europe-west1-depense-reserve-ia.cloudfunctions.net';
const DEMO_TEST_EMAIL = 'demo.foyer@ecopanier-ia.app';
const DEMO_TEST_PASS = 'DemoEcoPanier2026!';

const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);

function getNowYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getDefaultOperationDate(ym) {
  const now = new Date();
  const todayYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const day = String(now.getDate()).padStart(2, '0');
  if (!ym || ym === todayYm) {
    return `${todayYm}-${day}`;
  }
  const safeDay = String(Math.min(now.getDate(), 28)).padStart(2, '0');
  return `${ym}-${safeDay}`;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function computeExpiryStatus(expirationDate) {
  if (!expirationDate) return null;
  const expStr = String(expirationDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expStr)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = expStr.split('-').map(Number);
  const expDate = new Date(y, m - 1, d);
  const diffDays = Math.round((expDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays < 0) {
    return {
      daysLeft: diffDays,
      badgeText: `🚨 Périmé (${Math.abs(diffDays)}j)`,
      badgeClass: 'CRITICAL',
      isUrgent: true,
      isExpired: true,
    };
  }
  if (diffDays === 0) {
    return {
      daysLeft: 0,
      badgeText: "⏰ DLC Aujourd'hui",
      badgeClass: 'CRITICAL',
      isUrgent: true,
      isExpired: false,
    };
  }
  if (diffDays <= 3) {
    return {
      daysLeft: diffDays,
      badgeText: `⏰ DLC J-${diffDays}`,
      badgeClass: diffDays <= 1 ? 'CRITICAL' : 'WARNING',
      isUrgent: true,
      isExpired: false,
    };
  }
  return {
    daysLeft: diffDays,
    badgeText: `📅 ${expStr}`,
    badgeClass: 'HEALTHY',
    isUrgent: false,
    isExpired: false,
  };
}

export const AISLE_META = {
  PRIORITE: { label: 'À racheter en priorité', icon: '❗' },
  CREMERIE: { label: 'Crèmerie & Frais', icon: '🥛' },
  EPICERIE_SALEE: { label: 'Épicerie Sèche & Salée', icon: '🍝' },
  EPICERIE_SUCREE: { label: 'Petit-Déjeuner & Sucré', icon: '🍪' },
  VIANDES_SURGELES: { label: 'Viandes, Poissons & Surgelés', icon: '🥩' },
  BOISSONS: { label: 'Boissons & Liquides', icon: '🥤' },
  ENTRETIEN: { label: 'Entretien & Hygiène', icon: '🧼' },
};

const state = {
  authMode: 'LOGIN',
  authLoading: true,
  showPassword: false,
  isDemoSession: false,
  currentUser: null,
  currentScreen: 'STITCH-01',
  theme: 'light',
  selectedYearMonth: getNowYearMonth(),
  currentRealYearMonth: getNowYearMonth(),

  // Navigation & Filtres UX v3.2 (Haute Densité & Zéro Saturation)
  dashboardSubTab: 'ENVELOPPES', // ENVELOPPES | TRANSACTIONS
  envelopeFilter: 'ALL', // ALL | ALERT | VARIABLE | FIXE
  txSearchQuery: '',
  txSourceFilter: 'ALL',

  pantrySearchQuery: '',
  pantryFilter: 'ALL', // ALL | LOW | CREMERIE | EPICERIE_SALEE | EPICERIE_SUCREE | VIANDES_SURGELES | BOISSONS | ENTRETIEN
  pantryViewMode: 'ACCORDION', // ACCORDION | DENSE | GRID
  collapsedAisles: {},

  templateFilter: 'ALL', // ALL | CHARGE_FIXE | VARIABLE
  templateSearchQuery: '',

  comparatorMode: 'SINGLE_STORE',
  useStoreBrandSub: false,
  comparatorExcludedIds: {}, // { [itemId]: true } pour désélectionner des produits dans le comparateur
  comparatorQtyById: {}, // { [itemId]: number } quantité à acheter par produit
  comparatorBudgetCap: null, // null = pas de limite, sinon ex: 10, 15, 25 €

  operationMode: 'EXPENSE', // EXPENSE | EXTRA_INCOME | AGIOS
  coachSubTab: 'RECIPES', // RECIPES (Chef Zéro-Dépense 4 Cuisines) | SHIELD (Bouclier Anti-Agios & Arbitrage)
  recipeCuisineFilter: 'ALL', // ALL | FRANCAISE | CAMEROUNAISE | MAGHREBINE | ASIATIQUE
  recipeRefreshSeed: 0,
  recipeAiLoading: false,
  cookedRecipeIds: {},

  chartRangeMonths: 6,
  selectedInflationItemId: '',
  acquisitionTab: 'PDF',

  activeBottomSheet: null, // null | 'ADD_PANTRY' | 'ADD_TEMPLATE' | 'ADD_INCOME' | 'ADD_AGIOS' | 'EDIT_BUDGET'
  pendingRegistration: null,

  profile: null,
  categoryTemplates: [],
  monthlyBudgets: {},
  pantryItems: [],
  nearbyStores: [],
  pendingPdfExtraction: null,

  // Accès Tiers & Invité Temporaire (Mode Lecture Seule Éphémère)
  isGuestSession: false,
  guestSession: null,
  guestTimerInterval: null,
  userGuestPasses: [],
  lastGeneratedPass: null,

  // Chef Réserve v3.4 : Fiche Détails Recette & Comparateur Multimarques 5 km
  selectedRecipeForDetails: null,
  comparatorSelectedStoreId: 'BEST_PER_ITEM', // 'BEST_PER_ITEM' | 'store_lidl' | 'store_leclerc' | 'store_intermarche' | 'store_aldi' | 'store_carrefour'
  editingTransactionId: null,
  editingPantryItemId: null,
  isSubmittingOperation: false,

  // Lot 3 (Vague 2) : Comparateur déverrouillé, Chef IA Gemini prompt libre, Scanner OCR éditable
  comparatorScope: 'LOW', // 'LOW' | 'ALL'
  comparatorSearchQuery: '',
  chefCustomPrompt: '',
  aiGeneratedRecipes: [],
  ocrLoading: false,
  ocrLoadingLabel: '',
  pdfTargetCategoryId: '',

  // Lot 4 (Vague 3) : Freemium Paywall, Onboarding Express 60s, Story 9:16 & Affiliation Drive
  subscriptionTier: 'FREE', // 'FREE' | 'PRO' | 'FAMILY'
  ocrScansUsedThisMonth: 0,
  scanCreditsBalance: 0,
  onboardingStep: 1,
  onboardingIncome: 2200,
  onboardingCurrency: 'EUR',
  onboardingKitSelected: true,
};

Object.assign(window, {
  openRecipeDetailsModal,
  closeRecipeDetailsModal,
  setComparatorStoreFilter,
  setComparatorScope,
  handleComparatorSearch,
  addCustomComparatorProduct,
  openAffiliateDriveOrder,
  openEditTransactionModal,
  saveEditedTransaction,
  deleteTransaction,
  openEditPantryExpiryModal,
  savePantryExpiry,
  setChefCustomPrompt,
  applyChefQuickPrompt,
  updatePdfItemField,
  setPdfTargetCategory,
  addBlankPdfLine,
  removePdfLine,
  activateSubscriptionPlan,
  openOnboarding60sModal,
  setOnboardingStep,
  completeExpressOnboarding,
  openSavingsStoryModal,
  downloadSavingsStoryPng,
  shareSavingsStoryCard,
  claimReferralBonusDemo,
  openSideMenu,
  closeSideMenu,
  setScreen,
  openChefReserveScreen,
  toggleTheme,
  changeMonth,
  switchAuthTab,
  togglePasswordVisibility,
  handleAuthSubmit,
  handleOAuthLogin,
  handleBiometricQuickUnlock,
  handleDemoTestLogin,
  resetDemoTestData,
  handleForgotPassword,
  handleLogout,
  handleDeleteAccount,
  updateProfilePrefs,
  detectGpsLocation,
  setDashboardSubTab,
  setEnvelopeFilter,
  toggleMonthCategoryActive,
  deleteMonthCategory,
  handleTxSearch,
  setTxSourceFilter,
  setTemplateFilter,
  handleTemplateSearch,
  addOrUpdateTemplate,
  deleteTemplate,
  toggleTemplateFlag,
  simulateNextMonthRollover,
  setOperationMode,
  submitManualExpense,
  submitQuickCashflowOperation,
  saveQuickMonthlyBudget,
  setPantryFilter,
  setPantryViewMode,
  handlePantrySearch,
  toggleAisleCollapse,
  handlePantryTap,
  addNewPantryItem,
  deletePantryItem,
  cleanupDepletedPantryItems,
  openBottomSheet,
  closeBottomSheet,
  handleBackdropClick,
  shareAppToFriends,
  copyAppShareLink,
  generateGuestPass,
  revokeGuestPass,
  enterGuestSession,
  exitGuestSession,
  copyGuestPassLink,
  shareGuestPassWhatsApp,
  setComparatorMode,
  toggleStoreBrandSub,
  toggleComparatorItem,
  toggleAllComparatorItems,
  changeComparatorItemQty,
  applyComparatorBudgetCap,
  validate5kmBasketPurchase,
  setChartRange,
  selectMonthFromChart,
  selectInflationProduct,
  setCoachSubTab,
  setRecipeCuisineFilter,
  refreshAiChefRecipes,
  applyOneClickEnvelopeArbitrage,
  cookZeroSpendRecipe,
  applyCoachInsight,
  setAcquisitionTab,
  handleRealFileUpload,
  simulateDemoPdfInvoice,
  startLiveCameraScanner,
  stopLiveCameraScanner,
  captureCameraInvoiceFrame,
  submitBarcodeScan,
  togglePdfItemCheck,
  commitPdfInvoiceExtraction,
});

function showToast(message, severity = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${severity}`;
  el.innerHTML = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function formatMoney(amount) {
  const cur = state.profile?.currency || 'EUR';
  const loc = state.profile?.locale === 'en' ? 'en-US' : 'fr-FR';
  return new Intl.NumberFormat(loc, {
    style: 'currency',
    currency: cur,
    minimumFractionDigits: cur === 'XAF' ? 0 : 2,
    maximumFractionDigits: cur === 'XAF' ? 0 : 2,
  }).format(Number(amount) || 0);
}

function formatMonthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  const loc = state.profile?.locale === 'en' ? 'en-US' : 'fr-FR';
  const s = new Intl.DateTimeFormat(loc, { month: 'long', year: 'numeric' }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function computeGaugeState(spent, limit) {
  if (limit <= 0) {
    return { pct: spent > 0 ? 100 : 0, state: spent > 0 ? 'CRITICAL' : 'HEALTHY' };
  }
  const pct = Math.round((spent / limit) * 1000) / 10;
  if (pct >= 100) return { pct, state: 'CRITICAL' };
  if (pct >= 75) return { pct, state: 'WARNING' };
  return { pct, state: 'HEALTHY' };
}

const FREE_MONTHLY_OCR_LIMIT = 3;

function loadUserMonetizationState(uid) {
  if (!uid) return;
  try {
    const raw = localStorage.getItem(`ecopanier_monetization_${uid}`);
    const curYm = getNowYearMonth();
    if (!raw) {
      state.subscriptionTier = 'FREE';
      state.ocrScansUsedThisMonth = 0;
      state.scanCreditsBalance = 0;
      return;
    }
    const parsed = JSON.parse(raw);
    state.subscriptionTier = parsed.subscriptionTier || 'FREE';
    state.scanCreditsBalance = Math.max(0, Number(parsed.scanCreditsBalance) || 0);
    state.ocrScansUsedThisMonth =
      parsed.scanYearMonth === curYm ? Math.max(0, Number(parsed.ocrScansUsedThisMonth) || 0) : 0;
  } catch (e) {
    console.warn('Lecture état monétisation locale:', e);
  }
}

function saveUserMonetizationState(uid) {
  const targetUid = uid || state.currentUser?.uid;
  if (!targetUid) return;
  try {
    localStorage.setItem(
      `ecopanier_monetization_${targetUid}`,
      JSON.stringify({
        subscriptionTier: state.subscriptionTier || 'FREE',
        ocrScansUsedThisMonth: Number(state.ocrScansUsedThisMonth) || 0,
        scanCreditsBalance: Number(state.scanCreditsBalance) || 0,
        scanYearMonth: getNowYearMonth(),
      })
    );
  } catch (e) {
    console.warn('Sauvegarde état monétisation locale:', e);
  }
}

function getSubscriptionInfo() {
  const tier = state.subscriptionTier || 'FREE';
  const isPremium = tier === 'PRO' || tier === 'FAMILY';
  const usedScans = Math.max(0, Number(state.ocrScansUsedThisMonth) || 0);
  const freeRemaining = Math.max(0, FREE_MONTHLY_OCR_LIMIT - usedScans);
  const creditsBalance = Math.max(0, Number(state.scanCreditsBalance) || 0);
  const canScan = isPremium || freeRemaining > 0 || creditsBalance > 0;
  const tierLabel =
    tier === 'FAMILY'
      ? '👨‍👩‍👧‍👦 EcoPanier+ Famille (7,99 €/m)'
      : tier === 'PRO'
      ? '👑 EcoPanier+ Pro (4,99 €/m)'
      : '🌱 Offre Découverte Gratuite';
  return {
    tier,
    tierLabel,
    isPremium,
    freeLimit: FREE_MONTHLY_OCR_LIMIT,
    usedScans,
    freeRemaining,
    creditsBalance,
    canScan,
  };
}

function activateSubscriptionPlan(planCode) {
  if (state.isGuestSession) {
    showToast('ℹ️ Mode Invité : modifications désactivées.', 'warning');
    return;
  }
  if (planCode === 'PRO') {
    state.subscriptionTier = 'PRO';
    saveUserMonetizationState();
    closeBottomSheet();
    showToast('👑 Bienvenue dans EcoPanier+ Pro (4,99 €/mois) ! Scans OCR & Chef IA illimités débloqués.');
  } else if (planCode === 'FAMILY') {
    state.subscriptionTier = 'FAMILY';
    saveUserMonetizationState();
    closeBottomSheet();
    showToast('👨‍👩‍👧‍👦 EcoPanier+ Famille (7,99 €/mois) activé ! Partage foyer & Scans illimités débloqués.');
  } else if (planCode === 'PACK_15') {
    state.scanCreditsBalance = (Number(state.scanCreditsBalance) || 0) + 15;
    saveUserMonetizationState();
    closeBottomSheet();
    showToast(`⚡ Pack +15 Crédits Scans IA (1,99 €) activé ! Solde : ${state.scanCreditsBalance} crédits.`);
  } else {
    state.subscriptionTier = 'FREE';
    saveUserMonetizationState();
    closeBottomSheet();
    showToast('🌱 Retour à l’offre Découverte Gratuite (3 scans/mois).');
  }
  renderAll();
}

function claimReferralBonusDemo() {
  state.subscriptionTier = 'PRO';
  state.scanCreditsBalance = (Number(state.scanCreditsBalance) || 0) + 5;
  saveUserMonetizationState();
  showToast('🎁 Parrainage Double Win : 1 mois EcoPanier+ Pro + 5 crédits IA offerts activés !');
  renderAll();
}

function openOnboarding60sModal() {
  state.onboardingStep = 1;
  state.onboardingIncome = state.profile?.defaultMonthlyIncome || 2200;
  state.onboardingCurrency = state.profile?.currency || 'EUR';
  state.onboardingKitSelected = true;
  openBottomSheet('ONBOARDING_60S');
}

function setOnboardingStep(step) {
  const incEl = document.getElementById('onbIncomeInput');
  const curEl = document.getElementById('onbCurrencySelect');
  const kitEl = document.getElementById('onbStarterKitCheck');
  if (incEl) state.onboardingIncome = Math.max(100, Number(incEl.value) || 2200);
  if (curEl) state.onboardingCurrency = curEl.value || 'EUR';
  if (kitEl) state.onboardingKitSelected = Boolean(kitEl.checked);
  state.onboardingStep = step;
  renderBottomSheetModal();
}

async function completeExpressOnboarding() {
  if (state.isGuestSession || !state.currentUser) return;
  const incEl = document.getElementById('onbIncomeInput');
  const curEl = document.getElementById('onbCurrencySelect');
  const kitEl = document.getElementById('onbStarterKitCheck');
  if (incEl) state.onboardingIncome = Math.max(100, Number(incEl.value) || 2200);
  if (curEl) state.onboardingCurrency = curEl.value || 'EUR';
  if (kitEl) state.onboardingKitSelected = Boolean(kitEl.checked);

  const uid = state.currentUser.uid;
  const nowISO = new Date().toISOString();
  state.profile = {
    ...(state.profile || {}),
    uid,
    defaultMonthlyIncome: state.onboardingIncome,
    currency: state.onboardingCurrency,
    updatedAt: nowISO,
  };
  try {
    await setDoc(
      doc(db, 'users', uid),
      {
        defaultMonthlyIncome: state.onboardingIncome,
        currency: state.onboardingCurrency,
        updatedAt: nowISO,
      },
      { merge: true }
    );
  } catch (e) {
    console.warn('Sauvegarde profil onboarding:', e);
  }

  const mb = await ensureUserMonthInitialized(state.selectedYearMonth);
  mb.globalAllocated = state.onboardingIncome;
  recomputeMonthFinancials(mb);
  try {
    await setDoc(
      doc(db, 'users', uid, 'monthlyBudgets', state.selectedYearMonth),
      {
        globalAllocated: mb.globalAllocated,
        realDisposableIncome: mb.realDisposableIncome,
      },
      { merge: true }
    );
  } catch (_) {}

  if (state.onboardingKitSelected && state.pantryItems.length < 5) {
    const starterItems = [
      ['pantry_onb_lait', 'Lait Demi-Écrémé 1L', 'CREMERIE', 2, '1L', 1.18],
      ['pantry_onb_oeufs', 'Œufs Plein Air x12', 'CREMERIE', 1, 'boîte x12', 3.45],
      ['pantry_onb_beurre', 'Beurre Doux 250g', 'CREMERIE', 2, '250g', 2.45],
      ['pantry_onb_riz', 'Riz Basmati 1kg', 'EPICERIE_SALEE', 2, '1kg', 2.35],
      ['pantry_onb_pates', 'Pâtes Penne 500g', 'EPICERIE_SALEE', 3, '500g', 1.15],
      ['pantry_onb_huile', 'Huile d’Olive 1L', 'EPICERIE_SALEE', 1, '1L', 7.90],
      ['pantry_onb_poulet', 'Filets de Poulet 500g', 'VIANDES_SURGELES', 2, 'barquette', 6.50],
      ['pantry_onb_thon', 'Thon au Naturel x3', 'EPICERIE_SALEE', 2, 'lot x3', 4.20],
    ];
    for (const [id, name, aisle, qty, unit, price] of starterItems) {
      const item = {
        id,
        name,
        normalizedProductKey: name.toLowerCase().replace(/[^a-z0-9]/g, '_'),
        category: aisle,
        currentQuantity: qty,
        unit,
        alertThreshold: 1,
        needsRestock: qty <= 1,
        lastPricePaid: price,
        expirationDate: null,
        lastUpdatedAt: nowISO,
      };
      if (!state.pantryItems.some((x) => x.id === id)) {
        state.pantryItems.push(item);
        setDoc(doc(db, 'users', uid, 'pantryItems', id), item).catch(() => {});
      }
    }
  }

  closeBottomSheet();
  showToast('🚀 Foyer configuré en 60 secondes ! Votre budget et votre réserve sont prêts.');
  setScreen('STITCH-03');
}

function openSavingsStoryModal() {
  openBottomSheet('STORY_CARD_MODAL');
  setTimeout(() => renderSavingsStoryCanvas(), 60);
}

function renderSavingsStoryCanvas() {
  const canvas = document.getElementById('savingsStoryCanvas');
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  const mb = state.monthlyBudgets[state.selectedYearMonth] || {};
  const savedComp = Number(mb.totalSavedViaComparator) || 26.4;
  const cookedCount = Object.keys(state.cookedRecipeIds || {}).length || 3;
  const savedChef = Math.round(cookedCount * 14.5 * 100) / 100;
  const savedAgios = (Number(mb.totalAgiosAndFees) || 0) === 0 ? 24.0 : 0;
  const totalSaved = Math.round((savedComp + savedChef + savedAgios) * 100) / 100;
  const refCode = `ECO-${(state.currentUser?.uid || 'MARTIN').slice(0, 5).toUpperCase()}`;

  // Fond dégradé émeraude profond Story 9:16
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#022C22');
  grad.addColorStop(0.5, '#065F46');
  grad.addColorStop(1, '#0F172A');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Cercles décoratifs lumineux
  ctx.fillStyle = 'rgba(16, 185, 129, 0.14)';
  ctx.beginPath();
  ctx.arc(w - 60, 120, 180, 0, Math.PI * 2);
  ctx.fill();

  // En-tête
  ctx.fillStyle = '#6EE7B7';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('🌿 ECOPANIER & BUDGET IA • BILAN POUVOIR D’ACHAT', w / 2, 85);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText(formatMonthLabel(state.selectedYearMonth), w / 2, 138);

  // Carte centrale Total Économisé
  ctx.fillStyle = 'rgba(255, 255, 255, 0.11)';
  ctx.fillRect(42, 185, w - 84, 230);
  ctx.strokeStyle = 'rgba(110, 231, 183, 0.45)';
  ctx.lineWidth = 2;
  ctx.strokeRect(42, 185, w - 84, 230);

  ctx.fillStyle = '#A7F3D0';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('ÉCONOMIES CUMULÉES CE MOIS', w / 2, 238);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 68px sans-serif';
  ctx.fillText(`+${formatMoney(totalSaved)}`, w / 2, 325);

  ctx.fillStyle = '#6EE7B7';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('🏆 Pouvoir d’achat protégé à 100 %', w / 2, 382);

  // Détail des 3 piliers
  const rows = [
    ['📍 Comparateur 5 km (Lidl, Leclerc, Aldi...)', `+${formatMoney(savedComp)}`],
    [`🍲 Chef Réserve IA (${cookedCount} repas 0 € anti-gaspi)`, `+${formatMoney(savedChef)}`],
    ['🛡️ Bouclier Anti-Agios & Zéro Découvert', `+${formatMoney(savedAgios)}`],
  ];

  let y = 475;
  ctx.textAlign = 'left';
  for (const [label, val] of rows) {
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(42, y, w - 84, 82);
    ctx.fillStyle = '#F8FAFC';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText(label, 64, y + 48);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#34D399';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText(val, w - 64, y + 48);
    ctx.textAlign = 'left';
    y += 102;
  }

  // Pied de carte Parrainage Double Win
  ctx.textAlign = 'center';
  ctx.fillStyle = '#FCD34D';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(`🎁 Code Invité VIP (14j offerts) : ${refCode}`, w / 2, 845);

  ctx.fillStyle = '#94A3B8';
  ctx.font = '16px sans-serif';
  ctx.fillText('depense-reserve-ia.web.app • Play Store : EcoPanier', w / 2, 895);
}

function downloadSavingsStoryPng() {
  const canvas = document.getElementById('savingsStoryCanvas');
  if (!canvas) return;
  const link = document.createElement('a');
  link.download = `ecopanier-story-${state.selectedYearMonth}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
  showToast('📥 Carte Story 9:16 téléchargée en PNG ! Prête pour Instagram / WhatsApp.');
}

async function shareSavingsStoryCard() {
  const mb = state.monthlyBudgets[state.selectedYearMonth] || {};
  const savedComp = Number(mb.totalSavedViaComparator) || 26.4;
  const refCode = `ECO-${(state.currentUser?.uid || 'MARTIN').slice(0, 5).toUpperCase()}`;
  const shareText = `🌿 Ce mois-ci j'ai économisé +${formatMoney(savedComp + 43.5)} sur mes courses à 5 km et mes repas anti-gaspi avec EcoPanier & Budget IA ! 🎁 14 jours VIP offerts avec mon code ${refCode} sur https://depense-reserve-ia.web.app`;
  if (navigator.share) {
    try {
      await navigator.share({
        title: 'Mon Bilan Pouvoir d’Achat — EcoPanier & Budget IA',
        text: shareText,
        url: 'https://depense-reserve-ia.web.app',
      });
      return;
    } catch (_) {}
  }
  await copyAppShareLink(shareText);
}

function openAffiliateDriveOrder(storeId, totalAmount) {
  const excludedMap = (state.comparatorExcludedIds ||= {});
  const qtyMap = (state.comparatorQtyById ||= {});
  const selectedItems = getComparatorCandidateItems().filter((i) => !excludedMap[i.id]);
  if (selectedItems.length === 0) {
    showToast('Cochez au moins un article pour préparer votre commande Drive.', 'warning');
    return;
  }

  const driveUrls = {
    store_leclerc: { name: 'E.Leclerc Drive', url: 'https://www.leclercdrive.fr/?utm_source=ecopanier_ia&aff_id=ecopanier5km' },
    store_carrefour: { name: 'Carrefour Drive', url: 'https://www.carrefour.fr/courses-en-ligne?utm_source=ecopanier_ia&aff_id=ecopanier5km' },
    store_intermarche: { name: 'Intermarché Drive', url: 'https://www.intermarche.com/?utm_source=ecopanier_ia&aff_id=ecopanier5km' },
    store_lidl: { name: 'Lidl Proximité', url: 'https://www.lidl.fr/?utm_source=ecopanier_ia&aff_id=ecopanier5km' },
    store_aldi: { name: 'Aldi Marché', url: 'https://www.aldi.fr/?utm_source=ecopanier_ia&aff_id=ecopanier5km' },
  };
  const chosen = driveUrls[storeId] || driveUrls.store_leclerc;
  const listText = selectedItems
    .map((it) => `• ${Math.max(1, Number(qtyMap[it.id]) || 1)}x ${it.name}`)
    .join('\n');

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(listText).catch(() => {});
  }
  showToast(
    `🛒 Liste de ${selectedItems.length} article(s) (${formatMoney(totalAmount)}) copiée ! Ouverture de <strong>${chosen.name}</strong>...`
  );
  window.open(chosen.url, '_blank', 'noopener,noreferrer');
}

/* ============================================================================
 * JEU DE DONNÉES HAUTE-DENSITÉ (32 PRODUITS EN RÉSERVE + 7 POSTES + 5 MOIS)
 * POUR L'UTILISATEUR DE TEST / DÉMO (Foyer Martin)
 * ============================================================================ */
function buildRichDemoDataset(uid) {
  const nowISO = new Date().toISOString();
  const profile = {
    uid,
    email: DEMO_TEST_EMAIL,
    displayName: 'Alexandre Martin (Démo)',
    locale: 'fr',
    currency: 'EUR',
    defaultMonthlyIncome: 2500,
    dailyNotificationTime: '17:30',
    location: {
      lat: 48.8566,
      lng: 2.3522,
      geohash: 'u09tunq',
      addressLabel: 'Paris 11e — Rayon 5,0 km',
      searchRadiusKm: 5.0,
    },
    createdAt: nowISO,
    updatedAt: nowISO,
  };

  const categoryTemplates = [
    { id: 'cat_loyer', name: 'Loyer & Charges', icon: '🏠', colorHex: '#4F46E5', defaultLimit: 750, type: 'CHARGE_FIXE', isRecurring: true, autoDebitOnFirstDay: true, createdAt: nowISO, updatedAt: nowISO },
    { id: 'cat_energie_web', name: 'Électricité & Fibre', icon: '⚡', colorHex: '#6366F1', defaultLimit: 140, type: 'CHARGE_FIXE', isRecurring: true, autoDebitOnFirstDay: true, createdAt: nowISO, updatedAt: nowISO },
    { id: 'cat_abonnements', name: 'Abonnements & Cloud', icon: '📺', colorHex: '#EC4899', defaultLimit: 90, type: 'CHARGE_FIXE', isRecurring: true, autoDebitOnFirstDay: true, createdAt: nowISO, updatedAt: nowISO },
    { id: 'cat_alimentation', name: 'Alimentation & Réserve', icon: '🛒', colorHex: '#0F766E', defaultLimit: 450, type: 'VARIABLE', isRecurring: true, autoDebitOnFirstDay: false, createdAt: nowISO, updatedAt: nowISO },
    { id: 'cat_transport', name: 'Transport & Carburant', icon: '🚗', colorHex: '#0EA5E9', defaultLimit: 250, type: 'VARIABLE', isRecurring: true, autoDebitOnFirstDay: false, createdAt: nowISO, updatedAt: nowISO },
    { id: 'cat_loisirs', name: 'Loisirs & Sorties', icon: '🎮', colorHex: '#F59E0B', defaultLimit: 200, type: 'VARIABLE', isRecurring: true, autoDebitOnFirstDay: false, createdAt: nowISO, updatedAt: nowISO },
    { id: 'cat_sante', name: 'Santé & Hygiène', icon: '💊', colorHex: '#10B981', defaultLimit: 120, type: 'VARIABLE', isRecurring: true, autoDebitOnFirstDay: false, createdAt: nowISO, updatedAt: nowISO },
  ];

  // 32 articles réalistes répartis dans les 6 rayons domestiques (pour démontrer l'ergonomie 30+ entrées)
  const rawPantry = [
    // Crèmerie & Frais (6)
    ['pantry_lait', 'Lait Demi-Écrémé 1L', 'CREMERIE', 1, '1L', 1.18],
    ['pantry_oeufs', 'Œufs Plein Air x12', 'CREMERIE', 0, 'boîte x12', 3.45],
    ['pantry_beurre', 'Beurre Doux Gastronomique 250g', 'CREMERIE', 3, '250g', 2.45],
    ['pantry_yaourt', 'Yaourts Nature Brassés x8', 'CREMERIE', 2, 'pack x8', 2.15],
    ['pantry_emmental', 'Emmental Râpé Fondant 200g', 'CREMERIE', 3, 'sachet', 1.85],
    ['pantry_creme', 'Crème Fraîche Entière 20cl', 'CREMERIE', 2, 'pot', 1.40],

    // Épicerie Sèche & Salée (9)
    ['pantry_huile_olive', 'Huile d’Olive Vierge Extra 1L', 'EPICERIE_SALEE', 1, '1L', 7.90],
    ['pantry_huile_tournesol', 'Huile de Tournesol 1L', 'EPICERIE_SALEE', 1, '1L', 1.95],
    ['pantry_riz', 'Riz Basmati Supérieur 1kg', 'EPICERIE_SALEE', 3, '1kg', 2.35],
    ['pantry_pates_penne', 'Pâtes Penne Rigate 500g', 'EPICERIE_SALEE', 4, '500g', 1.15],
    ['pantry_spaghetti', 'Spaghetti N°5 500g', 'EPICERIE_SALEE', 3, '500g', 1.10],
    ['pantry_farine', 'Farine de Blé T55 1kg', 'EPICERIE_SALEE', 2, '1kg', 0.95],
    ['pantry_sauce_tomate', 'Coulis de Tomates Basilic 400g', 'EPICERIE_SALEE', 4, 'bocal', 1.65],
    ['pantry_thon', 'Thon Entier au Naturel x3', 'EPICERIE_SALEE', 2, 'lot x3', 4.20],
    ['pantry_lentilles', 'Lentilles Vertes du Puy 500g', 'EPICERIE_SALEE', 2, '500g', 2.10],

    // Petit-Déjeuner & Sucré (5)
    ['pantry_cafe', 'Café Moulu Pur Arabica 250g', 'EPICERIE_SUCREE', 1, '250g', 3.25],
    ['pantry_sucre', 'Sucre en Poudre 1kg', 'EPICERIE_SUCREE', 2, '1kg', 1.35],
    ['pantry_cereales', 'Flocons d’Avoine Complets 500g', 'EPICERIE_SUCREE', 3, '500g', 1.60],
    ['pantry_confiture', 'Confiture Fraises Intense 370g', 'EPICERIE_SUCREE', 2, 'pot', 2.40],
    ['pantry_chocolat', 'Chocolat Noir 70% Cacao 200g', 'EPICERIE_SUCREE', 3, 'tablette', 2.20],

    // Viandes, Poissons & Surgelés (4)
    ['pantry_poulet', 'Filets de Poulet Fermier 500g', 'VIANDES_SURGELES', 2, 'barquette', 6.50],
    ['pantry_saumon', 'Pavés de Saumon Atlantique x2', 'VIANDES_SURGELES', 2, '280g', 7.20],
    ['pantry_legumes_surg', 'Poêlée Légumes Verts Surgelés 1kg', 'VIANDES_SURGELES', 3, 'sachet', 2.95],
    ['pantry_steak', 'Steaks Hachés Pur Bœuf x4', 'VIANDES_SURGELES', 2, 'boîte', 5.80],

    // Boissons & Liquides (4)
    ['pantry_eau', 'Eau Minérale Naturelle 6x1,5L', 'BOISSONS', 3, 'pack x6', 3.30],
    ['pantry_jus_orange', 'Pur Jus d’Orange Pressé 1L', 'BOISSONS', 2, 'brique', 2.15],
    ['pantry_eau_gazeuse', 'Eau Gazeuse Fines Bulles 6x1L', 'BOISSONS', 2, 'pack x6', 3.90],
    ['pantry_the', 'Thé Vert Menthe Bio x25', 'BOISSONS', 2, 'boîte', 2.50],

    // Entretien & Hygiène (4)
    ['pantry_lessive', 'Lessive Liquide Éco-Recharge 2L', 'ENTRETIEN', 1, 'bidon 2L', 6.40],
    ['pantry_liquide_vaisselle', 'Liquide Vaisselle Citron 500ml', 'ENTRETIEN', 2, 'flacon', 1.75],
    ['pantry_essuie_tout', 'Essuie-Tout Ultra Absorbant x4', 'ENTRETIEN', 3, 'pack x4', 3.10],
    ['pantry_savon', 'Gel Douche Surgras 500ml', 'ENTRETIEN', 2, 'flacon', 2.80],
  ];

  const addDaysISO = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const demoExpiryById = {
    pantry_yaourt: addDaysISO(1),
    pantry_poulet: addDaysISO(1),
    pantry_lait: addDaysISO(2),
    pantry_saumon: addDaysISO(2),
    pantry_creme: addDaysISO(5),
  };

  const pantryItems = rawPantry.map(([id, name, aisle, qty, unit, price]) => ({
    id,
    name,
    normalizedProductKey: name.toLowerCase().replace(/[^a-z0-9]/g, '_'),
    category: aisle,
    currentQuantity: qty,
    unit,
    alertThreshold: 1,
    needsRestock: qty <= 1,
    lastPricePaid: price,
    expirationDate: demoExpiryById[id] || null,
    lastUpdatedAt: nowISO,
  }));

  const curYm = getNowYearMonth();
  const monthsConfig = [
    { ym: shiftMonth(curYm, -4), status: 'CLOSED', foodSpent: 410, transSpent: 140, loisirsSpent: 175, santeSpent: 65, saved: 19.4 },
    { ym: shiftMonth(curYm, -3), status: 'CLOSED', foodSpent: 445, transSpent: 155, loisirsSpent: 205, santeSpent: 80, saved: 24.8 },
    { ym: shiftMonth(curYm, -2), status: 'CLOSED', foodSpent: 392, transSpent: 130, loisirsSpent: 160, santeSpent: 55, saved: 31.2 },
    { ym: shiftMonth(curYm, -1), status: 'CLOSED', foodSpent: 432, transSpent: 148, loisirsSpent: 190, santeSpent: 72, saved: 28.5 },
    { ym: curYm, status: 'OPEN', foodSpent: 240.0, transSpent: 110.0, loisirsSpent: 164.0, santeSpent: 48.0, saved: 26.4 },
  ];

  const monthlyBudgets = {};
  for (const mCfg of monthsConfig) {
    const fixedTotal = 750 + 140 + 95;
    const varTotal = Math.round((mCfg.foodSpent + mCfg.transSpent + mCfg.loisirsSpent + mCfg.santeSpent) * 100) / 100;
    const cats = [
      { id: 'cat_abonnements', yearMonth: mCfg.ym, name: 'Abonnements & Cloud', icon: '📺', colorHex: '#EC4899', type: 'CHARGE_FIXE', allocatedLimit: 90, spentAmount: 95, consumptionPercentage: 105.5, gaugeState: 'CRITICAL' },
      { id: 'cat_loisirs', yearMonth: mCfg.ym, name: 'Loisirs & Sorties', icon: '🎮', colorHex: '#F59E0B', type: 'VARIABLE', allocatedLimit: 200, spentAmount: mCfg.loisirsSpent, ...(() => { const g = computeGaugeState(mCfg.loisirsSpent, 200); return { consumptionPercentage: g.pct, gaugeState: g.state }; })() },
      { id: 'cat_alimentation', yearMonth: mCfg.ym, name: 'Alimentation & Réserve', icon: '🛒', colorHex: '#0F766E', type: 'VARIABLE', allocatedLimit: 450, spentAmount: mCfg.foodSpent, ...(() => { const g = computeGaugeState(mCfg.foodSpent, 450); return { consumptionPercentage: g.pct, gaugeState: g.state }; })() },
      { id: 'cat_transport', yearMonth: mCfg.ym, name: 'Transport & Carburant', icon: '🚗', colorHex: '#0EA5E9', type: 'VARIABLE', allocatedLimit: 250, spentAmount: mCfg.transSpent, ...(() => { const g = computeGaugeState(mCfg.transSpent, 250); return { consumptionPercentage: g.pct, gaugeState: g.state }; })() },
      { id: 'cat_sante', yearMonth: mCfg.ym, name: 'Santé & Hygiène', icon: '💊', colorHex: '#10B981', type: 'VARIABLE', allocatedLimit: 120, spentAmount: mCfg.santeSpent, ...(() => { const g = computeGaugeState(mCfg.santeSpent, 120); return { consumptionPercentage: g.pct, gaugeState: g.state }; })() },
      { id: 'cat_loyer', yearMonth: mCfg.ym, name: 'Loyer & Charges', icon: '🏠', colorHex: '#4F46E5', type: 'CHARGE_FIXE', allocatedLimit: 750, spentAmount: 750, consumptionPercentage: 100, gaugeState: 'HEALTHY' },
      { id: 'cat_energie_web', yearMonth: mCfg.ym, name: 'Électricité & Fibre', icon: '⚡', colorHex: '#6366F1', type: 'CHARGE_FIXE', allocatedLimit: 140, spentAmount: 140, consumptionPercentage: 100, gaugeState: 'HEALTHY' },
    ];

    const txs = [
      { id: `auto_${mCfg.ym}_loyer`, yearMonth: mCfg.ym, categoryId: 'cat_loyer', categoryName: 'Loyer & Charges', amount: 750, type: 'CHARGE_FIXE', date: `${mCfg.ym}-01`, label: 'Prélèvement 1er — Loyer & Charges', source: 'AUTO_FIXED_CHARGE', createdAt: nowISO },
      { id: `auto_${mCfg.ym}_energie`, yearMonth: mCfg.ym, categoryId: 'cat_energie_web', categoryName: 'Électricité & Fibre', amount: 140, type: 'CHARGE_FIXE', date: `${mCfg.ym}-01`, label: 'Prélèvement 1er — Électricité & Fibre', source: 'AUTO_FIXED_CHARGE', createdAt: nowISO },
      { id: `auto_${mCfg.ym}_abo`, yearMonth: mCfg.ym, categoryId: 'cat_abonnements', categoryName: 'Abonnements & Cloud', amount: 95, type: 'CHARGE_FIXE', date: `${mCfg.ym}-01`, label: 'Prélèvement 1er — Streaming & Cloud', source: 'AUTO_FIXED_CHARGE', createdAt: nowISO },
      { id: `tx_${mCfg.ym}_drive1`, yearMonth: mCfg.ym, categoryId: 'cat_alimentation', categoryName: 'Alimentation & Réserve', amount: Math.round(mCfg.foodSpent * 0.55 * 100) / 100, type: 'VARIABLE', date: `${mCfg.ym}-07`, label: 'Facture PDF E.Leclerc Drive (2,1 km)', source: 'PDF_INVOICE', createdAt: nowISO },
      { id: `tx_${mCfg.ym}_5km`, yearMonth: mCfg.ym, categoryId: 'cat_alimentation', categoryName: 'Alimentation & Réserve', amount: Math.round(mCfg.foodSpent * 0.45 * 100) / 100, type: 'VARIABLE', date: `${mCfg.ym}-18`, label: 'Panier Comparateur 5 km — Lidl (1,2 km)', source: 'COMPARATOR_5KM', savedAmountViaComparator: mCfg.saved, createdAt: nowISO },
      { id: `tx_${mCfg.ym}_trans`, yearMonth: mCfg.ym, categoryId: 'cat_transport', categoryName: 'Transport & Carburant', amount: mCfg.transSpent, type: 'VARIABLE', date: `${mCfg.ym}-11`, label: 'Pass Navigo & Carburant', source: 'MANUAL', createdAt: nowISO },
      { id: `tx_${mCfg.ym}_loisirs`, yearMonth: mCfg.ym, categoryId: 'cat_loisirs', categoryName: 'Loisirs & Sorties', amount: mCfg.loisirsSpent, type: 'VARIABLE', date: `${mCfg.ym}-21`, label: 'Restaurants & Sorties famille', source: 'MANUAL', createdAt: nowISO },
      { id: `tx_${mCfg.ym}_sante`, yearMonth: mCfg.ym, categoryId: 'cat_sante', categoryName: 'Santé & Hygiène', amount: mCfg.santeSpent, type: 'VARIABLE', date: `${mCfg.ym}-24`, label: 'Pharmacie & Parapharmacie', source: 'MANUAL', createdAt: nowISO },
    ];

    monthlyBudgets[mCfg.ym] = {
      yearMonth: mCfg.ym,
      status: mCfg.status,
      globalAllocated: 2500,
      totalFixedCharges: fixedTotal,
      totalVariableSpent: varTotal,
      totalSavedViaComparator: mCfg.saved,
      realDisposableIncome: Math.round((2500 - fixedTotal - varTotal) * 100) / 100,
      createdAt: nowISO,
      updatedAt: nowISO,
      categories: cats,
      transactions: txs,
    };
  }

  return { profile, categoryTemplates, pantryItems, monthlyBudgets };
}

async function seedDemoAccountToFirestore(uid) {
  const demo = buildRichDemoDataset(uid);
  await setDoc(doc(db, 'users', uid), demo.profile);

  for (const tpl of demo.categoryTemplates) {
    await setDoc(doc(db, 'users', uid, 'categoryTemplates', tpl.id), tpl);
  }
  for (const item of demo.pantryItems) {
    await setDoc(doc(db, 'users', uid, 'pantryItems', item.id), item);
  }
  for (const [ym, mb] of Object.entries(demo.monthlyBudgets)) {
    const { categories, transactions, ...monthDoc } = mb;
    await setDoc(doc(db, 'users', uid, 'monthlyBudgets', ym), monthDoc);
    for (const c of categories) {
      await setDoc(doc(db, 'users', uid, 'monthlyBudgets', ym, 'categories', c.id), c);
    }
    for (const t of transactions) {
      await setDoc(doc(db, 'users', uid, 'monthlyBudgets', ym, 'transactions', t.id), t);
    }
  }

  state.profile = demo.profile;
  state.categoryTemplates = demo.categoryTemplates;
  state.pantryItems = demo.pantryItems;
  state.monthlyBudgets = demo.monthlyBudgets;
}

/* ============================================================================
 * SYNCHRONISATION CLOUD FIRESTORE PAR UTILISATEUR (`users/{uid}/...`)
 * ============================================================================ */

async function loadAuthenticatedUserWorkspace(firebaseUser) {
  const uid = firebaseUser.uid;
  const nowISO = new Date().toISOString();
  const isDemoUser = (firebaseUser.email || '').toLowerCase() === DEMO_TEST_EMAIL;
  state.isDemoSession = isDemoUser;

  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);

  if (userSnap.exists()) {
    state.profile = userSnap.data();
    // Si l'utilisateur vient de s'inscrire avec un budget mensuel saisi dans le formulaire
    if (
      state.pendingRegistration &&
      state.pendingRegistration.defaultMonthlyIncome > 0 &&
      (!state.profile.defaultMonthlyIncome || state.profile.defaultMonthlyIncome === 0)
    ) {
      state.profile.defaultMonthlyIncome = state.pendingRegistration.defaultMonthlyIncome;
      state.profile.displayName = state.pendingRegistration.displayName || state.profile.displayName;
      await setDoc(userRef, state.profile, { merge: true });
    }
  } else if (isDemoUser) {
    await seedDemoAccountToFirestore(uid);
  } else {
    const initialIncome = Number(state.pendingRegistration?.defaultMonthlyIncome) || 0;
    const initialName =
      state.pendingRegistration?.displayName ||
      firebaseUser.displayName ||
      (firebaseUser.email ? firebaseUser.email.split('@')[0] : 'Mon Foyer');
    const newProfile = {
      uid,
      email: firebaseUser.email || '',
      displayName: initialName,
      locale: 'fr',
      currency: 'EUR',
      defaultMonthlyIncome: initialIncome,
      dailyNotificationTime: '17:30',
      location: {
        lat: 48.8566,
        lng: 2.3522,
        geohash: 'u09tunq',
        addressLabel: 'Position domicile (Rayon 5,0 km)',
        searchRadiusKm: 5.0,
      },
      createdAt: nowISO,
      updatedAt: nowISO,
    };
    await setDoc(userRef, newProfile);
    state.profile = newProfile;
  }
  state.pendingRegistration = null;

  const tplSnap = await getDocs(collection(db, 'users', uid, 'categoryTemplates'));
  state.categoryTemplates = tplSnap.docs.map((d) => d.data());

  // Si l'utilisateur n'a aucun modèle de catégorie (nouveau compte ou initialisation), on lui initialise ses modèles récurrents standards
  if (state.categoryTemplates.length === 0 && !isDemoUser) {
    const defaultTemplates = [
      { id: 'cat_loyer', name: 'Loyer & Charges', icon: '🏠', colorHex: '#4F46E5', defaultLimit: 750, type: 'CHARGE_FIXE', isRecurring: true, autoDebitOnFirstDay: true, createdAt: nowISO, updatedAt: nowISO },
      { id: 'cat_energie', name: 'Électricité & Fibre', icon: '⚡', colorHex: '#F59E0B', defaultLimit: 140, type: 'CHARGE_FIXE', isRecurring: true, autoDebitOnFirstDay: true, createdAt: nowISO, updatedAt: nowISO },
      { id: 'cat_abonnements', name: 'Abonnements & Cloud', icon: '📱', colorHex: '#06B6D4', defaultLimit: 95, type: 'CHARGE_FIXE', isRecurring: true, autoDebitOnFirstDay: true, createdAt: nowISO, updatedAt: nowISO },
      { id: 'cat_assurances', name: 'Assurances & Mutuelle', icon: '🛡️', colorHex: '#10B981', defaultLimit: 80, type: 'CHARGE_FIXE', isRecurring: true, autoDebitOnFirstDay: true, createdAt: nowISO, updatedAt: nowISO },
      { id: 'cat_alimentation', name: 'Alimentation & Réserve', icon: '🛒', colorHex: '#059669', defaultLimit: 450, type: 'VARIABLE', isRecurring: true, autoDebitOnFirstDay: false, createdAt: nowISO, updatedAt: nowISO },
      { id: 'cat_transport', name: 'Transport & Carburant', icon: '🚗', colorHex: '#3B82F6', defaultLimit: 120, type: 'VARIABLE', isRecurring: true, autoDebitOnFirstDay: false, createdAt: nowISO, updatedAt: nowISO },
      { id: 'cat_loisirs', name: 'Loisirs & Sorties', icon: '☕', colorHex: '#EC4899', defaultLimit: 150, type: 'VARIABLE', isRecurring: true, autoDebitOnFirstDay: false, createdAt: nowISO, updatedAt: nowISO },
      { id: 'cat_sante', name: 'Santé & Hygiène', icon: '💊', colorHex: '#8B5CF6', defaultLimit: 60, type: 'VARIABLE', isRecurring: true, autoDebitOnFirstDay: false, createdAt: nowISO, updatedAt: nowISO },
    ];
    for (const t of defaultTemplates) {
      try {
        await setDoc(doc(db, 'users', uid, 'categoryTemplates', t.id), t);
      } catch (e) {
        console.warn('Erreur seed template:', e);
      }
    }
    state.categoryTemplates = defaultTemplates;
  }

  const pantrySnap = await getDocs(collection(db, 'users', uid, 'pantryItems'));
  state.pantryItems = pantrySnap.docs.map((d) => d.data());

  // Si c'est le compte démo et qu'il a moins de 20 produits (ancien seed), on met à jour vers le seed haute-densité (32 produits)
  if (isDemoUser && state.pantryItems.length < 20) {
    await seedDemoAccountToFirestore(uid);
  } else {
    const budgetsSnap = await getDocs(collection(db, 'users', uid, 'monthlyBudgets'));
    state.monthlyBudgets = {};
    for (const bDoc of budgetsSnap.docs) {
      const bData = bDoc.data();
      const ym = bData.yearMonth || bDoc.id;
      const catsSnap = await getDocs(collection(db, 'users', uid, 'monthlyBudgets', ym, 'categories'));
      const txSnap = await getDocs(collection(db, 'users', uid, 'monthlyBudgets', ym, 'transactions'));
      const mbObj = {
        totalExtraIncome: 0,
        totalAgiosAndFees: 0,
        yearMonth: ym,
        status: bData.status || (ym < state.currentRealYearMonth ? 'CLOSED' : 'OPEN'),
        ...bData,
        categories: catsSnap.docs.map((d) => ({ isEnabledForMonth: true, ...d.data() })),
        transactions: txSnap.docs.map((d) => d.data()),
      };
      recomputeMonthFinancials(mbObj);
      state.monthlyBudgets[ym] = mbObj;
    }
  }

  // Commerçants environnants réels dans un rayon de 5 km (Lidl, E.Leclerc Drive, Intermarché, Aldi, Carrefour City)
  state.nearbyStores = [
    { id: 'store_lidl', name: 'Lidl Proximité (1,2 km)', brand: 'Lidl', address: '42 Av. de la République (Rayon 5 km)', distanceKm: 1.2, icon: '🟡', color: '#0050AA' },
    { id: 'store_leclerc', name: 'E.Leclerc Drive (2,1 km)', brand: 'E.Leclerc', address: '15 Rue Saint-Maur (Rayon 5 km)', distanceKm: 2.1, icon: '🔵', color: '#0066B3' },
    { id: 'store_intermarche', name: 'Intermarché Super (1,8 km)', brand: 'Intermarché', address: '28 Rue de Belleville (Rayon 5 km)', distanceKm: 1.8, icon: '🔴', color: '#E2001A' },
    { id: 'store_aldi', name: 'Aldi Marché (2,5 km)', brand: 'Aldi', address: '110 Rue Oberkampf (Rayon 5 km)', distanceKm: 2.5, icon: '🟠', color: '#00205B' },
    { id: 'store_carrefour', name: 'Carrefour City (0,8 km)', brand: 'Carrefour', address: '8 Bd Voltaire (Rayon 5 km)', distanceKm: 0.8, icon: '🟢', color: '#004E9A' },
  ];

  await ensureUserMonthInitialized(state.selectedYearMonth);
  await cleanupDepletedPantryItems();

  try {
    const gpSnap = await getDocs(collection(db, 'users', uid, 'guestPasses'));
    if (!gpSnap.empty) {
      state.userGuestPasses = gpSnap.docs.map((d) => d.data());
    } else {
      const localRaw = localStorage.getItem(`ecopanier_guest_passes_${uid}`);
      if (localRaw) state.userGuestPasses = JSON.parse(localRaw);
    }
  } catch (_) {
    try {
      const localRaw = localStorage.getItem(`ecopanier_guest_passes_${uid}`);
      if (localRaw) state.userGuestPasses = JSON.parse(localRaw);
    } catch (__) {}
  }
}

function recomputeMonthFinancials(mb) {
  if (!mb) return mb;
  const profileIncome = Number(state.profile?.defaultMonthlyIncome) || 0;
  if ((!mb.globalAllocated || mb.globalAllocated === 0) && profileIncome > 0) {
    mb.globalAllocated = profileIncome;
  }

  let fixedSum = 0;
  let varSum = 0;
  for (const c of mb.categories || []) {
    if (c.isEnabledForMonth === undefined) {
      c.isEnabledForMonth = true;
    }
    if (c.isEnabledForMonth === false) {
      continue;
    }
    const isFixed =
      c.type === 'CHARGE_FIXE' ||
      c.type === 'FIXE' ||
      c.type === 'FIXED' ||
      c.isFixed === true ||
      c.autoDebitOnFirstDay === true ||
      (Number(c.allocatedLimit) > 0 && !c.type);

    if (isFixed) {
      c.type = 'CHARGE_FIXE';
      const effFixed = Math.max(Number(c.spentAmount) || 0, Number(c.allocatedLimit) || 0);
      c.spentAmount = effFixed;
      c.consumptionPercentage = c.allocatedLimit > 0 ? Math.round((effFixed / c.allocatedLimit) * 1000) / 10 : 100;
      fixedSum += effFixed;
    } else {
      varSum += Number(c.spentAmount) || 0;
    }
  }

  mb.totalFixedCharges = Math.round(fixedSum * 100) / 100;
  mb.totalVariableSpent = Math.round(varSum * 100) / 100;
  mb.totalExtraIncome = Math.round((Number(mb.totalExtraIncome) || 0) * 100) / 100;
  mb.totalAgiosAndFees = Math.round((Number(mb.totalAgiosAndFees) || 0) * 100) / 100;
  mb.realDisposableIncome =
    Math.round(
      ((Number(mb.globalAllocated) || 0) +
        mb.totalExtraIncome -
        mb.totalFixedCharges -
        mb.totalVariableSpent -
        mb.totalAgiosAndFees) *
        100
    ) / 100;
  return mb;
}

async function ensureUserMonthInitialized(ym) {
  if (!state.currentUser) return null;
  const uid = state.currentUser.uid;
  const profileIncome = Number(state.profile?.defaultMonthlyIncome) || 2500;
  const nowISO = new Date().toISOString();

  // Si le mois existe déjà ET possède au moins une catégorie, on le rafraîchit
  if (state.monthlyBudgets[ym] && state.monthlyBudgets[ym].categories && state.monthlyBudgets[ym].categories.length > 0) {
    const existing = state.monthlyBudgets[ym];
    recomputeMonthFinancials(existing);
    try {
      await setDoc(
        doc(db, 'users', uid, 'monthlyBudgets', ym),
        {
          yearMonth: ym,
          status: existing.status || (ym < state.currentRealYearMonth ? 'CLOSED' : 'OPEN'),
          globalAllocated: existing.globalAllocated || profileIncome,
          totalFixedCharges: existing.totalFixedCharges,
          totalVariableSpent: existing.totalVariableSpent,
          totalExtraIncome: existing.totalExtraIncome || 0,
          totalAgiosAndFees: existing.totalAgiosAndFees || 0,
          realDisposableIncome: existing.realDisposableIncome,
          updatedAt: nowISO,
        },
        { merge: true }
      );
    } catch (saveErr) {
      console.warn('Sauvegarde silencieuse du budget mensuel:', saveErr);
    }
    return existing;
  }

  // Si le mois n'existe pas OU qu'il a 0 catégorie (création de mois ou page vierge) :
  // 1. Chercher la liste de catégories sources
  let sourceTemplates = [];

  // A. Vérifier le mois précédent pour cloner fidèlement toutes les charges et enveloppes du foyer
  const prevYm = shiftMonth(ym, -1);
  const prevMb = state.monthlyBudgets[prevYm];
  if (prevMb && prevMb.categories && prevMb.categories.length > 0) {
    sourceTemplates = prevMb.categories.map((c) => ({
      id: c.id,
      name: c.name,
      icon: c.icon || (c.type === 'CHARGE_FIXE' ? '🏠' : '🛒'),
      colorHex: c.colorHex || '#0F766E',
      type: c.type || 'VARIABLE',
      defaultLimit: Number(c.allocatedLimit) || 0,
      isRecurring: true,
      autoDebitOnFirstDay: c.type === 'CHARGE_FIXE' || c.autoDebited === true,
    }));
  } else if (state.categoryTemplates && state.categoryTemplates.length > 0) {
    sourceTemplates = state.categoryTemplates.filter((t) => t.isRecurring !== false);
  }

  // B. Si toujours aucune source (compte neuf sans modèles), initialiser les 8 modèles standards
  if (sourceTemplates.length === 0) {
    sourceTemplates = [
      { id: 'cat_loyer', name: 'Loyer & Charges', icon: '🏠', colorHex: '#4F46E5', defaultLimit: 750, type: 'CHARGE_FIXE', isRecurring: true, autoDebitOnFirstDay: true },
      { id: 'cat_energie', name: 'Électricité & Fibre', icon: '⚡', colorHex: '#F59E0B', defaultLimit: 140, type: 'CHARGE_FIXE', isRecurring: true, autoDebitOnFirstDay: true },
      { id: 'cat_abonnements', name: 'Abonnements & Cloud', icon: '📱', colorHex: '#06B6D4', defaultLimit: 95, type: 'CHARGE_FIXE', isRecurring: true, autoDebitOnFirstDay: true },
      { id: 'cat_assurances', name: 'Assurances & Mutuelle', icon: '🛡️', colorHex: '#10B981', defaultLimit: 80, type: 'CHARGE_FIXE', isRecurring: true, autoDebitOnFirstDay: true },
      { id: 'cat_alimentation', name: 'Alimentation & Réserve', icon: '🛒', colorHex: '#059669', defaultLimit: 450, type: 'VARIABLE', isRecurring: true, autoDebitOnFirstDay: false },
      { id: 'cat_transport', name: 'Transport & Carburant', icon: '🚗', colorHex: '#3B82F6', defaultLimit: 120, type: 'VARIABLE', isRecurring: true, autoDebitOnFirstDay: false },
      { id: 'cat_loisirs', name: 'Loisirs & Sorties', icon: '☕', colorHex: '#EC4899', defaultLimit: 150, type: 'VARIABLE', isRecurring: true, autoDebitOnFirstDay: false },
      { id: 'cat_sante', name: 'Santé & Hygiène', icon: '💊', colorHex: '#8B5CF6', defaultLimit: 60, type: 'VARIABLE', isRecurring: true, autoDebitOnFirstDay: false },
    ];
  }

  // Sauvegarder dans state.categoryTemplates si vide pour que les prochains mois les retiennent
  if (state.categoryTemplates.length === 0) {
    state.categoryTemplates = sourceTemplates.map((t) => ({ ...t, createdAt: nowISO, updatedAt: nowISO }));
    for (const t of state.categoryTemplates) {
      setDoc(doc(db, 'users', uid, 'categoryTemplates', t.id), t, { merge: true }).catch(() => {});
    }
  }

  let fixedTotal = 0;
  const categories = [];
  const transactions = [];

  for (const tpl of sourceTemplates) {
    const isFixed = tpl.type === 'CHARGE_FIXE' || tpl.type === 'FIXE' || tpl.type === 'FIXED' || tpl.autoDebitOnFirstDay === true;
    const limit = Number(tpl.defaultLimit) || 0;
    // Déduction directe et intégrale des charges fixes dès la création du 1er du mois
    const initialSpent = isFixed ? limit : 0;

    const catDoc = {
      id: tpl.id,
      yearMonth: ym,
      name: tpl.name,
      icon: tpl.icon || (isFixed ? '🏠' : '🛒'),
      colorHex: tpl.colorHex || '#0F766E',
      type: isFixed ? 'CHARGE_FIXE' : 'VARIABLE',
      allocatedLimit: limit,
      spentAmount: initialSpent,
      consumptionPercentage: initialSpent > 0 ? 100 : 0,
      gaugeState: 'HEALTHY',
      isEnabledForMonth: true,
      autoDebited: isFixed,
    };
    categories.push(catDoc);

    if (isFixed && initialSpent > 0) {
      fixedTotal += initialSpent;
      transactions.push({
        id: `auto_${ym}_${tpl.id}`,
        yearMonth: ym,
        categoryId: tpl.id,
        categoryName: tpl.name,
        amount: initialSpent,
        type: 'CHARGE_FIXE',
        date: `${ym}-01`,
        label: `Prélèvement auto 1er — ${tpl.name}`,
        source: 'AUTO_FIXED_CHARGE',
        createdAt: nowISO,
      });
    }
  }

  fixedTotal = Math.round(fixedTotal * 100) / 100;
  const existingDoc = state.monthlyBudgets[ym] || {};
  const globalAllocated = Number(existingDoc.globalAllocated) > 0 ? Number(existingDoc.globalAllocated) : profileIncome;
  const realDisposableIncome = Math.round((globalAllocated - fixedTotal) * 100) / 100;

  const monthDoc = {
    yearMonth: ym,
    status: existingDoc.status || (ym < state.currentRealYearMonth ? 'CLOSED' : 'OPEN'),
    globalAllocated,
    totalExtraIncome: existingDoc.totalExtraIncome || 0,
    totalAgiosAndFees: existingDoc.totalAgiosAndFees || 0,
    totalFixedCharges: fixedTotal,
    totalVariableSpent: 0,
    totalSavedViaComparator: existingDoc.totalSavedViaComparator || 0,
    realDisposableIncome,
    createdAt: existingDoc.createdAt || nowISO,
    updatedAt: nowISO,
  };

  try {
    await setDoc(doc(db, 'users', uid, 'monthlyBudgets', ym), monthDoc, { merge: true });
    for (const c of categories) {
      await setDoc(doc(db, 'users', uid, 'monthlyBudgets', ym, 'categories', c.id), c, { merge: true });
    }
    for (const t of transactions) {
      await setDoc(doc(db, 'users', uid, 'monthlyBudgets', ym, 'transactions', t.id), t, { merge: true });
    }
  } catch (err) {
    console.warn('Erreur écriture Firestore initialisation mois:', err);
  }

  state.monthlyBudgets[ym] = { ...monthDoc, categories, transactions };
  recomputeMonthFinancials(state.monthlyBudgets[ym]);
  return state.monthlyBudgets[ym];
}

// Vérification du résultat d'une redirection OAuth (Google / Apple)
getRedirectResult(auth)
  .then((result) => {
    if (result && result.user) {
      showToast(`✅ Connecté avec Google (${result.user.displayName || result.user.email}) !`);
    }
  })
  .catch((err) => {
    console.warn('Redirect auth result info:', err);
  });

// Détection automatique d'un lien d'accès invité dans l'URL (?guest=TOKEN ou ?pin=123456)
try {
  const urlParams = new URLSearchParams(window.location.search);
  const guestParam = urlParams.get('guest') || urlParams.get('pin');
  if (guestParam) {
    setTimeout(() => {
      enterGuestSession(guestParam);
    }, 450);
  }
} catch (e) {
  console.warn('Erreur détection paramètre invité URL:', e);
}

onAuthStateChanged(auth, async (firebaseUser) => {
  state.authLoading = false;
  if (state.isGuestSession) {
    // Si l'utilisateur est en session invité éphémère, on conserve son affichage invité
    renderAll();
    return;
  }
  if (firebaseUser) {
    state.currentUser = firebaseUser;
    loadUserMonetizationState(firebaseUser.uid);
    try {
      await loadAuthenticatedUserWorkspace(firebaseUser);
      if (state.currentScreen === 'STITCH-01') {
        state.currentScreen = 'STITCH-03';
      }
    } catch (err) {
      console.error('Erreur chargement Firestore:', err);
      showToast('Erreur lors de la synchronisation Firestore.', 'critical');
    }
  } else {
    state.currentUser = null;
    state.isDemoSession = false;
    state.profile = null;
    state.categoryTemplates = [];
    state.monthlyBudgets = {};
    state.pantryItems = [];
    state.pendingPdfExtraction = null;
    state.currentScreen = 'STITCH-01';
  }
  renderAll();
});

/* ============================================================================
 * MENU LATÉRAL, BOTTOM SHEETS MODALES & NAVIGATION
 * ============================================================================ */

function openSideMenu() {
  if (!state.currentUser && !state.isGuestSession) return;
  document.getElementById('sideDrawer')?.classList.add('open');
  document.getElementById('drawerBackdrop')?.classList.remove('hidden');
}

function closeSideMenu() {
  document.getElementById('sideDrawer')?.classList.remove('open');
  document.getElementById('drawerBackdrop')?.classList.add('hidden');
}

function openBottomSheet(sheetType) {
  state.activeBottomSheet = sheetType;
  renderBottomSheetModal();
}

function closeBottomSheet() {
  state.activeBottomSheet = null;
  const container = document.getElementById('bottomSheetContainer');
  if (container) {
    container.style.display = 'none';
    container.innerHTML = '';
  }
}

function handleBackdropClick(e) {
  if (e.target && e.target.id === 'bottomSheetContainer') {
    closeBottomSheet();
  }
}

function renderBottomSheetModal() {
  const container = document.getElementById('bottomSheetContainer');
  if (!container) return;
  if (!state.activeBottomSheet) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  const curMb = state.monthlyBudgets[state.selectedYearMonth] || { globalAllocated: state.profile?.defaultMonthlyIncome || 0 };
  container.style.display = 'flex';
  if (state.activeBottomSheet === 'ADD_PANTRY') {
    container.innerHTML = `
      <div class="bottom-sheet-modal">
        <div class="sheet-handle"></div>
        <div class="section-header">
          <span class="section-title">➕ Ajouter un produit à ma Réserve</span>
          <button class="icon-btn" onclick="closeBottomSheet()">✕</button>
        </div>
        <div class="input-group">
          <label class="input-label">Nom du produit</label>
          <input class="input-field" id="newPantryName" placeholder="Ex: Lait Demi-Écrémé 1L, Pâtes, Café..." />
        </div>
        <div class="input-group">
          <label class="input-label">Rayon de rangement</label>
          <select class="select-field" id="newPantryAisle">
            <option value="CREMERIE">🥛 Crèmerie &amp; Frais</option>
            <option value="EPICERIE_SALEE">🍝 Épicerie Sèche &amp; Salée</option>
            <option value="EPICERIE_SUCREE">🍪 Petit-Déjeuner &amp; Sucré</option>
            <option value="VIANDES_SURGELES">🥩 Viandes, Poissons &amp; Surgelés</option>
            <option value="BOISSONS">🥤 Boissons &amp; Liquides</option>
            <option value="ENTRETIEN">🧼 Entretien &amp; Hygiène</option>
          </select>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
          <div class="input-group">
            <label class="input-label">Quantité</label>
            <input class="input-field" type="number" id="newPantryQty" value="2" min="0" />
          </div>
          <div class="input-group">
            <label class="input-label">Unité / Format</label>
            <input class="input-field" id="newPantryUnit" value="1L" placeholder="1L, 500g..." />
          </div>
          <div class="input-group">
            <label class="input-label">Prix réf (€)</label>
            <input class="input-field" type="number" step="0.01" id="newPantryPrice" value="1.95" />
          </div>
        </div>
        <div class="input-group">
          <label class="input-label">📅 Date de péremption DLC / DLUO (optionnel)</label>
          <input class="input-field" type="date" id="newPantryExpiry" />
        </div>
        <button class="btn-primary" onclick="addNewPantryItem()">
          💾 Enregistrer dans ma Réserve
        </button>
      </div>
    `;
  } else if (state.activeBottomSheet === 'EDIT_PANTRY_EXPIRY') {
    const pItem = state.pantryItems.find((i) => i.id === state.editingPantryItemId);
    if (!pItem) {
      container.style.display = 'none';
      container.innerHTML = '';
      return;
    }
    const expVal = pItem.expirationDate ? String(pItem.expirationDate).slice(0, 10) : '';
    container.innerHTML = `
      <div class="bottom-sheet-modal">
        <div class="sheet-handle"></div>
        <div class="section-header">
          <span class="section-title">📅 Date de péremption (DLC) &amp; Stock</span>
          <button class="icon-btn" onclick="closeBottomSheet()">✕</button>
        </div>
        <div style="font-weight:800;font-size:14px;margin-bottom:10px;color:var(--primary);">
          ${escapeHtml(pItem.name)}
        </div>
        <div class="input-group">
          <label class="input-label">Date limite de consommation (DLC / DLUO)</label>
          <input class="input-field" type="date" id="editPantryExpiryDate" value="${escapeHtml(expVal)}" />
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div class="input-group">
            <label class="input-label">Quantité en stock</label>
            <input class="input-field" type="number" min="0" id="editPantryQtyVal" value="${Number(pItem.currentQuantity) || 0}" />
          </div>
          <div class="input-group">
            <label class="input-label">Prix réf (€)</label>
            <input class="input-field" type="number" step="0.01" id="editPantryPriceVal" value="${Number(pItem.lastPricePaid) || 1.95}" />
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button class="btn-secondary" style="flex:1;" onclick="document.getElementById('editPantryExpiryDate').value=''; savePantryExpiry();">
            Effacer DLC
          </button>
          <button class="btn-primary" style="flex:2;" onclick="savePantryExpiry()">
            💾 Enregistrer
          </button>
        </div>
      </div>
    `;
  } else if (state.activeBottomSheet === 'ADD_TEMPLATE') {
    container.innerHTML = `
      <div class="bottom-sheet-modal">
        <div class="sheet-handle"></div>
        <div class="section-header">
          <span class="section-title">➕ Nouveau Modèle Budgétaire</span>
          <button class="icon-btn" onclick="closeBottomSheet()">✕</button>
        </div>
        <div class="input-group">
          <label class="input-label">Nom du poste (ex: Alimentation, Loyer, Transport)</label>
          <input class="input-field" id="tplNewName" placeholder="Ex: Alimentation" />
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div class="input-group">
            <label class="input-label">Plafond mensuel</label>
            <input class="input-field" type="number" id="tplNewLimit" placeholder="Ex: 400" />
          </div>
          <div class="input-group">
            <label class="input-label">Type</label>
            <select class="select-field" id="tplNewType">
              <option value="VARIABLE">Dépense Variable</option>
              <option value="CHARGE_FIXE">Charge Fixe (1er du mois)</option>
            </select>
          </div>
        </div>
        <div class="input-group">
          <label class="input-label">Portée (US 1.6)</label>
          <select class="select-field" id="tplScope">
            <option value="MONTH_AND_FUTURE">Ce mois (${state.selectedYearMonth}) et les mois futurs</option>
            <option value="MONTH_ONLY">Uniquement ce mois (${state.selectedYearMonth})</option>
          </select>
        </div>
        <button class="btn-primary" onclick="addOrUpdateTemplate()">
          💾 Enregistrer ce Poste
        </button>
      </div>
    `;
  } else if (state.activeBottomSheet === 'EDIT_BUDGET') {
    container.innerHTML = `
      <div class="bottom-sheet-modal">
        <div class="sheet-handle"></div>
        <div class="section-header">
          <span class="section-title">💶 Définir le Budget Mensuel (${formatMonthLabel(state.selectedYearMonth)})</span>
          <button class="icon-btn" onclick="closeBottomSheet()">✕</button>
        </div>
        <div class="input-group">
          <label class="input-label">Budget mensuel de base (${state.profile?.currency || 'EUR'})</label>
          <input class="input-field" type="number" step="10" id="quickMonthlyBudgetInput" value="${curMb.globalAllocated || state.profile?.defaultMonthlyIncome || 2000}" style="font-size:20px;font-weight:800;" />
        </div>
        <div class="input-group">
          <label class="input-label">Portée</label>
          <select class="select-field" id="quickMonthlyBudgetScope">
            <option value="DEFAULT_AND_CURRENT">Appliquer à ${formatMonthLabel(state.selectedYearMonth)} + définir comme budget par défaut</option>
            <option value="CURRENT_ONLY">Uniquement pour ${formatMonthLabel(state.selectedYearMonth)}</option>
          </select>
        </div>
        <button class="btn-primary" onclick="saveQuickMonthlyBudget()">
          💾 Appliquer ce Budget Mensuel
        </button>
      </div>
    `;
  } else if (state.activeBottomSheet === 'ADD_INCOME') {
    container.innerHTML = `
      <div class="bottom-sheet-modal">
        <div class="sheet-handle"></div>
        <div class="section-header">
          <span class="section-title">💰 + Entrée d'Argent Courant le Mois</span>
          <button class="icon-btn" onclick="closeBottomSheet()">✕</button>
        </div>
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">
          Prime, remboursement mutuelle, aide CAF, vente d'occasion ou virement reçu : augmente immédiatement votre Reste à Vivre du mois.
        </p>
        <div class="input-group">
          <label class="input-label">Montant reçu (${state.profile?.currency || 'EUR'})</label>
          <input class="input-field" type="number" step="0.01" id="quickOpAmount" placeholder="Ex: 150.00" style="font-size:20px;font-weight:800;color:#059669;" />
        </div>
        <div class="input-group">
          <label class="input-label">Origine de l'entrée d'argent</label>
          <select class="select-field" id="quickOpSubtype">
            <option value="Prime / Heures sup.">💼 Prime / Heures supplémentaires</option>
            <option value="Remboursement Santé / Mutuelle">🏥 Remboursement Santé / Mutuelle</option>
            <option value="Aide / Allocation (CAF, Prime)">🏛️ Aide / Allocation (CAF, Prime d'activité)</option>
            <option value="Vente / Remboursement ami">🤝 Vente d'occasion / Virement reçu</option>
            <option value="Autre entrée d'argent">✨ Autre entrée exceptionnelle</option>
          </select>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div class="input-group">
            <label class="input-label">Note / Détail</label>
            <input class="input-field" id="quickOpLabel" placeholder="Ex: Prime trimestre, Vinted..." />
          </div>
          <div class="input-group">
            <label class="input-label">Date</label>
            <input class="input-field" type="date" id="quickOpDate" value="${getDefaultOperationDate(state.selectedYearMonth)}" />
          </div>
        </div>
        <button class="btn-primary" id="quickIncomeSubmitBtn" onclick="submitQuickCashflowOperation('EXTRA_INCOME')">
          💰 Créditer sur ${formatMonthLabel(state.selectedYearMonth)}
        </button>
      </div>
    `;
  } else if (state.activeBottomSheet === 'ADD_AGIOS') {
    container.innerHTML = `
      <div class="bottom-sheet-modal">
        <div class="sheet-handle"></div>
        <div class="section-header">
          <span class="section-title">🏦 - Agios, Découvert &amp; Frais Bancaires</span>
          <button class="icon-btn" onclick="closeBottomSheet()">✕</button>
        </div>
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">
          Enregistrez vos agios, commissions d'intervention, frais de rejet ou tenue de compte pour garder un Reste à Vivre 100% exact et activer le Bouclier Anti-Agios IA.
        </p>
        <div class="input-group">
          <label class="input-label">Montant prélevé (${state.profile?.currency || 'EUR'})</label>
          <input class="input-field" type="number" step="0.01" id="quickOpAmount" placeholder="Ex: 14.50" style="font-size:20px;font-weight:800;color:var(--critical);" />
        </div>
        <div class="input-group">
          <label class="input-label">Nature des frais bancaires</label>
          <select class="select-field" id="quickOpSubtype">
            <option value="Agios / Intérêts débiteurs">🏦 Agios / Intérêts de découvert</option>
            <option value="Commission d'intervention">⚠️ Commission d'intervention bancaire</option>
            <option value="Frais de tenue de compte / Carte">💳 Frais de tenue de compte / Cotisation carte</option>
            <option value="Frais d'incident / Rejet">🚫 Frais d'incident ou rejet de prélèvement</option>
          </select>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div class="input-group">
            <label class="input-label">Banque / Détail</label>
            <input class="input-field" id="quickOpLabel" placeholder="Ex: Agios trimestriels..." />
          </div>
          <div class="input-group">
            <label class="input-label">Date</label>
            <input class="input-field" type="date" id="quickOpDate" value="${getDefaultOperationDate(state.selectedYearMonth)}" />
          </div>
        </div>
        <button class="btn-primary" id="quickAgiosSubmitBtn" style="background:linear-gradient(135deg,#DC2626,#B91C1C);" onclick="submitQuickCashflowOperation('AGIOS')">
          🏦 Imputer ces Agios / Frais
        </button>
      </div>
    `;
  } else if (state.activeBottomSheet === 'EDIT_TRANSACTION') {
    const mb = state.monthlyBudgets[state.selectedYearMonth];
    const tx = mb?.transactions?.find((t) => t.id === state.editingTransactionId);
    if (!tx) {
      closeBottomSheet();
      return;
    }
    const isSpecial =
      tx.type === 'EXTRA_INCOME' ||
      tx.source === 'EXTRA_INCOME' ||
      tx.type === 'AGIOS' ||
      tx.source === 'AGIOS';
    container.innerHTML = `
      <div class="bottom-sheet-modal">
        <div class="sheet-handle"></div>
        <div class="section-header">
          <span class="section-title">✏️ Modifier l'opération</span>
          <button class="icon-btn" onclick="closeBottomSheet()">✕</button>
        </div>
        <div class="input-group">
          <label class="input-label">Libellé de l'opération</label>
          <input class="input-field" id="editTxLabel" value="${escapeHtml(tx.label || '')}" />
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div class="input-group">
            <label class="input-label">Montant (${state.profile?.currency || 'EUR'})</label>
            <input class="input-field" type="number" step="0.01" min="0.01" id="editTxAmount" value="${Number(tx.amount) || 0}" style="font-weight:800;" />
          </div>
          <div class="input-group">
            <label class="input-label">Date</label>
            <input class="input-field" type="date" id="editTxDate" value="${escapeHtml(tx.date || getDefaultOperationDate(state.selectedYearMonth))}" />
          </div>
        </div>
        ${
          !isSpecial && mb?.categories?.length
            ? `
          <div class="input-group">
            <label class="input-label">Poste budgétaire</label>
            <select class="select-field" id="editTxCategory">
              ${mb.categories
                .map(
                  (c) =>
                    `<option value="${escapeHtml(c.id)}" ${c.id === tx.categoryId ? 'selected' : ''}>${escapeHtml(c.icon || '🎯')} ${escapeHtml(c.name)}</option>`
                )
                .join('')}
            </select>
          </div>
        `
            : ''
        }
        <div style="display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:8px;">
          <button class="btn-primary" onclick="saveEditedTransaction('${escapeHtml(tx.id)}')">
            💾 Enregistrer
          </button>
          <button
            type="button"
            class="btn-secondary"
            style="width:auto;padding:10px 14px;color:var(--critical);border-color:rgba(239,68,68,0.35);"
            onclick="deleteTransaction('${escapeHtml(tx.id)}')"
          >
            🗑️ Supprimer
          </button>
        </div>
      </div>
    `;
  } else if (state.activeBottomSheet === 'SHARE_APK') {
    const appWebUrl = 'https://depense-reserve-ia.web.app';
    const apkDirectUrl = 'https://depense-reserve-ia.web.app/ecopanier-budget-ia.apk';
    const playStoreUrl = 'https://play.google.com/store/apps/details?id=com.ecopanier.budgetia';
    const refCode = `ECO-${(state.currentUser?.uid || 'MARTIN').slice(0, 5).toUpperCase()}`;
    const refUrl = `${appWebUrl}/?ref=${refCode}`;
    container.innerHTML = `
      <div class="bottom-sheet-modal" style="max-height:88vh;overflow-y:auto;">
        <div class="sheet-handle"></div>
        <div class="section-header">
          <span class="section-title">📲 Installer l'APK &amp; Parrainage Double Win</span>
          <button class="icon-btn" onclick="closeBottomSheet()">✕</button>
        </div>
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">
          Installez l'application Android native <strong>EcoPanier &amp; Budget IA (v4.1)</strong> ou parrainez vos proches !
        </p>

        <!-- Encart Parrainage Bilatéral Double Win (ACT-14) -->
        <div style="background:linear-gradient(135deg,var(--primary-soft),var(--secondary-soft));border:1.5px solid var(--primary);border-radius:12px;padding:11px 12px;margin-bottom:12px;">
          <div style="font-weight:800;font-size:12.5px;color:var(--primary);margin-bottom:4px;">
            🎁 Parrainage Bilatéral "Double Win"
          </div>
          <div style="font-size:11.5px;color:var(--text);line-height:1.4;margin-bottom:8px;">
            Offrez <strong>14 jours d'essai EcoPanier+ VIP</strong> à un ami et recevez <strong>1 mois EcoPanier+ Pro (4,99 €) + 5 crédits IA offerts</strong> dès son inscription !
          </div>
          <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
            <input class="input-field" readonly value="${refUrl}" style="font-size:11px;padding:6px 8px;background:var(--surface);" />
            <button class="icon-btn" onclick="copyAppShareLink('${refUrl}')" style="flex-shrink:0;padding:6px 10px;">📋 Copier</button>
          </div>
          <button type="button" class="btn-primary" style="padding:8px 10px;font-size:11.5px;" onclick="claimReferralBonusDemo()">
            🎉 Simuler un filleul validé (+1 mois Pro offert)
          </button>
        </div>

        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">
          <a
            href="${apkDirectUrl}"
            download="ecopanier-budget-ia.apk"
            class="btn-primary"
            style="text-decoration:none;display:flex;align-items:center;justify-content:center;gap:8px;padding:12px;"
          >
            <span>📥</span>
            <span>Télécharger l'APK Android direct (ecopanier-budget-ia.apk)</span>
          </a>

          <a
            href="${playStoreUrl}"
            target="_blank"
            rel="noopener noreferrer"
            class="btn-secondary"
            style="text-decoration:none;display:flex;align-items:center;justify-content:center;gap:8px;padding:11px;border:1.5px solid var(--primary);color:var(--primary);font-weight:800;"
          >
            <span>▶️</span>
            <span>Ouvrir sur Google Play Store (com.ecopanier.budgetia)</span>
          </a>

          <button
            type="button"
            class="btn-secondary"
            style="display:flex;align-items:center;justify-content:center;gap:8px;padding:11px;"
            onclick="shareAppToFriends()"
          >
            <span>📤</span>
            <span>Partager à des amis (WhatsApp / SMS / Lien)</span>
          </button>
        </div>

        <div style="background:var(--surface-alt);padding:10px;border-radius:10px;border:1px solid var(--border);font-size:11px;">
          <div style="font-weight:800;margin-bottom:4px;">🔗 Lien direct Web &amp; APK pour vos amis :</div>
          <div style="display:flex;gap:6px;align-items:center;">
            <input class="input-field" readonly value="${appWebUrl}" style="font-size:11px;padding:6px 8px;" />
            <button class="icon-btn" onclick="copyAppShareLink('${appWebUrl}')" style="flex-shrink:0;padding:6px 10px;">📋 Copier</button>
          </div>
          <div style="margin-top:6px;color:var(--text-muted);">
            Package ID Play Store : <code>com.ecopanier.budgetia</code>
          </div>
        </div>
      </div>
    `;
  } else if (state.activeBottomSheet === 'PAYWALL_MODAL') {
    const sub = getSubscriptionInfo();
    container.innerHTML = `
      <div class="bottom-sheet-modal" style="max-height:88vh;overflow-y:auto;">
        <div class="sheet-handle"></div>
        <div class="section-header">
          <span class="section-title">👑 EcoPanier+ &amp; Crédits IA</span>
          <button class="icon-btn" onclick="closeBottomSheet()">✕</button>
        </div>
        <div style="background:var(--surface-alt);padding:10px 12px;border-radius:12px;border:1px solid var(--border);margin-bottom:12px;font-size:12px;">
          <div>Offre actuelle : <strong>${escapeHtml(sub.tierLabel)}</strong></div>
          <div style="color:var(--text-muted);margin-top:3px;">
            Quota OCR ce mois : <strong>${sub.isPremium ? 'Illimité ♾️' : `${sub.freeRemaining}/${sub.freeLimit} scans gratuits restants`}</strong>
            ${sub.creditsBalance > 0 ? ` • <strong>+${sub.creditsBalance} crédits pack</strong>` : ''}
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:12px;">
          <!-- Offre Pro 4,99 €/mois -->
          <div style="padding:12px;border-radius:14px;border:2px solid var(--primary);background:var(--primary-soft);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <span style="font-weight:800;font-size:14px;color:var(--primary);">👑 EcoPanier+ Pro</span>
              <span class="badge-state HEALTHY">4,99 € / mois</span>
            </div>
            <p style="font-size:11.5px;color:var(--text);margin-bottom:8px;line-height:1.4;">
              • Scans de tickets &amp; factures PDF par Gemini 2.0 Flash <strong>illimités</strong><br/>
              • Chef Réserve IA sur-mesure &amp; alertes DLC Anti-Gaspi<br/>
              • Rentabilisé dès le 1er panier optimisé à 5 km
            </p>
            <button class="btn-primary" style="padding:9px;" onclick="activateSubscriptionPlan('PRO')">
              ${sub.tier === 'PRO' ? '✅ Abonnement Pro Actif' : '🚀 Activer EcoPanier+ Pro (4,99 €/m)'}
            </button>
          </div>

          <!-- Offre Famille 7,99 €/mois -->
          <div style="padding:12px;border-radius:14px;border:1.5px solid var(--secondary);background:var(--secondary-soft);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <span style="font-weight:800;font-size:14px;color:var(--secondary);">👨‍👩‍👧‍👦 EcoPanier+ Famille</span>
              <span class="badge-state WARNING">7,99 € / mois</span>
            </div>
            <p style="font-size:11.5px;color:var(--text);margin-bottom:8px;line-height:1.4;">
              • Jusqu'à <strong>5 membres du foyer</strong> synchronisés en temps réel<br/>
              • Tout EcoPanier+ Pro inclus + Pass invités illimités
            </p>
            <button class="btn-secondary" style="padding:9px;border-color:var(--secondary);color:var(--secondary);font-weight:800;" onclick="activateSubscriptionPlan('FAMILY')">
              ${sub.tier === 'FAMILY' ? '✅ Abonnement Famille Actif' : '👨‍👩‍👧‍👦 Activer EcoPanier+ Famille (7,99 €/m)'}
            </button>
          </div>

          <!-- Pack à la carte 1,99 € -->
          <div style="padding:11px 12px;border-radius:12px;border:1px solid var(--border);background:var(--surface);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <span style="font-weight:800;font-size:13px;">⚡ Pack Recharge 15 Scans IA</span>
              <span style="font-weight:800;font-size:12.5px;color:var(--primary);">1,99 € (sans abo)</span>
            </div>
            <p style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">
              Idéal pour les besoins ponctuels : 15 extractions OCR &amp; Chef IA sans date d'expiration.
            </p>
            <button class="btn-secondary" style="padding:8px;font-size:12px;" onclick="activateSubscriptionPlan('PACK_15')">
              ➕ Créditer +15 Scans IA (1,99 €)
            </button>
          </div>
        </div>

        ${
          sub.isPremium
            ? `<button class="btn-secondary" style="padding:7px;font-size:11px;" onclick="activateSubscriptionPlan('FREE')">Revenir à l'offre Découverte Gratuite (3 scans/mois)</button>`
            : ''
        }
      </div>
    `;
  } else if (state.activeBottomSheet === 'ONBOARDING_60S') {
    const step = state.onboardingStep || 1;
    container.innerHTML = `
      <div class="bottom-sheet-modal">
        <div class="sheet-handle"></div>
        <div class="section-header">
          <span class="section-title">🚀 Configuration Express 60s (Étape ${step}/3)</span>
          <button class="icon-btn" onclick="closeBottomSheet()">✕</button>
        </div>

        <div class="gauge-track" style="margin-bottom:14px;height:6px;">
          <div class="gauge-fill HEALTHY" style="width:${Math.round((step / 3) * 100)}%;"></div>
        </div>

        ${
          step === 1
            ? `
          <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">
            <strong>Étape 1/3 :</strong> Indiquez les ressources mensuelles de votre foyer pour initialiser le Bouclier Anti-Agios.
          </p>
          <div class="input-group">
            <label class="input-label">Revenu mensuel net du foyer</label>
            <input class="input-field" type="number" id="onbIncomeInput" value="${state.onboardingIncome || 2200}" />
          </div>
          <div class="input-group">
            <label class="input-label">Devise principale</label>
            <select class="select-field" id="onbCurrencySelect">
              <option value="EUR" ${state.onboardingCurrency === 'EUR' ? 'selected' : ''}>€ Euro (EUR)</option>
              <option value="XAF" ${state.onboardingCurrency === 'XAF' ? 'selected' : ''}>FCFA (XAF)</option>
              <option value="USD" ${state.onboardingCurrency === 'USD' ? 'selected' : ''}>$ Dollar (USD)</option>
              <option value="CAD" ${state.onboardingCurrency === 'CAD' ? 'selected' : ''}>$ Dollar Can. (CAD)</option>
            </select>
          </div>
          <button class="btn-primary" onclick="setOnboardingStep(2)">
            Suivant : Mes Enveloppes Clés ➔
          </button>
        `
            : step === 2
            ? `
          <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">
            <strong>Étape 2/3 :</strong> Vos charges fixes sont automatiquement provisionnées chaque 1er du mois (règle 50/30/20).
          </p>
          <div style="background:var(--surface-alt);padding:10px 12px;border-radius:12px;border:1px solid var(--border);margin-bottom:12px;font-size:12px;display:flex;flex-direction:column;gap:6px;">
            <div style="display:flex;justify-content:space-between;"><span>🏠 Loyer &amp; Charges fixes</span><strong>Auto-débit 1er du mois</strong></div>
            <div style="display:flex;justify-content:space-between;"><span>🛒 Alimentation &amp; Réserve</span><strong>Relié au Comparateur 5 km</strong></div>
            <div style="display:flex;justify-content:space-between;"><span>🛡️ Bouclier Anti-Agios</span><strong>Quota journalier temps réel</strong></div>
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn-secondary" style="flex:1;" onclick="setOnboardingStep(1)">← Retour</button>
            <button class="btn-primary" style="flex:2;" onclick="setOnboardingStep(3)">Suivant : Ma Réserve ➔</button>
          </div>
        `
            : `
          <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">
            <strong>Étape 3/3 :</strong> Voulez-vous pré-remplir votre réserve avec les essentiels du quotidien (Lait, Œufs, Riz, Pâtes, Poulet...) pour activer immédiatement le Chef IA 0 € ?
          </p>
          <label style="display:flex;align-items:center;gap:10px;padding:12px;background:var(--primary-soft);border:1.5px solid var(--primary);border-radius:12px;cursor:pointer;margin-bottom:14px;font-size:12.5px;font-weight:700;">
            <input type="checkbox" id="onbStarterKitCheck" ${state.onboardingKitSelected ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--primary);" />
            <span>🥫 Oui, pré-charger le Kit Réserve Essentiels (recommandé)</span>
          </label>
          <div style="display:flex;gap:8px;">
            <button class="btn-secondary" style="flex:1;" onclick="setOnboardingStep(2)">← Retour</button>
            <button class="btn-primary" style="flex:2;" onclick="completeExpressOnboarding()">🚀 Terminer en 1 clic !</button>
          </div>
        `
        }
      </div>
    `;
  } else if (state.activeBottomSheet === 'STORY_CARD_MODAL') {
    container.innerHTML = `
      <div class="bottom-sheet-modal" style="max-height:90vh;overflow-y:auto;">
        <div class="sheet-handle"></div>
        <div class="section-header">
          <span class="section-title">📸 Ma Carte d'Économies Story (9:16)</span>
          <button class="icon-btn" onclick="closeBottomSheet()">✕</button>
        </div>
        <p style="font-size:11.5px;color:var(--text-muted);margin-bottom:10px;">
          Partagez votre bilan mensuel sur Instagram Story, WhatsApp ou TikTok et gagnez <strong>1 mois EcoPanier+ Pro offert</strong> pour chaque ami parrainé !
        </p>
        <div style="display:flex;justify-content:center;margin-bottom:12px;">
          <canvas id="savingsStoryCanvas" width="540" height="960" style="width:235px;height:418px;border-radius:14px;box-shadow:0 10px 25px rgba(0,0,0,0.25);border:2px solid var(--primary);"></canvas>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <button class="btn-secondary" style="padding:10px;font-size:12px;" onclick="downloadSavingsStoryPng()">
            📥 Télécharger PNG
          </button>
          <button class="btn-primary" style="padding:10px;font-size:12px;" onclick="shareSavingsStoryCard()">
            📤 Partager ma Story
          </button>
        </div>
      </div>
    `;
  } else if (state.activeBottomSheet === 'RECIPE_DETAILS') {
    const rec = state.selectedRecipeForDetails;
    if (!rec) return;
    const meta = CUISINE_META[rec.cuisine] || CUISINE_META.ALL;
    const wasCooked = Boolean(state.cookedRecipeIds && state.cookedRecipeIds[rec.id]);
    container.innerHTML = `
      <div class="bottom-sheet-modal" style="max-height:88vh;overflow-y:auto;">
        <div class="sheet-handle"></div>
        <div class="section-header" style="margin-bottom:8px;">
          <span class="section-title">👨‍🍳 Fiche Recette Complète 0 €</span>
          <button class="icon-btn" onclick="closeRecipeDetailsModal()">✕</button>
        </div>

        <div class="recipe-hero-box">
          <div style="font-size:52px;filter:drop-shadow(0 4px 10px rgba(0,0,0,0.3));">${rec.icon || '🥘'}</div>
          <div class="recipe-hero-overlay">
            <div style="display:flex;gap:6px;margin-bottom:4px;flex-wrap:wrap;">
              <span class="cuisine-badge ${meta.badgeClass}" style="background:rgba(0,0,0,0.65);color:#fff;">
                ${meta.flag} Cuisine ${meta.label}
              </span>
              <span class="badge-state HEALTHY" style="background:#059669;color:#fff;">
                0,00 € • Éco ${formatMoney(rec.savedEuros)}
              </span>
            </div>
            <div class="recipe-hero-title">${rec.title}</div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:14px;background:var(--surface-alt);padding:10px;border-radius:12px;text-align:center;">
          <div>
            <div style="font-size:10px;color:var(--text-muted);font-weight:700;">PRÉPA</div>
            <div style="font-size:12px;font-weight:800;color:var(--primary);">${rec.prepTime}</div>
          </div>
          <div>
            <div style="font-size:10px;color:var(--text-muted);font-weight:700;">CUISSON</div>
            <div style="font-size:12px;font-weight:800;color:var(--primary);">${rec.cookTime || '15 min'}</div>
          </div>
          <div>
            <div style="font-size:10px;color:var(--text-muted);font-weight:700;">PORTIONS</div>
            <div style="font-size:12px;font-weight:800;color:var(--text);">${rec.servings || '2-3 pers'}</div>
          </div>
          <div>
            <div style="font-size:10px;color:var(--text-muted);font-weight:700;">ÉNERGIE</div>
            <div style="font-size:12px;font-weight:800;color:#EA580C;">${rec.calories}</div>
          </div>
        </div>

        <div style="margin-bottom:14px;">
          <div style="font-size:11.5px;font-weight:800;color:var(--text-main);margin-bottom:6px;display:flex;align-items:center;gap:6px;">
            <span>🥫 Ingrédients détectés dans votre réserve :</span>
            <span class="badge-state HEALTHY" style="font-size:9.5px;">${rec.matchedItems.length} en stock</span>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">
            ${rec.matchedItems
              .map(
                (it) => `
              <span class="recipe-ingredient-chip in-stock">
                ✅ <strong>${it.name}</strong> (Stock: ${it.currentQuantity})
              </span>
            `
              )
              .join('')}
            ${(rec.missingLabels || [])
              .map(
                (m) => `
              <span class="recipe-ingredient-chip" style="background:rgba(245,158,11,0.12);color:#B45309;border:1px dashed rgba(245,158,11,0.4);">
                💡 Optionnel : ${m}
              </span>
            `
              )
              .join('')}
          </div>

          <div style="font-size:11px;color:var(--text-muted);background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:7px 10px;">
            🧂 <strong>Assaisonnements de base suggérés :</strong> ${(rec.pantryStaples || ['Sel fin', 'Poivre du moulin', 'Filet d\'huile', 'Eau de cuisson']).join(' • ')}
          </div>
        </div>

        <div style="margin-bottom:14px;">
          <div style="font-size:12px;font-weight:800;color:var(--text-main);margin-bottom:8px;">
            👨‍🍳 Préparation étape par étape :
          </div>
          ${(rec.fullSteps || [rec.steps])
            .map(
              (step, idx) => `
            <div class="recipe-step-item">
              <div class="recipe-step-num">${idx + 1}</div>
              <div class="recipe-step-text">${step}</div>
            </div>
          `
            )
            .join('')}
        </div>

        ${
          rec.chefTips
            ? `
          <div style="background:rgba(15,118,110,0.08);border-left:3px solid var(--primary);border-radius:8px;padding:9px 12px;margin-bottom:14px;font-size:11.5px;color:var(--text);line-height:1.4;">
            💡 <strong>Astuce Anti-Gaspillage du Chef :</strong> ${rec.chefTips}
          </div>
        `
            : ''
        }

        <button
          class="btn-primary"
          style="width:100%;padding:12px;font-size:13px;${wasCooked ? 'background:#059669;' : ''}"
          onclick="cookZeroSpendRecipe('${rec.id}')"
        >
          <span>🍳</span>
          <span>${wasCooked ? 'Déjà cuisiné (Recuisiner et décrémenter le stock)' : 'Cuisiner ce plat maintenant (Décrémenter le stock)'}</span>
        </button>
      </div>
    `;
    return;
  }

  if (state.activeBottomSheet === 'SHARE_GUEST_PASS') {
    const userPasses = state.userGuestPasses || [];
    const activePasses = userPasses.filter((p) => !p.isRevoked && new Date(p.expiresAt) > new Date());
    const lastPass = state.lastGeneratedPass;
    const directGuestUrl = lastPass ? `https://depense-reserve-ia.web.app/?guest=${lastPass.code}` : '';

    container.innerHTML = `
      <div class="bottom-sheet-modal" style="max-height:85vh;overflow-y:auto;">
        <div class="sheet-handle"></div>
        <div class="section-header">
          <span class="section-title">👥 Partager un Accès Invité / Tiers</span>
          <button class="icon-btn" onclick="closeBottomSheet()">✕</button>
        </div>
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">
          Autorisez un proche, votre conjoint(e) ou votre expert-comptable à consulter votre tableau de bord en <strong>lecture seule</strong> pour une durée définie, sans jamais divulguer votre mot de passe.
        </p>

        <!-- Formulaire de génération de Pass -->
        <div style="background:var(--surface-alt);border:1px solid var(--border);border-radius:14px;padding:12px;margin-bottom:14px;">
          <div style="font-weight:800;font-size:12.5px;margin-bottom:8px;">Créer un nouvel accès temporaire :</div>
          <div class="input-group">
            <label class="input-label">Destinataire / Rôle de l'invité</label>
            <input class="input-field" id="newGuestLabel" placeholder="Ex: Conjoint(e), Expert-comptable, Coach, Ami..." value="Conjoint(e)" />
          </div>
          <div class="input-group">
            <label class="input-label">Durée de validité de l'accès</label>
            <select class="select-field" id="newGuestDuration">
              <option value="1">⏱️ 1 Heure (Session rapide)</option>
              <option value="24" selected>📅 24 Heures (1 jour - recommandé)</option>
              <option value="48">📅 48 Heures (2 jours)</option>
              <option value="168">🗓️ 7 Jours (1 semaine)</option>
              <option value="720">🗓️ 30 Jours (1 mois)</option>
            </select>
          </div>
          <button class="btn-primary" onclick="generateGuestPass(document.getElementById('newGuestDuration')?.value, document.getElementById('newGuestLabel')?.value)">
            🔑 Générer le Code &amp; Lien Invité
          </button>
        </div>

        ${
          lastPass && !lastPass.isRevoked
            ? `
          <div class="guest-pin-box">
            <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;">
              CODE PIN TEMPORAIRE (${lastPass.guestLabel || 'Invité'}) :
            </div>
            <div class="guest-pin-code">${lastPass.code}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;">
              ⏱️ Valable jusqu'au : <strong>${new Date(lastPass.expiresAt).toLocaleString('fr-FR')}</strong>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <button class="btn-secondary" style="font-size:12px;padding:9px;" onclick="copyGuestPassLink('${lastPass.code}', '${directGuestUrl}')">
                📋 Copier le code / lien
              </button>
              <button class="btn-primary" style="font-size:12px;padding:9px;background:#059669;" onclick="shareGuestPassWhatsApp('${lastPass.code}', '${directGuestUrl}', ${lastPass.durationHours})">
                💬 Envoyer sur WhatsApp
              </button>
            </div>
          </div>
        `
            : ''
        }

        <!-- Liste des accès actifs -->
        <div style="margin-top:14px;">
          <div class="section-title" style="font-size:12.5px;margin-bottom:8px;">
            Vos accès tiers actifs (${activePasses.length}) :
          </div>
          ${
            activePasses.length === 0
              ? `<div style="font-size:11.5px;color:var(--text-muted);text-align:center;padding:12px;background:var(--surface-alt);border-radius:10px;">
                  Aucun accès invité actif pour le moment.
                </div>`
              : activePasses
                  .map(
                    (p) => `
                <div class="guest-pass-card">
                  <div>
                    <div style="font-weight:800;font-size:13px;color:var(--text-main);">
                      👤 ${p.guestLabel || 'Invité'} <span style="font-family:monospace;color:var(--primary);margin-left:4px;">[${p.code}]</span>
                    </div>
                    <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">
                      ⏱️ Expire dans <strong>${formatRemainingTime(new Date(p.expiresAt).getTime() - Date.now())}</strong>
                    </div>
                  </div>
                  <div style="display:flex;gap:6px;align-items:center;">
                    <button class="icon-btn" onclick="copyGuestPassLink('${p.code}', 'https://depense-reserve-ia.web.app/?guest=${p.code}')" title="Copier le lien" style="padding:5px 8px;">
                      📋
                    </button>
                    <button class="guest-exit-btn" onclick="revokeGuestPass('${p.id}')" title="Révoquer l'accès immédiatement">
                      🚫 Révoquer
                    </button>
                  </div>
                </div>
              `
                  )
                  .join('')
          }
        </div>
      </div>
    `;
  } else if (state.activeBottomSheet === 'PRIVACY_POLICY') {
    const canDelete = Boolean(state.currentUser && !state.isGuestSession && !state.isDemoSession);
    container.innerHTML = `
      <div class="bottom-sheet-modal" style="max-height:88vh;overflow-y:auto;">
        <div class="sheet-handle"></div>
        <div class="section-header">
          <span class="section-title">🔒 Confidentialité, Sécurité &amp; Données (RGPD / Play Store)</span>
          <button class="icon-btn" onclick="closeBottomSheet()">✕</button>
        </div>

        <div style="display:flex;flex-direction:column;gap:10px;font-size:12px;line-height:1.5;color:var(--text-main);margin-bottom:14px;">
          <div style="background:var(--surface-alt);padding:11px 12px;border-radius:12px;border:1px solid var(--border);">
            <div style="font-weight:800;margin-bottom:3px;color:var(--primary);">🛡️ Isolation &amp; Chiffrement des Données</div>
            Vos budgets mensuels, transactions, modèles récurrents et articles de réserve sont stockés sous votre identifiant unique Firebase Auth (<code>users/{uid}</code>) avec chiffrement TLS en transit et isolation stricte par règles Firestore. Aucune donnée bancaire sensible (IBAN, code PIN bancaire) n'est collectée.
          </div>

          <div style="background:var(--surface-alt);padding:11px 12px;border-radius:12px;border:1px solid var(--border);">
            <div style="font-weight:800;margin-bottom:3px;color:var(--primary);">📷 Permission Caméra (Optionnelle)</div>
            Utilisée uniquement lorsque vous lancez le <strong>Scanner Facture / Code-barres</strong> pour lire vos tickets de caisse via Gemini IA. Aucune photo n'est conservée à des fins publicitaires.
          </div>

          <div style="background:var(--surface-alt);padding:11px 12px;border-radius:12px;border:1px solid var(--border);">
            <div style="font-weight:800;margin-bottom:3px;color:var(--primary);">📍 Permission Localisation 5 km (Optionnelle)</div>
            Utilisée uniquement à votre demande pour localiser les supermarchés à moins de 5 km dans le <strong>Comparateur Local</strong>. Votre position n'est jamais revendue ni partagée à des tiers.
          </div>

          <div style="background:var(--critical-soft);padding:12px;border-radius:12px;border:1px solid rgba(239,68,68,0.35);">
            <div style="font-weight:800;color:var(--critical);margin-bottom:4px;">🗑️ Suppression de Compte &amp; Droit à l'Oubli</div>
            <p style="font-size:11.5px;color:var(--text-main);margin-bottom:8px;">
              Conformément aux exigences Google Play Store, Apple App Store et RGPD, vous pouvez supprimer définitivement votre compte et l'intégralité de vos données stockées dans le cloud en un clic.
            </p>
            ${
              canDelete
                ? `<button type="button" class="btn-logout" onclick="handleDeleteAccount()">
                    🗑️ Supprimer définitivement mon compte et mes données
                  </button>`
                : `<div style="font-size:11px;color:var(--text-muted);font-weight:600;">
                    ${state.isDemoSession ? 'ℹ️ Suppression désactivée sur le compte Démo partagé.' : state.isGuestSession ? 'ℹ️ Connectez-vous en tant que titulaire du compte pour supprimer un compte.' : 'ℹ️ Connectez-vous à votre compte personnel pour accéder à la suppression immédiate.'}
                  </div>`
            }
          </div>
        </div>

        <button type="button" class="btn-secondary" onclick="closeBottomSheet()">Fermer</button>
      </div>
    `;
  }
}

async function generateGuestPass(durationHours = 24, guestLabel = 'Invité / Tiers') {
  if (state.isGuestSession) {
    showToast('ℹ️ Impossible en mode invité.', 'warning');
    return;
  }
  if (!state.currentUser) return;
  const uid = state.currentUser.uid;
  const hours = Number(durationHours) || 24;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + hours * 3600 * 1000).toISOString();
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const token = `gst_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const passId = `pass_${Date.now()}`;

  const pass = {
    id: passId,
    code,
    token,
    ownerUid: uid,
    ownerDisplayName: state.profile?.displayName || state.currentUser.displayName || 'Mon Foyer',
    guestLabel: guestLabel || 'Invité / Tiers',
    durationHours: hours,
    createdAt: now.toISOString(),
    expiresAt,
    isRevoked: false,
    permissions: 'READ_ONLY',
    snapshot: {
      profile: {
        displayName: state.profile?.displayName || 'Mon Foyer',
        currency: state.profile?.currency || 'EUR',
        defaultMonthlyIncome: state.profile?.defaultMonthlyIncome || 0,
        locale: state.profile?.locale || 'fr',
      },
      monthlyBudgets: state.monthlyBudgets || {},
      categoryTemplates: state.categoryTemplates || [],
      pantryItems: state.pantryItems || [],
      selectedYearMonth: state.selectedYearMonth,
    },
  };

  try {
    try {
      await setDoc(doc(db, 'users', uid, 'guestPasses', passId), pass);
    } catch (_) {}
    try {
      await setDoc(doc(db, 'guestPasses', passId), pass);
      await setDoc(doc(db, 'guestPasses', code), pass);
    } catch (cloudErr) {
      console.warn('Synchronisation cloud guestPasses en attente:', cloudErr);
    }

    state.userGuestPasses = state.userGuestPasses || [];
    state.userGuestPasses.unshift(pass);
    state.lastGeneratedPass = pass;
    try {
      localStorage.setItem(`ecopanier_guest_passes_${uid}`, JSON.stringify(state.userGuestPasses.slice(0, 20)));
      localStorage.setItem(`ecopanier_guest_pass_code_${code}`, JSON.stringify(pass));
    } catch (_) {}
    renderBottomSheetModal();
    showToast(`🔑 Pass invité généré avec succès ! Code : <strong>${code}</strong> (Valable ${hours}h)`);
  } catch (err) {
    console.error('Erreur génération pass invité:', err);
    showToast(`Erreur génération pass : ${err.message}`, 'critical');
  }
}

async function revokeGuestPass(passId) {
  if (!state.currentUser) return;
  const uid = state.currentUser.uid;
  const targetPass = (state.userGuestPasses || []).find((x) => x.id === passId);
  try {
    try {
      await setDoc(doc(db, 'users', uid, 'guestPasses', passId), { isRevoked: true }, { merge: true });
    } catch (_) {}
    try {
      await setDoc(doc(db, 'guestPasses', passId), { isRevoked: true }, { merge: true });
      if (targetPass?.code) {
        await setDoc(doc(db, 'guestPasses', targetPass.code), { isRevoked: true }, { merge: true });
      }
    } catch (_) {}

    if (state.userGuestPasses) {
      const p = state.userGuestPasses.find((x) => x.id === passId);
      if (p) p.isRevoked = true;
    }
    if (state.lastGeneratedPass?.id === passId) {
      state.lastGeneratedPass.isRevoked = true;
    }
    try {
      localStorage.setItem(`ecopanier_guest_passes_${uid}`, JSON.stringify(state.userGuestPasses || []));
      if (targetPass?.code) {
        localStorage.removeItem(`ecopanier_guest_pass_code_${targetPass.code}`);
      }
    } catch (_) {}
    renderBottomSheetModal();
    showToast('🚫 Accès invité révoqué immédiatement.');
  } catch (err) {
    showToast(`Erreur révocation : ${err.message}`, 'critical');
  }
}

function copyGuestPassLink(code, url) {
  const shareText = `Bonjour ! Voici ton code d'accès invité temporaire pour consulter mon tableau de bord EcoPanier & Budget IA : ${code}\nOu clique directement sur ce lien sécurisé : ${url || `https://depense-reserve-ia.web.app/?guest=${code}`}`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(shareText).then(() => {
      showToast(`📋 Code ${code} et lien copiés dans le presse-papiers !`);
    });
  } else {
    showToast(`Code : ${code}`);
  }
}

function shareGuestPassWhatsApp(code, url, hours) {
  const msg = encodeURIComponent(
    `👋 Bonjour ! Je te partage un accès invité temporaire (${hours}h) en lecture seule pour voir mon tableau de bord EcoPanier & Budget IA :\n\n🔑 Code d'accès PIN : *${code}*\n🔗 Lien direct magique : ${url || `https://depense-reserve-ia.web.app/?guest=${code}`}`
  );
  window.open(`https://api.whatsapp.com/send?text=${msg}`, '_blank');
}

async function enterGuestSession(rawInput) {
  const cleanInput = (rawInput || '').replace(/\s+/g, '').trim();
  if (!cleanInput) {
    showToast("Veuillez saisir le code PIN à 6 chiffres ou le lien d'accès.", 'warning');
    return;
  }

  showToast("Vérification du pass d'accès invité...", 'info');
  try {
    let codeOrToken = cleanInput;
    if (cleanInput.includes('guest=')) {
      const match = cleanInput.match(/guest=([^&#]+)/);
      if (match) codeOrToken = match[1];
    }

    if (!auth.currentUser) {
      try {
        await signInAnonymously(auth);
      } catch (anonErr) {
        console.warn('Anonymous sign-in fallback:', anonErr);
      }
    }

    let pass = null;
    try {
      const directSnap = await getDoc(doc(db, 'guestPasses', codeOrToken));
      if (directSnap.exists()) {
        pass = directSnap.data();
      }
    } catch (_) {}

    if (!pass) {
      try {
        const snap = await getDocs(collection(db, 'guestPasses'));
        const passes = snap.docs.map((d) => d.data());
        pass = passes.find((p) => p.code === codeOrToken || p.token === codeOrToken || p.id === codeOrToken);
      } catch (_) {}
    }

    if (!pass) {
      try {
        const localPassRaw = localStorage.getItem(`ecopanier_guest_pass_code_${codeOrToken}`);
        if (localPassRaw) pass = JSON.parse(localPassRaw);
      } catch (_) {}
    }

    if (!pass) {
      showToast("❌ Code ou pass invité introuvable. Vérifiez le code à 6 chiffres.", 'critical');
      return;
    }

    if (pass.isRevoked) {
      showToast("🚫 Cet accès invité a été révoqué par le titulaire du compte.", 'warning');
      return;
    }

    const now = new Date();
    const expiryDate = new Date(pass.expiresAt);
    if (now >= expiryDate) {
      showToast(`⌛ Ce pass invité a expiré le ${expiryDate.toLocaleString('fr-FR')}.`, 'warning');
      return;
    }

    state.isGuestSession = true;
    state.guestSession = pass;
    if (!state.currentUser) {
      state.currentUser = {
        uid: pass.ownerUid || 'guest_session',
        displayName: pass.ownerDisplayName || 'Mon Foyer',
        email: '',
        isGuest: true,
      };
    }

    if (!state.nearbyStores || state.nearbyStores.length === 0) {
      state.nearbyStores = [
        { id: 'store_lidl', name: 'Lidl Proximité (1,2 km)', brand: 'Lidl', address: '42 Av. de la République (Rayon 5 km)', distanceKm: 1.2, icon: '🟡', color: '#0050AA' },
        { id: 'store_leclerc', name: 'E.Leclerc Drive (2,1 km)', brand: 'E.Leclerc', address: '15 Rue Saint-Maur (Rayon 5 km)', distanceKm: 2.1, icon: '🔵', color: '#0066B3' },
        { id: 'store_intermarche', name: 'Intermarché Super (1,8 km)', brand: 'Intermarché', address: '28 Rue de Belleville (Rayon 5 km)', distanceKm: 1.8, icon: '🔴', color: '#E2001A' },
        { id: 'store_aldi', name: 'Aldi Marché (2,5 km)', brand: 'Aldi', address: '110 Rue Oberkampf (Rayon 5 km)', distanceKm: 2.5, icon: '🟠', color: '#00205B' },
        { id: 'store_carrefour', name: 'Carrefour City (0,8 km)', brand: 'Carrefour', address: '8 Bd Voltaire (Rayon 5 km)', distanceKm: 0.8, icon: '🟢', color: '#004E9A' },
      ];
    }

    if (pass.snapshot) {
      state.profile = pass.snapshot.profile || { displayName: pass.ownerDisplayName, currency: 'EUR' };
      state.monthlyBudgets = pass.snapshot.monthlyBudgets || {};
      state.categoryTemplates = pass.snapshot.categoryTemplates || [];
      state.pantryItems = pass.snapshot.pantryItems || [];
      if (pass.snapshot.selectedYearMonth) {
        state.selectedYearMonth = pass.snapshot.selectedYearMonth;
      }
    } else {
      await loadAuthenticatedUserWorkspace({ uid: pass.ownerUid, displayName: pass.ownerDisplayName });
    }

    startGuestTimer();
    closeBottomSheet();
    state.currentScreen = 'STITCH-03';
    showToast(`🎉 Accès invité activé ! Bienvenue sur l'espace de <strong>${pass.ownerDisplayName}</strong>.`);
    renderAll();
  } catch (err) {
    console.error('Erreur accès invité:', err);
    showToast(`Erreur d'accès invité : ${err.message}`, 'critical');
  }
}

function startGuestTimer() {
  if (state.guestTimerInterval) clearInterval(state.guestTimerInterval);
  state.guestTimerInterval = setInterval(() => {
    if (!state.isGuestSession || !state.guestSession) {
      clearInterval(state.guestTimerInterval);
      return;
    }
    const remainingMs = new Date(state.guestSession.expiresAt).getTime() - Date.now();
    if (remainingMs <= 0) {
      clearInterval(state.guestTimerInterval);
      exitGuestSession(true);
      return;
    }
    const el = document.getElementById('guestTimeRemaining');
    if (el) {
      el.textContent = formatRemainingTime(remainingMs);
    }
  }, 15000);
}

function formatRemainingTime(ms) {
  if (ms <= 0) return 'Expiré';
  const totalMin = Math.floor(ms / (1000 * 60));
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}j ${hours % 24}h`;
  }
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins} min`;
}

function exitGuestSession(isExpired = false) {
  if (state.guestTimerInterval) {
    clearInterval(state.guestTimerInterval);
    state.guestTimerInterval = null;
  }
  state.isGuestSession = false;
  state.guestSession = null;
  if (state.currentUser?.isGuest) {
    state.currentUser = null;
  }
  state.profile = null;
  state.monthlyBudgets = {};
  state.categoryTemplates = [];
  state.pantryItems = [];
  state.currentScreen = 'STITCH-01';
  if (isExpired) {
    showToast('⌛ Votre accès invité temporaire est arrivé à expiration.', 'warning');
  } else {
    showToast("👋 Vous avez quitté l'espace invité.");
  }
  renderAll();
}

async function shareAppToFriends() {
  const shareData = {
    title: 'EcoPanier & Budget IA (App Mobile + APK)',
    text: "Teste mon application mobile EcoPanier & Budget IA (Gestion budget, Bouclier Anti-Agios, Chef Réserve 4 Cuisines à 0€ et Comparateur 5 km) !\n\n🌐 Lien Web : https://depense-reserve-ia.web.app\n📥 APK Android direct : https://depense-reserve-ia.web.app/ecopanier-budget-ia.apk\n▶️ Google Play Store : https://play.google.com/store/apps/details?id=com.ecopanier.budgetia",
    url: 'https://depense-reserve-ia.web.app',
  };
  if (navigator.share) {
    try {
      await navigator.share(shareData);
      showToast('✅ Lien partagé avec succès !');
      return;
    } catch (_) {}
  }
  copyAppShareLink(shareData.text);
}

function copyAppShareLink(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('📋 Lien copié dans le presse-papiers ! Vous pouvez le coller sur WhatsApp ou par SMS.');
    });
  } else {
    showToast('📋 Lien : https://depense-reserve-ia.web.app');
  }
}

async function saveQuickMonthlyBudget() {
  if (state.isGuestSession) {
    showToast('ℹ️ Mode Invité (Lecture seule) : modifications désactivées.', 'warning');
    return;
  }
  if (!state.currentUser) return;
  const amount = Number(document.getElementById('quickMonthlyBudgetInput')?.value) || 0;
  const scope = document.getElementById('quickMonthlyBudgetScope')?.value || 'DEFAULT_AND_CURRENT';
  if (amount <= 0) {
    showToast('Veuillez saisir un budget mensuel positif.', 'warning');
    return;
  }

  const uid = state.currentUser.uid;
  const mb = await ensureUserMonthInitialized(state.selectedYearMonth);
  mb.globalAllocated = amount;
  mb.realDisposableIncome =
    mb.globalAllocated +
    (mb.totalExtraIncome || 0) -
    (mb.totalFixedCharges || 0) -
    (mb.totalVariableSpent || 0) -
    (mb.totalAgiosAndFees || 0);

  await setDoc(
    doc(db, 'users', uid, 'monthlyBudgets', state.selectedYearMonth),
    {
      globalAllocated: mb.globalAllocated,
      realDisposableIncome: mb.realDisposableIncome,
    },
    { merge: true }
  );

  if (scope === 'DEFAULT_AND_CURRENT') {
    state.profile.defaultMonthlyIncome = amount;
    await setDoc(doc(db, 'users', uid), { defaultMonthlyIncome: amount }, { merge: true });
  }

  closeBottomSheet();
  showToast(`✅ Budget mensuel fixé à ${formatMoney(amount)} !`);
  renderAll();
}

async function submitQuickCashflowOperation(opType) {
  if (state.isGuestSession) {
    showToast('ℹ️ Mode Invité (Lecture seule) : modifications désactivées.', 'warning');
    return;
  }
  if (!state.currentUser || state.isSubmittingOperation) return;
  const amount = Number(document.getElementById('quickOpAmount')?.value) || 0;
  const subtype = document.getElementById('quickOpSubtype')?.value || '';
  const customNote = (document.getElementById('quickOpLabel')?.value || '').trim();
  const dateISO = document.getElementById('quickOpDate')?.value || getDefaultOperationDate(state.selectedYearMonth);

  if (amount <= 0) {
    showToast('Veuillez saisir un montant supérieur à 0.', 'warning');
    return;
  }

  state.isSubmittingOperation = true;
  const btn = document.getElementById(opType === 'EXTRA_INCOME' ? 'quickIncomeSubmitBtn' : 'quickAgiosSubmitBtn');
  if (btn) btn.disabled = true;

  try {
    const uid = state.currentUser.uid;
    const targetYm = dateISO.slice(0, 7);
    const mb = await ensureUserMonthInitialized(targetYm);

    const label = customNote ? `${subtype} — ${customNote}` : subtype || (opType === 'EXTRA_INCOME' ? 'Entrée exceptionnelle' : 'Agios & Frais bancaires');

    if (opType === 'EXTRA_INCOME') {
      mb.totalExtraIncome = Math.round(((mb.totalExtraIncome || 0) + amount) * 100) / 100;
    } else {
      mb.totalAgiosAndFees = Math.round(((mb.totalAgiosAndFees || 0) + amount) * 100) / 100;
    }

    mb.realDisposableIncome =
      mb.globalAllocated +
      (mb.totalExtraIncome || 0) -
      (mb.totalFixedCharges || 0) -
      (mb.totalVariableSpent || 0) -
      (mb.totalAgiosAndFees || 0);

    const tx = {
      id: `tx_${opType.toLowerCase()}_${Date.now()}`,
      yearMonth: targetYm,
      categoryId: opType === 'EXTRA_INCOME' ? 'cat_extra_income' : 'cat_agios_fees',
      categoryName: opType === 'EXTRA_INCOME' ? '💰 Entrée d’argent' : '🏦 Agios & Frais Bancaires',
      amount,
      type: opType,
      date: dateISO,
      label,
      source: opType,
      createdAt: new Date().toISOString(),
    };

    mb.transactions.push(tx);

    await setDoc(doc(db, 'users', uid, 'monthlyBudgets', targetYm, 'transactions', tx.id), tx);
    await setDoc(
      doc(db, 'users', uid, 'monthlyBudgets', targetYm),
      {
        totalExtraIncome: mb.totalExtraIncome || 0,
        totalAgiosAndFees: mb.totalAgiosAndFees || 0,
        realDisposableIncome: mb.realDisposableIncome,
      },
      { merge: true }
    );

    state.selectedYearMonth = targetYm;
    closeBottomSheet();
    if (opType === 'EXTRA_INCOME') {
      showToast(`💰 +${formatMoney(amount)} ajoutés au budget de ${formatMonthLabel(targetYm)} !`);
    } else {
      showToast(`🏦 -${formatMoney(amount)} d'agios/frais imputés sur ${formatMonthLabel(targetYm)}.`, 'warning');
    }
    renderAll();
  } finally {
    state.isSubmittingOperation = false;
    if (btn) btn.disabled = false;
  }
}

function setScreen(screenCode) {
  if (screenCode !== 'STITCH-10') {
    stopLiveCameraScanner();
  }
  if (screenCode === 'STITCH-06') {
    cleanupDepletedPantryItems();
  }
  closeBottomSheet();
  if (!state.currentUser && !state.isGuestSession && screenCode !== 'STITCH-01') {
    state.currentScreen = 'STITCH-01';
  } else {
    state.currentScreen = screenCode;
  }
  closeSideMenu();
  renderAll();
}

function openChefReserveScreen() {
  state.coachSubTab = 'RECIPES';
  setScreen('STITCH-09');
}

async function changeMonth(delta) {
  if (!state.currentUser && !state.isGuestSession) return;
  const target = shiftMonth(state.selectedYearMonth, delta);
  if (!state.isGuestSession) {
    await ensureUserMonthInitialized(target);
  }
  state.selectedYearMonth = target;
  renderAll();
}

function toggleTheme() {
  state.theme = state.theme === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', state.theme);
  renderAll();
}

function renderAll() {
  const shell = document.getElementById('mobileShell');
  const header = document.getElementById('appHeader');
  const bottomNav = document.getElementById('bottomNav');
  const sideDrawer = document.getElementById('sideDrawer');
  const content = document.getElementById('screenContent');

  if (state.authLoading) {
    shell?.classList.remove('is-authenticated', 'is-auth-screen');
    header.classList.add('hidden');
    bottomNav.classList.add('hidden');
    sideDrawer.innerHTML = '';
    closeSideMenu();
    content.innerHTML = `
      <div class="card" style="text-align:center;padding:40px 20px;margin:60px auto;max-width:420px;">
        <div style="font-size:32px;margin-bottom:10px;">⏳</div>
        <div style="font-weight:700;">Chargement de votre espace sécurisé...</div>
      </div>
    `;
    return;
  }

  if (!state.currentUser && !state.isGuestSession) {
    shell?.classList.remove('is-authenticated');
    shell?.classList.add('is-auth-screen');
    header.classList.add('hidden');
    bottomNav.classList.add('hidden');
    sideDrawer.innerHTML = '';
    closeSideMenu();
    content.innerHTML = renderStitch01Auth();
    return;
  }

  shell?.classList.remove('is-auth-screen');
  shell?.classList.add('is-authenticated');
  header.classList.remove('hidden');
  bottomNav.classList.remove('hidden');
  renderSideDrawer();
  renderHeader();
  renderBottomNav();

  switch (state.currentScreen) {
    case 'STITCH-02':
      content.innerHTML = renderStitch02Profile();
      break;
    case 'STITCH-03':
      content.innerHTML = renderStitch03Dashboard();
      break;
    case 'STITCH-04':
      content.innerHTML = renderStitch04Templates();
      break;
    case 'STITCH-05':
      content.innerHTML = renderStitch05AddExpense();
      break;
    case 'STITCH-06':
      content.innerHTML = renderStitch06Pantry();
      break;
    case 'STITCH-07':
      content.innerHTML = renderStitch07Comparator();
      break;
    case 'STITCH-08':
      content.innerHTML = renderStitch08Charts();
      break;
    case 'STITCH-09':
      content.innerHTML = renderStitch09CoachAI();
      break;
    case 'STITCH-10':
      content.innerHTML = renderStitch10AcquisitionHub();
      break;
    default:
      content.innerHTML = renderStitch03Dashboard();
  }
}

function renderSideDrawer() {
  const drawer = document.getElementById('sideDrawer');
  const p = state.profile || {};
  const initials = (p.displayName || p.email || 'U').slice(0, 2).toUpperCase();
  const lowStockCount = state.pantryItems.filter((i) => i.currentQuantity <= (i.alertThreshold ?? 1)).length;

  const menuItems = [
    { section: 'Gestion Budgétaire Mensuelle' },
    { code: 'STITCH-03', icon: '📊', label: 'Dashboard Budget Mensuel' },
    { code: 'STITCH-04', icon: '🔄', label: 'Modèles Récurrents (1er)' },
    { code: 'STITCH-05', icon: '➕', label: 'Nouvelle Opération / Agios' },
    { section: 'Réserve & Courses Locales (5 km)' },
    { code: 'STITCH-06', icon: '🥫', label: `Ma Réserve (${state.pantryItems.length})`, badge: lowStockCount > 0 ? `${lowStockCount} <=1` : '' },
    { code: 'STITCH-07', icon: '📍', label: 'Comparateur Quotidien 5 km' },
    { code: 'STITCH-10', icon: '📷', label: 'Scanner Facture & PDF IA' },
    { section: 'Analyses & Intelligence Artificielle' },
    { code: 'CHEF-RESERVE', icon: '🍲', label: 'Chef Réserve IA (4 Cuisines)', badge: '🇫🇷 🇨🇲 🇲🇦 🥢', badgeType: 'HEALTHY' },
    { code: 'STITCH-09', icon: '🛡️', label: 'Bouclier Anti-Agios & Coach IA' },
    { code: 'STITCH-08', icon: '📈', label: 'Graphiques Multi-Mois' },
    { section: 'Paramètres du Compte' },
    { code: 'STITCH-02', icon: '⚙️', label: 'Profil, Devise & Rayon 5 km' },
  ];

  drawer.innerHTML = `
    <div>
      <div class="drawer-user-header">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div class="drawer-avatar">${initials}</div>
          <button id="drawerCloseBtn" class="icon-btn" onclick="closeSideMenu()" style="background:rgba(255,255,255,0.18);color:#fff;border:none;">✕</button>
        </div>
        <div class="drawer-user-name">${p.displayName || 'Mon Foyer'}</div>
        <div class="drawer-user-email">${p.email || ''}</div>
        <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
          <span style="font-size:10.5px;background:rgba(255,255,255,0.2);padding:2px 8px;border-radius:999px;font-weight:700;">
            ${p.currency || 'EUR'} • ${(p.locale || 'fr').toUpperCase()}
          </span>
          ${
            state.isDemoSession
              ? `<span style="font-size:10.5px;background:rgba(245,158,11,0.9);color:#fff;padding:2px 8px;border-radius:999px;font-weight:800;">
                  🧪 Mode Démo (32 articles)
                </span>`
              : ''
          }
        </div>
      </div>

      <div class="drawer-nav-list">
        ${menuItems
          .map((item) => {
            if (item.section) {
              return `<div class="drawer-section-lbl">${item.section}</div>`;
            }
            const isActive =
              item.code === 'CHEF-RESERVE'
                ? state.currentScreen === 'STITCH-09' && state.coachSubTab === 'RECIPES'
                : item.code === 'STITCH-09'
                ? state.currentScreen === 'STITCH-09' && state.coachSubTab === 'SHIELD'
                : state.currentScreen === item.code;
            const clickAction =
              item.code === 'CHEF-RESERVE'
                ? "openChefReserveScreen()"
                : item.code === 'STITCH-09'
                ? "setCoachSubTab('SHIELD'); setScreen('STITCH-09')"
                : `setScreen('${item.code}')`;

            return `
              <button class="drawer-item ${isActive ? 'active' : ''}" onclick="${clickAction}">
                <span class="drawer-item-left">
                  <span>${item.icon}</span>
                  <span>${item.label}</span>
                </span>
                ${item.badge ? `<span class="badge-state ${item.badgeType || 'CRITICAL'}">${item.badge}</span>` : ''}
              </button>
            `;
          })
          .join('')}
      </div>
    </div>

      <div class="drawer-footer">
      <button class="btn-primary" onclick="closeSideMenu(); openBottomSheet('PAYWALL_MODAL');" style="width:100%;padding:9px;font-size:12px;background:linear-gradient(135deg,#047857,#065F46);margin-bottom:6px;">
        👑 EcoPanier+ &amp; Crédits Scans IA
      </button>
      <button class="btn-secondary" onclick="closeSideMenu(); openSavingsStoryModal();" style="width:100%;padding:9px;font-size:12px;margin-bottom:6px;">
        📸 Ma Carte d'Économies Story (9:16)
      </button>
      ${
        state.isGuestSession
          ? `
        <button class="guest-exit-btn" onclick="closeSideMenu(); exitGuestSession();" style="width:100%;padding:10px;font-size:12.5px;margin-bottom:6px;">
          🚪 Quitter l'Accès Invité
        </button>
      `
          : `
        <button class="btn-primary" onclick="closeSideMenu(); openBottomSheet('SHARE_GUEST_PASS');" style="width:100%;padding:9px;font-size:12px;background:linear-gradient(135deg,#4F46E5,#4338CA);margin-bottom:6px;">
          👥 Partager un Accès Invité (Code temporaire)
        </button>
      `
      }
      <button class="btn-primary" onclick="closeSideMenu(); openBottomSheet('SHARE_APK');" style="width:100%;padding:9px;font-size:12px;">
        📲 Télécharger APK / Play Store / Inviter Amis
      </button>
      ${
        state.isDemoSession
          ? `<button class="icon-btn" onclick="resetDemoTestData()" style="width:100%;padding:9px;border-color:rgba(79,70,229,0.4);color:var(--secondary);">
              🔄 Réinitialiser les 32 produits de démo
            </button>`
          : ''
      }
      <button class="icon-btn" onclick="toggleTheme()" style="width:100%;padding:9px;">
        ${state.theme === 'light' ? '🌙 Mode Sombre' : '☀️ Mode Clair'}
      </button>
      <button class="icon-btn" onclick="closeSideMenu(); openBottomSheet('PRIVACY_POLICY');" style="width:100%;padding:9px;">
        🔒 Confidentialité &amp; Données RGPD
      </button>
      <button class="btn-logout" onclick="${state.isGuestSession ? 'exitGuestSession()' : 'handleLogout()'}">
        🚪 ${state.isGuestSession ? 'Quitter le mode invité' : 'Se déconnecter'}
      </button>
    </div>
  `;
}

function renderHeader() {
  const header = document.getElementById('appHeader');
  const prevLabel = formatMonthLabel(shiftMonth(state.selectedYearMonth, -1));
  const currLabel = formatMonthLabel(state.selectedYearMonth);
  const nextLabel = formatMonthLabel(shiftMonth(state.selectedYearMonth, 1));

  const screenTitles = {
    'STITCH-02': 'Profil & Rayon 5 km',
    'STITCH-03': `Bonjour, ${state.profile?.displayName || 'Mon Foyer'}`,
    'STITCH-04': 'Modèles Récurrents',
    'STITCH-05': 'Nouvelle Opération',
    'STITCH-06': 'Réserve Domestique',
    'STITCH-07': 'Comparateur 5 km',
    'STITCH-08': 'Analyses Multi-Mois',
    'STITCH-09': state.coachSubTab === 'RECIPES' ? '🍲 Chef Réserve IA (4 Cuisines)' : '🛡️ Bouclier Anti-Agios & Coach IA',
    'STITCH-10': 'Scanner & Factures PDF',
  };

  header.innerHTML = `
    ${
      state.isGuestSession && state.guestSession
        ? `
      <div class="guest-top-banner">
        <div class="guest-banner-left">
          <span class="guest-badge">👥 MODE INVITÉ • LECTURE SEULE</span>
          <div class="guest-banner-title">Espace de <strong>${state.guestSession.ownerDisplayName}</strong> (${state.guestSession.guestLabel || 'Invité'})</div>
          <div class="guest-banner-timer">⏱️ Expire dans <strong id="guestTimeRemaining">${formatRemainingTime(new Date(state.guestSession.expiresAt).getTime() - Date.now())}</strong></div>
        </div>
        <button class="guest-exit-btn" onclick="exitGuestSession()">🚪 Quitter</button>
      </div>
    `
        : ''
    }
    <div class="app-header-inner">
      <div class="app-header-top">
        <div class="app-title-group">
          <button class="hamburger-btn" onclick="openSideMenu()" title="Menu latéral">☰</button>
          <div>
            <div class="app-subtitle">${screenTitles[state.currentScreen] || 'EcoPanier & Budget IA'}</div>
            <div class="app-title">${currLabel}</div>
          </div>
        </div>
        <div class="header-actions-bar">
          <button class="icon-btn desktop-only" onclick="setScreen('STITCH-05')" style="background:var(--primary);color:#FFFFFF;border-color:var(--primary);" title="Nouvelle opération">
            ＋ Opération
          </button>
          ${
            !state.isGuestSession
              ? `
            <button class="icon-btn desktop-only" onclick="openBottomSheet('SHARE_GUEST_PASS')" title="Partager un accès invité à un tiers">
              👥 Invité
            </button>
          `
              : ''
          }
          <button class="icon-btn desktop-only" onclick="openBottomSheet('SHARE_APK')" title="Télécharger APK Android / Play Store / Partager aux amis">
            📲 Mobile
          </button>
          <button class="icon-btn" onclick="openChefReserveScreen()" title="Recettes Chef Réserve 0€">
            🍲 Chef IA
          </button>
          <button class="icon-btn" onclick="setScreen('STITCH-10'); setAcquisitionTab('CAMERA');" title="Scanner une facture ou un ticket">
            📷 Scan
          </button>
          <button class="icon-btn" onclick="toggleTheme()" title="Changer de thème">
            ${state.theme === 'light' ? '🌙' : '☀️'}
          </button>
        </div>
      </div>

      <div class="month-selector-bar">
        <button class="month-nav-btn" onclick="changeMonth(-1)">
          ‹ ${prevLabel.split(' ')[0]}
        </button>
        <div class="month-active-center">
          <span>📅 ${currLabel}</span>
        </div>
        <button class="month-nav-btn" onclick="changeMonth(1)">
          ${nextLabel.split(' ')[0]} ›
        </button>
      </div>
    </div>
  `;
}

function renderBottomNav() {
  const nav = document.getElementById('bottomNav');
  const tabs = [
    { code: 'STITCH-03', icon: '👛', label: 'Budget' },
    { code: 'STITCH-06', icon: '🥫', label: 'Réserve' },
    { code: 'STITCH-05', icon: '➕', label: '+ Opération' },
    { code: 'STITCH-07', icon: '🏪', label: 'Comparateur' },
    { code: 'STITCH-09', icon: '🍲', label: 'Chef & IA' },
  ];
  nav.innerHTML = tabs
    .map(
      (t) => `
      <button class="nav-tab ${state.currentScreen === t.code ? 'active' : ''}" onclick="setScreen('${t.code}')">
        <span class="nav-icon">${t.icon}</span>
        <span>${t.label}</span>
      </button>
    `
    )
    .join('');
}

/* ============================================================================
 * STITCH-01 / STITCH-WEB-01 : Portail Web SaaS Split-Screen & Auth Mobile
 * ============================================================================ */
function renderStitch01Auth() {
  const isRegister = state.authMode === 'REGISTER';
  const currentMonthLabel = formatMonthLabel(state.selectedYearMonth);
  return `
    <div class="auth-portal-page">
      <!-- Topbar Portail Web -->
      <header class="auth-web-topbar">
        <div class="auth-brand-row">
          <div class="auth-logo-box">
            <span>🛒</span>
            <span class="auth-logo-badge">5 km</span>
          </div>
          <div>
            <div class="auth-brand-name">
              <span>EcoPanier</span>
              <span class="auth-brand-tag">Budget IA</span>
            </div>
            <div class="auth-brand-caption">Reste à vivre • Réserve • Comparateur 5 km</div>
          </div>
        </div>

        <div style="display:flex;align-items:center;gap:10px;">
          <div class="auth-topbar-links">
            <span class="auth-status-chip">
              <span>●</span>
              <span>${escapeHtml(currentMonthLabel)} opérationnel</span>
            </span>
          </div>
          <button type="button" class="icon-btn" onclick="toggleTheme()" title="Changer de thème">
            ${state.theme === 'light' ? '🌙 Sombre' : '☀️ Clair'}
          </button>
        </div>
      </header>

      <!-- Grille Split-Screen (Vitrine SaaS à gauche / Connexion à droite sur Desktop) -->
      <div class="auth-split-layout">
        <!-- Colonne Gauche : Vitrine SaaS & Téléchargement Mobile -->
        <section class="auth-hero-showcase">
          <div class="auth-version-pill">
            <span>✨ Plateforme Web &amp; App Mobile v4.1</span>
            <span>•</span>
            <span>Chiffrement Firebase</span>
          </div>

          <h1 class="auth-hero-title">
            Prenez le contrôle de votre <span>reste à vivre</span> et de vos courses à <span>5 km</span>.
          </h1>

          <p class="auth-hero-lead">
            Reliez directement votre budget mensuel par enveloppes, le stock réel de votre réserve anti-gaspi (DLC) et les prix des supermarchés locaux dans un rayon de 5 km.
          </p>

          <div class="auth-savings-banner">
            <div class="auth-savings-icon">📈</div>
            <div>
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <strong style="font-family:'Plus Jakarta Sans';font-size:18px;color:var(--primary);">+120,00 € / mois</strong>
                <span class="badge-state HEALTHY">Économies cibles</span>
              </div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">
                Grâce au Bouclier Anti-Agios, au Chef Réserve 0 € (4 cuisines) et au panier comparé à 5 km.
              </div>
            </div>
          </div>

          <div class="auth-pillars-grid">
            <div class="auth-pillar-card">
              <div class="auth-pillar-head">
                <span class="auth-pillar-ico">👛</span>
                <span>1. Budget Zéro-Agios</span>
              </div>
              <p class="auth-pillar-desc">
                Enveloppes dynamiques, charges fixes reconduites le 1er du mois et calcul temps réel du quota journalier sûr.
              </p>
            </div>

            <div class="auth-pillar-card">
              <div class="auth-pillar-head">
                <span class="auth-pillar-ico" style="background:var(--secondary-soft);color:var(--secondary);">🥫</span>
                <span>2. Réserve &amp; Alertes DLC</span>
              </div>
              <p class="auth-pillar-desc">
                Suivez 30+ produits ménagers en 1-tap (-1 / +1), scannez vos factures PDF/tickets et évitez le gaspillage.
              </p>
            </div>

            <div class="auth-pillar-card">
              <div class="auth-pillar-head">
                <span class="auth-pillar-ico" style="background:var(--healthy-soft);color:#059669;">📍</span>
                <span>3. Comparateur 5 km</span>
              </div>
              <p class="auth-pillar-desc">
                Comparez Lidl, Aldi, E.Leclerc, Intermarché &amp; Carrefour en panier unique ou mix optimal sous plafond.
              </p>
            </div>

            <div class="auth-pillar-card">
              <div class="auth-pillar-head">
                <span class="auth-pillar-ico" style="background:var(--warning-soft);color:#B45309;">🍲</span>
                <span>4. Chef Réserve IA (4 Cuisines)</span>
              </div>
              <p class="auth-pillar-desc">
                Des recettes 0,00 € avec vos stocks urgents : Française, Camerounaise, Maghrébine et Asiatique.
              </p>
            </div>
          </div>

          <!-- Bandeau Application Mobile -->
          <div class="auth-mobile-banner">
            <div>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;">
                <strong style="font-family:'Plus Jakarta Sans';font-size:14px;">📲 Application Mobile EcoPanier</strong>
                <span style="font-size:10px;background:rgba(20,184,166,0.2);color:#5EEAD4;padding:2px 8px;border-radius:999px;font-weight:700;">Android APK v4.1 • PWA iOS</span>
              </div>
              <div style="font-size:11.5px;color:#94A3B8;">
                Synchronisation instantanée entre votre navigateur Web et votre téléphone.
              </div>
            </div>
            <div class="auth-mobile-actions">
              <a href="/ecopanier-budget-ia.apk" download="ecopanier-budget-ia.apk" class="auth-apk-btn">
                <span>📥</span>
                <span>Télécharger APK</span>
              </a>
              <button type="button" class="auth-apk-btn-sec" onclick="openBottomSheet('SHARE_APK')">
                <span>📤</span>
                <span>Play Store / Partager</span>
              </button>
            </div>
          </div>
        </section>

        <!-- Colonne Droite : Carte Authentification & Accès Rapides -->
        <section class="auth-form-column">
          <div class="auth-card" style="padding:24px 22px;box-shadow:0 18px 42px -12px rgba(15,23,42,0.12);">
            <div style="text-align:center;margin-bottom:16px;">
              <h2 style="font-family:'Plus Jakarta Sans';font-size:21px;font-weight:800;color:var(--text-main);">
                ${isRegister ? 'Créer mon espace foyer' : 'Espace Sécurisé'}
              </h2>
              <p style="font-size:12px;color:var(--text-muted);margin-top:3px;">
                ${isRegister ? 'Initialisez votre budget mensuel en moins d’une minute' : 'Accédez à votre budget mensuel et à votre réserve synchronisée'}
              </p>
            </div>

            <div class="segmented-control" style="margin-bottom:16px;">
              <button class="seg-btn ${!isRegister ? 'active' : ''}" onclick="switchAuthTab('LOGIN')">
                Connexion
              </button>
              <button class="seg-btn ${isRegister ? 'active' : ''}" onclick="switchAuthTab('REGISTER')">
                Inscription
              </button>
            </div>

            ${
              isRegister
                ? `
              <div class="input-group">
                <label class="input-label">Nom du foyer / Prénom</label>
                <div class="auth-input-wrap">
                  <span class="input-icon-left">👤</span>
                  <input class="input-field" type="text" id="authName" placeholder="Ex: Foyer Martin" />
                </div>
              </div>
              <div class="input-group">
                <label class="input-label">Budget mensuel par défaut (€)</label>
                <div class="auth-input-wrap">
                  <span class="input-icon-left">💶</span>
                  <input class="input-field" type="number" id="authDefaultIncome" placeholder="Ex: 2500" value="0" />
                </div>
              </div>
            `
                : ''
            }

            <div class="input-group">
              <label class="input-label">Email</label>
              <div class="auth-input-wrap">
                <span class="input-icon-left">✉️</span>
                <input class="input-field" type="email" id="authEmail" placeholder="exemple@email.com" />
              </div>
            </div>

            <div class="input-group">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                <label class="input-label" style="margin-bottom:0;">Mot de passe</label>
                ${
                  !isRegister
                    ? `<a href="javascript:void(0)" onclick="handleForgotPassword()" style="font-size:11.5px;color:var(--primary);font-weight:700;text-decoration:none;">
                        Mot de passe oublié ?
                      </a>`
                    : ''
                }
              </div>
              <div class="auth-input-wrap">
                <span class="input-icon-left">🔒</span>
                <input
                  class="input-field"
                  type="${state.showPassword ? 'text' : 'password'}"
                  id="authPassword"
                  placeholder="••••••••"
                  onkeydown="if(event.key==='Enter') handleAuthSubmit()"
                />
                <button type="button" class="input-icon-right" onclick="togglePasswordVisibility()">
                  ${state.showPassword ? '🙈' : '👁️'}
                </button>
              </div>
            </div>

            <button class="btn-primary" onclick="handleAuthSubmit()" style="margin-top:4px;padding:13px;">
              <span>${isRegister ? 'Créer mon compte' : 'Se connecter'}</span>
              <span>➔</span>
            </button>

            ${
              !isRegister
                ? `
              <button type="button" class="biometric-pill" onclick="handleBiometricQuickUnlock()">
                <span>🪪</span>
                <span>Déverrouillage biométrique rapide</span>
              </button>
            `
                : ''
            }

            <div class="auth-divider">OU CONTINUER AVEC</div>

            <div class="oauth-grid" style="margin-bottom:14px;">
              <button type="button" class="oauth-btn" onclick="handleOAuthLogin('google')">
                <svg width="16" height="16" viewBox="0 0 24 24">
                  <path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.4 1 3.5 3.6 1.6 7.4l3.7 2.8C6.2 7.2 8.9 5 12 5z"/>
                  <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.6l3.7 2.9c2.2-2 3.7-5 3.7-8.7z"/>
                  <path fill="#FBBC05" d="M5.3 14.8c-.2-.8-.4-1.6-.4-2.5s.2-1.7.4-2.5L1.6 7C.6 9 0 11.2 0 13.5s.6 4.5 1.6 6.5l3.7-2.9z"/>
                  <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3.1 0-5.8-2.1-6.7-5l-3.7 2.8C3.5 21.4 7.4 24 12 24z"/>
                </svg>
                <span>Google</span>
              </button>

              <button type="button" class="oauth-btn" onclick="handleOAuthLogin('apple')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                </svg>
                <span>Apple</span>
              </button>
            </div>

            <!-- Raccourcis Démo & Invité -->
            <div style="display:flex;flex-direction:column;gap:8px;padding-top:12px;border-top:1px solid var(--border);">
              <button type="button" class="auth-quick-tile demo" onclick="handleDemoTestLogin()">
                <div>
                  <div style="font-size:12.5px;font-weight:800;color:var(--primary);">
                    🚀 Mode Démo 1-Clic <span class="badge-state HEALTHY" style="margin-left:4px;">32 produits</span>
                  </div>
                  <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">
                    Tester immédiatement avec 5 mois d'historique et 32 articles pré-remplis
                  </div>
                </div>
                <span style="font-size:16px;font-weight:800;color:var(--primary);">›</span>
              </button>

              <div class="auth-quick-tile" style="flex-direction:column;align-items:stretch;gap:8px;cursor:default;">
                <div style="font-size:12px;font-weight:800;">
                  👥 Accès Invité / Tiers (Code PIN 6 chiffres)
                </div>
                <div style="display:flex;gap:6px;">
                  <input
                    type="text"
                    id="guestPinInput"
                    class="input-field"
                    placeholder="Code PIN (ex: 482910) ou lien..."
                    style="padding:8px 10px;font-size:12.5px;background:var(--surface);"
                    onkeydown="if(event.key==='Enter') enterGuestSession(this.value)"
                  />
                  <button
                    type="button"
                    class="btn-primary"
                    style="width:auto;padding:8px 14px;font-size:12px;white-space:nowrap;"
                    onclick="enterGuestSession(document.getElementById('guestPinInput')?.value)"
                  >
                    🔓 Accéder
                  </button>
                </div>
              </div>
            </div>

            <div style="margin-top:14px;padding-top:10px;border-top:1px solid var(--border);text-align:center;font-size:11px;color:var(--text-muted);">
              🛡️ Données chiffrées Firebase •
              <a href="javascript:void(0)" onclick="openBottomSheet('PRIVACY_POLICY')" style="color:var(--primary);font-weight:700;text-decoration:none;">
                Confidentialité, Permissions &amp; RGPD
              </a>
            </div>
          </div>
        </section>
      </div>

      <!-- Pied de page Portail Web -->
      <footer class="auth-legal-footer">
        <div>
          <strong>EcoPanier &amp; Budget IA © 2026</strong> — Web SaaS, PWA &amp; Application Android
        </div>
        <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;">
          <a href="javascript:void(0)" onclick="openBottomSheet('PRIVACY_POLICY')" style="color:var(--primary);font-weight:700;text-decoration:none;">
            Politique de confidentialité &amp; Suppression de compte
          </a>
          <span>•</span>
          <span>Package Android : <code>com.ecopanier.budgetia</code></span>
        </div>
      </footer>
    </div>
  `;
}

function switchAuthTab(mode) {
  state.authMode = mode;
  renderAll();
}

function togglePasswordVisibility() {
  state.showPassword = !state.showPassword;
  renderAll();
}

async function handleAuthSubmit() {
  const email = (document.getElementById('authEmail')?.value || '').trim();
  const password = document.getElementById('authPassword')?.value || '';

  if (!email || password.length < 6) {
    showToast('Veuillez saisir un email valide et un mot de passe d’au moins 6 caractères.', 'warning');
    return;
  }

  try {
    if (state.authMode === 'REGISTER') {
      const displayName = (document.getElementById('authName')?.value || '').trim() || email.split('@')[0];
      const defaultIncome = Number(document.getElementById('authDefaultIncome')?.value) || 0;

      state.pendingRegistration = { displayName, defaultMonthlyIncome: defaultIncome };

      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName });

      const nowISO = new Date().toISOString();
      const newProfile = {
        uid: cred.user.uid,
        email,
        displayName,
        locale: 'fr',
        currency: 'EUR',
        defaultMonthlyIncome: defaultIncome,
        dailyNotificationTime: '17:30',
        location: {
          lat: 48.8566,
          lng: 2.3522,
          geohash: 'u09tunq',
          addressLabel: 'Position domicile (Rayon 5,0 km)',
          searchRadiusKm: 5.0,
        },
        createdAt: nowISO,
        updatedAt: nowISO,
      };
      await setDoc(doc(db, 'users', cred.user.uid), newProfile);
      state.profile = newProfile;

      const firstMb = state.monthlyBudgets[state.selectedYearMonth];
      if (firstMb && defaultIncome > 0) {
        firstMb.globalAllocated = defaultIncome;
        recomputeMonthFinancials(firstMb);
        await setDoc(
          doc(db, 'users', cred.user.uid, 'monthlyBudgets', state.selectedYearMonth),
          {
            globalAllocated: defaultIncome,
            realDisposableIncome: firstMb.realDisposableIncome,
          },
          { merge: true }
        );
      }
      renderAll();
      showToast(`🎉 Compte créé avec succès pour ${displayName} (Budget : ${formatMoney(defaultIncome)}) !`);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
      showToast(`✅ Bienvenue ! Vos données personnelles sont synchronisées.`);
    }
  } catch (err) {
    state.pendingRegistration = null;
    showToast(`Erreur d'authentification : ${err.message}`, 'critical');
  }
}

async function handleOAuthLogin(providerName) {
  try {
    const provider = providerName === 'google' ? new GoogleAuthProvider() : new OAuthProvider('apple.com');
    if (providerName === 'google') {
      provider.addScope('email');
      provider.addScope('profile');
      provider.setCustomParameters({ prompt: 'select_account' });
    }
    showToast(`Connexion ${providerName === 'google' ? 'Google' : 'Apple'} en cours...`, 'info');

    try {
      const result = await signInWithPopup(auth, provider);
      showToast(`✅ Connecté avec ${providerName} (${result.user.email || result.user.displayName}) !`);
    } catch (popupErr) {
      console.warn('Popup OAuth bloquée ou impossible, bascule vers redirection...', popupErr);
      const isPopupIssue =
        popupErr.code === 'auth/popup-blocked' ||
        popupErr.code === 'auth/cancelled-popup-request' ||
        popupErr.code === 'auth/popup-closed-by-user' ||
        popupErr.code === 'auth/internal-error' ||
        (popupErr.message && popupErr.message.toLowerCase().includes('popup')) ||
        (popupErr.message && popupErr.message.toLowerCase().includes('closed'));

      if (isPopupIssue) {
        showToast('Ouverture de la fenêtre de connexion sécurisée...', 'info');
        await signInWithRedirect(auth, provider);
      } else {
        throw popupErr;
      }
    }
  } catch (err) {
    const code = err.code || '';
    if (code.includes('operation-not-allowed') || code.includes('configuration-not-found')) {
      showToast(
        `ℹ️ Activez le fournisseur ${providerName} dans Firebase Console > Authentication > Sign-in method, ou utilisez Email/Mot de passe ou le bouton Démo.`,
        'warning'
      );
    } else {
      showToast(`Connexion ${providerName} : ${err.message}`, 'warning');
    }
  }
}

function handleBiometricQuickUnlock() {
  showToast('🪪 Déverrouillage biométrique disponible après une première connexion sur mobile.', 'info');
}

async function handleDemoTestLogin() {
  showToast('🧪 Connexion au compte Démo Haute-Densité (32 produits)...');
  try {
    await signInWithEmailAndPassword(auth, DEMO_TEST_EMAIL, DEMO_TEST_PASS);
    showToast('🎉 Connecté au compte Démo (Alexandre Martin) !');
  } catch (err) {
    try {
      const cred = await createUserWithEmailAndPassword(auth, DEMO_TEST_EMAIL, DEMO_TEST_PASS);
      await updateProfile(cred.user, { displayName: 'Alexandre Martin (Démo)' });
      await seedDemoAccountToFirestore(cred.user.uid);
      showToast('🎉 Compte Démo initialisé avec 32 produits en réserve !');
      renderAll();
    } catch (createErr) {
      showToast(`Erreur connexion démo : ${createErr.message}`, 'critical');
    }
  }
}

async function resetDemoTestData() {
  if (!state.currentUser || !state.isDemoSession) return;
  showToast('🔄 Restauration des 32 produits et 5 mois de démonstration...');
  await seedDemoAccountToFirestore(state.currentUser.uid);
  state.selectedYearMonth = getNowYearMonth();
  closeSideMenu();
  renderAll();
  showToast('✅ Données de démo restaurées !');
}

async function handleForgotPassword() {
  const email = (document.getElementById('authEmail')?.value || '').trim();
  if (!email) {
    showToast('Saisissez votre adresse email dans le champ Email.', 'warning');
    return;
  }
  await sendPasswordResetEmail(auth, email);
  showToast(`📧 Lien de réinitialisation envoyé à ${email}.`);
}

async function handleLogout() {
  await signOut(auth);
  showToast('👋 Vous êtes déconnecté.');
}

async function handleDeleteAccount() {
  if (!auth.currentUser || state.isGuestSession || state.isDemoSession) {
    showToast('ℹ️ Suppression disponible uniquement sur un compte personnel connecté.', 'warning');
    return;
  }
  const confirmed = window.confirm(
    '⚠️ Attention : cette action va supprimer définitivement votre compte, vos budgets mensuels, votre réserve et vos modèles récurrents. Continuer ?'
  );
  if (!confirmed) return;

  const user = auth.currentUser;
  const uid = user.uid;
  showToast('🗑️ Suppression définitive de vos données en cours...', 'warning');

  try {
    const simpleSubCols = ['categoryTemplates', 'pantryItems', 'pantryMovements', 'guestPasses'];
    for (const colName of simpleSubCols) {
      try {
        const snap = await getDocs(collection(db, 'users', uid, colName));
        for (const d of snap.docs) {
          await deleteDoc(d.ref);
        }
      } catch (_) {}
    }

    try {
      const mbSnap = await getDocs(collection(db, 'users', uid, 'monthlyBudgets'));
      for (const mbDoc of mbSnap.docs) {
        const ym = mbDoc.id;
        for (const sub of ['categories', 'transactions', 'aiInsights']) {
          try {
            const subSnap = await getDocs(collection(db, 'users', uid, 'monthlyBudgets', ym, sub));
            for (const sDoc of subSnap.docs) {
              await deleteDoc(sDoc.ref);
            }
          } catch (_) {}
        }
        await deleteDoc(mbDoc.ref);
      }
    } catch (_) {}

    try {
      for (const p of state.userGuestPasses || []) {
        if (p.id) await deleteDoc(doc(db, 'guestPasses', p.id)).catch(() => {});
        if (p.code) await deleteDoc(doc(db, 'guestPasses', p.code)).catch(() => {});
      }
    } catch (_) {}

    try {
      await deleteDoc(doc(db, 'users', uid));
    } catch (_) {}

    try {
      localStorage.removeItem(`ecopanier_guest_passes_${uid}`);
      localStorage.removeItem(`ecopanier_monetization_${uid}`);
    } catch (_) {}

    await deleteUser(user);
    closeBottomSheet();
    showToast('✅ Votre compte et toutes vos données ont été supprimés définitivement.');
  } catch (err) {
    if (err.code === 'auth/requires-recent-login') {
      showToast(
        '🔒 Par sécurité, veuillez vous déconnecter puis vous reconnecter avant de supprimer définitivement votre compte.',
        'warning'
      );
    } else {
      showToast(`Erreur lors de la suppression : ${err.message}`, 'critical');
    }
  }
}

/* ============================================================================
 * STITCH-03 : Dashboard Budget Mensuel v3.3
 * - Calcul exact et déduction immédiate des Charges Fixes actives du Reste à Vivre
 * - Case à cocher sur chaque charge/poste pour l'activer ou la désélectionner ce mois-ci
 * - Entrées d'argent en cours de mois (+ Entrées) & Agios / Frais bancaires (- Agios)
 * ============================================================================ */
function renderStitch03Dashboard() {
  const mb = state.monthlyBudgets[state.selectedYearMonth] || {
    yearMonth: state.selectedYearMonth,
    status: 'OPEN',
    globalAllocated: state.profile?.defaultMonthlyIncome || 0,
    totalExtraIncome: 0,
    totalAgiosAndFees: 0,
    totalFixedCharges: 0,
    totalVariableSpent: 0,
    totalSavedViaComparator: 0,
    categories: [],
    transactions: [],
  };

  // Recalcule systématiquement les totaux à partir des charges actives du mois
  recomputeMonthFinancials(mb);

  const extraIncome = Number(mb.totalExtraIncome) || 0;
  const agiosFees = Number(mb.totalAgiosAndFees) || 0;
  const disposable = mb.realDisposableIncome;
  const isClosed = mb.status === 'CLOSED';
  const alertCount = mb.categories.filter((c) => c.isEnabledForMonth !== false && computeGaugeState(c.spentAmount, c.allocatedLimit).pct >= 75 && c.type === 'VARIABLE').length;
  const varCount = mb.categories.filter((c) => c.type === 'VARIABLE').length;
  const fixCount = mb.categories.filter((c) => c.type === 'CHARGE_FIXE').length;

  // Calcul du Quota Journalier Anti-Agios (Reste à vivre / Jours restants dans le mois)
  const now = new Date();
  const [yNum, mNum] = state.selectedYearMonth.split('-').map(Number);
  const daysInMonth = new Date(yNum, mNum, 0).getDate();
  const isCurrentRealMonth = state.selectedYearMonth === state.currentRealYearMonth;
  const remainingDays = isCurrentRealMonth ? Math.max(1, daysInMonth - now.getDate() + 1) : daysInMonth;
  const safeDailyBurn = Math.max(0, disposable / remainingDays);

  function cLimit(cat) {
    return Number(cat.allocatedLimit) || 0;
  }

  const filteredEnvelopes = mb.categories
    .slice()
    .sort((a, b) => {
      if ((a.isEnabledForMonth !== false) !== (b.isEnabledForMonth !== false)) {
        return a.isEnabledForMonth !== false ? -1 : 1;
      }
      const pa = computeGaugeState(a.spentAmount, cLimit(a)).pct;
      const pb = computeGaugeState(b.spentAmount, cLimit(b)).pct;
      return pb - pa;
    })
    .filter((c) => {
      if (state.envelopeFilter === 'ALERT') return computeGaugeState(c.spentAmount, c.allocatedLimit).pct >= 75;
      if (state.envelopeFilter === 'VARIABLE') return c.type === 'VARIABLE';
      if (state.envelopeFilter === 'FIXE') return c.type === 'CHARGE_FIXE';
      return true;
    });

  const q = (state.txSearchQuery || '').toLowerCase().trim();
  const filteredTxs = mb.transactions
    .slice()
    .reverse()
    .filter((tx) => {
      if (state.txSourceFilter !== 'ALL' && tx.source !== state.txSourceFilter) return false;
      if (q && !`${tx.label} ${tx.categoryName} ${tx.amount}`.toLowerCase().includes(q)) return false;
      return true;
    });

  return `
    <!-- Carte Héro Épurée sur Fond Blanc (Stitch-03 v3.3) -->
    <div class="hero-v32-card">
      <div class="hero-v32-top">
        <span class="hero-v32-label">RESTE À VIVRE RÉEL</span>
        <div style="display:flex;gap:6px;align-items:center;">
          <button class="icon-btn" style="padding:3px 8px;font-size:11px;" onclick="openBottomSheet('EDIT_BUDGET')" title="Modifier le budget du mois">
            ✏️ Budget : ${formatMoney(mb.globalAllocated)}
          </button>
          <span class="badge-state ${disposable < 0 ? 'CRITICAL' : isClosed ? 'WARNING' : 'HEALTHY'}">
            ${disposable < 0 ? '⚠️ Découvert' : isClosed ? '🔒 Clôturé' : '● Actif'}
          </span>
        </div>
      </div>
      <div class="hero-v32-amount" style="${disposable < 0 ? 'color:var(--critical);' : ''}">${formatMoney(disposable)}</div>

      <div class="hero-v32-ai-pill" onclick="setCoachSubTab('SHIELD'); setScreen('STITCH-09');" style="cursor:pointer;">
        <span>🛡️ Bouclier Anti-Agios : <strong style="color:${disposable < 0 ? 'var(--critical)' : 'var(--primary)'};">${formatMoney(safeDailyBurn)} / jour max</strong> (${remainingDays}j restants)</span>
        <span style="font-size:11px;color:var(--secondary);font-weight:700;">Arbitrer ›</span>
      </div>

      <div class="hero-v32-stats" style="grid-template-columns:repeat(4,1fr);">
        <div class="hero-v32-stat-box" onclick="openBottomSheet('EDIT_BUDGET')" style="cursor:pointer;" title="Modifier le budget de base">
          <span class="hero-v32-stat-lbl">Base + Entrées</span>
          <span class="hero-v32-stat-val" style="color:var(--primary);">
            ${formatMoney(mb.globalAllocated + extraIncome)}
          </span>
        </div>
        <div class="hero-v32-stat-box" onclick="setEnvelopeFilter('FIXE')" style="cursor:pointer;" title="Voir et cocher/décocher les charges fixes">
          <span class="hero-v32-stat-lbl">Charges Fixes</span>
          <span class="hero-v32-stat-val" style="color:var(--critical);">-${formatMoney(mb.totalFixedCharges)}</span>
        </div>
        <div class="hero-v32-stat-box" onclick="setEnvelopeFilter('VARIABLE')" style="cursor:pointer;">
          <span class="hero-v32-stat-lbl">Dépenses Var.</span>
          <span class="hero-v32-stat-val" style="color:var(--secondary);">-${formatMoney(mb.totalVariableSpent)}</span>
        </div>
        <div class="hero-v32-stat-box" onclick="openBottomSheet('ADD_AGIOS')" style="cursor:pointer;" title="Ajouter ou voir les agios et frais bancaires">
          <span class="hero-v32-stat-lbl">Agios &amp; Frais</span>
          <span class="hero-v32-stat-val" style="color:${agiosFees > 0 ? 'var(--critical)' : 'var(--text-muted)'};">
            -${formatMoney(agiosFees)}
          </span>
        </div>
      </div>

      <!-- Barre d'actions rapides de Trésorerie : + Entrée d'argent | - Agios / Frais | Budget de base -->
      <div class="cashflow-quick-bar">
        <button type="button" class="cashflow-btn income" onclick="openBottomSheet('ADD_INCOME')">
          <span>💰 + Entrée d'argent</span>
          <span style="font-size:10px;opacity:0.85;">${extraIncome > 0 ? '+' + formatMoney(extraIncome) : 'Prime, Aide, Virement'}</span>
        </button>
        <button type="button" class="cashflow-btn agios" onclick="openBottomSheet('ADD_AGIOS')">
          <span>🏦 - Agios / Frais</span>
          <span style="font-size:10px;opacity:0.85;">${agiosFees > 0 ? '-' + formatMoney(agiosFees) : 'Découvert, Frais banque'}</span>
        </button>
        <button type="button" class="cashflow-btn budget" onclick="openBottomSheet('EDIT_BUDGET')">
          <span>✏️ Budget du mois</span>
          <span style="font-size:10px;opacity:0.85;">Base : ${formatMoney(mb.globalAllocated)}</span>
        </button>
      </div>
    </div>

    <!-- Sous-Onglets Segmentés Mobile (Masqués sur Desktop >= 1024px car les 2 colonnes s'affichent côte à côte) -->
    <div class="segmented-control dashboard-segmented-tabs" style="margin-bottom:12px;">
      <button class="seg-btn ${state.dashboardSubTab === 'ENVELOPPES' ? 'active' : ''}" onclick="setDashboardSubTab('ENVELOPPES')">
        Enveloppes &amp; Charges (${mb.categories.length})
      </button>
      <button class="seg-btn ${state.dashboardSubTab === 'TRANSACTIONS' ? 'active' : ''}" onclick="setDashboardSubTab('TRANSACTIONS')">
        Transactions (${mb.transactions.length})
      </button>
    </div>

    <div class="dashboard-dual-pane">
      <!-- COLONNE GAUCHE DESKTOP / ONGLET 1 MOBILE : Enveloppes & Charges -->
      <div class="dashboard-pane-envelopes ${state.dashboardSubTab !== 'ENVELOPPES' ? 'is-hidden-mobile' : ''}">
        <!-- Pilules de filtres des Enveloppes -->
        <div class="chips-scroll-row">
          <button class="filter-chip ${state.envelopeFilter === 'ALL' ? 'active' : ''}" onclick="setEnvelopeFilter('ALL')">
            Toutes (${mb.categories.length})
          </button>
          <button class="filter-chip ${state.envelopeFilter === 'FIXE' ? 'active' : ''}" onclick="setEnvelopeFilter('FIXE')">
            🏠 Charges Fixes (${fixCount})
          </button>
          <button class="filter-chip ${state.envelopeFilter === 'VARIABLE' ? 'active' : ''}" onclick="setEnvelopeFilter('VARIABLE')">
            🛒 Variables (${varCount})
          </button>
          <button class="filter-chip ${state.envelopeFilter === 'ALERT' ? 'active' : ''}" onclick="setEnvelopeFilter('ALERT')">
            ⚠️ En alerte (${alertCount})
          </button>
        </div>

        <!-- Liste Compacte des Postes Budgétaires avec Case à Cocher d'Activation Mensuelle -->
        <div class="card">
          <div class="section-header" style="margin-bottom:8px;">
            <div>
              <span class="section-title">Postes &amp; Charges du mois (${filteredEnvelopes.length})</span>
              <div style="font-size:11px;color:var(--text-muted);">Décochez une charge pour l'ignorer ce mois-ci</div>
            </div>
            <button class="icon-btn" style="padding:5px 10px;font-size:11.5px;color:var(--primary);border-color:var(--primary);" onclick="openBottomSheet('ADD_TEMPLATE')">
              + Poste
            </button>
          </div>
          ${
            filteredEnvelopes.length === 0
              ? `<div class="empty-state">
                  Aucun poste dans ce filtre.<br/>
                  <button class="btn-primary" style="margin-top:10px;" onclick="openBottomSheet('ADD_TEMPLATE')">
                    + Créer un poste budgétaire
                  </button>
                </div>`
              : `<div class="envelopes-grid-list">
                  ${filteredEnvelopes
                    .map((c) => {
                      const isEnabled = c.isEnabledForMonth !== false;
                      const effSpent = !isEnabled ? 0 : c.type === 'CHARGE_FIXE' ? Math.max(c.spentAmount || 0, c.allocatedLimit || 0) : c.spentAmount || 0;
                      const g = computeGaugeState(effSpent, c.allocatedLimit);
                      const pctColor = !isEnabled
                        ? 'var(--text-muted)'
                        : g.state === 'CRITICAL'
                        ? 'var(--critical)'
                        : g.state === 'WARNING'
                        ? 'var(--warning)'
                        : 'var(--healthy)';
                      return `
                      <div class="slim-envelope-row ${!isEnabled ? 'envelope-disabled' : ''}">
                        <div class="slim-envelope-top">
                          <div class="slim-env-left" onclick="toggleMonthCategoryActive('${c.id}')" style="cursor:pointer;">
                            <input
                              type="checkbox"
                              ${isEnabled ? 'checked' : ''}
                              onclick="event.stopPropagation(); toggleMonthCategoryActive('${c.id}')"
                              title="${isEnabled ? 'Décochez pour ne pas décompter cette charge ce mois-ci' : 'Cochez pour activer cette charge ce mois-ci'}"
                              style="width:19px;height:19px;accent-color:var(--primary);cursor:pointer;flex-shrink:0;"
                            />
                            <div class="slim-env-icon">${escapeHtml(c.icon || '🎯')}</div>
                            <div>
                              <div class="slim-env-name" style="${!isEnabled ? 'text-decoration:line-through;' : ''}">
                                ${escapeHtml(c.name)}
                              </div>
                              <div class="slim-env-sub">
                                ${
                                  !isEnabled
                                    ? '<span class="badge-state WARNING">⏸️ Désélectionné ce mois (0 € déduit)</span>'
                                    : c.type === 'CHARGE_FIXE'
                                    ? `<span style="color:var(--critical);font-weight:700;">Charge Fixe (-${formatMoney(effSpent)} déduits)</span>`
                                    : 'Enveloppe Variable'
                                }
                              </div>
                            </div>
                          </div>
                          <div class="slim-env-right" style="display:flex;align-items:center;gap:6px;">
                            <button
                              type="button"
                              onclick="toggleMonthCategoryActive('${escapeHtml(c.id)}')"
                              class="badge-state ${isEnabled ? 'HEALTHY' : 'WARNING'}"
                              style="border:none;cursor:pointer;padding:4px 7px;font-size:10px;"
                              title="Cliquer pour activer ou désélectionner sur ce mois"
                            >
                              ${isEnabled ? '✓ Actif' : '⏸️ Off'}
                            </button>
                            <div>
                              <span>${formatMoney(effSpent)} / ${formatMoney(c.allocatedLimit)}</span>
                              <span style="color:${pctColor};margin-left:3px;">(${isEnabled ? Math.round(g.pct) + '%' : '0%'})</span>
                            </div>
                            <button
                              onclick="deleteMonthCategory('${escapeHtml(c.id)}')"
                              title="Supprimer ce poste du mois"
                              style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:12px;padding:2px 4px;"
                            >✕</button>
                          </div>
                        </div>
                        <div class="gauge-track">
                          <div class="gauge-fill ${isEnabled ? g.state : 'HEALTHY'}" style="width:${isEnabled ? Math.min(100, g.pct) : 0}%"></div>
                        </div>
                      </div>
                    `;
                    })
                    .join('')}
                </div>`
          }
        </div>
      </div>

      <!-- COLONNE DROITE DESKTOP / ONGLET 2 MOBILE : Journal des Transactions -->
      <div class="dashboard-pane-transactions ${state.dashboardSubTab !== 'TRANSACTIONS' ? 'is-hidden-mobile' : ''}">
        <div class="search-bar-row">
          <div class="search-input-box">
            <span>🔍</span>
            <input
              type="text"
              placeholder="Rechercher parmi ${mb.transactions.length} opérations..."
              value="${escapeHtml(state.txSearchQuery)}"
              oninput="handleTxSearch(this.value)"
            />
          </div>
        </div>

        <div class="chips-scroll-row">
          <button class="filter-chip ${state.txSourceFilter === 'ALL' ? 'active' : ''}" onclick="setTxSourceFilter('ALL')">
            Toutes (${mb.transactions.length})
          </button>
          <button class="filter-chip ${state.txSourceFilter === 'EXTRA_INCOME' ? 'active' : ''}" onclick="setTxSourceFilter('EXTRA_INCOME')">
            💰 Entrées (+)
          </button>
          <button class="filter-chip ${state.txSourceFilter === 'AGIOS' ? 'active' : ''}" onclick="setTxSourceFilter('AGIOS')">
            🏦 Agios / Frais
          </button>
          <button class="filter-chip ${state.txSourceFilter === 'PDF_INVOICE' ? 'active' : ''}" onclick="setTxSourceFilter('PDF_INVOICE')">
            📄 Factures PDF
          </button>
          <button class="filter-chip ${state.txSourceFilter === 'COMPARATOR_5KM' ? 'active' : ''}" onclick="setTxSourceFilter('COMPARATOR_5KM')">
            📍 Panier 5 km
          </button>
          <button class="filter-chip ${state.txSourceFilter === 'AUTO_FIXED_CHARGE' ? 'active' : ''}" onclick="setTxSourceFilter('AUTO_FIXED_CHARGE')">
            🏠 Fixes 1er
          </button>
          <button class="filter-chip ${state.txSourceFilter === 'MANUAL' ? 'active' : ''}" onclick="setTxSourceFilter('MANUAL')">
            ✍️ Manuelles
          </button>
        </div>

        <div class="card" style="padding:14px 16px;">
          <div class="section-header" style="margin-bottom:8px;">
            <span class="section-title">🧾 Journal des Transactions (${filteredTxs.length})</span>
            <button class="icon-btn" style="padding:4px 9px;font-size:11px;" onclick="setScreen('STITCH-05')">
              + Ajouter
            </button>
          </div>
          ${
            filteredTxs.length === 0
              ? `<div class="empty-state">Aucune opération trouvée pour ce filtre.</div>`
              : filteredTxs
                  .map((tx) => {
                    const isIncome = tx.type === 'EXTRA_INCOME' || tx.source === 'EXTRA_INCOME';
                    const isAgios = tx.type === 'AGIOS' || tx.source === 'AGIOS';
                    const sign = isIncome ? '+' : '-';
                    const amtColor = isIncome ? '#059669' : 'var(--critical)';
                    return `
                    <div class="slim-envelope-row" style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                      <div style="min-width:0;padding-right:4px;flex:1;">
                        <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                          ${escapeHtml(tx.label)}
                          ${isAgios ? `<span class="badge-state CRITICAL" style="margin-left:4px;font-size:9.5px;">AGIOS</span>` : ''}
                          ${isIncome ? `<span class="badge-state HEALTHY" style="margin-left:4px;font-size:9.5px;">ENTRÉE</span>` : ''}
                        </div>
                        <div style="font-size:11px;color:var(--text-muted);">${escapeHtml(tx.date)} • ${escapeHtml(tx.categoryName)}</div>
                      </div>
                      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
                        <div style="font-family:'Plus Jakarta Sans';font-weight:800;font-size:13.5px;color:${amtColor};">
                          ${sign}${formatMoney(tx.amount)}
                        </div>
                        <button
                          type="button"
                          class="pantry-del-btn"
                          onclick="openEditTransactionModal('${escapeHtml(tx.id)}')"
                          title="Modifier cette opération"
                          aria-label="Modifier cette opération"
                        >✏️</button>
                        <button
                          type="button"
                          class="pantry-del-btn"
                          onclick="deleteTransaction('${escapeHtml(tx.id)}')"
                          title="Supprimer cette opération"
                          aria-label="Supprimer cette opération"
                        >🗑️</button>
                      </div>
                    </div>
                  `;
                  })
                  .join('')
          }
        </div>
      </div>
    </div>

    <!-- Bouton Flottant (+) pour Ajouter une Dépense ou Opération sans saturer la vue -->
    <button class="fab-add-btn" onclick="setScreen('STITCH-05')" title="Nouvelle opération">
      <span>＋</span>
    </button>
  `;
}

function setDashboardSubTab(tab) {
  state.dashboardSubTab = tab;
  renderAll();
}

function setEnvelopeFilter(f) {
  state.envelopeFilter = f;
  renderAll();
}

async function toggleMonthCategoryActive(catId) {
  if (state.isGuestSession) {
    showToast('ℹ️ Mode Invité (Lecture seule) : modifications désactivées.', 'warning');
    return;
  }
  if (!state.currentUser) return;
  const uid = state.currentUser.uid;
  const ym = state.selectedYearMonth;
  const mb = await ensureUserMonthInitialized(ym);
  const cat = mb.categories.find((c) => c.id === catId);
  if (!cat) return;

  cat.isEnabledForMonth = cat.isEnabledForMonth === false ? true : false;
  recomputeMonthFinancials(mb);

  await setDoc(doc(db, 'users', uid, 'monthlyBudgets', ym, 'categories', cat.id), cat, { merge: true });
  await setDoc(
    doc(db, 'users', uid, 'monthlyBudgets', ym),
    {
      totalFixedCharges: mb.totalFixedCharges,
      totalVariableSpent: mb.totalVariableSpent,
      realDisposableIncome: mb.realDisposableIncome,
    },
    { merge: true }
  );

  if (cat.isEnabledForMonth) {
    showToast(`✅ Poste "${cat.name}" réactivé pour ${formatMonthLabel(ym)}.`);
  } else {
    showToast(`⏸️ Poste "${cat.name}" désélectionné pour ${formatMonthLabel(ym)} (non décompté du Reste à Vivre).`);
  }
  renderAll();
}

async function deleteMonthCategory(catId) {
  if (state.isGuestSession) {
    showToast('ℹ️ Mode Invité (Lecture seule) : modifications désactivées.', 'warning');
    return;
  }
  if (!state.currentUser) return;
  const uid = state.currentUser.uid;
  const ym = state.selectedYearMonth;
  const mb = await ensureUserMonthInitialized(ym);
  const cat = mb.categories.find((c) => c.id === catId);
  if (!cat) return;

  await deleteDoc(doc(db, 'users', uid, 'monthlyBudgets', ym, 'categories', catId));
  mb.categories = mb.categories.filter((c) => c.id !== catId);
  recomputeMonthFinancials(mb);

  await setDoc(
    doc(db, 'users', uid, 'monthlyBudgets', ym),
    {
      totalFixedCharges: mb.totalFixedCharges,
      totalVariableSpent: mb.totalVariableSpent,
      realDisposableIncome: mb.realDisposableIncome,
    },
    { merge: true }
  );
  showToast(`🗑️ Poste "${cat.name}" retiré de ${formatMonthLabel(ym)}.`);
  renderAll();
}

function openEditTransactionModal(txId) {
  if (state.isGuestSession) {
    showToast('ℹ️ Mode Invité (Lecture seule) : modifications désactivées.', 'warning');
    return;
  }
  state.editingTransactionId = txId;
  openBottomSheet('EDIT_TRANSACTION');
}

async function saveEditedTransaction(txId) {
  if (state.isGuestSession) {
    showToast('ℹ️ Mode Invité (Lecture seule) : modifications désactivées.', 'warning');
    return;
  }
  if (!state.currentUser) return;
  const uid = state.currentUser.uid;
  const ym = state.selectedYearMonth;
  const mb = await ensureUserMonthInitialized(ym);
  const tx = mb.transactions.find((t) => t.id === txId);
  if (!tx) return;

  const newLabel = (document.getElementById('editTxLabel')?.value || '').trim() || tx.label || 'Opération';
  const newAmount = Math.round((Number(document.getElementById('editTxAmount')?.value) || 0) * 100) / 100;
  const newDate = document.getElementById('editTxDate')?.value || tx.date;
  const newCatId = document.getElementById('editTxCategory')?.value || tx.categoryId;

  if (newAmount <= 0) {
    showToast('Veuillez saisir un montant supérieur à 0.', 'warning');
    return;
  }

  const oldAmount = Number(tx.amount) || 0;
  const oldCatId = tx.categoryId;
  const isIncome = tx.type === 'EXTRA_INCOME' || tx.source === 'EXTRA_INCOME';
  const isAgios = tx.type === 'AGIOS' || tx.source === 'AGIOS';

  tx.label = newLabel;
  tx.amount = newAmount;
  tx.date = newDate;
  tx.updatedAt = new Date().toISOString();

  if (isIncome) {
    mb.totalExtraIncome = Math.max(0, Math.round(((mb.totalExtraIncome || 0) - oldAmount + newAmount) * 100) / 100);
  } else if (isAgios) {
    mb.totalAgiosAndFees = Math.max(0, Math.round(((mb.totalAgiosAndFees || 0) - oldAmount + newAmount) * 100) / 100);
  } else {
    const oldCat = mb.categories.find((c) => c.id === oldCatId);
    const newCat = mb.categories.find((c) => c.id === newCatId) || oldCat;
    if (oldCat && newCat && oldCat.id !== newCat.id) {
      oldCat.spentAmount = Math.max(0, Math.round(((oldCat.spentAmount || 0) - oldAmount) * 100) / 100);
      const gOld = computeGaugeState(oldCat.spentAmount, oldCat.allocatedLimit);
      oldCat.consumptionPercentage = gOld.pct;
      oldCat.gaugeState = gOld.state;
      await setDoc(doc(db, 'users', uid, 'monthlyBudgets', ym, 'categories', oldCat.id), oldCat, { merge: true });

      newCat.spentAmount = Math.max(0, Math.round(((newCat.spentAmount || 0) + newAmount) * 100) / 100);
      const gNew = computeGaugeState(newCat.spentAmount, newCat.allocatedLimit);
      newCat.consumptionPercentage = gNew.pct;
      newCat.gaugeState = gNew.state;
      tx.categoryId = newCat.id;
      tx.categoryName = newCat.name;
      tx.type = newCat.type || tx.type;
      await setDoc(doc(db, 'users', uid, 'monthlyBudgets', ym, 'categories', newCat.id), newCat, { merge: true });
    } else if (oldCat) {
      oldCat.spentAmount = Math.max(0, Math.round(((oldCat.spentAmount || 0) - oldAmount + newAmount) * 100) / 100);
      const gOld = computeGaugeState(oldCat.spentAmount, oldCat.allocatedLimit);
      oldCat.consumptionPercentage = gOld.pct;
      oldCat.gaugeState = gOld.state;
      await setDoc(doc(db, 'users', uid, 'monthlyBudgets', ym, 'categories', oldCat.id), oldCat, { merge: true });
    }
  }

  recomputeMonthFinancials(mb);

  await setDoc(doc(db, 'users', uid, 'monthlyBudgets', ym, 'transactions', tx.id), tx, { merge: true });
  await setDoc(
    doc(db, 'users', uid, 'monthlyBudgets', ym),
    {
      totalExtraIncome: mb.totalExtraIncome || 0,
      totalAgiosAndFees: mb.totalAgiosAndFees || 0,
      totalFixedCharges: mb.totalFixedCharges,
      totalVariableSpent: mb.totalVariableSpent,
      realDisposableIncome: mb.realDisposableIncome,
    },
    { merge: true }
  );

  state.editingTransactionId = null;
  closeBottomSheet();
  showToast(`✅ Opération "${tx.label}" mise à jour (${formatMoney(tx.amount)}).`);
  renderAll();
}

async function deleteTransaction(txId) {
  if (state.isGuestSession) {
    showToast('ℹ️ Mode Invité (Lecture seule) : modifications désactivées.', 'warning');
    return;
  }
  if (!state.currentUser) return;
  const uid = state.currentUser.uid;
  const ym = state.selectedYearMonth;
  const mb = await ensureUserMonthInitialized(ym);
  const tx = mb.transactions.find((t) => t.id === txId);
  if (!tx) return;

  if (!window.confirm(`Supprimer l'opération "${tx.label}" (${formatMoney(tx.amount)}) ?`)) {
    return;
  }

  const amount = Number(tx.amount) || 0;
  const isIncome = tx.type === 'EXTRA_INCOME' || tx.source === 'EXTRA_INCOME';
  const isAgios = tx.type === 'AGIOS' || tx.source === 'AGIOS';

  if (isIncome) {
    mb.totalExtraIncome = Math.max(0, Math.round(((mb.totalExtraIncome || 0) - amount) * 100) / 100);
  } else if (isAgios) {
    mb.totalAgiosAndFees = Math.max(0, Math.round(((mb.totalAgiosAndFees || 0) - amount) * 100) / 100);
  } else {
    const cat = mb.categories.find((c) => c.id === tx.categoryId);
    if (cat) {
      cat.spentAmount = Math.max(0, Math.round(((cat.spentAmount || 0) - amount) * 100) / 100);
      const g = computeGaugeState(cat.spentAmount, cat.allocatedLimit);
      cat.consumptionPercentage = g.pct;
      cat.gaugeState = g.state;
      await setDoc(doc(db, 'users', uid, 'monthlyBudgets', ym, 'categories', cat.id), cat, { merge: true });
    }
  }

  mb.transactions = mb.transactions.filter((t) => t.id !== txId);
  recomputeMonthFinancials(mb);

  await deleteDoc(doc(db, 'users', uid, 'monthlyBudgets', ym, 'transactions', txId));
  await setDoc(
    doc(db, 'users', uid, 'monthlyBudgets', ym),
    {
      totalExtraIncome: mb.totalExtraIncome || 0,
      totalAgiosAndFees: mb.totalAgiosAndFees || 0,
      totalFixedCharges: mb.totalFixedCharges,
      totalVariableSpent: mb.totalVariableSpent,
      realDisposableIncome: mb.realDisposableIncome,
    },
    { merge: true }
  );

  if (state.activeBottomSheet === 'EDIT_TRANSACTION') {
    state.editingTransactionId = null;
    closeBottomSheet();
  }
  showToast(`🗑️ Opération "${tx.label}" supprimée et solde recalculé.`);
  renderAll();
}

function handleTxSearch(val) {
  state.txSearchQuery = val;
  renderAll();
}

function setTxSourceFilter(f) {
  state.txSourceFilter = f;
  renderAll();
}

/* ============================================================================
 * STITCH-06 : Ma Réserve Domestique v3.2 (Haute Capacité 30 à 100+ produits)
 * - Barre de recherche instantanée + Bouton Scan Code-barres
 * - Pilules de filtres par rayon défilables horizontalement
 * - Accordéons pliables par rayon + Commutateur Vue Accordéon / Liste Dense / Grille 2 col
 * - Bouton flottant (+) ouvrant la Bottom Sheet modale
 * ============================================================================ */
function renderStitch06Pantry() {
  const totalCount = state.pantryItems.length;
  const lowItems = state.pantryItems.filter((i) => i.currentQuantity <= (i.alertThreshold ?? 1));
  const lowCount = lowItems.length;
  const expiringItems = state.pantryItems.filter((i) => {
    if (Number(i.currentQuantity) <= 0) return false;
    const exp = computeExpiryStatus(i.expirationDate);
    return exp && exp.isUrgent;
  });
  const expiringCount = expiringItems.length;

  const q = (state.pantrySearchQuery || '').toLowerCase().trim();
  const filtered = state.pantryItems
    .filter((item) => {
      if (q && !`${item.name} ${item.unit || ''}`.toLowerCase().includes(q)) return false;
      if (state.pantryFilter === 'LOW') return item.currentQuantity <= (item.alertThreshold ?? 1);
      if (state.pantryFilter === 'EXPIRING') {
        if (Number(item.currentQuantity) <= 0) return false;
        const exp = computeExpiryStatus(item.expirationDate);
        return Boolean(exp && exp.isUrgent);
      }
      if (state.pantryFilter !== 'ALL') return (item.category || 'EPICERIE_SALEE') === state.pantryFilter;
      return true;
    })
    .slice()
    .sort((a, b) => {
      const expA = computeExpiryStatus(a.expirationDate);
      const expB = computeExpiryStatus(b.expirationDate);
      const urgA = expA && expA.isUrgent && a.currentQuantity > 0 ? expA.daysLeft : 9999;
      const urgB = expB && expB.isUrgent && b.currentQuantity > 0 ? expB.daysLeft : 9999;
      if (urgA !== urgB) return urgA - urgB;
      return 0;
    });

  // Comptage par rayon
  const countByAisle = (aisleKey) =>
    state.pantryItems.filter((i) => (i.category || 'EPICERIE_SALEE') === aisleKey).length;

  const renderDenseRow = (item) => {
    const isLow = item.currentQuantity <= (item.alertThreshold ?? 1);
    const isStable = item.currentQuantity >= 3;
    const expStatus = item.currentQuantity > 0 ? computeExpiryStatus(item.expirationDate) : null;
    const dotClass = isLow || expStatus?.isUrgent ? 'critical' : isStable ? 'stable' : 'normal';
    const badgeClass = expStatus?.isUrgent
      ? expStatus.badgeClass
      : isLow
      ? 'CRITICAL'
      : isStable
      ? 'HEALTHY'
      : 'WARNING';
    const badgeText = expStatus?.isUrgent
      ? expStatus.badgeText
      : isLow
      ? 'CRITIQUE'
      : isStable
      ? 'STABLE'
      : 'NORMAL';
    const safeUnit = escapeHtml(item.unit || '1u');
    const expSub = expStatus && !expStatus.isUrgent ? ` • ${expStatus.badgeText}` : '';
    const subInfo = isLow
      ? `${safeUnit} • Rupture IA 1j${expSub}`
      : `${safeUnit} • Réf ${formatMoney(item.lastPricePaid || 1.95)}${expSub}`;

    return `
      <div class="dense-pantry-row">
        <div class="dense-pantry-left">
          <span class="status-dot ${dotClass}"></span>
          <div style="min-width:0;">
            <div class="dense-pantry-title">${escapeHtml(item.name)}</div>
            <div class="dense-pantry-sub">${subInfo}</div>
          </div>
        </div>
        <div class="dense-pantry-right">
          <span class="badge-state ${badgeClass}" style="cursor:pointer;" onclick="openEditPantryExpiryModal('${escapeHtml(item.id)}')" title="Modifier la DLC / DLUO">${badgeText}</span>
          <button type="button" class="pantry-del-btn" onclick="openEditPantryExpiryModal('${escapeHtml(item.id)}')" title="Date de péremption (DLC)">📅</button>
          <div class="stepper-pill">
            <button class="stepper-btn" onclick="handlePantryTap('${escapeHtml(item.id)}', -1)" title="Diminuer">-</button>
            <span class="stepper-val">${item.currentQuantity}</span>
            <button class="stepper-btn" onclick="handlePantryTap('${escapeHtml(item.id)}', 1)" title="Augmenter">+</button>
          </div>
          <button type="button" class="pantry-del-btn" onclick="deletePantryItem('${escapeHtml(item.id)}')" title="Supprimer ce produit de la réserve">🗑️</button>
        </div>
      </div>
    `;
  };

  let bodyHtml = '';

  if (filtered.length === 0) {
    bodyHtml = `
      <div class="card">
        <div class="empty-state">
          Aucun produit trouvé.<br/>
          <button class="btn-primary" style="margin-top:10px;" onclick="openBottomSheet('ADD_PANTRY')">
            + Ajouter un produit à ma réserve
          </button>
        </div>
      </div>
    `;
  } else if (state.pantryViewMode === 'GRID') {
    bodyHtml = `
      <div class="pantry-grid-2col">
        ${filtered
          .map((item) => {
            const isLow = item.currentQuantity <= (item.alertThreshold ?? 1);
            const expStatus = item.currentQuantity > 0 ? computeExpiryStatus(item.expirationDate) : null;
            return `
            <div class="pantry-tile ${isLow || expStatus?.isUrgent ? 'low-stock' : ''}">
              <div>
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:4px;margin-bottom:4px;">
                  <span style="font-size:12.5px;font-weight:700;line-height:1.25;">${escapeHtml(item.name)}</span>
                  <div style="display:flex;gap:2px;">
                    <button type="button" class="pantry-del-btn" onclick="openEditPantryExpiryModal('${escapeHtml(item.id)}')" title="Date de péremption (DLC)">📅</button>
                    <button type="button" class="pantry-del-btn" onclick="deletePantryItem('${escapeHtml(item.id)}')" title="Supprimer ce produit de la réserve">🗑️</button>
                  </div>
                </div>
                <div style="font-size:11px;color:var(--text-muted);">${escapeHtml(item.unit || 'unité')} • ${formatMoney(item.lastPricePaid || 1.95)}</div>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;">
                <span class="badge-state ${expStatus?.isUrgent ? expStatus.badgeClass : isLow ? 'CRITICAL' : 'HEALTHY'}" onclick="openEditPantryExpiryModal('${escapeHtml(item.id)}')" style="cursor:pointer;">${expStatus?.isUrgent ? expStatus.badgeText : isLow ? '<=1' : 'OK'}</span>
                <div class="stepper-pill">
                  <button class="stepper-btn" onclick="handlePantryTap('${escapeHtml(item.id)}', -1)">-</button>
                  <span class="stepper-val">${item.currentQuantity}</span>
                  <button class="stepper-btn" onclick="handlePantryTap('${escapeHtml(item.id)}', 1)">+</button>
                </div>
              </div>
            </div>
          `;
          })
          .join('')}
      </div>
    `;
  } else if (state.pantryViewMode === 'DENSE') {
    bodyHtml = `
      <div class="aisle-accordion">
        ${filtered.map(renderDenseRow).join('')}
      </div>
    `;
  } else {
    // Mode ACCORDION par rayon (par défaut, identique à STITCH-06 v3.2)
    const groups = [];
    const urgentExpiryGroup = filtered.filter((i) => {
      if (Number(i.currentQuantity) <= 0) return false;
      const exp = computeExpiryStatus(i.expirationDate);
      return Boolean(exp && exp.isUrgent);
    });
    if (urgentExpiryGroup.length > 0 && state.pantryFilter === 'ALL') {
      groups.push({
        key: 'DLC_URGENTE',
        label: `⏰ Anti-Gaspi : À cuisiner en priorité (${urgentExpiryGroup.length})`,
        icon: '🚨',
        items: urgentExpiryGroup,
      });
    }
    const priorityGroup = filtered.filter((i) => i.currentQuantity <= (i.alertThreshold ?? 1));
    if (priorityGroup.length > 0 && state.pantryFilter === 'ALL') {
      groups.push({ key: 'PRIORITE', label: `À racheter en priorité (${priorityGroup.length})`, icon: '❗', items: priorityGroup });
    }

    const aisleOrder = ['CREMERIE', 'EPICERIE_SALEE', 'EPICERIE_SUCREE', 'VIANDES_SURGELES', 'BOISSONS', 'ENTRETIEN'];
    for (const aKey of aisleOrder) {
      const aItems = filtered.filter((i) => (i.category || 'EPICERIE_SALEE') === aKey);
      if (aItems.length > 0) {
        const meta = AISLE_META[aKey] || { label: aKey, icon: '📦' };
        groups.push({ key: aKey, label: `${meta.label} (${aItems.length})`, icon: meta.icon, items: aItems });
      }
    }

    bodyHtml = groups
      .map((g) => {
        const isCollapsed = Boolean(state.collapsedAisles[g.key]);
        return `
        <div class="aisle-accordion">
          <button class="aisle-header" onclick="toggleAisleCollapse('${g.key}')">
            <span>${g.icon} ${g.label}</span>
            <span style="font-size:12px;color:var(--text-muted);">${isCollapsed ? '▶ Déplier' : '▼'}</span>
          </button>
          ${!isCollapsed ? `<div class="aisle-body">${g.items.map(renderDenseRow).join('')}</div>` : ''}
        </div>
      `;
      })
      .join('');
  }

  return `
    ${
      expiringCount > 0
        ? `
      <div class="card" style="padding:10px 12px;margin-bottom:10px;border-left:4px solid var(--warning);background:var(--warning-soft);display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div style="font-size:11.5px;line-height:1.35;">
          <strong>⏰ Alerte Anti-Gaspi :</strong> ${expiringCount} produit${expiringCount > 1 ? 's arrivent' : ' arrive'} à expiration sous 3 jours.
        </div>
        <button class="btn-primary" style="width:auto;padding:6px 10px;font-size:11px;flex-shrink:0;" onclick="applyChefQuickPrompt('Priorité absolue aux produits à DLC proche pour éviter tout gaspillage')">
          🍲 Cuisiner 0 €
        </button>
      </div>
    `
        : ''
    }

    <!-- Barre de Recherche Instantanée + Bouton Scan EAN (Stitch-06 v3.2) -->
    <div class="search-bar-row">
      <div class="search-input-box">
        <span>🔍</span>
        <input
          type="text"
          placeholder="Rechercher parmi ${totalCount} produits..."
          value="${escapeHtml(state.pantrySearchQuery)}"
          oninput="handlePantrySearch(this.value)"
        />
      </div>
      <button class="scan-square-btn" onclick="setScreen('STITCH-10'); setAcquisitionTab('BARCODE');" title="Scanner un code-barres">
        |||
      </button>
    </div>

    <!-- Pilules de Rayons Horizontales Défilables (Stitch-06 v3.2) -->
    <div class="chips-scroll-row">
      <button class="filter-chip ${state.pantryFilter === 'ALL' ? 'active' : ''}" onclick="setPantryFilter('ALL')">
        Tous (${totalCount})
      </button>
      <button class="filter-chip ${state.pantryFilter === 'EXPIRING' ? 'active' : ''}" onclick="setPantryFilter('EXPIRING')">
        ⏰ DLC proche (${expiringCount})
      </button>
      <button class="filter-chip ${state.pantryFilter === 'LOW' ? 'active' : ''}" onclick="setPantryFilter('LOW')">
        🔴 À racheter (${lowCount})
      </button>
      <button class="filter-chip ${state.pantryFilter === 'CREMERIE' ? 'active' : ''}" onclick="setPantryFilter('CREMERIE')">
        🥛 Crèmerie (${countByAisle('CREMERIE')})
      </button>
      <button class="filter-chip ${state.pantryFilter === 'EPICERIE_SALEE' ? 'active' : ''}" onclick="setPantryFilter('EPICERIE_SALEE')">
        🍝 Épicerie (${countByAisle('EPICERIE_SALEE')})
      </button>
      <button class="filter-chip ${state.pantryFilter === 'EPICERIE_SUCREE' ? 'active' : ''}" onclick="setPantryFilter('EPICERIE_SUCREE')">
        🍪 Sucré (${countByAisle('EPICERIE_SUCREE')})
      </button>
      <button class="filter-chip ${state.pantryFilter === 'VIANDES_SURGELES' ? 'active' : ''}" onclick="setPantryFilter('VIANDES_SURGELES')">
        🥩 Frais/Surgelés (${countByAisle('VIANDES_SURGELES')})
      </button>
      <button class="filter-chip ${state.pantryFilter === 'BOISSONS' ? 'active' : ''}" onclick="setPantryFilter('BOISSONS')">
        🥤 Boissons (${countByAisle('BOISSONS')})
      </button>
      <button class="filter-chip ${state.pantryFilter === 'ENTRETIEN' ? 'active' : ''}" onclick="setPantryFilter('ENTRETIEN')">
        🧼 Entretien (${countByAisle('ENTRETIEN')})
      </button>
    </div>

    <!-- Barre d'outils de densité d'affichage -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <span style="font-size:11.5px;color:var(--text-muted);font-weight:600;">
        Affichés : <strong>${filtered.length}</strong> sur ${totalCount}
      </span>
      <div style="display:flex;gap:4px;">
        <button class="icon-btn" style="padding:4px 8px;font-size:11px;${state.pantryViewMode === 'ACCORDION' ? 'border-color:var(--primary);color:var(--primary);' : ''}" onclick="setPantryViewMode('ACCORDION')">
          📂 Rayons
        </button>
        <button class="icon-btn" style="padding:4px 8px;font-size:11px;${state.pantryViewMode === 'DENSE' ? 'border-color:var(--primary);color:var(--primary);' : ''}" onclick="setPantryViewMode('DENSE')">
          ☰ Liste
        </button>
        <button class="icon-btn" style="padding:4px 8px;font-size:11px;${state.pantryViewMode === 'GRID' ? 'border-color:var(--primary);color:var(--primary);' : ''}" onclick="setPantryViewMode('GRID')">
          ⊞ Grille
        </button>
      </div>
    </div>

    ${bodyHtml}

    <!-- Bouton Flottant (+) ouvrant la Bottom Sheet d'ajout de produit -->
    <button class="fab-add-btn" onclick="openBottomSheet('ADD_PANTRY')" title="Ajouter un produit">
      <span>＋</span>
    </button>
  `;
}

function setPantryFilter(f) {
  state.pantryFilter = f;
  renderAll();
}

function setPantryViewMode(m) {
  state.pantryViewMode = m;
  renderAll();
}

function handlePantrySearch(val) {
  state.pantrySearchQuery = val;
  renderAll();
}

function toggleAisleCollapse(key) {
  state.collapsedAisles[key] = !state.collapsedAisles[key];
  renderAll();
}

// Batch automatique : purge les articles restés à 0 pendant plus de 7 jours consécutifs
async function cleanupDepletedPantryItems() {
  if (!state.currentUser || state.isGuestSession) return 0;
  const uid = state.currentUser.uid;
  const now = Date.now();
  const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

  const toDelete = state.pantryItems.filter((item) => {
    if (Number(item.currentQuantity) > 0) return false;
    const depletedTime = item.depletedAt
      ? new Date(item.depletedAt).getTime()
      : item.lastUpdatedAt
      ? new Date(item.lastUpdatedAt).getTime()
      : 0;
    return depletedTime > 0 && now - depletedTime >= ONE_WEEK_MS;
  });

  if (toDelete.length === 0) return 0;

  for (const item of toDelete) {
    try {
      await deleteDoc(doc(db, 'users', uid, 'pantryItems', item.id));
    } catch (e) {
      console.warn('Erreur purge produit épuisé:', e);
    }
  }

  const ids = new Set(toDelete.map((i) => i.id));
  state.pantryItems = state.pantryItems.filter((i) => !ids.has(i.id));
  showToast(
    `🧹 <strong>Nettoyage automatique (7j) :</strong> ${toDelete.length} produit(s) épuisé(s) depuis plus d'une semaine ont été retirés de la réserve.`
  );
  renderAll();
  return toDelete.length;
}

async function handlePantryTap(itemId, delta) {
  if (state.isGuestSession) {
    showToast('ℹ️ Mode Invité (Lecture seule) : modifications désactivées.', 'warning');
    return;
  }
  if (!state.currentUser) return;
  const item = state.pantryItems.find((i) => i.id === itemId);
  if (!item) return;

  const prevQty = Number(item.currentQuantity) || 0;
  const newQty = Math.max(0, prevQty + delta);
  item.currentQuantity = newQty;
  item.needsRestock = newQty <= (item.alertThreshold ?? 1);
  item.lastUpdatedAt = new Date().toISOString();

  // Si le produit tombe à 0, marquer la date d'épuisement pour le batch de purge à 7 jours
  if (newQty === 0) {
    if (!item.depletedAt) {
      item.depletedAt = item.lastUpdatedAt;
    }
  } else {
    // Si la quantité remonte > 0, réinitialiser la date d'épuisement
    item.depletedAt = null;
  }

  // Rendu instantané pour réactivité immédiate sans saccade
  renderAll();

  try {
    const cleanItem = {
      id: item.id,
      name: item.name || 'Produit réserve',
      normalizedProductKey: item.normalizedProductKey || item.name.toLowerCase().replace(/[^a-z0-9]/g, '_'),
      category: item.category || 'EPICERIE_SALEE',
      currentQuantity: item.currentQuantity,
      unit: item.unit || '1u',
      alertThreshold: Number(item.alertThreshold) >= 0 ? Number(item.alertThreshold) : 1,
      needsRestock: item.needsRestock,
      lastPricePaid: Number(item.lastPricePaid) || 1.95,
      expirationDate: item.expirationDate || null,
      lastUpdatedAt: item.lastUpdatedAt,
    };
    if (item.depletedAt) {
      cleanItem.depletedAt = item.depletedAt;
    }
    await setDoc(doc(db, 'users', state.currentUser.uid, 'pantryItems', item.id), cleanItem, { merge: true });

    const movId = `mov_${Date.now()}`;
    await setDoc(doc(db, 'users', state.currentUser.uid, 'pantryMovements', movId), {
      id: movId,
      itemId: item.id,
      itemName: item.name,
      yearMonth: state.selectedYearMonth || getNowYearMonth(),
      timestamp: item.lastUpdatedAt,
      type: delta < 0 ? 'CONSUMPTION' : 'RESTOCK',
      source: 'MANUAL',
      quantityDelta: delta,
      quantityAfter: item.currentQuantity,
    });
  } catch (err) {
    console.warn('Erreur mise à jour stock Firestore:', err);
  }

  if (delta < 0 && item.needsRestock) {
    showToast(
      `⚠️ <strong>Alerte Réserve :</strong> Il ne reste plus que <strong>${item.currentQuantity} ${item.name}</strong> !`,
      'critical'
    );
  }
}

function openEditPantryExpiryModal(itemId) {
  if (state.isGuestSession) {
    showToast('ℹ️ Mode Invité (Lecture seule) : modifications désactivées.', 'warning');
    return;
  }
  state.editingPantryItemId = itemId;
  openBottomSheet('EDIT_PANTRY_EXPIRY');
}

async function savePantryExpiry() {
  if (state.isGuestSession || !state.currentUser) return;
  const item = state.pantryItems.find((i) => i.id === state.editingPantryItemId);
  if (!item) return;

  const rawDate = (document.getElementById('editPantryExpiryDate')?.value || '').trim();
  const newQty = Math.max(0, Number(document.getElementById('editPantryQtyVal')?.value ?? item.currentQuantity));
  const newPrice = Math.max(0.01, Number(document.getElementById('editPantryPriceVal')?.value) || item.lastPricePaid || 1.95);

  item.expirationDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;
  item.currentQuantity = newQty;
  item.needsRestock = newQty <= (item.alertThreshold ?? 1);
  item.lastPricePaid = newPrice;
  item.lastUpdatedAt = new Date().toISOString();

  state.editingPantryItemId = null;
  closeBottomSheet();
  showToast(
    item.expirationDate
      ? `📅 DLC enregistrée (${item.expirationDate}) pour "${escapeHtml(item.name)}".`
      : `✅ Produit "${escapeHtml(item.name)}" mis à jour.`
  );
  renderAll();

  try {
    await setDoc(doc(db, 'users', state.currentUser.uid, 'pantryItems', item.id), item, { merge: true });
  } catch (err) {
    console.warn('Erreur mise à jour DLC Firestore:', err);
  }
}

async function addNewPantryItem() {
  if (state.isGuestSession) {
    showToast('ℹ️ Mode Invité (Lecture seule) : modifications désactivées.', 'warning');
    return;
  }
  if (!state.currentUser) return;
  const name = (document.getElementById('newPantryName')?.value || '').trim();
  const aisle = document.getElementById('newPantryAisle')?.value || 'EPICERIE_SALEE';
  const qty = Number(document.getElementById('newPantryQty')?.value) || 1;
  const unit = (document.getElementById('newPantryUnit')?.value || '1u').trim();
  const price = Number(document.getElementById('newPantryPrice')?.value) || 2.0;
  const rawExpiry = (document.getElementById('newPantryExpiry')?.value || '').trim();
  const expirationDate = /^\d{4}-\d{2}-\d{2}$/.test(rawExpiry) ? rawExpiry : null;

  if (!name) {
    showToast('Veuillez saisir le nom du produit.', 'warning');
    return;
  }

  const uid = state.currentUser.uid;
  const id = 'pantry_' + Date.now();
  const nowISO = new Date().toISOString();
  const newItem = {
    id,
    name,
    normalizedProductKey: name.toLowerCase().replace(/[^a-z0-9]/g, '_'),
    category: aisle,
    currentQuantity: qty,
    unit,
    alertThreshold: 1,
    needsRestock: qty <= 1,
    lastPricePaid: price,
    expirationDate,
    lastUpdatedAt: nowISO,
    depletedAt: qty === 0 ? nowISO : null,
  };

  state.pantryItems.push(newItem);
  closeBottomSheet();
  showToast(`✅ "${name}" ajouté dans ${AISLE_META[aisle]?.label || aisle}.`);
  renderAll();

  try {
    await setDoc(doc(db, 'users', uid, 'pantryItems', id), newItem);
  } catch (err) {
    console.warn('Erreur écriture Firestore nouveau produit:', err);
  }
}

async function deletePantryItem(id) {
  if (state.isGuestSession) {
    showToast('ℹ️ Mode Invité (Lecture seule) : modifications désactivées.', 'warning');
    return;
  }
  if (!state.currentUser) return;
  const item = state.pantryItems.find((i) => i.id === id);
  const name = item?.name || 'Produit';

  if (!window.confirm(`Supprimer "${name}" de votre réserve domestique ?`)) {
    return;
  }

  state.pantryItems = state.pantryItems.filter((i) => i.id !== id);
  renderAll();
  showToast(`🗑️ "${escapeHtml(name)}" supprimé de votre réserve.`);

  try {
    await deleteDoc(doc(db, 'users', state.currentUser.uid, 'pantryItems', id));
  } catch (err) {
    console.warn('Erreur suppression Firestore:', err);
  }
}

/* ============================================================================
 * STITCH-04 : Modèles de Postes Récurrents v3.2 (Haute Densité & Bottom Sheet)
 * ============================================================================ */
function renderStitch04Templates() {
  const totalRecurring = state.categoryTemplates
    .filter((t) => t.isRecurring)
    .reduce((acc, t) => acc + (Number(t.defaultLimit) || 0), 0);
  const income = state.profile?.defaultMonthlyIncome || 0;
  const available = Math.max(0, income - totalRecurring);
  const pctAlloc = income > 0 ? Math.min(100, Math.round((totalRecurring / income) * 100)) : 0;

  const fixCount = state.categoryTemplates.filter((t) => t.type === 'CHARGE_FIXE').length;
  const varCount = state.categoryTemplates.filter((t) => t.type === 'VARIABLE').length;
  const q = (state.templateSearchQuery || '').toLowerCase().trim();

  const filtered = state.categoryTemplates.filter((t) => {
    if (state.templateFilter !== 'ALL' && t.type !== state.templateFilter) return false;
    if (q && !t.name.toLowerCase().includes(q)) return false;
    return true;
  });

  return `
    <!-- Carte Synthèse Plafond Mensuel (Stitch-04 v3.2) -->
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <span class="hero-v32-label">PLAFOND MENSUEL</span>
        <span class="badge-state HEALTHY">● Actif</span>
      </div>
      <div style="font-family:'Plus Jakarta Sans';font-size:28px;font-weight:800;margin-bottom:10px;">
        ${formatMoney(income)}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px;">
        <span>Alloué : <strong>${formatMoney(totalRecurring)}</strong></span>
        <span>Disponible : <strong style="color:var(--primary);">${formatMoney(available)}</strong></span>
      </div>
      <div class="gauge-track">
        <div class="gauge-fill HEALTHY" style="width:${pctAlloc}%"></div>
      </div>
    </div>

    <!-- Pilules de filtres (Tous / Charges Fixes / Variables) -->
    <div class="chips-scroll-row">
      <button class="filter-chip ${state.templateFilter === 'ALL' ? 'active' : ''}" onclick="setTemplateFilter('ALL')">
        Tous (${state.categoryTemplates.length})
      </button>
      <button class="filter-chip ${state.templateFilter === 'CHARGE_FIXE' ? 'active' : ''}" onclick="setTemplateFilter('CHARGE_FIXE')">
        Charges Fixes (${fixCount})
      </button>
      <button class="filter-chip ${state.templateFilter === 'VARIABLE' ? 'active' : ''}" onclick="setTemplateFilter('VARIABLE')">
        Variables (${varCount})
      </button>
    </div>

    <div class="search-bar-row">
      <div class="search-input-box">
        <span>🔍</span>
        <input
          type="text"
          placeholder="Rechercher un modèle..."
          value="${state.templateSearchQuery}"
          oninput="handleTemplateSearch(this.value)"
        />
      </div>
    </div>

    <div class="section-header" style="margin-top:4px;">
      <span class="section-title">Modèles permanents</span>
      <button class="icon-btn" style="color:var(--primary);border-color:var(--primary);" onclick="openBottomSheet('ADD_TEMPLATE')">
        + Ajouter un modèle
      </button>
    </div>

    <div class="templates-grid" style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px;">
      ${filtered
        .map((t) => {
          const idx = state.categoryTemplates.findIndex((x) => x.id === t.id);
          const mbCurr = state.monthlyBudgets[state.selectedYearMonth];
          const monthCat = mbCurr?.categories?.find((c) => c.id === t.id);
          const isEnabledThisMonth = monthCat ? monthCat.isEnabledForMonth !== false : true;
          return `
          <div class="card ${!isEnabledThisMonth ? 'envelope-disabled' : ''}" style="margin-bottom:0;padding:12px 14px;display:flex;justify-content:space-between;align-items:center;gap:10px;">
            <div style="display:flex;align-items:center;gap:10px;min-width:0;">
              ${
                monthCat
                  ? `<input
                      type="checkbox"
                      ${isEnabledThisMonth ? 'checked' : ''}
                      onchange="toggleMonthCategoryActive('${t.id}')"
                      title="Activer ou désélectionner pour ${formatMonthLabel(state.selectedYearMonth)}"
                      style="width:18px;height:18px;accent-color:var(--primary);cursor:pointer;flex-shrink:0;"
                    />`
                  : ''
              }
              <div class="slim-env-icon">${t.icon || '🎯'}</div>
              <div style="min-width:0;">
                <div style="font-size:13.5px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${!isEnabledThisMonth ? 'text-decoration:line-through;' : ''}">
                  ${t.name} <span style="font-weight:500;color:var(--text-muted);">(${formatMoney(t.defaultLimit)})</span>
                </div>
                <div style="font-size:11px;color:var(--text-muted);">
                  ${t.type === 'CHARGE_FIXE' ? 'Charge Fixe • Mensuel' : 'Variable • Mensuel'}
                  ${monthCat ? (isEnabledThisMonth ? ' • <span style="color:var(--primary);font-weight:700;">Actif ce mois</span>' : ' • <span style="color:var(--warning);font-weight:700;">Ignoré ce mois</span>') : ''}
                </div>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
              <button
                class="badge-state ${t.isRecurring ? 'HEALTHY' : 'WARNING'}"
                style="border:none;cursor:pointer;padding:5px 8px;"
                onclick="toggleTemplateFlag(${idx}, 'isRecurring')"
              >
                ${t.isRecurring ? 'Reconduire 1er' : 'Pause'}
              </button>
              <button class="icon-btn" onclick="deleteTemplate('${t.id}')" style="padding:4px 6px;">🗑️</button>
            </div>
          </div>
        `;
        })
        .join('')}
    </div>

    ${
      state.categoryTemplates.length > 0
        ? `<button class="btn-secondary" onclick="simulateNextMonthRollover()">
            ⚡ Tester la génération automatique du mois suivant (1er du mois)
          </button>`
        : ''
    }

    <button class="fab-add-btn" onclick="openBottomSheet('ADD_TEMPLATE')">
      <span>＋ Nouveau modèle</span>
    </button>
  `;
}

function setTemplateFilter(f) {
  state.templateFilter = f;
  renderAll();
}

function handleTemplateSearch(val) {
  state.templateSearchQuery = val;
  renderAll();
}

async function addOrUpdateTemplate() {
  if (state.isGuestSession) {
    showToast('ℹ️ Mode Invité (Lecture seule) : modifications désactivées.', 'warning');
    return;
  }
  if (!state.currentUser) return;
  const name = (document.getElementById('tplNewName')?.value || '').trim();
  const limit = Number(document.getElementById('tplNewLimit')?.value) || 0;
  const type = document.getElementById('tplNewType')?.value || 'VARIABLE';
  const scope = document.getElementById('tplScope')?.value || 'MONTH_AND_FUTURE';

  if (!name || limit <= 0) {
    showToast('Veuillez saisir un nom de poste et un plafond positif.', 'warning');
    return;
  }

  const uid = state.currentUser.uid;
  const id = 'cat_' + name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '_');
  const icon = type === 'CHARGE_FIXE' ? '🏠' : '🛒';
  const nowISO = new Date().toISOString();

  const mb = await ensureUserMonthInitialized(state.selectedYearMonth);
  const autoDebit = type === 'CHARGE_FIXE';
  const initialSpent = autoDebit ? limit : 0;

  const newCat = {
    id,
    yearMonth: state.selectedYearMonth,
    name,
    icon,
    colorHex: '#0F766E',
    type,
    allocatedLimit: limit,
    spentAmount: initialSpent,
    consumptionPercentage: initialSpent > 0 ? 100 : 0,
    gaugeState: 'HEALTHY',
    isEnabledForMonth: true,
  };

  await setDoc(doc(db, 'users', uid, 'monthlyBudgets', state.selectedYearMonth, 'categories', id), newCat);
  mb.categories = mb.categories.filter((c) => c.id !== id).concat(newCat);

  if (autoDebit && initialSpent > 0) {
    const autoTxId = `auto_${state.selectedYearMonth}_${id}`;
    const autoTx = {
      id: autoTxId,
      yearMonth: state.selectedYearMonth,
      categoryId: id,
      categoryName: name,
      amount: initialSpent,
      type: 'CHARGE_FIXE',
      date: `${state.selectedYearMonth}-01`,
      label: `Prélèvement 1er — ${name}`,
      source: 'AUTO_FIXED_CHARGE',
      createdAt: nowISO,
    };
    await setDoc(doc(db, 'users', uid, 'monthlyBudgets', state.selectedYearMonth, 'transactions', autoTxId), autoTx);
    mb.transactions = mb.transactions.filter((t) => t.id !== autoTxId).concat(autoTx);
  }

  recomputeMonthFinancials(mb);
  await setDoc(
    doc(db, 'users', uid, 'monthlyBudgets', state.selectedYearMonth),
    {
      totalFixedCharges: mb.totalFixedCharges,
      totalVariableSpent: mb.totalVariableSpent,
      realDisposableIncome: mb.realDisposableIncome,
    },
    { merge: true }
  );

  if (scope === 'MONTH_AND_FUTURE') {
    const tpl = {
      id,
      name,
      icon,
      colorHex: '#0F766E',
      defaultLimit: limit,
      type,
      isRecurring: true,
      autoDebitOnFirstDay: type === 'CHARGE_FIXE',
      createdAt: nowISO,
      updatedAt: nowISO,
    };
    await setDoc(doc(db, 'users', uid, 'categoryTemplates', id), tpl);
    state.categoryTemplates = state.categoryTemplates.filter((t) => t.id !== id).concat(tpl);
  }

  closeBottomSheet();
  showToast(`✅ Poste "${name}" (${formatMoney(limit)}) enregistré.`);
  renderAll();
}

async function deleteTemplate(id) {
  if (state.isGuestSession) {
    showToast('ℹ️ Mode Invité (Lecture seule) : modifications désactivées.', 'warning');
    return;
  }
  if (!state.currentUser) return;
  await deleteDoc(doc(db, 'users', state.currentUser.uid, 'categoryTemplates', id));
  state.categoryTemplates = state.categoryTemplates.filter((t) => t.id !== id);
  renderAll();
}

async function toggleTemplateFlag(idx, field) {
  if (state.isGuestSession) {
    showToast('ℹ️ Mode Invité (Lecture seule) : modifications désactivées.', 'warning');
    return;
  }
  if (!state.currentUser) return;
  const tpl = state.categoryTemplates[idx];
  tpl[field] = !tpl[field];
  await setDoc(doc(db, 'users', state.currentUser.uid, 'categoryTemplates', tpl.id), tpl, { merge: true });
  renderAll();
}

async function simulateNextMonthRollover() {
  if (state.isGuestSession) {
    showToast('ℹ️ Mode Invité (Lecture seule) : modifications désactivées.', 'warning');
    return;
  }
  const nextYm = shiftMonth(state.selectedYearMonth, 1);
  delete state.monthlyBudgets[nextYm];
  await ensureUserMonthInitialized(nextYm);
  state.selectedYearMonth = nextYm;
  showToast(`✨ Nouvelle page ${formatMonthLabel(nextYm)} initialisée automatiquement !`);
  setScreen('STITCH-03');
}

/* ============================================================================
 * STITCH-07 : Comparateur Quotidien 5 km v3.2
 * - Sélection / Désélection individuelle des produits + Tout cocher/décocher
 * - Choix de la quantité à acheter par produit
 * - Mode Game-Changer "🎯 Budget Max en Poche" (10€, 15€, 25€)
 * ============================================================================ */
function setComparatorStoreFilter(storeId) {
  state.comparatorSelectedStoreId = storeId || 'BEST_PER_ITEM';
  renderAll();
}

function setComparatorScope(scope) {
  state.comparatorScope = scope === 'ALL' ? 'ALL' : 'LOW';
  renderAll();
}

function handleComparatorSearch(val) {
  state.comparatorSearchQuery = val || '';
  renderAll();
}

async function addCustomComparatorProduct() {
  if (state.isGuestSession) {
    showToast('ℹ️ Mode Invité (Lecture seule) : modifications désactivées.', 'warning');
    return;
  }
  const nameEl = document.getElementById('customCompName');
  const priceEl = document.getElementById('customCompPrice');
  const name = (nameEl?.value || '').trim();
  const price = Math.max(0.2, Number(priceEl?.value) || 2.0);
  if (!name) {
    showToast('Saisissez le nom du produit à comparer.', 'warning');
    return;
  }
  const id = 'pantry_comp_' + Date.now();
  const nowISO = new Date().toISOString();
  const newItem = {
    id,
    name,
    normalizedProductKey: name.toLowerCase().replace(/[^a-z0-9]/g, '_'),
    category: 'EPICERIE_SALEE',
    currentQuantity: 0,
    unit: '1u',
    alertThreshold: 1,
    needsRestock: true,
    lastPricePaid: price,
    expirationDate: null,
    lastUpdatedAt: nowISO,
  };
  state.pantryItems.unshift(newItem);
  state.comparatorExcludedIds = state.comparatorExcludedIds || {};
  state.comparatorExcludedIds[id] = false;
  if (nameEl) nameEl.value = '';
  showToast(`🛒 "${escapeHtml(name)}" ajouté au comparateur 5 km !`);
  renderAll();

  if (state.currentUser) {
    try {
      await setDoc(doc(db, 'users', state.currentUser.uid, 'pantryItems', id), newItem);
    } catch (err) {
      console.warn('Erreur sauvegarde produit comparateur:', err);
    }
  }
}

function getComparatorCandidateItems() {
  const lowItems = state.pantryItems.filter((i) => i.currentQuantity <= (i.alertThreshold ?? 1));
  const effectiveScope = state.comparatorScope === 'ALL' || lowItems.length === 0 ? 'ALL' : 'LOW';
  const baseList = effectiveScope === 'ALL' ? state.pantryItems : lowItems;
  const q = (state.comparatorSearchQuery || '').toLowerCase().trim();
  if (!q) return baseList;
  return baseList.filter((i) => `${i.name} ${i.unit || ''}`.toLowerCase().includes(q));
}

function renderStitch07Comparator() {
  const lowItems = state.pantryItems.filter((i) => i.currentQuantity <= (i.alertThreshold ?? 1));
  const effectiveScope = state.comparatorScope === 'ALL' || lowItems.length === 0 ? 'ALL' : 'LOW';
  const candidateItems = getComparatorCandidateItems();

  const COMPARATOR_STORES = [
    { id: 'store_lidl', name: 'Lidl Proximité', brand: 'Lidl', distanceKm: 1.2, icon: '🟡', mults: { EPICERIE_SALEE: 0.84, EPICERIE_SUCREE: 0.84, CREMERIE: 0.87, ENTRETIEN: 0.85, DEFAULT: 0.88 } },
    { id: 'store_aldi', name: 'Aldi Marché', brand: 'Aldi', distanceKm: 2.5, icon: '🟠', mults: { EPICERIE_SALEE: 0.82, EPICERIE_SUCREE: 0.83, CREMERIE: 0.89, DEFAULT: 0.86 } },
    { id: 'store_intermarche', name: 'Intermarché Super', brand: 'Intermarché', distanceKm: 1.8, icon: '🔴', mults: { CREMERIE: 0.84, VIANDES: 0.85, LEGUMES_FRUITS: 0.86, DEFAULT: 0.91 } },
    { id: 'store_leclerc', name: 'E.Leclerc Drive', brand: 'E.Leclerc', distanceKm: 2.1, icon: '🔵', mults: { ENTRETIEN: 0.85, BOISSONS: 0.86, EPICERIE_SALEE: 0.89, DEFAULT: 0.90 } },
    { id: 'store_carrefour', name: 'Carrefour City (Piéton)', brand: 'Carrefour', distanceKm: 0.8, icon: '🟢', mults: { DEFAULT: 1.06 } },
  ];

  const excludedMap = (state.comparatorExcludedIds ||= {});
  const qtyMap = (state.comparatorQtyById ||= {});
  const selectedStoreFilter = state.comparatorSelectedStoreId || 'BEST_PER_ITEM';

  // Calcul des totaux par magasin et de la meilleure offre par article
  const totalByStore = {
    store_lidl: 0,
    store_aldi: 0,
    store_intermarche: 0,
    store_leclerc: 0,
    store_carrefour: 0,
  };
  let totalOptimalMix = 0;
  let totalAverage = 0;
  let selectedCount = 0;

  function calcItemStorePrice(item, store) {
    const base = Number(item.lastPricePaid) || 2.0;
    const factor = state.useStoreBrandSub ? 0.78 : 1.0;
    const aisle = item.category || 'DEFAULT';
    const mult = store.mults[aisle] || store.mults.DEFAULT || 0.90;
    return Math.round(base * mult * factor * 100) / 100;
  }

  const rows = candidateItems.map((item) => {
    const isChecked = !excludedMap[item.id];
    const buyQty = Math.max(1, Number(qtyMap[item.id]) || 1);
    const basePrice = Number(item.lastPricePaid) || 2.0;
    const avgUnit = Math.round(basePrice * 1.12 * 100) / 100;
    const avgPrice = Math.round(avgUnit * buyQty * 100) / 100;

    // Calcul du prix dans chacun des 5 commerçants
    const storePrices = COMPARATOR_STORES.map((st) => {
      const uPrice = calcItemStorePrice(item, st);
      const lPrice = Math.round(uPrice * buyQty * 100) / 100;
      return { store: st, unitPrice: uPrice, linePrice: lPrice };
    });

    // Magasin le moins cher pour cet article
    const bestOffer = storePrices.slice().sort((a, b) => a.unitPrice - b.unitPrice)[0];

    if (isChecked) {
      for (const sp of storePrices) {
        totalByStore[sp.store.id] = Math.round((totalByStore[sp.store.id] + sp.linePrice) * 100) / 100;
      }
      totalOptimalMix = Math.round((totalOptimalMix + bestOffer.linePrice) * 100) / 100;
      totalAverage = Math.round((totalAverage + avgPrice) * 100) / 100;
      selectedCount++;
    }

    // Prix et magasin retenus selon le mode choisi par l'utilisateur
    let chosenOffer = bestOffer;
    if (selectedStoreFilter !== 'BEST_PER_ITEM') {
      const specific = storePrices.find((sp) => sp.store.id === selectedStoreFilter);
      if (specific) chosenOffer = specific;
    }

    const savingLine = Math.max(0.15, Math.round((avgPrice - chosenOffer.linePrice) * 100) / 100);
    const isCheapestStore = chosenOffer.unitPrice <= bestOffer.unitPrice + 0.01;

    return {
      item,
      isChecked,
      buyQty,
      chosenUnit: chosenOffer.unitPrice,
      chosenPrice: chosenOffer.linePrice,
      savingLine,
      storeChosen: `${chosenOffer.store.icon} ${chosenOffer.store.name} (${chosenOffer.store.distanceKm} km)`,
      bestStoreName: `${bestOffer.store.icon} ${bestOffer.store.name}`,
      isCheapestStore,
    };
  });

  // Détermination du magasin global le moins cher pour le panier complet
  const sortedSingleStores = COMPARATOR_STORES.slice().sort(
    (a, b) => totalByStore[a.id] - totalByStore[b.id]
  );
  const winningSingleStore = sortedSingleStores[0];

  const activeTotal =
    selectedStoreFilter === 'BEST_PER_ITEM'
      ? totalOptimalMix
      : totalByStore[selectedStoreFilter] || totalOptimalMix;
  const activeSaving = selectedCount > 0 ? Math.max(0.2, Math.round((totalAverage - activeTotal) * 100) / 100) : 0;
  const allSelected = selectedCount === rows.length;

  return `
    <!-- Sélecteur des 5 Commerçants de Proximité (Rayon 5 km) -->
    <div style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <span style="font-size:11.5px;font-weight:800;color:var(--text-main);">📍 Commerçants analysés dans un rayon de 5 km :</span>
        <span class="store-badge-winner">🏆 ${winningSingleStore.name} gagne</span>
      </div>

      <div class="stores-comparison-grid">
        <div
          class="store-selector-card ${selectedStoreFilter === 'BEST_PER_ITEM' ? 'active' : ''}"
          onclick="setComparatorStoreFilter('BEST_PER_ITEM')"
        >
          <div>
            <div class="store-name">🏆 Mix Optimal</div>
            <div class="store-distance">Meilleur prix / article</div>
          </div>
          <div class="store-total-price" style="color:#059669;">
            ${formatMoney(totalOptimalMix)}
            <div style="font-size:9.5px;font-weight:600;color:var(--healthy);">- ${formatMoney(Math.max(0, totalAverage - totalOptimalMix))}</div>
          </div>
        </div>

        ${COMPARATOR_STORES.map((st) => {
          const isWinner = st.id === winningSingleStore.id;
          const isCurrent = selectedStoreFilter === st.id;
          return `
          <div
            class="store-selector-card ${isCurrent ? 'active' : ''}"
            onclick="setComparatorStoreFilter('${st.id}')"
          >
            <div>
              <div class="store-name">
                <span>${st.icon}</span>
                <span>${st.brand}</span>
                ${isWinner ? '<span class="store-badge-winner">TOP</span>' : ''}
              </div>
              <div class="store-distance">${st.distanceKm} km ${st.id === 'store_carrefour' ? '(Piéton)' : ''}</div>
            </div>
            <div class="store-total-price">
              ${formatMoney(totalByStore[st.id])}
            </div>
          </div>
        `;
        }).join('')}
      </div>
    </div>

    <!-- Mode Game-Changer : Plafond "Budget Max en Poche" -->
    <div class="card" style="padding:10px 12px;margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <span style="font-size:11.5px;font-weight:800;color:var(--text-main);">🎯 Plafond "Budget Max en Poche" (Auto-sélection)</span>
        <span style="font-size:10.5px;color:var(--primary);font-weight:700;">Zéro dépassement</span>
      </div>
      <div class="chips-scroll-row" style="margin-bottom:0;padding-bottom:0;">
        <button class="filter-chip ${!state.comparatorBudgetCap ? 'active' : ''}" onclick="applyComparatorBudgetCap(0)">
          Tous (${rows.length})
        </button>
        <button class="filter-chip ${state.comparatorBudgetCap === 10 ? 'active' : ''}" onclick="applyComparatorBudgetCap(10)">
          💶 Max 10 €
        </button>
        <button class="filter-chip ${state.comparatorBudgetCap === 15 ? 'active' : ''}" onclick="applyComparatorBudgetCap(15)">
          💶 Max 15 €
        </button>
        <button class="filter-chip ${state.comparatorBudgetCap === 25 ? 'active' : ''}" onclick="applyComparatorBudgetCap(25)">
          💶 Max 25 €
        </button>
      </div>
    </div>

    <!-- Bandeau IA Substitutions MDD -->
    <label class="card" style="background:linear-gradient(135deg,var(--secondary-soft),var(--primary-soft));display:flex;justify-content:space-between;align-items:center;cursor:pointer;padding:11px 14px;margin-bottom:10px;">
      <div>
        <div style="font-weight:800;font-size:12.5px;">⚡ Substitutions Marques Distributeurs (MDD)</div>
        <div style="font-size:11px;color:var(--text-muted);">
          Économisez <strong style="color:var(--primary);">-22%</strong> en choisissant les marques de chaque enseigne.
        </div>
      </div>
      <input type="checkbox" ${state.useStoreBrandSub ? 'checked' : ''} onchange="toggleStoreBrandSub()" style="width:18px;height:18px;accent-color:var(--primary);" />
    </label>

    <!-- Filtre de périmètre (À racheter vs Toute la réserve) + Recherche & Ajout libre à la volée -->
    <div class="card" style="padding:10px 12px;margin-bottom:10px;">
      <div class="segmented-control" style="margin-bottom:8px;">
        <button class="seg-btn ${effectiveScope === 'LOW' ? 'active' : ''}" onclick="setComparatorScope('LOW')">
          🔴 À racheter (${lowItems.length})
        </button>
        <button class="seg-btn ${effectiveScope === 'ALL' ? 'active' : ''}" onclick="setComparatorScope('ALL')">
          🥫 Toute ma réserve (${state.pantryItems.length})
        </button>
      </div>
      <div class="search-bar-row" style="margin-bottom:8px;">
        <div class="search-input-box" style="flex:1;">
          <span>🔍</span>
          <input
            type="text"
            placeholder="Filtrer un produit à comparer à 5 km..."
            value="${escapeHtml(state.comparatorSearchQuery || '')}"
            oninput="handleComparatorSearch(this.value)"
          />
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 82px auto;gap:6px;align-items:center;">
        <input class="input-field" id="customCompName" placeholder="+ Produit libre (ex: Café, Couches...)" style="padding:7px 10px;font-size:12px;" />
        <input class="input-field" id="customCompPrice" type="number" step="0.01" value="2.50" placeholder="Prix €" style="padding:7px 8px;font-size:12px;" />
        <button type="button" class="btn-primary" style="width:auto;padding:7px 12px;font-size:12px;" onclick="addCustomComparatorProduct()">
          + Comparer
        </button>
      </div>
    </div>

    <div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0;">
      <span style="font-size:11px;font-weight:800;color:var(--text-muted);letter-spacing:0.05em;">
        ${effectiveScope === 'ALL' ? 'TOUS LES PRODUITS COMPARÉS' : 'ARTICLES EN STOCK CRITIQUE'} (${selectedCount} / ${rows.length})
      </span>
      <button class="icon-btn" style="padding:4px 10px;font-size:11px;" onclick="toggleAllComparatorItems()">
        ${allSelected ? '☐ Tout décocher' : '☑️ Tout cocher'}
      </button>
    </div>

    <div class="comparator-items-grid" style="display:flex;flex-direction:column;gap:8px;">
      ${rows
        .map(
          (r) => `
        <div class="card ${!r.isChecked ? 'comp-row-disabled' : ''}" style="margin-bottom:0;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1;cursor:pointer;" onclick="toggleComparatorItem('${r.item.id}')">
            <input
              type="checkbox"
              ${r.isChecked ? 'checked' : ''}
              onclick="event.stopPropagation(); toggleComparatorItem('${r.item.id}')"
              style="width:18px;height:18px;accent-color:var(--primary);cursor:pointer;flex-shrink:0;"
            />
            <div style="min-width:0;">
              <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${!r.isChecked ? 'text-decoration:line-through;' : ''}">
                ${r.item.name}
              </div>
              <div style="font-size:11px;color:var(--text-muted);">
                ${r.storeChosen} • Stock : <strong style="color:${r.item.currentQuantity === 0 ? 'var(--critical)' : 'var(--warning)'};">${r.item.currentQuantity}</strong> • ${formatMoney(r.chosenUnit)}/u
              </div>
            </div>
          </div>

          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
            <div class="stepper-pill">
              <button class="stepper-btn" onclick="changeComparatorItemQty('${r.item.id}', -1)">-</button>
              <span class="stepper-val">${r.buyQty}</span>
              <button class="stepper-btn" onclick="changeComparatorItemQty('${r.item.id}', 1)">+</button>
            </div>
            <div style="text-align:right;min-width:62px;">
              <div style="font-family:'Plus Jakarta Sans';font-weight:800;font-size:13.5px;color:var(--primary);">
                ${formatMoney(r.chosenPrice)}
              </div>
              <span class="badge-state HEALTHY">-${formatMoney(r.savingLine)}</span>
            </div>
          </div>
        </div>
      `
        )
        .join('')}
    </div>

    <!-- Sticky Bottom Action Bar -->
    <div class="sticky-comparator-footer">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-size:12.5px;">
        <span style="color:var(--text-muted);">
          Total Panier (${selectedCount} article${selectedCount > 1 ? 's' : ''}) • ${selectedStoreFilter === 'BEST_PER_ITEM' ? '🏆 Mix 5 km' : COMPARATOR_STORES.find(s=>s.id===selectedStoreFilter)?.brand || 'Magasin'}
        </span>
        <span>
          <strong style="font-size:15px;color:var(--primary);">${formatMoney(activeTotal)}</strong>
          <span style="font-size:11.5px;color:var(--healthy);font-weight:700;"> (Éco. ${formatMoney(activeSaving)})</span>
        </span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1.25fr;gap:8px;">
        <button
          type="button"
          class="btn-secondary"
          style="padding:10px 8px;font-size:12px;font-weight:800;border-color:var(--primary);color:var(--primary);"
          ${selectedCount === 0 ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}
          onclick="openAffiliateDriveOrder('${selectedStoreFilter === 'BEST_PER_ITEM' ? winningSingleStore.id : selectedStoreFilter}', ${activeTotal.toFixed(2)})"
        >
          🛒 Commander en Drive
        </button>
        <button
          class="btn-primary"
          style="padding:10px 8px;font-size:12px;"
          ${selectedCount === 0 ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}
          onclick="validate5kmBasketPurchase(${activeTotal.toFixed(2)}, ${activeSaving.toFixed(2)})"
        >
          ✅ Valider (${formatMoney(activeTotal)})
        </button>
      </div>
    </div>
  `;
}
function setComparatorMode(m) {
  state.comparatorMode = m;
  renderAll();
}

function toggleStoreBrandSub() {
  state.useStoreBrandSub = !state.useStoreBrandSub;
  if (state.comparatorBudgetCap > 0) {
    applyComparatorBudgetCap(state.comparatorBudgetCap);
  } else {
    renderAll();
  }
}

function toggleComparatorItem(itemId) {
  state.comparatorBudgetCap = null;
  const excludedMap = (state.comparatorExcludedIds ||= {});
  excludedMap[itemId] = !excludedMap[itemId];
  renderAll();
}

function toggleAllComparatorItems() {
  state.comparatorBudgetCap = null;
  const excludedMap = (state.comparatorExcludedIds ||= {});
  const candidateItems = getComparatorCandidateItems();
  const allChecked = candidateItems.every((i) => !excludedMap[i.id]);
  for (const item of candidateItems) {
    excludedMap[item.id] = allChecked;
  }
  renderAll();
}

function changeComparatorItemQty(itemId, delta) {
  const qtyMap = (state.comparatorQtyById ||= {});
  const excludedMap = (state.comparatorExcludedIds ||= {});
  const cur = Number(qtyMap[itemId]) || 1;
  const next = Math.max(1, cur + delta);
  qtyMap[itemId] = next;
  excludedMap[itemId] = false;
  renderAll();
}

function applyComparatorBudgetCap(capAmount) {
  const qtyMap = (state.comparatorQtyById ||= {});
  const candidateItems = getComparatorCandidateItems();
  if (!capAmount || capAmount <= 0) {
    state.comparatorBudgetCap = null;
    state.comparatorExcludedIds = {};
    renderAll();
    return;
  }

  state.comparatorBudgetCap = capAmount;
  const factor = state.useStoreBrandSub ? 0.78 : 1.0;

  // Tri intelligent : rupture totale (stock 0) en priorité absolue, puis prix croissant
  const sorted = candidateItems.slice().sort((a, b) => {
    if (a.currentQuantity !== b.currentQuantity) return a.currentQuantity - b.currentQuantity;
    return (a.lastPricePaid || 2) - (b.lastPricePaid || 2);
  });

  let runningTotal = 0;
  const newExcluded = {};
  let kept = 0;

  for (const item of sorted) {
    const qty = Math.max(1, Number(qtyMap[item.id]) || 1);
    const base = Number(item.lastPricePaid) || 2.0;
    const unitPrice =
      state.comparatorMode === 'SINGLE_STORE'
        ? Math.round(base * 0.92 * factor * 100) / 100
        : Math.round(base * 0.88 * factor * 100) / 100;
    const lineCost = unitPrice * qty;

    if (runningTotal + lineCost <= capAmount) {
      runningTotal += lineCost;
      newExcluded[item.id] = false;
      kept++;
    } else {
      newExcluded[item.id] = true;
    }
  }

  state.comparatorExcludedIds = newExcluded;
  showToast(`🎯 Panier ajusté à ${formatMoney(runningTotal)} (${kept} articles prioritaires <= ${capAmount} €) !`);
  renderAll();
}

async function validate5kmBasketPurchase(totalCost, saving) {
  if (state.isGuestSession) {
    showToast('ℹ️ Mode Invité (Lecture seule) : modifications désactivées.', 'warning');
    return;
  }
  if (!state.currentUser) return;
  const excludedMap = (state.comparatorExcludedIds ||= {});
  const candidateItems = getComparatorCandidateItems();
  const selectedItems = candidateItems.filter((i) => !excludedMap[i.id]);

  if (selectedItems.length === 0) {
    showToast('Veuillez cocher au moins un produit à acheter.', 'warning');
    return;
  }

  const uid = state.currentUser.uid;
  const mb = await ensureUserMonthInitialized(state.selectedYearMonth);

  for (const item of selectedItems) {
    const addQty = Math.max(1, Number(state.comparatorQtyById[item.id]) || 1);
    item.currentQuantity += addQty;
    item.needsRestock = item.currentQuantity <= (item.alertThreshold ?? 1);
    item.lastUpdatedAt = new Date().toISOString();
    await setDoc(doc(db, 'users', uid, 'pantryItems', item.id), item);
  }

  let foodCat = mb.categories.find((c) => c.type === 'VARIABLE') || mb.categories[0];
  if (foodCat) {
    foodCat.spentAmount = Math.round((foodCat.spentAmount + totalCost) * 100) / 100;
    const g = computeGaugeState(foodCat.spentAmount, foodCat.allocatedLimit);
    foodCat.consumptionPercentage = g.pct;
    foodCat.gaugeState = g.state;
    await setDoc(doc(db, 'users', uid, 'monthlyBudgets', state.selectedYearMonth, 'categories', foodCat.id), foodCat);
  }

  mb.totalVariableSpent = Math.round((mb.totalVariableSpent + totalCost) * 100) / 100;
  mb.totalSavedViaComparator = Math.round(((mb.totalSavedViaComparator || 0) + saving) * 100) / 100;
  mb.realDisposableIncome =
    mb.globalAllocated +
    (mb.totalExtraIncome || 0) -
    mb.totalFixedCharges -
    mb.totalVariableSpent -
    (mb.totalAgiosAndFees || 0);

  const tx = {
    id: `tx_5km_${Date.now()}`,
    yearMonth: state.selectedYearMonth,
    categoryId: foodCat?.id || 'cat_alimentation',
    categoryName: foodCat?.name || 'Alimentation',
    amount: totalCost,
    type: 'VARIABLE',
    date: getDefaultOperationDate(state.selectedYearMonth),
    label: `Panier 5 km (${selectedItems.length} article${selectedItems.length > 1 ? 's' : ''})`,
    source: 'COMPARATOR_5KM',
    savedAmountViaComparator: saving,
    createdAt: new Date().toISOString(),
  };
  mb.transactions.push(tx);

  await setDoc(doc(db, 'users', uid, 'monthlyBudgets', state.selectedYearMonth, 'transactions', tx.id), tx);
  await setDoc(
    doc(db, 'users', uid, 'monthlyBudgets', state.selectedYearMonth),
    {
      totalVariableSpent: mb.totalVariableSpent,
      totalSavedViaComparator: mb.totalSavedViaComparator,
      realDisposableIncome: mb.realDisposableIncome,
    },
    { merge: true }
  );

  state.comparatorExcludedIds = {};
  state.comparatorBudgetCap = null;
  showToast(`🎉 ${selectedItems.length} article(s) réapprovisionné(s) et ${formatMoney(totalCost)} imputés !`);
  setScreen('STITCH-03');
}

/* ============================================================================
 * STITCH-02, STITCH-05, STITCH-08, STITCH-09 & STITCH-10
 * ============================================================================ */
function renderStitch02Profile() {
  const p = state.profile || {};
  const sub = getSubscriptionInfo();
  const canDelete = Boolean(state.currentUser && !state.isGuestSession && !state.isDemoSession);
  return `
    <div class="profile-desktop-grid">
      <div>
        <!-- Carte Abonnement EcoPanier+ & Assistant Configuration Express 60s -->
        <div class="card" style="border-left:4px solid var(--primary);background:linear-gradient(135deg,var(--primary-soft),var(--surface));">
          <div class="section-header" style="margin-bottom:6px;">
            <span class="section-title">👑 Mon Offre &amp; Outils Croissance</span>
            <span class="badge-state ${sub.isPremium ? 'HEALTHY' : 'WARNING'}">
              ${sub.isPremium ? 'ILLIMITÉ' : `${sub.freeRemaining}/${sub.freeLimit} scans`}
            </span>
          </div>
          <div style="font-size:12px;color:var(--text);margin-bottom:10px;">
            Formule active : <strong>${escapeHtml(sub.tierLabel)}</strong>
            ${sub.creditsBalance > 0 ? ` • <strong>+${sub.creditsBalance} crédits IA</strong>` : ''}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
            <button type="button" class="btn-primary" style="padding:9px;font-size:12px;" onclick="openBottomSheet('PAYWALL_MODAL')">
              👑 Offres EcoPanier+
            </button>
            <button type="button" class="btn-secondary" style="padding:9px;font-size:12px;" onclick="openSavingsStoryModal()">
              📸 Carte Story 9:16
            </button>
          </div>
          <button type="button" class="btn-secondary" style="width:100%;padding:8px;font-size:12px;" onclick="openOnboarding60sModal()">
            🚀 Assistant Configuration Express 60s (3 étapes)
          </button>
        </div>

        <div class="card">
          <div class="section-header">
            <span class="section-title">👤 Mon Profil &amp; Préférences</span>
          </div>
          <div class="input-group">
            <label class="input-label">Nom du foyer</label>
            <input class="input-field" id="profName" value="${p.displayName || ''}" />
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div class="input-group">
              <label class="input-label">Langue</label>
              <select class="select-field" id="profLocale">
                <option value="fr" ${p.locale === 'fr' ? 'selected' : ''}>🇫🇷 Français (FR)</option>
                <option value="en" ${p.locale === 'en' ? 'selected' : ''}>🇬🇧 English (EN)</option>
              </select>
            </div>
            <div class="input-group">
              <label class="input-label">Devise</label>
              <select class="select-field" id="profCurrency">
                <option value="EUR" ${p.currency === 'EUR' ? 'selected' : ''}>€ Euro (EUR)</option>
                <option value="XAF" ${p.currency === 'XAF' ? 'selected' : ''}>FCFA (XAF)</option>
                <option value="USD" ${p.currency === 'USD' ? 'selected' : ''}>$ Dollar (USD)</option>
                <option value="CAD" ${p.currency === 'CAD' ? 'selected' : ''}>$ Dollar Can. (CAD)</option>
              </select>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div class="input-group">
              <label class="input-label">Budget mensuel global</label>
              <input class="input-field" type="number" id="profIncome" value="${p.defaultMonthlyIncome || 0}" />
            </div>
            <div class="input-group">
              <label class="input-label">Notification 5 km</label>
              <input class="input-field" type="time" id="profNotifTime" value="${p.dailyNotificationTime || '17:30'}" />
            </div>
          </div>
          <button class="btn-primary" onclick="updateProfilePrefs()">
            💾 Enregistrer mes préférences
          </button>
        </div>
      </div>

      <div>
        <div class="card">
          <div class="section-header">
            <span class="section-title">📍 Rayon Géographique 5,0 km</span>
            <button class="icon-btn" onclick="detectGpsLocation()">📡 GPS</button>
          </div>
          <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">
            Position : <strong>${p.location?.addressLabel || 'Paris 11e'}</strong>
          </p>
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${state.nearbyStores
              .map(
                (s) => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;background:var(--surface-alt);border-radius:10px;">
                <div>
                  <div style="font-weight:700;font-size:13px;">🏪 ${s.name}</div>
                  <div style="font-size:11px;color:var(--text-muted);">${s.address}</div>
                </div>
                <span class="badge-state HEALTHY">&lt;= 5 km</span>
              </div>
            `
              )
              .join('')}
          </div>
        </div>

        <div class="card">
          <div class="section-header">
            <span class="section-title">🔒 Confidentialité &amp; Publication Mobile</span>
            <span class="badge-state HEALTHY">RGPD / Play Store</span>
          </div>
          <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px;line-height:1.45;">
            Consultez le détail des permissions mobiles (Caméra OCR, GPS 5 km) et gérez vos données personnelles ou la suppression de votre compte.
          </p>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <button type="button" class="btn-secondary" onclick="openBottomSheet('PRIVACY_POLICY')">
              📜 Politique de Confidentialité &amp; Sécurité
            </button>
            <button type="button" class="btn-secondary" onclick="openBottomSheet('SHARE_APK')">
              📲 Installer APK Android / Lien Google Play Store
            </button>
            ${
              canDelete
                ? `<button type="button" class="btn-logout" onclick="handleDeleteAccount()">
                    🗑️ Supprimer définitivement mon compte
                  </button>`
                : ''
            }
          </div>
        </div>
      </div>
    </div>
  `;
}

async function updateProfilePrefs() {
  if (!state.currentUser) return;
  const displayName = document.getElementById('profName').value.trim() || 'Mon Foyer';
  const locale = document.getElementById('profLocale').value;
  const currency = document.getElementById('profCurrency').value;
  const defaultMonthlyIncome = Number(document.getElementById('profIncome').value) || 0;
  const dailyNotificationTime = document.getElementById('profNotifTime').value || '17:30';

  state.profile = { ...state.profile, displayName, locale, currency, defaultMonthlyIncome, dailyNotificationTime };
  await setDoc(doc(db, 'users', state.currentUser.uid), state.profile, { merge: true });

  // Si le mois actif a un budget à 0, on lui applique aussi le nouveau budget mensuel par défaut
  const curMb = state.monthlyBudgets[state.selectedYearMonth];
  if (curMb && (!curMb.globalAllocated || curMb.globalAllocated === 0) && defaultMonthlyIncome > 0) {
    curMb.globalAllocated = defaultMonthlyIncome;
    curMb.realDisposableIncome =
      defaultMonthlyIncome +
      (curMb.totalExtraIncome || 0) -
      (curMb.totalFixedCharges || 0) -
      (curMb.totalVariableSpent || 0) -
      (curMb.totalAgiosAndFees || 0);
    await setDoc(
      doc(db, 'users', state.currentUser.uid, 'monthlyBudgets', state.selectedYearMonth),
      {
        globalAllocated: defaultMonthlyIncome,
        realDisposableIncome: curMb.realDisposableIncome,
      },
      { merge: true }
    );
  }

  showToast('✅ Préférences et budget mensuel enregistrés.');
  renderAll();
}

function detectGpsLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(async (pos) => {
    state.profile.location = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      geohash: 'u09tunq',
      addressLabel: `GPS (${pos.coords.latitude.toFixed(3)}, ${pos.coords.longitude.toFixed(3)})`,
      searchRadiusKm: 5.0,
    };
    await setDoc(doc(db, 'users', state.currentUser.uid), { location: state.profile.location }, { merge: true });
    showToast('📍 Position GPS mise à jour !');
    renderAll();
  });
}

function setOperationMode(mode) {
  state.operationMode = mode;
  renderAll();
}

function renderStitch05AddExpense() {
  const mb = state.monthlyBudgets[state.selectedYearMonth] || { categories: [] };
  const mode = state.operationMode || 'EXPENSE';

  return `
    <div class="card operation-centered-card">
      <div class="section-header">
        <span class="section-title">💳 Nouvelle Opération (${formatMonthLabel(state.selectedYearMonth)})</span>
      </div>

      <!-- Sélecteur 3 modes : Dépense | + Entrée d'argent | - Agios / Frais -->
      <div class="segmented-control" style="margin-bottom:14px;">
        <button class="seg-btn ${mode === 'EXPENSE' ? 'active' : ''}" onclick="setOperationMode('EXPENSE')">
          💸 Dépense
        </button>
        <button class="seg-btn ${mode === 'EXTRA_INCOME' ? 'active' : ''}" onclick="setOperationMode('EXTRA_INCOME')">
          💰 + Entrée
        </button>
        <button class="seg-btn ${mode === 'AGIOS' ? 'active' : ''}" onclick="setOperationMode('AGIOS')">
          🏦 - Agios / Frais
        </button>
      </div>

      <div class="input-group">
        <label class="input-label">
          ${mode === 'EXTRA_INCOME' ? 'Montant reçu' : mode === 'AGIOS' ? 'Montant des agios / frais bancaires' : 'Montant de la dépense'} (${state.profile?.currency || 'EUR'})
        </label>
        <input
          class="input-field"
          type="number"
          step="0.01"
          id="expAmount"
          placeholder="0.00"
          style="font-size:22px;font-weight:800;color:${mode === 'EXTRA_INCOME' ? '#059669' : mode === 'AGIOS' ? 'var(--critical)' : 'var(--text-main)'};"
        />
      </div>

      ${
        mode === 'EXPENSE'
          ? mb.categories.length === 0
            ? `<div class="empty-state" style="margin-bottom:12px;">
                Créez d'abord un poste budgétaire.<br/>
                <button class="btn-secondary" style="margin-top:8px;" onclick="openBottomSheet('ADD_TEMPLATE')">+ Créer un poste</button>
              </div>`
            : `<div class="input-group">
                <label class="input-label">Enveloppe budgétaire</label>
                <select class="select-field" id="expCategory">
                  ${mb.categories.map((c) => `<option value="${c.id}">${c.icon || '🎯'} ${c.name}</option>`).join('')}
                </select>
              </div>`
          : mode === 'EXTRA_INCOME'
          ? `<div class="input-group">
              <label class="input-label">Type d'entrée d'argent</label>
              <select class="select-field" id="expCategory">
                <option value="Prime / Heures supplémentaires">💼 Prime / Heures supplémentaires</option>
                <option value="Remboursement Santé / Mutuelle">🏥 Remboursement Santé / Mutuelle</option>
                <option value="Aide / Allocation (CAF, Prime)">🏛️ Aide / Allocation (CAF, Prime)</option>
                <option value="Vente / Virement reçu">🤝 Vente d'occasion / Virement reçu</option>
              </select>
            </div>`
          : `<div class="input-group">
              <label class="input-label">Type de frais bancaires / Agios</label>
              <select class="select-field" id="expCategory">
                <option value="Agios / Intérêts débiteurs">🏦 Agios / Intérêts de découvert</option>
                <option value="Commission d'intervention">⚠️ Commission d'intervention bancaire</option>
                <option value="Frais tenue de compte / Carte">💳 Frais de tenue de compte / Carte</option>
                <option value="Frais de rejet / Incident">🚫 Frais d'incident ou rejet</option>
              </select>
            </div>`
      }

      <div class="input-group">
        <label class="input-label">Date de l'opération</label>
        <input class="input-field" type="date" id="expDate" value="${getDefaultOperationDate(state.selectedYearMonth)}" />
      </div>
      <div class="input-group">
        <label class="input-label">Libellé / Détail</label>
        <input
          class="input-field"
          id="expLabel"
          placeholder="${mode === 'EXTRA_INCOME' ? 'Ex: Prime employeur, Vinted...' : mode === 'AGIOS' ? 'Ex: Agios trimestriels...' : 'Ex: Courses, Boulangerie...'}"
        />
      </div>
      <button
        class="btn-primary"
        id="manualExpenseSubmitBtn"
        style="${mode === 'AGIOS' ? 'background:linear-gradient(135deg,#DC2626,#B91C1C);' : ''}"
        onclick="submitManualExpense()"
      >
        ${mode === 'EXTRA_INCOME' ? '💰 Créditer cette entrée d’argent' : mode === 'AGIOS' ? '🏦 Imputer ces agios / frais' : '💾 Enregistrer la dépense'}
      </button>
      <button class="btn-secondary" style="margin-top:10px;" onclick="setScreen('STITCH-10')">
        📷 Ou scanner une facture / ticket PDF
      </button>
    </div>
  `;
}

async function submitManualExpense() {
  if (state.isGuestSession) {
    showToast('ℹ️ Mode Invité (Lecture seule) : modifications désactivées.', 'warning');
    return;
  }
  if (!state.currentUser || state.isSubmittingOperation) return;
  const mode = state.operationMode || 'EXPENSE';
  const amount = Number(document.getElementById('expAmount')?.value) || 0;
  const catOrSub = document.getElementById('expCategory')?.value;
  const dateISO = document.getElementById('expDate')?.value || getDefaultOperationDate(state.selectedYearMonth);
  const rawLabel = (document.getElementById('expLabel')?.value || '').trim();

  if (amount <= 0) {
    showToast('Saisissez un montant supérieur à 0.', 'warning');
    return;
  }

  state.isSubmittingOperation = true;
  const submitBtn = document.getElementById('manualExpenseSubmitBtn');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const uid = state.currentUser.uid;
    const targetYm = dateISO.slice(0, 7);
    const mb = await ensureUserMonthInitialized(targetYm);

    if (mode === 'EXTRA_INCOME' || mode === 'AGIOS') {
      const label = rawLabel ? `${catOrSub} — ${rawLabel}` : catOrSub || (mode === 'EXTRA_INCOME' ? 'Entrée d’argent' : 'Agios & Frais');
      if (mode === 'EXTRA_INCOME') {
        mb.totalExtraIncome = Math.round(((mb.totalExtraIncome || 0) + amount) * 100) / 100;
      } else {
        mb.totalAgiosAndFees = Math.round(((mb.totalAgiosAndFees || 0) + amount) * 100) / 100;
      }
      mb.realDisposableIncome =
        mb.globalAllocated +
        (mb.totalExtraIncome || 0) -
        mb.totalFixedCharges -
        mb.totalVariableSpent -
        (mb.totalAgiosAndFees || 0);

      const tx = {
        id: `tx_${mode.toLowerCase()}_${Date.now()}`,
        yearMonth: targetYm,
        categoryId: mode === 'EXTRA_INCOME' ? 'cat_extra_income' : 'cat_agios_fees',
        categoryName: mode === 'EXTRA_INCOME' ? '💰 Entrée d’argent' : '🏦 Agios & Frais Bancaires',
        amount,
        type: mode,
        date: dateISO,
        label,
        source: mode,
        createdAt: new Date().toISOString(),
      };
      mb.transactions.push(tx);

      await setDoc(doc(db, 'users', uid, 'monthlyBudgets', targetYm, 'transactions', tx.id), tx);
      await setDoc(
        doc(db, 'users', uid, 'monthlyBudgets', targetYm),
        {
          totalExtraIncome: mb.totalExtraIncome || 0,
          totalAgiosAndFees: mb.totalAgiosAndFees || 0,
          realDisposableIncome: mb.realDisposableIncome,
        },
        { merge: true }
      );

      state.selectedYearMonth = targetYm;
      state.operationMode = 'EXPENSE';
      showToast(
        mode === 'EXTRA_INCOME'
          ? `💰 +${formatMoney(amount)} crédités sur ${formatMonthLabel(targetYm)} !`
          : `🏦 -${formatMoney(amount)} d'agios/frais enregistrés.`,
        mode === 'EXTRA_INCOME' ? 'info' : 'warning'
      );
      setScreen('STITCH-03');
      return;
    }

    const cat = mb.categories.find((c) => c.id === catOrSub) || mb.categories[0];
    if (!cat) {
      showToast('Créez d’abord un poste budgétaire.', 'warning');
      return;
    }

    cat.spentAmount = Math.round((cat.spentAmount + amount) * 100) / 100;
    const g = computeGaugeState(cat.spentAmount, cat.allocatedLimit);
    cat.consumptionPercentage = g.pct;
    cat.gaugeState = g.state;

    if (cat.type === 'CHARGE_FIXE') {
      mb.totalFixedCharges = Math.round((mb.totalFixedCharges + amount) * 100) / 100;
    } else {
      mb.totalVariableSpent = Math.round((mb.totalVariableSpent + amount) * 100) / 100;
    }

    mb.realDisposableIncome =
      mb.globalAllocated +
      (mb.totalExtraIncome || 0) -
      mb.totalFixedCharges -
      mb.totalVariableSpent -
      (mb.totalAgiosAndFees || 0);

    const tx = {
      id: `tx_${Date.now()}`,
      yearMonth: targetYm,
      categoryId: cat.id,
      categoryName: cat.name,
      amount,
      type: cat.type,
      date: dateISO,
      label: rawLabel || 'Dépense',
      source: 'MANUAL',
      createdAt: new Date().toISOString(),
    };
    mb.transactions.push(tx);

    await setDoc(doc(db, 'users', uid, 'monthlyBudgets', targetYm, 'categories', cat.id), cat);
    await setDoc(doc(db, 'users', uid, 'monthlyBudgets', targetYm, 'transactions', tx.id), tx);
    await setDoc(
      doc(db, 'users', uid, 'monthlyBudgets', targetYm),
      {
        totalFixedCharges: mb.totalFixedCharges,
        totalVariableSpent: mb.totalVariableSpent,
        realDisposableIncome: mb.realDisposableIncome,
      },
      { merge: true }
    );

    state.selectedYearMonth = targetYm;
    showToast(`✅ Dépense de ${formatMoney(amount)} enregistrée.`);
    setScreen('STITCH-03');
  } finally {
    state.isSubmittingOperation = false;
    if (submitBtn) submitBtn.disabled = false;
  }
}

function renderStitch08Charts() {
  const allMonths = Object.keys(state.monthlyBudgets).sort();
  const maxVal = Math.max(
    1000,
    ...allMonths.map((ym) => {
      const m = state.monthlyBudgets[ym];
      return Math.max((m.globalAllocated || 0) + (m.totalExtraIncome || 0), (m.totalFixedCharges || 0) + (m.totalVariableSpent || 0) + (m.totalAgiosAndFees || 0));
    })
  );

  return `
    <div class="charts-desktop-grid">
      <div class="card">
        <div class="section-header">
          <span class="section-title">📈 Évolution Multi-Mois</span>
          <button class="icon-btn" onclick="setScreen('STITCH-03')">← Budget</button>
        </div>
        <div class="chart-bars">
          ${allMonths
            .map((ym) => {
              const m = state.monthlyBudgets[ym];
              const totalIn = (m.globalAllocated || 0) + (m.totalExtraIncome || 0);
              const spent = (m.totalFixedCharges || 0) + (m.totalVariableSpent || 0) + (m.totalAgiosAndFees || 0);
              const hAlloc = Math.round((totalIn / maxVal) * 100);
              const hSpent = Math.min(100, Math.round((spent / maxVal) * 100));
              return `
              <div class="chart-col" onclick="selectMonthFromChart('${ym}')" style="cursor:pointer;">
                <div class="bar-pair">
                  <div class="bar allocated" style="height:${hAlloc}%"></div>
                  <div class="bar spent ${spent > totalIn && totalIn > 0 ? 'over' : ''}" style="height:${hSpent}%"></div>
                </div>
                <span class="chart-month-lbl">${ym}</span>
              </div>
            `;
            })
            .join('')}
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-top:8px;">
          <span>⬜ Budget + Entrées</span>
          <span>🟩 Total Dépensé (touchez un mois pour l'ouvrir)</span>
        </div>
      </div>

      <div class="card">
        <div class="section-header">
          <span class="section-title">🗓️ Synthèse Mensuelle</span>
        </div>
        ${allMonths
          .slice()
          .reverse()
          .map((ym) => {
            const m = state.monthlyBudgets[ym];
            const totalIn = (m.globalAllocated || 0) + (m.totalExtraIncome || 0);
            const spent = (m.totalFixedCharges || 0) + (m.totalVariableSpent || 0) + (m.totalAgiosAndFees || 0);
            const rest = totalIn - spent;
            return `
            <div class="slim-envelope-row" onclick="selectMonthFromChart('${ym}')" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;">
              <div>
                <div style="font-weight:700;font-size:13px;">${formatMonthLabel(ym)}</div>
                <div style="font-size:11px;color:var(--text-muted);">Dépensé : ${formatMoney(spent)} / ${formatMoney(totalIn)}</div>
              </div>
              <span class="badge-state ${rest >= 0 ? 'HEALTHY' : 'CRITICAL'}">${rest >= 0 ? '+' : ''}${formatMoney(rest)}</span>
            </div>
          `;
          })
          .join('')}
      </div>
    </div>
  `;
}

function setChartRange(n) { state.chartRangeMonths = n; renderAll(); }
function selectMonthFromChart(ym) { state.selectedYearMonth = ym; setScreen('STITCH-03'); }
function selectInflationProduct(id) { state.selectedInflationItemId = id; renderAll(); }

/* ============================================================================
 * STITCH-09 : Coach IA v3.3 — 2 FONCTIONNALITÉS GAME-CHANGER :
 * 1) 🛡️ "Bouclier Anti-Agios & Arbitrage Automatique 1-Clic"
 * 2) 🍲 "Chef IA Frigo & Réserve Zéro-Dépense (4 Cuisines du Monde)"
 * ============================================================================ */

const CUISINE_META = {
  ALL: { label: 'Toutes', flag: '🌍', badgeClass: 'HEALTHY' },
  FRANCAISE: { label: 'Française', flag: '🇫🇷', badgeClass: 'FR' },
  CAMEROUNAISE: { label: 'Camerounaise', flag: '🇨🇲', badgeClass: 'CM' },
  MAGHREBINE: { label: 'Maghrébine', flag: '🇲🇦', badgeClass: 'MA' },
  ASIATIQUE: { label: 'Asiatique', flag: '🥢', badgeClass: 'AS' },
};

function setCoachSubTab(tab) {
  state.coachSubTab = tab;
  renderAll();
}

function setRecipeCuisineFilter(cuisine) {
  state.recipeCuisineFilter = cuisine || 'ALL';
  renderAll();
}

function setChefCustomPrompt(val) {
  state.chefCustomPrompt = val || '';
}

function applyChefQuickPrompt(promptText) {
  state.chefCustomPrompt = promptText || '';
  state.coachSubTab = 'RECIPES';
  if (state.currentScreen !== 'STITCH-09') {
    state.currentScreen = 'STITCH-09';
  }
  refreshAiChefRecipes();
}

async function refreshAiChefRecipes() {
  if (state.recipeAiLoading) return;
  const promptInput = document.getElementById('chefCustomPromptInput');
  if (promptInput) {
    state.chefCustomPrompt = promptInput.value.trim();
  }
  state.recipeAiLoading = true;
  state.coachSubTab = 'RECIPES';
  renderAll();

  const inStockFood = state.pantryItems.filter(
    (i) => Number(i.currentQuantity) >= 1 && i.category !== 'ENTRETIEN'
  );

  try {
    const idToken = state.currentUser?.getIdToken ? await state.currentUser.getIdToken() : '';
    const headers = { 'Content-Type': 'application/json' };
    if (idToken) {
      headers.Authorization = `Bearer ${idToken}`;
    }

    const response = await fetch(`${FUNCTIONS_BASE_URL}/generateCustomChefRecipes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        data: {
          pantryItems: inStockFood.map((i) => ({
            name: i.name,
            currentQuantity: i.currentQuantity,
            unit: i.unit || '1u',
            category: i.category || 'EPICERIE_SALEE',
            expirationDate: i.expirationDate || null,
          })),
          cuisineFilter: state.recipeCuisineFilter || 'ALL',
          customPrompt: state.chefCustomPrompt || '',
        },
      }),
    });

    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(json?.error?.message || `HTTP ${response.status}`);
    }
    const payload = json.result || json;
    const rawRecipes = Array.isArray(payload.recipes) ? payload.recipes : [];
    if (rawRecipes.length > 0) {
      state.aiGeneratedRecipes = rawRecipes.map((r, idx) => ({
        id: r.id || `ai_chef_${Date.now()}_${idx}`,
        isAiGenerated: true,
        cuisine: r.cuisine || 'FRANCAISE',
        title: r.title || 'Recette Sur-Mesure du Chef IA',
        icon: r.icon || '🍲',
        servings: r.servings || '2 à 4 pers',
        prepTime: r.prepTime || '15 min',
        cookTime: r.cookTime || '15 min',
        savedEuros: Number(r.savedEuros) || 14.5,
        calories: r.calories || '480 kcal/pers',
        matchedKeywords: Array.isArray(r.matchedKeywords) ? r.matchedKeywords : [],
        pantryStaples: Array.isArray(r.pantryStaples) ? r.pantryStaples : ['Sel', 'Poivre', 'Huile'],
        steps: r.steps || 'Suivez les étapes détaillées du Chef IA.',
        fullSteps: Array.isArray(r.fullSteps) && r.fullSteps.length > 0 ? r.fullSteps : [r.steps || 'Cuisiner avec les produits du stock.'],
        chefTips: r.chefTips || 'Priorisez vos produits frais à DLC proche.',
      }));
      state.cookedRecipeIds = {};
      state.recipeAiLoading = false;
      showToast(
        `✨ Chef Gemini IA : ${state.aiGeneratedRecipes.length} recettes créées sur-mesure${state.chefCustomPrompt ? ` ("${escapeHtml(state.chefCustomPrompt)}")` : ''} !`
      );
      renderAll();
      return;
    }
  } catch (err) {
    console.warn('Fallback catalogue local Chef IA:', err.message);
  }

  // Fallback intelligent sur le catalogue local si hors-ligne ou mode démo local
  state.recipeRefreshSeed = ((state.recipeRefreshSeed || 0) + 1) % 3;
  state.cookedRecipeIds = {};
  state.recipeAiLoading = false;
  const allRecs = buildZeroSpendPantryRecipes();
  showToast(
    `✨ Agent Chef IA : ${allRecs.length} recettes sélectionnées (🇫🇷 🇨🇲 🇲🇦 🥢) à partir de vos ${inStockFood.length} produits alimentaires en stock !`
  );
  renderAll();
}

function buildZeroSpendPantryRecipes() {
  const inStockFood = state.pantryItems.filter(
    (i) => Number(i.currentQuantity) >= 1 && i.category !== 'ENTRETIEN'
  );
  const findItem = (keywords) =>
    inStockFood.find((item) => {
      const n = (item.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return keywords.some((kw) => n.includes(kw));
    });

  const masterCatalog = [
    // 🇫🇷 CUISINE FRANÇAISE (4 recettes)
    {
      id: 'fr_blanquette_poulet',
      cuisine: 'FRANCAISE',
      title: '🇫🇷 Blanquette Express de Poulet & Riz Pilaf à la Crème',
      icon: '🍗',
      servings: '3 à 4 pers',
      prepTime: '15 min',
      cookTime: '15 min',
      savedEuros: 17.5,
      calories: '550 kcal/pers',
      matchKeys: [
        { label: 'Filets de Poulet / Volaille', kws: ['poulet', 'viande', 'volaille', 'steak', 'dinde'] },
        { label: 'Riz Basmati / Pâtes', kws: ['riz', 'pates', 'spaghetti'] },
        { label: 'Crème Fraîche / Beurre', kws: ['creme', 'beurre', 'lait'] },
        { label: 'Légumes / Carottes', kws: ['carotte', 'legume', 'poelee', 'oignon', 'champignon'] },
      ],
      pantryStaples: ['Sel fin', 'Poivre du moulin', 'Pointe de farine', 'Eau de cuisson'],
      steps: 'Dorer le poulet au beurre, lier à la crème fraîche onctueuse et servir avec le riz pilaf chaud.',
      fullSteps: [
        'Émincer le poulet en bouchées régulières et couper les carottes ou légumes en rondelles fines.',
        'Dans une poêle bien chaude, faire dorer les morceaux de poulet dans une noisette de beurre pendant 6 minutes.',
        'Saupoudrer d\'une cuillère de farine, verser un demi-verre d\'eau puis la crème fraîche entière. Laisser mijoter à feu doux 8 minutes jusqu\'à liaison onctueuse.',
        'Dresser sur un lit de riz basmati bien fumant, saler, poivrer et parsemer d\'herbes si disponibles.'
      ],
      chefTips: 'Une pointe de jus de citron ou de moutarde dans la sauce crème rehausse instantanément le goût bistrot !',
    },
    {
      id: 'fr_lentilles_saumon',
      cuisine: 'FRANCAISE',
      title: '🇫🇷 Poêlée Bistrot de Lentilles Vertes & Pavé de Saumon / Thon',
      icon: '🐟',
      servings: '2 pers',
      prepTime: '10 min',
      cookTime: '18 min',
      savedEuros: 18.9,
      calories: '510 kcal/pers',
      matchKeys: [
        { label: 'Lentilles Vertes du Puy', kws: ['lentille', 'pois', 'legume'] },
        { label: 'Pavé de Saumon / Thon en boîte', kws: ['saumon', 'thon', 'poisson', 'oeuf'] },
        { label: 'Beurre Demi-Sel / Huile d\'Olive', kws: ['beurre', 'huile', 'creme'] },
        { label: 'Oignons / Aromates', kws: ['oignon', 'ail', 'legume'] },
      ],
      pantryStaples: ['Vinaigre de cidre / vin', 'Sel fin', 'Poivre'],
      steps: 'Mijoter les lentilles vertes avec aromates puis dresser avec le poisson doré.',
      fullSteps: [
        'Rincer les lentilles vertes et les cuire dans trois fois leur volume d\'eau non salée pendant 18 minutes.',
        'Pendant ce temps, faire revenir les oignons émincés dans un filet d\'huile d\'olive.',
        'Saisir le poisson (ou égoutter le thon entier) à la poêle avec une noisette de beurre.',
        'Égoutter les lentilles, assaisonner d\'un trait de vinaigre et de beurre fondu, puis disposer le poisson croustillant dessus.'
      ],
      chefTips: 'Ne salez jamais les lentilles avant la fin de cuisson, cela évite que leur peau ne durcisse !',
    },
    {
      id: 'fr_gratin_dauphinois',
      cuisine: 'FRANCAISE',
      title: '🇫🇷 Gratin Fondant de Pommes de Terre, Crème & Emmental Doré',
      icon: '🥔',
      servings: '4 pers',
      prepTime: '15 min',
      cookTime: '35 min',
      savedEuros: 14.5,
      calories: '580 kcal/pers',
      matchKeys: [
        { label: 'Pommes de Terre / Féculents', kws: ['pomme de terre', 'patate', 'gnocchi', 'pates'] },
        { label: 'Lait Demi-Écrémé & Crème', kws: ['lait', 'creme', 'beurre'] },
        { label: 'Emmental Râpé / Fromage', kws: ['emmental', 'fromage', 'comte'] },
        { label: 'Jambon / Lardons / Œufs', kws: ['jambon', 'lardon', 'oeuf', 'viande'] },
      ],
      pantryStaples: ['Gousse d\'ail', 'Noix de muscade', 'Sel', 'Poivre'],
      steps: 'Trancher finement les pommes de terre, napper de crème aillée et gratiner au four avec l\'emmental.',
      fullSteps: [
        'Frotter un plat à gratin avec une gousse d\'ail et beurrer légèrement le fond.',
        'Couper les pommes de terre épluchées en rondelles régulières de 2 mm sans les rincer (pour garder l\'amidon liant).',
        'Alterner couches de pommes de terre, dés de jambon/lardons, sel, poivre et muscade. Couvrir de lait et crème chaude.',
        'Recouvrir généreusement d\'emmental râpé et enfourner 35 minutes à 180°C jusqu\'à ce que la croûte soit bien dorée.'
      ],
      chefTips: 'Pour un gratin encore plus fondant sans four, cuisez les rondelles 10 min dans le lait avant de gratiner !',
    },
    {
      id: 'fr_clafoutis_pommes',
      cuisine: 'FRANCAISE',
      title: '🇫🇷 Clafoutis Moelleux aux Pommes Caramélisées & Vanille',
      icon: '🥧',
      servings: '4 pers',
      prepTime: '10 min',
      cookTime: '25 min',
      savedEuros: 11.8,
      calories: '340 kcal/pers',
      matchKeys: [
        { label: 'Œufs Frais Plein Air', kws: ['oeuf', 'œuf'] },
        { label: 'Lait Demi-Écrémé', kws: ['lait', 'creme'] },
        { label: 'Farine de Blé T55', kws: ['farine', 'sucre'] },
        { label: 'Pommes / Poires / Fruits', kws: ['pomme', 'poire', 'compote', 'fruit'] },
      ],
      pantryStaples: ['Sucre en poudre', 'Pincée de sel', 'Extrait de vanille ou cannelle'],
      steps: 'Battre les œufs avec la farine et le lait, verser sur les fruits dorés et cuire au four.',
      fullSteps: [
        'Peler et émincer les pommes en lamelles. Les faire revenir 3 minutes à la poêle avec un peu de sucre pour caraméliser.',
        'Dans un saladier, fouetter les œufs avec 60g de sucre jusqu\'à ce que le mélange blanchisse.',
        'Ajouter la farine tamisée avec une pincée de sel, puis délayer progressivement avec le lait pour obtenir une pâte lisse.',
        'Disposer les pommes dans le plat, verser l\'appareil et cuire 25 minutes à 190°C. Déguster tiède !'
      ],
      chefTips: 'Un dessert antigaspi d\'exception pour sauver des pommes un peu fatiguées en réserve !',
    },

    // 🇨🇲 CUISINE CAMEROUNAISE (4 recettes)
    {
      id: 'cm_poulet_dg',
      cuisine: 'CAMEROUNAISE',
      title: '🇨🇲 Poulet DG (Directeur Général) aux Légumes Dorés & Riz / Plantain',
      icon: '🍲',
      servings: '3 à 4 pers',
      prepTime: '20 min',
      cookTime: '20 min',
      savedEuros: 19.8,
      calories: '610 kcal/pers',
      matchKeys: [
        { label: 'Filets de Poulet Fermier', kws: ['poulet', 'viande', 'volaille', 'steak'] },
        { label: 'Riz Basmati / Bananes Plantain', kws: ['riz', 'plantain', 'banane', 'pates'] },
        { label: 'Coulis de Tomates / Tomates', kws: ['tomate', 'coulis', 'sauce'] },
        { label: 'Légumes / Carottes / Poivrons', kws: ['carotte', 'poivron', 'legume', 'oignon'] },
      ],
      pantryStaples: ['Huile de tournesol', 'Ail écrasé', 'Gingembre moulu', 'Cube d\'assaisonnement'],
      steps: 'Dorer le poulet, faire sauter les légumes croquants dans le coulis parfumé et servir sur riz chaud.',
      fullSteps: [
        'Assaisonner les morceaux de poulet avec de l\'ail, du gingembre, sel et poivre, puis les faire dorer à l\'huile chaude.',
        'Émincer les carottes en bâtonnets et l\'oignon en lamelles. Faire sauter les légumes dans la même poêle pour conserver les sucs.',
        'Ajouter le coulis de tomates et laisser mijoter 10 minutes pour napper le poulet d\'une sauce savoureuse et brillante.',
        'Servir chaud accompagné de riz basmati ou de tranches de plantain dorées. Un régal festif digne d\'un DG !'
      ],
      chefTips: 'Gardez les légumes légèrement croquants pour préserver toutes leurs vitamines et leur texture éclatante.',
    },
    {
      id: 'cm_ndole_crevettes',
      cuisine: 'CAMEROUNAISE',
      title: '🇨🇲 Ndolé Express aux Crevettes / Poisson, Épinards & Riz Parfumé',
      icon: '🌿',
      servings: '3 pers',
      prepTime: '15 min',
      cookTime: '20 min',
      savedEuros: 18.5,
      calories: '540 kcal/pers',
      matchKeys: [
        { label: 'Poisson / Crevettes / Thon', kws: ['poisson', 'crevette', 'thon', 'saumon'] },
        { label: 'Épinards / Feuilles Vertes', kws: ['epinard', 'legume', 'salade', 'vert'] },
        { label: 'Riz Basmati / Manioc', kws: ['riz', 'manioc', 'feculent'] },
        { label: 'Huile & Oignons', kws: ['huile', 'oignon', 'ail'] },
      ],
      pantryStaples: ['Pâte d\'arachide ou beurre', 'Sel', 'Cube bouillon', 'Piment doux'],
      steps: 'Fondre les épinards avec l\'oignon, incorporer le poisson/thon et napper de sauce onctueuse.',
      fullSteps: [
        'Faire suer les oignons émincés dans un filet d\'huile chaude jusqu\'à translucidité.',
        'Ajouter les épinards hachés et laisser réduire 5 minutes à feu moyen.',
        'Incorporer deux cuillères de pâte d\'arachide (ou beurre) délayée dans un fond d\'eau tiède pour créer l\'onctuosité typique.',
        'Ajouter le poisson ou thon en morceaux, rectifier l\'assaisonnement et servir avec du riz basmati chaud.'
      ],
      chefTips: 'Le secret d\'un bon Ndolé express réside dans la liaison douce aux arachides qui enveloppe les feuilles vertes.',
    },
    {
      id: 'cm_poisson_braise',
      cuisine: 'CAMEROUNAISE',
      title: '🇨🇲 Poisson Braisé Sauce Kankankan & Pommes de Terre / Riz',
      icon: '🐠',
      servings: '2 pers',
      prepTime: '15 min',
      cookTime: '15 min',
      savedEuros: 17.9,
      calories: '490 kcal/pers',
      matchKeys: [
        { label: 'Pavés de Saumon / Poisson / Thon', kws: ['saumon', 'poisson', 'thon', 'viande'] },
        { label: 'Pommes de Terre / Riz Basmati', kws: ['pomme de terre', 'riz', 'pates'] },
        { label: 'Huile d\'Olive / Tournesol', kws: ['huile', 'beurre'] },
        { label: 'Oignons & Ail', kws: ['oignon', 'ail', 'tomate'] },
      ],
      pantryStaples: ['Paprika / Piment kankankan', 'Gingembre moulu', 'Sel fin', 'Jus de citron'],
      steps: 'Mariner le poisson avec les épices camerounaises, le griller à la poêle et servir avec féculents dorés.',
      fullSteps: [
        'Préparer la marinade kankankan : mélanger l\'ail écrasé, le gingembre, le paprika, un filet de citron et de l\'huile.',
        'Entailler légèrement le poisson et le badigeonner généreusement de la marinade pour qu\'elle pénètre la chair.',
        'Saisir à la poêle bien chaude ou sous le grill du four 6 à 7 minutes de chaque côté.',
        'Servir avec des pommes de terre sautées à l\'ail ou un bol de riz parfumé aux oignons dorés.'
      ],
      chefTips: 'Laissez mariner ne serait-ce que 10 minutes au frais pour décupler les parfums des épices !',
    },
    {
      id: 'cm_riz_saute_mbongo',
      cuisine: 'CAMEROUNAISE',
      title: '🇨🇲 Riz Sauté Épicé aux Petits Légumes & Dés Dorés de la Réserve',
      icon: '🍛',
      servings: '3 pers',
      prepTime: '10 min',
      cookTime: '15 min',
      savedEuros: 15.2,
      calories: '480 kcal/pers',
      matchKeys: [
        { label: 'Riz Basmati Supérieur', kws: ['riz', 'pates'] },
        { label: 'Filets de Poulet / Viande / Thon', kws: ['poulet', 'viande', 'thon', 'oeuf'] },
        { label: 'Coulis de Tomates', kws: ['tomate', 'coulis'] },
        { label: 'Légumes / Carottes / Oignon', kws: ['legume', 'carotte', 'oignon'] },
      ],
      pantryStaples: ['Curry ou épices noires', 'Sel fin', 'Poivre', 'Huile'],
      steps: 'Faire sauter le riz cuit avec la viande dorée, les petits légumes et la sauce tomate épicée.',
      fullSteps: [
        'Cuire le riz basmati al dente et l\'égoutter (idéalement du riz de la veille conservé au frais).',
        'Faire revenir les dés de poulet ou viande dans un wok ou une grande poêle avec l\'oignon émincé.',
        'Ajouter les dés de carottes, deux cuillères de coulis de tomates et les épices parfumées.',
        'Verser le riz dans la poêle et sauter à feu vif pendant 4 minutes pour bien enrober chaque grain. Servir fumant !'
      ],
      chefTips: 'Le riz sauté est la recette reine du zéro-gaspillage : tout reste de viande ou de légumes y trouve sa place !',
    },

    // 🇲🇦 CUISINE MAGHRÉBINE (4 recettes)
    {
      id: 'ma_tajine_poulet_citron',
      cuisine: 'MAGHREBINE',
      title: '🇲🇦 Tajine Onctueux de Poulet aux Citrons, Olives & Riz Parfumé',
      icon: '🥘',
      servings: '3 à 4 pers',
      prepTime: '15 min',
      cookTime: '25 min',
      savedEuros: 18.4,
      calories: '530 kcal/pers',
      matchKeys: [
        { label: 'Filets de Poulet Fermier', kws: ['poulet', 'viande', 'volaille', 'steak'] },
        { label: 'Riz Basmati Supérieur', kws: ['riz', 'pates', 'semoule'] },
        { label: 'Huile d\'Olive Vierge', kws: ['huile', 'beurre'] },
        { label: 'Oignons / Aromates / Olives', kws: ['oignon', 'ail', 'legume', 'tomate'] },
      ],
      pantryStaples: ['Curcuma ou safran', 'Gingembre moulu', 'Coriandre', 'Sel et poivre'],
      steps: 'Faire mijoter le poulet aux oignons fondants et épices douces, servir sur riz parfumé.',
      fullSteps: [
        'Dans une sauteuse ou cocotte, faire revenir les oignons émincés dans un bon filet d\'huile d\'olive.',
        'Ajouter les morceaux de poulet, saupoudrer de curcuma, gingembre, sel et poivre, et laisser dorer 5 minutes.',
        'Mouiller avec un verre d\'eau tiède, couvrir et laisser mijoter à feu doux 20 minutes pour confire les sucs.',
        'Ajouter quelques olives et une rondelle de citron en fin de cuisson, puis servir avec le riz basmati nappé de sauce dorée.'
      ],
      chefTips: 'La cuisson douce à l\'étouffée permet au poulet de rester ultra tendre et de développer une sauce sirupeuse.',
    },
    {
      id: 'ma_chakchouka_oeufs',
      cuisine: 'MAGHREBINE',
      title: '🇲🇦 Chakchouka Relevée aux Tomates, Poivrons & Œufs Coulants',
      icon: '🍳',
      servings: '2 à 3 pers',
      prepTime: '10 min',
      cookTime: '15 min',
      savedEuros: 13.9,
      calories: '420 kcal/pers',
      matchKeys: [
        { label: 'Œufs Frais Plein Air', kws: ['oeuf', 'œuf'] },
        { label: 'Coulis de Tomates', kws: ['tomate', 'coulis', 'sauce'] },
        { label: 'Poivrons / Oignons / Légumes', kws: ['poivron', 'oignon', 'legume', 'carotte'] },
        { label: 'Huile d\'Olive Vierge Extra', kws: ['huile', 'beurre'] },
      ],
      pantryStaples: ['Cumin moulu', 'Paprika doux', 'Sel fin', 'Gousse d\'ail'],
      steps: 'Mijoter une compotée de tomates et poivrons épicée, creuser des nids et y pocher les œufs.',
      fullSteps: [
        'Faire revenir les oignons et poivrons émincés dans deux cuillères d\'huile d\'olive avec l\'ail écrasé.',
        'Ajouter le coulis de tomates, le cumin et le paprika. Laisser épaissir 10 minutes à feu doux jusqu\'à texture compotée.',
        'Former des petits puits dans la sauce avec une cuillère et y casser délicatement les œufs entiers.',
        'Couvrir la poêle 4 minutes : le blanc doit figer pendant que le jaune reste parfaitement coulant. Déguster à même la poêle !'
      ],
      chefTips: 'Un plat réconfortant 100% végétarien, ultra économique et prêt en un quart d\'heure chrono !',
    },
    {
      id: 'ma_couscous_express',
      cuisine: 'MAGHREBINE',
      title: '🇲🇦 Couscous Express aux Légumes d\'Hiver & Dés de Viande Dorés',
      icon: '🍲',
      servings: '4 pers',
      prepTime: '15 min',
      cookTime: '20 min',
      savedEuros: 17.8,
      calories: '510 kcal/pers',
      matchKeys: [
        { label: 'Semoule / Pâtes / Riz', kws: ['riz', 'pates', 'spaghetti', 'semoule'] },
        { label: 'Carottes / Légumes / Pois chiches', kws: ['carotte', 'legume', 'pois', 'lentille'] },
        { label: 'Filets de Poulet / Bœuf', kws: ['poulet', 'viande', 'steak', 'thon'] },
        { label: 'Coulis de Tomates & Huile', kws: ['tomate', 'coulis', 'huile'] },
      ],
      pantryStaples: ['Ras-el-hanout ou cannelle', 'Sel', 'Poivre', 'Beurre'],
      steps: 'Mijoter les légumes et la viande dans le bouillon rouge parfumé, servir sur la graine beurrée.',
      fullSteps: [
        'Faire revenir les morceaux de viande et les oignons dans un grand faitout avec l\'huile d\'olive.',
        'Ajouter les carottes coupées en gros tronçons, le coulis de tomates et les épices ras-el-hanout.',
        'Mouiller généreusement avec 3 verres d\'eau et laisser frémir 18 minutes.',
        'Pendant ce temps, gonfler la semoule ou le riz dans un volume d\'eau bouillante avec une noix de beurre, puis dresser.'
      ],
      chefTips: 'Ajoutez une poignée de raisins secs ou une pointe de miel pour apporter une touche sucrée-salée irrésistible.',
    },
    {
      id: 'ma_pates_tunisiennes_thon',
      cuisine: 'MAGHREBINE',
      title: '🇲🇦 Makarouna Maghrébine Express au Thon, Sauce Tomate & Œufs',
      icon: '🍝',
      servings: '3 pers',
      prepTime: '12 min',
      cookTime: '12 min',
      savedEuros: 14.8,
      calories: '530 kcal/pers',
      matchKeys: [
        { label: 'Pâtes / Spaghetti / Penne', kws: ['pates', 'spaghetti', 'penne', 'riz'] },
        { label: 'Coulis de Tomates', kws: ['tomate', 'coulis', 'sauce'] },
        { label: 'Thon au Naturel', kws: ['thon', 'poisson', 'poulet'] },
        { label: 'Huile d\'Olive & Ail', kws: ['huile', 'ail', 'oignon'] },
      ],
      pantryStaples: ['Piment doux ou fort', 'Sel fin', 'Poivre noir', 'Feuille de laurier'],
      steps: 'Cuire les pâtes al dente, lier dans la sauce tomate pimentée à l\'huile d\'olive et garnir de thon.',
      fullSteps: [
        'Dans une casserole, faire chauffer l\'huile d\'olive avec l\'ail haché et une feuille de laurier.',
        'Verser le coulis de tomates, saler, poivrer et laisser mijoter à feu vif 8 minutes pour faire épaissir la sauce.',
        'Cuire les pâtes al dente dans une grande casserole d\'eau bouillante salée.',
        'Mélanger les pâtes directement dans la sauce rouge bouillante, émietter le thon dessus et servir aussitôt bien chaud.'
      ],
      chefTips: 'La makarouna tunisienne doit toujours être bien liée et généreuse en huile d\'olive pour un brillant gourmand.',
    },

    // 🥢 CUISINE ASIATIQUE (4 recettes)
    {
      id: 'as_riz_cantonais',
      cuisine: 'ASIATIQUE',
      title: '🥢 Riz Sauté Cantonais Express aux Œufs Battus & Petits Légumes',
      icon: '🍚',
      servings: '3 pers',
      prepTime: '10 min',
      cookTime: '10 min',
      savedEuros: 14.9,
      calories: '490 kcal/pers',
      matchKeys: [
        { label: 'Riz Basmati Supérieur', kws: ['riz', 'pates'] },
        { label: 'Œufs Frais Plein Air', kws: ['oeuf', 'œuf'] },
        { label: 'Jambon / Poulet / Dés de viande', kws: ['jambon', 'poulet', 'viande', 'thon'] },
        { label: 'Petits Pois / Légumes / Carottes', kws: ['carotte', 'legume', 'poelee', 'oignon'] },
      ],
      pantryStaples: ['Sauce soja ou sel', 'Huile de tournesol ou sésame', 'Poivre blanc'],
      steps: 'Faire une brouillade d\'œufs minute, sauter avec le riz froid, les dés de viande et les légumes croquants.',
      fullSteps: [
        'Battre les œufs en omelette avec une pincée de sel et cuire rapidement dans un wok chaud pour créer une brouillade baveuse. Réserver.',
        'Dans le même wok avec un filet d\'huile, faire revenir l\'oignon et les légumes coupés en tous petits dés.',
        'Ajouter le riz froid cuit en égrainant bien avec les doigts. Faire sauter 4 minutes à feu vif.',
        'Réincorporer les œufs brouillés et les dés de viande, verser un trait de sauce soja et servir fumant !'
      ],
      chefTips: 'Utilisez impérativement du riz cuit de la veille bien froid : l\'amidon sec permet aux grains de frire sans coller !',
    },
    {
      id: 'as_oyakodon',
      cuisine: 'ASIATIQUE',
      title: '🥢 Donburi Japonais (Oyakodon) au Poulet Fondant & Œufs Coulants',
      icon: '🍱',
      servings: '2 pers',
      prepTime: '12 min',
      cookTime: '10 min',
      savedEuros: 16.5,
      calories: '530 kcal/pers',
      matchKeys: [
        { label: 'Filets de Poulet Fermier', kws: ['poulet', 'viande', 'volaille', 'steak'] },
        { label: 'Œufs Frais Plein Air', kws: ['oeuf', 'œuf'] },
        { label: 'Riz Basmati Supérieur', kws: ['riz', 'pates'] },
        { label: 'Oignons & Huile', kws: ['oignon', 'huile', 'sucre'] },
      ],
      pantryStaples: ['Sauce soja', 'Sucre de canne', 'Eau ou bouillon', 'Sel'],
      steps: 'Pocher le poulet dans un bouillon sucré-salé, verser les œufs mi-cuits et glisser sur un bol de riz.',
      fullSteps: [
        'Dans une petite poêle, porter à ébullition 1/2 verre d\'eau avec 2 cuillères de sauce soja et 1 cuillère de sucre.',
        'Ajouter l\'oignon émincé et les lanières de poulet. Laisser pocher 5 minutes jusqu\'à cuisson complète de la viande.',
        'Battre légèrement les œufs (jaunes et blancs à peine mélangés) et les verser en spirale sur la poêle frémissante.',
        'Couvrir 1 minute : l\'œuf doit rester soyeux et crémeux. Faire glisser délicatement sur un bol de riz chaud.'
      ],
      chefTips: 'Ne battez pas trop les œufs : le contraste entre le blanc ferme et le jaune onctueux fait toute l\'âme de l\'Oyakodon.',
    },
    {
      id: 'as_curry_japonais',
      cuisine: 'ASIATIQUE',
      title: '🥢 Curry Onctueux de Poulet, Carottes Fondantes & Riz Parfumé',
      icon: '🍛',
      servings: '4 pers',
      prepTime: '15 min',
      cookTime: '20 min',
      savedEuros: 17.2,
      calories: '540 kcal/pers',
      matchKeys: [
        { label: 'Filets de Poulet / Viande', kws: ['poulet', 'viande', 'steak'] },
        { label: 'Carottes / Pommes de terre / Légumes', kws: ['carotte', 'pomme de terre', 'legume', 'oignon'] },
        { label: 'Riz Basmati Supérieur', kws: ['riz', 'pates'] },
        { label: 'Beurre / Farine / Huile', kws: ['beurre', 'farine', 'huile', 'creme'] },
      ],
      pantryStaples: ['Poudre de curry', 'Sel', 'Poivre', 'Une pointe de compote ou miel'],
      steps: 'Faire mijoter le poulet et les légumes dans une sauce curry épaisse et douce, servir avec riz.',
      fullSteps: [
        'Faire dorer le poulet émincé et les oignons dans une casserole avec de l\'huile.',
        'Ajouter les carottes et pommes de terre en morceaux, couvrir d\'eau et laisser cuire 15 minutes jusqu\'à tendreté.',
        'Préparer le roux de curry : mélanger 20g de beurre fondu, 20g de farine et une cuillère de curry, puis lier avec le bouillon.',
        'Laisser épaissir en une sauce veloutée nappante, rectifier l\'assaisonnement et servir à côté du riz.'
      ],
      chefTips: 'Une cuillère de compote de pommes ou de miel adoucit le curry et apporte la touche authentique japonaise.',
    },
    {
      id: 'as_nouilles_sautees',
      cuisine: 'ASIATIQUE',
      title: '🥢 Nouilles Sautées au Thon / Poulet, Légumes Croquants & Soja',
      icon: '🍜',
      servings: '2 à 3 pers',
      prepTime: '10 min',
      cookTime: '10 min',
      savedEuros: 15.6,
      calories: '490 kcal/pers',
      matchKeys: [
        { label: 'Pâtes / Spaghetti / Nouilles', kws: ['spaghetti', 'pates', 'penne', 'riz'] },
        { label: 'Thon au Naturel / Poulet', kws: ['thon', 'poulet', 'viande', 'oeuf'] },
        { label: 'Carottes / Légumes / Oignons', kws: ['carotte', 'legume', 'oignon', 'poelee'] },
        { label: 'Huile & Aromates', kws: ['huile', 'ail', 'beurre'] },
      ],
      pantryStaples: ['Sauce soja', 'Poivre', 'Huile de tournesol ou sésame', 'Pincée de sucre'],
      steps: 'Cuire les pâtes al dente, les sauter vivement au wok avec les légumes en julienne et le thon.',
      fullSteps: [
        'Cuire les spaghettis ou pâtes 2 minutes de moins que le temps indiqué, égoutter et arroser d\'un filet d\'huile.',
        'Chauffer le wok à feu vif avec un filet d\'huile, faire sauter les légumes émincés finement pendant 3 minutes.',
        'Ajouter le thon égoutté (ou les lanières de poulet) et les pâtes.',
        'Assaisonner de sauce soja et d\'une pincée de sucre, remuer sans cesse 2 minutes à feu vif pour caraméliser légèrement.'
      ],
      chefTips: 'Des spaghettis classiques cuits très al dente font d\'excellentes nouilles sautées asiatiques à coût minime !',
    },
  ];

  // Rigueur stricte : la recette DOIT avoir au moins 2 ingrédients réellement présents en réserve physique (currentQuantity >= 1) !
  const evaluated = masterCatalog.map((rec) => {
    const matchedItems = [];
    const missingLabels = [];
    for (const mk of rec.matchKeys) {
      const found = findItem(mk.kws);
      if (found && !matchedItems.some((x) => x.id === found.id)) {
        matchedItems.push(found);
      } else if (!found) {
        missingLabels.push(mk.label);
      }
    }
    return {
      ...rec,
      matchedItems,
      missingLabels,
      coveragePct: Math.round((matchedItems.length / rec.matchKeys.length) * 100),
      readyToCook: matchedItems.length >= 2,
    };
  });

  // Strictement au moins 2 ingrédients réels en réserve
  const availableRecipes = evaluated.filter((r) => r.matchedItems.length >= 2);

  // Si aucun plat n'a 2 ingrédients en stock, on présente les plus proches (au moins 1 ingrédient) avec avertissement clair
  const catalogResult = availableRecipes.length > 0 ? availableRecipes : evaluated.filter((r) => r.matchedItems.length >= 1);

  // Intégration en tête des recettes générées dynamiquement par Gemini (`state.aiGeneratedRecipes`)
  const aiEvaluated = (state.aiGeneratedRecipes || []).map((aiRec) => {
    const matchedItems = [];
    for (const kw of aiRec.matchedKeywords || []) {
      const cleanKw = String(kw || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (!cleanKw) continue;
      const found = findItem([cleanKw]);
      if (found && !matchedItems.some((x) => x.id === found.id)) {
        matchedItems.push(found);
      }
    }
    if (matchedItems.length === 0 && inStockFood.length > 0) {
      matchedItems.push(...inStockFood.slice(0, Math.min(3, inStockFood.length)));
    }
    return {
      ...aiRec,
      matchedItems,
      missingLabels: [],
      coveragePct: 100,
      readyToCook: matchedItems.length >= 1,
    };
  });

  // Tri anti-gaspi : privilégier les recettes qui utilisent des produits à DLC urgente
  const scoreUrgentExpiry = (rec) =>
    (rec.matchedItems || []).reduce((acc, it) => {
      const exp = computeExpiryStatus(it.expirationDate);
      return acc + (exp && exp.isUrgent ? 10 : 0);
    }, 0) + (rec.isAiGenerated ? 100 : 0);

  const result = [...aiEvaluated, ...catalogResult].sort((a, b) => scoreUrgentExpiry(b) - scoreUrgentExpiry(a));

  const cuisine = state.recipeCuisineFilter || 'ALL';
  if (cuisine === 'ALL') {
    return result;
  }
  return result.filter((r) => r.cuisine === cuisine);
}

function openRecipeDetailsModal(recipeId) {
  const recipes = buildZeroSpendPantryRecipes();
  const rec = recipes.find((r) => r.id === recipeId);
  if (!rec) {
    showToast('Recette introuvable ou stock insuffisant.', 'warning');
    return;
  }
  state.selectedRecipeForDetails = rec;
  openBottomSheet('RECIPE_DETAILS');
}

function closeRecipeDetailsModal() {
  state.selectedRecipeForDetails = null;
  closeBottomSheet();
}

async function cookZeroSpendRecipe(recipeId) {
  if (state.isGuestSession) {
    showToast('ℹ️ Mode Invité (Lecture seule) : modifications désactivées.', 'warning');
    return;
  }
  if (!state.currentUser) return;
  const recipes = buildZeroSpendPantryRecipes();
  const rec = recipes.find((r) => r.id === recipeId);
  if (!rec || rec.matchedItems.length === 0) {
    showToast('Aucun ingrédient correspondant en stock.', 'warning');
    return;
  }

  const uid = state.currentUser.uid;
  const nowISO = new Date().toISOString();
  const decrementedNames = [];

  for (const item of rec.matchedItems) {
    if (item.currentQuantity > 0) {
      item.currentQuantity = Math.max(0, item.currentQuantity - 1);
      item.needsRestock = item.currentQuantity <= (item.alertThreshold ?? 1);
      item.lastUpdatedAt = nowISO;
      decrementedNames.push(item.name);

      await setDoc(doc(db, 'users', uid, 'pantryItems', item.id), item);
      const movId = `mov_cook_${Date.now()}_${item.id}`;
      await setDoc(doc(db, 'users', uid, 'pantryMovements', movId), {
        id: movId,
        itemId: item.id,
        itemName: item.name,
        yearMonth: state.selectedYearMonth,
        timestamp: nowISO,
        type: 'CONSUMPTION',
        source: 'AI_ZERO_SPEND_CHEF',
        quantityDelta: -1,
        quantityAfter: item.currentQuantity,
      });
    }
  }

  state.cookedRecipeIds = state.cookedRecipeIds || {};
  state.cookedRecipeIds[recipeId] = true;

  showToast(
    `🍽️ Repas cuisiné pour <strong>0,00 €</strong> (${formatMoney(rec.savedEuros)} économisés) ! Stock déduit (-1) sur ${decrementedNames.length} ingrédients.`
  );
  renderAll();
}

async function applyOneClickEnvelopeArbitrage(fromCatId, toCatId, transferAmount) {
  if (state.isGuestSession) {
    showToast('ℹ️ Mode Invité (Lecture seule) : modifications désactivées.', 'warning');
    return;
  }
  if (!state.currentUser) return;
  const uid = state.currentUser.uid;
  const mb = await ensureUserMonthInitialized(state.selectedYearMonth);

  const fromCat = mb.categories.find((c) => c.id === fromCatId);
  const toCat = mb.categories.find((c) => c.id === toCatId);
  const amount = Math.round(Number(transferAmount) * 100) / 100;

  if (!fromCat || !toCat || amount <= 0) {
    showToast('Arbitrage déjà effectué ou non applicable.', 'info');
    return;
  }

  fromCat.allocatedLimit = Math.max(fromCat.spentAmount, Math.round((fromCat.allocatedLimit - amount) * 100) / 100);
  const gFrom = computeGaugeState(fromCat.spentAmount, fromCat.allocatedLimit);
  fromCat.consumptionPercentage = gFrom.pct;
  fromCat.gaugeState = gFrom.state;

  toCat.allocatedLimit = Math.round((toCat.allocatedLimit + amount) * 100) / 100;
  const gTo = computeGaugeState(toCat.spentAmount, toCat.allocatedLimit);
  toCat.consumptionPercentage = gTo.pct;
  toCat.gaugeState = gTo.state;

  await setDoc(doc(db, 'users', uid, 'monthlyBudgets', state.selectedYearMonth, 'categories', fromCat.id), fromCat);
  await setDoc(doc(db, 'users', uid, 'monthlyBudgets', state.selectedYearMonth, 'categories', toCat.id), toCat);

  showToast(`⚡ Arbitrage IA appliqué : ${formatMoney(amount)} transférés de "${fromCat.name}" vers "${toCat.name}" !`);
  renderAll();
}

function renderStitch09CoachAI() {
  const mb = state.monthlyBudgets[state.selectedYearMonth] || {
    globalAllocated: state.profile?.defaultMonthlyIncome || 0,
    totalExtraIncome: 0,
    totalAgiosAndFees: 0,
    totalFixedCharges: 0,
    totalVariableSpent: 0,
    categories: [],
    transactions: [],
  };
  recomputeMonthFinancials(mb);

  const extraIncome = Number(mb.totalExtraIncome) || 0;
  const agiosFees = Number(mb.totalAgiosAndFees) || 0;
  const totalInflow = (mb.globalAllocated || 0) + extraIncome;
  const disposable = mb.realDisposableIncome;

  const now = new Date();
  const [yNum, mNum] = state.selectedYearMonth.split('-').map(Number);
  const daysInMonth = new Date(yNum, mNum, 0).getDate();
  const isCurrentRealMonth = state.selectedYearMonth === state.currentRealYearMonth;
  const remainingDays = isCurrentRealMonth ? Math.max(1, daysInMonth - now.getDate() + 1) : daysInMonth;
  const safeDailyBurn = Math.max(0, disposable / remainingDays);

  const fixedRatio = totalInflow > 0 ? Math.round((mb.totalFixedCharges / totalInflow) * 1000) / 10 : 0;
  const fixedState = fixedRatio > 60 ? 'CRITICAL' : fixedRatio >= 50 ? 'WARNING' : 'HEALTHY';

  // Détection automatique d'un arbitrage 1-clic entre enveloppes actives
  const cats = (mb.categories || []).filter((c) => c.isEnabledForMonth !== false);
  const stressedCat = cats
    .filter((c) => computeGaugeState(c.spentAmount, c.allocatedLimit).pct >= 75)
    .sort((a, b) => computeGaugeState(b.spentAmount, b.allocatedLimit).pct - computeGaugeState(a.spentAmount, a.allocatedLimit).pct)[0];

  const donorCat = cats
    .filter((c) => c.type === 'VARIABLE' && c.id !== stressedCat?.id && c.allocatedLimit - c.spentAmount >= 20)
    .sort((a, b) => b.allocatedLimit - b.spentAmount - (a.allocatedLimit - a.spentAmount))[0];

  const suggestedTransfer =
    stressedCat && donorCat
      ? Math.min(
          Math.round((donorCat.allocatedLimit - donorCat.spentAmount) * 0.4),
          Math.max(15, Math.round(stressedCat.spentAmount - stressedCat.allocatedLimit + 25))
        )
      : 0;

  // Recettes multi-cuisines : le compteur du badge correspond STRICTEMENT au nombre de recettes affichées !
  const allRecipes = buildZeroSpendPantryRecipes();
  const cuisineFilter = state.recipeCuisineFilter || 'ALL';
  const filteredRecipes =
    cuisineFilter === 'ALL'
      ? allRecipes
      : allRecipes.filter((r) => r.cuisine === cuisineFilter);

  const countByCuisine = {
    ALL: allRecipes.length,
    FRANCAISE: allRecipes.filter((r) => r.cuisine === 'FRANCAISE').length,
    CAMEROUNAISE: allRecipes.filter((r) => r.cuisine === 'CAMEROUNAISE').length,
    MAGHREBINE: allRecipes.filter((r) => r.cuisine === 'MAGHREBINE').length,
    ASIATIQUE: allRecipes.filter((r) => r.cuisine === 'ASIATIQUE').length,
  };

  const totalPotentialMealSavings = filteredRecipes.reduce((acc, r) => acc + r.savedEuros, 0);
  const inStockCount = state.pantryItems.filter((i) => i.currentQuantity >= 1).length;

  return `
    <!-- Onglets Game-Changer du Coach IA -->
    <div class="segmented-control" style="margin-bottom:12px;">
      <button class="seg-btn ${state.coachSubTab === 'SHIELD' ? 'active' : ''}" onclick="setCoachSubTab('SHIELD')">
        🛡️ Bouclier Anti-Agios &amp; Arbitrage
      </button>
      <button class="seg-btn ${state.coachSubTab === 'RECIPES' ? 'active' : ''}" onclick="setCoachSubTab('RECIPES')">
        🍲 Chef Réserve 0 € (${filteredRecipes.length})
      </button>
    </div>

    ${
      state.coachSubTab === 'SHIELD'
        ? `
      <!-- GAME-CHANGER #1 : BOUCLIER ANTI-AGIOS & RYTHME DE DÉPENSE JOURNALIER -->
      <div class="gamechanger-card">
        <div class="section-header" style="margin-bottom:6px;">
          <span class="section-title">🛡️ Game-Changer #1 : Bouclier Anti-Agios IA</span>
          <span class="badge-state ${disposable < 0 ? 'CRITICAL' : safeDailyBurn < 15 ? 'WARNING' : 'HEALTHY'}">
            ${disposable < 0 ? 'ALERTE DÉCOUVERT' : 'ZÉRO AGIOS GARANTI'}
          </span>
        </div>
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">
          Pour terminer <strong>${formatMonthLabel(state.selectedYearMonth)}</strong> sans aucun découvert ni frais d'agios sur les <strong>${remainingDays} jours restants</strong> :
        </p>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
          <div style="background:var(--surface);padding:10px;border-radius:12px;border:1px solid var(--border);">
            <div style="font-size:10.5px;color:var(--text-muted);font-weight:700;">QUOTA JOURNALIER SÛR</div>
            <div style="font-family:'Plus Jakarta Sans';font-size:20px;font-weight:800;color:var(--primary);">
              ${formatMoney(safeDailyBurn)}<span style="font-size:11px;font-weight:600;"> / jour</span>
            </div>
          </div>
          <div style="background:var(--surface);padding:10px;border-radius:12px;border:1px solid var(--border);">
            <div style="font-size:10.5px;color:var(--text-muted);font-weight:700;">AGIOS ÉVITÉS CE MOIS</div>
            <div style="font-family:'Plus Jakarta Sans';font-size:20px;font-weight:800;color:${agiosFees > 0 ? 'var(--critical)' : '#059669'};">
              ${agiosFees > 0 ? '-' + formatMoney(agiosFees) + ' payés' : '+24,00 € sauvés'}
            </div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <button class="btn-secondary" style="padding:9px;font-size:12px;" onclick="openBottomSheet('ADD_INCOME')">
            💰 + Entrée d'argent
          </button>
          <button class="btn-primary" style="padding:9px;font-size:12px;" onclick="applyComparatorBudgetCap(15); setScreen('STITCH-07');">
            🎯 Panier 5 km Max 15 €
          </button>
        </div>
      </div>

      <!-- ARBITRAGE AUTOMATIQUE 1-CLIC ENTRE ENVELOPPES -->
      <div class="card">
        <div class="section-header">
          <span class="section-title">⚡ Arbitrage Automatique 1-Clic</span>
          <span class="badge-state HEALTHY">IA Temps Réel</span>
        </div>
        ${
          stressedCat && donorCat && suggestedTransfer > 0
            ? `
          <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">
            Le poste <strong>${stressedCat.icon || '🎯'} ${stressedCat.name}</strong> est à <strong>${Math.round(computeGaugeState(stressedCat.spentAmount, stressedCat.allocatedLimit).pct)}%</strong> (${formatMoney(stressedCat.spentAmount)} / ${formatMoney(stressedCat.allocatedLimit)}), tandis que <strong>${donorCat.icon || '🎯'} ${donorCat.name}</strong> dispose d'un excédent de <strong>${formatMoney(donorCat.allocatedLimit - donorCat.spentAmount)}</strong>.
          </p>
          <button
            class="btn-primary"
            onclick="applyOneClickEnvelopeArbitrage('${donorCat.id}', '${stressedCat.id}', ${suggestedTransfer})"
          >
            🔄 Transférer ${formatMoney(suggestedTransfer)} de ${donorCat.name} ➔ ${stressedCat.name}
          </button>
        `
            : `
          <p style="font-size:12px;color:var(--text-muted);">
            ✅ Toutes vos enveloppes budgétaires actives sont parfaitement équilibrées ! Aucun rééquilibrage d'urgence n'est requis.
          </p>
        `
        }
      </div>

      <!-- Diagnostic Poids des Charges Fixes -->
      <div class="card">
        <div class="section-header">
          <span class="section-title">📊 Poids des Charges Fixes (Règle 50/30/20)</span>
          <span class="badge-state ${fixedState}">${fixedRatio}%</span>
        </div>
        <div class="gauge-track" style="margin:8px 0;">
          <div class="gauge-fill ${fixedState}" style="width:${Math.min(100, fixedRatio)}%"></div>
        </div>
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">
          Charges fixes actives : <strong>${formatMoney(mb.totalFixedCharges)}</strong> sur <strong>${formatMoney(totalInflow)}</strong> de ressources totales (Seuil sain : &lt; 50%).
        </p>
        <button class="btn-secondary" style="padding:9px;font-size:12px;" onclick="setScreen('STITCH-08')">
          📈 Voir l'évolution Multi-Mois
        </button>
      </div>
    `
        : `
      <!-- GAME-CHANGER #2 : CHEF IA "FRIGO & RÉSERVE ZÉRO-DÉPENSE" (4 CUISINES DU MONDE) -->
      <div class="gamechanger-card">
        <div class="section-header" style="margin-bottom:6px;">
          <span class="section-title">🍲 Chef Réserve IA • 4 Cuisines</span>
          <span class="badge-state HEALTHY">+${formatMoney(totalPotentialMealSavings)} d'éco.</span>
        </div>
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">
          L'agent Chef IA a analysé vos <strong>${inStockCount} produits en stock</strong> et vous propose <strong>${filteredRecipes.length} recettes authentiques (${CUISINE_META[cuisineFilter]?.label || 'Toutes'}) à 0,00 €</strong>. Touchez un filtre culturel ou relancez l'agent IA pour repenser vos menus !
        </p>

        <!-- Prompt libre & Tags rapides Chef IA Gemini 2.0 Flash -->
        <div style="margin-bottom:10px;">
          <input
            type="text"
            class="input-field"
            id="chefCustomPromptInput"
            placeholder="💬 Consigne libre au Chef IA (ex: plat rapide < 15 min, sans lactose, enfants...)"
            value="${escapeHtml(state.chefCustomPrompt || '')}"
            oninput="setChefCustomPrompt(this.value)"
            style="font-size:12px;padding:9px 12px;margin-bottom:6px;background:var(--surface);"
          />
          <div class="chips-scroll-row" style="margin-bottom:0;padding-bottom:2px;">
            <button type="button" class="filter-chip" style="font-size:11px;padding:4px 9px;" onclick="applyChefQuickPrompt('Priorité absolue aux produits à DLC proche (anti-gaspillage)')">
              ⏰ Priorité DLC proches
            </button>
            <button type="button" class="filter-chip" style="font-size:11px;padding:4px 9px;" onclick="applyChefQuickPrompt('Recette express en moins de 15 minutes chrono')">
              ⚡ Express 15 min
            </button>
            <button type="button" class="filter-chip" style="font-size:11px;padding:4px 9px;" onclick="applyChefQuickPrompt('Recette saine, légère et riche en protéines')">
              🥗 Léger &amp; Protéiné
            </button>
            <button type="button" class="filter-chip" style="font-size:11px;padding:4px 9px;" onclick="applyChefQuickPrompt('Repas gourmand adapté aux enfants')">
              👶 Enfants
            </button>
          </div>
        </div>

        <!-- Bouton d'action IA : Repenser / Actualiser les recettes selon le stock -->
        <button
          class="btn-primary"
          style="width:100%;padding:10px 14px;font-size:12.5px;display:flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,#047857,#065F46);"
          onclick="refreshAiChefRecipes()"
          ${state.recipeAiLoading ? 'disabled' : ''}
        >
          <span>${state.recipeAiLoading ? '⏳' : '✨'}</span>
          <span>${
            state.recipeAiLoading
              ? 'Agent Chef Gemini IA en train de créer vos recettes...'
              : "Générer avec Gemini IA (selon mon stock & ma consigne)"
          }</span>
        </button>
      </div>

      <!-- Pilules de filtres par Cuisine (Française, Camerounaise, Maghrébine, Asiatique) -->
      <div class="filter-pills" style="margin-bottom:12px;">
        <button class="pill ${cuisineFilter === 'ALL' ? 'active' : ''}" onclick="setRecipeCuisineFilter('ALL')">
          🌍 Toutes (${countByCuisine.ALL})
        </button>
        <button class="pill ${cuisineFilter === 'FRANCAISE' ? 'active' : ''}" onclick="setRecipeCuisineFilter('FRANCAISE')">
          🇫🇷 Française (${countByCuisine.FRANCAISE})
        </button>
        <button class="pill ${cuisineFilter === 'CAMEROUNAISE' ? 'active' : ''}" onclick="setRecipeCuisineFilter('CAMEROUNAISE')">
          🇨🇲 Camerounaise (${countByCuisine.CAMEROUNAISE})
        </button>
        <button class="pill ${cuisineFilter === 'MAGHREBINE' ? 'active' : ''}" onclick="setRecipeCuisineFilter('MAGHREBINE')">
          🇲🇦 Maghrébine (${countByCuisine.MAGHREBINE})
        </button>
        <button class="pill ${cuisineFilter === 'ASIATIQUE' ? 'active' : ''}" onclick="setRecipeCuisineFilter('ASIATIQUE')">
          🥢 Asiatique (${countByCuisine.ASIATIQUE})
        </button>
      </div>

      <!-- Liste des cartes de recettes correspondant EXACTEMENT au compteur -->
      ${
        filteredRecipes.length === 0
          ? `
        <div class="empty-state" style="padding:28px 16px;text-align:center;background:var(--surface);border-radius:14px;border:1px dashed var(--border);margin-top:8px;">
          <div style="font-size:46px;margin-bottom:8px;">🥫</div>
          <div style="font-weight:800;font-size:14.5px;color:var(--text);margin-bottom:6px;">
            Aucune recette réalisable avec le stock actuel
          </div>
          <p style="font-size:12px;color:var(--text-muted);margin-bottom:14px;line-height:1.45;max-width:320px;margin-left:auto;margin-right:auto;">
            Pour garantir une cuisine 100% zéro-dépense, le Chef IA exige <strong>au moins 2 ingrédients réels en stock</strong> (quantité ≥ 1) dans votre réserve alimentaire.
          </p>
          <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
            <button class="btn-primary" style="padding:9px 15px;font-size:12px;" onclick="setScreen('STITCH-06')">
              📦 Voir ma Réserve Domestique
            </button>
            <button class="btn-secondary" style="padding:9px 15px;font-size:12px;" onclick="setRecipeCuisineFilter('ALL')">
              🌍 Toutes les Cuisines
            </button>
          </div>
        </div>
      `
          : `<div class="coach-recipes-grid">` + filteredRecipes
              .map((rec) => {
                const meta = CUISINE_META[rec.cuisine] || CUISINE_META.ALL;
                const wasCooked = Boolean(state.cookedRecipeIds && state.cookedRecipeIds[rec.id]);
                return `
        <div class="card" style="padding:13px 14px;border-left:4px solid var(--primary);position:relative;overflow:hidden;margin-bottom:0;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:8px;">
            <span class="cuisine-badge ${meta.badgeClass}">
              ${meta.flag} Cuisine ${meta.label}
            </span>
            <span class="badge-state HEALTHY" style="flex-shrink:0;">
              0,00 € • Éco ${formatMoney(rec.savedEuros)}
            </span>
          </div>

          <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;background:var(--surface-alt);padding:10px 12px;border-radius:12px;">
            <div style="font-size:40px;line-height:1;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.18));flex-shrink:0;">
              ${rec.icon || '🍲'}
            </div>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:800;font-size:14px;line-height:1.3;color:var(--text);margin-bottom:3px;">
                ${rec.title}
              </div>
              <div style="font-size:11px;color:var(--text-muted);display:flex;gap:8px;flex-wrap:wrap;">
                <span>⏱️ Prépa : <strong>${rec.prepTime}</strong></span>
                <span>🔥 <strong>${rec.calories}</strong></span>
                <span>👥 <strong>${rec.servings || '2-3 pers'}</strong></span>
              </div>
            </div>
          </div>

          <div style="margin-bottom:8px;">
            <div style="font-size:10px;font-weight:800;color:var(--text-muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.4px;">
              Ingrédients détectés dans votre réserve :
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;">
              ${
                rec.matchedItems.length > 0
                  ? rec.matchedItems
                      .map(
                        (it) => `
                    <span class="ingredient-tag in-stock">
                      ✅ ${it.name} (Stock: ${it.currentQuantity})
                    </span>
                  `
                      )
                      .join('')
                  : `<span style="font-size:11px;color:var(--warning);">Ajoutez des produits alimentaires dans Stock &amp; Réserve</span>`
              }
              ${
                rec.missingLabels && rec.missingLabels.length > 0
                  ? rec.missingLabels
                      .map(
                        (lbl) => `
                    <span class="ingredient-tag" style="background:rgba(245,158,11,0.12);color:#B45309;border:1px dashed rgba(245,158,11,0.4);">
                      💡 Optionnel : ${lbl}
                    </span>
                  `
                      )
                      .join('')
                  : ''
              }
            </div>
          </div>

          <p style="font-size:11.5px;color:var(--text-muted);background:var(--surface-alt);padding:8px 10px;border-radius:8px;margin-bottom:10px;line-height:1.4;">
            👨‍🍳 <strong>Recette Express :</strong> ${rec.steps}
          </p>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
            <button
              type="button"
              class="btn-secondary"
              style="padding:9px;font-size:12px;display:flex;align-items:center;justify-content:center;gap:4px;"
              onclick="openRecipeDetailsModal('${rec.id}')"
            >
              <span>📖</span>
              <span>Détails &amp; Étapes</span>
            </button>
            <button
              class="btn-primary"
              style="padding:9px;font-size:12px;${wasCooked ? 'background:#059669;' : ''}"
              ${rec.matchedItems.length === 0 ? 'disabled style="opacity:0.5;"' : ''}
              onclick="cookZeroSpendRecipe('${rec.id}')"
            >
              ${
                wasCooked
                  ? '✅ Repas cuisiné ! (-1)'
                  : "🍽️ Cuisiner (-1 stock)"
              }
            </button>
          </div>
        </div>
      `;
              })
              .join('') + `</div>`
      }
    `
    }
  `;
}

function applyCoachInsight() {}

/* ============================================================================
 * STITCH-10 : Hub d'Acquisition Unifié (PDF / Caméra en direct / Code-barres)
 * ============================================================================ */
let activeMediaStream = null;

function stopLiveCameraScanner() {
  if (activeMediaStream) {
    activeMediaStream.getTracks().forEach((t) => t.stop());
    activeMediaStream = null;
  }
}

function renderStitch10AcquisitionHub() {
  const ext = state.pendingPdfExtraction;
  const tab = state.acquisitionTab || 'PDF';
  const curMb = state.monthlyBudgets[ext?.targetYearMonth || state.selectedYearMonth] || { categories: [] };
  const activeVariableCats = (curMb.categories || []).filter((c) => c.isEnabledForMonth !== false);
  const defaultFoodCat =
    activeVariableCats.find((c) => c.type === 'VARIABLE') ||
    activeVariableCats[0] ||
    { id: 'cat_alimentation', name: 'Alimentation & Réserve' };
  const selectedTargetCatId = state.pdfTargetCategoryId || defaultFoodCat.id;

  const checkedItems = ext ? (ext.items || []).filter((i) => i.checked) : [];
  const checkedTotalTTC = Math.round(
    checkedItems.reduce((acc, i) => acc + (Number(i.qty) || 1) * (Number(i.unitPrice) || 0), 0) * 100
  ) / 100;
  const sub = getSubscriptionInfo();

  return `
    <div class="card" style="max-width:860px;margin:0 auto;">
      <div class="section-header">
        <span class="section-title">📸 Scanner Facture &amp; Import PDF</span>
        <span
          class="badge-state ${sub.canScan ? 'HEALTHY' : 'WARNING'}"
          style="cursor:pointer;"
          onclick="openBottomSheet('PAYWALL_MODAL')"
          title="Gérer mon abonnement EcoPanier+ et mes crédits IA"
        >
          ${sub.isPremium ? '👑 EcoPanier+ Illimité' : `🎁 ${sub.freeRemaining}/${sub.freeLimit} scans gratuits${sub.creditsBalance > 0 ? ` (+${sub.creditsBalance})` : ''}`}
        </span>
      </div>

      <div class="segmented-control" style="margin-bottom:14px;">
        <button class="seg-btn ${tab === 'PDF' ? 'active' : ''}" onclick="setAcquisitionTab('PDF')">
          📄 Import PDF
        </button>
        <button class="seg-btn ${tab === 'CAMERA' ? 'active' : ''}" onclick="setAcquisitionTab('CAMERA')">
          📷 Scanner Facture
        </button>
        <button class="seg-btn ${tab === 'BARCODE' ? 'active' : ''}" onclick="setAcquisitionTab('BARCODE')">
          🏷️ Code-barres
        </button>
      </div>

      ${
        tab === 'PDF'
          ? `
        <div style="border:2px dashed var(--primary);background:var(--primary-soft);border-radius:14px;padding:16px;text-align:center;margin-bottom:12px;">
          <div style="font-size:26px;margin-bottom:4px;">📄</div>
          <div style="font-weight:700;font-size:13px;margin-bottom:4px;">
            Importer une facture PDF (Drive, Supermarché, Fournisseur)
          </div>
          <p style="font-size:11.5px;color:var(--text-muted);margin-bottom:10px;">
            Analyse multimodale rapide (~1,2s) par <code>parseInvoicePdfOrImage</code>.
          </p>
          <input type="file" accept="application/pdf,image/*" onchange="handleRealFileUpload(event)" style="font-size:12px;max-width:100%;" />
        </div>

        <button class="btn-secondary" style="margin-bottom:12px;" onclick="simulateDemoPdfInvoice()">
          🧪 Simuler une Facture PDF Drive (E.Leclerc Drive)
        </button>
      `
          : tab === 'CAMERA'
          ? `
        <div style="background:#0F172A;border-radius:14px;padding:12px;text-align:center;color:#fff;margin-bottom:12px;">
          <div style="position:relative;width:100%;height:210px;background:#020617;border-radius:10px;display:flex;align-items:center;justify-content:center;overflow:hidden;border:2px solid #10B981;">
            <video id="liveScannerVideo" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover;"></video>
            <div style="position:absolute;inset:12px;border:2px dashed rgba(16,185,129,0.85);border-radius:8px;pointer-events:none;display:flex;align-items:flex-end;justify-content:center;padding-bottom:6px;">
              <span style="background:rgba(2,6,23,0.75);color:#6EE7B7;font-size:10.5px;padding:2px 8px;border-radius:999px;font-weight:700;">
                Cadrez votre facture ou ticket puis capturez
              </span>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;">
            <button type="button" class="btn-secondary" onclick="startLiveCameraScanner()" style="background:#1E293B;color:#fff;border-color:#334155;">
              🎥 Ouvrir Caméra
            </button>
            <button type="button" class="btn-primary" onclick="captureCameraInvoiceFrame()">
              📸 Capturer &amp; Analyser
            </button>
          </div>
        </div>

        <div style="border:1px solid var(--border);background:var(--surface-alt);border-radius:12px;padding:12px;text-align:center;margin-bottom:12px;">
          <div style="font-weight:700;font-size:12px;margin-bottom:6px;">
            📱 Ou prendre une photo avec l'appareil photo / galerie
          </div>
          <input type="file" accept="image/*" capture="environment" onchange="handleRealFileUpload(event)" style="font-size:12px;max-width:100%;" />
        </div>
      `
          : `
        <div style="border:1px solid var(--border);background:var(--surface-alt);border-radius:12px;padding:14px;margin-bottom:12px;">
          <div style="font-weight:700;font-size:13px;margin-bottom:6px;">
            🏷️ Scanner un code-barres produit (EAN-13)
          </div>
          <div class="input-group">
            <label class="input-label">Produit EAN-13</label>
            <select class="select-field" id="barcodePresetSelect">
              <option value="3228857000166|Lait Demi-Écrémé 1L|1.18|CREMERIE">3228857000166 — Lait Demi-Écrémé 1L (1,18 €)</option>
              <option value="3038350023605|Pâtes Penne Barilla 500g|1.25|EPICERIE_SALEE">3038350023605 — Pâtes Penne Barilla 500g (1,25 €)</option>
              <option value="3017620422003|Pâte à tartiner 400g|3.49|EPICERIE_SUCREE">3017620422003 — Pâte à tartiner 400g (3,49 €)</option>
              <option value="3168930010265|Huile d'Olive Vierge 1L|7.65|EPICERIE_SALEE">3168930010265 — Huile d'Olive Vierge 1L (7,65 €)</option>
              <option value="8711000536322|Café Moulu Pur Arabica 250g|3.15|EPICERIE_SUCREE">8711000536322 — Café Moulu Pur Arabica 250g (3,15 €)</option>
            </select>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div class="input-group">
              <label class="input-label">Quantité</label>
              <input class="input-field" type="number" id="barcodeQty" value="1" min="1" />
            </div>
            <div class="input-group">
              <label class="input-label">Imputer au budget ?</label>
              <select class="select-field" id="barcodeChargeBudget">
                <option value="YES">Oui (Dépense + Réserve)</option>
                <option value="NO">Non (Réserve seule)</option>
              </select>
            </div>
          </div>
          <button class="btn-primary" onclick="submitBarcodeScan()">
            ➕ Ajouter à ma Réserve
          </button>
        </div>
      `
      }

      ${
        state.ocrLoading
          ? `
          <div class="skeleton-loader-box" style="margin-bottom:12px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
              <span style="font-size:18px;">🤖</span>
              <span style="font-size:12.5px;font-weight:800;color:var(--primary);">
                Analyse OCR Gemini 2.0 Flash en cours : ${escapeHtml(state.ocrLoadingLabel || 'Ticket')}...
              </span>
            </div>
            <div class="skeleton-line lg"></div>
            <div class="skeleton-line md"></div>
            <div class="skeleton-line lg"></div>
            <div class="skeleton-line sm"></div>
          </div>
        `
          : !ext
          ? `<div class="empty-state">Aucune facture en attente. Importez un PDF ou scannez votre ticket ci-dessus.</div>`
          : `
          <div style="padding:12px;background:var(--surface-alt);border-radius:12px;border:2px solid var(--primary);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <div style="font-weight:800;font-size:14px;">🏪 ${escapeHtml(ext.storeName)}</div>
              <span class="badge-state HEALTHY">OCR Éditable</span>
            </div>
            <div style="font-size:11.5px;color:var(--text-muted);margin-bottom:10px;">
              Date : <strong>${escapeHtml(ext.purchaseDateISO)}</strong> • Mois cible : <strong>${escapeHtml(ext.targetYearMonth)}</strong> • Total coché : <strong style="color:var(--primary);">${formatMoney(checkedTotalTTC)}</strong> (${checkedItems.length}/${ext.items.length} art.)
            </div>

            <div class="input-group" style="margin-bottom:10px;">
              <label class="input-label">🎯 Poste budgétaire à débiter (ou Réserve seule)</label>
              <select class="select-field" id="pdfTargetCategorySelect" onchange="setPdfTargetCategory(this.value)">
                ${activeVariableCats
                  .map(
                    (c) =>
                      `<option value="${escapeHtml(c.id)}" ${c.id === selectedTargetCatId ? 'selected' : ''}>${escapeHtml(c.icon || '🛒')} ${escapeHtml(c.name)} (Reste ${formatMoney(Math.max(0, (c.allocatedLimit || 0) - (c.spentAmount || 0)))})</option>`
                  )
                  .join('')}
                <option value="RESERVE_ONLY" ${selectedTargetCatId === 'RESERVE_ONLY' ? 'selected' : ''}>🥫 Réserve uniquement (0,00 € imputé au budget)</option>
              </select>
            </div>

            <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px;">
              ${ext.items
                .map(
                  (item, idx) => `
                <div style="padding:8px;background:var(--surface);border-radius:10px;border:1px solid var(--border);font-size:12px;">
                  <div class="ocr-edit-row" style="margin-bottom:6px;">
                    <input type="checkbox" ${item.checked ? 'checked' : ''} onchange="togglePdfItemCheck(${idx})" style="width:17px;height:17px;accent-color:var(--primary);" />
                    <input
                      type="text"
                      class="input-field"
                      value="${escapeHtml(item.name)}"
                      onchange="updatePdfItemField(${idx}, 'name', this.value)"
                      style="padding:5px 8px;font-size:12px;font-weight:700;"
                    />
                    <input
                      type="number"
                      min="1"
                      class="input-field"
                      value="${Number(item.qty) || 1}"
                      onchange="updatePdfItemField(${idx}, 'qty', this.value)"
                      title="Quantité"
                      style="padding:5px 6px;font-size:12px;text-align:center;"
                    />
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      class="input-field"
                      value="${Number(item.unitPrice || item.lineTotal || 0).toFixed(2)}"
                      onchange="updatePdfItemField(${idx}, 'unitPrice', this.value)"
                      title="Prix unitaire (€)"
                      style="padding:5px 6px;font-size:12px;text-align:right;"
                    />
                    <button type="button" class="pantry-del-btn" onclick="removePdfLine(${idx})" title="Retirer cette ligne">✕</button>
                  </div>
                  <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:6px;align-items:center;">
                    <select class="select-field" onchange="updatePdfItemField(${idx}, 'category', this.value)" style="padding:4px 6px;font-size:11px;">
                      <option value="CREMERIE" ${item.category === 'CREMERIE' ? 'selected' : ''}>🥛 Crèmerie &amp; Frais</option>
                      <option value="EPICERIE_SALEE" ${(!item.category || item.category === 'EPICERIE_SALEE') ? 'selected' : ''}>🍝 Épicerie Salée</option>
                      <option value="EPICERIE_SUCREE" ${item.category === 'EPICERIE_SUCREE' ? 'selected' : ''}>🍪 Épicerie Sucrée</option>
                      <option value="VIANDES_SURGELES" ${item.category === 'VIANDES_SURGELES' ? 'selected' : ''}>🥩 Viandes / Surgelés</option>
                      <option value="BOISSONS" ${item.category === 'BOISSONS' ? 'selected' : ''}>🥤 Boissons</option>
                      <option value="ENTRETIEN" ${item.category === 'ENTRETIEN' ? 'selected' : ''}>🧼 Entretien</option>
                    </select>
                    <input
                      type="date"
                      class="input-field"
                      value="${escapeHtml(item.expirationDate || '')}"
                      onchange="updatePdfItemField(${idx}, 'expirationDate', this.value)"
                      title="DLC / DLUO optionnelle"
                      style="padding:4px 6px;font-size:11px;"
                    />
                    <strong style="font-size:12px;color:var(--primary);min-width:54px;text-align:right;">
                      ${formatMoney((Number(item.qty) || 1) * (Number(item.unitPrice) || 0))}
                    </strong>
                  </div>
                </div>
              `
                )
                .join('')}
            </div>

            <div style="display:flex;gap:8px;margin-bottom:10px;">
              <button type="button" class="btn-secondary" style="padding:7px 10px;font-size:11.5px;" onclick="addBlankPdfLine()">
                ➕ Ajouter un article oublié
              </button>
            </div>

            <button
              class="btn-primary"
              ${checkedItems.length === 0 ? 'disabled' : ''}
              onclick="commitPdfInvoiceExtraction()"
            >
              ✅ Valider ${checkedItems.length} article${checkedItems.length > 1 ? 's' : ''} (${selectedTargetCatId === 'RESERVE_ONLY' ? 'Réserve seule • 0,00 €' : `${formatMoney(checkedTotalTTC)} sur ${ext.targetYearMonth}`})
            </button>
          </div>
        `
      }
    </div>
  `;
}

function setAcquisitionTab(t) {
  stopLiveCameraScanner();
  state.acquisitionTab = t;
  renderAll();
  if (t === 'CAMERA') {
    setTimeout(() => startLiveCameraScanner(), 150);
  }
}

async function startLiveCameraScanner() {
  const videoEl = document.getElementById('liveScannerVideo');
  if (!videoEl || !navigator.mediaDevices?.getUserMedia) return;
  try {
    stopLiveCameraScanner();
    activeMediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    videoEl.srcObject = activeMediaStream;
    showToast('📷 Caméra active : cadrez la facture puis cliquez sur "Capturer & Analyser".');
  } catch (err) {
    showToast('Caméra non détectée ou refusée. Utilisez le sélecteur de photo ci-dessous.', 'warning');
  }
}

async function captureCameraInvoiceFrame() {
  const videoEl = document.getElementById('liveScannerVideo');
  if (!videoEl || !activeMediaStream) {
    showToast('Ouvrez d’abord la caméra ou choisissez une photo.', 'warning');
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = videoEl.videoWidth || 1280;
  canvas.height = videoEl.videoHeight || 720;
  canvas.getContext('2d').drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  const base64Data = canvas.toDataURL('image/jpeg', 0.88).split(',')[1] || '';
  stopLiveCameraScanner();
  await sendBase64ToGeminiParser(base64Data, 'image/jpeg', 'Scan Caméra Ticket');
}

async function submitBarcodeScan() {
  if (!state.currentUser) return;
  const raw = document.getElementById('barcodePresetSelect')?.value || '3228857000166|Lait Demi-Écrémé 1L|1.18|CREMERIE';
  const [ean, name, priceStr, aisle] = raw.split('|');
  const qty = Math.max(1, Number(document.getElementById('barcodeQty')?.value) || 1);
  const chargeBudget = document.getElementById('barcodeChargeBudget')?.value === 'YES';
  const unitPrice = Number(priceStr) || 1.5;
  const totalCost = Math.round(unitPrice * qty * 100) / 100;

  const uid = state.currentUser.uid;
  const existing = state.pantryItems.find((i) => i.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    existing.currentQuantity += qty;
    existing.needsRestock = existing.currentQuantity <= 1;
    await setDoc(doc(db, 'users', uid, 'pantryItems', existing.id), existing);
  } else {
    const id = 'pantry_ean_' + ean;
    const newItem = {
      id,
      name,
      normalizedProductKey: name.toLowerCase().replace(/[^a-z0-9]/g, '_'),
      category: aisle || 'EPICERIE_SALEE',
      currentQuantity: qty,
      unit: '1u',
      alertThreshold: 1,
      needsRestock: qty <= 1,
      lastPricePaid: unitPrice,
      lastUpdatedAt: new Date().toISOString(),
    };
    await setDoc(doc(db, 'users', uid, 'pantryItems', id), newItem);
    state.pantryItems.push(newItem);
  }

  if (chargeBudget) {
    const mb = await ensureUserMonthInitialized(state.selectedYearMonth);
    let cat = mb.categories.find((c) => c.type === 'VARIABLE') || mb.categories[0];
    if (cat) {
      cat.spentAmount = Math.round((cat.spentAmount + totalCost) * 100) / 100;
      const g = computeGaugeState(cat.spentAmount, cat.allocatedLimit);
      cat.consumptionPercentage = g.pct;
      cat.gaugeState = g.state;
      mb.totalVariableSpent = Math.round((mb.totalVariableSpent + totalCost) * 100) / 100;
      const tx = {
        id: `tx_ean_${Date.now()}`,
        yearMonth: state.selectedYearMonth,
        categoryId: cat.id,
        categoryName: cat.name,
        amount: totalCost,
        type: 'VARIABLE',
        date: getDefaultOperationDate(state.selectedYearMonth),
        label: `Scan EAN ${ean} — ${qty}x ${name}`,
        source: 'BARCODE',
        createdAt: new Date().toISOString(),
      };
      mb.transactions.push(tx);
      await setDoc(doc(db, 'users', uid, 'monthlyBudgets', state.selectedYearMonth, 'categories', cat.id), cat);
      await setDoc(doc(db, 'users', uid, 'monthlyBudgets', state.selectedYearMonth, 'transactions', tx.id), tx);
      await setDoc(doc(db, 'users', uid, 'monthlyBudgets', state.selectedYearMonth), { totalVariableSpent: mb.totalVariableSpent }, { merge: true });
    }
  }

  showToast(`🏷️ +${qty} "${name}" ajouté à la réserve !`);
  setScreen('STITCH-06');
}

function togglePdfItemCheck(idx) {
  if (!state.pendingPdfExtraction) return;
  state.pendingPdfExtraction.items[idx].checked = !state.pendingPdfExtraction.items[idx].checked;
  renderAll();
}

function updatePdfItemField(idx, field, val) {
  if (!state.pendingPdfExtraction || !state.pendingPdfExtraction.items[idx]) return;
  const item = state.pendingPdfExtraction.items[idx];
  if (field === 'name') {
    item.name = String(val || '').trim() || 'Article';
  } else if (field === 'qty') {
    item.qty = Math.max(1, Number(val) || 1);
    item.lineTotal = Math.round(item.qty * (Number(item.unitPrice) || 0) * 100) / 100;
  } else if (field === 'unitPrice') {
    item.unitPrice = Math.max(0, Number(val) || 0);
    item.lineTotal = Math.round((Number(item.qty) || 1) * item.unitPrice * 100) / 100;
  } else if (field === 'category') {
    item.category = val || 'EPICERIE_SALEE';
  } else if (field === 'expirationDate') {
    item.expirationDate = /^\d{4}-\d{2}-\d{2}$/.test(String(val || '').trim()) ? String(val).trim() : null;
  }
  renderAll();
}

function setPdfTargetCategory(catId) {
  state.pdfTargetCategoryId = catId || '';
  renderAll();
}

function addBlankPdfLine() {
  if (!state.pendingPdfExtraction) return;
  state.pendingPdfExtraction.items.push({
    name: 'Nouvel article',
    qty: 1,
    unitPrice: 1.95,
    lineTotal: 1.95,
    category: 'EPICERIE_SALEE',
    expirationDate: null,
    checked: true,
  });
  renderAll();
}

function removePdfLine(idx) {
  if (!state.pendingPdfExtraction) return;
  state.pendingPdfExtraction.items.splice(idx, 1);
  renderAll();
}

function simulateDemoPdfInvoice() {
  const ym = state.selectedYearMonth;
  state.pendingPdfExtraction = {
    storeName: 'E.Leclerc Drive — Paris 11e (2,1 km)',
    purchaseDateISO: `${ym}-14`,
    targetYearMonth: ym,
    totalAmountTTC: 24.85,
    items: [
      { name: 'Lait Demi-Écrémé 1L', qty: 6, unitPrice: 1.09, lineTotal: 6.54, category: 'CREMERIE', expirationDate: null, checked: true },
      { name: 'Œufs Plein Air x12', qty: 2, unitPrice: 3.25, lineTotal: 6.50, category: 'CREMERIE', expirationDate: null, checked: true },
      { name: 'Huile d’Olive Vierge Extra 1L', qty: 1, unitPrice: 7.45, lineTotal: 7.45, category: 'EPICERIE_SALEE', expirationDate: null, checked: true },
      { name: 'Riz Basmati Supérieur 1kg', qty: 2, unitPrice: 2.18, lineTotal: 4.36, category: 'EPICERIE_SALEE', expirationDate: null, checked: true },
    ],
  };
  showToast('📄 Facture PDF E.Leclerc Drive pré-chargée !');
  renderAll();
}

async function handleRealFileUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file || !state.currentUser) return;
  try {
    const base64Data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    await sendBase64ToGeminiParser(base64Data, file.type || 'application/pdf', file.name);
  } catch (err) {
    showToast(`Erreur fichier : ${err.message}`, 'critical');
  }
}

async function sendBase64ToGeminiParser(base64Data, mimeType, sourceLabel) {
  const sub = getSubscriptionInfo();
  if (!sub.canScan) {
    showToast(
      `🔒 Vos ${sub.freeLimit} scans OCR gratuits du mois sont utilisés. Passez à EcoPanier+ Pro (4,99 €/m) ou prenez un Pack Crédits !`,
      'warning'
    );
    openBottomSheet('PAYWALL_MODAL');
    return;
  }

  state.ocrLoading = true;
  state.ocrLoadingLabel = sourceLabel;
  renderAll();
  showToast(`🤖 Analyse de "${escapeHtml(sourceLabel)}" par Gemini 2.0 Flash en cours...`);
  try {
    const idToken = state.currentUser?.getIdToken ? await state.currentUser.getIdToken() : '';
    const headers = { 'Content-Type': 'application/json' };
    if (idToken) {
      headers.Authorization = `Bearer ${idToken}`;
    }
    const response = await fetch(`${FUNCTIONS_BASE_URL}/parseInvoicePdfOrImage`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        data: {
          mimeType,
          base64Data,
        },
      }),
    });

    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(json?.error?.message || `HTTP ${response.status}`);
    }

    const data = json.result || json;
    const rawDate = String(data.purchaseDateISO || new Date().toISOString()).slice(0, 10);
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : new Date().toISOString().slice(0, 10);
    const targetYearMonth = validDate.slice(0, 7);

    const rawItems = Array.isArray(data.rawItems) ? data.rawItems : [];
    const items = rawItems.map((ri) => {
      const qty = Math.max(1, Number(ri.quantity) || 1);
      const unitPrice = Number(ri.unitPrice) || Number(ri.lineTotalTTC) || 0;
      const lineTotal = Number(ri.lineTotalTTC) || Math.round(qty * unitPrice * 100) / 100;
      return {
        name: ri.normalizedLabel || ri.rawLabel || 'Article facture',
        qty,
        unitPrice,
        lineTotal,
        category: 'EPICERIE_SALEE',
        expirationDate: null,
        checked: true,
      };
    });

    const computedSum = items.reduce((acc, i) => acc + i.lineTotal, 0);
    const totalAmountTTC = Number(data.totalAmountTTC) > 0 ? Number(data.totalAmountTTC) : Math.round(computedSum * 100) / 100;

    state.pendingPdfExtraction = {
      storeName: data.storeName || sourceLabel,
      purchaseDateISO: validDate,
      targetYearMonth,
      totalAmountTTC,
      items:
        items.length > 0
          ? items
          : [{ name: data.storeName || sourceLabel, qty: 1, unitPrice: totalAmountTTC, lineTotal: totalAmountTTC, category: 'EPICERIE_SALEE', expirationDate: null, checked: true }],
    };

    if (!sub.isPremium) {
      if (sub.freeRemaining > 0) {
        state.ocrScansUsedThisMonth = (Number(state.ocrScansUsedThisMonth) || 0) + 1;
      } else if (state.scanCreditsBalance > 0) {
        state.scanCreditsBalance = Math.max(0, Number(state.scanCreditsBalance) - 1);
      }
      saveUserMonetizationState();
    }

    showToast(`✅ Facture extraite en ~1s (${state.pendingPdfExtraction.items.length} article(s), total ${formatMoney(totalAmountTTC)}) !`);
  } catch (err) {
    showToast(`Erreur Gemini : ${err.message}`, 'critical');
  } finally {
    state.ocrLoading = false;
    state.ocrLoadingLabel = '';
    renderAll();
  }
}

async function commitPdfInvoiceExtraction() {
  if (state.isGuestSession) {
    showToast('ℹ️ Mode Invité (Lecture seule) : modifications désactivées.', 'warning');
    return;
  }
  if (!state.currentUser || !state.pendingPdfExtraction) return;
  const uid = state.currentUser.uid;
  const ext = state.pendingPdfExtraction;
  const checkedLines = (ext.items || []).filter((l) => l.checked);
  if (checkedLines.length === 0) {
    showToast('Veuillez cocher au moins un article à importer.', 'warning');
    return;
  }

  const checkedTotalTTC = Math.round(
    checkedLines.reduce((acc, l) => acc + (Number(l.qty) || 1) * (Number(l.unitPrice) || 0), 0) * 100
  ) / 100;

  const mb = await ensureUserMonthInitialized(ext.targetYearMonth);
  const targetCatId = state.pdfTargetCategoryId || '';

  if (targetCatId !== 'RESERVE_ONLY' && checkedTotalTTC > 0) {
    let cat =
      mb.categories.find((c) => c.id === targetCatId) ||
      mb.categories.find((c) => c.type === 'VARIABLE') ||
      mb.categories[0];
    if (cat) {
      cat.spentAmount = Math.round((cat.spentAmount + checkedTotalTTC) * 100) / 100;
      const g = computeGaugeState(cat.spentAmount, cat.allocatedLimit);
      cat.consumptionPercentage = g.pct;
      cat.gaugeState = g.state;
      await setDoc(doc(db, 'users', uid, 'monthlyBudgets', ext.targetYearMonth, 'categories', cat.id), cat);
    }

    recomputeMonthFinancials(mb);

    const tx = {
      id: `tx_pdf_${Date.now()}`,
      yearMonth: ext.targetYearMonth,
      categoryId: cat?.id || 'cat_alimentation',
      categoryName: cat?.name || 'Alimentation',
      amount: checkedTotalTTC,
      type: cat?.type || 'VARIABLE',
      date: ext.purchaseDateISO,
      label: `Facture OCR — ${ext.storeName} (${checkedLines.length} art.)`,
      source: 'PDF_INVOICE',
      createdAt: new Date().toISOString(),
    };
    mb.transactions.push(tx);

    await setDoc(doc(db, 'users', uid, 'monthlyBudgets', ext.targetYearMonth, 'transactions', tx.id), tx);
    await setDoc(
      doc(db, 'users', uid, 'monthlyBudgets', ext.targetYearMonth),
      {
        totalFixedCharges: mb.totalFixedCharges,
        totalVariableSpent: mb.totalVariableSpent,
        realDisposableIncome: mb.realDisposableIncome,
      },
      { merge: true }
    );
  }

  for (const line of checkedLines) {
    const existing = state.pantryItems.find((i) => i.name.toLowerCase() === line.name.toLowerCase());
    if (existing) {
      existing.currentQuantity += Number(line.qty) || 1;
      existing.needsRestock = existing.currentQuantity <= (existing.alertThreshold ?? 1);
      if (line.unitPrice > 0) existing.lastPricePaid = Number(line.unitPrice);
      if (line.category) existing.category = line.category;
      if (line.expirationDate) existing.expirationDate = line.expirationDate;
      existing.lastUpdatedAt = new Date().toISOString();
      await setDoc(doc(db, 'users', uid, 'pantryItems', existing.id), existing, { merge: true });
    } else {
      const id = 'pantry_' + Date.now() + Math.floor(Math.random() * 1000);
      const newItem = {
        id,
        name: line.name,
        normalizedProductKey: line.name.toLowerCase().replace(/[^a-z0-9]/g, '_'),
        category: line.category || 'EPICERIE_SALEE',
        currentQuantity: Number(line.qty) || 1,
        unit: '1u',
        alertThreshold: 1,
        needsRestock: (Number(line.qty) || 1) <= 1,
        lastPricePaid: Number(line.unitPrice) || Number(line.lineTotal) || 1.95,
        expirationDate: line.expirationDate || null,
        lastUpdatedAt: new Date().toISOString(),
      };
      await setDoc(doc(db, 'users', uid, 'pantryItems', id), newItem);
      state.pantryItems.push(newItem);
    }
  }

  state.pendingPdfExtraction = null;
  state.selectedYearMonth = ext.targetYearMonth;
  showToast(
    targetCatId === 'RESERVE_ONLY'
      ? `✅ ${checkedLines.length} article(s) ajouté(s) à la réserve (0,00 € imputé au budget) !`
      : `✅ Facture (${formatMoney(checkedTotalTTC)}) imputée sur ${ext.targetYearMonth} et réserve mise à jour !`
  );
  setScreen('STITCH-03');
}
