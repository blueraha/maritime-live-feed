import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, addDoc, query, orderBy, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Firebase 설정 (키 유지)
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

function showScreen(s) {
  ['loadingScreen','authScreen','roleScreen','appShell'].forEach(id => $(id).style.display = 'none');
  $(s).style.display = s === 'appShell' ? 'block' : 'flex';
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

// 🚧 개발 중 기능 토스트 알림
document.addEventListener('click', (e) => {
  if (e.target.closest('.dev-feature')) {
    toast('Feature in development 🚧');
  }
});

// === 구글 로그인 및 Auth 상태 관리 ===
onAuthStateChanged(auth, async user => {
  if (user) {
    currentUser = user;
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) {
        userProfile = snap.data();
        setupUI();
        showScreen('appShell');
        seedDemoData(); // 데이터 세팅 체크
        startFeed();
      } else {
        showScreen('roleScreen'); // 프로필 없으면 직급 선택으로
      }
    } catch(e) { console.error(e); }
  } else {
    currentUser = null;
    userProfile = null;
    showScreen('authScreen');
  }
});

// 구글 로긴 팝업
$('googleSignIn').addEventListener('click', () => {
  const provider = new GoogleAuthProvider();
  signInWithPopup(auth, provider).catch(e => toast('Login Failed: ' + e.message));
});

