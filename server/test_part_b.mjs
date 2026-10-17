import assert from 'assert';
import WebSocket from 'ws';
import crypto from 'crypto';
import { db } from './dist/db.js';

console.log('=== PART B: GROUPS, BLOCK, REPORT VERIFICATION ===\n');

const BASE_URL = 'http://localhost:3001';
const ORIGIN = 'http://localhost:5173';
const WS_URL = 'ws://localhost:3001/ws';

const results = [];

function recordResult(testName, passed, details = '') {
  results.push({ test: testName, status: passed ? 'PASS' : 'FAIL', details });
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${testName} ${details ? '(' + details + ')' : ''}`);
}

async function signupUser(prefix, password = 'StrongPassword!2026') {
  const email = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`;
  const res = await fetch(`${BASE_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (res.status !== 201) throw new Error(`Signup failed: ${JSON.stringify(data)}`);

  let sessionCookie = '';
  const sc = res.headers.get('set-cookie');
  if (sc) {
    const list = res.headers.getSetCookie ? res.headers.getSetCookie() : [sc];
    for (const item of list) {
      if (item.includes('baigchat_sid=')) {
        sessionCookie = item.split(';')[0];
      }
    }
  }

  return {
    userId: data.user.id,
    email: data.user.email,
    csrfToken: data.csrfToken,
    sessionCookie,
  };
}

function connectWs(user) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL, {
      headers: {
        Origin: ORIGIN,
        Cookie: user.sessionCookie,
      },
    });

    const messages = [];

    ws.on('open', () => {
      resolve({
        ws,
        messages,
        waitForMessage: (filterFn, timeoutMs = 3000) => {
          return new Promise((res, rej) => {
            const start = Date.now();
            const check = () => {
              const idx = messages.findIndex(filterFn);
              if (idx !== -1) {
                const found = messages[idx];
                messages.splice(idx, 1);
                res(found);
                return;
              }
              if (Date.now() - start > timeoutMs) {
                rej(new Error(`Timeout waiting for message after ${timeoutMs}ms`));
                return;
              }
              setTimeout(check, 50);
            };
            check();
          });
        },
        close: () => ws.close(),
      });
    });

    ws.on('message', (raw) => {
      try {
        const parsed = JSON.parse(raw.toString());
        messages.push(parsed);
      } catch {}
    });

    ws.on('error', (err) => reject(err));
  });
}

async function runTests() {
  try {
    const owner = await signupUser('owner');
    const member = await signupUser('member');
    const stranger = await signupUser('stranger');
    const userA = await signupUser('usera');
    const userB = await signupUser('userb');

    // -------------------------------------------------------------
    // Test 1: Group Creation & Member Permissions
    // -------------------------------------------------------------
    console.log('\n--- Test 1: Member Permissions (cannot add/remove/promote/edit) ---');
    const createGroupRes = await fetch(`${BASE_URL}/api/groups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: owner.sessionCookie,
        'X-CSRF-Token': owner.csrfToken,
      },
      body: JSON.stringify({
        name: 'Engineering\x00 Team\x1F', // Tests stripping control characters
        memberIds: [member.userId],
      }),
    });
    const createGroupData = await createGroupRes.json();
    assert.strictEqual(createGroupRes.status, 201, 'Owner should create group');
    assert.strictEqual(createGroupData.group.name, 'Engineering Team', 'Control characters stripped from group name');
    const groupId = createGroupData.group.id;

    // Member tries to add member
    const memberAddRes = await fetch(`${BASE_URL}/api/groups/${groupId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: member.sessionCookie,
        'X-CSRF-Token': member.csrfToken,
      },
      body: JSON.stringify({ userId: stranger.userId }),
    });
    assert.strictEqual(memberAddRes.status, 403, 'Member must not be able to add members');

    // Member tries to remove member
    const memberRemoveRes = await fetch(`${BASE_URL}/api/groups/${groupId}/members/${owner.userId}`, {
      method: 'DELETE',
      headers: {
        Origin: ORIGIN,
        Cookie: member.sessionCookie,
        'X-CSRF-Token': member.csrfToken,
      },
    });
    assert.strictEqual(memberRemoveRes.status, 403, 'Member must not be able to remove members');

    // Member tries to promote
    const memberPromoteRes = await fetch(`${BASE_URL}/api/groups/${groupId}/members/${member.userId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: member.sessionCookie,
        'X-CSRF-Token': member.csrfToken,
      },
      body: JSON.stringify({ role: 'admin' }),
    });
    assert.strictEqual(memberPromoteRes.status, 403, 'Member must not be able to promote members');

    // Member tries to edit group name
    const memberEditRes = await fetch(`${BASE_URL}/api/groups/${groupId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: member.sessionCookie,
        'X-CSRF-Token': member.csrfToken,
      },
      body: JSON.stringify({ name: 'Hacked Name' }),
    });
    assert.strictEqual(memberEditRes.status, 403, 'Member must not be able to edit group details');

    // Member tries to create group invite
    const memberInviteRes = await fetch(`${BASE_URL}/api/groups/${groupId}/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: member.sessionCookie,
        'X-CSRF-Token': member.csrfToken,
      },
      body: JSON.stringify({ maxUses: 5 }),
    });
    assert.strictEqual(memberInviteRes.status, 403, 'Member must not be able to create group invites');

    recordResult('Member cannot add, remove, promote, edit, or invite', true);

    // -------------------------------------------------------------
    // Test 2: Admin cannot touch Owner
    // -------------------------------------------------------------
    console.log('\n--- Test 2: Admin cannot touch Owner ---');
    // Owner promotes member to admin
    const promoteToAdminRes = await fetch(`${BASE_URL}/api/groups/${groupId}/members/${member.userId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: owner.sessionCookie,
        'X-CSRF-Token': owner.csrfToken,
      },
      body: JSON.stringify({ role: 'admin' }),
    });
    assert.strictEqual(promoteToAdminRes.status, 200, 'Owner should promote member to admin');

    // Admin tries to demote owner
    const adminDemoteOwnerRes = await fetch(`${BASE_URL}/api/groups/${groupId}/members/${owner.userId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: member.sessionCookie,
        'X-CSRF-Token': member.csrfToken,
      },
      body: JSON.stringify({ role: 'member' }),
    });
    assert.strictEqual(adminDemoteOwnerRes.status, 403, 'Admin must not be able to demote owner');

    // Admin tries to remove owner
    const adminRemoveOwnerRes = await fetch(`${BASE_URL}/api/groups/${groupId}/members/${owner.userId}`, {
      method: 'DELETE',
      headers: {
        Origin: ORIGIN,
        Cookie: member.sessionCookie,
        'X-CSRF-Token': member.csrfToken,
      },
    });
    assert.strictEqual(adminRemoveOwnerRes.status, 403, 'Admin must not be able to remove owner');

    // Admin tries to delete group
    const adminDeleteGroupRes = await fetch(`${BASE_URL}/api/groups/${groupId}`, {
      method: 'DELETE',
      headers: {
        Origin: ORIGIN,
        Cookie: member.sessionCookie,
        'X-CSRF-Token': member.csrfToken,
      },
    });
    assert.strictEqual(adminDeleteGroupRes.status, 403, 'Admin must not be able to delete group');

    recordResult('Admin cannot touch owner (demote/remove) or delete group', true);

    // -------------------------------------------------------------
    // Test 3: Owner cannot leave (must delete)
    // -------------------------------------------------------------
    console.log('\n--- Test 3: Owner cannot leave ---');
    const ownerLeaveRes = await fetch(`${BASE_URL}/api/groups/${groupId}/leave`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: owner.sessionCookie,
        'X-CSRF-Token': owner.csrfToken,
      },
    });
    assert.strictEqual(ownerLeaveRes.status, 400, 'Owner must receive 400 when attempting to leave group');
    recordResult('Owner cannot leave group (must delete instead)', true);

    // -------------------------------------------------------------
    // Test 4: Removed user immediately loses WS & REST access
    // -------------------------------------------------------------
    console.log('\n--- Test 4: Removed user stops receiving WS events & 403 on REST ---');
    // Owner adds stranger to group
    const addStrangerRes = await fetch(`${BASE_URL}/api/groups/${groupId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: owner.sessionCookie,
        'X-CSRF-Token': owner.csrfToken,
      },
      body: JSON.stringify({ userId: stranger.userId }),
    });
    assert.strictEqual(addStrangerRes.status, 200, 'Owner adds stranger to group');

    const strangerWsClient = await connectWs(stranger);
    const ownerWsClient = await connectWs(owner);

    // Owner removes stranger
    const removeStrangerRes = await fetch(`${BASE_URL}/api/groups/${groupId}/members/${stranger.userId}`, {
      method: 'DELETE',
      headers: {
        Origin: ORIGIN,
        Cookie: owner.sessionCookie,
        'X-CSRF-Token': owner.csrfToken,
      },
    });
    assert.strictEqual(removeStrangerRes.status, 200, 'Owner removes stranger');

    // Stranger calls GET group info -> 403
    const strangerGetGroupRes = await fetch(`${BASE_URL}/api/groups/${groupId}`, {
      headers: { Origin: ORIGIN, Cookie: stranger.sessionCookie },
    });
    assert.strictEqual(strangerGetGroupRes.status, 403, 'Removed user gets 403 on GET /api/groups/:id');

    // Stranger calls GET messages -> 403
    const strangerGetMsgsRes = await fetch(`${BASE_URL}/api/conversations/${groupId}/messages`, {
      headers: { Origin: ORIGIN, Cookie: stranger.sessionCookie },
    });
    assert.strictEqual(strangerGetMsgsRes.status, 403, 'Removed user gets 403 on GET /api/conversations/:id/messages');

    // Stranger tries to send WS message to group
    strangerWsClient.ws.send(
      JSON.stringify({
        type: 'message:send',
        conversationId: groupId,
        clientMsgId: crypto.randomUUID(),
        content: 'I should be rejected',
      })
    );
    const strangerWsErr = await strangerWsClient.waitForMessage((m) => m.type === 'error');
    assert.strictEqual(strangerWsErr.error, 'Not a member of this conversation');

    // Owner sends message; stranger must NOT receive message:new
    ownerWsClient.ws.send(
      JSON.stringify({
        type: 'message:send',
        conversationId: groupId,
        clientMsgId: crypto.randomUUID(),
        content: 'Secret post-removal message',
      })
    );
    await ownerWsClient.waitForMessage((m) => m.type === 'message:ack');

    // Wait 500ms and verify stranger has NOT received this message
    await new Promise((r) => setTimeout(r, 500));
    const receivedSecret = strangerWsClient.messages.find(
      (m) => m.type === 'message:new' && m.message?.content === 'Secret post-removal message'
    );
    assert.strictEqual(receivedSecret, undefined, 'Removed user must not receive new group messages via WS');

    strangerWsClient.close();
    ownerWsClient.close();
    recordResult('Removed user gets 403 on REST and no WS events', true);

    // -------------------------------------------------------------
    // Test 5: Non-member cannot read group info or messages
    // -------------------------------------------------------------
    console.log('\n--- Test 5: Non-member cannot read group info/messages ---');
    const nonMemberGetRes = await fetch(`${BASE_URL}/api/groups/${groupId}`, {
      headers: { Origin: ORIGIN, Cookie: userA.sessionCookie },
    });
    assert.strictEqual(nonMemberGetRes.status, 403, 'Non-member gets 403 on group info');

    const nonMemberMsgsRes = await fetch(`${BASE_URL}/api/conversations/${groupId}/messages`, {
      headers: { Origin: ORIGIN, Cookie: userA.sessionCookie },
    });
    assert.strictEqual(nonMemberMsgsRes.status, 403, 'Non-member gets 403 on group messages');
    recordResult('Non-member gets 403 on group info and messages', true);

    // -------------------------------------------------------------
    // Test 6: Group Invite Redemption (Atomic max_uses, 100 cap, removed user blocked)
    // -------------------------------------------------------------
    console.log('\n--- Test 6: Group invite atomic redemption with max_uses and 100 cap ---');
    const inviteRes = await fetch(`${BASE_URL}/api/groups/${groupId}/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: owner.sessionCookie,
        'X-CSRF-Token': owner.csrfToken,
      },
      body: JSON.stringify({ maxUses: 2 }),
    });
    const inviteData = await inviteRes.json();
    assert.strictEqual(inviteRes.status, 201, 'Owner creates group invite with maxUses: 2');
    const groupToken = inviteData.token;

    // Preview
    const previewRes = await fetch(`${BASE_URL}/api/invites/${groupToken}`, {
      headers: { Origin: ORIGIN },
    });
    const previewData = await previewRes.json();
    assert.strictEqual(previewRes.status, 200);
    assert.strictEqual(previewData.isGroup, true);
    assert.strictEqual(previewData.groupName, 'Engineering Team');

    // User A redeems (use 1 of 2)
    const redeemARes = await fetch(`${BASE_URL}/api/invites/${groupToken}/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: userA.sessionCookie,
        'X-CSRF-Token': userA.csrfToken,
      },
    });
    assert.strictEqual(redeemARes.status, 200, 'User A should redeem invite');

    // User B redeems (use 2 of 2)
    const redeemBRes = await fetch(`${BASE_URL}/api/invites/${groupToken}/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: userB.sessionCookie,
        'X-CSRF-Token': userB.csrfToken,
      },
    });
    assert.strictEqual(redeemBRes.status, 200, 'User B should redeem invite');

    // User C tries to redeem (use 3 of 2 -> exhausted)
    const userC = await signupUser('userc');
    const redeemCRes = await fetch(`${BASE_URL}/api/invites/${groupToken}/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: userC.sessionCookie,
        'X-CSRF-Token': userC.csrfToken,
      },
    });
    assert.strictEqual(redeemCRes.status, 404, 'Exhausted invite returns generic 404');

    // Removed user (stranger) tries to redeem a newly created group invite -> rejected!
    const inviteRes2 = await fetch(`${BASE_URL}/api/groups/${groupId}/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: owner.sessionCookie,
        'X-CSRF-Token': owner.csrfToken,
      },
      body: JSON.stringify({ maxUses: 10 }),
    });
    const inviteData2 = await inviteRes2.json();

    const strangerRedeemRes = await fetch(`${BASE_URL}/api/invites/${inviteData2.token}/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: stranger.sessionCookie,
        'X-CSRF-Token': stranger.csrfToken,
      },
    });
    assert.strictEqual(strangerRedeemRes.status, 404, 'Removed user cannot redeem group invite');

    recordResult('Invite redeem is atomic with max_uses, and removed users cannot redeem', true);

    // -------------------------------------------------------------
    // Test 7: Blocked DMs silently dropped with generic ack & presence hidden
    // -------------------------------------------------------------
    console.log('\n--- Test 7: Blocked DMs silently dropped with generic ack ---');
    // User Alice blocks User Bob
    const alice = await signupUser('alice');
    const bob = await signupUser('bob');

    // Create 1:1 conversation between Alice and Bob first
    const dmInviteRes = await fetch(`${BASE_URL}/api/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: alice.sessionCookie,
        'X-CSRF-Token': alice.csrfToken,
      },
      body: JSON.stringify({ maxUses: 1 }),
    });
    const dmInviteData = await dmInviteRes.json();
    const dmAcceptRes = await fetch(`${BASE_URL}/api/invites/${dmInviteData.token}/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: bob.sessionCookie,
        'X-CSRF-Token': bob.csrfToken,
      },
    });
    const dmAcceptData = await dmAcceptRes.json();
    const dmConvoId = dmAcceptData.conversationId;

    // Alice blocks Bob
    const blockRes = await fetch(`${BASE_URL}/api/blocks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: alice.sessionCookie,
        'X-CSRF-Token': alice.csrfToken,
      },
      body: JSON.stringify({ userId: bob.userId }),
    });
    assert.strictEqual(blockRes.status, 201, 'Alice blocks Bob');

    // Bob connects to WS and sends a DM to Alice
    const bobWsClient = await connectWs(bob);
    const aliceWsClient = await connectWs(alice);

    bobWsClient.ws.send(
      JSON.stringify({
        type: 'message:send',
        conversationId: dmConvoId,
        clientMsgId: crypto.randomUUID(),
        content: 'Hello Alice, please unblock me',
      })
    );

    // Bob MUST receive generic ack ("sent")
    const bobAck = await bobWsClient.waitForMessage((m) => m.type === 'message:ack');
    assert.strictEqual(bobAck.status, 'sent', 'Blocked user receives normal sent ack');

    // Alice MUST NOT receive the message via WS
    await new Promise((r) => setTimeout(r, 500));
    const aliceReceived = aliceWsClient.messages.find(
      (m) => m.type === 'message:new' && m.message?.content?.includes('unblock')
    );
    assert.strictEqual(aliceReceived, undefined, 'Blocker must not receive blocked user message via WS');

    // Alice checks GET /api/conversations/:id/messages: message is NOT in DB
    const aliceGetMsgs = await fetch(`${BASE_URL}/api/conversations/${dmConvoId}/messages`, {
      headers: { Origin: ORIGIN, Cookie: alice.sessionCookie },
    });
    const aliceMsgsData = await aliceGetMsgs.json();
    const foundInDb = aliceMsgsData.messages.find((m) => m.content.includes('unblock'));
    assert.strictEqual(foundInDb, undefined, 'Blocked DM must be silently dropped and not stored');

    // Bob cannot redeem Alice's new invites
    const aliceNewInviteRes = await fetch(`${BASE_URL}/api/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: alice.sessionCookie,
        'X-CSRF-Token': alice.csrfToken,
      },
      body: JSON.stringify({ maxUses: 1 }),
    });
    const aliceNewInviteData = await aliceNewInviteRes.json();

    const bobRedeemAliceRes = await fetch(`${BASE_URL}/api/invites/${aliceNewInviteData.token}/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: bob.sessionCookie,
        'X-CSRF-Token': bob.csrfToken,
      },
    });
    assert.strictEqual(bobRedeemAliceRes.status, 404, 'Blocked user cannot redeem blocker invite');

    bobWsClient.close();
    aliceWsClient.close();
    recordResult('Blocked user DMs silently dropped with generic ack & invites blocked', true);

    // -------------------------------------------------------------
    // Test 8: Non-member cannot report, member report stores snapshot
    // -------------------------------------------------------------
    console.log('\n--- Test 8: Non-member cannot report, member report captures snapshot ---');
    // Non-member (stranger) tries to report in dmConvoId
    const nonMemberReportRes = await fetch(`${BASE_URL}/api/reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: stranger.sessionCookie,
        'X-CSRF-Token': stranger.csrfToken,
      },
      body: JSON.stringify({
        reportedUserId: bob.userId,
        conversationId: dmConvoId,
        reason: 'Harassment',
      }),
    });
    assert.strictEqual(nonMemberReportRes.status, 403, 'Non-member cannot file report for conversation');

    // Alice sends a valid message in dmConvoId to report
    const sendMsgRes = db
      .prepare(`
        INSERT INTO messages (conversation_id, sender_id, client_msg_id, content, type)
        VALUES (?, ?, ?, ?, 'user')
      `)
      .run(dmConvoId, bob.userId, crypto.randomUUID(), 'Offensive test message to report');
    const msgIdToReport = Number(sendMsgRes.lastInsertRowid);

    // Member (Alice) reports Bob's message
    const aliceReportRes = await fetch(`${BASE_URL}/api/reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: alice.sessionCookie,
        'X-CSRF-Token': alice.csrfToken,
      },
      body: JSON.stringify({
        reportedUserId: bob.userId,
        conversationId: dmConvoId,
        messageId: msgIdToReport,
        reason: 'Inappropriate content',
        details: 'User posted an offensive message',
      }),
    });
    const aliceReportData = await aliceReportRes.json();
    assert.strictEqual(aliceReportRes.status, 201, 'Member can submit report');

    // Verify snapshot in database
    const reportRow = db
      .prepare('SELECT message_snapshot, reason, status FROM reports WHERE id = ?')
      .get(aliceReportData.reportId);
    assert.strictEqual(reportRow.message_snapshot, 'Offensive test message to report', 'Snapshot captured correctly');

    recordResult('Non-member cannot report, member report captures message snapshot', true);

    // -------------------------------------------------------------
    // Test 9: Clients cannot send system messages
    // -------------------------------------------------------------
    console.log('\n--- Test 9: Clients cannot send system messages ---');
    const clientWs = await connectWs(owner);

    // 1. Try sending event type 'system' -> Rejected by WsIncomingEventSchema
    clientWs.ws.send(
      JSON.stringify({
        type: 'system',
        conversationId: groupId,
        content: 'Forged system message',
      })
    );
    const errResp = await clientWs.waitForMessage((m) => m.type === 'error');
    assert.ok(errResp.error, 'Event with type system must be rejected');

    // 2. Try sending message:send with a spoofed type or content
    const clientMsgId = crypto.randomUUID();
    clientWs.ws.send(
      JSON.stringify({
        type: 'message:send',
        conversationId: groupId,
        clientMsgId,
        content: 'I want to be a system message',
        messageType: 'system',
      })
    );
    await clientWs.waitForMessage((m) => m.type === 'message:ack');

    // Check DB: message MUST have type 'user'
    const dbMsg = db
      .prepare('SELECT type FROM messages WHERE conversation_id = ? AND client_msg_id = ?')
      .get(groupId, clientMsgId);
    assert.strictEqual(dbMsg.type, 'user', 'Client sent message must always be stored with type user');

    clientWs.close();
    recordResult('Clients cannot send system messages', true);
  } catch (err) {
    console.error('Test failed with error:', err);
    recordResult('Part B Verification Suite', false, err.message);
  }

  console.log('\n========================================');
  console.log('PART B VERIFICATION SUMMARY');
  console.log('========================================');
  console.table(results);

  const failedCount = results.filter((r) => r.status === 'FAIL').length;
  if (failedCount > 0) {
    console.error(`\nFAILED: ${failedCount} test(s) failed.`);
    process.exit(1);
  } else {
    console.log('\nALL PART B TESTS PASSED SUCCESSFULLY!');
  }
}

runTests();
