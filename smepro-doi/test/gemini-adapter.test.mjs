// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractWithGemini } from '../engine/extractors/gemini.mjs';

/** A fake Gemini endpoint that records the request and returns canned JSON. */
function mockFetch(captured, { fenced = false } = {}) {
  const payload = {
    parties: [{ id: 'a', name: 'A LLC', type: 'entity' }],
    documents: [{ id: 'OGL-2013', kind: 'oilGasLease', title: 'Lease', fields: [
      { path: 'royalty', label: 'Royalty', value: '1/5', snippet: 'Royalty: 1/5', confidence: 0.95 },
      { path: 'reservation.basis', label: 'Basis', value: 'floating', snippet: '…', confidence: 0.3 },
    ] }],
    notes: [],
  };
  const text = fenced ? '```json\n' + JSON.stringify(payload) + '\n```' : JSON.stringify(payload);
  return async (url, init) => {
    captured.url = url;
    captured.headers = init.headers;
    captured.body = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
    };
  };
}

test('requires an API key', async () => {
  await assert.rejects(() => extractWithGemini('x', { apiKey: '' }), /apiKey is required/);
});

test('text input → text part, JSON mode set, key in header (not URL)', async () => {
  const cap = {};
  const result = await extractWithGemini('WARRANTY DEED ...', { apiKey: 'k', fetchImpl: mockFetch(cap) });
  assert.equal(cap.headers['x-goog-api-key'], 'k');
  assert.ok(!String(cap.url).includes('k'), 'API key must not be in the request URL');
  assert.equal(cap.body.generationConfig.responseMimeType, 'application/json');
  assert.equal(cap.body.generationConfig.temperature, 0);
  const parts = cap.body.contents[0].parts;
  assert.ok(parts.some((p) => p.text && p.text.includes('WARRANTY DEED')));
  assert.ok(!parts.some((p) => p.inlineData));
  // Parsed result carries the contract + defaulted statuses/needsDecision.
  assert.equal(result.engine, 'gemini');
  const f = result.documents[0].fields;
  assert.equal(f[0].status, 'pending');
  assert.equal(f[1].needsDecision, true); // confidence 0.3 ≤ 0.4
});

test('PDF input → native inlineData block (base64)', async () => {
  const cap = {};
  await extractWithGemini({ pdfBase64: 'JVBERi0xLjQK', mediaType: 'application/pdf' }, { apiKey: 'k', fetchImpl: mockFetch(cap) });
  const parts = cap.body.contents[0].parts;
  const docPart = parts.find((p) => p.inlineData);
  assert.ok(docPart, 'expected an inlineData part');
  assert.equal(docPart.inlineData.mimeType, 'application/pdf');
  assert.equal(docPart.inlineData.data, 'JVBERi0xLjQK');
});

test('tolerates ```json fenced output', async () => {
  const cap = {};
  const result = await extractWithGemini('x', { apiKey: 'k', fetchImpl: mockFetch(cap, { fenced: true }) });
  assert.equal(result.documents[0].fields[0].value, '1/5');
});

test('surfaces API errors', async () => {
  const fetchImpl = async () => ({ ok: false, status: 429, text: async () => 'rate limited' });
  await assert.rejects(() => extractWithGemini('x', { apiKey: 'k', fetchImpl }), /429/);
});
