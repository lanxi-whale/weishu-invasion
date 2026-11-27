#!/usr/bin/env node
// 4v4/start.js — 一个服务器进程，一个地址：两套玩法（盟约阵营 / 怪物阵营）都走同一个端口
//
//   主地址        http://localhost:3100        盟约阵营（干员方 / 主界面）
//   怪物阵营      http://monster.localhost:3100  同一个端口，用子域名区分（浏览器把 *.localhost 解析到本机）
//   直连备用      http://localhost:3101        怪物阵营的原始端口（局域网 / 浏览器不认 *.localhost 时用）
//
// 实现：两个游戏实例仍在同一个 Node 进程里（各自的 data：怪物方带 monsterOnly，只留 chess_mon_*），
// 3100 那台作为对外的服务器：Host 是 monster.localhost 的请求（含 WebSocket 升级）转发给 3101 那台。
// 这样外面只看到一个端口、一次启动；波次走进程内总线，不落文件也能用。
//
// 端口可用环境变量覆盖：OPS_PORT / MON_PORT。

import http from 'node:http';
import net from 'node:net';

const OPS_PORT = Number(process.env.OPS_PORT || 3100);
const MON_PORT = Number(process.env.MON_PORT || 3101);
const MON_HOST = (process.env.MON_HOST || 'monster.localhost').toLowerCase();

// 干员方的 waves.js 用 OPS_MODE 判断「出怪读怪物方的波次」；必须在 import 之前设好（ESM 是静态提升的）
process.env.OPS_MODE = '1';
// Live spectators consume the authoritative server snapshots.
process.env.SP_COMBAT = 'server';

const ports = { ops: OPS_PORT, monster: MON_PORT };
const log = (...a) => console.log(...a);

const { startServer: startOps } = await import('./game_ops/server/index.js');
const { startServer: startMonster } = await import('./game/server/index.js');
const { connectCampLobbies } = await import('./bridge/camp-lobby.js');
const { createInvasionReportHandler } = await import('./bridge/invasion-report.js');

const servers = [];

async function boot(label, fn, port, camp) {
  const srv = await fn({ port, camp: { camp, ports, front: OPS_PORT, monHost: MON_HOST, versionDataSnapshot: true, invasionReport: true } });
  servers.push(srv);
  log(`[4v4] ${label}  :${srv.port}`);
  return srv;
}

/** 这个请求是不是发给怪物阵营的（Host 为 monster.localhost[:port]） */
function wantsMonster(hostHeader) {
  const host = String(hostHeader || '').split(':')[0].toLowerCase();
  return host === MON_HOST;
}

/** 普通 HTTP：把请求转给怪物阵营那台（同一进程里的 127.0.0.1:MON_PORT） */
function proxyHttp(req, res) {
  const up = http.request({
    host: '127.0.0.1', port: MON_PORT, method: req.method, path: req.url,
    headers: { ...req.headers, host: `${MON_HOST}:${OPS_PORT}` },
  }, (r) => {
    res.writeHead(r.statusCode || 502, r.headers);
    r.pipe(res);
  });
  up.on('error', (e) => {
    log('[4v4] proxy error', e && e.message);
    try { res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }); res.end('侵略阵营没有启动'); } catch { /* ignore */ }
  });
  req.pipe(up);
}

/** WebSocket 升级：原样转给 3101（ws 服务器在那边处理握手） */
function proxyUpgrade(req, socket, head) {
  const up = net.connect(MON_PORT, '127.0.0.1', () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    up.write(lines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) up.write(head);
    socket.pipe(up);
    up.pipe(socket);
  });
  up.on('error', () => { try { socket.destroy(); } catch { /* ignore */ } });
  socket.on('error', () => { try { up.destroy(); } catch { /* ignore */ } });
}

/** 把对外那台（ops）的 request / upgrade 监听换成「按 Host 分流」 */
function installFrontRouter(front, back) {
  const serveInvasionReport = createInvasionReportHandler(back.versions);
  const httpHandlers = front.server.listeners('request');
  const backHttpHandlers = back.server.listeners('request');
  const upHandlers = front.server.listeners('upgrade');
  const backUpHandlers = back.server.listeners('upgrade');
  front.server.removeAllListeners('request');
  back.server.removeAllListeners('request');
  front.server.removeAllListeners('upgrade');
  front.server.on('request', (req, res) => {
    if (serveInvasionReport(req, res)) return;
    if (wantsMonster(req.headers.host)) { proxyHttp(req, res); return; }
    for (const fn of httpHandlers) fn(req, res);
  });
  back.server.on('request', (req, res) => {
    if (serveInvasionReport(req, res)) return;
    for (const fn of backHttpHandlers) fn(req, res);
  });
  front.server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    if (wantsMonster(req.headers.host)) { proxyUpgrade(req, socket, head); return; }
    for (const fn of upHandlers) fn(req, socket, head);
  });
  // 怪物阵营那台自己也要能直接访问（局域网 / 调试）：它的 upgrade 监听保持原样
  void backUpHandlers;
}

let closed = false;
async function shutdown(signal) {
  if (closed) return;
  closed = true;
  log(`\n[4v4] ${signal} — 正在关闭…`);
  await Promise.all(servers.map((s) => s.close().catch((e) => log('[4v4] close', e))));
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

try {
  log('[4v4] 启动服务器（两套玩法，一个端口）…');
  const ops = await boot('盟约阵营（干员方）', startOps, OPS_PORT, 'ops');
  const mon = await boot('侵略阵营', startMonster, MON_PORT, 'monster');
  connectCampLobbies(ops.lobby, mon.lobby);
  installFrontRouter(ops, mon);
  log('');
  log(`[4v4] 就绪：http://localhost:${OPS_PORT}/`);
  log(`[4v4] 阵营选择里选「侵略阵营」会进同一端口的 http://${MON_HOST}:${OPS_PORT}/`);
} catch (e) {
  log('[4v4] 启动失败：', e && e.message ? e.message : e);
  await Promise.all(servers.map((s) => s.close().catch(() => {})));
  process.exit(1);
}
