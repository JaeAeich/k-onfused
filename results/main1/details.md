# Details: `main1`

Percentages in parentheses are 95% Wilson intervals. `p` is an exact McNemar test on the tasks that
pass in one setting and fail in the other.

## Catalog size

Success:

| tools | k=3 | k=10 |
|---|---|---|
| 100 | 85% (64–95) | 85% (64–95) |
| 10k | 80% (58–92) | 85% (64–95) |
| 200k | 30% (15–52) | 60% (39–78) |

Right tool delivered to the agent:

| tools | k=3 | k=10 |
|---|---|---|
| 100 | 100% (84–100) | 100% (84–100) |
| 10k | 85% (64–95) | 90% (70–97) |
| 200k | 45% (26–66) | 90% (70–97) |

Right tool picked, when it was delivered:

| tools | k=3 | k=10 |
|---|---|---|
| 100 | 85% (64–95) | 85% (64–95) |
| 10k | 94% (73–99) | 94% (74–99) |
| 200k | 67% (35–88) | 67% (44–84) |

Same task in two settings:

| fixed | change | pass both | only before | only after | fail both | p |
|---|---|---|---|---|---|---|
| k=3 | N 100 → 200k | 6 | 11 | 0 | 3 | 0.001 |
| k=10 | N 100 → 200k | 10 | 7 | 2 | 1 | 0.180 |
| N=100 | k 3 → 10 | 15 | 2 | 2 | 1 | 1.000 |
| N=10k | k 3 → 10 | 16 | 0 | 1 | 3 | 1.000 |
| N=200k | k 3 → 10 | 5 | 1 | 7 | 7 | 0.070 |

## Search methods

Per trial averages. The price is what Claude Code reports the trial would cost at API prices (nothing is billed on a subscription). The re-ranker took about 56 ms per search on CPU.

| setting | method | n | success | delivered | picked when delivered | model calls | input tokens | seconds | price |
|---|---|---|---|---|---|---|---|---|---|
| k=3 | direct | 20 | 30% (15–52) | 45% | 67% | 6.5 | 20k | 16 | $0.026 |
| k=3 | re-ranker | 20 | 30% (15–52) | 60% | 50% | 5.8 | 17k | 16 | $0.023 |
| k=3 | librarian | 20 | 45% (26–66) | 55% | 82% | 16.6 | 37k | 42 | $0.056 |
| k=10 | direct | 20 | 60% (39–78) | 90% | 67% | 6.2 | 27k | 16 | $0.035 |
| k=10 | re-ranker | 19 | 42% (23–64) | 79% | 53% | 5.7 | 24k | 14 | $0.032 |
| k=10 | librarian | 20 | 55% (34–74) | 80% | 69% | 14.4 | 38k | 37 | $0.057 |

Each method against direct, task by task:

| setting | method | pass both | only direct | only method | fail both | p |
|---|---|---|---|---|---|---|
| k=3 | re-ranker | 4 | 2 | 2 | 12 | 1.000 |
| k=3 | librarian | 4 | 2 | 5 | 9 | 0.453 |
| k=10 | re-ranker | 7 | 4 | 1 | 7 | 0.375 |
| k=10 | librarian | 10 | 2 | 1 | 7 | 1.000 |

## How trials ended (direct · claude-haiku-4-5)

![How trials ended](figures/outcomes-direct-claude-haiku-4-5.svg)

| tools | k | n | pass | retrieval miss | wrong tool | bad args | hallucinated tool | gave up | step limit |
|---|---|---|---|---|---|---|---|---|---|
| 100 | 3 | 20 | 17 | 0 | 0 | 0 | 0 | 3 | 0 |
| 100 | 10 | 20 | 17 | 0 | 0 | 0 | 0 | 3 | 0 |
| 10k | 3 | 20 | 16 | 3 | 1 | 0 | 0 | 0 | 0 |
| 10k | 10 | 20 | 17 | 2 | 1 | 0 | 0 | 0 | 0 |
| 200k | 3 | 20 | 6 | 11 | 3 | 0 | 0 | 0 | 0 |
| 200k | 10 | 20 | 12 | 2 | 6 | 0 | 0 | 0 | 0 |

