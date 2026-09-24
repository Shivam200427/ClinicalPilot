// Builds frontend/src into frontend/app.js + frontend/styles.css and stamps
// cache-busting hashes into index.html. Run: `npm run build` (or `npm run watch`).
import { build, context } from 'esbuild';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');
const tailwindBin = join(dir, '..', 'node_modules', '.bin', 'tailwindcss');
const twArgs = ['-c', join(dir, 'tailwind.config.js'), '-i', join(dir, 'src', 'styles.css'),
  '-o', join(dir, 'styles.css'), '--minify'];

const jsOptions = {
  entryPoints: [join(dir, 'src', 'main.jsx')],
  outfile: join(dir, 'app.js'),
  bundle: true,
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  target: ['es2019'],
  jsx: 'transform', // React is a global loaded from the CDN in index.html
  logLevel: 'info',
};

function stamp() {
  const hash = f => createHash('sha1').update(readFileSync(join(dir, f))).digest('hex').slice(0, 10);
  const indexPath = join(dir, 'index.html');
  const html = readFileSync(indexPath, 'utf8')
    .replace(/app\.js(\?v=[\w]*)?"/, `app.js?v=${hash('app.js')}"`)
    .replace(/styles\.css(\?v=[\w]*)?"/, `styles.css?v=${hash('styles.css')}"`);
  writeFileSync(indexPath, html);
}

if (watch) {
  spawn(tailwindBin, [...twArgs, '--watch'], { stdio: 'inherit' });
  const ctx = await context(jsOptions);
  await ctx.watch();
} else {
  execFileSync(tailwindBin, twArgs, { stdio: 'inherit' });
  await build(jsOptions);
  stamp();
}
