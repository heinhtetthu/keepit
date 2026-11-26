# Mobile app (planned)

Not built yet. The rest of the repo is ready for it:

* **API:** every feature is a REST endpoint. Log in with `POST /api/v1/auth/login` (omit the `X-Renewly-Client: browser` header so the refresh token comes back in the body), then refresh with `POST /api/v1/auth/refresh {"refresh_token": …}`. Passkeys work through `/auth/passkey/*`.
* **Shared code:** `@workspace/core` has no DOM dependency. In an Expo app:

```ts
import * as SecureStore from 'expo-secure-store'
import { createApi, createFetchTransport, CoreProvider } from '@workspace/core'

const tokens = {
  getAccess: () => SecureStore.getItemAsync('access'), setAccess: (t) => t ? SecureStore.setItemAsync('access', t) : SecureStore.deleteItemAsync('access'),
  getRefresh: () => SecureStore.getItemAsync('refresh'), setRefresh: (t) => t ? SecureStore.setItemAsync('refresh', t) : SecureStore.deleteItemAsync('refresh'),
}
const api = createApi(createFetchTransport('https://app.example.com/api/v1', tokens))
// <QueryClientProvider><CoreProvider api={api}>…</CoreProvider></QueryClientProvider>
// then useAssets(), useAsset(id), useBorrows(), useEmployeeOverview(id)… exactly as on web.
```

* **Good first screens:** scan an asset QR code (it encodes `/assets/{id}`) → asset detail → log repair/maintenance/borrow; my assets; expiring renewals.
* **Push notifications:** add an Expo push channel next to Telegram in `apps/api/app/services/notification.py`.
