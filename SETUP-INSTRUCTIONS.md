# DJ Musta Backend - Setup Instructions

## Install Dependencies

Run this command in the `backend` folder:

```bash
npm install bcrypt jsonwebtoken
```

Or if npm is blocked, try:
```bash
yarn add bcrypt jsonwebtoken
```

## Database Setup

1. Go to your Supabase SQL Editor
2. Run the SQL file: `users-schema.sql`
3. This will create:
   - `users` table (for authentication)
   - `user_favorites` table (for liked songs)
   - `user_playlists` table
   - `playlist_songs` table
   - `user_listening_history` table

## Environment Variables

Make sure these are set in your `.env` or Render environment:

```
JWT_SECRET=your-secret-key-here-at-least-32-characters-long
DATABASE_URL=your-supabase-connection-string
```

## Test the API

After setup, test the authentication endpoints:

### Register a new user:
```bash
POST /api/auth/register
Content-Type: application/json

{
  "email": "test@example.com",
  "username": "testuser",
  "password": "password123",
  "fullName": "Test User"
}
```

### Login:
```bash
POST /api/auth/login
Content-Type: application/json

{
  "identifier": "testuser",
  "password": "password123"
}
```

### Get current user (requires token):
```bash
GET /api/auth/me
Authorization: Bearer your-jwt-token-here
```

## Features Implemented

✅ User registration with email/password
✅ User login with email or username
✅ JWT token authentication
✅ Password hashing with bcrypt
✅ Rate limiting on auth endpoints
✅ User profile management
✅ Favorites/likes system
✅ Playlists system
✅ Listening history tracking
