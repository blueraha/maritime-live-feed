import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, onAuthStateChanged, signOut, browserLocalPersistence, setPersistence } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, addDoc, query, orderBy, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const app = initializeApp({
  apiKey: "AIzaSyBuGoE5qGFuuXH99nNy4Y4f3waY2ZS4Nbk",
  authDomain: "maritime-live-feed.firebaseapp.com",
  projectId: "maritime-live-feed",
  storageBucket: "maritime-live-feed.firebasestorage.app",
  messagingSenderId: "599051690662",
  appId: "1:599051690662:web:233e351eb8bd571dc10a67"
});

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});

// === STATE ===
let currentUser = null, userProfile = null;
let activeTagFilter = 'all';
let postsCache = [], currentPostId = null, unsubPosts = null, unsubComments = null;
let selectedTag = null, mediaFile = null;

const $ = id => document.getElementById(id);

function showScreen(s) {
  ['loadingScreen','authScreen','roleScreen','appShell'].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.style.display = 'none';
  });
  if (s === 'loading') $('loadingScreen').style.display = 'flex';
  else if (s === 'auth') $('authScreen').style.display = 'flex';
  else if (s === 'role') $('roleScreen').style.display = 'flex';
  else if (s === 'app') { $('appShell').style.display = 'block'; startFeed(); }
}

// === AUTH ===
onAuthStateChanged(auth, async user => {
  if (user) {
    currentUser = user;
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) { userProfile = snap.data(); setupUI(); showScreen('app'); }
      else showScreen('role');
    } catch (e) { console.error(e); showScreen('role'); }
  } else {
    currentUser = null; userProfile = null;
    if (unsubPosts) { unsubPosts(); unsubPosts = null; }
    showScreen('auth');
  }
});

getRedirectResult(auth).catch(() => {});

// Google Sign In
function isInAppBrowser() {
  return /KAKAOTALK|NAVER|Line|Instagram|FBAN|FBAV|Twitter|wv\)/i.test(navigator.userAgent);
}

$('googleSignIn').addEventListener('click', async () => {
  const provider = new GoogleAuthProvider();
  if (isInAppBrowser()) {
    if (/android/i.test(navigator.userAgent)) {
      window.location.href = 'intent://' + window.location.href.replace(/https?:\/\//, '') + '#Intent;scheme=https;package=com.android.chrome;end';
      setTimeout(() => popup('Please open this link in Chrome or Safari directly. In-app browsers do not support Google Sign-In.'), 2000);
      return;
    }
    popup('Please open this link in Safari or Chrome directly.');
    return;
  }
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/popup-closed-by-user') {
      try { await signInWithRedirect(auth, provider); } catch (e2) { popup('Sign-in failed. Please try again.'); }
    } else {
      popup(e.message || 'Sign-in failed.');
    }
  }
});

function popup(msg) {
  $('popupMsg').textContent = msg;
  $('servicePopup').style.display = 'flex';
}
$('popupClose').addEventListener('click', () => $('servicePopup').style.display = 'none');

// === ROLE ===
let selectedRole = null;
document.querySelectorAll('.role-option').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.role-option').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedRole = btn.dataset.role;
    $('saveProfile').disabled = false;
  });
});

$('saveProfile').addEventListener('click', async () => {
  if (!selectedRole || !currentUser) return;
  const nick = $('nicknameInput').value.trim() || selectedRole + '_' + Math.floor(Math.random() * 1000);
  userProfile = { role: selectedRole, nickname: nick, createdAt: serverTimestamp() };
  await setDoc(doc(db, 'users', currentUser.uid), userProfile);
  setupUI();
  showScreen('app');
});

// === UI SETUP ===
function setupUI() {
  if (!userProfile) return;
  const init = (userProfile.nickname || userProfile.role).slice(0, 2).toUpperCase();
  $('avatarBtn').textContent = init;
  $('composerAvatar').textContent = init;
  $('profileName').textContent = userProfile.nickname || 'Anonymous';
  $('profileRole').textContent = userProfile.role;
  $('profileEmail').textContent = currentUser?.email || '';
}

$('avatarBtn').addEventListener('click', e => { e.stopPropagation(); $('profileDropdown').classList.toggle('show'); });
document.addEventListener('click', () => $('profileDropdown').classList.remove('show'));
$('signOutBtn').addEventListener('click', () => signOut(auth));

