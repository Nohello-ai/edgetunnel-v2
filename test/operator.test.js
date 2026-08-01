import assert from 'node:assert/strict';
import test from 'node:test';
import { identifyOperator } from '../src/net/operator.js';

test('identifyOperator returns cf for non-China traffic', () => {
  assert.equal(identifyOperator({ country: 'US', asn: '15169', asOrganization: 'Google LLC' }), 'cf');
  assert.equal(identifyOperator({ country: 'JP', asn: '2516', asOrganization: 'KDDI' }), 'cf');
  assert.equal(identifyOperator({ country: 'HK' }), 'cf');
});

test('identifyOperator returns cf for missing or invalid cf', () => {
  assert.equal(identifyOperator(null), 'cf');
  assert.equal(identifyOperator(undefined), 'cf');
  assert.equal(identifyOperator({}), 'cf');
});

test('identifyOperator matches China Telecom by ASN', () => {
  assert.equal(identifyOperator({ country: 'CN', asn: '4134', asOrganization: 'CHINANET' }), 'ct');
  assert.equal(identifyOperator({ country: 'CN', asn: '4809', asOrganization: 'CHINATELECOM' }), 'ct');
  assert.equal(identifyOperator({ country: 'CN', asn: '4812', asOrganization: 'China Telecom' }), 'ct');
});

test('identifyOperator matches China Unicom by ASN', () => {
  assert.equal(identifyOperator({ country: 'CN', asn: '4837', asOrganization: 'CHINA169' }), 'cu');
  assert.equal(identifyOperator({ country: 'CN', asn: '9929', asOrganization: 'China Unicom' }), 'cu');
  assert.equal(identifyOperator({ country: 'CN', asn: '17623', asOrganization: 'CNC Group' }), 'cu');
});

test('identifyOperator matches China Mobile by ASN', () => {
  assert.equal(identifyOperator({ country: 'CN', asn: '9808', asOrganization: 'China Mobile' }), 'cmcc');
  assert.equal(identifyOperator({ country: 'CN', asn: '24400', asOrganization: 'CMNET' }), 'cmcc');
  assert.equal(identifyOperator({ country: 'CN', asn: '56040', asOrganization: 'China Mobile Communications' }), 'cmcc');
});

test('identifyOperator matches by organization keyword when ASN is unknown', () => {
  assert.equal(identifyOperator({ country: 'CN', asn: '99999', asOrganization: 'CHINANET-BACKBONE' }), 'ct');
  assert.equal(identifyOperator({ country: 'CN', asn: '99999', asOrganization: 'China Mobile Communications' }), 'cmcc');
  assert.equal(identifyOperator({ country: 'CN', asn: '99999', asOrganization: 'China Unicom Broadband' }), 'cu');
});

test('identifyOperator falls back to cf for unknown CN ASN without keyword match', () => {
  assert.equal(identifyOperator({ country: 'CN', asn: '99999', asOrganization: 'Some Unknown ISP' }), 'cf');
  assert.equal(identifyOperator({ country: 'CN', asn: '99999', asOrganization: '' }), 'cf');
});