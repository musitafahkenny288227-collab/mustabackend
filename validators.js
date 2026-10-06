function sanitizeText(value, maxLength = 100) {
  if (value === null || value === undefined) return '';
  const cleaned = String(value).trim().replace(/\s+/g, ' ');
  return cleaned.slice(0, maxLength);
}

function normalizeEmail(value) {
  return sanitizeText(value, 254).toLowerCase();
}

function validatePassword(password) {
  return typeof password === 'string' && password.trim().length >= 6 && password.trim().length <= 128;
}

function validateUsername(username) {
  const cleaned = sanitizeText(username, 50);
  return cleaned.length >= 3 && cleaned.length <= 50 && /^[a-zA-Z0-9_]+$/.test(cleaned);
}

function normalizeName(value, maxLength = 120) {
  return sanitizeText(value, maxLength);
}

module.exports = {
  sanitizeText,
  normalizeEmail,
  validatePassword,
  validateUsername,
  normalizeName
};
