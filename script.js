// Lightweight interactions: parallax for blob and ripple on CTA
document.addEventListener('DOMContentLoaded', ()=>{
  const blob = document.querySelector('.blob');
  const hero = document.querySelector('.hero');
  if(blob && hero){
    hero.addEventListener('mousemove', (e)=>{
      const rect = hero.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5; // -0.5..0.5
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      // translate blob slightly for parallax
      blob.style.transform = `translateX(${8 + x * 6}%) translateY(${y * -6}px) scale(1.02)`;
    });
    hero.addEventListener('mouseleave', ()=>{
      blob.style.transform = 'translateX(8%) translateY(0) scale(1)';
    });
  }

  // Ripple effect on main CTA
  const cta = document.getElementById('cta-main');
  if(cta){
    cta.addEventListener('click', (ev)=>{
      const rect = cta.getBoundingClientRect();
      const circle = document.createElement('span');
      const d = Math.max(rect.width, rect.height);
      circle.style.width = circle.style.height = d + 'px';
      circle.style.left = (ev.clientX - rect.left - d/2) + 'px';
      circle.style.top = (ev.clientY - rect.top - d/2) + 'px';
      circle.className = 'ripple';
      cta.appendChild(circle);
      setTimeout(()=> circle.remove(), 700);
    });
  }
});

// Reel viewer: load manifest and allow opening modal to navigate folder videos
function getSupabaseReelsConfig(){
  return window.supabaseReelsConfig || null;
}

async function fetchSupabaseManifest(){
  const cfg = getSupabaseReelsConfig();
  console.log('fetchSupabaseManifest: config=', cfg);
  if(!cfg || !cfg.url || !cfg.anonKey){
    console.warn('fetchSupabaseManifest: missing supabase config or keys');
    return null;
  }

  // Support different UMD/global exposures — prefer window.supabase.createClient
  const globalSupabase = window.supabase;
  const createClientFn = (globalSupabase && typeof globalSupabase.createClient === 'function') ? globalSupabase.createClient : (typeof window.createClient === 'function' ? window.createClient : null);
  if(!createClientFn){
    console.warn('fetchSupabaseManifest: createClient function not available on global object', {hasGlobal: !!globalSupabase, hasCreateClient: !!(globalSupabase && globalSupabase.createClient)});
    return null;
  }

  const client = createClientFn(cfg.url, cfg.anonKey);

  // If a storage bucket is configured, try listing files from the bucket first
  if(cfg.bucket){
    try{
      const listResp = await client.storage.from(cfg.bucket).list('');
      const listData = (listResp && listResp.data) ? listResp.data : listResp;
      console.log('fetchSupabaseManifest: storage.list response:', {listResp, listData});
      if(listResp && listResp.error){
        console.warn('fetchSupabaseManifest: storage.list returned error', listResp.error);
      } else if(Array.isArray(listData) && listData.length){
        console.log('fetchSupabaseManifest: found', listData.length, 'items in bucket');
        const urls = listData.map((item, idx) => {
          const name = item && (item.name || item.path || item.id);
          if(!name) return null;
          const url = cfg.url.replace(/\/$/, '') + '/storage/v1/object/public/' + encodeURIComponent(cfg.bucket) + '/' + encodeURIComponent(name);
          if(idx < 3) console.log('  item[' + idx + '].name:', name, '→ url:', url);
          return url;
        }).filter(Boolean);
        if(urls.length){
          console.log('fetchSupabaseManifest: constructed', urls.length, 'public URLs from storage bucket', cfg.bucket);
          return urls;
        }
      } else {
        console.log('fetchSupabaseManifest: storage.list returned empty or non-array:', {isArray: Array.isArray(listData), length: listData ? listData.length : 'N/A'});
        if(window.reelManifest && Array.isArray(window.reelManifest) && window.reelManifest.length){
          const fallbackUrls = window.reelManifest.map(item => {
            const name = item && item.split('/') && item.split('/').pop();
            if(!name) return null;
            return cfg.url.replace(/\/$/, '') + '/storage/v1/object/public/' + encodeURIComponent(cfg.bucket) + '/' + encodeURIComponent(name);
          }).filter(Boolean);
          if(fallbackUrls.length){
            console.log('fetchSupabaseManifest: using fallback bucket URLs based on window.reelManifest', fallbackUrls.slice(0,5));
            return fallbackUrls;
          }
        }
      }
    }catch(err){
      console.warn('fetchSupabaseManifest: error listing storage bucket', err.message || err);
      if(window.reelManifest && Array.isArray(window.reelManifest) && window.reelManifest.length){
        const fallbackUrls = window.reelManifest.map(item => {
          const name = item && item.split('/') && item.split('/').pop();
          if(!name) return null;
          return cfg.url.replace(/\/$/, '') + '/storage/v1/object/public/' + encodeURIComponent(cfg.bucket) + '/' + encodeURIComponent(name);
        }).filter(Boolean);
        if(fallbackUrls.length){
          console.log('fetchSupabaseManifest: using fallback bucket URLs after list error', fallbackUrls.slice(0,5));
          return fallbackUrls;
        }
      }
    }
  }

  const table = cfg.table || 'video_reels';
  const field = cfg.field || 'video_url';
  const selectString = cfg.select || field;
  let query = client.from(table).select(selectString);
  if(cfg.orderBy && cfg.orderBy.column){
    query = query.order(cfg.orderBy.column, { ascending: cfg.orderBy.ascending !== false });
  }

  try{
    const { data, error } = await query;
    if(error || !data){
      console.warn('fetchSupabaseManifest: query error or no data', error);
      return null;
    }

    const urls = data
      .map(item => {
        if(!item) return null;
        if(typeof item === 'string') return item;
        return item[field] || item.url || item.src || item.path || item.video_url || null;
      })
      .filter(Boolean);
    console.log('fetchSupabaseManifest: loaded', urls.length, 'items');
    return urls.length ? urls : null;
  }catch(err){
    console.warn('fetchSupabaseManifest: unexpected error', err);
    return null;
  }
}

