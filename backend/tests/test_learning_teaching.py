from uuid import uuid4

from app.ai.contracts import AIError, Result
from tests.test_knowledge import apply, draft, setup
from tests.test_phase1 import account_app as account_app
from tests.test_phase1 import authenticate


def test_teaching_resumes_and_uses_only_the_current_conversation(account_app):
    app, client, knowledge, _, cookie = setup(account_app)
    assert apply(client, knowledge, draft(client, knowledge)).status_code == 200
    section = knowledge.split("/")[-2]
    project = client.post("/api/v1/learning/projects", json={"section_id": section}).json()["data"]
    path = f"/api/v1/learning/conversations/{project['conversation']['id']}/turns"
    first = {"request_id": str(uuid4()), "after": 0, "question": "什么是函数？"}
    assert client.get(path).json()["data"] == {"turns": [], "before": None}
    assert client.post(path, json=first).json()["error"]["code"] == "AI_CONFIG_INCOMPLETE"
    provider = client.post(
        "/api/v1/ai/providers",
        json={"provider_name": "local", "base_url": "http://localhost:1234/v1"},
    ).json()["data"]
    assert (
        client.post(
            f"/api/v1/ai/providers/{provider['id']}/models", json={"model_name": "teaching-fixture"}
        ).status_code
        == 201
    )
    calls = []

    async def execute(target, call, sink):
        calls.append(call.messages)
        if len(calls) == 1:
            raise AIError("AI_TIMEOUT")
        assert target.model_name == "teaching-fixture"
        return Result(text="每个输入只有一个对应的输出。")

    app.state.ai_gateway.execute = execute
    assert client.post(path, json=first).status_code == 502
    assert client.get(path).json()["data"]["turns"] == []
    saved = client.post(path, json=first).json()["data"]
    assert saved["position"] == 1
    assert client.post(path, json=first).json()["data"] == saved
    assert len(calls) == 2
    assert "非空集合之间的唯一对应" in calls[-1][0].content

    followup = {"request_id": str(uuid4()), "after": 1, "question": "能举个例子吗？"}
    assert client.post(path, json=followup | {"after": 0}).status_code == 409
    second = client.post(path, json=followup).json()["data"]
    assert second["position"] == 2
    assert [(message.role, message.content) for message in calls[-1][1:]] == [
        ("user", first["question"]),
        ("assistant", saved["answer"]),
        ("user", followup["question"]),
    ]
    assert client.get(path).json()["data"]["turns"] == [saved, second]
    assert client.get(path, params={"before": 2}).json()["data"]["turns"] == [saved]
    assert client.get(knowledge).json()["data"]["knowledge_points"][0]["status"] == "NOT_STARTED"

    authenticate(client, app, "other@example.com")
    assert client.get(path).status_code == 404
    assert client.post(path, json=followup).status_code == 404
    client.cookies.set("learning_session", cookie)
    assert (
        client.patch(
            f"/api/v1/courses/{project['course_id']}", json={"status": "archived"}
        ).status_code
        == 200
    )
    assert client.get(path).status_code == 404
