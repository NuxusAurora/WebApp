from app.learning.lesson_state import legacy_state_data
from app.learning.lesson_support import available
from app.learning.problem_parts import problem_fields


def snapshot(conversation_id, row):
    base = {"conversation_id": str(conversation_id), "revision": row.revision if row else 0}
    if row is None or row.plan_id is None:
        return {
            **base,
            "status": "legacy" if row else "not_started",
            "legacy": legacy_state_data(row) if row else None,
            "actions": ["start"],
            **problem_fields(row.state.get("problem") if row else None),
        }
    state = row.state
    steps = state["steps"]
    status = state["status"]
    return {
        **base,
        "task_id": state["task_id"],
        "question": {
            "question_id": state["question_id"],
            "problem": state["problem"],
            "format": "markdown",
        },
        **problem_fields(state["problem"]),
        "plan": {"plan_id": str(row.plan_id), **state["plan"]},
        "current_step": steps[-1],
        "completed_steps": steps if status == "completed" else steps[:-1],
        "status": status,
        "actions": {
            "teaching": ["next"],
            "final_step": ["complete"],
            "completed": ["next-question"],
        }[status]
        + (available(state) if status != "completed" else []),
        "support": state.get("support"),
        "check": state.get("check"),
        "completion": state.get("completion"),
    }


def legacy_view(row):
    if row is None or row.plan_id is None:
        return legacy_state_data(row)
    state = row.state
    step = state["steps"][-1]
    return {
        "revision": row.revision,
        "problem": state["problem"],
        "step": {
            "index": step["index"],
            "title": step["title"],
            "content": step["content"],
            "final": step["is_final_step"],
        },
        "support": None,
        "check": None,
        "complete": state["status"] == "completed",
    }