// 역할 선택
document.querySelectorAll('.role-option').forEach(btn => {
  btn.addEventListener('click', () => {
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
  seedDemoData();
  startFeed();
});

function setupUI() {
  const init = (userProfile.nickname || 'M').slice(0, 2).toUpperCase();
  $('avatarBtn').textContent = init;
}

$('avatarBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  $('profileDropdown').style.display = $('profileDropdown').style.display === 'none' ? 'block' : 'none';
});
document.addEventListener('click', () => $('profileDropdown').style.display = 'none');
$('signOutBtn').addEventListener('click', () => signOut(auth));

// === 10개의 더미 데이터 (사진 & 댓글 포함) 생성 로직 ===
async function seedDemoData() {
  try {
    const snap = await getDocs(collection(db, 'events'));
    if (!snap.empty) return; // 이미 데이터가 있으면 실행 안함

    console.log("Seeding initial 10 posts...");
    const posts = [
      {
        role: 'Master', nick: 'Capt. Lee Kim', text: '⚠️ Near Collision in Singapore Strait.\nNarrowly avoided a near collision with a container ship here. A timely port turn saved the situation. Fellow captains, any suggestions on improving our watch efficiency?', 
        img: 'https://images.unsplash.com/photo-1578575437130-527eed3abbec?auto=format&fit=crop&w=800&q=80',
        comments: [
          { role: 'Master', nick: 'Capt. David', text: 'Glad you avoided it! Consider adding an extra lookout during busy straits.' },
          { role: 'Mate', nick: 'Mate Park', text: 'Rule 5 is key here. Good job on the quick action.' }
        ]
      },
      {
        role: 'Mate', nick: 'Chris Park', text: '⚓ Heavy Swells Detected.\nNavigating the North Atlantic today. The swells are hitting 6 meters. Secured all loose cargo, but the pitching is intense.',
        img: 'https://images.unsplash.com/photo-1559827291-72ee739d0d9a?auto=format&fit=crop&w=800&q=80',
        comments: [{ role: 'Engineer', nick: 'Chief Song', text: 'Engine load is fluctuating. We are monitoring the RPM closely down here.' }]
      },
      {
        role: 'Engineer', nick: 'Eng. Patel', text: 'Routine maintenance on Main Engine Cylinder #4. Replaced the fuel injector. Running smooth now. Always rewarding to hear that steady hum.',
        img: 'https://images.unsplash.com/photo-1581092160562-40aa08e78837?auto=format&fit=crop&w=800&q=80',
        comments: [{ role: 'Mate', nick: 'Mate Chris', text: 'Thanks for the hard work, Chief!' }]
      },
      { role: 'Master', nick: 'Capt. Jensen', text: 'Visibility dropped to 0.5 NM near Busan approach due to dense fog. Sounding fog signals and proceeding at safe speed per COLREG Rule 19.', img: null, comments: [] },
      {
        role: 'Mate', nick: 'OOW Santos', text: 'Beautiful sunset after a long day of cargo operations in Rotterdam. Ready for departure.',
        img: 'https://images.unsplash.com/photo-1505445258525-2c83c07ea85d?auto=format&fit=crop&w=800&q=80',
        comments: [{ role: 'Mate', nick: 'Elena', text: 'Safe voyage ahead! Watch out for the coastal traffic.' }]
      },
      { role: 'Engineer', nick: 'CE Müller', text: 'Ballast water treatment system threw an unexpected error code 404 during de-ballasting. Restarted the UV reactor and it cleared. Documenting for handover.', img: null, comments: [] },
      {
        role: 'Master', nick: 'Capt. Tanaka', text: 'Transiting the Suez Canal. Traffic is smooth today. The new expansion really cut down our waiting time at the Bitter Lakes.',
        img: 'https://images.unsplash.com/photo-1617300713739-21695deafc13?auto=format&fit=crop&w=800&q=80',
        comments: [{ role: 'Master', nick: 'Capt. Olsen', text: 'Good to hear. We are approaching Port Said ETA 1400.' }]
      },
      { role: 'Mate', nick: 'Mate Rodriguez', text: 'Piracy watch Level 2 activated as we enter the Gulf of Guinea. Razor wire rigged, all access doors locked from inside. Stay safe everyone.', img: null, comments: [] },
      {
        role: 'Mate', nick: 'OOW Diallo', text: 'Pilot just boarded at Hamburg. River Elbe approach requires intense focus.',
        img: 'https://images.unsplash.com/photo-1518182170546-076616fdcb14?auto=format&fit=crop&w=800&q=80',
        comments: [{ role: 'Master', nick: 'Capt. Schmidt', text: 'Tide is favorable today. Have a good transit.' }]
      },
      { role: 'Engineer', nick: 'Eng. Kim', text: 'Generator #2 lube oil filter cleaned. Pressure differential back to normal parameters.', img: null, comments: [] }
    ];

    // 최신 글이 위로 오도록 시간 역순 저장 (딜레이 부여)
    for (let i = posts.length - 1; i >= 0; i--) {
      const p = posts[i];
      await addDoc(collection(db, 'events'), {
        creatorId: 'seed_data', creatorRole: p.role, creatorNickname: p.nick,
        description: p.text, imageUrl: p.img || '', type: 'general',
        comments: p.comments || [],
        createdAt: new Date(Date.now() - (i * 3600000)) // 과거 시간으로 세팅
      });
    }
  } catch(e) { console.error("Seed error:", e); }
}

// === 피드 렌더링 ===
function startFeed() {
  const q = query(collection(db, 'events'), orderBy('createdAt', 'desc'));
  onSnapshot(q, snap => {
    const feed = $('feed');
    if (snap.empty) { feed.innerHTML = ''; return; }
    
    let html = '';
    snap.forEach(doc => {
      const p = doc.data();
      const init = (p.creatorNickname || '??').slice(0, 2).toUpperCase();
      
      // 코멘트 HTML 생성
      let commentsHtml = '';
      if (p.comments && p.comments.length > 0) {
        commentsHtml = `<div class="comments-section">` + p.comments.map(c => `
          <div class="comment-item">
            <div class="comment-avatar">${c.nick.slice(0,2).toUpperCase()}</div>
            <div class="comment-content">
              <div class="comment-name">${escapeHtml(c.nick)} <span class="comment-role">${c.role}</span></div>
              <div>${escapeHtml(c.text)}</div>
            </div>
          </div>
        `).join('') + `</div>`;
      }

      html += `
        <div class="post-card">
          <div class="post-header">
            <div class="avatar-sm" style="background:#f0f0f0; color:#191919;">${init}</div>
            <div class="post-name-group">
              <span class="post-name">${escapeHtml(p.creatorNickname)}</span>
              <span class="post-meta">${p.creatorRole} at Sea</span>
            </div>
          </div>
          <div class="post-body">${escapeHtml(p.description)}</div>
          ${p.imageUrl ? `<img src="${p.imageUrl}" class="post-image" alt="post media">` : ''}
          <div class="post-actions dev-feature">
             <span style="display:flex; align-items:center; gap:4px;"><svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg> Like</span>
             <span style="display:flex; align-items:center; gap:4px;"><svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg> Comment</span>
             <span style="display:flex; align-items:center; gap:4px;"><svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="9 17 4 12 9 7"></polyline><path d="M20 18v-2a4 4 0 0 0-4-4H4"></path></svg> Share</span>
          </div>
          ${commentsHtml}
        </div>
      `;
    });
    feed.innerHTML = html;
  });
}

// 하단 글쓰기 전송
$('quickInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') $('quickPostBtn').click();
});

$('quickPostBtn').addEventListener('click', async () => {
  const text = $('quickInput').value.trim();
  if (!text || !currentUser || !userProfile) return;

  $('quickPostBtn').disabled = true;
  try {
    await addDoc(collection(db, 'events'), {
      creatorId: currentUser.uid,
      creatorRole: userProfile.role,
      creatorNickname: userProfile.nickname,
      description: text,
      comments: [], // 본인이 쓴 글엔 아직 댓글 없음
      createdAt: serverTimestamp()
    });
    $('quickInput').value = '';
    toast('Log posted to feed!');
  } catch (e) {
    toast('Error: ' + e.message);
  }
  $('quickPostBtn').disabled = false;
});

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}