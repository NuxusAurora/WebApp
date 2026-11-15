from datetime import UTC, datetime
from uuid import uuid4

from app.errors import AppError
from app.learning.contracts import LessonOperation
from app.learning.problem_parts import selected_subquestion

OPERATIONS = {
    "hint": LessonOperation.HINT,
    "rephrase": LessonOperation.REPHRASE,
    "check-question": LessonOperation.CHECK_QUESTION,
    "evaluate-check": LessonOperation.CHECK_FEEDBACK,
}


def available(state):
    support = state.get("support") or {}
    check = state.get("check")
    actions = ["rephrase"]
    if len(support.get("hints", [])) < 3:
        actions.append("hint")
    if check is None or check["status"] == "feedback_ready":
        actions.append("check-question")
    elif check["status"] == "awaiting_answer":
        actions.append("check-answer")
    else:
        actions.append("evaluate-check")
    return actions


def require_input(command, state):
    if command.action in {"check-answer", "evaluate-check"}:
        check = state.get("check")
        if not check or str(command.check_id) != check["check_id"]:
            raise AppError("INVALID_TRANSITION", "检测题已变更，请重新读取")
    elif command.check_id is not None:
        raise AppError("INVALID_TRANSITION", "当前操作无需检测题")
    if (command.action == "check-answer") != bool(command.answer.strip()):
        raise AppError("INVALID_TRANSITION", "请检查作答内容")


async def apply_support(generator, command, state, plan, material, subquestion=None):
    action = command.action
    support = dict(state.get("support") or {})
    check = dict(state.get("check") or {})
    current = state["steps"][-1]
    if action == "check-answer":
        check.update(
            status="awaiting_evaluation",
            attempt_id=str(uuid4()),
            answer=command.answer.strip(),
            answered_at=datetime.now(UTC).isoformat(),
        )
        return {"check": check}

    planned = plan.steps[current["index"] - 1]
    hints = support.get("hints", [])
    context = {
        "material": material,
        "problem": state["problem"],
        "step": current,
        "criteria": planned.completion_criteria,
        "forbidden": planned.forbidden,
    }
    if action == "hint":
        context.update(level=len(hints) + 1, previous_hints=hints)
    if action == "evaluate-check":
        context.update(check_question=check["question"], answer=check["answer"])
        subquestion = selected_subquestion(state["problem"], check.get("subquestion"))
    if subquestion is not None:
        context["active_subquestion"] = subquestion
    for _ in range(2):
        output = await generator.generate(OPERATIONS[action], context)
        text = output.text
        protected = [*planned.forbidden]
        if not current["is_final_step"]:
            protected.append(plan.reference_answer)
        if any(len(value) >= 8 and value in text for value in protected):
            continue
        if action == "hint":
            if any(hint["text"].strip() == text.strip() for hint in hints):
                continue
            support["hints"] = [*hints, {"level": len(hints) + 1, "text": text}]
        elif action == "rephrase":
            if text.strip() == current["content"].strip():
                continue
            support["rephrase"] = text
        elif action == "check-question":
            return {
                "check": {
                    "check_id": str(uuid4()),
                    "status": "awaiting_answer",
                    "question": text,
                    "created_at": datetime.now(UTC).isoformat(),
                    **({"subquestion": subquestion["number"]} if subquestion is not None else {}),
                }
            }
        else:
            check.update(
                status="feedback_ready", feedback=text, evaluated_at=datetime.now(UTC).isoformat()
            )
            return {"check": check}
        return {"support": support}
    raise AppError("MODEL_OUTPUT_INVALID", "辅助内容未通过校验，请重试", 502)
