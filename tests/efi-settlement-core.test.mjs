import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const build = mkdtempSync(join(tmpdir(), 'sonara-efi-tests-'));
const esbuild = process.platform === 'win32'
  ? join(root, 'node_modules', '.pnpm', readdirSync(join(root, 'node_modules', '.pnpm')).find((name) => name.startsWith('@esbuild+win32-x64@')) ?? 'missing-esbuild', 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe')
  : join(root, 'node_modules', '.bin', 'esbuild');

function bundle(source, name) {
  const output = join(build, name + '.cjs');
  const args = [source, '--bundle', '--platform=node', '--format=cjs', '--target=node22', `--outfile=${output}`];
  execFileSync(esbuild, args, { cwd: root, stdio: 'pipe' });
  return import(pathToFileURL(output).href).then((module) => module.default ?? module);
}

const settlement = await bundle('functions/_shared/efi-settlement-core.ts', 'settlement');
const pricing = await bundle('functions/_shared/pricing.ts', 'pricing');
const guards = await bundle('functions/_shared/activation-guards.ts', 'guards');
const validTxid = 'smabc1234567890';
const baseOrder = { provider: 'efi', paid: false, txid: validTxid, paymentId: validTxid, value: 39.9 };

test.after(() => rmSync(build, { recursive: true, force: true }));

test('confirma pagamento Efí concluído mesmo sem navegador (fluxo compartilhado pelo scanner)', () => {
  const charge = { txid: validTxid, status: 'CONCLUIDA', paid: true, value: 39.90 };
  assert.equal(settlement.settlementDecision(baseOrder, charge), 'confirmed');
});

test('mantém cobrança pendente fora do fluxo de liberação', () => {
  assert.equal(settlement.settlementDecision(baseOrder, { txid: validTxid, status: 'ATIVA', paid: false, value: 39.9 }), 'pending');
});

test('rejeita valor Efí divergente', () => {
  assert.equal(settlement.settlementDecision(baseOrder, { txid: validTxid, status: 'CONCLUIDA', paid: true, value: 39.91 }), 'mismatch');
});

test('rejeita TXID inválido ou de outra cobrança', () => {
  assert.equal(settlement.settlementDecision(baseOrder, { txid: 'external-txid', status: 'CONCLUIDA', paid: true, value: 39.9 }), 'mismatch');
  assert.equal(settlement.isSonaraTxid('external-txid'), false);
});

test('não reprocessa pedido já confirmado', () => {
  assert.equal(settlement.settlementDecision({ ...baseOrder, paid: true }, { txid: validTxid, status: 'CONCLUIDA', paid: true, value: 39.9 }), 'duplicate');
});

test('falha temporária de consulta é classificável para retry', () => {
  assert.equal(settlement.settlementDecision(baseOrder, null), 'retry');
});

test('falha de geração fica elegível para retry sem duplicar task já criada', () => {
  assert.equal(guards.shouldStartAutoGeneration({ source: 'auto', sunorStartRequested: false }, true), true);
  assert.equal(guards.shouldStartAutoGeneration({ source: 'auto', sunor_task_id: 'task-1' }, true), false);
});

test('falha de e-mail não marca entrega como enviada e permanece retryável', () => {
  assert.equal(guards.shouldRetryDeliveryEmail({ treblo_status: 'success', deliveryEmailSent: false, email: 'a@b.com' }, true), true);
  assert.equal(guards.shouldRetryDeliveryEmail({ treblo_status: 'success', deliveryEmailSent: true, email: 'a@b.com' }, true), false);
});

test('Spotify e Playback usam apenas a precificação do backend', () => {
  const configured = { ...pricing.DEFAULT_PRICING, base: 40, spotify: 80, playback: 22 };
  assert.equal(pricing.calculateOrderValue(configured, { spotify: true, playback: true }), 142);
});

test('recuperação aceita TXID Sonara e preço de arte dinâmico tem fallback seguro', async () => {
  assert.equal(settlement.isSonaraTxid('smrabc123'), true);
  const kv = { get: async () => JSON.stringify({ art: 12.5 }) };
  assert.equal((await pricing.getPricing(kv)).art, 12.5);
  const invalidKv = { get: async () => JSON.stringify({ art: 'invalid', base: -1 }) };
  assert.equal((await pricing.getPricing(invalidKv)).art, 9);
  assert.equal((await pricing.getPricing(invalidKv)).base, 39.9);
  assert.equal((await pricing.getPricing(undefined)).art, 9);
});
