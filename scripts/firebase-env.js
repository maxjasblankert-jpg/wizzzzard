require('./load-env');

function readFirebaseConfigFromEnv() {
  return {
    apiKey: process.env.FIREBASE_API_KEY || 'YOUR_API_KEY',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || 'wizard-f356d.firebaseapp.com',
    projectId: process.env.FIREBASE_PROJECT_ID || 'wizard-f356d',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'wizard-f356d.firebasestorage.app',
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '736283800688',
    appId: process.env.FIREBASE_APP_ID || 'YOUR_APP_ID'
  };
}

function formatFirebaseConfigJs(firebaseConfig, comment = 'Auto-generated from .env') {
  return `// ${comment}
window.firebaseConfig = ${JSON.stringify(firebaseConfig, null, 2)};

window.firebaseConfigured =
  window.firebaseConfig.apiKey !== 'YOUR_API_KEY' &&
  window.firebaseConfig.appId !== 'YOUR_APP_ID';
`;
}

function isFirebaseConfigured(firebaseConfig) {
  return firebaseConfig.apiKey !== 'YOUR_API_KEY' && firebaseConfig.appId !== 'YOUR_APP_ID';
}

function readBotServiceUrl() {
  return process.env.BOT_SERVICE_URL || 'http://127.0.0.1:8001';
}

function formatBotEnvJs(url, comment = 'Auto-generated from .env') {
  return `// ${comment}
window.__BOT_SERVICE_URL__ = ${JSON.stringify(url)};
`;
}

module.exports = {
  readFirebaseConfigFromEnv,
  formatFirebaseConfigJs,
  isFirebaseConfigured,
  readBotServiceUrl,
  formatBotEnvJs
};
