// ============================================================
// NewTech System - Firebase Cloud Sync Configuration
// ============================================================
// خطوات الإعداد:
// 1. اذهب إلى: https://console.firebase.google.com
// 2. أنشئ مشروعاً جديداً (مجاناً)
// 3. من Project Settings → General → SDK Setup → Config
// 4. انسخ القيم وضعها هنا بدل "YOUR_..."
// 5. من قائمة Build → Realtime Database → Create Database → Start in Test Mode
// ============================================================

window.FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// إذا لم يتم إعداد Firebase بعد، يعمل النظام بـ localStorage فقط (محلي)
window.FIREBASE_ENABLED = (
  window.FIREBASE_CONFIG.apiKey &&
  window.FIREBASE_CONFIG.apiKey !== 'YOUR_API_KEY' &&
  window.FIREBASE_CONFIG.databaseURL &&
  window.FIREBASE_CONFIG.databaseURL.indexOf('YOUR_PROJECT') === -1
);
