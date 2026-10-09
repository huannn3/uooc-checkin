const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');

const ROOT = __dirname;
const CONFIG = path.join(ROOT, 'config.json');
const PROFILE = path.join(ROOT, '.uooc-profile');
const AUTH = path.join(ROOT, '.uooc-auth.json');
const STATUS = path.join(ROOT, '.uooc-status.json');
const ORIGIN = 'https://www.uooc.net.cn';
const HOSTS = ['www.uooc.net.cn', 'uooc.net.cn'];

function courseUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !HOSTS.includes(url.hostname)
      || url.port || url.username || url.password
      || !/^\/home\/(?:course|learn(?:\/new)?)\/\d+\/?$/.test(url.pathname)) {
    throw new Error('请使用点击继续学习后的 Uooc 地址（/home/course/数字 或 /home/learn/new/数字）。');
  }
  const route = url.pathname.replace(/\/$/, '');
  return url.origin + route + (route.includes('/learn/') ? url.search + url.hash : '');
}

function readCourses() {
  if (!fs.existsSync(CONFIG)) return [];
  const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8').replace(/^\uFEFF/, ''));
  if (!Array.isArray(config.courses)) throw new Error('config.json 的 courses 必须是数组。');
  return [...new Set(config.courses.map(courseUrl))];
}

function saveCourses(courses, names = {}) {
  const config = fs.existsSync(CONFIG) ? JSON.parse(fs.readFileSync(CONFIG, 'utf8').replace(/^\uFEFF/, '')) : {};
  fs.writeFileSync(CONFIG, JSON.stringify({ ...config, courses,
    courseNames: { ...config.courseNames, ...names } }, null, 2) + '\n', 'utf8');
}

function log(message) {
  const time = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const line = `[${time}] ${message}\n`;
  process.stdout.write(line);
  fs.appendFileSync(path.join(ROOT, 'uooc.log'), line, 'utf8');
}

async function saveStatus(value, file = STATUS) {
  const json = JSON.stringify(value, null, 2) + '\n';
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      fs.writeFileSync(file + '.tmp', json, 'utf8');
      fs.renameSync(file + '.tmp', file);
      return true;
    } catch (error) {
      if (!['EBUSY', 'EPERM', 'EACCES'].includes(error.code) || attempt === 5) {
        log(`显示缓存暂未保存（${error.code || '未知错误'}），签到核实仍继续；请查看活动记录。`);
        return false;
      }
      await new Promise(resolve => setTimeout(resolve, 50 * 2 ** attempt));
    }
  }
}

function readStatus() {
  try { return JSON.parse(fs.readFileSync(STATUS, 'utf8')); } catch { return {}; }
}

function loginError() {
  return Object.assign(new Error('登录已失效，请在助手中点击“登录 / 添加课程”重新登录。'), { code: 'LOGIN_EXPIRED' });
}

async function checkLogin(request, origin, timeout = 10000) {
  await responseData(await request.get(origin + '/home/member/user', { timeout }));
}

function readSavedLogin() {
  if (!fs.existsSync(path.join(ROOT, '.uooc-login.dat'))) return null;
  try {
    const helper = path.join(process.env.WINDIR, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const login = JSON.parse(execFileSync(helper, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'credentials.ps1'), '-Mode', 'read'],
      { encoding: 'utf8', windowsHide: true, timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] }));
    if (typeof login?.account !== 'string' || !login.account || typeof login.password !== 'string' || !login.password) throw new Error();
    return login;
  } catch { log('保存的登录账号暂不可用，请重新设置或手动登录。'); return null; }
}