document.addEventListener('DOMContentLoaded', ()=>{
  const manifestUrl = './video-rells.json';
  let playlist = [];
  let normNames = [];
  const reelModal = document.getElementById('reel-modal');
  const reelPlayer = document.getElementById('reel-player');
  const prevBtn = document.getElementById('reel-prev');
  const nextBtn = document.getElementById('reel-next');
  const closeBtn = document.getElementById('reel-close');
  let currentIndex = 0;

  async function loadManifest(){
    try{
      const supabaseList = await fetchSupabaseManifest();
      if(supabaseList && Array.isArray(supabaseList) && supabaseList.length){
        console.log('loadManifest: using Supabase manifest with', supabaseList.length, 'items');
        playlist = supabaseList;
      } else {
        console.log('loadManifest: falling back to local manifest:', manifestUrl);
        const res = await fetch(manifestUrl);
        if(res.ok){
          playlist = await res.json();
          console.log('loadManifest: loaded local manifest with', playlist.length, 'items');
        } else {
          playlist = window.reelManifest || [];
          console.log('loadManifest: used window.reelManifest with', (playlist && playlist.length) || 0, 'items');
        }
      }
    }catch(err){
      console.warn('loadManifest: error fetching manifests, using window.reelManifest', err);
      playlist = window.reelManifest || [];
    }
    if(!playlist || !Array.isArray(playlist)){
      playlist = [];
    }
    normNames = playlist.map(p=>decodeURIComponent(p.split('/').pop()));
  }

  function openReel(i){
    if(!playlist || !playlist.length) return;
    currentIndex = (i + playlist.length) % playlist.length;
    const src = playlist[currentIndex];
    if(!reelPlayer) return;

    // ensure native controls are visible and video starts muted for autoplay
    try{ reelPlayer.controls = true; }catch(e){}
    reelPlayer.muted = true;
    if(reelPlayer.classList) reelPlayer.classList.remove('ready');
    reelPlayer.pause();
    reelPlayer.src = src;
    try{ reelPlayer.load(); }catch(e){}

    try{ reelModal.setAttribute('aria-hidden','false'); document.body.style.overflow = 'hidden'; }catch(e){}

    try{ 
      reelPlayer.play().then(()=>{
        setTimeout(()=>{ 
          if(reelPlayer && !reelPlayer.paused){
            reelPlayer.muted = false;
            reelPlayer.controls = true;
          }
        }, 100);
      }).catch(()=>{
        // If autoplay fails, controls remain visible for manual play/pause
        try{ reelPlayer.controls = true; }catch(e){}
      }); 
    }catch(e){}
  }

  function closeReel(){
    if(!reelModal) return;
    reelModal.setAttribute('aria-hidden','true');
    document.body.style.overflow = '';
    if(reelPlayer){ reelPlayer.pause(); reelPlayer.removeAttribute('src'); reelPlayer.load(); }
  }

  function nextReel(){ openReel(currentIndex + 1); }
  function prevReel(){ openReel(currentIndex - 1); }

  // wire modal controls
  if(nextBtn) nextBtn.addEventListener('click', (e)=>{ e.preventDefault(); nextReel(); });
  if(prevBtn) prevBtn.addEventListener('click', (e)=>{ e.preventDefault(); prevReel(); });
  if(closeBtn) closeBtn.addEventListener('click', (e)=>{ e.preventDefault(); closeReel(); });
  if(reelModal){
    const dialog = reelModal.querySelector('.modal-dialog');
    reelModal.addEventListener('click', (e)=>{ if(!dialog) return; if(!dialog.contains(e.target)) closeReel(); });
  }

  // keyboard navigation
  document.addEventListener('keydown', (e)=>{
    if(!reelModal || reelModal.getAttribute('aria-hidden') === 'true') return;
    if(e.key === 'ArrowDown') nextReel();
    if(e.key === 'ArrowUp') prevReel();
    if(e.key === 'Escape') closeReel();
  });

  // touch swipe support for mobile: swipe left -> next, right -> prev
  let touchStartX = 0;
  let touchEndX = 0;
  const swipeThreshold = 40; // px
  function handleTouchStart(e){
    if(!e.touches || !e.touches.length) return;
    touchStartX = e.touches[0].clientX;
  }
  function handleTouchMove(e){
    if(!e.touches || !e.touches.length) return;
    touchEndX = e.touches[0].clientX;
  }
  function handleTouchEnd(e){
    const delta = touchStartX - touchEndX;
    if(Math.abs(delta) < swipeThreshold) return;
    if(delta > 0) nextReel(); else prevReel();
    touchStartX = touchEndX = 0;
  }
  if(reelPlayer){
    reelPlayer.addEventListener('touchstart', handleTouchStart, {passive:true});
    reelPlayer.addEventListener('touchmove', handleTouchMove, {passive:true});
    reelPlayer.addEventListener('touchend', handleTouchEnd, {passive:true});

    reelPlayer.addEventListener('loadeddata', ()=>{
      if(reelPlayer.classList) reelPlayer.classList.add('ready');
    });
    reelPlayer.addEventListener('emptied', ()=>{
      if(reelPlayer.classList) reelPlayer.classList.remove('ready');
    });
  }

  // attach click handlers to reel cards/videos — custom inline play/pause with overlay
  function attachReelListeners(){
    document.querySelectorAll('.reel-card').forEach(card=>{
      const vid = card.querySelector('video.reel');
      const overlay = card.querySelector('.play-overlay');
      if(!vid) return;
      // ensure native controls are removed
      try{ vid.removeAttribute('controls'); }catch(e){}
      vid.preload = 'metadata';

      // If this is a homepage-generated card, clicking should open the modal viewer
      if(card.classList.contains('home-reel')){
        const idx = card.dataset.index ? parseInt(card.dataset.index,10) : null;
        if(idx !== null && !isNaN(idx)){
          const anchor = card.closest('a.reel-link');
          if(anchor){ anchor.addEventListener('click', (e)=> e.preventDefault()); }
          card.addEventListener('click', (e)=>{ e.preventDefault(); openReel(idx); });
          if(overlay){ overlay.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); openReel(idx); }); }
          // clicking the actual video should toggle play/pause without opening modal
          vid.addEventListener('click', (e)=>{
            e.preventDefault(); e.stopPropagation();
            try{
              if(vid.paused){ vid.play().catch(()=>{}); if(overlay) overlay.classList.add('hidden'); }
              else { vid.pause(); if(overlay) overlay.classList.remove('hidden'); }
            }catch(err){}
          });
        }
        return; // skip inline play/pause behavior for homepage cards
      }
      // end home-reel handling

      function playInlineVideo(){
        vid.play().catch(()=>{});
        if(overlay) overlay.classList.add('hidden');
      }
      function pauseInlineVideo(){
        vid.pause();
        if(overlay) overlay.classList.remove('hidden');
      }

      // clicking the video toggles play/pause and otherwise plays on click
      vid.addEventListener('click', (e)=>{
        e.preventDefault();
        if(vid.paused){ playInlineVideo(); } else { pauseInlineVideo(); }
      });

      // show/hide overlay based on playback state using CSS class
      vid.addEventListener('play', ()=>{ if(overlay) overlay.classList.add('hidden'); });
      vid.addEventListener('pause', ()=>{ if(overlay) overlay.classList.remove('hidden'); });
      vid.addEventListener('ended', ()=>{ if(overlay) overlay.classList.remove('hidden'); });

      // overlay button acts as a real play button
      if(overlay){
        overlay.addEventListener('click', (ev)=>{
          ev.preventDefault(); ev.stopPropagation();
          if(vid.paused){ playInlineVideo(); }
          else { pauseInlineVideo(); }
        });
        // ensure overlay initial state (visible when paused)
        if(vid.paused) overlay.classList.remove('hidden'); else overlay.classList.add('hidden');
      }
    });

    // clicking the card outside the video toggles playback too (skip home-reel cards)
    document.querySelectorAll('.reel-card').forEach(card=>{
      if(card.classList.contains('home-reel')) return;
      card.addEventListener('click', (e)=>{
        if(e.target.closest('.play-overlay')) return; // handled above
        const vid = card.querySelector('video.reel');
        if(!vid) return;
        if(vid.paused) vid.play().catch(()=>{}); else vid.pause();
      });
    });
  }

  function getRandomIndices(total, count){
    const indices = Array.from({length: total}, (_, i) => i);
    for(let i = indices.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return indices.slice(0, count);
  }

  function populateHomepageReels(){
    if(!playlist || !playlist.length) return;
    const count = Math.min(3, playlist.length);
    const selected = getRandomIndices(playlist.length, count);

    for(let slot = 0; slot < 3; slot++){
      const el = document.getElementById('reel-' + slot);
      const card = el && el.closest('.reel-card');
      const overlay = card ? card.querySelector('.play-overlay') : null;
      if(!el) continue;
      if(slot < selected.length){
        el.src = playlist[selected[slot]];
        el.muted = true;
        try{ el.load(); }catch(e){}
        if(overlay) overlay.classList.remove('hidden');
      } else {
        el.removeAttribute('src');
        try{ el.load(); }catch(e){}
        if(overlay) overlay.classList.remove('hidden');
      }
    }
  }

  // initialize
  loadManifest().then(()=>{
    populateHomepageReels();
    attachReelListeners();
    // build full reels grid on homepage from manifest
    try{
      // build a horizontal scroller of all reels but lazy-load their src
      const container = document.getElementById('home-reels-list');
      if(container && playlist && playlist.length){
        container.innerHTML = '';
        // observer to lazy-load video src when near viewport
        const io = new IntersectionObserver((entries)=>{
          entries.forEach(entry=>{
            if(entry.isIntersecting){
              const vid = entry.target;
              if(vid.dataset && vid.dataset.src && !vid.src) vid.src = vid.dataset.src;
              io.unobserve(vid);
            }
          });
        },{rootMargin:'300px'});

        // show only five reels on the homepage and keep the full playlist for modal navigation
        const MAX_RANDOM = Math.min(5, playlist.length);
        function pickRandomIndices(n, count){
          const indices = Array.from({length:n}, (_,i)=>i);
          for(let i = indices.length - 1; i > 0; i--){
            const j = Math.floor(Math.random() * (i + 1));
            [indices[i], indices[j]] = [indices[j], indices[i]];
          }
          return indices.slice(0, count);
        }

        const selectedIndices = pickRandomIndices(playlist.length, MAX_RANDOM);
        const selectedList = selectedIndices.map(i=>playlist[i]);

        selectedList.forEach((src, idx)=>{
          const a = document.createElement('a');
          a.className = 'reel-link';
          a.href = '#';

          const card = document.createElement('div');
          card.className = 'reel-card home-reel';
          // store original playlist index so modal opens correct video
          card.dataset.index = String(selectedIndices[idx]);

          const v = document.createElement('video');
          v.className = 'reel';
          v.dataset.src = src; // lazy source
          v.muted = true;
          v.loop = true;
          v.playsInline = true;
          v.preload = 'metadata';

          const overlay = document.createElement('button');
          overlay.className = 'play-overlay';
          overlay.setAttribute('aria-label','Open reel');
          overlay.innerHTML = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="12" /><g class="play-triangle"><path d="M10 8L16 12L10 16V8Z" fill="#fff"/></g></svg>';

          card.appendChild(v);
          card.appendChild(overlay);
          a.appendChild(card);
          container.appendChild(a);

          io.observe(v);
        });
        // Add See more button at the end of the reel list
        try{
          const seeMoreCard = document.createElement('div');
          seeMoreCard.className = 'reel-card reel-card-watch-more';
          const seeMoreBtn = document.createElement('button');
          seeMoreBtn.className = 'btn blue outline btn-small';
          seeMoreBtn.textContent = 'See more';
          seeMoreBtn.id = 'see-more-btn';
          seeMoreBtn.type = 'button';
          seeMoreCard.appendChild(seeMoreBtn);
          container.appendChild(seeMoreCard);

          seeMoreBtn.addEventListener('click', ()=>{
            const signupModal = document.getElementById('signup-modal');
            if(signupModal){
              signupModal.setAttribute('aria-hidden','false');
              document.body.style.overflow = 'hidden';
              const firstInput = signupModal.querySelector('input');
              if(firstInput) firstInput.focus();
            }
          });
        }catch(e){}
        // re-attach listeners to include new cards
        attachReelListeners();
      }
    }catch(err){ console.warn('Failed to build homepage reels grid', err); }
    // If the URL contains ?reel=N open that reel automatically
    try{
      const params = new URLSearchParams(window.location.search);
      const r = params.get('reel');
      if(r !== null){
        const idx = parseInt(r,10);
        if(!isNaN(idx) && playlist.length){
          openReel(idx);
          // remove the query parameter so reload doesn't re-open
          const url = new URL(window.location.href);
          url.searchParams.delete('reel');
          history.replaceState(null, '', url.toString());
        }
      }
    }catch(err){
      // ignore URL parsing errors
    }
  });
});

