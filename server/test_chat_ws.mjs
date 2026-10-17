import WebSocket from 'ws';

const BASE = 'http://localhost:3001';
const WS_URL = 'ws://localhost:3001/ws';

async function createUser(prefix) {
  const email = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@example.com`;
  const password = 'Password123!';
  let rawSessionCookie = '';
  let csrfToken = '';

  const res = await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost:5173' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (res.status !== 201) throw new Error(`Signup failed: ${JSON.stringify(data)}`);

  const sc = res.headers.get('set-cookie');
  if (sc) {
    const list = res.headers.getSetCookie ? res.headers.getSetCookie() : [sc];
    for (const item of list) {
      if (item.includes('baigchat_sid=')) {
        rawSessionCookie = item.split(';')[0];
      }
    }
  }

  return {
    email: email.toLowerCase(),
    userId: data.user.id,
    csrfToken: data.csrfToken,
    sessionCookie: rawSessionCookie,
  };
}

async function createPairConversation(userA, userB) {
  // A creates invite
  const inviteRes = await fetch(`${BASE}/api/invites`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'http://localhost:5173',
      'Cookie': userA.sessionCookie,
      'X-CSRF-Token': userA.csrfToken,
    },
    body: JSON.stringify({}),
  });
  const inviteData = await inviteRes.json();
  if (inviteRes.status !== 201) throw new Error(`Failed to create invite: ${JSON.stringify(inviteData)}`);

  // B accepts invite
  const acceptRes = await fetch(`${BASE}/api/invites/${inviteData.token}/accept`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'http://localhost:5173',
      'Cookie': userB.sessionCookie,
      'X-CSRF-Token': userB.csrfToken,
    },
  });
  const acceptData = await acceptRes.json();
  if (acceptRes.status !== 200) throw new Error(`Failed to accept invite: ${JSON.stringify(acceptData)}`);

  return acceptData.conversationId;
}

function connectWs(user, origin = 'http://localhost:5173') {
  return new Promise((resolve, reject) => {
    const headers = { Origin: origin };
    if (user && user.sessionCookie) {
      headers['Cookie'] = user.sessionCookie;
    }
    const ws = new WebSocket(WS_URL, { headers });

    const openTimer = setTimeout(() => {
      reject(new Error('WS connection timeout'));
    }, 5000);

    ws.on('open', () => {
      clearTimeout(openTimer);
      resolve(ws);
    });

    ws.on('unexpected-response', (req, res) => {
      clearTimeout(openTimer);
      reject(new Error(`Upgrade rejected with HTTP ${res.statusCode}`));
    });

    ws.on('error', (err) => {
      clearTimeout(openTimer);
      reject(err);
    });
  });
}

function waitForEvent(ws, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for event`));
    }, timeoutMs);

    function onMessage(data) {
      try {
        const parsed = JSON.parse(data.toString());
        if (predicate(parsed)) {
          cleanup();
          resolve(parsed);
        }
      } catch (e) {
        // ignore
      }
    }

    function cleanup() {
      clearTimeout(timer);
      ws.off('message', onMessage);
    }

    ws.on('message', onMessage);
  });
}

