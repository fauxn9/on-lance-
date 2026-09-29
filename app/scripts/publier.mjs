// Publie une nouvelle version de l'app :
//   npm run publier -- 0.3.0 "Première nouveauté\nDeuxième nouveauté"
// (« \n » pour aller à la ligne : sous Windows, npm coupe un vrai retour à la
// ligne dans un argument.)
// Met le numéro de version partout, commite, pose le tag « tracker-v0.3.0 »
// (son message = les notes de version affichées dans l'app) et pousse.
// GitHub Actions compile, signe et publie ; les apps installées proposent
// la mise à jour dans les heures qui suivent.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [version, brut] = process.argv.slice(2);
const notes = brut?.split('\\n').map((l) => l.trim()).join('\n');
if (!/^\d+\.\d+\.\d+$/.test(version ?? '') || !notes?.trim()) {
  console.error('Usage : npm run publier -- 0.3.0 "Première nouveauté\\nDeuxième nouveauté"');
  process.exit(1);
}
const ici = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const git = (...a) => execFileSync('git', a, { cwd: ici('.'), stdio: 'inherit' });

const pkg = JSON.parse(readFileSync(ici('package.json'), 'utf8'));
pkg.version = version;
writeFileSync(ici('package.json'), `${JSON.stringify(pkg, null, 2)}\n`);

const conf = JSON.parse(readFileSync(ici('src-tauri/tauri.conf.json'), 'utf8'));
conf.version = version;
writeFileSync(ici('src-tauri/tauri.conf.json'), `${JSON.stringify(conf, null, 2)}\n`);

const cargo = readFileSync(ici('src-tauri/Cargo.toml'), 'utf8');
writeFileSync(ici('src-tauri/Cargo.toml'), cargo.replace(/^version = ".*"$/m, `version = "${version}"`));
execFileSync('cargo', ['update', '-p', 'onlance', '--offline'], { cwd: ici('.'), stdio: 'inherit' });

git('add', 'package.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'Cargo.lock');
git('commit', '-m', `App ${version}\n\n${notes}\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`);
git('tag', '-a', `tracker-v${version}`, '-m', notes);
git('push', 'origin', 'HEAD:main', '--follow-tags');
console.log(`tracker-v${version} poussé : GitHub compile et publie (environ 10 min).`);