async function fillLogin(page, login, timeout = 300000) {
  // Only the observed HTTPS Uooc login frame may receive credentials.
  const trusted = value => { try { const url = new URL(value); return url.protocol === 'https:' && url.origin === ORIGIN && !url.username && !url.password; } catch { return false; } };
  if (!trusted(page.url())) throw new Error('登录页面来源不正确。');
  await page.locator('#loginBtn').click();
  const deadline = Date.now() + 15000;
  let frame;
  while (Date.now() < deadline) {
    frame = page.frames().find(item => trusted(item.url()) && new URL(item.url()).pathname === '/user/login');
    if (frame) break;
    await page.waitForTimeout(250);
  }
  if (!frame) throw new Error('未找到登录表单。');
  await frame.waitForLoadState('load', { timeout: 30000 });
  await frame.locator('#passwd_li').click();
  if (!trusted(frame.url())) throw new Error('登录页面来源已改变。');
  const account = frame.locator('input[placeholder="手机号/邮箱"]:visible');
  await account.fill(login.account);
  if (!trusted(frame.url())) throw new Error('登录页面来源已改变。');
  await frame.locator('input[placeholder="密码"]:visible').fill(login.password);
  log('账号密码已自动填入；正在尝试点击验证框一次。');
  const form = account.locator('xpath=ancestor::form');
  const button = form.getByRole('button', { name: '登录', exact: true });
  await button.waitFor({ state: 'visible', timeout });
  const passed = () => form.getByText(/验证通过[!！]?/).isVisible();
  let manualNotice = false;
  if (!await passed()) {
    try {
      const checkbox = form.locator('#aliyunCaptcha-checkbox-icon:visible');
      await checkbox.waitFor({ state: 'visible', timeout: 5000 });
      if (!trusted(frame.url())) throw new Error('登录页面来源已改变。');
      const box = await checkbox.boundingBox();
      if (!box) throw new Error('验证框不可见。');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
      if (!trusted(frame.url())) throw new Error('登录页面来源已改变。');
      await checkbox.click({ timeout: 3000 });
      log('已点击验证框一次，等待网站验证结果。');
    } catch {
      log('未能完成自动点击，请在 Edge 中手动完成验证；通过后会自动提交登录。');
      manualNotice = true;
    }
  }
  // One ordinary click only; additional challenges are left to the user.
  const manualAt = Date.now() + 5000;
  const stopAt = Date.now() + timeout;
  while (Date.now() < stopAt) {
    if (!trusted(frame.url())) throw new Error('登录页面来源已改变。');
    if (await passed() && await button.isEnabled()) {
      await button.click();
      return;
    }
    if (!manualNotice && Date.now() >= manualAt) {
      log('自动点击暂未完成验证，请在 Edge 中手动处理；程序不会重复点击或处理进一步的验证题。');
      manualNotice = true;
    }
    await page.waitForTimeout(500);
  }
  throw new Error('等待验证通过超时。');
}

function signinCounts(progress) {
  const values = [progress.signin_cnt, progress.signin_total];
  if (!values.every(value => value !== null && value !== undefined && /^\d+$/.test(String(value).trim()))) return {};
  const [count, total] = values.map(Number);
  return Number.isSafeInteger(count) && Number.isSafeInteger(total) ? { count, total } : {};
}

function playwright() {
  try { return require('playwright'); } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    // 这台电脑已有 Codex 提供的 Playwright，无需重复安装。
    const bundled = path.join(os.homedir(), '.cache', 'codex-runtimes',
      'codex-primary-runtime', 'dependencies', 'node', 'node_modules', 'playwright');
    if (fs.existsSync(bundled)) return require(bundled);
    throw new Error('缺少 Playwright，请先运行 npm install。');
  }
}

function siteState(state) {
  return {
    cookies: state.cookies.filter(cookie => HOSTS.includes(cookie.domain.replace(/^\./, ''))),
    origins: state.origins.filter(origin => HOSTS.includes(new URL(origin.origin).hostname)),
  };
}

