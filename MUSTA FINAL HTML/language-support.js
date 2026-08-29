// ============================================================
// MULTI-LANGUAGE SUPPORT FOR UGANDA
// Supports: English, Luganda, Lusoga, Runyankole, Acholi, etc.
// ============================================================

// Current language
let currentLanguage = localStorage.getItem('djmusta_language') || 'en';
let translations = {};
let isTranslationsLoaded = false;

// Available languages
const LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇬🇧', native: 'English' },
  { code: 'lg', name: 'Luganda', flag: '🇺🇬', native: 'Luganda' },
  { code: 'xog', name: 'Lusoga', flag: '🇺🇬', native: 'Lusoga' },
  { code: 'nyn', name: 'Runyankole', flag: '🇺🇬', native: 'Runyankole' },
  { code: 'ach', name: 'Acholi', flag: '🇺🇬', native: 'Acholi' },
  { code: 'lgg', name: 'Lugbara', flag: '🇺🇬', native: 'Lugbara' },
  { code: 'teo', name: 'Ateso', flag: '🇺🇬', native: 'Ateso' }
];

// ============================================================
// LOAD LANGUAGE FILE
// ============================================================

async function loadLanguage(langCode) {
  try {
    // Check if we have basic translations first
    if (!langCode || langCode === 'en') {
      langCode = 'en';
    }

    // Try to fetch translation file
    const response = await fetch(`./translations/${langCode}.json`);

    if (response.ok) {
      translations = await response.json();
      currentLanguage = langCode;
      localStorage.setItem('djmusta_language', langCode);
      isTranslationsLoaded = true;

      // Translate the page
      translatePage();

      return true;
    } else {
      // Fallback to English
      console.warn(`Translation file for ${langCode} not found, using English`);
      if (langCode !== 'en') {
        return loadLanguage('en');
      }
    }
  } catch (error) {
    console.error('Error loading language:', error);
    // Use English as fallback
    if (langCode !== 'en') {
      return loadLanguage('en');
    }
  }

  return false;
}

// ============================================================
// TRANSLATE PAGE
// ============================================================

function translatePage() {
  if (!isTranslationsLoaded || !translations) {
    console.warn('Translations not loaded yet');
    return;
  }

  // Translate all elements with data-translate attribute
  document.querySelectorAll('[data-translate]').forEach(element => {
    const key = element.getAttribute('data-translate');
    const translation = translations[key];

    if (translation) {
      // Check if it's a placeholder
      if (element.placeholder !== undefined) {
        element.placeholder = translation;
      }
      // Check if it's a value (input)
      else if (element.value !== undefined && element.type !== 'text' && element.type !== 'search') {
        element.value = translation;
      }
      // Check if it's a title/tooltip
      else if (element.title) {
        element.title = translation;
      }
      // Regular text content
      else {
        element.textContent = translation;
      }
    }
  });

  // Update HTML lang attribute
  document.documentElement.lang = currentLanguage;

  console.log(`✓ Page translated to ${currentLanguage}`);
}

// ============================================================
// GET TRANSLATION
// ============================================================

function t(key, fallback = key) {
  if (!translations || !translations[key]) {
    return fallback;
  }
  return translations[key];
}

// ============================================================
// SHOW LANGUAGE SELECTOR
// ============================================================

function showLanguageSelector() {
  // Remove existing modal if open
  document.getElementById('langSelectorModal')?.remove();

  const languageButtons = LANGUAGES.map(lang => {
    const isActive = lang.code === currentLanguage;
    return `
      <button onclick="changeLanguage('${lang.code}')"
              style="display:flex;align-items:center;gap:12px;width:100%;padding:14px 16px;border-radius:10px;background:${isActive ? 'rgba(168,85,247,0.1)' : 'transparent'};border:2px solid ${isActive ? 'var(--pink,#a855f7)' : 'rgba(255,255,255,0.1)'};cursor:pointer;transition:all 0.2s;margin-bottom:8px;color:inherit;font-family:inherit">
        <span style="font-size:28px">${lang.flag}</span>
        <div style="text-align:left;flex:1">
          <div style="font-size:16px;font-weight:700;color:${isActive ? 'var(--pink,#a855f7)' : 'var(--text,#f1f5f9)'}">${lang.native}</div>
          <div style="font-size:12px;color:var(--muted,#94a3b8)">${lang.name}</div>
        </div>
        ${isActive ? '<span style="color:var(--pink,#a855f7);font-size:20px">✓</span>' : ''}
      </button>
    `;
  }).join('');

  const modal = document.createElement('div');
  modal.id = 'langSelectorModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:10001;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div style="background:var(--card,#1e293b);padding:30px;border-radius:20px;max-width:450px;width:100%;position:relative;max-height:90vh;overflow-y:auto">
      <button onclick="document.getElementById('langSelectorModal').remove()" style="position:absolute;top:12px;right:14px;font-size:22px;background:none;border:none;cursor:pointer;color:var(--muted,#94a3b8)">✕</button>
      <h2 style="font-size:24px;font-weight:800;margin-bottom:8px;text-align:center">
        🌍 ${t('select_language', 'Select Language')}
      </h2>
      <p style="color:var(--muted,#94a3b8);text-align:center;margin-bottom:24px;font-size:14px">
        Choose your preferred language
      </p>
      <div style="max-height:380px;overflow-y:auto">
        ${languageButtons}
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

// ============================================================
// CHANGE LANGUAGE
// ============================================================

async function changeLanguage(langCode) {
  // Show loading
  if (typeof showToast === 'function') {
    showToast(t('loading', 'Loading...'), '🔄');
  }

  // Load new language
  const success = await loadLanguage(langCode);

  if (success) {
    // Close modal
    document.getElementById('langSelectorModal')?.remove();

    // Show success message
    if (typeof showToast === 'function') {
      showToast(t('language_changed', 'Language changed!'), '✅');
    }

    // Reload songs with new language (if function exists)
    if (typeof loadSongs === 'function') {
      loadSongs();
    }
  }
}

// ============================================================
// GET CURRENT LANGUAGE INFO
// ============================================================

function getCurrentLanguageInfo() {
  return LANGUAGES.find(lang => lang.code === currentLanguage) || LANGUAGES[0];
}

// ============================================================
// INITIALIZE LANGUAGE ON PAGE LOAD
// ============================================================

async function initializeLanguage() {
  // Get saved language or detect from browser
  let langCode = localStorage.getItem('djmusta_language');

  if (!langCode) {
    // Try to detect from browser
    const browserLang = navigator.language || navigator.userLanguage;

    // Check if it's a supported language
    if (browserLang.startsWith('lg')) langCode = 'lg'; // Luganda
    else langCode = 'en'; // Default to English
  }

  // Load language
  await loadLanguage(langCode);

  console.log(`✓ Language initialized: ${langCode}`);
}

// ============================================================
// AUTO-INITIALIZE
// ============================================================

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeLanguage);
} else {
  initializeLanguage();
}

// ============================================================
// EXPORT FUNCTIONS
// ============================================================

if (typeof window !== 'undefined') {
  window.LANGUAGES = LANGUAGES;
  window.currentLanguage = currentLanguage;
  window.loadLanguage = loadLanguage;
  window.translatePage = translatePage;
  window.changeLanguage = changeLanguage;
  window.showLanguageSelector = showLanguageSelector;
  window.getCurrentLanguageInfo = getCurrentLanguageInfo;
  window.t = t;
}
