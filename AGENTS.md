# How I directed the agent

I built this with Claude Code as the implementer and myself as the reviewer and decision-maker. The agent wrote most of the code. These are the rules I held it to, and the moments where holding them changed the result. I also used a separate Claude agent as a second reviewer for the plan and each phase report; I made the calls and sent the direction.

## The working agreement

- **Phase gates with review.** The work ran in phases: plan, foundation, grading and eval, product, load test, final pass. At the end of each phase the agent stopped and reported what was done, what it decided, what it was unsure about, test results and its commits. Nothing moved forward, and nothing was pushed, until I'd reviewed it. Decisions it couldn't make alone went into `DECISIONS.md` for me to approve or change.
- **Spend approval.** Before any eval or real-model run, the agent printed a projected cost, and anything over $2 needed my yes. A budget guard in the app refuses model calls below a floor. The whole project used about $0.27 of model credit.
- **Git rules.** Small logical commits that each build and pass tests, with conventional messages. Only my name on commits: no co-author or tool trailers, and no touching git config. Before every push, two scans: one for attribution lines and one for API keys in the full history. Secrets and private notes stay gitignored.
- **Verify APIs against source.** Effect v4 is new and moves fast, so the agent checked every API against a pinned clone of the Effect repo instead of trusting memory. That's how we found the repo it was told to use had been archived, and switched to the canonical one (D-16).
- **SLOs before load tests.** The pass/fail bar was agreed before the first run: zero lost work checked against the database, latency and time-to-grade targets at a stated load, and a validity gate so a slow load generator can't produce a fake pass (D-22). The verdict comes from those numbers, not from how the run felt.

## Where direction changed the outcome

- **The hard set caught the fallback.** The 20-case eval said three cheap models were equally good. I asked for a small set of nasty cases on top. It showed the planned fallback model confidently "reading" an unreadable scribble and awarding 3 of 4 points, every time. That's the one error a teacher would never catch, so the fallback was replaced (D-30).
- **The transfer budget caught a real bug.** Our database's free tier allows 5 GB of transfer a month, shared with production. I capped the load test at 2 GB and required each run to project its transfer before starting. Measuring it showed every student poll was carrying their submitted drawings, a regression from an earlier UI change that every test had missed. It was fixed before the big runs (D-31).
- **Re-measure, don't claim.** The load test found the first breakpoint and the agent proposed raising concurrency as the fix. I asked for it applied and re-measured at 2× and 4×, with the reasoning shown via Little's law and the untested assumption stated plainly: the provider has to accept that concurrency. The claim became a measured result (D-32).
- **Simplifying the hosting.** This one was my own push-back. The first hosting plan grew to a second deployed environment, a separately deployed fake model, and the cloud setup around them. I cut it to one service and one database, with the simulator inside the app and the load test aimed at the real public URL. That kept the infrastructure proportional to what the brief asks for and kept the focus on the product (D-28).
