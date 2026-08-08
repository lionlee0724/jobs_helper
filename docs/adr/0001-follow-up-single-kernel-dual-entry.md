# Follow-up: single kernel, dual entry

Ring B (in-job-run interleaved follow-up) and Message Assist (manual/batch/run-all) both need the same chat disposition behaviour. We decided that **one FollowUpKernel** (`processFollowUpOnTab` and its successors) owns intent → action, while Ring B and Message Assist remain **two product entry points** that only orchestrate tabs/queues and call the kernel.

We rejected “Message Assist as sole owner / Ring B default off” for this phase because the approved Design Spec requires job-run follow-up interleaved with open-chat; we rejected keeping two parallel implementations because disposition bugs (handoff, resume, outbound screen, caps) had no single locality.

**Consequences:** `runFollowUpBatch` must not inline classify/LLM/send. `followUpInJobRun` defaults to on (user can disable). Multi-list job sources stay Spec debt and are out of scope for this decision.
