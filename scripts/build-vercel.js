const fs = require('fs');
const path = require('path');
const {
  readFirebaseConfigFromEnv,
  formatFirebaseConfigJs,
  isFirebaseConfigured,
  readBotServiceUrl,
  formatBotEnvJs
} = require('./firebase-env');

const srcDir = path.join(__dirname, '..', 'public');
const distDir = path.join(__dirname, '..', 'dist');

fs.mkdirSync(distDir, { recursive: true });

for (const file of fs.readdirSync(srcDir)) {
  fs.copyFileSync(path.join(srcDir, file), path.join(distDir, file));
}

const firebaseConfig = readFirebaseConfigFromEnv();
fs.writeFileSync(
  path.join(distDir, 'firebase-config.js'),
  formatFirebaseConfigJs(firebaseConfig, 'Auto-generated at build time')
);

fs.writeFileSync(
  path.join(distDir, 'bot-env.js'),
  formatBotEnvJs(readBotServiceUrl(), 'Auto-generated at build time')
);

console.log(`Vercel build complete. Firebase: ${isFirebaseConfigured(firebaseConfig)
  ? 'configured'
  : 'needs FIREBASE_API_KEY + FIREBASE_APP_ID in Vercel env'}`);