// Signup modal handlers
document.addEventListener('DOMContentLoaded', ()=>{
  const openBtn = document.getElementById('open-signup');
  const modal = document.getElementById('signup-modal');
  const closeBtn = modal && modal.querySelector('.modal-close');
  const dialog = modal && modal.querySelector('.modal-dialog');

  function openModal(){
    if(!modal) return;
    modal.setAttribute('aria-hidden','false');
    document.body.style.overflow = 'hidden';
    const firstInput = modal.querySelector('input');
    if(firstInput) firstInput.focus();
  }
  function closeModal(){
    if(!modal) return;
    modal.setAttribute('aria-hidden','true');
    document.body.style.overflow = '';
  }

  if(openBtn) openBtn.addEventListener('click', openModal);
  if(closeBtn) closeBtn.addEventListener('click', (e)=>{
    // reset signup fields, clear any pending data, then navigate home
    try{
      const formEl = document.getElementById('signup-form');
      if(formEl) formEl.reset();
      // also clear any stored pending signup that might repopulate the modal
      sessionStorage.removeItem('pendingSignup');
    }catch(err){
      // ignore errors accessing DOM/storage
    }
    closeModal();
    window.location.href = 'index.html';
  });

  // click outside to close
  if(modal){
    modal.addEventListener('click', (e)=>{
      if(!dialog) return;
      if(!dialog.contains(e.target)) closeModal();
    });
  }

  // form submit basic validation
  const form = document.getElementById('signup-form');
  if(form){
    // Google Apps Script URL for Join submissions (name, email, password)
    const url = 'https://script.google.com/macros/s/AKfycbzTuqfu3YN0ncdwplaXGLfVINH9uKUsqky3IYpALlNWDu_YIPuRIt2EvP1oAiM8f3o/exec';

    async function sendSignup({username, email, password, confirm}){
      const payload = new FormData();
      // send as requested: name, email, password
      payload.append('name', username);
      payload.append('email', email);
      payload.append('password', password);
      payload.append('timestamp', new Date().toISOString());
      try{
        const res = await fetch(url, { method: 'POST', body: payload });
        if(res && res.ok){
          alert('Data submitted successfully.');
        } else {
          alert('Submission received — please check the spreadsheet.');
        }
        form.reset();
        closeModal();
      }catch(err){
        console.error('Submission error:', err);
        alert('An error occurred while sending. Please try again.');
      }
    }

    function collectAndValidate(){
      const data = new FormData(form);
      const username = (data.get('username')||'').toString().trim();
      const email = (data.get('email')||'').toString().trim();
      const password = (data.get('password')||'').toString();
      const confirm = (data.get('confirm')||'').toString();
      // mark empty fields as invalid and focus first empty
      let firstMissing = null;
      if(!username){ const el = form.querySelector('input[name="username"]'); if(el){ el.classList.add('invalid'); el.setAttribute('aria-invalid','true'); if(!firstMissing) firstMissing = el; } }
      if(!email){ const el = form.querySelector('input[name="email"]'); if(el){ el.classList.add('invalid'); el.setAttribute('aria-invalid','true'); if(!firstMissing) firstMissing = el; } }
      if(!password){ const el = form.querySelector('input[name="password"]'); if(el){ el.classList.add('invalid'); el.setAttribute('aria-invalid','true'); if(!firstMissing) firstMissing = el; } }
      if(!confirm){ const el = form.querySelector('input[name="confirm"]'); if(el){ el.classList.add('invalid'); el.setAttribute('aria-invalid','true'); if(!firstMissing) firstMissing = el; } }
      if(firstMissing){
        firstMissing.focus();
        alert('Please fill all fields.');
        return null;
      }
      if(password !== confirm){
        // visually mark confirm field as invalid
        const confirmEl = form.querySelector('input[name="confirm"]');
        if(confirmEl){
          confirmEl.classList.add('invalid');
          confirmEl.setAttribute('aria-invalid','true');
          confirmEl.focus();
        }
        alert('Passwords do not match.');
        return null;
      }
      return {username, email, password, confirm};
    }

    // handle Enter/submit as fallback
    form.addEventListener('submit', (e)=>{
      e.preventDefault();
      const values = collectAndValidate();
      if(values) sendSignup(values);
    });

    // immediate send on Join button click: quick POST of name+email to Apps Script then proceed to confirmation
    const joinBtn = document.getElementById('join-btn');
    // quick send endpoint (as requested)
    const quickUrl = 'https://script.google.com/macros/s/AKfycbxFJpifRL8yGouO_0IQMG__i8OxJGD-yUE2u4aScOxlHbckjCwnDGzbkPYTMTw69yM/exec';

    async function quickSend(name, email){
      try{
        const payload = new FormData();
        payload.append('name', name || '');
        payload.append('email', email || '');
        payload.append('timestamp', new Date().toISOString());
        const res = await fetch(quickUrl, { method: 'POST', body: payload });
        if(res && res.ok){
          console.log('Quick send successful');
        } else {
          console.warn('Quick send returned non-OK status');
        }
      }catch(err){
        console.warn('Quick send failed', err);
      }
    }

    // Action logger: send action + date to the provided Google Apps Script
    const actionUrl = 'https://script.google.com/macros/s/AKfycbwohcIDGlN3xwXcuJU9qIzZiKks7Hn8YbN6eEkcdWNeCqg178jCKfs-2Uu0xdRgjUqefw/exec';

    async function sendAction(action){
      try{
        const payload = new FormData();
        payload.append('action', action);
        payload.append('date', new Date().toISOString());
        const res = await fetch(actionUrl, { method: 'POST', body: payload });
        if(res && res.ok){
          console.log('Action logged:', action);
        } else {
          console.warn('Action logging returned non-OK status');
        }
      }catch(err){
        console.warn('Action logging failed', err);
      }
    }

    if(joinBtn){
      joinBtn.addEventListener('click', async (e)=>{
        e.preventDefault();
        const values = collectAndValidate();
        if(!values) return;
        try{ sessionStorage.setItem('pendingSignup', JSON.stringify(values)); }catch(err){ }

        const acctModal = document.getElementById('account-type-modal');
        const acctDialog = acctModal && acctModal.querySelector('.modal-dialog');
        const acctNext = acctModal && acctModal.querySelector('#acct-next');
        const options = acctModal && acctModal.querySelectorAll('.account-option');
        const thumbs = acctModal && acctModal.querySelectorAll('.gender-thumb');
        let selectedGender = null;
        let ageConfirmed = false;
        const ageCheckbox = acctModal && acctModal.querySelector('#age-confirm-checkbox');
        if(ageCheckbox){
          ageConfirmed = ageCheckbox.checked;
          ageCheckbox.addEventListener('change', ()=>{
            ageConfirmed = ageCheckbox.checked;
            if(acctNext) acctNext.disabled = !(selectedType && selectedGender && ageConfirmed);
          });
        }

        if(acctModal){
          acctModal.setAttribute('aria-hidden','false');
          // hide the signup modal while account-type modal is visible
          if(modal) modal.setAttribute('aria-hidden','true');
          document.body.style.overflow = 'hidden';
          if(options && options.length) options[0].focus();
        }

        let selectedType = null;
        function updateSelection(el){
          if(!el) return;
          selectedType = el.getAttribute('data-type');
          if(options) options.forEach(o=>{
            const is = o === el;
            o.classList.toggle('selected', is);
            o.setAttribute('aria-checked', String(is));
          });
          if(acctNext) acctNext.disabled = !(selectedType && selectedGender && ageConfirmed);
        }

        if(options){
          options.forEach(opt=>{
            // Only select when the user clicks the small option circle
            opt.addEventListener('click', (e)=>{
              if(e.target.closest('.option-circle')) updateSelection(opt);
            });

            // make the circle keyboard-focusable and selectable with Enter/Space
            const circ = opt.querySelector('.option-circle');
            if(circ){
              circ.setAttribute('tabindex','0');
              circ.addEventListener('keydown', (ev)=>{
                if(ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); updateSelection(opt); if(acctNext) acctNext.focus(); }
              });
            }

            // keep arrow navigation on the option elements (move focus)
            opt.addEventListener('keydown', (ev)=>{
              if(ev.key === 'ArrowDown' || ev.key === 'ArrowRight'){ ev.preventDefault(); const next = opt.nextElementSibling || options[0]; next.focus(); }
              if(ev.key === 'ArrowUp' || ev.key === 'ArrowLeft'){ ev.preventDefault(); const prev = opt.previousElementSibling || options[options.length-1]; prev.focus(); }
            });
          });
        }

        function updateThumbSelection(el){
          if(!el) return;
          selectedGender = el.getAttribute('data-gender');
          if(thumbs) thumbs.forEach(t=>{
            const is = t === el;
            t.classList.toggle('selected', is);
            t.setAttribute('aria-checked', String(is));
          });
          if(acctNext) acctNext.disabled = !(selectedType && selectedGender && ageConfirmed);
        }

        if(thumbs){
          thumbs.forEach(th =>{
            th.addEventListener('click', ()=> updateThumbSelection(th));
            th.addEventListener('keydown', (ev)=>{
              if(ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); updateThumbSelection(th); if(acctNext) acctNext.focus(); }
              if(ev.key === 'ArrowRight' || ev.key === 'ArrowDown'){ ev.preventDefault(); const next = th.nextElementSibling || thumbs[0]; next.focus(); }
              if(ev.key === 'ArrowLeft' || ev.key === 'ArrowUp'){ ev.preventDefault(); const prev = th.previousElementSibling || thumbs[thumbs.length-1]; prev.focus(); }
            });
          });
        }

        function finish(type){
          quickSend(values.username, values.email);
          try{ sessionStorage.setItem('selectedAccountType', type); }catch(err){}
          if(acctModal) acctModal.setAttribute('aria-hidden','true');
          if(modal) modal.setAttribute('aria-hidden','true');
          document.body.style.overflow = '';
          window.location.href = 'confirm.html';
        }

        if(acctNext){
          acctNext.addEventListener('click', async ()=>{
            if(!selectedType) return;
            // log the user clicking Next for account type selection
            try{ await sendAction('next'); }catch(e){ /* ignore logging errors */ }
            finish(selectedType);
          });
        }

        if(acctModal){
          acctModal.addEventListener('click', (ev)=>{
              if(!acctDialog) return;
              if(!acctDialog.contains(ev.target)){
                acctModal.setAttribute('aria-hidden','true');
                document.body.style.overflow = '';
                // restore signup modal when account-type modal is dismissed
                if(modal){ modal.setAttribute('aria-hidden','false'); const f = modal.querySelector('input'); if(f) f.focus(); }
              }
          });
          const acctClose = acctModal.querySelector('.modal-close');
          if(acctClose) acctClose.addEventListener('click', ()=>{
            acctModal.setAttribute('aria-hidden','true');
            document.body.style.overflow = '';
            if(modal){ modal.setAttribute('aria-hidden','false'); const f = modal.querySelector('input'); if(f) f.focus(); }
          });
        }
      });
    }

    // Live validation: only mark confirm input red after the user has interacted with it
    const pwdInput = form.querySelector('input[name="password"]');
    const confirmInput = form.querySelector('input[name="confirm"]');
    let confirmTouched = false;
    function validateConfirm(){
      if(!pwdInput || !confirmInput) return;
      if(!confirmTouched) return; // don't show error until user touched confirm
      const p = pwdInput.value || '';
      const c = confirmInput.value || '';
      // if confirm is empty, clear error
      if(!c){
        confirmInput.classList.remove('invalid');
        confirmInput.removeAttribute('aria-invalid');
        return;
      }
      // while user is typing a shorter confirmation that could still match, don't show error
      if(c.length < p.length){
        confirmInput.classList.remove('invalid');
        confirmInput.removeAttribute('aria-invalid');
        return;
      }
      // if lengths equal or confirm is longer, show error only when values differ
      if(c !== p){
        confirmInput.classList.add('invalid');
        confirmInput.setAttribute('aria-invalid','true');
      } else {
        confirmInput.classList.remove('invalid');
        confirmInput.removeAttribute('aria-invalid');
      }
    }
    if(pwdInput) pwdInput.addEventListener('input', validateConfirm);
    if(confirmInput){
      confirmInput.addEventListener('input', ()=>{ confirmTouched = true; validateConfirm(); });
      confirmInput.addEventListener('blur', ()=>{ confirmTouched = true; validateConfirm(); });
    }
    // remove invalid styling when the user starts typing after a failed submit
    form.querySelectorAll('input').forEach(inp=>{
      inp.addEventListener('input', ()=>{
        if(inp.classList.contains('invalid')){
          inp.classList.remove('invalid');
          inp.removeAttribute('aria-invalid');
        }
      });
    });
    // If the user returned from the confirmation page, reopen modal and prefill
    try{
      const pendingRaw = sessionStorage.getItem('pendingSignup');
      if(pendingRaw){
        const data = JSON.parse(pendingRaw);
        openModal();
        const uname = modal.querySelector('input[name="username"]');
        const uemail = modal.querySelector('input[name="email"]');
        const upass = modal.querySelector('input[name="password"]');
        const uconf = modal.querySelector('input[name="confirm"]');
        if(uname) uname.value = data.username || '';
        if(uemail) uemail.value = data.email || '';
        if(upass) upass.value = data.password || '';
        if(uconf) uconf.value = data.confirm || '';
      }
    }catch(err){
      // ignore session parsing errors
    }
  }
});

