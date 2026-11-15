import json
from uuid import uuid4

from app.ai.contracts import Result
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
    first_problem = "给定函数 f。\n（1）求 f(2)。\n（2）证明 f 单调。"
    problems = iter([first_problem, first_problem.replace("f(2)", "f(3)"), "说明函数与关系的区别"])
    generated = []

    async def generate(self, operation, context):
        generated.append((operation, context))
        if operation == LessonOperation.PLAN:
            return validate_model_output(operation, draft_data | {"problem": next(problems)})
        return validate_model_output(
            operation, {"title": "主题", "content": context["step"]["objective"]}
        )

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
    assert first["problem_parts"] == {
        "statement": "给定函数 f。",
        "parts": [{"number": 1, "text": "求 f(2)。"}, {"number": 2, "text": "证明 f 单调。"}],
    }
    assert "reference_answer" not in str(first)
    assert "第二步目标" not in str(first)
    assert send(start)["data"] == first
    assert len(generated) == 2
    send(command("complete", first), 400)
    send(command("next", first, subquestion=3), 400)
    next_step = command("next", first, subquestion=2)
    second = send(next_step)["data"]
    assert send(next_step)["data"] == second
    send(next_step | {"subquestion": 1}, 409)
    assert second["question"] == first["question"]
    assert second["status"] == "final_step"
    assert second["completed_steps"] == [first["current_step"]]
    assert generated[-1][1]["step"]["objective"] == "第二步目标"
    assert generated[-1][1]["active_subquestion"] == {"number": 2, "text": "证明 f 单调。"}
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


def test_can_leave_a_multipart_question_without_completing_the_hidden_plan(
    example_conversation, draft_data, monkeypatch
):
    _, client, conversation_id = example_conversation
    url = f"/api/v1/learning/conversations/{conversation_id}/lesson/task"
    problems = iter(["给定函数 f。\n（1）求值。\n（2）求定义域。", "解释什么是反函数。"])

    async def generate(self, operation, context):
        if operation == LessonOperation.PLAN:
            return validate_model_output(operation, draft_data | {"problem": next(problems)})
        return validate_model_output(operation, {"title": "讲解", "content": "从定义出发。"})

    monkeypatch.setattr(LessonGenerator, "generate", generate)
    start = {"action": "start", "request_id": str(uuid4()), "expected_revision": 0}
    first = client.post(url, json=start).json()["data"]
    assert first["status"] != "completed"
    assert "next-question" in first["actions"]

    def move_on(task):
        return client.post(
            url,
            json={
                "action": "next-question",
                "request_id": str(uuid4()),
                "expected_revision": task["revision"],
                "expected_task_id": task["task_id"],
                "expected_plan_id": task["plan"]["plan_id"],
                "expected_step_index": task["current_step"]["index"],
            },
        )

    response = move_on(first)
    assert response.status_code == 200
    following = response.json()["data"]
    assert following["question"]["problem"] == "解释什么是反函数。"
    assert "next-question" not in following["actions"]
    assert move_on(following).status_code == 400
    assert client.post(url, json=start).json()["data"] == first


