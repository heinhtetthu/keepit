# Frontend

## Stack

- React 18
- TypeScript
- Vite
- Tailwind CSS
- TanStack Query
- React Router
- Zustand (auth state)

## Structure

```
apps/web/
├── src/
│   ├── components/    # UI components
│   │   ├── ui/        # Base UI primitives
│   │   ├── DynamicForm.tsx
│   │   ├── DynamicTable.tsx
│   │   └── Layout.tsx
│   ├── pages/         # Route pages
│   ├── store/         # Zustand stores
│   ├── lib/           # API client, utils
│   └── types/         # TypeScript types
├── public/
└── package.json
```

## Running Locally

```bash
cd apps/web
npm install
npm run dev
```

The dev server proxies `/api` to the backend at `http://localhost:8000`.