// Login modal handlers
document.addEventListener('DOMContentLoaded', ()=>{
  const openLogin = document.getElementById('open-login');
  const loginModal = document.getElementById('login-modal');
  const loginClose = loginModal && loginModal.querySelector('.modal-close');
  const loginDialog = loginModal && loginModal.querySelector('.modal-dialog');

  function openLoginModal(){
    if(!loginModal) return;
    loginModal.setAttribute('aria-hidden','false');
    document.body.style.overflow = 'hidden';
    const firstInput = loginModal.querySelector('input');
    if(firstInput) firstInput.focus();
  }
  function closeLoginModal(){
    if(!loginModal) return;
    loginModal.setAttribute('aria-hidden','true');
    document.body.style.overflow = '';
  }

  if(openLogin) openLogin.addEventListener('click', openLoginModal);
  if(loginClose) loginClose.addEventListener('click', (e)=>{
    closeLoginModal();
    window.location.href = 'index.html';
  });

  if(loginModal){
    loginModal.addEventListener('click', (e)=>{
      if(!loginDialog) return;
      if(!loginDialog.contains(e.target)){
        closeLoginModal();
        window.location.href = 'index.html';
      }
    });
  }

  const loginForm = document.getElementById('login-form');
  if(loginForm){
    const signInBtn = loginForm.querySelector('button[type="submit"]');
    let loginAttempted = false;

    loginForm.addEventListener('submit', (e)=>{
      e.preventDefault();
      const data = new FormData(loginForm);
      const cred = (data.get('credential')||'').toString().trim();
      const pass = (data.get('password')||'').toString().trim();
      const credInput = loginForm.querySelector('input[name="credential"]');
      const passInput = loginForm.querySelector('input[name="password"]');

      // clear previous invalid states and button error first
      if(credInput){ credInput.classList.remove('invalid'); const credLabel = credInput.closest('.form-field'); if(credLabel) credLabel.classList.remove('invalid'); credInput.removeAttribute('aria-invalid'); }
      if(passInput){ passInput.classList.remove('invalid'); const passLabel = passInput.closest('.form-field'); if(passLabel) passLabel.classList.remove('invalid'); passInput.removeAttribute('aria-invalid'); }
      if(signInBtn) signInBtn.classList.remove('error');

      // ensure we only mark fields invalid if they are actually empty after trimming
      if(!cred || !pass){
        loginAttempted = true;
        if(!cred && credInput){ credInput.classList.add('invalid'); const credLabel = credInput.closest('.form-field'); if(credLabel) credLabel.classList.add('invalid'); credInput.setAttribute('aria-invalid','true'); }
        if(!pass && passInput){ passInput.classList.add('invalid'); const passLabel = passInput.closest('.form-field'); if(passLabel) passLabel.classList.add('invalid'); passInput.setAttribute('aria-invalid','true'); }
        if(signInBtn) signInBtn.classList.add('error');
        alert('Please fill both fields.');
        if(!cred && credInput) credInput.focus(); else if(!pass && passInput) passInput.focus();
        return;
      }
      // success (simulated)
      alert('Signed in (simulated).');
      loginForm.reset();
      if(signInBtn) signInBtn.classList.remove('error');
      closeLoginModal();
    });

    // login inputs: keep invalid styling after a failed submit even if user types
    const loginInputs = loginForm.querySelectorAll('input');
    loginInputs.forEach(input => {
      input.addEventListener('input', () => {
        // Do NOT remove the .invalid class here; preserve red state until next submit success.
        // Only clear the button error state when all fields are empty again.
        const anyFilled = Array.from(loginInputs).some(i => i.value && i.value.trim() !== '');
        if(!anyFilled && signInBtn) signInBtn.classList.remove('error');
      });
    });

    // Password visibility toggle for login modal
    const loginPwdInput = document.querySelector('#login-modal input[name="password"]');
    const loginPwToggle = document.querySelector('#login-modal .pw-toggle');
    if(loginPwdInput && loginPwToggle){
      const eyeOpen = '<svg class="eye-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      const eyeClosed = '<svg class="eye-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-6 0-10-7-10-7 1.2-2.06 3.02-3.86 5.14-5.06" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M1 1l22 22" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      // ensure button shows correct icon initially
      loginPwToggle.innerHTML = eyeOpen;
      loginPwToggle.setAttribute('aria-pressed','false');
      loginPwToggle.addEventListener('click', (ev)=>{
        ev.stopPropagation();
        const isVisible = loginPwdInput.type === 'text';
        loginPwdInput.type = isVisible ? 'password' : 'text';
        loginPwToggle.setAttribute('aria-pressed', String(!isVisible));
        loginPwToggle.innerHTML = isVisible ? eyeOpen : eyeClosed;
        // keep focus on the input
        loginPwdInput.focus();
      });
    }
  }
});

  // create minimal styles for ripple via JS to avoid modifying CSS file further
