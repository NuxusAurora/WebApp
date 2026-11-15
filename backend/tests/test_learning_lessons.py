import json
from uuid import uuid4

import httpx

from app.ai.adapters import OpenAIProvider
from app.ai.gateway import Gateway
from tests.test_knowledge import apply, draft, setup
from tests.test_phase1 import account_app as account_app
from tests.test_phase1 import authenticate


def test_lesson_advances_only_on_confirmation_and_questions_stay_separate(account_app):
    app, client, knowledge, _, _ = setup(account_app)
    assert apply(client, knowledge, draft(client, knowledge)).status_code == 200
    section = knowledge.split("/")[-2]
    project = client.post("/api/v1/learning/projects", json={"section_id": section}).json()["data"]
    path = f"/api/v1/learning/conversations/{project['conversation']['id']}"
    provider = client.post(
        "/api/v1/ai/providers",
        json={"provider_name": "local", "base_url": "http://localhost:1234/v1"},
    ).json()["data"]
    assert (
        client.post(
            f"/api/v1/ai/providers/{provider['id']}/models", json={"model_name": "lesson-fixture"}
        ).status_code
        == 201
    )
    actions = []
    questions = []
    problem = "给定函数 f。\n（1）计算 f(2)。\n（2）解释代入含义。"
    outputs = {
        "start": {
            "problem": problem,
            "title": "明确输入",
            "content": "输入是 2。",
            "final": False,
        },
        "next": {"title": "求输出", "content": "代入表达式。", "final": True},
        "explain": {"text": "先把函数看成一条对应规则。"},
        "hint": {"text": "看括号里。"},
        "check": {"text": "输入是什么？"},
        "evaluate": {"text": "正确。"},
    }

    def respond(request):
        wire = json.loads(request.content)
        assert wire["model"] == "lesson-fixture"
        messages = wire["messages"]
        content = messages[-1]["content"]
        if not content.startswith("{"):
            questions.append(messages)
            answer = "这里的 2 是输入。"
        else:
            data = json.loads(content)
            action = data["操作"]
            actions.append(action)
            if action == "evaluate":
                assert data["理解检测"] == "输入是什么？"
                assert data["学生回答"] == "2"
            answer = json.dumps(outputs[action])
        return httpx.Response(
            200, json={"choices": [{"message": {"content": answer}, "finish_reason": "stop"}]}
        )

    app.state.ai_gateway = Gateway(
        {"openai": OpenAIProvider(httpx.AsyncClient(transport=httpx.MockTransport(respond)))}
    )

    def get_lesson():
        return client.get(path + "/lesson").json()["data"]

    def post(body):
        return client.post(path + "/lesson", json=body)

    def payload(action, revision, **extra):
        return {"action": action, "revision": revision, "request_id": str(uuid4()), **extra}

    assert get_lesson() == {"revision": 0}
    assert post(payload("next", 0)).status_code == 400
    assert actions == []
    start = payload("start", 0)
    first = post(start).json()["data"]
    assert (first["problem"], first["step"]["index"]) == (problem, 1)
    assert post(start).json()["data"] == first
    assert actions == ["start"]
    assert post(payload("next", 0)).status_code == 409
    assert post(payload("evaluate", 1, response="2")).status_code == 400

    scoped = {"request_id": str(uuid4()), "after": 0, "question": "解释一下。", "subquestion": 2}
    assert client.post(path + "/turns", json=scoped | {"lesson_revision": 2}).status_code == 409
    assert (
        client.post(
            path + "/turns", json=scoped | {"lesson_revision": 1, "subquestion": 3}
        ).status_code
        == 400
    )
    for position, question in enumerate(("2 代表什么？", "为什么不是输出？"), 1):
        focus = {"subquestion": 2, "lesson_revision": 1} if position == 2 else {}
        result = client.post(
            path + "/turns",
            json={
                "request_id": str(uuid4()),
                "after": position - 1,
                "question": question,
            }
            | focus,
        )
        assert result.json()["data"]["position"] == position
    assert "明确输入" in questions[0][0]["content"]
    assert "求输出" not in questions[1][0]["content"]
    assert questions[1][1]["content"] == "2 代表什么？"
    assert '"当前小题": {"number": 2, "text": "解释代入含义。"}' in questions[1][0]["content"]
    assert get_lesson() == first

    for revision, action in enumerate(("explain", "hint", "check", "evaluate"), 1):
        extra = {"response": "2"} if action == "evaluate" else {}
        state = post(payload(action, revision, **extra)).json()["data"]
        assert state["step"] == first["step"]
    assert state["support"] == {"kind": "evaluate", "text": "正确。"}

    second = post(payload("next", 5)).json()["data"]
    assert second["problem"] == first["problem"]
    assert second["step"]["index"] == 2
    assert second["support"] is None
    assert second["check"] is None
    assert client.get(path + "/turns").json()["data"]["turns"][1]["position"] == 2

    done = post(payload("next", 6)).json()["data"]
    assert done["complete"]
    assert done == get_lesson()
    assert actions.count("next") == 1
    assert post(payload("next", 7)).status_code == 400
    assert post(payload("start", 7)).json()["data"]["step"]["index"] == 1

    authenticate(client, app, "other@example.com")
    assert client.get(path + "/lesson").status_code == 404
    assert post(payload("next", 8)).status_code == 404
