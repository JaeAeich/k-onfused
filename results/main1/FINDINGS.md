- **Catalog size only matters at the top end.** Success holds at 80–85% up to 10k tools, then drops
  to 30% with 3 tools per search and 60% with 10 at 200k. With 3 per search, 11 tasks went from pass
  to fail between 100 and 200k tools and none went the other way (p = 0.001).
- **Two different failures.** With 3 per search the right tool often never reaches the agent (45%
  delivered at 200k). With 10 it arrives 90% of the time, but the agent then picks a near-identical
  tool from the same vendor about a third of the time: `daybay_v2` for "Daybay", or the by-id tool
  when the prompt gives a URL.
- **Better search didn't help.** A librarian model cost 2.5× the calls and time, and a local
  re-ranker moved the right tool into the top 3 for 76% of searches offline (up from 60%). Neither
  changed success, because what's left is choosing between twins, not finding the tool.
- **Two-step tasks weren't harder** than single ones.

One model, 20 tasks, one run per setting, synthetic tools: only the catalog-size drop is
statistically solid. At 100 tools, 5 of 40 trials failed because Claude Code hadn't picked up a tool
it had just been given, so those numbers are slightly low. One re-ranker trial hit a harness error
and was dropped.