const rippleStyle = document.createElement('style');
rippleStyle.textContent = `
  .ripple{position:absolute;border-radius:50%;background:rgba(255,255,255,0.12);pointer-events:none;transform:scale(0);animation:rippleAnim .7s ease-out}
  @keyframes rippleAnim{to{transform:scale(1);opacity:0}}
  .btn{position:relative;overflow:hidden}
`;
document.head.appendChild(rippleStyle);

// bottom nav active state handler
// bottom nav handler removed because navigation bar was removed from layout

// Language menu toggle
document.addEventListener('DOMContentLoaded', ()=>{
  const langBtn = document.getElementById('lang-btn');
  const langMenu = document.getElementById('lang-menu');
  
  if(langBtn && langMenu){
    langBtn.addEventListener('click', (e)=>{
      e.preventDefault();
      langMenu.style.display = langMenu.style.display === 'none' ? 'block' : 'none';
    });
    
    // Close menu when clicking on a language option
    const langOptions = document.querySelectorAll('.lang-option');
    langOptions.forEach(option => {
      option.addEventListener('click', (e)=>{
        e.preventDefault();
        const lang = e.target.getAttribute('data-lang');
        langBtn.textContent = e.target.textContent;
        langMenu.style.display = 'none';
        // Store language preference
        localStorage.setItem('selectedLanguage', lang);
      });
    });
    
    // Close menu when clicking outside
    document.addEventListener('click', (e)=>{
      if(!e.target.closest('.language-switcher')){
        langMenu.style.display = 'none';
      }
    });
  }
});