async function openSetupBrowser(profile = PROFILE) {
  const candidates = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA]
    .filter(Boolean).map(base => path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  const executable = candidates.find(file => fs.existsSync(file));
  if (!executable) throw new Error('未找到 Microsoft Edge。');
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  // 普通 Edge 启动；只在本机开放调试连接，自动流程未成功时由用户接手。
  const child = spawn(executable, [
    `--user-data-dir=${profile}`, '--profile-directory=Default',
    '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`,
    '--no-first-run', '--new-window', ORIGIN + '/league/union',
  ], { stdio: 'ignore' });
  let launchError;
  child.once('error', error => { launchError = error; });
  child.unref();
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    try {
      const result = await fetch(endpoint + '/json/version', { signal: AbortSignal.timeout(1000) });
      if (result.ok) return await playwright().chromium.connectOverCDP(endpoint);
    } catch { /* 浏览器启动中，稍后重试。 */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('无法连接配置窗口。请关闭之前脚本打开的所有 Edge 窗口，再运行 setup。');
}

async function autoLogin() {
  const login = readSavedLogin();
  if (!login) { log('未配置可用的登录账号，请点击“登录账号设置”保存账号，或手动重新登录。'); return null; }
  let browser, profile;
  try {
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'uooc-relogin-'));
    browser = await openSetupBrowser(profile);
    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.newPage();
    const response = await page.goto(ORIGIN + '/league/union', { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!response?.ok()) throw new Error('登录页面不可用。');
    await fillLogin(page, login, 30000);
    // Login submission can finish after the button click. Retry only an unconfirmed session.
    for (let attempt = 0; ; attempt++) {
      try { await checkLogin(context.request, ORIGIN, 5000); break; } catch (error) {
        if (error.code !== 'LOGIN_EXPIRED' || attempt === 9) throw error;
        await page.waitForTimeout(500);
      }
    }
    const state = siteState(await context.storageState({ indexedDB: true }));
    if (!state.cookies.length && !state.origins.length) throw new Error('未取得可恢复的会话。');
    return state;
  } catch {
    // Playwright errors can include filled values. Keep account/password out of logs.
    log('自动登录未能完成；可能需要手动验证、检查账号密码，或等待平台恢复后重试。');
    return null;
  } finally {
    login.password = '';
    if (browser) {
      for (const context of browser.contexts()) for (const page of context.pages()) await page.close().catch(() => {});
      await browser.close().catch(() => {});
    }
    if (profile) {
      const resolved = path.resolve(profile);
      if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('uooc-relogin-')) {
        try { fs.rmSync(resolved, { recursive: true, force: true }); } catch { /* Edge may still be releasing temporary files. */ }
      }
    }
  }
}

function signinResult(info, progress, today) {
  if (String(info.is_sign) === '1') return { status: 'signed' };
  if (String(progress.signin_time || '').slice(0, 10) === today) {
    return { status: 'already', count: progress.signin_cnt };
  }
  const count = Number(progress.signin_cnt);
  const total = Number(progress.signin_total);
  if (Number.isFinite(count) && total > 0 && count >= total) return { status: 'complete', count, total };
  throw new Error(`已进入课程，但未确认今日签到；最近记录：${progress.signin_time || '无'}。`);
}

async function responseData(response) {
  if (response.status() === 401) throw loginError();
  if (!response.ok()) throw new Error(`课程接口 HTTP ${response.status()}。`);
  if (response.url && /\/(?:login|signin)(?:\/|$)/i.test(new URL(response.url()).pathname)) throw loginError();
  let data;
  try { data = await response.json(); } catch { throw new Error('课程接口返回了非 JSON 内容。'); }
  if (String(data.code) === '401' || (String(data.code) !== '1' && /未登[录陆]|请(?:先|重新)?登[录陆]|登[录陆](?:已)?(?:失效|过期|超时)/.test(String(data.msg || '')))) throw loginError();
  if (String(data.code) !== '1') {
    const message = String(data.msg || '未知错误').replace(/[\r\n]/g, ' ').slice(0, 160);
    throw new Error(`网站接口未返回成功（code=${data.code}）：${message}`);
  }
  return data.data || {};
}

