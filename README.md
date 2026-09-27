# k-onfused

How well does an LLM agent pick the right tool when it has to search for it in a catalog of 100 to
200,000 tools, and how many results should each search return (k)?

![Success rate vs catalog size](results/main1/figures/success-direct-claude-haiku-4-5.svg)

Up to 10k tools nothing much changes. At 200k, success drops to 30% with 3 tools per search and 60%
with 10. A librarian model and a local re-ranker were no better than plain search: the agent usually
gets the right tool and then picks a near-identical one.

![Search methods compared at 200k tools](results/main1/figures/modes.svg)

Full results are in [results/main1](results/main1).

## How it works

Tools and tasks are generated from a seed, so every run sees the same catalog. The agent is headless
Claude Code with no tools except `request_tools(need)`: the request is embedded, searched in Qdrant
over a catalog of N tools, and the top k become callable. Calls go to a mock that validates the
arguments, and a trial passes if the right tool was called with the right arguments.

## Run

```sh
npm install
docker compose up -d qdrant
npm run gen -- --count 200000 --tasks 30 --multi 10
npm run index
npm run trial -- --task t001 --N 10000 --k 3
npm run experiment -- --N 100,10000,200000 --k 3,10 --mode direct --model haiku --run-id mine
npm run results -- --run-id mine
```

It uses your Claude Code login, so nothing is billed on a subscription. `--mode rerank` and
`--mode query_agent` switch the search method, and `npm run report` builds an interactive
`report.html` from every trial.
