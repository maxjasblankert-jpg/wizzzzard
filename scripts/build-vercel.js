const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'public');
const distDir = path.join(__dirname, '..', 'dist');

fs.mkdirSync(distDir, { recursive: true });

for (const file of fs.readdirSync(srcDir)) {
  fs.copyFileSync(path.join(srcDir, file), path.join(distDir, file));
}

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || 'YOUR_API_KEY',
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || 'wizard-f356d.firebaseapp.com',
  projectId: process.env.FIREBASE_PROJECT_ID || 'wizard-f356d',
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'wizard-f356d.firebasestorage.app',
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '736283800688',
  appId: process.env.FIREBASE_APP_ID || 'YOUR_APP_ID'
};

const configJs = `// Auto-generated at build time
window.firebaseConfig = ${JSON.stringify(firebaseConfig, null, 2)};

window.firebaseConfigured =
  window.firebaseConfig.apiKey !== 'YOUR_API_KEY' &&
  window.firebaseConfig.appId !== 'YOUR_APP_ID';
`;

fs.writeFileSync(path.join(distDir, 'firebase-config.js'), configJs);

const configured = firebaseConfig.apiKey !== 'YOUR_API_KEY' && firebaseConfig.appId !== 'YOUR_APP_ID';
console.log(`Vercel build complete. Firebase: ${configured ? 'configured' : 'needs FIREBASE_API_KEY + FIREBASE_APP_ID in Vercel env'}`);