async function visitCourse(page, url, timeout = 30000, previous = {}) {
  const cid = new URL(url).pathname.match(/\d+\/?$/)[0].replace(/\/$/, '');
  // 当前页面通过 /home/course/info 的 is_sign 字段返回签到结果。
  // 必须先监听再进入页面，响应可能早于页面加载完成。
  const receipt = page.waitForResponse(response => {
    const endpoint = new URL(response.url());
    return ['http:', 'https:'].includes(endpoint.protocol) && HOSTS.includes(endpoint.hostname)
      && !endpoint.port && endpoint.pathname === '/home/course/info'
      && endpoint.searchParams.get('cid') === cid && response.request().method() === 'GET';
  }, { timeout }).then(response => ({ response }), () => ({ response: null }));
  const navigation = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  if (navigation?.status?.() === 401) throw loginError();
  if (!navigation || !navigation.ok()) throw new Error('课程页面请求失败，请检查网络和登录状态。');
  if (page.url && /\/(?:login|signin)(?:\/|$)/i.test(new URL(page.url()).pathname)) throw loginError();
  const { response } = await receipt;
  if (!response) throw new Error('未收到课程信息响应，请检查页面是否正常加载。');
  const info = await responseData(response);
  const title = info.parent_name || info.name || info.course_name || `课程 ${cid}`;
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const previousDay = previous.checkedAt ? new Date(previous.checkedAt).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }) : '';
  // 成绩提供次数；新签到已确认时，次数查询失败不能抹掉签到结果。
  let progress;
  let countPending = false;
  try {
    // 网站的新签到标记可能早于成绩次数更新，等待当天记录及计数一起同步。
    for (let attempt = 0; attempt < 6; attempt++) {
      progress = await responseData(await page.request.get(new URL('/home/course/progress', url).href, {
        params: { cid, _: Date.now() }, headers: { 'Cache-Control': 'no-cache' }, timeout,
      }));
      const counts = signinCounts(progress);
      const atTarget = counts.total > 0 && counts.count >= counts.total;
      const expectIncrease = previousDay && previousDay < today && Number.isSafeInteger(previous.count)
        && previous.total === counts.total && previous.count < counts.total;
      const fresh = String(progress.signin_time || '').slice(0, 10) === today
        && (!expectIncrease || counts.count > previous.count);
      countPending = String(info.is_sign) === '1' && counts.count !== undefined && !atTarget && !fresh;
      if (!countPending || attempt === 5) break;
      await page.waitForTimeout(500 * 2 ** attempt);
    }
  } catch (error) {
    if (String(info.is_sign) !== '1') throw error;
    return { status: 'signed', title, countError: error.message, loginExpired: error.code === 'LOGIN_EXPIRED' };
  }
  const counts = signinCounts(progress);
  const result = { ...signinResult(info, progress, today), ...counts, title };
  if (countPending) {
    result.countPending = true;
    result.countError = '签到已确认，网站成绩次数尚待同步；当前显示旧次数，不自行加一。';
  }
  if (counts.count === undefined) {
    delete result.count;
    delete result.total;
    result.countError = '成绩接口未提供有效的签到次数。';
  }
  return result;
}