async function runTests() {
  const results = [];

  console.log('1. Setting up test users and conversation...');
  const userA = await createUser('userA');
  const userB = await createUser('userB');
  const userC = await createUser('userC'); // non-member
  const conversationId = await createPairConversation(userA, userB);

  // Test 1: Unauthenticated upgrade rejected
  try {
    await connectWs(null, 'http://localhost:5173');
    results.push({ test: 'Unauthenticated upgrade rejected', passed: false });
  } catch (err) {
    const passed = err.message.includes('401');
    results.push({ test: 'Unauthenticated upgrade rejected (HTTP 401)', passed, detail: err.message });
  }

  // Test 2: Bad Origin upgrade rejected
  try {
    await connectWs(userA, 'http://evil.com');
    results.push({ test: 'Bad Origin upgrade rejected', passed: false });
  } catch (err) {
    const passed = err.message.includes('403');
    results.push({ test: 'Bad Origin upgrade rejected (HTTP 403)', passed, detail: err.message });
  }

  // Connect valid sockets for User A and User B
  const wsA = await connectWs(userA);
  const wsB = await connectWs(userB);

  // Test 3: Oversized payload closes socket (maxPayload 16KB)
  try {
    const wsTemp = await connectWs(userA);
    const bigPayload = JSON.stringify({
      type: 'message:send',
      conversationId,
      clientMsgId: 'big-msg',
      content: 'x'.repeat(20000), // ~20KB payload
    });

    const closePromise = new Promise((resolve) => {
      wsTemp.on('close', (code) => resolve(code));
    });

    wsTemp.send(bigPayload);
    const closeCode = await closePromise;
    // ws package closes with 1009 (Message Too Big)
    const passed = closeCode === 1009 || closeCode === 1006;
    results.push({ test: 'Oversized payload (>16KB) closes socket', passed, detail: `Close code: ${closeCode}` });
  } catch (err) {
    results.push({ test: 'Oversized payload (>16KB) closes socket', passed: false, detail: err.message });
  }

  // Test 4: send -> ack -> delivered -> read flow
  let firstMsgId;
  try {
    const clientMsgId = 'test-msg-1-' + Date.now();
    const ackPromise = waitForEvent(wsA, (e) => e.type === 'message:ack' && e.clientMsgId === clientMsgId);
    const newMsgPromise = waitForEvent(wsB, (e) => (e.type === 'message:new' || e.type === 'new_message') && e.message?.clientMsgId === clientMsgId);
    const deliveredPromise = waitForEvent(wsA, (e) => e.type === 'message:delivered' && e.clientMsgId === clientMsgId);

    wsA.send(
      JSON.stringify({
        type: 'message:send',
        conversationId,
        clientMsgId,
        content: 'Hello User B!',
      })
    );

    const [ackEvent, newMsgEvent, deliveredEvent] = await Promise.all([ackPromise, newMsgPromise, deliveredPromise]);
    firstMsgId = ackEvent.message.id;

    // Now User B reads the message
    const readPromise = waitForEvent(wsA, (e) => (e.type === 'message:read' || e.type === 'messages_read') && e.conversationId === conversationId);
    wsB.send(
      JSON.stringify({
        type: 'message:read',
        conversationId,
        messageId: firstMsgId,
      })
    );
    const readEvent = await readPromise;

    const passed = !!(ackEvent && newMsgEvent && deliveredEvent && readEvent);
    results.push({ test: 'Send -> Ack -> Delivered -> Read flow', passed });
  } catch (err) {
    results.push({ test: 'Send -> Ack -> Delivered -> Read flow', passed: false, detail: err.message });
  }

  // Test 5: Duplicate clientMsgId returns same message (idempotency)
  try {
    const duplicateClientMsgId = 'dup-msg-' + Date.now();
    // First send
    const ack1Promise = waitForEvent(wsA, (e) => e.type === 'message:ack' && e.clientMsgId === duplicateClientMsgId);
    wsA.send(
      JSON.stringify({
        type: 'message:send',
        conversationId,
        clientMsgId: duplicateClientMsgId,
        content: 'Original content',
      })
    );
    const ack1 = await ack1Promise;

    // Retry send with same clientMsgId
    const ack2Promise = waitForEvent(wsA, (e) => e.type === 'message:ack' && e.clientMsgId === duplicateClientMsgId);
    wsA.send(
      JSON.stringify({
        type: 'message:send',
        conversationId,
        clientMsgId: duplicateClientMsgId,
        content: 'Original content retry',
      })
    );
    const ack2 = await ack2Promise;

    const passed = ack1.message.id === ack2.message.id && ack1.message.clientMsgId === ack2.message.clientMsgId;
    results.push({ test: 'Duplicate clientMsgId returns existing message (no duplicate)', passed, detail: `ID: ${ack1.message.id}` });
  } catch (err) {
    results.push({ test: 'Duplicate clientMsgId returns existing message', passed: false, detail: err.message });
  }

  // Test 6: Non-member send is rejected (IDOR protection)
  try {
    const wsC = await connectWs(userC);
    const errorPromise = waitForEvent(wsC, (e) => e.type === 'error' && e.error.includes('Not a member'));

    wsC.send(
      JSON.stringify({
        type: 'message:send',
        conversationId, // User C does NOT belong to this conversation
        clientMsgId: 'idor-msg-' + Date.now(),
        content: 'Unauthorized intrusion',
      })
    );

    const errorEvent = await errorPromise;
    wsC.close();
    results.push({ test: 'Non-member send rejected with error (IDOR protection)', passed: true });
  } catch (err) {
    results.push({ test: 'Non-member send rejected with error', passed: false, detail: err.message });
  }

  // Test 7: Reconnect + sync:request returns missed messages
  try {
    // User B disconnects
    wsB.close();

    // User A sends message while User B is offline
    const offlineMsgId = 'offline-msg-' + Date.now();
    const ackOfflinePromise = waitForEvent(wsA, (e) => e.type === 'message:ack' && e.clientMsgId === offlineMsgId);
    wsA.send(
      JSON.stringify({
        type: 'message:send',
        conversationId,
        clientMsgId: offlineMsgId,
        content: 'Message while you were away',
      })
    );
    const ackOffline = await ackOfflinePromise;

    // User B reconnects and asks for sync:request
    const wsB2 = await connectWs(userB);
    const syncPromise = waitForEvent(wsB2, (e) => e.type === 'sync:response' && e.conversationId === conversationId);

    wsB2.send(
      JSON.stringify({
        type: 'sync:request',
        conversationId,
        afterId: firstMsgId, // ask for messages after firstMsgId
      })
    );

    const syncResponse = await syncPromise;
    const hasOfflineMsg = syncResponse.messages.some((m) => m.clientMsgId === offlineMsgId);

    wsB2.close();
    results.push({ test: 'Reconnect + sync:request returns missed messages', passed: hasOfflineMsg });
  } catch (err) {
    results.push({ test: 'Reconnect + sync:request returns missed messages', passed: false, detail: err.message });
  }

  wsA.close();

  console.log('\n--- WEBSOCKET VERIFICATION RESULTS ---');
  for (const r of results) {
    console.log(`${r.passed ? 'PASS' : 'FAIL'} | ${r.test} ${r.detail ? '(' + r.detail + ')' : ''}`);
  }

  const allPassed = results.every((r) => r.passed);
  if (!allPassed) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
