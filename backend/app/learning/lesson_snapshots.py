from app.learning.lesson_state import legacy_state_data, question_timeline
from app.learning.lesson_support import available
from app.learning.practice import practice_actions
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
    fields = problem_fields(state["problem"])
    practice = state.get("practice")
    navigation = practice_actions(practice, status, bool(fields))
    actions = {
        "teaching": ["next"],
        "final_step": ["complete"],
        "completed": [],
    }[status]
    if status != "completed":
        actions.extend(available(state))
    return {
        **base,
        "task_id": state["task_id"],
        "question": {
            "question_id": state["question_id"],
            "problem": state["problem"],
            "format": "markdown",
            "type_title": practice["types"][practice["current"]]["title"] if practice else None,
        },
        **fields,
        "plan": {"plan_id": str(row.plan_id), **state["plan"]},
        "current_step": steps[-1],
        "completed_steps": steps if status == "completed" else steps[:-1],
        "status": status,
        "actions": [*actions, *navigation],
        "practice": practice,
        "support": state.get("support"),
        "check": state.get("check"),
        "completion": state.get("completion"),
    }


async def conversation_snapshot(db, conversation_id, row):
    result = snapshot(conversation_id, row)
    if row is not None and row.revision > 1:
        timeline = await question_timeline(db, conversation_id, row.revision)
        if len(timeline) > 1:
            result["previous_questions"] = []
            for entry, first_revision in timeline:
                if entry.revision == row.revision:
                    result["question_order"] = first_revision
                else:
                    result["previous_questions"].append(
                        {
                            **snapshot(conversation_id, entry),
                            "actions": [],
                            "question_order": first_revision,
                        }
                    )
    return result


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
