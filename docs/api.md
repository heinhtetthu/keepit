# API

## Base URL

```
/api/v1
```

## Authentication

All protected endpoints require a Bearer token:

```
Authorization: Bearer <access_token>
```

## Endpoints

### Auth
- `POST /api/v1/auth/login` - Login
- `POST /api/v1/auth/refresh` - Refresh token
- `GET /api/v1/auth/me` - Current user
- `POST /api/v1/auth/logout` - Logout

### Users
- `GET /api/v1/users` - List users
- `POST /api/v1/users` - Create user
- `GET /api/v1/users/{id}` - Get user
- `PUT /api/v1/users/{id}` - Update user
- `DELETE /api/v1/users/{id}` - Delete user

### Record Types
- `GET /api/v1/record-types` - List record types
- `POST /api/v1/record-types` - Create record type
- `GET /api/v1/record-types/{id}` - Get record type
- `PUT /api/v1/record-types/{id}` - Update record type
- `DELETE /api/v1/record-types/{id}` - Delete record type

### Records
- `GET /api/v1/records/by-type/{type_id}` - List records
- `POST /api/v1/records/by-type/{type_id}` - Create record
- `GET /api/v1/records/{id}` - Get record
- `PUT /api/v1/records/{id}` - Update record
- `POST /api/v1/records/{id}/archive` - Archive record
- `DELETE /api/v1/records/{id}` - Delete record

### Reminders
- `GET /api/v1/reminders/rules` - List rules
- `POST /api/v1/reminders/rules` - Create rule
- `GET /api/v1/reminders/logs` - Notification history
- `GET /api/v1/reminders/recipients` - List recipients

### Reports
- `GET /api/v1/reports/{type_id}/excel` - Export Excel
- `GET /api/v1/reports/{type_id}/pdf` - Export PDF

### Audit
- `GET /api/v1/audit-logs` - List audit logs

### Health
- `GET /api/v1/health` - Health check
- `GET /api/v1/health/ready` - Readiness check

## Pagination

```
?page=1&page_size=25&search=query&sort=name&order=asc
```

## Error Format

```json
{
  "error": {
    "code": "RECORD_NOT_FOUND",
    "message": "The requested record was not found.",
    "details": null
  }
}
```
