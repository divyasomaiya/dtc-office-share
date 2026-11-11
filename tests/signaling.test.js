'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { WebSocket } = require('ws');
const { createServer } = require('../src/server');

describe('Signaling Server & WebSocket Protocol', () => {
  let app;
  const testPort = 3199;

  before((t, done) => {
    app = createServer({ port: testPort });
    app.start(done);
  });

  after((t, done) => {
    app.close(done);
  });

  test('peer joins, receives self profile and empty peer list', async () => {
    const ws = new WebSocket(`ws://localhost:${testPort}`);

    await new Promise((resolve) => ws.on('open', resolve));

    const messagePromise = new Promise((resolve) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        resolve(msg);
      });
    });

    ws.send(JSON.stringify({
      type: 'join',
      name: 'Tester-1',
      deviceType: 'desktop'
    }));

    const welcomeMsg = await messagePromise;
    assert.strictEqual(welcomeMsg.type, 'peers');
    assert.strictEqual(welcomeMsg.self.name, 'Tester-1');
    assert.strictEqual(welcomeMsg.self.deviceType, 'desktop');
    assert.strictEqual(welcomeMsg.peers.length, 0);

    ws.close();
  });

  test('two peers discover each other and exchange WebRTC signaling messages', async () => {
    const ws1 = new WebSocket(`ws://localhost:${testPort}`);
    const ws2 = new WebSocket(`ws://localhost:${testPort}`);

    await Promise.all([
      new Promise((res) => ws1.on('open', res)),
      new Promise((res) => ws2.on('open', res))
    ]);

    let peer1Id = null;
    let peer2Id = null;

    // Helper to receive message of specific type
    function waitForMessage(ws, expectedType) {
      return new Promise((resolve) => {
        const onMsg = (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === expectedType) {
            ws.off('message', onMsg);
            resolve(msg);
          }
        };
        ws.on('message', onMsg);
      });
    }

    const ws1JoinPromise = waitForMessage(ws1, 'peers');
    ws1.send(JSON.stringify({ type: 'join', name: 'Peer-Alpha', deviceType: 'desktop' }));
    const p1Join = await ws1JoinPromise;
    peer1Id = p1Join.self.id;

    const ws2JoinPromise = waitForMessage(ws2, 'peers');
    const ws1PeerUpdatePromise = waitForMessage(ws1, 'peers');
    ws2.send(JSON.stringify({ type: 'join', name: 'Peer-Beta', deviceType: 'phone' }));

    const [p2Join, p1Updated] = await Promise.all([ws2JoinPromise, ws1PeerUpdatePromise]);
    peer2Id = p2Join.self.id;

    assert.ok(p2Join.peers.some(p => p.id === peer1Id));
    assert.ok(p1Updated.peers.some(p => p.id === peer2Id));

    // Test transfer request relay
    const transferReqPromise = waitForMessage(ws2, 'transfer-request');
    ws1.send(JSON.stringify({
      type: 'transfer-request',
      target: peer2Id,
      transferId: 'tx-1234',
      files: [{ name: 'report.pdf', size: 1024 }],
      totalSize: 1024
    }));

    const receivedReq = await transferReqPromise;
    assert.strictEqual(receivedReq.from, peer1Id);
    assert.strictEqual(receivedReq.transferId, 'tx-1234');
    assert.strictEqual(receivedReq.files[0].name, 'report.pdf');

    // Test transfer response relay
    const transferResPromise = waitForMessage(ws1, 'transfer-response');
    ws2.send(JSON.stringify({
      type: 'transfer-response',
      target: peer1Id,
      transferId: 'tx-1234',
      accepted: true
    }));

    const receivedRes = await transferResPromise;
    assert.strictEqual(receivedRes.from, peer2Id);
    assert.strictEqual(receivedRes.transferId, 'tx-1234');
    assert.strictEqual(receivedRes.accepted, true);

    // Test WebRTC signal relay
    const offerPromise = waitForMessage(ws2, 'signal-offer');
    ws1.send(JSON.stringify({
      type: 'signal-offer',
      target: peer2Id,
      sdp: { type: 'offer', sdp: 'fake-sdp-data' }
    }));

    const receivedOffer = await offerPromise;
    assert.strictEqual(receivedOffer.from, peer1Id);
    assert.strictEqual(receivedOffer.sdp.sdp, 'fake-sdp-data');

    ws1.close();
    ws2.close();
  });

  test('notifies client if target peer does not exist', async () => {
    const ws = new WebSocket(`ws://localhost:${testPort}`);
    await new Promise((res) => ws.on('open', res));

    const notFoundPromise = new Promise((resolve) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'peer-not-found') resolve(msg);
      });
    });

    ws.send(JSON.stringify({
      type: 'signal-offer',
      target: 'non-existent-peer-id',
      sdp: {}
    }));

    const resp = await notFoundPromise;
    assert.strictEqual(resp.type, 'peer-not-found');
    assert.strictEqual(resp.target, 'non-existent-peer-id');

    ws.close();
  });
});
