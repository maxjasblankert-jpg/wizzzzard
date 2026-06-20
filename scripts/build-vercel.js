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
const buildId = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7)
  || process.env.VERCEL_DEPLOYMENT_ID?.slice(0, 8)
  || Date.now().toString(36);

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

const indexPath = path.join(distDir, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
html = html.replace(/((?:href|src)="(?!https?:\/\/)([^"?]+))(")/g, `$1?v=${buildId}$3`);
fs.writeFileSync(indexPath, html);

console.log(`Vercel build complete (${buildId}). Firebase: ${isFirebaseConfigured(firebaseConfig)
  ? 'configured'
  : 'needs FIREBASE_API_KEY + FIREBASE_APP_ID in Vercel env'}`);
