const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

const glow = $('.cursor-glow');
document.addEventListener('mousemove', (event) => {
  if (!glow) return;
  glow.style.left = `${event.clientX}px`;
  glow.style.top = `${event.clientY}px`;
});

// Make sure music button exists on all pages
let musicBtn = $('#musicBtn');
if (!musicBtn) {
  // Create music button if it doesn't exist
  musicBtn = document.createElement('button');
  musicBtn.className = 'music-btn';
  musicBtn.id = 'musicBtn';
  musicBtn.textContent = '♪';
  document.body.appendChild(musicBtn);
}

// ===== AUDIO MANAGER - Centralized audio control =====
const AudioManager = {
  audio: new Audio('assets/song.mp3'),
  restored: false,
  lastSavedTime: 0,

  init() {
    this.audio.loop = false;
    this.audio.preload = 'metadata';
    this.audio.volume = 0.8;

    console.log('[AudioManager] Initialized');

    // Save timestamp as the track plays (fires ~4x/sec) instead of a manual
    // 100ms setInterval poll — same freshness, far less overhead on mobile.
    this.audio.addEventListener('timeupdate', () => this.autoSave());

    // Restore audio when ready.
    // IMPORTANT: this must check the AUDIO element's own readiness, not the
    // document's. document.readyState is almost always 'interactive'/'complete'
    // by the time this script runs, which used to trigger an immediate
    // restore() call before the audio's metadata (and therefore `duration`)
    // had loaded. That made the saved-position check `savedTime < duration`
    // fail (duration was NaN), skip the seek, but still start playback from
    // 0 -- and because `restored` was already set true, the real
    // 'loadedmetadata' restore later never ran. Net effect: the track kept
    // restarting from the beginning instead of resuming.
    this.audio.addEventListener('loadedmetadata', () => this.restore());
    if (this.audio.readyState >= 1) {
      // Metadata already available (e.g. served instantly from cache)
      this.restore();
    }
  },

  autoSave() {
    if (this.audio && !this.audio.paused) {
      this.lastSavedTime = this.audio.currentTime;
      try {
        localStorage.setItem('hb_audio_lastTime', this.lastSavedTime.toString());
        localStorage.setItem('hb_audio_wasPlaying', 'true');
      } catch (e) {}
    }
  },

  restore() {
    if (this.restored) {
      console.log('[AudioManager] Already restored on this page, skipping');
      return;
    }

    this.restored = true;

    try {
      const savedTime = parseFloat(localStorage.getItem('hb_audio_lastTime') || '0');
      const wasPlaying = localStorage.getItem('hb_audio_wasPlaying') === 'true';

      console.log('[AudioManager] Restoring: time=' + savedTime.toFixed(2) + 's, wasPlaying=' + wasPlaying);

      // Only restore if music is enabled
      if (!isMusicEnabled()) {
        console.log('[AudioManager] Music disabled, not restoring');
        updateMusicButtonUI(false);
        return;
      }

      // Don't restore while site is locked
      if (siteLocked) {
        console.log('[AudioManager] Site locked, not restoring');
        return;
      }

      // Set audio position
      if (savedTime > 0 && savedTime < this.audio.duration) {
        this.audio.currentTime = savedTime;
        console.log('[AudioManager] Set position to ' + savedTime.toFixed(2) + 's');
      }

      // Play if it was playing
      if (wasPlaying) {
        this.audio.play().then(() => {
          console.log('[AudioManager] Playback resumed');
          updateMusicButtonUI(true);
        }).catch(err => {
          console.log('[AudioManager] Autoplay blocked: ' + err.message);
          updateMusicButtonUI(false);
        });
      }
    } catch (e) {
      console.log('[AudioManager] Error restoring:', e);
    }
  },

  play() {
    console.log('[AudioManager] Play requested');
    return this.audio.play().catch(err => {
      console.log('[AudioManager] Play failed:', err.message);
      throw err;
    });
  },

  pause() {
    console.log('[AudioManager] Pause requested');
    this.audio.pause();
  },

  reset() {
    console.log('[AudioManager] Reset: seeking to 0');
    this.audio.currentTime = 0;
  }
};

// Initialize audio manager
AudioManager.init();