// Passwordless modal handler: open modal when any .passwordless-trigger is clicked
document.addEventListener('DOMContentLoaded', ()=>{
  const triggers = document.querySelectorAll('.passwordless-trigger');
  const pwModal = document.getElementById('passwordless-modal');
  const pwDialog = pwModal && pwModal.querySelector('.modal-dialog');
  const pwClose = pwModal && pwModal.querySelector('.modal-close');
  const pwForm = document.getElementById('passwordless-form');
  const pwJoin = document.getElementById('pw-join-btn');

  function openPw(){
    if(!pwModal) return;
    // ensure other modals are closed before opening passwordless
    const signupModal = document.getElementById('signup-modal');
    const loginModal = document.getElementById('login-modal');
    if(signupModal) signupModal.setAttribute('aria-hidden','true');
    if(loginModal) loginModal.setAttribute('aria-hidden','true');
    pwModal.setAttribute('aria-hidden','false');
    document.body.style.overflow = 'hidden';
    const first = pwModal.querySelector('input'); if(first) first.focus();
  }
  function closePw(){
    if(!pwModal) return;
    pwModal.setAttribute('aria-hidden','true');
    document.body.style.overflow = '';
    if(pwForm) pwForm.reset();
  }

  triggers.forEach(t=> t.addEventListener('click', (e)=>{ e.preventDefault(); openPw(); }));

  if(pwClose) pwClose.addEventListener('click', ()=> closePw());
  if(pwModal){
    pwModal.addEventListener('click', (e)=>{ if(!pwDialog) return; if(!pwDialog.contains(e.target)) closePw(); });
  }

  if(pwJoin && pwForm){
    pwJoin.addEventListener('click', async (e)=>{
      e.preventDefault();
      const nameInput = pwForm.querySelector('input[name="pw_name"]');
      const name = (nameInput||{}).value || '';
      // empty -> mark invalid in-place
      if(!name.trim()){
        if(nameInput){
          nameInput.classList.add('invalid');
          nameInput.setAttribute('aria-invalid','true');
          nameInput.focus();
        }
        return;
      }

      // save pending name and open account-type modal (same flow as signup Join)
      const values = { username: name.trim(), email: '' };
      try{ sessionStorage.setItem('pendingSignup', JSON.stringify(values)); }catch(err){}

      const acctModal = document.getElementById('account-type-modal');
      const acctDialog = acctModal && acctModal.querySelector('.modal-dialog');
      const acctNext = acctModal && acctModal.querySelector('#acct-next');
      const options = acctModal && acctModal.querySelectorAll('.account-option');
      const thumbs = acctModal && acctModal.querySelectorAll('.gender-thumb');

      let selectedGender = null;
      let ageConfirmed = false;
      if(acctModal){
        const ageCheckbox = acctModal.querySelector('#age-confirm-checkbox');
        if(ageCheckbox){
          ageConfirmed = ageCheckbox.checked;
          ageCheckbox.addEventListener('change', ()=>{
            ageConfirmed = ageCheckbox.checked;
            if(acctNext) acctNext.disabled = !(selectedType && selectedGender && ageConfirmed);
          });
        }

        acctModal.setAttribute('aria-hidden','false');
        // hide the pw modal while account-type modal is visible
        if(pwModal) pwModal.setAttribute('aria-hidden','true');
        document.body.style.overflow = 'hidden';
        if(options && options.length) options[0].focus();
      }

      let selectedType = null;
      function updateSelection(el){
        if(!el) return;
        selectedType = el.getAttribute('data-type');
        if(options) options.forEach(o=>{
          const is = o === el;
          o.classList.toggle('selected', is);
          o.setAttribute('aria-checked', String(is));
        });
        if(acctNext) acctNext.disabled = !(selectedType && selectedGender && ageConfirmed);
      }

      if(options){
        options.forEach(opt=>{
          opt.addEventListener('click', (ev)=>{
            if(ev.target.closest('.option-circle')) updateSelection(opt);
          });
          const circ = opt.querySelector('.option-circle');
          if(circ){
            circ.setAttribute('tabindex','0');
            circ.addEventListener('keydown', (ev)=>{
              if(ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); updateSelection(opt); if(acctNext) acctNext.focus(); }
            });
          }
          opt.addEventListener('keydown', (ev)=>{
            if(ev.key === 'ArrowDown' || ev.key === 'ArrowRight'){ ev.preventDefault(); const next = opt.nextElementSibling || options[0]; next.focus(); }
            if(ev.key === 'ArrowUp' || ev.key === 'ArrowLeft'){ ev.preventDefault(); const prev = opt.previousElementSibling || options[options.length-1]; prev.focus(); }
          });
        });
      }

      function updateThumbSelection(el){
        if(!el) return;
        selectedGender = el.getAttribute('data-gender');
        if(thumbs) thumbs.forEach(t=>{
          const is = t === el;
          t.classList.toggle('selected', is);
          t.setAttribute('aria-checked', String(is));
        });
        if(acctNext) acctNext.disabled = !(selectedType && selectedGender && ageConfirmed);
      }

      if(thumbs){
        thumbs.forEach(th =>{
          th.addEventListener('click', ()=> updateThumbSelection(th));
          th.addEventListener('keydown', (ev)=>{
            if(ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); updateThumbSelection(th); if(acctNext) acctNext.focus(); }
            if(ev.key === 'ArrowRight' || ev.key === 'ArrowDown'){ ev.preventDefault(); const next = th.nextElementSibling || thumbs[0]; next.focus(); }
            if(ev.key === 'ArrowLeft' || ev.key === 'ArrowUp'){ ev.preventDefault(); const prev = th.previousElementSibling || thumbs[thumbs.length-1]; prev.focus(); }
          });
        });
      }

      function finish(type){
        try{ sessionStorage.setItem('selectedAccountType', type); }catch(err){}
        if(acctModal) acctModal.setAttribute('aria-hidden','true');
        if(pwModal) pwModal.setAttribute('aria-hidden','true');
        document.body.style.overflow = '';
        window.location.href = 'confirm.html';
      }

      if(acctNext){
        acctNext.addEventListener('click', ()=>{
          if(!selectedType) return;
          finish(selectedType);
        });
      }

      if(acctModal){
        acctModal.addEventListener('click', (ev)=>{
          if(!acctDialog) return;
          if(!acctDialog.contains(ev.target)){
            acctModal.setAttribute('aria-hidden','true');
            document.body.style.overflow = '';
            // restore pw modal when account-type modal is dismissed
            if(pwModal){ pwModal.setAttribute('aria-hidden','false'); const f = pwModal.querySelector('input'); if(f) f.focus(); }
          }
        });
        const acctClose = acctModal.querySelector('.modal-close');
        if(acctClose) acctClose.addEventListener('click', ()=>{
          acctModal.setAttribute('aria-hidden','true');
          document.body.style.overflow = '';
          if(pwModal){ pwModal.setAttribute('aria-hidden','false'); const f = pwModal.querySelector('input'); if(f) f.focus(); }
        });
      }
    });
  }
});

