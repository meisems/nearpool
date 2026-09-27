# V3 Access and Final Destination Confirmation Fix

V3 is now selectable for every valid token address; it is no longer disabled merely because live V3 pool discovery has not returned an existing pool. V3 pool discovery remains informational and reports detected fee tiers when available. V4 is likewise selectable for a valid token address, allowing the selected launch route to handle initialization.

The lock-or-burn selector has been moved from the upper form area to the final confirmation section immediately before the injection button. The final copy states that the destination choice cannot be changed after injection and distinguishes permanent locking from irreversible burning.

Validation: `npm run build` completed successfully. Only the pre-existing Rollup chunk-size warning remains.
