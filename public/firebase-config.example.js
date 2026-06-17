// Copy to firebase-config.js for local dev, or:
//   1. Copy .env.example → .env and add your keys
//   2. Run: npm run sync:firebase
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
