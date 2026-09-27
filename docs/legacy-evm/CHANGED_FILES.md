# Changed files

The uploaded PonsPool source was updated in three source locations:

| File | Change |
| --- | --- |
| `src/App.tsx` | Added BrowserRouter route definitions for `/`, `/launch-pool`, `/buy`, `/how-it-works`, `/docs`, `/terms`, and `/privacy-policy`; added shared footer navigation. |
| `src/components/Navbar.tsx` | Converted the launch and buy controls from in-page tabs to route-aware navigation; added desktop and mobile links for How It Works, Docs, Terms, and Privacy Policy. |
| `src/pages/index.tsx` | Added the dedicated landing, launch-pool, buy, and reusable informational page components. |

Validation completed with `npm run typecheck` and `npm run build`. The production build completed successfully; Vite only reported existing dependency annotation and large-chunk warnings.
