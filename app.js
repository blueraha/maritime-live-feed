import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDoc, addDoc, query, orderBy, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Firebase 설정 (기존 키 유지)
const app = initializeApp({
  apiKey: "AIzaSyBuGoE5qGFuuXH99nNy4Y4f3waY2ZS4Nbk",
  authDomain: "maritime-live-feed.firebaseapp.com",
  projectId: "maritime-live-feed",
});
const auth = getAuth(app);
const db = getFirestore(app);

const $ = id => document.getElementById(id);

let currentUser = null;
let userProfile = null;
let selectedRole = 'Mate'; // Mate 기본 설정

// 화면 전환
function showScreen(s) {
  ['loadingScreen','authScreen','roleScreen','appShell'].forEach(id => $(id).style.display = 'none');
  $(s).style.display = s === 'appShell' ? 'block' : 'flex';
}

// 🚧 토스트 메시지 함수
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}

// 개발 중 기능 알림 이벤트 바인딩
document.addEventListener('click', (e) => {
  if (e.target.closest('.dev-feature')) {
    toast('Feature in development 🚧');
  }
});

// === 인증 로직 ===
onAuthStateChanged(auth, async user => {
  if (user) {
    currentUser = user;
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (snap.exists()) {
      userProfile = snap.data();
      setupUI();
      showScreen('appShell');
      startFeed();
    } else {
      showScreen('roleScreen');
    }
  } else {
    currentUser = null;
    userProfile = null;
    showScreen('authScreen');
  }
});

$('googleSignIn').addEventListener('click', () => {
  const provider = new GoogleAuthProvider();
  signInWithPopup(auth, provider).catch(e => toast(e.message));
});

// 역할 선택 로직 (Mate는 기본 선택되어 있음)
document.querySelectorAll('.role-option').forEach(btn => {
  btn.addEventListener('click', (e) => {
    // 개발 중인 직급 클릭 시 알림 띄우고 Mate 유지
    if (btn.classList.contains('dev-feature')) return; 
    
    document.querySelectorAll('.role-option').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedRole = btn.dataset.role;
  });
});

$('saveProfile').addEventListener('click', async () => {
  if (!currentUser) return;
  const nick = $('nicknameInput').value.trim() || 'Anonymous Mate';
  userProfile = { role: selectedRole, nickname: nick, createdAt: serverTimestamp() };
  await setDoc(doc(db, 'users', currentUser.uid), userProfile);
  setupUI();
  showScreen('appShell');
  startFeed();
});

function setupUI() {
  const init = (userProfile.nickname || 'A').slice(0, 2).toUpperCase();
  $('avatarBtn').textContent = init;
}

// 프로필 메뉴 및 로그아웃
$('avatarBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  $('profileDropdown').style.display = $('profileDropdown').style.display === 'none' ? 'block' : 'none';
});
document.addEventListener('click', () => $('profileDropdown').style.display = 'none');
$('signOutBtn').addEventListener('click', () => signOut(auth));


// === 피드 및 글쓰기 로직 ===
function startFeed() {
  const q = query(collection(db, 'events'), orderBy('createdAt', 'desc'));
  onSnapshot(q, snap => {
    const feed = $('feed');
    if (snap.empty) {
      feed.innerHTML = '<div style="text-align:center; padding:40px; color:#999;">No stories yet. Be the first to log!</div>';
      return;
    }
    
    let html = '';
    snap.forEach(doc => {
      const p = doc.data();
      const init = (p.creatorNickname || '??').slice(0, 2).toUpperCase();
      
      html += `
        <div class="post-card">
          <div class="post-header">
            <div class="avatar-sm" style="width:40px; height:40px; border-radius:50%; background:#f0f0f0; color:#191919; display:flex; align-items:center; justify-content:center; font-weight:600;">${init}</div>
            <div>
              <div class="post-name">${escapeHtml(p.creatorNickname || 'Anonymous')}</div>
              <div class="post-meta">${p.creatorRole}</div>
            </div>
          </div>
          <div class="post-body">${escapeHtml(p.description || '')}</div>
          <div class="post-actions dev-feature">
             <span>Translate</span> · <span>Comment</span> · <span>Share</span>
          </div>
        </div>
      `;
    });
    feed.innerHTML = html;
  });
}

// 엔터 키로도 전송 가능하게
$('quickInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') $('quickPostBtn').click();
});

// 하단 입력창 글쓰기 실제 작동
$('quickPostBtn').addEventListener('click', async () => {
  const text = $('quickInput').value.trim();
  if (!text || !currentUser || !userProfile) return;

  const btn = $('quickPostBtn');
  btn.disabled = true;

  try {
    // Firebase 'events' 컬렉션에 데이터 저장
    await addDoc(collection(db, 'events'), {
      creatorId: currentUser.uid,
      creatorRole: userProfile.role,
      creatorNickname: userProfile.nickname,
      description: text,
      type: 'general',
      createdAt: serverTimestamp()
    });
    $('quickInput').value = '';
    toast('Logged successfully!');
  } catch (e) {
    toast('Error: ' + e.message);
  }
  btn.disabled = false;
});

// XSS 방지 유틸
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}