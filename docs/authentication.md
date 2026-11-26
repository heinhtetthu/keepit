# Authentication

## Flow

1. User submits email/password to `POST /api/v1/auth/login`
2. Backend verifies credentials (Argon2 hashed)
3. Backend returns access token + refresh token
4. Frontend stores tokens in localStorage
5. Subsequent requests include `Authorization: Bearer <token>`
6. Backend validates token and checks permissions

## Token Types

- **Access Token**: Short-lived (24h), used for API requests
- **Refresh Token**: Long-lived (30d), used to obtain new access tokens

## Password Security

- Argon2id hashing via `passlib`
- Minimum 8 characters
- Never stored in plaintext