// Reference for use throughout script
const bgAudio = AudioManager.audio;

// Shared state across tabs via BroadcastChannel
let bc = null;
try { bc = new BroadcastChannel('hb_music'); } catch (e) { bc = null; }

// Music enabled state persisted in localStorage. Default: true
function isMusicEnabled() {
  try {
    const v = localStorage.getItem('hb_music_enabled');
    if (v === null) return true;
    return v === '1' || v === 'true';
  } catch (e) { return true; }
}
function setMusicEnabled(val) {
  try { localStorage.setItem('hb_music_enabled', val ? '1' : '0'); } catch (e) {}
}

// Session-based audio state persistence for cross-page continuity
function saveAudioState() {
  try {
    if (bgAudio && bgAudio.currentTime) {
      localStorage.setItem('hb_audio_lastTime', bgAudio.currentTime.toString());
      localStorage.setItem('hb_audio_wasPlaying', (!bgAudio.paused).toString());
    }
  } catch (e) {}
}
function getAudioState() {
  try {
    const currentTime = parseFloat(localStorage.getItem('hb_audio_lastTime') || '0');
    const isPlaying = localStorage.getItem('hb_audio_wasPlaying') === 'true';
    return { currentTime, isPlaying };
  } catch (e) {
    return { currentTime: 0, isPlaying: false };
  }
}
function clearAudioState() {
  try {
    localStorage.removeItem('hb_audio_lastTime');
    localStorage.removeItem('hb_audio_wasPlaying');
  } catch (e) {}
}

// Save audio state before navigation
window.addEventListener('beforeunload', saveAudioState);

// Update UI according to playing state
function updateMusicButtonUI(playing) {
  if (!musicBtn) return;
  if (playing) {
    musicBtn.classList.add('playing');
    musicBtn.textContent = '♫';
  } else {
    musicBtn.classList.remove('playing');
    musicBtn.textContent = '♪';
  }
}

// Play or pause helper that respects lock state
async function playMusicIfAllowed() {
  if (!isMusicEnabled()) return;
  if (siteLocked) return; // don't auto-play while locked
  try {
    await bgAudio.play();
    updateMusicButtonUI(true);
    saveAudioState();
    // notify other tabs
    if (bc) bc.postMessage({type:'play'});
  } catch (e) {
    updateMusicButtonUI(false);
  }
}
function pauseMusic() {
  try { bgAudio.pause(); } catch (e) {}
  updateMusicButtonUI(false);
  saveAudioState();
  if (bc) bc.postMessage({type:'pause'});
}

// React to BroadcastChannel messages
if (bc) {
  bc.onmessage = (msg) => {
    if (!msg || !msg.data) return;
    const { type } = msg.data;
    if (type === 'play') {
      if (!siteLocked) bgAudio.play().then(() => updateMusicButtonUI(true)).catch(() => updateMusicButtonUI(false));
    } else if (type === 'pause') {
      bgAudio.pause(); updateMusicButtonUI(false);
    } else if (type === 'set') {
      const val = msg.data.value;
      setMusicEnabled(!!val);
      if (val) {
        // if enabled by another tab, try to play here
        if (!siteLocked) playMusicIfAllowed();
      } else {
        // disabled in another tab
        pauseMusic();
      }
    }
  };
}

// Initialize button behavior - handle music toggle
musicBtn?.addEventListener('click', () => {
  // Do not allow toggling audio while site is locked
  if (typeof siteLocked !== 'undefined' && siteLocked) return;

  const enabled = isMusicEnabled();
  if (!enabled) {
    // enabling music
    setMusicEnabled(true);
    if (bc) bc.postMessage({type:'set', value:true});
    playMusicIfAllowed();
  } else {
    // disabling music
    setMusicEnabled(false);
    if (bc) bc.postMessage({type:'set', value:false});
    pauseMusic();
  }
});

// When the audio ends, loop it
bgAudio.addEventListener('ended', () => {
  if (isMusicEnabled() && !siteLocked) {
    bgAudio.currentTime = 0;
    bgAudio.play().catch(() => {});
  }
});

// When audio plays/pauses, update UI and save state
bgAudio.addEventListener('play', () => { updateMusicButtonUI(true); saveAudioState(); });
bgAudio.addEventListener('pause', () => { updateMusicButtonUI(false); saveAudioState(); });


