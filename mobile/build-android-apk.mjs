import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync, execSync } from 'node:child_process';

const ROOT = 'd:/Projets/Depense/mobile';
const DIST_WEB = path.join(ROOT, 'dist-web');
const ANDROID_DIR = path.join(ROOT, 'android-app');
const BUILD_DIR = path.join(ANDROID_DIR, 'build');

const SDK_DIR = 'C:/Users/yvesb/AppData/Local/Android/Sdk';
const ANDROID_JAR = path.join(SDK_DIR, 'platforms/android-35/android.jar');
const BUILD_TOOLS = path.join(SDK_DIR, 'build-tools/35.0.1');
const AAPT2 = path.join(BUILD_TOOLS, 'aapt2.exe');
const ZIPALIGN = path.join(BUILD_TOOLS, 'zipalign.exe');
const APKSIGNER = path.join(BUILD_TOOLS, 'apksigner.bat');
const D8 = path.join(BUILD_TOOLS, 'd8.bat');

const JDK_BIN = 'C:/Program Files/Eclipse Adoptium/jdk-25.0.2.10-hotspot/bin';
const JAVAC = path.join(JDK_BIN, 'javac.exe');
const JAR = path.join(JDK_BIN, 'jar.exe');
const KEYTOOL = path.join(JDK_BIN, 'keytool.exe');
const JARSIGNER = path.join(JDK_BIN, 'jarsigner.exe');