## How trials ended (query_agent · claude-haiku-4-5)

![How trials ended](figures/outcomes-query-agent-claude-haiku-4-5.svg)

| tools | k | n | pass | retrieval miss | wrong tool | bad args | hallucinated tool | gave up | step limit |
|---|---|---|---|---|---|---|---|---|---|
| 200k | 3 | 20 | 9 | 9 | 2 | 0 | 0 | 0 | 0 |
| 200k | 10 | 20 | 11 | 4 | 5 | 0 | 0 | 0 | 0 |

## How trials ended (rerank · claude-haiku-4-5)

![How trials ended](figures/outcomes-rerank-claude-haiku-4-5.svg)

| tools | k | n | pass | retrieval miss | wrong tool | bad args | hallucinated tool | gave up | step limit |
|---|---|---|---|---|---|---|---|---|---|
| 200k | 3 | 20 | 6 | 8 | 6 | 0 | 0 | 0 | 0 |
| 200k | 10 | 19 | 8 | 4 | 6 | 0 | 0 | 1 | 0 |

## By task kind

| kind | n | success | delivered | picked when delivered | parts done |
|---|---|---|---|---|---|
| single | 150 | 59% (51–66) | 78% | 75% | 59% |
| chain | 29 | 69% (51–83) | 83% | 83% | 71% |
| cross_app | 20 | 55% (34–74) | 75% | 73% | 78% |

## By look-alikes

Other tools in the trial's catalog with the same resource and action as the target, e.g. every
"delete job posting" tool. This grows with catalog size, so it overlaps with that effect.

| look-alikes | n | success | delivered | picked when delivered | parts done |
|---|---|---|---|---|---|
| 0 | 30 | 80% (63–90) | 100% | 80% | 82% |
| 1–5 | 10 | 100% (72–100) | 100% | 100% | 100% |
| 6–20 | 20 | 70% (48–85) | 80% | 88% | 70% |
| 21–100 | 20 | 95% (76–99) | 95% | 100% | 95% |
| >100 | 119 | 44% (35–53) | 68% | 64% | 47% |

Counting only the same vendor (other editions, other id forms):

| same vendor | n | success | delivered | picked when delivered | parts done |
|---|---|---|---|---|---|
| 0 | 60 | 83% (72–91) | 93% | 89% | 84% |
| 1–5 | 20 | 85% (64–95) | 95% | 89% | 85% |
| 6–20 | 107 | 45% (36–54) | 68% | 66% | 49% |
| 21–100 | 12 | 33% (14–61) | 67% | 50% | 33% |

## Every task

✓ pass · RM retrieval miss · WT wrong tool · BA bad args · HT hallucinated tool · GU gave up ·
SL step limit · ERR error

**direct · claude-haiku-4-5**

| task | kind | 100 k3 | 100 k10 | 10k k3 | 10k k10 | 200k k3 | 200k k10 | pass |
|---|---|---|---|---|---|---|---|---|
| t001 | single | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6/6 |
| t002 | single | GU | ✓ | ✓ | ✓ | RM | ✓ | 4/6 |
| t003 | single | ✓ | ✓ | ✓ | ✓ | ✓ | WT | 5/6 |
| t004 | single | ✓ | ✓ | ✓ | ✓ | RM | ✓ | 5/6 |
| t005 | single | ✓ | GU | RM | RM | ✓ | ✓ | 3/6 |
| t006 | single | ✓ | ✓ | RM | RM | WT | WT | 2/6 |
| t007 | single | ✓ | ✓ | WT | WT | WT | WT | 2/6 |
| t008 | single | ✓ | ✓ | ✓ | ✓ | RM | RM | 4/6 |
| t009 | single | ✓ | ✓ | ✓ | ✓ | RM | RM | 4/6 |
| t010 | single | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6/6 |
| t011 | single | ✓ | ✓ | ✓ | ✓ | RM | ✓ | 5/6 |
| t012 | single | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6/6 |
| t013 | single | GU | GU | RM | ✓ | RM | ✓ | 2/6 |
| t014 | single | ✓ | ✓ | ✓ | ✓ | RM | ✓ | 5/6 |
| t015 | single | ✓ | GU | ✓ | ✓ | RM | WT | 3/6 |
| t031 | chain | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6/6 |
| t032 | cross_app | GU | ✓ | ✓ | ✓ | RM | WT | 3/6 |
| t033 | chain | ✓ | ✓ | ✓ | ✓ | RM | WT | 4/6 |
| t034 | cross_app | ✓ | ✓ | ✓ | ✓ | WT | ✓ | 5/6 |
| t035 | chain | ✓ | ✓ | ✓ | ✓ | RM | ✓ | 5/6 |

