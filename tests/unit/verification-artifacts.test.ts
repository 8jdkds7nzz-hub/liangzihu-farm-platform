import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, lstatSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {artifactDirectory, artifactPath, createArtifactRun, PROJECT_ROOT} from '../support/artifacts';

test('Q01每轮产物独立且私有，路径不能指向历史或越界', () => {
  const first = createArtifactRun(), second = createArtifactRun();
  try {
    assert.notEqual(first, second);
    const file = artifactPath('验收/1a/结果.json', first);
    writeFileSync(file, '{}');
    assert(existsSync(file));
    assert.equal(lstatSync(first).mode & 0o777, 0o700);
    for (const path of ['../escaped', '/tmp/escaped', 'a/../../escaped', 'a\\escaped']) {
      assert.throws(() => artifactPath(path, first), /产物路径/);
    }
    assert.throws(() => artifactPath('结果.json', join(PROJECT_ROOT, 'docs/acceptance')), /运行目录/);
    assert.equal(existsSync(join(first, 'escaped')), false);
  } finally { rmSync(first, {recursive: true, force: true}); rmSync(second, {recursive: true, force: true}); }
});

test('Q01拒绝通过符号链接把产物写到其他目录', () => {
  const first = createArtifactRun(), second = createArtifactRun();
  try {
    symlinkSync(second, join(artifactDirectory('验收', first), 'link'));
    assert.throws(() => artifactPath('验收/link/result.json', first), /符号链接/);
    assert.equal(existsSync(join(second, 'result.json')), false);
  } finally { rmSync(first, {recursive: true, force: true}); rmSync(second, {recursive: true, force: true}); }
});
