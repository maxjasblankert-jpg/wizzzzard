// Copy to firebase-config.js for local dev, or set env vars for Vercel build
window.firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'wizard-f356d.firebaseapp.com',
  projectId: 'wizard-f356d',
  storageBucket: 'wizard-f356d.firebasestorage.app',
  messagingSenderId: '736283800688',
  appId: 'YOUR_APP_ID'
};

window.firebaseConfigured =
  window.firebaseConfig.apiKey !== 'YOUR_API_KEY' &&
  window.firebaseConfig.appId !== 'YOUR_APP_ID';