**query_agent · claude-haiku-4-5**

| task | kind | 200k k3 | 200k k10 | pass |
|---|---|---|---|---|
| t001 | single | ✓ | ✓ | 2/2 |
| t002 | single | RM | WT | 0/2 |
| t003 | single | RM | RM | 0/2 |
| t004 | single | ✓ | ✓ | 2/2 |
| t005 | single | RM | ✓ | 1/2 |
| t006 | single | RM | RM | 0/2 |
| t007 | single | WT | WT | 0/2 |
| t008 | single | RM | WT | 0/2 |
| t009 | single | WT | WT | 0/2 |
| t010 | single | ✓ | ✓ | 2/2 |
| t011 | single | ✓ | ✓ | 2/2 |
| t012 | single | ✓ | ✓ | 2/2 |
| t013 | single | RM | ✓ | 1/2 |
| t014 | single | ✓ | ✓ | 2/2 |
| t015 | single | RM | ✓ | 1/2 |
| t031 | chain | ✓ | ✓ | 2/2 |
| t032 | cross_app | ✓ | RM | 1/2 |
| t033 | chain | RM | WT | 0/2 |
| t034 | cross_app | ✓ | ✓ | 2/2 |
| t035 | chain | RM | RM | 0/2 |

**rerank · claude-haiku-4-5**

| task | kind | 200k k3 | 200k k10 | pass |
|---|---|---|---|---|
| t001 | single | ✓ | WT | 1/2 |
| t002 | single | WT | WT | 0/2 |
| t003 | single | RM | ✓ | 1/2 |
| t004 | single | RM | ✓ | 1/2 |
| t005 | single | ✓ | ✓ | 2/2 |
| t006 | single | RM | RM | 0/2 |
| t007 | single | WT | WT | 0/2 |
| t008 | single | RM | RM | 0/2 |
| t009 | single | WT | WT | 0/2 |
| t010 | single | ✓ | ✓ | 2/2 |
| t011 | single | ✓ | ✓ | 2/2 |
| t012 | single | WT | ✓ | 1/2 |
| t013 | single | RM | RM | 0/2 |
| t014 | single | RM | ✓ | 1/2 |
| t015 | single | WT | WT | 0/2 |
| t031 | chain | ✓ | ✓ | 2/2 |
| t032 | cross_app | RM | GU | 0/2 |
| t033 | chain | WT | WT | 0/2 |
| t034 | cross_app | RM | RM | 0/2 |
| t035 | chain | ✓ |  | 1/1 |

## Failures

