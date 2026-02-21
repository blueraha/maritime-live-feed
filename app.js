import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, onAuthStateChanged, signOut, browserLocalPersistence, setPersistence } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, addDoc, query, orderBy, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const app = initializeApp({
  apiKey: "AIzaSyBuGoE5qGFuuXH59nNy4Y4f3waY2ZS4Nbk",
  authDomain: "maritime-live-feed.firebaseapp.com",
  projectId: "maritime-live-feed",
  storageBucket: "maritime-live-feed.firebasestorage.app",
  messagingSenderId: "599051690662",
  appId: "1:599051690662:web:233e351eb8bd571dc10a67"
});

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Set persistence to local to avoid sessionStorage issues on mobile
setPersistence(auth, browserLocalPersistence).catch(e => console.warn('Persistence error:', e));

// === STATE ===
let currentUser = null, userProfile = null, selectedEventType = null;
let activeRoleFilter = 'all', activeTypeFilter = 'all';
let eventsCache = [], currentDetailEventId = null, unsubEvents = null;

const $ = id => document.getElementById(id);
const $loading = $('loadingScreen'), $auth = $('authScreen'), $role = $('roleScreen'), $app = $('appShell');

function showScreen(s) {
  [$loading, $auth, $role, $app].forEach(el => el.style.display = 'none');
  if (s === 'loading') $loading.style.display = 'flex';
  else if (s === 'auth') $auth.style.display = 'flex';
  else if (s === 'role') { $role.style.display = 'flex'; $role.style.flexDirection = 'column'; }
  else if (s === 'app') { $app.style.display = 'block'; startRealtimeFeed(); }
}

// === AUTH STATE ===
onAuthStateChanged(auth, async user => {
  if (user) {
    currentUser = user;
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) { userProfile = snap.data(); setupAppUI(); showScreen('app'); }
      else showScreen('role');
    } catch (e) { console.error(e); showScreen('role'); }
  } else {
    currentUser = null; userProfile = null;
    if (unsubEvents) { unsubEvents(); unsubEvents = null; }
    showScreen('auth');
  }
});

// Handle redirect result for mobile browsers
getRedirectResult(auth).catch(e => {
  if (e.code !== 'auth/null-user') {
    console.warn('Redirect result error:', e);
  }
});

// === GOOGLE SIGN IN ===
function isInAppBrowser() {
  const ua = navigator.userAgent || '';
  return /KAKAOTALK|NAVER|Line|Instagram|FBAN|FBAV|Twitter|wv\)/i.test(ua);
}

$('googleSignIn').addEventListener('click', async () => {
  const provider = new GoogleAuthProvider();

  // In-app browsers (KakaoTalk, etc.) block Google popup. Open in external browser.
  if (isInAppBrowser()) {
    // Try to open in system browser
    const currentUrl = window.location.href;
    // For Android: intent scheme to open in Chrome
    if (/android/i.test(navigator.userAgent)) {
      window.location.href = 'intent://' + currentUrl.replace(/https?:\/\//, '') + '#Intent;scheme=https;package=com.android.chrome;end';
      setTimeout(() => {
        // Fallback: just show message
        showServicePopup('Please open this link in Chrome or Safari browser directly. In-app browsers (KakaoTalk, etc.) do not support Google Sign-In.');
      }, 2000);
      return;
    }
    // For iOS or others
    showServicePopup('Please open this link in Safari or Chrome browser directly. In-app browsers do not support Google Sign-In.');
    return;
  }

  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') {
      try {
        await signInWithRedirect(auth, provider);
      } catch (e2) {
        showServicePopup('Google Sign-In failed. Please try opening this link in Chrome or Safari browser directly.');
      }
    } else {
      showServicePopup(e.message || 'Sign-in is temporarily unavailable. Please try again later.');
    }
  }
});