def test_explains_only_the_requested_subquestion_without_advancing_the_lesson(
    example_conversation, draft_data, monkeypatch
):
    app, client, conversation_id = example_conversation
    url = f"/api/v1/learning/conversations/{conversation_id}/lesson/task"
    draft_data["problem"] = "给定函数 f。\n（1）求值。\n（2）求定义域。\n（3）讨论单调性。"
    provider = client.post(
        "/api/v1/ai/providers",
        json={"provider_name": "local", "base_url": "http://localhost:1234/v1"},
    ).json()["data"]
    assert (
        client.post(
            f"/api/v1/ai/providers/{provider['id']}/models",
            json={"model_name": "subquestion-fixture"},
        ).status_code
        == 201
    )
    calls = []
    output = {"title": "判断单调性", "content": "比较两个输入对应的函数值。"}
    actual_generate = LessonGenerator.generate

    async def generate(self, operation, context):
        if operation == LessonOperation.PLAN:
            return validate_model_output(operation, draft_data)
        if operation == LessonOperation.NEXT:
            return validate_model_output(operation, {"title": "第一问", "content": "先求值。"})
        return await actual_generate(self, operation, context)

    async def gateway(target, call, sink):
        calls.append(call)
        return Result(text="", structured=output)

    monkeypatch.setattr(LessonGenerator, "generate", generate)
    monkeypatch.setattr(app.state.ai_gateway, "execute", gateway)
    initial = client.post(
        url, json={"action": "start", "request_id": str(uuid4()), "expected_revision": 0}
    ).json()["data"]
    explain_url = url + "/subquestion"
    body = {"expected_revision": initial["revision"], "subquestion": 3}
    assert client.post(explain_url, json=body | {"expected_revision": 2}).status_code == 409
    assert client.post(explain_url, json=body | {"subquestion": 4}).status_code == 400
    response = client.post(explain_url, json=body)
    assert response.status_code == 200
    assert response.json()["data"] == {"number": 3, **output}
    assert client.get(url).json()["data"] == initial
    assert len(calls) == 1
    assert calls[0].prompt_version == "explain-subquestion-v1"
    prompt_input = json.loads(calls[0].messages[-1].content)
    assert prompt_input["statement"] == "给定函数 f。"
    assert prompt_input["active_subquestion"] == {"number": 3, "text": "讨论单调性。"}
    assert "求定义域" not in calls[0].messages[-1].content
    assert "先求值" not in calls[0].messages[-1].content


def test_check_reply_is_saved_before_evaluation_and_support_keeps_step(
    example_conversation, draft_data, monkeypatch
):
    _, client, conversation_id = example_conversation
    url = f"/api/v1/learning/conversations/{conversation_id}/lesson/task"
    evaluation_fails = True
    draft_data["problem"] = "给定函数。\n（1）求定义域。\n（2）讨论单调性。"

    async def generate(self, operation, context):
        if operation == LessonOperation.PLAN:
            return validate_model_output(operation, draft_data)
        if operation == LessonOperation.NEXT:
            return validate_model_output(operation, {"title": "演示", "content": "一段讲解"})
        if operation == LessonOperation.CHECK_FEEDBACK:
            assert context["answer"] == "这是学生答案"
            if evaluation_fails:
                raise AppError("MODEL_TIMEOUT", "模型响应超时", 502)
        if operation in {LessonOperation.CHECK_QUESTION, LessonOperation.CHECK_FEEDBACK}:
            assert context["active_subquestion"] == {"number": 2, "text": "讨论单调性。"}
        text = f"提示 {context['level']}" if operation == LessonOperation.HINT else "简短内容"
        return validate_model_output(operation, {"text": text})

    monkeypatch.setattr(LessonGenerator, "generate", generate)
    state = client.get(url).json()["data"]

    def post(action, status=200, **extra):
        nonlocal state
        body = {
            "action": action,
            "expected_revision": state["revision"],
            "expected_task_id": state.get("task_id"),
            "expected_plan_id": state.get("plan", {}).get("plan_id"),
            "expected_step_index": state.get("current_step", {}).get("index"),
            "request_id": str(uuid4()),
        } | extra
        result = client.post(url, json=body)
        assert result.status_code == status, result.json()
        if status == 200:
            state = result.json()["data"]

    post("start")
    step = state["current_step"]
    for _ in range(3):
        post("hint")
    post("hint", 400)
    assert [hint["level"] for hint in state["support"]["hints"]] == [1, 2, 3]
    post("rephrase")
    assert len(state["support"]["hints"]) == 3
    post("check-question", subquestion=2)
    check_id = state["check"]["check_id"]
    post("check-answer", check_id=check_id, answer="这是学生答案")
    post("evaluate-check", 502, check_id=check_id)
    restored = client.get(url).json()["data"]
    assert restored["check"]["answer"] == "这是学生答案"
    assert restored["check"]["status"] == "awaiting_evaluation"
    evaluation_fails = False
    post("evaluate-check", check_id=check_id)
    assert state["current_step"] == step
    assert state["check"]["status"] == "feedback_ready"
    assert state["check"]["attempt_id"] == restored["check"]["attempt_id"]
    assert state["completion"] is None
