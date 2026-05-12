---
id: "019e1bea-c427-7b4b-b503-bbb2e23a5a4c"
url: "https://ampcode.com/news/deep-mode"
title: "Go Deep"
captured_at: "2026-05-12T11:20:31.016Z"
extraction_status: "success"
---
# Go Deep

\(Update on February 19, 2026: [deep now uses GPT\-5\.3\-Codex](https://ampcode.com/news/gpt-5.3-codex)\.\)

Amp has a new agent mode: deep\. It uses GPT\-5\.2\-Codex and a selection of tools that are tuned to what this model is good at\.

Where smart is eager, collaborative, and happy to edit right away, deep will silently read files and move through the codebase for five, ten, sometimes fifteen minutes before making changes \- happy to be left alone\.

GPT\-5\.2\-Codex in deep is not an assistant that's constantly checking in with you\. It wants to go off and solve problems on its own, not pair program\. But that requires a clear definition of the problem up front, which you'll either need to provide in your first prompt, or ask deep to work out with you before you tell it to go and implement it\.

Here are some prompts that worked really well in deep mode:

- [Nicolay, changing how Skills register MCP tools](https://ampcode.com/threads/T-019c0416-78f2-7298-8926-369b325f7188): "A user has multiple skills, each skill has a mcp\.json with the same server name and url, but with different includeTools list\. So each skill uses a different subset of tools\. Each mcp can only be registered once and last registration wins\. But for each mcp within a skill we are only registering its subset of tools\. So when the user has multiple skills, it is probably only having one set of tools being registered instead of all\. How can we fix this? we could: \\[\.\.\.\\]"

- [Thorsten, fixing a theme bug, and providing a screenshot](https://ampcode.com/threads/T-019bfa3e-6b60-706f-880f-75c7fdb82ef7): "Ever since we added @doc/cli\-themes\.md there's a bug: the selected message has a different color than normal messages\. It should match\."

The autonomy of deep has limits: it's very good at fixing issues in one go, but it's also very lazy when it comes to running commands or checking its work\. It also doesn't pay as much attention to AGENTS\.md files as Opus does\. That's an area we're actively improving\.

We're very excited by how deep complements smart: use smart when you want to interactively work on something together, or get chores done; use deep when you want it to research thoroughly or fix hairy problems on its own\. You can now also ask [the agent to handoff](https://ampcode.com/news/ask-to-handoff) to deep or smart mode\.

To use it: run command mode: use deep in the Amp CLI, or select deep mode in the Amp editor extension's prompt field\.

![Deep mode in action](https://static.ampcode.com/news/deep-mode-2.png)