| task | method | tools | k | outcome | what happened |
|---|---|---|---|---|---|
| t002 | direct | 100 | 3 | gave up | said "The search results indicated a tool for answering notes in Saleswave Enterprise (saleswave_enterprise_reply_n…" |
| t002 | direct | 200k | 3 | retrieval miss | never got `saleswave_enterprise_reply_note_by_url`; searched "access Saleswave Enterprise, answer a jotting/note at a spe…", "answer or reply to a jotting in Saleswave Enterprise" |
| t003 | direct | 200k | 10 | wrong tool | called `crmbay_reopen_deal_by_id` instead of `crmbay_eu_reopen_deal_by_id` |
| t004 | direct | 200k | 3 | retrieval miss | never got `signalbay_enterprise_delete_dashboard_by_id`; searched "delete or remove a metrics view in Signalbay Enterprise", "delete metrics view in Signalbay Enterprise with ID" |
| t005 | direct | 10k | 3 | retrieval miss | never got `chargebay_us_list_payout`; searched "access Chargebay US to retrieve transfer outs on the Globex…", "Chargebay US list transfer outs account" and 1 more |
| t005 | direct | 100 | 10 | gave up | said "The tool chargebay_us_list_payout for accessing Chargebay US account data and transfer outs is not currently…" |
| t005 | direct | 10k | 10 | retrieval miss | never got `chargebay_us_list_payout`; searched "access Chargebay US to retrieve transfer outs on the Globex…", "list transfers or transfer outs in Chargebay US" and 1 more |
| t006 | direct | 10k | 3 | retrieval miss | never got `knownest_share_page_by_url`; searched "share or collaborate on a page/document on Knownest with sp…", "Knownest page sharing or collaboration" |
| t006 | direct | 200k | 3 | wrong tool | called `knownest_eu_share_page_by_url` instead of `knownest_share_page_by_url` |
| t006 | direct | 10k | 10 | retrieval miss | never got `knownest_share_page_by_url`; searched "share or add access to a page/write-up on Knownest with spe…", "Knownest page sharing or access management" and 1 more |
| t006 | direct | 200k | 10 | wrong tool | called `knownest_share_page_by_id` instead of `knownest_share_page_by_url` |
| t007 | direct | 10k | 3 | wrong tool | called `daybay_v2_create_event` instead of `daybay_create_event` |
| t007 | direct | 200k | 3 | wrong tool | called `daybay_v2_create_event` instead of `daybay_create_event` |
| t007 | direct | 10k | 10 | wrong tool | called `daybay_v2_create_event` instead of `daybay_create_event` |
| t007 | direct | 200k | 10 | wrong tool | called `daybay_v2_create_event` instead of `daybay_create_event` |
| t008 | direct | 200k | 3 | retrieval miss | never got `slack_enterprise_pin_thread_by_id`; searched "pin or stick a message/conversation in Slack Enterprise" |
| t008 | direct | 200k | 10 | retrieval miss | never got `slack_enterprise_pin_thread_by_id`; searched "pin or stick a conversation/message in Slack" |
| t009 | direct | 200k | 3 | retrieval miss | never got `gitforge_v2_get_branch_by_id`; searched "lookup reference number in Gitforge v2" |
| t009 | direct | 200k | 10 | retrieval miss | never got `gitforge_v2_get_branch_by_id`; searched "look up reference number in Gitforge v2" |
| t011 | direct | 200k | 3 | retrieval miss | never got `campaignly_us_delete_signature_by_id`; searched "delete or drop a sign-off block in Campaignly", "delete or remove a sign-off block by ID in Campaignly" |
| t013 | direct | 100 | 3 | gave up | said "The Merchnest v2 archive tool was identified in the catalog but is not available for use." |
| t013 | direct | 100 | 10 | gave up | said "The appropriate tool for shelving the SKU listing (merchnest_v2_archive_product_by_url) was identified but is…" |
| t013 | direct | 10k | 3 | retrieval miss | never got `merchnest_v2_archive_product_by_url`; searched "update or shelve a product listing on Merchnest e-commerce…", "get or retrieve product details from Merchnest v2 by produc…" |
| t013 | direct | 200k | 3 | retrieval miss | never got `merchnest_v2_archive_product_by_url`; searched "shelve or update product listing status on Merchnest v2", "shelve or archive product on Merchnest" and 1 more |
| t014 | direct | 200k | 3 | retrieval miss | never got `bugloop_eu_create_epic_due`; searched "create an umbrella item in Bugloop EU under the API project", "create an item or ticket in Bugloop EU" and 1 more |
| t015 | direct | 100 | 10 | gave up | said "The Knowly Cloud workspace update tool (knowly_cloud_update_workspace_by_url) was found in the search results…" |
| t015 | direct | 200k | 10 | wrong tool | called `knowly_cloud_update_workspace_by_id` instead of `knowly_cloud_update_workspace_by_url` |
| t015 | direct | 200k | 3 | retrieval miss | never got `knowly_cloud_update_workspace_by_url`; searched "edit or rename a workspace in Knowly Cloud", "update a Knowly workspace by ID or get workspace details fr…" and 1 more |
| t032 | direct | 100 | 3 | gave up | said "Created public agenda 'q4-launch' in Sales workspace (ID: 63142)." (1 of 2 parts done) |
| t032 | direct | 200k | 3 | retrieval miss | never got `slotnest_cloud_create_calendar_vis`; searched "create and manage agendas in Slotnest Cloud, specifically i…", "access Trackbay EU to view epics or umbrella items" and 2 more (1 of 2 parts done) |
| t032 | direct | 200k | 10 | wrong tool | called `slotnest_cloud_create_calendar` instead of `slotnest_cloud_create_calendar_vis` (1 of 2 parts done) |
| t033 | direct | 200k | 3 | retrieval miss | never got `staffwise_create_onboard_task`; searched "file a new-hire to-do in Support via Staffwise", "Staffwise create task to-do Support new-hire" and 1 more (0 of 2 parts done) |
| t033 | direct | 200k | 10 | wrong tool | called `staffwise_v2_create_onboard_task` instead of `staffwise_create_onboard_task` (0 of 2 parts done) |
| t034 | direct | 200k | 3 | wrong tool | called `knownest_list_workspace` instead of `knownest_enterprise_list_workspace` (1 of 2 parts done) |
| t035 | direct | 200k | 3 | retrieval miss | never got `signalwave_enterprise_create_silence`; searched "create or set up a quiet period in Signalwave Enterprise", "cancel or remove a silence in Signalwave" (0 of 2 parts done) |
| t002 | librarian | 200k | 3 | retrieval miss | never got `saleswave_enterprise_reply_note_by_url`; searched "interact with Saleswave Enterprise, add a comment or answer…" |
| t002 | librarian | 200k | 10 | wrong tool | called `saleswave_enterprise_reply_note_by_id` instead of `saleswave_enterprise_reply_note_by_url` |
| t003 | librarian | 200k | 3 | retrieval miss | never got `crmbay_eu_reopen_deal_by_id`; searched "revive or reopen a sales opportunity/deal in Crmbay EU CRM", "Crmbay reopen or revive deal 89438" |
| t003 | librarian | 200k | 10 | retrieval miss | never got `crmbay_eu_reopen_deal_by_id`; searched "revive or update a sale in Crmbay EU CRM system" |
| t005 | librarian | 200k | 3 | retrieval miss | never got `chargebay_us_list_payout`; searched "access Chargebay US account, retrieve transfer outs on Glob…", "get transfer transactions, list transfers on account Charge…" |
| t006 | librarian | 200k | 10 | retrieval miss | never got `knownest_share_page_by_url`; searched "write or update a page on Knownest" |
| t007 | librarian | 200k | 3 | wrong tool | called `daybay_create_event_invite` instead of `daybay_create_event` |
| t006 | librarian | 200k | 3 | retrieval miss | never got `knownest_share_page_by_url`; searched "Knownest write-up or page editor for people ops", "update or write to a web page or document platform" |
| t008 | librarian | 200k | 3 | retrieval miss | never got `slack_enterprise_pin_thread_by_id`; searched "pin or stick a conversation in Slack Enterprise" |
| t008 | librarian | 200k | 10 | wrong tool | called `slack_enterprise_pin_message_by_id` instead of `slack_enterprise_pin_thread_by_id` |
| t007 | librarian | 200k | 10 | wrong tool | called `daybay_create_booking` instead of `daybay_create_event` |
| t009 | librarian | 200k | 3 | wrong tool | called `gitforge_v2_get_issue_by_id` instead of `gitforge_v2_get_branch_by_id` |
| t009 | librarian | 200k | 10 | wrong tool | called `gitforge_v2_get_issue_by_id` instead of `gitforge_v2_get_branch_by_id` |
| t013 | librarian | 200k | 3 | retrieval miss | never got `merchnest_v2_archive_product_by_url`; searched "shelve or deactivate a product SKU listing on Merchnest mar…", "update product status or manage SKU inventory on Merchnest" and 1 more |
| t015 | librarian | 200k | 3 | retrieval miss | never got `knowly_cloud_update_workspace_by_url`; searched "edit a workspace in Knowly Cloud to rename it", "get information about a Knowly Cloud workspace by its ID" and 1 more |
| t032 | librarian | 200k | 10 | retrieval miss | never got `slotnest_cloud_create_calendar_vis`; searched "create an agenda in Slotnest Cloud within Sales and make it…", "access and display an umbrella item from Trackbay EU using…" (1 of 2 parts done) |
| t033 | librarian | 200k | 3 | retrieval miss | never got `staffwise_create_onboard_task`; searched "file a to-do in Staffwise Support category", "Staffwise task management create new to-do" and 1 more (0 of 2 parts done) |
| t033 | librarian | 200k | 10 | wrong tool | called `staffwise_cloud_create_onboard_task`, `staffwise_cloud_approve_onboard_task_by_id` instead of `staffwise_create_onboard_task`, `staffwise_approve_onboard_task_by_id` (0 of 2 parts done) |
| t035 | librarian | 200k | 3 | retrieval miss | never got `signalwave_enterprise_create_silence`, `signalwave_enterprise_cancel_silence_by_id`; searched "Signalwave Enterprise quiet period management - create and…" (0 of 2 parts done) |
| t035 | librarian | 200k | 10 | retrieval miss | never got `signalwave_enterprise_cancel_silence_by_id`; searched "Signalwave Enterprise quiet period management", "Signalwave Enterprise create add silence quiet period" (1 of 2 parts done) |
| t001 | re-ranker | 200k | 10 | wrong tool | called `staffwise_v2_delete_job_posting_by_id` instead of `staffwise_delete_job_posting_by_id` |
| t002 | re-ranker | 200k | 3 | wrong tool | called `saleswave_enterprise_reply_note_by_id` instead of `saleswave_enterprise_reply_note_by_url` |
| t002 | re-ranker | 200k | 10 | wrong tool | called `saleswave_enterprise_reply_note_by_id` instead of `saleswave_enterprise_reply_note_by_url` |
| t004 | re-ranker | 200k | 3 | retrieval miss | never got `signalbay_enterprise_delete_dashboard_by_id`; searched "delete or remove a metrics view in Signalbay Enterprise", "Signalbay Enterprise delete metrics view" and 1 more |
| t003 | re-ranker | 200k | 3 | retrieval miss | never got `crmbay_eu_reopen_deal_by_id`; searched "revive or update a sale in progress on Crmbay CRM system" |
| t006 | re-ranker | 200k | 3 | retrieval miss | never got `knownest_share_page_by_url`; searched "share or grant access to a write-up on Knownest with specif…" |
| t006 | re-ranker | 200k | 10 | retrieval miss | never got `knownest_share_page_by_url`; searched "share or grant access to a write-up on Knownest with specif…", "Knownest share or grant access to pages or content" |
| t007 | re-ranker | 200k | 3 | wrong tool | called `daybay_v2_create_event` instead of `daybay_create_event` |
| t008 | re-ranker | 200k | 3 | retrieval miss | never got `slack_enterprise_pin_thread_by_id`; searched "pin or stick a conversation in Slack Enterprise" |
| t007 | re-ranker | 200k | 10 | wrong tool | called `daybay_cloud_create_event` instead of `daybay_create_event` |
| t008 | re-ranker | 200k | 10 | retrieval miss | never got `slack_enterprise_pin_thread_by_id`; searched "pin or stick a conversation in Slack Enterprise" |
| t009 | re-ranker | 200k | 3 | wrong tool | called `gitforge_v2_get_issue_by_id` instead of `gitforge_v2_get_branch_by_id` |
| t009 | re-ranker | 200k | 10 | wrong tool | called `gitforge_v2_get_issue_by_id` instead of `gitforge_v2_get_branch_by_id` |
| t012 | re-ranker | 200k | 3 | wrong tool | called `taskforge_list_member` instead of `taskforge_enterprise_list_member` |
| t013 | re-ranker | 200k | 3 | retrieval miss | never got `merchnest_v2_archive_product_by_url`; searched "shelve or hide a product listing on Merchnest v2", "update product status to shelved or inactive on Merchnest" |
| t013 | re-ranker | 200k | 10 | retrieval miss | never got `merchnest_v2_archive_product_by_url`; searched "shelve or deactivate a product listing on Merchnest v2" |
| t014 | re-ranker | 200k | 3 | retrieval miss | never got `bugloop_eu_create_epic_due`; searched "create an umbrella item in Bugloop EU under the API project", "create an item or issue in Bugloop EU" and 1 more |
| t015 | re-ranker | 200k | 3 | wrong tool | called `knowly_cloud_update_workspace_by_id` instead of `knowly_cloud_update_workspace_by_url` |
| t015 | re-ranker | 200k | 10 | wrong tool | called `knowly_cloud_update_workspace_by_id` instead of `knowly_cloud_update_workspace_by_url` |
| t032 | re-ranker | 200k | 10 | gave up | stopped without finishing (1 of 2 parts done) |
| t032 | re-ranker | 200k | 3 | retrieval miss | never got `slotnest_cloud_create_calendar_vis`; searched "create an agenda in Slotnest Cloud Sales space and make it…", "view umbrella item epic in Trackbay EU" and 3 more (1 of 2 parts done) |
| t033 | re-ranker | 200k | 3 | wrong tool | called `staffwise_v2_create_onboard_task_owner` instead of `staffwise_create_onboard_task` (0 of 2 parts done) |
| t033 | re-ranker | 200k | 10 | wrong tool | called `staffwise_cloud_create_onboard_task` instead of `staffwise_create_onboard_task` (0 of 2 parts done) |
| t034 | re-ranker | 200k | 3 | retrieval miss | never got `daynest_cloud_create_reminder_invite`; searched "create a nudge or event in Daynest Cloud Team Calendar", "list team spaces in Knownest Enterprise under a specific or…" (1 of 2 parts done) |
| t034 | re-ranker | 200k | 10 | retrieval miss | never got `daynest_cloud_create_reminder_invite`; searched "create a nudge in Team Calendar in Daynest Cloud", "get team spaces in Knownest Enterprise" and 1 more (1 of 2 parts done) |

