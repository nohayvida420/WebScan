/* ============================================================
   WebScan AI – Main Application Script
   ============================================================ */

// ── CORS PROXIES (tried in order) ──────────────────────────
const PROXIES = [
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  u => `https://cors-anywhere.herokuapp.com/${u}`,
];

// ── DOM REFS ───────────────────────────────────────────────
const homeScreen    = document.getElementById('homeScreen');
const loadingScreen = document.getElementById('loadingScreen');
const resultsScreen = document.getElementById('resultsScreen');
const urlInput      = document.getElementById('urlInput');
const scanBtn       = document.getElementById('scanBtn');
const errorMsg      = document.getElementById('errorMsg');
const scanningUrl   = document.getElementById('scanningUrl');
const progressFill  = document.getElementById('progressFill');
const progressPct   = document.getElementById('progressPct');
const loaderLog     = document.getElementById('loaderLog');
const newScanBtn    = document.getElementById('newScanBtn');
const resultUrlBadge = document.getElementById('resultUrl');
const aiSummaryText  = document.getElementById('aiSummaryText');
const aiExplainBtn   = document.getElementById('aiExplainBtn');
const aiStepsPanel   = document.getElementById('aiStepsPanel');
const aiStepsInner   = document.getElementById('aiStepsInner');

// ── STATE ───────────────────────────────────────────────────
let analysisData = {};

// ── SCREEN MANAGEMENT ──────────────────────────────────────
function showScreen(id) {
  [homeScreen, loadingScreen, resultsScreen].forEach(s => {
    s.classList.add('hidden');
    s.classList.remove('active', 'fade-in');
  });
  const target = document.getElementById(id);
  target.classList.remove('hidden');
  target.classList.add('active');
  if (id !== 'loadingScreen') target.classList.add('fade-in');
}

// ── SCAN TRIGGER ───────────────────────────────────────────
scanBtn.addEventListener('click', startScan);
urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') startScan(); });
newScanBtn.addEventListener('click', () => { showScreen('homeScreen'); urlInput.value = ''; });

async function startScan() {
  const raw = urlInput.value.trim();
  if (!raw) return showError('Please enter a URL.');
  let targetUrl = raw;
  if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;
  try { new URL(targetUrl); } catch { return showError('Invalid URL format.'); }

  errorMsg.classList.add('hidden');
  showScreen('loadingScreen');
  scanningUrl.textContent = targetUrl;
  resetLoader();

  try {
    const html = await fetchWithProxy(targetUrl);
    const data = await analyzeHTML(html, targetUrl);
    analysisData = data;
    renderResults(data, targetUrl);
    showScreen('resultsScreen');
    generateAISummary(data, targetUrl);
  } catch (err) {
    showScreen('homeScreen');
    showError('Could not fetch the site. It may block scrapers or require authentication. Try another URL.\n' + err.message);
  }
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove('hidden');
}

// ── FETCH ───────────────────────────────────────────────────
async function fetchWithProxy(url) {
  for (const proxy of PROXIES) {
    try {
      logMsg(`Trying proxy: ${proxy(url).split('?')[0]}…`);
      const res = await fetch(proxy(url), { signal: AbortSignal.timeout(12000) });
      if (!res.ok) continue;
      const text = await res.text();
      if (text.length > 50) { logMsg(`✓ Fetched ${formatBytes(text.length)}`); return text; }
    } catch (_) { /* try next */ }
  }
  throw new Error('All proxies failed');
}

// ── LOADER HELPERS ─────────────────────────────────────────
function resetLoader() {
  progressFill.style.width = '0%';
  progressPct.textContent = '0%';
  loaderLog.innerHTML = '';
  ['links','images','scripts','styles','fonts','meta','iframes','flags'].forEach(k => {
    document.getElementById('cnt-' + k).textContent = '0';
    document.querySelector(`[data-key="${k}"]`)?.classList.remove('active');
  });
}

let _logCount = 0;
function logMsg(msg) {
  _logCount++;
  const now = new Date();
  const time = `${String(now.getSeconds()).padStart(2,'0')}.${String(now.getMilliseconds()).padStart(3,'0')}`;
  const line = document.createElement('div');
  line.className = 'log-line';
  line.innerHTML = `<span class="log-time">[${time}]</span><span class="log-msg">${msg}</span>`;
  loaderLog.appendChild(line);
  loaderLog.scrollTop = loaderLog.scrollHeight;
}

function setProgress(pct) {
  progressFill.style.width = pct + '%';
  progressPct.textContent = Math.round(pct) + '%';
}

function animateCounter(key, value) {
  const el = document.getElementById('cnt-' + key);
  const card = document.querySelector(`[data-key="${key}"]`);
  card?.classList.add('active');
  let i = 0;
  const step = Math.max(1, Math.ceil(value / 20));
  const t = setInterval(() => {
    i = Math.min(i + step, value);
    el.textContent = i;
    if (i >= value) clearInterval(t);
  }, 40);
}

