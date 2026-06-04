// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractWithClaude, EXTRACTION_TOOL } from '../engine/extractors/claude.mjs';

/** A fake Anthropic endpoint that records the request and returns a canned tool_use. */
function mockFetch(captured) {
  return async (url, init) => {
    captured.url = url;
    captured.headers = init.headers;
    captured.body = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({
        content: [{
          type: 'tool_use', name: EXTRACTION_TOOL.name,
          input: {
            parties: [{ id: 'a', name: 'A LLC', type: 'entity' }],
            documents: [{ id: 'OGL-2013', kind: 'oilGasLease', title: 'Lease', fields: [
              { path: 'royalty', label: 'Royalty', value: '1/5', snippet: 'Royalty: 1/5', confidence: 0.95 },
              { path: 'reservation.basis', label: 'Basis', value: 'floating', snippet: '…', confidence: 0.3 },
            ] }],
            notes: [],
          },
        }],
      }),
    };
  };
}

test('requires an API key', async () => {
  await assert.rejects(() => extractWithClaude('x', { apiKey: '' }), /apiKey is required/);
});

test('text input → text block, tool forced, prompt caching set', async () => {
  const cap = {};
  const result = await extractWithClaude('WARRANTY DEED ...', { apiKey: 'k', fetchImpl: mockFetch(cap) });
  assert.equal(cap.headers['x-api-key'], 'k');
  assert.equal(cap.body.tool_choice.name, EXTRACTION_TOOL.name);
  assert.equal(cap.body.system[0].cache_control.type, 'ephemeral');
  assert.equal(cap.body.tools[0].cache_control.type, 'ephemeral');
  const content = cap.body.messages[0].content;
  assert.ok(content.some((b) => b.type === 'text' && b.text.includes('WARRANTY DEED')));
  assert.ok(!content.some((b) => b.type === 'document'));
  // Parsed result carries the contract + defaulted statuses/needsDecision.
  assert.equal(result.engine, 'claude');
  const f = result.documents[0].fields;
  assert.equal(f[0].status, 'pending');
  assert.equal(f[1].needsDecision, true); // confidence 0.3 ≤ 0.4
});

test('PDF input → native document block (base64)', async () => {
  const cap = {};
  await extractWithClaude({ pdfBase64: 'JVBERi0xLjQK', mediaType: 'application/pdf' }, { apiKey: 'k', fetchImpl: mockFetch(cap) });
  const content = cap.body.messages[0].content;
  const docBlock = content.find((b) => b.type === 'document');
  assert.ok(docBlock, 'expected a document block');
  assert.equal(docBlock.source.type, 'base64');
  assert.equal(docBlock.source.media_type, 'application/pdf');
  assert.equal(docBlock.source.data, 'JVBERi0xLjQK');
});

test('surfaces API errors', async () => {
  const fetchImpl = async () => ({ ok: false, status: 429, text: async () => 'rate limited' });
  await assert.rejects(() => extractWithClaude('x', { apiKey: 'k', fetchImpl }), /429/);
});
