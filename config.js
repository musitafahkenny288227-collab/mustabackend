'use strict';

const REQUIRED_ENV = ['JWT_SECRET', 'DATABASE_URL', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY', 'R2_SECRET_KEY'];

const config = {
  PORT: process.env.PORT || 5000,
  JWT_SECRET: process.env.JWT_SECRET,
  FRONTEND_URL: process.env.FRONTEND_URL || 'https://djmusta.com',
  DATABASE_URL: process.env.DATABASE_URL,
  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
  R2_ACCESS_KEY: process.env.R2_ACCESS_KEY,
  R2_SECRET_KEY: process.env.R2_SECRET_KEY,
  R2_BUCKET: process.env.R2_BUCKET || 'djmusta-music',
  R2_PUBLIC_URL: process.env.R2_PUBLIC_URL || 'https://pub-1004f9c2790e44689198e9849c00fb9b.r2.dev',
  SITE_URL: process.env.SITE_URL || 'https://djmusta.com',
  VAPID_PUBLIC: process.env.VAPID_PUBLIC_KEY || 'BAonU5h2RMD7db5Zl3gGS_01GfXP0_tevIWydLGXvX4JTJOWpkku-ag-be63rkPoGCs9CSka6y--ktyq-kJvYxw',
  VAPID_EMAIL: process.env.VAPID_EMAIL || 'mailto:musitafahkenny288227@gmail.com',
  BREVO_API_KEY: process.env.BREVO_API_KEY || '',
  EMAIL_USER: process.env.EMAIL_USER || 'musitafahkenny288227@gmail.com',
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',
  INDEXNOW_KEY: process.env.INDEXNOW_KEY || 'djmusta2026'
};

config.missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);

module.exports = config;
