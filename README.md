# the-enjoye-website

Marketing site for **Enjoye** — a modern lifestyle brand crafting curated
experiences, thoughtful products, and moments worth remembering.

Built with [Next.js 16](https://nextjs.org) (App Router), React 19, TypeScript,
and Tailwind CSS 4.

## Getting started

```bash
npm ci        # install dependencies (uses package-lock.json)
npm run dev    # start the dev server on http://localhost:3000
```

Then open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command         | Description                                  |
| --------------- | -------------------------------------------- |
| `npm run dev`   | Start the development server (Turbopack)     |
| `npm run build` | Create an optimized production build         |
| `npm run start` | Serve the production build                   |
| `npm run lint`  | Run ESLint                                   |

## Project structure

```
src/app/
  layout.tsx            Root layout + metadata
  page.tsx              Landing page (hero, features, community, join)
  newsletter.tsx        Client component for the email signup form
  api/subscribe/route.ts  API route backing the newsletter form
  globals.css           Design tokens + Tailwind theme
```

## API

- `POST /api/subscribe` — accepts `{ "email": string }`, validates it, and
  returns a confirmation message. Backs the newsletter signup on the landing
  page.
