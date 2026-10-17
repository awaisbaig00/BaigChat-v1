import http from 'http';
import fs from 'fs';
import path from 'path';
import { WebSocket } from 'ws';

const API_BASE = 'http://localhost:3001/api';

async function request(pathUrl, options = {}) {
  const url = new URL(pathUrl.startsWith('http') ? pathUrl : `${API_BASE}${pathUrl}`);
  const headers = { ...(options.headers || {}) };

  let body = options.body;
  if (body && typeof body === 'object' && !Buffer.isBuffer(body) && !(body instanceof FormData)) {
    body = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url.toString(), {
    method: options.method || 'GET',
    headers,
    body,
  });

  const cookies = {};
  const rawSetCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const str of rawSetCookies) {
    const [nameVal] = str.split(';');
    const idx = nameVal.indexOf('=');
    if (idx !== -1) {
      const name = nameVal.slice(0, idx).trim();
      const val = nameVal.slice(idx + 1).trim();
      cookies[name] = val;
    }
  }

  let data = null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      data = await res.json();
    } catch {}
  } else {
    data = await res.text();
  }

  return { status: res.status, data, headers: res.headers, cookies };
}

class TestClient {
  constructor(name) {
    this.name = name;
    this.cookies = {};
    this.csrfToken = null;
    this.user = null;
  }