async function main() {
  const mode = process.argv[2] || 'run';
  if (!['login', 'setup', 'run'].includes(mode) || process.argv.slice(3).some(x => x !== '--visible')) {
    throw new Error('用法：node uooc.js setup | node uooc.js run [--visible]');
  }
  const courses = readCourses();
  const setup = mode === 'setup' || mode === 'login';
  if (!setup && !courses.length) {
    throw new Error('请先运行 setup，在浏览器中登录并逐个进入需要签到的课程。');
  }
  const browser = setup ? await openSetupBrowser() : await playwright().chromium.launch({
    channel: 'msedge', headless: !process.argv.includes('--visible'), chromiumSandbox: true,
  });
  try {
    let context = setup ? browser.contexts()[0] : await browser.newContext({ storageState: fs.existsSync(AUTH) ? AUTH : undefined });
    if (setup) {
      let saving = Promise.resolve();
      let savePending = false;
      let savedLogin = false;
      const saveLogin = sourceUrl => {
        if (savePending) return;
        savePending = true;
        saving = (async () => {
          const check = await context.request.get(new URL(sourceUrl).origin + '/home/member/user', { timeout: 10000 });
          if (!check.ok() || String((await check.json()).code) !== '1') return;
          const state = siteState(await context.storageState({ indexedDB: true }));
          if (!state.cookies.length && !state.origins.length) return;
          fs.writeFileSync(AUTH, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
          if (!savedLogin) log('已验证登录，并保存可供下次运行使用的登录状态。');
          savedLogin = true;
          // 清除旧的失效提示，保留此前的课程次数。
          const previous = readStatus();
          await saveStatus({ ...previous, loginExpired: false, updatedAt: new Date().toISOString() });
        })().catch(() => {}).finally(() => { savePending = false; });
      };
      let finish;
      const closed = new Promise(resolve => { finish = resolve; browser.once('disconnected', resolve); });
      const remember = page => {
        page.once('close', () => { if (!context.pages().length) finish(); });
        page.on('framenavigated', frame => {
          if (frame !== page.mainFrame()) return;
          let url;
          try { url = courseUrl(frame.url()); } catch { return; }
          saveLogin(url);
          if (courses.some(saved => new URL(saved).hostname === new URL(url).hostname
              && new URL(saved).pathname === new URL(url).pathname)) return;
          courses.push(url);
          saveCourses(courses);
          log(`已保存课程 ${url}`);
        });
      };
      context.pages().forEach(remember);
      context.on('page', remember);
      context.on('response', response => {
        const url = new URL(response.url());
        if (HOSTS.includes(url.hostname) && url.pathname.startsWith('/home/')) saveLogin(response.url());
      });
      log('请在 Edge 中登录，逐个进入需要签到的课程；完成后关闭这个 Edge 窗口。');
      log('课程和登录状态在同一个窗口记录，请勿分享 .uooc-auth.json 或 .uooc-profile。');
      const login = readSavedLogin();
      if (login) {
        const page = context.pages().find(item => item.url().startsWith(ORIGIN + '/'));
        if (page) {
          let loggedIn = false;
          try { await checkLogin(context.request, ORIGIN); loggedIn = true; saveLogin(page.url()); } catch { }
          if (!loggedIn) {
            try { await fillLogin(page, login); } catch { log('自动填写流程已结束；如未登录，请在窗口中手动完成登录。'); }
          }
        }
        login.password = '';
      }
      await closed;
      await saving;
      log(`配置完成，共 ${courses.length} 门课程；本次登录状态${savedLogin ? '已保存' : '未验证成功，请重新配置'}。`);
      if (!savedLogin || !courses.length) process.exitCode = 1;
    } else {
      let failures = 0;
      let successes = 0;
      const previous = readStatus();
      const report = { updatedAt: new Date().toISOString(), loginExpired: Boolean(previous.loginExpired), courses: previous.courses || {} };
      const origins = new Set(courses.map(url => new URL(url).origin));
      let recoveryAttempted = false;
      const recover = async error => {
        if (error.code !== 'LOGIN_EXPIRED' || recoveryAttempted) return false;
        recoveryAttempted = true;
        log('检测到登录失效，尝试自动重新登录（本次运行最多一次）。');
        const state = await autoLogin();
        if (!state) return false;
        let restored;
        try {
          restored = await browser.newContext({ storageState: state });
          for (const origin of origins) await checkLogin(restored.request, origin);
          fs.writeFileSync(AUTH + '.tmp', JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
          fs.renameSync(AUTH + '.tmp', AUTH);
        } catch {
          if (restored) await restored.close().catch(() => {});
          log('新登录会话未能核实或保存，自动恢复未完成；请手动重新登录。');
          return false;
        } finally {
          try { fs.rmSync(AUTH + '.tmp', { force: true }); } catch { }
        }
        const previousContext = context;
        context = restored;
        await previousContext.close().catch(() => {});
        report.loginExpired = false;
        delete report.error;
        log('自动登录成功，已保存并核实可恢复的登录状态，继续签到。');
        return true;
      };
      const visit = async url => {
        for (;;) {
          const page = await context.newPage();
          let result, error;
          try { result = await visitCourse(page, url, 30000, report.courses[url]); }
          catch (caught) { error = caught; }
          finally { await page.close().catch(() => {}); }
          if (error) {
            if (await recover(error)) continue;
            throw error;
          }
          if (result.loginExpired && await recover(loginError())) {
            result.loginExpired = false;
            result.countError = '本课程签到已确认，登录已自动恢复；次数将在下次签到检查时刷新。';
          }
          return result;
        }
      };
      // 先验证会话，避免跳回登录页后只得到课程响应超时。
      for (const origin of origins) {
        try {
          if (!fs.existsSync(AUTH)) throw loginError();
          await checkLogin(context.request, origin);
        } catch (error) {
          if (await recover(error)) continue;
          if (error.code === 'LOGIN_EXPIRED') report.loginExpired = true;
          report.error = error.message;
          for (const url of courses) {
            report.courses[url] = { ...report.courses[url], status: 'failed', countError: error.message, lastAttemptAt: new Date().toISOString() };
          }
          await saveStatus(report);
          throw error;
        }
      }
      report.loginExpired = false;
      for (const url of courses) {
        try {
          const result = await visit(url);
          const label = { signed: '今日签到成功', already: '今日已签到', complete: '签到次数已满' }[result.status];
          const counts = result.count === undefined ? '；签到次数暂不可用' : `；签到次数 ${result.count}/${result.total}${result.countPending ? '（待同步）' : ''}`;
          log(`${label}：${result.title}（${url}）${counts}`);
          if (result.countError) log(`次数查询提示：${result.countError}`);
          successes++;
          report.courses[url] = { status: result.status, count: result.count ?? null, total: result.total ?? null,
            countError: result.countError || '', countPending: Boolean(result.countPending), checkedAt: new Date().toISOString() };
          report.loginExpired = Boolean(result.loginExpired);
          saveCourses(courses, { [url]: result.title });
          if (!report.loginExpired) fs.writeFileSync(AUTH, JSON.stringify(siteState(await context.storageState({ indexedDB: true }))), 'utf8');
        } catch (error) {
          failures++;
          log(`失败：${url}；${error.message}`);
          report.loginExpired = error.code === 'LOGIN_EXPIRED';
          report.error = error.message;
          report.courses[url] = { ...report.courses[url], status: 'failed', countError: error.message, lastAttemptAt: new Date().toISOString() };
        }
        report.updatedAt = new Date().toISOString();
        await saveStatus(report);
        if (report.loginExpired) break;
      }
      log(`运行完成：成功 ${successes}，失败 ${failures}，未处理 ${courses.length - successes - failures}。签到次数以成绩页为准。`);
      process.exitCode = report.loginExpired ? 2 : failures ? 1 : 0;
    }
  } finally { await browser.close(); }
}

module.exports = { courseUrl, readCourses, visitCourse, signinResult, signinCounts, checkLogin, saveStatus, siteState, playwright, fillLogin, readSavedLogin, openSetupBrowser };
if (require.main === module) main().catch(error => {
  log(`错误：${error.message}`);
  process.exitCode = error.code === 'LOGIN_EXPIRED' ? 2 : 1;
});
