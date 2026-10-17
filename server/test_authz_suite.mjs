import assert from 'assert';
import WebSocket from 'ws';
import crypto from 'crypto';
import { db } from './dist/db.js';

const BASE_URL = 'http://localhost:3001';
const ORIGIN = 'http://localhost:5173';
const WS_URL = 'ws://localhost:3001/ws';

const results = [];

function recordResult(testName, passed, details = '') {
  results.push({ test: testName, status: passed ? 'PASS' : 'FAIL', details });
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${testName} ${details ? '(' + details + ')' : ''}`);
}

async function signupUser(prefix, password = 'StrongPassword!2026') {
  const timestamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 7);
  const email = `${prefix}_${timestamp}_${rand}@authz.test`;
  const res = await fetch(`${BASE_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ email, password, termsAccepted: true }),
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

async function runAuthzTests() {
  console.log('=== STARTING AUTOMATED AUTHORIZATION TEST SUITE ===\n');

  try {
    const userA = await signupUser('user_a');
    const userB = await signupUser('user_b');
    const stranger = await signupUser('stranger');

    // Setup conversation between A and B
    const invRes = await fetch(`${BASE_URL}/api/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: userA.sessionCookie,
        'X-CSRF-Token': userA.csrfToken,
      },
      body: JSON.stringify({}),
    });
    const invData = await invRes.json();
    const inviteToken = invData.token;

    await fetch(`${BASE_URL}/api/invites/${inviteToken}/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: userB.sessionCookie,
        'X-CSRF-Token': userB.csrfToken,
      },
    });

    const convosA = await (
      await fetch(`${BASE_URL}/api/conversations`, {
        headers: { Cookie: userA.sessionCookie, Origin: ORIGIN },
      })
    ).json();
    const convoId = convosA.conversations[0].id;

    // Send a message from A
    const msgInsert = db
      .prepare(
        "INSERT INTO messages (conversation_id, sender_id, client_msg_id, content, type) VALUES (?, ?, ?, ?, 'user')"
      )
      .run(convoId, userA.userId, 'authz_msg_' + Date.now(), 'Private conversation message');
    const messageId = Number(msgInsert.lastInsertRowid);

    // -------------------------------------------------------------
    // 1. Non-members cannot read, send to, search, react, edit, or delete in other people's chats
    // -------------------------------------------------------------
    console.log('--- Test 1: Non-member Resource Authorization ---');
    const readRes = await fetch(`${BASE_URL}/api/conversations/${convoId}/messages`, {
      headers: { Cookie: stranger.sessionCookie, Origin: ORIGIN },
    });
    const searchRes = await fetch(
      `${BASE_URL}/api/messages/search?q=Private&conversationId=${convoId}`,
      {
        headers: { Cookie: stranger.sessionCookie, Origin: ORIGIN },
      }
    );
    const reactRes = await fetch(`${BASE_URL}/api/messages/${messageId}/reactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: stranger.sessionCookie,
        Origin: ORIGIN,
        'X-CSRF-Token': stranger.csrfToken,
      },
      body: JSON.stringify({ emoji: '👍' }),
    });
    const editRes = await fetch(`${BASE_URL}/api/messages/${messageId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: stranger.sessionCookie,
        Origin: ORIGIN,
        'X-CSRF-Token': stranger.csrfToken,
      },
      body: JSON.stringify({ content: 'Hacked edit' }),
    });
    const deleteRes = await fetch(`${BASE_URL}/api/messages/${messageId}?mode=everyone`, {
      method: 'DELETE',
      headers: {
        Cookie: stranger.sessionCookie,
        Origin: ORIGIN,
        'X-CSRF-Token': stranger.csrfToken,
      },
    });

    const nonMemberAllDenied =
      readRes.status === 403 &&
      searchRes.status === 403 &&
      reactRes.status === 403 &&
      editRes.status === 403 &&
      deleteRes.status === 403;

    recordResult(
      'Non-members cannot read, search, react, edit, or delete in other conversations',
      nonMemberAllDenied,
      `read=${readRes.status}, search=${searchRes.status}, react=${reactRes.status}, edit=${editRes.status}, delete=${deleteRes.status}`
    );

    // -------------------------------------------------------------
    // 2. Members cannot act as admin or owner
    // -------------------------------------------------------------
    console.log('\n--- Test 2: Role Hierarchy & Privilege Escalation Guard ---');
    const groupRes = await (
      await fetch(`${BASE_URL}/api/groups`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: userA.sessionCookie,
          'X-CSRF-Token': userA.csrfToken,
        },
        body: JSON.stringify({
          name: 'Authz Security Group',
          memberIds: [userB.userId],
        }),
      })
    ).json();
    const groupId = groupRes.group.id;

    // Member B tries to add stranger to group -> 403
    const memberAdd = await fetch(`${BASE_URL}/api/groups/${groupId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: userB.sessionCookie,
        'X-CSRF-Token': userB.csrfToken,
      },
      body: JSON.stringify({ userId: stranger.userId }),
    });

    // Member B tries to change group name -> 403
    const memberRename = await fetch(`${BASE_URL}/api/groups/${groupId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: userB.sessionCookie,
        'X-CSRF-Token': userB.csrfToken,
      },
      body: JSON.stringify({ name: 'Hacked Group Name' }),
    });

    // Member B tries to delete group -> 403
    const memberDeleteGroup = await fetch(`${BASE_URL}/api/groups/${groupId}`, {
      method: 'DELETE',
      headers: {
        Origin: ORIGIN,
        Cookie: userB.sessionCookie,
        'X-CSRF-Token': userB.csrfToken,
      },
    });

    const memberPrivilegeBlocked =
      memberAdd.status === 403 && memberRename.status === 403 && memberDeleteGroup.status === 403;

    recordResult(
      'Group members cannot act as admin or owner (escalation blocked)',
      memberPrivilegeBlocked,
      `add=${memberAdd.status}, rename=${memberRename.status}, deleteGroup=${memberDeleteGroup.status}`
    );

    // -------------------------------------------------------------
    // 3. Blocked users cannot message or redeem invites
    // -------------------------------------------------------------
    console.log('\n--- Test 3: Block Enforcement on Messaging and Invites ---');
    // User A blocks Stranger
    await fetch(`${BASE_URL}/api/blocks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: userA.sessionCookie,
        'X-CSRF-Token': userA.csrfToken,
      },
      body: JSON.stringify({ userId: stranger.userId }),
    });

    // User A creates an invite
    const blockInvRes = await (
      await fetch(`${BASE_URL}/api/invites`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: userA.sessionCookie,
          'X-CSRF-Token': userA.csrfToken,
        },
        body: JSON.stringify({}),
      })
    ).json();
    const blockInviteToken = blockInvRes.token;

    // Blocked Stranger tries to redeem User A's invite -> 400
    const blockedRedeem = await fetch(`${BASE_URL}/api/invites/${blockInviteToken}/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: stranger.sessionCookie,
        'X-CSRF-Token': stranger.csrfToken,
      },
    });

    recordResult(
      'Blocked users cannot redeem invites from blocker',
      blockedRedeem.status === 404,
      `status=${blockedRedeem.status}`
    );

    // -------------------------------------------------------------
    // 4. Invite tokens: expired, reused, revoked, self-redeem all fail with generic error
    // -------------------------------------------------------------
    console.log('\n--- Test 4: Invite Token Invalidation & Single-Use ---');
    // 4a. Self-redeem
    const selfRedeemRes = await fetch(`${BASE_URL}/api/invites/${blockInviteToken}/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: userA.sessionCookie,
        'X-CSRF-Token': userA.csrfToken,
      },
    });

    // 4b. Revoked invite
    const revokeInv = await (
      await fetch(`${BASE_URL}/api/invites`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: userA.sessionCookie,
          'X-CSRF-Token': userA.csrfToken,
        },
        body: JSON.stringify({}),
      })
    ).json();
    await fetch(`${BASE_URL}/api/invites/${revokeInv.id}`, {
      method: 'DELETE',
      headers: {
        Origin: ORIGIN,
        Cookie: userA.sessionCookie,
        'X-CSRF-Token': userA.csrfToken,
      },
    });
    const tryRedeemRevoked = await fetch(`${BASE_URL}/api/invites/${revokeInv.token}/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: userB.sessionCookie,
        'X-CSRF-Token': userB.csrfToken,
      },
    });

    // 4c. Expired invite (insert with token_hash as invites table uses hashed tokens)
    const expToken = 'exp_' + Date.now();
    const expTokenHash = crypto.createHash('sha256').update(expToken).digest('hex');
    db.prepare(`
      INSERT INTO invites (id, token_hash, inviter_id, expires_at, max_uses, use_count, revoked)
      VALUES (?, ?, ?, datetime('now', '-10 minutes'), 1, 0, 0)
    `).run(crypto.randomUUID(), expTokenHash, userA.userId);
    const tryRedeemExpired = await fetch(`${BASE_URL}/api/invites/${expToken}/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: userB.sessionCookie,
        'X-CSRF-Token': userB.csrfToken,
      },
    });

    // 4d. Reused 1:1 invite
    const singleUseInv = await (
      await fetch(`${BASE_URL}/api/invites`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: userA.sessionCookie,
          'X-CSRF-Token': userA.csrfToken,
        },
        body: JSON.stringify({}),
      })
    ).json();
    // First accept by user B -> success
    await fetch(`${BASE_URL}/api/invites/${singleUseInv.token}/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: userB.sessionCookie,
        'X-CSRF-Token': userB.csrfToken,
      },
    });
    // Second accept by stranger -> rejected 400
    const tryReuse = await fetch(`${BASE_URL}/api/invites/${singleUseInv.token}/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: stranger.sessionCookie,
        'X-CSRF-Token': stranger.csrfToken,
      },
    });

    const inviteTokensSecure =
      selfRedeemRes.status === 400 &&
      tryRedeemRevoked.status === 404 &&
      tryRedeemExpired.status === 404 &&
      tryReuse.status === 404;

    recordResult(
      'Invite tokens: self-redeem (400), revoked/expired/reused (404 generic)',
      inviteTokensSecure,
      `self=${selfRedeemRes.status}, revoked=${tryRedeemRevoked.status}, expired=${tryRedeemExpired.status}, reused=${tryReuse.status}`
    );

    // -------------------------------------------------------------
    // 5. Unauthenticated WS connection and bad Origin are rejected
    // -------------------------------------------------------------
    console.log('\n--- Test 5: WebSocket Authentication & Origin Enforcement ---');
    // 5a. Unauthenticated WS (no cookie)
    const noAuthWsPromise = new Promise((res) => {
      const ws = new WebSocket(WS_URL, { headers: { Origin: ORIGIN } });
      ws.on('open', () => {
        ws.close();
        res(false);
      });
      ws.on('error', () => res(true));
      ws.on('unexpected-response', (req, response) => {
        res(response.statusCode === 401 || response.statusCode === 403);
      });
      setTimeout(() => res(false), 2000);
    });
    const noAuthRejected = await noAuthWsPromise;

    // 5b. Bad Origin
    const badOriginWsPromise = new Promise((res) => {
      const ws = new WebSocket(WS_URL, {
        headers: {
          Origin: 'http://malicious-site.example',
          Cookie: userA.sessionCookie,
        },
      });
      ws.on('open', () => {
        ws.close();
        res(false);
      });
      ws.on('error', () => res(true));
      ws.on('unexpected-response', (req, response) => {
        res(response.statusCode === 403);
      });
      setTimeout(() => res(false), 2000);
    });
    const badOriginRejected = await badOriginWsPromise;

    recordResult(
      'WebSocket handshake rejects unauthenticated connections and unauthorized Origins',
      noAuthRejected && badOriginRejected,
      `noAuth=${noAuthRejected}, badOrigin=${badOriginRejected}`
    );

    // -------------------------------------------------------------
    // 6. Rate limits trigger as expected
    // -------------------------------------------------------------
    console.log('\n--- Test 6: Rate Limiting Enforcement ---');
    // Test search rate limit (limit is 40 reqs/min)
    const searchPromises = [];
    for (let i = 0; i < 45; i++) {
      searchPromises.push(
        fetch(`${BASE_URL}/api/messages/search?q=test&conversationId=${convoId}`, {
          headers: { Cookie: userA.sessionCookie, Origin: ORIGIN },
        })
      );
    }
    const searchResponses = await Promise.all(searchPromises);
    const hasRateLimit429 = searchResponses.some((r) => r.status === 429);

    recordResult(
      'Rate limiting correctly throttles excessive requests (returns HTTP 429)',
      hasRateLimit429,
      `Found HTTP 429 among burst requests: ${hasRateLimit429}`
    );
  } catch (err) {
    console.error('Authz test failed:', err);
    recordResult('Authorization Test Suite', false, err.message);
  }

  console.log('\n========================================');
  console.log('    AUTHORIZATION SUITE RESULTS SUMMARY  ');
  console.log('========================================');
  console.table(results);

  const allPassed = results.every((r) => r.status === 'PASS');
  console.log(allPassed ? '\n>> ALL AUTHORIZATION TESTS PASSED! <<' : '\n>> SOME TESTS FAILED <<');
  process.exit(allPassed ? 0 : 1);
}

runAuthzTests();
