import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const git = (args, options = {}) => execFileSync('git', args, { encoding: 'utf8', ...options })?.trim() ?? '';
const root = git(['rev-parse', '--show-toplevel']);
const dist = path.join(root, 'dist');
const temporary = mkdtempSync(path.join(tmpdir(), 'gravy-train-pages-'));

try {
  // An isolated index publishes generated files without changing the checkout.
  const env = { ...process.env, GIT_DIR: git(['rev-parse', '--absolute-git-dir']), GIT_WORK_TREE: dist, GIT_INDEX_FILE: path.join(temporary, 'index') };
  writeFileSync(path.join(dist, '.nojekyll'), '');
  const previous = git(['ls-remote', '--heads', 'origin', 'gh-pages']);
  let parent;
  if (previous) {
    git(['fetch', 'origin', 'gh-pages']);
    parent = git(['rev-parse', 'FETCH_HEAD']);
  }
  git(['read-tree', '--empty'], { env, cwd: dist });
  git(['add', '--all', '--', '.'], { env, cwd: dist });
  const tree = git(['write-tree'], { env, cwd: dist });
  const source = git(['rev-parse', '--short', 'HEAD']);
  const commit = git(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', `Deploy Gravy Train from ${source}`]);
  // No force push: a concurrent deployment is preserved and can be retried.
  git(['push', 'origin', `${commit}:refs/heads/gh-pages`], { stdio: 'inherit' });
  console.log('Published the static site to gh-pages. GitHub Pages will deploy it shortly.');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