// ── HTML ANALYSIS ──────────────────────────────────────────
async function analyzeHTML(html, baseUrl) {
  const base = new URL(baseUrl);
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const data = {};

  setProgress(10); logMsg('Parsing DOM structure…');
  await tick();

  // ── LINKS ──
  logMsg('Extracting links…');
  const anchors = [...doc.querySelectorAll('a[href]')];
  data.links = anchors.map(a => {
    const href = a.getAttribute('href') || '';
    let type = 'external';
    if (href.startsWith('mailto:')) type = 'mailto';
    else if (href.startsWith('tel:')) type = 'tel';
    else if (href.startsWith('javascript:')) type = 'js';
    else if (href.startsWith('#')) type = 'anchor';
    else {
      try {
        const u = new URL(href, baseUrl);
        if (u.hostname === base.hostname) type = 'internal';
      } catch (_) { type = 'relative'; }
    }
    return { href, text: (a.textContent || '').trim().slice(0, 80), type };
  }).filter((l, i, arr) => arr.findIndex(x => x.href === l.href) === i);
  animateCounter('links', data.links.length);
  setProgress(22); logMsg(`Found ${data.links.length} unique links`);
  await tick();

  // ── IMAGES ──
  logMsg('Scanning images…');
  data.images = [...doc.querySelectorAll('img')].map(img => ({
    src: img.getAttribute('src') || '',
    alt: img.getAttribute('alt') || '',
    width: img.getAttribute('width') || '?',
    height: img.getAttribute('height') || '?',
    loading: img.getAttribute('loading') || 'eager',
  })).filter(i => i.src);
  animateCounter('images', data.images.length);
  setProgress(35); logMsg(`Found ${data.images.length} images`);
  await tick();

  // ── SCRIPTS ──
  logMsg('Analyzing scripts…');
  data.scripts = [...doc.querySelectorAll('script')].map(s => ({
    src: s.getAttribute('src') || '',
    type: s.getAttribute('type') || 'text/javascript',
    async: s.hasAttribute('async'),
    defer: s.hasAttribute('defer'),
    inline: !s.getAttribute('src'),
    snippet: !s.getAttribute('src') ? (s.textContent || '').slice(0, 120).trim() : '',
  }));
  animateCounter('scripts', data.scripts.length);
  setProgress(47); logMsg(`Found ${data.scripts.length} scripts`);
  await tick();

  // ── STYLESHEETS ──
  logMsg('Collecting stylesheets…');
  data.styles = [...doc.querySelectorAll('link[rel="stylesheet"], style')].map(s => ({
    href: s.getAttribute('href') || '',
    inline: s.tagName === 'STYLE',
    media: s.getAttribute('media') || 'all',
  }));
  animateCounter('styles', data.styles.length);
  setProgress(55); logMsg(`Found ${data.styles.length} stylesheets`);
  await tick();

  // ── FONTS ──
  logMsg('Detecting fonts…');
  const fontSources = [];
  const fontLinkRx = /fonts\.googleapis\.com|fonts\.bunny\.net|typekit\.net|use\.fontawesome|cdnfonts/i;
  const fontFaceRx = /@font-face[\s\S]*?}/g;
  const googleFontRx = /family=([^&"']+)/;
  doc.querySelectorAll('link[href]').forEach(l => {
    const h = l.getAttribute('href') || '';
    if (fontLinkRx.test(h)) {
      const m = h.match(googleFontRx);
      const names = m ? decodeURIComponent(m[1]).replace(/\+/g,' ').split('|').map(n => n.split(':')[0]) : [h];
      names.forEach(n => fontSources.push({ name: n.trim(), source: 'Google Fonts', href: h }));
    }
  });
  doc.querySelectorAll('style').forEach(s => {
    const text = s.textContent || '';
    let m; const rx = /@font-face\s*\{([^}]*)\}/g;
    while ((m = rx.exec(text)) !== null) {
      const nameM = m[1].match(/font-family\s*:\s*['"]?([^;'"]+)/i);
      const srcM  = m[1].match(/src\s*:\s*[^;]+/i);
      if (nameM) fontSources.push({ name: nameM[1].trim(), source: 'Inline @font-face', href: srcM ? srcM[0].replace(/src\s*:\s*/,'').trim() : '' });
    }
  });
  const cssLinks = [...doc.querySelectorAll('link[rel="stylesheet"]')].map(l => l.getAttribute('href') || '');
  if (cssLinks.some(l => fontLinkRx.test(l)) && fontSources.length === 0) {
    fontSources.push({ name: 'External font', source: 'Stylesheet reference', href: cssLinks.find(l => fontLinkRx.test(l)) || '' });
  }
  data.fonts = fontSources.filter((f, i, a) => a.findIndex(x => x.name === f.name) === i);
  animateCounter('fonts', data.fonts.length);
  setProgress(64); logMsg(`Found ${data.fonts.length} font families`);
  await tick();

  // ── META / SEO ──
  logMsg('Reading meta tags & SEO…');
  data.meta = [...doc.querySelectorAll('meta')].map(m => ({
    name: m.getAttribute('name') || m.getAttribute('property') || m.getAttribute('http-equiv') || '',
    content: m.getAttribute('content') || '',
  })).filter(m => m.name);
  data.title = doc.title || '';
  data.lang  = doc.documentElement.getAttribute('lang') || '';
  data.canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute('href') || '';
  data.favicon   = doc.querySelector('link[rel*="icon"]')?.getAttribute('href') || '/favicon.ico';
  animateCounter('meta', data.meta.length);
  setProgress(73); logMsg(`Found ${data.meta.length} meta tags`);
  await tick();

  // ── IFRAMES ──
  logMsg('Checking iframes…');
  data.iframes = [...doc.querySelectorAll('iframe')].map(f => ({
    src: f.getAttribute('src') || '',
    sandbox: f.getAttribute('sandbox') || 'none',
    allow: f.getAttribute('allow') || '',
    width: f.getAttribute('width') || '?',
    height: f.getAttribute('height') || '?',
  }));
  animateCounter('iframes', data.iframes.length);
  setProgress(80); logMsg(`Found ${data.iframes.length} iframes`);
  await tick();

  // ── SECURITY FLAGS ──
  logMsg('Running security analysis…');
  data.security = detectSecurityFlags(doc, html, base, data);
  animateCounter('flags', data.security.filter(f => f.risk !== 'info').length);
  setProgress(90); logMsg(`Found ${data.security.length} security findings`);
  await tick();

  // ── TECH STACK ──
  logMsg('Fingerprinting tech stack…');
  data.tech = detectTech(html, doc);
  setProgress(97); logMsg(`Detected ${data.tech.length} technologies`);
  await tick();

  // ── DONE ──
  data.rawHtml = html;
  data.charCount = html.length;
  data.wordCount = (doc.body?.textContent || '').trim().split(/\s+/).length;
  setProgress(100); logMsg('✓ Analysis complete!');
  await delay(600);
  return data;
}

// ── SECURITY DETECTION ─────────────────────────────────────
function detectSecurityFlags(doc, html, base, data) {
  const flags = [];
  const add = (icon, title, desc, risk) => flags.push({ icon, title, desc, risk });

  // Mixed content
  if (base.protocol === 'https:' && /src=["']http:\/\//i.test(html))
    add('⚠️', 'Mixed Content Detected', 'Page loads HTTP resources over an HTTPS connection, which browsers may block.', 'high');

  // Forms with external action
  doc.querySelectorAll('form[action]').forEach(f => {
    const action = f.getAttribute('action') || '';
    try {
      const u = new URL(action, base.href);
      if (u.hostname && u.hostname !== base.hostname)
        add('🔓', 'Form Posts to External Domain', `Form submits data to ${u.hostname} — verify this is intentional.`, 'high');
    } catch(_) {}
  });

  // Password fields without HTTPS
  if (doc.querySelector('input[type="password"]') && base.protocol !== 'https:')
    add('🚨', 'Password Field on HTTP', 'Login form found on a non-HTTPS page — credentials transmitted in plain text.', 'high');

  // Inline event handlers
  const inlineEvents = html.match(/\bon\w+\s*=\s*["'][^"']*["']/gi) || [];
  if (inlineEvents.length > 0)
    add('⚡', 'Inline Event Handlers', `${inlineEvents.length} inline event attributes (onclick, onload, etc.) detected — potential XSS vector if user input is reflected.`, 'medium');

  // eval() usage
  if (/\beval\s*\(/.test(html))
    add('🔴', 'eval() Usage Detected', 'JavaScript eval() found — can execute arbitrary code and is a common attack surface.', 'high');

  // document.write
  if (/document\.write\s*\(/.test(html))
    add('⚠️', 'document.write() Usage', 'document.write() can be exploited for XSS and blocks HTML parser — generally discouraged.', 'medium');

  // Iframes from external domains
  data.iframes.forEach(fr => {
    if (fr.src && fr.sandbox === 'none') {
      try {
        const u = new URL(fr.src, base.href);
        if (u.hostname !== base.hostname)
          add('🪟', 'Unsandboxed External Iframe', `Iframe from ${u.hostname} has no sandbox attribute.`, 'medium');
      } catch(_) {}
    }
  });

  // Hidden inputs
  const hiddenInputs = [...doc.querySelectorAll('input[type="hidden"]')];
  if (hiddenInputs.length > 0)
    add('👁️', 'Hidden Form Inputs', `${hiddenInputs.length} hidden input(s) found — may contain CSRF tokens (good) or sensitive data (check carefully).`, 'info');

  // Open redirect patterns
  if (/redirect=|return=|next=|url=|goto=/i.test(html))
    add('↪️', 'Potential Open Redirect Parameters', 'URL parameters like redirect=, next=, url= found — could enable open redirect attacks if not validated.', 'medium');

  // Base tag
  if (doc.querySelector('base[href]'))
    add('🔗', 'Base Tag Override', `<base> tag changes all relative URLs — can be abused in phishing if injected.`, 'info');

  // Strict CSP check
  const csp = [...doc.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')];
  if (csp.length === 0)
    add('🛡️', 'No Content-Security-Policy Meta Tag', 'No CSP meta tag found. A CSP header would help prevent XSS attacks.', 'info');
  else
    add('✅', 'Content-Security-Policy Present', 'A CSP meta tag was found on this page.', 'low');

  // Autocomplete on password
  doc.querySelectorAll('input[type="password"][autocomplete="off"]').forEach(() =>
    add('🔐', 'Password Autocomplete Disabled', 'Prevents password managers from saving credentials — may reduce usability.', 'info'));

  // data-* attributes with suspicious patterns
  const suspicious = html.match(/data-[\w-]*(?:token|key|secret|auth|pass)[^="]*/gi) || [];
  if (suspicious.length > 0)
    add('🗝️', 'Sensitive Data Attributes', `${suspicious.length} data-* attribute(s) with names like token, key, or secret — ensure these don't expose credentials.`, 'medium');

  // JS files from external CDNs without SRI
  const extScripts = data.scripts.filter(s => s.src && !s.src.startsWith('/') && !s.src.includes(base.hostname));
  const noSRI = extScripts.filter(s => !html.includes(`integrity=`));
  if (noSRI.length > 0)
    add('📦', 'External Scripts Missing SRI', `${noSRI.length} external script(s) loaded without Subresource Integrity (integrity=) attribute.`, 'medium');

  return flags;
}

// ── TECH STACK DETECTION ───────────────────────────────────
function detectTech(html, doc) {
  const tech = [];
  const h = html.toLowerCase();
  const add = (name, cat, icon) => tech.push({ name, cat, icon });

  // Frameworks
  if (h.includes('react') || h.includes('__react'))            add('React', 'Framework', '⚛️');
  if (h.includes('vue') || h.includes('__vue'))                 add('Vue.js', 'Framework', '💚');
  if (h.includes('ng-version') || h.includes('angular'))        add('Angular', 'Framework', '🔺');
  if (h.includes('svelte') || h.includes('__svelte'))           add('Svelte', 'Framework', '🔥');
  if (h.includes('next/') || h.includes('_next'))               add('Next.js', 'Framework', '▲');
  if (h.includes('nuxt') || h.includes('__nuxt'))               add('Nuxt.js', 'Framework', '💚');
  if (h.includes('gatsby'))                                      add('Gatsby', 'Framework', '💜');

  // CMS
  if (h.includes('wp-content') || h.includes('wordpress'))      add('WordPress', 'CMS', '📝');
  if (h.includes('drupal'))                                      add('Drupal', 'CMS', '💧');
  if (h.includes('joomla'))                                      add('Joomla', 'CMS', '🟨');
  if (h.includes('ghost'))                                       add('Ghost', 'CMS', '👻');
  if (h.includes('shopify'))                                     add('Shopify', 'E-Commerce', '🛍️');
  if (h.includes('magento'))                                     add('Magento', 'E-Commerce', '🛒');
  if (h.includes('wix.com') || h.includes('wixsite'))           add('Wix', 'Website Builder', '🔷');
  if (h.includes('squarespace'))                                 add('Squarespace', 'Website Builder', '🔲');
  if (h.includes('webflow'))                                     add('Webflow', 'Website Builder', '🌊');

  // Libraries
  if (h.includes('jquery'))                                      add('jQuery', 'Library', '🔧');
  if (h.includes('bootstrap'))                                   add('Bootstrap', 'CSS Framework', '🅱️');
  if (h.includes('tailwind'))                                    add('Tailwind CSS', 'CSS Framework', '🌀');
  if (h.includes('lodash') || h.includes('underscore'))         add('Lodash/Underscore', 'Utility Library', '🔩');
  if (h.includes('three.js') || h.includes('three.min'))        add('Three.js', '3D Library', '🧊');
  if (h.includes('gsap') || h.includes('tweenmax'))             add('GSAP', 'Animation', '🎞️');
  if (h.includes('socket.io'))                                   add('Socket.IO', 'Real-time', '🔌');
  if (h.includes('axios'))                                       add('Axios', 'HTTP Client', '🌐');

  // Analytics / Marketing
  if (h.includes('google-analytics') || h.includes('gtag') || h.includes('ga.js')) add('Google Analytics', 'Analytics', '📊');
  if (h.includes('googletagmanager'))                            add('Google Tag Manager', 'Tag Manager', '🏷️');
  if (h.includes('segment.com'))                                 add('Segment', 'Analytics', '📈');
  if (h.includes('hotjar'))                                      add('Hotjar', 'Heatmap', '🔥');
  if (h.includes('intercom'))                                    add('Intercom', 'Chat', '💬');
  if (h.includes('zendesk'))                                     add('Zendesk', 'Support', '🎧');
  if (h.includes('crisp.chat'))                                  add('Crisp', 'Chat', '💬');
  if (h.includes('facebook.net') || h.includes('fb-root'))      add('Facebook Pixel', 'Marketing', '📘');
  if (h.includes('connect.facebook'))                            add('Facebook SDK', 'Social', '📘');
  if (h.includes('platform.twitter'))                            add('Twitter/X SDK', 'Social', '🐦');

  // CDNs
  if (h.includes('cloudflare'))                                  add('Cloudflare', 'CDN/Security', '🛡️');
  if (h.includes('cdn.jsdelivr'))                                add('jsDelivr', 'CDN', '📦');
  if (h.includes('unpkg.com'))                                   add('UNPKG', 'CDN', '📦');
  if (h.includes('cdnjs.cloudflare'))                            add('cdnjs', 'CDN', '📦');
  if (h.includes('amazonaws.com'))                               add('AWS S3/CF', 'Cloud', '☁️');
  if (h.includes('vercel') || h.includes('_vercel'))            add('Vercel', 'Hosting', '▲');
  if (h.includes('netlify'))                                     add('Netlify', 'Hosting', '🌐');

  // Fonts
  if (h.includes('fonts.googleapis'))                            add('Google Fonts', 'Fonts', '🔤');
  if (h.includes('use.fontawesome') || h.includes('font-awesome')) add('Font Awesome', 'Icons', '⭐');
  if (h.includes('feathericons') || h.includes('feather-icons')) add('Feather Icons', 'Icons', '🪶');

  // Payments
  if (h.includes('stripe'))                                      add('Stripe', 'Payments', '💳');
  if (h.includes('paypal'))                                      add('PayPal', 'Payments', '💰');
  if (h.includes('braintree'))                                   add('Braintree', 'Payments', '💳');

  // Maps
  if (h.includes('maps.googleapis') || h.includes('google.maps')) add('Google Maps', 'Maps', '🗺️');
  if (h.includes('mapbox'))                                      add('Mapbox', 'Maps', '🗺️');
  if (h.includes('leafletjs') || h.includes('leaflet.js'))      add('Leaflet', 'Maps', '🗺️');

  return tech;
}

// ── RENDER RESULTS ─────────────────────────────────────────
function renderResults(data, targetUrl) {
  resultUrlBadge.textContent = targetUrl;
  renderOverview(data, targetUrl);
  renderLinks(data);
  renderAssets(data);
  renderFonts(data);
  renderMeta(data);
  renderSecurity(data);
  renderTech(data);
  renderRaw(data);
  setupTabs();
  aiStepsPanel.classList.add('hidden');
  aiSummaryText.textContent = 'Generating AI analysis…';
}

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });
}

// ── OVERVIEW TAB ──────────────────────────────────────────
function renderOverview(data, url) {
  const el = document.getElementById('tab-overview');
  const extLinks  = data.links.filter(l => l.type === 'external').length;
  const intLinks  = data.links.filter(l => l.type === 'internal').length;
  const highFlags = data.security.filter(f => f.risk === 'high').length;
  const og = data.meta.find(m => m.name === 'og:image')?.content || '';
  const desc = data.meta.find(m => m.name === 'description' || m.name === 'og:description')?.content || 'No description found.';

  const ogImg = og ? `<img src="${escHtml(og)}" alt="OG Image" style="max-width:100%;border-radius:10px;margin-bottom:16px;border:1px solid var(--border);" onerror="this.style.display='none'">` : '';

  el.innerHTML = `
    ${ogImg}
    <div class="stats-row">
      <div class="stat-card"><div class="stat-val">${data.links.length}</div><div class="stat-label">Total Links</div></div>
      <div class="stat-card"><div class="stat-val">${data.images.length}</div><div class="stat-label">Images</div></div>
      <div class="stat-card"><div class="stat-val">${data.scripts.length}</div><div class="stat-label">Scripts</div></div>
      <div class="stat-card"><div class="stat-val">${data.styles.length}</div><div class="stat-label">Stylesheets</div></div>
      <div class="stat-card"><div class="stat-val">${data.fonts.length}</div><div class="stat-label">Font Families</div></div>
      <div class="stat-card"><div class="stat-val">${data.tech.length}</div><div class="stat-label">Technologies</div></div>
      <div class="stat-card"><div class="stat-val" style="color:${highFlags > 0 ? 'var(--red)' : 'var(--green)'}">${highFlags}</div><div class="stat-label">High-Risk Flags</div></div>
      <div class="stat-card"><div class="stat-val">${formatBytes(data.charCount)}</div><div class="stat-label">Page Size</div></div>
    </div>
    <div class="card">
      <div class="card-title">Page Information</div>
      <table class="meta-table">
        <tr><td>Title</td><td>${escHtml(data.title) || '<em>None</em>'}</td></tr>
        <tr><td>Language</td><td>${escHtml(data.lang) || 'Not specified'}</td></tr>
        <tr><td>Canonical</td><td>${data.canonical ? `<a class="link-url" href="${escHtml(data.canonical)}" target="_blank">${escHtml(data.canonical)}</a>` : 'Not set'}</td></tr>
        <tr><td>Word Count</td><td>~${data.wordCount.toLocaleString()} words</td></tr>
        <tr><td>Description</td><td style="white-space:normal;color:var(--text-dim)">${escHtml(desc)}</td></tr>
        <tr><td>Internal Links</td><td>${intLinks}</td></tr>
        <tr><td>External Links</td><td>${extLinks}</td></tr>
      </table>
    </div>`;
}

// ── LINKS TAB ─────────────────────────────────────────────
function renderLinks(data) {
  const el = document.getElementById('tab-links');
  const groups = { internal: [], external: [], mailto: [], tel: [], js: [], anchor: [], relative: [] };
  data.links.forEach(l => (groups[l.type] || groups.relative).push(l));

  let html = `<div class="search-bar-wrap"><input class="search-bar" placeholder="🔍 Filter links…" oninput="filterLinks(this.value)" id="linkSearch"></div>`;
  html += `<div id="linkListWrap">`;

  const sections = [
    ['internal','Internal Links','badge-internal'],
    ['external','External Links','badge-external'],
    ['mailto','Email Links','badge-mailto'],
    ['tel','Phone Links','badge-tel'],
    ['js','JavaScript Links','badge-js'],
    ['anchor','Anchor Links','badge-internal'],
    ['relative','Relative Links','badge-external'],
  ];

  sections.forEach(([type, title, badge]) => {
    const items = groups[type];
    if (!items.length) return;
    html += `<div class="section-title">${escHtml(title)} <span class="count-pill">${items.length}</span></div>`;
    html += `<div class="link-list" id="group-${type}">`;
    items.forEach(link => {
      const href = link.href || '';
      const isClickable = !href.startsWith('javascript:') && href;
      html += `
        <div class="link-item" data-url="${escHtml(href)}">
          <span class="link-badge ${badge}">${escHtml(type)}</span>
          ${isClickable
            ? `<a class="link-url" href="${escHtml(href)}" target="_blank" rel="noopener">${escHtml(href.slice(0,100))}</a>`
            : `<span class="link-url" style="color:var(--text-muted)">${escHtml(href.slice(0,100)) || '(empty)'}</span>`}
          ${link.text ? `<span style="font-size:0.75rem;color:var(--text-muted);flex-shrink:0;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(link.text)}</span>` : ''}
          <button class="copy-btn" onclick="copyText('${escAttr(href)}', this)">Copy</button>
        </div>`;
    });
    html += '</div><br>';
  });
  html += '</div>';
  el.innerHTML = html;
}

window.filterLinks = function(q) {
  q = q.toLowerCase();
  document.querySelectorAll('#linkListWrap .link-item').forEach(item => {
    item.style.display = item.dataset.url.toLowerCase().includes(q) ? '' : 'none';
  });
};

// ── ASSETS TAB ────────────────────────────────────────────
function renderAssets(data) {
  const el = document.getElementById('tab-assets');
  let html = '';

  // Images
  html += `<div class="section-title">Images <span class="count-pill">${data.images.length}</span></div>`;
  if (data.images.length) {
    html += `<div class="link-list">`;
    data.images.forEach(img => {
      html += `<div class="link-item">
        <span class="link-badge badge-internal">IMG</span>
        <a class="link-url" href="${escHtml(img.src)}" target="_blank" rel="noopener">${escHtml(img.src.slice(0,90))}</a>
        <span style="font-size:0.72rem;color:var(--text-muted);flex-shrink:0">${escHtml(img.width)}×${escHtml(img.height)}</span>
        ${img.alt ? `<span style="font-size:0.72rem;color:var(--text-muted);flex-shrink:0;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">alt: ${escHtml(img.alt)}</span>` : ''}
        <span class="link-badge ${img.loading === 'lazy' ? 'badge-mailto' : 'badge-external'}">${escHtml(img.loading)}</span>
      </div>`;
    });
    html += '</div>';
  } else { html += emptyState('No images found'); }

  // Scripts
  html += `<br><div class="section-title">Scripts <span class="count-pill">${data.scripts.length}</span></div>`;
  if (data.scripts.length) {
    html += `<div class="link-list">`;
    data.scripts.forEach(s => {
      html += `<div class="link-item" style="flex-wrap:wrap;gap:8px">
        <span class="link-badge ${s.inline ? 'badge-js' : 'badge-external'}">${s.inline ? 'INLINE' : 'EXT'}</span>
        ${s.src ? `<a class="link-url" href="${escHtml(s.src)}" target="_blank" rel="noopener">${escHtml(s.src.slice(0,90))}</a>` : `<span class="link-url" style="color:var(--text-muted);font-size:0.78rem">${escHtml(s.snippet)}…</span>`}
        ${s.async ? '<span class="link-badge badge-mailto">async</span>' : ''}
        ${s.defer ? '<span class="link-badge badge-internal">defer</span>' : ''}
        ${s.src ? `<button class="copy-btn" onclick="copyText('${escAttr(s.src)}', this)">Copy</button>` : ''}
      </div>`;
    });
    html += '</div>';
  } else { html += emptyState('No scripts found'); }

  // Stylesheets
  html += `<br><div class="section-title">Stylesheets <span class="count-pill">${data.styles.length}</span></div>`;
  if (data.styles.length) {
    html += `<div class="link-list">`;
    data.styles.forEach(s => {
      html += `<div class="link-item">
        <span class="link-badge ${s.inline ? 'badge-js' : 'badge-external'}">${s.inline ? 'INLINE' : 'EXT'}</span>
        ${s.href ? `<a class="link-url" href="${escHtml(s.href)}" target="_blank" rel="noopener">${escHtml(s.href.slice(0,90))}</a>` : `<span class="link-url" style="color:var(--text-muted)">Inline style block</span>`}
        ${s.media !== 'all' ? `<span class="link-badge badge-mailto">${escHtml(s.media)}</span>` : ''}
      </div>`;
    });
    html += '</div>';
  } else { html += emptyState('No external stylesheets found'); }

  // Iframes
  html += `<br><div class="section-title">Iframes <span class="count-pill">${data.iframes.length}</span></div>`;
  if (data.iframes.length) {
    html += `<div class="link-list">`;
    data.iframes.forEach(f => {
      html += `<div class="link-item">
        <span class="link-badge badge-js">IFRAME</span>
        <a class="link-url" href="${escHtml(f.src)}" target="_blank" rel="noopener">${escHtml(f.src.slice(0,90))}</a>
        <span style="font-size:0.72rem;color:var(--text-muted);">${escHtml(f.width)}×${escHtml(f.height)}</span>
      </div>`;
    });
    html += '</div>';
  } else { html += emptyState('No iframes found'); }

  el.innerHTML = html;
}

// ── FONTS TAB ─────────────────────────────────────────────
function renderFonts(data) {
  const el = document.getElementById('tab-fonts');
  if (!data.fonts.length) { el.innerHTML = emptyState('No font declarations detected'); return; }
  let html = `<div class="font-grid">`;
  const previews = ['Aa Bb Cc', 'The quick brown fox', '0123456789', 'Hello, World!'];
  data.fonts.forEach((f, i) => {
    html += `<div class="font-card">
      <div class="font-name">${escHtml(f.name)}</div>
      <div class="font-preview" style="font-family:'${escHtml(f.name)}',sans-serif">${previews[i % previews.length]}</div>
      <div class="font-source">Source: ${escHtml(f.source)}</div>
      ${f.href ? `<div class="font-source" style="margin-top:4px"><a href="${escHtml(f.href.slice(0,120))}" target="_blank" class="link-url" style="font-size:0.7rem">View source ↗</a></div>` : ''}
    </div>`;
  });
  html += '</div>';
  el.innerHTML = html;
}

// ── META TAB ──────────────────────────────────────────────
function renderMeta(data) {
  const el = document.getElementById('tab-meta');
  const seo = ['title','description','keywords','robots','canonical','og:title','og:description','og:image','og:url','twitter:card','twitter:title','twitter:description','twitter:image'];

  let html = `<div class="card"><div class="card-title">Page Title</div>
    <div style="font-size:1rem;color:var(--text)">${escHtml(data.title) || '<em style="color:var(--text-muted)">No title</em>'}</div>
  </div>`;

  html += `<div class="card"><div class="card-title">All Meta Tags <span class="card-count">${data.meta.length}</span></div>
    <table class="meta-table"><thead><tr><th>Name / Property</th><th>Content</th></tr></thead><tbody>`;
  data.meta.forEach(m => {
    html += `<tr><td>${escHtml(m.name)}</td><td style="white-space:normal;word-break:break-word">${escHtml(m.content.slice(0,300))}</td></tr>`;
  });
  html += `</tbody></table></div>`;

  // SEO checklist
  const found = data.meta.map(m => m.name.toLowerCase());
  const hasTitle = !!data.title;
  html += `<div class="card"><div class="card-title">SEO Checklist</div>`;
  seo.forEach(key => {
    const ok = key === 'title' ? hasTitle : found.includes(key);
    html += `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border)">
      <span>${ok ? '✅' : '❌'}</span>
      <span style="font-size:0.85rem;font-weight:500">${escHtml(key)}</span>
      ${!ok ? '<span style="font-size:0.75rem;color:var(--red);margin-left:auto">Missing</span>' : ''}
    </div>`;
  });
  html += `</div>`;
  el.innerHTML = html;
}

// ── SECURITY TAB ──────────────────────────────────────────
function renderSecurity(data) {
  const el = document.getElementById('tab-security');
  const high   = data.security.filter(f => f.risk === 'high');
  const medium = data.security.filter(f => f.risk === 'medium');
  const low    = data.security.filter(f => f.risk === 'low');
  const info   = data.security.filter(f => f.risk === 'info');

  let html = `<div class="stats-row" style="grid-template-columns:repeat(4,1fr)">
    <div class="stat-card"><div class="stat-val" style="color:var(--red)">${high.length}</div><div class="stat-label">High Risk</div></div>
    <div class="stat-card"><div class="stat-val" style="color:var(--yellow)">${medium.length}</div><div class="stat-label">Medium Risk</div></div>
    <div class="stat-card"><div class="stat-val" style="color:var(--green)">${low.length}</div><div class="stat-label">Low Risk</div></div>
    <div class="stat-card"><div class="stat-val" style="color:var(--accent3)">${info.length}</div><div class="stat-label">Info</div></div>
  </div>`;

  [['high','High Risk Findings'], ['medium','Medium Risk'], ['low','Low Risk'], ['info','Informational']].forEach(([risk, label]) => {
    const items = data.security.filter(f => f.risk === risk);
    if (!items.length) return;
    html += `<div class="section-title" style="margin-top:20px">${escHtml(label)} <span class="count-pill">${items.length}</span></div>`;
    items.forEach(f => {
      html += `<div class="flag-item risk-${escHtml(risk)}">
        <div class="flag-icon">${f.icon}</div>
        <div class="flag-body">
          <div class="flag-title">${escHtml(f.title)}</div>
          <div class="flag-desc">${escHtml(f.desc)}</div>
        </div>
        <span class="risk-badge ${escHtml(risk)}">${escHtml(risk)}</span>
      </div>`;
    });
  });
  el.innerHTML = html;
}

// ── TECH TAB ──────────────────────────────────────────────
function renderTech(data) {
  const el = document.getElementById('tab-tech');
  if (!data.tech.length) { el.innerHTML = emptyState('No technologies fingerprinted'); return; }

  const cats = {};
  data.tech.forEach(t => { (cats[t.cat] = cats[t.cat] || []).push(t); });

  let html = '';
  Object.entries(cats).forEach(([cat, items]) => {
    html += `<div class="section-title" style="margin-top:16px">${escHtml(cat)} <span class="count-pill">${items.length}</span></div>`;
    html += `<div class="tech-grid">`;
    items.forEach(t => {
      html += `<div class="tech-item"><div class="tech-icon">${t.icon}</div>
        <div class="tech-info"><div class="tech-name">${escHtml(t.name)}</div><div class="tech-cat">${escHtml(t.cat)}</div></div>
      </div>`;
    });
    html += `</div><br>`;
  });
  el.innerHTML = html;
}

// ── RAW HTML TAB ──────────────────────────────────────────
function renderRaw(data) {
  const el = document.getElementById('tab-raw');
  const preview = escHtml(data.rawHtml.slice(0, 20000));
  el.innerHTML = `
    <div class="raw-html-wrap">
      <div class="raw-html-box" id="rawHtmlBox">${preview}${data.rawHtml.length > 20000 ? '\n\n… (truncated, showing first 20,000 chars)' : ''}</div>
      <button class="copy-raw-btn" onclick="copyText(document.getElementById('rawHtmlBox').textContent, this)">Copy HTML</button>
    </div>`;
}

// ── AI SUMMARY ────────────────────────────────────────────
async function generateAISummary(data, url) {
  const summary = buildAISummary(data, url);
  typewriterEffect(aiSummaryText, summary, 18);
}

function buildAISummary(data, url) {
  const host = (() => { try { return new URL(url).hostname; } catch(_){ return url; }})();
  const highFlags = data.security.filter(f => f.risk === 'high').length;
  const extLinks = data.links.filter(l => l.type === 'external').length;
  const topTech = data.tech.slice(0, 4).map(t => t.name).join(', ') || 'no identifiable frameworks';
  const fontList = data.fonts.slice(0, 3).map(f => f.name).join(', ') || 'system fonts';

  let risk = '✅ No critical security issues detected.';
  if (highFlags >= 3) risk = `🔴 ${highFlags} high-risk security flags found — this site has serious vulnerabilities.`;
  else if (highFlags > 0) risk = `⚠️ ${highFlags} high-risk flag(s) found — review the Security tab carefully.`;

  return `${host} has ${data.links.length} links (${extLinks} external), ${data.images.length} images, ${data.scripts.length} scripts, and ${data.styles.length} stylesheets. Uses ${topTech}. Font stack includes ${fontList}. ${risk} Page size: ${formatBytes(data.charCount)}.`;
}

// ── AI STEP-BY-STEP ───────────────────────────────────────
aiExplainBtn.addEventListener('click', () => {
  const isOpen = !aiStepsPanel.classList.contains('hidden');
  if (isOpen) { aiStepsPanel.classList.add('hidden'); aiExplainBtn.textContent = 'Step-by-Step Explanation ▼'; return; }
  aiStepsPanel.classList.remove('hidden');
  aiExplainBtn.textContent = 'Hide Explanation ▲';
  renderAISteps(analysisData);
});

function renderAISteps(data) {
  const steps = buildAISteps(data);
  aiStepsInner.innerHTML = '';
  steps.forEach((step, i) => {
    const div = document.createElement('div');
    div.className = 'ai-step';
    div.style.animationDelay = `${i * 0.08}s`;
    div.innerHTML = `
      <div class="ai-step-num">${i + 1}</div>
      <div class="ai-step-body">
        <h4>${escHtml(step.title)}</h4>
        <p>${escHtml(step.body)}</p>
      </div>`;
    aiStepsInner.appendChild(div);
  });
}

function buildAISteps(data) {
  const high   = data.security.filter(f => f.risk === 'high');
  const medium = data.security.filter(f => f.risk === 'medium');
  const extScripts = data.scripts.filter(s => s.src && !s.src.startsWith('/'));
  const inlineScripts = data.scripts.filter(s => s.inline);
  const og = data.meta.find(m => m.name === 'og:title')?.content || '';
  const robots = data.meta.find(m => m.name === 'robots')?.content || '';

  return [
    {
      title: `Page Identity & Title`,
      body: `The page title is "${data.title || 'not set'}". ${data.lang ? `Language is set to "${data.lang}".` : 'No language attribute was found on <html>.'} ${data.canonical ? `A canonical URL is declared at ${data.canonical}.` : 'No canonical URL is set — this can hurt SEO in duplicate content scenarios.'}`,
    },
    {
      title: `Link Architecture (${data.links.length} total)`,
      body: `The page contains ${data.links.filter(l=>l.type==='internal').length} internal links, ${data.links.filter(l=>l.type==='external').length} external links, ${data.links.filter(l=>l.type==='mailto').length} email links, and ${data.links.filter(l=>l.type==='anchor').length} anchor links. External links indicate partnerships, CDN usage, or outbound resources.`,
    },
    {
      title: `Images & Media (${data.images.length} found)`,
      body: `${data.images.length} images detected. ${data.images.filter(i=>i.loading==='lazy').length} use lazy loading (good for performance). ${data.images.filter(i=>!i.alt).length} are missing alt text — this affects accessibility and SEO.`,
    },
    {
      title: `JavaScript Layer (${data.scripts.length} scripts)`,
      body: `${extScripts.length} external scripts and ${inlineScripts.length} inline script blocks detected. ${data.scripts.filter(s=>s.async).length} use async and ${data.scripts.filter(s=>s.defer).length} use defer loading (both are good for performance). External scripts are potential attack surfaces if loaded without Subresource Integrity (SRI).`,
    },
    {
      title: `Technology Fingerprint`,
      body: data.tech.length
        ? `Detected ${data.tech.length} technologies: ${data.tech.map(t=>`${t.name} (${t.cat})`).join(', ')}.`
        : `No common framework signatures detected. The site may use custom or proprietary technology, or scripts may be bundled/obfuscated.`,
    },
    {
      title: `Font & Design System`,
      body: data.fonts.length
        ? `${data.fonts.length} font famil${data.fonts.length===1?'y':'ies'} found: ${data.fonts.map(f=>f.name).join(', ')}. Loading fonts from external services (e.g. Google Fonts) adds an external DNS dependency and slight latency.`
        : `No explicit font declarations found. The site likely uses system fonts or fonts are loaded via CSS not accessible to the parser.`,
    },
    {
      title: `SEO & Open Graph`,
      body: `${og ? `Open Graph title: "${og}".` : 'No Open Graph title set — social sharing previews will be limited.'} ${robots ? `Robots directive: "${robots}".` : 'No robots meta tag — search engine bots use default crawl rules.'} The page has ${data.meta.length} total meta tags.`,
    },
    {
      title: `Security Overview (${data.security.length} findings)`,
      body: high.length === 0 && medium.length === 0
        ? `No critical or medium-risk security concerns detected. The site appears to follow standard security practices. Always verify server-side headers (HSTS, X-Frame-Options, etc.) separately, as these cannot be checked from client-side HTML.`
        : `${high.length} high-risk and ${medium.length} medium-risk findings. Key concerns: ${high.map(f=>f.title).concat(medium.map(f=>f.title)).slice(0,4).join('; ')}. Review the Security tab for full details.`,
    },
    {
      title: `Iframe & Embedding`,
      body: data.iframes.length
        ? `${data.iframes.length} iframe(s) found. Sources include: ${data.iframes.map(f=>{ try{ return new URL(f.src).hostname; }catch(_){return f.src.slice(0,40);} }).join(', ')}. Unsandboxed iframes from external domains can run arbitrary JavaScript.`
        : `No iframes found on this page.`,
    },
    {
      title: `What To Do Next`,
      body: `If you're auditing this site: focus first on the high-risk security flags, then verify all external scripts have SRI hashes, check that HTTPS is enforced, and ensure all forms post to trusted domains. For SEO, add missing meta tags and ensure every image has descriptive alt text.`,
    },
  ];
}

// ── TYPEWRITER EFFECT ─────────────────────────────────────
function typewriterEffect(el, text, speed = 20) {
  el.textContent = '';
  let i = 0;
  const t = setInterval(() => {
    el.textContent += text[i++];
    if (i >= text.length) clearInterval(t);
  }, speed);
}

// ── COPY HELPER ───────────────────────────────────────────
window.copyText = function(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    if (btn) { btn.textContent = '✓ Copied'; btn.classList.add('copied'); setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1800); }
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    if (btn) { btn.textContent = '✓ Copied'; setTimeout(() => btn.textContent = 'Copy', 1800); }
  });
};

// ── UTILITIES ─────────────────────────────────────────────
function escHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escAttr(s) { return String(s || '').replace(/'/g,'&#39;').replace(/"/g,'&quot;'); }
function formatBytes(n) { if (n < 1024) return n + ' B'; if (n < 1048576) return (n/1024).toFixed(1) + ' KB'; return (n/1048576).toFixed(2) + ' MB'; }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function tick()   { return new Promise(r => setTimeout(r, 0)); }
function emptyState(msg) { return `<div class="empty-state"><div class="es-icon">🔍</div><p>${escHtml(msg)}</p></div>`; }