  cookieHeader() {
    return Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  updateCookies(newCookies) {
    this.cookies = { ...this.cookies, ...newCookies };
    if (this.cookies['baigchat_csrf']) {
      this.csrfToken = this.cookies['baigchat_csrf'];
    }
  }

  async post(pathUrl, body, customHeaders = {}) {
    const headers = {
      Cookie: this.cookieHeader(),
      Origin: 'http://localhost:5173',
      Referer: 'http://localhost:5173/',
      ...customHeaders,
    };
    if (this.csrfToken) {
      headers['X-CSRF-Token'] = this.csrfToken;
    }
    const res = await request(pathUrl, { method: 'POST', body, headers });
    this.updateCookies(res.cookies);
    if (res.data?.csrfToken) this.csrfToken = res.data.csrfToken;
    if (res.data?.user) this.user = res.data.user;
    return res;
  }

  async patch(pathUrl, body) {
    const headers = {
      Cookie: this.cookieHeader(),
      Origin: 'http://localhost:5173',
      Referer: 'http://localhost:5173/',
    };
    if (this.csrfToken) {
      headers['X-CSRF-Token'] = this.csrfToken;
    }
    const res = await request(pathUrl, { method: 'PATCH', body, headers });
    this.updateCookies(res.cookies);
    return res;
  }

  async get(pathUrl) {
    const headers = {
      Cookie: this.cookieHeader(),
    };
    const res = await request(pathUrl, { method: 'GET', headers });
    this.updateCookies(res.cookies);
    return res;
  }

  async delete(pathUrl, body = null) {
    const headers = {
      Cookie: this.cookieHeader(),
      Origin: 'http://localhost:5173',
      Referer: 'http://localhost:5173/',
    };
    if (this.csrfToken) {
      headers['X-CSRF-Token'] = this.csrfToken;
    }
    const res = await request(pathUrl, { method: 'DELETE', body, headers });
    this.updateCookies(res.cookies);
    return res;
  }
}

async function runStage3Tests() {
  console.log('--- STARTING STAGE 3: CHAT ESSENTIALS (PART A) VERIFICATION SUITE ---');
  const results = [];
  const timestamp = Date.now();

  const userA = new TestClient('UserA');
  const userB = new TestClient('UserB');
  const userC = new TestClient('UserC');

  // Sign up test users
  await userA.post('/auth/signup', {
    email: `stage3_a_${timestamp}@test.local`,
    username: `s3_user_a_${timestamp % 10000}`,
    password: 'Password123!@#',
  });

  await userB.post('/auth/signup', {
    email: `stage3_b_${timestamp}@test.local`,
    username: `s3_user_b_${timestamp % 10000}`,
    password: 'Password123!@#',
  });

  await userC.post('/auth/signup', {
    email: `stage3_c_${timestamp}@test.local`,
    username: `s3_user_c_${timestamp % 10000}`,
    password: 'Password123!@#',
  });

  // Setup direct conversation between userA and userB via invite
  const invRes = await userA.post('/invites', {});
  const inviteToken = invRes.data.token;
  await userB.post(`/invites/${inviteToken}/accept`, {});

  // Fetch conversation ID
  const convosA = (await userA.get('/conversations')).data.conversations;
  const conversationId = convosA[0].id;

  // Insert a test message from user A via DB
  const { db } = await import('./dist/db.js');
  const clientMsgId1 = 's3_msg_1_' + timestamp;
  const msgResult = db.prepare(`
    INSERT INTO messages (conversation_id, sender_id, client_msg_id, content, type)
    VALUES (?, ?, ?, ?, 'user')
  `).run(conversationId, userA.user.id, clientMsgId1, 'Original message text to edit');
  const messageId1 = Number(msgResult.lastInsertRowid);

  // TEST 1: Edit message by author within 15 minutes, preserving audit history
  try {
    const editRes = await userA.patch(`/messages/${messageId1}`, {
      content: 'Updated message text (edited)',
    });

    const auditRow = db.prepare('SELECT old_content FROM message_edits WHERE message_id = ?').get(messageId1);

    // Negative check: wrong user (user B) cannot edit
    const nonAuthorRes = await userB.patch(`/messages/${messageId1}`, {
      content: 'Hacked by User B',
    });

    const pass =
      editRes.status === 200 &&
      editRes.data?.content === 'Updated message text (edited)' &&
      auditRow?.old_content === 'Original message text to edit' &&
      nonAuthorRes.status === 403;

    results.push({
      test: 'Message Edit (Author Only & Audit History)',
      pass,
      details: pass ? 'Author edited message; audit record preserved; non-author got 403' : 'Edit failed',
    });
  } catch (err) {
    results.push({ test: 'Message Edit (Author Only & Audit History)', pass: false, details: err.message });
  }

  // TEST 2: Edit message rejected if older than 15 minutes
  try {
    const oldMsgId = 's3_old_' + timestamp;
    const oldRes = db.prepare(`
      INSERT INTO messages (conversation_id, sender_id, client_msg_id, content, type, created_at)
      VALUES (?, ?, ?, ?, 'user', datetime('now', '-20 minutes'))
    `).run(conversationId, userA.user.id, oldMsgId, 'Old message from 20 mins ago');
    const oldMessageId = Number(oldRes.lastInsertRowid);

    const tryEditOld = await userA.patch(`/messages/${oldMessageId}`, {
      content: 'Should not allow edit',
    });

    const pass = tryEditOld.status === 400 && tryEditOld.data?.error?.includes('15 minutes');

    results.push({
      test: 'Message Edit Time Window (15 Minutes Cap)',
      pass,
      details: pass ? 'Edit on 20-min old message correctly rejected with 400' : `Failed, status: ${tryEditOld.status}`,
    });
  } catch (err) {
    results.push({ test: 'Message Edit Time Window (15 Minutes Cap)', pass: false, details: err.message });
  }

  // TEST 3: Edit Negative Tests (Text-Only & Non-Member Check)
  try {
    // 1. Non-member user C tries to edit message in conversation -> 403
    const strangerEdit = await userC.patch(`/messages/${messageId1}`, {
      content: 'Stranger edit attempt',
    });

    // 2. Edit message with attachment -> rejected 400
    const testAttId = 's3_att_' + timestamp;
    db.prepare(`
      INSERT INTO attachments (id, uploader_id, conversation_id, stored_name, original_name, mime, size)
      VALUES (?, ?, ?, ?, 'photo.png', 'image/png', 1024)
    `).run(testAttId, userA.user.id, conversationId, 'dummy_' + timestamp);

    const attMsgResult = db.prepare(`
      INSERT INTO messages (conversation_id, sender_id, client_msg_id, content, type, attachment_id)
      VALUES (?, ?, ?, ?, 'user', ?)
    `).run(conversationId, userA.user.id, 's3_att_msg_' + timestamp, 'Photo message', testAttId);
    const attMsgId = Number(attMsgResult.lastInsertRowid);

    const editAttMsg = await userA.patch(`/messages/${attMsgId}`, {
      content: 'Trying to edit photo message',
    });

    const pass = strangerEdit.status === 403 && editAttMsg.status === 400 && editAttMsg.data?.error?.includes('text');

    results.push({
      test: 'Message Edit Negative (Non-Member 403 & Attachment Edit 400)',
      pass,
      details: pass ? 'Non-member got 403; message with attachment rejected with 400' : 'Failed text-only or stranger check',
    });
  } catch (err) {
    results.push({ test: 'Message Edit Negative (Non-Member 403 & Attachment Edit 400)', pass: false, details: err.message });
  }

  // TEST 4: Delete for me (hides only for caller)
  try {
    const delMeClientMsgId = 's3_delme_' + timestamp;
    const delMeInsert = db.prepare(`
      INSERT INTO messages (conversation_id, sender_id, client_msg_id, content, type)
      VALUES (?, ?, ?, ?, 'user')
    `).run(conversationId, userA.user.id, delMeClientMsgId, 'Message to delete for me only');
    const delMeId = Number(delMeInsert.lastInsertRowid);

    const delMeRes = await userA.delete(`/messages/${delMeId}?mode=me`);

    const msgsA = (await userA.get(`/conversations/${conversationId}/messages`)).data.messages;
    const foundInA = msgsA.some((m) => m.id === delMeId);

    const msgsB = (await userB.get(`/conversations/${conversationId}/messages`)).data.messages;
    const foundInB = msgsB.some((m) => m.id === delMeId);

    const pass = delMeRes.status === 200 && !foundInA && foundInB;

    results.push({
      test: 'Delete For Me (Caller-Only Exclusion)',
      pass,
      details: pass ? 'Hidden from caller, still visible to other conversation member' : 'Delete for me failed',
    });
  } catch (err) {
    results.push({ test: 'Delete For Me (Caller-Only Exclusion)', pass: false, details: err.message });
  }

  // TEST 5: Delete for everyone (Author & Group Admin Moderation)
  try {
    const delEvClientMsgId = 's3_delev_' + timestamp;
    const delEvInsert = db.prepare(`
      INSERT INTO messages (conversation_id, sender_id, client_msg_id, content, type)
      VALUES (?, ?, ?, ?, 'user')
    `).run(conversationId, userA.user.id, delEvClientMsgId, 'Author message to delete for everyone');
    const delEvId = Number(delEvInsert.lastInsertRowid);

    const delEvRes = await userA.delete(`/messages/${delEvId}?mode=everyone`);
    const updatedMsg = db.prepare('SELECT is_deleted, content FROM messages WHERE id = ?').get(delEvId);

    // Group moderation check
    const groupRes = await userA.post('/groups', {
      name: 'Stage 3 Moderation Group',
      memberIds: [userB.user.id, userC.user.id],
    });
    const groupId = groupRes.data.group.id;

    const memberMsgResult = db.prepare(`
      INSERT INTO messages (conversation_id, sender_id, client_msg_id, content, type)
      VALUES (?, ?, ?, ?, 'user')
    `).run(groupId, userC.user.id, 's3_c_msg_' + timestamp, 'Spam message from member C');
    const memberMsgId = Number(memberMsgResult.lastInsertRowid);

    // Non-admin member B tries to delete -> 403
    const nonAdminDelete = await userB.delete(`/messages/${memberMsgId}?mode=everyone`);

    // Group Owner A deletes member C message -> 200
    const ownerDelete = await userA.delete(`/messages/${memberMsgId}?mode=everyone`);

    const pass =
      delEvRes.status === 200 &&
      updatedMsg.is_deleted === 1 &&
      updatedMsg.content === 'This message was deleted' &&
      nonAdminDelete.status === 403 &&
      ownerDelete.status === 200;

    results.push({
      test: 'Delete For Everyone (Author & Group Admin Moderation)',
      pass,
      details: pass ? 'Soft-deleted with tombstone; non-admin got 403; admin moderation succeeded' : 'Delete failed',
    });
  } catch (err) {
    results.push({ test: 'Delete For Everyone (Author & Group Admin Moderation)', pass: false, details: err.message });
  }

  // TEST 6: Delete for everyone Negative Tests (1-Hour Cap & Non-Member 403)
  try {
    // 1. Author message older than 1 hour -> rejected with 400
    const oldDelMsgResult = db.prepare(`
      INSERT INTO messages (conversation_id, sender_id, client_msg_id, content, type, created_at)
      VALUES (?, ?, ?, ?, 'user', datetime('now', '-75 minutes'))
    `).run(conversationId, userA.user.id, 's3_del_old_' + timestamp, 'Message from 75 minutes ago');
    const oldDelMsgId = Number(oldDelMsgResult.lastInsertRowid);

    const tryDeleteOld = await userA.delete(`/messages/${oldDelMsgId}?mode=everyone`);

    // 2. Non-member user C tries to delete message in conversation A-B -> 403
    const strangerDelete = await userC.delete(`/messages/${messageId1}?mode=everyone`);

    const pass = tryDeleteOld.status === 400 && tryDeleteOld.data?.error?.includes('1 hour') && strangerDelete.status === 403;

    results.push({
      test: 'Delete For Everyone Negative (1-Hour Cap & Non-Member 403)',
      pass,
      details: pass ? 'Author deletion > 1 hr rejected with 400; stranger got 403' : 'Failed 1-hr or stranger delete check',
    });
  } catch (err) {
    results.push({ test: 'Delete For Everyone Negative (1-Hour Cap & Non-Member 403)', pass: false, details: err.message });
  }

  // TEST 7: Emoji Reactions (Allowlist, Toggle, Change, Negative Tests)
  try {
    const rxMsgClient = 's3_rx_' + timestamp;
    const rxInsert = db.prepare(`
      INSERT INTO messages (conversation_id, sender_id, client_msg_id, content, type)
      VALUES (?, ?, ?, ?, 'user')
    `).run(conversationId, userA.user.id, rxMsgClient, 'Message to react to');
    const rxMsgId = Number(rxInsert.lastInsertRowid);

    // User B reacts with allowed emoji 👍
    const r1 = await userB.post(`/messages/${rxMsgId}/reactions`, { emoji: '👍' });

    // User B changes reaction to ❤️ (change action, maintains 1 reaction per user)
    const rChange = await userB.post(`/messages/${rxMsgId}/reactions`, { emoji: '❤️' });

    // User A reacts with ❤️
    const r2 = await userA.post(`/messages/${rxMsgId}/reactions`, { emoji: '❤️' });

    // Verify aggregate reactions
    const msgs = (await userA.get(`/conversations/${conversationId}/messages`)).data.messages;
    const targetMsg = msgs.find((m) => m.id === rxMsgId);
    const heartRx = targetMsg?.reactions?.find((r) => r.emoji === '❤️');
    const thumbsRx = targetMsg?.reactions?.find((r) => r.emoji === '👍');

    // Negative 1: Disallowed emoji rejected (400)
    const invalidEmojiRes = await userA.post(`/messages/${rxMsgId}/reactions`, { emoji: '🔥' });

    // Negative 2: Stranger C tries to react in conversation A-B -> 403
    const strangerReact = await userC.post(`/messages/${rxMsgId}/reactions`, { emoji: '❤️' });

    // User B toggles ❤️ off
    const rToggleOff = await userB.post(`/messages/${rxMsgId}/reactions`, { emoji: '❤️' });

    const pass =
      r1.data?.action === 'add' &&
      rChange.data?.action === 'change' &&
      heartRx?.count === 2 &&
      !thumbsRx &&
      invalidEmojiRes.status === 400 &&
      strangerReact.status === 403 &&
      rToggleOff.data?.action === 'remove';

    results.push({
      test: 'Emoji Reactions (Allowlist, Toggle, In-Place Change & Stranger 403)',
      pass,
      details: pass ? 'Allowlist enforced; change reaction maintained 1 rx/user; toggle removed; stranger got 403' : 'Reactions failed',
    });
  } catch (err) {
    results.push({ test: 'Emoji Reactions (Allowlist, Toggle, In-Place Change & Stranger 403)', pass: false, details: err.message });
  }

  // TEST 8: Quoted Reply Message Snapshot
  try {
    const parentClientMsgId = 's3_parent_' + timestamp;
    const parentInsert = db.prepare(`
      INSERT INTO messages (conversation_id, sender_id, client_msg_id, content, type)
      VALUES (?, ?, ?, ?, 'user')
    `).run(conversationId, userA.user.id, parentClientMsgId, 'Parent question to reply to');
    const parentMsgId = Number(parentInsert.lastInsertRowid);

    const replyClientMsgId = 's3_reply_' + timestamp;
    const replyInsert = db.prepare(`
      INSERT INTO messages (conversation_id, sender_id, client_msg_id, content, type, reply_to_id)
      VALUES (?, ?, ?, ?, 'user', ?)
    `).run(conversationId, userB.user.id, replyClientMsgId, 'This is my quoted reply answer', parentMsgId);
    const replyMsgId = Number(replyInsert.lastInsertRowid);

    const msgs = (await userA.get(`/conversations/${conversationId}/messages`)).data.messages;
    const replyMsg = msgs.find((m) => m.id === replyMsgId);

    const pass =
      replyMsg?.replyToId === parentMsgId &&
      replyMsg?.replyQuote?.content === 'Parent question to reply to' &&
      replyMsg?.replyQuote?.senderId === userA.user.id;

    results.push({
      test: 'Quoted Reply Message Snapshot',
      pass,
      details: pass ? 'Reply stores replyToId and returns replyQuote snapshot' : 'Reply snapshot missing',
    });
  } catch (err) {
    results.push({ test: 'Quoted Reply Message Snapshot', pass: false, details: err.message });
  }

  // TEST 9: Cross-Conversation Reply Negative Test (Server Verification)
  try {
    // Message from another conversation (e.g. group chat)
    const otherConvoRes = await userA.post('/groups', {
      name: 'Separate Group for Cross-Reply Test',
    });
    const otherGroupId = otherConvoRes.data.group.id;
    const otherMsgResult = db.prepare(`
      INSERT INTO messages (conversation_id, sender_id, client_msg_id, content, type)
      VALUES (?, ?, ?, ?, 'user')
    `).run(otherGroupId, userA.user.id, 's3_cross_' + timestamp, 'Message in group chat');
    const otherMsgId = Number(otherMsgResult.lastInsertRowid);

    // Attempt to send message over WS in conversationId replying to otherMsgId
    const wsUrl = `ws://localhost:3001`;
    const ws = new WebSocket(wsUrl, {
      headers: {
        Origin: 'http://localhost:5173',
        Cookie: userA.cookieHeader(),
      },
    });

    const wsPromise = new Promise((resolve) => {
      ws.on('open', () => {
        ws.send(
          JSON.stringify({
            type: 'message:send',
            conversationId,
            clientMsgId: 'cross_reply_' + timestamp,
            content: 'Attempting cross-conversation reply',
            replyToId: otherMsgId,
          })
        );
      });

      ws.on('message', (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === 'error' && parsed.error?.includes('Replied-to message not found in this conversation')) {
            ws.close();
            resolve(true);
          } else if (parsed.type === 'message:ack') {
            ws.close();
            resolve(false);
          }
        } catch {
          ws.close();
          resolve(false);
        }
      });

      ws.on('error', () => {
        resolve(false);
      });

      setTimeout(() => {
        ws.close();
        resolve(false);
      }, 3000);
    });