// === FEED ===
function startFeed() {
  if (unsubPosts) unsubPosts();
  const q = query(collection(db, 'events'), orderBy('createdAt', 'desc'));
  unsubPosts = onSnapshot(q, snap => {
    postsCache = [];
    snap.forEach(d => postsCache.push({ id: d.id, ...d.data() }));
    renderFeed();
  });
}

function renderFeed() {
  const feed = $('feed');
  const filtered = postsCache.filter(p => activeTagFilter === 'all' || p.type === activeTagFilter);

  if (!filtered.length) {
    feed.innerHTML = '<div class="empty-state"><div class="empty-icon">🌊</div><div class="empty-title">No posts yet</div><p>Be the first to share something.</p></div>';
    return;
  }

  feed.innerHTML = filtered.map((p, i) => {
    const ts = p.createdAt?.toDate ? p.createdAt.toDate().getTime() : Date.now();
    const init = (p.creatorNickname || p.creatorRole || '??').slice(0, 2).toUpperCase();
    const text = formatText(p.description || p.title || '');
    const tag = p.type ? `<span class="hashtag">#${p.type}</span>` : '';

    return `<div class="post-card" style="animation-delay:${i * 0.04}s">
      <div class="post-header">
        <div class="avatar-sm">${init}</div>
        <div class="post-user-info">
          <div class="post-name">${esc(p.creatorNickname || 'Anonymous')}</div>
          <div class="post-role">${esc(p.creatorRole || '')} · ${ago(ts)}</div>
        </div>
      </div>
      <div class="post-body">${text} ${tag}</div>
      ${p.location ? `<div class="post-location">📍 ${esc(p.location)}</div>` : ''}
      ${p.imageUrl ? (isVideo(p.imageUrl) ? `<video class="post-media-video" src="${p.imageUrl}" controls></video>` : `<img class="post-media" src="${p.imageUrl}" loading="lazy">`) : ''}
      <div class="post-footer">
        <button class="post-action" data-id="${p.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
          ${p.insightCount || 0} Comments
        </button>
        <button class="post-action">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/></svg>
          Share
        </button>
      </div>
    </div>`;
  }).join('');

  // Click handlers
  feed.querySelectorAll('.post-action[data-id]').forEach(btn => {
    btn.addEventListener('click', () => openDetail(btn.dataset.id));
  });
  feed.querySelectorAll('.post-media').forEach(img => {
    img.addEventListener('click', e => { e.stopPropagation(); $('viewerImage').src = img.src; $('imageViewer').classList.add('show'); });
  });
}

// Filter
$('filterBar').addEventListener('click', e => {
  const tag = e.target.closest('.tag');
  if (!tag) return;
  document.querySelectorAll('#filterBar .tag').forEach(t => t.classList.remove('active'));
  tag.classList.add('active');
  activeTagFilter = tag.dataset.tag;
  renderFeed();
});

// === COMPOSE ===
$('composerTrigger').addEventListener('click', openCompose);
$('composerPhotoBtn').addEventListener('click', () => { openCompose(); setTimeout(() => $('mediaInput').click(), 200); });
$('composerVideoBtn').addEventListener('click', () => { openCompose(); setTimeout(() => $('mediaInput').click(), 200); });
$('composerLocBtn').addEventListener('click', () => { openCompose(); setTimeout(() => $('composeLocation').style.display = 'flex', 200); });

function openCompose() {
  const init = (userProfile?.nickname || userProfile?.role || '??').slice(0, 2).toUpperCase();
  $('modalAvatar').textContent = init;
  $('modalName').textContent = userProfile?.nickname || 'Anonymous';
  $('modalRole').textContent = userProfile?.role || '';
  $('composeModal').classList.add('show');
  setTimeout(() => $('postText').focus(), 200);
}

