#!/usr/bin/env node

// USAGE:
//  oz-docs [-c COMPONENT] [watch PATTERNS...]

const path = require('path');
const fs = require('fs');
const proc = require('child_process');
const crypto = require('crypto');
const yaml = require('js-yaml');
const findUp = require('find-up');
const chokidar = require('chokidar');
const paths = require('env-paths')('openzeppelin-docs-preview', { suffix: '' });;

const {
  c: component = '.',
  _: [ command = 'build', ...args ],
} = require('minimist')(process.argv.slice(2));

// Clone docs repo

const docsDir = getDocsDir();

if (fs.existsSync(docsDir)) {
  const rev1 = getDocsRevision();

  proc.spawnSync('git', [ 'pull' ], {
    stdio: 'inherit',
    cwd: docsDir,
  });

  const rev2 = getDocsRevision();

  if (rev1 !== rev2) {
    proc.spawnSync('npx', ['yarn'], {
      cwd: docsDir,
      stdio: 'inherit',
    });
  }
} else {
  proc.spawnSync('git', [
    'clone',
    'https://github.com/OpenZeppelin/docs.openzeppelin.com.git',
    '--branch=build-local',
    '--depth=1',
    docsDir,
  ], {
    stdio: 'inherit',
  });

  proc.spawnSync('npx', ['yarn'], {
    cwd: docsDir,
    stdio: 'inherit',
  });

  // We create a build directory in cwd and a symlink from the docs dir to it,
  // so that the built docs are placed here.
  fs.mkdirSync('build', { recursive: true });
  fs.symlinkSync(path.resolve('build'), path.join(docsDir, 'build'));
}

const playbook = getPlaybook();

if (command === 'build') {
  build();

} else if (command === 'watch') {
  // We will manually run prepare-docs on changes.
  process.env.DISABLE_PREPARE_DOCS = 'true';

  chokidar.watch(args).on('all', debounce(() => {
    proc.spawnSync('npm', ['run', 'prepare-docs'], {
      stdio: 'inherit',
    });
  }, 500));

  chokidar.watch(['**/*.yml', '**/*.adoc'], {
    cwd: component,
  }).on('all', debounce(() => {
    build();
  }, 500));

} else {
  console.error(`Unknown command ${command}`);
  process.exit(1);
}

function getPlaybook() {
  const playbook = yaml.safeLoad(fs.readFileSync(path.join(docsDir, 'playbook.yml')));
  playbook.content.sources = [ playbook.content.sources[0], getSource() ];
  // TODO: change site start page

  const localPlaybookFile = path.resolve(docsDir, 'local-playbook.yml');
  fs.writeFileSync(localPlaybookFile, yaml.safeDump(playbook));
  return localPlaybookFile;
}

function getSource() {
  const gitDir = findUp.sync('.git', { type: 'directory' });

  if (gitDir === undefined) {
    throw new Error('Must be inside a git repository');
  }

  const repoDir = path.dirname(gitDir);
  const startPath = path.relative(repoDir, component);

  return {
    url: repoDir,
    start_path: startPath,
    branches: 'HEAD',
  };
}

function getDocsDir() {
  const hash = crypto.createHash('sha1')
    .update(process.cwd())
    .digest('hex');
  return path.join(paths.temp, hash);
}

function getDocsRevision() {
  return proc.execFileSync('git', [ 'rev-parse', 'HEAD' ], {
    cwd: docsDir,
    encoding: 'utf8',
  });
}

function debounce(fn, delay) {
  let timeout;
  return function () {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      fn.apply(this);
    }, delay);;
  }
}

function build() {
  proc.spawnSync('npm', ['run', 'build:custom', playbook], {
    cwd: docsDir,
    stdio: 'inherit',
  });
}