## Tasks

| task | kind | prompt | expected tool |
|---|---|---|---|
| t001 | single | Nuke vacancy number 28286 in Staffwise. | `staffwise_delete_job_posting_by_id` |
| t002 | single | Using Saleswave Enterprise, answer this jotting: https://saleswave.example.com/initech/notes/94963 saying "Needs design review first". | `saleswave_enterprise_reply_note_by_url` |
| t003 | single | Revive sale in progress 89438 on Crmbay EU. | `crmbay_eu_reopen_deal_by_id` |
| t004 | single | Nuke the metrics view with id 9937 via Signalbay Enterprise. | `signalbay_enterprise_delete_dashboard_by_id` |
| t005 | single | On Chargebay US, give me all transfer outs on the Globex account. | `chargebay_us_list_payout` |
| t006 | single | On Knownest, let this write-up: https://knownest.example.com/people-ops/pages/61863 with priya@nimbus.io and jordan@acme.com. | `knownest_share_page_by_url` |
| t007 | single | Set up an appointment onto Team Calendar on Daybay called "Rotate API keys quarterly" from 2026-10-07T09:30:00Z. | `daybay_create_event` |
| t008 | single | Stick conversation number 1095 using Slack Enterprise. | `slack_enterprise_pin_thread_by_id` |
| t009 | single | Look up ref number 11866 via Gitforge v2. | `gitforge_v2_get_branch_by_id` |
| t010 | single | Get rid of the pay stub with id 80360 in Peoplenest Enterprise. | `peoplenest_enterprise_delete_payslip_by_id` |
| t011 | single | Drop the sign-off block with id 66675 in Campaignly US. | `campaignly_us_delete_signature_by_id` |
| t012 | single | Using Taskforge Enterprise, show every teammates in project OPS. | `taskforge_enterprise_list_member` |
| t013 | single | Shelve this SKU listing: https://merchnest.example.com/acme-outlet/products/61054 on Merchnest v2. | `merchnest_v2_archive_product_by_url` |
| t014 | single | In Bugloop EU, set up an umbrella item under the API project with the heading "Add dark mode toggle" due 2026-12-05. | `bugloop_eu_create_epic_due` |
| t015 | single | Edit this team space: https://knowly.example.com/tidal/workspaces/95280 via Knowly Cloud to be called "ops-runbooks". | `knowly_cloud_update_workspace_by_url` |
| t031 | chain | Bill a card charge against customer cus_t5l2w via Ledgerbay Cloud for 32 GBP, then kill it. | `ledgerbay_cloud_create_charge` → `ledgerbay_cloud_cancel_charge_by_id` |
| t032 | cross_app | Spin up an agenda inside Sales in Slotnest Cloud named "q4-launch" and make it public. Also, show me this umbrella item: https://trackbay.example.com/web/epics/79026 using Trackbay EU. | `slotnest_cloud_create_calendar_vis` → `trackbay_eu_get_epic_by_url` |
| t033 | chain | Via Staffwise, file a new-hire to-do in Support called "Mobile nav overlaps header", then accept it. | `staffwise_create_onboard_task` → `staffwise_approve_onboard_task_by_id` |
| t034 | cross_app | Via Daynest Cloud, set up a nudge in Team Calendar titled "Upgrade Postgres to 16" from 2026-10-21T11:00:00Z and loop in jordan@acme.com and priya@nimbus.io. Also, give me all team spaces under nimbus in Knownest Enterprise. | `daynest_cloud_create_reminder_invite` → `knownest_enterprise_list_workspace` |
| t035 | chain | Using Signalwave Enterprise, set up a quiet period coming from search-worker called "Login page crashes on submit" kicking off at 2026-10-21T11:00:00Z, then call it off. | `signalwave_enterprise_create_silence` → `signalwave_enterprise_cancel_silence_by_id` |