$('composeClose').addEventListener('click', closeCompose);
$('composeModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeCompose(); });

function closeCompose() {
  $('composeModal').classList.remove('show');
  resetCompose();
}

function resetCompose() {
  $('postText').value = '';
  $('mediaPreview').style.display = 'none';
  $('mediaPreviewImg').style.display = 'none';
  $('mediaPreviewVid').style.display = 'none';
  $('composeLocation').style.display = 'none';
  $('locationInput').value = '';
  mediaFile = null;
  selectedTag = null;
  document.querySelectorAll('.ctag').forEach(t => t.classList.remove('active'));
  $('postBtn').disabled = true;
}

$('postText').addEventListener('input', () => {
  $('postBtn').disabled = !$('postText').value.trim();
});

// Media
$('mediaInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  mediaFile = file;
  const url = URL.createObjectURL(file);
  if (file.type.startsWith('video')) {
    $('mediaPreviewVid').src = url;
    $('mediaPreviewVid').style.display = 'block';
    $('mediaPreviewImg').style.display = 'none';
  } else {
    $('mediaPreviewImg').src = url;
    $('mediaPreviewImg').style.display = 'block';
    $('mediaPreviewVid').style.display = 'none';
  }
  $('mediaPreview').style.display = 'block';
});

$('mediaRemove').addEventListener('click', () => {
  mediaFile = null;
  $('mediaPreview').style.display = 'none';
  $('mediaInput').value = '';
});

// Location
$('addLocationBtn').addEventListener('click', () => {
  const loc = $('composeLocation');
  loc.style.display = loc.style.display === 'none' ? 'flex' : 'none';
});
$('locationRemove').addEventListener('click', () => {
  $('composeLocation').style.display = 'none';
  $('locationInput').value = '';
});

// Tags
$('composeTags').addEventListener('click', e => {
  const tag = e.target.closest('.ctag');
  if (!tag) return;
  if (tag.classList.contains('active')) {
    tag.classList.remove('active');
    selectedTag = null;
  } else {
    document.querySelectorAll('.ctag').forEach(t => t.classList.remove('active'));
    tag.classList.add('active');
    selectedTag = tag.dataset.tag;
  }
});

// POST
$('postBtn').addEventListener('click', async () => {
  const text = $('postText').value.trim();
  if (!text || !userProfile) return;

  const btn = $('postBtn');
  btn.disabled = true;
  btn.textContent = 'Posting...';

  try {
    let uploadedUrl = '';
    if (mediaFile) {
      const storageRef = ref(storage, 'posts/' + Date.now() + '_' + mediaFile.name);
      await uploadBytes(storageRef, mediaFile);
      uploadedUrl = await getDownloadURL(storageRef);
    }

    await addDoc(collection(db, 'events'), {
      creatorId: currentUser.uid,
      creatorRole: userProfile.role,
      creatorNickname: userProfile.nickname || '',
      type: selectedTag || '',
      title: '',
      description: text,
      location: $('locationInput').value.trim(),
      imageUrl: uploadedUrl,
      insightCount: 0,
      createdAt: serverTimestamp()
    });
    closeCompose();
    toast('Posted!');
  } catch (e) {
    toast('Error: ' + e.message);
  }
  btn.disabled = false;
  btn.textContent = 'Post';
});

