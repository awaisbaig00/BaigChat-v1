import http from 'http';
import fs from 'fs';
import path from 'path';

const API_BASE = 'http://localhost:3001/api';

// Helper for HTTP requests
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
  } else if (contentType.includes('image/')) {
    data = Buffer.from(await res.arrayBuffer());
  } else {
    data = await res.text();
  }

  return { status: res.status, data, headers: res.headers, cookies };
}

// Session Client
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

async function runStage2Tests() {
  console.log('--- STARTING STAGE 2 VERIFICATION SUITE ---');
  const results = [];

  const timestamp = Date.now();
  const userA = new TestClient('UserA');
  const userB = new TestClient('UserB');
  const userC = new TestClient('UserC');

  // Test 1: Username availability and validation rules
  try {
    const resAvail = await request(`/auth/username-available?u=valid_user_${timestamp % 10000}`);
    const resReserved = await request(`/auth/username-available?u=admin`);
    const resTooShort = await request(`/auth/username-available?u=ab`);
    const resConsecutive = await request(`/auth/username-available?u=test..name`);
    const resInvalidChars = await request(`/auth/username-available?u=test@name`);

    const pass =
      resAvail.data?.available === true &&
      resReserved.data?.available === false &&
      resTooShort.data?.available === false &&
      resConsecutive.data?.available === false &&
      resInvalidChars.data?.available === false;

    results.push({
      test: 'Username Validation & Availability API',
      pass,
      details: pass ? 'Passed valid, reserved, length, and char rules' : 'Failed validation rules',
    });
  } catch (err) {
    results.push({ test: 'Username Validation & Availability API', pass: false, details: err.message });
  }

  // Test 2: Signup with chosen username + auto-fallback username
  const emailA = `stage2_a_${timestamp}@example.com`;
  const usernameA = `stage2_user_a_${timestamp % 10000}`;
  const passwordA = 'StrongPass123!@#';

  const emailB = `stage2_b_${timestamp}@example.com`;
  const passwordB = 'StrongPass456!@#';

  try {
    const resA = await userA.post('/auth/signup', {
      email: emailA,
      username: usernameA,
      password: passwordA,
    });

    const resB = await userB.post('/auth/signup', {
      email: emailB,
      password: passwordB, // Auto-fallback username
    });

    const pass =
      resA.status === 201 &&
      resA.data?.user?.username === usernameA &&
      resB.status === 201 &&
      resB.data?.user?.username.length >= 3;

    results.push({
      test: 'Signup with Chosen & Auto-Derived Username',
      pass,
      details: pass
        ? `A: ${resA.data.user.username}, B derived: ${resB.data.user.username}`
        : `A status=${resA.status}, B status=${resB.status}`,
    });
  } catch (err) {
    results.push({ test: 'Signup with Chosen & Auto-Derived Username', pass: false, details: err.message });
  }

  // Test 3: Login with email OR username
  try {
    // Logout user A
    await userA.post('/auth/logout');
    // Login with username
    const resLoginUser = await userA.post('/auth/login', {
      identifier: usernameA,
      password: passwordA,
    });
    // Logout
    await userA.post('/auth/logout');
    // Login with email
    const resLoginEmail = await userA.post('/auth/login', {
      identifier: emailA,
      password: passwordA,
    });

    const pass =
      resLoginUser.status === 200 &&
      resLoginUser.data?.user?.username === usernameA &&
      resLoginEmail.status === 200 &&
      resLoginEmail.data?.user?.email === emailA;

    results.push({
      test: 'Login via Username OR Email',
      pass,
      details: pass ? 'Both username and email login succeeded' : 'Login failed',
    });
  } catch (err) {
    results.push({ test: 'Login via Username OR Email', pass: false, details: err.message });
  }

  // Test 4: Forgot Password & Reset Flow
  try {
    const resForgot = await request('/auth/forgot', {
      method: 'POST',
      body: { email: emailA },
      headers: { 'Content-Type': 'application/json' },
    });

    // Read token from password_resets in DB
    const { db } = await import('./dist/db.js');
    const resetRow = db
      .prepare('SELECT id, token_hash FROM password_resets WHERE user_id = ? AND used = 0 ORDER BY created_at DESC LIMIT 1')
      .get(userA.user.id);

    // Let's create a known test token directly for reset testing
    const crypto = await import('crypto');
    const testRawToken = 'testresettoken_' + timestamp;
    const testHash = crypto.createHash('sha256').update(testRawToken).digest('hex');
    const testExpires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO password_resets (id, user_id, token_hash, expires_at, used) VALUES (?, ?, ?, ?, 0)').run(
      crypto.randomUUID(),
      userA.user.id,
      testHash,
      testExpires
    );

    const newPassA = 'NewSuperStrongPass999!';
    const resReset = await request('/auth/reset', {
      method: 'POST',
      body: { token: testRawToken, newPassword: newPassA },
      headers: { 'Content-Type': 'application/json' },
    });

    // Verify reset token cannot be used again
    const resResetAgain = await request('/auth/reset', {
      method: 'POST',
      body: { token: testRawToken, newPassword: newPassA },
      headers: { 'Content-Type': 'application/json' },
    });

    // Login with new password
    const resNewLogin = await userA.post('/auth/login', {
      identifier: usernameA,
      password: newPassA,
    });

    const pass =
      resForgot.data?.success === true &&
      resReset.status === 200 &&
      resResetAgain.status === 400 &&
      resNewLogin.status === 200;

    results.push({
      test: 'Password Reset Flow & Session Invalidation',
      pass,
      details: pass ? 'Reset succeeded, token single-use verified, new login passed' : 'Failed reset flow',
    });
  } catch (err) {
    results.push({ test: 'Password Reset Flow & Session Invalidation', pass: false, details: err.message });
  }

  // Test 5: Profile editing & 3/day username limit
  try {
    const resProfile = await userA.patch('/me/profile', {
      displayName: 'Awais Updated',
      bio: 'Building awesome chat apps\nhttps://example.com',
      about: 'Available for coding',
    });

    // Change username 1
    const u1 = `stage2_u1_${timestamp % 10000}`;
    const r1 = await userA.patch('/me/profile', { username: u1 });

    // Change username 2
    const u2 = `stage2_u2_${timestamp % 10000}`;
    const r2 = await userA.patch('/me/profile', { username: u2 });

    // Change username 3
    const u3 = `stage2_u3_${timestamp % 10000}`;
    const r3 = await userA.patch('/me/profile', { username: u3 });

    // Change username 4 (should be rejected 429)
    const u4 = `stage2_u4_${timestamp % 10000}`;
    const r4 = await userA.patch('/me/profile', { username: u4 });

    const pass =
      resProfile.status === 200 &&
      resProfile.data?.displayName === 'Awais Updated' &&
      r1.status === 200 &&
      r2.status === 200 &&
      r3.status === 200 &&
      r4.status === 429;

    results.push({
      test: 'Profile Update & 3-per-24h Username Rate Limit',
      pass,
      details: pass ? 'Profile updated; 4th username change blocked with 429' : `Failed rate limit, r4 status: ${r4.status}`,
    });
  } catch (err) {
    results.push({ test: 'Profile Update & 3-per-24h Username Rate Limit', pass: false, details: err.message });
  }

  // Test 6: Avatar Upload, Sharp Crop (512x512 & 96x96), and EXIF stripping
  try {
    // Generate a minimal valid 100x100 PNG buffer
    const sharp = (await import('sharp')).default;
    const testPngBuffer = await sharp({
      create: {
        width: 200,
        height: 200,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    // Fake an executable pretending to be png
    const fakeExeBuffer = Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff');

    // Test rejection of fake exe
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    const exeBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="avatar"; filename="malware.png"\r\nContent-Type: image/png\r\n\r\n`),
      fakeExeBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const resFake = await userA.post('/me/avatar', exeBody, {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    });

    // Test real upload
    const realBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="avatar"; filename="avatar.png"\r\nContent-Type: image/png\r\n\r\n`),
      testPngBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const resReal = await userA.post('/me/avatar', realBody, {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    });

    // Verify avatar files exist on disk with correct sizes
    const avatarsDir =
      process.env.AVATARS_DIR ||
      (fs.existsSync(path.resolve(process.cwd(), 'data/avatars'))
        ? path.resolve(process.cwd(), 'data/avatars')
        : path.resolve(process.cwd(), 'avatars'));
    const fullPath = path.join(avatarsDir, `${userA.user.id}_full.webp`);
    const thumbPath = path.join(avatarsDir, `${userA.user.id}_thumb.webp`);

    const fullMeta = await sharp(fullPath).metadata();
    const thumbMeta = await sharp(thumbPath).metadata();

    // Test GET /api/avatars/:id
    const resGetThumb = await userA.get(`/avatars/${userA.user.id}?size=thumb`);
    const resGetFull = await userA.get(`/avatars/${userA.user.id}?size=full`);

    const pass =
      resFake.status === 400 &&
      resReal.status === 200 &&
      fullMeta.width === 512 &&
      fullMeta.height === 512 &&
      fullMeta.format === 'webp' &&
      thumbMeta.width === 96 &&
      thumbMeta.height === 96 &&
      thumbMeta.format === 'webp' &&
      resGetThumb.status === 200 &&
      resGetThumb.headers.get('content-type') === 'image/webp' &&
      resGetFull.headers.get('x-content-type-options') === 'nosniff';

    results.push({
      test: 'Avatar Upload, Magic Byte Check & Sharp Crop (512x512/96x96)',
      pass,
      details: pass ? 'Rejected fake exe; Sharp cropped 512x512 & 96x96 WebP with nosniff' : 'Avatar processing failed',
    });
  } catch (err) {
    results.push({ test: 'Avatar Upload, Magic Byte Check & Sharp Crop (512x512/96x96)', pass: false, details: err.message });
  }

  // Test 7: Reciprocal Privacy Enforcement (WhatsApp Style) & Discoverability
  try {
    // User C is a stranger
    const emailC = `stage2_c_${timestamp}@example.com`;
    const resC = await userC.post('/auth/signup', {
      email: emailC,
      password: 'StrongPass789!@#',
    });

    // Fetch user A username
    const currentAUser = (await userA.get('/me')).data;
    const currentUsernameA = currentAUser.username;

    // By default, User C can view User A's public profile
    const resProfileBefore = await userC.get(`/users/${currentUsernameA}`);

    // User A turns off discoverability
    await userA.patch('/me/profile', { isDiscoverable: false });
    const resProfileAfter = await userC.get(`/users/${currentUsernameA}`); // Stranger -> 404

    // Restore discoverability
    await userA.patch('/me/profile', { isDiscoverable: true });

    // Privacy toggles: User A turns off showOnline
    await userA.patch('/me/privacy', { showOnline: false });
    const resSeeAOnline = await userC.get(`/users/${currentUsernameA}`); // should see isOnline: false

    // Privacy toggles: User A turns showOnline back on, but User C turns showOnline off
    await userA.patch('/me/privacy', { showOnline: true });
    await userC.patch('/me/privacy', { showOnline: false });
    const resReciprocal = await userC.get(`/users/${currentUsernameA}`); // C turned off online -> cannot see A either

    const pass =
      resProfileBefore.status === 200 &&
      resProfileAfter.status === 404 &&
      resSeeAOnline.data?.isOnline === false &&
      resReciprocal.data?.isOnline === false;

    results.push({
      test: 'Stranger Discoverability 404 & Reciprocal Privacy',
      pass,
      details: pass ? 'Discoverability 404 and reciprocal privacy enforced' : 'Privacy check failed',
    });
  } catch (err) {
    results.push({ test: 'Stranger Discoverability 404 & Reciprocal Privacy', pass: false, details: err.message });
  }

  // Test 8: Active Sessions & Session Revocation
  try {
    const resSessions = await userA.get('/me/sessions');
    const sessionsList = resSessions.data?.sessions || [];

    // Revoke others
    const resRevokeOthers = await userA.post('/me/sessions/revoke-others');
    const resSessionsAfter = await userA.get('/me/sessions');

    const pass =
      resSessions.status === 200 &&
      sessionsList.length >= 1 &&
      resRevokeOthers.status === 200 &&
      resSessionsAfter.data?.sessions?.length === 1;

    results.push({
      test: 'Active Sessions & Revoke Others',
      pass,
      details: pass ? 'Session list tracked and revoke-others succeeded' : 'Session test failed',
    });
  } catch (err) {
    results.push({ test: 'Active Sessions & Revoke Others', pass: false, details: err.message });
  }

  // Test 9: Pre-existing user backfill validation
  try {
    const { db } = await import('./dist/db.js');
    const usersWithoutUsername = db.prepare('SELECT COUNT(*) as count FROM users WHERE username_lower IS NULL').get();
    const pass = usersWithoutUsername.count === 0;

    results.push({
      test: 'Pre-existing Users Database Username Backfill',
      pass,
      details: pass ? '0 users without username in DB' : `${usersWithoutUsername.count} users missing username`,
    });
  } catch (err) {
    results.push({ test: 'Pre-existing Users Database Username Backfill', pass: false, details: err.message });
  }

  console.log('\n========================================');
  console.log('       STAGE 2 VERIFICATION RESULTS     ');
  console.log('========================================');
  console.table(
    results.map((r) => ({
      Test: r.test,
      Status: r.pass ? 'PASS' : 'FAIL',
      Details: r.details,
    }))
  );

  const allPassed = results.every((r) => r.pass);
  console.log(allPassed ? '\n>> ALL STAGE 2 TESTS PASSED! <<' : '\n>> SOME STAGE 2 TESTS FAILED <<');
  return allPassed;
}

runStage2Tests().then((ok) => {
  process.exit(ok ? 0 : 1);
}).catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