## Terms

- **tools / N**: catalog size. The trial's own target plus N − 1 others from a fixed shuffle, so a
  smaller catalog is a subset of a bigger one.
- **k**: tools handed to the agent per search.
- **delivered**: every target reached the agent through some search.
- **outcome**: the first thing that went wrong, in this order: hallucinated tool, retrieval miss,
  bad args, wrong tool, step limit, gave up. For two-step tasks, the first step not done.
- **chain**: create something, then act on it by the id that came back. **cross_app**: two
  unrelated jobs in different apps.

## Setup

node v25.9.0 · claude code 2.1.283 · os Darwin 25.6.0 arm64 · qdrant http://localhost:6333

Data checksums after `npm run gen`:

```text
2e87c399e48b5a09b121469b7b599c96fe7c963ea807926b210515adc1a333bb  data/tools.jsonl
94a1b067a0272bea4f8c9e5f45c8b629409d14ad6a637c645b580309346191b6  data/tasks.jsonl
```

| setting | value |
|---|---|
| worker_turns_per_part | 8 |
| worker_searches_per_part | 3 |
| query_agent_turns | 6 |
| query_agent_searches | 4 |
| embedding_model | Xenova/bge-small-en-v1.5 |
| timeout_ms_per_part | 240000 |
| rerank_candidates | 50 |

Worker system prompt:

```text
You complete tasks by calling tools. You start with NO domain tools.
1. Call request_tools with a short description of the capability you need: which app, which kind of object, which action. It returns tool definitions that become available to you.
2. Call the tool that does the job, with arguments taken from the task. If a call fails validation, fix the arguments and retry.
3. If the task has several parts, do them in order and search again for each part as needed.
4. When every part is done, call finish with status "completed". If no suitable tool exists after searching, call finish with status "cannot_complete".
Never invent tool names. Do not ask questions; act on the task as given.
```