// Elements that control locked/unlocked state before birthday
const siteBlocker = $('#siteBlocker');
const interactiveActions = $('#interactiveActions');
const preWishInline = $('#preWishInline');
let siteLocked = Date.now() < new Date('2026-07-13T00:00:00').getTime();

// Allow a query param for testing: ?debug=unlock will force-unlock the site
try {
  const params = new URLSearchParams(window.location.search);
  if (params.get('debug') === 'unlock') {
    siteLocked = false;
  }
} catch (e) {}

function lockSite() {
  if (siteBlocker) {
    siteBlocker.style.display = 'flex';
    siteBlocker.setAttribute('aria-hidden', 'false');
    // move blocker to end of body to ensure it sits above all other stacking contexts
    try {
      document.body.appendChild(siteBlocker);
      siteBlocker.style.zIndex = '2147483647';
      siteBlocker.tabIndex = -1;
      // do NOT call focus() - focusing the blocker can cause the page to auto-scroll
    } catch (e) {
      // ignore
    }
  }
  if (interactiveActions) interactiveActions.classList.add('hidden');
  if (preWishInline) preWishInline.classList.remove('hidden');
  // add a locked state to body so CSS can block interactions
  document.body.classList.add('locked');
  // if music is playing, pause it when site locks
  try {
    if (typeof bgAudio !== 'undefined' && !bgAudio.paused) {
      bgAudio.pause();
      saveAudioState();
      updateMusicButtonUI(false);
    }
  } catch (e) {}
  // additionally disable all interactive elements for robustness
  disableInteractiveElements();
}

function unlockSite() {
  console.log('[UnlockSite] Site unlocking...');

  if (siteBlocker) {
    siteBlocker.style.display = 'none';
    siteBlocker.setAttribute('aria-hidden', 'true');
  }
  if (interactiveActions) interactiveActions.classList.remove('hidden');
  if (preWishInline) preWishInline.classList.add('hidden');
  // remove locked state
  document.body.classList.remove('locked');
  // restore interactivity
  enableInteractiveElements();

  // START MUSIC FROM BEGINNING
  try {
    console.log('[UnlockSite] Starting music from beginning');
    setMusicEnabled(true);
    localStorage.setItem('hb_audio_wasPlaying', 'true');
    localStorage.setItem('hb_audio_lastTime', '0');

    // Reset audio to beginning
    AudioManager.reset();

    // Wait a moment for audio to be ready
    setTimeout(() => {
      AudioManager.play().then(() => {
        console.log('[UnlockSite] Music started successfully');
        updateMusicButtonUI(true);
      }).catch(err => {
        console.log('[UnlockSite] Music autoplay failed:', err.message);
        console.log('[UnlockSite] Note: Browsers block autoplay - music will play on page reload or user interaction');
      });
    }, 100);

  } catch (e) {
    console.log('[UnlockSite] Error starting music:', e);
  }

  // NOTE: this used to force a location.reload() ~2s after unlocking.
  // That's been removed on purpose: a full reload here would throw away
  // the very audio continuity (and router state, see below) we're setting
  // up, and on mobile a fresh page load immediately after unlocking is
  // exactly the situation where autoplay gets blocked -- so the reload was
  // actively working against "music keeps playing" on phones. Everything
  // needed (hiding the blocker, enabling links, starting the track) is
  // already done above without a reload.
}

// Prevent clicks/navigation on anchors and buttons while locked
const interactivePreventMap = new WeakMap();
function disableInteractiveElements() {
  const elems = document.querySelectorAll('a[href], button, input, textarea, [role="button"]');
  elems.forEach((el) => {
    // don't disable things inside blocker
    if (el.closest('#siteBlocker')) return;
    // store previous attributes
    interactivePreventMap.set(el, {
      tabIndex: el.getAttribute('tabindex'),
      role: el.getAttribute('role'),
    });
    // set aria-disabled and remove tabindex
    try { el.setAttribute('aria-disabled', 'true'); } catch (e) {}
    try { el.setAttribute('tabindex', '-1'); } catch (e) {}
    el.classList.add('disabled-link');
    // attach preventers for multiple interaction events
    const handler = (ev) => { ev.preventDefault(); ev.stopImmediatePropagation(); };
    const events = ['click', 'mousedown', 'touchstart', 'auxclick', 'keydown'];
    interactivePreventMap.get(el).handlers = [];
    events.forEach((evName) => {
      el.addEventListener(evName, handler, true);
      interactivePreventMap.get(el).handlers.push({ evName, handler });
    });
  });
}

