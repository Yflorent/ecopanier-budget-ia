# EcoPanier & Budget IA

Application Mobile & PWA de Gestion Financière, Réserve Domestique & Comparateur Géolocalisé (5 km) — Architecture Monorepo TypeScript Serverless (Firebase BaaS & Vertex AI Gemini 2.5 Flash).

## 🔗 Liens du Projet

- **Dépôt GitHub** : https://github.com/Yflorent/ecopanier-budget-ia
- **Clone Git** : `https://github.com/Yflorent/ecopanier-budget-ia.git`
- **Application Web Live (PWA / Firebase Hosting)** : https://depense-reserve-ia.web.app
- **Application Web (Domaine alternatif FirebaseApp)** : https://depense-reserve-ia.firebaseapp.com
- **Téléchargement direct APK Android (v4.1)** : https://depense-reserve-ia.web.app/ecopanier-budget-ia.apk
- **Console Firebase** : https://console.firebase.google.com/project/depense-reserve-ia/overview

## 📦 Structure du Monorepo

- `packages/shared` (`@depense/shared`) : Modèles Firestore, logique métier pure (budget mensuel `YYYY-MM`, réserve domestique, comparateur géolocalisé 5 km / Geohash, parseur facture), utilitaires i18n et tests.
- `backend/functions` (`@depense/functions`) : Cloud Functions Firebase (reconduction mensuelle, comparateur quotidien, extraction multimodale de factures PDF/tickets et coach financier via Vertex AI Gemini).
- `mobile` (`@depense/mobile`) : Application React Native / Expo & Web PWA + wrapper Android (`mobile/android-app`).
- `design/stitch` : Écrans et manifestes Google Stitch (`STITCH-01` à `STITCH-10`).
- `firestore.rules`, `firestore.indexes.json`, `storage.rules`, `firebase.json` : Configuration et sécurité Firebase.

## 🛠️ Scripts principaux

```bash
npm install
npm run build
npm test
```

Pour plus de détails techniques, consultez [ARCHITECTURE.md](./ARCHITECTURE.md) et [DESIGN.md](./DESIGN.md).
