# Footer-only informational links

Removed the floating desktop and mobile reference navigation bars from `src/components/Navbar.tsx`.

The routes remain available and the footer in `src/App.tsx` still contains links to:

- How It Works
- Docs
- Terms
- Privacy Policy

The primary header navigation continues to show only the main product actions: Launch Pool and Buy $PonsPool.

Validation: `npm run typecheck` passed and `npm run build` completed successfully. Existing dependency annotation and large-chunk warnings remain unchanged.