// === SERVICE POPUP ===
function showServicePopup(msg) {
  const overlay = document.createElement('div');
  overlay.className = 'service-popup-overlay';
  overlay.innerHTML = `
    <div class="service-popup">
      <div class="service-popup-icon">🚧</div>
      <h2>Notice</h2>
      <p>${msg || 'This feature is currently being configured. Please try again later.'}</p>
      <button onclick="this.closest('.service-popup-overlay').remove()">Got it</button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

// === ROLE SELECTION ===
let selectedRole = null;
document.querySelectorAll('.role-option').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.role-option').forEach(b => b.style.borderColor = 'var(--border)');
    btn.style.borderColor = 'var(--accent)';
    selectedRole = btn.dataset.role;
    $('saveProfile').disabled = false;
  });
});

$('saveProfile').addEventListener('click', async () => {
  if (!selectedRole || !currentUser) return;
  const nick = $('nicknameInput').value.trim() || selectedRole + '_' + Math.floor(Math.random() * 1000);
  userProfile = { role: selectedRole, nickname: nick, createdAt: serverTimestamp() };
  await setDoc(doc(db, 'users', currentUser.uid), userProfile);
  setupAppUI();
  showScreen('app');
});

// === APP UI ===
function setupAppUI() {
  if (!userProfile) return;
  const init = (userProfile.nickname || userProfile.role).slice(0, 2).toUpperCase();
  $('avatarBtn').textContent = init;
  $('profileName').textContent = userProfile.nickname || 'Anonymous';
  $('profileRole').textContent = userProfile.role;
  $('profileEmail').textContent = currentUser?.email || '';
}

$('avatarBtn').addEventListener('click', e => {
  e.stopPropagation();
  $('profileDropdown').classList.toggle('show');
});
document.addEventListener('click', () => $('profileDropdown').classList.remove('show'));
$('signOutBtn').addEventListener('click', () => signOut(auth));

// === REALTIME FEED ===
function startRealtimeFeed() {
  if (unsubEvents) unsubEvents();
  const q = query(collection(db, 'events'), orderBy('createdAt', 'desc'));
  unsubEvents = onSnapshot(q, snap => {
    eventsCache = [];
    snap.forEach(d => eventsCache.push({ id: d.id, ...d.data() }));
    renderFeed();
    updateSummary();
  });
}

function renderFeed() {
  const feed = $('feed');
  const filtered = eventsCache.filter(e => {
    if (activeTypeFilter !== 'all' && e.type !== activeTypeFilter) return false;
    if (activeRoleFilter !== 'all' && e.creatorRole?.toLowerCase() !== activeRoleFilter) return false;
    return true;
  });

  if (!filtered.length) {
    feed.innerHTML = '<div class="empty-state"><div class="empty-icon">🌊</div><div class="empty-title">No events yet</div><div class="empty-desc">Be the first to share a maritime event.</div></div>';
    return;
  }

  feed.innerHTML = filtered.map((e, i) => {
    const ts = e.createdAt?.toDate ? e.createdAt.toDate().getTime() : Date.now();
    const isNew = (Date.now() - ts) < 3600000;
    return `<div class="event-card" data-id="${e.id}" style="animation-delay:${i * 0.05}s">
      <div class="card-type-bar ${e.type}"></div>
      <div class="card-body">
        <div class="card-meta">
          <span class="card-type-badge ${e.type}">${fmtType(e.type)}</span>
          ${isNew ? '<span class="card-new">NEW</span>' : ''}
        </div>
        <div class="card-title">${esc(e.title)}</div>
        ${e.imageUrl ? `<img src="${e.imageUrl}" class="card-image">` : ''}
        <div class="card-preview">
          <span class="role-tag">${esc(e.creatorRole || '')}:</span>
          ${esc(e.description || 'No description')}
        </div>
        <div class="card-footer">
          <div class="card-footer-left">
            <span class="card-stat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>${e.insightCount || 0}</span>
            ${e.location ? `<span class="card-stat">📍 ${esc(e.location)}</span>` : ''}
          </div>
          <span class="card-time">${ago(ts)}</span>
        </div>
      </div>
    </div>`;
  }).join('');

  feed.querySelectorAll('.event-card').forEach(card => {
    card.addEventListener('click', () => openDetail(card.dataset.id));
  });
}

function updateSummary() {
  let ins = 0;
  eventsCache.forEach(e => ins += (e.insightCount || 0));
  $('summaryText').textContent = `Today: ${eventsCache.length} events • ${ins} decisions shared`;
}

// === EVENT DETAIL ===
let unsubInsights = null;

function openDetail(id) {
  currentDetailEventId = id;
  const e = eventsCache.find(x => x.id === id);
  if (!e) return;

  $('detailType').textContent = fmtType(e.type);
  $('detailType').style.color = typeColor(e.type);
  $('detailTitle').textContent = e.title;
  $('detailBody').innerHTML = `
    <div class="detail-desc">${esc(e.description || 'No description.')}</div>
    <div class="detail-section-title">Decisions</div>
    <div id="insightsList"><div class="loading-text" style="text-align:center;padding:20px">Loading...</div></div>`;
  $('detailView').classList.add('show');

  if (unsubInsights) unsubInsights();
  const iq = query(collection(db, 'events', id, 'insights'), orderBy('createdAt', 'desc'));
  unsubInsights = onSnapshot(iq, snap => {
    const list = $('insightsList');
    if (!list) return;
    const insights = [];
    snap.forEach(d => insights.push({ id: d.id, ...d.data() }));
    if (!insights.length) {
      list.innerHTML = '<div class="empty-state"><div class="empty-desc">No decisions yet. Be the first!</div></div>';
      return;
    }
    list.innerHTML = insights.map(ins => {
      const ts = ins.createdAt?.toDate ? ins.createdAt.toDate().getTime() : Date.now();
      return `<div class="insight-card">
        <div class="insight-header">
          <span class="insight-role">${esc(ins.role || '')}</span>
          <span class="insight-time">${ago(ts)}</span>
        </div>
        <div class="insight-text">${esc(ins.text)}</div>
      </div>`;
    }).join('');
  });
}

// === SEND INSIGHT ===
$('sendInsight').addEventListener('click', sendInsight);
$('insightInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendInsight(); });

async function sendInsight() {
  const input = $('insightInput');
  const text = input.value.trim();
  if (!text || !currentDetailEventId || !userProfile) return;
  input.value = '';

  try {
    await addDoc(collection(db, 'events', currentDetailEventId, 'insights'), {
      userId: currentUser.uid,
      role: userProfile.role,
      nickname: userProfile.nickname || '',
      text,
      createdAt: serverTimestamp()
    });
    const refDoc = doc(db, 'events', currentDetailEventId);
    const snap = await getDoc(refDoc);
    if (snap.exists()) {
      await setDoc(refDoc, { insightCount: (snap.data().insightCount || 0) + 1 }, { merge: true });
    }
    toast('Decision shared!');
  } catch (e) {
    toast('Error: ' + e.message);
  }
}

// === CREATE EVENT ===
$('createBtn').addEventListener('click', () => $('createModal').classList.add('show'));
$('closeModal').addEventListener('click', () => { $('createModal').classList.remove('show'); resetForm(); });
$('createModal').addEventListener('click', e => {
  if (e.target === e.currentTarget) { e.currentTarget.classList.remove('show'); resetForm(); }
});

$('typeGrid').addEventListener('click', e => {
  const opt = e.target.closest('.type-option');
  if (!opt) return;
  document.querySelectorAll('.type-option').forEach(o => o.classList.remove('selected'));
  opt.classList.add('selected');
  selectedEventType = opt.dataset.type;
  chkSubmit();
});

$('eventTitle').addEventListener('input', chkSubmit);

function chkSubmit() {
  $('submitEvent').disabled = !(selectedEventType && $('eventTitle').value.trim());
}

$('submitEvent').addEventListener('click', async () => {
  const title = $('eventTitle').value.trim();
  const desc = $('eventDesc').value.trim();
  const loc = $('eventLoc').value.trim();
  if (!selectedEventType || !title || !userProfile) return;

  const btn = $('submitEvent');
  btn.disabled = true;
  btn.textContent = 'Creating...';

  try {
    let uploadedImageUrl = '';
    const file = $('eventImage').files[0];
    if (file) {
      const storageRef = ref(storage, 'events/' + Date.now() + '_' + file.name);
      await uploadBytes(storageRef, file);
      uploadedImageUrl = await getDownloadURL(storageRef);
    }

    await addDoc(collection(db, 'events'), {
      creatorId: currentUser.uid,
      creatorRole: userProfile.role,
      creatorNickname: userProfile.nickname || '',
      type: selectedEventType,
      title,
      description: desc || '',
      location: loc || '',
      imageUrl: uploadedImageUrl,
      insightCount: 0,
      createdAt: serverTimestamp()
    });
    $('createModal').classList.remove('show');
    resetForm();
    toast('Event created!');
  } catch (e) {
    toast('Error: ' + e.message);
    btn.disabled = false;
    btn.textContent = 'Create Event';
  }
});

function resetForm() {
  selectedEventType = null;
  $('eventTitle').value = '';
  $('eventDesc').value = '';
  $('eventLoc').value = '';
  document.querySelectorAll('.type-option').forEach(o => o.classList.remove('selected'));
  $('submitEvent').disabled = true;
  $('submitEvent').textContent = 'Create Event';
}

// === DETAIL BACK ===
$('backBtn').addEventListener('click', () => {
  $('detailView').classList.remove('show');
  currentDetailEventId = null;
  if (unsubInsights) { unsubInsights(); unsubInsights = null; }
});

// === FILTERS ===
$('roleFilter').addEventListener('click', e => {
  if (!e.target.classList.contains('filter-chip')) return;
  document.querySelectorAll('#roleFilter .filter-chip').forEach(c => c.classList.remove('active'));
  e.target.classList.add('active');
  activeRoleFilter = e.target.dataset.role;
  renderFeed();
});

$('typeFilter').addEventListener('click', e => {
  if (!e.target.classList.contains('filter-chip')) return;
  document.querySelectorAll('#typeFilter .filter-chip').forEach(c => c.classList.remove('active'));
  e.target.classList.add('active');
  activeTypeFilter = e.target.dataset.type;
  renderFeed();
});

// === SEED DATA ===
async function seedDemoData() {
  try {
    const eventsSnap = await getDocs(collection(db, 'events'));
    if (eventsSnap.size > 0) return; // Already has data

    const seedEvents = [
      {
        creatorId: 'demo_seed', creatorRole: 'Master', creatorNickname: 'Capt_Kim',
        type: 'near-miss', title: 'Close quarter situation in Singapore Strait',
        description: 'While transiting eastbound in the TSS, a small fishing vessel crossed our bow at approximately 0.3 NM. Immediate helm action taken to starboard. All crew alerted. Vessel passed safely with CPA of 0.15 NM. AIS showed the fishing vessel had no transponder active.',
        location: 'Singapore Strait', imageUrl: '', insightCount: 3, createdAt: serverTimestamp()
      },
      {
        creatorId: 'demo_seed', creatorRole: 'Mate', creatorNickname: 'OOW_Tokyo',
        type: 'traffic', title: 'Heavy traffic congestion at Malacca TSS entry',
        description: 'Experienced extremely heavy traffic at the western approach of Malacca Strait TSS. Over 40 vessels visible on radar within 6 NM. Multiple VHF calls required to coordinate with crossing vessels. Recommend extra vigilance during 0400–0800 UTC window.',
        location: 'Malacca Strait', imageUrl: '', insightCount: 2, createdAt: serverTimestamp()
      },
      {
        creatorId: 'demo_seed', creatorRole: 'Master', creatorNickname: 'Capt_Jensen',
        type: 'weather', title: 'Sudden fog bank encountered off Busan',
        description: 'Visibility dropped from 5 NM to less than 0.2 NM within 10 minutes approaching Busan anchorage. Fog signal activated, speed reduced to bare steerage. Radar watch doubled. Anchored safely after 2-hour delay. Local forecast had not predicted this event.',
        location: 'Busan, South Korea', imageUrl: '', insightCount: 2, createdAt: serverTimestamp()
      },
      {
        creatorId: 'demo_seed', creatorRole: 'Engineer', creatorNickname: 'CE_Patel',
        type: 'equipment', title: 'Main engine turbocharger surge during full ahead',
        description: 'Turbocharger #2 experienced surging at 85% MCR. Exhaust gas temperatures showed 30°C deviation across cylinders. Reduced to half ahead and cleaned turbo grid. Root cause appears to be fouled air cooler. Scheduled full cleaning at next port.',
        location: 'Indian Ocean', imageUrl: '', insightCount: 2, createdAt: serverTimestamp()
      },
      {
        creatorId: 'demo_seed', creatorRole: 'Mate', creatorNickname: 'OOW_Santos',
        type: 'navigation', title: 'ECDIS chart discrepancy noted near Port Said',
        description: 'While approaching Port Said, ECDIS displayed a charted depth of 15m in an area where echo sounder showed 11.2m. Reported to the Hydrographic Office. Navigational warning issued 6 hours later confirming recent siltation. Always cross-check electronic charts with real-time soundings.',
        location: 'Port Said, Egypt', imageUrl: '', insightCount: 2, createdAt: serverTimestamp()
      },
      {
        creatorId: 'demo_seed', creatorRole: 'Master', creatorNickname: 'Capt_Andersen',
        type: 'near-miss', title: 'Anchor dragging during typhoon anchorage in Kaohsiung',
        description: 'During Typhoon GAEMI, vessel dragged anchor 0.4 NM despite 8 shackles in water. Engine put on standby and used to maintain position. Two other vessels in the anchorage also reported dragging. Harbor master issued emergency VHF broadcast. Recommend deep-water anchorage with better holding ground.',
        location: 'Kaohsiung, Taiwan', imageUrl: '', insightCount: 3, createdAt: serverTimestamp()
      },
      {
        creatorId: 'demo_seed', creatorRole: 'Engineer', creatorNickname: 'ENG_Liu',
        type: 'equipment', title: 'Ballast pump failure during cargo operations in Rotterdam',
        description: 'No.1 ballast pump tripped on overload during de-ballasting. Investigation revealed seized bearing due to lack of lubrication. Backup pump activated within 15 minutes. Cargo operations delayed by 2 hours. Maintenance schedule has been reviewed and intervals shortened.',
        location: 'Rotterdam, Netherlands', imageUrl: '', insightCount: 1, createdAt: serverTimestamp()
      },
      {
        creatorId: 'demo_seed', creatorRole: 'Mate', creatorNickname: 'OOW_Garcia',
        type: 'traffic', title: 'Fishing fleet blocking approach to Callao anchorage',
        description: 'Approximately 80 small fishing vessels operating without AIS blocked the designated anchorage approach channel. VHF calls on Ch.16 went unanswered. Pilot advised to approach from alternate bearing. Delay of 4 hours to anchorage. Common occurrence during fishing season Jan–Mar.',
        location: 'Callao, Peru', imageUrl: '', insightCount: 2, createdAt: serverTimestamp()
      },
      {
        creatorId: 'demo_seed', creatorRole: 'Master', creatorNickname: 'Capt_Okonkwo',
        type: 'other', title: 'Stowaway discovered in cargo hold after departure from Lagos',
        description: 'During routine cargo hold inspection 24 hours after departure from Apapa Terminal, two stowaways were found hiding behind container stacks. Both were in poor health. Medical aid provided, P&I Club notified, and course adjusted for nearest safe port. Full security audit ordered.',
        location: 'Gulf of Guinea', imageUrl: '', insightCount: 2, createdAt: serverTimestamp()
      },
      {
        creatorId: 'demo_seed', creatorRole: 'Mate', creatorNickname: 'OOW_Nakamura',
        type: 'weather', title: 'Rogue wave impact during North Pacific crossing',
        description: 'At 0245 LT, vessel encountered abnormally large wave estimated at 12m in otherwise 4–5m sea state. Green water over bow reached bridge front. Forward containers shifted. Two lashing rods broken. Speed reduced and course altered 30° to reduce slamming. Full damage inspection conducted at daylight.',
        location: 'North Pacific Ocean', imageUrl: '', insightCount: 3, createdAt: serverTimestamp()
      },
      {
        creatorId: 'demo_seed', creatorRole: 'Engineer', creatorNickname: 'CE_Müller',
        type: 'navigation', title: 'GPS signal jamming detected near port of Jeddah',
        description: 'Both GPS receivers showed erratic position jumps of 2–5 NM while approaching Jeddah Islamic Port. Switched to GLONASS backup. Radar position fixing confirmed actual position. Incident lasted approximately 45 minutes. Reported to flag state. Gyro heading remained stable throughout.',
        location: 'Jeddah, Saudi Arabia', imageUrl: '', insightCount: 2, createdAt: serverTimestamp()
      }
    ];

    const seedInsights = {
      0: [
        { role: 'Master', nickname: 'Capt_Park', text: 'We had a similar encounter last month. I now maintain 12 knots max in the TSS at night. Better to arrive late than not at all.' },
        { role: 'Mate', nickname: 'OOW_Williams', text: 'Recommend sounding 5 short blasts immediately per COLREG Rule 34(d). Also log the fishing vessel details for port state report.' },
        { role: 'Engineer', nickname: 'CE_Singh', text: 'From engine room perspective, keep us informed early so we can have full maneuvering power ready instead of running on eco mode.' }
      ],
      1: [
        { role: 'Master', nickname: 'Capt_Li', text: 'Best to transit this section during slack tide. The current change reduces crossing traffic significantly around 1200 UTC.' },
        { role: 'Mate', nickname: 'OOW_Brown', text: 'I plot all targets with vectors at 12-minute intervals in this area. TCPA alarms set to 10 minutes minimum.' }
      ],
      2: [
        { role: 'Master', nickname: 'Capt_Tanaka', text: 'Busan approach is notorious for sudden fog in spring. We always have anchor ready and engines on standby from 5 NM out.' },
        { role: 'Mate', nickname: 'OOW_Chen', text: 'Recommend using S-band radar over X-band in heavy fog. Better detection of smaller targets at close range.' }
      ],
      3: [
        { role: 'Engineer', nickname: 'ENG_Santos', text: 'We experienced the same issue. Turbo wash every 500 hours in tropical waters made a huge difference. Also check scavenge drain regularly.' },
        { role: 'Master', nickname: 'Capt_Nielsen', text: 'Good call reducing speed. Bridge needs to know about these limitations so we can plan ETAs accordingly.' }
      ],
      4: [
        { role: 'Mate', nickname: 'OOW_Petrov', text: 'Always cross-reference with latest NtM. We found 3 chart discrepancies in the Suez Canal approach last year.' },
        { role: 'Master', nickname: 'Capt_Hassan', text: 'Excellent practice. I require all OOWs to compare echo sounder with charted depth every 15 minutes in pilotage waters.' }
      ],
      5: [
        { role: 'Master', nickname: 'Capt_Chen', text: 'During typhoon season, I always keep the engine on standby at anchor. The cost of fuel is nothing compared to the risk of grounding.' },
        { role: 'Engineer', nickname: 'CE_Fernandez', text: 'Engine room was ready within 2 minutes for our similar incident. We now do monthly anchor windlass emergency drills.' },
        { role: 'Mate', nickname: 'OOW_Yamamoto', text: 'We plot anchor position on ECDIS with a 0.1 NM alarm circle. Any movement triggers immediate bridge alert.' }
      ],
      6: [
        { role: 'Engineer', nickname: 'ENG_Kowalski', text: 'Bearing seizure is often a sign of bigger maintenance issues. Recommend vibration analysis on all pumps during next dry dock.' }
      ],
      7: [
        { role: 'Mate', nickname: 'OOW_Rivera', text: 'We carry a spare set of fishing frequency VHF channels for South American ports. Ch.16 is rarely monitored by small fishermen.' },
        { role: 'Master', nickname: 'Capt_Mendoza', text: 'I always request pilot 2 hours before arrival at Callao during fishing season. They know the safe corridors.' }
      ],
      8: [
        { role: 'Master', nickname: 'Capt_James', text: 'West African ports require thorough hold inspections before departure. We do a full sweep with security team and sniffer dogs when available.' },
        { role: 'Mate', nickname: 'OOW_Diallo', text: 'ISPS Code Level 2 should be maintained during the entire stay at Apapa. Deck watches every 30 minutes minimum.' }
      ],
      9: [
        { role: 'Master', nickname: 'Capt_Olsen', text: 'Rogue waves are becoming more frequent in the North Pacific winter. I now route 5° further south during Dec–Feb even if it adds a day.' },
        { role: 'Mate', nickname: 'OOW_Park', text: 'After a similar event, we installed additional container lashing sensors that alert the bridge when forces exceed design limits.' },
        { role: 'Engineer', nickname: 'CE_Kim', text: 'Check all bilge alarms and watertight door indicators after such an event. We found a cracked forward peak tank inspection plate.' }
      ],
      10: [
        { role: 'Mate', nickname: 'OOW_Abbas', text: 'GPS jamming around the Red Sea and Arabian Gulf is increasingly common. Keep a celestial fix ready as last resort backup.' },
        { role: 'Master', nickname: 'Capt_Johansson', text: 'We reported a similar incident to IMO MSC. Flag states need these reports to pressure regional authorities.' }
      ]
    };

    // Create events
    for (let i = 0; i < seedEvents.length; i++) {
      const eventRef = await addDoc(collection(db, 'events'), seedEvents[i]);
      // Add insights for this event
      if (seedInsights[i]) {
        for (const insight of seedInsights[i]) {
          await addDoc(collection(db, 'events', eventRef.id, 'insights'), {
            userId: 'demo_seed',
            role: insight.role,
            nickname: insight.nickname,
            text: insight.text,
            createdAt: serverTimestamp()
          });
        }
      }
    }
    console.log('Seed data created successfully');
  } catch (e) {
    console.error('Seed error:', e);
  }
}

// Run seed after auth is ready
onAuthStateChanged(auth, user => {
  if (user) seedDemoData();
});

// === UTILS ===
function fmtType(t) { return t.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' '); }
function typeColor(t) {
  return { 'near-miss': '#cc1016', 'traffic': '#e16b16', 'weather': '#0a66c2', 'equipment': '#7c3aed', 'navigation': '#057a55', 'other': '#6b7280' }[t] || '#6b7280';
}
function ago(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// === PWA ===
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

const viewer = $('imageViewer');
const viewerImg = $('viewerImage');

document.addEventListener('click', e => {
  if (e.target.classList.contains('card-image')) {
    viewerImg.src = e.target.src;
    viewer.classList.add('show');
  }
});

viewer.addEventListener('click', () => {
  viewer.classList.remove('show');
});