function enableInteractiveElements() {
  const elems = document.querySelectorAll('a[aria-disabled="true"], button[aria-disabled="true"], input[aria-disabled="true"], textarea[aria-disabled="true"], [role="button"][aria-disabled="true"]');
  elems.forEach((el) => {
    const prev = interactivePreventMap.get(el) || {};
    if (prev.tabIndex === null || prev.tabIndex === undefined) el.removeAttribute('tabindex');
    else el.setAttribute('tabindex', prev.tabIndex);
    el.removeAttribute('aria-disabled');
    el.classList.remove('disabled-link');
    if (prev.handlers && Array.isArray(prev.handlers)) {
      prev.handlers.forEach(({ evName, handler }) => el.removeEventListener(evName, handler, true));
    }
    interactivePreventMap.delete(el);
  });
}

// Teja's birthday: July 19, 2026 (set to start of day local time)
const birthdayDate = new Date('2026-07-13T00:00:00').getTime();
function updateCountdown() {
  const countdown = $('#countdown');
  if (!countdown) return;

  const difference = Math.max(birthdayDate - Date.now(), 0);
  const days = Math.floor(difference / 86400000);
  const hours = Math.floor((difference % 86400000) / 3600000);
  const minutes = Math.floor((difference % 3600000) / 60000);
  const seconds = Math.floor((difference % 60000) / 1000);

  $('#days').textContent = String(days).padStart(2, '0');
  $('#hours').textContent = String(hours).padStart(2, '0');
  $('#mins').textContent = String(minutes).padStart(2, '0');
  $('#secs').textContent = String(seconds).padStart(2, '0');

  // Add dramatic animation when countdown is in last 10 seconds
  const totalSecondsLeft = days * 86400 + hours * 3600 + minutes * 60 + seconds;
  if (totalSecondsLeft <= 10 && totalSecondsLeft > 0) {
    countdown.classList.add('dramatic');
  } else {
    countdown.classList.remove('dramatic');
  }

  // Lock/unlock site based on countdown reaching zero
  if (difference === 0) {
    if (siteLocked) {
      siteLocked = false;
      unlockSite();
    }
  } else {
    // still locked
    if (!siteLocked) siteLocked = true;
    lockSite();
  }
}
updateCountdown();
setInterval(updateCountdown, 1000);
// Ensure site is locked immediately on load if birthday hasn't arrived
if (siteLocked) lockSite();

