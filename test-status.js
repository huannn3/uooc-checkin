const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

module.exports = async function testStatus() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uooc-cache-'));
  const rename = fs.renameSync;
  const moduleFile = path.join(root, 'uooc.js');
  try {
    fs.copyFileSync(path.join(__dirname, 'uooc.js'), moduleFile);
    const { saveStatus } = require(moduleFile);
    const file = path.join(root, '.uooc-status.json');
    fs.writeFileSync(file, '{"count":5}');
    let attempts = 0;
    fs.renameSync = (...args) => {
      if (++attempts < 3) throw Object.assign(new Error('fixture lock'), { code: 'EBUSY' });
      return rename(...args);
    };
    assert.equal(await saveStatus({ count: 6 }, file), true);
    assert.equal(attempts, 3);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).count, 6);
    fs.renameSync = () => { throw Object.assign(new Error('fixture persistent lock'), { code: 'EBUSY' }); };
    assert.equal(await saveStatus({ count: 7 }, file), false, 'Display-cache failures must not abort check-in.');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).count, 6, 'Retain the last valid cache when replacement is blocked.');
    console.log('通过：显示缓存短暂占用自动重试，持续占用不抛出致命错误且保留旧缓存（模拟文件锁）。');
  } finally {
    fs.renameSync = rename;
    delete require.cache[moduleFile];
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('uooc-cache-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
};
