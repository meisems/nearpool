# Success Modal and Landing Activity Update

Successful injections now carry the selected `burn` or `lock` destination in the receipt model. The completion modal presents a destination-specific status, explains whether the position was locked or burned, and includes a direct Robinhood Chain explorer transaction link.

Confirmed injections are persisted in browser storage and broadcast through a same-tab/custom event plus the storage event. The landing-page platform activity feed reads those confirmations and displays them above simulated activity, with a direct transaction link and destination-specific `locked` or `burned` label.

Validation: `npm run build` completed successfully. The build retains only the existing Rollup chunk-size warning.