// 1. Génération d'une icône PNG valide (Émeraude #047857 avec carré central doré/blanc)
function createSolidIconPng(size) {
  const width = size;
  const height = size;
  const rawData = Buffer.alloc(height * (1 + width * 4));

  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    rawData[rowStart] = 0; // filter type 0
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 4;
      const cx = (x - width / 2) / (width / 2);
      const cy = (y - height / 2) / (height / 2);
      const dist = Math.sqrt(cx * cx + cy * cy);

      // Fond dégradé émeraude (#064E3B -> #047857)
      let r = 4, g = 120, b = 87, a = 255;
      if (dist > 0.72) {
        r = 6; g = 78; b = 59;
      }
      // Anneau doré/blanc stylisé au centre (panier / bouclier)
      if (dist >= 0.34 && dist <= 0.44) {
        r = 167; g = 243; b = 208;
      } else if (Math.abs(cx) < 0.22 && Math.abs(cy) < 0.22) {
        r = 255; g = 255; b = 255;
      }

      rawData[px] = r;
      rawData[px + 1] = g;
      rawData[px + 2] = b;
      rawData[px + 3] = a;
    }
  }

  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    const combined = Buffer.concat([typeBuf, data]);
    crcBuf.writeUInt32BE(crc32(combined), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(rawData);
  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

console.log('1/6 Preparation des repertoires et icones PNG...');
fs.rmSync(BUILD_DIR, { recursive: true, force: true });
fs.mkdirSync(path.join(ANDROID_DIR, 'res/drawable'), { recursive: true });
fs.mkdirSync(path.join(ANDROID_DIR, 'res/values'), { recursive: true });
fs.mkdirSync(path.join(ANDROID_DIR, 'res/xml'), { recursive: true });
fs.mkdirSync(path.join(ANDROID_DIR, 'assets'), { recursive: true });
fs.mkdirSync(path.join(ANDROID_DIR, 'src/com/ecopanier/budgetia'), { recursive: true });
fs.mkdirSync(path.join(BUILD_DIR, 'compiled_res'), { recursive: true });
fs.mkdirSync(path.join(BUILD_DIR, 'gen'), { recursive: true });
fs.mkdirSync(path.join(BUILD_DIR, 'classes'), { recursive: true });
fs.mkdirSync(path.join(BUILD_DIR, 'dex'), { recursive: true });

const icon192 = createSolidIconPng(192);
const icon512 = createSolidIconPng(512);
fs.writeFileSync(path.join(DIST_WEB, 'icon-192.png'), icon192);
fs.writeFileSync(path.join(DIST_WEB, 'icon-512.png'), icon512);
fs.writeFileSync(path.join(ANDROID_DIR, 'res/drawable/ic_launcher.png'), icon192);

// Copie des assets web pour le mode hors-ligne embarqué dans l'APK
for (const f of ['index.html', 'app.js', 'styles.css', 'manifest.json', 'sw.js', 'icon-192.png']) {
  const srcFile = path.join(DIST_WEB, f);
  if (fs.existsSync(srcFile)) {
    fs.copyFileSync(srcFile, path.join(ANDROID_DIR, 'assets', f));
  }
}

console.log('2/6 Generation de AndroidManifest.xml et MainActivity.java...');
fs.writeFileSync(
  path.join(ANDROID_DIR, 'res/values/strings.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">EcoPanier &amp; Budget IA</string>
</resources>
`
);

fs.writeFileSync(
  path.join(ANDROID_DIR, 'res/xml/network_security_config.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
</network-security-config>
`
);

fs.writeFileSync(
  path.join(ANDROID_DIR, 'AndroidManifest.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.ecopanier.budgetia"
    android:versionCode="41"
    android:versionName="4.1.0">

    <uses-sdk android:minSdkVersion="24" android:targetSdkVersion="35" />

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    <uses-permission android:name="android.permission.CAMERA" />

    <uses-feature android:name="android.hardware.camera" android:required="false" />
    <uses-feature android:name="android.hardware.location.gps" android:required="false" />

    <application
        android:allowBackup="true"
        android:icon="@drawable/ic_launcher"
        android:label="@string/app_name"
        android:networkSecurityConfig="@xml/network_security_config"
        android:supportsRtl="true"
        android:hardwareAccelerated="true"
        android:theme="@android:style/Theme.DeviceDefault.NoActionBar">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:configChanges="orientation|screenSize|keyboardHidden"
            android:windowSoftInputMode="adjustResize">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>

            <!-- Deep Link & Google Play App Links vers https://depense-reserve-ia.web.app -->
            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="depense-reserve-ia.web.app" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`
);

// MainActivity.java est conserve depuis ANDROID_DIR/src/com/ecopanier/budgetia/MainActivity.java
const mainActivityPath = path.join(ANDROID_DIR, 'src/com/ecopanier/budgetia/MainActivity.java');
if (!fs.existsSync(mainActivityPath)) {
  throw new Error(`MainActivity.java introuvable a ${mainActivityPath}`);
}

console.log('3/6 Compilation des ressources Android avec aapt2...');
execFileSync(AAPT2, [
  'compile',
  '--dir',
  path.join(ANDROID_DIR, 'res'),
  '-o',
  path.join(BUILD_DIR, 'compiled_res/res.zip'),
]);

const unsignedApk = path.join(BUILD_DIR, 'unsigned.apk');
execFileSync(AAPT2, [
  'link',
  '-o',
  unsignedApk,
  '-I',
  ANDROID_JAR,
  '--manifest',
  path.join(ANDROID_DIR, 'AndroidManifest.xml'),
  '--java',
  path.join(BUILD_DIR, 'gen'),
  '-A',
  path.join(ANDROID_DIR, 'assets'),
  path.join(BUILD_DIR, 'compiled_res/res.zip'),
  '--auto-add-overlay',
]);

console.log('4/6 Compilation Java -> Bytecode -> Dalvik DEX (d8)...');
const rJava = path.join(BUILD_DIR, 'gen/com/ecopanier/budgetia/R.java');
const mainJava = path.join(ANDROID_DIR, 'src/com/ecopanier/budgetia/MainActivity.java');

execFileSync(JAVAC, [
  '--release',
  '11',
  '-cp',
  ANDROID_JAR,
  '-d',
  path.join(BUILD_DIR, 'classes'),
  rJava,
  mainJava,
]);

// Collect all .class files
const classFiles = [];
function findClassFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findClassFiles(full);
    else if (entry.name.endsWith('.class')) classFiles.push(full);
  }
}
findClassFiles(path.join(BUILD_DIR, 'classes'));

execFileSync(
  'cmd.exe',
  ['/c', D8, '--lib', ANDROID_JAR, '--min-api', '24', '--output', path.join(BUILD_DIR, 'dex'), ...classFiles],
  { stdio: 'inherit' }
);

// Add classes.dex to the root of unsigned.apk
execFileSync(JAR, ['uf', unsignedApk, '-C', path.join(BUILD_DIR, 'dex'), 'classes.dex']);

console.log('5/6 Generation du Keystore de signature & Alignement zipalign...');
const os = await import('os');
const crypto = await import('crypto');
const externalKeystoreDir = path.join(os.default.homedir(), '.ecopanier-keystore');
fs.mkdirSync(externalKeystoreDir, { recursive: true });
const keystorePath = process.env.ANDROID_KEYSTORE_PATH || path.join(externalKeystoreDir, 'ecopanier-release-v2.jks');
const passFile = path.join(externalKeystoreDir, '.keystore-pass');
let storePass = process.env.ANDROID_KEYSTORE_PASS;
if (!storePass) {
  if (fs.existsSync(passFile)) {
    storePass = fs.readFileSync(passFile, 'utf8').trim();
  } else {
    storePass = crypto.default.randomBytes(24).toString('base64url');
    fs.writeFileSync(passFile, storePass, { mode: 0o600 });
  }
}
const keyAlias = process.env.ANDROID_KEY_ALIAS || 'ecopanier-key';

if (!fs.existsSync(keystorePath)) {
  execFileSync(KEYTOOL, [
    '-genkeypair',
    '-v',
    '-keystore',
    keystorePath,
    '-alias',
    keyAlias,
    '-keyalg',
    'RSA',
    '-keysize',
    '2048',
    '-validity',
    '10000',
    '-storepass',
    storePass,
    '-keypass',
    storePass,
    '-dname',
    'CN=EcoPanier Budget IA, OU=Mobile, O=EcoPanier, L=Paris, ST=IDF, C=FR',
  ]);
}

const alignedApk = path.join(BUILD_DIR, 'aligned.apk');
execFileSync(ZIPALIGN, ['-f', '-p', '4', unsignedApk, alignedApk]);

const finalApkInAndroid = path.join(ANDROID_DIR, 'ecopanier-budget-ia-v4.1.apk');
const finalApkInWeb = path.join(DIST_WEB, 'ecopanier-budget-ia.apk');

execFileSync(
  'cmd.exe',
  [
    '/c',
    APKSIGNER,
    'sign',
    '--ks',
    keystorePath,
    '--ks-key-alias',
    keyAlias,
    '--ks-pass',
    `pass:${storePass}`,
    '--key-pass',
    `pass:${storePass}`,
    '--out',
    finalApkInAndroid,
    alignedApk,
  ],
  { stdio: 'inherit' }
);

fs.copyFileSync(finalApkInAndroid, finalApkInWeb);

console.log('6/6 Extraction de l empreinte SHA-256 pour Google Play Store Digital Asset Links...');
const certInfo = execFileSync(
  'cmd.exe',
  ['/c', APKSIGNER, 'verify', '--print-certs', finalApkInAndroid]
).toString('utf8');

const sha256Match = certInfo.match(/SHA-256 digest:\s*([0-9a-fA-F]+)/i);
let sha256Fingerprint = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';
if (sha256Match) {
  const hex = sha256Match[1].trim().toUpperCase();
  sha256Fingerprint = hex.match(/.{1,2}/g).join(':');
}

fs.mkdirSync(path.join(DIST_WEB, '.well-known'), { recursive: true });
fs.writeFileSync(
  path.join(DIST_WEB, '.well-known/assetlinks.json'),
  JSON.stringify(
    [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'com.ecopanier.budgetia',
          sha256_cert_fingerprints: [sha256Fingerprint],
        },
      },
    ],
    null,
    2
  )
);

const stat = fs.statSync(finalApkInWeb);
console.log(`✅ APK signe genere avec succes : ${finalApkInWeb} (${Math.round(stat.size / 1024)} Ko)`);
console.log(`🔑 SHA-256 Play Store / App Links : ${sha256Fingerprint}`);

console.log('7/7 Generation et signature du Bundle Google Play (.aab)...');
const protoBaseApk = path.join(BUILD_DIR, 'proto_base.apk');
execFileSync(AAPT2, [
  'link',
  '--proto-format',
  '-o',
  protoBaseApk,
  '-I',
  ANDROID_JAR,
  '--manifest',
  path.join(ANDROID_DIR, 'AndroidManifest.xml'),
  '-A',
  path.join(ANDROID_DIR, 'assets'),
  path.join(BUILD_DIR, 'compiled_res/res.zip'),
  '--auto-add-overlay',
]);

const protoExtractDir = path.join(BUILD_DIR, 'aab_proto');
const aabStagingDir = path.join(BUILD_DIR, 'aab_staging');
fs.mkdirSync(protoExtractDir, { recursive: true });
fs.mkdirSync(path.join(aabStagingDir, 'base/manifest'), { recursive: true });
fs.mkdirSync(path.join(aabStagingDir, 'base/dex'), { recursive: true });

execFileSync(JAR, ['xf', protoBaseApk], { cwd: protoExtractDir });

fs.writeFileSync(
  path.join(aabStagingDir, 'BundleConfig.pb'),
  Buffer.from([0x0a, 0x08, 0x0a, 0x06, 0x31, 0x2e, 0x31, 0x37, 0x2e, 0x31])
);
fs.copyFileSync(
  path.join(protoExtractDir, 'AndroidManifest.xml'),
  path.join(aabStagingDir, 'base/manifest/AndroidManifest.xml')
);
fs.copyFileSync(
  path.join(protoExtractDir, 'resources.pb'),
  path.join(aabStagingDir, 'base/resources.pb')
);
fs.copyFileSync(
  path.join(BUILD_DIR, 'dex/classes.dex'),
  path.join(aabStagingDir, 'base/dex/classes.dex')
);

if (fs.existsSync(path.join(protoExtractDir, 'res'))) {
  fs.cpSync(path.join(protoExtractDir, 'res'), path.join(aabStagingDir, 'base/res'), { recursive: true });
}
if (fs.existsSync(path.join(protoExtractDir, 'assets'))) {
  fs.cpSync(path.join(protoExtractDir, 'assets'), path.join(aabStagingDir, 'base/assets'), { recursive: true });
}

const finalAabInAndroid = path.join(ANDROID_DIR, 'ecopanier-budget-ia-v4.1.aab');
fs.rmSync(finalAabInAndroid, { force: true });
execFileSync(JAR, ['cfM', finalAabInAndroid, '.'], { cwd: aabStagingDir });

execFileSync(
  JARSIGNER,
  [
    '-keystore',
    keystorePath,
    '-storepass',
    storePass,
    '-keypass',
    storePass,
    '-sigalg',
    'SHA256withRSA',
    '-digestalg',
    'SHA-256',
    finalAabInAndroid,
    keyAlias,
  ],
  { stdio: 'inherit' }
);

execFileSync(JARSIGNER, ['-verify', finalAabInAndroid], { stdio: 'inherit' });
const aabStat = fs.statSync(finalAabInAndroid);
console.log(`✅ Android App Bundle (.aab) signe genere avec succes : ${finalAabInAndroid} (${Math.round(aabStat.size / 1024)} Ko)`);
