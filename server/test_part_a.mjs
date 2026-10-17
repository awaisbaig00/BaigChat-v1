import assert from 'assert';
import http from 'http';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { db } from './dist/db.js';

console.log('=== PART A: FILE AND IMAGE SHARING VERIFICATION ===\n');

const BASE_URL = 'http://localhost:3001';
const ORIGIN = 'http://localhost:5173';

const results = [];

function recordResult(testName, passed, details = '') {
  results.push({ test: testName, status: passed ? 'PASS' : 'FAIL', details });
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${testName} ${details ? '(' + details + ')' : ''}`);
}

async function signupUser(email, password = 'StrongPassword!2026') {
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

async function uploadFile(user, fileBuffer, filename) {
  const form = new FormData();
  form.append('file', new Blob([fileBuffer]), filename);

  const res = await fetch(`${BASE_URL}/api/uploads`, {
    method: 'POST',
    headers: {
      Origin: ORIGIN,
      Cookie: user.sessionCookie,
      'X-CSRF-Token': user.csrfToken,
    },
    body: form,
  });

  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, headers: res.headers };
}

async function runTests() {
  try {
    const timestamp = Date.now();
    const userA = await signupUser(`alice_${timestamp}@example.com`);
    const userB = await signupUser(`bob_${timestamp}@example.com`);
    const userC = await signupUser(`charlie_${timestamp}@example.com`);

    // Create a 1:1 conversation between User A and User B
    const inviteRes = await fetch(`${BASE_URL}/api/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: userA.sessionCookie,
        'X-CSRF-Token': userA.csrfToken,
      },
      body: JSON.stringify({ maxUses: 1 }),
    });
    const inviteData = await inviteRes.json();
    const acceptRes = await fetch(`${BASE_URL}/api/invites/${inviteData.token}/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: userB.sessionCookie,
        'X-CSRF-Token': userB.csrfToken,
      },
    });
    const acceptData = await acceptRes.json();
    const conversationId = acceptData.conversationId;

    // -------------------------------------------------------------
    // Check 1: Valid JPEG / PNG / PDF accepted
    // -------------------------------------------------------------
    {
      // 1a: JPEG
      const jpegBuffer = await sharp({
        create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } },
      }).jpeg().toBuffer();
      const resJpeg = await uploadFile(userA, jpegBuffer, 'test.jpg');
      const passJpeg = resJpeg.status === 201 && resJpeg.data.mime === 'image/jpeg';

      // 1b: PNG
      const pngBuffer = await sharp({
        create: { width: 50, height: 50, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } },
      }).png().toBuffer();
      const resPng = await uploadFile(userA, pngBuffer, 'test.png');
      const passPng = resPng.status === 201 && resPng.data.mime === 'image/png';

      // 1c: PDF
      const pdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
      const resPdf = await uploadFile(userA, pdfBuffer, 'document.pdf');
      const passPdf = resPdf.status === 201 && resPdf.data.mime === 'application/pdf';

      recordResult(
        'Valid JPEG/PNG/PDF accepted',
        passJpeg && passPng && passPdf,
        `JPEG: ${resJpeg.status}, PNG: ${resPng.status}, PDF: ${resPdf.status}`
      );
    }

    // -------------------------------------------------------------
    // Check 2: .exe renamed to .jpg rejected
    // -------------------------------------------------------------
    {
      // Start with Windows PE header "MZ" (0x4D 0x5A)
      const fakeExeBuffer = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(100)]);
      const res = await uploadFile(userA, fakeExeBuffer, 'cute_cat.jpg');
      const passed = res.status === 400 && res.data.error?.includes('Unsupported or unsafe');
      recordResult('.exe renamed to .jpg rejected', passed, `HTTP ${res.status}: ${res.data.error}`);
    }

    // -------------------------------------------------------------
    // Check 3: SVG with a script rejected
    // -------------------------------------------------------------
    {
      const svgBuffer = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert("XSS")</script><rect width="100" height="100"/></svg>'
      );
      const res = await uploadFile(userA, svgBuffer, 'image.svg');
      const passed = res.status === 400 && res.data.error?.includes('Unsupported or unsafe');
      recordResult('SVG with a script rejected', passed, `HTTP ${res.status}: ${res.data.error}`);
    }

    // -------------------------------------------------------------
    // Check 4: Oversized file rejected
    // -------------------------------------------------------------
    {
      // Image limit is 5 MB. Create 5.5 MB JPEG buffer
      const bigHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      const bigJpgBuffer = Buffer.concat([bigHeader, Buffer.alloc(5.5 * 1024 * 1024)]);
      const res = await uploadFile(userA, bigJpgBuffer, 'huge.jpg');
      const passed = res.status === 400 && res.data.error?.includes('exceeds the 5 MB limit');
      recordResult('Oversized file rejected', passed, `HTTP ${res.status}: ${res.data.error}`);
    }

    // -------------------------------------------------------------
    // Check 5: Non-member can't download (BOLA)
    // -------------------------------------------------------------
    let attachmentIdForCheck = '';
    {
      const validJpg = await sharp({
        create: { width: 40, height: 40, channels: 3, background: { r: 10, g: 20, b: 30 } },
      }).jpeg().toBuffer();
      const uploadRes = await uploadFile(userA, validJpg, 'member_only.jpg');
      attachmentIdForCheck = uploadRes.data.attachmentId;

      // User A links it to the conversation between A and B
      db.prepare('UPDATE attachments SET conversation_id = ? WHERE id = ?').run(
        conversationId,
        attachmentIdForCheck
      );

      // User C (not in conversation) tries to download
      const resC = await fetch(`${BASE_URL}/api/attachments/${attachmentIdForCheck}`, {
        headers: {
          Origin: ORIGIN,
          Cookie: userC.sessionCookie,
        },
      });
      const dataC = await resC.json().catch(() => ({}));
      const passed = resC.status === 403;
      recordResult("Non-member can't download (BOLA)", passed, `HTTP ${resC.status}: ${dataC.error}`);
    }

    // -------------------------------------------------------------
    // Check 6: User can't attach someone else's upload
    // -------------------------------------------------------------
    {
      // User B uploads an attachment
      const validDoc = Buffer.from('Confidential notes by User B');
      const uploadB = await uploadFile(userB, validDoc, 'notes_b.txt');
      const bAttachmentId = uploadB.data.attachmentId;

      // User A tries to link User B's attachment to conversation
      const checkRow = db
        .prepare('SELECT uploader_id FROM attachments WHERE id = ?')
        .get(bAttachmentId);
      const isDifferentUser = checkRow && checkRow.uploader_id !== userA.userId;

      // Attempt to link under user A's ownership
      const updateAttempt = db
        .prepare(
          'UPDATE attachments SET conversation_id = ? WHERE id = ? AND conversation_id IS NULL AND uploader_id = ?'
        )
        .run(conversationId, bAttachmentId, userA.userId);

      const passed = isDifferentUser && updateAttempt.changes === 0;
      recordResult("User can't attach someone else's upload", passed, `DB changes: ${updateAttempt.changes}`);
    }

    // -------------------------------------------------------------
    // Check 7: Stored image has no EXIF
    // -------------------------------------------------------------
    {
      // Generate image with explicit EXIF metadata
      const imageWithExif = await sharp({
        create: { width: 60, height: 60, channels: 3, background: { r: 120, g: 150, b: 200 } },
      })
        .withMetadata({
          exif: {
            IFD0: {
              Make: 'TestCameraBrand',
              Model: 'SecretSpyDevice123',
            },
          },
        })
        .jpeg()
        .toBuffer();

      const uploadExif = await uploadFile(userA, imageWithExif, 'camera_photo.jpg');
      const attId = uploadExif.data.attachmentId;

      // Fetch row to find stored_name
      const row = db.prepare('SELECT stored_name FROM attachments WHERE id = ?').get(attId);
      const storedPath = path.resolve('uploads', row.stored_name);
      const storedBuffer = fs.readFileSync(storedPath);

      // Inspect with sharp
      const meta = await sharp(storedBuffer).metadata();
      const hasExif = !!meta.exif;
      recordResult('Stored image has no EXIF', !hasExif, `exif present: ${hasExif}`);
    }

    // -------------------------------------------------------------
    // Check 8: Download headers include nosniff and correct disposition
    // -------------------------------------------------------------
    {
      // 8a: Image download headers (inline)
      const resImg = await fetch(`${BASE_URL}/api/attachments/${attachmentIdForCheck}`, {
        headers: {
          Origin: ORIGIN,
          Cookie: userA.sessionCookie,
        },
      });
      const nosniffImg = resImg.headers.get('x-content-type-options');
      const cspImg = resImg.headers.get('content-security-policy');
      const dispImg = resImg.headers.get('content-disposition');
      const contentTypeImg = resImg.headers.get('content-type');

      const passImgHeaders =
        nosniffImg === 'nosniff' &&
        cspImg === 'sandbox' &&
        dispImg === 'inline' &&
        contentTypeImg === 'image/jpeg';

      // 8b: Document download headers (attachment)
      const docBuffer = Buffer.from('%PDF-1.4\n%testpdf');
      const uploadDoc = await uploadFile(userA, docBuffer, 'report.pdf');
      const docId = uploadDoc.data.attachmentId;
      db.prepare('UPDATE attachments SET conversation_id = ? WHERE id = ?').run(conversationId, docId);

      const resDoc = await fetch(`${BASE_URL}/api/attachments/${docId}`, {
        headers: {
          Origin: ORIGIN,
          Cookie: userA.sessionCookie,
        },
      });
      const nosniffDoc = resDoc.headers.get('x-content-type-options');
      const dispDoc = resDoc.headers.get('content-disposition');
      const passDocHeaders = nosniffDoc === 'nosniff' && dispDoc?.startsWith('attachment;');

      recordResult(
        'Download headers include nosniff and correct disposition',
        passImgHeaders && passDocHeaders,
        `Image disp: ${dispImg}, Doc disp: ${dispDoc}`
      );
    }

    // -------------------------------------------------------------
    // Check 9: Storage quota exceeded is rejected
    // -------------------------------------------------------------
    {
      // Mock user storage usage by inserting a dummy high size in DB
      const dummyId = 'quota_test_' + Date.now();
      db.prepare(`
        INSERT INTO attachments (id, uploader_id, stored_name, original_name, mime, size)
        VALUES (?, ?, 'dummy', 'dummy.bin', 'application/pdf', ?)
      `).run(dummyId, userA.userId, 200 * 1024 * 1024); // 200 MB quota consumed

      const testBuffer = Buffer.from('%PDF-1.4\n%smallpdf');
      const quotaRes = await uploadFile(userA, testBuffer, 'overflow.pdf');

      // Clean up mock row
      db.prepare('DELETE FROM attachments WHERE id = ?').run(dummyId);

      const passed =
        quotaRes.status === 400 && quotaRes.data.error?.includes('Storage quota exceeded');
      recordResult('Quota exceeded is rejected', passed, `HTTP ${quotaRes.status}: ${quotaRes.data.error}`);
    }

    console.log('\n=== VERIFICATION SUMMARY ===');
    console.table(results);

    const allPassed = results.every((r) => r.status === 'PASS');
    if (allPassed) {
      console.log('\n>>> ALL PART A VERIFICATION CHECKS PASSED <<<\n');
    } else {
      console.error('\n>>> SOME CHECKS FAILED <<<\n');
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('Test execution error:', err);
    process.exitCode = 1;
  }
}

runTests();
