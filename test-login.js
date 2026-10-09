const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
module.exports = async function () {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uooc-login-test-'));
  const copied = path.join(root, 'uooc.js');
  try {
    fs.copyFileSync(path.join(__dirname, 'uooc.js'), copied);
    const { fillLogin } = require(copied);
    const calls = [];
    let verified = false;
    let ticks = 0;
    let clearOnVerify = false;
    let clearAfterRefill = false;
    let tabSelected = false;
    const accountSelector = 'input[placeholder="手机号/邮箱"]:visible';
    const passwordSelector = 'input[placeholder="密码"]:visible';
    const values = {};
    const login = { account: 'fixture@example.invalid', password: 'private-fixture-password' };
    const button = { waitFor: async () => {}, isEnabled: async () => true, click: async () => {
      assert.equal(values[passwordSelector], login.password, 'Never submit an empty or changed password.'); calls.push('submit');
    } };
    const checkbox = { waitFor: async () => {}, boundingBox: async () => ({x:100,y:200,width:24,height:24}),
      click: async () => calls.push('verification-click') };
    const form = { getByRole: () => button, getByText: () => ({ isVisible: async () => verified }),
      locator: selector => { assert.equal(selector, '#aliyunCaptcha-checkbox-icon:visible'); return checkbox; } };
    const frame = { url: () => 'https://www.uooc.net.cn/user/login', waitForLoadState: async () => calls.push('frame-loaded'), locator: selector => ({
      click: async () => calls.push(selector),
      getAttribute: async () => tabSelected ? 'selected' : '',
      fill: async value => { assert.equal(value, selector === accountSelector ? login.account : ''); values[selector]=value; calls.push(selector); },
      pressSequentially: async (value, options) => { assert.equal(value, login.password); assert.deepEqual(options,{delay:25}); values[selector]=value; calls.push('type-password'); },
      press: async key => { assert.equal(key,'Tab'); calls.push('blur-password'); },
      inputValue: async () => values[selector] || '',
      locator: () => form,
    }) };
    const page = { url: () => 'https://www.uooc.net.cn/league/union', frames: () => [frame],
      mouse: {move: async (x,y,options) => { assert.deepEqual([x,y,options], [112,212,{steps:8}]); calls.push('mouse-move'); }},
      locator: selector => ({ click: async () => calls.push(selector) }),
      waitForTimeout: async ms => {
        assert.ok(!calls.includes('submit'), 'Must wait for verification to pass before submitting.');
        if (ms === 500) {
          verified = ++ticks >= 2;
          if (verified && clearOnVerify) { values[passwordSelector]=''; clearOnVerify=false; }
        }
        if (ms === 300 && verified && clearAfterRefill) values[passwordSelector]='';
      },
    };
    await fillLogin(page, login, 1000);
    assert.deepEqual(calls, ['#loginBtn', 'frame-loaded', '#passwd_li', accountSelector, passwordSelector, 'type-password', 'blur-password', 'mouse-move', 'verification-click', 'submit']);
    assert.equal(ticks, 2);
    assert.ok(!fs.readFileSync(path.join(root, 'uooc.log'), 'utf8').includes(login.password));
    calls.length = 0;
    await assert.rejects(fillLogin({ ...page, url: () => 'https://evil.example/' }, login), /来源/);
    assert.deepEqual(calls, [], 'Never enter credentials on another host.');
    verified = false;
    const idle = { ...page, waitForTimeout: async () => new Promise(resolve => setTimeout(resolve, 5)) };
    await assert.rejects(fillLogin(idle, login, 20), /超时/);
    assert.ok(!calls.includes('submit'), 'An enabled login button alone does not prove verification passed.');
    assert.equal(calls.filter(x => x === 'verification-click').length, 1, 'Do not retry verification clicks.');
    calls.length = 0;
    ticks = 0;
    verified = false;
    checkbox.click = async () => { calls.push('failed-verification-click'); throw new Error('fixture click failed'); };
    await fillLogin(page, login, 1000);
    assert.equal(calls.filter(x => x === 'failed-verification-click').length, 1);
    assert.equal(calls.at(-1), 'submit', 'Allow manual verification after the one failed click.');
    calls.length = 0; ticks = 0; verified = false; tabSelected = true;
    checkbox.click = async () => calls.push('verification-click');
    await fillLogin(page, login, 1000);
    assert.ok(!calls.includes('#passwd_li'), 'Do not reset an already selected password form.');
    tabSelected = false;
    calls.length = 0; ticks = 0; verified = false; clearOnVerify = true;
    checkbox.click = async () => calls.push('verification-click');
    await fillLogin(page, login, 1000);
    assert.equal(calls.filter(x=>x==='type-password').length,2, 'Refill once after verification clears the password.');
    assert.equal(calls.filter(x=>x==='verification-click').length,1);
    assert.equal(calls.filter(x=>x==='submit').length,1);
    calls.length = 0; ticks = 0; verified = false; clearOnVerify = true; clearAfterRefill = true;
    await assert.rejects(fillLogin(page, login, 1000), /表单仍在变化/);
    assert.ok(!calls.includes('submit'), 'Stop if the page keeps clearing the refilled password.');
    assert.equal(calls.filter(x=>x==='type-password').length,2);
    const output = fs.readFileSync(path.join(root,'uooc.log'),'utf8');
    assert.ok(!output.includes(login.account) && !output.includes(login.password));
    console.log('通过：键盘输入与失焦同步、验证后清空密码补填一次、再次清空不提交、验证仅点击一次、外站拒绝填写及日志不含密码（模拟表单）。');
  } finally {
    delete require.cache[copied];
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('uooc-login-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
};