const reasons = [
'Your smile feels like sunshine.',
'You make me feel like the luckiest person alive.',
'Your laugh is my favorite sound.',
'You turn ordinary days into my favorite memories.',
'You love me in ways words cannot describe.',
'Your presence feels like magic.',
'You are beautiful inside and out.',
'Every memory with you feels golden.',
'Your heart is my favorite place.',
'You are my favorite person to tease.',
'You glow without even trying.',
'Life became better the day you walked into it.',
'You feel like home to me.',
'You are effortlessly beautiful.',
'You deserve the happiest life.',
'You are my comfort place.',
'Your presence brings me peace.',
'You are everything good in one person.',
'You make love feel effortless.',
'You are loved more than you will ever know.',
'You bring calm to my busiest days.',
'Every picture with you becomes my favorite.',
'I adore your little habits.',
'Even boring days become special with you.',
'You are gentle, yet stronger than you know.',
'Your love is the greatest gift I have ever received.',
'You changed me in ways I never imagined possible.',
'Silence feels comfortable when I am with you.',
'You have the softest kind of beauty.',
'You make me believe love is real.',
'Someone like you is once in a lifetime.',
'Every celebration feels brighter because you are there.',
'You carry warmth wherever you go.',
'You make the smallest moments unforgettable.',
'You have the most beautiful soul.',
'You always know how to make me laugh.',
'Your honesty is one of the things I love most.',
'Seeing your message always makes my day.',
'You make the world feel lighter.',
'You deserve flowers every single day.',
'You make loving you feel so easy.',
'You are soft, rare, and precious to me.',
'Every plan is better when it is with you.',
'You are naturally graceful.',
'You care in ways most people never notice.',
'You have the prettiest energy.',
'You make my heart believe in forever.',
'You are the reason behind so many of my smiles.',
'Every conversation with you becomes a favorite memory.',
'You are my safe place.',
'You are most beautiful when you are simply yourself.',
'Goodbyes are always the hardest with you.',
'You make me feel loved in the smallest ways.',
'Life feels warmer with you beside me.',
'You are my favorite person.',
'You make every memory worth keeping.',
'You are sunshine with a little bit of adorable drama.',
'You make every birthday worth celebrating.',
'You are my favorite chapter.',
'Anywhere with you feels like home.',
'You are cute without even trying.',
'You have the prettiest heart I have ever known.',
'You make everyone around you feel special.',
'You bring sparkle into my life.',
'You are love in its purest form.',
'Every story is better because you are in it.',
'Meeting you is something I will always be grateful for.',
'You make it safe to love with my whole heart.',
'You have a rare kind of beauty and grace.',
'Every day feels shorter because I never get enough of you.',
'I hope I get to love you forever.',
'You make everyone around you happier, especially me.',
'You are my favorite kind of sunshine.',
'Even your little surprises mean the world to me.',
'I love your beautifully dramatic side.',
'Life with you feels like my favorite movie.',
'You are my favorite memory.',
'Even chaos feels beautiful when you are with me.',
'Every season feels better because I have you.',
'I am proud to call you mine.',
'You show your love through everything you do.',
'Every laugh is louder when we are together.',
'You are my little universe.',
'You make me feel like I am never alone.',
'You are rare, real, and everything I have ever wanted.',
'You make me believe dreams come true.',
'You are my favorite place to be.',
'Every message from you makes my heart smile.',
'You turn moments into forever memories.',
'I will always find reasons to celebrate you.',
'You make kindness look beautiful.',
'You are the greatest blessing in my life.',
'Every page of my life became better because of you.',
'You are deeply, endlessly loved.',
'You make my heart smile every single day.',
'I want nothing more than to see you happy.',
'You make even my hardest days feel easier.',
'You are unforgettable in every possible way.',
'You will always be my only Pandii.',
'No list could ever describe how much I love you.'
];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A cake-animation "sequence number" so that if the user navigates away
// mid-animation, the in-flight async sequence notices and stops instead of
// mutating a detached page's DOM or firing confetti on the wrong page.
let cakeAnimSeq = 0;

// Called once by the router (or once at first load) any time the visible
// page's DOM changes. Each init*Page function re-queries the DOM fresh and
// re-creates its own local state, so it behaves correctly whether this is
// the very first page load or the 10th in-app navigation.
function initPageScripts() {
  initReasonsPage();
  initLetterPage();
  initCakePage();
}

function initReasonsPage() {
  const reasonGrid = $('#reasonGrid');
  if (reasonGrid) {
    const imageFolder = reasonGrid.dataset.imageFolder || 'assets';
    const reasonImages = Array.from({ length: 100 }, (_, index) => `${imageFolder}/${index + 1}.jpg`);

    // Use DocumentFragment for better performance - add 100 cards efficiently
    const fragment = document.createDocumentFragment();

    reasons.forEach((reason, index) => {
      const image = reasonImages[index % reasonImages.length];
      const article = document.createElement('article');
      article.className = 'reason-card reveal';
      article.tabIndex = '0';
      article.innerHTML = `
        <div class="reason-inner">
          <div class="reason-front">
            <h3>${index + 1}</h3>
            <p>tap love note</p>
          </div>
          <div class="reason-back" style="background-image: linear-gradient(to bottom, rgba(62,50,50,.08), rgba(62,50,50,.18) 45%, rgba(62,50,50,.78)), url('${image}');">
            <p>${reason}</p>
          </div>
        </div>
      `;
      fragment.appendChild(article);
    });

    // Append all at once (much faster than appending one by one)
    reasonGrid.appendChild(fragment);
  }

  $('#randomReasonBtn')?.addEventListener('click', () => {
    $('#randomReason').textContent = reasons[Math.floor(Math.random() * reasons.length)];
  });
}