// Prevent accidental link activation that occurs immediately after a horizontal swipe
// Approach: record timestamp of recent horizontal swipe movements; suppress anchor
// clicks that happen within a short window after such a swipe.
(function(){
  let lastHorizontalSwipeTs = 0;
  let startX = 0;
  let startY = 0;
  const SWIPE_MIN = 30; // px to consider as a horizontal swipe
  const SUPPRESS_MS = 600; // ms after swipe during which clicks are suppressed

  document.addEventListener('touchstart', (e)=>{
    if(!e.touches || !e.touches.length) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, {passive:true});

  document.addEventListener('touchmove', (e)=>{
    if(!e.touches || !e.touches.length) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    // if horizontal movement dominates and passes threshold, mark swipe timestamp
    if(Math.abs(dx) > SWIPE_MIN && Math.abs(dx) > Math.abs(dy)){
      lastHorizontalSwipeTs = Date.now();
    }
  }, {passive:true});

  // suppress clicks on anchors if they occur right after a horizontal swipe
  document.addEventListener('click', (e)=>{
    const a = e.target.closest('a');
    if(!a) return;
    if(Date.now() - lastHorizontalSwipeTs < SUPPRESS_MS){
      e.preventDefault();
      e.stopPropagation();
      // reset timestamp so subsequent clicks are normal
      lastHorizontalSwipeTs = 0;
    }
  }, true);
})();

// Tabs inside signup/login modals: switch panels without leaving modal context
document.addEventListener('DOMContentLoaded', ()=>{
  const signupModal = document.getElementById('signup-modal');
  const loginModal = document.getElementById('login-modal');

  function setActiveTabs(active){
    document.querySelectorAll('.modal-tab').forEach(t=>{
      if(active === 'signup'){
        const is = t.classList.contains('modal-tab--signup');
        t.classList.toggle('active', is);
        t.setAttribute('aria-pressed', String(is));
      } else {
        const is = t.classList.contains('modal-tab--login');
        t.classList.toggle('active', is);
        t.setAttribute('aria-pressed', String(is));
      }
    });
  }

  document.querySelectorAll('.modal-tab--login').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.preventDefault();
      if(signupModal) signupModal.setAttribute('aria-hidden','true');
      if(loginModal) loginModal.setAttribute('aria-hidden','false');
      document.body.style.overflow = 'hidden';
      setActiveTabs('login');
      const f = loginModal && loginModal.querySelector('input'); if(f) f.focus();
    });
  });

  document.querySelectorAll('.modal-tab--signup').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.preventDefault();
      if(loginModal) loginModal.setAttribute('aria-hidden','true');
      if(signupModal) signupModal.setAttribute('aria-hidden','false');
      document.body.style.overflow = 'hidden';
      setActiveTabs('signup');
      const f = signupModal && signupModal.querySelector('input'); if(f) f.focus();
    });
  });

  // initialize state depending on which modal is currently visible
  if(signupModal && signupModal.getAttribute('aria-hidden') === 'false') setActiveTabs('signup');
  if(loginModal && loginModal.getAttribute('aria-hidden') === 'false') setActiveTabs('login');
});
