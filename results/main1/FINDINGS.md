1. **Up to 10k tools, catalog size barely matters; at 200k it does.** Success was 85% / 80% / 30% at
   N = 100 / 10k / 200k with k = 3, and 85% / 85% / 60% with k = 10. With k = 3, 11 of 20 tasks
   passed at N=100 and failed at 200k, and none went the other way (exact McNemar p = 0.001; this
   survives a Bonferroni correction for the 5 comparisons). With k = 10 the drop is 7 vs 2 flips (p
   = 0.18): likely real, not shown with 20 tasks.

2. **With few results per search (k = 3), the loss is in search, not in the model.** Recall fell
   100% → 85% → 45%; 11 of the 14 failures at 200k / k=3 are the target never reaching the agent,
   even though the agent rephrased and searched again (see the failure table). The embedding search
   can't tell the right tool from hundreds of similar ones in 3 slots.

3. **More results (k = 10) fix search but expose a choice problem.** At 200k, recall rose from 45%
   to 90%, but when the target was delivered the agent picked it only 67% of the time. All 6 wrong
   picks at 200k / k=10 were near-twins from the **same vendor**: another edition (`daybay_v2` for
   "Daybay", `crmbay` for "Crmbay EU", `staffwise_v2` for "Staffwise") or another form of the same
   tool (`by_id` when the prompt gives a URL, `create_calendar` without the visibility variant).
   Trials whose target had 6–20 same-vendor look-alikes in the catalog succeeded 47% of the time vs
   83–85% with ≤ 5.

4. **Two-step tasks were not clearly harder** (chain 83%, cross-app 67%, single 69%; the intervals
   overlap and only 5 two-step tasks ran). The agent reliably carried the created id into the second
   call; when two-step tasks failed, it was for the same reasons as single ones, at 200k.

5. **A librarian (a second model that searches for the agent) did not clearly help, and cost ~2.5×
   more.** At 200k, success was 45% vs 30% with k = 3 (5 tasks gained, 2 lost; p = 0.45) and 55% vs
   60% with k = 10 (1 gained, 2 lost). It used 2.3–2.6× the model calls and ~2.5× the time per
   trial. Why it didn't pay off:
   - It barely used its one real advantage, filtered search: 19 of 219 searches had a filter (when
     it filtered by app it always picked the right app, so filtering itself works).
   - It handed back far fewer tools than allowed (1.8 of 3, 3.2 of 10 on average), so a larger k was
     mostly wasted: recall at k = 10 was 80% vs 90% for plain search.
   - When the target did arrive, the worker still picked the same same-vendor near-twins (t007 fails
     identically in both modes). The obvious next change is making the librarian filter by app by
     default and return the full k, not a different model.

6. **A fast local re-ranker didn't help either, even though offline it looked like it would.**
   Replaying the agent's recorded searches offline, a 22M-parameter cross-encoder (MiniLM, ~50 ms
   per search on a laptop CPU, no LLM, $0) lifted "right tool in the top 3" at 200k from 60% to 76%
   (`rerank-offline-direct.csv`; bge-m3 reached 80% at 1 s per search, bge-base made it worse).
   Live, recall rose (45% → 60% at k = 3) but success did not: 30% vs 30% at k = 3 (2 gained, 2
   lost) and 42% vs 60% at k = 10 (1 gained, 4 lost; p = 0.38, within noise). The trials it lost
   were the same near-twin picks as before (`staffwise_v2` for "Staffwise", by-id for a URL,
   `taskforge` for "Taskforge Enterprise").

**What 4–6 add up to:** at 200k tools, getting the right tool _into_ the agent's hands is mostly
solved by k = 10 (90% recall); what's left is the agent choosing among same-vendor near-twins it was
handed, and no retrieval change (librarian or re-ranker) moves that. The next lever is the choice
itself: a stronger worker model, or tool names/descriptions that make twins easier to tell apart.

**Caveats, read before quoting numbers.**

- **One repeat per setting.** A task can pass or fail on a rerun of the same setting (the model is
  sampled), so single flips between methods include that noise; none of the method comparisons at
  200k is significant. Only the catalog-size effect at k = 3 (finding 1) clears the bar.
- **Harness artifact at N=100.** In 5 of the 40 N=100 trials the target _was_ delivered but the
  model said the tool was "not available" and gave up (t002, t005, t013 ×2, t015). Our side had
  registered the tool; the model apparently tried before Claude Code refreshed its tool list. It
  happened in 0 of 80 trials at larger N. This makes N=100 look worse than it is, so the drop to
  200k is, if anything, understated.
- One model (Claude Haiku 4.5, through Claude Code's agent loop), 20 tasks, librarian and re-ranker
  tested only at N=200k, synthetic tools. The shape of the curve is the result; the absolute rates
  depend on the model and loop.
- t007 ("… on Daybay") failed the same way at every N ≥ 10k (always picked Daybay v2), so it alone
  contributes 4 of the 11 wrong-tool failures. That is a real confusion, but one task, so weigh it
  that way.
- The re-ranker arm has 39 of 40 trials: the 40th (t035, k = 10) hit a harness error when the local
  Docker engine froze, and was dropped rather than counted as a failure.