const letterText = `I still don't know exactly how we met, but I'm so glad we did, cause I can't imagine a life without you now 🥺 I guess I need to thank our college librarian for making us talk for the first time. It started from that... and then the magic happened. Sorry, covid happened 😅 But the magic happened anyway.
And Now it's been 6+ years and I still see you the same and love you the same ❤️ Maybe even more. I know we've spent more time apart than together, and maybe that's the reason we grew so attached — by missing each other. From cities to states and now to countries, the distance grew... but so did our love, right along with it 🌍💕
I really want to be with you right now, in your most special moment of the year. Maybe not this year, but I'll definitely be there for you soon 🤍 I really wish everything goes our way, and that we get married soon — I honestly can't hold it in anymore 😳 I want you. For life. And I'll do everything I can for that.
Until then... I love you 💌`;

function initLetterPage() {
  const envelope = $('#envelope');
  if (!envelope) return;

  let hasTypedLetter = false;
  let typingInterval = null;

  envelope.addEventListener('click', () => {
    envelope.classList.add('open');
    if (hasTypedLetter) return;

    hasTypedLetter = true;
    let index = 0;
    const typedLetter = $('#typedLetter');
    typingInterval = setInterval(() => {
      typedLetter.textContent += letterText[index] || '';
      index += 1;
      if (index > letterText.length) clearInterval(typingInterval);
    }, 35);
  });

  // Registered so the router can stop the typing effect if the user
  // navigates away from the letter mid-animation.
  registerPageCleanup(() => {
    if (typingInterval) clearInterval(typingInterval);
  });
}

function initCakePage() {
  const cake = $('#birthdayCake') || $('.cake');
  const cutCakeBtn = $('.cut-cake-btn');
  const cakeStageText = $('#cakeStageText');
  if (!cutCakeBtn) return;

  let cakeAnimationStarted = false;
  const mySeq = ++cakeAnimSeq;

  cutCakeBtn.addEventListener('click', async () => {
    if (!cake || cakeAnimationStarted) return;

    cakeAnimationStarted = true;
    cutCakeBtn.disabled = true;

    cakeStageText.textContent = 'blowing the candles... 🌬️';
    cutCakeBtn.textContent = 'Blowing Candles...';
    cake.classList.add('blow');
    await wait(1500);
    if (mySeq !== cakeAnimSeq) return; // navigated away mid-animation

    cakeStageText.textContent = ' cake is cutting 🔪';
    cutCakeBtn.textContent = '';
    cake.classList.add('knife-in');
    await wait(1200);
    if (mySeq !== cakeAnimSeq) return;

    cakeStageText.textContent = ' into a slice... 🍰';
    cutCakeBtn.textContent = 'Cutting Slice...';
    cake.classList.add('sliced');
    await wait(900);
    if (mySeq !== cakeAnimSeq) return;

    cakeStageText.textContent = 'first slice for my Pandii 🎉';
    cutCakeBtn.textContent = 'Cake Cut 🎉';

    if (typeof confetti === 'function') {
      confetti({ particleCount: 280, spread: 115, origin: { y: 0.62 } });
    }
  });
}

// ===== IN-APP ROUTER =====
// Why this exists: browsers only let audio keep playing across a real page
// navigation if they judge autoplay "allowed" for that origin -- and mobile
// Safari/Chrome very often refuse that, silently pausing the music every
// time you follow a link. The one reliable fix is to stop doing full page
// reloads for internal navigation: fetch the next page's HTML, swap the
// content into the current document, and leave the existing <audio> element
// (and the JS that's controlling it) completely untouched. Since the page
// never actually unloads, there's nothing for autoplay policy to block --
// the same rule applies on desktop and mobile.
let pageCleanup = null;
function registerPageCleanup(fn) {
  pageCleanup = fn;
}

function isPersistentWidget(el) {
  if (!el || el.nodeType !== 1) return false;
  return el.id === 'musicBtn' || el.classList.contains('cursor-glow');
}

