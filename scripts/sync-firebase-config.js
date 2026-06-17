const fs = require('fs');
const path = require('path');
const {
  readFirebaseConfigFromEnv,
  formatFirebaseConfigJs,
  isFirebaseConfigured,
  readBotServiceUrl,
  formatBotEnvJs
} = require('./firebase-env');

const outPath = path.join(__dirname, '..', 'public', 'firebase-config.js');
const botEnvPath = path.join(__dirname, '..', 'public', 'bot-env.js');
const firebaseConfig = readFirebaseConfigFromEnv();

fs.writeFileSync(outPath, formatFirebaseConfigJs(firebaseConfig, 'Auto-generated from .env — run: npm run sync:firebase'));
fs.writeFileSync(botEnvPath, formatBotEnvJs(readBotServiceUrl(), 'Auto-generated from .env — run: npm run sync:firebase'));

console.log(`Wrote ${outPath}`);
console.log(`Wrote ${botEnvPath}`);
console.log(isFirebaseConfigured(firebaseConfig)
  ? 'Firebase: configured'
  : 'Firebase: set FIREBASE_API_KEY and FIREBASE_APP_ID in .env');