// === DETAIL ===
function openDetail(id) {
  currentPostId = id;
  const p = postsCache.find(x => x.id === id);
  if (!p) return;

  const ts = p.createdAt?.toDate ? p.createdAt.toDate().getTime() : Date.now();
  const init = (p.creatorNickname || p.creatorRole || '??').slice(0, 2).toUpperCase();
  const text = formatText(p.description || p.title || '');
  const tag = p.type ? `<span class="hashtag">#${p.type}</span>` : '';

  $('detailBody').innerHTML = `
    <div class="detail-post">
      <div class="post-header">
        <div class="avatar-sm">${init}</div>
        <div class="post-user-info">
          <div class="post-name">${esc(p.creatorNickname || 'Anonymous')}</div>
          <div class="post-role">${esc(p.creatorRole || '')} · ${ago(ts)}</div>
        </div>
      </div>
      <div class="detail-post-text">${text} ${tag}</div>
      ${p.location ? `<div class="post-location">📍 ${esc(p.location)}</div>` : ''}
      ${p.imageUrl ? (isVideo(p.imageUrl) ? `<video class="detail-post-media post-media-video" src="${p.imageUrl}" controls style="width:100%;border-radius:8px"></video>` : `<img class="detail-post-media" src="${p.imageUrl}" style="width:100%;border-radius:8px;cursor:pointer">`) : ''}
    </div>
    <div class="comment-section-title">Comments</div>
    <div id="commentsList"><div style="text-align:center;padding:20px;color:var(--text3)">Loading...</div></div>`;

  $('detailView').classList.add('show');

  // Image click in detail
  const detImg = $('detailBody').querySelector('.detail-post-media:not(video)');
  if (detImg) detImg.addEventListener('click', () => { $('viewerImage').src = detImg.src; $('imageViewer').classList.add('show'); });

  // Comments realtime
  if (unsubComments) unsubComments();
  const cq = query(collection(db, 'events', id, 'insights'), orderBy('createdAt', 'desc'));
  unsubComments = onSnapshot(cq, snap => {
    const list = $('commentsList');
    if (!list) return;
    const comments = [];
    snap.forEach(d => comments.push({ id: d.id, ...d.data() }));
    if (!comments.length) {
      list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text3)">No comments yet. Be the first!</div>';
      return;
    }
    list.innerHTML = comments.map(c => {
      const cts = c.createdAt?.toDate ? c.createdAt.toDate().getTime() : Date.now();
      const cinit = (c.nickname || c.role || '??').slice(0, 2).toUpperCase();
      return `<div class="comment-card">
        <div class="avatar-sm" style="width:32px;height:32px;font-size:11px">${cinit}</div>
        <div class="comment-body">
          <span class="comment-name">${esc(c.nickname || 'Anonymous')}</span>
          <span class="comment-role-badge">${esc(c.role || '')}</span>
          <div class="comment-text">${esc(c.text)}</div>
          <div class="comment-time">${ago(cts)}</div>
        </div>
      </div>`;
    }).join('');
  });
}

$('backBtn').addEventListener('click', () => {
  $('detailView').classList.remove('show');
  currentPostId = null;
  if (unsubComments) { unsubComments(); unsubComments = null; }
});

