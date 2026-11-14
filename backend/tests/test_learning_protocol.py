from uuid import uuid4

from app.errors import AppError
from app.learning.contracts import LessonOperation, validate_model_output
from app.learning.lesson_generation import LessonGenerator
from tests.test_learning_contracts import draft_data as draft_data
from tests.test_learning_legacy_reads import example_conversation as example_conversation
from tests.test_phase1 import account_app as account_app
from tests.test_phase1 import authenticate


def test_protocol_commands_and_public_history(example_conversation, draft_data, monkeypatch):
    app, client, conversation_id = example_conversation
    url = f"/api/v1/learning/conversations/{conversation_id}/lesson/task"
    first_step = draft_data["steps"][0]
    draft_data["steps"] = [first_step, dict(first_step, index=2, objective="第二步目标")]
    problems = iter(["求 f(2)", "求 f(3)", "说明函数与关系的区别"])
    generated = []

    async def generate(self, operation, context):
        generated.append((operation, context))
        if operation == LessonOperation.PLAN:
            return validate_model_output(operation, draft_data | {"problem": next(problems)})
        return validate_model_output(operation, {"title": "主题", "content": "讲解"})

    monkeypatch.setattr(LessonGenerator, "generate", generate)

    def command(action, state, **overrides):
        return {
            "action": action,
            "request_id": str(uuid4()),
            "expected_revision": state["revision"],
            "expected_task_id": state.get("task_id"),
            "expected_plan_id": (state.get("plan") or {}).get("plan_id"),
            "expected_step_index": (state.get("current_step") or {}).get("index"),
        } | overrides

    def send(body, status=200):
        response = client.post(url, json=body)
        assert response.status_code == status, response.json()
        return response.json()

    empty = client.get(url).json()["data"]
    start = command("start", empty)
    first = send(start)["data"]
    assert first["status"] == "teaching"
    assert first["plan"]["total_steps"] == 2
    assert first["current_step"]["index"] == 1
    assert "reference_answer" not in str(first)
    assert "第二步目标" not in str(first)
    assert send(start)["data"] == first
    assert len(generated) == 2
    send(command("complete", first), 400)
    second = send(command("next", first))["data"]
    assert second["question"] == first["question"]
    assert second["status"] == "final_step"
    assert second["completed_steps"] == [first["current_step"]]
    assert generated[-1][1]["step"]["objective"] == "第二步目标"
    assert send(command("next", first), 409)["error"]["details"]["snapshot"] == second
    done = send(command("complete", second))["data"]
    assert done["status"] == "completed"
    assert done["completion"]["completed_at"]
    assert len(generated) == 3
    following = send(command("next-question", done))["data"]
    assert following["question"]["problem"] == "说明函数与关系的区别"
    for key in ("task_id", "question", "plan"):
        assert following[key] != first[key]
    assert send(start)["data"] == first
    assert client.get(url).json()["data"] == following
    authenticate(client, app, "other@example.com")
    assert client.get(url).status_code == 404
    send(command("next", following), 404)


def test_first_step_failure_leaves_no_plan(example_conversation, draft_data, monkeypatch):
    app, client, conversation_id = example_conversation
    url = f"/api/v1/learning/conversations/{conversation_id}/lesson/task"

    async def generate(self, operation, context):
        if operation == LessonOperation.PLAN:
            return validate_model_output(operation, draft_data)
        raise AppError("MODEL_OUTPUT_INVALID", "模型输出无效", 502)

    monkeypatch.setattr(LessonGenerator, "generate", generate)
    empty = client.get(url).json()["data"]
    assert (
        client.post(
            url,
            json={
                "action": "start",
                "request_id": str(uuid4()),
                "expected_revision": empty["revision"],
            },
        ).status_code
        == 502
    )
    assert client.get(url).json()["data"] == empty
