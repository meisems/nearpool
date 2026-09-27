# V3 permanent-burn fix

The V3 launch flow no longer offers or uses a locker destination. When the V3 engine is selected, the destination state is forced to `burn`, the UI hides the V4 lock/burn selector, and the router receives the permanent burn address for every `injectV3` call.

V4 behavior is unchanged: V4 still shows the lock-forever and burn-position choices and routes the selected recipient to the configured V4 locker or burn address.

The V3 fee-tier issue was also guarded: when V3 pool discovery finds a live pool, the selected fee tier is synchronized to that pool before submission. This prevents an `injectV3` call against a different uninitialized fee tier, which can surface in the wallet as an unknown rejection.

Validation: `npm run typecheck` passed and `npm run build` completed successfully. The build retains existing dependency annotation and large-chunk warnings only.
