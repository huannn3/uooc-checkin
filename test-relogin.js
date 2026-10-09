const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

module.exports = function () {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uooc-relogin-test-'));
  const urls = [1, 2, 3].map(id => `https://www.uooc.net.cn/home/course/${id}`);
  const oldAuth = '{"fixture":"original session"}';
  try {
    fs.copyFileSync(path.join(__dirname, 'uooc.js'), path.join(root, 'uooc.js'));
    const modules = path.join(root, 'node_modules', 'playwright');
    const fakeEdge = path.join(root, 'edge', 'Microsoft', 'Edge', 'Application');
    fs.mkdirSync(modules, { recursive: true });
    fs.mkdirSync(fakeEdge, { recursive: true });
    fs.writeFileSync(path.join(fakeEdge, 'msedge.exe'), 'fixture only');
    fs.writeFileSync(path.join(root, 'preload.js'), `
      const fs = require('node:fs'), path = require('node:path');
      const cp = require('node:child_process'), net = require('node:net');
      const {EventEmitter} = require('node:events');
      if (process.env.UOOC_RELOGIN_CASE === 'profile-failed') fs.mkdtempSync = () => { throw new Error('fixture temporary directory failure'); };
      if (process.env.UOOC_RELOGIN_CASE === 'save-failed') {
        const rename = fs.renameSync;
        fs.renameSync = (from,to) => { if (from.endsWith('.uooc-auth.json.tmp')) throw Object.assign(new Error('fixture lock'),{code:'EBUSY'}); return rename(from,to); };
      }
      global.metrics = {opens:0, clicks:0, submits:0, visited:[], closed:0};
      process.env.ProgramFiles = path.join(__dirname, 'edge');
      delete process.env['ProgramFiles(x86)'];
      process.env.WINDIR ||= 'C:\\Windows';
      cp.execFileSync = () => JSON.stringify({account:'fixture@example.invalid',password:'private-fixture-password'});
      cp.spawn = () => { metrics.opens++; const child = new EventEmitter(); child.unref = () => {}; return child; };
      net.createServer = () => {
        const server = new EventEmitter();
        server.listen = (_port, _host, ready) => ready();
        server.address = () => ({port:12345}); server.close = done => done(); return server;
      };
      global.fetch = async url => { if (!url.startsWith('http://127.0.0.1:')) throw new Error('External network forbidden in fixture'); return {ok:true}; };
      let elapsed = 0; const now = Date.now; Date.now = () => now() + elapsed;
      global.delay = async ms => { elapsed += ms; };
      process.on('exit', () => fs.writeFileSync(path.join(__dirname,'metrics.json'),JSON.stringify(metrics)));
    `);
    fs.writeFileSync(path.join(modules, 'index.js'), `
      const scenario = process.env.UOOC_RELOGIN_CASE;
      const response = (data, status=200) => ({ok:()=>status>=200&&status<300,status:()=>status,json:async()=>data});
      const today = new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
      const snapshot = {cookies:[{domain:'.uooc.net.cn',name:'fixture',value:'restored'}],origins:[]};
      const initialExpired = !['midway','count-expired','network502','normal'].includes(scenario);
      function context(restored) {
        const request = {get:async url => {
          if (scenario === 'network502') return response({},502);
          if (url.includes('/member/user')) return response({code: restored ? (scenario==='restore-failed'?401:1) : (initialExpired?401:1)});
          if (scenario === 'count-expired' && !restored && request.cid === '2') return response({code:401});
          return response({code:1,data:{signin_cnt:3,signin_total:30,signin_time:today}});
        }};
        return {request,close:async()=>{},storageState:async()=>snapshot,newPage:async()=>{
          let receipt;
          return {request,waitForTimeout:delay,close:async()=>{},
            waitForResponse:()=>new Promise(resolve=>{receipt=resolve;}),
            goto:async url=>{
              const cid = url.split('/').at(-1); request.cid=cid;
              metrics.visited.push(cid+':'+(restored?'new':'old'));
              const expired = (scenario==='midway' && !restored && cid==='2') || scenario==='again-expired';
              receipt(response({code:expired?401:1,data:{is_sign:1,name:'fixture course '+cid}}));
              return {ok:()=>true};
            }
          };
        }};
      }
      const runBrowser = {newContext:async options=>context(typeof options.storageState==='object'),close:async()=>{}};
      const button = {waitFor:async()=>{},isEnabled:async()=>true,click:async()=>{metrics.submits++;}};
      let passed = false;
      const values = {};
      const checkbox = {waitFor:async()=>{},boundingBox:async()=>({x:100,y:200,width:24,height:24}),
        click:async()=>{metrics.clicks++; passed = scenario!=='verification-failed'; if(scenario==='password-cleared') values['input[placeholder="密码"]:visible']='';}};
      const form = {getByRole:()=>button,getByText:()=>({isVisible:async()=>passed}),locator:()=>checkbox};
      const frame = {url:()=> 'https://www.uooc.net.cn/user/login',waitForLoadState:async()=>{},locator: selector=>({
        click:async()=>{if(scenario==='form-failed') throw new Error('private-fixture-password');},
        getAttribute:async()=>'',
        fill:async value=>{if(value !== (selector.includes('手机号/邮箱')?'fixture@example.invalid':'')) throw new Error('Unexpected fixture input'); values[selector]=value;},
        pressSequentially:async value=>{if(value!=='private-fixture-password') throw new Error('Unexpected fixture password'); values[selector]=value;},
        press:async()=>{},inputValue:async()=>values[selector]||'',
        locator:()=>form
      })};
      const loginPage = {url:()=> 'https://www.uooc.net.cn/league/union',frames:()=>[frame],locator:()=>({click:async()=>{}}),
        mouse:{move:async()=>{}},waitForTimeout:delay,goto:async()=>({ok:()=>scenario!=='login502'}),close:async()=>{metrics.closed++;}};
      const loginContext = {pages:()=>[loginPage],newPage:async()=>loginPage,
        request:{get:async()=>response({code:scenario==='password-failed'?401:1})},
        storageState:async()=>scenario==='empty-session'?{cookies:[],origins:[]}:snapshot};
      exports.chromium = {launch:async()=>runBrowser,connectOverCDP:async()=>({contexts:()=>[loginContext],close:async()=>{}})};
    `);

    const failures = ['verification-failed', 'password-failed', 'restore-failed', 'save-failed', 'profile-failed', 'login502', 'form-failed', 'empty-session'];
    for (const scenario of ['success', 'password-cleared', 'missing-session', 'midway', 'count-expired', 'again-expired', 'network502', 'normal', ...failures]) {
      fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ courses: urls, customField: 'preserved' }));
      fs.writeFileSync(path.join(root, '.uooc-auth.json'), oldAuth);
      fs.writeFileSync(path.join(root, '.uooc-login.dat'), 'isolated encrypted-data placeholder');
      fs.rmSync(path.join(root, '.uooc-status.json'), { force: true });
      if (scenario === 'missing-session') fs.unlinkSync(path.join(root, '.uooc-auth.json'));
      const child = spawnSync(process.execPath, ['-r', path.join(root, 'preload.js'), path.join(root, 'uooc.js'), 'run'], {
        env: { ...process.env, UOOC_RELOGIN_CASE: scenario }, encoding: 'utf8', timeout: 10000,
      });
      assert.ifError(child.error);
      const failed = failures.includes(scenario) || scenario === 'again-expired';
      assert.equal(child.status, scenario === 'network502' ? 1 : failed ? 2 : 0, scenario + '\n' + child.stdout + child.stderr);
      const metrics = JSON.parse(fs.readFileSync(path.join(root, 'metrics.json'), 'utf8'));
      const report = JSON.parse(fs.readFileSync(path.join(root, '.uooc-status.json'), 'utf8'));
      assert.equal(metrics.opens, ['network502', 'normal', 'profile-failed'].includes(scenario) ? 0 : 1, scenario + ': one recovery only');
      assert.ok(metrics.clicks <= 1 && metrics.submits <= 1, scenario + ': no repeated verification or login');
      assert.equal(report.loginExpired, failed);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8')).courses, urls);
      assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8')).customField, 'preserved');
      assert.ok(!child.stdout.includes('private-fixture-password') && !child.stdout.includes('fixture@example.invalid'));
      assert.equal(fs.existsSync(path.join(root,'.uooc-auth.json.tmp')),false, 'Remove temporary credential snapshots.');
      if (failures.includes(scenario) || scenario === 'network502') {
        assert.equal(fs.readFileSync(path.join(root, '.uooc-auth.json'), 'utf8'), oldAuth, scenario + ': preserve old session');
      }
      if (!failed && scenario !== 'network502') {
        assert.match(child.stdout, /成功 3，失败 0，未处理 0/);
        assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.uooc-auth.json'), 'utf8')).cookies[0].value, 'restored');
      }
      if (scenario === 'midway') assert.deepEqual(metrics.visited, ['1:old', '2:old', '2:new', '3:new']);
      if (scenario === 'count-expired') {
        assert.equal(report.courses[urls[1]].status, 'signed');
        assert.equal(report.courses[urls[1]].count, null, 'Keep confirmed attendance when counts could not be fetched.');
        assert.deepEqual(metrics.visited, ['1:old', '2:old', '3:new']);
      }
      if (scenario === 'again-expired') assert.equal(metrics.visited.length, 1, 'Stop after renewed login expires again.');
      if (scenario === 'verification-failed') assert.equal(metrics.submits, 0);
      if (metrics.opens) assert.equal(metrics.closed, 1, 'Close only the temporary login page.');
    }
    console.log('通过：签到前及途中掉登恢复一次、恢复后继续课程、缺少快照、再次掉登停止、502不触发、失败保留原凭据及无敏感输出（独立模拟账户）。');
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('uooc-relogin-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
};
