export const WORKFLOW_STEP_DEFINITIONS = [
    { id: "fetch_ticket", label: "Fetch Tickets" },
    { id: "evaluate_guardrails", label: "Guardrails" },
    { id: "comment_start", label: "Start Comment" },
    { id: "prepare_repository", label: "Prepare Repo" },
    { id: "document_context", label: "Document Context" },
    { id: "implement_changes", label: "Implement" },
    { id: "review_implementation", label: "Review" },
    { id: "validation", label: "Validate" },
    { id: "commit_push", label: "Commit & Push" },
    { id: "create_pull_request", label: "Create PR" },
    { id: "finalize_jira", label: "Finalize Jira" }
];
