const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = __dirname;
const PORT = Number(process.env.UOOC_UI_PORT || 4177);
let runState = { running: false, output: [], startedAt: null, finishedAt: null, exitCode: null };

function buildDashboardState(config, status) {
  const byId = new Map();
  for (const url of config.courses || []) {
    let id;
    try { id = new URL(url).pathname.match(/\d+\/?$/)?.[0]?.replace(/\/$/, ''); } catch { continue; }
    if (!id) continue;
    const result = status.courses?.[url] || {};
    const prior = byId.get(id) || {};
    const name = config.courseNames?.[url] || prior.name || `课程 ${id}`;
    const rank = { failed: 4, signed: 3, already: 2, complete: 1 };
    const chosen = (rank[result.status] || 0) >= (rank[prior.status] || 0) ? result : prior;
    byId.set(id, { id, name, status: chosen.status || 'pending', count: chosen.count ?? null,
      total: chosen.total ?? null, checkedAt: chosen.checkedAt || null, error: chosen.countError || '' });
  }
  const courses = [...byId.values()];
  return { courses, summary: {
    total: courses.length,
    signed: courses.filter(c => ['already', 'signed', 'complete'].includes(c.status)).length,
    failed: courses.filter(c => c.status === 'failed').length,
    pending: courses.filter(c => c.status === 'pending').length,
  }, run: { ...runState } };
}

function getState() {
  let config = {}, status = {};
  try { config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')); } catch {}
  try { status = JSON.parse(fs.readFileSync(path.join(ROOT, '.uooc-status.json'), 'utf8')); } catch {}
  return buildDashboardState(config, status);
}
function send(res, code, data, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}
function isTrustedOrigin(req) {
  const host = req.headers.host || '';
  return (/^127\.0\.0\.1(?::\d+)?$/.test(host) || /^localhost(?::\d+)?$/.test(host))
    && req.headers.origin === `http://${host}`;
}
function server() {
  return http.createServer((req, res) => {
    const host = req.headers.host || '';
    if (!/^127\.0\.0\.1(?::\d+)?$/.test(host) && !/^localhost(?::\d+)?$/.test(host)) return send(res, 403, { error: '仅允许本机访问' });
    if (req.method === 'GET' && req.url === '/api/state') return send(res, 200, getState());
    if (req.method === 'POST' && req.url === '/api/run') {
      if (!isTrustedOrigin(req)) return send(res, 403, { error: '拒绝跨站请求' });
      if (runState.running) return send(res, 409, { error: '签到任务正在运行' });
      runState = { running: true, output: [], startedAt: new Date().toISOString(), finishedAt: null, exitCode: null };
      const child = spawn(process.execPath, [path.join(ROOT, 'uooc.js'), 'run'], { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
      const keep = chunk => { runState.output.push(chunk.toString('utf8').replace(/[\r\n]+$/g, '')); if (runState.output.length > 100) runState.output.shift(); };
      child.stdout.on('data', keep); child.stderr.on('data', keep);
      child.on('error', e => { runState.output.push(`启动失败：${e.message}`); runState.exitCode = 1; runState.running = false; runState.finishedAt = new Date().toISOString(); });
      child.on('close', code => { runState.exitCode = code; runState.running = false; runState.finishedAt = new Date().toISOString(); });
      return send(res, 202, { started: true });
    }
    if (req.method === 'GET' && req.url === '/') {
      try { return send(res, 200, fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8'), 'text/html; charset=utf-8'); }
      catch { return send(res, 500, { error: '界面文件缺失' }); }
    }
    return send(res, 404, { error: 'Not found' });
  });
}
if (require.main === module) server().listen(PORT, '127.0.0.1', () => console.log(`Uooc 签到面板：http://127.0.0.1:${PORT}`));
module.exports = { buildDashboardState, getState, server, isTrustedOrigin };
