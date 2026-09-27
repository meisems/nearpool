Browser verification findings (Sep 05, 2026):

- The Vite dev server is running on http://localhost:3000/ (not port 5173).
- The landing page renders with the splash loader, top navigation, hero, platform activity, how-the-pond-works section, docs/how-it-works CTA cards, and footer links.
- The route-aware navigation visibly includes launch pool, buy $ponspool, how it works, docs, terms, and privacy policy.
- The browser extracted the expected landing-page copy without a runtime error.
- The first attempted URL, http://localhost:5173/, was refused because Vite selected port 3000; this was corrected by opening http://localhost:3000/.

The dedicated /launch-pool route rendered the creator terminal, launch-flow guidance, buy CTA, and requested reference links. The dedicated /buy route rendered the native swap card, $PONSPOOL context panel, how-it-works link, and requested reference links. Both routes loaded without browser runtime errors.

The /how-it-works route rendered four numbered walkthrough sections with anchor navigation and links back to Launch pool and Buy. The /docs route rendered product surfaces, holder tier, network/routing, sandbox mode, and safety checklist sections with anchor navigation. Both informational routes displayed the requested top tabs and footer links without runtime errors.

The /terms route rendered the intended-use, custody, acceptable-use, third-party-network, and changes sections. The /privacy-policy route rendered wallet/transaction data, local preferences, service providers, data choices, and contact/update sections. Both routes included anchor navigation, top tabs, and footer links, with no runtime errors observed.