// Send comment
$('sendComment').addEventListener('click', sendComment);
$('commentInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendComment(); });

async function sendComment() {
  const text = $('commentInput').value.trim();
  if (!text || !currentPostId || !userProfile) return;
  $('commentInput').value = '';
  try {
    await addDoc(collection(db, 'events', currentPostId, 'insights'), {
      userId: currentUser.uid,
      role: userProfile.role,
      nickname: userProfile.nickname || '',
      text,
      createdAt: serverTimestamp()
    });
    const refDoc = doc(db, 'events', currentPostId);
    const snap = await getDoc(refDoc);
    if (snap.exists()) {
      await setDoc(refDoc, { insightCount: (snap.data().insightCount || 0) + 1 }, { merge: true });
    }
    toast('Comment posted!');
  } catch (e) { toast('Error: ' + e.message); }
}

// === SEED DATA ===
async function seedDemoData() {
  try {
    const snap = await getDocs(collection(db, 'events'));
    let hasSeed = false;
    snap.forEach(d => { if (d.data().creatorId === 'demo_seed') hasSeed = true; });
    if (hasSeed) return;

    const posts = [
      { role: 'Master', nick: 'Capt_Kim', type: 'near-miss', text: 'Close quarter situation in Singapore Strait. A small fishing vessel crossed our bow at 0.3 NM while transiting eastbound in the TSS. Immediate helm action taken. CPA was just 0.15 NM. The fishing vessel had no AIS active. Stay sharp out there.', loc: 'Singapore Strait' },
      { role: 'Mate', nick: 'OOW_Tokyo', type: 'traffic', text: 'Extremely heavy traffic at western approach of Malacca Strait TSS this morning. Over 40 vessels on radar within 6 NM. Multiple VHF calls needed to coordinate with crossing vessels. Extra vigilance recommended during 0400-0800 UTC.', loc: 'Malacca Strait' },
      { role: 'Master', nick: 'Capt_Jensen', type: 'weather', text: 'Visibility dropped from 5 NM to less than 0.2 NM within 10 minutes approaching Busan anchorage. Fog signal activated, speed reduced. Had to anchor after 2-hour delay. Local forecast completely missed this one.', loc: 'Busan, South Korea' },
      { role: 'Engineer', nick: 'CE_Patel', type: 'equipment', text: 'Turbocharger #2 surging at 85% MCR. Exhaust gas temp showed 30°C deviation across cylinders. Reduced to half ahead and cleaned turbo grid. Root cause: fouled air cooler. Tropical waters are brutal on the machinery.', loc: 'Indian Ocean' },
      { role: 'Mate', nick: 'OOW_Santos', type: 'navigation', text: 'ECDIS showed charted depth of 15m near Port Said but echo sounder read 11.2m. Reported to Hydrographic Office — nav warning confirmed recent siltation 6 hours later. Always cross-check your electronic charts with real-time soundings!', loc: 'Port Said, Egypt' },
      { role: 'Master', nick: 'Capt_Andersen', type: 'near-miss', text: 'Vessel dragged anchor 0.4 NM during Typhoon GAEMI despite 8 shackles in water. Engine on standby saved us. Two other vessels also reported dragging. Deep-water anchorage with better holding ground is essential during typhoon season.', loc: 'Kaohsiung, Taiwan' },
      { role: 'Engineer', nick: 'ENG_Liu', type: 'equipment', text: 'Ballast pump #1 tripped on overload during de-ballasting in Rotterdam. Seized bearing due to missed lubrication schedule. Backup pump took 15 min to activate. Cargo ops delayed 2 hours. We\'ve now shortened maintenance intervals.', loc: 'Rotterdam, Netherlands' },
      { role: 'Mate', nick: 'OOW_Garcia', type: 'traffic', text: 'About 80 small fishing vessels without AIS blocking the approach to Callao anchorage. VHF Ch.16 calls went completely unanswered. Pilot advised alternate approach bearing. 4-hour delay. This happens every fishing season Jan-Mar.', loc: 'Callao, Peru' },
      { role: 'Master', nick: 'Capt_Okonkwo', type: 'other', text: 'Two stowaways found in cargo hold 24 hours after departing Apapa Terminal, Lagos. Both in poor health. Medical aid provided, P&I Club notified. Full security audit ordered. ISPS Level 2 should be maintained during entire stay at West African ports.', loc: 'Gulf of Guinea' },
      { role: 'Mate', nick: 'OOW_Nakamura', type: 'weather', text: 'Rogue wave estimated 12m hit us at 0245 LT during otherwise 4-5m seas in North Pacific. Green water over bow reached bridge front. Forward containers shifted, two lashing rods broken. Altered course 30° to reduce slamming. Scary stuff.', loc: 'North Pacific Ocean' },
      { role: 'Engineer', nick: 'CE_Müller', type: 'navigation', text: 'GPS showing erratic position jumps of 2-5 NM near Jeddah. Switched to GLONASS backup — radar confirmed actual position. Incident lasted 45 minutes. Reported to flag state. GPS jamming is becoming more common in this region.', loc: 'Jeddah, Saudi Arabia' }
    ];

    const comments = {
      0: [
        { role: 'Master', nick: 'Capt_Park', text: 'Had the same last month. I now limit to 12 knots in the TSS at night. Better late than never.' },
        { role: 'Mate', nick: 'OOW_Williams', text: 'Recommend 5 short blasts per COLREG Rule 34(d) immediately. Log the fishing vessel details too.' },
        { role: 'Engineer', nick: 'CE_Singh', text: 'From ER perspective — tell us early so we can have full maneuvering power ready instead of eco mode.' }
      ],
      1: [
        { role: 'Master', nick: 'Capt_Li', text: 'Transit during slack tide. Current change around 1200 UTC reduces crossing traffic significantly.' },
        { role: 'Mate', nick: 'OOW_Brown', text: 'I plot all targets with 12-min vectors in this area. TCPA alarm at 10 min minimum.' }
      ],
      2: [
        { role: 'Master', nick: 'Capt_Tanaka', text: 'Busan approach notorious for sudden fog in spring. Anchor ready and engines on standby from 5 NM out.' },
        { role: 'Mate', nick: 'OOW_Chen', text: 'S-band radar works better than X-band in heavy fog for close-range detection.' }
      ],
      3: [
        { role: 'Engineer', nick: 'ENG_Santos', text: 'Turbo wash every 500 hours in tropical waters makes a huge difference. Check scavenge drain regularly too.' },
        { role: 'Master', nick: 'Capt_Nielsen', text: 'Good call reducing speed. Bridge needs to know these limitations for ETA planning.' }
      ],
      4: [
        { role: 'Mate', nick: 'OOW_Petrov', text: 'Always cross-reference with latest NtM. Found 3 chart discrepancies in Suez approach last year.' },
        { role: 'Master', nick: 'Capt_Hassan', text: 'I require all OOWs to compare echo sounder with chart every 15 min in pilotage waters.' }
      ],
      5: [
        { role: 'Master', nick: 'Capt_Chen', text: 'During typhoon season, engine always on standby at anchor. Fuel cost is nothing vs grounding risk.' },
        { role: 'Engineer', nick: 'CE_Fernandez', text: 'ER was ready in 2 min for our similar event. Monthly anchor windlass emergency drills help a lot.' },
        { role: 'Mate', nick: 'OOW_Yamamoto', text: 'We plot anchor position on ECDIS with 0.1 NM alarm circle. Any drift triggers immediate alert.' }
      ],
      6: [
        { role: 'Engineer', nick: 'ENG_Kowalski', text: 'Bearing seizure often means bigger maintenance issues. Recommend vibration analysis on all pumps at next dry dock.' }
      ],
      7: [
        { role: 'Mate', nick: 'OOW_Rivera', text: 'Carry spare fishing frequency VHF channels for South American ports. Ch.16 is rarely monitored by small fishermen.' },
        { role: 'Master', nick: 'Capt_Mendoza', text: 'Request pilot 2 hours early at Callao during fishing season. They know the safe corridors.' }
      ],
      8: [
        { role: 'Master', nick: 'Capt_James', text: 'West African ports need thorough hold inspections before departure. Full sweep with security team when possible.' },
        { role: 'Mate', nick: 'OOW_Diallo', text: 'Deck watches every 30 min minimum during Apapa stay. Can\'t be too careful.' }
      ],
      9: [
        { role: 'Master', nick: 'Capt_Olsen', text: 'Rogue waves more frequent in North Pacific winter. I route 5° further south Dec-Feb even if it adds a day.' },
        { role: 'Mate', nick: 'OOW_Park', text: 'We installed container lashing sensors that alert bridge when forces exceed design limits. Worth the investment.' },
        { role: 'Engineer', nick: 'CE_Kim', text: 'Check all bilge alarms and WT door indicators after such an event. We found a cracked forward peak tank plate.' }
      ],
      10: [
        { role: 'Mate', nick: 'OOW_Abbas', text: 'GPS jamming around Red Sea and Arabian Gulf is increasingly common. Keep celestial fix capability as backup.' },
        { role: 'Master', nick: 'Capt_Johansson', text: 'Reported similar to IMO MSC. Flag states need these reports to pressure regional authorities.' }
      ]
    };

    for (let i = 0; i < posts.length; i++) {
      const p = posts[i];
      const eventRef = await addDoc(collection(db, 'events'), {
        creatorId: 'demo_seed',
        creatorRole: p.role,
        creatorNickname: p.nick,
        type: p.type,
        title: '',
        description: p.text,
        location: p.loc,
        imageUrl: '',
        insightCount: (comments[i] || []).length,
        createdAt: serverTimestamp()
      });
      if (comments[i]) {
        for (const c of comments[i]) {
          await addDoc(collection(db, 'events', eventRef.id, 'insights'), {
            userId: 'demo_seed', role: c.role, nickname: c.nick, text: c.text, createdAt: serverTimestamp()
          });
        }
      }
    }
    console.log('Seed data created');
  } catch (e) { console.error('Seed error:', e); }
}

onAuthStateChanged(auth, u => { if (u) seedDemoData(); });

// === UTILS ===
function formatText(t) {
  return esc(t).replace(/#([\w-]+)/g, '<span class="hashtag">#$1</span>');
}
function isVideo(url) { return /\.(mp4|mov|webm|avi)/i.test(url) || url.includes('video'); }
function ago(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h';
  return Math.floor(h / 24) + 'd';
}
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// Image viewer
$('imageViewer').addEventListener('click', () => $('imageViewer').classList.remove('show'));

// PWA
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
