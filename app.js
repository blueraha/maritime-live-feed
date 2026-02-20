import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDoc, addDoc, query, orderBy, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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

// === STATE ===
let currentUser = null, userProfile = null, selectedEventType = null;
let activeRoleFilter = 'all', activeTypeFilter = 'all';
let eventsCache = [], currentDetailEventId = null, isSignUp = false, unsubEvents = null;

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

// === GOOGLE SIGN IN ===
$('googleSignIn').addEventListener('click', async () => {
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (e) { showAuthError(e.message); }
});

// === EMAIL AUTH ===
$('toggleAuth').addEventListener('click', () => {
  isSignUp = !isSignUp;
  $('toggleAuth').textContent = isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up";
  $('emailSignIn').textContent = isSignUp ? 'Sign Up' : 'Sign In';
  $('authError').style.display = 'none';
});

$('emailSignIn').addEventListener('click', async () => {
  const email = $('emailInput').value.trim(), pass = $('passInput').value;
  if (!email || !pass) return showAuthError('Please enter email and password.');
  try {
    if (isSignUp) await createUserWithEmailAndPassword(auth, email, pass);
    else await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    const msgs = {
      'auth/user-not-found': 'No account found.',
      'auth/wrong-password': 'Wrong password.',
      'auth/email-already-in-use': 'Email already used.',
      'auth/weak-password': 'Min 6 characters.',
      'auth/invalid-credential': 'Invalid email or password.'
    };
    showAuthError(msgs[e.code] || e.message);
  }
});

function showAuthError(msg) {
  $('authError').textContent = msg;
  $('authError').style.display = 'block';
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
  userProfile = { role: selectedRole, nickname: nick, createdAt: new Date().toISOString() };
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
        <div class="card-preview"><span class="role-tag">${esc(e.creatorRole || '')}:</span> ${esc(e.description || 'No description')}</div>
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

  // Event delegation for card clicks
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
    // Update count
    const ref = doc(db, 'events', currentDetailEventId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await setDoc(ref, { insightCount: (snap.data().insightCount || 0) + 1 }, { merge: true });
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
    await addDoc(collection(db, 'events'), {
      creatorId: currentUser.uid,
      creatorRole: userProfile.role,
      creatorNickname: userProfile.nickname || '',
      type: selectedEventType,
      title,
      description: desc || '',
      location: loc || '',
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

// === UTILS ===
function fmtType(t) { return t.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' '); }
function typeColor(t) {
  return { 'near-miss':'#ef4444','traffic':'#f97316','weather':'#3b82f6','equipment':'#a855f7','navigation':'#22c55e','other':'#6b7280' }[t] || '#6b7280';
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