    const rejected = await wsPromise;

    results.push({
      test: 'Quoted Reply Cross-Conversation Verification',
      pass: rejected,
      details: rejected
        ? 'WebSocket rejected reply to message from another conversation'
        : 'Cross-conversation reply was not rejected',
    });
  } catch (err) {
    results.push({ test: 'Quoted Reply Cross-Conversation Verification', pass: false, details: err.message });
  }

  // TEST 10: Message Search (Parameterized, Excludes Deleted & Stranger)
  try {
    const searchTarget = `secretkeyword_${timestamp}`;
    db.prepare(`
      INSERT INTO messages (conversation_id, sender_id, client_msg_id, content, type)
      VALUES (?, ?, ?, ?, 'user')
    `).run(conversationId, userA.user.id, 's3_search_' + timestamp, `Here is the ${searchTarget} for search`);

    const searchInConvo = await userB.get(`/messages/search?q=${searchTarget}&conversationId=${conversationId}`);
    const searchGlobal = await userB.get(`/messages/search?q=${searchTarget}`);
    const searchStranger = await userC.get(`/messages/search?q=${searchTarget}`);
    const searchStrangerForbidden = await userC.get(`/messages/search?q=${searchTarget}&conversationId=${conversationId}`);

    const pass =
      searchInConvo.status === 200 &&
      searchInConvo.data?.results?.length === 1 &&
      searchGlobal.status === 200 &&
      searchGlobal.data?.results?.length === 1 &&
      searchStranger.data?.results?.length === 0 &&
      searchStrangerForbidden.status === 403;

    results.push({
      test: 'Parameterized Message Search & Authorization Scoping',
      pass,
      details: pass
        ? 'Matched query in conversation; stranger got 0 global results and 403 on private chat'
        : `inConvo=${searchInConvo.status}(len=${searchInConvo.data?.results?.length}), global=${searchGlobal.status}(len=${searchGlobal.data?.results?.length}), stranger=${searchStranger.status}(len=${searchStranger.data?.results?.length}), strangerForbidden=${searchStrangerForbidden.status}`,
    });
  } catch (err) {
    results.push({ test: 'Parameterized Message Search & Authorization Scoping', pass: false, details: err.message });
  }

  // TEST 11: Per-Chat Mute (8h, 1w, always, unmute & Unread Count Suppression)
  try {
    // 1. Stranger C tries to mute chat A-B -> 403
    const strangerMute = await userC.post(`/conversations/${conversationId}/mute`, { duration: '8h' });

    // 2. User A mutes conversation for 8h
    const mute8h = await userA.post(`/conversations/${conversationId}/mute`, { duration: '8h' });

    // User B sends a message to conversation
    db.prepare(`
      INSERT INTO messages (conversation_id, sender_id, client_msg_id, content, type)
      VALUES (?, ?, ?, ?, 'user')
    `).run(conversationId, userB.user.id, 's3_mute_msg_' + timestamp, 'Unread message while muted');

    // User A fetches conversations -> unreadCount should be suppressed to 0, isMuted = true
    const convosMuted = (await userA.get('/conversations')).data.conversations;
    const targetConvoMuted = convosMuted.find((c) => c.id === conversationId);

    // 3. User A tests '1w' and 'always'
    const mute1w = await userA.post(`/conversations/${conversationId}/mute`, { duration: '1w' });
    const muteAlways = await userA.post(`/conversations/${conversationId}/mute`, { duration: 'always' });

    // 4. User A unmutes
    const unmuteRes = await userA.post(`/conversations/${conversationId}/mute`, { duration: 'unmute' });
    const convosUnmuted = (await userA.get('/conversations')).data.conversations;
    const targetConvoUnmuted = convosUnmuted.find((c) => c.id === conversationId);

    const pass =
      strangerMute.status === 403 &&
      mute8h.status === 200 &&
      mute8h.data?.isMuted === true &&
      targetConvoMuted?.isMuted === true &&
      targetConvoMuted?.unreadCount === 0 &&
      mute1w.status === 200 &&
      muteAlways.status === 200 &&
      unmuteRes.status === 200 &&
      unmuteRes.data?.isMuted === false &&
      targetConvoUnmuted?.isMuted === false &&
      targetConvoUnmuted?.unreadCount > 0;

    results.push({
      test: 'Per-Chat Mute (8h, 1w, always, unmute & Unread Suppression)',
      pass,
      details: pass
        ? 'Muted 8h/1w/always; suppressed unread badge; restored count on unmute; stranger got 403'
        : 'Mute test failed',
    });
  } catch (err) {
    results.push({ test: 'Per-Chat Mute (8h, 1w, always, unmute & Unread Suppression)', pass: false, details: err.message });
  }

  console.log('\n========================================');
  console.log('       STAGE 3 VERIFICATION RESULTS     ');
  console.log('========================================');
  console.table(
    results.map((r) => ({
      Test: r.test,
      Status: r.pass ? 'PASS' : 'FAIL',
      Details: r.details,
    }))
  );

  const allPassed = results.every((r) => r.pass);
  console.log(allPassed ? '\n>> ALL STAGE 3 TESTS PASSED! <<' : '\n>> SOME STAGE 3 TESTS FAILED <<');
  return allPassed;
}

runStage3Tests().then((ok) => {
  process.exit(ok ? 0 : 1);
}).catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