// Track which external scripts are already loaded so we never fetch/execute
// script.js a second time (that would double up AudioManager, listeners,
// etc.) and never re-download something like the confetti library twice.
const loadedScripts = new Set();
Array.from(document.querySelectorAll('script[src]')).forEach((s) => {
  try { loadedScripts.add(new URL(s.getAttribute('src'), location.href).href); } catch (e) {}
});

function loadScriptsThenInit(urls) {
  if (!urls.length) {
    initPageScripts();
    return;
  }
  let remaining = urls.length;
  urls.forEach((src) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = el.onerror = () => {
      remaining -= 1;
      if (remaining === 0) initPageScripts();
    };
    document.body.appendChild(el);
  });
}

function applyNewDocument(newDoc, url) {
  if (pageCleanup) {
    try { pageCleanup(); } catch (e) {}
    pageCleanup = null;
  }

  if (newDoc.title) document.title = newDoc.title;

  // Carry over body-level theming (e.g. the "night" class, or the
  // --hero-image / --final-image custom properties set inline per page).
  document.body.className = newDoc.body.className;
  const newStyle = newDoc.body.getAttribute('style');
  if (newStyle) document.body.setAttribute('style', newStyle);
  else document.body.removeAttribute('style');

  // Remove everything from the current page except our persistent widgets
  // (music button, cursor glow) and any <script> tags already run.
  Array.from(document.body.children).forEach((el) => {
    if (isPersistentWidget(el) || el.tagName === 'SCRIPT') return;
    el.remove();
  });

  // Insert the new page's content, skipping any duplicate copies of the
  // persistent widgets (every page's HTML includes its own #musicBtn /
  // .cursor-glow markup, but we keep our original live nodes so their
  // bound event listeners and current "playing" state survive the swap).
  const scriptsToLoad = [];
  Array.from(newDoc.body.children).forEach((node) => {
    if (isPersistentWidget(node)) return;
    if (node.tagName === 'SCRIPT') {
      const src = node.getAttribute('src');
      if (!src || /script\.js(\?.*)?$/.test(src)) return; // never re-run our own script
      const absoluteSrc = new URL(src, url).href;
      if (loadedScripts.has(absoluteSrc)) return;
      loadedScripts.add(absoluteSrc);
      scriptsToLoad.push(absoluteSrc);
      return;
    }
    document.body.appendChild(node);
  });

  // Videos (and audio) parsed via DOMParser live in an inert document with
  // no browsing context, so the browser never runs their automatic load
  // algorithm -- even ones marked autoplay just sit there blank/frozen once
  // moved into the real page. Give them an explicit nudge. (Muted videos
  // are exempt from the autoplay-needs-a-gesture rule, so .play() succeeds
  // here the same way it would after a normal full page load.)
  document.querySelectorAll('video[autoplay]').forEach((video) => {
    video.load();
    video.play().catch(() => {});
  });

  loadScriptsThenInit(scriptsToLoad);
}

function isRoutableLink(a) {
  if (!a || !a.getAttribute('href')) return false;
  if (a.target && a.target !== '_self') return false;
  if (a.hasAttribute('download')) return false;
  if (a.getAttribute('rel') === 'external') return false;
  let url;
  try { url = new URL(a.href, location.href); } catch (e) { return false; }
  if (url.origin !== location.origin) return false;
  if (!/\.html?$/i.test(url.pathname)) return false;
  return true;
}

let navToken = 0;
async function navigateTo(url, push) {
  const myToken = ++navToken;
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Bad response: ' + res.status);
    const html = await res.text();
    if (myToken !== navToken) return; // a newer navigation started meanwhile

    const newDoc = new DOMParser().parseFromString(html, 'text/html');
    applyNewDocument(newDoc, url);

    if (push) history.pushState({ url }, '', url);
    window.scrollTo(0, 0);
  } catch (err) {
    console.log('[Router] Falling back to full navigation:', err.message);
    location.href = url;
  }
}

document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const a = event.target.closest('a[href]');
  if (!a || !isRoutableLink(a)) return;

  const url = new URL(a.href, location.href);
  event.preventDefault();
  if (url.href === location.href) return; // already here
  navigateTo(url.href, true);
});

window.addEventListener('popstate', () => {
  navigateTo(location.href, false);
});
history.replaceState({ url: location.href }, '', location.href);

// Run page-specific setup for whichever page was actually loaded first.
initPageScripts();